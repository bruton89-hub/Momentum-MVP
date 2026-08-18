"use strict";

/**
 * Focused subsystem benchmarks: feed (incl. dataset scaling), athlete
 * profile, battle stress, and the isolated media/storage track.
 */

const { resolveTarget } = require("./env");
const { assertSafeBenchmarkConfig } = require("./guard");
const { MomentumRestClient } = require("./restClient");
const { Metrics, summarize } = require("./metrics");
const { verifyIntegrity } = require("./integrity");
const {
  PASSWORD,
  USER_PREFIX,
  userEmail,
  readManifest,
} = require("./seed");
const {
  FEED_INITIAL,
  FEED_BACKGROUND,
  PROFILE_POST_LIMIT,
} = require("./workloads");

async function signInPool(client, count, offset = 0) {
  const sessions = [];
  const size = 25;
  for (let index = 0; index < count; index += size) {
    const slice = Array.from(
      { length: Math.min(size, count - index) },
      (_, k) => index + k + offset
    );
    const batch = await Promise.all(
      slice.map(async (userIndex) => {
        const auth = await client.signIn(userEmail(userIndex), PASSWORD);
        return {
          uid: `${USER_PREFIX}${userIndex}`,
          idToken: auth.idToken,
          index: userIndex,
        };
      })
    );
    sessions.push(...batch);
  }
  return sessions;
}

/**
 * Feed benchmark — measures the app's real feed session against the current
 * dataset: first page, background expansion, repeated refreshes, duplicate
 * detection, and the Firestore reads a single feed session generates.
 */
async function feedBenchmark({ sessions = 20, refreshes = 3, env = process.env, log = console.log } = {}) {
  const target = resolveTarget({ env });
  const manifest = readManifest();
  const client = new MomentumRestClient(target);
  const metrics = new Metrics();

  const users = await signInPool(client, Math.min(sessions, manifest.users));
  const observed = { duplicates: 0, sessionsChecked: 0, readsPerSession: [] };

  // Actual dataset size, counted server-side — never trusted from the manifest.
  const { createAdminContext } = require("./adminContext");
  const { db } = createAdminContext({
    projectId: target.projectId,
    emulators: target.emulators,
    env,
  });
  const datasetCount = (await db.collection("posts").count().get()).data().count;

  await Promise.all(
    users.map(async (user) => {
      for (let pass = 0; pass < refreshes; pass += 1) {
        // Read accounting is per-session and local: the shared metrics counter
        // is incremented by every concurrent session, so a before/after delta
        // on it would attribute other sessions' reads to this one.
        let sessionReads = 0;

        const first = await metrics.record(
          "feed.firstPage",
          () => client.runQuery(user.idToken, client.feedFirstPageQuery(FEED_INITIAL)),
          { readsFromResult: (docs) => docs.length }
        );
        sessionReads += first.length;
        let pool = first;
        if (first.length === FEED_INITIAL) {
          const background = await metrics.record(
            "feed.backgroundPage",
            () =>
              client.runQuery(
                user.idToken,
                client.feedNextPageQuery(FEED_BACKGROUND, first[first.length - 1])
              ),
            { readsFromResult: (docs) => docs.length }
          );
          sessionReads += background.length;
          pool = [...first, ...background];
        }

        // Duplicate detection across the paginated pool.
        const ids = new Set();
        for (const post of pool) {
          if (ids.has(post.id)) observed.duplicates += 1;
          ids.add(post.id);
        }
        observed.sessionsChecked += 1;
        observed.readsPerSession.push(sessionReads);
      }
    })
  );

  metrics.finish();
  return {
    datasetPosts: datasetCount,
    sessions: users.length,
    refreshes,
    duplicateDocuments: observed.duplicates,
    // Document reads a SINGLE feed session generates (first page + background
    // expansion). This is the number that multiplies by DAU in the cost model.
    avgFirestoreReadsPerFeedSession:
      observed.readsPerSession.length > 0
        ? Math.round(
            (observed.readsPerSession.reduce((a, b) => a + b, 0) /
              observed.readsPerSession.length) * 10
          ) / 10
        : null,
    ...summarize(metrics),
  };
}

/**
 * Athlete profile benchmark — measures both the legacy three-alias fan-out
 * (current production default) and the consolidated single-query path.
 */
