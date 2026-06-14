import { useState, useCallback, useEffect } from "react";
import {
  collection,
  query,
  where,
  orderBy,
  getDocs,
  addDoc,
  doc,
  getDoc,
  updateDoc,
  runTransaction,
  serverTimestamp,
  Timestamp,
  increment,
} from "firebase/firestore";
import { httpsCallable } from "firebase/functions";
import { db, functions } from "@/config/firebase";
import type { Battle, BattlePlayer, Vote } from "@/types";

// ─── Server-authoritative finalization ───────────────────────────────────────
// Closing a battle (status/winner/statsRecorded) and recording wins/losses is
// done exclusively by the `finalizeBattle` Cloud Function. Firestore rules
// forbid the client from writing those fields directly, so we never mutate
// them here — we just ask the server to do it.
type FinalizeBattleResult = {
  battleId: string;
  status: "finalized" | "already_recorded";
  winner: string | null;
};

const finalizeBattleCallable = httpsCallable<
  { battleId: string },
  FinalizeBattleResult
>(functions, "finalizeBattle");

// ─── Timestamp → milliseconds (handles Firestore Timestamp and plain objects) ─

function tsToMs(value: unknown): number | null {
  if (!value) return null;
  if (value instanceof Timestamp) return value.toMillis();
  const obj = value as { seconds?: number; toMillis?: () => number };
  if (typeof obj.toMillis === "function") return obj.toMillis();
  if (typeof obj.seconds === "number") return obj.seconds * 1000;
  return null;
}

// ─── Normalize a raw Firestore document into a typed Battle ──────────────────
// Firestore documents may come from a different app version with different
// field names, missing fields, or unexpected shapes. This function extracts
// every field defensively so BattleCard never receives undefined values.

function normalizeBattlePlayer(raw: unknown): BattlePlayer | null {
  if (!raw || typeof raw !== "object") return null;
  const r = raw as Record<string, unknown>;
  // Must have at least a userId to be considered a valid player
  if (!r.userId) return null;
  return {
    userId:    typeof r.userId    === "string" ? r.userId    : "",
    username:  typeof r.username  === "string" ? r.username  : "Unknown",
    avatar:    typeof r.avatar    === "string" ? r.avatar    : "",
    mediaUrl:  typeof r.mediaUrl  === "string" ? r.mediaUrl  : "",
    mediaType: r.mediaType === "video" ? "video" : "image",
    postId:    typeof r.postId    === "string" ? r.postId    : "",
  };
}

function normalizeBattle(id: string, data: Record<string, unknown>): Battle {
  return {
    id,
    playerA:        normalizeBattlePlayer(data.playerA),
    playerB:        normalizeBattlePlayer(data.playerB),
    creatorId:      typeof data.creatorId      === "string" ? data.creatorId      : "",
    votesA:         typeof data.votesA         === "number" ? data.votesA         : 0,
    votesB:         typeof data.votesB         === "number" ? data.votesB         : 0,
    status:         (["open", "live", "completed"] as const).includes(
                      data.status as Battle["status"]
                    )
                    ? (data.status as Battle["status"])
                    : "open",
    category:       typeof data.category       === "string" ? data.category       : "",
    endTime:        (data.endTime as Timestamp) ?? null,
    durationHours:  typeof data.durationHours  === "number" ? data.durationHours  : undefined,
    durationMinutes:typeof data.durationMinutes === "number" ? data.durationMinutes : undefined,
    winner:         typeof data.winner         === "string" ? data.winner         : null,
    statsRecorded:  data.statsRecorded === true,
    createdAt:      (data.createdAt as Timestamp) ?? null,
  };
}

// ─── Helper: resolve the definitive end time for any battle ──────────────────
// Priority: stored endTime → createdAt + durationHours/Minutes → createdAt + 24 h

export function getBattleEndTime(battle: Battle): number | null {
  // 1. Authoritative stored endTime
  const stored = tsToMs(battle.endTime);
  if (stored) return stored;

  // 2. Compute from createdAt + explicit duration
  const createdMs = tsToMs(battle.createdAt);
  if (!createdMs) return null;

  if (typeof battle.durationMinutes === "number") {
    return createdMs + battle.durationMinutes * 60_000;
  }
  const hours = typeof battle.durationHours === "number" ? battle.durationHours : 24;
  return createdMs + hours * 3_600_000;
}

// ─── Helper: check if battle has expired ─────────────────────────────────────

export function isBattleExpired(battle: Battle): boolean {
  const endMs = getBattleEndTime(battle);
  if (!endMs) return false;
  return Date.now() > endMs;
}

