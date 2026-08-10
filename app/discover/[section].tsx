import React, { useCallback, useMemo, useState } from "react";
import { View, Text, StyleSheet, FlatList, ActivityIndicator } from "react-native";
import { SafeAreaView, useSafeAreaInsets } from "react-native-safe-area-context";
import { useLocalSearchParams, useRouter } from "expo-router";
import { useAuthStore } from "@/store/authStore";
import { useFollows } from "@/hooks/useFollows";
import { useDiscover, SECTION_SUBTITLES, SECTION_TITLES } from "@/hooks/useDiscover";
import { COLORS, SPACING, FONTS, TYPE } from "@/constants/theme";
import AthleteRow from "@/components/AthleteRow";
import PostGridThumb from "@/components/PostGridThumb";
import PostDetailModal from "@/components/PostDetailModal";
import BattlePickerModal from "@/components/BattlePickerModal";
import IconButton from "@/components/IconButton";
import EmptyState from "@/components/EmptyState";
import LoadingSpinner from "@/components/LoadingSpinner";
import { openAthleteProfile } from "@/utils/navigation";
import type { DiscoverAthlete } from "@/services/discoverRepository";
import type { Post, UserProfile } from "@/types";

type ExpandableSection = "rising" | "radar" | "records" | "highlights";

const VALID: readonly ExpandableSection[] = [
  "rising",
  "radar",
  "records",
  "highlights",
];

const athleteKey = (item: DiscoverAthlete | UserProfile) =>
  "userId" in item ? item.userId : "";
const postKey = (item: Post) => item.id;

/**
 * Expanded "See All" view for a Discover rail.
 *
 * Reads the same cached pool the Discover screen built, so opening this screen
 * issues no additional Firestore reads inside the cache TTL. Athlete sections
 * render the existing AthleteRow (with its working Follow button); the
 * highlights section renders the existing PostGridThumb + PostDetailModal, so
 * like/comment/share stay in one implementation.
 */