async function profileBenchmark({ sessions = 20, env = process.env } = {}) {
  const target = resolveTarget({ env });
  const manifest = readManifest();
  const client = new MomentumRestClient(target);
  const legacy = new Metrics();
  const consolidated = new Metrics();

  const users = await signInPool(client, Math.min(sessions, manifest.users));

  await Promise.all(
    users.map(async (user, index) => {
      const targetUid = `${USER_PREFIX}${index % Math.min(manifest.users, 200)}`;

      await legacy.record(
        "profile.userDoc",
        () => client.getDoc(user.idToken, "users", targetUid),
        { reads: 1 }
      );
      await Promise.all(
        ["userId", "authorId", "uid"].map((field) =>
          legacy.record(
            "profile.posts.legacy",
            () =>
              client.runQuery(
                user.idToken,
                client.postsByAuthorFieldQuery(field, targetUid, PROFILE_POST_LIMIT)
              ),
            { readsFromResult: (docs) => Math.max(1, docs.length) }
          )
        )
      );

      await consolidated.record(
        "profile.userDoc",
        () => client.getDoc(user.idToken, "users", targetUid),
        { reads: 1 }
      );
      await consolidated.record(
        "profile.posts.consolidated",
        () =>
          client.runQuery(
            user.idToken,
            client.postsByUserOrderedQuery(targetUid, PROFILE_POST_LIMIT)
          ),
        { readsFromResult: (docs) => Math.max(1, docs.length) }
      );
    })
  );

  legacy.finish();
  consolidated.finish();
  return {
    sessions: users.length,
    legacy: summarize(legacy),
    consolidated: summarize(consolidated),
  };
}

/**
 * Battle stress test — concentrated voting on ONE battle.
 * Every voter is a distinct eligible user; the expected accepted-vote count
 * is reconciled against persisted state afterwards.
 */
