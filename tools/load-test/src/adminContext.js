"use strict";

/**
 * Guarded Admin SDK context for the seeder, cleanup, and integrity
 * verification. The production guard runs BEFORE firebase-admin is even
 * required, and emulator env vars are pinned to the validated loopback hosts
 * so the Admin SDK cannot silently talk to real Firebase APIs.
 */

const path = require("node:path");
const { assertSafeTarget } = require("./guard");

let cached = null;

function createAdminContext({ projectId, emulators, env = process.env }) {
  const target = assertSafeTarget({ projectId, emulators, env });

  if (target.mode === "emulator") {
    process.env.FIRESTORE_EMULATOR_HOST = target.emulators.firestore;
    process.env.FIREBASE_AUTH_EMULATOR_HOST = target.emulators.auth;
    process.env.FIREBASE_STORAGE_EMULATOR_HOST = target.emulators.storage;
    delete process.env.GOOGLE_APPLICATION_CREDENTIALS;
  }

  if (cached?.projectId === target.projectId) return cached;

  // Resolve firebase-admin from the repository's own node_modules.
  const repoRoot = path.resolve(__dirname, "..", "..", "..");
  // eslint-disable-next-line import/no-dynamic-require, global-require
  const admin = require(require.resolve("firebase-admin", { paths: [repoRoot] }));

  const app =
    admin.apps.find((existing) => existing?.name === "momentum-loadtest") ||
    admin.initializeApp({ projectId: target.projectId }, "momentum-loadtest");

  cached = {
    projectId: target.projectId,
    target,
    admin,
    app,
    db: app.firestore(),
    auth: app.auth(),
  };
  return cached;
}

module.exports = { createAdminContext };
