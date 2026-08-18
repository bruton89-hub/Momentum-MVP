"use strict";

/**
 * Synthetic-data cleanup for the Momentum capacity benchmark.
 *
 * PRODUCTION-GUARDED with the same guard as the seeder and the benchmarks.
 * Deletes ONLY records this harness created, identified two ways:
 *   - document ID prefix `lt-`
 *   - `loadtest: true` marker field (for docs written by the callables, which
 *     the harness cannot mark directly — those are matched by ID prefix or by
 *     their reference to a synthetic parent)
 * Auth users are removed by the reserved `@loadtest.momentum.test` domain.
 */

const fs = require("node:fs");
const path = require("node:path");
const { assertSafeTarget } = require("./guard");
const { createAdminContext } = require("./adminContext");
const { RESULTS_DIR } = require("./seed");

const SYNTHETIC_ID_PREFIX = "lt-";
const SYNTHETIC_EMAIL_DOMAIN = "loadtest.momentum.test";
const DELETE_BATCH = 400;

function isSyntheticId(id) {
  return typeof id === "string" && id.startsWith(SYNTHETIC_ID_PREFIX);
}

/**
 * A dependent document (like/vote/notification/comment) is synthetic when its
 * own id is prefixed, or when it references a synthetic parent — e.g. a vote
 * created by castBattleVote is `{battleId}_{uid}` where both parts are
 * synthetic.
 */
function isSyntheticDependent(id, data) {
  if (isSyntheticId(id)) return true;
  if (data?.loadtest === true) return true;
  for (const field of ["battleId", "postId", "userId", "recipientId", "actorId", "followerId", "followingId"]) {
    if (isSyntheticId(data?.[field])) return true;
  }
  return false;
}

async function deleteRefs(db, refs, log) {
  let deleted = 0;
  for (let index = 0; index < refs.length; index += DELETE_BATCH) {
    const batch = db.batch();
    refs.slice(index, index + DELETE_BATCH).forEach((ref) => batch.delete(ref));
    await batch.commit();
    deleted += Math.min(DELETE_BATCH, refs.length - index);
  }
  return deleted;
}

/**
 * @param {object} options
 * @param {string} options.projectId
 * @param {object} options.emulators
 * @param {boolean} [options.dryRun]
 */
async function cleanup({ projectId, emulators, env = process.env, dryRun = false, log = console.log }) {
  // Guard FIRST — a cleanup pointed at production would be catastrophic.
  assertSafeTarget({ projectId, emulators, env });

  const { db, auth } = createAdminContext({ projectId, emulators, env });
  const report = { dryRun, collections: {}, authUsers: 0 };

  const collections = [
    "posts",
    "battles",
    "votes",
    "likes",
    "follows",
    "notifications",
    "comments",
    "saves",
    "users",
  ];

  for (const collectionName of collections) {
    const snapshot = await db.collection(collectionName).get();
    const refs = [];
    snapshot.forEach((docSnap) => {
      const data = docSnap.data();
      const synthetic =
        collectionName === "users" || collectionName === "posts" || collectionName === "battles"
          ? isSyntheticId(docSnap.id) || data?.loadtest === true
          : isSyntheticDependent(docSnap.id, data);
      if (synthetic) refs.push(docSnap.ref);
    });
    report.collections[collectionName] = {
      scanned: snapshot.size,
      synthetic: refs.length,
      deleted: 0,
    };
    if (!dryRun && refs.length > 0) {
      report.collections[collectionName].deleted = await deleteRefs(db, refs, log);
    }
    log(
      `[cleanup] ${collectionName}: ${refs.length} synthetic / ${snapshot.size} scanned` +
        (dryRun ? " (dry run)" : " — deleted")
    );
  }

  // ── Auth users ─────────────────────────────────────────────────────────────
  let pageToken;
  const syntheticUids = [];
  do {
    const page = await auth.listUsers(1_000, pageToken);
    page.users.forEach((user) => {
      if (
        (user.email && user.email.endsWith(`@${SYNTHETIC_EMAIL_DOMAIN}`)) ||
        isSyntheticId(user.uid)
      ) {
        syntheticUids.push(user.uid);
      }
    });
    pageToken = page.pageToken;
  } while (pageToken);

  report.authUsers = syntheticUids.length;
  if (!dryRun && syntheticUids.length > 0) {
    for (let index = 0; index < syntheticUids.length; index += 1_000) {
      await auth.deleteUsers(syntheticUids.slice(index, index + 1_000));
    }
  }
  log(`[cleanup] auth users: ${syntheticUids.length}${dryRun ? " (dry run)" : " — deleted"}`);

  if (!dryRun) {
    const manifestPath = path.join(RESULTS_DIR, "seed-manifest.json");
    if (fs.existsSync(manifestPath)) fs.unlinkSync(manifestPath);
  }
  return report;
}

module.exports = { cleanup, isSyntheticId, SYNTHETIC_ID_PREFIX, SYNTHETIC_EMAIL_DOMAIN };
