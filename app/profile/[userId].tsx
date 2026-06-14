import React, { useMemo, useState } from "react";
import {
  View,
  Text,
  FlatList,
  Modal,
  StyleSheet,
  Pressable,
  Dimensions,
} from "react-native";
import { useLocalSearchParams, useRouter, Redirect } from "expo-router";
import { SafeAreaView } from "react-native-safe-area-context";
import { openAthleteProfile } from "@/utils/navigation";
import { useAuthStore } from "@/store/authStore";
import { useProfile } from "@/hooks/useProfile";
import { useUserPosts } from "@/hooks/usePosts";
import { useBattles } from "@/hooks/useBattles";
import { useFollows } from "@/hooks/useFollows";
import { COLORS, SPACING, RADIUS, FONTS } from "@/constants/theme";
import AvatarImage from "@/components/AvatarImage";
import GlowButton from "@/components/GlowButton";
import EmptyState from "@/components/EmptyState";
import LoadingSpinner from "@/components/LoadingSpinner";
import MediaTile from "@/components/MediaTile";
import PostCard from "@/components/PostCard";
import BattlePickerModal from "@/components/BattlePickerModal";
import type { Battle, Post, UserProfile } from "@/types";

const SCREEN_W = Dimensions.get("window").width;
type ProfileTab = "posts" | "battles" | "saved";

// ─── PostThumb — uses MediaTile for native-safe rendering ────────────────────
function PostThumb({ post, onPress }: { post: Post; onPress: () => void }) {
  const SIZE = (SCREEN_W - SPACING.lg * 2 - SPACING.sm * 2) / 3;
  const thumbStyle = { width: SIZE, height: SIZE, borderRadius: RADIUS.sm } as const;
  return (
    <Pressable style={{ position: "relative" }} onPress={onPress}>
      <MediaTile
        uri={post.mediaUrl || null}
        mediaType={post.mediaType}
        style={thumbStyle}
        context="PlayerProfileGrid"
      />
      {post.mediaType === "video" && (
        <View style={styles.videoBadge}>
          <Text style={styles.videoBadgeText}>VIDEO</Text>
        </View>
      )}
    </Pressable>
  );
}

function PostDetailModal({
  post,
  visible,
  onClose,
  currentUserId,
  isFollowing,
  onFollow,
  onBattle,
}: {
  post: Post | null;
  visible: boolean;
  onClose: () => void;
  currentUserId: string | null;
  isFollowing: boolean;
  onFollow: (userId: string, isCurrentlyFollowing: boolean) => void;
  onBattle: (post: Post) => void;
}) {
  if (!post) return null;

  return (
    <Modal visible={visible} animationType="slide" onRequestClose={onClose}>
      <SafeAreaView style={styles.postModalSafe} edges={["top"]}>
        <View style={styles.postModalTopBar}>
          <Pressable
            onPress={onClose}
            style={styles.backBtn}
            hitSlop={{ top: 8, bottom: 8, left: 8, right: 8 }}
          >
            <Text style={styles.backIcon}>‹</Text>
          </Pressable>
        </View>
        <PostCard
          post={post}
          isLiked={false}
          onLike={() => undefined}
          currentUserId={currentUserId}
          isFollowing={isFollowing}
          onFollow={onFollow}
          onBattle={onBattle}
          enableVideoPlayback
          isActiveVideo
        />
      </SafeAreaView>
    </Modal>
  );
}

// ─── BattleHistoryCard (same layout as own profile) ───────────────────────────
function formatBattleDate(value: Battle["createdAt"]) {
  if (!value) return "Recent";
  const date =
    typeof value.toDate === "function"
      ? value.toDate()
      : new Date(
          (value as { seconds?: number }).seconds
            ? (value as { seconds: number }).seconds * 1000
            : Date.now()
        );
  return date.toLocaleDateString(undefined, { month: "short", day: "numeric" });
}

