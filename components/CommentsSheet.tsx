import React, { memo, useCallback, useEffect, useState } from "react";
import {
  View,
  Text,
  Modal,
  Pressable,
  StyleSheet,
  FlatList,
  TextInput,
  Platform,
  Alert,
  ActivityIndicator,
  KeyboardAvoidingView,
  TextInputKeyPressEventData,
  NativeSyntheticEvent,
} from "react-native";
import { Feather } from "@expo/vector-icons";
import Animated, {
  FadeIn,
  useSharedValue,
  useAnimatedStyle,
  useReducedMotion,
  withRepeat,
  withSequence,
  withTiming,
  Easing,
  cancelAnimation,
} from "react-native-reanimated";
import { useSafeAreaInsets } from "react-native-safe-area-context";
import { COLORS, SPACING, RADIUS, FONTS, TYPE, HIT_SLOP } from "@/constants/theme";
import AvatarImage from "./AvatarImage";
import IconButton from "./IconButton";
import { useAuthStore } from "@/store/authStore";
import { useComments } from "@/hooks/useComments";
import { MAX_COMMENT_LENGTH } from "@/services/commentRepository";
import { notifyComment } from "@/services/notificationRepository";
import { toHandle, formatRelativeTime } from "@/utils/format";
import type { Post, PostComment } from "@/types";

interface Props {
  visible: boolean;
  post: Post | null;
  currentUserId: string | null;
  onClose: () => void;
}

// ─── Comment row — memoized so composer keystrokes never re-render rows ──────
const CommentRow = memo(function CommentRow({
  comment,
  isOwn,
  isDeleting,
  onDelete,
  reducedMotion,
}: {
  comment: PostComment;
  isOwn: boolean;
  isDeleting: boolean;
  onDelete: (comment: PostComment) => void;
  reducedMotion: boolean;
}) {
  const age = formatRelativeTime(comment.createdAt);
  return (
    <Animated.View
      entering={reducedMotion ? undefined : FadeIn.duration(160)}
      style={styles.row}
      accessible
      accessibilityLabel={`Comment by ${comment.username}${age ? `, ${age} ago` : ""}: ${comment.text}`}
    >
      <AvatarImage uri={comment.avatar || null} username={comment.username} size={34} />
      <View style={styles.rowBody}>
        <View style={styles.rowHeader}>
          <Text style={styles.rowName} numberOfLines={1}>
            {comment.username}
          </Text>
          <Text style={styles.rowMeta} numberOfLines={1}>
            {toHandle(comment.username)}{age ? `  ·  ${age}` : ""}
          </Text>
        </View>
        <Text style={styles.rowText}>{comment.text}</Text>
      </View>
      {isOwn && (
        <Pressable
          onPress={() => onDelete(comment)}
          disabled={isDeleting}
          hitSlop={HIT_SLOP}
          accessibilityRole="button"
          accessibilityLabel="Delete your comment"
          accessibilityState={{ disabled: isDeleting, busy: isDeleting }}
          style={({ pressed }) => [styles.deleteBtn, pressed && { opacity: 0.6 }]}
        >
          {isDeleting ? (
            <ActivityIndicator size="small" color={COLORS.textMuted} />
          ) : (
            <Feather name="trash-2" size={14} color={COLORS.textMuted} />
          )}
        </Pressable>
      )}
    </Animated.View>
  );
});

// ─── Layout-stable loading skeleton (single shared UI-thread pulse) ──────────
function CommentSkeleton() {
  const pulse = useSharedValue(0.45);
  useEffect(() => {
    pulse.value = withRepeat(
      withSequence(
        withTiming(1, { duration: 650, easing: Easing.inOut(Easing.quad) }),
        withTiming(0.45, { duration: 650, easing: Easing.inOut(Easing.quad) })
      ),
      -1
    );
    return () => cancelAnimation(pulse);
  }, [pulse]);
  const pulseStyle = useAnimatedStyle(() => ({ opacity: pulse.value }));
  return (
    <Animated.View
      style={pulseStyle}
      accessibilityRole="progressbar"
      accessibilityLabel="Loading comments"
    >
      {[0, 1, 2].map((i) => (
        <View key={i} style={styles.row}>
          <View style={styles.skelAvatar} />
          <View style={styles.rowBody}>
            <View style={[styles.skelLine, { width: "38%" }]} />
            <View style={[styles.skelLine, { width: "82%", marginTop: 8 }]} />
          </View>
        </View>
      ))}
    </Animated.View>
  );
}

