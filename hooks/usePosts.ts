import { useState, useCallback, useEffect, useMemo, useRef } from "react";
import {
  collection,
  query,
  orderBy,
  limit,
  getDocs,
  startAfter,
  addDoc,
  where,
  Timestamp,
  documentId,
} from "firebase/firestore";
import { ref, uploadBytesResumable, getDownloadURL } from "firebase/storage";
import { httpsCallable } from "firebase/functions";
import { Platform } from "react-native";
import AsyncStorage from "@react-native-async-storage/async-storage";
import { db, functions, storage } from "@/config/firebase";
import {
  fetchPostsByUser,
  fetchPostsByUsers,
  normalizePost,
  timestampToMs,
} from "@/services/postRepository";
import type { Post } from "@/types";
import type { PostVideoEdit } from "@/constants/videoEditing";

const POSTS_PER_PAGE = 20;
const DISCOVERY_INITIAL_LIMIT = 24;
const DISCOVERY_BACKGROUND_LIMIT = 56;
const DISCOVERY_PAGE_SIZE = 12;
const FEED_CACHE_PREFIX = "momentum:feed:v1";
export const MAX_POST_MEDIA_BYTES = 50 * 1024 * 1024;

function feedCacheKey(userId?: string | null): string {
  return `${FEED_CACHE_PREFIX}:${userId || "guest"}`;
}

function renderablePosts(posts: Post[]): Post[] {
  const unique = new Map<string, Post>();
  posts.forEach((post) => {
    if (post.mediaUrl && !unique.has(post.id)) unique.set(post.id, post);
  });
  return Array.from(unique.values());
}

async function readCachedFeed(userId?: string | null): Promise<Post[]> {
  try {
    const value = await AsyncStorage.getItem(feedCacheKey(userId));
    if (!value) return [];
    const parsed: unknown = JSON.parse(value);
    if (!Array.isArray(parsed)) return [];
    return renderablePosts(
      parsed
        .filter(
          (item): item is Record<string, unknown> =>
            !!item && typeof item === "object" && typeof item.id === "string"
        )
        .map((item) => normalizePost(item.id as string, item))
    );
  } catch {
    return [];
  }
}

function writeCachedFeed(
  posts: Post[],
  userId?: string | null
): Promise<void> {
  return AsyncStorage.setItem(
    feedCacheKey(userId),
    JSON.stringify(posts)
  ).catch(() => undefined);
}

function seededUnit(seed: number, value: string): number {
  let hash = seed ^ 2166136261;
  for (let index = 0; index < value.length; index += 1) {
    hash ^= value.charCodeAt(index);
    hash = Math.imul(hash, 16777619);
  }
  return (hash >>> 0) / 4294967296;
}

function createDiscoverySeed(): number {
  return Math.floor(Math.random() * 2147483647);
}

function rankDiscoveryPosts(
  posts: Post[],
  seed: number,
  currentUserId: string | null | undefined,
  followedIds: Set<string>
): Post[] {
  const timestamps = posts.map((post) => timestampToMs(post.createdAt));
  const newestTimestamp = Math.max(...timestamps, 1);
  const oldestTimestamp = Math.min(...timestamps, newestTimestamp);
  const timestampSpan = Math.max(1, newestTimestamp - oldestTimestamp);
  const candidates = posts.map((post) => {
    const recency =
      (timestampToMs(post.createdAt) - oldestTimestamp) / timestampSpan;
    const lowVisibility = 1 / Math.sqrt(Math.max(0, post.likesCount) + 1);
    const unfamiliarAthlete =
      post.userId !== currentUserId && !followedIds.has(post.userId) ? 1 : 0;

    return {
      post,
      score:
        seededUnit(seed, post.id) * 0.45 +
        recency * 0.25 +
        lowVisibility * 0.2 +
        unfamiliarAthlete * 0.1,
    };
  });
  const ranked: Post[] = [];
  const authorCounts = new Map<string, number>();

  // Seeded scoring keeps the order stable for the session. The author penalty
  // prevents prolific athletes from filling consecutive discovery slots.
  while (candidates.length > 0) {
    let bestIndex = 0;
    let bestAdjustedScore = Number.NEGATIVE_INFINITY;
    candidates.forEach((candidate, index) => {
      const authorCount = authorCounts.get(candidate.post.userId) ?? 0;
      const repeatsPreviousAuthor =
        ranked[ranked.length - 1]?.userId === candidate.post.userId;
      const adjustedScore =
        candidate.score -
        authorCount * 0.16 -
        (repeatsPreviousAuthor ? 0.35 : 0);
      if (adjustedScore > bestAdjustedScore) {
        bestAdjustedScore = adjustedScore;
        bestIndex = index;
      }
    });
    const [{ post }] = candidates.splice(bestIndex, 1);
    ranked.push(post);
    authorCounts.set(post.userId, (authorCounts.get(post.userId) ?? 0) + 1);
  }

  return ranked;
}

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
  // ── Optional athlete context (written only when the user provides values;
  //    read back by normalizePost — fully backward-compatible) ──────────────
  sport?: string;
  position?: string;
  school?: string;
  teamName?: string;
}

