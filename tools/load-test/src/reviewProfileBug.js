"use strict";

/**
 * INDEPENDENT REVIEW — verify the claimed profile-grid defect empirically.
 *
 * Claim under review: "athletes with more than 30 posts see an arbitrary 30
 * instead of their newest 30" on the legacy three-alias read path
 * (services/postRepository.ts fetchPostsByUser with
 * EXPO_PUBLIC_POSTS_USERID_BACKFILLED unset).
 *
 * The legacy query is `where(<alias>,'==',uid).limit(30)` with NO orderBy.
 * Firestore returns such a query in __name__ (document id) order. Modern post
 * ids are `post_{base36 millis}_{random}`, which sort lexicographically in
 * ASCENDING time order — so the selection is not merely arbitrary, it is
 * systematically biased toward the OLDEST posts.
 *
 * This runs against the emulator only.
 */

const { resolveTarget } = require("./env");
const { createAdminContext } = require("./adminContext");

async function verifyProfileBug({ env = process.env, postCount = 45 } = {}) {
  const target = resolveTarget({ env });
  const { db } = createAdminContext({
    projectId: target.projectId,
    emulators: target.emulators,
    env,
  });

  const uid = "lt-profilebug-user";
  const base = Date.now() - postCount * 3_600_000;

  // Clear any prior run.
  const existing = await db.collection("posts").where("userId", "==", uid).get();
  let clear = db.batch();
  existing.forEach((d) => clear.delete(d.ref));
  await clear.commit();

  // Create posts with the app's real id scheme, oldest first.
  let batch = db.batch();
  const expectedNewest = [];
  for (let index = 0; index < postCount; index += 1) {
    const createdAtMs = base + index * 3_600_000;
    const id = `post_${createdAtMs.toString(36)}_${String(index).padStart(4, "0")}zzzz`;
    if (index >= postCount - 30) expectedNewest.push(id);
    batch.set(db.collection("posts").doc(id), {
      userId: uid,
      authorId: uid,
      uid,
      username: "profilebug",
      mediaUrl: `https://x/o/posts%2F${uid}%2F${index}.mp4`,
      mediaType: "video",
      caption: `post ${index}`,
      battleEnabled: false,
      likesCount: 0,
      createdAt: new Date(createdAtMs),
      updatedAt: new Date(createdAtMs),
      loadtest: true,
    });
  }
  await batch.commit();

  // ── LEGACY PATH: where(alias)==uid, limit(30), no orderBy ────────────────
  const legacySnap = await db
    .collection("posts")
    .where("userId", "==", uid)
    .limit(30)
    .get();
  const legacyIds = legacySnap.docs.map((d) => d.id);
  const legacyNewest = legacyIds.filter((id) => expectedNewest.includes(id)).length;

  // ── CONSOLIDATED PATH: orderBy createdAt desc, limit(30) ─────────────────
  const consolidatedSnap = await db
    .collection("posts")
    .where("userId", "==", uid)
    .orderBy("createdAt", "desc")
    .limit(30)
    .get();
  const consolidatedIds = consolidatedSnap.docs.map((d) => d.id);
  const consolidatedNewest = consolidatedIds.filter((id) =>
    expectedNewest.includes(id)
  ).length;

  // Read amplification: legacy issues one query per alias.
  const legacyReads = 3 * legacySnap.size;
  const consolidatedReads = consolidatedSnap.size;

  return {
    postsForAthlete: postCount,
    pageSize: 30,
    legacy: {
      returned: legacySnap.size,
      ofTheNewest30: legacyNewest,
      missingNewest: 30 - legacyNewest,
      firstId: legacyIds[0],
      lastId: legacyIds[legacyIds.length - 1],
      reads: legacyReads,
    },
    consolidated: {
      returned: consolidatedSnap.size,
      ofTheNewest30: consolidatedNewest,
      reads: consolidatedReads,
    },
    readAmplification:
      consolidatedReads > 0
        ? Math.round((legacyReads / consolidatedReads) * 100) / 100
        : null,
    bugConfirmed: legacyNewest < 30,
    // If the legacy page is dominated by the oldest posts the selection is
    // systematically biased, not merely unordered.
    systematicallyOldest: legacyNewest === 0,
  };
}

module.exports = { verifyProfileBug };
