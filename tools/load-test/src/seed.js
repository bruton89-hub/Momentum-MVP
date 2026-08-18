"use strict";

/**
 * Synthetic-data seeder for the Momentum capacity benchmark.
 *
 * PRODUCTION-GUARDED: refuses to run unless the target passes
 * assertSafeTarget (see guard.js). All synthetic records are identifiable:
 * document IDs are prefixed `lt-` and every document carries
 * `loadtest: true`. Auth users use the reserved domain
 * `@loadtest.momentum.test`.
 */

const fs = require("node:fs");
const path = require("node:path");
const { assertSafeTarget } = require("./guard");
const { createAdminContext } = require("./adminContext");

const PASSWORD = "LoadTest!2026";
const USER_PREFIX = "lt-user-";
const POST_PREFIX = "lt-seed-post-";
const BATTLE_PREFIX = "lt-seed-battle-";
const HOT_BATTLE_ID = "lt-hot-battle";
const RESULTS_DIR = path.resolve(__dirname, "..", "results");

function userEmail(index) {
  return `lt-user-${index}@loadtest.momentum.test`;
}

function mediaUrlFor(projectId, uid, file) {
  return (
    `https://firebasestorage.googleapis.com/v0/b/${projectId}.appspot.com/o/` +
    `posts%2F${uid}%2F${file}?alt=media&token=loadtest`
  );
}

async function inPool(items, limit, worker) {
  const executing = new Set();
  const results = [];
  for (const [index, item] of items.entries()) {
    const promise = Promise.resolve()
      .then(() => worker(item, index))
      .finally(() => executing.delete(promise));
    executing.add(promise);
    results.push(promise);
    if (executing.size >= limit) await Promise.race(executing);
  }
  return Promise.all(results);
}

/**
 * @param {object} options
 * @param {string} options.projectId
 * @param {object} options.emulators
 * @param {object} options.dataset {users, posts, battles, followsPerUser}
 */
async function seed({ projectId, emulators, env = process.env, dataset = {}, log = console.log }) {
  // Guard FIRST — before any SDK/client is constructed.
  const target = assertSafeTarget({ projectId, emulators, env });

  const users = dataset.users ?? 200;
  const posts = dataset.posts ?? 1_000;
  const battles = dataset.battles ?? 40;
  const followsPerUser = dataset.followsPerUser ?? 8;

  const context = createAdminContext({ projectId, emulators, env });
  const { db, auth } = context;
  const startedAt = Date.now();

  // ── Auth users + profiles ──────────────────────────────────────────────────
  log(`[seed] creating ${users} synthetic users…`);
  const userIds = Array.from({ length: users }, (_, index) => `${USER_PREFIX}${index}`);
  await inPool(userIds, 32, async (uid, index) => {
    try {
      await auth.createUser({
        uid,
        email: userEmail(index),
        password: PASSWORD,
        displayName: `lt_athlete_${index}`,
      });
    } catch (error) {
      if (error?.errorInfo?.code !== "auth/uid-already-exists" &&
          error?.code !== "auth/uid-already-exists" &&
          !String(error?.message).includes("already exists")) {
        throw error;
      }
    }
  });

  let batch = db.batch();
  let pending = 0;
  const flush = async () => {
    if (pending > 0) {
      await batch.commit();
      batch = db.batch();
      pending = 0;
    }
  };
  const queue = async (ref, data) => {
    batch.set(ref, data);
    pending += 1;
    if (pending >= 400) await flush();
  };

  const sports = ["Basketball", "Football", "Soccer", "Track", "Baseball"];
  for (const [index, uid] of userIds.entries()) {
    const username = `lt_athlete_${index}`;
    await queue(db.collection("users").doc(uid), {
      username,
      usernameLower: username.toLowerCase(),
      schoolLower: `loadtest high ${index % 25}`,
      cityLower: "benchmark city",
      bio: "synthetic load-test athlete",
      sport: sports[index % sports.length],
      athleteType: sports[index % sports.length],
      avatar: "",
      avatarUrl: "",
      posts: 0,
      wins: 0,
      losses: 0,
      school: `Loadtest High ${index % 25}`,
      city: "Benchmark City",
      state: "CA",
      loadtest: true,
      createdAt: new Date(startedAt - index * 60_000),
    });
  }
  await flush();

  // ── Posts (dataset backbone for the feed) ──────────────────────────────────
  log(`[seed] creating ${posts} synthetic posts…`);
  const now = Date.now();
  const monthMs = 30 * 24 * 3_600_000;
  for (let index = 0; index < posts; index += 1) {
    const uid = userIds[index % userIds.length];
    const id = `${POST_PREFIX}${index}`;
    const createdAt = new Date(now - Math.floor((index / posts) * monthMs));
    await queue(db.collection("posts").doc(id), {
      userId: uid,
      authorId: uid,
      uid,
      username: `lt_athlete_${index % userIds.length}`,
      userAvatar: "",
      avatarUrl: "",
      authorAvatar: "",
      mediaUrl: mediaUrlFor(target.projectId, uid, `${id}.mp4`),
      mediaType: index % 3 === 0 ? "image" : "video",
      caption: `synthetic highlight #${index}`,
      battleEnabled: index % 2 === 0,
      likesCount: 0,
      sport: sports[index % sports.length],
      loadtest: true,
      createdAt,
      updatedAt: createdAt,
    });
  }
  await flush();

  // ── Follow graph ───────────────────────────────────────────────────────────
  log(`[seed] creating follow graph (${followsPerUser}/user)…`);
  for (const [index, uid] of userIds.entries()) {
    for (let offset = 1; offset <= followsPerUser; offset += 1) {
      const target = userIds[(index + offset * 7) % userIds.length];
      if (target === uid) continue;
      await queue(db.collection("follows").doc(`${uid}_${target}`), {
        followerId: uid,
        followingId: target,
        loadtest: true,
        createdAt: new Date(startedAt),
      });
    }
  }
  await flush();

  // ── Battles (live, vote-eligible) + the hot battle ─────────────────────────
  log(`[seed] creating ${battles} live battles + hot battle…`);
  const battleIds = [];
  const makeBattle = (id, aIndex, bIndex, createdAtMs) => {
    const uidA = userIds[aIndex % userIds.length];
    const uidB = userIds[bIndex % userIds.length];
    const postA = `${POST_PREFIX}${aIndex % posts}`;
    const postB = `${POST_PREFIX}${bIndex % posts}`;
    return {
      creatorId: uidB,
      playerA: {
        userId: uidA,
        username: `lt_athlete_${aIndex % userIds.length}`,
        avatar: "",
        mediaUrl: mediaUrlFor(target.projectId, uidA, `${postA}.mp4`),
        mediaType: "video",
        postId: postA,
      },
      playerB: {
        userId: uidB,
        username: `lt_athlete_${bIndex % userIds.length}`,
        avatar: "",
        mediaUrl: mediaUrlFor(target.projectId, uidB, `${postB}.mp4`),
        mediaType: "video",
        postId: postB,
      },
      votesA: 0,
      votesB: 0,
      status: "live",
      category: "Highlights",
      durationHours: 24,
      endTime: new Date(createdAtMs + 24 * 3_600_000),
      winner: null,
      statsRecorded: false,
      loadtest: true,
      createdAt: new Date(createdAtMs),
    };
  };
  for (let index = 0; index < battles; index += 1) {
    const id = `${BATTLE_PREFIX}${index}`;
    battleIds.push(id);
    await queue(
      db.collection("battles").doc(id),
      makeBattle(id, index * 2, index * 2 + 1, now - index * 120_000)
    );
  }
  // Hot battle between the first two seeded users — the Workload D target.
  await queue(db.collection("battles").doc(HOT_BATTLE_ID), makeBattle(HOT_BATTLE_ID, 0, 1, now));
  battleIds.push(HOT_BATTLE_ID);
  await flush();

  const manifest = {
    projectId: target.projectId,
    mode: target.mode,
    seededAt: new Date().toISOString(),
    password: PASSWORD,
    users,
    posts,
    battles: battleIds.length,
    followsPerUser,
    userPrefix: USER_PREFIX,
    postPrefix: POST_PREFIX,
    battlePrefix: BATTLE_PREFIX,
    hotBattleId: HOT_BATTLE_ID,
    emailDomain: "loadtest.momentum.test",
  };
  fs.mkdirSync(RESULTS_DIR, { recursive: true });
  fs.writeFileSync(
    path.join(RESULTS_DIR, "seed-manifest.json"),
    JSON.stringify(manifest, null, 2)
  );
  log(
    `[seed] done in ${((Date.now() - startedAt) / 1000).toFixed(1)}s — ` +
      `${users} users, ${posts} posts, ${battleIds.length} battles`
  );
  return manifest;
}

