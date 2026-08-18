"use strict";

/**
 * MANDATORY safety tests for the Momentum load-test production guard.
 *
 * These prove that no seed / cleanup / benchmark entry point can target the
 * production Firebase project, that missing or invalid environments are
 * refused, and that the concurrency envelope is enforced.
 */

const test = require("node:test");
const assert = require("node:assert/strict");

const {
  PRODUCTION_REFUSAL_MESSAGE,
  PRODUCTION_PROJECT_IDS,
  MAX_CONCURRENT_USERS,
  CLOUD_ACKNOWLEDGEMENT,
  GuardRefusalError,
  isProductionProjectId,
  assertSafeTarget,
  assertSafeBenchmarkConfig,
} = require("../src/guard");

const { resolveTarget } = require("../src/env");


/** Run fn, assert it throws GuardRefusalError, and return the error. */
function capture(fn) {
  try {
    fn();
  } catch (error) {
    assert.ok(error instanceof GuardRefusalError, `expected GuardRefusalError, got ${error}`);
    return error;
  }
  throw new assert.AssertionError({ message: "expected function to throw" });
}

const LOOPBACK_EMULATORS = {
  auth: "127.0.0.1:9099",
  firestore: "127.0.0.1:8080",
  functions: "127.0.0.1:5001",
  storage: "127.0.0.1:9199",
};

// ─── 1. Production project rejection ─────────────────────────────────────────

test("guard refuses every known production project ID", () => {
  for (const productionId of PRODUCTION_PROJECT_IDS) {
    const error = capture(() => assertSafeTarget({
          projectId: productionId,
          emulators: LOOPBACK_EMULATORS,
        }));
    assert.equal(error.message, PRODUCTION_REFUSAL_MESSAGE);
    assert.equal(error.reason, "production-project");
  }
});

test("guard refuses production IDs regardless of casing, whitespace, or embedding", () => {
  for (const disguised of [
    "MOMENTUM-APP-PROD-1E870",
    "  momentum-app-prod-1e870  ",
    "momentum-live-483819",
    "eu-momentum-app-prod-1e870-shard",
  ]) {
    assert.throws(
      () => assertSafeTarget({ projectId: disguised, emulators: LOOPBACK_EMULATORS }),
      (error) => error.message === PRODUCTION_REFUSAL_MESSAGE
    );
  }
});

test("guard refuses production even when every override is present", () => {
  // No allowlist mechanism may bypass the production check.
  assert.throws(
    () =>
      assertSafeTarget({
        projectId: "momentum-app-prod-1e870",
        emulators: LOOPBACK_EMULATORS,
        env: {
          LOADTEST_ALLOW_PROJECT: "momentum-app-prod-1e870",
          LOADTEST_ALLOW_CLOUD: CLOUD_ACKNOWLEDGEMENT,
        },
      }),
    (error) => error.message === PRODUCTION_REFUSAL_MESSAGE
  );
});

test("isProductionProjectId matches only real production identifiers", () => {
  assert.equal(isProductionProjectId("momentum-app-prod-1e870"), true);
  assert.equal(isProductionProjectId("demo-momentum-loadtest"), false);
  assert.equal(isProductionProjectId(""), false);
  assert.equal(isProductionProjectId(undefined), false);
  // Name-based heuristics are NOT how the guard decides: an unrelated project
  // that merely contains the word "prod" is not the production blocklist's
  // concern (it is still refused later by the demo-*/allowlist gate).
  assert.equal(isProductionProjectId("some-other-prod-app"), false);
});

// ─── 2. Missing / invalid environment rejection ──────────────────────────────

test("guard refuses missing or malformed project IDs", () => {
  for (const bad of [undefined, null, "", "   ", "Bad Project!", "x"]) {
    const error = capture(() => assertSafeTarget({ projectId: bad, emulators: LOOPBACK_EMULATORS }));
    assert.equal(error.reason, "invalid-project");
  }
});

test("guard refuses demo projects without emulator hosts", () => {
  const error = capture(() => assertSafeTarget({ projectId: "demo-momentum-loadtest", emulators: {} }));
  assert.equal(error.reason, "missing-emulators");
});

test("guard refuses emulator hosts that are not loopback", () => {
  const error = capture(() => assertSafeTarget({
        projectId: "demo-momentum-loadtest",
        emulators: { ...LOOPBACK_EMULATORS, firestore: "firestore.googleapis.com:443" },
      }));
  assert.equal(error.reason, "non-loopback-emulator");
});

