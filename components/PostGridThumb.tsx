import React, { memo, useCallback } from "react";
import { View, Text, Pressable, StyleSheet, Dimensions, Alert } from "react-native";
import { showAlert, confirm } from "@/utils/alert";
import { Feather, MaterialCommunityIcons } from "@expo/vector-icons";
import { COLORS, SPACING, RADIUS, FONTS } from "@/constants/theme";
import MediaTile from "./MediaTile";
import PostOwnerMenu from "./PostOwnerMenu";
import type { Post } from "@/types";

const SCREEN_W = Dimensions.get("window").width;
/** 3-column grid cell size, matching the profile grid's padding + gaps. */
const CELL = (SCREEN_W - SPACING.lg * 2 - SPACING.sm * 2) / 3;

interface Props {
  post: Post;
  onPress: (post: Post) => void;
  /** Diagnostic label passed through to MediaTile logs. */
  context?: string;
  /** Dim the tile once the viewer has already opened it (caller-provided). */
  viewed?: boolean;
  currentUserId?: string | null;
  onDeleted?: (postId: string) => void;
}

/** Compact count for the grid like overlay: 1400 → "1.4K". */
function formatCount(n: number): string {
  if (n >= 1_000_000) return `${(n / 1_000_000).toFixed(1).replace(/\.0$/, "")}M`;
  if (n >= 1_000) return `${(n / 1_000).toFixed(1).replace(/\.0$/, "")}K`;
  return String(n);
}

/**
 * Square media thumbnail for the profile posts grid — shared by the own-profile
 * and player-profile screens. Indicators (video, battle, pinned, likes) render
 * only from real post data.
 */
function PostGridThumb({
  post,
  onPress,
  context = "ProfileGrid",
  viewed = false,
  currentUserId,
  onDeleted,
}: Props) {
  const [ownerMenuOpen, setOwnerMenuOpen] = React.useState(false);
  const handlePress = useCallback(() => onPress(post), [onPress, post]);
  const isOwner = !!currentUserId && currentUserId === post.userId;
  const indicatorParts = [
    post.mediaType === "video" ? "video" : "photo",
    post.pinned ? "pinned" : null,
    post.battleEnabled ? "open for challenge" : null,
  ].filter(Boolean);

  return (
    <View style={styles.wrap}>
      <Pressable
        onPress={handlePress}
        accessibilityRole="imagebutton"
        accessibilityLabel={
          post.caption
            ? `${indicatorParts.join(", ")} post: ${post.caption}`
            : `${indicatorParts.join(", ")} post`
        }
        accessibilityState={{ selected: viewed }}
        style={({ pressed }) => pressed && styles.pressed}
      >
        <MediaTile
          uri={post.mediaUrl || null}
          mediaType={post.mediaType}
          style={styles.thumb}
          context={context}
        />

        {/* Viewed — subtle dim so state isn't color-only (also in a11y state) */}
        {viewed && <View style={styles.viewedOverlay} pointerEvents="none" />}

        {/* Top-left: pinned */}
        {post.pinned && (
          <View style={[styles.badge, styles.badgeTopLeft]}>
            <MaterialCommunityIcons name="pin" size={10} color={COLORS.accent} />
          </View>
        )}

        {/* Top-right: media / battle indicators */}
        <View style={[styles.badgeColumn, isOwner && styles.ownerBadgeColumn]} pointerEvents="none">
          {post.mediaType === "video" && (
            <View style={styles.badge}>
              <Feather name="play" size={10} color={COLORS.white} />
            </View>
          )}
          {post.battleEnabled && (
            <View style={[styles.badge, styles.badgeAccent]}>
              <MaterialCommunityIcons name="sword-cross" size={10} color={COLORS.accent} />
            </View>
          )}
        </View>

        {/* Bottom-left: likes (real data, only when non-zero) */}
        {post.likesCount > 0 && (
          <View style={styles.likesRow} pointerEvents="none">
            <MaterialCommunityIcons name="heart" size={10} color={COLORS.white} />
            <Text style={styles.likesText}>{formatCount(post.likesCount)}</Text>
          </View>
        )}
      </Pressable>

      {isOwner && (
        <Pressable
          onPress={() => setOwnerMenuOpen(true)}
          accessibilityRole="button"
          accessibilityLabel="Post options"
          hitSlop={8}
          style={({ pressed }) => [styles.ownerMenuButton, pressed && styles.pressed]}
        >
          <Feather name="more-horizontal" size={16} color={COLORS.white} />
        </Pressable>
      )}

      {isOwner && (
        <PostOwnerMenu
          postId={post.id}
          visible={ownerMenuOpen}
          onClose={() => setOwnerMenuOpen(false)}
          onDeleted={(postId) => onDeleted?.(postId)}
          onError={(message) => showAlert("Couldn’t delete post", message)}
          onWarning={(message) => showAlert("Post deleted", message)}
        />
      )}
    </View>
  );
}

export default memo(PostGridThumb);

const styles = StyleSheet.create({
  wrap: { position: "relative" },
  pressed: { opacity: 0.8 },
  thumb: {
    width: CELL,
    height: CELL,
    borderRadius: RADIUS.sm,
  },
  viewedOverlay: {
    ...StyleSheet.absoluteFillObject,
    borderRadius: RADIUS.sm,
    backgroundColor: "rgba(0,0,0,0.38)",
  },
  badgeColumn: {
    position: "absolute",
    top: 4,
    right: 4,
    gap: 3,
    alignItems: "flex-end",
  },
  ownerBadgeColumn: { top: 30 },
  ownerMenuButton: {
    position: "absolute",
    top: 4,
    right: 4,
    width: 26,
    height: 24,
    borderRadius: RADIUS.xs,
    alignItems: "center",
    justifyContent: "center",
    backgroundColor: COLORS.scrimBadge,
  },
  badge: {
    backgroundColor: COLORS.scrimBadge,
    borderRadius: RADIUS.xs,
    paddingHorizontal: 4,
    paddingVertical: 3,
    alignItems: "center",
    justifyContent: "center",
  },
  badgeAccent: {
    borderWidth: 1,
    borderColor: COLORS.accentBorderFaint,
  },
  badgeTopLeft: {
    position: "absolute",
    top: 4,
    left: 4,
  },
  likesRow: {
    position: "absolute",
    bottom: 4,
    left: 4,
    flexDirection: "row",
    alignItems: "center",
    gap: 3,
    backgroundColor: COLORS.scrimBadge,
    borderRadius: RADIUS.xs,
    paddingHorizontal: 4,
    paddingVertical: 2,
  },
  likesText: {
    color: COLORS.white,
    fontSize: 9,
    fontWeight: FONTS.bold,
  },
});
