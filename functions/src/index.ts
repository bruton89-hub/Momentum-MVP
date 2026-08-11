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
  type DocumentReference,
  getFirestore,
  FieldValue,
  Timestamp,
} from "firebase-admin/firestore";
import { getStorage } from "firebase-admin/storage";
import {
  type CastBattleVoteRequest,
  type CastBattleVoteResponse,
  type DeletePostRequest,
  type DeletePostResponse,
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
const DELETE_BATCH_SIZE = 400;

interface BattlePlayer {
  userId?: string;
  username?: string;
  avatar?: string;
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

      // Already expired — nothing further to do.
      if (data.status === "expired") {
        return {
          battleId,
          status: "already_recorded" as const,
          winner: null,
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

      // Validate immutable participant provenance before trusting this document.
      // This protects finalization from malformed battles that may have been
      // written before the hardened creation rules were deployed.
      const playerA = (data.playerA as BattlePlayer | null) ?? null;
      const playerB = (data.playerB as BattlePlayer | null) ?? null;
      const creatorId = typeof data.creatorId === "string" ? data.creatorId : "";
      const creatorIsParticipant =
        !!creatorId &&
        (creatorId === playerA?.userId || creatorId === playerB?.userId);
      if (
        !playerA?.userId ||
        !creatorIsParticipant ||
        (!!playerB?.userId && playerA.userId === playerB.userId)
      ) {
        throw new HttpsError(
          "failed-precondition",
          "Battle participant provenance is invalid."
        );
      }

      // Stored counters are not accepted on faith. Every legitimate vote has a
      // server-created marker, so the markers must exactly reproduce both
      // counters before stats or result notifications can be written.
      const votesA = typeof data.votesA === "number" ? data.votesA : 0;
      const votesB = typeof data.votesB === "number" ? data.votesB : 0;
      const voteSnapshot = await tx.get(
        db.collection("votes").where("battleId", "==", battleId)
      );
      let recordedVotesA = 0;
      let recordedVotesB = 0;
      let malformedVote = false;
      voteSnapshot.forEach((vote) => {
        const side = vote.get("side");
        if (side === "A") recordedVotesA += 1;
        else if (side === "B") recordedVotesB += 1;
        else malformedVote = true;
      });
      if (
        malformedVote ||
        votesA !== recordedVotesA ||
        votesB !== recordedVotesB
      ) {
        throw new HttpsError(
          "failed-precondition",
          "Battle vote counters do not match authoritative vote records."
        );
      }

      // ── Unmatched challenge: nobody ever accepted ──────────────────────────
      // This is NOT a completed battle. Marking it completed put "Waiting for
      // challenger" cards in the Completed tab and inflated every athlete's
      // battle count with contests that never happened. It expires instead:
      // no winner, no stats, and hidden from every surface.
      //
      // Checked before the winner logic on purpose — with playerB null, a
      // single vote on A would otherwise crown a walkover winner.
      if (!playerA?.userId || !playerB?.userId) {
        tx.update(battleRef, {
          status: "expired",
          winner: null,
          // statsRecorded true = "finalization is done for this doc", which is
          // what makes the callable idempotent. It does NOT mean a result was
          // recorded; no wins or losses are written below.
          statsRecorded: true,
          finalizedAt: FieldValue.serverTimestamp(),
        });

        return {
          battleId,
          status: "expired" as const,
          winner: null,
        };
      }

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


      // Result notifications are part of the same Admin transaction as the
      // authoritative outcome. Clients cannot forge these writes, and a
      // transaction retry cannot duplicate them because IDs are deterministic.
      const players = [playerA, playerB].filter(
        (player): player is BattlePlayer & { userId: string } => !!player?.userId
      );
      if (players.length === 2) {
        players.forEach((player) => {
          const opponent = players.find((candidate) => candidate.userId !== player.userId);
          if (!opponent) return;
          const won = !!winnerId && winnerId === player.userId;
          tx.set(db.collection("notifications").doc(`bres_${battleId}_${player.userId}`), {
            type: won ? "battle_won" : "battle_completed",
            recipientId: player.userId,
            actorId: "system",
            subjectUsername: opponent.username ?? "An athlete",
            subjectAvatar: opponent.avatar ?? "",
            battleId,
            read: false,
            createdAt: FieldValue.serverTimestamp(),
          });
        });
      }

      return {
        battleId,
        status: "finalized" as const,
        winner: winnerId,
      };
    });

    // Avoid charging for repetitive idempotent info logs when multiple clients
    // observe the same expired battle.
    if (result.status === "finalized" || result.status === "expired") {
      logger.info("[finalizeBattle] done", {
        battleId,
        requestedBy: uid,
        outcome: result.status,
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

// ─── Server-authoritative post deletion ─────────────────────────────────────

interface OwnedStorageObject {
  bucket: string;
  path: string;
}

const POST_OWNER_FIELDS = ["userId", "authorId", "uid", "ownerId"] as const;

/**
 * Resolve post ownership with the same precedence as the client normalizer.
 * Modern posts always have userId; the aliases keep legitimate legacy posts
 * deletable without letting a lower-priority conflicting field override it.
 */
function postOwnerId(post: Record<string, unknown>): string | null {
  for (const field of POST_OWNER_FIELDS) {
    const value = post[field];
    if (typeof value === "string" && value.length > 0) return value;
  }
  return null;
}

function storageObjectFromValue(
  value: unknown,
  ownerId: string
): OwnedStorageObject | null {
  if (typeof value !== "string" || value.length === 0) return null;
  let bucket = "";
  let path = "";
  try {
    if (value.startsWith("gs://")) {
      const parts = value.slice(5).split("/");
      bucket = parts.shift() ?? "";
      path = parts.join("/");
    } else {
      const url = new URL(value);
      const firebaseObjectMarker = "/o/";
      const markerIndex = url.pathname.indexOf(firebaseObjectMarker);
      if (markerIndex >= 0) {
        const bucketMatch = url.pathname.match(/\/b\/([^/]+)\/o\//);
        bucket = bucketMatch ? decodeURIComponent(bucketMatch[1]) : "";
        path = decodeURIComponent(
          url.pathname.slice(markerIndex + firebaseObjectMarker.length)
        );
      } else if (url.hostname === "storage.googleapis.com") {
        const parts = url.pathname.split("/").filter(Boolean);
        bucket = decodeURIComponent(parts.shift() ?? "");
        path = decodeURIComponent(parts.join("/"));
      }
    }
  } catch {
    return null;
  }
  const ownerPrefix = `posts/${ownerId}/`;
  return bucket && path.startsWith(ownerPrefix) ? { bucket, path } : null;
}

async function deleteReferences(references: DocumentReference[]): Promise<void> {
  for (let index = 0; index < references.length; index += DELETE_BATCH_SIZE) {
    const batch = db.batch();
    references
      .slice(index, index + DELETE_BATCH_SIZE)
      .forEach((reference) => batch.delete(reference));
    await batch.commit();
  }
}

export const deletePost = onCall<
  DeletePostRequest,
  Promise<DeletePostResponse>
>(
  {
    region: REGION,
    enforceAppCheck: false,
    timeoutSeconds: 120,
  },
  async (request) => {
    const uid = requireAuthenticatedUid(request.auth);
    const data = requireRecord(request.data);
    const postId = requireString(data.postId, "postId", { maxLength: 128 });
    const postRef = db.collection("posts").doc(postId);
    const postSnap = await postRef.get();

    // Idempotent retries after a successful deletion issue no writes.
    if (!postSnap.exists) {
      return {
        postId,
        outcome: "already_applied",
        deleted: { comments: 0, likes: 0, notifications: 0 },
        mediaCleanupComplete: true,
        mediaRetainedForBattleHistory: false,
      };
    }

    const post = (postSnap.data() ?? {}) as Record<string, unknown>;
    if (postOwnerId(post) !== uid) {
      throw new HttpsError(
        "permission-denied",
        "You can only delete your own posts."
      );
    }

    const [playerABattles, playerBBattles] = await Promise.all([
      db.collection("battles").where("playerA.postId", "==", postId).get(),
      db.collection("battles").where("playerB.postId", "==", postId).get(),
    ]);
    const referencedBattles = new Map(
      [...playerABattles.docs, ...playerBBattles.docs].map((snapshot) => [
        snapshot.id,
        snapshot,
      ])
    );
    const activeBattle = [...referencedBattles.values()].find(
      (snapshot) => snapshot.get("status") !== "completed"
    );
    if (activeBattle) {
      throw new HttpsError(
        "failed-precondition",
        "This post is currently part of an active battle and cannot be deleted yet."
      );
    }

    const [comments, likes, notifications] = await Promise.all([
      db.collection("comments").where("postId", "==", postId).get(),
      db.collection("likes").where("postId", "==", postId).get(),
      db.collection("notifications").where("postId", "==", postId).get(),
    ]);

    // Delete dependent documents first. The post remains visible/retriable if
    // a batch fails; the post itself and profile count are committed together.
    await deleteReferences([
      ...comments.docs.map((snapshot) => snapshot.ref),
      ...likes.docs.map((snapshot) => snapshot.ref),
      ...notifications.docs.map((snapshot) => snapshot.ref),
    ]);

    await db.runTransaction(async (transaction) => {
      const latestPost = await transaction.get(postRef);
      if (!latestPost.exists) return;
      const latestPostData = (latestPost.data() ?? {}) as Record<string, unknown>;
      if (postOwnerId(latestPostData) !== uid) {
        throw new HttpsError(
          "permission-denied",
          "You can only delete your own posts."
        );
      }

      const userRef = db.collection("users").doc(uid);
      const userSnap = await transaction.get(userRef);
      transaction.delete(postRef);
      if (userSnap.exists) {
        const currentCount = userSnap.get("posts");
        if (typeof currentCount === "number" && currentCount > 0) {
          transaction.update(userRef, { posts: Math.max(0, currentCount - 1) });
        }
      }
    });

    const mediaRetainedForBattleHistory = referencedBattles.size > 0;
    let mediaCleanupComplete = true;
    if (!mediaRetainedForBattleHistory) {
      const mediaObjects = new Map(
        [post.mediaUrl, post.originalMediaUrl]
          .map((value) => storageObjectFromValue(value, uid))
          .filter((object): object is OwnedStorageObject => object !== null)
          .map((object) => [`${object.bucket}/${object.path}`, object])
      );
      const cleanupResults = await Promise.allSettled(
        [...mediaObjects.values()].map(({ bucket, path }) =>
          getStorage().bucket(bucket).file(path).delete({ ignoreNotFound: true })
        )
      );
      mediaCleanupComplete = cleanupResults.every(
        (result) => result.status === "fulfilled"
      );
      if (!mediaCleanupComplete) {
        logger.error("[deletePost] media cleanup incomplete", {
          postId,
          ownerId: uid,
          failedFileCount: cleanupResults.filter(
            (result) => result.status === "rejected"
          ).length,
        });
      }
    }

    logger.info("[deletePost] completed", {
      postId,
      ownerId: uid,
      commentsDeleted: comments.size,
      likesDeleted: likes.size,
      notificationsDeleted: notifications.size,
      mediaCleanupComplete,
      mediaRetainedForBattleHistory,
    });

    return {
      postId,
      outcome: "applied",
      deleted: {
        comments: comments.size,
        likes: likes.size,
        notifications: notifications.size,
      },
      mediaCleanupComplete,
      mediaRetainedForBattleHistory,
    };
  }
);
