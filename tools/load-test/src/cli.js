#!/usr/bin/env node
"use strict";

/**
 * Momentum load-test CLI.
 *
 * Every subcommand runs behind the production guard. Intended to be executed
 * inside `firebase emulators:exec` (see npm run loadtest:emulator).
 *
 *   node tools/load-test/src/cli.js seed --users 200 --posts 1000
 *   node tools/load-test/src/cli.js tier --users 100
 *   node tools/load-test/src/cli.js battle-stress --voters 250
 *   node tools/load-test/src/cli.js feed-bench
 *   node tools/load-test/src/cli.js media-bench
 *   node tools/load-test/src/cli.js integrity
 *   node tools/load-test/src/cli.js cleanup [--dry-run]
 */

const fs = require("node:fs");
const path = require("node:path");
const { GuardRefusalError } = require("./guard");
const { resolveTarget } = require("./env");
const { RESULTS_DIR } = require("./seed");

function parseArgs(argv) {
  const args = { _: [] };
  for (let index = 0; index < argv.length; index += 1) {
    const token = argv[index];
    if (token.startsWith("--")) {
      const key = token.slice(2);
      const next = argv[index + 1];
      if (next === undefined || next.startsWith("--")) {
        args[key] = true;
      } else {
        args[key] = /^-?\d+(\.\d+)?$/.test(next) ? Number(next) : next;
        index += 1;
      }
    } else {
      args._.push(token);
    }
  }
  return args;
}

function writeResult(name, payload) {
  fs.mkdirSync(RESULTS_DIR, { recursive: true });
  const file = path.join(RESULTS_DIR, `${name}.json`);
  fs.writeFileSync(file, JSON.stringify(payload, null, 2));
  console.log(`[result] ${file}`);
  return file;
}

