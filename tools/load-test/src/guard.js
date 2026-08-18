"use strict";

/**
 * Momentum load-test production guard.
 *
 * HARD RULE: no benchmark, seeder, or cleanup command may ever touch the
 * production Firebase project. This module is consulted BEFORE any
 * traffic-generating or data-writing connection is opened, and it decides by
 * validating the actual Firebase project ID — never environment names like
 * "prod" or "production".
 *
 * Refusal modes (all throw GuardRefusalError):
 *  1. The target project ID is a known Momentum production/live project.
 *  2. The target project ID is missing or malformed.
 *  3. The target is not an emulator-only project (demo-*) and was not
 *     explicitly allowlisted twice over (LOADTEST_ALLOW_PROJECT must equal
 *     the project ID *and* LOADTEST_ALLOW_CLOUD must carry the exact
 *     acknowledgement sentence).
 *  4. Emulator mode without emulator hosts, or emulator hosts that are not
 *     loopback addresses.
 *  5. A benchmark configuration outside the harness's validated envelope
 *     (concurrency cap, durations, workload mix).
 */

const PRODUCTION_REFUSAL_MESSAGE =
  "MOMENTUM LOAD TEST REFUSED — PRODUCTION PROJECT DETECTED";

/**
 * Known Momentum production / live project IDs, sourced from the repository:
 *  - .firebaserc "default" and .env EXPO_PUBLIC_FIREBASE_PROJECT_ID:
 *      momentum-app-prod-1e870
 *  - google-services.json (Android live config): momentum-live-483819
 * Keep this list additive — never remove an entry that ever pointed at real
 * user data.
 */
const PRODUCTION_PROJECT_IDS = Object.freeze([
  "momentum-app-prod-1e870",
  "momentum-live-483819",
]);

/** Absolute ceiling on simultaneous synthetic users for any single run. */
const MAX_CONCURRENT_USERS = 20_000;
/** Absolute ceiling on any single phase duration (seconds). */
const MAX_PHASE_SECONDS = 3_600;

const CLOUD_ACKNOWLEDGEMENT =
  "I_UNDERSTAND_THIS_TARGETS_A_REAL_FIREBASE_PROJECT";

class GuardRefusalError extends Error {
  constructor(message, reason) {
    super(message);
    this.name = "GuardRefusalError";
    this.reason = reason;
    this.refused = true;
  }
}

function normalizeProjectId(projectId) {
  return typeof projectId === "string" ? projectId.trim().toLowerCase() : "";
}

function isProductionProjectId(projectId) {
  const normalized = normalizeProjectId(projectId);
  if (!normalized) return false;
  return PRODUCTION_PROJECT_IDS.some(
    (production) =>
      normalized === production ||
      // A namespaced variant of a production ID (e.g. suffixed database or
      // resource path that embeds it) is still production.
      normalized.includes(production)
  );
}

