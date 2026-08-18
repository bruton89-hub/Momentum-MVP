"use strict";

/**
 * Transaction-contention probe.
 *
 * Separates two very different causes of transactional write failure:
 *
 *   A) REAL per-document contention — many transactions touching the SAME
 *      document. Firestore production serializes writes to one document
 *      (documented soft limit ~1 sustained write/sec per document), so this
 *      is an architectural property Momentum inherits wherever a counter is
 *      centralised (battles/{id}.votesA|votesB, posts/{id}.likesCount).
 *
 *   B) EMULATOR-WIDE serialization — the Firestore emulator takes coarser
 *      transaction locks than production, so transactions on DISJOINT
 *      documents can also block each other. That is an artifact of the test
 *      environment and must not be reported as a Momentum bottleneck.
 *
 * Method: run the same concurrency twice — once with every writer targeting
 * its own distinct document, once with all writers targeting one shared
 * document — and compare.
 *   disjoint fails ≈ shared fails → environment-wide serialization (B)
 *   disjoint ok, shared fails     → genuine per-document contention (A)
 */

const { resolveTarget } = require("./env");
const { MomentumRestClient } = require("./restClient");
const { Metrics, summarize } = require("./metrics");
const { PASSWORD, USER_PREFIX, userEmail, readManifest } = require("./seed");
const { createAdminContext } = require("./adminContext");

async function signIn(client, index) {
  const auth = await client.signIn(userEmail(index), PASSWORD);
  return { uid: `${USER_PREFIX}${index}`, idToken: auth.idToken, index };
}

async function runLikeWave({ client, metrics, sessions, postIdFor, label }) {
  const results = await Promise.allSettled(
    sessions.map((session, index) =>
      metrics.record(
        label,
        () =>
          client.callable("setPostLike", session.idToken, {
            postId: postIdFor(index),
            liked: true,
            clientMutationId: `${postIdFor(index)}:${session.uid}:true`,
          }),
        { functionCalls: 1 }
      )
    )
  );
  const ok = results.filter((result) => result.status === "fulfilled").length;
  const failed = results.filter((result) => result.status === "rejected");
  const codes = failed.reduce((acc, result) => {
    const code = String(result.reason?.code ?? "unknown");
    acc[code] = (acc[code] ?? 0) + 1;
    return acc;
  }, {});
  return { attempts: sessions.length, ok, failed: failed.length, codes };
}

