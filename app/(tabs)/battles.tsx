import React, { useMemo, useState, useCallback } from "react";
import {
  View,
  Text,
  FlatList,
  StyleSheet,
  Pressable,
  RefreshControl,
  Modal,
  ScrollView,
  ActivityIndicator,
  Platform,
} from "react-native";
import { showAlert, confirm } from "@/utils/alert";
import { SafeAreaView, useSafeAreaInsets } from "react-native-safe-area-context";
import { useFocusEffect, useIsFocused } from "@react-navigation/native";
import { useRouter } from "expo-router";
import { Feather } from "@expo/vector-icons";
import * as ImagePicker from "expo-image-picker";
import { useAuthStore } from "@/store/authStore";
import {
  useBattles,
  acceptChallenge,
  getBattleStatus,
  getBattleWinner,
  getTimeRemainingLabel,
  getNextVotableBattle,
  isVotableBattle,
} from "@/hooks/useBattles";
import { uploadMedia, createPost } from "@/hooks/usePosts";
import type { CreatePostInput } from "@/hooks/usePosts";
import { notifyChallengeAccepted } from "@/services/notificationRepository";
import { fetchPostsByUser } from "@/services/postRepository";
import { COLORS, SPACING, FONTS, RADIUS } from "@/constants/theme";
import { openAthleteProfile } from "@/utils/navigation";
import { toHandle } from "@/utils/format";
import BattleCardSkeleton from "@/components/BattleCardSkeleton";
import BattleDetailModal from "@/components/BattleDetailModal";
import EmptyState from "@/components/EmptyState";
import LoadingSpinner from "@/components/LoadingSpinner";
import AvatarImage from "@/components/AvatarImage";
import GlowButton from "@/components/GlowButton";
import MediaTile from "@/components/MediaTile";
import SegmentedTabs from "@/components/SegmentedTabs";
import Chip from "@/components/Chip";
import FeaturedBattle from "@/components/battles/FeaturedBattle";
import OpenChallengeRow from "@/components/battles/OpenChallengeRow";
import ActiveBattleRow from "@/components/battles/ActiveBattleRow";
import BattleResultCard from "@/components/battles/BattleResultCard";
import { shareBattle, shareBattleResult } from "@/utils/shareBattle";
import type { Battle, Post, BattlePlayer } from "@/types";
import { useInteractionReady } from "@/hooks/useInteractionReady";
import type { CreationMutation } from "@/utils/creationMutation";
import { createCreationMutation } from "@/utils/creationMutation";

// Tabs: "live" = Live Battles, "mine" = My Battles, "completed" = Completed
type Tab = "live" | "mine" | "completed";

/**
 * My Battles sub-filters.
 *
 * There is no "Challenges Received": BattlePickerModal creates a LIVE battle
 * with both players in a single write, so an inbound challenge is never in a
 * pending state a filter could show. Adding one would mean inventing a status
 * the backend doesn't have.
 */
type MineFilter = "all" | "active" | "sent" | "completed";

// List rows — every tab is one virtualized list, so headers, the featured
// hero, the trending rail, and the card lists all flow through renderItem and
// mount lazily. Only already-loaded battle data is used.
type ListRow =
  | { type: "header"; id: string; title: string; subtitle?: string }
  | { type: "featured"; id: string; battle: Battle }
  | { type: "rail"; id: string; battles: Battle[] }
  | { type: "challenge"; id: string; battle: Battle }
  | { type: "active"; id: string; battle: Battle }
  | { type: "result"; id: string; battle: Battle };

const battleRowKey = (item: ListRow) => item.id;
const railKey = (item: Battle) => item.id;

// ─── Post thumbnail — uses MediaTile for native-safe rendering ───────────────
function PostThumbItem({
  post,
  onPress,
  disabled,
  selected,
}: {
  post: Post;
  onPress: () => void;
  disabled: boolean;
  selected?: boolean;
}) {
  return (
    <Pressable
      style={({ pressed }) => [
        modal.postThumb,
        selected && modal.postThumbSelected,
        pressed && { opacity: 0.8 },
      ]}
      onPress={onPress}
      disabled={disabled}
      accessibilityRole="button"
      accessibilityLabel={`Use post: ${post.caption || "untitled post"}`}
      accessibilityState={{ selected: !!selected, disabled }}
    >
      <View style={modal.thumbWrap}>
        <MediaTile
          uri={post.mediaUrl || null}
          mediaType={post.mediaType}
          style={modal.thumb}
          context="AcceptModal"
        />
        {selected && (
          <View style={modal.thumbCheck}>
            <Feather name="check" size={13} color={COLORS.background} />
          </View>
        )}
      </View>
      <Text style={modal.postName} numberOfLines={1}>{post.caption || "Post"}</Text>
    </Pressable>
  );
}

