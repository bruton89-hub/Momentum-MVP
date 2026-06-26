import React, { memo, useEffect, useRef, useState, useCallback, useMemo } from "react";
import {
  View,
  Text,
  Pressable,
  StyleSheet,
  Dimensions,
  Animated,
  Alert,
  Image,
} from "react-native";
import { ResizeMode, Video } from "expo-av";
import { useRouter } from "expo-router";
import { COLORS, SPACING, RADIUS, FONTS } from "@/constants/theme";
import AvatarImage from "./AvatarImage";
import MediaTile from "./MediaTile";
import { openAthleteProfile } from "@/utils/navigation";
import {
  isVideoMedia,
  isValidMediaUrl,
  getVideoThumbnailUri,
  normalizeFirebaseStorageUrl,
} from "@/utils/media";
import type { Post } from "@/types";
import { VIDEO_AUDIO_TRACKS } from "@/constants/videoEditing";

const { width: SCREEN_W } = Dimensions.get("window");
const MEDIA_HEIGHT = Math.round(SCREEN_W * 0.88); // ~9:10 — tall, portrait

interface Props {
  post: Post;
  isLiked: boolean;
  onLike: (postId: string) => void;
  currentUserId?: string | null;
  isFollowing?: boolean;
  onFollow?: (userId: string, isCurrentlyFollowing: boolean) => void;
  onBattle?: (post: Post) => void;
  isBattling?: boolean;
  isActiveVideo?: boolean;
  enableVideoPlayback?: boolean;
}

function formatTimestamp(ts: Post["createdAt"]): string {
  if (!ts) return "";
  const date =
    typeof (ts as { toDate?: () => Date }).toDate === "function"
      ? (ts as { toDate: () => Date }).toDate()
      : new Date((ts as { seconds: number }).seconds * 1000);
  const diff = Date.now() - date.getTime();
  const mins = Math.floor(diff / 60_000);
  if (mins < 1) return "just now";
  if (mins < 60) return `${mins}m`;
  const hrs = Math.floor(mins / 60);
  if (hrs < 24) return `${hrs}h`;
  return `${Math.floor(hrs / 24)}d`;
}