async function battleStress({ voters, battleId, env = process.env, log = console.log }) {
  const target = resolveTarget({ env });
  assertSafeBenchmarkConfig({ users: voters });
  const manifest = readManifest();
  const client = new MomentumRestClient(target);
  const metrics = new Metrics();

  const targetBattleId = battleId ?? manifest.hotBattleId;
  const { createAdminContext } = require("./adminContext");
  const { db } = createAdminContext({
    projectId: target.projectId,
    emulators: target.emulators,
    env,
  });

  // Reset the battle to a clean live state and clear prior markers so
  // expected-vs-persisted reconciliation is unambiguous.
  const existingMarkers = await db
    .collection("votes")
    .where("battleId", "==", targetBattleId)
    .get();
  let batch = db.batch();
  existingMarkers.forEach((markerSnap) => batch.delete(markerSnap.ref));
  await batch.commit();
  await db.collection("battles").doc(targetBattleId).update({
    votesA: 0,
    votesB: 0,
    status: "live",
    winner: null,
    statsRecorded: false,
    endTime: new Date(Date.now() + 3_600_000),
  });

  const battleSnap = await db.collection("battles").doc(targetBattleId).get();
  const battle = battleSnap.data();
  const participants = new Set([battle.playerA?.userId, battle.playerB?.userId]);

  // Eligible voters only (participants cannot vote in their own battle).
  const eligible = [];
  for (let index = 0; eligible.length < voters && index < manifest.users; index += 1) {
    const uid = `${USER_PREFIX}${index}`;
    if (!participants.has(uid)) eligible.push(index);
  }
  if (eligible.length < voters) {
    throw new Error(
      `battle stress needs ${voters} eligible voters, only ${eligible.length} available`
    );
  }

  const sessions = await Promise.all(
    eligible.map(async (userIndex) => {
      const auth = await client.signIn(userEmail(userIndex), PASSWORD);
      return { uid: `${USER_PREFIX}${userIndex}`, idToken: auth.idToken, index: userIndex };
    })
  );

  // All voters fire as simultaneously as the driver allows — this is the
  // contention test, so no ramp.
  const results = await Promise.allSettled(
    sessions.map((session, index) =>
      metrics.record(
        "battle.vote",
        () =>
          client.callable("castBattleVote", session.idToken, {
            battleId: targetBattleId,
            side: index % 2 === 0 ? "A" : "B",
            clientMutationId: `${targetBattleId}:${session.uid}`,
          }),
        { functionCalls: 1, reads: 2, writes: 2 }
      )
    )
  );

  const applied = results.filter(
    (result) => result.status === "fulfilled" && result.value?.outcome === "applied"
  ).length;
  const alreadyApplied = results.filter(
    (result) => result.status === "fulfilled" && result.value?.outcome === "already_applied"
  ).length;
  const rejected = results.filter((result) => result.status === "rejected");
  const timedOut = rejected.filter((result) => result.reason?.timedOut).length;

  // ── Outcome of client-visible failures ────────────────────────────────────
  // A vote can fail at the client (timeout) while still committing on the
  // server. Distinguishing the two matters: "committed after the client gave
  // up" is a UX-integrity problem (the athlete is told their vote failed), not
  // a data-integrity one, and it must not be counted as a lost write.
  const markersAfterRound1 = await db
    .collection("votes")
    .where("battleId", "==", targetBattleId)
    .get();
  const votedAfterRound1 = new Set();
  markersAfterRound1.forEach((markerSnap) => votedAfterRound1.add(markerSnap.data().userId));

  const failedSessionUids = sessions
    .filter((_, index) => results[index].status === "rejected")
    .map((session) => session.uid);
  const committedDespiteClientFailure = failedSessionUids.filter((uid) =>
    votedAfterRound1.has(uid)
  ).length;
  const lostAfterClientFailure = failedSessionUids.length - committedDespiteClientFailure;

  // ── Duplicate-protection round ────────────────────────────────────────────
  // Every voter votes again. For users who already hold a marker this MUST be
  // refused or reported already_applied. For users whose first attempt never
  // committed, a success here is a legitimate first vote (a real client would
  // likewise let the athlete retry), so it is scored separately.
  const duplicateResults = await Promise.allSettled(
    sessions.map((session) =>
      metrics.record(
        "battle.duplicateVote",
        () =>
          client.callable("castBattleVote", session.idToken, {
            battleId: targetBattleId,
            side: "A",
            clientMutationId: `${targetBattleId}:${session.uid}`,
          }),
        { functionCalls: 1, reads: 2 }
      )
    )
  );
  let duplicateApplied = 0; // second vote applied for a user who already voted
  let retryApplied = 0; // first vote finally landing after a failed attempt
  duplicateResults.forEach((result, index) => {
    if (result.status !== "fulfilled" || result.value?.outcome !== "applied") return;
    if (votedAfterRound1.has(sessions[index].uid)) duplicateApplied += 1;
    else retryApplied += 1;
  });

  metrics.finish();

  // Authoritative expectation: one vote per distinct user who ever succeeded.
  const finalMarkers = await db
    .collection("votes")
    .where("battleId", "==", targetBattleId)
    .get();
  const distinctVoters = new Set();
  finalMarkers.forEach((markerSnap) => distinctVoters.add(markerSnap.data().userId));

  const integrity = await verifyIntegrity({
    projectId: target.projectId,
    emulators: target.emulators,
    env,
    expected: { battleId: targetBattleId, acceptedVotes: distinctVoters.size },
  });
  if (duplicateApplied > 0) {
    integrity.violations.push(
      `${duplicateApplied} users had a SECOND vote applied (duplicate-vote protection failed)`
    );
    integrity.clean = false;
  }
  if (finalMarkers.size !== distinctVoters.size) {
    integrity.violations.push(
      `${finalMarkers.size} vote markers for only ${distinctVoters.size} distinct voters`
    );
    integrity.clean = false;
  }

  const persistedSnap = await db.collection("battles").doc(targetBattleId).get();
  const persisted = persistedSnap.data();

  // Finalization correctness: end the battle and finalize through the real
  // callable, then confirm the winner matches the persisted counters.
  await db.collection("battles").doc(targetBattleId).update({
    endTime: new Date(Date.now() - 60_000),
  });
  let finalization = null;
  try {
    const finalizerSession = sessions[0];
    const result = await metrics.record(
      "battle.finalize",
      () =>
        client.callable("finalizeBattle", finalizerSession.idToken, {
          battleId: targetBattleId,
        }),
      { functionCalls: 1 }
    );
    const afterSnap = await db.collection("battles").doc(targetBattleId).get();
    const after = afterSnap.data();
    const expectedWinner =
      after.votesA > after.votesB
        ? after.playerA?.userId
        : after.votesB > after.votesA
        ? after.playerB?.userId
        : null;
    finalization = {
      status: result?.status ?? null,
      winner: result?.winner ?? null,
      expectedWinner,
      correct: (result?.winner ?? null) === expectedWinner,
      statsRecorded: after.statsRecorded === true,
    };
    if (!finalization.correct) {
      integrity.violations.push(
        `finalization winner ${result?.winner} != expected ${expectedWinner}`
      );
      integrity.clean = false;
    }
  } catch (error) {
    finalization = { error: error.message, code: error.code };
  }

  const summary = summarize(metrics);
  return {
    voters,
    battleId: targetBattleId,
    // Expected = distinct users holding an authoritative vote marker.
    expectedVotes: distinctVoters.size,
    persistedVotes: (persisted.votesA ?? 0) + (persisted.votesB ?? 0),
    persistedA: persisted.votesA ?? 0,
    persistedB: persisted.votesB ?? 0,
    voteMarkers: finalMarkers.size,
    // Round 1 (the true concurrency measurement).
    round1: {
      attempts: voters,
      applied,
      alreadyApplied,
      failed: rejected.length,
      timedOut,
      committedDespiteClientFailure,
      lostAfterClientFailure,
      errorRate: voters ? rejected.length / voters : 0,
    },
    rejectionCodes: rejected.reduce((acc, result) => {
      const code = String(result.reason?.code ?? "unknown");
      acc[code] = (acc[code] ?? 0) + 1;
      return acc;
    }, {}),
    duplicateAttempts: duplicateResults.length,
    duplicateApplied,
    retryApplied,
    finalization,
    integrity,
    ...summary,
  };
}