// ─── Accept Challenge Modal ───────────────────────────────────────────────────
// Shows the original challenger, the battle category, the rules, a side-by-side
// matchup preview, and a post picker. The challenge is only accepted after the
// user explicitly taps "Confirm & Accept" (no accidental single-tap accepts).
function AcceptModal({
  visible,
  battle,
  onClose,
  onAccepted,
  userId,
  profile,
}: {
  visible: boolean;
  battle: Battle | null;
  onClose: () => void;
  onAccepted: () => void;
  userId: string;
  profile: { username: string; avatar: string } | null;
}) {
  const insets = useSafeAreaInsets();
  const [myPosts, setMyPosts] = useState<Post[]>([]);
  const [loadingPosts, setLoadingPosts] = useState(false);
  const [postsLoaded, setPostsLoaded] = useState(false);
  const [submitting, setSubmitting] = useState(false);
  const [selectedPostId, setSelectedPostId] = useState<string | null>(null);
  const [uploading, setUploading] = useState(false);
  const [uploadPct, setUploadPct] = useState(0);
  const postsRequestRef = React.useRef(0);
  const operationRef = React.useRef(false);
  const uploadAttemptRef = React.useRef<{
    uri: string;
    mutation: CreationMutation;
    mediaUrl?: string;
    input?: CreatePostInput;
  } | null>(null);

  const battleId = battle?.id ?? null;
  const contentReady = useInteractionReady(visible, battleId);
  const challenger = battle?.playerA ?? null;
  const selectedPost = useMemo(
    () => myPosts.find((p) => p.id === selectedPostId) ?? null,
    [myPosts, selectedPostId]
  );

  // Reset the chosen post whenever a different challenge is opened.
  React.useEffect(() => {
    setSelectedPostId(null);
    setPostsLoaded(false);
  }, [battleId]);

  React.useEffect(() => {
    const requestId = ++postsRequestRef.current;
    if (!visible || !contentReady || !userId) return;
    setLoadingPosts(true);
    // ── Query by all known userId field aliases ───────────────────────────────
    // We intentionally do NOT filter by `battleEnabled`: any of the user's posts
    // with renderable media can be used to accept a challenge (and they can also
    // upload brand-new media below). `orderBy` is omitted to avoid requiring a
    // composite index; we sort the merged results newest-first client-side.
    fetchPostsByUser(userId)
      .then((posts) => {
        if (requestId === postsRequestRef.current) setMyPosts(posts);
      })
      .catch((err) => {
        console.error("[acceptModal] post query failed:", err);
        if (requestId === postsRequestRef.current) setMyPosts([]);
      })
      .finally(() => {
        if (requestId === postsRequestRef.current) {
          setLoadingPosts(false);
          setPostsLoaded(true);
        }
      });
    return () => {
      postsRequestRef.current += 1;
    };
  }, [contentReady, visible, userId]);

  // ── Upload brand-new media to use for this battle ───────────────────────────
  // Mirrors the Create screen's pattern: pick → uploadMedia → createPost. The new
  // post is battle-enabled so it can be reused, then auto-selected as the pick.
  async function pickAndUpload() {
    if (!profile || operationRef.current) return;
    operationRef.current = true;
    try {
      const result = await ImagePicker.launchImageLibraryAsync({
        mediaTypes: ImagePicker.MediaTypeOptions.All,
        quality: 0.8,
        allowsEditing: Platform.OS !== "web",
        aspect: [4, 3],
      });
      if (result.canceled || result.assets.length === 0) return;

      const asset = result.assets[0];
      const mediaType: "image" | "video" = asset.type === "video" ? "video" : "image";

      if (uploadAttemptRef.current?.uri !== asset.uri) {
        uploadAttemptRef.current = {
          uri: asset.uri,
          mutation: createCreationMutation("post"),
        };
      }
      const attempt = uploadAttemptRef.current;

      setUploading(true);
      setUploadPct(0);

      const mediaUrl =
        attempt.mediaUrl ??
        (await uploadMedia(asset.uri, userId, (pct) => setUploadPct(pct)));
      attempt.mediaUrl = mediaUrl;

      attempt.input ??= {
        userId,
        username: profile.username,
        userAvatar: profile.avatar,
        avatarUrl: profile.avatar,
        mediaUrl,
        mediaType,
        caption: "",
        battleEnabled: true,
      };
      const newPostId = await createPost(attempt.input, attempt.mutation);
      uploadAttemptRef.current = null;

      const newPost: Post = {
        id: newPostId,
        userId,
        username: profile.username,
        userAvatar: profile.avatar,
        avatarUrl: profile.avatar,
        mediaUrl,
        mediaType,
        caption: "",
        likesCount: 0,
        battleEnabled: true,
        createdAt: null,
      };
      // Prepend and auto-select the freshly uploaded post
      setMyPosts((prev) => [newPost, ...prev]);
      setSelectedPostId(newPostId);
    } catch (err) {
      console.error("[acceptModal] upload failed:", err);
      showAlert("Upload failed", "Could not upload that media. Please try again.");
    } finally {
      operationRef.current = false;
      setUploading(false);
      setUploadPct(0);
    }
  }

  async function confirmAccept() {
    if (!battleId || !profile || !selectedPost || operationRef.current) return;
    operationRef.current = true;
    setSubmitting(true);
    const playerB: BattlePlayer = {
      userId,
      username: profile.username,
      avatar: profile.avatar,
      mediaUrl: selectedPost.mediaUrl,
      mediaType: selectedPost.mediaType,
      postId: selectedPost.id,
    };
    try {
      await acceptChallenge(battleId, playerB);
      // Notify the challenger their open challenge was accepted (fire-and-
      // forget, deduped per battle).
      const challengerId = battle?.playerA?.userId || battle?.creatorId;
      if (challengerId) notifyChallengeAccepted(challengerId, battleId);
      onAccepted();
      onClose();
    } catch {
      showAlert("Error", "Could not accept challenge. Try again.");
    } finally {
      operationRef.current = false;
      setSubmitting(false);
    }
  }

  return (
    <Modal visible={visible} transparent animationType="slide" onRequestClose={onClose}>
      <View style={modal.overlay}>
        <View style={modal.sheet}>
          <View style={modal.handle} />
          <ScrollView
            showsVerticalScrollIndicator={false}
            // SAFE AREA: sheet rests on the screen edge — Cancel must clear
            // the home indicator.
            contentContainerStyle={[modal.scrollBody, { paddingBottom: insets.bottom + SPACING.xl }]}
          >
            <Text style={modal.title}>Accept Challenge</Text>

            {/* Challenger header */}
            {challenger && (
              <View style={modal.challengerRow}>
                <AvatarImage uri={challenger.avatar || null} username={challenger.username || "?"} size={44} />
                <View style={modal.challengerInfo}>
                  <Text style={modal.challengerLabel}>Challenged by</Text>
                  <Text style={modal.challengerName} numberOfLines={1}>{challenger.username}</Text>
                  <Text style={modal.challengerHandle} numberOfLines={1}>{toHandle(challenger.username)}</Text>
                </View>
                {!!battle?.category && (
                  <View style={modal.categoryBadge}>
                    <Text style={modal.categoryBadgeText}>{battle.category}</Text>
                  </View>
                )}
              </View>
            )}

            {/* Rules / instructions */}
            <View style={modal.rulesBox}>
              <Text style={modal.rulesTitle}>How it works</Text>
              <Text style={modal.rulesText}>
                Pick one of your battle-enabled posts to go head-to-head
                {challenger ? ` against ${challenger.username}` : ""}. As soon as you
                confirm, the battle goes live and the community votes. Whoever has the
                most votes when the timer ends wins.
              </Text>
            </View>

            {/* Matchup preview: challenger media VS your pick */}
            <View style={modal.previewRow}>
              <View style={modal.previewCol}>
                <View style={modal.previewThumbWrap}>
                  <MediaTile
                    uri={challenger?.mediaUrl || null}
                    mediaType={challenger?.mediaType}
                    style={modal.previewThumb}
                    context="AcceptPreview"
                  />
                </View>
                <Text style={modal.previewName} numberOfLines={1}>
                  {challenger?.username ?? "Challenger"}
                </Text>
              </View>

              <Text style={modal.previewVs}>VS</Text>

              <View style={modal.previewCol}>
                <View style={[modal.previewThumbWrap, !selectedPost && modal.previewThumbEmpty]}>
                  {selectedPost ? (
                    <MediaTile
                      uri={selectedPost.mediaUrl || null}
                      mediaType={selectedPost.mediaType}
                      style={modal.previewThumb}
                      context="AcceptPreview"
                    />
                  ) : (
                    <Text style={modal.previewPlaceholder}>Your{"\n"}pick</Text>
                  )}
                </View>
                <Text style={modal.previewName} numberOfLines={1}>You</Text>
              </View>
            </View>

            {/* Post picker — choose an existing post or upload brand-new media */}
            <Text style={modal.sectionLabel}>Choose or upload your media</Text>
            {!contentReady || !postsLoaded || loadingPosts ? (
              <LoadingSpinner label="Loading your posts…" />
            ) : (
              <ScrollView horizontal showsHorizontalScrollIndicator={false} style={modal.row}>
                {/* Upload-new tile (always first) */}
                <Pressable
                  style={({ pressed }) => [modal.uploadTile, pressed && { opacity: 0.8 }]}
                  onPress={pickAndUpload}
                  disabled={uploading || submitting}
                  accessibilityRole="button"
                  accessibilityLabel="Upload new photo or video"
                  accessibilityState={{ disabled: uploading || submitting, busy: uploading }}
                >
                  {uploading ? (
                    <>
                      <ActivityIndicator color={COLORS.accent} />
                      <Text style={modal.uploadLabel}>{uploadPct}%</Text>
                    </>
                  ) : (
                    <>
                      <Feather name="plus" size={24} color={COLORS.accent} />
                      <Text style={modal.uploadLabel}>Upload new</Text>
                    </>
                  )}
                </Pressable>

                {myPosts.map((p) => (
                  <PostThumbItem
                    key={p.id}
                    post={p}
                    onPress={() => setSelectedPostId(p.id)}
                    disabled={submitting || uploading}
                    selected={p.id === selectedPostId}
                  />
                ))}
              </ScrollView>
            )}
            {contentReady && postsLoaded && !loadingPosts && myPosts.length === 0 && !uploading && (
              <Text style={modal.emptyHint}>
                No posts yet — tap “Upload new” to add a photo or video for this battle.
              </Text>
            )}

            {/* Confirm */}
            <GlowButton
              label={submitting ? "Accepting…" : "Confirm & Accept"}
              onPress={confirmAccept}
              variant="primary"
              disabled={!selectedPost || submitting}
              style={modal.confirmBtn}
            />
            <Pressable
              onPress={onClose}
              disabled={submitting}
              accessibilityRole="button"
              accessibilityLabel="Cancel"
              style={({ pressed }) => [modal.cancelBtn, pressed && { opacity: 0.7 }]}
            >
              <Text style={modal.cancelText}>Cancel</Text>
            </Pressable>
          </ScrollView>
        </View>
      </View>
    </Modal>
  );
}

