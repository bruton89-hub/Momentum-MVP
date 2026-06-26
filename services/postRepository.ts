import {
  collection,
  getDocs,
  limit,
  query,
  Timestamp,
  where,
} from "firebase/firestore";
import { db } from "@/config/firebase";
import type { Post } from "@/types";
import type {
  PostVideoEdit,
  VideoAudioTrackId,
} from "@/constants/videoEditing";

const AUTHOR_FIELDS = ["userId", "authorId", "uid"] as const;
const FIRESTORE_IN_LIMIT = 10;
const PROFILE_POST_LIMIT = 30;

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
    coverUri: stringValue(edit.coverUri) || null,
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
    stringValue(data.userAvatar) ||
    stringValue(data.avatarUrl) ||
    stringValue(data.avatar) ||
    stringValue(data.photoURL);
  const avatarUrl =
    stringValue(data.avatarUrl) ||
    stringValue(data.userAvatar) ||
    stringValue(data.avatar);
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
  };
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

export async function fetchPostsByUser(userId: string): Promise<Post[]> {
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

  return deduplicateAndSort(
    snapshots.flatMap((snapshot) =>
      snapshot.docs.map((postDoc) =>
        normalizePost(
          postDoc.id,
          postDoc.data() as Record<string, unknown>
        )
      )
    )
  );
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

  return deduplicateAndSort(
    snapshots.flatMap((snapshot) =>
      snapshot.docs.map((postDoc) =>
        normalizePost(
          postDoc.id,
          postDoc.data() as Record<string, unknown>
        )
      )
    )
  ).slice(0, resultLimit);
}
