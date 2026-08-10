#!/usr/bin/env node
/**
 * backfill-post-user-id.js
 *
 * Stamps a canonical `userId` (and `createdAt`) onto every legacy post document
 * so the client can read posts with ONE indexed query instead of three.
 *
 * WHY THIS EXISTS
 * ───────────────
 * `services/postRepository.ts` queries three author aliases in parallel —
 * userId, authorId, uid — because posts written by early builds carried only
 * one of them. Every post written by the current app carries all three, so
 * those docs match all three queries and are returned, and billed, three times:
 * up to 90 document reads to display a 30-post profile grid.
 *
 * The three-alias path also cannot use orderBy("createdAt","desc") — composite
 * indexes exist for userId+createdAt only — so it takes an arbitrary 30 docs
 * and sorts them client-side. An athlete with more than 30 posts currently sees
 * an arbitrary 30 rather than their 30 newest. That is a correctness bug, not
 * just a cost one.
 *
 * Once every post has `userId`, set in .env:
 *     EXPO_PUBLIC_POSTS_USERID_BACKFILLED=true
 * and the client collapses to a single ordered query: ~66% fewer reads on
 * profile grids and the Following feed, and correct newest-first ordering.
 *
 * WHAT IT DOES
 * ────────────
 *  1. Streams every doc in `posts`.
 *  2. For each doc missing a usable `userId`, resolves one from `authorId`,
 *     then `uid`, then `ownerId` — the same precedence `normalizePost` uses,
 *     so nothing changes about which author a post is attributed to.
 *  3. For each doc missing `createdAt`, sets it from `updatedAt` when present,
 *     otherwise the document's own create time. Required because the
 *     consolidated query orders by `createdAt`, and Firestore silently OMITS
 *     documents that lack the field being ordered on.
 *  4. Writes only those fields, in batches, leaving every other field alone.
 *  5. Reports anything it could not resolve, so no post is silently orphaned.
 *
 * WHAT IT NEVER TOUCHES
 * ─────────────────────
 *  • Any field other than userId / createdAt
 *  • Documents that already have both
 *  • Any other collection, Storage, rules, or indexes
 *
 * SAFETY
 * ──────
 * Additive and idempotent — re-running is a no-op. Runs as a DRY RUN by
 * default and will not write anything until you pass --commit. Always take a
 * backup first (scripts/cleanup-firestore.js writes one to ./backups/).
 *
 * PREREQUISITES
 * ─────────────
 *  1. scripts/serviceAccountKey.json  (Firebase Console → Project Settings →
 *     Service Accounts → Generate New Private Key). Never commit it.
 *  2. npm install --save-dev firebase-admin
 *
 * RUN
 * ───
 *   # Dry run — reports exactly what would change, writes nothing:
 *   FIREBASE_PROJECT_ID=your-project-id node scripts/backfill-post-user-id.js
 *
 *   # Apply:
 *   FIREBASE_PROJECT_ID=your-project-id node scripts/backfill-post-user-id.js --commit
 */

"use strict";

const path = require("path");
const fs = require("fs");

// ── Config ────────────────────────────────────────────────────────────────────

const PROJECT_ID = process.env.FIREBASE_PROJECT_ID;
const SERVICE_ACCOUNT_PATH = path.join(__dirname, "serviceAccountKey.json");

/** Author aliases in the same precedence order normalizePost applies. */
const AUTHOR_ALIASES = ["userId", "authorId", "uid", "ownerId"];

/** Firestore allows 500 writes per batch; stay under it. */
const WRITE_BATCH_SIZE = 400;

/** Writes are opt-in. Without --commit this is a reporting run only. */
const COMMIT = process.argv.includes("--commit");

// ── Bootstrap ─────────────────────────────────────────────────────────────────

if (!PROJECT_ID) {
  console.error(`
ERROR: FIREBASE_PROJECT_ID is required.

  FIREBASE_PROJECT_ID=your-project-id node scripts/backfill-post-user-id.js
`);
  process.exit(1);
}

if (!fs.existsSync(SERVICE_ACCOUNT_PATH)) {
  console.error(`
ERROR: Service account key not found.

  Expected:  scripts/serviceAccountKey.json

  Firebase Console → Project Settings → Service Accounts
  → Generate New Private Key → save to the path above. Never commit it.
`);
  process.exit(1);
}

let admin;
try {
  admin = require("firebase-admin");
} catch {
  console.error(`
ERROR: firebase-admin is not installed.

  npm install --save-dev firebase-admin
`);
  process.exit(1);
}

admin.initializeApp({
  credential: admin.credential.cert(require(SERVICE_ACCOUNT_PATH)),
  projectId: PROJECT_ID,
});

const db = admin.firestore();

// ── Helpers ───────────────────────────────────────────────────────────────────

