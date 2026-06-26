/**
 * Momentum MVP — Cloud Functions
 *
 * Server-authoritative battle finalization.
 *
 * The client may NOT write the protected fields below directly (Firestore
 * rules reject those writes). Instead the client invokes the `finalizeBattle`
 * callable, which runs with Admin privileges (bypassing security rules) and is
 * the *only* code path allowed to:
 *   - set battles/{id}.status = "completed"
 *   - set battles/{id}.winner
 *   - set battles/{id}.statsRecorded = true
 *   - increment users/{id}.wins
 *   - increment users/{id}.losses
 */

import { onCall, HttpsError } from "firebase-functions/v2/https";
import { logger } from "firebase-functions";
import { initializeApp } from "firebase-admin/app";
import {
  getFirestore,
  FieldValue,
  Timestamp,
} from "firebase-admin/firestore";
import {
  type CastBattleVoteRequest,
  type CastBattleVoteResponse,
  type SetPostLikeRequest,
  type SetPostLikeResponse,
} from "./contracts/engagement";
import { requireAuthenticatedUid } from "./shared/auth";
import {
  requireBattleVoteSide,
  requireBoolean,
  requireClientMutationId,
  requireRecord,
  requireString,
} from "./shared/validation";

initializeApp();

const db = getFirestore();

// Must match the region the client targets via getFunctions(app).
const REGION = "us-central1";

interface BattlePlayer {
  userId?: string;
}

// ─── Time helpers (mirror the client's getBattleEndTime logic) ────────────────

function toMillis(value: unknown): number | null {
  if (!value) return null;
  if (value instanceof Timestamp) return value.toMillis();
  const obj = value as { seconds?: number; toMillis?: () => number };
  if (typeof obj.toMillis === "function") return obj.toMillis();
  if (typeof obj.seconds === "number") return obj.seconds * 1000;
  return null;
}

/**
 * Resolve the authoritative end time for a battle.
 * Priority: stored endTime → createdAt + duration → createdAt + 24h.
 */
function resolveEndTimeMs(data: Record<string, unknown>): number | null {
  const stored = toMillis(data.endTime);
  if (stored) return stored;

  const createdMs = toMillis(data.createdAt);
  if (!createdMs) return null;

  if (typeof data.durationMinutes === "number") {
    return createdMs + data.durationMinutes * 60_000;
  }
  const hours = typeof data.durationHours === "number" ? data.durationHours : 24;
  return createdMs + hours * 3_600_000;
}

// ─── finalizeBattle callable ──────────────────────────────────────────────────

export const finalizeBattle = onCall(
  {
    region: REGION,
    enforceAppCheck: false,
  },
  async (request) => {
    // 1. Require authentication.
    const uid = request.auth?.uid;
    if (!uid) {
      throw new HttpsError("unauthenticated", "You must be signed in.");
    }

    // 2. Validate input.
    const battleId =
      typeof request.data?.battleId === "string"
        ? request.data.battleId.trim()
        : "";
    if (!battleId) {
      throw new HttpsError("invalid-argument", "battleId is required.");
    }

    const battleRef = db.collection("battles").doc(battleId);

    // 3. Run the whole finalization atomically.
    const result = await db.runTransaction(async (tx) => {
      const snap = await tx.get(battleRef);
      if (!snap.exists) {
        throw new HttpsError("not-found", "Battle not found.");
      }

      const data = (snap.data() ?? {}) as Record<string, unknown>;

      // Idempotent: already finalized — return current outcome, write nothing.
      if (data.statsRecorded === true) {
        return {
          battleId,
          status: "already_recorded" as const,
          winner: (data.winner as string | null) ?? null,
        };
      }

      // The battle must actually be over (server clock is authoritative).
      const endMs = resolveEndTimeMs(data);
      const isCompleted =
        data.status === "completed" || (endMs !== null && Date.now() > endMs);
      if (!isCompleted) {
        throw new HttpsError(
          "failed-precondition",
          "Battle has not ended yet."
        );
      }

      // Determine the winner from the authoritative vote counts.
      const playerA = (data.playerA as BattlePlayer | null) ?? null;
      const playerB = (data.playerB as BattlePlayer | null) ?? null;
      const votesA = typeof data.votesA === "number" ? data.votesA : 0;
      const votesB = typeof data.votesB === "number" ? data.votesB : 0;

      let winnerId: string | null = null;
      if (votesA > votesB) winnerId = playerA?.userId ?? null;
      else if (votesB > votesA) winnerId = playerB?.userId ?? null;
      // Equal votes → tie → winnerId stays null.

      const loserId =
        winnerId && playerA?.userId === winnerId
          ? playerB?.userId ?? null
          : winnerId && playerB?.userId === winnerId
          ? playerA?.userId ?? null
          : null;

      // Close the battle.
      tx.update(battleRef, {
        status: "completed",
        winner: winnerId,
        statsRecorded: true,
        finalizedAt: FieldValue.serverTimestamp(),
      });

      // Record win/loss exactly once (skip ties and malformed pairs).
      if (winnerId && loserId && winnerId !== loserId) {
        tx.set(
          db.collection("users").doc(winnerId),
          { wins: FieldValue.increment(1) },
          { merge: true }
        );
        tx.set(
          db.collection("users").doc(loserId),
          { losses: FieldValue.increment(1) },
          { merge: true }
        );
      }

      return {
        battleId,
        status: "finalized" as const,
        winner: winnerId,
      };
    });

    // Avoid charging for repetitive idempotent info logs when multiple clients
    // observe the same expired battle.
    if (result.status === "finalized") {
      logger.info("[finalizeBattle] done", {
        battleId,
        requestedBy: uid,
        winner: result.winner,
      });
    }

    return result;
  }
);

