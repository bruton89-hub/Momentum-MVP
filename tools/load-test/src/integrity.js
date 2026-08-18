"use strict";

/**
 * Integrity verification against PERSISTED state.
 *
 * Run after every benchmark: reconciles battle vote counters against
 * authoritative vote markers, like counters against like markers, and checks
 * for duplicate/unauthorized records. An integrity violation fails the tier
 * regardless of latency.
 */

const { createAdminContext } = require("./adminContext");

async function verifyIntegrity({ projectId, emulators, env = process.env, expected = {} }) {
  const { db } = createAdminContext({ projectId, emulators, env });
  const violations = [];
  const details = {};

  // ── Battles: counters must equal marker counts, exactly. ───────────────────
  const battles = await db.collection("battles").get();
  const voteMarkers = await db.collection("votes").get();
  const markersByBattle = new Map();
  const voterSeen = new Map(); // `${battleId}:${userId}` → count (duplicate detection)

  voteMarkers.forEach((markerSnap) => {
    const data = markerSnap.data();
    const battleId = data.battleId;
    if (!battleId) {
      violations.push(`vote marker ${markerSnap.id} has no battleId`);
      return;
    }
    const entry = markersByBattle.get(battleId) ?? { A: 0, B: 0, other: 0 };
    if (data.side === "A") entry.A += 1;
    else if (data.side === "B") entry.B += 1;
    else entry.other += 1;
    markersByBattle.set(battleId, entry);

    const voterKey = `${battleId}:${data.userId}`;
    voterSeen.set(voterKey, (voterSeen.get(voterKey) ?? 0) + 1);

    // The server writes markers at the deterministic id `{battleId}_{uid}`;
    // any other id shape means a write bypassed castBattleVote.
    if (markerSnap.id !== `${battleId}_${data.userId}`) {
      violations.push(
        `vote marker ${markerSnap.id} does not match its deterministic id ${battleId}_${data.userId}`
      );
    }
  });

  for (const [voterKey, count] of voterSeen) {
    if (count > 1) violations.push(`duplicate votes (${count}) for ${voterKey}`);
  }

  let battlesChecked = 0;
  battles.forEach((battleSnap) => {
    const data = battleSnap.data();
    const markers = markersByBattle.get(battleSnap.id) ?? { A: 0, B: 0, other: 0 };
    const votesA = typeof data.votesA === "number" ? data.votesA : 0;
    const votesB = typeof data.votesB === "number" ? data.votesB : 0;
    battlesChecked += 1;
    if (markers.other > 0) {
      violations.push(`battle ${battleSnap.id} has ${markers.other} malformed vote markers`);
    }
    if (votesA !== markers.A || votesB !== markers.B) {
      violations.push(
        `battle ${battleSnap.id} counters (A=${votesA}, B=${votesB}) != markers ` +
          `(A=${markers.A}, B=${markers.B})`
      );
    }
    // Participants must never appear as voters in their own battle.
    for (const participant of [data.playerA?.userId, data.playerB?.userId]) {
      if (participant && voterSeen.has(`${battleSnap.id}:${participant}`)) {
        violations.push(
          `battle ${battleSnap.id}: participant ${participant} voted in their own battle`
        );
      }
    }
  });
  details.battlesChecked = battlesChecked;
  details.voteMarkers = voteMarkers.size;

  // ── Posts: likesCount must equal like markers. ─────────────────────────────
  const likeMarkers = await db.collection("likes").get();
  const likesByPost = new Map();
  const likerSeen = new Map();
  likeMarkers.forEach((likeSnap) => {
    const data = likeSnap.data();
    likesByPost.set(data.postId, (likesByPost.get(data.postId) ?? 0) + 1);
    const key = `${data.postId}:${data.userId}`;
    likerSeen.set(key, (likerSeen.get(key) ?? 0) + 1);
    if (likeSnap.id !== `${data.postId}_${data.userId}`) {
      violations.push(`like marker ${likeSnap.id} has a non-deterministic id`);
    }
  });
  for (const [key, count] of likerSeen) {
    if (count > 1) violations.push(`duplicate likes (${count}) for ${key}`);
  }

  const posts = await db.collection("posts").get();
  let postsChecked = 0;
  const postIds = new Set();
  posts.forEach((postSnap) => {
    const data = postSnap.data();
    const likesCount = typeof data.likesCount === "number" ? data.likesCount : 0;
    const markers = likesByPost.get(postSnap.id) ?? 0;
    postsChecked += 1;
    if (likesCount !== markers) {
      violations.push(
        `post ${postSnap.id} likesCount=${likesCount} != like markers=${markers}`
      );
    }
    if (likesCount < 0) violations.push(`post ${postSnap.id} has a negative likesCount`);
    if (postIds.has(postSnap.id)) violations.push(`duplicate post document ${postSnap.id}`);
    postIds.add(postSnap.id);
  });
  details.postsChecked = postsChecked;
  details.likeMarkers = likeMarkers.size;

  // ── Expected-vs-persisted reconciliation for the battle stress test. ───────
  if (expected.battleId && typeof expected.acceptedVotes === "number") {
    const battleSnap = await db.collection("battles").doc(expected.battleId).get();
    const data = battleSnap.data() ?? {};
    const persisted = (data.votesA ?? 0) + (data.votesB ?? 0);
    details.expectedVotes = expected.acceptedVotes;
    details.persistedVotes = persisted;
    if (persisted !== expected.acceptedVotes) {
      violations.push(
        `battle ${expected.battleId}: expected ${expected.acceptedVotes} accepted votes, ` +
          `persisted ${persisted}`
      );
    }
  }

  return { violations, details, clean: violations.length === 0 };
}

module.exports = { verifyIntegrity };
