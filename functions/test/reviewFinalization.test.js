"use strict";

/**
 * INDEPENDENT REVIEW — finalizeBattle aggregate-reconciliation validation.
 *
 * The previous agent replaced a full vote-collection scan inside the
 * finalizeBattle transaction with three count() aggregate reads. Passing tests
 * are not sufficient to accept that change: the aggregate path must be correct
 * for every battle outcome, must remain authorization-gated, must stay
 * idempotent, and — most importantly — must still SERIALIZE correctly against
 * concurrent voting so a vote cannot slip between reconciliation and commit.
 *
 * These cases target the gaps not covered by finalizeBattle.test.js or
 * engagementConcurrency.test.js.
 */

const test = require("node:test");
const assert = require("node:assert/strict");
const { getFirestore, Timestamp } = require("firebase-admin/firestore");
const { finalizeBattle, castBattleVote } = require("../lib/index");

const db = getFirestore();

function endedBattle(overrides = {}) {
  return {
    creatorId: "p-a",
    playerA: { userId: "p-a", username: "Alpha", avatar: "" },
    playerB: { userId: "p-b", username: "Bravo", avatar: "" },
    votesA: 0,
    votesB: 0,
    status: "live",
    endTime: Timestamp.fromMillis(Date.now() - 60_000),
    winner: null,
    statsRecorded: false,
    ...overrides,
  };
}

const asViewer = (battleId, uid = "viewer") => ({
  auth: { uid, token: {} },
  data: { battleId },
});

// ── Zero-vote battle ────────────────────────────────────────────────────────

test("REVIEW: a matched battle that ended with zero votes is a tie, not a winner", async () => {
  const battleId = "rev-zero-votes";
  await Promise.all([
    db.doc(`battles/${battleId}`).set(endedBattle()),
    db.doc("users/p-a").set({ wins: 0, losses: 0 }),
    db.doc("users/p-b").set({ wins: 0, losses: 0 }),
  ]);

  const result = await finalizeBattle.run(asViewer(battleId));
  assert.equal(result.status, "finalized");
  assert.equal(result.winner, null, "zero votes must not crown a winner");

  const [battle, a, b] = await Promise.all([
    db.doc(`battles/${battleId}`).get(),
    db.doc("users/p-a").get(),
    db.doc("users/p-b").get(),
  ]);
  assert.equal(battle.get("status"), "completed");
  assert.equal(battle.get("statsRecorded"), true);
  assert.equal(a.get("wins"), 0, "a tie must record no wins");
  assert.equal(b.get("losses"), 0, "a tie must record no losses");
  // Result notifications still go out to both participants.
  const [na, nb] = await Promise.all([
    db.doc(`notifications/bres_${battleId}_p-a`).get(),
    db.doc(`notifications/bres_${battleId}_p-b`).get(),
  ]);
  assert.equal(na.get("type"), "battle_completed");
  assert.equal(nb.get("type"), "battle_completed");
});

// ── Authorization ───────────────────────────────────────────────────────────

test("REVIEW: finalization requires authentication", async () => {
  const battleId = "rev-unauth";
  await db.doc(`battles/${battleId}`).set(endedBattle());
  await assert.rejects(
    finalizeBattle.run({ auth: null, data: { battleId } }),
    (error) => error.code === "unauthenticated"
  );
  const battle = await db.doc(`battles/${battleId}`).get();
  assert.equal(battle.get("statsRecorded"), false, "denied call must not mutate state");
});

test("REVIEW: a battle that has not ended cannot be finalized early", async () => {
  const battleId = "rev-not-ended";
  await db.doc(`battles/${battleId}`).set(
    endedBattle({ endTime: Timestamp.fromMillis(Date.now() + 3_600_000) })
  );
  await assert.rejects(
    finalizeBattle.run(asViewer(battleId)),
    (error) => error.code === "failed-precondition"
  );
  const battle = await db.doc(`battles/${battleId}`).get();
  assert.equal(battle.get("status"), "live");
  assert.equal(battle.get("statsRecorded"), false);
});

test("REVIEW: a missing battle is reported, not silently finalized", async () => {
  await assert.rejects(
    finalizeBattle.run(asViewer("rev-does-not-exist")),
    (error) => error.code === "not-found"
  );
});

// ── Unmatched (expired) challenge ───────────────────────────────────────────

