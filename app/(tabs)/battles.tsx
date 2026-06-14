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
  Alert,
  ActivityIndicator,
  Platform,
} from "react-native";
import { SafeAreaView } from "react-native-safe-area-context";
import { useFocusEffect } from "@react-navigation/native";
import { useRouter } from "expo-router";
import * as ImagePicker from "expo-image-picker";
import { getDocs, query, collection, where } from "firebase/firestore";
import { db } from "@/config/firebase";
import { useAuthStore } from "@/store/authStore";
import {
  useBattles,
  acceptChallenge,
  getBattleStatus,
  getBattleWinner,
  getTimeRemainingLabel,
  getNextVotableBattle,
} from "@/hooks/useBattles";
import { uploadMedia, createPost } from "@/hooks/usePosts";
import { COLORS, SPACING, FONTS, RADIUS } from "@/constants/theme";
import { openAthleteProfile } from "@/utils/navigation";
import BattleCard from "@/components/BattleCard";
import BattleDetailModal from "@/components/BattleDetailModal";
import EmptyState from "@/components/EmptyState";
import LoadingSpinner from "@/components/LoadingSpinner";
import AvatarImage from "@/components/AvatarImage";
import GlowButton from "@/components/GlowButton";
import MediaTile from "@/components/MediaTile";
import type { Battle, Post, BattlePlayer } from "@/types";

