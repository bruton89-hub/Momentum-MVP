import { useState, useCallback, useEffect, useRef } from "react";
import {
  collection,
  query,
  orderBy,
  limit,
  getDocs,
  addDoc,
  where,
  Timestamp,
  documentId,
} from "firebase/firestore";
import { ref, uploadBytesResumable, getDownloadURL } from "firebase/storage";
import { httpsCallable } from "firebase/functions";
import { Platform } from "react-native";
import { db, functions, storage } from "@/config/firebase";
import {
  fetchPostsByUser,
  fetchPostsByUsers,
  normalizePost,
} from "@/services/postRepository";
import type { Post } from "@/types";
import type { PostVideoEdit } from "@/constants/videoEditing";

const POSTS_PER_PAGE = 20;
export const MAX_POST_MEDIA_BYTES = 50 * 1024 * 1024;

type SetPostLikeResult = {
  postId: string;
  liked: boolean;
  likesCount: number;
  outcome: "applied" | "already_applied";
};

const setPostLikeCallable = httpsCallable<
  { postId: string; liked: boolean; clientMutationId: string },
  SetPostLikeResult
>(functions, "setPostLike");

// ─── Upload media to Firebase Storage ────────────────────────────────────────

export async function uploadMedia(
  uri: string,
  userId: string,
  onProgress?: (pct: number) => void
): Promise<string> {
  return (await uploadMediaWithPath(uri, userId, onProgress)).url;
}

export interface UploadedMedia {
  url: string;
  fullPath: string;
}

export async function uploadMediaWithPath(
  uri: string,
  userId: string,
  onProgress?: (pct: number) => void,
  filenamePrefix = "post"
): Promise<UploadedMedia> {
  const blob = await uriToBlob(uri);
  if (blob.size > MAX_POST_MEDIA_BYTES) {
    throw new Error("Media must be 50 MB or smaller.");
  }

  const ext = extensionFromBlob(blob) || extensionFromUri(uri) || "jpg";
  const filename = `posts/${userId}/${filenamePrefix}_${Date.now()}.${ext}`;
  const storageRef = ref(storage, filename);

  return new Promise<UploadedMedia>((resolve, reject) => {
    const task = uploadBytesResumable(storageRef, blob, {
      contentType: blob.type || (ext === "mp4" ? "video/mp4" : "image/jpeg"),
    });
    task.on(
      "state_changed",
      (snap) => {
        if (onProgress) {
          onProgress(Math.round((snap.bytesTransferred / snap.totalBytes) * 100));
        }
      },
      (err) => {
        console.error("[uploadMedia] uploadBytes error", err);
        reject(err);
      },
      async () => {
        try {
          const url = await getDownloadURL(task.snapshot.ref);
          onProgress?.(100);
          resolve({ url, fullPath: task.snapshot.ref.fullPath });
        } catch (err) {
          console.error("[uploadMedia] getDownloadURL error", err);
          reject(err);
        }
      }
    );
  });
}

async function uriToBlob(uri: string): Promise<Blob> {
  if (Platform.OS === "web" || uri.startsWith("http") || uri.startsWith("blob:") || uri.startsWith("data:")) {
    const response = await fetch(uri);
    if (!response.ok) {
      throw new Error(`Media fetch failed with status ${response.status}`);
    }
    return response.blob();
  }

  return new Promise<Blob>((resolve, reject) => {
    const xhr = new XMLHttpRequest();
    xhr.onload = () => {
      resolve(xhr.response as Blob);
    };
    xhr.onerror = () => {
      reject(new Error("Could not read selected media file."));
    };
    xhr.responseType = "blob";
    xhr.open("GET", uri, true);
    xhr.send(null);
  });
}

function extensionFromUri(uri: string): string | null {
  const cleanUri = uri.split("?")[0];
  const ext = cleanUri.split(".").pop()?.toLowerCase();
  if (!ext || ext === cleanUri) return null;
  return ext === "jpeg" ? "jpg" : ext;
}

