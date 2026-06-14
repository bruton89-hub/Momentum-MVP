#!/usr/bin/env node
/**
 * cleanup-firestore.js
 *
 * Cleans up test/demo content from Firestore before a fresh test run.
 *
 * WHAT IT DOES
 * ─────────────
 *  1. Counts documents in each target collection
 *  2. Prints a summary table and asks for confirmation
 *  3. Exports a timestamped JSON backup to ./backups/  (rollback source)
 *  4. Deletes all documents in: posts · battles · likes · votes · follows
 *  5. Leaves intact: users · ALL Firestore rules · ALL indexes · ALL Storage
 *
 * WHAT IT NEVER TOUCHES
 * ──────────────────────
 *  • users collection (auth profiles stay)
 *  • Firebase Auth user accounts
 *  • Firestore security rules
 *  • Firebase Storage files
 *  • momentum-mobile-v3 (different project folder, never referenced here)
 *
 * PREREQUISITES
 * ─────────────
 *  1. A Firebase service account key JSON file.
 *     Firebase Console → Project Settings → Service Accounts
 *     → Generate New Private Key  →  save as  scripts/serviceAccountKey.json
 *
 *  2. firebase-admin installed:
 *     cd Momentum-MVP && npm install --save-dev firebase-admin
 *     (or:  npm install firebase-admin  in the scripts/ folder)
 *
 * RUN
 * ───
 *  node scripts/cleanup-firestore.js
 *
 *  Dry-run (count + backup, no deletes):
 *  DRY_RUN=true node scripts/cleanup-firestore.js
 */

"use strict";

const path    = require("path");
const fs      = require("fs");
const readline = require("readline");

// ── Config ────────────────────────────────────────────────────────────────────

const PROJECT_ID = "momentum-app-prod-1e870";

const SERVICE_ACCOUNT_PATH = path.join(__dirname, "serviceAccountKey.json");

/** Collections to wipe.  users is intentionally absent. */
const TARGET_COLLECTIONS = ["posts", "battles", "likes", "votes", "follows"];

/** Batch size for Firestore delete operations (max 500 per commit) */
const DELETE_BATCH_SIZE = 400;

const DRY_RUN = process.env.DRY_RUN === "true";

// ── Bootstrap ─────────────────────────────────────────────────────────────────

if (!fs.existsSync(SERVICE_ACCOUNT_PATH)) {
  console.error(`
╔══════════════════════════════════════════════════════════════════╗
║  ERROR: Service account key not found                           ║
║                                                                  ║
║  Expected:  scripts/serviceAccountKey.json                       ║
║                                                                  ║
║  To generate one:                                                ║
║  1. Go to Firebase Console → Project Settings → Service Accounts ║
║  2. Click "Generate New Private Key"                             ║
║  3. Save the downloaded file as:                                 ║
║       Momentum-MVP/scripts/serviceAccountKey.json                ║
╚══════════════════════════════════════════════════════════════════╝
`);
  process.exit(1);
}

let admin;
try {
  admin = require("firebase-admin");
} catch {
  console.error(`
ERROR: firebase-admin is not installed.

Run one of the following from the Momentum-MVP directory:
  npm install --save-dev firebase-admin

Then re-run this script.
`);
  process.exit(1);
}

admin.initializeApp({
  credential:  admin.credential.cert(require(SERVICE_ACCOUNT_PATH)),
  projectId:   PROJECT_ID,
});

const db = admin.firestore();

// ── Helpers ───────────────────────────────────────────────────────────────────

function prompt(question) {
  return new Promise((resolve) => {
    const rl = readline.createInterface({ input: process.stdin, output: process.stdout });
    rl.question(question, (answer) => { rl.close(); resolve(answer.trim()); });
  });
}

function padEnd(str, len) {
  return String(str).padEnd(len);
}

function padStart(str, len) {
  return String(str).padStart(len);
}

/**
 * Count all documents in a collection by streaming IDs (no document reads).
 * Uses select() to fetch only the __name__ field — cheap on quota.
 */
async function countCollection(collectionName) {
  const snap = await db.collection(collectionName).select().get();
  return snap.size;
}

/**
 * Fetch ALL documents from a collection for backup.
 * Returns an array of { id, data } objects.
 */
async function fetchAllDocs(collectionName) {
  const snap = await db.collection(collectionName).get();
  return snap.docs.map((d) => ({ id: d.id, data: d.data() }));
}

/**
 * Delete all documents in a collection in batches.
 * Returns the total number of documents deleted.
 */
async function deleteAllDocs(collectionName) {
  let total = 0;

  while (true) {
    const snap = await db
      .collection(collectionName)
      .select()                         // only fetch IDs — no data read quota
      .limit(DELETE_BATCH_SIZE)
      .get();

    if (snap.empty) break;

    const batch = db.batch();
    snap.docs.forEach((d) => batch.delete(d.ref));
    await batch.commit();
    total += snap.size;

    process.stdout.write(`\r  ${collectionName}: deleted ${total} docs…`);
  }

  // Clear the progress line
  process.stdout.write(`\r  ${collectionName}: deleted ${total} docs  \n`);
  return total;
}

// ── Main ──────────────────────────────────────────────────────────────────────