test("REVIEW: an unmatched open challenge expires without stats or notifications", async () => {
  const battleId = "rev-unmatched";
  await Promise.all([
    db.doc(`battles/${battleId}`).set(
      endedBattle({ playerB: null, status: "open", votesA: 1 })
    ),
    db.doc("users/p-a").set({ wins: 0, losses: 0 }),
    // A stray vote marker exists so reconciliation has something to match.
    db.doc(`votes/${battleId}_voter-1`).set({
      battleId,
      userId: "voter-1",
      side: "A",
      createdAt: Timestamp.now(),
    }),
  ]);

  const result = await finalizeBattle.run(asViewer(battleId));
  assert.equal(result.status, "expired");
  assert.equal(result.winner, null);

  const [battle, a, notif] = await Promise.all([
    db.doc(`battles/${battleId}`).get(),
    db.doc("users/p-a").get(),
    db.doc(`notifications/bres_${battleId}_p-a`).get(),
  ]);
  assert.equal(battle.get("status"), "expired");
  assert.equal(a.get("wins"), 0, "an unanswered challenge is not a win");
  assert.equal(notif.exists, false, "expired challenges must not notify a result");
});

// ── Duplicate + concurrent finalization ─────────────────────────────────────

test("REVIEW: concurrent finalization attempts record stats exactly once", async () => {
  const battleId = "rev-concurrent-final";
  await Promise.all([
    db.doc(`battles/${battleId}`).set(endedBattle({ votesA: 2, votesB: 1 })),
    db.doc("users/p-a").set({ wins: 0, losses: 0 }),
    db.doc("users/p-b").set({ wins: 0, losses: 0 }),
    db.doc(`votes/${battleId}_v1`).set({ battleId, userId: "v1", side: "A", createdAt: Timestamp.now() }),
    db.doc(`votes/${battleId}_v2`).set({ battleId, userId: "v2", side: "A", createdAt: Timestamp.now() }),
    db.doc(`votes/${battleId}_v3`).set({ battleId, userId: "v3", side: "B", createdAt: Timestamp.now() }),
  ]);

  // Ten clients observe the same ended battle simultaneously — the real
  // pattern, since every client that renders it calls the callable.
  const results = await Promise.allSettled(
    Array.from({ length: 10 }, (_, index) =>
      finalizeBattle.run(asViewer(battleId, `viewer-${index}`))
    )
  );
  const fulfilled = results.filter((r) => r.status === "fulfilled");
  assert.ok(fulfilled.length > 0, "at least one finalization must succeed");
  for (const r of fulfilled) {
    assert.ok(["finalized", "already_recorded"].includes(r.value.status));
    if (r.value.status === "finalized") assert.equal(r.value.winner, "p-a");
  }

  // Persisted state must show exactly one recorded outcome.
  const [battle, a, b] = await Promise.all([
    db.doc(`battles/${battleId}`).get(),
    db.doc("users/p-a").get(),
    db.doc("users/p-b").get(),
  ]);
  assert.equal(battle.get("winner"), "p-a");
  assert.equal(battle.get("statsRecorded"), true);
  assert.equal(a.get("wins"), 1, "wins must be incremented exactly once");
  assert.equal(b.get("losses"), 1, "losses must be incremented exactly once");
});

test("REVIEW: re-finalizing an already recorded battle is a no-op", async () => {
  const battleId = "rev-idempotent";
  await Promise.all([
    db.doc(`battles/${battleId}`).set(endedBattle({ votesA: 1, votesB: 0 })),
    db.doc("users/p-a").set({ wins: 0, losses: 0 }),
    db.doc("users/p-b").set({ wins: 0, losses: 0 }),
    db.doc(`votes/${battleId}_v1`).set({ battleId, userId: "v1", side: "A", createdAt: Timestamp.now() }),
  ]);
  const first = await finalizeBattle.run(asViewer(battleId));
  assert.equal(first.status, "finalized");
  for (let i = 0; i < 5; i += 1) {
    const again = await finalizeBattle.run(asViewer(battleId));
    assert.equal(again.status, "already_recorded");
  }
  const a = await db.doc("users/p-a").get();
  assert.equal(a.get("wins"), 1, "repeat finalization must not inflate stats");
});

// ── The critical serialization property ─────────────────────────────────────

