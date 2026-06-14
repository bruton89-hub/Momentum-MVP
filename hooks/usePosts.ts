import { useState, useCallback, useEffect, useRef } from "react";
import {
  collection,
  query,
  orderBy,
  limit,
  getDocs,
  getDoc,
  addDoc,
  updateDoc,
  doc,
  serverTimestamp,
  where,
  runTransaction,
  increment,
  Timestamp,
} from "firebase/firestore";
import { ref, uploadBytesResumable, getDownloadURL } from "firebase/storage";
import { Platform } from "react-native";
import { db, storage } from "@/config/firebase";
import type { Post } from "@/types";

const POSTS_PER_PAGE = 20;

// ─── Normalize raw Firestore data into a typed Post ───────────────────────────
// Post documents may come from different app versions with missing or differently
// typed fields. Extract every field defensively to avoid undefined/NaN at render.
//
// Field aliases accepted (legacy schema compatibility):
//   userId   ← userId | authorId | uid | ownerId
//   username ← username | displayName
//   mediaUrl ← mediaUrl | mediaURL | photoURL
//   userAvatar ← userAvatar | avatarUrl | avatar | photoURL

function str(value: unknown): string {
  return typeof value === "string" && value.length > 0 ? value : "";
}

export function normalizePost(id: string, data: Record<string, unknown>): Post {
  // Resolve userId from any of the known alias fields written by old app versions
  const userId =
    str(data.userId) ||
    str(data.authorId) ||
    str(data.uid) ||
    str(data.ownerId);

  // Resolve display name
  const username =
    str(data.username) ||
    str(data.displayName) ||
    "Unknown";

  // Resolve media URL — some versions used camelCase mediaURL or photoURL
  const mediaUrl =
    str(data.mediaUrl) ||
    str(data.mediaURL) ||
    str(data.photoURL);

  // Resolve avatar — prefer dedicated avatar field, fall back to photoURL
  const userAvatar =
    str(data.userAvatar) ||
    str(data.avatarUrl) ||
    str(data.avatar) ||
    str(data.photoURL);

  const avatarUrl =
    str(data.avatarUrl) ||
    str(data.userAvatar) ||
    str(data.avatar);

  // Infer mediaType from URL extension for legacy posts that stored "image"
  // even though the URL points to an .mp4 / .mov file. VIDEO_EXT_RE matches
  // the extension immediately before an optional query string or hash.
  const VIDEO_EXT_RE = /\.(mp4|mov|m4v|avi|webm|mkv)(\?|#|$)/i;
  const inferredMediaType: "video" | "image" =
    data.mediaType === "video" || VIDEO_EXT_RE.test(mediaUrl)
      ? "video"
      : "image";

  return {
    id,
    userId,
    username,
    userAvatar,
    avatarUrl,
    mediaUrl,
    mediaType:     inferredMediaType,
    caption:       str(data.caption),
    likesCount:    typeof data.likesCount === "number" ? data.likesCount : 0,
    battleEnabled: typeof data.battleEnabled === "boolean" ? data.battleEnabled : false,
    createdAt:     (data.createdAt as Timestamp) ?? null,
  };
}

// ─── Upload media to Firebase Storage ────────────────────────────────────────

export async function uploadMedia(
  uri: string,
  userId: string,
  onProgress?: (pct: number) => void
): Promise<string> {
  console.log("[uploadMedia] input URI", uri);
  console.log("[uploadMedia] platform", Platform.OS);
  console.log("[uploadMedia] storage bucket", storage.app.options.storageBucket);

  const blob = await uriToBlob(uri);
  console.log("[uploadMedia] blob created", {
    size: blob.size,
    type: blob.type,
  });

  const ext = extensionFromBlob(blob) || extensionFromUri(uri) || "jpg";
  const filename = `posts/${userId}/${Date.now()}.${ext}`;
  console.log("[uploadMedia] Firebase Storage ref path", filename);
  const storageRef = ref(storage, filename);

  return new Promise<string>((resolve, reject) => {
    const task = uploadBytesResumable(storageRef, blob, {
      contentType: blob.type || (ext === "mp4" ? "video/mp4" : "image/jpeg"),
    });
    task.on(
      "state_changed",
      (snap) => {
        console.log("[uploadMedia] uploadBytes state", {
          state: snap.state,
          bytesTransferred: snap.bytesTransferred,
          totalBytes: snap.totalBytes,
        });
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
          console.log("[uploadMedia] uploadBytes result", {
            fullPath: task.snapshot.ref.fullPath,
            size: task.snapshot.metadata.size,
            contentType: task.snapshot.metadata.contentType,
          });
          const url = await getDownloadURL(task.snapshot.ref);
          console.log("[uploadMedia] getDownloadURL result", url);
          onProgress?.(100);
          resolve(url);
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
    console.log("[uploadMedia] fetch(uri) result", {
      ok: response.ok,
      status: response.status,
      type: response.type,
    });
    if (!response.ok) {
      throw new Error(`Media fetch failed with status ${response.status}`);
    }
    return response.blob();
  }

  return new Promise<Blob>((resolve, reject) => {
    const xhr = new XMLHttpRequest();
    xhr.onload = () => {
      console.log("[uploadMedia] native XHR result", {
        status: xhr.status,
        responseType: xhr.responseType,
      });
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

// ─── Timestamp helper (used by sorting in useUserPosts + useFollowingPosts) ───

function getTimestampMs(ts: Post["createdAt"]): number {
  if (!ts) return 0;
  if (ts instanceof Timestamp) return ts.toMillis();
  return (ts as { seconds: number }).seconds * 1000;
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
}

export async function createPost(input: CreatePostInput): Promise<string> {
  const payload = {
    ...input,
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
  console.log("[createPost] Firestore payload", {
    userId: payload.userId,
    authorId: payload.authorId,
    uid: payload.uid,
    username: payload.username,
    userAvatar: payload.userAvatar,
    avatarUrl: payload.avatarUrl,
    mediaUrl: payload.mediaUrl,
    mediaType: payload.mediaType,
    caption: payload.caption,
    likesCount: payload.likesCount,
    battleEnabled: payload.battleEnabled,
    createdAt: payload.createdAt.toMillis(),
  });
  const docRef = await addDoc(collection(db, "posts"), payload);
  console.log("[createPost] Firestore post created, docId =", docRef.id);

  // Verify the doc is immediately readable (confirms write succeeded)
  try {
    const snap = await getDoc(docRef);
    console.log("[createPost] post doc snapshot — exists:", snap.exists(),
      "createdAt:", snap.data()?.createdAt ?? "null",
      "userId:", snap.data()?.userId ?? "missing");
  } catch (snapErr) {
    console.warn("[createPost] post doc snapshot read failed (non-fatal):", snapErr);
  }

  // ── Non-fatal posts counter ─────────────────────────────────────────────────
  // Firestore rules may restrict writes to users/{userId}.  If this increment
  // fails it must NOT throw — the post document was already written and the user
  // should NOT see "Post failed".  Counter inaccuracy is recoverable; losing the
  // navigation to Home is not.
  try {
    await updateDoc(doc(db, "users", input.userId), {
      posts: increment(1),
    });
    console.log("[createPost] posts counter incremented");
  } catch (counterErr) {
    console.warn("[createPost] posts counter increment failed (non-fatal):", counterErr);
  }

  return docRef.id;
}

// ─── Toggle like (transaction-safe) ──────────────────────────────────────────

export async function toggleLike(
  postId: string,
  userId: string
): Promise<"liked" | "unliked"> {
  const likeRef = doc(db, "likes", `${postId}_${userId}`);
  const postRef = doc(db, "posts", postId);

  return await runTransaction(db, async (tx) => {
    const likeSnap = await tx.get(likeRef);
    if (likeSnap.exists()) {
      tx.delete(likeRef);
      tx.update(postRef, { likesCount: increment(-1) });
      return "unliked";
    } else {
      tx.set(likeRef, { postId, userId, createdAt: serverTimestamp() });
      tx.update(postRef, { likesCount: increment(1) });
      return "liked";
    }
  });
}

// ─── Check if current user liked a post ──────────────────────────────────────
// Wrapped in try/catch: the `likes` collection may not exist yet or may be
// restricted by project-level Firestore rules. A failure here must never
// block the main feed from rendering.

export async function fetchLikedPostIds(userId: string): Promise<Set<string>> {
  try {
    const snap = await getDocs(
      query(collection(db, "likes"), where("userId", "==", userId))
    );
    const ids = new Set<string>();
    snap.forEach((d) => ids.add(d.data().postId as string));
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
      // fetchLikedPostIds already handles its own errors and returns empty Set.
      // Run both fetches concurrently; likes failure never blocks the feed.
      const [postsSnap, liked] = await Promise.all([
        getDocs(
          query(
            collection(db, "posts"),
            orderBy("createdAt", "desc"),
            limit(POSTS_PER_PAGE)
          )
        ),
        currentUserId
          ? fetchLikedPostIds(currentUserId)
          : Promise.resolve(new Set<string>()),
      ]);

      const rawCount = postsSnap.docs.length;
      const rawIds = postsSnap.docs.map((d) => d.id);
      console.log("[fetchPosts] fetched doc ids:", rawIds);

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
      const keptIds = fetched.map((p) => p.id);
      console.log("[fetchPosts] raw docs:", rawCount, "→ kept:", fetched.length);
      console.log("[fetchPosts] kept doc ids:", keptIds);

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
      console.log("[handleLike] called — postId:", postId, "currentUserId:", currentUserId);
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
        await toggleLike(postId, currentUserId);
        console.log("[handleLike] Firestore sync success — postId:", postId);
      } catch (err) {
        console.error("[handleLike] Firestore sync failed — reverting:", err);
        // Revert on failure — read latest state from ref for accurate revert
        setLikedIds(new Set(likedIdsRef.current));
        setPosts((prev) =>
          prev.map((p) =>
            p.id === postId
              ? { ...p, likesCount: p.likesCount + (alreadyLiked ? 1 : -1) }
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
      // Three parallel queries — one per known author-field alias
      const [byUserId, byAuthorId, byUid] = await Promise.all([
        getDocs(query(collection(db, "posts"), where("userId",   "==", userId))),
        getDocs(query(collection(db, "posts"), where("authorId", "==", userId))),
        getDocs(query(collection(db, "posts"), where("uid",      "==", userId))),
      ]);

      // Deduplicate by doc ID (a post with all three fields would appear 3×)
      const seen = new Set<string>();
      const normalized: Post[] = [];
      for (const snap of [byUserId, byAuthorId, byUid]) {
        for (const d of snap.docs) {
          if (seen.has(d.id)) continue;
          seen.add(d.id);
          const p = normalizePost(d.id, d.data() as Record<string, unknown>);
          if (p.mediaUrl) normalized.push(p);
        }
      }

      // Sort newest-first client-side
      normalized.sort((a, b) => getTimestampMs(b.createdAt) - getTimestampMs(a.createdAt));
      console.log("[fetchUserPosts] userId:", userId, "→ kept:", normalized.length);
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
        console.log("[followingFeed] fetch skipped — request already in flight");
        return;
      }

      fetchInFlightRef.current = true;

      if (isRefresh) setRefreshing(true);
      else setLoading(true);

      try {
        console.log("[followingFeed] followedIds:", Array.from(followedIds));

        // No one followed → return empty immediately
        if (followedIds.size === 0) {
          setPosts([]);
          return;
        }

        // Firestore `in` supports max 10 values — batch into groups of 10
        const ids = Array.from(followedIds);
        const batches: string[][] = [];
        for (let i = 0; i < ids.length; i += 10) {
          batches.push(ids.slice(i, i + 10));
        }

        // ── Query all known userId field aliases in parallel ────────────────
        // Old Firestore docs may store the author under `authorId` or `uid`
        // instead of `userId`. We cannot OR across fields in a single Firestore
        // query, so we run three separate batch queries and deduplicate by doc ID.
        //
        // `orderBy` is intentionally omitted here: combining `where("userId","in",...)`
        // with `orderBy("createdAt")` requires a composite index that may not be
        // deployed. Without `orderBy` these are single-field queries — always
        // auto-indexed by Firestore. Sorting happens client-side below.
        const [userIdSnaps, authorIdSnaps, uidSnaps] = await Promise.all([
          Promise.all(
            batches.map((batch) =>
              getDocs(query(collection(db, "posts"), where("userId",   "in", batch), limit(POSTS_PER_PAGE)))
            )
          ),
          Promise.all(
            batches.map((batch) =>
              getDocs(query(collection(db, "posts"), where("authorId", "in", batch), limit(POSTS_PER_PAGE)))
            )
          ),
          Promise.all(
            batches.map((batch) =>
              getDocs(query(collection(db, "posts"), where("uid",      "in", batch), limit(POSTS_PER_PAGE)))
            )
          ),
        ]);

        const allSnaps = [...userIdSnaps, ...authorIdSnaps, ...uidSnaps];

        const fetchedPosts: Post[] = allSnaps.flatMap((snap) =>
          snap.docs.map((d) =>
            normalizePost(d.id, d.data() as Record<string, unknown>)
          )
        );

        const renderablePosts = fetchedPosts.filter((p) => !!p.mediaUrl);

        const sortedPosts = renderablePosts
          .sort((a, b) => getTimestampMs(b.createdAt) - getTimestampMs(a.createdAt));

        // Final safety dedup before logging and before setPosts. Alias queries
        // can return the same document up to three times when userId, authorId,
        // and uid are all present.
        const unique = Array.from(new Map(sortedPosts.map(p => [p.id, p])).values())
          .slice(0, POSTS_PER_PAGE);

        console.log("[followingFeed] raw count:", fetchedPosts.length);
        console.log("[followingFeed] unique count:", unique.length);
        console.log("[followingFeed] unique ids:", unique.map((p) => p.id));

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
