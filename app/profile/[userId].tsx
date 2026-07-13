import React, { useCallback, useMemo, useState } from "react";
import { View, StyleSheet, Alert, Platform } from "react-native";
import { useLocalSearchParams, useRouter, Redirect } from "expo-router";
import { SafeAreaView } from "react-native-safe-area-context";
import Animated, {
  useSharedValue,
  useAnimatedScrollHandler,
} from "react-native-reanimated";
import { useAuthStore } from "@/store/authStore";
import { useProfile } from "@/hooks/useProfile";
import { useUserPosts } from "@/hooks/usePosts";
import { useBattles } from "@/hooks/useBattles";
import { useFollows } from "@/hooks/useFollows";
import { COLORS, SPACING, TRENDING_LIKES_THRESHOLD } from "@/constants/theme";
import { isVideoMedia } from "@/utils/media";
import EmptyState from "@/components/EmptyState";
import LoadingSpinner from "@/components/LoadingSpinner";
import IconButton from "@/components/IconButton";
import ProfileHeader from "@/components/ProfileHeader";
import ProfileTabs, { ProfileTabDef } from "@/components/ProfileTabs";
import ProfileCompactBar, { COMPACT_BAR_HEIGHT } from "@/components/ProfileCompactBar";
import ProfileGridSkeleton from "@/components/ProfileGridSkeleton";
import PostGridThumb from "@/components/PostGridThumb";
import BattleHistoryCard from "@/components/BattleHistoryCard";
import PostDetailModal from "@/components/PostDetailModal";
import BattlePickerModal from "@/components/BattlePickerModal";
import type { Battle, Post } from "@/types";

type ProfileTab = "posts" | "highlights" | "battles" | "saved";