const modal = StyleSheet.create({
  overlay: { flex: 1, backgroundColor: COLORS.overlay, justifyContent: "flex-end" },
  sheet: {
    backgroundColor: COLORS.card,
    borderTopLeftRadius: RADIUS.xl,
    borderTopRightRadius: RADIUS.xl,
    paddingHorizontal: SPACING.xl,
    paddingTop: SPACING.md,
    maxHeight: "92%",
  },
  scrollBody: {}, // paddingBottom applied inline — safe-area dependent.
  handle: {
    width: 40, height: 4, borderRadius: 2,
    backgroundColor: COLORS.inputBorder,
    alignSelf: "center", marginBottom: SPACING.lg,
  },
  title: { color: COLORS.textPrimary, fontSize: 20, fontWeight: FONTS.heavy, marginBottom: SPACING.md },

  // Challenger header
  challengerRow: {
    flexDirection: "row",
    alignItems: "center",
    gap: SPACING.md,
    marginBottom: SPACING.lg,
  },
  challengerInfo: { flex: 1 },
  challengerLabel: { color: COLORS.textMuted, fontSize: 11, fontWeight: FONTS.semibold },
  challengerName: { color: COLORS.textPrimary, fontSize: 15, fontWeight: FONTS.heavy },
  challengerHandle: { color: COLORS.textHandle, fontSize: 12 },
  categoryBadge: {
    backgroundColor: COLORS.accentFaint,
    borderWidth: 1,
    borderColor: COLORS.accent,
    borderRadius: RADIUS.xs,
    paddingHorizontal: 8,
    paddingVertical: 4,
  },
  categoryBadgeText: { color: COLORS.accent, fontSize: 11, fontWeight: FONTS.heavy },

  // Rules
  rulesBox: {
    backgroundColor: COLORS.surface,
    borderWidth: 1,
    borderColor: COLORS.cardBorder,
    borderRadius: RADIUS.md,
    padding: SPACING.md,
    marginBottom: SPACING.lg,
    gap: 4,
  },
  rulesTitle: { color: COLORS.textPrimary, fontSize: 13, fontWeight: FONTS.heavy },
  rulesText: { color: COLORS.textSecondary, fontSize: 13, lineHeight: 19 },

  // Matchup preview
  previewRow: {
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "center",
    marginBottom: SPACING.lg,
  },
  previewCol: { flex: 1, alignItems: "center", gap: SPACING.xs },
  previewThumbWrap: {
    width: 110,
    height: 132,
    borderRadius: RADIUS.md,
    overflow: "hidden",
    backgroundColor: COLORS.surface,
  },
  previewThumbEmpty: {
    alignItems: "center",
    justifyContent: "center",
    borderWidth: 1.5,
    borderColor: COLORS.inputBorder,
    borderStyle: "dashed",
  },
  previewThumb: { width: 110, height: 132 },
  previewPlaceholder: { color: COLORS.textMuted, fontSize: 12, textAlign: "center" },
  previewName: { color: COLORS.textSecondary, fontSize: 12, fontWeight: FONTS.semibold },
  previewVs: {
    width: 50,
    textAlign: "center",
    color: COLORS.accent,
    fontSize: 20,
    fontWeight: FONTS.heavy,
    letterSpacing: 2,
  },

  // Post picker
  sectionLabel: {
    color: COLORS.textPrimary,
    fontSize: 13,
    fontWeight: FONTS.heavy,
    marginBottom: SPACING.sm,
  },
  row: { flexGrow: 0, marginBottom: SPACING.lg },
  postThumb: {
    width: 100,
    marginRight: SPACING.md,
    borderRadius: RADIUS.md,
    padding: 3,
    borderWidth: 2,
    borderColor: "transparent",
  },
  postThumbSelected: { borderColor: COLORS.accent },
  thumbWrap: { position: "relative", marginBottom: SPACING.xs },
  thumb: { width: 100, height: 120, borderRadius: RADIUS.md },
  thumbCheck: {
    position: "absolute",
    top: 6,
    right: 6,
    width: 22,
    height: 22,
    borderRadius: 11,
    backgroundColor: COLORS.accent,
    alignItems: "center",
    justifyContent: "center",
  },
  postName: { color: COLORS.textSecondary, fontSize: 11, textAlign: "center" },

  // Upload-new tile
  uploadTile: {
    width: 100,
    height: 120,
    marginRight: SPACING.md,
    borderRadius: RADIUS.md,
    borderWidth: 1.5,
    borderColor: COLORS.inputBorder,
    borderStyle: "dashed",
    backgroundColor: COLORS.surface,
    alignItems: "center",
    justifyContent: "center",
    gap: SPACING.xs,
  },
  uploadLabel: { color: COLORS.textSecondary, fontSize: 11, fontWeight: FONTS.semibold },
  emptyHint: {
    color: COLORS.textMuted,
    fontSize: 12,
    lineHeight: 17,
    marginBottom: SPACING.lg,
  },

  // Confirm / cancel
  confirmBtn: { marginTop: SPACING.xs },
  cancelBtn: {
    paddingVertical: SPACING.md, alignItems: "center",
    marginTop: SPACING.sm,
  },
  cancelText: { color: COLORS.textMuted, fontSize: 15, fontWeight: FONTS.semibold },
});