// ─── Server-authoritative engagement commands ───────────────────────────────

export const castBattleVote = onCall<
  CastBattleVoteRequest,
  Promise<CastBattleVoteResponse>
>(
  {
    region: REGION,
    enforceAppCheck: false,
  },
  async (request) => {
    const uid = requireAuthenticatedUid(request.auth);
    const data = requireRecord(request.data);
    const battleId = requireString(data.battleId, "battleId", {
      maxLength: 128,
    });
    const side = requireBattleVoteSide(data.side);
    requireClientMutationId(data.clientMutationId);

    const battleRef = db.collection("battles").doc(battleId);
    const voteRef = db.collection("votes").doc(`${battleId}_${uid}`);

    return db.runTransaction(async (tx) => {
      const [battleSnap, voteSnap] = await Promise.all([
        tx.get(battleRef),
        tx.get(voteRef),
      ]);

      if (!battleSnap.exists) {
        throw new HttpsError("not-found", "Battle not found.");
      }

      const battle = (battleSnap.data() ?? {}) as Record<string, unknown>;
      const playerA = (battle.playerA as BattlePlayer | null) ?? null;
      const playerB = (battle.playerB as BattlePlayer | null) ?? null;
      const votesA = typeof battle.votesA === "number" ? battle.votesA : 0;
      const votesB = typeof battle.votesB === "number" ? battle.votesB : 0;

      if (voteSnap.exists) {
        const existingSide = voteSnap.get("side");
        if (existingSide !== side) {
          throw new HttpsError(
            "already-exists",
            "A vote has already been recorded for this battle."
          );
        }
        return {
          battleId,
          side,
          votesA,
          votesB,
          outcome: "already_applied" as const,
        };
      }

      const endMs = resolveEndTimeMs(battle);
      if (
        battle.status !== "live" ||
        !playerA?.userId ||
        !playerB?.userId ||
        (endMs !== null && Date.now() >= endMs)
      ) {
        throw new HttpsError(
          "failed-precondition",
          "This battle is not open for voting."
        );
      }
      if (uid === playerA.userId || uid === playerB.userId) {
        throw new HttpsError(
          "permission-denied",
          "Battle participants cannot vote in their own battle."
        );
      }

      tx.create(voteRef, {
        battleId,
        userId: uid,
        side,
        createdAt: FieldValue.serverTimestamp(),
      });
      tx.update(battleRef, {
        [side === "A" ? "votesA" : "votesB"]: FieldValue.increment(1),
      });

      return {
        battleId,
        side,
        votesA: votesA + (side === "A" ? 1 : 0),
        votesB: votesB + (side === "B" ? 1 : 0),
        outcome: "applied" as const,
      };
    });
  }
);

export const setPostLike = onCall<
  SetPostLikeRequest,
  Promise<SetPostLikeResponse>
>(
  {
    region: REGION,
    enforceAppCheck: false,
  },
  async (request) => {
    const uid = requireAuthenticatedUid(request.auth);
    const data = requireRecord(request.data);
    const postId = requireString(data.postId, "postId", { maxLength: 128 });
    const liked = requireBoolean(data.liked, "liked");
    requireClientMutationId(data.clientMutationId);

    const postRef = db.collection("posts").doc(postId);
    const likeRef = db.collection("likes").doc(`${postId}_${uid}`);

    return db.runTransaction(async (tx) => {
      const [postSnap, likeSnap] = await Promise.all([
        tx.get(postRef),
        tx.get(likeRef),
      ]);
      if (!postSnap.exists) {
        throw new HttpsError("not-found", "Post not found.");
      }

      const currentCount =
        typeof postSnap.get("likesCount") === "number"
          ? postSnap.get("likesCount")
          : 0;
      const alreadyLiked = likeSnap.exists;

      if (liked === alreadyLiked) {
        return {
          postId,
          liked,
          likesCount: currentCount,
          outcome: "already_applied" as const,
        };
      }

      if (liked) {
        tx.create(likeRef, {
          postId,
          userId: uid,
          createdAt: FieldValue.serverTimestamp(),
        });
      } else {
        tx.delete(likeRef);
      }

      const delta = liked ? 1 : -1;
      tx.update(postRef, {
        likesCount: FieldValue.increment(delta),
      });

      return {
        postId,
        liked,
        likesCount: Math.max(0, currentCount + delta),
        outcome: "applied" as const,
      };
    });
  }
);
