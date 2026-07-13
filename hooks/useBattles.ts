import { useState, useCallback, useEffect, useRef } from "react";
import {
  collection,
  query,
  where,
  orderBy,
  limit,
  getDocs,
  addDoc,
  doc,
  getDoc,
  updateDoc,
  serverTimestamp,
  Timestamp,
  documentId,
} from "firebase/firestore";
import { httpsCallable } from "firebase/functions";
import { auth, db, functions } from "@/config/firebase";
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

type CastBattleVoteResult = {
  battleId: string;
  side: "A" | "B";
  votesA: number;
  votesB: number;
  outcome: "applied" | "already_applied";
};

const BATTLES_PAGE_SIZE = 30;

const finalizeBattleCallable = httpsCallable<
  { battleId: string },
  FinalizeBattleResult
>(functions, "finalizeBattle");
const castBattleVoteCallable = httpsCallable<
  { battleId: string; side: "A" | "B"; clientMutationId: string },
  CastBattleVoteResult
>(functions, "castBattleVote");

// ─── Session-scoped finalize guard ───────────────────────────────────────────
// Module-level (not per-hook-instance) so it survives hook remounts, tab
// re-focus, and re-renders. Once a battleId has been sent to finalizeBattle in
// this app session it is never sent again — preventing the callable from being
// hammered on every focus/render. It is cleared only when the signed-in user
// changes (sign-in/out/switch) or on an explicit manual refresh, so a genuine
// retry is still possible. See `clearFinalizeGuard`.
const sessionFinalizeGuard = new Set<string>();

function clearFinalizeGuard(): void {
  sessionFinalizeGuard.clear();
}

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
  __DEV__ && console.log("[createBattle] creating —", {
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
    __DEV__ && console.log("[createBattle] success — battleId:", docRef.id);
    return docRef.id;
  } catch (err) {
    console.error("[createBattle] error:", err);
    throw err;
  }
}

// ─── Create a LIVE battle directly (direct challenge) ────────────────────────
// Used by the "Challenge" flow where the challenger pits their own post against
// a target post. Unlike createBattle (open challenge, accepted later by a
// DIFFERENT user), this writes both players and status:"live" in a SINGLE
// document create.
//
// Why a single write: Firestore rules allow the creator to create a battle in
// any status (the `allow create` rule only checks creatorId == auth.uid), but
// they FORBID the creator from "accepting" their own open challenge
// (`isAcceptingChallenge` requires creatorId != auth.uid). The old
// create-open-then-self-accept sequence therefore always failed at the accept
// step with permission-denied and left an orphaned open battle behind. Creating
// the live battle in one write conforms to the existing rules and leaves no
// orphan.
export interface CreateLiveBattleInput {
  creatorId: string;
  playerA: BattlePlayer;
  playerB: BattlePlayer;
  category: string;
  durationHours: number;
}

export async function createLiveBattle(input: CreateLiveBattleInput): Promise<string> {
  const endTime = Timestamp.fromMillis(
    Date.now() + input.durationHours * 3_600_000
  );
  __DEV__ && console.log("[createLiveBattle] creating —", {
    creatorId: input.creatorId,
    playerA: { userId: input.playerA.userId, username: input.playerA.username },
    playerB: { userId: input.playerB.userId, username: input.playerB.username },
    category: input.category,
    durationHours: input.durationHours,
  });
  try {
    const docRef = await addDoc(collection(db, "battles"), {
      creatorId: input.creatorId,
      playerA: input.playerA,
      playerB: input.playerB,
      votesA: 0,
      votesB: 0,
      status: "live",
      category: input.category,
      durationHours: input.durationHours,
      endTime,
      winner: null,
      statsRecorded: false,
      createdAt: serverTimestamp(),
    });
    __DEV__ && console.log("[createLiveBattle] success — battleId:", docRef.id);
    return docRef.id;
  } catch (err) {
    console.error("[createLiveBattle] error:", err);
    throw err;
  }
}

// ─── Finalize an ended battle and record profile stats once ──────────────────
// Delegates to the `finalizeBattle` Cloud Function. The server validates that
// the battle has actually ended, computes the winner from the authoritative
// vote counts, closes the battle, and increments wins/losses — all with Admin
// privileges. The client never writes these protected fields itself, so
// Firestore rules can (and do) reject any direct client attempt.