// ─── "More Battles" mini row card ────────────────────────────────────────────
function BattleRowCard({
  battle,
  onPress,
  currentUserId,
}: {
  battle: Battle;
  onPress: () => void;
  currentUserId?: string | null;
}) {
  const router = useRouter();
  const pA = battle.playerA;
  const pB = battle.playerB;
  const totalVotes = (battle.votesA ?? 0) + (battle.votesB ?? 0);
  const status = getBattleStatus(battle);
  const timeLabel = getTimeRemainingLabel(battle);

  // Winner label for completed row cards
  const winner = status === "completed" ? getBattleWinner(battle) : null;
  const winnerName =
    winner === "tie"
      ? "Tied"
      : winner !== null
      ? (winner as BattlePlayer).username
      : null;

  // WEB DOM NESTING: the outer container is a plain View — the avatar
  // pressables and the row's own press target must be siblings, never
  // interactive elements nested inside a role="button" element.
  return (
    <View style={rowCard.wrap}>
      {/* Stacked avatars — each tappable for profile navigation */}
      <View style={rowCard.avatarStack}>
        {pA && (
          <Pressable
            style={[rowCard.avatarRing, { zIndex: 2 }]}
            onPress={(e) => {
              e.stopPropagation?.();
              openAthleteProfile(router, pA.userId, currentUserId);
            }}
            hitSlop={{ top: 6, bottom: 6, left: 6, right: 6 }}
          >
            <AvatarImage uri={pA.avatar || null} username={pA.username || "?"} size={36} />
          </Pressable>
        )}
        {pB ? (
          <Pressable
            style={[rowCard.avatarRing, rowCard.avatarRingB]}
            onPress={(e) => {
              e.stopPropagation?.();
              openAthleteProfile(router, pB.userId, currentUserId);
            }}
            hitSlop={{ top: 6, bottom: 6, left: 6, right: 6 }}
          >
            <AvatarImage uri={pB.avatar || null} username={pB.username || "?"} size={36} />
          </Pressable>
        ) : (
          <View style={[rowCard.avatarRing, rowCard.avatarRingB, rowCard.openRing]}>
            <Text style={rowCard.openPlus}>+</Text>
          </View>
        )}
      </View>

      {/* Row body — the actual "open detail" button (info + chevron) */}
      <Pressable
        onPress={onPress}
        accessibilityRole="button"
        accessibilityLabel={`${battle.category || "Battle"}: ${pA?.username ?? "open"} vs ${
          pB?.username ?? "open slot"
        }. ${totalVotes} votes.`}
        style={({ pressed }) => [rowCard.body, pressed && { opacity: 0.8 }]}
      >
        {/* Info */}
        <View style={rowCard.info}>
          <Text style={rowCard.title} numberOfLines={1}>{battle.category || "Battle"}</Text>
          <Text style={rowCard.meta}>
            {winnerName
              ? `Winner: ${winnerName} · ${totalVotes.toLocaleString()} votes`
              : timeLabel
              ? `${timeLabel} · ${totalVotes.toLocaleString()} votes`
              : `${totalVotes.toLocaleString()} votes`}
          </Text>
        </View>

        {/* Badge + chevron */}
        <View style={rowCard.right}>
          <View style={[
            rowCard.statusDot,
            status === "live"      && rowCard.liveDot,
            status === "completed" && rowCard.completedDot,
          ]} />
          <Feather name="chevron-right" size={18} color={COLORS.textMuted} />
        </View>
      </Pressable>
    </View>
  );
}

const rowCard = StyleSheet.create({
  wrap: {
    flexDirection: "row",
    alignItems: "center",
    paddingHorizontal: SPACING.lg,
    paddingVertical: SPACING.md,
    borderTopWidth: 1,
    borderTopColor: COLORS.cardBorder,
    gap: SPACING.md,
  },
  avatarStack: { flexDirection: "row", width: 52 },
  body: {
    flex: 1,
    flexDirection: "row",
    alignItems: "center",
    gap: SPACING.md,
    minHeight: 44, // accessible touch target
  },
  avatarRing: {
    borderRadius: 22,
    borderWidth: 2,
    borderColor: COLORS.background,
    overflow: "hidden",
  },
  avatarRingB: { marginLeft: -12 },
  openRing: {
    width: 38, height: 38, borderRadius: 19,
    backgroundColor: COLORS.surface, borderColor: COLORS.inputBorder,
    alignItems: "center", justifyContent: "center",
  },
  openPlus: { color: COLORS.textMuted, fontSize: 18, fontWeight: FONTS.heavy },
  info: { flex: 1 },
  title: { color: COLORS.textPrimary, fontSize: 14, fontWeight: FONTS.bold },
  meta: { color: COLORS.textMuted, fontSize: 12, marginTop: 2 },
  right: { flexDirection: "row", alignItems: "center", gap: SPACING.sm },
  statusDot: {
    width: 8,
    height: 8,
    borderRadius: 4,
    backgroundColor: COLORS.inputBorder,
  },
  liveDot: { backgroundColor: COLORS.live },
  completedDot: { backgroundColor: COLORS.warning },
});

