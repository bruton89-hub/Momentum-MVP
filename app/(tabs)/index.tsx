import React, { useEffect, useRef, useState, useCallback, useMemo } from "react";
import {
  View,
  Text,
  FlatList,
  StyleSheet,
  Pressable,
  RefreshControl,
  Modal,
  ViewToken,
  LayoutChangeEvent,
} from "react-native";
import { showAlert, confirm } from "@/utils/alert";
import AsyncStorage from "@react-native-async-storage/async-storage";
import { useSafeAreaInsets } from "react-native-safe-area-context";
import { LinearGradient } from "expo-linear-gradient";
import { useFocusEffect, useIsFocused } from "@react-navigation/native";
import { useRouter } from "expo-router";
import { useAuthStore } from "@/store/authStore";
import { usePosts, useFollowingPosts } from "@/hooks/usePosts";
import { useFollows } from "@/hooks/useFollows";
import { createBattle, useBattles, getBattleStatus } from "@/hooks/useBattles";
import { useUnreadNotificationCount } from "@/hooks/useNotifications";
import { timestampToMs } from "@/services/postRepository";
import { COLORS, SPACING, FONTS, SCRIMS } from "@/constants/theme";
import PostCard from "@/components/PostCard";
import BattlePickerModal from "@/components/BattlePickerModal";
import CommentsSheet from "@/components/CommentsSheet";
import EmptyState from "@/components/EmptyState";
import FeedSkeleton from "@/components/FeedSkeleton";
import GlowButton from "@/components/GlowButton";
import IconButton from "@/components/IconButton";
import DiscoveryTabs, { DiscoveryTabDef } from "@/components/DiscoveryTabs";
import { isVideoMedia } from "@/utils/media";
import type { Post } from "@/types";
import { isPostDeleted } from "@/services/postDeletion";

// ─── Discovery tabs ─────────────────────────────────────────────────────────────
// "forYou" / "following" keep their original feeds. "battles" filters the
// discovery pool to challenge-enabled posts. Sport tabs filter by post.sport.
type FeedTab =
  | "forYou"
  | "following"
  | "battles"
  | "Football"
  | "Basketball"
  | "Wrestling"
  | "Soccer"
  | "Baseball";

const DISCOVERY_TABS: readonly DiscoveryTabDef<FeedTab>[] = [
  { key: "forYou", label: "For You", emoji: "🔥" },
  { key: "following", label: "Following", emoji: "👥" },
  { key: "battles", label: "Battles", emoji: "⚔️" },
  { key: "Football", label: "Football", emoji: "🏈" },
  { key: "Basketball", label: "Basketball", emoji: "🏀" },
  { key: "Wrestling", label: "Wrestling", emoji: "🤼" },
  { key: "Soccer", label: "Soccer", emoji: "⚽" },
  { key: "Baseball", label: "Baseball", emoji: "⚾" },
];

const SPORT_TABS = new Set<FeedTab>([
  "Football",
  "Basketball",
  "Wrestling",
  "Soccer",
  "Baseball",
]);

// Module-level so FlatList receives the same function identity every render.
const keyExtractor = (item: Post) => item.id;