const PROFILE_TABS: readonly ProfileTabDef<ProfileTab>[] = [
  { key: "posts", label: "Posts", icon: "grid" },
  { key: "highlights", label: "Highlights", icon: "play" },
  { key: "battles", label: "Battles", icon: "zap" },
  { key: "saved", label: "Saved", icon: "bookmark" },
];

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
  // includeVotes=false: this screen only renders battle history rows and never
  // shows or casts votes, so skip the votedMap lookups (3 Firestore `in`
  // queries per visit). The battles list itself is user-independent.
  const { battles, loading: battlesLoading } = useBattles(currentUserId, false);
  const { followedIds, follow, unfollow } = useFollows(currentUserId);

  const [activeTab, setActiveTab] = useState<ProfileTab>("posts");
  const [selectedPost, setSelectedPost] = useState<Post | null>(null);
  const [challengeTargetPost, setChallengeTargetPost] = useState<Post | null>(null);

  // Collapsing header — scroll offset lives on the UI thread only.
  const scrollY = useSharedValue(0);
  const scrollHandler = useAnimatedScrollHandler((event) => {
    scrollY.value = event.contentOffset.y;
  });

  const isFollowing = !!targetUserId && followedIds.has(targetUserId);

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

  // ── Derived lists (memoized — no extra queries) ─────────────────────────────
  const sortedPosts = useMemo(() => {
    const pinned = posts.filter((p) => p.pinned);
    if (pinned.length === 0) return posts;
    return [...pinned, ...posts.filter((p) => !p.pinned)];
  }, [posts]);

  const highlightPosts = useMemo(
    () => sortedPosts.filter((p) => isVideoMedia(p.mediaUrl, p.mediaType)),
    [sortedPosts]
  );

  const hasTrendingPost = useMemo(
    () => posts.some((p) => p.likesCount >= TRENDING_LIKES_THRESHOLD),
    [posts]
  );

  const handleTabChange = useCallback(
    (tab: ProfileTab) => {
      scrollY.value = 0; // list remounts at top; keep the compact bar in sync
      setActiveTab(tab);
    },
    [scrollY]
  );

  const handleFollowToggle = useCallback(() => {
    if (!targetUserId || !currentUserId) return;
    if (isFollowing) unfollow(targetUserId);
    else follow(targetUserId);
  }, [targetUserId, currentUserId, isFollowing, follow, unfollow]);

  function handleFollow(targetId: string, isCurrentlyFollowing: boolean) {
    if (!currentUserId) return;
    if (isCurrentlyFollowing) unfollow(targetId);
    else follow(targetId);
  }

  function handleBattle(post: Post) {
    if (!currentUserId) return;
    setChallengeTargetPost(post);
  }

  // Header CHALLENGE — target the athlete's most recent highlight.
  const handleHeaderChallenge = useCallback(() => {
    if (!currentUserId) return;
    const target = sortedPosts[0];
    if (!target) {
      Alert.alert(
        "No highlights yet",
        "This athlete hasn't posted a highlight to challenge."
      );
      return;
    }
    setChallengeTargetPost(target);
  }, [currentUserId, sortedPosts]);

  const handleMessage = useCallback(() => {
    if (Platform.OS === "web") {
      if (typeof window !== "undefined") window.alert("Messaging is coming soon.");
      return;
    }
    Alert.alert("Messaging", "Messaging is coming soon.");
  }, []);

  function goBack() {
    if (router.canGoBack()) router.back();
    else router.navigate("/(tabs)" as never);
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
        <View style={styles.fallbackTopBar}>
          <IconButton
            icon="chevron-left"
            accessibilityLabel="Go back"
            onPress={goBack}
            color={COLORS.textPrimary}
          />
        </View>
        <EmptyState
          icon="👤"
          title="Athlete not found"
          subtitle="This profile doesn't exist or has been removed."
        />
      </SafeAreaView>
    );
  }

  const isGridTab = activeTab === "posts" || activeTab === "highlights";
  const listData: (Post | Battle)[] =
    activeTab === "posts"
      ? sortedPosts
      : activeTab === "highlights"
      ? highlightPosts
      : activeTab === "battles"
      ? profileBattles
      : [];

  return (
    <SafeAreaView style={styles.safe} edges={["top"]}>
      <Animated.FlatList
        key={activeTab}
        data={listData}
        keyExtractor={(item: Post | Battle) => item.id}
        numColumns={isGridTab ? 3 : 1}
        columnWrapperStyle={isGridTab ? { gap: SPACING.sm } : undefined}
        contentContainerStyle={styles.grid}
        initialNumToRender={isGridTab ? 15 : 8}
        windowSize={9}
        onScroll={scrollHandler}
        scrollEventThrottle={16}
        renderItem={({ item }: { item: Post | Battle }) =>
          isGridTab ? (
            <PostGridThumb
              post={item as Post}
              onPress={() => setSelectedPost(item as Post)}
              context="PlayerProfileGrid"
            />
          ) : (
            <BattleHistoryCard
              battle={item as Battle}
              userId={targetUserId}
              currentUserId={currentUserId}
              context="PlayerProfileBattleHistory"
            />
          )
        }
        ListHeaderComponent={
          <View style={styles.headerWrap}>
            <ProfileHeader
              profile={profile}
              postsCount={posts.length}
              battlesCount={profileBattles.length}
              isOwn={false}
              hasTrendingPost={hasTrendingPost}
              isFollowing={isFollowing}
              onFollow={handleFollowToggle}
              onChallenge={handleHeaderChallenge}
              onMessage={handleMessage}
              scrollY={scrollY}
            />
            <ProfileTabs
              tabs={PROFILE_TABS}
              activeKey={activeTab}
              onChange={handleTabChange}
            />
          </View>
        }
        ListEmptyComponent={
          isGridTab && postsLoading ? (
            <ProfileGridSkeleton />
          ) : activeTab === "battles" && battlesLoading ? (
            <LoadingSpinner label="Loading battles…" />
          ) : activeTab === "battles" ? (
            <EmptyState
              icon="⚔️"
              title="No battle history"
              subtitle={`Challenge ${profile.username} to start one.`}
              actionLabel={`Challenge ${profile.username}`}
              onAction={handleHeaderChallenge}
            />
          ) : activeTab === "saved" ? (
            <EmptyState
              icon="🔖"
              title="No saved posts"
              subtitle="Saved posts will show up here."
            />
          ) : activeTab === "highlights" ? (
            <EmptyState
              icon="🎬"
              title="No video highlights yet"
              subtitle="This athlete hasn't posted any videos."
            />
          ) : (
            <EmptyState
              icon="📷"
              title="No highlights yet"
              subtitle="This athlete hasn't posted any highlights."
            />
          )
        }
        showsVerticalScrollIndicator={false}
      />

      {/* Collapsing compact bar — name fades in as the header scrolls away */}
      <ProfileCompactBar
        username={profile.username}
        avatarUri={profile.avatarUrl || profile.avatar}
        verified={profile.verified}
        scrollY={scrollY}
        left={
          <IconButton
            icon="chevron-left"
            accessibilityLabel="Go back"
            onPress={goBack}
            color={COLORS.textPrimary}
          />
        }
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

// ─── Styles (layout-only — identity/badge/stat styles live in ProfileHeader) ──
const styles = StyleSheet.create({
  safe: { flex: 1, backgroundColor: COLORS.background },

  // Fallback bar for the not-found state (compact bar needs a profile).
  fallbackTopBar: {
    flexDirection: "row",
    alignItems: "center",
    paddingHorizontal: SPACING.md,
    minHeight: COMPACT_BAR_HEIGHT,
  },

  // Header + tabs render full-bleed inside the padded grid container.
  headerWrap: {
    marginHorizontal: -SPACING.lg,
    marginBottom: SPACING.sm,
  },

  // ── Grid ─────────────────────────────────────────────────────────────────
  // paddingHorizontal must stay SPACING.lg — PostGridThumb's CELL math and
  // ProfileGridSkeleton both assume it.
  grid: {
    paddingTop: COMPACT_BAR_HEIGHT,
    paddingHorizontal: SPACING.lg,
    paddingBottom: SPACING.xxxl,
    gap: SPACING.sm,
  },
});