function BattleHistoryCard({
  battle,
  userId,
  currentUserId,
}: {
  battle: Battle;
  userId: string;
  currentUserId: string | null;
}) {
  const router = useRouter();
  const mine = battle.playerA?.userId === userId ? battle.playerA : battle.playerB;
  const opponent = battle.playerA?.userId === userId ? battle.playerB : battle.playerA;
  const result = battle.winner
    ? battle.winner === userId
      ? "WIN"
      : "LOSS"
    : battle.status.toUpperCase();
  const resultStyle =
    result === "WIN"
      ? styles.resultWin
      : result === "LOSS"
      ? styles.resultLoss
      : styles.resultLive;
  const date = formatBattleDate(battle.createdAt);

  return (
    <View style={styles.battleCard}>
      {/* MediaTile fills the 68×68 battleThumb container safely on iOS */}
      <MediaTile
        uri={mine?.mediaUrl || null}
        mediaType={mine?.mediaType}
        style={styles.battleThumb}
        context="PlayerProfileBattleHistory"
      />
      <View style={styles.battleInfo}>
        <View style={styles.battleMetaRow}>
          <Text style={[styles.resultPill, resultStyle]}>{result}</Text>
          <Text style={styles.battleDate}>{date}</Text>
        </View>
        <Text style={styles.battleTitle} numberOfLines={1}>
          {battle.category || "Battle"}
        </Text>
        {/* Opponent name — tappable to navigate to their profile */}
        {opponent?.userId ? (
          <Pressable
            onPress={() => openAthleteProfile(router, opponent!.userId, currentUserId)}
            hitSlop={{ top: 6, bottom: 6, left: 6, right: 6 }}
          >
            <Text style={[styles.battleOpponent, styles.battleOpponentLink]} numberOfLines={1}>
              vs {opponent.username}
            </Text>
          </Pressable>
        ) : (
          <Text style={styles.battleOpponent} numberOfLines={1}>
            vs {opponent?.username || "Open challenge"}
          </Text>
        )}
      </View>
    </View>
  );
}

// ─── Stat cell ────────────────────────────────────────────────────────────────
function Stat({ label, value }: { label: string; value: number }) {
  return (
    <View style={styles.stat}>
      <Text style={styles.statValue}>{value}</Text>
      <Text style={styles.statLabel}>{label}</Text>
    </View>
  );
}