function isLoopbackHost(hostPort) {
  if (typeof hostPort !== "string" || hostPort.length === 0) return false;
  const host = hostPort.replace(/^https?:\/\//, "").split("/")[0].split(":")[0];
  return (
    host === "localhost" ||
    host === "127.0.0.1" ||
    host === "0.0.0.0" ||
    host === "::1" ||
    host === "[::1]"
  );
}

/**
 * Validate the target environment. Returns a frozen descriptor on success.
 * @param {object} options
 * @param {string} options.projectId  Firebase project ID the run will target.
 * @param {object} [options.emulators] host:port strings for auth/firestore/functions/storage.
 * @param {object} [options.env]      environment map (defaults to process.env).
 */
function assertSafeTarget({ projectId, emulators = {}, env = process.env }) {
  // 1. Production detection comes first and is absolute. No override
  //    mechanism — not LOADTEST_ALLOW_PROJECT, not emulator hosts — may
  //    bypass it, because an emulator host env var pointing at production
  //    credentials is exactly the misconfiguration this guard exists for.
  if (isProductionProjectId(projectId)) {
    throw new GuardRefusalError(PRODUCTION_REFUSAL_MESSAGE, "production-project");
  }

  const normalized = normalizeProjectId(projectId);
  if (!normalized || !/^[a-z0-9][a-z0-9-]{2,40}$/.test(normalized)) {
    throw new GuardRefusalError(
      "MOMENTUM LOAD TEST REFUSED — missing or malformed Firebase project ID",
      "invalid-project"
    );
  }

  const emulatorHosts = [
    emulators.auth,
    emulators.firestore,
    emulators.functions,
    emulators.storage,
  ].filter(Boolean);

  const isDemoProject = normalized.startsWith("demo-");

  if (!isDemoProject) {
    // Non-demo projects are refused unless BOTH explicit acknowledgements are
    // present. This is the path for a dedicated non-production test project;
    // it is never the default and never inferred.
    const allowedProject = normalizeProjectId(env.LOADTEST_ALLOW_PROJECT);
    if (allowedProject !== normalized) {
      throw new GuardRefusalError(
        `MOMENTUM LOAD TEST REFUSED — project "${normalized}" is not an ` +
          "emulator-only demo-* project and was not explicitly allowlisted " +
          "via LOADTEST_ALLOW_PROJECT",
        "not-allowlisted"
      );
    }
    if (env.LOADTEST_ALLOW_CLOUD !== CLOUD_ACKNOWLEDGEMENT) {
      throw new GuardRefusalError(
        "MOMENTUM LOAD TEST REFUSED — targeting a non-demo project requires " +
          `LOADTEST_ALLOW_CLOUD=${CLOUD_ACKNOWLEDGEMENT}`,
        "cloud-not-acknowledged"
      );
    }
  } else {
    // demo-* projects exist only inside the Emulator Suite; require emulator
    // endpoints so a mis-set SDK cannot silently fall through to real APIs.
    if (emulatorHosts.length === 0) {
      throw new GuardRefusalError(
        "MOMENTUM LOAD TEST REFUSED — demo project targets require emulator " +
          "host configuration (FIRESTORE_EMULATOR_HOST etc.)",
        "missing-emulators"
      );
    }
    for (const hostPort of emulatorHosts) {
      if (!isLoopbackHost(hostPort)) {
        throw new GuardRefusalError(
          `MOMENTUM LOAD TEST REFUSED — emulator host "${hostPort}" is not a ` +
            "loopback address",
          "non-loopback-emulator"
        );
      }
    }
  }

  return Object.freeze({
    projectId: normalized,
    mode: isDemoProject ? "emulator" : "allowlisted-cloud",
    emulators: { ...emulators },
  });
}

/** Validate benchmark configuration limits. */
function assertSafeBenchmarkConfig(config) {
  const users = config?.users;
  if (!Number.isInteger(users) || users < 1) {
    throw new GuardRefusalError(
      "MOMENTUM LOAD TEST REFUSED — invalid concurrency (users must be a positive integer)",
      "invalid-config"
    );
  }
  if (users > MAX_CONCURRENT_USERS) {
    throw new GuardRefusalError(
      `MOMENTUM LOAD TEST REFUSED — concurrency ${users} exceeds the maximum ` +
        `of ${MAX_CONCURRENT_USERS} simultaneous synthetic users`,
      "max-concurrency"
    );
  }
  for (const key of ["warmupSec", "rampSec", "sustainSec", "cooldownSec"]) {
    const value = config[key];
    if (value === undefined) continue;
    if (!Number.isFinite(value) || value < 0 || value > MAX_PHASE_SECONDS) {
      throw new GuardRefusalError(
        `MOMENTUM LOAD TEST REFUSED — ${key}=${value} outside [0, ${MAX_PHASE_SECONDS}]`,
        "invalid-config"
      );
    }
  }
  if (config.mix) {
    const total = Object.values(config.mix).reduce((sum, v) => sum + v, 0);
    if (Math.abs(total - 1) > 0.001) {
      throw new GuardRefusalError(
        `MOMENTUM LOAD TEST REFUSED — workload mix must sum to 1 (got ${total})`,
        "invalid-config"
      );
    }
  }
  return true;
}

module.exports = {
  PRODUCTION_REFUSAL_MESSAGE,
  PRODUCTION_PROJECT_IDS,
  MAX_CONCURRENT_USERS,
  CLOUD_ACKNOWLEDGEMENT,
  GuardRefusalError,
  isProductionProjectId,
  assertSafeTarget,
  assertSafeBenchmarkConfig,
};
