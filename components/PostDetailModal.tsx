import React, { useCallback, useEffect, useState } from "react";
import { View, Text, Modal, StyleSheet } from "react-native";
import { SafeAreaView } from "react-native-safe-area-context";
import { COLORS, SPACING, FONTS, TYPE } from "@/constants/theme";
import PostCard from "./PostCard";
import CommentsSheet from "./CommentsSheet";
import IconButton from "./IconButton";
import type { Post } from "@/types";

interface Props {
  post: Post | null;
  visible: boolean;
  onClose: () => void;
  currentUserId: string | null;
  onBattle: (post: Post) => void;
  isBattling?: boolean;
  isFollowing?: boolean;
  onFollow?: (userId: string, isCurrentlyFollowing: boolean) => void;
}

/**
 * Full-screen post viewer opened from the profile grids — shared by both
 * profile screens. Reuses PostCard (identity hierarchy, media, caption,
 * interaction rail, Challenge CTA) so the detail layer matches the feed
 * exactly, and layers the CommentsSheet on top for discussion.
 */
export default function PostDetailModal({
  post,
  visible,
  onClose,
  currentUserId,
  onBattle,
  isBattling = false,
  isFollowing,
  onFollow,
}: Props) {
  const [commentsOpen, setCommentsOpen] = useState(false);

  // Close the thread whenever the viewer closes or the post changes so a
  // stale sheet can't reopen over a different highlight.
  const postId = post?.id ?? null;
  useEffect(() => {
    setCommentsOpen(false);
  }, [postId, visible]);

  const openComments = useCallback(() => setCommentsOpen(true), []);
  const closeComments = useCallback(() => setCommentsOpen(false), []);

  if (!post) return null;

  return (
    <Modal visible={visible} animationType="slide" onRequestClose={onClose}>
      <SafeAreaView style={styles.safe} edges={["top"]}>
        {/* Compact navigation header */}
        <View style={styles.topBar}>
          <IconButton
            icon="chevron-left"
            accessibilityLabel="Close post"
            onPress={onClose}
            color={COLORS.textPrimary}
          />
          <Text style={styles.topBarTitle} accessibilityRole="header" numberOfLines={1}>
            {post.username}'s highlight
          </Text>
          {/* Spacer balances the back button so the title stays centered */}
          <View style={styles.topBarSpacer} />
        </View>

        <PostCard
          post={post}
          isLiked={false}
          onLike={() => undefined}
          onComment={openComments}
          currentUserId={currentUserId}
          isFollowing={isFollowing}
          onFollow={onFollow}
          onBattle={onBattle}
          isBattling={isBattling}
          enableVideoPlayback
          isActiveVideo
          isActiveCard
        />

        {/* Comment thread — flat comments, loads on first open */}
        <CommentsSheet
          visible={commentsOpen}
          post={post}
          currentUserId={currentUserId}
          onClose={closeComments}
        />
      </SafeAreaView>
    </Modal>
  );
}

const styles = StyleSheet.create({
  safe: { flex: 1, backgroundColor: COLORS.background },
  topBar: {
    flexDirection: "row",
    alignItems: "center",
    paddingHorizontal: SPACING.lg,
    paddingTop: SPACING.sm,
    paddingBottom: SPACING.xs,
    gap: SPACING.sm,
  },
  topBarTitle: {
    flex: 1,
    color: COLORS.textPrimary,
    fontSize: TYPE.callout,
    fontWeight: FONTS.heavy,
    letterSpacing: 0.2,
    textAlign: "center",
  },
  topBarSpacer: { width: 36 },
});