test("guard refuses non-demo projects without the double acknowledgement", () => {
  // Not allowlisted at all.
  assert.equal(capture(() => assertSafeTarget({ projectId: "momentum-staging-abc", env: {} })).reason, "not-allowlisted");
  // Allowlisted but missing the cloud acknowledgement.
  assert.equal(capture(() => assertSafeTarget({
          projectId: "momentum-staging-abc",
          env: { LOADTEST_ALLOW_PROJECT: "momentum-staging-abc" },
        })).reason, "cloud-not-acknowledged");
  // Fully acknowledged non-production project is accepted.
  const target = assertSafeTarget({
    projectId: "momentum-staging-abc",
    env: {
      LOADTEST_ALLOW_PROJECT: "momentum-staging-abc",
      LOADTEST_ALLOW_CLOUD: CLOUD_ACKNOWLEDGEMENT,
    },
  });
  assert.equal(target.mode, "allowlisted-cloud");
});

test("guard accepts the emulator target the harness actually uses", () => {
  const target = assertSafeTarget({
    projectId: "demo-momentum-loadtest",
    emulators: LOOPBACK_EMULATORS,
  });
  assert.equal(target.mode, "emulator");
  assert.equal(target.projectId, "demo-momentum-loadtest");
});

// ─── 3. Invalid benchmark configuration rejection ────────────────────────────

test("guard refuses invalid benchmark configurations", () => {
  for (const bad of [
    { users: 0 },
    { users: -5 },
    { users: 1.5 },
    { users: "many" },
    {},
  ]) {
    assert.throws(() => assertSafeBenchmarkConfig(bad), GuardRefusalError);
  }
  assert.throws(
    () => assertSafeBenchmarkConfig({ users: 100, sustainSec: 999_999 }),
    GuardRefusalError
  );
  assert.throws(
    () =>
      assertSafeBenchmarkConfig({
        users: 100,
        mix: { browsing: 0.9, engaged: 0.9 },
      }),
    GuardRefusalError
  );
});

// ─── 4. Maximum concurrency protection ───────────────────────────────────────

test("guard enforces the maximum concurrency ceiling", () => {
  const error = capture(() => assertSafeBenchmarkConfig({ users: MAX_CONCURRENT_USERS + 1 }));
  assert.equal(error.reason, "max-concurrency");
  assert.equal(
    assertSafeBenchmarkConfig({
      users: MAX_CONCURRENT_USERS,
      warmupSec: 5,
      rampSec: 30,
      sustainSec: 60,
      cooldownSec: 10,
    }),
    true
  );
});

// ─── 5. Seeder and cleanup share the guard ───────────────────────────────────

test("seeder refuses to run against production", async () => {
  const { seed } = require("../src/seed");
  await assert.rejects(
    seed({
      projectId: "momentum-app-prod-1e870",
      emulators: LOOPBACK_EMULATORS,
      dataset: { users: 1, posts: 1 },
    }),
    (error) => error.message === PRODUCTION_REFUSAL_MESSAGE
  );
});

test("cleanup refuses to run against production", async () => {
  const { cleanup } = require("../src/cleanup");
  await assert.rejects(
    cleanup({
      projectId: "momentum-live-483819",
      emulators: LOOPBACK_EMULATORS,
    }),
    (error) => error.message === PRODUCTION_REFUSAL_MESSAGE
  );
});

// ─── 6. Environment resolution never invents a safe target ───────────────────

test("resolveTarget refuses when the environment points at production", () => {
  assert.throws(
    () =>
      resolveTarget({
        env: {
          GCLOUD_PROJECT: "momentum-app-prod-1e870",
          FIRESTORE_EMULATOR_HOST: "127.0.0.1:8080",
        },
      }),
    (error) => error.message === PRODUCTION_REFUSAL_MESSAGE
  );
});

test("resolveTarget accepts the emulator environment emulators:exec provides", () => {
  const target = resolveTarget({
    env: {
      GCLOUD_PROJECT: "demo-momentum-loadtest",
      FIREBASE_AUTH_EMULATOR_HOST: "127.0.0.1:9099",
      FIRESTORE_EMULATOR_HOST: "127.0.0.1:8080",
      FIREBASE_STORAGE_EMULATOR_HOST: "127.0.0.1:9199",
      LOADTEST_FUNCTIONS_EMULATOR_HOST: "127.0.0.1:5001",
    },
  });
  assert.equal(target.mode, "emulator");
  assert.equal(target.emulators.firestore, "127.0.0.1:8080");
});
