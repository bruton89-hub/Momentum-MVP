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

    logger.info("[finalizeBattle] done", {
      battleId,
      requestedBy: uid,
      outcome: result.status,
      winner: result.winner,
    });

    return result;
  }
);