export default function HomeScreen() {
  const router = useRouter();
  const insets = useSafeAreaInsets();
  const isFocused = useIsFocused();
  const userId  = useAuthStore((s) => s.userId);
  const profile = useAuthStore((s) => s.profile);
  const [feedTab, setFeedTab] = useState<FeedTab>("forYou");
  // Active card (any media type) — gates ambient card animations (Challenge
  // pulse, badge entrances). Distinct from activeVideoPostId, which only
  // tracks playable videos for the single-mounted-player strategy.
  const [activeCardId, setActiveCardId] = useState<string | null>(null);
  const [activeVideoPostId, setActiveVideoPostId] = useState<string | null>(null);
  const [preparedVideoPostIds, setPreparedVideoPostIds] = useState<Set<string>>(
    new Set()
  );
  const [showWelcome, setShowWelcome] = useState(false);
  // Full-screen page height — measured from the list container so each card
  // exactly fills the space between the top of the screen and the tab bar.
  const [pageHeight, setPageHeight] = useState(0);
  const viewabilityConfig = useRef({
    viewAreaCoveragePercentThreshold: 65,
  }).current;

  const handleListLayout = useCallback(
    (event: LayoutChangeEvent) => {
      const h = Math.round(event.nativeEvent.layout.height);
      setPageHeight((prev) => (prev === h ? prev : h));
    },
    []
  );

  // ── Follows state ─────────────────────────────────────────────────────────────
  const {
    followedIds,
    loading: followsLoading,
    follow,
    unfollow,
    refresh: refreshFollows,
  } = useFollows(userId);

  // ── For You feed ─────────────────────────────────────────────────────────────
  const {
    posts: fyPosts,
    likedIds,
    loading:    fyLoading,
    refreshing: fyRefreshing,
    error:      fyError,
    refresh:    fyRefresh,
    refreshIfStale: fyRefreshIfStale,
    loadMore:   fyLoadMore,
    hasMore:    fyHasMore,
    handleLike,
    // The viewer's profile drives the relevance term (same sport / school /
    // state). Ranking degrades to recency + engagement while it hydrates.
  } = usePosts(userId, followedIds, profile);

  // ── Following feed ────────────────────────────────────────────────────────────
  const {
    posts:      followingPosts,
    loading:    followingLoading,
    refreshing: followingRefreshing,
    refresh:    followingRefresh,
    refreshIfStale: followingRefreshIfStale,
  } = useFollowingPosts(userId, followedIds, followsLoading);

  // ── Battles discovery source ──────────────────────────────────────────────────
  // The Battles tab surfaces posts participating in REAL battles (live → open →
  // recently completed) from the same battles query/cache the main Battles page
  // uses — not merely posts flagged battleEnabled. The query is deferred until
  // the tab is first opened, then stays warm for the session.
  const [battlesEnabled, setBattlesEnabled] = useState(false);
  useEffect(() => {
    if (feedTab === "battles") setBattlesEnabled(true);
  }, [feedTab]);
  const {
    battles,
    loading:    battlesLoading,
    refreshing: battlesRefreshing,
    refresh:    battlesRefresh,
    manualRefresh: battlesManualRefresh,
  } = useBattles(userId, false, battlesEnabled);

  // ── Notifications badge — one aggregate count read, refreshed on focus ───────
  const { count: unreadNotifications, refresh: refreshUnread } =
    useUnreadNotificationCount(userId);
  const openNotifications = useCallback(
    () => router.push("/notifications" as never),
    [router]
  );

  // ── Comment thread ────────────────────────────────────────────────────────
  // Held as screen state rather than per-card state so only one sheet can be
  // mounted at a time, and so a card scrolling out of the window can't take
  // an open thread with it.
  const [commentsPost, setCommentsPost] = useState<Post | null>(null);
  const openComments = useCallback((post: Post) => setCommentsPost(post), []);
  const closeComments = useCallback(() => setCommentsPost(null), []);

  // ── Refresh on tab focus (Expo Router tabs don't remount) ────────────────────
  // All callbacks stored in refs so useFocusEffect only depends on the stable
  // `feedTab` string — prevents the setState→rerender→new fn→re-run loop.
  //
  // refreshFollows re-fetches the follows list from Firestore on every focus so
  // that follows made from the player profile screen are reflected immediately
  // when the user returns to Home. When followedIds changes, useFollowingPosts
  // automatically re-queries Firestore for the new set of followed users.
  // Focus uses the staleness-gated variants; pull-to-refresh keeps the
  // unconditional ones. Publishing marks the pool stale, so a new highlight
  // still appears immediately on return to Home.
  const fyRefreshRef = useRef(fyRefreshIfStale);
  fyRefreshRef.current = fyRefreshIfStale;
  const followingRefreshRef = useRef(followingRefreshIfStale);
  followingRefreshRef.current = followingRefreshIfStale;
  const battlesRefreshRef = useRef(battlesRefresh);
  battlesRefreshRef.current = battlesRefresh;
  const refreshUnreadRef = useRef(refreshUnread);
  refreshUnreadRef.current = refreshUnread;
  const refreshFollowsRef = useRef(refreshFollows);
  refreshFollowsRef.current = refreshFollows;
  const hasFocusedRef = useRef(false);

  useFocusEffect(
    useCallback(() => {
      if (!hasFocusedRef.current) {
        hasFocusedRef.current = true;
        return;
      }
      // Always re-fetch the follows list so Follow state is current after
      // navigating away (e.g. tapping Follow on the player profile screen).
      refreshFollowsRef.current();
      // Refresh whichever feed source backs the active tab.
      if (feedTab === "following") followingRefreshRef.current();
      else fyRefreshRef.current();
      if (feedTab === "battles") battlesRefreshRef.current();
      // Cheap aggregate read — keeps the bell badge honest after reading
      // notifications and returning to Home.
      void refreshUnreadRef.current();
    }, [feedTab]) // ← only feedTab; all callbacks accessed via refs
  );

  // ── Battles tab derivation ────────────────────────────────────────────────────
  // Posts participating in real battles, ordered by the CANONICAL status helper
  // (getBattleStatus — folds expiry into "completed", never compares raw status
  // strings): live → open → recently completed. Within each group the order is
  // battle recency (deterministic — stable across renders; pull-to-refresh may
  // reorder only because the data changed). Posts are resolved from the loaded
  // discovery pool when available (full caption/likes/sport); otherwise the
  // card is built from the battle's stored player fields — all real data.
  const battlePosts = useMemo(() => {
    if (battles.length === 0) return [];
    const STATUS_RANK: Record<string, number> = { live: 0, open: 1, completed: 2 };
    const poolById = new Map(fyPosts.map((p) => [p.id, p]));
    const entries = new Map<string, { post: Post; priority: number; createdMs: number }>();

    battles.forEach((battle) => {
      const status = getBattleStatus(battle);
      // Unmatched challenges that ran out the clock never became battles, so
      // their posts don't belong in the Battles tab.
      if (status === "expired") return;
      const priority = STATUS_RANK[status] ?? 3; // unknown → after completed, still rendered
      const createdMs = timestampToMs(battle.createdAt);
      [battle.playerA, battle.playerB].forEach((player) => {
        if (!player?.postId || !player.mediaUrl?.trim()) return;
        if (isPostDeleted(player.postId)) return;
        const isWinner = status === "completed" && !!battle.winner && battle.winner === player.userId;
        const resolved = poolById.get(player.postId);
        const post: Post = resolved
          ? isWinner && !resolved.battleWon
            ? { ...resolved, battleWon: true }
            : resolved
          : {
              id: player.postId,
              userId: player.userId,
              username: player.username,
              userAvatar: player.avatar,
              avatarUrl: player.avatar,
              mediaUrl: player.mediaUrl,
              mediaType: player.mediaType,
              caption: "",
              likesCount: 0,
              battleEnabled: status === "open",
              createdAt: battle.createdAt,
              battleWon: isWinner || undefined,
            };
        const existing = entries.get(player.postId);
        // Keep the highest-priority appearance (a post in a live battle must
        // never be pushed down by its completed history).
        if (!existing || priority < existing.priority) {
          entries.set(player.postId, { post, priority, createdMs });
        }
      });
    });

    return [...entries.values()]
      .sort((a, b) => a.priority - b.priority || b.createdMs - a.createdMs)
      .map((entry) => entry.post);
  }, [battles, fyPosts]);

  // Pull-to-refresh on the Battles tab refreshes both sources it renders from.
  const refreshBattlesTab = useCallback(() => {
    fyRefresh();
    battlesManualRefresh();
  }, [fyRefresh, battlesManualRefresh]);

  // ── Active feed derivation ────────────────────────────────────────────────────
  // Sport tabs are client-side filters over the discovery pool — no extra
  // queries, no change to the caching strategy.
  const isFollowingTab = feedTab === "following";
  const isBattlesTab = feedTab === "battles";
  const activePosts = useMemo(() => {
    if (isFollowingTab) return followingPosts;
    if (isBattlesTab) return battlePosts;
    if (SPORT_TABS.has(feedTab)) {
      return fyPosts.filter(
        (p) => p.sport?.toLowerCase() === feedTab.toLowerCase()
      );
    }
    return fyPosts;
  }, [feedTab, fyPosts, followingPosts, battlePosts, isFollowingTab, isBattlesTab]);

  const activeLoading = isFollowingTab
    ? followingLoading
    : isBattlesTab
    ? battlesLoading && battlePosts.length === 0
    : fyLoading;
  const activeRefresh = isFollowingTab
    ? followingRefresh
    : isBattlesTab
    ? refreshBattlesTab
    : fyRefresh;
  const activeRefreshing = isFollowingTab
    ? followingRefreshing
    : isBattlesTab
    ? battlesRefreshing || fyRefreshing
    : fyRefreshing;
  const activeError = isFollowingTab ? null : isBattlesTab ? null : fyError;

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
      if (isCurrentlyFollowing) unfollow(targetUserId);
      else follow(targetUserId);
    },
    [follow, unfollow]
  );

  // ── Battle flow ───────────────────────────────────────────────────────────────
  // `startingBattlePostId` tracks which postId is mid-creation so the button
  // can show a loading state while the Firestore write is in-flight.
  const [startingBattlePostId, setStartingBattlePostId] = useState<string | null>(null);
  const startingBattleRef = useRef<string | null>(null);

  // `challengeTargetPost` is set when the user taps "Challenge" on someone
  // else's post — it drives the BattlePickerModal.
  const [challengeTargetPost, setChallengeTargetPost] = useState<Post | null>(null);

  const handleBattle = useCallback(
    async (post: Post) => {
      if (!userId || !profile) {
        console.warn("[Home] handleBattle aborted — missing userId or profile");
        return;
      }

      if (post.userId === userId) {
        if (startingBattleRef.current) return;
        // ── Own post: "Start Battle" — create open challenge immediately ─────
        startingBattleRef.current = post.id;
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
          showAlert("Challenge open", "Your post is now open for challenges.");
        } catch (err) {
          console.error("Start battle failed", err);
          showAlert("Failed", "Could not create battle. Please try again.");
        } finally {
          startingBattleRef.current = null;
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
      // Active card = first viewable item of any media type. setState with an
      // unchanged value is a no-op in React, so this doesn't add re-renders
      // beyond the existing per-page-change cadence.
      const firstViewable = viewableItems.find(({ isViewable }) => isViewable);
      setActiveCardId(firstViewable?.item.id ?? null);

      const activeVideo = viewableItems.find(
        ({ item, isViewable }) =>
          isViewable &&
          isVideoMedia(item.mediaUrl, item.mediaType) &&
          !!item.mediaUrl?.trim()
      );
      setActiveVideoPostId(activeVideo?.item.id ?? null);
      const activeIndex = activeVideo?.index ?? -1;
      const prepared = new Set<string>();
      if (activeVideo?.item.id) prepared.add(activeVideo.item.id);
      const nextPost = activeIndex >= 0 ? activePostsRef.current[activeIndex + 1] : null;
      if (
        nextPost &&
        isVideoMedia(nextPost.mediaUrl, nextPost.mediaType) &&
        nextPost.mediaUrl?.trim()
      ) {
        prepared.add(nextPost.id);
      }
      // PERF: viewability fires on every scroll tick; bail out when the
      // prepared set is unchanged so HomeScreen doesn't re-render per tick
      // (a new Set identity would otherwise force it even with equal contents).
      setPreparedVideoPostIds((prev) => {
        if (
          prev.size === prepared.size &&
          [...prepared].every((id) => prev.has(id))
        ) {
          return prev;
        }
        return prepared;
      });
    }
  ).current;
  const activePostsRef = useRef(activePosts);
  activePostsRef.current = activePosts;

  useEffect(() => {
    setActiveCardId(null);
    setActiveVideoPostId(null);
    setPreparedVideoPostIds(new Set());
  }, [feedTab]);

  // PERF: stable renderItem — an inline arrow got a fresh identity on every
  // HomeScreen render, forcing VirtualizedList to re-render its cell wrappers
  // even when PostCard's memo would have bailed. Recreates only when a prop
  // that genuinely feeds the cards changes.
  const authorAvatar = profile?.avatarUrl || profile?.avatar;
  const renderItem = useCallback(
    ({ item }: { item: Post }) => (
      <PostCard
        post={item}
        height={pageHeight}
        isLiked={likedIds.has(item.id)}
        onLike={handleLike}
        // Without this the rail's Comment button fell through to PostCard's
        // "Comments coming soon" placeholder — on a feature that is fully
        // built and already reachable from the post detail modal.
        onComment={openComments}
        currentUserId={userId}
        isFollowing={followedIds.has(item.userId)}
        onFollow={handleFollow}
        onBattle={handleBattle}
        isBattling={startingBattlePostId === item.id}
        authorAvatarOverride={item.userId === userId ? authorAvatar : undefined}
        enableVideoPlayback
        isActiveVideo={isFocused && activeVideoPostId === item.id}
        isActiveCard={isFocused && activeCardId === item.id}
        mountVideoPlayer={preparedVideoPostIds.has(item.id)}
      />
    ),
    [
      pageHeight,
      likedIds,
      handleLike,
      openComments,
      userId,
      followedIds,
      handleFollow,
      handleBattle,
      startingBattlePostId,
      authorAvatar,
      isFocused,
      activeVideoPostId,
      activeCardId,
      preparedVideoPostIds,
    ]
  );

  // Full-screen pages: fixed layout lets the virtualizer compute offsets
  // without measuring — required for smooth paging with windowSize kept small.
  const getItemLayout = useCallback(
    (_data: ArrayLike<Post> | null | undefined, index: number) => ({
      length: pageHeight,
      offset: pageHeight * index,
      index,
    }),
    [pageHeight]
  );

  // ── Empty state per tab — encouraging, sports-first, with a CTA ──────────────
  const emptyState = useMemo(() => {
    if (isFollowingTab) {
      return (
        <EmptyState
          icon="👥"
          title="Your locker room is empty"
          subtitle="Follow athletes to build your feed."
          actionLabel="Discover athletes"
          onAction={() => setFeedTab("forYou")}
        />
      );
    }
    if (feedTab === "battles") {
      return (
        <EmptyState
          icon="⚔️"
          title="No battles to show yet"
          subtitle="Start a challenge from any athlete highlight."
          actionLabel="Browse highlights"
          onAction={() => setFeedTab("forYou")}
        />
      );
    }
    if (SPORT_TABS.has(feedTab)) {
      const tab = DISCOVERY_TABS.find((t) => t.key === feedTab);
      return (
        <EmptyState
          icon={tab?.emoji ?? "🏟️"}
          title={`Be the first ${tab?.label ?? ""} athlete in your area`}
          subtitle="Post a highlight and own this feed."
          actionLabel="Upload your highlight"
          onAction={() => router.push("/create" as never)}
        />
      );
    }
    return (
      <EmptyState
        icon="🎬"
        title="Upload your first highlight"
        subtitle="Every legend starts with clip one."
        actionLabel="Create your first highlight"
        onAction={() => router.push("/create" as never)}
      />
    );
  }, [feedTab, isFollowingTab, router]);

  const headerHeight = insets.top + 84;

  // ── Error (For You only) ──────────────────────────────────────────────────────
  if (activeError && activePosts.length === 0 && !activeLoading) {
    return (
      <View style={styles.safe}>
        <View style={{ paddingTop: headerHeight, flex: 1 }}>
          <EmptyState
            icon="⚠️"
            title="Something went wrong"
            subtitle={activeError}
            actionLabel="Retry"
            onAction={activeRefresh}
          />
        </View>
        <FeedHeader
          feedTab={feedTab}
          onTabChange={setFeedTab}
          topInset={insets.top}
          unreadCount={unreadNotifications}
          onOpenNotifications={openNotifications}
        />
      </View>
    );
  }

  return (
    <View style={styles.safe}>
      <View style={styles.listContainer} onLayout={handleListLayout}>
        {pageHeight > 0 ? (
          <FlatList<Post>
            data={activePosts}
            keyExtractor={keyExtractor}
            renderItem={renderItem}
            pagingEnabled
            getItemLayout={getItemLayout}
            onViewableItemsChanged={handleViewableItemsChanged}
            viewabilityConfig={viewabilityConfig}
            onEndReached={
              // Battles tab isn't backed by the discovery pagination window;
              // following has its own single-page query.
              !isFollowingTab && !isBattlesTab && fyHasMore ? fyLoadMore : undefined
            }
            onEndReachedThreshold={0.6}
            initialNumToRender={2}
            maxToRenderPerBatch={3}
            updateCellsBatchingPeriod={50}
            windowSize={5}
            refreshControl={
              <RefreshControl
                refreshing={activeRefreshing}
                onRefresh={activeRefresh}
                tintColor={COLORS.accent}
                colors={[COLORS.accent]}
                progressViewOffset={headerHeight}
              />
            }
            ListEmptyComponent={
              activeLoading ? <FeedSkeleton height={pageHeight} /> : emptyState
            }
            showsVerticalScrollIndicator={false}
            contentContainerStyle={
              activePosts.length === 0
                ? { flex: 1, paddingTop: activeLoading ? 0 : headerHeight }
                : undefined
            }
          />
        ) : (
          <FeedSkeleton />
        )}
      </View>

      {/* Overlay header — logo + horizontally scrolling discovery pills */}
      <FeedHeader
        feedTab={feedTab}
        onTabChange={setFeedTab}
        topInset={insets.top}
        unreadCount={unreadNotifications}
        onOpenNotifications={openNotifications}
      />

      {activeError && activePosts.length > 0 ? (
        <View style={styles.refreshError}>
          <Text style={styles.refreshErrorText}>
            Couldn’t refresh. Showing saved highlights.
          </Text>
        </View>
      ) : null}

      {/* Comment thread — mounts only when a post's Comment button is tapped */}
      <CommentsSheet
        visible={!!commentsPost}
        post={commentsPost}
        currentUserId={userId}
        onClose={closeComments}
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
            <Pressable
              onPress={dismissWelcome}
              accessibilityRole="button"
              accessibilityLabel="Skip welcome"
              style={({ pressed }) => [styles.skipWelcome, pressed && { opacity: 0.7 }]}
            >
              <Text style={styles.skipWelcomeText}>Skip</Text>
            </Pressable>
          </View>
        </View>
      </Modal>
    </View>
  );
}

