#!/usr/bin/env node
/**
 * expire-unmatched-battles.js
 *
 * Reclassifies battles that were marked "completed" but never had an opponent.
 *
 * WHY THIS EXISTS
 * ───────────────
 * `finalizeBattle` used to mark ANY battle past its end time as
 * status:"completed", including open challenges nobody ever accepted. Those
 * documents then showed up in the Completed tab as "Waiting for challenger"
 * cards with 0 votes, and counted toward every athlete's battle total.
 *
 * The function now writes status:"expired" for unmatched battles. This script
 * fixes the ones already in the database.
 *
 * WHAT COUNTS AS UNMATCHED
 * ────────────────────────
 * No `playerB.userId`, or no `playerA.userId`. A battle needs two real
 * athletes to have been a contest.
 *
 * WHAT IT WRITES
 * ──────────────
 *   status  → "expired"
 *   winner  → null
 * on documents that are currently "open" or "completed", past their end time,
 * and unmatched.
 *
 * WINS AND LOSSES
 * ───────────────
 * Not touched, and they don't need to be. finalizeBattle only ever incremented
 * wins/losses when BOTH a winner and a loser resolved, which is impossible
 * without a playerB — so no unmatched battle has ever written a stat. This
 * script verifies that assumption as it goes and reports any document that
 * contradicts it rather than silently correcting a record.
 *
 * SAFETY
 * ──────
 * Dry run by default; pass --commit to write. Idempotent — re-running is a
 * no-op. Only ever touches `status` and `winner`.
 *
 * AUTHENTICATION
 * ──────────────
 * Two paths, tried in this order:
 *
 *   1. Application Default Credentials (preferred). Run once:
 *        gcloud auth application-default login
 *        gcloud auth application-default set-quota-project <project-id>
 *      This uses your own Google account and writes no long-lived secret to
 *      the repo. It is the path to use when your organization blocks service
 *      account key creation
 *      (constraints/iam.disableServiceAccountKeyCreation), which is an
 *      increasingly common default.
 *
 *   2. scripts/serviceAccountKey.json, if that file happens to exist. Kept for
 *      CI and for projects without the org policy. Never commit it.
 *
 * Either way you need Firestore write access on the project — Owner, Editor,
 * or roles/datastore.user.
 *
 * PREREQUISITES
 * ─────────────
 *   npm install --save-dev firebase-admin
 *
 * RUN
 * ───
 *   FIREBASE_PROJECT_ID=your-project-id node scripts/expire-unmatched-battles.js
 *   FIREBASE_PROJECT_ID=your-project-id node scripts/expire-unmatched-battles.js --commit
 */

"use strict";

const path = require("path");
const fs = require("fs");
const os = require("os");

// Project id: FIREBASE_PROJECT_ID first, then the variables gcloud and the
// Google client libraries already set, so `gcloud config set project` is enough.
const PROJECT_ID =
  process.env.FIREBASE_PROJECT_ID ||
  process.env.GOOGLE_CLOUD_PROJECT ||
  process.env.GCLOUD_PROJECT;

const SERVICE_ACCOUNT_PATH = path.join(__dirname, "serviceAccountKey.json");
const WRITE_BATCH_SIZE = 400;
const COMMIT = process.argv.includes("--commit");
const DEFAULT_DURATION_HOURS = 24;

/** Where `gcloud auth application-default login` writes its credentials. */
function adcPath() {
  if (process.env.GOOGLE_APPLICATION_CREDENTIALS) {
    return process.env.GOOGLE_APPLICATION_CREDENTIALS;
  }
  if (process.platform === "win32") {
    return path.join(
      process.env.APPDATA || "",
      "gcloud",
      "application_default_credentials.json"
    );
  }
  return path.join(
    os.homedir(),
    ".config",
    "gcloud",
    "application_default_credentials.json"
  );
}

