/**
 * BattlePickerModal
 *
 * Challenge flow bottom sheet.
 * Shows the current user's own posts so they can pick one to battle against
 * a target post. On selection, creates a LIVE battle:
 *   playerA = target post owner (the person being challenged)
 *   playerB = current user (the challenger)
 *   status  = "live"   (open → accepted in one operation)
 */
import React, { useState, useEffect, useRef } from "react";
import {
  Modal,
  View,
  Text,
  Pressable,
  StyleSheet,
  ScrollView,
  ActivityIndicator,
  Alert,
} from "react-native";
import { Feather } from "@expo/vector-icons";
import { useSafeAreaInsets } from "react-native-safe-area-context";
import { createLiveBattle } from "@/hooks/useBattles";
import { notifyChallengeReceived } from "@/services/notificationRepository";
import { fetchPostsByUser } from "@/services/postRepository";
import { COLORS, SPACING, RADIUS, FONTS, TYPE } from "@/constants/theme";
import AvatarImage from "./AvatarImage";
import MediaTile from "./MediaTile";
import type { Post, BattlePlayer, UserProfile } from "@/types";

// ─── Thumb size ───────────────────────────────────────────────────────────────
const THUMB_W = 104;
const THUMB_H = 124;

interface Props {
  visible: boolean;
  /** The post that the current user wants to challenge */
  targetPost: Post | null;
  currentUserId: string;
  currentProfile: UserProfile | null;
  onClose: () => void;
  /** Fired after the battle is successfully created */
  onBattleCreated: () => void;
}

// ─── Per-post thumb — uses MediaTile for native-safe rendering ───────────────
function PostPickItem({
  p,
  isSelected,
  creating,
  onPress,
}: {
  p: Post;
  isSelected: boolean;
  creating: boolean;
  onPress: () => void;
}) {
  return (
    <Pressable
      key={p.id}
      onPress={onPress}
      disabled={creating}
      accessibilityRole="button"
      accessibilityLabel={`Battle with post: ${p.caption || "untitled post"}`}
      accessibilityState={{ selected: isSelected, disabled: creating }}
      style={({ pressed }) => [
        styles.thumbWrap,
        isSelected && styles.thumbWrapSelected,
        pressed && { opacity: 0.8 },
      ]}
    >
      {/* Explicit THUMB_W × THUMB_H so MediaTile's absoluteFillObject image
          resolves pixel dimensions without any percentage ambiguity on iOS. */}
      <MediaTile
        uri={p.mediaUrl || null}
        mediaType={p.mediaType}
        style={{ width: THUMB_W, height: THUMB_H }}
        context="BattlePickerModal"
      />

      {/* Loading overlay on the selected thumb */}
      {isSelected && creating && (
        <View style={styles.thumbLoadingOverlay}>
          <ActivityIndicator color={COLORS.accent} />
        </View>
      )}

      {/* Caption */}
      <Text style={styles.thumbCaption} numberOfLines={1}>
        {p.caption || "Post"}
      </Text>
    </Pressable>
  );
}