export async function finalizeBattleStatsIfNeeded(
  battleId: string
): Promise<FinalizeBattleResult> {
  try {
    const result = await finalizeBattleCallable({ battleId });
    return result.data;
  } catch (err) {
    // Surface the Firebase error code/message clearly so deploy/permission
    // problems are obvious in the logs. Common codes:
    //   not-found / internal  → function not deployed (or wrong project/region)
    //   permission-denied     → caller blocked by rules / App Check
    //   unauthenticated       → no signed-in user
    //   failed-precondition   → battle hasn't actually ended yet (benign)
    const code = (err as { code?: string })?.code ?? "unknown";
    const message = (err as { message?: string })?.message ?? String(err);
    // This failure is ALWAYS handled by the caller (Promise.allSettled + the
    // non-blocking `finalizeWarning` banner), so log it as a warning rather than
    // an error. console.error triggers React Native's full-screen red LogBox
    // overlay in dev, which spams the screen once per completed battle when the
    // deployed callable rejects (e.g. a v2/Cloud Run invoker-permission or
    // App Check misconfiguration returns a platform-level 401 → `unauthenticated`
    // BEFORE the function body runs — note the generic "unauthenticated" message
    // instead of the function's own "You must be signed in."). Downgrading keeps
    // the diagnostic in the logs without the disruptive overlay.
    console.warn(
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
  __DEV__ && console.log("[acceptChallenge] accepting —", {
    battleId,
    playerB: { userId: playerB.userId, username: playerB.username,
               mediaType: playerB.mediaType, hasMedia: !!playerB.mediaUrl },
  });
  try {
    await updateDoc(doc(db, "battles", battleId), {
      playerB,
      status: "live",
    });
    __DEV__ && console.log("[acceptChallenge] success — battleId:", battleId);
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
): Promise<CastBattleVoteResult> {
  const result = await castBattleVoteCallable({
    battleId,
    side,
    clientMutationId: `${battleId}:${userId}`,
  });
  return result.data;
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

async function fetchVotedBattleIds(
  userId: string,
  battleIds: string[]
): Promise<Map<string, "A" | "B">> {
  if (battleIds.length === 0) return new Map();
  try {
    const voteIds = battleIds.map((battleId) => `${battleId}_${userId}`);
    const batches: string[][] = [];
    for (let index = 0; index < voteIds.length; index += 10) {
      batches.push(voteIds.slice(index, index + 10));
    }
    const snapshots = await Promise.all(
      batches.map((ids) =>
        getDocs(
          query(collection(db, "votes"), where(documentId(), "in", ids))
        )
      )
    );
    const map = new Map<string, "A" | "B">();
    snapshots.forEach((snapshot) =>
      snapshot.forEach((d) => {
        const v = d.data() as Vote;
        map.set(v.battleId, v.side);
      })
    );
    return map;
  } catch {
    // Permission denied or collection missing — return empty map so battles load.
    return new Map<string, "A" | "B">();
  }
}

// ─── Hook: battles list ───────────────────────────────────────────────────────
// `includeVotes` (default true): when false, skips the fetchVotedBattleIds
// lookups (up to 3 `in` queries / 30 doc reads per fetch). Pass false from
// screens that never render or cast votes (profile battle-history lists) —
// votedMap will stay empty there, which those screens already ignore.

export function useBattles(currentUserId: string | null, includeVotes = true) {
  const [battles, setBattles] = useState<Battle[]>([]);
  const [votedMap, setVotedMap] = useState<Map<string, "A" | "B">>(new Map());
  const [loading, setLoading] = useState(true);
  const [refreshing, setRefreshing] = useState(false);
  const [error, setError] = useState<string | null>(null);
  // Non-blocking warning shown when server-side stat finalization fails (e.g.
  // the finalizeBattle Cloud Function is missing or permission-blocked). This
  // never prevents the battles list from rendering.
  const [finalizeWarning, setFinalizeWarning] = useState<string | null>(null);
  const votedMapRef = useRef(votedMap);
  votedMapRef.current = votedMap;

  const fetchBattles = useCallback(
    async (isRefresh = false) => {
      if (isRefresh) setRefreshing(true);
      else setLoading(true);
      setError(null);
      setFinalizeWarning(null);

      try {
        const battlesSnap = await getDocs(
          query(
            collection(db, "battles"),
            orderBy("createdAt", "desc"),
            limit(BATTLES_PAGE_SIZE)
          )
        );

        let fetched: Battle[] = battlesSnap.docs.map((d) =>
          normalizeBattle(d.id, d.data() as Record<string, unknown>)
        );
        const voted = currentUserId && includeVotes
          ? await fetchVotedBattleIds(
              currentUserId,
              fetched.map((battle) => battle.id)
            )
          : new Map<string, "A" | "B">();

        // Finalization is a server call that requires an authenticated user.
        // Gate on the live Firebase Auth user (auth.currentUser), not just the
        // store's currentUserId: during the auth-restore window the store can
        // already hold a userId while auth.currentUser is still null and no ID
        // token exists, which makes the callable fail with
        // `functions/unauthenticated`. Skipping here prevents that call entirely
        // for signed-out viewers and during that startup gap.
        const authedUser = auth.currentUser;
        const finalizable = currentUserId && authedUser
          ? fetched.filter(
              (battle) =>
                getBattleStatus(battle) === "completed" && !battle.statsRecorded
                // Session guard: never re-attempt a battle already tried this
                // session (survives remounts/focus), until auth changes or a
                // manual refresh clears the guard.
                && !sessionFinalizeGuard.has(battle.id)
            )
          : [];

        // Ensure a valid ID token is actually available before invoking the
        // callable. On cold start the user is restored from AsyncStorage
        // persistence (auth.currentUser becomes non-null) BEFORE an ID token has
        // been fetched, so the callable would reach the server with no auth
        // context and be rejected as `functions/unauthenticated`. Awaiting
        // getIdToken() forces the token to be fetched/cached so the callable can
        // attach it. If a token can't be obtained we skip finalize this pass
        // WITHOUT marking the battles attempted, so the next refresh / auth
        // change retries cleanly once the token is ready (no error spam).
        let finalizeTokenReady = false;
        if (finalizable.length > 0 && authedUser) {
          try {
            finalizeTokenReady = !!(await authedUser.getIdToken());
          } catch {
            finalizeTokenReady = false;
          }
        }

        if (finalizable.length > 0 && finalizeTokenReady) {
          // Mark as attempted BEFORE awaiting so a concurrent/refocus fetch
          // can't fire the same finalize call in parallel. On an
          // `unauthenticated` (or any) failure the id stays in the guard, so we
          // stop retrying it until auth changes or a manual refresh.
          finalizable.forEach((battle) =>
            sessionFinalizeGuard.add(battle.id)
          );
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

          if (realFailures.length > 0) {
            const reason = realFailures[0].result.reason as { code?: string; message?: string };
            const code = reason?.code ?? "error";
            setFinalizeWarning(
              `Stats sync failed (${code}). Wins/losses may be out of date — ` +
                `check that the finalizeBattle Cloud Function is deployed to this project.`
            );
          }

          const finalizedById = new Map(
            results.flatMap((result, index) =>
              result.status === "fulfilled"
                ? [[finalizable[index].id, result.value] as const]
                : []
            )
          );
          fetched = fetched.map((battle) => {
            const result = finalizedById.get(battle.id);
            return result
              ? {
                  ...battle,
                  status: "completed",
                  statsRecorded: true,
                  winner: result.winner,
                }
              : battle;
          });
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
    [currentUserId, includeVotes]
  );

  useEffect(() => {
    fetchBattles();
  }, [fetchBattles]);

  // When the signed-in user changes (sign-in / sign-out / account switch) reset
  // the session finalize guard so battles can be legitimately re-attempted under
  // the new auth context. This is the "until auth changes" recovery path for a
  // battle that previously failed with `unauthenticated`.
  useEffect(() => {
    clearFinalizeGuard();
  }, [currentUserId]);

  // Optimistic vote — returns true on Firestore success, false if already voted or error
  const handleVote = useCallback(
    async (battleId: string, side: "A" | "B"): Promise<boolean> => {
      if (!currentUserId) return false;
      if (votedMapRef.current.has(battleId)) {
        console.warn("[voteBattle] already voted — battleId:", battleId);
        return false;
      }

      __DEV__ && console.log("[voteBattle] voting — battleId:", battleId, "side:", side, "userId:", currentUserId);

      // Optimistic update
      const nextVoted = new Map(votedMapRef.current);
      nextVoted.set(battleId, side);
      votedMapRef.current = nextVoted;
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
        const result = await submitVote(battleId, currentUserId, side);
        setBattles((prev) =>
          prev.map((battle) =>
            battle.id === battleId
              ? {
                  ...battle,
                  votesA: result.votesA,
                  votesB: result.votesB,
                }
              : battle
          )
        );
        __DEV__ && console.log("[voteBattle] success — battleId:", battleId, "side:", side);
        return true;
      } catch (err) {
        console.error("[voteBattle] error — reverting — battleId:", battleId, err);
        // Revert
        setVotedMap((current) => {
          const reverted = new Map(current);
          reverted.delete(battleId);
          votedMapRef.current = reverted;
          return reverted;
        });
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
    [currentUserId]
  );

  // Stable refresh reference — only recreates when fetchBattles changes (i.e.
  // when currentUserId changes). Prevents useFocusEffect / RefreshControl from
  // getting a new function reference each render and triggering a loop.
  // NOTE: this is what `useFocusEffect` uses, so it must NOT clear the finalize
  // guard — otherwise every tab focus would re-arm the finalize calls.
  const refresh = useCallback(() => fetchBattles(true), [fetchBattles]);

  // Explicit user-initiated refresh (pull-to-refresh / Retry). Unlike focus
  // refresh, this clears the session finalize guard first so a previously
  // failed finalization (e.g. one that hit `unauthenticated` mid-startup) can
  // be retried on demand.
  const manualRefresh = useCallback(() => {
    clearFinalizeGuard();
    return fetchBattles(true);
  }, [fetchBattles]);

  return {
    battles,
    votedMap,
    loading,
    refreshing,
    error,
    finalizeWarning,
    refresh,
    manualRefresh,
    handleVote,
  };
}