function usableString(value) {
  return typeof value === "string" && value.trim().length > 0
    ? value.trim()
    : "";
}

/** Resolve an author id using the same precedence the client reader uses. */
function resolveUserId(data) {
  for (const alias of AUTHOR_ALIASES) {
    const value = usableString(data[alias]);
    if (value) return value;
  }
  return "";
}

/** A Firestore Timestamp, or null when the value is not one. */
function usableTimestamp(value) {
  if (!value) return null;
  if (value instanceof admin.firestore.Timestamp) return value;
  if (typeof value.toMillis === "function") return value;
  return null;
}

// ── Main ──────────────────────────────────────────────────────────────────────

async function main() {
  console.log(
    `\nBackfilling posts.userId on project "${PROJECT_ID}"` +
      `\nMode: ${COMMIT ? "COMMIT (writes will be applied)" : "DRY RUN (no writes)"}\n`
  );

  const snapshot = await db.collection("posts").get();
  console.log(`Scanned ${snapshot.size} post documents.\n`);

  const pending = [];
  const unresolved = [];
  let alreadyComplete = 0;

  snapshot.forEach((doc) => {
    const data = doc.data();
    const updates = {};

    if (!usableString(data.userId)) {
      const resolved = resolveUserId(data);
      if (!resolved) {
        // No alias carries an author. These need a human decision — they are
        // most likely corrupt fixtures, not real athlete posts.
        unresolved.push(doc.id);
        return;
      }
      updates.userId = resolved;
    }

    // The consolidated query orders by createdAt, and Firestore OMITS docs
    // that lack the ordered field — a post without createdAt would silently
    // vanish from profiles the moment the flag is flipped.
    if (!usableTimestamp(data.createdAt)) {
      updates.createdAt =
        usableTimestamp(data.updatedAt) ||
        doc.createTime ||
        admin.firestore.Timestamp.now();
    }

    if (Object.keys(updates).length === 0) {
      alreadyComplete += 1;
      return;
    }
    pending.push({ ref: doc.ref, id: doc.id, updates });
  });

  const needsUserId = pending.filter((item) => "userId" in item.updates).length;
  const needsCreatedAt = pending.filter(
    (item) => "createdAt" in item.updates
  ).length;

  console.log("  Already complete           :", alreadyComplete);
  console.log("  Need userId                :", needsUserId);
  console.log("  Need createdAt             :", needsCreatedAt);
  console.log("  Documents to write         :", pending.length);
  console.log("  Unresolvable (no author)   :", unresolved.length);

  if (unresolved.length > 0) {
    console.log(
      "\n  ⚠  These posts carry no author field in any alias and were skipped.\n" +
        "     Inspect them before flipping EXPO_PUBLIC_POSTS_USERID_BACKFILLED —\n" +
        "     the consolidated query will not return them.\n"
    );
    unresolved.slice(0, 25).forEach((id) => console.log(`       posts/${id}`));
    if (unresolved.length > 25) {
      console.log(`       …and ${unresolved.length - 25} more`);
    }
  }

  if (pending.length === 0) {
    console.log(
      "\nNothing to backfill." +
        (unresolved.length === 0
          ? " Safe to set EXPO_PUBLIC_POSTS_USERID_BACKFILLED=true.\n"
          : " Resolve the posts listed above first.\n")
    );
    return;
  }

  if (!COMMIT) {
    console.log("\nSample of pending changes:\n");
    pending.slice(0, 10).forEach(({ id, updates }) => {
      console.log(`  posts/${id}  →  ${JSON.stringify(updates)}`);
    });
    console.log(
      `\nDRY RUN complete — nothing was written.\n` +
        `Re-run with --commit to apply ${pending.length} update(s).\n`
    );
    return;
  }

  let written = 0;
  for (let index = 0; index < pending.length; index += WRITE_BATCH_SIZE) {
    const chunk = pending.slice(index, index + WRITE_BATCH_SIZE);
    const batch = db.batch();
    // merge:true — additive only. No existing field is cleared or overwritten.
    chunk.forEach(({ ref, updates }) => batch.set(ref, updates, { merge: true }));
    await batch.commit();
    written += chunk.length;
    console.log(`  committed ${written}/${pending.length}`);
  }

  console.log(
    `\nBackfill complete — ${written} document(s) updated.\n\n` +
      `Next steps:\n` +
      `  1. Confirm firestore.indexes.json is deployed:\n` +
      `       npx firebase deploy --only firestore:indexes\n` +
      `  2. Set in .env:  EXPO_PUBLIC_POSTS_USERID_BACKFILLED=true\n` +
      `  3. Rebuild the app and spot-check a profile grid and the Following feed.\n` +
      `     Roll back instantly by unsetting the flag — no data change required.\n`
  );
}

main().catch((error) => {
  console.error("\nBackfill failed:", error);
  process.exit(1);
});
