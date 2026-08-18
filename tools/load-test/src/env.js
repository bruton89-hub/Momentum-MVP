"use strict";

/**
 * Target-environment resolution for the Momentum load-test harness.
 *
 * The harness is designed to run inside `firebase emulators:exec`, which
 * exports GCLOUD_PROJECT and the *_EMULATOR_HOST variables. Everything is
 * validated through the production guard before any endpoint is returned.
 */

const { assertSafeTarget } = require("./guard");

const DEFAULT_PROJECT_ID = "demo-momentum-loadtest";
// Region must match config/firebase.ts + functions/src/index.ts.
const FUNCTIONS_REGION = "us-central1";

function resolveTarget({ env = process.env } = {}) {
  const projectId =
    env.LOADTEST_PROJECT_ID ||
    env.GCLOUD_PROJECT ||
    env.FIREBASE_PROJECT ||
    DEFAULT_PROJECT_ID;

  const emulators = {
    auth: env.FIREBASE_AUTH_EMULATOR_HOST || env.AUTH_EMULATOR_HOST || "127.0.0.1:9099",
    firestore: env.FIRESTORE_EMULATOR_HOST || "127.0.0.1:8080",
    functions: env.LOADTEST_FUNCTIONS_EMULATOR_HOST || "127.0.0.1:5001",
    storage:
      env.FIREBASE_STORAGE_EMULATOR_HOST ||
      env.STORAGE_EMULATOR_HOST ||
      "127.0.0.1:9199",
  };

  const target = assertSafeTarget({ projectId, emulators, env });

  const firestoreBase = `http://${target.emulators.firestore}/v1/projects/${target.projectId}/databases/(default)/documents`;
  const firestoreQueryBase = `http://${target.emulators.firestore}/v1/projects/${target.projectId}/databases/(default)/documents`;

  return Object.freeze({
    ...target,
    region: FUNCTIONS_REGION,
    endpoints: Object.freeze({
      authSignUp: `http://${target.emulators.auth}/identitytoolkit.googleapis.com/v1/accounts:signUp?key=loadtest`,
      authSignIn: `http://${target.emulators.auth}/identitytoolkit.googleapis.com/v1/accounts:signInWithPassword?key=loadtest`,
      authClear: `http://${target.emulators.auth}/emulator/v1/projects/${target.projectId}/accounts`,
      firestoreDocs: firestoreBase,
      firestoreRunQuery: `${firestoreQueryBase}:runQuery`,
      firestoreRunAggregationQuery: `${firestoreQueryBase}:runAggregationQuery`,
      firestoreCommit: `${firestoreQueryBase.replace(/\/documents$/, "")}/documents:commit`,
      callable: (name) =>
        `http://${target.emulators.functions}/${target.projectId}/${FUNCTIONS_REGION}/${name}`,
      storageUpload: (bucket, objectPath) =>
        `http://${target.emulators.storage}/upload/storage/v1/b/${bucket}/o?uploadType=media&name=${encodeURIComponent(objectPath)}`,
      storageObject: (bucket, objectPath) =>
        `http://${target.emulators.storage}/v0/b/${bucket}/o/${encodeURIComponent(objectPath)}`,
      storageList: (bucket, prefix) =>
        `http://${target.emulators.storage}/storage/v1/b/${bucket}/o?prefix=${encodeURIComponent(prefix)}`,
    }),
    documentPath: (collection, id) =>
      `projects/${target.projectId}/databases/(default)/documents/${collection}/${id}`,
    bucket: `${target.projectId}.appspot.com`,
  });
}

module.exports = { resolveTarget, DEFAULT_PROJECT_ID, FUNCTIONS_REGION };
