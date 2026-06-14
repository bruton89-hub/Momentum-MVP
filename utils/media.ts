/**
 * Media utility helpers — URL normalisation, validation, and type detection.
 *
 * WHY THESE EXIST
 * ───────────────
 * Old Firestore posts were written by app versions that:
 *   1. Stored mediaType: "image" even when mediaUrl ends in .mp4/.mov (legacy upload bug)
 *   2. Stored truncated Firebase Storage URLs without ?alt=media (metadata only, not bytes)
 *   3. Stored empty or undefined mediaUrl fields
 *   4. Stored Firebase Storage URLs with double-encoded paths (%252F) or unencoded paths
 *
 * Passing a .mp4 URL to Image.prefetch / <Image> causes "Error decoding image data".
 * Passing a URL without ?alt=media returns JSON metadata, not image bytes.
 *
 * These helpers are the single source of truth for all media decisions across
 * MediaTile, PostCard, and normalizePost.
 */
import * as VideoThumbnails from "expo-video-thumbnails";

const videoThumbnailCache = new Map<string, string>();
const videoThumbnailRequests = new Map<string, Promise<string>>();

// ─── Firebase Storage URL normaliser ─────────────────────────────────────────
/**
 * Accepts any variant of a Firebase Storage download URL and returns a
 * canonically encoded URL that NSURL on iOS can parse without rewriting.
 *
 * Handles three stored forms:
 *   • Correct:        .../o/posts%2Ffilename.jpg?alt=media&token=...
 *   • Double-encoded: .../o/posts%252Ffilename.jpg?...
 *   • Decoded path:   .../o/posts/filename.jpg?...
 *
 * Always ensures ?alt=media is present so Firebase returns bytes, not metadata.
 * Falls back to the raw input on any parse error — never silently drops a URL.
 */
export function normalizeFirebaseStorageUrl(input?: string | null): string {
  if (!input) return "";

  const raw = input.trim();

  try {
    const url = new URL(raw);

    if (!url.hostname.includes("firebasestorage.googleapis.com")) {
      return raw;
    }

    const parts = url.pathname.split("/");
    const bucketIndex = parts.indexOf("b");
    const objectIndex = parts.indexOf("o");

    const bucket = bucketIndex >= 0 ? parts[bucketIndex + 1] : "";
    const encodedObject =
      objectIndex >= 0 ? parts.slice(objectIndex + 1).join("/") : "";

    if (!bucket || !encodedObject) return raw;

    // Fully decode the object path — handles both %2F and %252F (%25 = literal %)
    let objectPath = encodedObject;
    try {
      objectPath = decodeURIComponent(objectPath);
    } catch {
      objectPath = encodedObject;
    }
    // Belt-and-suspenders: replace any residual %2F / %252F after decode
    objectPath = objectPath.replace(/%2F/gi, "/").replace(/%252F/gi, "/");

    const token = url.searchParams.get("token");
    // Always ensure alt=media — without it Firebase returns JSON metadata, not bytes
    const alt = url.searchParams.get("alt") || "media";

    // Reconstruct via string concat (not new URL) to avoid platform-specific
    // percent-encoding normalisation that could decode our %2F back to /
    const qs = `?alt=${alt}${token ? `&token=${encodeURIComponent(token)}` : ""}`;
    return `https://firebasestorage.googleapis.com/v0/b/${bucket}/o/${encodeURIComponent(objectPath)}${qs}`;
  } catch {
    return raw;
  }
}

// ─── Media extension patterns ─────────────────────────────────────────────────

const VIDEO_EXTENSION_RE = /\.(mp4|mov|m4v)(\?|#|$)/i;
const IMAGE_EXTENSION_RE = /\.(jpe?g|png|webp)(\?|#|$)/i;

/**
 * Returns true if the media should be treated as a video.
 *
 * Considers BOTH the stored mediaType field (accurate for new posts) and the
 * URL extension (fallback for legacy posts where mediaType was stored as "image"
 * despite the URL pointing to an .mp4 file).
 */
export function isVideoMedia(
  mediaUrl: string | null | undefined,
  mediaType: string | null | undefined
): boolean {
  if (mediaType === "video") return true;
  if (!mediaUrl) return false;
  return VIDEO_EXTENSION_RE.test(mediaUrl);
}

/**
 * Returns true if the media should be treated as an image.
 *
 * Video inference wins first so legacy posts with mediaType:"image" and a
 * .mp4 URL still render as video. Otherwise, use the stored mediaType or the
 * image extension.
 */
export function isImageMedia(
  mediaUrl: string | null | undefined,
  mediaType: string | null | undefined
): boolean {
  if (isVideoMedia(mediaUrl, mediaType)) return false;
  if (mediaType === "image") return true;
  if (!mediaUrl) return false;
  return IMAGE_EXTENSION_RE.test(mediaUrl);
}

// ─── URL validity check ───────────────────────────────────────────────────────

/**
 * Returns true if the URL is safe to pass to <Image source={{uri}} />.
 *
 * Validity rules:
 *   1. Must be a non-empty string.
 *   2. Must start with "https://" (React Native does not support http on iOS ATS).
 *   3. For Firebase Storage URLs (firebasestorage.googleapis.com):
 *      a. Must contain "?alt=media" or "&alt=media" — without this the server
 *         returns JSON metadata, not image bytes.
 *      b. Must have a non-trivial object path after "/o/" (i.e. not just "/o/").
 *
 * Returns false for empty strings, http:// URLs, and truncated Firebase URLs.
 */
export function isValidMediaUrl(url: string | null | undefined): boolean {
  if (!url || typeof url !== "string") return false;
  if (!url.startsWith("https://")) return false;

  // Firebase Storage specific checks
  if (url.includes("firebasestorage.googleapis.com")) {
    // Must include alt=media param
    if (!url.includes("alt=media")) return false;
    // Must have non-trivial path after /o/
    const oIndex = url.indexOf("/o/");
    if (oIndex < 0) return false;
    const afterO = url.slice(oIndex + 3).replace(/\?.*$/, ""); // strip query
    if (!afterO || afterO.length < 2) return false;
  }

  return true;
}

export async function getVideoThumbnailUri(
  mediaUrl: string | null | undefined
): Promise<string> {
  const normalizedUri = normalizeFirebaseStorageUrl(mediaUrl);
  if (!normalizedUri) return "";

  const cached = videoThumbnailCache.get(normalizedUri);
  if (cached) return cached;

  const pending = videoThumbnailRequests.get(normalizedUri);
  if (pending) return pending;

  const request = VideoThumbnails.getThumbnailAsync(normalizedUri, { time: 0 })
    .then(({ uri }) => {
      videoThumbnailCache.set(normalizedUri, uri);
      videoThumbnailRequests.delete(normalizedUri);
      return uri;
    })
    .catch((error) => {
      videoThumbnailRequests.delete(normalizedUri);
      throw error;
    });

  videoThumbnailRequests.set(normalizedUri, request);
  return request;
}
