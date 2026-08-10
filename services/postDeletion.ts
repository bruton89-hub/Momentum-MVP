import AsyncStorage from "@react-native-async-storage/async-storage";
import { httpsCallable } from "firebase/functions";
import { functions } from "@/config/firebase";

const FEED_CACHE_PREFIX = "momentum:feed:v1:";
const DELETED_POSTS_CACHE_KEY = "momentum:deleted-posts:v1";

export interface DeletePostResult {
  postId: string;
  outcome: "applied" | "already_applied";
  deleted: {
    comments: number;
    likes: number;
    notifications: number;
  };
  mediaCleanupComplete: boolean;
  mediaRetainedForBattleHistory: boolean;
}

const deletePostCallable = httpsCallable<
  { postId: string },
  DeletePostResult
>(functions, "deletePost");

const deletedPostIds = new Set<string>();
const listeners = new Set<(postId: string) => void>();
const inFlightDeletes = new Map<string, Promise<DeletePostResult>>();
const hydration = AsyncStorage.getItem(DELETED_POSTS_CACHE_KEY)
  .then((value) => {
    const parsed: unknown = value ? JSON.parse(value) : [];
    if (Array.isArray(parsed)) {
      parsed.forEach((postId) => {
        if (typeof postId === "string" && postId) deletedPostIds.add(postId);
      });
    }
  })
  .catch(() => undefined);

export function isPostDeleted(postId: string): boolean {
  return deletedPostIds.has(postId);
}

export function excludeDeletedPosts<T extends { id: string }>(posts: T[]): T[] {
  return posts.filter((post) => !deletedPostIds.has(post.id));
}

export function subscribeToPostDeletions(
  listener: (postId: string) => void
): () => void {
  listeners.add(listener);
  void hydration.then(() => {
    if (!listeners.has(listener)) return;
    deletedPostIds.forEach(listener);
  });
  return () => listeners.delete(listener);
}

async function removePostFromFeedCaches(postId: string): Promise<void> {
  try {
    const keys = (await AsyncStorage.getAllKeys()).filter((key) =>
      key.startsWith(FEED_CACHE_PREFIX)
    );
    if (keys.length === 0) return;
    const entries = await AsyncStorage.multiGet(keys);
    const updates: [string, string][] = [];
    for (const [key, value] of entries) {
      if (!value) continue;
      const parsed: unknown = JSON.parse(value);
      if (!Array.isArray(parsed)) continue;
      const filtered = parsed.filter(
        (item) =>
          !item ||
          typeof item !== "object" ||
          !("id" in item) ||
          item.id !== postId
      );
      if (filtered.length !== parsed.length) {
        updates.push([key, JSON.stringify(filtered)]);
      }
    }
    if (updates.length > 0) await AsyncStorage.multiSet(updates);
  } catch (error) {
    console.error("[deletePost] Failed to evict feed cache entry", {
      postId,
      error,
    });
  }
}

function publishDeletion(postId: string): void {
  if (deletedPostIds.has(postId)) return;
  deletedPostIds.add(postId);
  listeners.forEach((listener) => listener(postId));
  void AsyncStorage.setItem(
    DELETED_POSTS_CACHE_KEY,
    JSON.stringify([...deletedPostIds])
  ).catch(() => undefined);
  void removePostFromFeedCaches(postId);
}

/**
 * Server-authoritative deletion. A module-level promise deduplicates taps and
 * duplicate mounted cards for the same post until the callable settles.
 */
export function deletePost(postId: string): Promise<DeletePostResult> {
  const existing = inFlightDeletes.get(postId);
  if (existing) return existing;

  const startedAt = Date.now();
  const operation = deletePostCallable({ postId })
    .then(({ data }) => {
      publishDeletion(postId);
      if (__DEV__) {
        console.log(`[perf] delete post completed in ${Date.now() - startedAt}ms`);
      }
      return data;
    })
    .catch((error) => {
      console.error("[deletePost] Callable failed", {
        postId,
        code:
          typeof error === "object" && error && "code" in error
            ? String(error.code)
            : "unknown",
        message:
          typeof error === "object" && error && "message" in error
            ? String(error.message)
            : "Unknown callable error",
        details:
          typeof error === "object" && error && "details" in error
            ? error.details
            : undefined,
      });
      throw error;
    })
    .finally(() => {
      inFlightDeletes.delete(postId);
    });

  inFlightDeletes.set(postId, operation);
  return operation;
}

export function postDeletionErrorMessage(error: unknown): string {
  const code =
    typeof error === "object" && error && "code" in error
      ? String(error.code)
      : "";
  if (code.endsWith("failed-precondition")) {
    return "This post is currently part of an active battle and cannot be deleted yet.";
  }
  if (code.endsWith("unauthenticated")) {
    return "Please sign in again before deleting this post.";
  }
  if (code.endsWith("permission-denied")) {
    return "You can only delete your own posts.";
  }
  if (code.endsWith("invalid-argument")) {
    return "The delete request was invalid. Refresh the post and try again.";
  }
  if (code.endsWith("not-found")) {
    return "This post no longer exists. Refresh your profile or feed.";
  }
  if (code.endsWith("resource-exhausted")) {
    return "The delete service is busy. Wait a moment and try again.";
  }
  if (code.endsWith("aborted") || code.endsWith("cancelled")) {
    return "The delete operation was interrupted. The post is still available—please try again.";
  }
  if (code.endsWith("internal")) {
    return "The delete service returned an internal error. The post was not removed—please try again later.";
  }
  const message =
    typeof error === "object" && error && "message" in error
      ? String(error.message)
      : "";
  if (
    code.endsWith("unavailable") ||
    code.endsWith("deadline-exceeded") ||
    /failed to fetch|network request failed|networkerror/i.test(message)
  ) {
    return "Couldn't reach the server. Check your connection and try again.";
  }
  return code
    ? `The post could not be deleted (${code.replace(/^functions\//, "")}). It is still available—please try again.`
    : "The post could not be deleted. It is still available—please try again.";
}
