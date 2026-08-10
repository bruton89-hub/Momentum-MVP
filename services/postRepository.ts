import {
  collection,
  documentId,
  getDocs,
  limit,
  orderBy,
  query,
  Timestamp,
  where,
} from "firebase/firestore";
import { db } from "@/config/firebase";
import { excludeDeletedPosts } from "@/services/postDeletion";
import { isRemoteUri } from "@/utils/media";
import type { Post } from "@/types";
import type {
  PostVideoEdit,
  VideoAudioTrackId,
} from "@/constants/videoEditing";

const AUTHOR_FIELDS = ["userId", "authorId", "uid"] as const;
const FIRESTORE_IN_LIMIT = 10;
const PROFILE_POST_LIMIT = 30;

// ─── Author-field consolidation ──────────────────────────────────────────────
// Every post `createPost` has ever written carries all three author aliases
// (userId / authorId / uid), but posts predating that change may carry only
// one. Querying all three in parallel is what kept legacy posts visible — at
// the cost of returning, and being billed for, every modern doc three times.
//
// Once `scripts/backfill-post-user-id.js` has stamped `userId` onto every
// legacy doc, that fan-out is pure waste: set
// EXPO_PUBLIC_POSTS_USERID_BACKFILLED=true and each read collapses to a single
// indexed query — ~66% fewer document reads on profile grids and the Following
// feed, and one round trip instead of three (or of 3×N for the `in` batches).
//
// The consolidated path can also finally use orderBy("createdAt","desc"). The
// three-alias path cannot: composite indexes exist for userId+createdAt only,
// so the legacy path takes an arbitrary PROFILE_POST_LIMIT docs and sorts them
// client-side — meaning an athlete with more than 30 posts sees an arbitrary
// 30 rather than their 30 newest. Backfilling fixes that correctness bug too.
const POSTS_USERID_BACKFILLED =
  process.env.EXPO_PUBLIC_POSTS_USERID_BACKFILLED === "true";

function stringValue(value: unknown): string {
  return typeof value === "string" && value.length > 0 ? value : "";
}

const AUDIO_TRACK_IDS = new Set<VideoAudioTrackId>([
  "hype",
  "cinematic",
  "victory",
  "chill",
  "intense",
]);

function normalizeVideoEdit(value: unknown): PostVideoEdit | undefined {
  if (!value || typeof value !== "object") return undefined;
  const edit = value as Record<string, unknown>;
  const musicValue = edit.music ?? edit.audioTrackId;
  const music =
    typeof musicValue === "string" &&
    AUDIO_TRACK_IDS.has(musicValue as VideoAudioTrackId)
      ? (musicValue as VideoAudioTrackId)
      : null;
  return {
    music,
    trimStart:
      typeof (edit.trimStart ?? edit.trimStartSeconds) === "number"
        ? Math.max(0, (edit.trimStart ?? edit.trimStartSeconds) as number)
        : 0,
    trimEnd:
      typeof (edit.trimEnd ?? edit.trimEndSeconds) === "number"
        ? ((edit.trimEnd ?? edit.trimEndSeconds) as number)
        : null,
    textOverlay: stringValue(edit.textOverlay),
    // Only remote covers survive normalisation. Older builds persisted the
    // local file:// URI straight from the device thumbnail cache, which
    // resolves on the author's phone and nowhere else — every other viewer got
    // a broken image. Dropping those here repairs legacy docs at read time.
    coverUri: isRemoteUri(stringValue(edit.coverUri))
      ? stringValue(edit.coverUri)
      : null,
  };
}

export function timestampToMs(value: unknown): number {
  if (!value) return 0;
  if (value instanceof Timestamp) return value.toMillis();

  const timestamp = value as {
    seconds?: number;
    toMillis?: () => number;
  };
  if (typeof timestamp.toMillis === "function") return timestamp.toMillis();
  return typeof timestamp.seconds === "number" ? timestamp.seconds * 1000 : 0;
}