// ─── Main Battles Screen ──────────────────────────────────────────────────────
export default function BattlesScreen() {
  const router = useRouter();
  const isFocused = useIsFocused();
  const userId = useAuthStore((s) => s.userId);
  const profile = useAuthStore((s) => s.profile);
  const { battles, votedMap, loading, refreshing, error, finalizeWarning, refresh, manualRefresh, handleVote } =
    useBattles(userId);

  // UI shows "Live Battles", "My Battles", "Completed"
  const [activeTab, setActiveTab] = useState<Tab>("live");
  const [acceptBattle, setAcceptBattle] = useState<Battle | null>(null);
  const [mineFilter, setMineFilter] = useState<MineFilter>("all");
  // Detail modal: which battle is open in detail view
  const [detailBattle, setDetailBattle] = useState<Battle | null>(null);

  // Refresh battles when the tab gains focus (battles don't remount in tab nav)
  const refreshRef = React.useRef(refresh);
  refreshRef.current = refresh;

  // Pull-to-refresh and manual retry re-open the whole queue: skipping is a
  // session-scoped deferral, so a refresh must offer skipped battles again.
  const manualRefreshAndResetSkips = useCallback(() => {
    skippedIdsRef.current.clear();
    return manualRefresh();
  }, [manualRefresh]);
  const hasFocusedRef = React.useRef(false);
  useFocusEffect(
    useCallback(() => {
      if (!hasFocusedRef.current) {
        hasFocusedRef.current = true;
        return;
      }
      void refreshRef.current();
    }, [])
  );

  // Stable refs so handleVoteWithAdvance always sees the latest battles/votedMap
  // without being recreated on every render.
  const battlesRef = React.useRef(battles);
  battlesRef.current = battles;
  const votedMapRef = React.useRef(votedMap);
  votedMapRef.current = votedMap;
  // Battles the viewer skipped in THIS session. Deliberately session-scoped and
  // never persisted: skipping defers a battle, it does not decline it, so a
  // pull-to-refresh or re-entry offers it again. Held in a ref (not state)
  // because only the queue helpers read it — re-rendering on skip would rebuild
  // the memoised rows underneath the modal for no visible benefit.
  const skippedIdsRef = React.useRef<Set<string>>(new Set());
  const votingBattleRef = React.useRef<string | null>(null);
  const advanceTimerRef = React.useRef<ReturnType<typeof setTimeout> | null>(null);
  const advanceResolveRef = React.useRef<(() => void) | null>(null);
  const mountedRef = React.useRef(true);
  React.useEffect(() => {
    mountedRef.current = true;
    return () => {
      mountedRef.current = false;
      if (advanceTimerRef.current) clearTimeout(advanceTimerRef.current);
      advanceResolveRef.current?.();
      advanceResolveRef.current = null;
    };
  }, []);

  // ── Section derivations ─────────────────────────────────────────────────────
  // All statuses come from getBattleStatus, the canonical helper: it folds
  // expiry into "completed" for MATCHED battles and into "expired" for
  // challenges nobody accepted. Expired never reaches any tab.
  const live = useMemo(
    () => battles.filter((b) => getBattleStatus(b) === "live"),
    [battles]
  );
  const openChallenges = useMemo(
    () => battles.filter((b) => getBattleStatus(b) === "open"),
    [battles]
  );
  const completed = useMemo(
    () => battles.filter((b) => getBattleStatus(b) === "completed"),
    [battles]
  );

  const participates = useCallback(
    (b: Battle) =>
      !!userId &&
      (b.playerA?.userId === userId ||
        b.playerB?.userId === userId ||
        b.creatorId === userId),
    [userId]
  );

  const myActive = useMemo(
    () => live.filter(participates),
    [live, participates]
  );
  // "Challenges Sent" = open challenges this athlete created and nobody has
  // accepted yet. There is deliberately no "Challenges Received" filter:
  // BattlePickerModal creates a LIVE battle with both players immediately, so
  // Momentum has no pending inbound-challenge state to back one.
  const myChallengesSent = useMemo(
    () => openChallenges.filter((b) => b.creatorId === userId),
    [openChallenges, userId]
  );
  const myCompleted = useMemo(
    () => completed.filter(participates),
    [completed, participates]
  );

  // Featured = the first live battle the viewer can still vote on, so the hero
  // is always actionable; otherwise just the first live battle.
  const featuredBattle = useMemo(() => {
    if (live.length === 0) return null;
    const votable = live.find(
      (b) =>
        !votedMap.has(b.id) &&
        !!userId &&
        b.playerA?.userId !== userId &&
        b.playerB?.userId !== userId
    );
    return votable ?? live[0];
  }, [live, votedMap, userId]);

  const trendingBattles = useMemo(
    () => live.filter((b) => b.id !== featuredBattle?.id),
    [live, featuredBattle]
  );

  // ── Honest per-tab counts (already-loaded data — no new queries) ────────────
  // The Live badge counts LIVE battles only. It previously added
  // openChallenges.length, so a tab holding one live battle and two unaccepted
  // challenges rendered "Live (3)" — then the viewer correctly ran out of
  // votable battles after a single vote and announced "All caught up", which
  // read as a bug. Open challenges have no opponent and can never be voted on;
  // they keep their own labelled section in the list.
  const tabCounts = useMemo(
    () => ({
      live: live.length,
      mine: myActive.length + myChallengesSent.length + myCompleted.length,
      completed: completed.length,
    }),
    [live, myActive, myChallengesSent, myCompleted, completed]
  );

  // ── Rows ────────────────────────────────────────────────────────────────────
  const listRows = useMemo<ListRow[]>(() => {
    const rows: ListRow[] = [];

    if (activeTab === "live") {
      if (featuredBattle) {
        rows.push({ type: "featured", id: `f-${featuredBattle.id}`, battle: featuredBattle });
      }
      if (trendingBattles.length > 0) {
        rows.push({
          type: "header",
          id: "h-trending",
          title: "Trending Battles",
          subtitle: `${trendingBattles.length} more live right now`,
        });
        rows.push({ type: "rail", id: "rail-trending", battles: trendingBattles });
      }
      if (openChallenges.length > 0) {
        rows.push({
          type: "header",
          id: "h-open",
          title: "Open Challenges",
          subtitle: "Accept one and the battle goes live",
        });
        openChallenges.forEach((b) =>
          rows.push({ type: "challenge", id: b.id, battle: b })
        );
      }
      return rows;
    }

    if (activeTab === "mine") {
      const showActive = mineFilter === "all" || mineFilter === "active";
      const showSent = mineFilter === "all" || mineFilter === "sent";
      const showDone = mineFilter === "all" || mineFilter === "completed";

      if (showActive && myActive.length > 0) {
        rows.push({ type: "header", id: "h-active", title: "Active", subtitle: "The community is voting" });
        myActive.forEach((b) => rows.push({ type: "active", id: b.id, battle: b }));
      }
      if (showSent && myChallengesSent.length > 0) {
        rows.push({
          type: "header",
          id: "h-sent",
          title: "Challenges sent",
          subtitle: "Waiting for an opponent",
        });
        myChallengesSent.forEach((b) => rows.push({ type: "active", id: b.id, battle: b }));
      }
      if (showDone && myCompleted.length > 0) {
        rows.push({ type: "header", id: "h-done", title: "Results" });
        myCompleted.forEach((b) => rows.push({ type: "result", id: b.id, battle: b }));
      }
      return rows;
    }

    completed.forEach((b) => rows.push({ type: "result", id: b.id, battle: b }));
    return rows;
  }, [
    activeTab,
    featuredBattle,
    trendingBattles,
    openChallenges,
    mineFilter,
    myActive,
    myChallengesSent,
    myCompleted,
    completed,
  ]);

  const openDetail = useCallback((battle: Battle) => {
    setDetailBattle(battle);
  }, []);

  const closeDetail = useCallback(() => {
    setDetailBattle(null);
  }, []);

  // Open the Accept Challenge modal for a given battle id, resolving the full
  // battle object so the modal can show the challenger, category, and rules.
  const openAccept = useCallback((battleId: string) => {
    const b = battlesRef.current.find((x) => x.id === battleId) ?? null;
    setAcceptBattle(b);
  }, []);

  // PERF: memoized, because renderBattleRow depends on these. As plain function
  // declarations they got a fresh identity every render, which invalidated
  // renderBattleRow and defeated the memoized row components underneath it.
  //
  // The eligibility rules themselves are unchanged: live, not already voted,
  // signed in, matched, and not one of the two competitors.
  // Single shared eligibility predicate (services/battleQueue.ts). The vote
  // buttons, the featured hero, the Live count and the viewer queue all derive
  // from this one function so they can no longer disagree with each other.
  // A skipped battle is still votable — skipping only defers it — so the
  // session skip list is ignored here.
  const canVoteOnBattle = useCallback(
    (battle: Battle): boolean =>
      isVotableBattle(
        battle,
        { currentUserId: userId, votedIds: votedMap },
        { includeSkipped: true }
      ),
    [votedMap, userId]
  );

  const canSkipBattle = useCallback(
    (battle: Battle): boolean => {
      if (getBattleStatus(battle) !== "live") return false;
      return (
        getNextVotableBattle({
          battles: battlesRef.current,
          currentBattleId: battle.id,
          currentUserId: userId,
          votedMap: votedMapRef.current,
          skippedIds: skippedIdsRef.current,
        }) !== null
      );
    },
    [userId]
  );

  // Vote, then advance to the next votable live battle (or show "all caught up")
  const handleVoteWithAdvance = useCallback(
    async (battleId: string, side: "A" | "B") => {
      if (votingBattleRef.current === battleId) return;
      votingBattleRef.current = battleId;

      // Optimistic modal update so the vote bar animates immediately
      setDetailBattle((prev) =>
        prev && prev.id === battleId
          ? {
              ...prev,
              votesA: prev.votesA + (side === "A" ? 1 : 0),
              votesB: prev.votesB + (side === "B" ? 1 : 0),
            }
          : prev
      );

      const success = await handleVote(battleId, side);
      if (!success) {
        votingBattleRef.current = null;
        return; // Already voted or Firestore error — stay on current battle
      }

      // Hold on voted state for 700 ms so user sees the result
      await new Promise<void>((resolve) => {
        advanceResolveRef.current = resolve;
        advanceTimerRef.current = setTimeout(() => {
          advanceResolveRef.current = null;
          resolve();
        }, 700);
      });
      advanceTimerRef.current = null;
      if (!mountedRef.current) return;

      // Build the updated voted map (Firestore write may not have propagated yet)
      const updatedVotedMap = new Map(votedMapRef.current);
      updatedVotedMap.set(battleId, side);

      // A voted battle leaves the queue permanently; drop any stale skip entry
      // so it cannot linger and mask a genuinely empty queue later.
      skippedIdsRef.current.delete(battleId);

      const next = getNextVotableBattle({
        battles: battlesRef.current,
        currentBattleId: battleId,
        currentUserId: userId,
        votedMap: updatedVotedMap,
        skippedIds: skippedIdsRef.current,
      });

      if (next) {
        setDetailBattle(next);
      } else {
        setDetailBattle(null);
        showAlert("All caught up! 🎉", "You've voted on all available live battles.");
      }

      votingBattleRef.current = null;
    },
    [handleVote, userId]
  );

  const handleSkipBattle = useCallback(
    (battleId: string) => {
      // Record the skip BEFORE searching, so the queue advances past it instead
      // of cycling back to the battle the viewer just dismissed.
      skippedIdsRef.current.add(battleId);

      const next = getNextVotableBattle({
        battles: battlesRef.current,
        currentBattleId: battleId,
        currentUserId: userId,
        votedMap: votedMapRef.current,
        skippedIds: skippedIdsRef.current,
      });

      if (next) {
        setDetailBattle(next);
        return;
      }

      // Genuinely nothing left. Distinguish "you voted on everything" from
      // "you skipped past everything", and clear the skip list so re-entering
      // the viewer offers the deferred battles again rather than stranding the
      // athlete on an empty queue.
      const skippedCount = skippedIdsRef.current.size;
      skippedIdsRef.current.clear();
      setDetailBattle(null);
      showAlert(
        "All caught up! 🎉",
        skippedCount > 0
          ? "You've seen every live battle. Pull to refresh to run through the skipped ones again."
          : "No more votable battles right now."
      );
    },
    [userId]
  );

  // ── Share (cross-platform, with clipboard fallback) ────────────────────────
  const shareLive = useCallback((battle: Battle) => {
    void shareBattle(battle);
  }, []);
  const shareResult = useCallback((battle: Battle) => {
    void shareBattleResult(battle);
  }, []);

  const openAthlete = useCallback(
    (targetUserId: string) => openAthleteProfile(router, targetUserId, userId),
    [router, userId]
  );

  const goToFeed = useCallback(() => router.push("/(tabs)" as never), [router]);

  const renderRailCard = useCallback(
    ({ item }: { item: Battle }) => (
      <View style={styles.railItem}>
        <BattleRowCard
          battle={item}
          onPress={() => openDetail(item)}
          currentUserId={userId}
        />
      </View>
    ),
    [openDetail, userId]
  );

  const renderBattleRow = useCallback(
    ({ item }: { item: ListRow }) => {
      if (item.type === "header") {
        return (
          <View style={styles.groupHeader} accessibilityRole="header">
            <Text style={styles.groupHeaderTitle}>{item.title}</Text>
            {item.subtitle ? (
              <Text style={styles.groupHeaderSub}>{item.subtitle}</Text>
            ) : null}
          </View>
        );
      }

      if (item.type === "featured") {
        return (
          <FeaturedBattle
            battle={item.battle}
            userVote={votedMap.get(item.battle.id) ?? null}
            canVote={canVoteOnBattle(item.battle)}
            onVote={handleVoteWithAdvance}
            onOpen={openDetail}
            onOpenAthlete={openAthlete}
            onShare={shareLive}
            onSkip={
              canSkipBattle(item.battle)
                ? () => handleSkipBattle(item.battle.id)
                : undefined
            }
          />
        );
      }

      if (item.type === "rail") {
        return (
          <FlatList
            horizontal
            data={item.battles}
            keyExtractor={railKey}
            renderItem={renderRailCard}
            showsHorizontalScrollIndicator={false}
            contentContainerStyle={styles.rail}
            initialNumToRender={2}
            maxToRenderPerBatch={2}
            windowSize={3}
          />
        );
      }

      if (item.type === "challenge") {
        return (
          <OpenChallengeRow
            battle={item.battle}
            onAccept={openAccept}
            onOpen={openDetail}
            onOpenAthlete={openAthlete}
            // Firestore rules forbid the creator from accepting their own
            // challenge, so the button is replaced with a "yours" state.
            canAccept={!!userId && item.battle.creatorId !== userId}
          />
        );
      }

      if (item.type === "active") {
        return (
          <ActiveBattleRow
            battle={item.battle}
            viewerUserId={userId}
            onOpen={openDetail}
            onOpenAthlete={openAthlete}
            onShare={shareLive}
          />
        );
      }

      return (
        <BattleResultCard
          battle={item.battle}
          onOpen={openDetail}
          onOpenAthlete={openAthlete}
          onShare={shareResult}
          viewerUserId={activeTab === "mine" ? userId : null}
        />
      );
    },
    [
      activeTab,
      canSkipBattle,
      canVoteOnBattle,
      handleSkipBattle,
      handleVoteWithAdvance,
      openAccept,
      openAthlete,
      openDetail,
      renderRailCard,
      shareLive,
      shareResult,
      userId,
      votedMap,
    ]
  );

  const tabDefs = useMemo<{ key: Tab; label: string }[]>(
    () => [
      { key: "live", label: `Live${tabCounts.live > 0 ? ` (${tabCounts.live})` : ""}` },
      { key: "mine", label: `My Battles${tabCounts.mine > 0 ? ` (${tabCounts.mine})` : ""}` },
      {
        key: "completed",
        label: `Completed${tabCounts.completed > 0 ? ` (${tabCounts.completed})` : ""}`,
      },
    ],
    [tabCounts]
  );

  // Initial load with nothing cached — skeletons matching the card layout.
  if (loading && battles.length === 0) {
    return (
      <SafeAreaView style={styles.safe} edges={["top"]}>
        <View style={styles.header}>
          <Text style={styles.heading}>Battles</Text>
        </View>
        <View style={styles.tabBarWrap}>
          <SegmentedTabs tabs={tabDefs} activeKey={activeTab} onChange={setActiveTab} />
        </View>
        <BattleCardSkeleton count={2} />
      </SafeAreaView>
    );
  }

  // Hard error only when there is nothing at all to show. If a previous page
  // loaded, keep it on screen and surface the error as a banner instead.
  if (error && battles.length === 0) {
    return (
      <SafeAreaView style={styles.safe} edges={["top"]}>
        <EmptyState icon="⚠️" title="Failed to load battles" subtitle={error}
          actionLabel="Retry" onAction={manualRefreshAndResetSkips} />
      </SafeAreaView>
    );
  }

  return (
    <SafeAreaView style={styles.safe} edges={["top"]}>
      {/* ── Header ─────────────────────────────────────────────────────────── */}
      <View style={styles.header}>
        <Text style={styles.heading}>Battles</Text>
      </View>

      {/* ── Tabs ───────────────────────────────────────────────────────────── */}
      <View style={styles.tabBarWrap}>
        <SegmentedTabs tabs={tabDefs} activeKey={activeTab} onChange={setActiveTab} />
      </View>

      {/* ── Stats-sync warning (non-blocking) ──────────────────────────────── */}
      {finalizeWarning && (
        <View style={styles.warningBanner} accessibilityRole="alert">
          <Feather name="alert-triangle" size={14} color={COLORS.warning} />
          <Text style={styles.warningText}>{finalizeWarning}</Text>
        </View>
      )}

      {/* ── Refresh error banner — cached battles stay on screen ───────────── */}
      {error && battles.length > 0 && (
        <View style={styles.warningBanner} accessibilityRole="alert">
          <Feather name="alert-triangle" size={14} color={COLORS.warning} />
          <Text style={styles.warningText}>
            Couldn’t refresh battles. Showing the last loaded results.
          </Text>
          <Pressable
            onPress={manualRefreshAndResetSkips}
            accessibilityRole="button"
            accessibilityLabel="Retry loading battles"
            hitSlop={{ top: 8, bottom: 8, left: 8, right: 8 }}
          >
            <Text style={styles.retryText}>Retry</Text>
          </Pressable>
        </View>
      )}

      {/* ── Content ────────────────────────────────────────────────────────── */}
      {/* PERF: FlatList instead of ScrollView+map so the My Battles / Completed
          card lists are virtualized — previously every BattleCard (media tiles,
          thumbnails, avatars) mounted at once. UI is unchanged: the live tab's
          hero + "More Battles" rounded section renders as the list header
          (lightweight rows), while the full-size card lists go through
          renderItem and mount lazily. */}
      <FlatList<ListRow>
        data={listRows}
        keyExtractor={battleRowKey}
        showsVerticalScrollIndicator={false}
        initialNumToRender={3}
        maxToRenderPerBatch={3}
        updateCellsBatchingPeriod={50}
        windowSize={7}
        // NOTE: removeClippedSubviews is intentionally NOT set here. The live
        // tab's ListHeaderComponent contains an auto-playing <Video> and
        // absolutely-positioned overlays (voted check / winner badge), and RN's
        // subview clipping is known to blank native video views and drop
        // absolute-positioned children when they detach mid-scroll. The
        // virtualization win comes from the window props above.
        refreshControl={
          <RefreshControl refreshing={refreshing} onRefresh={manualRefreshAndResetSkips} tintColor={COLORS.accent} />
        }
        contentContainerStyle={
          listRows.length === 0
            ? { flexGrow: 1 }
            : { paddingBottom: SPACING.xxxl, paddingTop: SPACING.sm }
        }
        renderItem={renderBattleRow}
        ListHeaderComponent={
          activeTab === "mine" ? (
            <View style={styles.mineFilterRow}>
              <Chip
                label="All"
                selected={mineFilter === "all"}
                onPress={() => setMineFilter("all")}
              />
              <Chip
                label={`Active${myActive.length ? ` (${myActive.length})` : ""}`}
                selected={mineFilter === "active"}
                onPress={() => setMineFilter("active")}
              />
              <Chip
                label={`Challenges Sent${myChallengesSent.length ? ` (${myChallengesSent.length})` : ""}`}
                selected={mineFilter === "sent"}
                onPress={() => setMineFilter("sent")}
              />
              <Chip
                label={`Completed${myCompleted.length ? ` (${myCompleted.length})` : ""}`}
                selected={mineFilter === "completed"}
                onPress={() => setMineFilter("completed")}
              />
            </View>
          ) : null
        }
        ListEmptyComponent={
          activeTab === "live" ? (
            /* Live is never a blank black screen: when there is nothing to vote
               on, it becomes a launchpad. Every action below is real — Start a
               Battle opens the feed (challenges begin from a highlight), and
               Recent Results switches to a tab that already has content. */
            <View style={styles.liveEmpty}>
              <EmptyState
                icon="⚔️"
                title="No live battles right now"
                subtitle="Be the spark. Start a battle from one of your highlights, or accept an open challenge."
                actionLabel="Start a Battle"
                onAction={goToFeed}
              />
              {openChallenges.length > 0 && (
                <Pressable
                  onPress={() => setActiveTab("live")}
                  accessibilityRole="button"
                  accessibilityLabel={`See ${openChallenges.length} open challenges`}
                  style={({ pressed }) => [
                    styles.emptyLink,
                    pressed && { opacity: 0.75 },
                  ]}
                >
                  <Feather name="zap" size={14} color={COLORS.accent} />
                  <Text style={styles.emptyLinkText}>
                    {openChallenges.length} open{" "}
                    {openChallenges.length === 1 ? "challenge" : "challenges"} waiting
                  </Text>
                </Pressable>
              )}
              {completed.length > 0 && (
                <Pressable
                  onPress={() => setActiveTab("completed")}
                  accessibilityRole="button"
                  accessibilityLabel="See recent results"
                  style={({ pressed }) => [
                    styles.emptyLink,
                    pressed && { opacity: 0.75 },
                  ]}
                >
                  <Feather name="award" size={14} color={COLORS.accent} />
                  <Text style={styles.emptyLinkText}>
                    See {completed.length} recent{" "}
                    {completed.length === 1 ? "result" : "results"}
                  </Text>
                </Pressable>
              )}
            </View>
          ) : activeTab === "mine" ? (
            <EmptyState
              icon="🥊"
              title={
                mineFilter === "all"
                  ? "You haven't battled yet"
                  : "Nothing in this filter"
              }
              subtitle={
                mineFilter === "all"
                  ? "Open a challenge from one of your highlights, or accept one from the Live tab."
                  : "Try another filter, or head to Live to find a battle."
              }
              actionLabel={mineFilter === "all" ? "See live battles" : "Show all"}
              onAction={
                mineFilter === "all"
                  ? () => setActiveTab("live")
                  : () => setMineFilter("all")
              }
            />
          ) : (
            <EmptyState
              icon="🏆"
              title="No results yet"
              subtitle="When a matched battle's timer ends, the winner lands on this tab."
              actionLabel="See live battles"
              onAction={() => setActiveTab("live")}
            />
          )
        }
      />

      {/* ── Accept modal ───────────────────────────────────────────────────── */}
      <AcceptModal
        visible={!!acceptBattle}
        battle={acceptBattle}
        onClose={() => setAcceptBattle(null)}
        onAccepted={refresh}
        userId={userId ?? ""}
        profile={profile}
      />

      {/* ── Battle detail modal ────────────────────────────────────────────── */}
      <BattleDetailModal
        visible={!!detailBattle}
        battle={detailBattle}
        userVote={detailBattle ? (votedMap.get(detailBattle.id) ?? null) : null}
        onVote={handleVoteWithAdvance}
        onClose={closeDetail}
        currentUserId={userId}
        onSkip={handleSkipBattle}
        onAccept={(id) => {
          closeDetail();
          openAccept(id);
        }}
      />
    </SafeAreaView>
  );
}

