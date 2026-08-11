import { useState, useCallback, useEffect, useMemo, useRef } from "react";
import {
  collection,
  query,
  orderBy,
  limit,
  getDocs,
  getDoc,
  startAfter,
  doc,
  setDoc,
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
} from "@/services/postRepository";
import { createFeedSeed, rankFeed, viewerContextFrom } from "@/services/feedRanking";
import { invalidateDiscoverPool } from "@/services/discoverRepository";
import type { Post, UserProfile } from "@/types";
import type { PostVideoEdit } from "@/constants/videoEditing";
import { startDevTimer } from "@/utils/performance";
import {
  loadMediaBlob,
  mediaSourceMimeType,
  mediaSourceUri,
  type MediaUploadSource,
} from "@/utils/mediaUpload";
import {
  excludeDeletedPosts,
  subscribeToPostDeletions,
} from "@/services/postDeletion";
import type { CreationMutation } from "@/utils/creationMutation";
import { createCreationMutation } from "@/utils/creationMutation";
import { isLatestGeneration } from "@/utils/remediationGuards";

const POSTS_PER_PAGE = 20;
const DISCOVERY_INITIAL_LIMIT = 24;
const DISCOVERY_BACKGROUND_LIMIT = 56;
const DISCOVERY_PAGE_SIZE = 12;
const FEED_CACHE_PREFIX = "momentum:feed:v1";
export const MAX_POST_MEDIA_BYTES = 50 * 1024 * 1024;

function feedCacheKey(userId?: string | null): string {
  return `${FEED_CACHE_PREFIX}:${userId || "guest"}`;
}

// ─── Feed freshness ───────────────────────────────────────────────────────────
// Home used to re-fetch on EVERY focus: up to 80 post documents plus the
// follows list, every time you came back from Profile, Battles, or a modal.
// That was deliberate — it's how a highlight you just published appears after
// router.replace("/") — but it made routine tab-switching cost a network round
// trip and a visible refresh spinner.
//
// Focus now refreshes only when the pool is actually stale: either the TTL has
// elapsed, or something changed the pool. `invalidateFeeds()` is called on
// publish, so publishing still lands you on a feed containing your new post.
// Pull-to-refresh is unaffected and always forces a real fetch.
//
// A generation counter rather than a boolean, because For You and Following
// read the signal independently — a boolean let whichever refreshed first
// consume the invalidation and leave the other showing stale data.
const FEED_FRESHNESS_MS = 60_000;
let feedGeneration = 0;

export function invalidateFeeds(): void {
  feedGeneration += 1;
}

/** Tracks whether a given feed consumer has seen the latest generation. */
function useFeedFreshness() {
  const lastGenerationRef = useRef(-1);
  const lastFetchedAtRef = useRef(0);

  const isStale = useCallback(
    () =>
      lastGenerationRef.current !== feedGeneration ||
      Date.now() - lastFetchedAtRef.current > FEED_FRESHNESS_MS,
    []
  );
  const markFresh = useCallback(() => {
    lastGenerationRef.current = feedGeneration;
    lastFetchedAtRef.current = Date.now();
  }, []);

  return { isStale, markFresh };
}

function renderablePosts(posts: Post[]): Post[] {
  const unique = new Map<string, Post>();
  posts.forEach((post) => {
    if (post.mediaUrl && !unique.has(post.id)) unique.set(post.id, post);
  });
  return excludeDeletedPosts(Array.from(unique.values()));
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

// Ranking lives in services/feedRanking.ts. The previous inline model was
// dominated by a 0.45-weight random term, which meant the feed was mostly
// shuffle: a great new highlight and a stale one had near-identical odds, and
// nothing about the viewer mattered. See docs/feed-ranking.md.

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
  source: MediaUploadSource,
  userId: string,
  onProgress?: (pct: number) => void
): Promise<string> {
  return (await uploadMediaWithPath(source, userId, onProgress)).url;
}

export type { MediaUploadSource } from "@/utils/mediaUpload";

export interface UploadedMedia {
  url: string;
  fullPath: string;
}

