"use strict";

const test = require("node:test");
const assert = require("node:assert/strict");
const { getFirestore, Timestamp } = require("firebase-admin/firestore");
const { finalizeBattle } = require("../lib/index");

const db = getFirestore();

test("finalizeBattle atomically records stats and trusted result notifications once", async () => {
  const battleId = "finalize-notifications";
  await db.doc(`battles/${battleId}`).set({
    creatorId: "player-a",
    playerA: { userId: "player-a", username: "Alpha", avatar: "alpha.jpg" },
    playerB: { userId: "player-b", username: "Bravo", avatar: "bravo.jpg" },
    votesA: 3,
    votesB: 1,
    status: "live",
    endTime: Timestamp.fromMillis(Date.now() - 60_000),
    winner: null,
    statsRecorded: false,
  });
  await Promise.all([
    db.doc("users/player-a").set({ wins: 0, losses: 0 }),
    db.doc("users/player-b").set({ wins: 0, losses: 0 }),
    db.doc("votes/finalize-notifications_voter-1").set({ battleId, userId: "voter-1", side: "A" }),
    db.doc("votes/finalize-notifications_voter-2").set({ battleId, userId: "voter-2", side: "A" }),
    db.doc("votes/finalize-notifications_voter-3").set({ battleId, userId: "voter-3", side: "A" }),
    db.doc("votes/finalize-notifications_voter-4").set({ battleId, userId: "voter-4", side: "B" }),
  ]);

  const request = { auth: { uid: "viewer", token: {} }, data: { battleId } };
  const first = await finalizeBattle.run(request);
  assert.equal(first.status, "finalized");
  assert.equal(first.winner, "player-a");

  const [winner, loser, winnerNotification, loserNotification] = await Promise.all([
    db.doc("users/player-a").get(),
    db.doc("users/player-b").get(),
    db.doc(`notifications/bres_${battleId}_player-a`).get(),
    db.doc(`notifications/bres_${battleId}_player-b`).get(),
  ]);
  assert.equal(winner.get("wins"), 1);
  assert.equal(loser.get("losses"), 1);
  assert.equal(winnerNotification.get("type"), "battle_won");
  assert.equal(winnerNotification.get("recipientId"), "player-a");
  assert.equal(winnerNotification.get("actorId"), "system");
  assert.equal(loserNotification.get("type"), "battle_completed");
  assert.equal(loserNotification.get("recipientId"), "player-b");

  const retry = await finalizeBattle.run(request);
  assert.equal(retry.status, "already_recorded");
  assert.equal((await db.doc("users/player-a").get()).get("wins"), 1);
  assert.equal((await db.doc("users/player-b").get()).get("losses"), 1);
});

test("finalizeBattle treats a tied authoritative vote set atomically", async () => {
  const battleId = "finalize-tie";
  await Promise.all([
    db.doc(`battles/${battleId}`).set({
      creatorId: "tie-a",
      playerA: { userId: "tie-a", username: "Tie Alpha", avatar: "" },
      playerB: { userId: "tie-b", username: "Tie Bravo", avatar: "" },
      votesA: 1,
      votesB: 1,
      status: "live",
      endTime: Timestamp.fromMillis(Date.now() - 60_000),
      winner: null,
      statsRecorded: false,
    }),
    db.doc("users/tie-a").set({ wins: 0, losses: 0 }),
    db.doc("users/tie-b").set({ wins: 0, losses: 0 }),
    db.doc("votes/finalize-tie_voter-a").set({ battleId, userId: "voter-a", side: "A" }),
    db.doc("votes/finalize-tie_voter-b").set({ battleId, userId: "voter-b", side: "B" }),
  ]);

  const result = await finalizeBattle.run({
    auth: { uid: "viewer", token: {} },
    data: { battleId },
  });
  assert.equal(result.status, "finalized");
  assert.equal(result.winner, null);
  assert.equal((await db.doc("users/tie-a").get()).get("wins"), 0);
  assert.equal((await db.doc("users/tie-b").get()).get("losses"), 0);
  assert.equal(
    (await db.doc(`notifications/bres_${battleId}_tie-a`).get()).get("type"),
    "battle_completed"
  );
  assert.equal(
    (await db.doc(`notifications/bres_${battleId}_tie-b`).get()).get("type"),
    "battle_completed"
  );
});

test("finalizeBattle rejects forged counters without partial stats or notifications", async () => {
  const battleId = "finalize-forged-counters";
  await Promise.all([
    db.doc(`battles/${battleId}`).set({
      creatorId: "forged-a",
      playerA: { userId: "forged-a", username: "Forged Alpha", avatar: "" },
      playerB: { userId: "forged-b", username: "Forged Bravo", avatar: "" },
      votesA: 99,
      votesB: 0,
      status: "live",
      endTime: Timestamp.fromMillis(Date.now() - 60_000),
      winner: null,
      statsRecorded: false,
    }),
    db.doc("users/forged-a").set({ wins: 0, losses: 0 }),
    db.doc("users/forged-b").set({ wins: 0, losses: 0 }),
  ]);

  await assert.rejects(
    finalizeBattle.run({ auth: { uid: "viewer", token: {} }, data: { battleId } }),
    (error) => error.code === "failed-precondition"
  );
  assert.equal((await db.doc(`battles/${battleId}`).get()).get("statsRecorded"), false);
  assert.equal((await db.doc("users/forged-a").get()).get("wins"), 0);
  assert.equal((await db.doc("users/forged-b").get()).get("losses"), 0);
  assert.equal((await db.doc(`notifications/bres_${battleId}_forged-a`).get()).exists, false);
  assert.equal((await db.doc(`notifications/bres_${battleId}_forged-b`).get()).exists, false);
});
