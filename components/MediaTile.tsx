/**
 * MediaTile — native-safe static media renderer
 *
 * WHY THIS EXISTS
 * ───────────────
 * React Native on iOS does NOT reliably resolve `width:"100%"` / `height:"100%"`
 * on <Image> when the parent's own width is also a flex/percentage value. The
 * layout engine must resolve both in order — if the Image renders before the
 * parent's dimensions are committed it gets 0×0 and shows the native broken-
 * image indicator rather than our fallback (onError fires too late or not at all).
 *
 * The fix: the container View owns the dimensions (from `style`), and the Image
 * inside uses StyleSheet.absoluteFillObject (position:absolute, top/right/bottom/left:0).
 * absoluteFillObject resolves instantly from the container without a separate
 * layout pass, so the Image always has pixel dimensions on iOS.
 *
 * VIDEO POLICY
 * ────────────
 * MediaTile is a STATIC renderer — it never plays video. When isVideo=true it
 * generates and displays a cached thumbnail, then overlays the existing play
 * affordance. Actual video playback lives in PostCard's <Video> component.
 */
import React, { useEffect, useMemo, useState } from "react";
import {
  View,
  Image,
  Text,
  StyleSheet,
  StyleProp,
  ViewStyle,
  Platform,
} from "react-native";
import { COLORS } from "@/constants/theme";
import {
  getVideoThumbnailUri,
  normalizeFirebaseStorageUrl,
  isImageMedia,
  isVideoMedia,
  isValidMediaUrl,
} from "@/utils/media";

// ─── Props ────────────────────────────────────────────────────────────────────

export interface MediaTileProps {
  /** Firebase Storage download URL (or any https image URL). Null/empty → fallback. */
  uri?: string | null;
  /**
   * "video" → always render play-icon placeholder, never pass to <Image>.
   * "image" (or undefined) → attempt to load as image.
   */
  mediaType?: "image" | "video";
  /**
   * Style applied to the container View that owns the dimensions.
   * Must supply an explicit width + height (or use flex:1 inside a sized parent).
   * Do NOT pass width:"100%" + height:"100%" unless the parent has pixel dimensions.
   */
  style?: StyleProp<ViewStyle>;
  /**
   * Short label for diagnostic logs (e.g. "PostCard", "BattleCard", "ProfileGrid").
   * Helps identify which component produced a failure in Metro output.
   */
  context?: string;
  postId?: string;
}

// ─── Component ────────────────────────────────────────────────────────────────

