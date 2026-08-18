"use strict";

/**
 * Firebase cost model for Momentum, derived from MEASURED per-session
 * operation counts.
 *
 * Every per-session figure below is measured by this harness in the emulator
 * (document counts and call counts are environment-independent — they follow
 * from the query shapes in the app, not from how fast the backend answers).
 * Everything downstream of "sessions per DAU" is an EXPLICIT ASSUMPTION and is
 * labelled as such. Unit prices are published Firebase list prices for the
 * Blaze plan and change over time — they are inputs, not guarantees.
 */

// ── Measured per-session costs (from tools/load-test/results) ───────────────
// Feed session: 24-doc first page + 56-doc background expansion = 80 reads,
// constant across 1k / 10k / 50k datasets (feed-bench-*.json).
const MEASURED = {
  feedSessionReads: 80,
  // Like-marker hydration: ceil(80/10) = 8 `in` queries. Firestore bills the
  // documents returned; an empty `in` query still bills a minimum of 1 read.
  feedLikeHydrationReadsMin: 8,
  // useFollows.fetchFollowedIds — one query returning the user's follow docs.
  followsQueryReadsPerFollow: 1,
  // Unread badge: getCountFromServer = 1 read per 1,000 matched docs.
  unreadBadgeReads: 1,
  // Profile view, legacy three-alias path (current production default):
  // 1 user doc + 3 queries. Measured 28 reads/session at ~8 posts per athlete.
  profileViewReadsLegacy: 28,
  // Same view with EXPO_PUBLIC_POSTS_USERID_BACKFILLED=true. Measured 10.
  profileViewReadsConsolidated: 10,
  // Battles tab: 30 battles + ceil(30/10)=3 vote `in` queries.
  battlesTabReads: 33,
  // Callable engagement ops (server-side reads/writes inside the transaction).
  likeCallable: { functionCalls: 1, reads: 2, writes: 2 },
  voteCallable: { functionCalls: 1, reads: 2, writes: 2 },
  // Post creation: 1 document write (media handled separately).
  postCreateWrites: 1,
};

// ── Behavioural assumptions (NOT measured — stated so they can be argued) ───
const ASSUMPTIONS = {
  feedSessionsPerDauDay: 4, // app opens / pull-to-refreshes that hit network
  profileViewsPerDauDay: 3,
  battlesTabOpensPerDauDay: 1,
  likesPerDauDay: 2,
  votesPerDauDay: 0.5,
  postsPerDauDay: 0.15, // ~1 post per user per week
  avgFollowsPerUser: 25,
  mediaUploadMb: 8, // average post media size
  mediaViewsPerDauDay: 40, // media objects fetched per active day
  avgMediaViewMb: 1.2, // partial video fetch / image
  daysPerMonth: 30,
};

// ── Firebase Blaze list prices (inputs — verify before quoting) ─────────────
const PRICES = {
  firestoreReadPer100k: 0.06,
  firestoreWritePer100k: 0.18,
  firestoreDeletePer100k: 0.02,
  firestoreStorageGbMonth: 0.18,
  functionsInvocationPerMillion: 0.4,
  functionsGbSecond: 0.0000025,
  functionsGhzSecond: 0.00001,
  storageGbMonth: 0.026,
  storageDownloadGb: 0.12,
  // Free tier (per day for Firestore, per month for Functions).
  freeReadsPerDay: 50_000,
  freeWritesPerDay: 20_000,
  freeFunctionsInvocationsPerMonth: 2_000_000,
  freeStorageGb: 5,
  freeDownloadGbPerDay: 1,
};

// Average Cloud Functions execution time measured for the engagement
// callables in the emulator. Emulator timing is NOT a proxy for deployed
// latency, so this is flagged and used only for an order-of-magnitude figure.
const FUNCTION_AVG_SECONDS = 0.25;
const FUNCTION_MEMORY_GB = 0.256;

function perDauDayOps({ consolidatedProfiles = false } = {}) {
  const a = ASSUMPTIONS;
  const profileReads = consolidatedProfiles
    ? MEASURED.profileViewReadsConsolidated
    : MEASURED.profileViewReadsLegacy;

  const reads =
    a.feedSessionsPerDauDay *
      (MEASURED.feedSessionReads +
        MEASURED.feedLikeHydrationReadsMin +
        a.avgFollowsPerUser * MEASURED.followsQueryReadsPerFollow +
        MEASURED.unreadBadgeReads) +
    a.profileViewsPerDauDay * profileReads +
    a.battlesTabOpensPerDauDay * MEASURED.battlesTabReads +
    a.likesPerDauDay * MEASURED.likeCallable.reads +
    a.votesPerDauDay * MEASURED.voteCallable.reads;

  const writes =
    a.likesPerDauDay * MEASURED.likeCallable.writes +
    a.votesPerDauDay * MEASURED.voteCallable.writes +
    a.postsPerDauDay * MEASURED.postCreateWrites;

  const functionCalls =
    a.likesPerDauDay * MEASURED.likeCallable.functionCalls +
    a.votesPerDauDay * MEASURED.voteCallable.functionCalls;

  return { reads, writes, functionCalls };
}

