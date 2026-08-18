"use strict";

/**
 * Battle viewer queue — regression coverage.
 *
 * Reported defect: with several Live battles visible in the Battles tab, voting
 * on one (or tapping "Skip to next battle") jumped straight to
 * "All caught up — No more votable battles right now" instead of advancing.
 *
 * Two independent causes were found:
 *
 *   1. The "Live (N)" badge counted `live.length + openChallenges.length`.
 *      Open challenges have no opponent (`playerB: null`) and can never be
 *      voted on, so a tab holding 1 live battle + 2 unaccepted challenges
 *      rendered "Live (3)" while the votable queue held exactly one battle.
 *      Voting once then correctly reported exhaustion — which read as a bug.
 *
 *   2. Skipping recorded nothing. With one votable battle, skipping it returned
 *      null ("All caught up") even though the battle was still votable; with
 *      several, skipping cycled between the same battles forever and could
 *      re-offer the battle just dismissed.
 *
 * IMPORTANT: this suite imports the REAL implementation, compiled from
 * `services/battleQueue.ts` by `npm run test:battles`. The pre-existing
 * `test/battleSections.test.js` keeps a hand-copied duplicate of this logic,
 * which meant tests could pass while the shipped code drifted. Testing the
 * compiled source is what makes this coverage meaningful.
 */

const test = require("node:test");
const assert = require("node:assert/strict");
const path = require("node:path");
const fs = require("node:fs");

const COMPILED = path.resolve(__dirname, "..", ".test-build/services/battleQueue.js");
if (!fs.existsSync(COMPILED)) {
  throw new Error(
    `Compiled queue module missing at ${COMPILED}.\n` +
      "Run: npx tsc -p tsconfig.testbuild.json   (npm run test:battles does this)"
  );
}
const {
  getBattleStatus,
  getNextVotableBattle,
  isVotableBattle,
  listVotableBattles,
  countVotableBattles,
} = require(COMPILED);

// ─── Fixtures ────────────────────────────────────────────────────────────────

const VIEWER = "viewer-1";
const ts = (ms) => ({ toMillis: () => ms });
const HOUR = 3_600_000;

/** A matched, in-window battle between two other athletes — votable. */
function liveBattle(id, a = `${id}-a`, b = `${id}-b`) {
  return {
    id,
    creatorId: a,
    playerA: { userId: a, username: a, postId: `${a}-post` },
    playerB: { userId: b, username: b, postId: `${b}-post` },
    votesA: 0,
    votesB: 0,
    status: "live",
    category: "Highlights",
    durationHours: 24,
    createdAt: ts(Date.now() - HOUR),
    endTime: ts(Date.now() + 24 * HOUR),
    winner: null,
    statsRecorded: false,
  };
}

/** An unaccepted challenge: no opponent, therefore never votable. */
function openChallenge(id, a = `${id}-a`) {
  return { ...liveBattle(id, a), playerB: null, status: "open" };
}

const ctx = (voted = [], skipped = []) => ({
  currentUserId: VIEWER,
  votedIds: new Map(voted.map((id) => [id, "A"])),
  skippedIds: new Set(skipped),
});

function advance(battles, currentId, voted, skipped) {
  return getNextVotableBattle({
    battles,
    currentBattleId: currentId,
    currentUserId: VIEWER,
    votedMap: new Map(voted.map((id) => [id, "A"])),
    skippedIds: new Set(skipped),
  });
}

// ─── The reported scenario: 3 simultaneous Live battles ──────────────────────

test("3 live battles: vote first → second, skip second → third, then exhausted", () => {
  const battles = [liveBattle("B1"), liveBattle("B2"), liveBattle("B3")];
  assert.equal(countVotableBattles(battles, ctx()), 3, "all three are votable");

  // Vote B1 → B2
  const afterVote1 = advance(battles, "B1", ["B1"], []);
  assert.ok(afterVote1, 'voting the first battle must not report "All caught up"');
  assert.equal(afterVote1.id, "B2");

  // Skip B2 (no vote cast) → B3
  const afterSkip2 = advance(battles, "B2", ["B1"], ["B2"]);
  assert.ok(afterSkip2, "skipping must not exhaust the remaining queue");
  assert.equal(afterSkip2.id, "B3");

  // Vote B3 — the third and last unhandled battle. B2 was already handled
  // (skipped) this session, so the queue is now legitimately exhausted. This is
  // the exact sequence the bug report requires: exhaustion appears only AFTER
  // the third battle is handled, never before.
  const afterVote3 = advance(battles, "B3", ["B1", "B3"], ["B2"]);
  assert.equal(afterVote3, null, '"All caught up" only after all three handled');
});

