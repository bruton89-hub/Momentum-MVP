import { useState, useCallback, useEffect, useRef } from "react";
import {
  collection,
  query,
  where,
  orderBy,
  limit,
  getDocs,
  setDoc,
  doc,
  getDoc,
  updateDoc,
  Timestamp,
  documentId,
} from "firebase/firestore";
import { httpsCallable } from "firebase/functions";
import { auth, db, functions } from "@/config/firebase";
import { startDevMetricTimer } from "@/utils/performance";
import type { Battle, BattlePlayer, BattleStatus, Vote } from "@/types";
import type { CreationMutation } from "@/utils/creationMutation";
import { createCreationMutation } from "@/utils/creationMutation";

// ─── Server-authoritative finalization ───────────────────────────────────────
// Closing a battle (status/winner/statsRecorded) and recording wins/losses is
// done exclusively by the `finalizeBattle` Cloud Function. Firestore rules
// forbid the client from writing those fields directly, so we never mutate
// them here — we just ask the server to do it.
type FinalizeBattleResult = {
  battleId: string;
  /** "expired" = the window closed with no opponent; no stats were recorded. */
  status: "finalized" | "already_recorded" | "expired";
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
const BATTLES_CACHE_TTL_MS = 15_000;
const FIRESTORE_IN_LIMIT = 30;

type CachedBattlePage = { battles: Battle[]; fetchedAt: number };
type BattlePageLoad = {
  battles: Battle[];
  source: "network" | "cache" | "in-flight";
  queryCount: number;
};
type VoteLoad = {
  votedMap: Map<string, "A" | "B">;
  source: "network" | "cache" | "in-flight";
  queryCount: number;
};

let cachedBattlePage: CachedBattlePage | null = null;
let battlePageInFlight: Promise<Battle[]> | null = null;
const voteCache = new Map<
  string,
  { votedMap: Map<string, "A" | "B">; fetchedAt: number }
>();
const voteLoadsInFlight = new Map<string, Promise<Map<string, "A" | "B">>>();

function isFresh(fetchedAt: number): boolean {
  return Date.now() - fetchedAt < BATTLES_CACHE_TTL_MS;
}

function peekBattleCache(): Battle[] | null {
  return cachedBattlePage && isFresh(cachedBattlePage.fetchedAt)
    ? cachedBattlePage.battles
    : null;
}

function invalidateBattleCache(): void {
  cachedBattlePage = null;
}

function invalidateVoteCache(userId: string): void {
  for (const key of voteCache.keys()) {
    if (key.startsWith(`${userId}:`)) voteCache.delete(key);
  }
}

async function loadBattlePage(forceNetwork: boolean): Promise<BattlePageLoad> {
  const cached = peekBattleCache();
  if (!forceNetwork && cached) {
    return { battles: cached, source: "cache", queryCount: 0 };
  }
  if (battlePageInFlight) {
    return {
      battles: await battlePageInFlight,
      source: "in-flight",
      queryCount: 0,
    };
  }

  battlePageInFlight = getDocs(
    query(
      collection(db, "battles"),
      orderBy("createdAt", "desc"),
      limit(BATTLES_PAGE_SIZE)
    )
  ).then((snapshot) => {
    const battles = snapshot.docs.map((d) =>
      normalizeBattle(d.id, d.data() as Record<string, unknown>)
    );
    cachedBattlePage = { battles, fetchedAt: Date.now() };
    return battles;
  });

  try {
    return {
      battles: await battlePageInFlight,
      source: "network",
      queryCount: 1,
    };
  } finally {
    battlePageInFlight = null;
  }
}

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
    status:         (["open", "live", "completed", "expired"] as const).includes(
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

// ─── Helper: did anyone actually accept this challenge? ──────────────────────
/**
 * True only when a real opponent exists. This is the line between a contest
 * and an invitation nobody answered — everything that counts (Completed lists,
 * battle totals, records) gates on it.
 */
export function isMatchedBattle(battle: Battle): boolean {
  return !!battle.playerB?.userId && !!battle.playerA?.userId;
}

// ─── Helper: derive logical status (accounts for expiry) ─────────────────────
// Always use this instead of battle.status directly when rendering UI.
// Rules:
//   "expired"   if the window closed and no opponent ever accepted
//   "completed" if stored status is completed OR a MATCHED battle has expired
//   "live"      if playerA + playerB present and not expired
//   "open"      if playerB is missing and not expired
//
// The unmatched case is checked first and deliberately overrides a stored
// status of "completed": battles finalized before the expired status existed
// are still sitting in Firestore marked completed, and this reclassifies them
// on read so they disappear from the UI without waiting for the backfill.

export function getBattleStatus(battle: Battle): BattleStatus {
  if (battle.status === "expired") return "expired";
  const expired = isBattleExpired(battle);
  if (!isMatchedBattle(battle)) {
    // Never accepted. Expired once its window closed; otherwise still open.
    return expired || battle.status === "completed" ? "expired" : "open";
  }
  if (battle.status === "completed") return "completed";
  if (expired) return "completed";
  if (battle.status === "live") return "live";
  return "open";
}

/** Battles that count: matched contests, live or completed. */
export function isCountableBattle(battle: Battle): boolean {
  const status = getBattleStatus(battle);
  return status === "live" || status === "completed";
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

export async function createBattle(
  input: CreateBattleInput,
  mutation: CreationMutation = createCreationMutation("battle")
): Promise<string> {
  const endTime = Timestamp.fromMillis(
    mutation.createdAtMs + input.durationHours * 3_600_000
  );
  try {
    const docRef = doc(db, "battles", mutation.documentId);
    const payload = {
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
      createdAt: Timestamp.fromMillis(mutation.createdAtMs),
    };
    try {
      await setDoc(docRef, payload);
    } catch (writeError) {
      const existing = await getDoc(docRef).catch(() => null);
      if (!existing?.exists() || existing.data().creatorId !== input.creatorId) {
        throw writeError;
      }
    }
    invalidateBattleCache();
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
// Why a single write: Firestore rules explicitly allow this validated live
// shape, but they forbid the creator from "accepting" their own open challenge
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

export async function createLiveBattle(
  input: CreateLiveBattleInput,
  mutation: CreationMutation = createCreationMutation("battle")
): Promise<string> {
  const endTime = Timestamp.fromMillis(
    mutation.createdAtMs + input.durationHours * 3_600_000
  );
  try {
    const docRef = doc(db, "battles", mutation.documentId);
    const payload = {
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
      createdAt: Timestamp.fromMillis(mutation.createdAtMs),
    };
    try {
      await setDoc(docRef, payload);
    } catch (writeError) {
      const existing = await getDoc(docRef).catch(() => null);
      if (!existing?.exists() || existing.data().creatorId !== input.creatorId) {
        throw writeError;
      }
    }
    invalidateBattleCache();
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
  try {
    await updateDoc(doc(db, "battles", battleId), {
      playerB,
      status: "live",
    });
    invalidateBattleCache();
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
  invalidateVoteCache(userId);
  if (cachedBattlePage) {
    cachedBattlePage = {
      ...cachedBattlePage,
      battles: cachedBattlePage.battles.map((battle) =>
        battle.id === battleId
          ? { ...battle, votesA: result.data.votesA, votesB: result.data.votesB }
          : battle
      ),
    };
  }
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
): Promise<VoteLoad> {
  if (battleIds.length === 0) {
    return { votedMap: new Map(), source: "cache", queryCount: 0 };
  }
  const cacheKey = `${userId}:${battleIds.join(",")}`;
  const cached = voteCache.get(cacheKey);
  if (cached && isFresh(cached.fetchedAt)) {
    return { votedMap: cached.votedMap, source: "cache", queryCount: 0 };
  }
  const inFlight = voteLoadsInFlight.get(cacheKey);
  if (inFlight) {
    return { votedMap: await inFlight, source: "in-flight", queryCount: 0 };
  }

  const load = (async () => {
    const voteIds = battleIds.map((battleId) => `${battleId}_${userId}`);
    const batches: string[][] = [];
    for (let index = 0; index < voteIds.length; index += FIRESTORE_IN_LIMIT) {
      batches.push(voteIds.slice(index, index + FIRESTORE_IN_LIMIT));
    }
    const snapshots = await Promise.all(
      batches.map((ids) =>
        getDocs(query(collection(db, "votes"), where(documentId(), "in", ids)))
      )
    );
    const map = new Map<string, "A" | "B">();
    snapshots.forEach((snapshot) =>
      snapshot.forEach((d) => {
        const v = d.data() as Vote;
        map.set(v.battleId, v.side);
      })
    );
    voteCache.set(cacheKey, { votedMap: map, fetchedAt: Date.now() });
    return map;
  })();
  voteLoadsInFlight.set(cacheKey, load);
  try {
    return {
      votedMap: await load,
      source: "network",
      queryCount: Math.ceil(battleIds.length / FIRESTORE_IN_LIMIT),
    };
  } catch {
    // Permission denied or collection missing — return empty map so battles load.
    return { votedMap: new Map(), source: "network", queryCount: 1 };
  } finally {
    voteLoadsInFlight.delete(cacheKey);
  }
}

// ─── Hook: battles list ───────────────────────────────────────────────────────
// `includeVotes` (default true): when false, skips the fetchVotedBattleIds
// lookup (one `in` query / up to 30 doc reads per network fetch). Pass false from
// screens that never render or cast votes (profile battle-history lists) —
// votedMap will stay empty there, which those screens already ignore.
// `enabled` (default true): when false, the initial fetch is deferred until it
// flips true — lets the Home feed mount the hook without querying Firestore
// until the user actually opens the Battles discovery tab.

export function useBattles(
  currentUserId: string | null,
  includeVotes = true,
  enabled = true
) {
  const [battles, setBattles] = useState<Battle[]>(() => peekBattleCache() ?? []);
  const [votedMap, setVotedMap] = useState<Map<string, "A" | "B">>(new Map());
  const [loading, setLoading] = useState(() => peekBattleCache() === null);
  const [refreshing, setRefreshing] = useState(false);
  const [error, setError] = useState<string | null>(null);
  // Non-blocking warning shown when server-side stat finalization fails (e.g.
  // the finalizeBattle Cloud Function is missing or permission-blocked). This
  // never prevents the battles list from rendering.
  const [finalizeWarning, setFinalizeWarning] = useState<string | null>(null);
  const votedMapRef = useRef(votedMap);
  votedMapRef.current = votedMap;
  const requestIdRef = useRef(0);

  const fetchBattles = useCallback(
    async (isRefresh = false, forceNetwork = false) => {
      const requestId = ++requestIdRef.current;
      if (isRefresh) setRefreshing(true);
      else setLoading(true);
      setError(null);
      setFinalizeWarning(null);
      const stopTimer = startDevMetricTimer("battles fetch", 700);
      let queryCount = 0;
      let returnedBattleCount = 0;
      let source: BattlePageLoad["source"] = "network";
      const trigger = isRefresh ? "background refresh" : "initial load";
      let kind = "cold fetch";

      try {
        const page = await loadBattlePage(forceNetwork);
        source = page.source;
        queryCount += page.queryCount;
        returnedBattleCount = page.battles.length;
        if (page.source === "cache") kind = "cached fetch";
        else if (page.source === "in-flight") kind = "deduplicated fetch";
        let fetched = page.battles;

        // Publish primary records immediately. Votes and finalization are
        // secondary data and must not hold the page shell or cached rows.
        if (requestId !== requestIdRef.current) return;
        setBattles(fetched);
        setLoading(false);

        const voteLoad = currentUserId && includeVotes
          ? await fetchVotedBattleIds(
              currentUserId,
              fetched.map((battle) => battle.id)
            )
          : { votedMap: new Map<string, "A" | "B">(), source: "cache" as const, queryCount: 0 };
        queryCount += voteLoad.queryCount;
        const voted = voteLoad.votedMap;

        // Finalization is a server call that requires an authenticated user.
        // Gate on the live Firebase Auth user (auth.currentUser), not just the
        // store's currentUserId: during the auth-restore window the store can
        // already hold a userId while auth.currentUser is still null and no ID
        // token exists, which makes the callable fail with
        // `functions/unauthenticated`. Skipping here prevents that call entirely
        // for signed-out viewers and during that startup gap.
        const authedUser = auth.currentUser;
        // Expired-unmatched battles are finalized too, so the server can write
        // status:"expired" once and this stops being a per-read reclassification
        // on every device forever. finalizeBattle records no stats for them.
        const finalizable = currentUserId && authedUser
          ? fetched.filter(
              (battle) =>
                (getBattleStatus(battle) === "completed" ||
                  (getBattleStatus(battle) === "expired" &&
                    battle.status !== "expired")) &&
                !battle.statsRecorded
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
          // Another mounted useBattles consumer may have reached this point
          // while this hook awaited its token. Re-check the module guard now,
          // then claim IDs synchronously before starting any callable.
          const readyToFinalize = finalizable.filter(
            (battle) => !sessionFinalizeGuard.has(battle.id)
          );
          // Mark as attempted BEFORE awaiting so a concurrent/refocus fetch
          // can't fire the same finalize call in parallel. On an
          // `unauthenticated` (or any) failure the id stays in the guard, so we
          // stop retrying it until auth changes or a manual refresh.
          readyToFinalize.forEach((battle) =>
            sessionFinalizeGuard.add(battle.id)
          );
          const results = await Promise.allSettled(
            readyToFinalize.map((battle) => finalizeBattleStatsIfNeeded(battle.id))
          );

          // Collect real failures. "failed-precondition" means the battle just
          // hasn't ended on the server clock yet — benign and transient, so it
          // is logged but never raised to the UI banner.
          const realFailures = results
            .map((result, index) => ({ result, id: readyToFinalize[index]?.id }))
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
                ? [[readyToFinalize[index].id, result.value] as const]
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
          cachedBattlePage = cachedBattlePage
            ? { ...cachedBattlePage, battles: fetched }
            : cachedBattlePage;
        }

        if (requestId !== requestIdRef.current) return;
        setBattles(fetched);
        setVotedMap(voted);
      } catch (err: unknown) {
        if (requestId !== requestIdRef.current) return;
        // Only surfaces if the battles query itself fails (not votes).
        // On permission-denied or missing collection, show empty list.
        const code = (err as { code?: string })?.code ?? "";
        if (code === "permission-denied" || code === "unavailable") {
          setBattles([]);
        } else {
          setError(err instanceof Error ? err.message : "Failed to load battles");
        }
      } finally {
        stopTimer({
          kind,
          trigger,
          source,
          queries: queryCount,
          battles: returnedBattleCount,
        });
        if (requestId === requestIdRef.current) {
          setLoading(false);
          setRefreshing(false);
        }
      }
    },
    [currentUserId, includeVotes]
  );

  useEffect(() => {
    if (!enabled) return;
    void fetchBattles();
    return () => {
      requestIdRef.current += 1;
    };
  }, [fetchBattles, enabled]);

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
  const refresh = useCallback(() => fetchBattles(true, false), [fetchBattles]);

  // Explicit user-initiated refresh (pull-to-refresh / Retry). Unlike focus
  // refresh, this clears the session finalize guard first so a previously
  // failed finalization (e.g. one that hit `unauthenticated` mid-startup) can
  // be retried on demand.
  const manualRefresh = useCallback(() => {
    clearFinalizeGuard();
    return fetchBattles(true, true);
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