function extensionFromBlob(blob: Blob): string | null {
  const subtype = blob.type.split("/")[1]?.split(";")[0]?.toLowerCase();
  if (!subtype) return null;
  if (subtype === "jpeg") return "jpg";
  if (subtype === "quicktime") return "mov";
  return subtype;
}

// ─── Create a post ────────────────────────────────────────────────────────────

export interface CreatePostInput {
  userId: string;
  username: string;
  userAvatar: string;
  avatarUrl?: string;
  mediaUrl: string;
  mediaType: "image" | "video";
  caption: string;
  battleEnabled: boolean;
  originalMediaUrl?: string;
  videoEdit?: PostVideoEdit;
}

export async function createPost(input: CreatePostInput): Promise<string> {
  const {
    originalMediaUrl,
    videoEdit,
    ...requiredInput
  } = input;
  const payload = {
    ...requiredInput,
    ...(originalMediaUrl ? { originalMediaUrl } : {}),
    ...(videoEdit ? { videoEdit } : {}),
    // Write all known userId aliases so docs are found regardless of which
    // field name old or future queries use.
    authorId: input.userId,
    uid:      input.userId,
    // Write avatarUrl explicitly even if input already includes it via spread,
    // so both avatar field names are always present.
    avatarUrl: input.avatarUrl ?? input.userAvatar ?? "",
    likesCount: 0,
    // Use client-side Timestamp.now() instead of serverTimestamp() so that
    // createdAt is immediately non-null in the local Firestore cache.
    // serverTimestamp() resolves to null until the server acknowledges the write,
    // causing orderBy("createdAt","desc") to sort the new post to the bottom
    // and the feed's limit(POSTS_PER_PAGE) to exclude it.
    createdAt: Timestamp.now(),
    updatedAt: Timestamp.now(),
  };
  const docRef = await addDoc(collection(db, "posts"), payload);

  return docRef.id;
}

// ─── Check if current user liked a post ──────────────────────────────────────
// Wrapped in try/catch: the `likes` collection may not exist yet or may be
// restricted by project-level Firestore rules. A failure here must never
// block the main feed from rendering.

export async function fetchLikedPostIds(
  userId: string,
  postIds: string[]
): Promise<Set<string>> {
  if (postIds.length === 0) return new Set();
  try {
    const likeIds = postIds.map((postId) => `${postId}_${userId}`);
    const batches: string[][] = [];
    for (let index = 0; index < likeIds.length; index += 10) {
      batches.push(likeIds.slice(index, index + 10));
    }
    const snapshots = await Promise.all(
      batches.map((ids) =>
        getDocs(
          query(collection(db, "likes"), where(documentId(), "in", ids))
        )
      )
    );
    const ids = new Set<string>();
    snapshots.forEach((snapshot) =>
      snapshot.forEach((d) => ids.add(d.data().postId as string))
    );
    return ids;
  } catch {
    // Permission denied or collection missing — return empty set so feed loads.
    return new Set<string>();
  }
}

// ─── Hook: paginated home feed ────────────────────────────────────────────────