export default function MediaTile({
  uri,
  mediaType,
  style,
  context = "unknown",
  postId,
}: MediaTileProps) {
  const [error, setError] = useState(false);
  const [thumbnailUri, setThumbnailUri] = useState("");
  const [thumbnailError, setThumbnailError] = useState(false);

  // expo-video-thumbnails is a native-only module — it throws on web. On web we
  // render a real DOM <video> element as the static tile instead (see below),
  // so we never call the thumbnail generator and never show a broken-image icon.
  const isWeb = Platform.OS === "web";

  // Normalise once per uri change — handles all Firebase Storage encoding variants
  // and always ensures ?alt=media is present so Firebase returns bytes not metadata.
  const normalizedUri = useMemo(
    () => normalizeFirebaseStorageUrl(uri),
    [uri]
  );

  // Use isVideoMedia so legacy posts with mediaType:"image" but a .mp4 URL are
  // correctly identified as video and never passed to <Image> or Image.prefetch.
  const isVideo = isVideoMedia(normalizedUri || uri, mediaType);
  const isImage = isImageMedia(normalizedUri || uri, mediaType);

  // URL validity — only relevant for the image branch.
  // isUrlValid is NEVER used to gate video rendering (videos hit isVideo=true first).
  // A Firebase image URL without ?alt=media returns JSON metadata, not bytes →
  // isValidMediaUrl correctly rejects it and shows a placeholder instead.
  const isUrlValid = isValidMediaUrl(normalizedUri);

  // Decide which branch will render (for logging / overlay)
  const renderBranch: "video" | "image" | "placeholder" = isVideo
    ? isUrlValid && !thumbnailError
      ? "video"
      : "placeholder"
    : error || !normalizedUri || !isUrlValid || !isImage
    ? "placeholder"
    : "image";

  useEffect(() => {
    setError(false);
    setThumbnailUri("");
    setThumbnailError(false);
  }, [normalizedUri]);

  useEffect(() => {
    let cancelled = false;
    // Web never uses expo-video-thumbnails (unsupported → throws); it renders a
    // <video> element directly, so skip the generator entirely on web.
    if (isWeb || !isVideo || !normalizedUri || !isUrlValid) return;

    getVideoThumbnailUri(normalizedUri)
      .then((thumbUri) => {
        if (!cancelled) setThumbnailUri(thumbUri);
      })
      .catch(() => {
        if (!cancelled) setThumbnailError(true);
      });

    return () => {
      cancelled = true;
    };
  }, [isWeb, isVideo, isUrlValid, normalizedUri]);

  // ── Native prefetch diagnostic (DEV only, images only) ───────────────────────
  useEffect(() => {
    // Only prefetch for valid image URLs — never for videos or invalid URLs.
    // Prefetching .mp4 URLs causes "Error decoding image data" on iOS.
    if (!normalizedUri || isVideo || !isUrlValid) return;

    Image.prefetch(normalizedUri).catch(() => undefined);
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [normalizedUri, isVideo, isUrlValid]);

  function handleError() {
    setError(true);
  }

  return (
    // The container View owns width + height. Everything inside fills it absolutely.
    <View style={[styles.root, style]}>
      {renderBranch === "video" ? (
        <View style={styles.fill}>
          {isWeb && normalizedUri ? (
            // Web: render a real DOM <video> as a static poster tile. Muted +
            // playsInline + preload="metadata" loads a frame without autoplaying,
            // and the "#t=0.1" fragment nudges the browser to paint the first
            // frame. React-dom renders the lowercase "video" tag as a real
            // <video> element (this branch only runs on web).
            React.createElement("video", {
              src: `${normalizedUri}#t=0.1`,
              muted: true,
              playsInline: true,
              preload: "metadata",
              controls: false,
              style: {
                position: "absolute",
                top: 0,
                left: 0,
                width: "100%",
                height: "100%",
                objectFit: "cover",
              },
            })
          ) : thumbnailUri ? (
            <Image
              source={{ uri: thumbnailUri }}
              style={StyleSheet.absoluteFillObject}
              resizeMode="cover"
              onError={() => setThumbnailError(true)}
            />
          ) : null}
          <View style={styles.playCircle}>
            <Text style={styles.playIcon}>▶</Text>
          </View>
        </View>
      ) : renderBranch === "placeholder" ? (
        // ── Error / missing / invalid URL: full-tile fallback ─────────────────
        // isUrlValid catches Firebase URLs without ?alt=media and non-https URLs.
        // Shows a dark placeholder instead of attempting to render a bad URL
        // (which would log "Error decoding image data" and show nothing anyway).
        <View style={styles.fill}>
          <Text style={styles.fallbackIcon}>🖼️</Text>
        </View>
      ) : (
        // ── Image: absoluteFillObject eliminates % dimension resolution race ───
        <Image
          source={{ uri: normalizedUri }}
          style={StyleSheet.absoluteFillObject}
          resizeMode="cover"
          onError={handleError}
        />
      )}
    </View>
  );
}

// ─── Styles ───────────────────────────────────────────────────────────────────

const styles = StyleSheet.create({
  root: {
    // overflow hidden clips the absoluteFillObject image to the container bounds
    overflow: "hidden",
    backgroundColor: COLORS.surface,
  },
  fill: {
    // Fill the container absolutely so fallback/placeholder tiles look correct
    ...StyleSheet.absoluteFillObject,
    alignItems: "center",
    justifyContent: "center",
    gap: 8,
  },
  playCircle: {
    width: 48,
    height: 48,
    borderRadius: 24,
    backgroundColor: COLORS.accentFaint,
    borderWidth: 1.5,
    borderColor: COLORS.accent,
    alignItems: "center",
    justifyContent: "center",
  },
  playIcon: {
    color: COLORS.accent,
    fontSize: 18,
    marginLeft: 3, // visual centering of ▶ glyph
  },
  fallbackIcon: {
    fontSize: 28,
    opacity: 0.35,
  },
});
