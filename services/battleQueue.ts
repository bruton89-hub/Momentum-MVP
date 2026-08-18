/**
 * Battle status + voting-queue logic — PURE.
 *
 * This module deliberately imports nothing from `firebase/*`. It was extracted
 * from `hooks/useBattles.ts` so the rules that decide
 *
 *   • which battles are "live",
 *   • which live battles a given viewer may vote on, and
 *   • which battle the viewer advances to after voting or skipping,
 *
 * can be imported and executed directly by tests. Previously the only coverage
 * for this logic was `test/battleSections.test.js`, which kept a hand-copied
 * duplicate of these functions — so the tests could pass while the shipped
 * implementation drifted.
 *
 * `hooks/useBattles.ts` re-exports everything here, so every existing
 * `@/hooks/useBattles` import keeps working unchanged.
 */

import type { Battle, BattlePlayer, BattleStatus } from "@/types";

const DEFAULT_DURATION_HOURS = 24;

/** Firestore Timestamp | {seconds} | null → epoch ms | null. */
function tsToMs(value: unknown): number | null {
  if (!value) return null;
  const candidate = value as { toMillis?: () => number; seconds?: number };
  if (typeof candidate.toMillis === "function") return candidate.toMillis();
  if (typeof candidate.seconds === "number") return candidate.seconds * 1000;
  return null;
}

// ─── Status ──────────────────────────────────────────────────────────────────
// Priority: stored endTime → createdAt + durationHours/Minutes → createdAt + 24h