export async function createPost(input: CreatePostInput): Promise<string> {
  const {
    originalMediaUrl,
    videoEdit,
    sport,
    position,
    school,
    teamName,
    ...requiredInput
  } = input;
  const payload = {
    ...requiredInput,
    ...(originalMediaUrl ? { originalMediaUrl } : {}),
    ...(videoEdit ? { videoEdit } : {}),
    ...(sport?.trim() ? { sport: sport.trim() } : {}),
    ...(position?.trim() ? { position: position.trim() } : {}),
    ...(school?.trim() ? { school: school.trim() } : {}),
    ...(teamName?.trim() ? { teamName: teamName.trim() } : {}),
    // Write all known userId aliases so docs are found regardless of which
    // field name old or future queries use.
    authorId: input.userId,
    uid:      input.userId,
    // Write avatarUrl explicitly even if input already includes it via spread,
    // so both avatar field names are always present.
    avatarUrl: input.avatarUrl ?? input.userAvatar ?? "",
    authorAvatar: input.avatarUrl ?? input.userAvatar ?? "",
    userAvatar: input.avatarUrl ?? input.userAvatar ?? "",
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

export function usePosts(
  currentUserId?: string | null,
  followedIds: Set<string> = new Set()
) {
  const [posts, setPosts] = useState<Post[]>([]);
  const [visibleCount, setVisibleCount] = useState(DISCOVERY_PAGE_SIZE);
  const [likedIds, setLikedIds] = useState<Set<string>>(new Set());
  const [loading, setLoading] = useState(true);
  const [refreshing, setRefreshing] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const discoverySeedRef = useRef(createDiscoverySeed());
  const postsRef = useRef<Post[]>([]);
  const requestIdRef = useRef(0);
  const followedIdsRef = useRef(followedIds);
  followedIdsRef.current = followedIds;

  const fetchPosts = useCallback(async (isRefresh = false) => {
    const requestId = ++requestIdRef.current;
    if (isRefresh) setRefreshing(true);
    else if (postsRef.current.length === 0) setLoading(true);
    setError(null);

    try {
      const postsSnap = await getDocs(
        query(
          collection(db, "posts"),
          orderBy("createdAt", "desc"),
          limit(DISCOVERY_INITIAL_LIMIT)
        )
      );
      if (requestId !== requestIdRef.current) return;

      const initialPosts = renderablePosts(
        postsSnap.docs
        .map((d) => normalizePost(d.id, d.data() as Record<string, unknown>))
      );

      if (isRefresh) discoverySeedRef.current = createDiscoverySeed();

      const rankedInitial = rankDiscoveryPosts(
        initialPosts,
        discoverySeedRef.current,
        currentUserId,
        followedIdsRef.current
      );
      postsRef.current = rankedInitial;
      setPosts(rankedInitial);
      setVisibleCount(DISCOVERY_INITIAL_LIMIT);
      setLoading(false);
      setRefreshing(false);
      void writeCachedFeed(rankedInitial, currentUserId);

      // Likes are presentation metadata; never hold the first feed paint for them.
      if (currentUserId) {
        void fetchLikedPostIds(
          currentUserId,
          initialPosts.map((post) => post.id)
        ).then((liked) => {
          if (requestId === requestIdRef.current) {
            setLikedIds((previous) => new Set([...previous, ...liked]));
          }
        });
      }

      // Expand the candidate pool after the first page is already usable. Using
      // the initial query's cursor avoids rereading those first 24 documents.
      const cursor = postsSnap.docs[postsSnap.docs.length - 1];
      if (cursor && postsSnap.docs.length === DISCOVERY_INITIAL_LIMIT) {
        void getDocs(
          query(
            collection(db, "posts"),
            orderBy("createdAt", "desc"),
            startAfter(cursor),
            limit(DISCOVERY_BACKGROUND_LIMIT)
          )
        )
          .then(async (backgroundSnap) => {
            if (requestId !== requestIdRef.current) return;
            const existingIds = new Set(rankedInitial.map((post) => post.id));
            const additional = renderablePosts(
              backgroundSnap.docs.map((postDoc) =>
                normalizePost(
                  postDoc.id,
                  postDoc.data() as Record<string, unknown>
                )
              )
            ).filter((post) => !existingIds.has(post.id));
            const rankedAdditional = rankDiscoveryPosts(
              additional,
              discoverySeedRef.current,
              currentUserId,
              followedIdsRef.current
            );
            const expanded = [...rankedInitial, ...rankedAdditional];
            postsRef.current = expanded;
            setPosts(expanded);
            await writeCachedFeed(expanded, currentUserId);

            if (currentUserId && additional.length > 0) {
              const backgroundLikes = await fetchLikedPostIds(
                currentUserId,
                additional.map((post) => post.id)
              );
              if (requestId === requestIdRef.current) {
                setLikedIds((previous) =>
                  new Set([...previous, ...backgroundLikes])
                );
              }
            }
          })
          .catch((backgroundError) => {
            __DEV__ &&
              console.warn("[fetchPosts] background expansion failed", backgroundError);
          });
      }
    } catch (err: unknown) {
      const code = (err as { code?: string })?.code ?? "";
      console.error("[fetchPosts] query error", { code, err });
      if (postsRef.current.length === 0 && code === "permission-denied") {
        setPosts([]);
      }
      setError(err instanceof Error ? err.message : "Failed to refresh feed");
    } finally {
      if (requestId === requestIdRef.current) {
        setLoading(false);
        setRefreshing(false);
      }
    }
  }, [currentUserId]);

  useEffect(() => {
    let cancelled = false;
    setLoading(true);
    setLikedIds(new Set());
    readCachedFeed(currentUserId).then((cached) => {
      if (cancelled) return;
      if (cached.length > 0) {
        postsRef.current = cached;
        setPosts(cached);
        setVisibleCount(DISCOVERY_INITIAL_LIMIT);
        setLoading(false);
      }
      void fetchPosts();
    });
    return () => {
      cancelled = true;
      requestIdRef.current += 1;
    };
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
  const loadMore = useCallback(() => {
    setVisibleCount((count) =>
      Math.min(count + DISCOVERY_PAGE_SIZE, posts.length)
    );
  }, [posts.length]);

  // PERF: memoize the visible window. `posts.slice()` in the return object
  // created a brand-new array identity on EVERY render of the host screen,
  // which invalidated downstream useMemo/useEffect deps (e.g. the Home feed's
  // activePosts derivation) and forced FlatList to re-diff its data prop even
  // when nothing changed. Item references were stable, so cards didn't
  // re-render — but the array identity churn was pure waste.
  const visiblePosts = useMemo(
    () => posts.slice(0, visibleCount),
    [posts, visibleCount]
  );

  return {
    posts: visiblePosts,
    likedIds,
    loading,
    refreshing,
    error,
    refresh,
    loadMore,
    hasMore: visibleCount < posts.length,
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
        return;
      }

      fetchInFlightRef.current = true;

      if (isRefresh) setRefreshing(true);
      else setLoading(true);

      try {
        // No one followed → return empty immediately
        if (followedIds.size === 0) {
          setPosts([]);
          return;
        }

        const unique = await fetchPostsByUsers(
          followedIds,
          POSTS_PER_PAGE
        );

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