export async function uploadMediaWithPath(
  source: MediaUploadSource,
  userId: string,
  onProgress?: (pct: number) => void,
  filenamePrefix = "post"
): Promise<UploadedMedia> {
  const uri = mediaSourceUri(source);
  const declaredMimeType = mediaSourceMimeType(source);
  const originalFileName =
    typeof source === "string" ? null : source.fileName?.trim() || null;

  let blob: Blob;
  try {
    blob = await loadMediaBlob(source, Platform.OS);
  } catch (error) {
    const detail = error instanceof Error ? error.message : "Unknown file read error.";
    throw new Error(`Selected media could not be read. ${detail}`);
  }
  if (blob.size > MAX_POST_MEDIA_BYTES) {
    throw new Error("Media must be 50 MB or smaller.");
  }
  if (blob.size === 0) {
    throw new Error("Selected media is empty. Choose the file again and retry.");
  }

  const ext =
    extensionFromBlob(blob) ||
    (originalFileName ? extensionFromUri(originalFileName) : null) ||
    extensionFromUri(uri) ||
    (declaredMimeType?.startsWith("video/") ? "mp4" : "jpg");
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
        const code = typeof err?.code === "string" ? ` (${err.code})` : "";
        reject(new Error(`Firebase Storage upload failed${code}. ${err.message || "Check your connection and try again."}`));
      },
      async () => {
        try {
          const url = await getDownloadURL(task.snapshot.ref);
          onProgress?.(100);
          resolve({ url, fullPath: task.snapshot.ref.fullPath });
        } catch (err) {
          console.error("[uploadMedia] getDownloadURL error", err);
          const detail = err instanceof Error ? err.message : "Unknown download URL error.";
          reject(new Error(`Upload finished, but its download URL could not be retrieved. ${detail}`));
        }
      }
    );
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

export async function createPost(
  input: CreatePostInput,
  mutation: CreationMutation = createCreationMutation("post")
): Promise<string> {
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
    createdAt: Timestamp.fromMillis(mutation.createdAtMs),
    updatedAt: Timestamp.fromMillis(mutation.createdAtMs),
  };
  const docRef = doc(db, "posts", mutation.documentId);
  try {
    await setDoc(docRef, payload);
  } catch (writeError) {
    // The first write may have committed and then progressed (for example, an
    // owner edit) before this replay. Resolve the preallocated identity as
    // success only when the existing document still belongs to this creator.
    const existing = await getDoc(docRef).catch(() => null);
    if (!existing?.exists() || existing.data().userId !== input.userId) {
      throw writeError;
    }
  }
  // The pool just changed — the next Home focus must re-fetch rather than serve
  // a cached page that is missing the highlight this athlete just published.
  // Discover derives all of its rails from its own cached pool, so that has to
  // be dropped too or a new highlight can't appear there either.
  invalidateFeeds();
  invalidateDiscoverPool();

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
  followedIds: Set<string> = new Set(),
  /** Viewer profile — drives the relevance term. Optional; ranking degrades
   *  gracefully to recency + engagement when it's absent. */
  viewerProfile?: UserProfile | null
) {
  const [posts, setPosts] = useState<Post[]>([]);
  const [visibleCount, setVisibleCount] = useState(DISCOVERY_PAGE_SIZE);
  const [likedIds, setLikedIds] = useState<Set<string>>(new Set());
  const [loading, setLoading] = useState(true);
  const [refreshing, setRefreshing] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const discoverySeedRef = useRef(createFeedSeed());
  const postsRef = useRef<Post[]>([]);
  const requestIdRef = useRef(0);
  const followedIdsRef = useRef(followedIds);
  followedIdsRef.current = followedIds;
  // Read through a ref so a profile hydrating after mount doesn't rebuild
  // fetchPosts and retrigger the whole feed load.
  const viewerProfileRef = useRef(viewerProfile);
  viewerProfileRef.current = viewerProfile;
  const { isStale, markFresh } = useFeedFreshness();

  useEffect(
    () =>
      subscribeToPostDeletions((postId) => {
        const remaining = postsRef.current.filter((post) => post.id !== postId);
        postsRef.current = remaining;
        setPosts(remaining);
        setLikedIds((previous) => {
          if (!previous.has(postId)) return previous;
          const next = new Set(previous);
          next.delete(postId);
          return next;
        });
        void writeCachedFeed(remaining, currentUserId);
      }),
    [currentUserId]
  );

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

      // A fresh seed per pull-to-refresh: the jitter term is the only thing
      // that changes, so the feed visibly moves without the ranking flipping.
      if (isRefresh) discoverySeedRef.current = createFeedSeed();

      const viewer = viewerContextFrom(
        currentUserId,
        viewerProfileRef.current,
        followedIdsRef.current
      );
      const rankedInitial = rankFeed(
        initialPosts,
        viewer,
        discoverySeedRef.current
      );
      postsRef.current = rankedInitial;
      setPosts(rankedInitial);
      setVisibleCount(DISCOVERY_INITIAL_LIMIT);
      setLoading(false);
      setRefreshing(false);
      markFresh();
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
            // Ranked as its own block and appended, never re-ranked with the
            // first page: reordering posts the athlete may already be looking
            // at would move content under their thumb mid-scroll.
            const rankedAdditional = rankFeed(
              additional,
              viewerContextFrom(
                currentUserId,
                viewerProfileRef.current,
                followedIdsRef.current
              ),
              discoverySeedRef.current
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
  }, [currentUserId, markFresh]);

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
  // Focus-time refresh. Skips the network entirely when the pool is still fresh
  // and nothing has published since the last fetch.
  const refreshIfStale = useCallback(() => {
    if (!isStale()) return;
    void fetchPosts(true);
  }, [fetchPosts, isStale]);
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
    refreshIfStale,
    loadMore,
    hasMore: visibleCount < posts.length,
    handleLike,
  };
}

