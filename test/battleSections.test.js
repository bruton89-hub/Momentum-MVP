"use strict";

/**
 * Battles tab section derivations.
 *
 * These mirror the pure logic in app/(tabs)/battles.tsx — which tab a battle
 * lands in, and who may accept a challenge. The rules they protect are the
 * ones that have actually broken before:
 *
 *   • An unmatched challenge past its deadline is "expired" and must never
 *     appear in Live, My Battles, or Completed.
 *   • A battle stored as "completed" with no playerB is still expired.
 *   • A creator can never accept their own challenge (firestore.rules
 *     enforces this server-side; the UI must not offer the button).
 *
 * Run with:  node --test test/battleSections.test.js
 */

const test = require("node:test");
const assert = require("node:assert/strict");

// ─── Helpers under test (kept in sync with hooks/useBattles.ts) ───────────────

const DEFAULT_DURATION_HOURS = 24;

function toMillis(value) {
  if (!value) return null;
  if (typeof value.toMillis === "function") return value.toMillis();
  if (typeof value.seconds === "number") return value.seconds * 1000;
  return null;
}

function getBattleEndTime(battle) {
  const stored = toMillis(battle.endTime);
  if (stored) return stored;
  const createdMs = toMillis(battle.createdAt);
  if (!createdMs) return null;
  if (typeof battle.durationMinutes === "number") {
    return createdMs + battle.durationMinutes * 60_000;
  }
  const hours =
    typeof battle.durationHours === "number"
      ? battle.durationHours
      : DEFAULT_DURATION_HOURS;
  return createdMs + hours * 3_600_000;
}

function isBattleExpired(battle) {
  const endMs = getBattleEndTime(battle);
  if (!endMs) return false;
  return Date.now() > endMs;
}

function isMatchedBattle(battle) {
  return !!battle.playerB?.userId && !!battle.playerA?.userId;
}

function getBattleStatus(battle) {
  if (battle.status === "expired") return "expired";
  const expired = isBattleExpired(battle);
  if (!isMatchedBattle(battle)) {
    return expired || battle.status === "completed" ? "expired" : "open";
  }
  if (battle.status === "completed") return "completed";
  if (expired) return "completed";
  if (battle.status === "live") return "live";
  return "open";
}

// ─── Section derivations (mirror of the Battles screen) ──────────────────────

const sections = (battles, userId) => {
  const live = battles.filter((b) => getBattleStatus(b) === "live");
  const open = battles.filter((b) => getBattleStatus(b) === "open");
  const completed = battles.filter((b) => getBattleStatus(b) === "completed");
  const participates = (b) =>
    !!userId &&
    (b.playerA?.userId === userId ||
      b.playerB?.userId === userId ||
      b.creatorId === userId);
  return {
    live,
    open,
    completed,
    myActive: live.filter(participates),
    myChallengesSent: open.filter((b) => b.creatorId === userId),
    myCompleted: completed.filter(participates),
  };
};

const canAcceptChallenge = (battle, userId) =>
  !!userId && getBattleStatus(battle) === "open" && battle.creatorId !== userId;

// ─── Fixtures ────────────────────────────────────────────────────────────────

const ts = (ms) => ({ toMillis: () => ms });
const future = () => ts(Date.now() + 6 * 3_600_000);
const past = () => ts(Date.now() - 60_000);
const A = { userId: "user-a", username: "AthleteA" };
const B = { userId: "user-b", username: "AthleteB" };

const liveMatched = {
  id: "live-1",
  creatorId: "user-a",
  playerA: A,
  playerB: B,
  status: "live",
  endTime: future(),
  votesA: 3,
  votesB: 1,
};
const openUnmatched = {
  id: "open-1",
  creatorId: "user-a",
  playerA: A,
  playerB: null,
  status: "open",
  endTime: future(),
  votesA: 0,
  votesB: 0,
};
const expiredUnmatched = {
  id: "exp-1",
  creatorId: "user-a",
  playerA: A,
  playerB: null,
  status: "open",
  endTime: past(),
  votesA: 0,
  votesB: 0,
};
/** The historical bug: finalizeBattle marked an unanswered challenge completed. */
const legacyBadCompleted = {
  id: "exp-2",
  creatorId: "user-a",
  playerA: A,
  playerB: null,
  status: "completed",
  endTime: past(),
  votesA: 0,
  votesB: 0,
};
const completedMatched = {
  id: "done-1",
  creatorId: "user-a",
  playerA: A,
  playerB: B,
  status: "completed",
  endTime: past(),
  votesA: 7,
  votesB: 3,
  winner: "user-a",
};

const ALL = [
  liveMatched,
  openUnmatched,
  expiredUnmatched,
  legacyBadCompleted,
  completedMatched,
];

// ─── Tests ───────────────────────────────────────────────────────────────────

test("expired unmatched challenges appear in no section", () => {
  const s = sections(ALL, "user-a");
  const ids = (list) => list.map((b) => b.id);
  for (const key of ["live", "open", "completed", "myActive", "myChallengesSent", "myCompleted"]) {
    assert.ok(
      !ids(s[key]).includes("exp-1"),
      `expired unmatched challenge leaked into ${key}`
    );
    assert.ok(
      !ids(s[key]).includes("exp-2"),
      `legacy completed-but-unmatched challenge leaked into ${key}`
    );
  }
});

test("a stored-completed battle with no opponent is expired, not completed", () => {
  assert.equal(getBattleStatus(legacyBadCompleted), "expired");
});

test("Live shows live battles and open challenges separately", () => {
  const s = sections(ALL, "user-c");
  assert.deepEqual(s.live.map((b) => b.id), ["live-1"]);
  assert.deepEqual(s.open.map((b) => b.id), ["open-1"]);
});

test("Completed contains only matched, finished battles", () => {
  const s = sections(ALL, "user-c");
  assert.deepEqual(s.completed.map((b) => b.id), ["done-1"]);
});

test("My Battles splits active, challenges sent, and results", () => {
  const s = sections(ALL, "user-a");
  assert.deepEqual(s.myActive.map((b) => b.id), ["live-1"]);
  assert.deepEqual(s.myChallengesSent.map((b) => b.id), ["open-1"]);
  assert.deepEqual(s.myCompleted.map((b) => b.id), ["done-1"]);
});

test("a non-participant has no My Battles content", () => {
  const s = sections(ALL, "user-z");
  assert.equal(s.myActive.length, 0);
  assert.equal(s.myChallengesSent.length, 0);
  assert.equal(s.myCompleted.length, 0);
});

test("a creator cannot accept their own challenge", () => {
  assert.equal(canAcceptChallenge(openUnmatched, "user-a"), false);
  assert.equal(canAcceptChallenge(openUnmatched, "user-b"), true);
});

test("an expired challenge cannot be accepted by anyone", () => {
  assert.equal(canAcceptChallenge(expiredUnmatched, "user-b"), false);
});

test("a signed-out viewer cannot accept", () => {
  assert.equal(canAcceptChallenge(openUnmatched, null), false);
});
