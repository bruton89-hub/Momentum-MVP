"use strict";

/**
 * Concurrency-tier runner: warm-up → ramp → sustain → cool-down.
 *
 * Virtual users are cooperative async sessions in a single Node process (the
 * app's operations are network-bound, so the driver is I/O-bound, not
 * CPU-bound). Driver saturation is measured explicitly and reported, so a
 * driver-side limit is never misreported as a backend limit.
 */

const { assertSafeBenchmarkConfig } = require("./guard");
const { resolveTarget } = require("./env");
const { MomentumRestClient } = require("./restClient");
const { Metrics, summarize } = require("./metrics");
const {
  VirtualUser,
  WORKLOADS,
  DEFAULT_MIX,
  workloadForIndex,
} = require("./workloads");
const { PASSWORD, USER_PREFIX, userEmail, readManifest } = require("./seed");

const DEFAULT_PHASES = {
  warmupSec: 5,
  rampSec: 20,
  sustainSec: 40,
  cooldownSec: 5,
};

function sleep(ms) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

/**
 * Measure event-loop lag to detect driver saturation. If the driver itself is
 * the bottleneck, latency numbers describe the harness, not Momentum — so
 * this is reported alongside every tier.
 */
function startLoopLagProbe(intervalMs = 200) {
  const samples = [];
  let last = process.hrtime.bigint();
  const timer = setInterval(() => {
    const now = process.hrtime.bigint();
    const actual = Number(now - last) / 1e6;
    samples.push(Math.max(0, actual - intervalMs));
    last = now;
  }, intervalMs);
  timer.unref?.();
  return {
    stop() {
      clearInterval(timer);
      const sorted = [...samples].sort((a, b) => a - b);
      const at = (p) =>
        sorted.length
          ? Math.round(sorted[Math.min(sorted.length - 1, Math.ceil((p / 100) * sorted.length) - 1)] * 10) / 10
          : null;
      return { p50: at(50), p95: at(95), max: at(100), samples: sorted.length };
    },
  };
}

/**
 * @param {object} config
 * @param {number} config.users        simultaneous active users
 * @param {object} [config.mix]        workload mix (defaults to DEFAULT_MIX)
 * @param {object} [config.phases]
 * @param {boolean} [config.consolidatedPosts] model EXPO_PUBLIC_POSTS_USERID_BACKFILLED=true
 */