// ─── Feed header (overlay — floats over the full-screen video) ─────────────────
function FeedHeader({
  feedTab,
  onTabChange,
  topInset,
  unreadCount,
  onOpenNotifications,
}: {
  feedTab: FeedTab;
  onTabChange: (tab: FeedTab) => void;
  topInset: number;
  unreadCount: number;
  onOpenNotifications: () => void;
}) {
  return (
    <View style={styles.headerOverlay} pointerEvents="box-none">
      <LinearGradient
        colors={SCRIMS.top}
        style={StyleSheet.absoluteFillObject}
        pointerEvents="none"
      />
      <View style={{ paddingTop: topInset + 2 }} pointerEvents="box-none">
        {/* Compact brand row */}
        <View style={styles.logoRow} pointerEvents="box-none">
          <View style={styles.logoLockup} accessible accessibilityRole="header" accessibilityLabel="Momentum">
            <View style={styles.logoMBadge}>
              <Text style={styles.logoMLetter}>M</Text>
            </View>
            <Text style={styles.logoText}>MOMENTUM</Text>
          </View>
          <View>
            <IconButton
              icon="bell"
              accessibilityLabel={
                unreadCount > 0
                  ? `Notifications, ${unreadCount} unread`
                  : "Notifications"
              }
              onPress={onOpenNotifications}
            />
            {unreadCount > 0 && (
              <View style={styles.bellBadge} pointerEvents="none">
                <Text style={styles.bellBadgeText}>
                  {unreadCount > 9 ? "9+" : unreadCount}
                </Text>
              </View>
            )}
          </View>
        </View>

        {/* Horizontally scrolling discovery tabs */}
        <DiscoveryTabs
          tabs={DISCOVERY_TABS}
          activeKey={feedTab}
          onChange={onTabChange}
        />
      </View>
    </View>
  );
}