async function main() {
  console.log(`
╔══════════════════════════════════════════════════════════════╗
║  Momentum-MVP  ·  Firestore Cleanup                         ║
║  Project: ${padEnd(PROJECT_ID, 48)} ║
║  Mode:    ${padEnd(DRY_RUN ? "DRY RUN (no deletes)" : "LIVE (will delete documents)", 48)} ║
╚══════════════════════════════════════════════════════════════╝
`);

  // ── Step 1: Count ────────────────────────────────────────────────────────────
  console.log("Step 1 of 4 — Counting documents…\n");

  const counts = {};
  for (const col of TARGET_COLLECTIONS) {
    process.stdout.write(`  Counting ${col}…`);
    counts[col] = await countCollection(col);
    process.stdout.write(`\r  ${padEnd(col, 12)} ${padStart(counts[col], 6)} documents\n`);
  }

  // Users count (read-only, shown for reference)
  process.stdout.write("  Counting users (kept)…");
  const userCount = await countCollection("users");
  process.stdout.write(`\r  ${"users (kept)".padEnd(12)} ${padStart(userCount, 6)} documents\n`);

  const totalTarget = Object.values(counts).reduce((a, b) => a + b, 0);

  // ── Step 2: Summary ──────────────────────────────────────────────────────────
  console.log(`
Step 2 of 4 — Summary
  ┌─────────────┬────────────┬───────────┐
  │ Collection  │  Documents │  Action   │
  ├─────────────┼────────────┼───────────┤`);

  for (const col of TARGET_COLLECTIONS) {
    const action = counts[col] === 0 ? "  skip (empty)" : "  DELETE ALL";
    console.log(`  │ ${padEnd(col, 11)} │ ${padStart(counts[col], 10)} │${action.padEnd(10)} │`);
  }

  console.log(`  ├─────────────┼────────────┼───────────┤`);
  console.log(`  │ ${"users".padEnd(11)} │ ${padStart(userCount, 10)} │  KEEP     │`);
  console.log(`  └─────────────┴────────────┴───────────┘`);
  console.log(`\n  Total documents to delete: ${totalTarget}`);

  if (totalTarget === 0) {
    console.log("\n  ✅  All target collections are already empty. Nothing to do.\n");
    process.exit(0);
  }

  if (DRY_RUN) {
    console.log("\n  DRY RUN mode — skipping backup and deletes.\n");
    process.exit(0);
  }

  // ── Step 3: Backup ───────────────────────────────────────────────────────────
  console.log("\nStep 3 of 4 — Creating rollback backup…\n");

  const backupDir = path.join(__dirname, "backups");
  fs.mkdirSync(backupDir, { recursive: true });

  const timestamp   = new Date().toISOString().replace(/[:.]/g, "-").slice(0, 19);
  const backupFile  = path.join(backupDir, `backup-${timestamp}.json`);
  const backup      = { timestamp: new Date().toISOString(), projectId: PROJECT_ID, collections: {} };

  let totalBackedUp = 0;
  for (const col of TARGET_COLLECTIONS) {
    if (counts[col] === 0) {
      backup.collections[col] = [];
      continue;
    }
    process.stdout.write(`  Exporting ${col}…`);
    const docs = await fetchAllDocs(col);
    // Serialize Firestore Timestamps and special types to plain JSON
    backup.collections[col] = docs.map(({ id, data }) => ({
      id,
      data: JSON.parse(JSON.stringify(data, (_, v) => {
        // Convert Firestore Timestamp to plain object
        if (v && typeof v === "object" && "_seconds" in v) {
          return { __type: "timestamp", seconds: v._seconds, nanoseconds: v._nanoseconds };
        }
        return v;
      })),
    }));
    totalBackedUp += docs.length;
    process.stdout.write(`\r  ${padEnd(col, 12)} ${padStart(docs.length, 6)} docs exported\n`);
  }

  fs.writeFileSync(backupFile, JSON.stringify(backup, null, 2), "utf8");
  const backupSizeKB = Math.round(fs.statSync(backupFile).size / 1024);
  console.log(`\n  ✅  Backup saved: ${backupFile}`);
  console.log(`      (${totalBackedUp} documents, ~${backupSizeKB} KB)`);

  // ── Confirmation ─────────────────────────────────────────────────────────────
  const answer = await prompt(`
  ⚠️  About to permanently delete ${totalTarget} documents.
      Users collection is NOT touched.
      Backup is at: ${path.relative(process.cwd(), backupFile)}

  Type  yes  to continue, anything else to abort: `);

  if (answer.toLowerCase() !== "yes") {
    console.log("\n  Aborted. No documents were deleted.\n");
    process.exit(0);
  }

  // ── Step 4: Delete ───────────────────────────────────────────────────────────
  console.log("\nStep 4 of 4 — Deleting documents…\n");

  let grandTotal = 0;
  for (const col of TARGET_COLLECTIONS) {
    if (counts[col] === 0) {
      console.log(`  ${padEnd(col, 12)} already empty — skipped`);
      continue;
    }
    const deleted = await deleteAllDocs(col);
    grandTotal += deleted;
  }

  // ── Final verification ────────────────────────────────────────────────────────
  console.log("\nVerifying counts after delete…\n");
  let allClear = true;
  for (const col of TARGET_COLLECTIONS) {
    const remaining = await countCollection(col);
    const status = remaining === 0 ? "✅  empty" : `⚠️  ${remaining} remaining`;
    console.log(`  ${padEnd(col, 12)} ${status}`);
    if (remaining > 0) allClear = false;
  }

  const usersAfter = await countCollection("users");
  console.log(`  ${"users (kept)".padEnd(12)} ${usersAfter} docs (unchanged)`);

  console.log(`
${allClear ? "  ✅  Cleanup complete." : "  ⚠️   Some documents remain — check Firestore console."}
  Deleted:  ${grandTotal} total documents
  Backup:   ${path.relative(process.cwd(), backupFile)}

  Rollback:  node scripts/rollback-firestore.js ${path.basename(backupFile)}
`);

  await admin.app().delete();
}

main().catch((err) => {
  console.error("\nFATAL ERROR:", err.message || err);
  process.exit(1);
});