export default function BattlePickerModal({
  visible,
  targetPost,
  currentUserId,
  currentProfile,
  onClose,
  onBattleCreated,
}: Props) {
  const insets = useSafeAreaInsets();
  const [myPosts, setMyPosts] = useState<Post[]>([]);
  const [loadingPosts, setLoadingPosts] = useState(false);
  const [creating, setCreating] = useState(false);
  const [selectedPostId, setSelectedPostId] = useState<string | null>(null);
  const postsRequestRef = useRef(0);
  const creatingRef = useRef(false);

  // ── Load the current user's posts whenever the modal opens ──────────────────
  // Root-cause note:
  //   where("userId","==",uid) + orderBy("createdAt","desc") requires a
  //   Firestore composite index.  If that index is missing, Firestore throws
  //   FAILED_PRECONDITION.  The old .catch(() => setMyPosts([])) silently
  //   swallowed the error, making the picker always show "No posts yet".
  //
  //   Fix: remove orderBy entirely, query all three known userId field aliases
  //   in parallel, deduplicate by doc ID, and sort newest-first client-side.
  //   This mirrors the same pattern used in useFollowingPosts and useUserPosts.
  useEffect(() => {
    const requestId = ++postsRequestRef.current;
    if (!visible || !currentUserId) return;
    setSelectedPostId(null);
    setLoadingPosts(true);

    fetchPostsByUser(currentUserId)
      .then((eligible) => {
        if (requestId === postsRequestRef.current) setMyPosts(eligible);
      })
      .catch((err) => {
        // Log the real error so FAILED_PRECONDITION (missing index) or
        // PERMISSION_DENIED is visible in Metro, not silently hidden.
        console.error("[challengePicker] query failed:", err);
        if (requestId === postsRequestRef.current) setMyPosts([]);
      })
      .finally(() => {
        if (requestId === postsRequestRef.current) setLoadingPosts(false);
      });
    return () => {
      postsRequestRef.current += 1;
    };
  }, [visible, currentUserId]);

  // ── Create the live battle ──────────────────────────────────────────────────
  async function handlePickPost(myPost: Post) {
    if (!targetPost || !currentProfile || creatingRef.current) return;
    creatingRef.current = true;
    setSelectedPostId(myPost.id);
    setCreating(true);

    try {
      // playerA = the post being challenged (its owner is the "defender")
      const playerA: BattlePlayer = {
        userId:    targetPost.userId,
        username:  targetPost.username,
        avatar:    targetPost.userAvatar,
        mediaUrl:  targetPost.mediaUrl,
        mediaType: targetPost.mediaType,
        postId:    targetPost.id,
      };

      // playerB = the current user (the challenger)
      const playerB: BattlePlayer = {
        userId:    currentUserId,
        username:  currentProfile.username,
        avatar:    currentProfile.avatar,
        mediaUrl:  myPost.mediaUrl,
        mediaType: myPost.mediaType,
        postId:    myPost.id,
      };

      // Create the LIVE battle in a single write (both players + status:"live").
      // The challenger is the creator AND playerB, so the old
      // create-open-then-accept path was rejected by Firestore rules (a creator
      // may not accept their own challenge). A one-shot live create conforms to
      // the rules and leaves no orphaned open battle.
      const battleId = await createLiveBattle({
        creatorId:     currentUserId,
        playerA,
        playerB,
        category:      "Highlights",
        durationHours: 24,
      });

      // Notify the challenged athlete (fire-and-forget, deduped per battle).
      notifyChallengeReceived(targetPost.userId, battleId);

      onBattleCreated();
      onClose();
      Alert.alert(
        "Battle started! ⚔️",
        `You're now battling @${targetPost.username}. Head to Battles to vote.`
      );
    } catch {
      Alert.alert("Failed", "Could not create battle. Please try again.");
      setSelectedPostId(null);
    } finally {
      creatingRef.current = false;
      setCreating(false);
    }
  }

  if (!targetPost) return null;

  return (
    <Modal
      visible={visible}
      transparent
      animationType="slide"
      onRequestClose={onClose}
      statusBarTranslucent
    >
      <View style={styles.overlay}>
        <Pressable style={styles.backdrop} onPress={onClose} />

        {/* SAFE AREA: Cancel sits at the sheet bottom on the screen edge. */}
        <View style={[styles.sheet, { paddingBottom: insets.bottom + SPACING.xl }]}>
          {/* Handle */}
          <View style={styles.handle} />

          {/* Title */}
          <Text style={styles.title}>Pick Your Post</Text>
          <Text style={styles.subtitle}>
            Challenging{" "}
            <Text style={styles.subtitleAccent}>@{targetPost.username}</Text>
          </Text>

          {/* Target post preview row */}
          <View style={styles.targetRow}>
            <AvatarImage
              uri={targetPost.userAvatar}
              username={targetPost.username}
              size={32}
            />
            {/* targetThumb has explicit 52×64 — MediaTile fills it safely on iOS */}
            <MediaTile
              uri={targetPost.mediaUrl || null}
              mediaType={targetPost.mediaType}
              style={styles.targetThumb}
              context="BattlePickerTarget"
            />
            <Text style={styles.vsLabel}>VS</Text>
            {/* Placeholder for picker side */}
            <View style={[styles.targetThumb, styles.targetThumbEmpty]}>
              <Text style={styles.targetThumbEmptyText}>?</Text>
            </View>
          </View>

          <View style={styles.divider} />

          {/* Post picker */}
          <Text style={styles.pickerLabel}>Your Posts</Text>

          {loadingPosts ? (
            <View style={styles.center}>
              <ActivityIndicator color={COLORS.accent} />
            </View>
          ) : myPosts.length === 0 ? (
            /* ── No posts guard ── */
            <View style={styles.center}>
              <Feather name="camera" size={32} color={COLORS.textMuted} />
              <Text style={styles.noPostsTitle}>No posts yet</Text>
              <Text style={styles.noPostsSub}>
                Create a post first before challenging.
              </Text>
            </View>
          ) : (
            <ScrollView
              horizontal
              showsHorizontalScrollIndicator={false}
              contentContainerStyle={styles.thumbRow}
            >
              {myPosts.map((p) => (
                <PostPickItem
                  key={p.id}
                  p={p}
                  isSelected={selectedPostId === p.id}
                  creating={creating}
                  onPress={() => handlePickPost(p)}
                />
              ))}
            </ScrollView>
          )}

          {/* Cancel */}
          <Pressable
            onPress={onClose}
            disabled={creating}
            accessibilityRole="button"
            accessibilityLabel="Cancel"
            style={({ pressed }) => [styles.cancelBtn, pressed && { opacity: 0.7 }]}
          >
            <Text style={styles.cancelText}>Cancel</Text>
          </Pressable>
        </View>
      </View>
    </Modal>
  );
}