// ─── Player Profile Screen ────────────────────────────────────────────────────
export default function PlayerProfileScreen() {
  const { userId: routeUserId } = useLocalSearchParams<{ userId: string }>();
  const router = useRouter();
  const currentUserId = useAuthStore((s) => s.userId);
  const currentProfile = useAuthStore((s) => s.profile);

  // If viewing own profile, show own data (edit still available)
  const targetUserId = routeUserId ?? null;
  const isSelf = !!targetUserId && targetUserId === currentUserId;

  const { profile, loading: profileLoading, error: profileError } = useProfile(targetUserId);
  const { posts, loading: postsLoading } = useUserPosts(targetUserId);
  // Use currentUserId (viewer) so the votedMap reflects the viewer's own votes,
  // not the profile owner's votes. The battles list is identical either way since
  // useBattles always fetches all battles regardless of the passed userId.
  const { battles, loading: battlesLoading } = useBattles(currentUserId);
  const { followedIds, follow, unfollow } = useFollows(currentUserId);

  const [activeTab, setActiveTab] = useState<ProfileTab>("posts");
  const [selectedPost, setSelectedPost] = useState<Post | null>(null);
  const [challengeTargetPost, setChallengeTargetPost] = useState<Post | null>(null);

  const isFollowing = !!targetUserId && followedIds.has(targetUserId);

  const profileHandle = `@${profile?.username?.trim().toLowerCase().replace(/\s+/g, "") || "player"}`;

  const profileBattles = useMemo(
    () =>
      battles.filter(
        (b) =>
          b.playerA?.userId === targetUserId ||
          b.playerB?.userId === targetUserId ||
          b.creatorId === targetUserId
      ),
    [battles, targetUserId]
  );

  const listData =
    activeTab === "posts" ? posts : activeTab === "battles" ? profileBattles : [];

  const tabs: { key: ProfileTab; label: string }[] = [
    { key: "posts", label: "Posts" },
    { key: "battles", label: "Battles" },
    { key: "saved", label: "Saved" },
  ];

  function handleFollow(targetId: string, isCurrentlyFollowing: boolean) {
    if (!currentUserId) return;
    if (isCurrentlyFollowing) unfollow(targetId);
    else follow(targetId);
  }

  function handleBattle(post: Post) {
    if (!currentUserId) return;
    setChallengeTargetPost(post);
  }

  // ── Redirect own profile to the tab so the tab bar is visible and there
  //    is no back button. Must come after all hook calls (Rules of Hooks).
  if (isSelf) {
    return <Redirect href={"/(tabs)/profile" as never} />;
  }

  // ── Loading / error / not-found states ─────────────────────────────────────
  if (!targetUserId) {
    return (
      <SafeAreaView style={styles.safe} edges={["top"]}>
        <EmptyState icon="👤" title="No user specified" subtitle="" />
      </SafeAreaView>
    );
  }

  if (profileLoading) {
    return (
      <SafeAreaView style={styles.safe} edges={["top"]}>
        <LoadingSpinner fullscreen />
      </SafeAreaView>
    );
  }

  if (profileError || !profile) {
    return (
      <SafeAreaView style={styles.safe} edges={["top"]}>
        <View style={styles.topBar}>
          <Pressable
            onPress={() => router.canGoBack() ? router.back() : router.navigate("/(tabs)" as never)}
            style={styles.backBtn}
            hitSlop={{ top: 8, bottom: 8, left: 8, right: 8 }}
          >
            <Text style={styles.backIcon}>‹</Text>
          </Pressable>
        </View>
        <EmptyState
          icon="👤"
          title="Athlete not found"
          subtitle="This profile doesn't exist or has been removed."
        />
      </SafeAreaView>
    );
  }

  return (
    <SafeAreaView style={styles.safe} edges={["top"]}>
      <FlatList<Post | Battle>
        key={activeTab}
        data={listData as (Post | Battle)[]}
        keyExtractor={(item) => item.id}
        numColumns={activeTab === "posts" ? 3 : 1}
        columnWrapperStyle={activeTab === "posts" ? { gap: SPACING.sm } : undefined}
        contentContainerStyle={styles.grid}
        renderItem={({ item }) =>
          activeTab === "posts" ? (
            <PostThumb post={item as Post} onPress={() => setSelectedPost(item as Post)} />
          ) : (
            <BattleHistoryCard battle={item as Battle} userId={targetUserId} currentUserId={currentUserId} />
          )
        }
        ListHeaderComponent={
          <View style={styles.profileHeader}>
            {/* ── Top bar: back button ──────────────────────────────────────── */}
            <View style={styles.topBar}>
              <Pressable
                onPress={() => router.canGoBack() ? router.back() : router.navigate("/(tabs)" as never)}
                style={styles.backBtn}
                hitSlop={{ top: 8, bottom: 8, left: 8, right: 8 }}
              >
                <Text style={styles.backIcon}>‹</Text>
              </Pressable>
            </View>

            {/* ── Identity: avatar + name/handle ───────────────────────────── */}
            <View style={styles.identityRow}>
              <View style={styles.avatarRingWrap}>
                <AvatarImage uri={profile.avatar} username={profile.username} size={80} />
              </View>
              <View style={styles.identityText}>
                <Text style={styles.username}>{profile.username}</Text>
                <Text style={styles.handle}>{profileHandle}</Text>
              </View>
            </View>

            {/* ── Stats row ────────────────────────────────────────────────── */}
            {/* posts.length mirrors the grid exactly; profile.posts is stale
                because Firestore rules block client-side counter increments. */}
            <View style={styles.statsRow}>
              <Stat label="Posts" value={posts.length} />
              <View style={styles.statDivider} />
              <Stat label="Wins" value={profile.wins} />
              <View style={styles.statDivider} />
              <Stat label="Losses" value={profile.losses} />
            </View>

            {/* ── Bio / sport ──────────────────────────────────────────────── */}
            {(profile.athleteType || profile.bio) ? (
              <View style={styles.bioSection}>
                {profile.athleteType ? (
                  <Text style={styles.sport}>{profile.athleteType}</Text>
                ) : null}
                {profile.bio ? (
                  <Text style={styles.bio}>{profile.bio}</Text>
                ) : null}
              </View>
            ) : null}

            {/* ── Action buttons ────────────────────────────────────────────── */}
            {/* isSelf case is handled by the Redirect above; only other athletes reach here */}
            <View style={styles.actionRow}>
              {(
                <GlowButton
                  label={isFollowing ? "Following" : "Follow"}
                  onPress={() => {
                    if (!targetUserId || !currentUserId) return;
                    if (isFollowing) unfollow(targetUserId);
                    else follow(targetUserId);
                  }}
                  variant={isFollowing ? "secondary" : "primary"}
                  size="sm"
                  style={{ flex: 1 }}
                />
              )}
            </View>

            {/* ── Posts / Battles / Saved tabs ─────────────────────────────── */}
            <View style={styles.tabs}>
              {tabs.map((tab) => {
                const isActive = activeTab === tab.key;
                return (
                  <Pressable
                    key={tab.key}
                    onPress={() => setActiveTab(tab.key)}
                    style={styles.tabButton}
                  >
                    <Text style={[styles.tabText, isActive && styles.tabTextActive]}>
                      {tab.label}
                    </Text>
                    <View
                      style={[styles.tabUnderline, isActive && styles.tabUnderlineActive]}
                    />
                  </Pressable>
                );
              })}
            </View>
          </View>
        }
        ListEmptyComponent={
          activeTab === "posts" && postsLoading ? (
            <LoadingSpinner label="Loading posts…" />
          ) : activeTab === "battles" && battlesLoading ? (
            <LoadingSpinner label="Loading battles…" />
          ) : activeTab === "battles" ? (
            <EmptyState
              icon="⚔️"
              title="No battle history"
              subtitle="Completed battles will show up here."
            />
          ) : activeTab === "saved" ? (
            <EmptyState
              icon="🔖"
              title="No saved posts"
              subtitle="Saved posts will show up here."
            />
          ) : (
            <EmptyState
              icon="📷"
              title="No posts yet"
              subtitle="This athlete hasn't posted any highlights."
            />
          )
        }
        showsVerticalScrollIndicator={false}
      />
      <PostDetailModal
        visible={!!selectedPost}
        post={selectedPost}
        onClose={() => setSelectedPost(null)}
        currentUserId={currentUserId}
        isFollowing={isFollowing}
        onFollow={handleFollow}
        onBattle={handleBattle}
      />
      <BattlePickerModal
        visible={!!challengeTargetPost}
        targetPost={challengeTargetPost}
        currentUserId={currentUserId ?? ""}
        currentProfile={currentProfile}
        onClose={() => setChallengeTargetPost(null)}
        onBattleCreated={() => {
          setChallengeTargetPost(null);
          setSelectedPost(null);
        }}
      />
    </SafeAreaView>
  );
}

