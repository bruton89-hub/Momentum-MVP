import type { Timestamp } from "firebase/firestore";

// ─── User ─────────────────────────────────────────────────────────────────────

export interface UserProfile {
  userId: string;
  username: string;
  avatar: string;
  avatarUrl?: string;
  athleteType: string;
  sport?: string;
  bio: string;
  posts: number;
  wins: number;
  losses: number;
  createdAt: Timestamp | null;
  updatedAt?: Timestamp | null;
}

// ─── Post ─────────────────────────────────────────────────────────────────────

export interface Post {
  id: string;
  userId: string;
  username: string;
  userAvatar: string;
  avatarUrl?: string;
  mediaUrl: string;
  mediaType: "image" | "video";
  caption: string;
  likesCount: number;
  battleEnabled: boolean;
  createdAt: Timestamp | null;
}

// ─── Battle ───────────────────────────────────────────────────────────────────

export interface BattlePlayer {
  userId: string;
  username: string;
  avatar: string;
  mediaUrl: string;
  mediaType: "image" | "video";
  postId: string;
}

export type BattleStatus = "open" | "live" | "completed";

export interface Battle {
  id: string;
  // playerA can be null/undefined when Firestore doc uses a different schema
  // (e.g. legacy documents from a different app version). BattleCard guards
  // against this and renders a placeholder instead of crashing.
  playerA: BattlePlayer | null;
  playerB: BattlePlayer | null; // null when status = "open" or doc incomplete
  creatorId: string;
  votesA: number;
  votesB: number;
  status: BattleStatus;
  category: string;
  /** Firestore-stored end timestamp. Takes priority over duration fields. */
  endTime: Timestamp | null;
  /** Optional: explicit duration stored at creation time. */
  durationHours?: number;
  durationMinutes?: number;
  winner: string | null; // userId of winner
  statsRecorded?: boolean;
  createdAt: Timestamp | null;
}

// ─── Vote ─────────────────────────────────────────────────────────────────────

export interface Vote {
  battleId: string;
  userId: string;
  side: "A" | "B";
  createdAt: Timestamp | null;
}
