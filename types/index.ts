import type { Timestamp } from "firebase/firestore";
import type {
  PostVideoEdit,
} from "@/constants/videoEditing";

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
  // ── Athlete identity (optional — rendered only when present) ────────────────
  /** Playing position, e.g. "QB", "Point Guard". */
  position?: string;
  /** School / program name. */
  school?: string;
  /** Club / team name — shown when no school is present. */
  teamName?: string;
  /** Home city. */
  city?: string;
  /** Home state / region. */
  state?: string;
  /** Graduation year, e.g. "2027". */
  gradYear?: string;
  // ── Status / achievements (optional — never fabricated client-side) ─────────
  /** Verified athlete — green ring + check + badge. */
  verified?: boolean;
  /** Verified by a coach (future-ready). */
  coachVerified?: boolean;
  /** Momentum Score (platform ranking metric). */
  momentumScore?: number;
  /** Tournament champion achievement. */
  tournamentChampion?: boolean;
  /** Top-ranked athlete flag. */
  topRanked?: boolean;
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
  originalMediaUrl?: string;
  videoEdit?: PostVideoEdit;
  createdAt: Timestamp | null;
  // ── Athlete identity (optional — rendered in the feed overlay when present) ──
  /** Sport the athlete plays, e.g. "Football". Falls back to author profile data. */
  sport?: string;
  /** Playing position, e.g. "QB", "Point Guard". */
  position?: string;
  /** School / program name, e.g. "Lincoln High". */
  school?: string;
  /** Club / team name — shown when no school is present. */
  teamName?: string;
  /** Home city, e.g. "Dallas". */
  city?: string;
  /** Home state / region, e.g. "TX". */
  state?: string;
  /** Graduation year, e.g. "2027". */
  gradYear?: string;
  /** Verified athlete — earns the Momentum-green ring + check badge. */
  verified?: boolean;
  /** Momentum Score (platform ranking metric), shown as a badge when present. */
  momentumScore?: number;
  /** Post is a live stream / live tagged clip. */
  isLive?: boolean;
  /** Post won a battle — earns the Battle Winner badge. */
  battleWon?: boolean;
  /** Pinned to the top of the athlete's profile grid. */
  pinned?: boolean;
  /** Comment count — optional, rendered only when the backend writes it. */
  commentsCount?: number;
}

// ─── Comment ──────────────────────────────────────────────────────────────────
// Flat, post-scoped comments. The backend stores no reply relationships —
// do not infer or render nesting.

export interface PostComment {
  id: string;
  postId: string;
  userId: string;
  username: string;
  avatar: string;
  text: string;
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

// ─── Notification ─────────────────────────────────────────────────────────────
// Written by the acting user (actorId == auth.uid) with deterministic doc IDs
// so repeated actions can never create duplicates. `subject*` fields carry the
// identity shown in the row (usually the actor; for battle results, the
// recipient's opponent — the finalizing viewer is incidental).

export type NotificationType =
  | "follow"
  | "comment"
  | "challenge_received"
  | "challenge_accepted"
  | "battle_completed"
  | "battle_won";

export interface MomentumNotification {
  id: string;
  type: NotificationType;
  recipientId: string;
  actorId: string;
  subjectUsername: string;
  subjectAvatar: string;
  /** Comment snippet for type "comment". */
  preview?: string;
  postId?: string;
  battleId?: string;
  read: boolean;
  createdAt: Timestamp | null;
}

// ─── Vote ─────────────────────────────────────────────────────────────────────

export interface Vote {
  battleId: string;
  userId: string;
  side: "A" | "B";
  createdAt: Timestamp | null;
}