const styles = StyleSheet.create({
  overlay: {
    flex: 1,
    justifyContent: "flex-end",
  },
  backdrop: {
    ...StyleSheet.absoluteFillObject,
    backgroundColor: COLORS.scrim,
  },
  sheet: {
    backgroundColor: COLORS.card,
    borderTopLeftRadius: RADIUS.xl,
    borderTopRightRadius: RADIUS.xl,
    paddingTop: SPACING.sm,
    paddingHorizontal: SPACING.xl,
    // paddingBottom applied inline — safe-area dependent.
  },
  handle: {
    width: 40,
    height: 4,
    borderRadius: 2,
    backgroundColor: COLORS.inputBorder,
    alignSelf: "center",
    marginBottom: SPACING.lg,
  },
  title: {
    color: COLORS.textPrimary,
    fontSize: 20,
    fontWeight: FONTS.heavy,
    marginBottom: 4,
  },
  subtitle: {
    color: COLORS.textMuted,
    fontSize: 13,
    marginBottom: SPACING.lg,
  },
  subtitleAccent: {
    color: COLORS.accent,
    fontWeight: FONTS.bold,
  },

  // Target post preview row
  targetRow: {
    flexDirection: "row",
    alignItems: "center",
    gap: SPACING.md,
    marginBottom: SPACING.lg,
  },
  targetThumbWrap: {
    borderRadius: RADIUS.sm,
    overflow: "hidden",
  },
  targetThumb: {
    width: 52,
    height: 64,
    borderRadius: RADIUS.sm,
    backgroundColor: COLORS.surface,
  },
  targetThumbPlaceholder: {
    alignItems: "center",
    justifyContent: "center",
  },
  targetThumbEmpty: {
    alignItems: "center",
    justifyContent: "center",
    borderWidth: 1.5,
    borderColor: COLORS.inputBorder,
    borderStyle: "dashed",
  },
  targetThumbEmptyText: {
    color: COLORS.textMuted,
    fontSize: 20,
    fontWeight: FONTS.heavy,
  },
  vsLabel: {
    color: COLORS.textPrimary,
    fontSize: 14,
    fontWeight: FONTS.heavy,
    letterSpacing: 1,
  },

  divider: {
    height: 1,
    backgroundColor: COLORS.cardBorder,
    marginHorizontal: -SPACING.xl,
    marginBottom: SPACING.lg,
  },

  pickerLabel: {
    color: COLORS.textSecondary,
    fontSize: 12,
    fontWeight: FONTS.bold,
    letterSpacing: 0.5,
    textTransform: "uppercase",
    marginBottom: SPACING.md,
  },

  // Empty / loading states
  center: {
    alignItems: "center",
    paddingVertical: SPACING.xl,
    gap: SPACING.sm,
  },
  noPostsTitle: {
    color: COLORS.textPrimary,
    fontSize: 16,
    fontWeight: FONTS.bold,
  },
  noPostsSub: {
    color: COLORS.textMuted,
    fontSize: 13,
    textAlign: "center",
    lineHeight: 18,
  },

  // Thumbnail row
  thumbRow: {
    gap: SPACING.md,
    paddingBottom: SPACING.sm,
  },
  thumbWrap: {
    width: THUMB_W,
    borderRadius: RADIUS.md,
    overflow: "hidden",
    borderWidth: 2,
    borderColor: "transparent",
  },
  thumbWrapSelected: {
    borderColor: COLORS.accent,
  },
  thumb: {
    width: THUMB_W,
    height: THUMB_H,
    backgroundColor: COLORS.surface,
  },
  thumbPlaceholder: {
    alignItems: "center",
    justifyContent: "center",
  },
  thumbLoadingOverlay: {
    ...StyleSheet.absoluteFillObject,
    backgroundColor: COLORS.overlay,
    alignItems: "center",
    justifyContent: "center",
    height: THUMB_H,
  },
  thumbCaption: {
    color: COLORS.textSecondary,
    fontSize: 11,
    paddingHorizontal: 4,
    paddingVertical: 4,
    backgroundColor: COLORS.card,
    textAlign: "center",
  },

  // Cancel
  cancelBtn: {
    paddingVertical: SPACING.md,
    alignItems: "center",
    marginTop: SPACING.md,
    borderTopWidth: 1,
    borderTopColor: COLORS.cardBorder,
  },
  cancelText: {
    color: COLORS.textMuted,
    fontSize: 15,
    fontWeight: FONTS.semibold,
  },
});