// ─── Helper: derive logical status (accounts for expiry) ─────────────────────
// Always use this instead of battle.status directly when rendering UI.
// Rules:
//   "completed" if stored status is completed OR battle has expired
//   "live"      if playerA + playerB present and not expired
//   "open"      if playerB is missing and not expired

export function getBattleStatus(battle: Battle): "open" | "live" | "completed" {
  if (battle.status === "completed") return "completed";
  if (isBattleExpired(battle)) return "completed";
  if (battle.status === "live") return "live";
  return "open";
}

// ─── Helper: human-readable time remaining / elapsed ─────────────────────────

export function getTimeRemainingLabel(battle: Battle): string {
  const endMs = getBattleEndTime(battle);
  if (!endMs) return "";
  const diff = endMs - Date.now();
  if (diff <= 0) return "Ended";
  const hours = Math.floor(diff / 3_600_000);
  const mins  = Math.floor((diff % 3_600_000) / 60_000);
  if (hours > 48) return `${Math.floor(hours / 24)}d remaining`;
  if (hours > 0)  return `${hours}h ${mins}m remaining`;
  return `${mins}m remaining`;
}

// Keep old name for backwards-compat with BattleCard import
export const timeRemaining = getTimeRemainingLabel;

// ─── Helper: client-side winner resolution ───────────────────────────────────
// Used for completed battles that don't have winner written to Firestore yet.
// Returns:
//   BattlePlayer  — the winning player object
//   "tie"         — equal votes
//   null          — battle not completed yet

export function getBattleWinner(
  battle: Battle
): BattlePlayer | "tie" | null {
  if (getBattleStatus(battle) !== "completed") return null;

  // Prefer the stored winner field (may be set by Cloud Functions)
  if (battle.winner) {
    if (battle.playerA?.userId === battle.winner) return battle.playerA;
    if (battle.playerB?.userId === battle.winner) return battle.playerB;
  }

  const votesA = battle.votesA ?? 0;
  const votesB = battle.votesB ?? 0;
  if (votesA === votesB) return "tie";
  if (votesA > votesB)  return battle.playerA ?? "tie";
  return battle.playerB ?? "tie";
}

// ─── Helper: find the next votable battle after a vote ───────────────────────
// Searches forward from currentBattleId (wraps once). Returns null when none.

export function getNextVotableBattle({
  battles,
  currentBattleId,
  currentUserId,
  votedMap,
}: {
  battles: Battle[];
  currentBattleId: string;
  currentUserId: string | null | undefined;
  votedMap: Map<string, "A" | "B">;
}): Battle | null {
  if (!currentUserId || battles.length === 0) return null;

  function isVotable(b: Battle): boolean {
    if (getBattleStatus(b) !== "live") return false;
    if (!b.playerA || !b.playerB) return false;
    if (b.playerA.userId === currentUserId) return false;
    if (b.playerB.userId === currentUserId) return false;
    if (votedMap.has(b.id)) return false;
    return true;
  }

  const currentIndex = battles.findIndex((b) => b.id === currentBattleId);
  const startIndex = currentIndex >= 0 ? currentIndex + 1 : 0;
  const tail = battles.slice(startIndex);
  const head = battles.slice(0, Math.max(0, currentIndex));
  return [...tail, ...head].find(isVotable) ?? null;
}

// ─── Create an open challenge (playerB = null) ────────────────────────────────

export interface CreateBattleInput {
  creatorId: string;
  playerA: BattlePlayer;
  category: string;
  durationHours: number;
}

export async function createBattle(input: CreateBattleInput): Promise<string> {
  const endTime = Timestamp.fromMillis(
    Date.now() + input.durationHours * 3_600_000
  );
  console.log("[createBattle] creating —", {
    creatorId: input.creatorId,
    playerA: { userId: input.playerA.userId, username: input.playerA.username,
               mediaType: input.playerA.mediaType, hasMedia: !!input.playerA.mediaUrl },
    category: input.category,
    durationHours: input.durationHours,
  });
  try {
    const docRef = await addDoc(collection(db, "battles"), {
      creatorId: input.creatorId,
      playerA: input.playerA,
      playerB: null,
      votesA: 0,
      votesB: 0,
      status: "open",
      category: input.category,
      durationHours: input.durationHours,
      endTime,
      winner: null,
      statsRecorded: false,
      createdAt: serverTimestamp(),
    });
    console.log("[createBattle] success — battleId:", docRef.id);
    return docRef.id;
  } catch (err) {
    console.error("[createBattle] error:", err);
    throw err;
  }
}

// ─── Finalize an ended battle and record profile stats once ──────────────────
// Delegates to the `finalizeBattle` Cloud Function. The server validates that
// the battle has actually ended, computes the winner from the authoritative
// vote counts, closes the battle, and increments wins/losses — all with Admin
// privileges. The client never writes these protected fields itself, so
// Firestore rules can (and do) reject any direct client attempt.