export function usePosts(currentUserId?: string | null) {
  const [posts, setPosts] = useState<Post[]>([]);
  const [likedIds, setLikedIds] = useState<Set<string>>(new Set());
  const [loading, setLoading] = useState(true);
  const [refreshing, setRefreshing] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const fetchPosts = useCallback(async (isRefresh = false) => {
    if (isRefresh) setRefreshing(true);
    else setLoading(true);
    setError(null);

    try {
      const postsSnap = await getDocs(
        query(
          collection(db, "posts"),
          orderBy("createdAt", "desc"),
          limit(POSTS_PER_PAGE)
        )
      );
      const liked = currentUserId
        ? await fetchLikedPostIds(
            currentUserId,
            postsSnap.docs.map((postDoc) => postDoc.id)
          )
        : new Set<string>();

      const fetched: Post[] = postsSnap.docs
        .map((d) => normalizePost(d.id, d.data() as Record<string, unknown>))
        .filter((p) => {
          // Only reject docs that are truly unrenderable — no media to display.
          // userId is now resolved from authorId/uid/ownerId aliases, so most
          // "hasUserId: false" rejections should be gone after the normalizePost fix.
          const keep = !!p.mediaUrl;
          if (!keep && __DEV__) {
            console.warn("[fetchPosts] rejected doc (no mediaUrl)", p.id,
              { hasMediaUrl: !!p.mediaUrl, hasUserId: !!p.userId });
          }
          return keep;
        });
      setPosts(fetched);
      setLikedIds(liked);
    } catch (err: unknown) {
      // Only surfaces if the posts query itself fails (not likes).
      // On permission-denied or missing collection, show empty feed.
      const code = (err as { code?: string })?.code ?? "";
      console.error("[fetchPosts] query error", { code, err });
      if (code === "permission-denied" || code === "unavailable") {
        setPosts([]);
      } else {
        setError(err instanceof Error ? err.message : "Failed to load posts");
      }
    } finally {
      setLoading(false);
      setRefreshing(false);
    }
  }, [currentUserId]);

  useEffect(() => {
    fetchPosts();
  }, [fetchPosts]);

  // ── Like toggle ───────────────────────────────────────────────────────────────
  // likedIds is stored in a ref so handleLike's identity only changes when
  // currentUserId changes — not after every like. Without this, every like
  // creates a new handleLike reference, propagating a new onLike prop to every
  // memoised PostCard, triggering a full-list re-render cascade that can drop
  // touch events mid-flight.
  const likedIdsRef = useRef(likedIds);
  likedIdsRef.current = likedIds;

  const handleLike = useCallback(
    async (postId: string) => {
      __DEV__ && console.log("[handleLike] called — postId:", postId, "currentUserId:", currentUserId);
      if (!currentUserId) {
        console.warn("[handleLike] aborted — no currentUserId");
        return;
      }

      // Optimistic update — read latest liked state from ref
      const alreadyLiked = likedIdsRef.current.has(postId);
      const nextLiked = new Set(likedIdsRef.current);
      if (alreadyLiked) {
        nextLiked.delete(postId);
      } else {
        nextLiked.add(postId);
      }
      likedIdsRef.current = nextLiked;
      setLikedIds(nextLiked);
      setPosts((prev) =>
        prev.map((p) =>
          p.id === postId
            ? { ...p, likesCount: p.likesCount + (alreadyLiked ? -1 : 1) }
            : p
        )
      );

      // Sync to Firestore
      try {
        const response = await setPostLikeCallable({
          postId,
          liked: !alreadyLiked,
          clientMutationId: `${postId}:${currentUserId}:${Date.now()}`,
        });
        setPosts((prev) =>
          prev.map((post) =>
            post.id === postId
              ? { ...post, likesCount: response.data.likesCount }
              : post
          )
        );
      } catch (err) {
        console.error("[handleLike] Firestore sync failed — reverting:", err);
        const reverted = new Set(likedIdsRef.current);
        if (alreadyLiked) reverted.add(postId);
        else reverted.delete(postId);
        likedIdsRef.current = reverted;
        setLikedIds(reverted);
        setPosts((prev) =>
          prev.map((p) =>
            p.id === postId
              ? {
                  ...p,
                  likesCount: Math.max(
                    0,
                    p.likesCount + (alreadyLiked ? 1 : -1)
                  ),
                }
              : p
          )
        );
      }
    },
    [currentUserId] // stable: only recreates when the logged-in user changes
  );

  // Stable refresh reference — wrapped so its identity only changes when
  // fetchPosts itself changes (i.e. when currentUserId changes), not every render.
  const refresh = useCallback(() => fetchPosts(true), [fetchPosts]);

  return {
    posts,
    likedIds,
    loading,
    refreshing,
    error,
    refresh,
    handleLike,
  };
}

