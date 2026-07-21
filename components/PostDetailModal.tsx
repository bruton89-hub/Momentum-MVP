import React, { useCallback, useEffect, useRef, useState } from "react";
import { View, Text, Modal, StyleSheet, LayoutChangeEvent } from "react-native";
import { useRouter } from "expo-router";
import { useSafeAreaInsets } from "react-native-safe-area-context";
import { COLORS, SPACING, FONTS, TYPE } from "@/constants/theme";
import PostCard from "./PostCard";
import CommentsSheet from "./CommentsSheet";
import IconButton from "./IconButton";
import { useInteractionReady } from "@/hooks/useInteractionReady";
import type { Post } from "@/types";

interface Props {
  post: Post | null;
  visible: boolean;
  /** Modal callers close local state; route callers may omit this to use history. */
  onClose?: () => void;
  currentUserId: string | null;
  onBattle: (post: Post) => void;
  isBattling?: boolean;
  isFollowing?: boolean;
  onFollow?: (userId: string, isCurrentlyFollowing: boolean) => void;
}
const ignoreLike = () => undefined;
const HEADER_HEIGHT = 52;

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
  const router = useRouter();
  const insets = useSafeAreaInsets();
  const [commentsOpen, setCommentsOpen] = useState(false);
  const navigatingRef = useRef(false);
  // SAFE AREA: PostCard defaults to the full window height, but this modal's
  // usable area is shorter (top inset + nav bar + home indicator). Measure the
  // actual container so the card's bottom overlays (identity stack, action
  // rail, Challenge CTA) are never clipped or pushed under the home indicator.
  const [cardHeight, setCardHeight] = useState(0);
  const handleCardAreaLayout = useCallback((event: LayoutChangeEvent) => {
    const h = Math.round(event.nativeEvent.layout.height);
    setCardHeight((prev) => (prev === h ? prev : h));
  }, []);

  // Close the thread whenever the viewer closes or the post changes so a
  // stale sheet can't reopen over a different highlight.
  const postId = post?.id ?? null;
  const mediaReady = useInteractionReady(visible, postId);
  useEffect(() => {
    setCommentsOpen(false);
    if (visible) navigatingRef.current = false;
  }, [postId, visible]);

  const openComments = useCallback(() => setCommentsOpen(true), []);
  const closeComments = useCallback(() => setCommentsOpen(false), []);
  const handleBack = useCallback(() => {
    if (navigatingRef.current) return;
    navigatingRef.current = true;

    // Profile grids present this viewer as local modal state. Closing it is the
    // only correct way to reveal that exact profile/list position; popping the
    // router here would skip past the profile because the modal adds no route.
    if (onClose) {
      onClose();
      return;
    }

    // Route/deep-link safety for any caller that presents this component as a
    // screen: use native history when available, otherwise return to the tabs.
    if (router.canGoBack()) router.back();
    else router.replace("/(tabs)" as never);
  }, [onClose, router]);

  if (!post) return null;

  return (
    <Modal visible={visible} animationType="slide" onRequestClose={handleBack}>
      <View style={styles.safe}>
        <View
          style={[
            styles.cardArea,
            {
              marginTop: insets.top + HEADER_HEIGHT,
              paddingBottom: insets.bottom,
            },
          ]}
          onLayout={handleCardAreaLayout}
        >
          {cardHeight > 0 && (
            <PostCard
              post={post}
              height={cardHeight - insets.bottom}
              isLiked={false}
              onLike={ignoreLike}
              onComment={openComments}
              currentUserId={currentUserId}
              isFollowing={isFollowing}
              onFollow={onFollow}
              onBattle={onBattle}
              isBattling={isBattling}
              enableVideoPlayback={mediaReady}
              isActiveVideo={mediaReady}
              isActiveCard
              mountVideoPlayer={mediaReady}
            />
          )}
        </View>

        {/* Render after the media subtree and force a native top layer. This is
            critical on iOS, where AVPlayer-backed views can otherwise win hit
            testing even when the header is visually present. */}
        <View
          pointerEvents="box-none"
          style={[
            styles.topBar,
            { height: insets.top + HEADER_HEIGHT, paddingTop: insets.top },
          ]}
        >
          <IconButton
            icon="chevron-left"
            accessibilityLabel="Back"
            onPress={handleBack}
            color={COLORS.textPrimary}
            size={44}
            style={styles.backButton}
          />
          <Text style={styles.topBarTitle} accessibilityRole="header" numberOfLines={1}>
            {post.username}'s highlight
          </Text>
          {/* Spacer balances the 44pt back target so the title stays centered. */}
          <View style={styles.topBarSpacer} pointerEvents="none" />
        </View>

        {/* Comment thread — flat comments, loads on first open */}
        <CommentsSheet
          visible={commentsOpen}
          post={post}
          currentUserId={currentUserId}
          onClose={closeComments}
        />
      </View>
    </Modal>
  );
}

const styles = StyleSheet.create({
  safe: { flex: 1, backgroundColor: COLORS.background },
  cardArea: { flex: 1 },
  topBar: {
    position: "absolute",
    top: 0,
    left: 0,
    right: 0,
    flexDirection: "row",
    alignItems: "center",
    paddingHorizontal: SPACING.lg,
    gap: SPACING.sm,
    backgroundColor: COLORS.background,
    zIndex: 1000,
    elevation: 1000,
  },
  backButton: { zIndex: 1001, elevation: 1001 },
  topBarTitle: {
    flex: 1,
    color: COLORS.textPrimary,
    fontSize: TYPE.callout,
    fontWeight: FONTS.heavy,
    letterSpacing: 0.2,
    textAlign: "center",
  },
  topBarSpacer: { width: 44, height: 44 },
});