test("skipping never re-offers the battle just dismissed", () => {
  const battles = [liveBattle("B1"), liveBattle("B2"), liveBattle("B3")];
  const next = advance(battles, "B2", [], ["B2"]);
  assert.notEqual(next.id, "B2");
});

test("skipping every battle in turn visits each one exactly once", () => {
  const battles = [liveBattle("B1"), liveBattle("B2"), liveBattle("B3")];
  const skipped = [];
  const seen = [];
  let currentId = "B1";
  skipped.push("B1");
  for (let step = 0; step < 5; step += 1) {
    const next = advance(battles, currentId, [], skipped);
    if (!next) break;
    // Never revisit a battle already handled in this run — skipping must
    // terminate rather than cycling forever.
    assert.equal(seen.includes(next.id), false, `re-offered ${next.id}`);
    seen.push(next.id);
    currentId = next.id;
    skipped.push(next.id);
  }
  assert.deepEqual(seen, ["B2", "B3"], "advances through the rest, then stops");
});

test("skipping the ONLY votable battle reports exhaustion honestly", () => {
  // Regression: previously this returned null because the current battle was
  // excluded from the search — indistinguishable from a genuinely empty queue.
  // It is still the correct answer here, but only because nothing else exists.
  const battles = [liveBattle("B1")];
  assert.equal(advance(battles, "B1", [], ["B1"]), null);
  assert.equal(countVotableBattles(battles, ctx([], ["B1"])), 1,
    "the battle itself is still votable — the skip is a deferral, not a decline");
});

// ─── Root cause 1: count must match the queue ────────────────────────────────

test("open challenges are never votable and must not inflate the votable count", () => {
  const battles = [liveBattle("L1"), openChallenge("O1"), openChallenge("O2")];

  const live = battles.filter((b) => getBattleStatus(b) === "live");
  const open = battles.filter((b) => getBattleStatus(b) === "open");
  assert.equal(live.length, 1);
  assert.equal(open.length, 2);

  // The old badge: live + open = 3, while the queue held exactly 1.
  assert.equal(live.length + open.length, 3, "reproduces the misleading total");
  assert.equal(
    countVotableBattles(battles, ctx()),
    1,
    "votable count must reflect what the viewer can actually act on"
  );

  // Voting the single live battle legitimately exhausts the queue.
  assert.equal(advance(battles, "L1", ["L1"], []), null);
  for (const challenge of open) {
    assert.equal(isVotableBattle(challenge, ctx()), false);
  }
});

// ─── Eligibility parity ──────────────────────────────────────────────────────

test("participants and creators are excluded consistently", () => {
  const asPlayerA = liveBattle("P1", VIEWER, "other");
  const asPlayerB = liveBattle("P2", "other", VIEWER);
  const asCreator = { ...liveBattle("P3"), creatorId: VIEWER };
  const bystander = liveBattle("P4");
  const battles = [asPlayerA, asPlayerB, asCreator, bystander];

  assert.equal(isVotableBattle(asPlayerA, ctx()), false);
  assert.equal(isVotableBattle(asPlayerB, ctx()), false);
  assert.equal(isVotableBattle(asCreator, ctx()), false, "creator may not vote in their own battle");
  assert.equal(isVotableBattle(bystander, ctx()), true);

  assert.deepEqual(
    listVotableBattles(battles, ctx()).map((b) => b.id),
    ["P4"]
  );
  const next = advance(battles, "P1", [], []);
  assert.equal(next.id, "P4", "queue skips battles the viewer competes in");
});

