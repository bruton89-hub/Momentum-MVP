import React, { useEffect, useRef, useState, useCallback } from "react";
import {
  View,
  Text,
  FlatList,
  StyleSheet,
  Pressable,
  RefreshControl,
  Alert,
  Modal,
  ViewToken,
} from "react-native";
import AsyncStorage from "@react-native-async-storage/async-storage";
import { SafeAreaView } from "react-native-safe-area-context";
import { useFocusEffect, useIsFocused } from "@react-navigation/native";
import { useRouter } from "expo-router";
import { useAuthStore } from "@/store/authStore";
import { usePosts, useFollowingPosts } from "@/hooks/usePosts";
import { useFollows } from "@/hooks/useFollows";
import { createBattle } from "@/hooks/useBattles";
import { COLORS, SPACING, FONTS } from "@/constants/theme";
import PostCard from "@/components/PostCard";
import BattlePickerModal from "@/components/BattlePickerModal";
import EmptyState from "@/components/EmptyState";
import GlowButton from "@/components/GlowButton";
import LoadingSpinner from "@/components/LoadingSpinner";
import { isVideoMedia } from "@/utils/media";
import type { Post } from "@/types";

type FeedTab = "forYou" | "following";

export default function HomeScreen() {
  const router = useRouter();
  const isFocused = useIsFocused();
  const userId  = useAuthStore((s) => s.userId);
  const profile = useAuthStore((s) => s.profile);
  const [feedTab, setFeedTab] = useState<FeedTab>("forYou");
  const [activeVideoPostId, setActiveVideoPostId] = useState<string | null>(null);
  const [showWelcome, setShowWelcome] = useState(false);
  const viewabilityConfig = useRef({
    viewAreaCoveragePercentThreshold: 65,
  }).current;

  // ── For You feed ─────────────────────────────────────────────────────────────
  const {
    posts: fyPosts,
    likedIds,
    loading:    fyLoading,
    refreshing: fyRefreshing,
    error:      fyError,
    refresh:    fyRefresh,
    handleLike,
  } = usePosts(userId);

  // ── Follows state ─────────────────────────────────────────────────────────────
  const {
    followedIds,
    loading: followsLoading,
    follow,
    unfollow,
    refresh: refreshFollows,
  } = useFollows(userId);

  // ── Following feed ────────────────────────────────────────────────────────────
  const {
    posts:      followingPosts,
    loading:    followingLoading,
    refreshing: followingRefreshing,
    refresh:    followingRefresh,
  } = useFollowingPosts(userId, followedIds, followsLoading);

  // ── Refresh on tab focus (Expo Router tabs don't remount) ────────────────────
  // All callbacks stored in refs so useFocusEffect only depends on the stable
  // `feedTab` string — prevents the setState→rerender→new fn→re-run loop.
  //
  // refreshFollows re-fetches the follows list from Firestore on every focus so
  // that follows made from the player profile screen are reflected immediately
  // when the user returns to Home. When followedIds changes, useFollowingPosts
  // automatically re-queries Firestore for the new set of followed users.
  const fyRefreshRef = useRef(fyRefresh);
  fyRefreshRef.current = fyRefresh;
  const followingRefreshRef = useRef(followingRefresh);
  followingRefreshRef.current = followingRefresh;
  const refreshFollowsRef = useRef(refreshFollows);
  refreshFollowsRef.current = refreshFollows;

  useFocusEffect(
    useCallback(() => {
      __DEV__ && console.log("[Home] useFocusEffect fired — feedTab:", feedTab);
      // Always re-fetch the follows list so Follow state is current after
      // navigating away (e.g. tapping Follow on the player profile screen).
      refreshFollowsRef.current();
      // Refresh whichever feed tab is active.
      if (feedTab === "forYou") fyRefreshRef.current();
      else followingRefreshRef.current();
    }, [feedTab]) // ← only feedTab; all callbacks accessed via refs
  );

  // ── Active feed derivation ────────────────────────────────────────────────────
  const isForYou       = feedTab === "forYou";
  const activePosts    = isForYou ? fyPosts       : followingPosts;
  const activeLoading  = isForYou ? fyLoading      : followingLoading;
  const activeRefresh  = isForYou ? fyRefresh      : followingRefresh;
  const activeRefreshing = isForYou ? fyRefreshing : followingRefreshing;
  const activeError    = isForYou ? fyError        : null;

  useEffect(() => {
    __DEV__ && console.log("[Home] activePosts passed to FlatList:", activePosts.length, "feedTab:", feedTab);
  }, [activePosts, feedTab]);

  useEffect(() => {
    if (!userId) return;
    const key = `momentum:onboarding:${userId}`;
    AsyncStorage.getItem(key)
      .then((value) => {
        if (!value) setShowWelcome(true);
      })
      .catch(() => undefined);
  }, [userId]);

  const dismissWelcome = useCallback(async () => {
    if (userId) {
      await AsyncStorage.setItem(`momentum:onboarding:${userId}`, "seen").catch(() => undefined);
    }
    setShowWelcome(false);
  }, [userId]);

  const handleCreateFirstPost = useCallback(async () => {
    await dismissWelcome();
    router.push("/create" as never);
  }, [dismissWelcome, router]);

  // ── Follow / Unfollow ─────────────────────────────────────────────────────────
  const handleFollow = useCallback(
    (targetUserId: string, isCurrentlyFollowing: boolean) => {
      __DEV__ && console.log("[Home] handleFollow called — targetUserId:", targetUserId, "isCurrentlyFollowing:", isCurrentlyFollowing);
      if (isCurrentlyFollowing) unfollow(targetUserId);
      else follow(targetUserId);
    },
    [follow, unfollow]
  );

  // ── Battle flow ───────────────────────────────────────────────────────────────
  // `startingBattlePostId` tracks which postId is mid-creation so the button
  // can show a loading state while the Firestore write is in-flight.
  const [startingBattlePostId, setStartingBattlePostId] = useState<string | null>(null);

  // `challengeTargetPost` is set when the user taps "Challenge" on someone
  // else's post — it drives the BattlePickerModal.
  const [challengeTargetPost, setChallengeTargetPost] = useState<Post | null>(null);

  const handleBattle = useCallback(
    async (post: Post) => {
      __DEV__ && console.log("[Home] handleBattle called — postId:", post.id, "postUserId:", post.userId, "currentUserId:", userId);
      if (!userId || !profile) {
        console.warn("[Home] handleBattle aborted — missing userId or profile");
        return;
      }

      if (post.userId === userId) {
        // ── Own post: "Start Battle" — create open challenge immediately ─────
        setStartingBattlePostId(post.id);
        try {
          await createBattle({
            creatorId:     userId,
            playerA: {
              userId:    post.userId,
              username:  post.username,
              avatar:    post.userAvatar,
              mediaUrl:  post.mediaUrl,
              mediaType: post.mediaType,
              postId:    post.id,
            },
            category:      "Highlights",
            durationHours: 24,
          });
          Alert.alert("Challenge open", "Your post is now open for challenges.");
        } catch (err) {
          console.error("Start battle failed", err);
          Alert.alert("Failed", "Could not create battle. Please try again.");
        } finally {
          setStartingBattlePostId(null);
        }
      } else {
        // ── Other user's post: "Challenge" — open picker modal ────────────────
        setChallengeTargetPost(post);
      }
    },
    [userId, profile]
  );

  const handleViewableItemsChanged = useRef(
    ({ viewableItems }: { viewableItems: ViewToken[] }) => {
      const activeVideo = viewableItems.find(
        ({ item, isViewable }) =>
          isViewable &&
          isVideoMedia(item.mediaUrl, item.mediaType) &&
          !!item.mediaUrl?.trim()
      );
      setActiveVideoPostId(activeVideo?.item.id ?? null);
    }
  ).current;

  useEffect(() => {
    setActiveVideoPostId(null);
  }, [feedTab]);

  // ── Loading ───────────────────────────────────────────────────────────────────
  if (activeLoading) {
    return <LoadingSpinner fullscreen label="Loading feed…" />;
  }

  // ── Error (For You only) ──────────────────────────────────────────────────────
  if (activeError) {
    return (
      <SafeAreaView style={styles.safe} edges={["top"]}>
        <FeedHeader feedTab={feedTab} onTabChange={setFeedTab} />
        <EmptyState
          icon="⚠️"
          title="Something went wrong"
          subtitle={activeError}
          actionLabel="Retry"
          onAction={activeRefresh}
        />
      </SafeAreaView>
    );
  }

  return (
    <SafeAreaView style={styles.safe} edges={["top"]}>
      <FeedHeader feedTab={feedTab} onTabChange={setFeedTab} />

      <FlatList<Post>
        data={activePosts}
        keyExtractor={(item) => item.id}
        renderItem={({ item }) => (
          <PostCard
            post={item}
            isLiked={likedIds.has(item.id)}
            onLike={handleLike}
            currentUserId={userId}
            isFollowing={followedIds.has(item.userId)}
            onFollow={handleFollow}
            onBattle={handleBattle}
            isBattling={startingBattlePostId === item.id}
            enableVideoPlayback
            isActiveVideo={isFocused && activeVideoPostId === item.id}
          />
        )}
        onViewableItemsChanged={handleViewableItemsChanged}
        viewabilityConfig={viewabilityConfig}
        refreshControl={
          <RefreshControl
            refreshing={activeRefreshing}
            onRefresh={activeRefresh}
            tintColor={COLORS.accent}
            colors={[COLORS.accent]}
          />
        }
        ListEmptyComponent={
          isForYou ? (
            <EmptyState
              icon="🎬"
              title="No highlights yet. Be the first to post."
              subtitle=""
              actionLabel="Create your first highlight"
              onAction={() => router.push("/create" as never)}
            />
          ) : (
            <EmptyState
              icon="👥"
              title="Your feed is empty"
              subtitle="Follow athletes to build your feed."
            />
          )
        }
        showsVerticalScrollIndicator={false}
        contentContainerStyle={activePosts.length === 0 ? { flex: 1 } : undefined}
      />

      {/* Challenge picker modal — only mounts when a target post is set */}
      <BattlePickerModal
        visible={!!challengeTargetPost}
        targetPost={challengeTargetPost}
        currentUserId={userId ?? ""}
        currentProfile={profile}
        onClose={() => setChallengeTargetPost(null)}
        onBattleCreated={() => setChallengeTargetPost(null)}
      />

      <Modal visible={showWelcome} transparent animationType="fade" onRequestClose={dismissWelcome}>
        <View style={styles.welcomeOverlay}>
          <View style={styles.welcomeCard}>
            <Text style={styles.welcomeTitle}>Welcome to Momentum</Text>
            <Text style={styles.welcomeCopy}>Post highlights.{"\n"}Start battles.{"\n"}Build your name.</Text>
            <GlowButton label="Create First Post" onPress={handleCreateFirstPost} size="lg" />
            <Pressable onPress={dismissWelcome} style={styles.skipWelcome}>
              <Text style={styles.skipWelcomeText}>Skip</Text>
            </Pressable>
          </View>
        </View>
      </Modal>
    </SafeAreaView>
  );
}