const keyExtractor = (item: PostComment) => item.id;

/**
 * Bottom-sheet comment thread for a post. Flat comments only (matches the
 * stored model — no reply relationships exist). Composer state lives here,
 * so typing never re-renders the post underneath.
 */
export default function CommentsSheet({
  visible,
  post,
  currentUserId,
  onClose,
}: Props) {
  const profile = useAuthStore((s) => s.profile);
  const insets = useSafeAreaInsets();
  const reducedMotion = useReducedMotion();
  const postId = post?.id ?? null;
  const {
    comments,
    loading,
    loaded,
    loadError,
    submitting,
    submitError,
    deletingId,
    refresh,
    submit,
    remove,
  } = useComments(postId, visible);

  const [draft, setDraft] = useState("");

  // Reset the draft only when switching to a DIFFERENT post — closing and
  // reopening the same post keeps unsent text.
  useEffect(() => {
    setDraft("");
  }, [postId]);

  const canComment = !!currentUserId && !!profile;
  const canSend = canComment && draft.trim().length > 0 && !submitting;

  const handleSend = useCallback(async () => {
    if (!canSend || !currentUserId || !profile || !post) return;
    const accepted = await submit(draft, {
      userId: currentUserId,
      username: profile.username,
      avatar: profile.avatarUrl || profile.avatar,
    });
    // Clear ONLY after the backend accepted the comment.
    if (accepted) {
      setDraft("");
      // Notify the post owner (skipped automatically for self-comments);
      // keyed on the comment id so it can never duplicate.
      notifyComment(post.userId, post.id, accepted.id, accepted.text);
    }
  }, [canSend, currentUserId, profile, post, submit, draft]);

  // Web: Enter sends, Shift+Enter inserts a newline.
  const handleKeyPress = useCallback(
    (event: NativeSyntheticEvent<TextInputKeyPressEventData>) => {
      if (Platform.OS !== "web") return;
      const native = event.nativeEvent as TextInputKeyPressEventData & {
        shiftKey?: boolean;
      };
      if (native.key === "Enter" && !native.shiftKey) {
        event.preventDefault?.();
        void handleSend();
      }
    },
    [handleSend]
  );

  const handleDelete = useCallback(
    (comment: PostComment) => {
      const doDelete = async () => {
        const ok = await remove(comment.id);
        if (!ok) {
          Alert.alert("Delete failed", "Could not delete that comment. Try again.");
        }
      };
      if (Platform.OS === "web") {
        const confirmed =
          typeof window !== "undefined" && typeof window.confirm === "function"
            ? window.confirm("Delete this comment?")
            : true;
        if (confirmed) void doDelete();
        return;
      }
      Alert.alert("Delete comment?", "This can't be undone.", [
        { text: "Cancel", style: "cancel" },
        { text: "Delete", style: "destructive", onPress: () => void doDelete() },
      ]);
    },
    [remove]
  );

  const renderItem = useCallback(
    ({ item }: { item: PostComment }) => (
      <CommentRow
        comment={item}
        isOwn={!!currentUserId && item.userId === currentUserId}
        isDeleting={deletingId === item.id}
        onDelete={handleDelete}
        reducedMotion={reducedMotion}
      />
    ),
    [currentUserId, deletingId, handleDelete, reducedMotion]
  );

  if (!post) return null;

  return (
    <Modal visible={visible} transparent animationType="slide" onRequestClose={onClose}>
      <View style={styles.overlay}>
        <Pressable
          style={styles.backdrop}
          onPress={onClose}
          accessibilityRole="button"
          accessibilityLabel="Close comments"
        />
        <KeyboardAvoidingView
          behavior={Platform.OS === "ios" ? "padding" : undefined}
          style={styles.kav}
          pointerEvents="box-none"
        >
          {/* SAFE AREA: the sheet sits on the screen edge — the composer must
              clear the home indicator when the keyboard is closed. */}
          <View style={[styles.sheet, { paddingBottom: SPACING.lg + insets.bottom }]}>
            <View style={styles.handle} />

            {/* Header — real count only once loaded */}
            <View style={styles.header}>
              <Text style={styles.title} accessibilityRole="header">
                Comments{loaded ? ` (${comments.length})` : ""}
              </Text>
              <IconButton
                icon="x"
                size={30}
                accessibilityLabel="Close comments"
                onPress={onClose}
              />
            </View>

            {/* Load error — cached comments stay visible below */}
            {loadError && (
              <View style={styles.errorBanner} accessibilityRole="alert">
                <Feather name="alert-triangle" size={13} color={COLORS.warning} />
                <Text style={styles.errorBannerText}>
                  Couldn't load comments.
                </Text>
                <Pressable
                  onPress={refresh}
                  hitSlop={HIT_SLOP}
                  accessibilityRole="button"
                  accessibilityLabel="Retry loading comments"
                >
                  <Text style={styles.retryText}>Retry</Text>
                </Pressable>
              </View>
            )}

            {/* Thread */}
            {loading && comments.length === 0 ? (
              <CommentSkeleton />
            ) : comments.length === 0 ? (
              <Animated.View
                entering={reducedMotion ? undefined : FadeIn.duration(220)}
                style={styles.empty}
              >
                <Text style={styles.emptyIcon}>💬</Text>
                <Text style={styles.emptyTitle}>No comments yet</Text>
                <Text style={styles.emptySub}>Start the conversation.</Text>
              </Animated.View>
            ) : (
              <FlatList
                data={comments}
                keyExtractor={keyExtractor}
                renderItem={renderItem}
                style={styles.list}
                contentContainerStyle={styles.listContent}
                keyboardShouldPersistTaps="handled"
                showsVerticalScrollIndicator={false}
                initialNumToRender={12}
                maxToRenderPerBatch={8}
                updateCellsBatchingPeriod={50}
                windowSize={7}
              />
            )}

            {/* Composer */}
            <View style={styles.composerWrap}>
              {submitError && (
                <Text style={styles.submitError} accessibilityRole="alert">
                  {`Couldn't post your comment — your text is saved, try again.`}
                </Text>
              )}
              <View style={styles.composer}>
                <TextInput
                  style={styles.input}
                  placeholder={
                    canComment ? "Add a comment…" : "Sign in to comment"
                  }
                  placeholderTextColor={COLORS.textMuted}
                  value={draft}
                  onChangeText={setDraft}
                  onKeyPress={handleKeyPress}
                  multiline
                  maxLength={MAX_COMMENT_LENGTH}
                  editable={canComment && !submitting}
                  accessibilityLabel="Comment text"
                  blurOnSubmit={false}
                />
                <Pressable
                  onPress={handleSend}
                  disabled={!canSend}
                  hitSlop={HIT_SLOP}
                  accessibilityRole="button"
                  accessibilityLabel="Send comment"
                  accessibilityState={{ disabled: !canSend, busy: submitting }}
                  style={({ pressed }) => [
                    styles.sendBtn,
                    !canSend && styles.sendBtnDisabled,
                    pressed && canSend && { opacity: 0.8 },
                  ]}
                >
                  {submitting ? (
                    <ActivityIndicator size="small" color={COLORS.black} />
                  ) : (
                    <Feather
                      name="arrow-up"
                      size={18}
                      color={canSend ? COLORS.black : COLORS.textMuted}
                    />
                  )}
                </Pressable>
              </View>
            </View>
          </View>
        </KeyboardAvoidingView>
      </View>
    </Modal>
  );
}