const styles = StyleSheet.create({
  safe: { flex: 1, backgroundColor: COLORS.background },

  // ── Trending rail ──────────────────────────────────────────────────────────
  rail: {
    flexDirection: "row",
    gap: SPACING.sm,
    paddingHorizontal: SPACING.lg,
    paddingBottom: SPACING.sm,
  },
  railItem: { width: 280 },

  // ── My Battles filters ─────────────────────────────────────────────────────
  mineFilterRow: {
    flexDirection: "row",
    flexWrap: "wrap",
    gap: SPACING.sm,
    paddingHorizontal: SPACING.lg,
    paddingBottom: SPACING.md,
  },

  // ── Live empty state ───────────────────────────────────────────────────────
  liveEmpty: { flexGrow: 1, justifyContent: "center", gap: SPACING.sm },
  emptyLink: {
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "center",
    gap: SPACING.sm,
    marginHorizontal: SPACING.xl,
    minHeight: 46,
    borderRadius: RADIUS.md,
    borderWidth: 1,
    borderColor: COLORS.accentBorderFaint,
    backgroundColor: COLORS.accentFaint,
  },
  emptyLinkText: {
    color: COLORS.accent,
    fontSize: 13,
    fontWeight: FONTS.bold,
  },

  // Header
  header: {
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "center",
    paddingHorizontal: SPACING.lg,
    paddingTop: SPACING.md,
    paddingBottom: SPACING.sm,
  },
  heading: {
    color: COLORS.textPrimary,
    fontSize: 22,
    fontWeight: FONTS.heavy,
    letterSpacing: 0.5,
  },

  // Stats-sync warning banner (non-blocking)
  warningBanner: {
    flexDirection: "row",
    alignItems: "center",
    gap: SPACING.sm,
    marginHorizontal: SPACING.lg,
    marginTop: SPACING.sm,
    paddingVertical: SPACING.sm,
    paddingHorizontal: SPACING.md,
    backgroundColor: COLORS.warningFaint,
    borderWidth: 1,
    borderColor: COLORS.warningBorder,
    borderRadius: RADIUS.md,
  },
  warningText: {
    flex: 1,
    color: COLORS.textSecondary,
    fontSize: 12,
    lineHeight: 17,
  },
  retryText: {
    color: COLORS.accent,
    fontSize: 12,
    fontWeight: FONTS.bold,
  },

  // "My Battles" group headers
  groupHeader: {
    paddingHorizontal: SPACING.lg,
    paddingTop: SPACING.lg,
    paddingBottom: SPACING.sm,
  },
  groupHeaderTitle: {
    color: COLORS.textPrimary,
    fontSize: 15,
    fontWeight: FONTS.heavy,
    letterSpacing: 0.3,
  },
  groupHeaderSub: {
    color: COLORS.textMuted,
    fontSize: 12,
    marginTop: 1,
  },

  // Tabs
  tabBarWrap: {
    paddingHorizontal: SPACING.lg,
  },

  // Hero section

  // "View Battle" pill button below each card

  // More Battles
});