/** Highlight #hashtags in neon green */
function CaptionText({ text, style }: { text: string; style?: object }) {
  const parts = text.split(/(#\w+)/g);
  return (
    <Text style={style}>
      {parts.map((part, i) =>
        part.startsWith("#") ? (
          <Text key={i} style={styles.hashtag}>{part}</Text>
        ) : (
          <Text key={i}>{part}</Text>
        )
      )}
    </Text>
  );
}

function toHandle(username: string): string {
  return "@" + username.toLowerCase().replace(/\s+/g, ".");
}

function PostCard({
  post,
  isLiked,
  onLike,
  currentUserId,
  isFollowing = false,
  onFollow,
  onBattle,
  isBattling = false,
  isActiveVideo = false,
  enableVideoPlayback = false,
}: Props) {
  const router = useRouter();
  const heartScale = useRef(new Animated.Value(0)).current;
  const videoRef = useRef<Video>(null);
  const [showHeart, setShowHeart] = useState(false);
  const [mediaError, setMediaError] = useState(false);
  const [thumbnailUri, setThumbnailUri] = useState("");
  const [isMuted, setIsMuted] = useState(true);
  const lastTap = useRef(0);
  const handleMediaError = useCallback(() => setMediaError(true), []);

  // ── URL normalisation for the Video component ─────────────────────────────
  // normalizeFirebaseStorageUrl ensures ?alt=media is present and the path is
  // correctly percent-encoded for iOS NSURL. Always use this for Video source
  // rather than the raw post.mediaUrl from Firestore.
  const normalizedMediaUrl = useMemo(
    () => normalizeFirebaseStorageUrl(post.mediaUrl),
    [post.mediaUrl]
  );
  const isActive = isActiveVideo;

  // isVideoMedia checks both the stored mediaType field AND the URL extension,
  // so legacy posts with mediaType:"image" but a .mp4 URL are handled correctly.
  const postIsVideo = isVideoMedia(normalizedMediaUrl || post.mediaUrl, post.mediaType);
  const musicLabel = VIDEO_AUDIO_TRACKS.find(
    (track) => track.id === post.videoEdit?.music
  )?.label;
  const hasTrim =
    !!post.videoEdit &&
    (post.videoEdit.trimStart > 0 || post.videoEdit.trimEnd !== null);

  // isValidMediaUrl is only used for image-branch decisions (in MediaTile).
  // We compute it here for the DEV log so we can see it alongside other values.
  const mediaUrlValid = isValidMediaUrl(normalizedMediaUrl);

  // shouldPlayVideo: true only when parent explicitly enables playback AND
  // this specific post is the currently visible one.
  const shouldPlayVideo =
    enableVideoPlayback &&
    isActive &&
    postIsVideo &&
    !!normalizedMediaUrl &&
    !mediaError;
  useEffect(() => {
    setMediaError(false);
    setThumbnailUri("");
    setIsMuted(true);
  }, [post.id, normalizedMediaUrl]);

  useEffect(() => {
    let cancelled = false;
    if (!postIsVideo || !normalizedMediaUrl || !mediaUrlValid) return;

    getVideoThumbnailUri(normalizedMediaUrl)
      .then((thumbUri) => {
        if (!cancelled) setThumbnailUri(thumbUri);
      })
      .catch(() => undefined);

    return () => {
      cancelled = true;
    };
  }, [mediaUrlValid, normalizedMediaUrl, postIsVideo]);

  useEffect(() => {
    if (!isActive) {
      videoRef.current?.pauseAsync().catch(() => undefined);
    }
  }, [isActive]);

  useEffect(() => {
    return () => {
      videoRef.current?.unloadAsync().catch(() => undefined);
    };
  }, []);

  // Guard: only show Follow if we have a valid target userId.
  const showFollowBtn = !!onFollow && !!currentUserId && !!post.userId && currentUserId !== post.userId;
  const isOwnPost = !!currentUserId && currentUserId === post.userId;
  const showBattleBtn = !!onBattle && !!currentUserId;

  function handleDoubleTap() {
    const now = Date.now();
    const gap = now - lastTap.current;
    lastTap.current = now;
    if (gap < 300) {
      __DEV__ && console.log("[PostCard] double-tap like — postId:", post.id, "isLiked:", isLiked);
      if (!isLiked) onLike(post.id);
      flashHeart();
    }
  }

  function handleMediaPress() {
    if (postIsVideo && normalizedMediaUrl && !mediaError) {
      setIsMuted((muted) => !muted);
    }
    handleDoubleTap();
  }

  function flashHeart() {
    setShowHeart(true);
    heartScale.setValue(0);
    Animated.sequence([
      Animated.spring(heartScale, { toValue: 1.4, useNativeDriver: true }),
      Animated.spring(heartScale, { toValue: 1, useNativeDriver: true }),
      Animated.delay(600),
      Animated.timing(heartScale, { toValue: 0, duration: 200, useNativeDriver: true }),
    ]).start(() => setShowHeart(false));
  }

  const handle = toHandle(post.username);

  return (
    <View style={styles.card}>
      {/* ── Header ──────────────────────────────────────────────────────────── */}
      <View style={styles.headerRow}>
        <Pressable
          style={styles.headerLeft}
          onPress={() => {
            __DEV__ && console.log("[PostCard] profile pressed — userId:", post.userId,
              "isSelf:", post.userId === currentUserId);
            openAthleteProfile(router, post.userId, currentUserId);
          }}
        >
          <AvatarImage uri={post.userAvatar} username={post.username} size={38} />
          <View style={styles.headerText}>
            <Text style={styles.username}>{post.username}</Text>
            <Text style={styles.handle}>{handle}  ·  {formatTimestamp(post.createdAt)}</Text>
          </View>
        </Pressable>

        <View style={styles.headerRight}>
          {/* Battle badge */}
          {post.battleEnabled && (
            <View style={styles.battleBadge}>
              <Text style={styles.battleBadgeText}>⚔️</Text>
            </View>
          )}
          {/* Follow button */}
          {showFollowBtn && (
            <Pressable
              onPress={() => {
                __DEV__ && console.log("[PostCard] follow pressed — targetUserId:", post.userId, "isFollowing:", isFollowing);
                onFollow!(post.userId, isFollowing);
              }}
              style={[styles.followBtn, isFollowing && styles.followingBtn]}
              hitSlop={{ top: 8, bottom: 8, left: 8, right: 8 }}
            >
              <Text style={[styles.followBtnText, isFollowing && styles.followingBtnText]}>
                {isFollowing ? "Following" : "Follow"}
              </Text>
            </Pressable>
          )}
          {/* More menu */}
          <Pressable style={styles.moreBtn} hitSlop={{ top: 8, bottom: 8, left: 8, right: 8 }}>
            <Text style={styles.moreBtnText}>···</Text>
          </Pressable>
        </View>
      </View>

      {/* ── Media ────────────────────────────────────────────────────────────── */}
      <Pressable onPress={handleMediaPress} style={styles.mediaWrapper}>
        {postIsVideo && post.videoEdit?.coverUri ? (
          <Image
            source={{ uri: post.videoEdit.coverUri }}
            style={styles.media}
            resizeMode="cover"
            onError={handleMediaError}
          />
        ) : postIsVideo && normalizedMediaUrl && !mediaError ? (
          // ── Video: always render <Video> so the first frame is visible ──────
          // shouldPlay controls whether it actually plays (true only for the
          // currently-visible post when enableVideoPlayback=true).
          // Use normalizedMediaUrl so the URL has correct encoding + ?alt=media.
          <Video
            key={`${post.id}:${thumbnailUri ? "poster" : "pending"}`}
            ref={videoRef}
            source={{ uri: normalizedMediaUrl }}
            style={styles.media}
            resizeMode={ResizeMode.COVER}
            shouldPlay={shouldPlayVideo}
            isLooping={false}
            isMuted={isMuted}
            useNativeControls={false}
            usePoster={!!thumbnailUri}
            posterSource={thumbnailUri ? { uri: thumbnailUri } : undefined}
            posterStyle={styles.videoPoster}
            onError={handleMediaError}
          />
        ) : postIsVideo && (mediaError || !normalizedMediaUrl) ? (
          // ── Video with bad/missing URL: explicit video placeholder ───────────
          <View style={styles.videoErrorPlaceholder}>
            <Text style={styles.videoErrorIcon}>▶</Text>
            <Text style={styles.videoErrorLabel}>VIDEO UNAVAILABLE</Text>
          </View>
        ) : (
          // ── Image (or non-video placeholder): handled by MediaTile ───────────
          // MediaTile normalizes the URL itself and shows 🖼️ if invalid.
          <MediaTile
            uri={post.mediaUrl}
            mediaType={post.mediaType}
            style={StyleSheet.absoluteFillObject}
            context="PostCard"
            postId={post.id}
          />
        )}

        {/* Duration badge — only for valid video posts */}
        {postIsVideo && normalizedMediaUrl && !mediaError && (
          <View style={styles.durationBadge}>
            <Text style={styles.durationText}>0:15</Text>
          </View>
        )}

        {postIsVideo && musicLabel && (
          <View style={styles.musicBadge}>
            <Text style={styles.metadataText}>🎵 {musicLabel}</Text>
          </View>
        )}

        {__DEV__ && postIsVideo && hasTrim && (
          <View style={styles.trimBadge}>
            <Text style={styles.metadataText}>
              Trim {post.videoEdit!.trimStart.toFixed(1)}s–
              {post.videoEdit!.trimEnd === null
                ? "end"
                : `${post.videoEdit!.trimEnd.toFixed(1)}s`}
            </Text>
          </View>
        )}

        {postIsVideo && !!post.videoEdit?.textOverlay.trim() && (
          <View pointerEvents="none" style={styles.postTextOverlayWrap}>
            <Text style={styles.postTextOverlay}>
              {post.videoEdit.textOverlay.trim()}
            </Text>
          </View>
        )}

        {/* Double-tap heart */}
        {showHeart && (
          <Animated.Text
            style={[styles.heartOverlay, { transform: [{ scale: heartScale }] }]}
          >
            ❤️
          </Animated.Text>
        )}
      </Pressable>

      {/* ── Footer ───────────────────────────────────────────────────────────── */}
      <View style={styles.footer}>
        {/* Action row */}
        <View style={styles.actionRow}>
          {/* Like */}
          <Pressable
            onPress={() => {
              __DEV__ && console.log("[PostCard] like pressed — postId:", post.id, "isLiked:", isLiked);
              onLike(post.id);
            }}
            style={styles.actionBtn}
          >
            <Text style={[styles.actionIcon, isLiked && styles.actionIconActive]}>
              {isLiked ? "❤️" : "🤍"}
            </Text>
            <Text style={[styles.actionCount, isLiked && styles.actionCountActive]}>
              {post.likesCount}
            </Text>
          </Pressable>

          {/* Comment — V1 placeholder */}
          <Pressable
            style={styles.actionBtn}
            onPress={() => Alert.alert("Comments", "Comments coming soon.")}
          >
            <Text style={styles.actionIcon}>💬</Text>
            <Text style={styles.actionCount}>0</Text>
          </Pressable>

          {/* Share */}
          <Pressable style={styles.actionBtn}>
            <Text style={styles.actionIcon}>↗</Text>
          </Pressable>

          {/* Battle button pushed to right */}
          {showBattleBtn && (
            <Pressable
              onPress={() => {
                __DEV__ && console.log("[PostCard] battle pressed — postId:", post.id, "isBattling:", isBattling);
                onBattle!(post);
              }}
              disabled={isBattling}
              style={[styles.battleActionBtn, isBattling && styles.battleActionBtnLoading]}
            >
              <Text style={styles.battleActionBtnText}>
                {isBattling ? "Starting…" : isOwnPost ? "⚔️ Start" : "⚔️ Challenge"}
              </Text>
            </Pressable>
          )}
        </View>

        {/* Caption */}
        {post.caption ? (
          <View style={styles.captionRow}>
            <Text style={styles.captionUser}>{post.username} </Text>
            <CaptionText text={post.caption} style={styles.caption} />
          </View>
        ) : null}
      </View>
    </View>
  );
}

export default memo(PostCard);

const styles = StyleSheet.create({
  card: {
    backgroundColor: COLORS.card,
    borderBottomWidth: 1,
    borderBottomColor: COLORS.cardBorder,
    marginBottom: SPACING.sm,
  },

  // ── Header ──────────────────────────────────────────────────────────────────
  headerRow: {
    flexDirection: "row",
    alignItems: "center",
    paddingHorizontal: SPACING.md,
    paddingVertical: SPACING.md,
  },
  headerLeft: {
    flex: 1,
    flexDirection: "row",
    alignItems: "center",
    gap: SPACING.sm,
  },
  headerText: { flex: 1 },
  headerRight: {
    flexDirection: "row",
    alignItems: "center",
    gap: SPACING.sm,
  },
  username: {
    color: COLORS.textPrimary,
    fontWeight: FONTS.bold,
    fontSize: 15,
    letterSpacing: 0.2,
  },
  handle: {
    color: COLORS.textHandle,
    fontSize: 12,
    marginTop: 2,
  },
  battleBadge: {
    backgroundColor: COLORS.accentFaint,
    borderWidth: 1,
    borderColor: COLORS.accent,
    borderRadius: RADIUS.xs,
    paddingHorizontal: 5,
    paddingVertical: 2,
  },
  battleBadgeText: {
    fontSize: 10,
  },
  followBtn: {
    paddingHorizontal: SPACING.md,
    paddingVertical: 5,
    borderRadius: RADIUS.full,
    borderWidth: 1.5,
    borderColor: COLORS.accent,
    backgroundColor: "transparent",
  },
  followingBtn: {
    borderColor: COLORS.inputBorder,
    backgroundColor: COLORS.surface,
  },
  followBtnText: {
    color: COLORS.accent,
    fontSize: 11,
    fontWeight: FONTS.bold,
  },
  followingBtnText: {
    color: COLORS.textMuted,
  },
  moreBtn: {
    paddingHorizontal: 4,
  },
  moreBtnText: {
    color: COLORS.textMuted,
    fontSize: 16,
    letterSpacing: 1,
    lineHeight: 18,
  },

  // ── Media ────────────────────────────────────────────────────────────────────
  // mediaWrapper owns the explicit height so children (Video, MediaTile) can
  // use absoluteFillObject without needing their own height.
  mediaWrapper: {
    width: "100%",
    height: MEDIA_HEIGHT,
    backgroundColor: COLORS.surface,
    overflow: "hidden",
  },
  media: {
    width: "100%",
    height: "100%",
  },
  videoPoster: {
    width: "100%",
    height: "100%",
    resizeMode: "cover",
  },
  videoErrorPlaceholder: {
    ...StyleSheet.absoluteFillObject,
    alignItems: "center",
    justifyContent: "center",
    gap: 8,
    backgroundColor: COLORS.surface,
  },
  videoErrorIcon: {
    color: COLORS.textMuted,
    fontSize: 32,
    opacity: 0.5,
  },
  videoErrorLabel: {
    color: COLORS.textMuted,
    fontSize: 11,
    fontWeight: FONTS.bold,
    letterSpacing: 1.5,
    textTransform: "uppercase",
    opacity: 0.6,
  },
  durationBadge: {
    position: "absolute",
    bottom: 8,
    left: 10,
    backgroundColor: "rgba(0,0,0,0.65)",
    borderRadius: RADIUS.xs,
    paddingHorizontal: 6,
    paddingVertical: 2,
  },
  durationText: {
    color: COLORS.white,
    fontSize: 11,
    fontWeight: FONTS.bold,
  },
  musicBadge: {
    position: "absolute",
    top: SPACING.md,
    left: SPACING.md,
    paddingHorizontal: SPACING.sm,
    paddingVertical: 5,
    borderRadius: RADIUS.full,
    backgroundColor: "rgba(0,0,0,0.72)",
    borderWidth: 1,
    borderColor: COLORS.accent,
  },
  trimBadge: {
    position: "absolute",
    top: 48,
    left: SPACING.md,
    paddingHorizontal: SPACING.sm,
    paddingVertical: 4,
    borderRadius: RADIUS.xs,
    backgroundColor: "rgba(0,0,0,0.72)",
  },
  metadataText: {
    color: COLORS.accent,
    fontSize: 11,
    fontWeight: FONTS.bold,
  },
  postTextOverlayWrap: {
    position: "absolute",
    left: SPACING.xl,
    right: SPACING.xl,
    bottom: 52,
    alignItems: "center",
  },
  postTextOverlay: {
    color: COLORS.white,
    fontSize: 24,
    lineHeight: 29,
    fontWeight: FONTS.heavy,
    textAlign: "center",
    textShadowColor: COLORS.black,
    textShadowOffset: { width: 1, height: 2 },
    textShadowRadius: 4,
  },
  heartOverlay: {
    position: "absolute",
    fontSize: 72,
    alignSelf: "center",
    top: "35%",
  },

  // ── Footer ───────────────────────────────────────────────────────────────────
  footer: {
    paddingHorizontal: SPACING.md,
    paddingTop: SPACING.md,
    paddingBottom: SPACING.md,
    gap: SPACING.sm + 2,
  },
  actionRow: {
    flexDirection: "row",
    alignItems: "center",
    gap: SPACING.lg,
  },
  actionBtn: {
    flexDirection: "row",
    alignItems: "center",
    gap: 5,
  },
  actionIcon: {
    fontSize: 22,
    color: COLORS.textSecondary,
  },
  actionIconActive: {},
  actionCount: {
    color: COLORS.textSecondary,
    fontSize: 14,
    fontWeight: FONTS.semibold,
  },
  actionCountActive: { color: COLORS.textPrimary },
  battleActionBtn: {
    marginLeft: "auto",
    paddingHorizontal: SPACING.md,
    paddingVertical: 6,
    borderRadius: RADIUS.full,
    borderWidth: 1.5,
    borderColor: COLORS.accent,
    backgroundColor: COLORS.accentFaint,
  },
  battleActionBtnLoading: {
    borderColor: COLORS.inputBorder,
    backgroundColor: "transparent",
  },
  battleActionBtnText: {
    color: COLORS.accent,
    fontSize: 12,
    fontWeight: FONTS.bold,
  },
  captionRow: {
    flexDirection: "row",
    flexWrap: "wrap",
  },
  captionUser: {
    color: COLORS.textPrimary,
    fontWeight: FONTS.bold,
    fontSize: 13,
  },
  caption: {
    color: COLORS.textSecondary,
    fontSize: 13,
    lineHeight: 20,
    flexShrink: 1,
  },
  hashtag: {
    color: COLORS.accent,
    fontWeight: FONTS.semibold,
  },
});