// Tabs: "live" = Live Battles, "mine" = My Battles, "completed" = Completed
type Tab = "live" | "mine" | "completed";

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
      style={[modal.postThumb, selected && modal.postThumbSelected]}
      onPress={onPress}
      disabled={disabled}
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
            <Text style={modal.thumbCheckText}>✓</Text>
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
function toHandle(username: string): string {
  return "@" + username.toLowerCase().replace(/\s+/g, ".");
}

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
  const [myPosts, setMyPosts] = useState<Post[]>([]);
  const [loadingPosts, setLoadingPosts] = useState(false);
  const [submitting, setSubmitting] = useState(false);
  const [selectedPostId, setSelectedPostId] = useState<string | null>(null);
  const [uploading, setUploading] = useState(false);
  const [uploadPct, setUploadPct] = useState(0);

  const battleId = battle?.id ?? null;
  const challenger = battle?.playerA ?? null;
  const selectedPost = useMemo(
    () => myPosts.find((p) => p.id === selectedPostId) ?? null,
    [myPosts, selectedPostId]
  );

  // Reset the chosen post whenever a different challenge is opened.
  React.useEffect(() => {
    setSelectedPostId(null);
  }, [battleId]);

  React.useEffect(() => {
    if (!visible || !userId) return;
    setLoadingPosts(true);
    // ── Query by all known userId field aliases ───────────────────────────────
    // We intentionally do NOT filter by `battleEnabled`: any of the user's posts
    // with renderable media can be used to accept a challenge (and they can also
    // upload brand-new media below). `orderBy` is omitted to avoid requiring a
    // composite index; we sort the merged results newest-first client-side.
    Promise.all([
      getDocs(query(collection(db, "posts"), where("userId",   "==", userId))),
      getDocs(query(collection(db, "posts"), where("authorId", "==", userId))),
      getDocs(query(collection(db, "posts"), where("uid",      "==", userId))),
    ])
      .then(([byUserId, byAuthorId, byUid]) => {
        const seen = new Set<string>();
        const merged: Post[] = [];
        for (const snap of [byUserId, byAuthorId, byUid]) {
          for (const d of snap.docs) {
            if (!seen.has(d.id)) {
              seen.add(d.id);
              merged.push({ id: d.id, ...(d.data() as Omit<Post, "id">) });
            }
          }
        }
        // Keep only posts that have renderable media
        const withMedia = merged.filter((p) => !!p.mediaUrl);
        // Sort newest-first client-side
        withMedia.sort((a, b) => {
          const tsA = a.createdAt ? (typeof (a.createdAt as { toMillis?: () => number }).toMillis === "function" ? (a.createdAt as { toMillis: () => number }).toMillis() : 0) : 0;
          const tsB = b.createdAt ? (typeof (b.createdAt as { toMillis?: () => number }).toMillis === "function" ? (b.createdAt as { toMillis: () => number }).toMillis() : 0) : 0;
          return tsB - tsA;
        });
        setMyPosts(withMedia);
      })
      .catch((err) => {
        console.error("[acceptModal] post query failed:", err);
        setMyPosts([]);
      })
      .finally(() => setLoadingPosts(false));
  }, [visible, userId]);

  // ── Upload brand-new media to use for this battle ───────────────────────────
  // Mirrors the Create screen's pattern: pick → uploadMedia → createPost. The new
  // post is battle-enabled so it can be reused, then auto-selected as the pick.
  async function pickAndUpload() {
    if (!profile || uploading || submitting) return;
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

      setUploading(true);
      setUploadPct(0);

      const mediaUrl = await uploadMedia(asset.uri, userId, (pct) => setUploadPct(pct));

      const newPostId = await createPost({
        userId,
        username: profile.username,
        userAvatar: profile.avatar,
        avatarUrl: profile.avatar,
        mediaUrl,
        mediaType,
        caption: "",
        battleEnabled: true,
      });

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
      Alert.alert("Upload failed", "Could not upload that media. Please try again.");
    } finally {
      setUploading(false);
      setUploadPct(0);
    }
  }

  async function confirmAccept() {
    if (!battleId || !profile || !selectedPost) return;
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
      onAccepted();
      onClose();
    } catch {
      Alert.alert("Error", "Could not accept challenge. Try again.");
    } finally {
      setSubmitting(false);
    }
  }

  return (
    <Modal visible={visible} transparent animationType="slide" onRequestClose={onClose}>
      <View style={modal.overlay}>
        <View style={modal.sheet}>
          <View style={modal.handle} />
          <ScrollView showsVerticalScrollIndicator={false} contentContainerStyle={modal.scrollBody}>
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
            {loadingPosts ? (
              <LoadingSpinner label="Loading your posts…" />
            ) : (
              <ScrollView horizontal showsHorizontalScrollIndicator={false} style={modal.row}>
                {/* Upload-new tile (always first) */}
                <Pressable
                  style={modal.uploadTile}
                  onPress={pickAndUpload}
                  disabled={uploading || submitting}
                >
                  {uploading ? (
                    <>
                      <ActivityIndicator color={COLORS.accent} />
                      <Text style={modal.uploadLabel}>{uploadPct}%</Text>
                    </>
                  ) : (
                    <>
                      <Text style={modal.uploadIcon}>＋</Text>
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
            {!loadingPosts && myPosts.length === 0 && !uploading && (
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
            <Pressable onPress={onClose} style={modal.cancelBtn} disabled={submitting}>
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
  scrollBody: { paddingBottom: SPACING.xxxl },
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
  thumbCheckText: { color: COLORS.background, fontSize: 12, fontWeight: FONTS.heavy },
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
  uploadIcon: { color: COLORS.accent, fontSize: 26, fontWeight: FONTS.light, lineHeight: 28 },
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

  return (
    <Pressable onPress={onPress} style={rowCard.wrap}>
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
        <Text style={rowCard.chevron}>›</Text>
      </View>
    </Pressable>
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
  completedDot: { backgroundColor: COLORS.accent },
  chevron: { color: COLORS.textMuted, fontSize: 20, fontWeight: FONTS.light },
});

// ─── Main Battles Screen ──────────────────────────────────────────────────────
export default function BattlesScreen() {
  const router = useRouter();
  const userId = useAuthStore((s) => s.userId);
  const profile = useAuthStore((s) => s.profile);
  const { battles, votedMap, loading, refreshing, error, finalizeWarning, refresh, handleVote } =
    useBattles(userId);

  // UI shows "Live Battles", "My Battles", "Completed"
  const [activeTab, setActiveTab] = useState<Tab>("live");
  const [acceptBattle, setAcceptBattle] = useState<Battle | null>(null);
  // Detail modal: which battle is open in detail view
  const [detailBattle, setDetailBattle] = useState<Battle | null>(null);

  // Refresh battles when the tab gains focus (battles don't remount in tab nav)
  const refreshRef = React.useRef(refresh);
  refreshRef.current = refresh;
  useFocusEffect(
    useCallback(() => {
      refreshRef.current();
    }, [])
  );

  // Stable refs so handleVoteWithAdvance always sees the latest battles/votedMap
  // without being recreated on every render.
  const battlesRef = React.useRef(battles);
  battlesRef.current = battles;
  const votedMapRef = React.useRef(votedMap);
  votedMapRef.current = votedMap;
  const votingBattleRef = React.useRef<string | null>(null);

  // ── Filter logic using getBattleStatus ──────────────────────────────────────
  // Live:      active live battles first, then open challenges
  // Mine:      any battle where current user is playerA, playerB, or creator
  // Completed: only ended/completed battles
  const filtered = useMemo(() => {
    const visible = battles.filter((b) => {
      const status = getBattleStatus(b);
      if (activeTab === "live")
        return status === "live" || status === "open";
      if (activeTab === "completed")
        return status === "completed";
      if (activeTab === "mine")
        return (
          b.playerA?.userId === userId ||
          b.playerB?.userId === userId ||
          b.creatorId === userId
        );
      return true;
    });

    // Live tab: live battles first, open challenges second
    if (activeTab === "live") {
      return [...visible].sort((a, b) => {
        const rankA = getBattleStatus(a) === "live" ? 0 : 1;
        const rankB = getBattleStatus(b) === "live" ? 0 : 1;
        return rankA - rankB;
      });
    }

    return visible;
  }, [activeTab, battles, userId]);

  // Split live tab: first live battle = hero, rest = "More Battles" list
  const heroBattle = activeTab === "live" && filtered.length > 0 ? filtered[0] : null;
  const moreBattles = activeTab === "live" && filtered.length > 1 ? filtered.slice(1) : [];
  const showHeroSplit = activeTab === "live" && heroBattle !== null;

  function openDetail(battle: Battle) {
    setDetailBattle(battle);
  }

  function closeDetail() {
    setDetailBattle(null);
  }

  // Open the Accept Challenge modal for a given battle id, resolving the full
  // battle object so the modal can show the challenger, category, and rules.
  const openAccept = useCallback((battleId: string) => {
    const b = battlesRef.current.find((x) => x.id === battleId) ?? null;
    setAcceptBattle(b);
  }, []);

  function canVoteOnBattle(battle: Battle): boolean {
    const status = getBattleStatus(battle);
    return (
      status === "live" &&
      !votedMap.has(battle.id) &&
      !!userId &&
      !!battle.playerB &&
      battle.playerA?.userId !== userId &&
      battle.playerB?.userId !== userId
    );
  }

  function canSkipBattle(battle: Battle): boolean {
    if (getBattleStatus(battle) !== "live") return false;
    return (
      getNextVotableBattle({
        battles: battlesRef.current,
        currentBattleId: battle.id,
        currentUserId: userId,
        votedMap: votedMapRef.current,
      }) !== null
    );
  }

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
      await new Promise<void>((r) => setTimeout(r, 700));

      // Build the updated voted map (Firestore write may not have propagated yet)
      const updatedVotedMap = new Map(votedMapRef.current);
      updatedVotedMap.set(battleId, side);

      const next = getNextVotableBattle({
        battles: battlesRef.current,
        currentBattleId: battleId,
        currentUserId: userId,
        votedMap: updatedVotedMap,
      });

      if (next) {
        console.log("[battleVote] advancing to next battle —", {
          battleId: next.id,
          category: next.category,
        });
        setDetailBattle(next);
      } else {
        console.log("[battleVote] all caught up — no more votable battles");
        setDetailBattle(null);
        Alert.alert("All caught up! 🎉", "You've voted on all available live battles.");
      }

      votingBattleRef.current = null;
    },
    [handleVote, userId]
  );

  const handleSkipBattle = useCallback(
    (battleId: string) => {
      const next = getNextVotableBattle({
        battles: battlesRef.current,
        currentBattleId: battleId,
        currentUserId: userId,
        votedMap: votedMapRef.current,
      });

      if (next) {
        console.log("[battleSkip] advancing to next battle —", {
          battleId: next.id,
          category: next.category,
        });
        setDetailBattle(next);
      } else {
        console.log("[battleSkip] no more votable battles");
        setDetailBattle(null);
        Alert.alert("All caught up! 🎉", "No more votable battles right now.");
      }
    },
    [userId]
  );

  if (loading) return <LoadingSpinner fullscreen label="Loading battles…" />;
  if (error) {
    return (
      <SafeAreaView style={styles.safe} edges={["top"]}>
        <EmptyState icon="⚠️" title="Failed to load battles" subtitle={error}
          actionLabel="Retry" onAction={refresh} />
      </SafeAreaView>
    );
  }

  const tabDefs: { key: Tab; label: string }[] = [
    { key: "live",      label: "Live Battles" },
    { key: "mine",      label: "My Battles" },
    { key: "completed", label: "Completed" },
  ];

  return (
    <SafeAreaView style={styles.safe} edges={["top"]}>
      {/* ── Header ─────────────────────────────────────────────────────────── */}
      <View style={styles.header}>
        <Text style={styles.heading}>Battles</Text>
      </View>

      {/* ── Tabs ───────────────────────────────────────────────────────────── */}
      <View style={styles.tabBar}>
        {tabDefs.map((t) => (
          <Pressable key={t.key} style={styles.tab} onPress={() => setActiveTab(t.key)}>
            <Text style={[styles.tabText, activeTab === t.key && styles.tabTextActive]}>
              {t.label}
            </Text>
            <View style={[styles.tabUnderline, activeTab === t.key && styles.tabUnderlineActive]} />
          </Pressable>
        ))}
      </View>

      {/* ── Stats-sync warning (non-blocking) ──────────────────────────────── */}
      {finalizeWarning && (
        <View style={styles.warningBanner}>
          <Text style={styles.warningIcon}>⚠️</Text>
          <Text style={styles.warningText}>{finalizeWarning}</Text>
        </View>
      )}

      {/* ── Content ────────────────────────────────────────────────────────── */}
      <ScrollView
        showsVerticalScrollIndicator={false}
        refreshControl={
          <RefreshControl refreshing={refreshing} onRefresh={refresh} tintColor={COLORS.accent} />
        }
        contentContainerStyle={filtered.length === 0 ? { flex: 1 } : { paddingBottom: SPACING.xxxl }}
      >
        {filtered.length === 0 ? (
          <EmptyState
            icon={activeTab === "live" ? "🔴" : activeTab === "mine" ? "👤" : "✅"}
            title={
              activeTab === "live" ? "No live battles yet." :
              activeTab === "mine" ? "Your battles will show here." :
              "No completed battles yet."
            }
            subtitle={
              activeTab === "live" ? "Start one from any post." :
              activeTab === "mine" ? "Open or accept a challenge to compete." :
              "Check back after battles end."
            }
            actionLabel={activeTab !== "completed" ? "Start your first battle" : undefined}
            onAction={activeTab !== "completed" ? () => router.push("/create" as never) : undefined}
          />
        ) : showHeroSplit ? (
          <>
            {/* Hero battle card — tapping opens detail */}
            <View style={styles.heroSection}>
              <Pressable onPress={() => openDetail(heroBattle!)} style={{ flex: 1 }}>
                <BattleCard
                  battle={heroBattle!}
                  userVote={votedMap.get(heroBattle!.id) ?? null}
                  onVote={handleVoteWithAdvance}
                  onAccept={openAccept}
                  currentUserId={userId}
                  featured
                  autoPlayMedia
                />
              </Pressable>
              {/* Quick actions below hero */}
              <View style={styles.heroActions}>
                <Pressable
                  style={[styles.viewBattleBtn, styles.heroActionBtn]}
                  onPress={() => openDetail(heroBattle!)}
                >
                  <Text style={styles.viewBattleBtnText}>View Battle →</Text>
                </Pressable>
                {(canVoteOnBattle(heroBattle!) || canSkipBattle(heroBattle!)) && (
                  <Pressable
                    style={[styles.viewBattleBtn, styles.heroActionBtn, styles.skipBattleBtn]}
                    onPress={() => handleSkipBattle(heroBattle!.id)}
                  >
                    <Text style={styles.viewBattleBtnText}>Skip →</Text>
                  </Pressable>
                )}
              </View>
            </View>

            {/* "More Battles" section — each row opens detail */}
            {moreBattles.length > 0 && (
              <View style={styles.moreBattlesSection}>
                <View style={styles.moreBattlesHeader}>
                  <Text style={styles.moreBattlesTitle}>More Battles</Text>
                  <Text style={styles.moreBattlesCount}>{moreBattles.length} more</Text>
                </View>
                {moreBattles.map((b) => (
                  <BattleRowCard
                    key={b.id}
                    battle={b}
                    onPress={() => openDetail(b)}
                    currentUserId={userId}
                  />
                ))}
              </View>
            )}
          </>
        ) : (
          /* My Battles / Completed: regular card list — each tappable for detail */
          <View style={{ paddingTop: SPACING.md }}>
            {filtered.map((b, index) => (
              <View key={b.id}>
                <Pressable onPress={() => openDetail(b)}>
                  <BattleCard
                    battle={b}
                    userVote={votedMap.get(b.id) ?? null}
                    onVote={handleVoteWithAdvance}
                    onAccept={openAccept}
                    currentUserId={userId}
                    featured={index === 0}
                  />
                </Pressable>
                <Pressable
                  style={styles.viewBattleBtn}
                  onPress={() => openDetail(b)}
                >
                  <Text style={styles.viewBattleBtnText}>View Battle →</Text>
                </Pressable>
              </View>
            ))}
          </View>
        )}
      </ScrollView>

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
    fontSize: 20,
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
    backgroundColor: "rgba(255,196,0,0.10)",
    borderWidth: 1,
    borderColor: "rgba(255,196,0,0.45)",
    borderRadius: RADIUS.md,
  },
  warningIcon: { fontSize: 14 },
  warningText: {
    flex: 1,
    color: COLORS.textSecondary,
    fontSize: 12,
    lineHeight: 17,
  },

  // Tabs
  tabBar: {
    flexDirection: "row",
    borderBottomWidth: 1,
    borderBottomColor: COLORS.cardBorder,
    paddingHorizontal: SPACING.lg,
  },
  tab: {
    flex: 1,
    paddingHorizontal: SPACING.sm,
    alignItems: "center",
    paddingTop: SPACING.sm,
    paddingBottom: 0,
  },
  tabText: {
    color: COLORS.textMuted,
    fontSize: 13,
    fontWeight: FONTS.semibold,
  },
  tabTextActive: {
    color: COLORS.textPrimary,
    fontWeight: FONTS.bold,
  },
  tabUnderline: {
    width: "100%",
    height: 2,
    borderRadius: 2,
    backgroundColor: COLORS.transparent,
    marginTop: SPACING.sm,
  },
  tabUnderlineActive: {
    backgroundColor: COLORS.accent,
  },

  // Hero section
  heroSection: {
    paddingTop: SPACING.lg,
  },
  heroActions: {
    flexDirection: "row",
    justifyContent: "center",
    gap: SPACING.sm,
    marginTop: -SPACING.sm,
    marginBottom: SPACING.lg,
  },
  heroActionBtn: {
    marginTop: 0,
    marginBottom: 0,
  },
  skipBattleBtn: {
    borderColor: COLORS.inputBorder,
    backgroundColor: COLORS.surface,
  },

  // "View Battle" pill button below each card
  viewBattleBtn: {
    alignSelf: "center",
    marginTop: -SPACING.sm,
    marginBottom: SPACING.lg,
    paddingHorizontal: SPACING.lg,
    paddingVertical: SPACING.xs + 2,
    borderRadius: RADIUS.full,
    borderWidth: 1,
    borderColor: COLORS.accent,
    backgroundColor: COLORS.accentFaint,
  },
  viewBattleBtnText: {
    color: COLORS.accent,
    fontSize: 12,
    fontWeight: FONTS.bold,
    letterSpacing: 0.3,
  },

  // More Battles
  moreBattlesSection: {
    backgroundColor: COLORS.card,
    marginHorizontal: SPACING.lg,
    marginTop: SPACING.sm,
    borderRadius: RADIUS.xl,
    borderWidth: 1,
    borderColor: COLORS.cardBorder,
    overflow: "hidden",
  },
  moreBattlesHeader: {
    flexDirection: "row",
    justifyContent: "space-between",
    alignItems: "center",
    paddingHorizontal: SPACING.lg,
    paddingVertical: SPACING.md,
  },
  moreBattlesTitle: {
    color: COLORS.textPrimary,
    fontSize: 16,
    fontWeight: FONTS.heavy,
  },
  moreBattlesCount: {
    color: COLORS.textMuted,
    fontSize: 12,
    fontWeight: FONTS.semibold,
  },
});
