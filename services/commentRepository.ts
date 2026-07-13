import {
  addDoc,
  collection,
  deleteDoc,
  doc,
  getDocs,
  limit,
  query,
  where,
  Timestamp,
} from "firebase/firestore";
import { db } from "@/config/firebase";
import { timestampToMs } from "@/services/postRepository";
import type { PostComment } from "@/types";

/** Hard cap per load — matches the codebase's single-page patterns. */
const COMMENTS_PAGE_LIMIT = 100;

/** Max comment length — mirrors the Firestore rules validation (300). */
export const MAX_COMMENT_LENGTH = 300;

function commentString(value: unknown): string {
  return typeof value === "string" ? value : "";
}

/**
 * Defensive normalization — malformed docs (wrong app version, manual edits)
 * degrade to safe empty strings instead of crashing rows. Comments with no
 * text or author are filtered out by fetchCommentsForPost.
 */
export function normalizeComment(
  id: string,
  data: Record<string, unknown>
): PostComment {
  return {
    id,
    postId: commentString(data.postId),
    userId: commentString(data.userId),
    username: commentString(data.username) || "Athlete",
    avatar:
      commentString(data.avatar) ||
      commentString(data.avatarUrl) ||
      "",
    text: commentString(data.text),
    createdAt: (data.createdAt as Timestamp) ?? null,
  };
}

/**
 * Load the comments for one post, newest first.
 * Single `where` + no orderBy (composite-index-free, same pattern as
 * fetchPostsByUser); sorted client-side.
 */
export async function fetchCommentsForPost(
  postId: string
): Promise<PostComment[]> {
  const snap = await getDocs(
    query(
      collection(db, "comments"),
      where("postId", "==", postId),
      limit(COMMENTS_PAGE_LIMIT)
    )
  );
  return snap.docs
    .map((d) => normalizeComment(d.id, d.data() as Record<string, unknown>))
    .filter((comment) => comment.text.trim().length > 0 && !!comment.userId)
    .sort((a, b) => timestampToMs(b.createdAt) - timestampToMs(a.createdAt));
}

export interface CreateCommentInput {
  postId: string;
  userId: string;
  username: string;
  avatar: string;
  text: string;
}

/**
 * Create a comment. Resolves ONLY after Firestore acknowledges the write —
 * callers must not render the comment before this resolves (no optimistic
 * insertion). Returns the accepted comment for direct list insertion so no
 * refetch (and no duplicate) is needed.
 */
export async function createComment(
  input: CreateCommentInput
): Promise<PostComment> {
  const text = input.text.trim().slice(0, MAX_COMMENT_LENGTH);
  // Client-side Timestamp.now() (not serverTimestamp) so createdAt is
  // immediately non-null — same rationale as createPost.
  const createdAt = Timestamp.now();
  const docRef = await addDoc(collection(db, "comments"), {
    postId: input.postId,
    userId: input.userId,
    username: input.username,
    avatar: input.avatar,
    text,
    createdAt,
  });
  return {
    id: docRef.id,
    postId: input.postId,
    userId: input.userId,
    username: input.username,
    avatar: input.avatar,
    text,
    createdAt,
  };
}

/** Delete a comment (rules enforce author-only). */
export async function deleteComment(commentId: string): Promise<void> {
  await deleteDoc(doc(db, "comments", commentId));
}