// ─── Hook: posts by a specific user ──────────────────────────────────────────
// Author lookup lives in services/postRepository.ts. By default it queries all
// three known userId aliases (userId, authorId, uid) in parallel so legacy docs
// that stored only authorId still reach the profile grid — at the cost of
// returning every modern doc three times, and of sorting client-side over an
// arbitrary page rather than ordering in the query.
//
// The composite index this needs (posts: userId ASC, createdAt DESC) IS
// deployed in firestore.indexes.json — an earlier note here claiming otherwise
// was stale. After running scripts/backfill-post-user-id.js, setting
// EXPO_PUBLIC_POSTS_USERID_BACKFILLED=true collapses this to one ordered query.

export function useUserPosts(userId: string | null) {
  const [posts, setPosts] = useState<Post[]>([]);
  const [loading, setLoading] = useState(false);
  const requestIdRef = useRef(0);

  useEffect(
    () => subscribeToPostDeletions((postId) => {
      setPosts((current) => current.filter((post) => post.id !== postId));
    }),
    []
  );

  const load = useCallback(async () => {
    const requestId = ++requestIdRef.current;
    if (!userId) {
      setPosts([]);
      setLoading(false);
      return;
    }
    setLoading(true);
    const stopTimer = startDevTimer(`posts for user ${userId}`);
    try {
      const normalized = await fetchPostsByUser(userId);
      if (requestId === requestIdRef.current) {
        setPosts(excludeDeletedPosts(normalized));
      }
    } catch (err) {
      console.error("[fetchUserPosts] query failed:", err);
      if (requestId === requestIdRef.current) setPosts([]);
    } finally {
      stopTimer();
      if (requestId === requestIdRef.current) setLoading(false);
    }
  }, [userId]);

  useEffect(() => {
    void load();
    return () => {
      requestIdRef.current += 1;
    };
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
  const requestIdRef = useRef(0);
  const inFlightKeysRef = useRef(new Set<string>());
  const { isStale, markFresh } = useFeedFreshness();

  useEffect(
    () => subscribeToPostDeletions((postId) => {
      setPosts((current) => current.filter((post) => post.id !== postId));
    }),
    []
  );

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

      const queryKey = `${currentUserId ?? "signed-out"}:${followedKey}`;
      // Deduplicate identical refreshes, but never let an older follow set block
      // the new generation from starting its own request.
      if (inFlightKeysRef.current.has(queryKey)) {
        return;
      }

      const requestId = ++requestIdRef.current;
      inFlightKeysRef.current.add(queryKey);

      if (isRefresh) setRefreshing(true);
      else setLoading(true);

      try {
        // No one followed → return empty immediately
        if (followedIds.size === 0) {
          if (isLatestGeneration(requestId, requestIdRef.current)) setPosts([]);
          return;
        }

        const unique = await fetchPostsByUsers(
          followedIds,
          POSTS_PER_PAGE
        );

        // Replace results. Do not append: focus refreshes and followed-id changes
        // should never stack duplicate batches into existing feed state.
        if (isLatestGeneration(requestId, requestIdRef.current)) {
          setPosts(excludeDeletedPosts(unique));
          markFresh();
        }
      } catch (err) {
        // Surface the real error code so a FAILED_PRECONDITION (missing index)
        // or PERMISSION_DENIED isn't silently swallowed as an empty feed.
        const code = (err as { code?: string })?.code ?? "unknown";
        console.error("[followingFeed] query failed — code:", code, err);
        if (isLatestGeneration(requestId, requestIdRef.current)) setPosts([]);
      } finally {
        inFlightKeysRef.current.delete(queryKey);
        if (isLatestGeneration(requestId, requestIdRef.current)) {
          setLoading(false);
          setRefreshing(false);
        }
      }
    },
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [currentUserId, followedKey, followsLoading, markFresh]
  );

  useEffect(() => {
    void fetchPosts();
    return () => {
      requestIdRef.current += 1;
    };
  }, [fetchPosts]);

  // Stable refresh reference — wrapped so its identity only changes when
  // fetchPosts itself changes (i.e. when followedKey/followsLoading changes).
  const refresh = useCallback(() => fetchPosts(true), [fetchPosts]);
  const refreshIfStale = useCallback(() => {
    if (!isStale()) return;
    void fetchPosts(true);
  }, [fetchPosts, isStale]);

  return {
    posts,
    // Combine loading states: still loading if follows haven't resolved yet
    loading: followsLoading || loading,
    refreshing,
    refresh,
    refreshIfStale,
  };
}