// ─── Feed header (extracted so tab switches don't remount the list) ────────────
function FeedHeader({
  feedTab,
  onTabChange,
}: {
  feedTab: FeedTab;
  onTabChange: (tab: FeedTab) => void;
}) {
  return (
    <View style={styles.header}>
      {/* Logo row */}
      <View style={styles.logoRow}>
        <View style={styles.logoLockup}>
          <View style={styles.logoMBadge}>
            <Text style={styles.logoMLetter}>M</Text>
          </View>
          <Text style={styles.logoText}>MOMENTUM</Text>
        </View>
        <Pressable style={styles.bellBtn} hitSlop={{ top: 8, bottom: 8, left: 8, right: 8 }}>
          <Text style={styles.bellIcon}>🔔</Text>
        </Pressable>
      </View>

      {/* For You / Following tabs */}
      <View style={styles.tabs}>
        <Pressable
          onPress={() => onTabChange("forYou")}
          style={styles.tab}
        >
          <Text style={[styles.tabText, feedTab === "forYou" && styles.tabTextActive]}>
            For You
          </Text>
          <View style={[styles.tabUnderline, feedTab === "forYou" && styles.tabUnderlineActive]} />
        </Pressable>
        <Pressable
          onPress={() => onTabChange("following")}
          style={styles.tab}
        >
          <Text style={[styles.tabText, feedTab === "following" && styles.tabTextActive]}>
            Following
          </Text>
          <View style={[styles.tabUnderline, feedTab === "following" && styles.tabUnderlineActive]} />
        </Pressable>
      </View>
    </View>
  );
}