function monthlyCost(dau, { consolidatedProfiles = false } = {}) {
  const a = ASSUMPTIONS;
  const per = perDauDayOps({ consolidatedProfiles });

  const readsPerDay = per.reads * dau;
  const writesPerDay = per.writes * dau;
  const functionCallsPerMonth = per.functionCalls * dau * a.daysPerMonth;

  // Free tier applies per day for Firestore ops.
  const billableReadsMonth = Math.max(0, readsPerDay - PRICES.freeReadsPerDay) * a.daysPerMonth;
  const billableWritesMonth = Math.max(0, writesPerDay - PRICES.freeWritesPerDay) * a.daysPerMonth;
  const billableInvocations = Math.max(
    0,
    functionCallsPerMonth - PRICES.freeFunctionsInvocationsPerMonth
  );

  const readCost = (billableReadsMonth / 100_000) * PRICES.firestoreReadPer100k;
  const writeCost = (billableWritesMonth / 100_000) * PRICES.firestoreWritePer100k;
  const invocationCost = (billableInvocations / 1_000_000) * PRICES.functionsInvocationPerMillion;
  const computeCost =
    functionCallsPerMonth * FUNCTION_AVG_SECONDS * FUNCTION_MEMORY_GB * PRICES.functionsGbSecond;

  // Storage: new media accumulates each month.
  const newMediaGbMonth = (a.postsPerDauDay * dau * a.daysPerMonth * a.mediaUploadMb) / 1024;
  const storageCost = Math.max(0, newMediaGbMonth - PRICES.freeStorageGb) * PRICES.storageGbMonth;

  // Media bandwidth is served from Cloud Storage egress.
  const downloadGbPerDay = (dau * a.mediaViewsPerDauDay * a.avgMediaViewMb) / 1024;
  const billableDownloadGbMonth =
    Math.max(0, downloadGbPerDay - PRICES.freeDownloadGbPerDay) * a.daysPerMonth;
  const bandwidthCost = billableDownloadGbMonth * PRICES.storageDownloadGb;

  const round = (value) => Math.round(value * 100) / 100;
  return {
    dau,
    profileMode: consolidatedProfiles ? "consolidated" : "legacy-3-alias",
    perUserPerDay: {
      reads: Math.round(per.reads * 10) / 10,
      writes: Math.round(per.writes * 100) / 100,
      functionCalls: Math.round(per.functionCalls * 100) / 100,
    },
    daily: {
      reads: Math.round(readsPerDay),
      writes: Math.round(writesPerDay),
      downloadGb: Math.round(downloadGbPerDay * 100) / 100,
    },
    monthlyUsd: {
      firestoreReads: round(readCost),
      firestoreWrites: round(writeCost),
      functionsInvocations: round(invocationCost),
      functionsCompute: round(computeCost),
      storage: round(storageCost),
      mediaBandwidth: round(bandwidthCost),
      // Authentication: email/password sign-in is free at every tier modelled
      // here (Identity Platform billing starts far above 100k MAU).
      authentication: 0,
      total: round(
        readCost + writeCost + invocationCost + computeCost + storageCost + bandwidthCost
      ),
    },
    newMediaGbMonth: Math.round(newMediaGbMonth * 10) / 10,
  };
}

function buildCostTable(dauLevels = [100, 1_000, 5_000, 10_000, 50_000, 100_000]) {
  return {
    measured: MEASURED,
    assumptions: ASSUMPTIONS,
    prices: PRICES,
    caveats: [
      "Per-session read/write/call COUNTS are measured; they follow from the app's query shapes.",
      "Sessions-per-DAU, media sizes and view counts are ASSUMPTIONS, not measurements.",
      "Function compute seconds are taken from emulator timings and are order-of-magnitude only.",
      "Unit prices are Firebase list prices at time of writing and must be re-checked before quoting.",
      "These are projections, not a billing guarantee.",
    ],
    legacy: dauLevels.map((dau) => monthlyCost(dau, { consolidatedProfiles: false })),
    consolidated: dauLevels.map((dau) => monthlyCost(dau, { consolidatedProfiles: true })),
  };
}

module.exports = { buildCostTable, monthlyCost, perDauDayOps, MEASURED, ASSUMPTIONS, PRICES };
