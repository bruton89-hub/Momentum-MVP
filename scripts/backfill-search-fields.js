#!/usr/bin/env node
/**
 * backfill-search-fields.js
 *
 * Adds the lowercased search-index fields to every existing user document so
 * athlete discovery can find profiles created before search shipped.
 *
 * WHY THIS EXISTS
 * ───────────────
 * Firestore has no full-text search. `services/athleteSearchRepository.ts`
 * does prefix matching with a range query over a lowercased copy of each
 * searchable field:
 *
 *     where('usernameLower', '>=', term) && where('usernameLower', '<', term + '')
 *
 * Range queries are exact and case-sensitive, so the lowercased copy is what
 * makes "chr" find "ChrisFly". Every profile written from now on gets these
 * fields automatically (see `searchFieldsFor` in hooks/useProfile.ts) — this
 * script covers the ones already in the database.
 *
 * Firestore OMITS documents that lack the field being queried, so until this
 * runs, existing athletes are invisible to search. That's the whole point.
 *
 * Also note: `isUsernameTaken` now checks `usernameLower`. Until this backfill
 * runs, existing usernames won't be detected as taken.
 *
 * FIELDS WRITTEN
 * ──────────────
 *   usernameLower  ← username
 *   schoolLower    ← school (or schoolName)
 *   cityLower      ← city
 *
 * WHAT IT NEVER TOUCHES
 * ─────────────────────
 * Any other field, any other collection, Storage, rules, or indexes. Additive
 * and idempotent — re-running is a no-op.
 *
 * PREREQUISITES
 * ─────────────
 *  1. scripts/serviceAccountKey.json  (Firebase Console → Project Settings →
 *     Service Accounts → Generate New Private Key). Never commit it.
 *  2. npm install --save-dev firebase-admin
 *
 * RUN
 * ───
 *   # Dry run — reports what would change, writes nothing:
 *   FIREBASE_PROJECT_ID=your-project-id node scripts/backfill-search-fields.js
 *
 *   # Apply:
 *   FIREBASE_PROJECT_ID=your-project-id node scripts/backfill-search-fields.js --commit
 *
 * AFTERWARDS
 *   npx firebase deploy --only firestore:indexes
 */

"use strict";

const path = require("path");
const fs = require("fs");

const PROJECT_ID = process.env.FIREBASE_PROJECT_ID;
const SERVICE_ACCOUNT_PATH = path.join(__dirname, "serviceAccountKey.json");
const WRITE_BATCH_SIZE = 400;
const COMMIT = process.argv.includes("--commit");

if (!PROJECT_ID) {
  console.error(`
ERROR: FIREBASE_PROJECT_ID is required.

  FIREBASE_PROJECT_ID=your-project-id node scripts/backfill-search-fields.js
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

/** Mirrors searchFieldsFor() in hooks/useProfile.ts — keep the two in step. */
function lower(value) {
  return typeof value === "string" ? value.trim().toLowerCase() : "";
}

async function main() {
  console.log(
    `\nBackfilling user search fields on project "${PROJECT_ID}"` +
      `\nMode: ${COMMIT ? "COMMIT (writes will be applied)" : "DRY RUN (no writes)"}\n`
  );

  const snapshot = await db.collection("users").get();
  console.log(`Scanned ${snapshot.size} user documents.\n`);

  const pending = [];
  const noUsername = [];
  let alreadyComplete = 0;

  snapshot.forEach((doc) => {
    const data = doc.data();
    const desired = {
      usernameLower: lower(data.username),
      schoolLower: lower(data.school || data.schoolName),
      cityLower: lower(data.city),
    };

    if (!desired.usernameLower) {
      // No username at all — unsearchable by name and probably an incomplete
      // signup. Reported rather than silently stamped with empty strings.
      noUsername.push(doc.id);
      return;
    }

    const updates = {};
    for (const [key, value] of Object.entries(desired)) {
      if (data[key] !== value) updates[key] = value;
    }

    if (Object.keys(updates).length === 0) {
      alreadyComplete += 1;
      return;
    }
    pending.push({ ref: doc.ref, id: doc.id, updates });
  });

  console.log("  Already complete         :", alreadyComplete);
  console.log("  Documents to write       :", pending.length);
  console.log("  Skipped (no username)    :", noUsername.length);

  if (noUsername.length > 0) {
    console.log(
      "\n  ⚠  These profiles have no username and will not appear in search:\n"
    );
    noUsername.slice(0, 25).forEach((id) => console.log(`       users/${id}`));
    if (noUsername.length > 25) {
      console.log(`       …and ${noUsername.length - 25} more`);
    }
  }

  if (pending.length === 0) {
    console.log("\nNothing to backfill.\n");
    return;
  }

  if (!COMMIT) {
    console.log("\nSample of pending changes:\n");
    pending.slice(0, 10).forEach(({ id, updates }) => {
      console.log(`  users/${id}  →  ${JSON.stringify(updates)}`);
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
    // merge:true — purely additive; no existing field is cleared.
    chunk.forEach(({ ref, updates }) => batch.set(ref, updates, { merge: true }));
    await batch.commit();
    written += chunk.length;
    console.log(`  committed ${written}/${pending.length}`);
  }

  console.log(
    `\nBackfill complete — ${written} document(s) updated.\n\n` +
      `Next: deploy the indexes so the range queries can run.\n` +
      `  npx firebase deploy --only firestore:indexes\n`
  );
}

main().catch((error) => {
  console.error("\nBackfill failed:", error);
  process.exit(1);
});