const styles = StyleSheet.create({
  safe: { flex: 1, backgroundColor: COLORS.black },
  listContainer: { flex: 1 },
  headerOverlay: {
    position: "absolute",
    top: 0,
    left: 0,
    right: 0,
    paddingBottom: SPACING.sm,
    zIndex: 10,
  },
  refreshError: {
    position: "absolute",
    left: SPACING.lg,
    right: SPACING.lg,
    bottom: SPACING.md,
    borderRadius: 10,
    borderWidth: 1,
    borderColor: COLORS.cardBorder,
    backgroundColor: COLORS.card,
    padding: SPACING.sm,
  },
  refreshErrorText: {
    color: COLORS.textSecondary,
    fontSize: 12,
    textAlign: "center",
  },
  logoRow: {
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "space-between",
    paddingHorizontal: SPACING.lg,
    marginBottom: SPACING.xs,
    minHeight: 36,
  },
  logoLockup: {
    flexDirection: "row",
    alignItems: "center",
    gap: SPACING.sm,
  },
  bellBadge: {
    position: "absolute",
    top: -3,
    right: -3,
    minWidth: 16,
    height: 16,
    borderRadius: 8,
    paddingHorizontal: 3,
    backgroundColor: COLORS.accent,
    borderWidth: 1.5,
    borderColor: COLORS.black,
    alignItems: "center",
    justifyContent: "center",
  },
  bellBadgeText: {
    color: COLORS.black,
    fontSize: 9,
    fontWeight: FONTS.heavy,
    includeFontPadding: false,
  },
  logoMBadge: {
    // Matches brand guide M badge: lime rounded square
    width: 26,
    height: 26,
    borderRadius: 6,
    backgroundColor: COLORS.accent,
    alignItems: "center",
    justifyContent: "center",
  },
  logoMLetter: {
    color: COLORS.black,
    fontSize: 16,
    fontWeight: FONTS.heavy,
    // No italic — the brand guide M is upright and ultra-bold
    includeFontPadding: false,
    lineHeight: 18,
  },
  logoText: {
    color: COLORS.textPrimary,
    fontSize: 16,
    fontWeight: FONTS.heavy,
    letterSpacing: 2,
    includeFontPadding: false,
    textShadowColor: "rgba(0,0,0,0.5)",
    textShadowOffset: { width: 0, height: 1 },
    textShadowRadius: 3,
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