export default function DiscoverSectionScreen() {
  const { section, sport } = useLocalSearchParams<{
    section: string;
    sport?: string;
  }>();
  const router = useRouter();
  const insets = useSafeAreaInsets();
  const userId = useAuthStore((s) => s.userId);
  const profile = useAuthStore((s) => s.profile);

  const [detailPost, setDetailPost] = useState<Post | null>(null);
  const [challengeTargetPost, setChallengeTargetPost] = useState<Post | null>(null);

  const sportFilter = sport?.trim() ? sport.trim() : null;
  const key = (VALID as readonly string[]).includes(section ?? "")
    ? (section as ExpandableSection)
    : null;

  const { followedIds, follow, unfollow } = useFollows(userId);
  // Battles aren't needed here — See All for battles goes to the Battles tab —
  // so an empty array is passed rather than mounting the battles hook.
  const { rising, underRadar, highlights, records, loading } = useDiscover(
    userId,
    [],
    sportFilter,
    // Only the Top Records rail needs its own `users` query.
    key === "records"
  );

  const goBack = useCallback(() => {
    if (router.canGoBack()) {
      router.back();
      return;
    }
    router.replace("/discover" as never);
  }, [router]);

  const openProfile = useCallback(
    (targetUserId: string) => openAthleteProfile(router, targetUserId, userId),
    [router, userId]
  );

  const toggleFollow = useCallback(
    (targetUserId: string, isCurrentlyFollowing: boolean) => {
      if (!userId) return;
      if (isCurrentlyFollowing) void unfollow(targetUserId);
      else void follow(targetUserId);
    },
    [follow, unfollow, userId]
  );

  const openPost = useCallback((post: Post) => setDetailPost(post), []);
  const closePost = useCallback(() => setDetailPost(null), []);
  const handleBattleFromPost = useCallback((post: Post) => {
    setDetailPost(null);
    setChallengeTargetPost(post);
  }, []);

  // Athlete rails share one row renderer. DiscoverAthlete and UserProfile are
  // adapted to the same shape AthleteRow already expects.
  const renderAthlete = useCallback(
    ({ item }: { item: DiscoverAthlete | UserProfile }) => {
      const asProfile: UserProfile =
        "wins" in item
          ? (item as UserProfile)
          : {
              userId: item.userId,
              username: item.username,
              avatar: item.avatarUrl,
              avatarUrl: item.avatarUrl,
              athleteType: item.sport ?? "Other",
              sport: item.sport,
              bio: "",
              posts: 0,
              wins: 0,
              losses: 0,
              createdAt: null,
              position: item.position,
              school: item.school,
            };
      return (
        <AthleteRow
          athlete={asProfile}
          onPress={openProfile}
          isFollowing={followedIds.has(asProfile.userId)}
          onToggleFollow={userId ? toggleFollow : undefined}
        />
      );
    },
    [followedIds, openProfile, toggleFollow, userId]
  );

  const renderHighlight = useCallback(
    ({ item }: { item: Post }) => (
      <PostGridThumb
        post={item}
        onPress={openPost}
        context="DiscoverSeeAll"
        currentUserId={userId}
        onDeleted={closePost}
      />
    ),
    [closePost, openPost, userId]
  );

  const data = useMemo(() => {
    switch (key) {
      case "rising":
        return rising;
      case "radar":
        return underRadar;
      case "records":
        return records;
      case "highlights":
        return highlights;
      default:
        return [];
    }
  }, [key, rising, underRadar, records, highlights]);

  if (!key) {
    return (
      <SafeAreaView style={styles.safe} edges={["top"]}>
        <View style={styles.topBar}>
          <IconButton
            icon="chevron-left"
            accessibilityLabel="Go back"
            onPress={goBack}
            color={COLORS.textPrimary}
          />
        </View>
        <EmptyState
          icon="🤷"
          title="Unknown section"
          subtitle="That Discover section doesn't exist."
        />
      </SafeAreaView>
    );
  }

  const isHighlights = key === "highlights";

  return (
    <SafeAreaView style={styles.safe} edges={["top"]}>
      <View style={styles.topBar}>
        <IconButton
          icon="chevron-left"
          accessibilityLabel="Go back"
          onPress={goBack}
          color={COLORS.textPrimary}
        />
        <View style={styles.topBarText}>
          <Text style={styles.topBarTitle} accessibilityRole="header" numberOfLines={1}>
            {SECTION_TITLES[key]}
          </Text>
          <Text style={styles.topBarSubtitle} numberOfLines={1}>
            {sportFilter ? `${sportFilter} · ` : ""}
            {SECTION_SUBTITLES[key]}
          </Text>
        </View>
        {/* Balances the back button so the title block stays centred. */}
        <View style={styles.topBarSpacer} pointerEvents="none" />
      </View>

      {loading && data.length === 0 ? (
        <LoadingSpinner />
      ) : isHighlights ? (
        <FlatList
          data={data as Post[]}
          key="highlights-grid"
          keyExtractor={postKey}
          numColumns={3}
          columnWrapperStyle={styles.gridColumns}
          renderItem={renderHighlight}
          contentContainerStyle={[
            styles.grid,
            { paddingBottom: insets.bottom + SPACING.xxxl },
          ]}
          initialNumToRender={9}
          maxToRenderPerBatch={9}
          windowSize={7}
          showsVerticalScrollIndicator={false}
          ListEmptyComponent={
            <EmptyState
              icon="🎬"
              title="No highlights here yet"
              subtitle={
                sportFilter
                  ? `No ${sportFilter} highlights in the current window.`
                  : "Highlights appear here as athletes post them."
              }
            />
          }
        />
      ) : (
        <FlatList
          data={data as (DiscoverAthlete | UserProfile)[]}
          key="athlete-list"
          keyExtractor={athleteKey}
          renderItem={renderAthlete}
          ItemSeparatorComponent={() => <View style={styles.separator} />}
          contentContainerStyle={[
            styles.list,
            { paddingBottom: insets.bottom + SPACING.xxxl },
          ]}
          initialNumToRender={12}
          maxToRenderPerBatch={12}
          windowSize={9}
          showsVerticalScrollIndicator={false}
          ListEmptyComponent={
            <EmptyState
              icon="🤷"
              title="Nobody here yet"
              subtitle={
                sportFilter
                  ? `No ${sportFilter} athletes match this section right now.`
                  : "Check back once more athletes are active."
              }
            />
          }
        />
      )}

      <PostDetailModal
        visible={!!detailPost}
        post={detailPost}
        onClose={closePost}
        currentUserId={userId}
        isFollowing={!!detailPost && followedIds.has(detailPost.userId)}
        onFollow={toggleFollow}
        onBattle={handleBattleFromPost}
        onDeleted={closePost}
      />

      <BattlePickerModal
        visible={!!challengeTargetPost}
        targetPost={challengeTargetPost}
        currentUserId={userId ?? ""}
        currentProfile={profile}
        onClose={() => setChallengeTargetPost(null)}
        onBattleCreated={() => setChallengeTargetPost(null)}
      />
    </SafeAreaView>
  );
}

const styles = StyleSheet.create({
  safe: { flex: 1, backgroundColor: COLORS.background },
  topBar: {
    flexDirection: "row",
    alignItems: "center",
    gap: SPACING.sm,
    paddingHorizontal: SPACING.md,
    paddingVertical: SPACING.sm,
    borderBottomWidth: 1,
    borderBottomColor: COLORS.cardBorder,
  },
  topBarText: { flex: 1, gap: 1 },
  topBarTitle: {
    color: COLORS.textPrimary,
    fontSize: TYPE.title3,
    fontWeight: FONTS.heavy,
  },
  topBarSubtitle: { color: COLORS.textMuted, fontSize: TYPE.small },
  topBarSpacer: { width: 36 },

  list: { flexGrow: 1, paddingVertical: SPACING.sm },
  separator: {
    height: 1,
    backgroundColor: COLORS.cardBorder,
    marginLeft: SPACING.lg + 48 + SPACING.md,
  },
  grid: {
    flexGrow: 1,
    paddingHorizontal: SPACING.lg,
    paddingTop: SPACING.md,
    gap: SPACING.sm,
  },
  gridColumns: { gap: SPACING.sm },
});
