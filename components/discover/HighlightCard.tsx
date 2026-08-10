import React, { memo, useCallback } from "react";
import { View, Text, Pressable, StyleSheet } from "react-native";
import { MaterialCommunityIcons, Feather } from "@expo/vector-icons";
import { COLORS, SPACING, RADIUS, FONTS, TYPE } from "@/constants/theme";
import AvatarImage from "@/components/AvatarImage";
import MediaTile from "@/components/MediaTile";
import { isVideoMedia } from "@/utils/media";
import type { Post } from "@/types";

interface Props {
  post: Post;
  /** Opens the existing PostDetailModal, which carries like/comment/share. */
  onOpen: (post: Post) => void;
  onOpenAthlete: (userId: string) => void;
}

/**
 * Trending highlight card.
 *
 * Shows the stored likesCount and nothing else numeric — Momentum tracks no
 * view count, and comment counts are never written, so neither is displayed
 * here. The card opens PostDetailModal rather than reimplementing the
 * interaction rail, so like / comment / share stay in exactly one place.
 */
function HighlightCard({ post, onOpen, onOpenAthlete }: Props) {
  const open = useCallback(() => onOpen(post), [post, onOpen]);
  const openAthlete = useCallback(
    () => onOpenAthlete(post.userId),
    [post.userId, onOpenAthlete]
  );

  const isVideo = isVideoMedia(post.mediaUrl, post.mediaType);
  const avatar = post.avatarUrl || post.userAvatar;

  return (
    <View style={styles.card}>
      <Pressable
        onPress={open}
        accessibilityRole="button"
        accessibilityLabel={
          `${isVideo ? "Video" : "Photo"} highlight by ${post.username}` +
          `${post.caption?.trim() ? `: ${post.caption.trim()}` : ""}. ` +
          `${post.likesCount} ${post.likesCount === 1 ? "like" : "likes"}. Open.`
        }
        style={({ pressed }) => [styles.mediaWrap, pressed && styles.pressed]}
      >
        <MediaTile
          uri={post.mediaUrl}
          mediaType={post.mediaType}
          style={StyleSheet.absoluteFillObject}
          context="DiscoverHighlight"
          postId={post.id}
        />
        {isVideo && (
          <View style={styles.playBadge} pointerEvents="none">
            <Feather name="play" size={14} color={COLORS.white} />
          </View>
        )}
        <View style={styles.likePill} pointerEvents="none">
          <MaterialCommunityIcons name="heart" size={11} color={COLORS.accent} />
          <Text style={styles.likeText}>{post.likesCount}</Text>
        </View>
      </Pressable>

      {/* Author row is its own pressable so it opens the profile, not the post */}
      <Pressable
        onPress={openAthlete}
        accessibilityRole="button"
        accessibilityLabel={`Open ${post.username}'s profile`}
        style={({ pressed }) => [styles.authorRow, pressed && styles.pressed]}
      >
        <AvatarImage uri={avatar} username={post.username} size={24} />
        <View style={styles.authorText}>
          <Text style={styles.authorName} numberOfLines={1}>
            {post.username}
          </Text>
          {!!(post.sport || post.school) && (
            <Text style={styles.authorDetail} numberOfLines={1}>
              {[post.sport, post.school].filter(Boolean).join(" · ")}
            </Text>
          )}
        </View>
      </Pressable>
    </View>
  );
}

export default memo(HighlightCard);

const CARD_W = 150;
const MEDIA_H = 200;

const styles = StyleSheet.create({
  card: {
    width: CARD_W,
    borderRadius: RADIUS.lg,
    borderWidth: 1,
    borderColor: COLORS.cardBorder,
    backgroundColor: COLORS.surfaceRaised,
    overflow: "hidden",
  },
  pressed: { opacity: 0.8 },
  mediaWrap: {
    width: "100%",
    height: MEDIA_H,
    backgroundColor: COLORS.surfaceDeep,
  },
  playBadge: {
    position: "absolute",
    top: SPACING.sm,
    left: SPACING.sm,
    width: 24,
    height: 24,
    borderRadius: 12,
    alignItems: "center",
    justifyContent: "center",
    backgroundColor: COLORS.scrimBadge,
  },
  likePill: {
    position: "absolute",
    bottom: SPACING.sm,
    left: SPACING.sm,
    flexDirection: "row",
    alignItems: "center",
    gap: 3,
    paddingHorizontal: 6,
    paddingVertical: 3,
    borderRadius: RADIUS.xs,
    backgroundColor: COLORS.scrimBadge,
  },
  likeText: {
    color: COLORS.white,
    fontSize: TYPE.micro,
    fontWeight: FONTS.bold,
  },
  authorRow: {
    flexDirection: "row",
    alignItems: "center",
    gap: SPACING.sm,
    padding: SPACING.sm,
    minHeight: 44,
  },
  authorText: { flex: 1, gap: 1 },
  authorName: {
    color: COLORS.textPrimary,
    fontSize: TYPE.micro,
    fontWeight: FONTS.bold,
  },
  authorDetail: {
    color: COLORS.textMuted,
    fontSize: 10,
  },
});