export function normalizePost(
  id: string,
  data: Record<string, unknown>
): Post {
  const userId =
    stringValue(data.userId) ||
    stringValue(data.authorId) ||
    stringValue(data.uid) ||
    stringValue(data.ownerId);
  const username =
    stringValue(data.username) ||
    stringValue(data.displayName) ||
    "Unknown";
  const mediaUrl =
    stringValue(data.mediaUrl) ||
    stringValue(data.mediaURL) ||
    stringValue(data.photoURL);
  const userAvatar =
    stringValue(data.avatarUrl) ||
    stringValue(data.authorAvatar) ||
    stringValue(data.userAvatar) ||
    stringValue(data.avatar) ||
    stringValue(data.photoURL);
  const avatarUrl =
    stringValue(data.avatarUrl) ||
    stringValue(data.authorAvatar) ||
    stringValue(data.userAvatar) ||
    stringValue(data.avatar) ||
    stringValue(data.photoURL);
  const isVideo =
    data.mediaType === "video" ||
    /\.(mp4|mov|m4v|avi|webm|mkv)(\?|#|$)/i.test(mediaUrl);

  return {
    id,
    userId,
    username,
    userAvatar,
    avatarUrl,
    mediaUrl,
    mediaType: isVideo ? "video" : "image",
    caption: stringValue(data.caption),
    likesCount: typeof data.likesCount === "number" ? data.likesCount : 0,
    battleEnabled:
      typeof data.battleEnabled === "boolean" ? data.battleEnabled : false,
    originalMediaUrl: stringValue(data.originalMediaUrl) || undefined,
    videoEdit: normalizeVideoEdit(data.videoEdit),
    createdAt: (data.createdAt as Timestamp) ?? null,
    // ── Optional athlete identity / status fields (tolerant of alias names) ──
    sport:
      stringValue(data.sport) || stringValue(data.athleteType) || undefined,
    position:
      stringValue(data.position) ||
      stringValue(data.playerPosition) ||
      undefined,
    school:
      stringValue(data.school) || stringValue(data.schoolName) || undefined,
    teamName:
      stringValue(data.teamName) || stringValue(data.team) || undefined,
    city: stringValue(data.city) || undefined,
    state:
      stringValue(data.state) || stringValue(data.region) || undefined,
    gradYear: normalizeGradYear(
      data.gradYear ?? data.graduationYear ?? data.classOf
    ),
    verified: data.verified === true || data.isVerified === true || undefined,
    momentumScore:
      typeof data.momentumScore === "number" ? data.momentumScore : undefined,
    isLive: data.isLive === true || undefined,
    battleWon: data.battleWon === true || undefined,
    pinned: data.pinned === true || data.isPinned === true || undefined,
    commentsCount:
      typeof data.commentsCount === "number" ? data.commentsCount : undefined,
  };
}

function normalizeGradYear(value: unknown): string | undefined {
  if (typeof value === "number" && Number.isFinite(value)) return String(value);
  if (typeof value === "string" && value.trim()) return value.trim();
  return undefined;
}

function deduplicateAndSort(posts: Post[]): Post[] {
  const unique = new Map<string, Post>();
  for (const post of posts) {
    if (post.mediaUrl && !unique.has(post.id)) {
      unique.set(post.id, post);
    }
  }
  return Array.from(unique.values()).sort(
    (a, b) => timestampToMs(b.createdAt) - timestampToMs(a.createdAt)
  );
}

function postsFromSnapshots(
  snapshots: { docs: { id: string; data: () => unknown }[] }[]
): Post[] {
  return deduplicateAndSort(
    snapshots.flatMap((snapshot) =>
      snapshot.docs.map((postDoc) =>
        normalizePost(postDoc.id, postDoc.data() as Record<string, unknown>)
      )
    )
  );
}

export async function fetchPostsByUser(userId: string): Promise<Post[]> {
  if (POSTS_USERID_BACKFILLED) {
    // One indexed query (posts: userId ASC, createdAt DESC) instead of three
    // unordered scans — and genuinely the newest posts, not an arbitrary page.
    const snapshot = await getDocs(
      query(
        collection(db, "posts"),
        where("userId", "==", userId),
        orderBy("createdAt", "desc"),
        limit(PROFILE_POST_LIMIT)
      )
    );
    return excludeDeletedPosts(postsFromSnapshots([snapshot]));
  }

  const snapshots = await Promise.all(
    AUTHOR_FIELDS.map((field) =>
      getDocs(
        query(
          collection(db, "posts"),
          where(field, "==", userId),
          limit(PROFILE_POST_LIMIT)
        )
      )
    )
  );

  return excludeDeletedPosts(deduplicateAndSort(
    snapshots.flatMap((snapshot) =>
      snapshot.docs.map((postDoc) =>
        normalizePost(
          postDoc.id,
          postDoc.data() as Record<string, unknown>
        )
      )
    )
  ));
}

/**
 * The newest posts, ordered by the server.
 *
 * One indexed query on a single collection — the same shape the Home feed
 * already runs. Discover derives every one of its sections from this single
 * result rather than issuing a query per rail.
 */
export async function fetchRecentPosts(max: number): Promise<Post[]> {
  const snapshot = await getDocs(
    query(
      collection(db, "posts"),
      orderBy("createdAt", "desc"),
      limit(max)
    )
  );
  return excludeDeletedPosts(
    snapshot.docs
      .map((postDoc) =>
        normalizePost(postDoc.id, postDoc.data() as Record<string, unknown>)
      )
      .filter((post) => !!post.mediaUrl)
  );
}

/**
 * Fetch posts by document id, batched to Firestore's 10-item `in` cap.
 *
 * Missing ids are simply absent from the result — a post deleted after it was
 * saved or referenced shouldn't fail the whole read.
 */
export async function fetchPostsByIds(postIds: string[]): Promise<Post[]> {
  const ids = Array.from(new Set(postIds.filter(Boolean)));
  if (ids.length === 0) return [];

  const batches: string[][] = [];
  for (let index = 0; index < ids.length; index += FIRESTORE_IN_LIMIT) {
    batches.push(ids.slice(index, index + FIRESTORE_IN_LIMIT));
  }

  const snapshots = await Promise.all(
    batches.map((batch) =>
      getDocs(
        query(collection(db, "posts"), where(documentId(), "in", batch))
      )
    )
  );

  return excludeDeletedPosts(postsFromSnapshots(snapshots));
}

export async function fetchPostsByUsers(
  userIds: Iterable<string>,
  resultLimit: number
): Promise<Post[]> {
  const ids = Array.from(new Set(userIds));
  if (ids.length === 0) return [];

  const batches: string[][] = [];
  for (let index = 0; index < ids.length; index += FIRESTORE_IN_LIMIT) {
    batches.push(ids.slice(index, index + FIRESTORE_IN_LIMIT));
  }

  if (POSTS_USERID_BACKFILLED) {
    // One query per batch of 10 authors instead of three, each returning that
    // batch's newest posts rather than an arbitrary slice.
    const snapshots = await Promise.all(
      batches.map((batch) =>
        getDocs(
          query(
            collection(db, "posts"),
            where("userId", "in", batch),
            orderBy("createdAt", "desc"),
            limit(resultLimit)
          )
        )
      )
    );
    return excludeDeletedPosts(postsFromSnapshots(snapshots)).slice(
      0,
      resultLimit
    );
  }

  const snapshots = await Promise.all(
    AUTHOR_FIELDS.flatMap((field) =>
      batches.map((batch) =>
        getDocs(
          query(
            collection(db, "posts"),
            where(field, "in", batch),
            limit(resultLimit)
          )
        )
      )
    )
  );

  return excludeDeletedPosts(deduplicateAndSort(
    snapshots.flatMap((snapshot) =>
      snapshot.docs.map((postDoc) =>
        normalizePost(
          postDoc.id,
          postDoc.data() as Record<string, unknown>
        )
      )
    )
  )).slice(0, resultLimit);
}
