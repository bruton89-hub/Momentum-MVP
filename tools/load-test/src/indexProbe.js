"use strict";

/**
 * Index-behavior probe.
 *
 * Distinguishes a REAL architectural cost (latency tracking the number of
 * documents RETURNED) from an EMULATOR ARTIFACT (latency tracking the number
 * of documents in the collection). The Firestore emulator does not implement
 * production's index storage engine, so an ordered range query over a large
 * collection degrades in the emulator in a way production does not.
 *
 * Method: on the same large collection, vary the result limit while holding
 * the collection constant, then compare against a small collection using an
 * identical query shape.
 *   - latency ~ f(limit)           → cost is in the result set (real)
 *   - latency ~ f(collection size) → cost is in the scan (emulator artifact)
 */

const { resolveTarget } = require("./env");
const { MomentumRestClient } = require("./restClient");
const { PASSWORD, userEmail, readManifest } = require("./seed");
const { createAdminContext } = require("./adminContext");

async function timed(fn) {
  const start = process.hrtime.bigint();
  try {
    const value = await fn();
    return { ms: Number(process.hrtime.bigint() - start) / 1e6, value, ok: true };
  } catch (error) {
    return {
      ms: Number(process.hrtime.bigint() - start) / 1e6,
      ok: false,
      error: error.message,
      code: error.code,
    };
  }
}

async function probeIndexBehavior({ env = process.env, samples = 3 } = {}) {
  const target = resolveTarget({ env });
  const manifest = readManifest();
  const client = new MomentumRestClient(target);
  const { db } = createAdminContext({
    projectId: target.projectId,
    emulators: target.emulators,
    env,
  });

  const auth = await client.signIn(userEmail(0), PASSWORD);
  const postCount = (await db.collection("posts").count().get()).data().count;
  const battleCount = (await db.collection("battles").count().get()).data().count;

  const median = (values) => {
    const sorted = [...values].sort((a, b) => a - b);
    return Math.round(sorted[Math.floor(sorted.length / 2)] * 10) / 10;
  };

  async function measure(queryFactory) {
    const runs = [];
    for (let index = 0; index < samples; index += 1) {
      const result = await timed(() => client.runQuery(auth.idToken, queryFactory()));
      runs.push(result);
    }
    const ok = runs.filter((run) => run.ok);
    return {
      medianMs: ok.length ? median(ok.map((run) => run.ms)) : null,
      failures: runs.length - ok.length,
      docsReturned: ok.length ? ok[0].value.length : null,
      lastError: runs.find((run) => !run.ok)?.error ?? null,
    };
  }

  // Same large collection, different result sizes.
  const postsLimit1 = await measure(() => client.feedFirstPageQuery(1));
  const postsLimit24 = await measure(() => client.feedFirstPageQuery(24));
  // Small collection, identical query shape.
  const battlesLimit30 = await measure(() => client.battlesPageQuery(30));

  // Interpretation: if limit(1) on a 100k collection is as slow as limit(24),
  // and the 41-document collection with the same shape is fast, the cost is in
  // the scan (collection size), not the result set.
  const limitSensitivity =
    postsLimit1.medianMs && postsLimit24.medianMs
      ? Math.round((postsLimit24.medianMs / postsLimit1.medianMs) * 100) / 100
      : null;
  const collectionSensitivity =
    battlesLimit30.medianMs && postsLimit24.medianMs
      ? Math.round((postsLimit24.medianMs / battlesLimit30.medianMs) * 100) / 100
      : null;

  const verdict =
    limitSensitivity !== null && limitSensitivity < 2 && collectionSensitivity > 5
      ? "collection-size-bound (emulator scan artifact — production serves this from an index)"
      : limitSensitivity !== null && limitSensitivity >= 2
      ? "result-size-bound (real cost, scales with page size)"
      : "inconclusive";

  return {
    postCount,
    battleCount,
    samples,
    postsLimit1,
    postsLimit24,
    battlesLimit30,
    limitSensitivity,
    collectionSensitivity,
    verdict,
  };
}

module.exports = { probeIndexBehavior };