test("already-voted battles are never offered again", () => {
  const battles = [liveBattle("B1"), liveBattle("B2")];
  assert.equal(isVotableBattle(battles[0], ctx(["B1"])), false);
  const next = advance(battles, "B2", ["B1", "B2"], []);
  assert.equal(next, null);
});

test("expired and completed battles leave the queue", () => {
  const ended = {
    ...liveBattle("E1"),
    endTime: ts(Date.now() - HOUR),
  };
  const done = { ...liveBattle("C1"), status: "completed" };
  const battles = [ended, done, liveBattle("B1")];

  assert.equal(getBattleStatus(ended), "completed", "past its window");
  assert.equal(isVotableBattle(ended, ctx()), false);
  assert.equal(isVotableBattle(done, ctx()), false);
  assert.equal(countVotableBattles(battles, ctx()), 1);
});

test("a signed-out viewer has no queue", () => {
  const battles = [liveBattle("B1"), liveBattle("B2")];
  assert.equal(
    getNextVotableBattle({
      battles,
      currentBattleId: "B1",
      currentUserId: null,
      votedMap: new Map(),
    }),
    null
  );
});

// ─── Stale state after refresh / re-entry ────────────────────────────────────

test("a stale current battle id (refreshed away) still advances, without repeating itself", () => {
  // The viewer holds a battle object that a refresh removed from the list.
  const battles = [liveBattle("B1"), liveBattle("B2")];
  const next = advance(battles, "GONE", [], []);
  assert.ok(next, "must not report exhaustion just because the cursor is stale");
  assert.equal(next.id, "B1");

  // And a stale id that is also skipped must not come back.
  const afterSkipStale = advance(battles, "B1", [], ["B1"]);
  assert.equal(afterSkipStale.id, "B2");
});

test("after refresh clears skips, the full queue is offered again", () => {
  const battles = [liveBattle("B1"), liveBattle("B2"), liveBattle("B3")];
  // Mid-session: two skipped, so only B3 is un-skipped.
  assert.equal(
    listVotableBattles(battles, ctx([], ["B1", "B2"]), { includeSkipped: false }).length,
    1
  );
  // Pull-to-refresh clears the session skip list (battles.tsx
  // manualRefreshAndResetSkips) — every battle is votable again.
  assert.equal(countVotableBattles(battles, ctx([], [])), 3);
  const next = advance(battles, "B1", [], []);
  assert.equal(next.id, "B2");
});

test("the Live count and the viewer queue agree for a pure live set", () => {
  const battles = [liveBattle("B1"), liveBattle("B2"), liveBattle("B3")];
  const liveCount = battles.filter((b) => getBattleStatus(b) === "live").length;
  assert.equal(liveCount, countVotableBattles(battles, ctx()));

  // They diverge only for reasons a viewer can understand: a battle they are
  // competing in is live but not votable by them.
  const mine = liveBattle("B4", VIEWER, "other");
  const withMine = [...battles, mine];
  assert.equal(withMine.filter((b) => getBattleStatus(b) === "live").length, 4);
  assert.equal(countVotableBattles(withMine, ctx()), 3);
});

test("vote → skip → vote across a mixed board never strands a votable battle", () => {
  const battles = [
    liveBattle("B1"),
    openChallenge("O1"),
    liveBattle("B2"),
    liveBattle("B3", VIEWER, "other"), // viewer competes here
    liveBattle("B4"),
  ];
  assert.equal(countVotableBattles(battles, ctx()), 3, "B1, B2, B4");

  const step1 = advance(battles, "B1", ["B1"], []);
  assert.equal(step1.id, "B2");

  const step2 = advance(battles, "B2", ["B1"], ["B2"]);
  assert.equal(step2.id, "B4", "skips the open challenge and the viewer's own battle");

  // B1 and B4 voted, B2 skipped — every votable battle handled this session.
  const step3 = advance(battles, "B4", ["B1", "B4"], ["B2"]);
  assert.equal(step3, null, "exhausted only once every votable battle is handled");

  // And a refresh (which clears skips) brings the deferred battle back.
  const afterRefresh = advance(battles, "B4", ["B1", "B4"], []);
  assert.equal(afterRefresh.id, "B2", "refresh re-opens skipped battles");
});