// ─── Styles (mirrors app/(tabs)/profile.tsx) ──────────────────────────────────
const styles = StyleSheet.create({
  safe: { flex: 1, backgroundColor: COLORS.background },
  postModalSafe: { flex: 1, backgroundColor: COLORS.background },
  postModalTopBar: {
    paddingHorizontal: SPACING.lg,
    paddingTop: SPACING.sm,
    paddingBottom: SPACING.xs,
  },

  profileHeader: {
    paddingBottom: 0,
    backgroundColor: COLORS.background,
  },

  // ── Top bar (back navigation) ─────────────────────────────────────────────
  topBar: {
    flexDirection: "row",
    alignItems: "center",
    paddingHorizontal: SPACING.lg,
    paddingTop: SPACING.md,
    paddingBottom: SPACING.sm,
    minHeight: 48,
  },
  backBtn: {
    width: 36,
    height: 36,
    borderRadius: 18,
    backgroundColor: COLORS.surface,
    borderWidth: 1,
    borderColor: COLORS.cardBorder,
    alignItems: "center",
    justifyContent: "center",
  },
  backIcon: { color: COLORS.textPrimary, fontSize: 22, lineHeight: 28, marginTop: -2 },

  // ── Identity ──────────────────────────────────────────────────────────────
  identityRow: {
    flexDirection: "row",
    alignItems: "center",
    paddingHorizontal: SPACING.lg,
    paddingBottom: SPACING.lg,
    gap: SPACING.lg,
  },
  avatarRingWrap: {
    borderRadius: 46,
    borderWidth: 3,
    borderColor: COLORS.accent,
    padding: 2,
    overflow: "hidden",
  },
  identityText: { flex: 1 },
  username: {
    color: COLORS.textPrimary,
    fontSize: 24,
    fontWeight: FONTS.heavy,
    marginBottom: 3,
  },
  handle: {
    color: COLORS.textHandle,
    fontSize: 14,
    fontWeight: FONTS.medium,
  },

  // ── Stats ─────────────────────────────────────────────────────────────────
  statsRow: {
    flexDirection: "row",
    justifyContent: "center",
    alignItems: "center",
    paddingVertical: SPACING.lg,
    paddingHorizontal: SPACING.xl,
    borderTopWidth: 1,
    borderTopColor: COLORS.cardBorder,
    borderBottomWidth: 1,
    borderBottomColor: COLORS.cardBorder,
    marginBottom: SPACING.md,
  },
  stat: { flex: 1, alignItems: "center" },
  statDivider: {
    width: 1,
    height: 36,
    backgroundColor: COLORS.cardBorder,
  },
  statValue: {
    color: COLORS.textPrimary,
    fontSize: 22,
    fontWeight: FONTS.heavy,
  },
  statLabel: {
    color: COLORS.textMuted,
    fontSize: 11,
    marginTop: 3,
    textTransform: "uppercase",
    letterSpacing: 0.5,
  },

  // ── Bio / sport ───────────────────────────────────────────────────────────
  bioSection: {
    paddingHorizontal: SPACING.lg,
    paddingBottom: SPACING.md,
    gap: 4,
    alignItems: "center",
  },
  sport: {
    color: COLORS.accent,
    fontSize: 14,
    fontWeight: FONTS.semibold,
    textAlign: "center",
  },
  bio: {
    color: COLORS.textSecondary,
    fontSize: 13,
    lineHeight: 19,
    textAlign: "center",
  },

  // ── Action buttons ────────────────────────────────────────────────────────
  actionRow: {
    flexDirection: "row",
    gap: SPACING.sm,
    marginHorizontal: SPACING.lg,
    marginBottom: SPACING.md,
  },

  // ── Tabs ──────────────────────────────────────────────────────────────────
  tabs: {
    flexDirection: "row",
    borderBottomWidth: 1,
    borderBottomColor: COLORS.cardBorder,
    paddingHorizontal: SPACING.lg,
    marginBottom: SPACING.sm,
  },
  tabButton: {
    flex: 1,
    alignItems: "center",
    paddingTop: SPACING.sm,
    paddingBottom: 0,
  },
  tabText: {
    color: COLORS.textMuted,
    fontSize: 14,
    fontWeight: FONTS.bold,
  },
  tabTextActive: { color: COLORS.textPrimary },
  tabUnderline: {
    width: "80%",
    height: 2,
    borderRadius: 2,
    backgroundColor: COLORS.transparent,
    marginTop: SPACING.sm,
  },
  tabUnderlineActive: { backgroundColor: COLORS.accent },

  // ── Grid ─────────────────────────────────────────────────────────────────
  grid: {
    paddingHorizontal: SPACING.md,
    paddingBottom: SPACING.xxxl,
    gap: SPACING.sm,
  },

  // ── Post thumbnail video badge ─────────────────────────────────────────────
  videoBadge: {
    position: "absolute",
    top: 4,
    right: 4,
    backgroundColor: "rgba(0,0,0,0.6)",
    borderRadius: RADIUS.xs,
    paddingHorizontal: 4,
    paddingVertical: 1,
  },
  videoBadgeText: {
    color: COLORS.white,
    fontSize: 9,
    fontWeight: FONTS.bold,
  },

  // ── Battle history cards ──────────────────────────────────────────────────
  battleCard: {
    flexDirection: "row",
    alignItems: "center",
    paddingHorizontal: SPACING.lg,
    paddingVertical: SPACING.md,
    borderBottomWidth: 1,
    borderBottomColor: COLORS.cardBorder,
    gap: SPACING.md,
  },
  battleThumb: {
    width: 68,
    height: 68,
    borderRadius: RADIUS.md,
    overflow: "hidden",
    backgroundColor: COLORS.surface,
    flexShrink: 0,
  },
  battleInfo: { flex: 1 },
  battleMetaRow: {
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "space-between",
    marginBottom: 4,
  },
  resultPill: {
    overflow: "hidden",
    borderRadius: RADIUS.full,
    paddingHorizontal: SPACING.sm,
    paddingVertical: 3,
    fontSize: 11,
    fontWeight: FONTS.heavy,
  },
  resultWin:  { color: COLORS.accent,         backgroundColor: COLORS.accentFaint },
  resultLoss: { color: COLORS.error,           backgroundColor: COLORS.errorFaint },
  resultLive: { color: COLORS.textSecondary,   backgroundColor: COLORS.input },
  battleDate: { color: COLORS.textMuted, fontSize: 12 },
  battleTitle: {
    color: COLORS.textPrimary,
    fontSize: 15,
    fontWeight: FONTS.bold,
    marginBottom: 2,
  },
  battleOpponent: { color: COLORS.textSecondary, fontSize: 13 },
  battleOpponentLink: { color: COLORS.accent, textDecorationLine: "underline" },
});
