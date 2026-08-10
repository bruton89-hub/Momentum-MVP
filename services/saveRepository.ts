import {
  collection,
  deleteDoc,
  doc,
  documentId,
  getDocs,
  query,
  setDoc,
  Timestamp,
  where,
} from "firebase/firestore";
import { db } from "@/config/firebase";
import { fetchPostsByIds } from "@/services/postRepository";
import { excludeDeletedPosts } from "@/services/postDeletion";
import type { Post } from "@/types";

/**
 * Saved posts ("bookmarks").
 *
 * Doc ID convention: saves/{postId}_{userId} — the same compound-key pattern
 * `likes` and `follows` use. It makes a save idempotent (re-saving overwrites
 * rather than duplicating), gives existence checks for free, and lets the
 * Firestore rules verify ownership from the ID alone.
 *
 * Saves are private: only the owner may read their own. That's enforced in
 * firestore.rules, so no client can enumerate another athlete's bookmarks.
 */

const FIRESTORE_IN_LIMIT = 10;

export function saveDocId(postId: string, userId: string): string {
  return `${postId}_${userId}`;
}

/** Every postId this user has saved, newest first. */
export async function fetchSavedPostIds(userId: string): Promise<string[]> {
  if (!userId) return [];
  try {
    const snapshot = await getDocs(
      query(collection(db, "saves"), where("userId", "==", userId))
    );
    return snapshot.docs
      .map((saveDoc) => {
        const data = saveDoc.data() as Record<string, unknown>;
        const createdAt = data.createdAt;
        const createdMs =
          createdAt instanceof Timestamp ? createdAt.toMillis() : 0;
        return { postId: String(data.postId ?? ""), createdMs };
      })
      .filter((entry) => entry.postId)
      .sort((a, b) => b.createdMs - a.createdMs)
      .map((entry) => entry.postId);
  } catch (err) {
    // Rules not yet deployed, or offline. A save-state failure must never
    // block a feed or profile from rendering.
    const code = (err as { code?: string })?.code ?? "unknown";
    console.error("[fetchSavedPostIds] failed — code:", code, err);
    return [];
  }
}

/** Saved-post ids as a Set, for O(1) lookups while rendering a feed. */
export async function fetchSavedPostIdSet(
  userId: string
): Promise<Set<string>> {
  return new Set(await fetchSavedPostIds(userId));
}

/** Hydrate the Saved tab. Deleted posts are filtered out on the way through. */
export async function fetchSavedPosts(userId: string): Promise<Post[]> {
  const ids = await fetchSavedPostIds(userId);
  if (ids.length === 0) return [];
  const posts = await fetchPostsByIds(ids);
  // Preserve save recency rather than post recency — the Saved tab is a
  // reading list, so most-recently-saved belongs at the top.
  const order = new Map(ids.map((id, index) => [id, index]));
  return excludeDeletedPosts(posts).sort(
    (a, b) => (order.get(a.id) ?? 0) - (order.get(b.id) ?? 0)
  );
}

/** Create or remove a save. Idempotent in both directions. */
export async function setPostSaved(
  postId: string,
  userId: string,
  saved: boolean
): Promise<void> {
  if (!postId || !userId) {
    throw new Error("You must be signed in to save a highlight.");
  }
  const ref = doc(db, "saves", saveDocId(postId, userId));
  if (saved) {
    await setDoc(ref, {
      postId,
      userId,
      createdAt: Timestamp.now(),
    });
  } else {
    await deleteDoc(ref);
  }
}

/** Which of these posts the user has saved — batched to Firestore's `in` cap. */
export async function fetchSavedStateFor(
  userId: string,
  postIds: string[]
): Promise<Set<string>> {
  if (!userId || postIds.length === 0) return new Set();
  try {
    const docIds = postIds.map((postId) => saveDocId(postId, userId));
    const batches: string[][] = [];
    for (let index = 0; index < docIds.length; index += FIRESTORE_IN_LIMIT) {
      batches.push(docIds.slice(index, index + FIRESTORE_IN_LIMIT));
    }
    const snapshots = await Promise.all(
      batches.map((ids) =>
        getDocs(query(collection(db, "saves"), where(documentId(), "in", ids)))
      )
    );
    const saved = new Set<string>();
    snapshots.forEach((snapshot) =>
      snapshot.forEach((saveDoc) => {
        const postId = (saveDoc.data() as { postId?: string }).postId;
        if (postId) saved.add(postId);
      })
    );
    return saved;
  } catch (err) {
    const code = (err as { code?: string })?.code ?? "unknown";
    console.error("[fetchSavedStateFor] failed — code:", code, err);
    return new Set<string>();
  }
}