async function probeContention({ concurrency = 25, env = process.env } = {}) {
  const target = resolveTarget({ env });
  const manifest = readManifest();
  const client = new MomentumRestClient(target);
  const { db } = createAdminContext({
    projectId: target.projectId,
    emulators: target.emulators,
    env,
  });

  const sessions = [];
  for (let index = 0; index < concurrency; index += 1) {
    sessions.push(await signIn(client, index));
  }

  // Fresh target documents owned by a seeded user, so security rules and the
  // callable behave exactly as in the app.
  const ownerUid = `${USER_PREFIX}0`;
  const mediaUrl =
    `https://firebasestorage.googleapis.com/v0/b/${target.bucket}/o/` +
    `posts%2F${ownerUid}%2Fprobe.mp4?alt=media&token=lt`;
  const basePost = {
    userId: ownerUid,
    authorId: ownerUid,
    uid: ownerUid,
    username: "lt_athlete_0",
    userAvatar: "",
    avatarUrl: "",
    authorAvatar: "",
    mediaUrl,
    mediaType: "video",
    caption: "contention probe",
    battleEnabled: false,
    likesCount: 0,
    loadtest: true,
  };

  // Reset helper: recreating a probe post with likesCount=0 while leaving its
  // previous like markers behind would make a *later* run look like a counter
  // mismatch. Markers must be cleared with the counter.
  async function resetProbePosts(ids) {
    for (const id of ids) {
      const markers = await db.collection("likes").where("postId", "==", id).get();
      let markerBatch = db.batch();
      markers.forEach((markerSnap) => markerBatch.delete(markerSnap.ref));
      markerBatch.set(db.collection("posts").doc(id), {
        ...basePost,
        createdAt: new Date(),
        updatedAt: new Date(),
      });
      await markerBatch.commit();
    }
  }

  // ── Wave 1: disjoint documents (one post per writer) ──────────────────────
  const disjointIds = Array.from(
    { length: concurrency },
    (_, index) => `lt-probe-disjoint-${index}`
  );
  await resetProbePosts(disjointIds);

  const disjointMetrics = new Metrics();
  const disjoint = await runLikeWave({
    client,
    metrics: disjointMetrics,
    sessions,
    postIdFor: (index) => disjointIds[index],
    label: "like.disjoint",
  });
  disjointMetrics.finish();

  // ── Wave 2: one shared document (all writers on the same post) ────────────
  const sharedId = "lt-probe-shared";
  await resetProbePosts([sharedId]);

  const sharedMetrics = new Metrics();
  const shared = await runLikeWave({
    client,
    metrics: sharedMetrics,
    sessions,
    postIdFor: () => sharedId,
    label: "like.shared",
  });
  sharedMetrics.finish();

  // ── Persisted-state reconciliation for both waves ─────────────────────────
  const sharedSnap = await db.collection("posts").doc(sharedId).get();
  const sharedMarkers = await db.collection("likes").where("postId", "==", sharedId).get();
  const disjointCounters = await Promise.all(
    disjointIds.map(async (id) => {
      const snap = await db.collection("posts").doc(id).get();
      const markers = await db.collection("likes").where("postId", "==", id).get();
      return { id, likesCount: snap.get("likesCount") ?? 0, markers: markers.size };
    })
  );
  const disjointMismatches = disjointCounters.filter(
    (entry) => entry.likesCount !== entry.markers
  );

  const disjointSummary = summarize(disjointMetrics);
  const sharedSummary = summarize(sharedMetrics);

  const disjointFailRate = disjoint.failed / disjoint.attempts;
  const sharedFailRate = shared.failed / shared.attempts;

  // Latency ratio matters as much as failure rate: if writes to DISJOINT
  // documents slow down just as much as writes to one SHARED document, the
  // serialization is environment-wide rather than per-document.
  const latencyRatio =
    disjointSummary.overall.p95 && sharedSummary.overall.p95
      ? Math.round((sharedSummary.overall.p95 / disjointSummary.overall.p95) * 100) / 100
      : null;

  let verdict;
  if (disjointFailRate >= 0.2 && sharedFailRate >= 0.2) {
    verdict =
      "environment-wide transaction serialization (EMULATOR ARTIFACT) — disjoint " +
      "documents fail as often as a shared one, which production Firestore does not do";
  } else if (disjointFailRate < 0.05 && sharedFailRate >= 0.2) {
    verdict =
      "genuine per-document contention — disjoint writes succeed, shared-document " +
      "writes fail; matches production Firestore's single-document write limit";
  } else if (
    disjointFailRate < 0.05 &&
    sharedFailRate < 0.05 &&
    latencyRatio !== null &&
    latencyRatio < 1.5
  ) {
    verdict =
      "no per-document contention signal at this concurrency — disjoint and shared " +
      "writes behave alike and all succeed; any slowdown is environment-wide " +
      "(EMULATOR ARTIFACT), not Momentum's document layout";
  } else {
    verdict = "mixed/inconclusive — compare the two fail rates and the latency ratio";
  }

  return {
    concurrency,
    disjoint: {
      ...disjoint,
      failRate: Math.round(disjointFailRate * 1000) / 1000,
      p50: disjointSummary.overall.p50,
      p95: disjointSummary.overall.p95,
    },
    shared: {
      ...shared,
      failRate: Math.round(sharedFailRate * 1000) / 1000,
      p50: sharedSummary.overall.p50,
      p95: sharedSummary.overall.p95,
    },
    latencyRatio,
    integrity: {
      sharedLikesCount: sharedSnap.get("likesCount") ?? 0,
      sharedMarkers: sharedMarkers.size,
      sharedConsistent: (sharedSnap.get("likesCount") ?? 0) === sharedMarkers.size,
      disjointMismatches: disjointMismatches.length,
      disjointMismatchDetail: disjointMismatches.slice(0, 5),
    },
    verdict,
  };
}

module.exports = { probeContention };