test("REVIEW: a vote landing during finalization cannot corrupt the recorded outcome", async () => {
  // The aggregate reconciliation only remains safe because castBattleVote also
  // writes battles/{id}, which finalizeBattle reads inside its transaction —
  // so a vote committing mid-finalization forces a retry rather than a
  // counter/marker mismatch. Exercise that interleaving directly.
  const battleId = "rev-race";
  await Promise.all([
    db.doc(`battles/${battleId}`).set({
      creatorId: "p-a",
      playerA: { userId: "p-a", username: "Alpha", avatar: "" },
      playerB: { userId: "p-b", username: "Bravo", avatar: "" },
      votesA: 0,
      votesB: 0,
      status: "live",
      // Still open for voting for a moment, then finalized below.
      endTime: Timestamp.fromMillis(Date.now() + 2_000),
      winner: null,
      statsRecorded: false,
    }),
    db.doc("users/p-a").set({ wins: 0, losses: 0 }),
    db.doc("users/p-b").set({ wins: 0, losses: 0 }),
  ]);

  // Fire votes and a finalization attempt concurrently.
  const votes = Array.from({ length: 8 }, (_, index) =>
    castBattleVote
      .run({
        auth: { uid: `racer-${index}`, token: {} },
        data: {
          battleId,
          side: index % 2 === 0 ? "A" : "B",
          clientMutationId: `${battleId}:racer-${index}`,
        },
      })
      .catch(() => null)
  );
  const finalizeAttempt = finalizeBattle.run(asViewer(battleId)).catch(() => null);
  await Promise.all([...votes, finalizeAttempt]);

  // Whatever the interleaving produced, counters and markers must agree.
  const [battle, markers] = await Promise.all([
    db.doc(`battles/${battleId}`).get(),
    db.collection("votes").where("battleId", "==", battleId).get(),
  ]);
  let a = 0;
  let b = 0;
  markers.forEach((m) => {
    if (m.get("side") === "A") a += 1;
    else if (m.get("side") === "B") b += 1;
  });
  assert.equal(battle.get("votesA"), a, "votesA must equal side-A markers");
  assert.equal(battle.get("votesB"), b, "votesB must equal side-B markers");

  // If it did finalize, the winner must follow from the persisted counters.
  if (battle.get("statsRecorded") === true && battle.get("status") === "completed") {
    const expected = a > b ? "p-a" : b > a ? "p-b" : null;
    assert.equal(battle.get("winner"), expected, "winner must match persisted counters");
  }

  // Force a clean finalization now that voting has closed and confirm it
  // still reconciles through the aggregate path.
  await db.doc(`battles/${battleId}`).update({
    endTime: Timestamp.fromMillis(Date.now() - 1_000),
  });
  const settled = await finalizeBattle.run(asViewer(battleId)).catch((error) => error);
  if (settled && settled.code) {
    // Only an integrity refusal is acceptable here, never a wrong result.
    assert.equal(settled.code, "failed-precondition");
  }
  const after = await db.doc(`battles/${battleId}`).get();
  const expectedWinner = a > b ? "p-a" : b > a ? "p-b" : null;
  if (after.get("statsRecorded") === true && after.get("status") === "completed") {
    assert.equal(after.get("winner"), expectedWinner);
  }
});

// ── Aggregate correctness at a larger marker count ─────────────────────────

test("REVIEW: aggregate reconciliation is exact well past a single page of votes", async () => {
  // The whole point of the change was to stop streaming every vote document.
  // Verify the count path is still exact at a volume where the old scan would
  // have been the expensive part.
  const battleId = "rev-many-votes";
  const total = 250;
  const sideA = 140;
  await db.doc(`battles/${battleId}`).set(
    endedBattle({ votesA: sideA, votesB: total - sideA })
  );
  await Promise.all([
    db.doc("users/p-a").set({ wins: 0, losses: 0 }),
    db.doc("users/p-b").set({ wins: 0, losses: 0 }),
  ]);

  let batch = db.batch();
  for (let index = 0; index < total; index += 1) {
    batch.set(db.doc(`votes/${battleId}_voter-${index}`), {
      battleId,
      userId: `voter-${index}`,
      side: index < sideA ? "A" : "B",
      createdAt: Timestamp.now(),
    });
    if ((index + 1) % 200 === 0) {
      await batch.commit();
      batch = db.batch();
    }
  }
  await batch.commit();

  const result = await finalizeBattle.run(asViewer(battleId));
  assert.equal(result.status, "finalized");
  assert.equal(result.winner, "p-a");
  const a = await db.doc("users/p-a").get();
  assert.equal(a.get("wins"), 1);
});