/** Add extra posts on top of an existing seed (used by the dataset-scale bench). */
async function seedMorePosts({ projectId, emulators, env = process.env, fromIndex, toIndex, log = console.log }) {
  const target = assertSafeTarget({ projectId, emulators, env });
  const context = createAdminContext({ projectId, emulators, env });
  const { db } = context;
  const manifestPath = path.join(RESULTS_DIR, "seed-manifest.json");
  const manifest = JSON.parse(fs.readFileSync(manifestPath, "utf8"));
  const userCount = manifest.users;
  const now = Date.now();
  const monthMs = 30 * 24 * 3_600_000;

  let batch = db.batch();
  let pending = 0;
  for (let index = fromIndex; index < toIndex; index += 1) {
    const uid = `${USER_PREFIX}${index % userCount}`;
    const id = `${POST_PREFIX}${index}`;
    const createdAt = new Date(now - Math.floor(((index % 100_000) / 100_000) * monthMs));
    batch.set(db.collection("posts").doc(id), {
      userId: uid,
      authorId: uid,
      uid,
      username: `lt_athlete_${index % userCount}`,
      userAvatar: "",
      avatarUrl: "",
      authorAvatar: "",
      mediaUrl: mediaUrlFor(target.projectId, uid, `${id}.mp4`),
      mediaType: index % 3 === 0 ? "image" : "video",
      caption: `synthetic highlight #${index}`,
      battleEnabled: index % 2 === 0,
      likesCount: 0,
      loadtest: true,
      createdAt,
      updatedAt: createdAt,
    });
    pending += 1;
    if (pending >= 400) {
      await batch.commit();
      batch = db.batch();
      pending = 0;
    }
    if (index % 10_000 === 0 && index > fromIndex) log(`[seed] …${index}`);
  }
  if (pending > 0) await batch.commit();
  manifest.posts = Math.max(manifest.posts, toIndex);
  fs.writeFileSync(manifestPath, JSON.stringify(manifest, null, 2));
  return manifest;
}

function readManifest() {
  const manifestPath = path.join(RESULTS_DIR, "seed-manifest.json");
  if (!fs.existsSync(manifestPath)) return null;
  return JSON.parse(fs.readFileSync(manifestPath, "utf8"));
}

module.exports = {
  seed,
  seedMorePosts,
  readManifest,
  PASSWORD,
  USER_PREFIX,
  POST_PREFIX,
  BATTLE_PREFIX,
  HOT_BATTLE_ID,
  RESULTS_DIR,
  userEmail,
};