export async function finalizeBattleStatsIfNeeded(battleId: string): Promise<void> {
  try {
    await finalizeBattleCallable({ battleId });
  } catch (err) {
    // Surface the Firebase error code/message clearly so deploy/permission
    // problems are obvious in the logs. Common codes:
    //   not-found / internal  → function not deployed (or wrong project/region)
    //   permission-denied     → caller blocked by rules / App Check
    //   unauthenticated       → no signed-in user
    //   failed-precondition   → battle hasn't actually ended yet (benign)
    const code = (err as { code?: string })?.code ?? "unknown";
    const message = (err as { message?: string })?.message ?? String(err);
    console.error(
      `[finalizeBattle] callable failed — battleId=${battleId} code=${code} message=${message}`
    );
    // Re-throw a normalized error so callers can surface a UI warning without
    // re-parsing the raw FirebaseError shape.
    throw Object.assign(new Error(message), { code, battleId });
  }
}

// ─── Accept an open challenge ─────────────────────────────────────────────────

export async function acceptChallenge(
  battleId: string,
  playerB: BattlePlayer
): Promise<void> {
  console.log("[acceptChallenge] accepting —", {
    battleId,
    playerB: { userId: playerB.userId, username: playerB.username,
               mediaType: playerB.mediaType, hasMedia: !!playerB.mediaUrl },
  });
  try {
    await updateDoc(doc(db, "battles", battleId), {
      playerB,
      status: "live",
    });
    console.log("[acceptChallenge] success — battleId:", battleId);
  } catch (err) {
    console.error("[acceptChallenge] error — battleId:", battleId, err);
    throw err;
  }
}

// ─── Submit a vote ────────────────────────────────────────────────────────────

export async function submitVote(
  battleId: string,
  userId: string,
  side: "A" | "B"
): Promise<void> {
  const voteRef = doc(db, "votes", `${battleId}_${userId}`);
  const battleRef = doc(db, "battles", battleId);

  await runTransaction(db, async (tx) => {
    const existing = await tx.get(voteRef);
    if (existing.exists()) throw new Error("Already voted");

    tx.set(voteRef, {
      battleId,
      userId,
      side,
      createdAt: serverTimestamp(),
    });

    tx.update(battleRef, {
      [side === "A" ? "votesA" : "votesB"]: increment(1),
    });
  });
}

// ─── Check if user has voted ──────────────────────────────────────────────────

export async function getUserVote(
  battleId: string,
  userId: string
): Promise<"A" | "B" | null> {
  const snap = await getDoc(doc(db, "votes", `${battleId}_${userId}`));
  if (!snap.exists()) return null;
  return (snap.data() as Vote).side;
}

// ─── Fetch voted battle IDs for a user ───────────────────────────────────────
// Wrapped in try/catch: the `votes` collection may not exist yet or may be
// restricted by project-level Firestore rules. A failure here must never
// block the battles list from rendering.

async function fetchVotedBattleIds(userId: string): Promise<Map<string, "A" | "B">> {
  try {
    const snap = await getDocs(
      query(collection(db, "votes"), where("userId", "==", userId))
    );
    const map = new Map<string, "A" | "B">();
    snap.forEach((d) => {
      const v = d.data() as Vote;
      map.set(v.battleId, v.side);
    });
    return map;
  } catch {
    // Permission denied or collection missing — return empty map so battles load.
    return new Map<string, "A" | "B">();
  }
}

// ─── Hook: battles list ───────────────────────────────────────────────────────