async function runTier(config, { log = console.log, env = process.env } = {}) {
  const users = config.users;
  const mix = config.mix ?? DEFAULT_MIX;
  const phases = { ...DEFAULT_PHASES, ...(config.phases ?? {}) };

  // Guard: environment + configuration, before any connection is opened.
  const target = resolveTarget({ env });
  assertSafeBenchmarkConfig({ users, mix, ...phases });

  const manifest = readManifest();
  if (!manifest) {
    throw new Error("No seed manifest found — run the seeder before a tier.");
  }
  if (users > manifest.users) {
    throw new Error(
      `Tier requires ${users} synthetic identities but only ${manifest.users} were seeded.`
    );
  }

  const client = new MomentumRestClient(target);
  const metrics = new Metrics();

  const world = {
    userIds: Array.from({ length: Math.min(manifest.users, 200) }, (_, index) => `${USER_PREFIX}${index}`),
    hotBattleId: manifest.hotBattleId,
  };

  const vus = [];
  for (let index = 0; index < users; index += 1) {
    const workloadName = workloadForIndex(index, users, mix);
    const vu = new VirtualUser({
      client,
      metrics,
      identity: {
        uid: `${USER_PREFIX}${index}`,
        email: userEmail(index),
        password: PASSWORD,
        username: `lt_athlete_${index}`,
      },
      world,
      seed: index * 2654435761,
      bucket: target.bucket,
      options: { consolidatedPosts: config.consolidatedPosts === true },
    });
    vus.push({ vu, workloadName });
  }

  log(
    `[tier ${users}] target=${target.projectId} mode=${target.mode} ` +
      `mix=${JSON.stringify(mix)} phases=${JSON.stringify(phases)}`
  );

  const lagProbe = startLoopLagProbe();
  const sessions = [];
  const startedAt = Date.now();

  // ── Warm-up: a small pilot cohort primes emulator caches/JIT. ──────────────
  const warmupCount = Math.max(1, Math.min(5, Math.floor(users * 0.05)));
  for (let index = 0; index < warmupCount; index += 1) {
    const { vu, workloadName } = vus[index];
    sessions.push(
      WORKLOADS[workloadName](vu).catch((error) => {
        if (!vu.stopped) log(`[warmup vu${index}] ${error.message}`);
      })
    );
  }
  await sleep(phases.warmupSec * 1_000);

  // ── Ramp: introduce the remaining users linearly over rampSec. ─────────────
  const rampTargets = vus.slice(warmupCount);
  const rampStepMs = rampTargets.length > 0
    ? (phases.rampSec * 1_000) / rampTargets.length
    : 0;
  for (const [index, { vu, workloadName }] of rampTargets.entries()) {
    sessions.push(
      WORKLOADS[workloadName](vu).catch((error) => {
        if (!vu.stopped) log(`[vu${index + warmupCount}] ${error.message}`);
      })
    );
    if (rampStepMs >= 1) await sleep(rampStepMs);
  }
  const rampCompletedAt = Date.now();

  // ── Sustain ────────────────────────────────────────────────────────────────
  await sleep(phases.sustainSec * 1_000);

  // ── Cool-down: stop issuing new work, let in-flight operations drain. ──────
  vus.forEach(({ vu }) => vu.stop());
  await Promise.race([
    Promise.all(sessions),
    sleep(phases.cooldownSec * 1_000 + 15_000),
  ]);

  metrics.finish();
  const loopLag = lagProbe.stop();
  const summary = summarize(metrics);

  const workloadCounts = {};
  for (const { workloadName } of vus) {
    workloadCounts[workloadName] = (workloadCounts[workloadName] ?? 0) + 1;
  }

  return {
    tier: users,
    projectId: target.projectId,
    mode: target.mode,
    mix,
    phases,
    workloadCounts,
    consolidatedPosts: config.consolidatedPosts === true,
    rampSeconds: Math.round((rampCompletedAt - startedAt) / 100) / 10,
    driver: {
      eventLoopLagMs: loopLag,
      // A saturated driver invalidates latency attribution to the backend.
      saturated: (loopLag.p95 ?? 0) > 250,
    },
    ...summary,
  };
}

/**
 * Classify a tier result. Integrity failures always FAIL, regardless of
 * latency (per the mission's classification rules).
 */
function classifyTier(result, integrity = { violations: [] }) {
  const reasons = [];
  if (integrity.violations.length > 0) {
    return {
      status: "FAIL",
      reasons: [`integrity violations: ${integrity.violations.join("; ")}`],
    };
  }
  const errorRate = result.overall.errorRate;
  const p95 = result.overall.p95 ?? 0;

  if (errorRate > 0.05) reasons.push(`error rate ${(errorRate * 100).toFixed(2)}% > 5%`);
  if (result.overall.timeouts > result.overall.total * 0.01) {
    reasons.push(`timeouts ${result.overall.timeouts} exceed 1% of operations`);
  }
  if (reasons.length > 0) return { status: "FAIL", reasons };

  if (errorRate > 0.01) reasons.push(`error rate ${(errorRate * 100).toFixed(2)}% > 1%`);
  if (p95 > 1_500) reasons.push(`P95 ${p95}ms > 1500ms`);
  if (result.overall.contention > 0) {
    reasons.push(`${result.overall.contention} transaction contention events`);
  }
  if (reasons.length > 0) return { status: "DEGRADED", reasons };

  return { status: "PASS", reasons: [] };
}

module.exports = { runTier, classifyTier, DEFAULT_PHASES };
