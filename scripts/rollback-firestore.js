#!/usr/bin/env node
/**
 * rollback-firestore.js
 *
 * Restores a Firestore backup created by cleanup-firestore.js.
 *
 * USAGE
 * ─────
 *   node scripts/rollback-firestore.js backup-2025-01-01T12-00-00.json
 *
 *   Or restore the most-recent backup automatically:
 *   node scripts/rollback-firestore.js --latest
 *
 * BEHAVIOR
 * ────────
 *  • Reads the backup JSON from scripts/backups/<filename>
 *  • Writes each document back to its original collection + document ID
 *  • Restores Timestamp fields from the serialized __type:timestamp format
 *  • Does NOT wipe the collection first — merges/overwrites individual docs
 *  • Does NOT touch the users collection
 *
 * PREREQUISITES
 * ─────────────
 *  Same as cleanup-firestore.js:
 *  - scripts/serviceAccountKey.json must exist
 *  - firebase-admin must be installed (npm install --save-dev firebase-admin)
 */

"use strict";

const path     = require("path");
const fs       = require("fs");
const readline = require("readline");

const PROJECT_ID          = process.env.FIREBASE_PROJECT_ID;
const SERVICE_ACCOUNT_PATH = path.join(__dirname, "serviceAccountKey.json");
const BACKUPS_DIR         = path.join(__dirname, "backups");
const RESTORE_BATCH_SIZE  = 400;

function prompt(question) {
  return new Promise((resolve) => {
    const rl = readline.createInterface({ input: process.stdin, output: process.stdout });
    rl.question(question, (answer) => { rl.close(); resolve(answer.trim()); });
  });
}

// ── Resolve backup file ───────────────────────────────────────────────────────

function resolveBackupPath(arg) {
  if (!arg || arg === "--latest") {
    // Find most recent backup
    if (!fs.existsSync(BACKUPS_DIR)) {
      console.error("ERROR: No backups directory found. Run cleanup-firestore.js first.");
      process.exit(1);
    }
    const files = fs
      .readdirSync(BACKUPS_DIR)
      .filter((f) => f.startsWith("backup-") && f.endsWith(".json"))
      .sort()
      .reverse();

    if (files.length === 0) {
      console.error("ERROR: No backup files found in scripts/backups/");
      process.exit(1);
    }
    const latest = path.join(BACKUPS_DIR, files[0]);
    console.log(`Using latest backup: ${files[0]}`);
    return latest;
  }

  // Filename or full path provided
  const p = path.isAbsolute(arg) ? arg : path.join(BACKUPS_DIR, arg);
  if (!fs.existsSync(p)) {
    console.error(`ERROR: Backup file not found: ${p}`);
    process.exit(1);
  }
  return p;
}

// ── Deserialize timestamps ────────────────────────────────────────────────────

function deserializeValue(admin, value) {
  if (value === null || value === undefined) return value;

  if (typeof value === "object" && value.__type === "timestamp") {
    return new admin.firestore.Timestamp(value.seconds, value.nanoseconds);
  }

  if (Array.isArray(value)) {
    return value.map((v) => deserializeValue(admin, v));
  }

  if (typeof value === "object") {
    const result = {};
    for (const [k, v] of Object.entries(value)) {
      result[k] = deserializeValue(admin, v);
    }
    return result;
  }

  return value;
}

// ── Main ──────────────────────────────────────────────────────────────────────

async function main() {
  if (!PROJECT_ID) {
    console.error(`
ERROR: FIREBASE_PROJECT_ID is required.

Set it in your shell before running this script:
  FIREBASE_PROJECT_ID=your-project-id node scripts/rollback-firestore.js --latest
`);
    process.exit(1);
  }

  const backupFile = resolveBackupPath(process.argv[2]);

  // ── Load & validate backup ────────────────────────────────────────────────
  let backup;
  try {
    backup = JSON.parse(fs.readFileSync(backupFile, "utf8"));
  } catch (e) {
    console.error("ERROR: Could not parse backup file:", e.message);
    process.exit(1);
  }

  if (!backup.collections || !backup.projectId) {
    console.error("ERROR: Backup file appears corrupt or from a different tool.");
    process.exit(1);
  }

  if (backup.projectId !== PROJECT_ID) {
    console.error(
      `ERROR: Backup is from project '${backup.projectId}' but this script targets '${PROJECT_ID}'.`
    );
    process.exit(1);
  }

  // ── Summary ───────────────────────────────────────────────────────────────
  console.log(`
╔══════════════════════════════════════════════════════════════╗
║  Momentum-MVP  ·  Firestore Rollback                        ║
╚══════════════════════════════════════════════════════════════╝

  Backup file:  ${path.basename(backupFile)}
  Created:      ${backup.timestamp}
  Project:      ${backup.projectId}
`);

  let totalDocs = 0;
  console.log("  Documents to restore:");
  for (const [col, docs] of Object.entries(backup.collections)) {
    console.log(`    ${col.padEnd(12)} ${String(docs.length).padStart(6)}`);
    totalDocs += docs.length;
  }
  console.log(`\n  Total: ${totalDocs} documents`);

  if (totalDocs === 0) {
    console.log("\n  Nothing to restore.\n");
    process.exit(0);
  }

  const answer = await prompt(`
  ⚠️  This will write ${totalDocs} documents back to Firestore.
      Existing documents with the same IDs will be overwritten.

  Type  yes  to continue, anything else to abort: `);

  if (answer.toLowerCase() !== "yes") {
    console.log("\n  Aborted. No changes made.\n");
    process.exit(0);
  }

  // ── Init Firebase Admin ────────────────────────────────────────────────────
  if (!fs.existsSync(SERVICE_ACCOUNT_PATH)) {
    console.error("\nERROR: scripts/serviceAccountKey.json not found.");
    process.exit(1);
  }
  let admin;
  try {
    admin = require("firebase-admin");
  } catch {
    console.error("\nERROR: firebase-admin not installed. Run: npm install --save-dev firebase-admin");
    process.exit(1);
  }

  admin.initializeApp({
    credential: admin.credential.cert(require(SERVICE_ACCOUNT_PATH)),
    projectId:  PROJECT_ID,
  });
  const db = admin.firestore();

  // ── Restore ───────────────────────────────────────────────────────────────
  console.log("\nRestoring documents…\n");

  for (const [col, docs] of Object.entries(backup.collections)) {
    if (docs.length === 0) {
      console.log(`  ${col.padEnd(12)} empty — skipped`);
      continue;
    }

    let restored = 0;
    for (let i = 0; i < docs.length; i += RESTORE_BATCH_SIZE) {
      const chunk = docs.slice(i, i + RESTORE_BATCH_SIZE);
      const batch = db.batch();
      for (const { id, data } of chunk) {
        const deserialized = deserializeValue(admin, data);
        batch.set(db.collection(col).doc(id), deserialized);
      }
      await batch.commit();
      restored += chunk.length;
      process.stdout.write(`\r  ${col.padEnd(12)} ${restored}/${docs.length} restored…`);
    }
    process.stdout.write(`\r  ${col.padEnd(12)} ${docs.length} docs restored ✅\n`);
  }

  console.log(`\n  ✅  Rollback complete. ${totalDocs} documents restored.\n`);
  await admin.app().delete();
}

main().catch((err) => {
  console.error("\nFATAL ERROR:", err.message || err);
  process.exit(1);
});