// ─── Hook: posts by a specific user ──────────────────────────────────────────
// Queries all three known userId field aliases (userId, authorId, uid) in
// parallel so that both old docs (that only stored authorId) and new docs
// (that always store userId) appear on the profile grid.
//
// IMPORTANT: Do NOT use orderBy("createdAt") alongside where("userId","==").
// That compound query requires a Firestore composite index.  Without one,
// Firestore returns FAILED_PRECONDITION.  We sort client-side instead.

export function useUserPosts(userId: string | null) {
  const [posts, setPosts] = useState<Post[]>([]);
  const [loading, setLoading] = useState(false);

  const load = useCallback(async () => {
    if (!userId) { setPosts([]); return; }
    setLoading(true);
    try {
      const normalized = await fetchPostsByUser(userId);
      __DEV__ && console.log("[fetchUserPosts] userId:", userId, "→ kept:", normalized.length);
      setPosts(normalized);
    } catch (err) {
      console.error("[fetchUserPosts] query failed:", err);
      setPosts([]);
    } finally {
      setLoading(false);
    }
  }, [userId]);

  useEffect(() => {
    load();
  }, [load]);

  return { posts, loading, refresh: load };
}

// ─── Hook: following feed ─────────────────────────────────────────────────────
// Loads posts only from users the current user follows.
// Handles Firestore `in` operator limit (max 10 per query) by batching.
// If the user follows nobody, returns an empty array immediately.
// Waits for `followsLoading` to complete before running — prevents showing a
// false empty state while the follows list is still being fetched.

export function useFollowingPosts(
  currentUserId: string | null,
  followedIds: Set<string>,
  followsLoading: boolean
) {
  const [posts, setPosts] = useState<Post[]>([]);
  const [loading, setLoading] = useState(true);
  const [refreshing, setRefreshing] = useState(false);
  const fetchInFlightRef = useRef(false);

  // Serialize followedIds to a stable string so the callback only recreates
  // when the actual set of followed IDs changes, not just the Set reference.
  const followedKey = Array.from(followedIds).sort().join(",");

  const fetchPosts = useCallback(
    async (isRefresh = false) => {
      // Don't run until the follows list has fully loaded
      if (followsLoading) {
        setLoading(true);
        return;
      }

      if (fetchInFlightRef.current) {
        __DEV__ && console.log("[followingFeed] fetch skipped — request already in flight");
        return;
      }

      fetchInFlightRef.current = true;

      if (isRefresh) setRefreshing(true);
      else setLoading(true);

      try {
        __DEV__ && console.log("[followingFeed] followedIds:", Array.from(followedIds));

        // No one followed → return empty immediately
        if (followedIds.size === 0) {
          setPosts([]);
          return;
        }

        const unique = await fetchPostsByUsers(
          followedIds,
          POSTS_PER_PAGE
        );
        __DEV__ && console.log("[followingFeed] unique count:", unique.length);
        __DEV__ && console.log("[followingFeed] unique ids:", unique.map((p) => p.id));

        // Replace results. Do not append: focus refreshes and followed-id changes
        // should never stack duplicate batches into existing feed state.
        setPosts(unique);
      } catch (err) {
        // Surface the real error code so a FAILED_PRECONDITION (missing index)
        // or PERMISSION_DENIED isn't silently swallowed as an empty feed.
        const code = (err as { code?: string })?.code ?? "unknown";
        console.error("[followingFeed] query failed — code:", code, err);
        setPosts([]);
      } finally {
        fetchInFlightRef.current = false;
        setLoading(false);
        setRefreshing(false);
      }
    },
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [followedKey, followsLoading]
  );

  useEffect(() => {
    fetchPosts();
  }, [fetchPosts]);

  // Stable refresh reference — wrapped so its identity only changes when
  // fetchPosts itself changes (i.e. when followedKey/followsLoading changes).
  const refresh = useCallback(() => fetchPosts(true), [fetchPosts]);

  return {
    posts,
    // Combine loading states: still loading if follows haven't resolved yet
    loading: followsLoading || loading,
    refreshing,
    refresh,
  };
}
