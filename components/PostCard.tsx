import React, { memo, useEffect, useRef, useState, useCallback, useMemo } from "react";
import {
  View,
  Text,
  Pressable,
  StyleSheet,
  Dimensions,
  Alert,
  Image,
} from "react-native";
import { ResizeMode, Video } from "expo-av";
import { LinearGradient } from "expo-linear-gradient";
import { useRouter } from "expo-router";
import { useSafeAreaInsets } from "react-native-safe-area-context";
import { Feather, MaterialCommunityIcons } from "@expo/vector-icons";
import Animated, {
  FadeIn,
  FadeOut,
  useSharedValue,
  useAnimatedStyle,
  useReducedMotion,
  withSpring,
  withSequence,
  withDelay,
  withTiming,
  withRepeat,
  cancelAnimation,
  runOnJS,
  Easing,
} from "react-native-reanimated";
import {
  COLORS,
  SPACING,
  RADIUS,
  FONTS,
  TYPE,
  HIT_SLOP,
  GLOW,
  SCRIMS,
  TRENDING_LIKES_THRESHOLD,
} from "@/constants/theme";
import AvatarImage from "./AvatarImage";
import MediaTile from "./MediaTile";
import SportBadge, { SportBadgeVariant } from "./SportBadge";
import PressableScale from "./PressableScale";
import { openAthleteProfile } from "@/utils/navigation";
import { toHandle, formatRelativeTime } from "@/utils/format";
import {
  isVideoMedia,
  isValidMediaUrl,
  getVideoThumbnailUri,
  normalizeFirebaseStorageUrl,
} from "@/utils/media";
import type { Post } from "@/types";
import { VIDEO_AUDIO_TRACKS } from "@/constants/videoEditing";

const { height: SCREEN_H } = Dimensions.get("window");

/** Max status badges shown at once — broadcast overlays stay scannable. */
const MAX_BADGES = 3;

interface Props {
  post: Post;
  isLiked: boolean;
  onLike: (postId: string) => void;
  /**
   * Opens the comment thread. Optional and backward-compatible: when omitted
   * (e.g. existing feed usage) the button keeps its previous placeholder.
   */
  onComment?: (post: Post) => void;
  currentUserId?: string | null;
  isFollowing?: boolean;
  onFollow?: (userId: string, isCurrentlyFollowing: boolean) => void;
  onBattle?: (post: Post) => void;
  isBattling?: boolean;
  isActiveVideo?: boolean;
  enableVideoPlayback?: boolean;
  mountVideoPlayer?: boolean;
  authorAvatarOverride?: string | null;
  /** Full-screen page height (measured by the feed). Falls back to window height. */
  height?: number;
  /**
   * True when this card is the one currently in view (any media type).
   * Gates the Challenge idle pulse, badge entrances, and other ambient
   * effects so inactive cards stay visually correct but quiet.
   */
  isActiveCard?: boolean;
}

/** Compact count for the action rail: 1400 → "1.4K". */
function formatCount(n: number): string {
  if (n >= 1_000_000) return `${(n / 1_000_000).toFixed(1).replace(/\.0$/, "")}M`;
  if (n >= 1_000) return `${(n / 1_000).toFixed(1).replace(/\.0$/, "")}K`;
  return String(n);
}

