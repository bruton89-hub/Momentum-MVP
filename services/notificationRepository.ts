import {
  collection,
  doc,
  getDoc,
  getDocs,
  getCountFromServer,
  limit,
  query,
  setDoc,
  updateDoc,
  where,
  writeBatch,
  Timestamp,
} from "firebase/firestore";
import { auth, db } from "@/config/firebase";
import { useAuthStore } from "@/store/authStore";
import { timestampToMs } from "@/services/postRepository";
import type {
  MomentumNotification,
  NotificationType,
} from "@/types";

/**
 * Notifications v1 — client-generated, actor-written.
 *
 * DEDUPE STRATEGY: every notification has a DETERMINISTIC doc id derived from
 * the triggering action (one follow pair, one comment, one battle event). A
 * repeat write targets the same id, which Firestore treats as an update —
 * denied by rules for anyone but the recipient's read-flag flip — so repeated
 * actions (re-follow, double-tap, concurrent finalizers) can never duplicate.
 *
 * All writers are fire-and-forget: a notification failure must never break
 * the follow/comment/battle flow that triggered it.
 */

const NOTIFICATIONS_FETCH_LIMIT = 100;

export interface UnreadNotificationCountResult {
  count: number;
  permissionDenied: boolean;
}

/**
 * A store userId is UI state, not proof that the Firestore request can be
 * authenticated. Require the live Firebase Auth user to match and force its
 * ID token to resolve before issuing a notification read/aggregation.
 */
async function resolveAuthenticatedRecipient(
  userId: string
): Promise<string | null> {
  const currentUser = auth.currentUser;
  if (!currentUser || currentUser.uid !== userId) return null;
  try {
    await currentUser.getIdToken();
  } catch {
    return null;
  }
  return auth.currentUser?.uid === userId ? userId : null;
}

function isPermissionDenied(error: unknown): boolean {
  if (!error || typeof error !== "object" || !("code" in error)) return false;
  const code = String((error as { code?: unknown }).code);
  return code === "permission-denied" || code === "firestore/permission-denied";
}

interface WriteInput {
  id: string;
  type: NotificationType;
  recipientId: string;
  subjectUsername: string;
  subjectAvatar: string;
  preview?: string;
  postId?: string;
  commentId?: string;
  battleId?: string;
}

function actorFromStore(): { userId: string; username: string; avatar: string } | null {
  const { userId, profile } = useAuthStore.getState();
  if (!userId) return null;
  return {
    userId,
    username: profile?.username ?? "",
    avatar: profile?.avatarUrl || profile?.avatar || "",
  };
}

async function writeNotification(input: WriteInput): Promise<void> {
  const actor = actorFromStore();
  // Never notify yourself; rules also forbid it.
  if (!actor || actor.userId === input.recipientId) return;
  try {
    // Follow can be tapped during the short window after auth resolves but
    // before the decorative profile store hydrates. Its rule verifies the
    // authoritative username, so resolve that identity rather than dropping a
    // legitimate notification because the client temporarily had "".
    let subjectUsername = input.subjectUsername;
    let subjectAvatar = input.subjectAvatar;
    if (input.type === "follow") {
      const actorProfile = await getDoc(doc(db, "users", actor.userId));
      if (!actorProfile.exists()) return;
      const data = actorProfile.data();
      subjectUsername = typeof data.username === "string" ? data.username : "";
      subjectAvatar =
        (typeof data.avatarUrl === "string" && data.avatarUrl) ||
        (typeof data.avatar === "string" && data.avatar) ||
        "";
    }
    await setDoc(doc(db, "notifications", input.id), {
      type: input.type,
      recipientId: input.recipientId,
      actorId: actor.userId,
      subjectUsername,
      subjectAvatar,
      ...(input.preview ? { preview: input.preview } : {}),
      ...(input.postId ? { postId: input.postId } : {}),
      ...(input.commentId ? { commentId: input.commentId } : {}),
      ...(input.battleId ? { battleId: input.battleId } : {}),
      read: false,
      createdAt: Timestamp.now(),
    });
  } catch {
    // Expected for duplicates (update denied by rules) and never fatal.
  }
}

// ─── Generators (call AFTER the triggering action succeeds) ───────────────────

export function notifyFollow(targetUserId: string): void {
  const actor = actorFromStore();
  if (!actor) return;
  void writeNotification({
    id: `follow_${actor.userId}_${targetUserId}`,
    type: "follow",
    recipientId: targetUserId,
    subjectUsername: actor.username,
    subjectAvatar: actor.avatar,
  });
}