const styles = StyleSheet.create({
  overlay: { flex: 1, justifyContent: "flex-end" },
  backdrop: {
    ...StyleSheet.absoluteFillObject,
    backgroundColor: COLORS.scrim,
  },
  kav: { justifyContent: "flex-end" },
  sheet: {
    backgroundColor: COLORS.card,
    borderTopLeftRadius: RADIUS.xl,
    borderTopRightRadius: RADIUS.xl,
    maxHeight: 560,
    minHeight: 320,
    // paddingBottom applied inline: SPACING.lg + safe-area bottom inset.
  },
  handle: {
    width: 40,
    height: 4,
    borderRadius: 2,
    backgroundColor: COLORS.inputBorder,
    alignSelf: "center",
    marginTop: SPACING.sm,
    marginBottom: SPACING.xs,
  },
  header: {
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "space-between",
    paddingHorizontal: SPACING.lg,
    paddingBottom: SPACING.sm,
    borderBottomWidth: 1,
    borderBottomColor: COLORS.cardBorder,
  },
  title: {
    color: COLORS.textPrimary,
    fontSize: TYPE.headline,
    fontWeight: FONTS.heavy,
    letterSpacing: 0.2,
  },

  // Error banner
  errorBanner: {
    flexDirection: "row",
    alignItems: "center",
    gap: SPACING.sm,
    marginHorizontal: SPACING.lg,
    marginTop: SPACING.sm,
    paddingHorizontal: SPACING.md,
    paddingVertical: SPACING.sm,
    borderRadius: RADIUS.md,
    borderWidth: 1,
    borderColor: COLORS.warningBorder,
    backgroundColor: COLORS.warningFaint,
  },
  errorBannerText: {
    flex: 1,
    color: COLORS.textSecondary,
    fontSize: TYPE.small,
  },
  retryText: {
    color: COLORS.accent,
    fontSize: TYPE.small,
    fontWeight: FONTS.bold,
  },

  // Rows
  list: { flexGrow: 0 },
  listContent: { paddingVertical: SPACING.sm },
  row: {
    flexDirection: "row",
    alignItems: "flex-start",
    gap: SPACING.md,
    paddingHorizontal: SPACING.lg,
    paddingVertical: SPACING.sm + 2,
  },
  rowBody: { flex: 1, gap: 2 },
  rowHeader: {
    flexDirection: "row",
    alignItems: "center",
    gap: 6,
  },
  rowName: {
    color: COLORS.textPrimary,
    fontSize: TYPE.footnote,
    fontWeight: FONTS.bold,
    flexShrink: 1,
  },
  rowMeta: {
    color: COLORS.textMuted,
    fontSize: TYPE.caption,
    flexShrink: 1,
  },
  rowText: {
    color: COLORS.textSecondary,
    fontSize: TYPE.body,
    lineHeight: 20,
  },
  deleteBtn: {
    width: 28,
    height: 28,
    alignItems: "center",
    justifyContent: "center",
  },

  // Skeleton
  skelAvatar: {
    width: 34,
    height: 34,
    borderRadius: 17,
    backgroundColor: COLORS.surface,
  },
  skelLine: {
    height: 9,
    borderRadius: 5,
    backgroundColor: COLORS.surface,
  },

  // Empty
  empty: {
    alignItems: "center",
    paddingVertical: SPACING.xxl,
    gap: 4,
  },
  emptyIcon: { fontSize: 32, marginBottom: SPACING.xs },
  emptyTitle: {
    color: COLORS.textPrimary,
    fontSize: TYPE.callout,
    fontWeight: FONTS.bold,
  },
  emptySub: {
    color: COLORS.textMuted,
    fontSize: TYPE.footnote,
  },

  // Composer
  composerWrap: {
    borderTopWidth: 1,
    borderTopColor: COLORS.cardBorder,
    paddingHorizontal: SPACING.lg,
    paddingTop: SPACING.sm,
    gap: SPACING.xs,
  },
  submitError: {
    color: COLORS.error,
    fontSize: TYPE.caption,
  },
  composer: {
    flexDirection: "row",
    alignItems: "flex-end",
    gap: SPACING.sm,
  },
  input: {
    flex: 1,
    backgroundColor: COLORS.input,
    borderWidth: 1,
    borderColor: COLORS.inputBorder,
    borderRadius: RADIUS.lg,
    color: COLORS.textPrimary,
    paddingHorizontal: SPACING.md,
    paddingTop: SPACING.sm + 2,
    paddingBottom: SPACING.sm + 2,
    fontSize: TYPE.base,
    maxHeight: 110,
  },
  sendBtn: {
    width: 44,
    height: 44,
    borderRadius: 22,
    backgroundColor: COLORS.accent,
    alignItems: "center",
    justifyContent: "center",
  },
  sendBtnDisabled: {
    backgroundColor: COLORS.surface,
    borderWidth: 1,
    borderColor: COLORS.inputBorder,
  },
});