const AUTH_HELP = `
  Authenticate with your own Google account (no service account key needed):

    gcloud auth application-default login
    gcloud auth application-default set-quota-project <your-project-id>

  The quota-project step matters: without it, user credentials have no project
  to bill API calls to and Firestore returns a 403.

  No gcloud? Install it:  https://cloud.google.com/sdk/docs/install
  You need Owner, Editor, or roles/datastore.user on the project.
`;

if (!PROJECT_ID) {
  console.error(`
ERROR: No project id.

  Set one of FIREBASE_PROJECT_ID / GOOGLE_CLOUD_PROJECT, e.g.

    FIREBASE_PROJECT_ID=your-project-id node scripts/expire-unmatched-battles.js
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

// ── Credentials ──────────────────────────────────────────────────────────────
// Application Default Credentials are preferred: they use the operator's own
// Google account, expire, and put no long-lived secret in the repo. A service
// account key is still honoured when one exists, for CI and for projects
// without the key-creation org policy.
let credentialSource;
let credential;

if (fs.existsSync(SERVICE_ACCOUNT_PATH)) {
  credential = admin.credential.cert(require(SERVICE_ACCOUNT_PATH));
  credentialSource = "service account key (scripts/serviceAccountKey.json)";
} else {
  const adcFile = adcPath();
  if (!fs.existsSync(adcFile)) {
    console.error(`
ERROR: No credentials found.

  Looked for:
    • scripts/serviceAccountKey.json          (not present)
    • ${adcFile}
      (Application Default Credentials — not present)
${AUTH_HELP}`);
    process.exit(1);
  }
  credential = admin.credential.applicationDefault();
  credentialSource = `Application Default Credentials (${adcFile})`;
}

admin.initializeApp({ credential, projectId: PROJECT_ID });

const db = admin.firestore();

/**
 * Turn an auth/permission failure into instructions instead of a stack trace.
 * The common ones are an expired ADC session, a missing quota project, and an
 * account without Firestore access — all fixed by the same two commands.
 */
function explainAuthFailure(error) {
  const code = error && (error.code || error.status);
  const message = String((error && error.message) || error);
  const isAuth =
    code === 7 || // PERMISSION_DENIED
    code === 16 || // UNAUTHENTICATED
    code === 401 ||
    code === 403 ||
    /PERMISSION_DENIED|UNAUTHENTICATED|invalid_grant|could not (load|refresh)|quota project/i.test(
      message
    );
  if (!isAuth) return false;

  console.error(`
ERROR: Firestore rejected the request — this is a credentials problem, not a
data problem. Nothing was written.

  ${message}
${AUTH_HELP}
  Already logged in? The ADC session may have expired, or the quota project may
  be unset. Re-running both commands above fixes both.
`);
  return true;
}

/** Network/reachability failures, kept to one line instead of a grpc stack. */
function explainNetworkFailure(error) {
  const code = error && error.code;
  const message = String((error && error.message) || error);
  const isNetwork =
    code === 14 || // UNAVAILABLE
    code === 4 || // DEADLINE_EXCEEDED
    /UNAVAILABLE|Name resolution failed|ENOTFOUND|ECONNREFUSED|ETIMEDOUT|proxy/i.test(
      message
    );
  if (!isNetwork) return false;

  console.error(`
ERROR: Could not reach Firestore. Nothing was read or written.

  ${message.split("\n")[0]}

  Check your connection, then confirm the project id is right:
    gcloud config get-value project
  If you're behind a VPN or corporate proxy, that's the usual cause.
`);
  return true;
}

// ── Helpers (mirror resolveEndTimeMs in functions/src/index.ts) ───────────────

function toMillis(value) {
  if (!value) return null;
  if (typeof value.toMillis === "function") return value.toMillis();
  if (typeof value.seconds === "number") return value.seconds * 1000;
  return null;
}

function resolveEndTimeMs(data) {
  const stored = toMillis(data.endTime);
  if (stored) return stored;

  const createdMs = toMillis(data.createdAt);
  if (!createdMs) return null;

  if (typeof data.durationMinutes === "number") {
    return createdMs + data.durationMinutes * 60_000;
  }
  const hours =
    typeof data.durationHours === "number"
      ? data.durationHours
      : DEFAULT_DURATION_HOURS;
  return createdMs + hours * 3_600_000;
}

function playerId(player) {
  return player && typeof player.userId === "string" && player.userId.trim()
    ? player.userId.trim()
    : "";
}

// ── Main ─────────────────────────────────────────────────────────────────────

async function main() {
  console.log(
    `\nExpiring unmatched battles on project "${PROJECT_ID}"` +
      `\nAuth: ${credentialSource}` +
      `\nMode: ${COMMIT ? "COMMIT (writes will be applied)" : "DRY RUN (no writes)"}\n`
  );

  const snapshot = await db.collection("battles").get();
  console.log(`Scanned ${snapshot.size} battle documents.\n`);

  const pending = [];
  const suspicious = [];
  const now = Date.now();
  let matched = 0;
  let stillOpen = 0;
  let alreadyExpired = 0;

  snapshot.forEach((doc) => {
    const data = doc.data();
    const a = playerId(data.playerA);
    const b = playerId(data.playerB);

    if (a && b) {
      matched += 1;
      return;
    }

    if (data.status === "expired") {
      alreadyExpired += 1;
      return;
    }

    const endMs = resolveEndTimeMs(data);
    const isOver = endMs !== null && now > endMs;

    // Unmatched but the window is still open — leave it alone, someone may
    // still accept it. That's a live open challenge, not a stale one.
    if (!isOver && data.status !== "completed") {
      stillOpen += 1;
      return;
    }

    // A winner on an unmatched battle means a stat may have been recorded
    // against a phantom opponent. Report rather than quietly rewrite it.
    if (data.winner) {
      suspicious.push({ id: doc.id, winner: data.winner });
    }

    pending.push({
      ref: doc.ref,
      id: doc.id,
      from: data.status ?? "(none)",
      hadWinner: !!data.winner,
    });
  });

  console.log("  Matched battles (untouched)   :", matched);
  console.log("  Unmatched, still open         :", stillOpen);
  console.log("  Already expired               :", alreadyExpired);
  console.log("  To reclassify as expired      :", pending.length);

  if (suspicious.length > 0) {
    console.log(
      `\n  ⚠  ${suspicious.length} unmatched battle(s) carry a winner. No stat should\n` +
        `     have been written without two players — inspect these before committing,\n` +
        `     and check the listed users' wins/losses if anything looks off:\n`
    );
    suspicious.slice(0, 25).forEach(({ id, winner }) =>
      console.log(`       battles/${id}  winner=${winner}`)
    );
    if (suspicious.length > 25) {
      console.log(`       …and ${suspicious.length - 25} more`);
    }
  }

  if (pending.length === 0) {
    console.log("\nNothing to reclassify.\n");
    return;
  }

  if (!COMMIT) {
    console.log("\nSample of pending changes:\n");
    pending.slice(0, 10).forEach(({ id, from }) => {
      console.log(`  battles/${id}  status "${from}" → "expired"`);
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
    chunk.forEach(({ ref }) =>
      batch.set(
        ref,
        {
          status: "expired",
          winner: null,
          // Marks finalization as done so finalizeBattle stays idempotent for
          // these docs. It does NOT mean a result was recorded.
          statsRecorded: true,
        },
        { merge: true }
      )
    );
    await batch.commit();
    written += chunk.length;
    console.log(`  committed ${written}/${pending.length}`);
  }

  console.log(
    `\nDone — ${written} battle(s) reclassified as expired.\n\n` +
      `They now disappear from Completed, My Battles, the Battles feed, and\n` +
      `every battle count. The highlights stay challengeable.\n`
  );
}

main().catch((error) => {
  if (!explainAuthFailure(error) && !explainNetworkFailure(error)) {
    console.error("\nFailed:", error);
  }
  process.exit(1);
});