export function useBattles(currentUserId: string | null) {
  const [battles, setBattles] = useState<Battle[]>([]);
  const [votedMap, setVotedMap] = useState<Map<string, "A" | "B">>(new Map());
  const [loading, setLoading] = useState(true);
  const [refreshing, setRefreshing] = useState(false);
  const [error, setError] = useState<string | null>(null);
  // Non-blocking warning shown when server-side stat finalization fails (e.g.
  // the finalizeBattle Cloud Function is missing or permission-blocked). This
  // never prevents the battles list from rendering.
  const [finalizeWarning, setFinalizeWarning] = useState<string | null>(null);

  const fetchBattles = useCallback(
    async (isRefresh = false) => {
      if (isRefresh) setRefreshing(true);
      else setLoading(true);
      setError(null);
      setFinalizeWarning(null);

      try {
        // fetchVotedBattleIds already handles its own errors and returns empty Map.
        // Run both fetches concurrently; votes failure never blocks the list.
        const [battlesSnap, voted] = await Promise.all([
          getDocs(
            query(collection(db, "battles"), orderBy("createdAt", "desc"))
          ),
          currentUserId
            ? fetchVotedBattleIds(currentUserId)
            : Promise.resolve(new Map<string, "A" | "B">()),
        ]);

        let fetched: Battle[] = battlesSnap.docs.map((d) =>
          normalizeBattle(d.id, d.data() as Record<string, unknown>)
        );

        // Finalization is a server call that requires an authenticated user.
        // Skip it entirely for signed-out viewers (the server would reject it).
        const finalizable = currentUserId
          ? fetched.filter(
              (battle) =>
                getBattleStatus(battle) === "completed" && !battle.statsRecorded
            )
          : [];

        if (finalizable.length > 0) {
          console.log("[battleStats] finalizing ended battles:", finalizable.map((b) => b.id));
          const results = await Promise.allSettled(
            finalizable.map((battle) => finalizeBattleStatsIfNeeded(battle.id))
          );

          // Collect real failures. "failed-precondition" means the battle just
          // hasn't ended on the server clock yet — benign and transient, so it
          // is logged but never raised to the UI banner.
          const realFailures = results
            .map((result, index) => ({ result, id: finalizable[index]?.id }))
            .filter(
              (r): r is { result: PromiseRejectedResult; id: string } =>
                r.result.status === "rejected" &&
                (r.result.reason as { code?: string })?.code !== "failed-precondition"
            );

          results.forEach((result, index) => {
            if (result.status === "rejected") {
              const reason = result.reason as { code?: string; message?: string };
              console.error(
                "[battleStats] finalize failed:",
                finalizable[index]?.id,
                reason?.code ?? "unknown",
                reason?.message ?? reason
              );
            }
          });

          if (realFailures.length > 0) {
            const reason = realFailures[0].result.reason as { code?: string; message?: string };
            const code = reason?.code ?? "error";
            setFinalizeWarning(
              `Stats sync failed (${code}). Wins/losses may be out of date — ` +
                `check that the finalizeBattle Cloud Function is deployed to this project.`
            );
          }

          const refreshedSnap = await getDocs(
            query(collection(db, "battles"), orderBy("createdAt", "desc"))
          );
          fetched = refreshedSnap.docs.map((d) =>
            normalizeBattle(d.id, d.data() as Record<string, unknown>)
          );
        }

        setBattles(fetched);
        setVotedMap(voted);
      } catch (err: unknown) {
        // Only surfaces if the battles query itself fails (not votes).
        // On permission-denied or missing collection, show empty list.
        const code = (err as { code?: string })?.code ?? "";
        if (code === "permission-denied" || code === "unavailable") {
          setBattles([]);
        } else {
          setError(err instanceof Error ? err.message : "Failed to load battles");
        }
      } finally {
        setLoading(false);
        setRefreshing(false);
      }
    },
    [currentUserId]
  );

  useEffect(() => {
    fetchBattles();
  }, [fetchBattles]);

  // Optimistic vote — returns true on Firestore success, false if already voted or error
  const handleVote = useCallback(
    async (battleId: string, side: "A" | "B"): Promise<boolean> => {
      if (!currentUserId) return false;
      if (votedMap.has(battleId)) {
        console.warn("[voteBattle] already voted — battleId:", battleId);
        return false;
      }

      console.log("[voteBattle] voting — battleId:", battleId, "side:", side, "userId:", currentUserId);

      // Optimistic update
      const nextVoted = new Map(votedMap);
      nextVoted.set(battleId, side);
      setVotedMap(nextVoted);
      setBattles((prev) =>
        prev.map((b) =>
          b.id === battleId
            ? {
                ...b,
                votesA: b.votesA + (side === "A" ? 1 : 0),
                votesB: b.votesB + (side === "B" ? 1 : 0),
              }
            : b
        )
      );

      try {
        await submitVote(battleId, currentUserId, side);
        console.log("[voteBattle] success — battleId:", battleId, "side:", side);
        return true;
      } catch (err) {
        console.error("[voteBattle] error — reverting — battleId:", battleId, err);
        // Revert
        setVotedMap(votedMap);
        setBattles((prev) =>
          prev.map((b) =>
            b.id === battleId
              ? {
                  ...b,
                  votesA: b.votesA - (side === "A" ? 1 : 0),
                  votesB: b.votesB - (side === "B" ? 1 : 0),
                }
              : b
          )
        );
        return false;
      }
    },
    [currentUserId, votedMap]
  );

  // Stable refresh reference — only recreates when fetchBattles changes (i.e.
  // when currentUserId changes). Prevents useFocusEffect / RefreshControl from
  // getting a new function reference each render and triggering a loop.
  const refresh = useCallback(() => fetchBattles(true), [fetchBattles]);

  return {
    battles,
    votedMap,
    loading,
    refreshing,
    error,
    finalizeWarning,
    refresh,
    handleVote,
  };
}