export function notifyComment(
  postOwnerId: string,
  postId: string,
  commentId: string,
  text: string
): void {
  const actor = actorFromStore();
  if (!actor) return;
  void writeNotification({
    id: `comment_${commentId}`,
    type: "comment",
    recipientId: postOwnerId,
    subjectUsername: actor.username,
    subjectAvatar: actor.avatar,
    preview: text.slice(0, 80),
    postId,
    commentId,
  });
}

export function notifyChallengeReceived(
  targetUserId: string,
  battleId: string
): void {
  const actor = actorFromStore();
  if (!actor) return;
  void writeNotification({
    id: `challenge_${battleId}`,
    type: "challenge_received",
    recipientId: targetUserId,
    subjectUsername: actor.username,
    subjectAvatar: actor.avatar,
    battleId,
  });
}

export function notifyChallengeAccepted(
  challengerId: string,
  battleId: string
): void {
  const actor = actorFromStore();
  if (!actor) return;
  void writeNotification({
    id: `accepted_${battleId}`,
    type: "challenge_accepted",
    recipientId: challengerId,
    subjectUsername: actor.username,
    subjectAvatar: actor.avatar,
    battleId,
  });
}

// ─── Readers ──────────────────────────────────────────────────────────────────

function notifString(value: unknown): string {
  return typeof value === "string" ? value : "";
}

const KNOWN_TYPES = new Set<NotificationType>([
  "follow",
  "comment",
  "challenge_received",
  "challenge_accepted",
  "battle_completed",
  "battle_won",
]);

export function normalizeNotification(
  id: string,
  data: Record<string, unknown>
): MomentumNotification | null {
  const type = data.type as NotificationType;
  if (!KNOWN_TYPES.has(type)) return null; // unknown types fail safely
  const recipientId = notifString(data.recipientId);
  if (!recipientId) return null;
  return {
    id,
    type,
    recipientId,
    actorId: notifString(data.actorId),
    subjectUsername: notifString(data.subjectUsername) || "An athlete",
    subjectAvatar: notifString(data.subjectAvatar),
    preview: notifString(data.preview) || undefined,
    postId: notifString(data.postId) || undefined,
    battleId: notifString(data.battleId) || undefined,
    read: data.read === true,
    createdAt: (data.createdAt as Timestamp) ?? null,
  };
}

/**
 * Load the recipient's notifications, newest first. Single equality `where`
 * (no composite index), sorted client-side — same index-free pattern as
 * comments and profile posts. The screen windows this pool for infinite
 * scroll, matching the discovery feed's pagination pattern.
 */
export async function fetchNotificationsForUser(
  userId: string
): Promise<MomentumNotification[]> {
  const recipientId = await resolveAuthenticatedRecipient(userId);
  if (!recipientId) return [];
  const snap = await getDocs(
    query(
      collection(db, "notifications"),
      where("recipientId", "==", recipientId),
      limit(NOTIFICATIONS_FETCH_LIMIT)
    )
  );
  return snap.docs
    .map((d) => normalizeNotification(d.id, d.data() as Record<string, unknown>))
    .filter((n): n is MomentumNotification => n !== null)
    .sort((a, b) => timestampToMs(b.createdAt) - timestampToMs(a.createdAt));
}

/**
 * Unread badge count via a server-side aggregate — one billed read per 1,000
 * matched docs instead of downloading documents. Two equality filters are
 * served by Firestore's built-in indexes (no composite required).
 */
export async function fetchUnreadNotificationCount(
  userId: string
): Promise<UnreadNotificationCountResult> {
  const recipientId = await resolveAuthenticatedRecipient(userId);
  if (!recipientId) return { count: 0, permissionDenied: false };
  try {
    const snapshot = await getCountFromServer(
      query(
        collection(db, "notifications"),
        where("recipientId", "==", recipientId),
        where("read", "==", false)
      )
    );
    return { count: snapshot.data().count, permissionDenied: false };
  } catch (error) {
    // The badge is decorative. Report denial to the hook so it can stop
    // automatic focus retries for this auth session, and never surface a
    // rejected promise into Expo's development error overlay.
    return { count: 0, permissionDenied: isPermissionDenied(error) };
  }
}

export async function markNotificationRead(id: string): Promise<void> {
  await updateDoc(doc(db, "notifications", id), { read: true });
}

/** Batch-mark the provided (loaded) unread notifications as read. */
export async function markNotificationsRead(ids: string[]): Promise<void> {
  if (ids.length === 0) return;
  const batch = writeBatch(db);
  ids.slice(0, 500).forEach((id) => {
    batch.update(doc(db, "notifications", id), { read: true });
  });
  await batch.commit();
}