/**
 * Media/storage benchmark — deliberately isolated from the Firestore
 * benchmark. Uses small synthetic fixtures (never large real video).
 */
async function mediaBenchmark({ uploads = 25, sizeKb = 64, env = process.env } = {}) {
  const target = resolveTarget({ env });
  assertSafeBenchmarkConfig({ users: uploads });
  const manifest = readManifest();
  const client = new MomentumRestClient(target);
  const metrics = new Metrics();

  const sessions = await signInPool(client, Math.min(uploads, manifest.users));
  const payload = Buffer.alloc(sizeKb * 1024, 0x4d); // synthetic fixture bytes
  const uploaded = [];
  const failures = [];

  await Promise.all(
    sessions.map(async (session, index) => {
      const objectPath = `posts/${session.uid}/lt-media-${index}.bin`;
      try {
        await metrics.record(
          "media.upload",
          async () => {
            const response = await fetch(
              target.endpoints.storageUpload(target.bucket, objectPath),
              {
                method: "POST",
                headers: {
                  "Content-Type": "application/octet-stream",
                  Authorization: `Bearer ${session.idToken}`,
                },
                body: payload,
              }
            );
            if (!response.ok) {
              const text = await response.text();
              const error = new Error(`upload HTTP ${response.status}: ${text.slice(0, 120)}`);
              error.code = String(response.status);
              throw error;
            }
            return response.json().catch(() => ({}));
          },
          { writes: 0 }
        );
        uploaded.push({ uid: session.uid, objectPath, idToken: session.idToken });
      } catch (error) {
        failures.push({ objectPath, message: error.message });
      }
    })
  );

  // Metadata write following a successful upload (the app's real sequence).
  await Promise.all(
    uploaded.map((item, index) =>
      metrics.record(
        "media.metadataWrite",
        () =>
          client.commit(item.idToken, [
            client.writeSet("posts", `lt-media-post-${item.uid}-${index}`, {
              userId: item.uid,
              authorId: item.uid,
              uid: item.uid,
              username: `lt_athlete_${index}`,
              userAvatar: "",
              avatarUrl: "",
              authorAvatar: "",
              mediaUrl:
                `https://firebasestorage.googleapis.com/v0/b/${target.bucket}/o/` +
                `${encodeURIComponent(item.objectPath)}?alt=media&token=lt`,
              mediaType: "video",
              caption: "media benchmark",
              battleEnabled: false,
              likesCount: 0,
              createdAt: new Date(),
              updatedAt: new Date(),
            }),
          ]),
        { writes: 1 }
      ).catch((error) => failures.push({ stage: "metadata", message: error.message }))
    )
  );

  // Download/playback read-back.
  await Promise.all(
    uploaded.slice(0, Math.min(uploaded.length, 10)).map((item) =>
      metrics.record("media.download", async () => {
        const response = await fetch(
          `${target.endpoints.storageObject(target.bucket, item.objectPath)}?alt=media`,
          { headers: { Authorization: `Bearer ${item.idToken}` } }
        );
        if (!response.ok) {
          const error = new Error(`download HTTP ${response.status}`);
          error.code = String(response.status);
          throw error;
        }
        const buffer = await response.arrayBuffer();
        return buffer.byteLength;
      }).catch((error) => failures.push({ stage: "download", message: error.message }))
    )
  );

  // Orphan check: an object with no referencing post document.
  const { createAdminContext } = require("./adminContext");
  const { db } = createAdminContext({
    projectId: target.projectId,
    emulators: target.emulators,
    env,
  });
  const postSnapshot = await db.collection("posts").get();
  const referencedPaths = new Set();
  postSnapshot.forEach((postSnap) => {
    const url = postSnap.data().mediaUrl;
    if (typeof url !== "string") return;
    const match = url.match(/\/o\/([^?]+)/);
    if (match) referencedPaths.add(decodeURIComponent(match[1]));
  });
  const orphans = uploaded.filter((item) => !referencedPaths.has(item.objectPath));

  metrics.finish();
  return {
    uploads: sessions.length,
    fixtureSizeKb: sizeKb,
    succeeded: uploaded.length,
    failed: failures.length,
    failures: failures.slice(0, 5),
    orphanedObjects: orphans.length,
    totalBytesUploaded: uploaded.length * sizeKb * 1024,
    ...summarize(metrics),
  };
}

module.exports = {
  feedBenchmark,
  profileBenchmark,
  battleStress,
  mediaBenchmark,
  signInPool,
};