const styles = StyleSheet.create({
  safe: { flex: 1, backgroundColor: COLORS.background },
  header: {
    paddingTop: SPACING.sm,
    paddingBottom: 0,
    paddingHorizontal: SPACING.lg,
    backgroundColor: COLORS.background,
  },
  logoRow: {
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "space-between",
    marginBottom: SPACING.md,
  },
  logoLockup: {
    flexDirection: "row",
    alignItems: "center",
    gap: SPACING.sm,
  },
  logoMBadge: {
    // Matches brand guide M badge: lime rounded square
    width: 32,
    height: 32,
    borderRadius: 7,
    backgroundColor: COLORS.accent,
    alignItems: "center",
    justifyContent: "center",
  },
  logoMLetter: {
    color: COLORS.black,
    fontSize: 20,
    fontWeight: FONTS.heavy,
    // No italic — the brand guide M is upright and ultra-bold
    includeFontPadding: false,
    lineHeight: 22,
  },
  logoText: {
    color: COLORS.textPrimary,
    fontSize: 20,
    fontWeight: FONTS.heavy,
    letterSpacing: 2,
    includeFontPadding: false,
  },
  bellBtn: {
    width: 36,
    height: 36,
    borderRadius: 18,
    backgroundColor: COLORS.surface,
    borderWidth: 1,
    borderColor: COLORS.cardBorder,
    alignItems: "center",
    justifyContent: "center",
  },
  bellIcon: { fontSize: 16 },
  tabs: {
    flexDirection: "row",
    borderBottomWidth: 1,
    borderBottomColor: COLORS.cardBorder,
  },
  tab: {
    paddingHorizontal: SPACING.lg,
    alignItems: "center",
    paddingTop: SPACING.sm + 2,
    paddingBottom: 0,
  },
  tabText: {
    color: COLORS.textMuted,
    fontSize: 15,
    fontWeight: FONTS.semibold,
    letterSpacing: 0.3,
  },
  tabTextActive: {
    color: COLORS.textPrimary,
    fontWeight: FONTS.bold,
  },
  tabUnderline: {
    width: "100%",
    height: 3,
    borderRadius: 3,
    backgroundColor: COLORS.transparent,
    marginTop: SPACING.sm + 2,
  },
  tabUnderlineActive: {
    backgroundColor: COLORS.accent,
  },
  welcomeOverlay: {
    flex: 1,
    backgroundColor: COLORS.overlay,
    alignItems: "center",
    justifyContent: "center",
    padding: SPACING.xl,
  },
  welcomeCard: {
    width: "100%",
    backgroundColor: COLORS.card,
    borderRadius: 24,
    borderWidth: 1,
    borderColor: COLORS.cardBorder,
    padding: SPACING.xl,
    gap: SPACING.md,
  },
  welcomeTitle: {
    color: COLORS.textPrimary,
    fontSize: 24,
    fontWeight: FONTS.heavy,
    textAlign: "center",
  },
  welcomeCopy: {
    color: COLORS.textSecondary,
    fontSize: 17,
    lineHeight: 26,
    textAlign: "center",
    marginBottom: SPACING.sm,
  },
  skipWelcome: {
    alignItems: "center",
    paddingVertical: SPACING.sm,
  },
  skipWelcomeText: {
    color: COLORS.textMuted,
    fontSize: 14,
    fontWeight: FONTS.semibold,
  },
});
