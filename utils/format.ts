// ─── Shared formatting helpers ────────────────────────────────────────────────
// Single source of truth for handles, relative timestamps, and battle dates.
// Previously duplicated across PostCard, BattleCard, BattleDetailModal,
// battles.tsx, and both profile screens.

import type { Post, Battle } from "@/types";

/** "Jordan Smith" → "@jordan.smith" — canonical Momentum handle format. */
export function toHandle(username: string | null | undefined): string {
  return "@" + (username ?? "player").trim().toLowerCase().replace(/\s+/g, ".");
}

type FirestoreTimestampLike =
  | { toDate: () => Date }
  | { seconds: number }
  | null
  | undefined;

function toDate(ts: FirestoreTimestampLike): Date | null {
  if (!ts) return null;
  if (typeof (ts as { toDate?: () => Date }).toDate === "function") {
    return (ts as { toDate: () => Date }).toDate();
  }
  const seconds = (ts as { seconds?: number }).seconds;
  return typeof seconds === "number" ? new Date(seconds * 1000) : null;
}

/** Compact relative time: "just now", "5m", "3h", "2d". */
export function formatRelativeTime(ts: Post["createdAt"]): string {
  const date = toDate(ts as FirestoreTimestampLike);
  if (!date) return "";
  const mins = Math.floor((Date.now() - date.getTime()) / 60_000);
  if (mins < 1) return "just now";
  if (mins < 60) return `${mins}m`;
  const hrs = Math.floor(mins / 60);
  if (hrs < 24) return `${hrs}h`;
  return `${Math.floor(hrs / 24)}d`;
}

/** Short calendar date for battle history rows: "Jul 8". */
export function formatBattleDate(value: Battle["createdAt"]): string {
  const date = toDate(value as FirestoreTimestampLike);
  if (!date) return "Recent";
  return date.toLocaleDateString(undefined, { month: "short", day: "numeric" });
}
