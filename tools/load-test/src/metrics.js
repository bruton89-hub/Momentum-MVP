"use strict";

/**
 * Lightweight metrics recorder for the Momentum load-test harness.
 * Latencies are kept as raw millisecond samples per operation type with
 * reservoir sampling above a cap, so percentiles stay exact for typical runs
 * and statistically sound for very large ones.
 */

const MAX_SAMPLES_PER_OP = 100_000;

class Metrics {
  constructor() {
    this.ops = new Map();
    this.startedAtMs = Date.now();
    this.endedAtMs = null;
  }

  op(type) {
    let entry = this.ops.get(type);
    if (!entry) {
      entry = {
        total: 0,
        ok: 0,
        failed: 0,
        timeouts: 0,
        retries: 0,
        contention: 0,
        authFailures: 0,
        duplicateRejections: 0,
        errorCodes: {},
        latencies: [],
        seen: 0,
        firestoreReads: 0,
        firestoreWrites: 0,
        functionCalls: 0,
      };
      this.ops.set(type, entry);
    }
    return entry;
  }

  /**
   * Time an async operation.
   * @param {string} type
   * @param {() => Promise<any>} fn
   * @param {object} [io] declared I/O cost of one successful op:
   *   {reads, writes, functionCalls} — reads may also be resolved from the
   *   result via readsFromResult.
   */
  async record(type, fn, io = {}) {
    const entry = this.op(type);
    entry.total += 1;
    const start = process.hrtime.bigint();
    try {
      const result = await fn();
      const ms = Number(process.hrtime.bigint() - start) / 1e6;
      entry.ok += 1;
      this.pushLatency(entry, ms);
      entry.firestoreReads += io.readsFromResult ? io.readsFromResult(result) : (io.reads ?? 0);
      entry.firestoreWrites += io.writes ?? 0;
      entry.functionCalls += io.functionCalls ?? 0;
      return result;
    } catch (error) {
      const ms = Number(process.hrtime.bigint() - start) / 1e6;
      entry.failed += 1;
      this.pushLatency(entry, ms);
      const code = String(error?.code ?? error?.status ?? "unknown");
      entry.errorCodes[code] = (entry.errorCodes[code] ?? 0) + 1;
      if (error?.timedOut || code === "TIMEOUT") entry.timeouts += 1;
      if (code === "ABORTED" || code === "aborted") entry.contention += 1;
      if (code === "ALREADY_EXISTS" || code === "already-exists") {
        entry.duplicateRejections += 1;
      }
      if (
        code === "UNAUTHENTICATED" ||
        code === "unauthenticated" ||
        error?.status === 401 ||
        error?.status === 403
      ) {
        entry.authFailures += 1;
      }
      entry.functionCalls += io.functionCalls ?? 0;
      throw error;
    }
  }

  pushLatency(entry, ms) {
    entry.seen += 1;
    if (entry.latencies.length < MAX_SAMPLES_PER_OP) {
      entry.latencies.push(ms);
    } else {
      const index = Math.floor(Math.random() * entry.seen);
      if (index < MAX_SAMPLES_PER_OP) entry.latencies[index] = ms;
    }
  }

  addRetry(type) {
    this.op(type).retries += 1;
  }

  finish() {
    this.endedAtMs = Date.now();
  }

  /** Serializable snapshot for worker → coordinator transfer. */
  toJSON() {
    const ops = {};
    for (const [type, entry] of this.ops) {
      ops[type] = { ...entry };
    }
    return { startedAtMs: this.startedAtMs, endedAtMs: this.endedAtMs, ops };
  }

  static merge(snapshots) {
    const merged = new Metrics();
    merged.startedAtMs = Math.min(...snapshots.map((s) => s.startedAtMs));
    merged.endedAtMs = Math.max(...snapshots.map((s) => s.endedAtMs ?? Date.now()));
    for (const snapshot of snapshots) {
      for (const [type, entry] of Object.entries(snapshot.ops)) {
        const target = merged.op(type);
        for (const key of [
          "total", "ok", "failed", "timeouts", "retries", "contention",
          "authFailures", "duplicateRejections", "seen",
          "firestoreReads", "firestoreWrites", "functionCalls",
        ]) {
          target[key] += entry[key] ?? 0;
        }
        for (const [code, count] of Object.entries(entry.errorCodes ?? {})) {
          target.errorCodes[code] = (target.errorCodes[code] ?? 0) + count;
        }
        target.latencies.push(...(entry.latencies ?? []));
      }
    }
    return merged;
  }
}

function percentile(sortedLatencies, p) {
  if (sortedLatencies.length === 0) return null;
  const index = Math.min(
    sortedLatencies.length - 1,
    Math.ceil((p / 100) * sortedLatencies.length) - 1
  );
  return sortedLatencies[Math.max(0, index)];
}

function summarizeOp(entry) {
  const sorted = [...entry.latencies].sort((a, b) => a - b);
  const round = (value) => (value === null ? null : Math.round(value * 10) / 10);
  return {
    total: entry.total,
    ok: entry.ok,
    failed: entry.failed,
    timeouts: entry.timeouts,
    retries: entry.retries,
    contention: entry.contention,
    authFailures: entry.authFailures,
    duplicateRejections: entry.duplicateRejections,
    errorRate: entry.total ? entry.failed / entry.total : 0,
    p50: round(percentile(sorted, 50)),
    p90: round(percentile(sorted, 90)),
    p95: round(percentile(sorted, 95)),
    p99: round(percentile(sorted, 99)),
    max: round(sorted[sorted.length - 1] ?? null),
    errorCodes: entry.errorCodes,
    firestoreReads: entry.firestoreReads,
    firestoreWrites: entry.firestoreWrites,
    functionCalls: entry.functionCalls,
  };
}

function summarize(metrics) {
  const json = metrics instanceof Metrics ? metrics.toJSON() : metrics;
  const opSummaries = {};
  const overall = {
    total: 0, ok: 0, failed: 0, timeouts: 0, retries: 0, contention: 0,
    authFailures: 0, duplicateRejections: 0,
    firestoreReads: 0, firestoreWrites: 0, functionCalls: 0,
  };
  const allLatencies = [];
  for (const [type, entry] of Object.entries(json.ops)) {
    opSummaries[type] = summarizeOp(entry);
    for (const key of Object.keys(overall)) overall[key] += entry[key] ?? 0;
    allLatencies.push(...entry.latencies);
  }
  allLatencies.sort((a, b) => a - b);
  const durationSec = ((json.endedAtMs ?? Date.now()) - json.startedAtMs) / 1000;
  const round = (value) => (value === null ? null : Math.round(value * 10) / 10);
  return {
    durationSec: Math.round(durationSec * 10) / 10,
    overall: {
      ...overall,
      errorRate: overall.total ? overall.failed / overall.total : 0,
      throughputOpsPerSec: durationSec > 0 ? Math.round((overall.total / durationSec) * 10) / 10 : null,
      p50: round(percentile(allLatencies, 50)),
      p90: round(percentile(allLatencies, 90)),
      p95: round(percentile(allLatencies, 95)),
      p99: round(percentile(allLatencies, 99)),
    },
    ops: opSummaries,
  };
}

module.exports = { Metrics, summarize, summarizeOp, percentile };