async function main() {
  const [command, ...rest] = process.argv.slice(2);
  const args = parseArgs(rest);

  // Resolving the target runs the guard before anything else happens.
  const target = resolveTarget({ env: process.env });
  const guardedTarget = { projectId: target.projectId, emulators: target.emulators };

  switch (command) {
    case "seed": {
      const { seed } = require("./seed");
      const manifest = await seed({
        ...guardedTarget,
        dataset: {
          users: args.users ?? 200,
          posts: args.posts ?? 1_000,
          battles: args.battles ?? 40,
          followsPerUser: args.follows ?? 8,
        },
      });
      writeResult("seed", manifest);
      break;
    }
    case "seed-more-posts": {
      const { seedMorePosts } = require("./seed");
      const manifest = await seedMorePosts({
        ...guardedTarget,
        fromIndex: args.from ?? 0,
        toIndex: args.to ?? 10_000,
      });
      console.log(`[seed] dataset now ${manifest.posts} posts`);
      break;
    }
    case "tier": {
      const { runTier, classifyTier } = require("./runTier");
      const { verifyIntegrity } = require("./integrity");
      const users = args.users ?? 100;
      const result = await runTier({
        users,
        consolidatedPosts: args.consolidated === true,
        phases: {
          warmupSec: args.warmup ?? 5,
          rampSec: args.ramp ?? 20,
          sustainSec: args.sustain ?? 40,
          cooldownSec: args.cooldown ?? 5,
        },
      });
      const integrity = await verifyIntegrity(guardedTarget);
      const classification = classifyTier(result, integrity);
      const payload = { ...result, integrity, classification };
      writeResult(`tier-${users}`, payload);
      console.log(
        `[tier ${users}] ${classification.status} — errorRate=` +
          `${(result.overall.errorRate * 100).toFixed(2)}% p95=${result.overall.p95}ms ` +
          `throughput=${result.overall.throughputOpsPerSec}/s ` +
          `integrity=${integrity.clean ? "clean" : integrity.violations.length + " violations"}`
      );
      if (classification.reasons.length > 0) {
        console.log(`[tier ${users}] reasons: ${classification.reasons.join("; ")}`);
      }
      break;
    }
    case "battle-stress": {
      const { battleStress } = require("./benchmarks");
      const voters = args.voters ?? 25;
      const result = await battleStress({ voters, battleId: args.battle });
      writeResult(`battle-stress-${voters}`, result);
      console.log(
        `[battle ${voters}] round1 applied=${result.round1.applied} failed=${result.round1.failed} ` +
          `(timeouts=${result.round1.timedOut}, committed-anyway=${result.round1.committedDespiteClientFailure}, ` +
          `lost=${result.round1.lostAfterClientFailure}) | expected=${result.expectedVotes} ` +
          `persisted=${result.persistedVotes} duplicatesApplied=${result.duplicateApplied} ` +
          `p95=${result.ops["battle.vote"]?.p95}ms ` +
          `integrity=${result.integrity.clean ? "clean" : result.integrity.violations.join("; ")}`
      );
      break;
    }
    case "feed-bench": {
      const { feedBenchmark } = require("./benchmarks");
      const result = await feedBenchmark({
        sessions: args.sessions ?? 20,
        refreshes: args.refreshes ?? 3,
      });
      writeResult(`feed-bench-${result.datasetPosts}`, result);
      console.log(
        `[feed ${result.datasetPosts} posts] p50=${result.overall.p50}ms p95=${result.overall.p95}ms ` +
          `duplicates=${result.duplicateDocuments} readsPerSession=${result.avgFirestoreReadsPerFeedSession}`
      );
      break;
    }
    case "profile-bench": {
      const { profileBenchmark } = require("./benchmarks");
      const result = await profileBenchmark({ sessions: args.sessions ?? 20 });
      writeResult("profile-bench", result);
      console.log(
        `[profile] legacy p95=${result.legacy.overall.p95}ms reads=${result.legacy.overall.firestoreReads} | ` +
          `consolidated p95=${result.consolidated.overall.p95}ms reads=${result.consolidated.overall.firestoreReads}`
      );
      break;
    }
    case "media-bench": {
      const { mediaBenchmark } = require("./benchmarks");
      const result = await mediaBenchmark({
        uploads: args.uploads ?? 25,
        sizeKb: args.sizeKb ?? 64,
      });
      writeResult("media-bench", result);
      console.log(
        `[media] uploads=${result.uploads} ok=${result.succeeded} failed=${result.failed} ` +
          `orphans=${result.orphanedObjects} p95=${result.overall.p95}ms`
      );
      break;
    }
    case "index-probe": {
      const { probeIndexBehavior } = require("./indexProbe");
      const result = await probeIndexBehavior({ samples: args.samples ?? 3 });
      writeResult("index-probe", result);
      console.log(
        `[index-probe] posts=${result.postCount} limit1=${result.postsLimit1.medianMs}ms ` +
          `limit24=${result.postsLimit24.medianMs}ms battles(41)=${result.battlesLimit30.medianMs}ms ` +
          `→ ${result.verdict}`
      );
      break;
    }
    case "contention-probe": {
      const { probeContention } = require("./contentionProbe");
      const result = await probeContention({ concurrency: args.concurrency ?? 25 });
      writeResult(`contention-probe-${result.concurrency}`, result);
      console.log(
        `[contention ${result.concurrency}] disjoint: ${result.disjoint.ok}/${result.disjoint.attempts} ok ` +
          `(failRate=${result.disjoint.failRate}, p95=${result.disjoint.p95}ms) | ` +
          `shared: ${result.shared.ok}/${result.shared.attempts} ok ` +
          `(failRate=${result.shared.failRate}, p95=${result.shared.p95}ms) | ` +
          `sharedConsistent=${result.integrity.sharedConsistent} ` +
          `disjointMismatches=${result.integrity.disjointMismatches}`
      );
      console.log(`[contention] VERDICT: ${result.verdict}`);
      break;
    }
    case "cost-model": {
      const { buildCostTable } = require("./costModel");
      const table = buildCostTable();
      writeResult("cost-model", table);
      console.log("[cost] DAU | legacy $/mo | consolidated $/mo | reads/day");
      table.legacy.forEach((row, index) => {
        console.log(
          `      ${String(row.dau).padStart(7)} | ${String(row.monthlyUsd.total).padStart(11)} | ` +
            `${String(table.consolidated[index].monthlyUsd.total).padStart(17)} | ` +
            row.daily.reads.toLocaleString()
        );
      });
      console.log("[cost] measured per-user/day:", JSON.stringify(table.legacy[0].perUserPerDay));
      break;
    }
    case "integrity": {
      const { verifyIntegrity } = require("./integrity");
      const result = await verifyIntegrity(guardedTarget);
      writeResult("integrity", result);
      console.log(
        result.clean
          ? "[integrity] clean"
          : `[integrity] ${result.violations.length} violations:\n  ${result.violations.slice(0, 20).join("\n  ")}`
      );
      break;
    }
    case "cleanup": {
      const { cleanup } = require("./cleanup");
      const result = await cleanup({ ...guardedTarget, dryRun: args["dry-run"] === true });
      writeResult("cleanup", result);
      break;
    }
    default:
      console.error(
        "Usage: cli.js <seed|seed-more-posts|tier|battle-stress|feed-bench|profile-bench|media-bench|index-probe|contention-probe|cost-model|integrity|cleanup> [--flags]"
      );
      process.exit(2);
  }
}

main().catch((error) => {
  if (error instanceof GuardRefusalError || error?.refused) {
    console.error(`\n${error.message}\n`);
    process.exit(3);
  }
  console.error(error);
  process.exit(1);
});