export function getBattleEndTime(battle: Battle): number | null {
  const stored = tsToMs(battle.endTime);
  if (stored) return stored;

  const createdMs = tsToMs(battle.createdAt);
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

export function isBattleExpired(battle: Battle): boolean {
  const endMs = getBattleEndTime(battle);
  if (!endMs) return false;
  return Date.now() > endMs;
}

/**
 * True only when a real opponent exists. This is the line between a contest
 * and an invitation nobody answered — everything that counts (Completed lists,
 * battle totals, records) gates on it.
 */
export function isMatchedBattle(battle: Battle): boolean {
  return !!battle.playerB?.userId && !!battle.playerA?.userId;
}

/**
 * Logical status, accounting for expiry. Always use this instead of
 * `battle.status` when rendering UI.
 *
 * The unmatched case is checked first and deliberately overrides a stored
 * status of "completed": battles finalized before the "expired" status existed
 * are still in Firestore marked completed, and this reclassifies them on read.
 */
export function getBattleStatus(battle: Battle): BattleStatus {
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

/** Battles that count: matched contests, live or completed. */
export function isCountableBattle(battle: Battle): boolean {
  const status = getBattleStatus(battle);
  return status === "live" || status === "completed";
}

export function getTimeRemainingLabel(battle: Battle): string {
  const endMs = getBattleEndTime(battle);
  if (!endMs) return "";
  const diff = endMs - Date.now();
  if (diff <= 0) return "Ended";
  const hours = Math.floor(diff / 3_600_000);
  const mins = Math.floor((diff % 3_600_000) / 60_000);
  if (hours > 48) return `${Math.floor(hours / 24)}d remaining`;
  if (hours > 0) return `${hours}h ${mins}m remaining`;
  return `${mins}m remaining`;
}

export function getBattleWinner(battle: Battle): BattlePlayer | "tie" | null {
  if (getBattleStatus(battle) !== "completed") return null;

  if (battle.winner) {
    if (battle.playerA?.userId === battle.winner) return battle.playerA;
    if (battle.playerB?.userId === battle.winner) return battle.playerB;
  }

  const votesA = battle.votesA ?? 0;
  const votesB = battle.votesB ?? 0;
  if (votesA === votesB) return "tie";
  if (votesA > votesB) return battle.playerA ?? "tie";
  return battle.playerB ?? "tie";
}

// ─── Voting eligibility ──────────────────────────────────────────────────────

export interface VoterContext {
  currentUserId: string | null | undefined;
  /** Battle ids this viewer has already voted on. */
  votedIds: ReadonlySet<string> | ReadonlyMap<string, "A" | "B">;
  /** Battle ids skipped in this session. Skipping never writes to Firestore. */
  skippedIds?: ReadonlySet<string>;
}

function hasId(
  collection: ReadonlySet<string> | ReadonlyMap<string, "A" | "B"> | undefined,
  id: string
): boolean {
  return collection ? collection.has(id) : false;
}

/**
 * THE single source of truth for "can this viewer vote on this battle right
 * now". Every surface — the queue, the Live count, the featured hero, the vote
 * buttons — must derive from this one predicate, or the UI will disagree with
 * itself (which is exactly the defect this module was created to fix).
 *
 * `includeSkipped: true` ignores the session skip list, which is what the
 * *count* wants: a skipped battle is still genuinely votable, it has just been
 * deferred for this session.
 */
export function isVotableBattle(
  battle: Battle,
  context: VoterContext,
  { includeSkipped = false }: { includeSkipped?: boolean } = {}
): boolean {
  const { currentUserId, votedIds, skippedIds } = context;
  if (!currentUserId) return false;
  if (getBattleStatus(battle) !== "live") return false;
  // An unmatched challenge has no opponent to vote between.
  if (!battle.playerA?.userId || !battle.playerB?.userId) return false;
  // Participants may never vote in their own battle (server enforces this too).
  if (battle.playerA.userId === currentUserId) return false;
  if (battle.playerB.userId === currentUserId) return false;
  if (battle.creatorId === currentUserId) return false;
  if (hasId(votedIds, battle.id)) return false;
  if (!includeSkipped && hasId(skippedIds, battle.id)) return false;
  return true;
}

/**
 * Every battle this viewer could still vote on.
 *
 * `includeSkipped` defaults to TRUE so callers computing a *count* report what
 * genuinely remains, independent of this session's skip list.
 */
export function listVotableBattles(
  battles: readonly Battle[],
  context: VoterContext,
  { includeSkipped = true }: { includeSkipped?: boolean } = {}
): Battle[] {
  return battles.filter((battle) =>
    isVotableBattle(battle, context, { includeSkipped })
  );
}

/** How many battles remain votable, ignoring this session's skips. */
export function countVotableBattles(
  battles: readonly Battle[],
  context: VoterContext
): number {
  return listVotableBattles(battles, context, { includeSkipped: true }).length;
}

/**
 * The next battle to show after voting on / skipping `currentBattleId`.
 *
 * Traversal starts after the current battle and wraps once, so the viewer moves
 * forward through the queue rather than restarting at the top. The current
 * battle is never returned.
 *
 * A battle is "handled" for this session once the viewer votes on it OR skips
 * it, and handled battles are not offered again. Exhaustion therefore means
 * "you have seen every live battle", not "there were none" — the caller is
 * responsible for saying so and for clearing the session skip list so a
 * refresh offers the deferred battles again.
 *
 * Deliberately NOT implemented: re-offering a skipped battle once the
 * un-skipped ones run out. It sounds friendlier, but it makes skipping
 * non-terminating — the viewer could skip forever and never reach a settled
 * state — which is the behaviour this function exists to fix.
 */
export function getNextVotableBattle({
  battles,
  currentBattleId,
  currentUserId,
  votedMap,
  skippedIds,
}: {
  battles: readonly Battle[];
  currentBattleId: string;
  currentUserId: string | null | undefined;
  votedMap: ReadonlySet<string> | ReadonlyMap<string, "A" | "B">;
  skippedIds?: ReadonlySet<string>;
}): Battle | null {
  if (!currentUserId || battles.length === 0) return null;

  const context: VoterContext = {
    currentUserId,
    votedIds: votedMap,
    skippedIds,
  };

  // Rotate the list so traversal begins immediately after the current battle
  // and wraps exactly once. When the current battle is absent from the list
  // (stale reference after a refresh) we still exclude it explicitly, so a
  // skip can never return the battle the viewer just dismissed.
  const currentIndex = battles.findIndex(
    (battle) => battle.id === currentBattleId
  );
  const ordered =
    currentIndex >= 0
      ? [
          ...battles.slice(currentIndex + 1),
          ...battles.slice(0, currentIndex),
        ]
      : battles.filter((battle) => battle.id !== currentBattleId);

  return ordered.find((battle) => isVotableBattle(battle, context)) ?? null;
}
