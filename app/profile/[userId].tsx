import React, { useCallback, useMemo, useState } from "react";
import { View, StyleSheet, Alert, Platform, FlatList } from "react-native";
import { useLocalSearchParams, useRouter, Redirect } from "expo-router";
import { SafeAreaView, useSafeAreaInsets } from "react-native-safe-area-context";
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
const profileItemKey = (item: Post | Battle) => item.id;

// ─── Player Profile Screen ────────────────────────────────────────────────────
export default function PlayerProfileScreen() {
  const { userId: routeUserId } = useLocalSearchParams<{ userId: string }>();
  const router = useRouter();
  const insets = useSafeAreaInsets();
  const currentUserId = useAuthStore((s) => s.userId);
  const currentProfile = useAuthStore((s) => s.profile);
  const authLoading = useAuthStore((s) => s.isLoading);

  // If viewing own profile, show own data (edit still available)
  const targetUserId = routeUserId ?? null;
  const isSelf = !!targetUserId && targetUserId === currentUserId;
  const queryUserId = authLoading || isSelf ? null : targetUserId;

  const { profile, loading: profileLoading, error: profileError } = useProfile(queryUserId);
  const { posts, loading: postsLoading } = useUserPosts(queryUserId);
  // includeVotes=false: this screen only renders battle history rows and never
  // shows or casts votes, so skip the votedMap lookups (3 Firestore `in`
  // queries per visit). The battles list itself is user-independent.
  const { battles, loading: battlesLoading } = useBattles(
    currentUserId,
    false,
    !authLoading && !isSelf
  );
  const { followedIds, follow, unfollow } = useFollows(
    authLoading || isSelf ? null : currentUserId
  );

  const [activeTab, setActiveTab] = useState<ProfileTab>("posts");
  const [selectedPost, setSelectedPost] = useState<Post | null>(null);
  const [challengeTargetPost, setChallengeTargetPost] = useState<Post | null>(null);
  const listRef = React.useRef<FlatList<Post | Battle>>(null);

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
      scrollY.value = 0;
      setActiveTab(tab);
    },
    [scrollY]
  );

  React.useEffect(() => {
    listRef.current?.scrollToOffset({ offset: 0, animated: false });
  }, [activeTab]);

  const handleFollowToggle = useCallback(() => {
    if (!targetUserId || !currentUserId) return;
    if (isFollowing) unfollow(targetUserId);
    else follow(targetUserId);
  }, [targetUserId, currentUserId, isFollowing, follow, unfollow]);

  const handleFollow = useCallback((targetId: string, isCurrentlyFollowing: boolean) => {
    if (!currentUserId) return;
    if (isCurrentlyFollowing) unfollow(targetId);
    else follow(targetId);
  }, [currentUserId, follow, unfollow]);

  const handleBattle = useCallback((post: Post) => {
    if (!currentUserId) return;
    setChallengeTargetPost(post);
  }, [currentUserId]);

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

  const goBack = useCallback(() => {
    if (router.canGoBack()) router.back();
    else router.navigate("/(tabs)" as never);
  }, [router]);

  const isGridTab = activeTab === "posts" || activeTab === "highlights";
  const listData = useMemo<(Post | Battle)[]>(
    () =>
      activeTab === "posts"
        ? sortedPosts
        : activeTab === "highlights"
        ? highlightPosts
        : activeTab === "battles"
        ? profileBattles
        : [],
    [activeTab, highlightPosts, profileBattles, sortedPosts]
  );
  const listContentStyle = useMemo(
    () => [styles.grid, { paddingBottom: SPACING.xxxl + insets.bottom }],
    [insets.bottom]
  );
  const renderProfileItem = useCallback(
    ({ item }: { item: Post | Battle }) =>
      isGridTab ? (
        <PostGridThumb
          post={item as Post}
          onPress={setSelectedPost}
          context="PlayerProfileGrid"
        />
      ) : (
        <BattleHistoryCard
          battle={item as Battle}
          userId={targetUserId ?? ""}
          currentUserId={currentUserId}
          context="PlayerProfileBattleHistory"
        />
      ),
    [currentUserId, isGridTab, targetUserId]
  );

  // ── Redirect own profile to the tab so the tab bar is visible and there
  //    is no back button. Must come after all hook calls (Rules of Hooks).
  if (isSelf) {
    return <Redirect href={"/(tabs)/profile" as never} />;
  }

  if (authLoading) {
    return (
      <SafeAreaView style={styles.safe} edges={["top"]}>
        <LoadingSpinner fullscreen />
      </SafeAreaView>
    );
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

  return (
    <SafeAreaView style={styles.safe} edges={["top"]}>
      <Animated.FlatList
        ref={listRef}
        key={isGridTab ? "profile-grid" : "profile-list"}
        data={listData}
        keyExtractor={profileItemKey}
        numColumns={isGridTab ? 3 : 1}
        columnWrapperStyle={isGridTab ? styles.gridColumns : undefined}
        // SAFE AREA: stack screen with no tab bar — the last row/card must
        // clear the home indicator.
        contentContainerStyle={listContentStyle}
        initialNumToRender={isGridTab ? 9 : 6}
        maxToRenderPerBatch={isGridTab ? 9 : 6}
        updateCellsBatchingPeriod={50}
        windowSize={7}
        onScroll={scrollHandler}
        scrollEventThrottle={16}
        renderItem={renderProfileItem}
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
    // paddingBottom applied inline — safe-area dependent.
    gap: SPACING.sm,
  },
  gridColumns: { gap: SPACING.sm },
});