/** Highlight #hashtags in Momentum green */
function CaptionText({ text, style }: { text: string; style?: object }) {
  const parts = text.split(/(#\w+)/g);
  return (
    <Text style={style} numberOfLines={3}>
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

function PostCard({
  post,
  isLiked,
  onLike,
  onComment,
  currentUserId,
  isFollowing = false,
  onFollow,
  onBattle,
  isBattling = false,
  isActiveVideo = false,
  enableVideoPlayback = false,
  mountVideoPlayer = true,
  authorAvatarOverride,
  height,
  isActiveCard = false,
}: Props) {
  const router = useRouter();
  const videoRef = useRef<Video>(null);
  const [showHeart, setShowHeart] = useState(false);
  const [mediaError, setMediaError] = useState(false);
  const [thumbnailUri, setThumbnailUri] = useState("");
  const [isMuted, setIsMuted] = useState(true);
  const [isSaved, setIsSaved] = useState(false);
  const lastTap = useRef(0);
  const handleMediaError = useCallback(() => setMediaError(true), []);
  const pageHeight = height ?? SCREEN_H;
  const reducedMotion = useReducedMotion();
  const insets = useSafeAreaInsets();
  // SAFE AREA: the card starts at the physical screen top on the Home feed,
  // with the overlay header (~84pt) below the top inset. A fixed offset
  // underlapped the header on Dynamic Island devices (59 + 84 > 118).
  const muteBadgeTop = insets.top + 96;

  // ── Micro-animation shared values (all UI-thread) ───────────────────────────
  const heartScale = useSharedValue(0);      // double-tap heart burst
  const likePulse = useSharedValue(1);       // rail Like icon pulse on like
  const savePulse = useSharedValue(1);       // rail Save icon pulse on save
  const followPulse = useSharedValue(1);     // follow badge plus→check pop
  const challengePulse = useSharedValue(0);  // Challenge idle pulse ring
  const badgeIn = useSharedValue(1);         // badge row entrance (1 = settled)

  const heartStyle = useAnimatedStyle(() => ({
    transform: [{ scale: heartScale.value }],
    opacity: heartScale.value === 0 ? 0 : 1,
  }));
  const likePulseStyle = useAnimatedStyle(() => ({
    transform: [{ scale: likePulse.value }],
  }));
  const savePulseStyle = useAnimatedStyle(() => ({
    transform: [{ scale: savePulse.value }],
  }));
  const followPulseStyle = useAnimatedStyle(() => ({
    transform: [{ scale: followPulse.value }],
  }));
  const challengeRingStyle = useAnimatedStyle(() => ({
    transform: [{ scale: 1 + challengePulse.value * 0.32 }],
    opacity: (1 - challengePulse.value) * 0.5,
  }));
  const badgeRowStyle = useAnimatedStyle(() => ({
    opacity: badgeIn.value,
    transform: [{ translateY: (1 - badgeIn.value) * 8 }],
  }));

  // Like pulse — only after a like is applied (false → true), never on mount.
  const prevLikedRef = useRef(isLiked);
  useEffect(() => {
    if (isLiked && !prevLikedRef.current && !reducedMotion) {
      likePulse.value = withSequence(
        withSpring(1.3, { damping: 9, stiffness: 320 }),
        withSpring(1, { damping: 14 })
      );
    }
    prevLikedRef.current = isLiked;
  }, [isLiked, likePulse, reducedMotion]);

  // Follow badge pop when following state actually changes.
  const prevFollowingRef = useRef(isFollowing);
  useEffect(() => {
    if (isFollowing !== prevFollowingRef.current && !reducedMotion) {
      followPulse.value = withSequence(
        withSpring(1.35, { damping: 9, stiffness: 320 }),
        withSpring(1, { damping: 14 })
      );
    }
    prevFollowingRef.current = isFollowing;
  }, [isFollowing, followPulse, reducedMotion]);

  // Challenge idle pulse — a slow, restrained ring. Runs ONLY while this card
  // is the active one (and motion isn't reduced); cancelled the moment the
  // card scrolls away so off-screen cards cost nothing.
  useEffect(() => {
    if (isActiveCard && !isBattling && !reducedMotion) {
      challengePulse.value = 0;
      challengePulse.value = withRepeat(
        withSequence(
          withTiming(1, { duration: 1900, easing: Easing.out(Easing.quad) }),
          withTiming(0, { duration: 0 }),
          withTiming(0, { duration: 900 }) // rest between pulses — not constant motion
        ),
        -1,
        false
      );
    } else {
      cancelAnimation(challengePulse);
      challengePulse.value = 0;
    }
    return () => cancelAnimation(challengePulse);
  }, [isActiveCard, isBattling, reducedMotion, challengePulse]);

  // Badge entrance — restrained fade/slide only when the card becomes active.
  useEffect(() => {
    if (isActiveCard && !reducedMotion) {
      badgeIn.value = 0;
      badgeIn.value = withTiming(1, {
        duration: 300,
        easing: Easing.out(Easing.cubic),
      });
    } else {
      badgeIn.value = 1; // inactive cards: static, fully visible
    }
  }, [isActiveCard, reducedMotion, badgeIn]);

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
    setIsSaved(false);
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

  const hideHeart = useCallback(() => setShowHeart(false), []);

  const flashHeart = useCallback(() => {
    if (reducedMotion) return;
    setShowHeart(true);
    heartScale.value = 0;
    heartScale.value = withSequence(
      withSpring(1.25, { damping: 11, stiffness: 260 }),
      withSpring(1, { damping: 14 }),
      withDelay(
        480,
        withTiming(0, { duration: 220 }, (finished) => {
          if (finished) runOnJS(hideHeart)();
        })
      )
    );
  }, [heartScale, hideHeart, reducedMotion]);

  function handleDoubleTap() {
    const now = Date.now();
    const gap = now - lastTap.current;
    lastTap.current = now;
    if (gap < 300) {
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

  const handleSave = useCallback(() => {
    setIsSaved((saved) => {
      if (!saved && !reducedMotion) {
        savePulse.value = withSequence(
          withSpring(1.3, { damping: 9, stiffness: 320 }),
          withSpring(1, { damping: 14 })
        );
      }
      return !saved;
    });
  }, [reducedMotion, savePulse]);

  const handle = toHandle(post.username);
  const authorAvatar =
    authorAvatarOverride?.trim() ||
    post.avatarUrl?.trim() ||
    post.userAvatar?.trim() ||
    "";

  const isTrending = post.likesCount >= TRENDING_LIKES_THRESHOLD;

  // ── Status badges — real data only, strict priority, capped at three ────────
  const badges = useMemo(() => {
    const list: { variant: SportBadgeVariant; value?: number }[] = [];
    if (post.isLive) list.push({ variant: "live" });
    if (post.battleWon) list.push({ variant: "winner" });
    if (post.battleEnabled) list.push({ variant: "challenge" });
    if (isTrending) list.push({ variant: "trending" });
    if (post.verified) list.push({ variant: "verified" });
    if (typeof post.momentumScore === "number") {
      list.push({ variant: "score", value: post.momentumScore });
    }
    return list.slice(0, MAX_BADGES);
  }, [
    post.isLive,
    post.battleWon,
    post.battleEnabled,
    post.verified,
    post.momentumScore,
    isTrending,
  ]);

  // ── Identity lines — only render fields that exist ──────────────────────────
  const sportLine = [
    post.sport,
    post.position,
    post.gradYear ? `Class of ${post.gradYear}` : undefined,
  ]
    .filter(Boolean)
    .join("  ·  ");

  const homeBase = [post.city, post.state].filter(Boolean).join(", ");
  const programLine = [post.school || post.teamName, homeBase]
    .filter(Boolean)
    .join("  ·  ");

  return (
    <View style={[styles.page, { height: pageHeight }]}>
      {/* ── Full-bleed media ─────────────────────────────────────────────────── */}
      <Pressable
        onPress={handleMediaPress}
        style={StyleSheet.absoluteFillObject}
        accessibilityLabel={
          postIsVideo
            ? "Video. Tap to toggle sound, double-tap to like."
            : "Photo. Double-tap to like."
        }
      >
        {postIsVideo && post.videoEdit?.coverUri ? (
          <Image
            source={{ uri: post.videoEdit.coverUri }}
            style={styles.media}
            resizeMode="cover"
            onError={handleMediaError}
          />
        ) : postIsVideo && normalizedMediaUrl && !mediaError && mountVideoPlayer ? (
          // Only the visible/next card owns a native player. Other video cards
          // remain lightweight thumbnail tiles until they approach the viewport.
          <Video
            key={`${post.id}:${thumbnailUri ? "poster" : "pending"}`}
            ref={videoRef}
            source={{ uri: normalizedMediaUrl }}
            style={styles.media}
            resizeMode={ResizeMode.COVER}
            shouldPlay={shouldPlayVideo}
            isLooping
            isMuted={isMuted}
            useNativeControls={false}
            usePoster={!!thumbnailUri}
            posterSource={thumbnailUri ? { uri: thumbnailUri } : undefined}
            posterStyle={styles.videoPoster}
            onError={handleMediaError}
          />
        ) : postIsVideo && normalizedMediaUrl && !mediaError ? (
          <MediaTile
            uri={post.mediaUrl}
            mediaType={post.mediaType}
            style={StyleSheet.absoluteFillObject}
            context="PostCard"
            postId={post.id}
          />
        ) : postIsVideo && (mediaError || !normalizedMediaUrl) ? (
          <View style={styles.videoErrorPlaceholder}>
            <Feather name="video-off" size={28} color={COLORS.textMuted} style={{ opacity: 0.5 }} />
            <Text style={styles.videoErrorLabel}>VIDEO UNAVAILABLE</Text>
          </View>
        ) : (
          <MediaTile
            uri={post.mediaUrl}
            mediaType={post.mediaType}
            style={StyleSheet.absoluteFillObject}
            context="PostCard"
            postId={post.id}
          />
        )}
      </Pressable>

      {/* ── Readability scrims (never intercept touches) ─────────────────────── */}
      <LinearGradient
        pointerEvents="none"
        colors={SCRIMS.top}
        style={styles.scrimTop}
      />
      <LinearGradient
        pointerEvents="none"
        colors={SCRIMS.bottom}
        style={styles.scrimBottom}
      />
      <LinearGradient
        pointerEvents="none"
        colors={SCRIMS.rail}
        start={{ x: 0, y: 0 }}
        end={{ x: 1, y: 0 }}
        style={styles.scrimRail}
      />

      {/* ── Double-tap heart ─────────────────────────────────────────────────── */}
      {showHeart && (
        <Animated.View pointerEvents="none" style={[styles.heartOverlay, heartStyle]}>
          <MaterialCommunityIcons name="heart" size={84} color={COLORS.accent} />
        </Animated.View>
      )}

      {/* ── Creator text overlay (from the video editor) ─────────────────────── */}
      {postIsVideo && !!post.videoEdit?.textOverlay.trim() && (
        <View pointerEvents="none" style={styles.postTextOverlayWrap}>
          <Text style={styles.postTextOverlay}>
            {post.videoEdit.textOverlay.trim()}
          </Text>
        </View>
      )}

      {__DEV__ && postIsVideo && hasTrim && (
        <View style={styles.trimBadge} pointerEvents="none">
          <Text style={styles.trimText}>
            Trim {post.videoEdit!.trimStart.toFixed(1)}s–
            {post.videoEdit!.trimEnd === null
              ? "end"
              : `${post.videoEdit!.trimEnd.toFixed(1)}s`}
          </Text>
        </View>
      )}

      {/* ── Overlay chrome — fades in as the card mounts ─────────────────────── */}
      <Animated.View
        entering={reducedMotion ? undefined : FadeIn.duration(280)}
        style={styles.overlay}
        pointerEvents="box-none"
      >
        {/* Bottom-left: badges → athlete identity → caption */}
        <View style={styles.infoStack} pointerEvents="box-none">
          {/* Status badges — broadcast ticker feel, entrance on activation */}
          {badges.length > 0 && (
            <Animated.View style={[styles.badgeRow, badgeRowStyle]} pointerEvents="none">
              {badges.map((badge) => (
                <SportBadge
                  key={badge.variant}
                  variant={badge.variant}
                  value={badge.value}
                />
              ))}
            </Animated.View>
          )}

          {/* Athlete identity */}
          <Pressable
            style={({ pressed }) => [styles.identityRow, pressed && styles.pressedDim]}
            accessibilityRole="link"
            accessibilityLabel={`View ${post.username}'s profile`}
            onPress={() => {
              openAthleteProfile(router, post.userId, currentUserId);
            }}
          >
            <View style={styles.avatarWrap}>
              <View style={[styles.avatarRing, post.verified && styles.avatarRingVerified]}>
                <AvatarImage uri={authorAvatar} username={post.username} size={48} />
              </View>
              {/* Follow mini-badge on the avatar — TikTok pattern */}
              {showFollowBtn && (
                <PressableScale
                  scaleTo={0.82}
                  onPress={() => {
                    onFollow!(post.userId, isFollowing);
                  }}
                  accessibilityRole="button"
                  accessibilityLabel={isFollowing ? `Unfollow ${post.username}` : `Follow ${post.username}`}
                  accessibilityState={{ selected: isFollowing }}
                  hitSlop={HIT_SLOP}
                  style={styles.followBadgeTouch}
                >
                  <Animated.View
                    style={[
                      styles.followBadge,
                      isFollowing && styles.followBadgeActive,
                      followPulseStyle,
                    ]}
                  >
                    <Feather
                      name={isFollowing ? "check" : "plus"}
                      size={12}
                      color={isFollowing ? COLORS.accent : COLORS.black}
                    />
                  </Animated.View>
                </PressableScale>
              )}
            </View>

            <View style={styles.identityText}>
              {/* 1. Display name + verified indicator — carries the most weight */}
              <View style={styles.nameRow}>
                <Text style={styles.username} numberOfLines={1}>
                  {post.username}
                </Text>
                {post.verified && (
                  <MaterialCommunityIcons
                    name="check-decagram"
                    size={16}
                    color={COLORS.accent}
                    accessibilityLabel="Verified athlete"
                  />
                )}
              </View>
              {/* 2. @username · post age */}
              <Text style={styles.handleLine} numberOfLines={1}>
                {handle}  ·  {formatRelativeTime(post.createdAt)}
              </Text>
              {/* 3. Sport · Position · Class year */}
              {sportLine ? (
                <Text style={styles.metaLine} numberOfLines={1}>
                  {sportLine}
                </Text>
              ) : null}
              {/* 4. School or team (· City, ST) */}
              {programLine ? (
                <Text style={styles.programLine} numberOfLines={1}>
                  {programLine}
                </Text>
              ) : null}
            </View>
          </Pressable>

          {/* 5+6. Caption + hashtags */}
          {post.caption ? (
            <CaptionText text={post.caption} style={styles.caption} />
          ) : null}

          {/* Music attribution */}
          {postIsVideo && musicLabel && (
            <View style={styles.musicRow} pointerEvents="none">
              <Feather name="music" size={11} color={COLORS.accent} />
              <Text style={styles.musicText} numberOfLines={1}>{musicLabel}</Text>
            </View>
          )}
        </View>

        {/* Bottom-right: action rail */}
        <View style={styles.rail} pointerEvents="box-none">
          {/* Like — large */}
          <PressableScale
            scaleTo={0.8}
            onPress={() => {
              onLike(post.id);
              if (!isLiked) flashHeart();
            }}
            accessibilityRole="button"
            accessibilityLabel={
              isLiked ? "Unlike this highlight" : "Like this highlight"
            }
            accessibilityState={{ selected: isLiked }}
            hitSlop={HIT_SLOP}
            style={styles.railBtn}
          >
            <Animated.View style={likePulseStyle}>
              <MaterialCommunityIcons
                name={isLiked ? "heart" : "heart-outline"}
                size={38}
                color={isLiked ? COLORS.accent : COLORS.white}
                style={styles.railIconShadow}
              />
            </Animated.View>
            <Text style={[styles.railCount, isLiked && styles.railCountActive]}>
              {formatCount(post.likesCount)}
            </Text>
          </PressableScale>

          {/* Comment — opens the thread when the host screen provides it */}
          <PressableScale
            scaleTo={0.8}
            hitSlop={HIT_SLOP}
            accessibilityRole="button"
            accessibilityLabel="Open comments"
            onPress={() =>
              onComment
                ? onComment(post)
                : Alert.alert("Comments", "Comments coming soon.")
            }
            style={styles.railBtn}
          >
            <Feather name="message-circle" size={33} color={COLORS.white} style={styles.railIconShadow} />
            <Text style={styles.railCount}>{formatCount(post.commentsCount ?? 0)}</Text>
          </PressableScale>

          {/* Share */}
          <PressableScale
            scaleTo={0.8}
            hitSlop={HIT_SLOP}
            accessibilityRole="button"
            accessibilityLabel="Share this highlight"
            style={styles.railBtn}
          >
            <Feather name="send" size={31} color={COLORS.white} style={styles.railIconShadow} />
            <Text style={styles.railCount}>Share</Text>
          </PressableScale>

          {/* Save */}
          <PressableScale
            scaleTo={0.8}
            hitSlop={HIT_SLOP}
            accessibilityRole="button"
            accessibilityLabel={
              isSaved ? "Remove this highlight from saved" : "Save this highlight"
            }
            accessibilityState={{ selected: isSaved }}
            onPress={handleSave}
            style={styles.railBtn}
          >
            <Animated.View style={savePulseStyle}>
              <MaterialCommunityIcons
                name={isSaved ? "bookmark" : "bookmark-outline"}
                size={35}
                color={isSaved ? COLORS.accent : COLORS.white}
                style={styles.railIconShadow}
              />
            </Animated.View>
            <Text style={[styles.railCount, isSaved && styles.railCountActive]}>
              {isSaved ? "Saved" : "Save"}
            </Text>
          </PressableScale>

          {/* Challenge — Momentum's signature interaction */}
          {showBattleBtn && (
            <PressableScale
              scaleTo={0.85}
              onPress={() => {
                onBattle!(post);
              }}
              disabled={isBattling}
              accessibilityRole="button"
              accessibilityLabel={
                isOwnPost
                  ? "Open this post for challenges"
                  : `Challenge ${post.username} to a battle`
              }
              accessibilityState={{ disabled: isBattling, busy: isBattling }}
              hitSlop={HIT_SLOP}
              style={styles.railBtn}
            >
              <View style={styles.challengeWrap}>
                {/* Slow idle pulse ring — active card only, reduced-motion aware */}
                <Animated.View
                  pointerEvents="none"
                  style={[styles.challengeRing, challengeRingStyle]}
                />
                <View style={[styles.challengeBtn, isBattling && styles.challengeBtnLoading]}>
                  <MaterialCommunityIcons
                    name="sword-cross"
                    size={27}
                    color={isBattling ? COLORS.accent : COLORS.black}
                  />
                </View>
              </View>
              <Text style={styles.challengeLabel}>
                {isBattling ? "STARTING…" : isOwnPost ? "START BATTLE" : "CHALLENGE"}
              </Text>
            </PressableScale>
          )}
        </View>
      </Animated.View>

      {/* ── Mute indicator — fades in/out with state changes ─────────────────── */}
      {postIsVideo && normalizedMediaUrl && !mediaError && mountVideoPlayer && (
        <Animated.View
          entering={reducedMotion ? undefined : FadeIn.duration(200)}
          exiting={reducedMotion ? undefined : FadeOut.duration(200)}
          style={[styles.muteBadge, { top: muteBadgeTop }]}
          accessible
          accessibilityLabel={isMuted ? "Muted" : "Sound on"}
        >
          <Feather name={isMuted ? "volume-x" : "volume-2"} size={13} color={COLORS.white} />
        </Animated.View>
      )}
    </View>
  );
}

export default memo(PostCard);

const RAIL_WIDTH = 82;
const CHALLENGE_SIZE = 54;

const styles = StyleSheet.create({
  page: {
    width: "100%",
    backgroundColor: COLORS.black,
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
    backgroundColor: COLORS.surfaceDeep,
  },
  videoErrorLabel: {
    color: COLORS.textMuted,
    fontSize: 11,
    fontWeight: FONTS.bold,
    letterSpacing: 1.5,
    textTransform: "uppercase",
    opacity: 0.6,
  },

  // ── Scrims ───────────────────────────────────────────────────────────────────
  scrimTop: {
    position: "absolute",
    top: 0,
    left: 0,
    right: 0,
    height: 140,
  },
  scrimBottom: {
    position: "absolute",
    bottom: 0,
    left: 0,
    right: 0,
    height: "30%",
  },
  scrimRail: {
    position: "absolute",
    right: 0,
    bottom: 0,
    width: RAIL_WIDTH + 26,
    height: "58%",
  },

  // ── Overlay chrome ───────────────────────────────────────────────────────────
  overlay: {
    ...StyleSheet.absoluteFillObject,
    justifyContent: "flex-end",
  },

  // Bottom-left info stack
  infoStack: {
    position: "absolute",
    left: SPACING.lg,
    right: RAIL_WIDTH + SPACING.md,
    bottom: SPACING.lg,
    gap: SPACING.sm + 2,
  },
  badgeRow: {
    flexDirection: "row",
    flexWrap: "wrap",
    gap: 6,
  },
  identityRow: {
    flexDirection: "row",
    alignItems: "center",
    gap: SPACING.md,
  },
  avatarWrap: {
    width: 56,
    height: 56,
  },
  avatarRing: {
    width: 56,
    height: 56,
    borderRadius: 28,
    borderWidth: 2,
    borderColor: "rgba(255,255,255,0.35)",
    alignItems: "center",
    justifyContent: "center",
  },
  avatarRingVerified: {
    borderColor: COLORS.accent,
  },
  followBadgeTouch: {
    position: "absolute",
    bottom: -6,
    alignSelf: "center",
  },
  followBadge: {
    width: 20,
    height: 20,
    borderRadius: 10,
    backgroundColor: COLORS.accent,
    alignItems: "center",
    justifyContent: "center",
    borderWidth: 1.5,
    borderColor: COLORS.black,
  },
  followBadgeActive: {
    backgroundColor: COLORS.black,
    borderColor: COLORS.accent,
  },
  identityText: { flex: 1, gap: 2 },
  nameRow: {
    flexDirection: "row",
    alignItems: "center",
    gap: 5,
  },
  username: {
    color: COLORS.textPrimary,
    fontWeight: FONTS.heavy,
    fontSize: TYPE.headline,
    letterSpacing: 0.2,
    textShadowColor: "rgba(0,0,0,0.6)",
    textShadowOffset: { width: 0, height: 1 },
    textShadowRadius: 3,
    flexShrink: 1,
  },
  handleLine: {
    color: "rgba(255,255,255,0.62)",
    fontSize: TYPE.caption,
    textShadowColor: "rgba(0,0,0,0.6)",
    textShadowOffset: { width: 0, height: 1 },
    textShadowRadius: 3,
  },
  metaLine: {
    color: "rgba(255,255,255,0.92)",
    fontSize: TYPE.small,
    fontWeight: FONTS.bold,
    letterSpacing: 0.3,
    textShadowColor: "rgba(0,0,0,0.6)",
    textShadowOffset: { width: 0, height: 1 },
    textShadowRadius: 3,
  },
  programLine: {
    color: "rgba(255,255,255,0.78)",
    fontSize: TYPE.small,
    fontWeight: FONTS.medium,
    letterSpacing: 0.2,
    textShadowColor: "rgba(0,0,0,0.6)",
    textShadowOffset: { width: 0, height: 1 },
    textShadowRadius: 3,
  },
  caption: {
    color: "rgba(255,255,255,0.95)",
    fontSize: TYPE.body,
    lineHeight: 20,
    textShadowColor: "rgba(0,0,0,0.6)",
    textShadowOffset: { width: 0, height: 1 },
    textShadowRadius: 3,
  },
  hashtag: {
    color: COLORS.accent,
    fontWeight: FONTS.bold,
  },
  musicRow: {
    flexDirection: "row",
    alignItems: "center",
    gap: 6,
  },
  musicText: {
    color: "rgba(255,255,255,0.85)",
    fontSize: TYPE.caption,
    fontWeight: FONTS.semibold,
  },

  // Bottom-right action rail
  rail: {
    position: "absolute",
    right: SPACING.sm,
    bottom: SPACING.lg,
    width: RAIL_WIDTH - SPACING.sm,
    alignItems: "center",
    gap: SPACING.lg + 2,
  },
  railBtn: {
    alignItems: "center",
    gap: 3,
    minWidth: 44, // accessible touch target
  },
  railIconShadow: {
    textShadowColor: "rgba(0,0,0,0.55)",
    textShadowOffset: { width: 0, height: 1 },
    textShadowRadius: 4,
  },
  railCount: {
    color: COLORS.white,
    fontSize: TYPE.small,
    fontWeight: FONTS.bold,
    textShadowColor: "rgba(0,0,0,0.55)",
    textShadowOffset: { width: 0, height: 1 },
    textShadowRadius: 3,
  },
  railCountActive: { color: COLORS.accent },
  challengeWrap: {
    width: CHALLENGE_SIZE,
    height: CHALLENGE_SIZE,
    alignItems: "center",
    justifyContent: "center",
  },
  challengeRing: {
    position: "absolute",
    width: CHALLENGE_SIZE,
    height: CHALLENGE_SIZE,
    borderRadius: CHALLENGE_SIZE / 2,
    borderWidth: 1.5,
    borderColor: COLORS.accent,
  },
  challengeBtn: {
    width: CHALLENGE_SIZE,
    height: CHALLENGE_SIZE,
    borderRadius: CHALLENGE_SIZE / 2,
    backgroundColor: COLORS.accent,
    alignItems: "center",
    justifyContent: "center",
    ...GLOW.accent,
  },
  challengeBtnLoading: {
    backgroundColor: COLORS.accentFaint,
    borderWidth: 1.5,
    borderColor: COLORS.accent,
  },
  challengeLabel: {
    color: COLORS.accent,
    fontSize: TYPE.micro,
    fontWeight: FONTS.heavy,
    letterSpacing: 0.8,
    textShadowColor: "rgba(0,0,0,0.55)",
    textShadowOffset: { width: 0, height: 1 },
    textShadowRadius: 3,
  },

  // ── Floating elements over media ─────────────────────────────────────────────
  muteBadge: {
    position: "absolute",
    // top applied inline — safe-area dependent.
    right: SPACING.md,
    width: 28,
    height: 28,
    borderRadius: 14,
    backgroundColor: COLORS.scrimBadge,
    alignItems: "center",
    justifyContent: "center",
  },
  trimBadge: {
    position: "absolute",
    top: 150,
    left: SPACING.md,
    paddingHorizontal: SPACING.sm,
    paddingVertical: 4,
    borderRadius: RADIUS.xs,
    backgroundColor: COLORS.scrimBadge,
  },
  trimText: {
    color: COLORS.accent,
    fontSize: TYPE.caption,
    fontWeight: FONTS.bold,
  },
  postTextOverlayWrap: {
    position: "absolute",
    left: SPACING.xl,
    right: SPACING.xl,
    top: "30%",
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
    alignSelf: "center",
    top: "38%",
  },
  pressedDim: { opacity: 0.75 },
});
