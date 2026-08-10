import React, { useCallback, useMemo, useState } from "react";
import {
  View,
  Text,
  TextInput,
  StyleSheet,
  FlatList,
  ScrollView,
  Pressable,
  ActivityIndicator,
  RefreshControl,
  Keyboard,
} from "react-native";
import { SafeAreaView } from "react-native-safe-area-context";
import { useRouter } from "expo-router";
import { useIsFocused } from "@react-navigation/native";
import { Feather } from "@expo/vector-icons";
import { useAuthStore } from "@/store/authStore";
import { useFollows } from "@/hooks/useFollows";
import { useBattles } from "@/hooks/useBattles";
import {
  useAthleteSearch,
  MIN_SEARCH_LENGTH,
} from "@/hooks/useAthleteSearch";
import {
  useDiscover,
  profileToDiscoverAthlete,
  RAIL_PREVIEW_COUNT,
  SECTION_SUBTITLES,
  SECTION_TITLES,
} from "@/hooks/useDiscover";
import {
  COLORS,
  SPACING,
  RADIUS,
  FONTS,
  TYPE,
  HIT_SLOP,
  ATHLETE_TYPES,
} from "@/constants/theme";
import AthleteRow from "@/components/AthleteRow";
import DiscoverSection from "@/components/discover/DiscoverSection";
import AthleteCard from "@/components/discover/AthleteCard";
import HotBattleCard from "@/components/discover/HotBattleCard";
import HighlightCard from "@/components/discover/HighlightCard";
import BattleDetailModal from "@/components/BattleDetailModal";
import PostDetailModal from "@/components/PostDetailModal";
import BattlePickerModal from "@/components/BattlePickerModal";
import Chip from "@/components/Chip";
import EmptyState from "@/components/EmptyState";
import { openAthleteProfile } from "@/utils/navigation";
import type { DiscoverAthlete } from "@/services/discoverRepository";
import type { Battle, Post, UserProfile } from "@/types";

const athleteKey = (item: UserProfile) => item.userId;
const discoverAthleteKey = (item: DiscoverAthlete) => item.userId;
const battleKey = (item: Battle) => item.id;
const postKey = (item: Post) => item.id;

/**
 * Discover — find athletes, live battles, and highlights.
 *
 * Typing searches athletes; an empty field shows five derived sections. Every
 * section is built from data Momentum actually stores (see
 * services/discoverRepository.ts for the derivations and the data-integrity
 * rule), and the sport chips filter all of them, not just search.
 */
export default function DiscoverScreen() {
  const router = useRouter();
  const isFocused = useIsFocused();
  const userId = useAuthStore((s) => s.userId);
  const profile = useAuthStore((s) => s.profile);

  const [term, setTerm] = useState("");
  const [sportFilter, setSportFilter] = useState<string | null>(null);
  const [detailBattle, setDetailBattle] = useState<Battle | null>(null);
  const [detailPost, setDetailPost] = useState<Post | null>(null);
  const [challengeTargetPost, setChallengeTargetPost] = useState<Post | null>(null);

  const { followedIds, follow, unfollow } = useFollows(userId);

  // Shares the module-level battle cache with the Battles tab and Home, so
  // mounting Discover doesn't re-query. votedMap powers the Voted state and
  // handleVote is the same server-authoritative path the Battles tab uses.
  const { battles, votedMap, handleVote } = useBattles(userId, true, isFocused);

  const { rising, underRadar, highlights, hotBattles, records, loading, refresh } =
    useDiscover(userId, battles, sportFilter);

  const { results, loading: searching, active } = useAthleteSearch(term, {
    sport: sportFilter,
    excludeUserId: userId,
  });

  const [refreshing, setRefreshing] = useState(false);
  const handleRefresh = useCallback(async () => {
    setRefreshing(true);
    try {
      await refresh();
    } finally {
      setRefreshing(false);
    }
  }, [refresh]);

  // ── Navigation handlers ───────────────────────────────────────────────────
  const openProfile = useCallback(
    (targetUserId: string) => {
      Keyboard.dismiss();
      openAthleteProfile(router, targetUserId, userId);
    },
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

  const openBattle = useCallback((battle: Battle) => {
    Keyboard.dismiss();
    setDetailBattle(battle);
  }, []);
  const closeBattle = useCallback(() => setDetailBattle(null), []);

  const openPost = useCallback((post: Post) => {
    Keyboard.dismiss();
    setDetailPost(post);
  }, []);
  const closePost = useCallback(() => setDetailPost(null), []);

  // Challenge from the post detail modal reuses the existing picker flow.
  const handleBattleFromPost = useCallback((post: Post) => {
    setDetailPost(null);
    setChallengeTargetPost(post);
  }, []);

  const seeAll = useCallback(
    (section: string) => {
      router.push(
        `/discover/${section}${sportFilter ? `?sport=${encodeURIComponent(sportFilter)}` : ""}` as never
      );
    },
    [router, sportFilter]
  );

  const seeAllBattles = useCallback(() => {
    // The existing Battles tab is the real expanded battle experience.
    router.push("/battles" as never);
  }, [router]);

  // ── Renderers ─────────────────────────────────────────────────────────────
  const renderSearchResult = useCallback(
    ({ item }: { item: UserProfile }) => (
      <AthleteRow
        athlete={item}
        onPress={openProfile}
        isFollowing={followedIds.has(item.userId)}
        onToggleFollow={userId ? toggleFollow : undefined}
      />
    ),
    [followedIds, openProfile, toggleFollow, userId]
  );

  const renderRising = useCallback(
    ({ item }: { item: DiscoverAthlete }) => (
      <AthleteCard athlete={item} onPress={openProfile} metric="recentPosts" />
    ),
    [openProfile]
  );

  const renderRadar = useCallback(
    ({ item }: { item: DiscoverAthlete }) => (
      <AthleteCard athlete={item} onPress={openProfile} metric="none" />
    ),
    [openProfile]
  );

  const renderRecord = useCallback(
    ({ item }: { item: UserProfile }) => (
      <AthleteCard
        athlete={profileToDiscoverAthlete(item)}
        onPress={openProfile}
        metric="record"
        wins={item.wins}
        losses={item.losses}
        verified={item.verified}
      />
    ),
    [openProfile]
  );

  const renderBattle = useCallback(
    ({ item }: { item: Battle }) => (
      <HotBattleCard
        battle={item}
        onOpen={openBattle}
        onOpenAthlete={openProfile}
        userVote={votedMap.get(item.id) ?? null}
      />
    ),
    [openBattle, openProfile, votedMap]
  );

  const renderHighlight = useCallback(
    ({ item }: { item: Post }) => (
      <HighlightCard post={item} onOpen={openPost} onOpenAthlete={openProfile} />
    ),
    [openPost, openProfile]
  );

  const sportFilters = useMemo(() => ATHLETE_TYPES, []);
  const showBrowse = !active;

  const risingPreview = rising.slice(0, RAIL_PREVIEW_COUNT);
  const radarPreview = underRadar.slice(0, RAIL_PREVIEW_COUNT);
  const highlightPreview = highlights.slice(0, RAIL_PREVIEW_COUNT);
  const recordPreview = records.slice(0, RAIL_PREVIEW_COUNT);
  const battlePreview = hotBattles.slice(0, RAIL_PREVIEW_COUNT);

  const nothingToShow =
    !loading &&
    risingPreview.length === 0 &&
    radarPreview.length === 0 &&
    highlightPreview.length === 0 &&
    recordPreview.length === 0 &&
    battlePreview.length === 0;

  return (
    <SafeAreaView style={styles.safe} edges={["top"]}>
      {/* ── Header: title, search, sport chips ──────────────────────────────── */}
      <View style={styles.header}>
        <Text style={styles.title} accessibilityRole="header">
          Discover
        </Text>
        <View style={styles.searchWrap}>
          <Feather name="search" size={16} color={COLORS.textMuted} />
          <TextInput
            style={styles.searchInput}
            value={term}
            onChangeText={setTerm}
            placeholder="Search athletes, schools, cities"
            placeholderTextColor={COLORS.textMuted}
            autoCapitalize="none"
            autoCorrect={false}
            returnKeyType="search"
            accessibilityLabel="Search athletes by name, school, or city"
            clearButtonMode="never"
          />
          {term.length > 0 && (
            <Pressable
              onPress={() => setTerm("")}
              hitSlop={HIT_SLOP}
              accessibilityRole="button"
              accessibilityLabel="Clear search"
              style={({ pressed }) => pressed && styles.pressed}
            >
              <Feather name="x-circle" size={16} color={COLORS.textMuted} />
            </Pressable>
          )}
        </View>

        {/* Sport chips filter search AND every browse section below. */}
        <ScrollView
          horizontal
          showsHorizontalScrollIndicator={false}
          contentContainerStyle={styles.filterRow}
          keyboardShouldPersistTaps="handled"
        >
          <Chip
            label="All sports"
            selected={sportFilter === null}
            onPress={() => setSportFilter(null)}
          />
          {sportFilters.map((sport) => (
            <Chip
              key={sport}
              label={sport}
              selected={sportFilter === sport}
              onPress={() =>
                setSportFilter((current) => (current === sport ? null : sport))
              }
            />
          ))}
        </ScrollView>
      </View>

      {/* ── Search results ──────────────────────────────────────────────────── */}
      {!showBrowse ? (
        searching ? (
          <View style={styles.centered}>
            <ActivityIndicator color={COLORS.accent} />
          </View>
        ) : (
          <FlatList
            data={results}
            keyExtractor={athleteKey}
            renderItem={renderSearchResult}
            keyboardShouldPersistTaps="handled"
            keyboardDismissMode="on-drag"
            contentContainerStyle={styles.results}
            ItemSeparatorComponent={() => <View style={styles.separator} />}
            ListEmptyComponent={
              <EmptyState
                icon="🤷"
                title={`No athletes matching "${term.trim()}"`}
                subtitle={`Search matches the start of a username, school, or city — try the first few letters.${
                  sportFilter ? ` You're also filtering to ${sportFilter}.` : ""
                }`}
              />
            }
          />
        )
      ) : loading && nothingToShow ? (
        <View style={styles.centered}>
          <ActivityIndicator color={COLORS.accent} />
        </View>
      ) : (
        /* ── Browse sections ───────────────────────────────────────────────── */
        <ScrollView
          contentContainerStyle={styles.browse}
          showsVerticalScrollIndicator={false}
          keyboardShouldPersistTaps="handled"
          refreshControl={
            <RefreshControl
              refreshing={refreshing}
              onRefresh={handleRefresh}
              tintColor={COLORS.accent}
              colors={[COLORS.accent]}
            />
          }
        >
          {nothingToShow ? (
            <EmptyState
              icon="🔎"
              title={
                sportFilter
                  ? `Nothing in ${sportFilter} yet`
                  : "Nothing to discover yet"
              }
              subtitle={
                sportFilter
                  ? "Try another sport, or clear the filter to see everything."
                  : "Once athletes start posting highlights and opening challenges, they'll show up here."
              }
              actionLabel={sportFilter ? "Clear filter" : undefined}
              onAction={sportFilter ? () => setSportFilter(null) : undefined}
            />
          ) : null}

          {/* 1 · Rising Now */}
          {risingPreview.length > 0 && (
            <DiscoverSection
              title={SECTION_TITLES.rising}
              subtitle={SECTION_SUBTITLES.rising}
              count={rising.length}
              onSeeAll={
                rising.length > risingPreview.length
                  ? () => seeAll("rising")
                  : undefined
              }
            >
              <FlatList
                horizontal
                data={risingPreview}
                keyExtractor={discoverAthleteKey}
                renderItem={renderRising}
                showsHorizontalScrollIndicator={false}
                contentContainerStyle={styles.rail}
                initialNumToRender={4}
                maxToRenderPerBatch={4}
                windowSize={3}
              />
            </DiscoverSection>
          )}

          {/* 2 · Hot Battles */}
          {battlePreview.length > 0 && (
            <DiscoverSection
              title={SECTION_TITLES.battles}
              subtitle={SECTION_SUBTITLES.battles}
              count={hotBattles.length}
              onSeeAll={seeAllBattles}
            >
              <FlatList
                horizontal
                data={battlePreview}
                keyExtractor={battleKey}
                renderItem={renderBattle}
                showsHorizontalScrollIndicator={false}
                contentContainerStyle={styles.rail}
                initialNumToRender={2}
                maxToRenderPerBatch={2}
                windowSize={3}
              />
            </DiscoverSection>
          )}

          {/* 3 · Trending Highlights */}
          {highlightPreview.length > 0 && (
            <DiscoverSection
              title={SECTION_TITLES.highlights}
              subtitle={SECTION_SUBTITLES.highlights}
              count={highlights.length}
              onSeeAll={
                highlights.length > highlightPreview.length
                  ? () => seeAll("highlights")
                  : undefined
              }
            >
              <FlatList
                horizontal
                data={highlightPreview}
                keyExtractor={postKey}
                renderItem={renderHighlight}
                showsHorizontalScrollIndicator={false}
                contentContainerStyle={styles.rail}
                initialNumToRender={3}
                maxToRenderPerBatch={3}
                windowSize={3}
              />
            </DiscoverSection>
          )}

          {/* 4 · Under the Radar */}
          {radarPreview.length > 0 && (
            <DiscoverSection
              title={SECTION_TITLES.radar}
              subtitle={SECTION_SUBTITLES.radar}
              count={underRadar.length}
              onSeeAll={
                underRadar.length > radarPreview.length
                  ? () => seeAll("radar")
                  : undefined
              }
            >
              <FlatList
                horizontal
                data={radarPreview}
                keyExtractor={discoverAthleteKey}
                renderItem={renderRadar}
                showsHorizontalScrollIndicator={false}
                contentContainerStyle={styles.rail}
                initialNumToRender={4}
                maxToRenderPerBatch={4}
                windowSize={3}
              />
            </DiscoverSection>
          )}

          {/* 5 · Top Records — kept, but no longer the headline section */}
          {recordPreview.length > 0 && (
            <DiscoverSection
              title={SECTION_TITLES.records}
              subtitle={SECTION_SUBTITLES.records}
              count={records.length}
              onSeeAll={
                records.length > recordPreview.length
                  ? () => seeAll("records")
                  : undefined
              }
            >
              <FlatList
                horizontal
                data={recordPreview}
                keyExtractor={athleteKey}
                renderItem={renderRecord}
                showsHorizontalScrollIndicator={false}
                contentContainerStyle={styles.rail}
                initialNumToRender={4}
                maxToRenderPerBatch={4}
                windowSize={3}
              />
            </DiscoverSection>
          )}
        </ScrollView>
      )}

      {/* Hint while the term is too short to query */}
      {term.trim().length > 0 && term.trim().length < MIN_SEARCH_LENGTH && (
        <Text style={styles.hint}>
          Keep typing — searches start at {MIN_SEARCH_LENGTH} characters.
        </Text>
      )}

      {/* Existing battle voting experience, unchanged */}
      <BattleDetailModal
        visible={!!detailBattle}
        battle={detailBattle}
        userVote={detailBattle ? votedMap.get(detailBattle.id) ?? null : null}
        onVote={handleVote}
        onClose={closeBattle}
        currentUserId={userId}
      />

      {/* Existing post detail — carries like, comment, share and the rail */}
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
  pressed: { opacity: 0.6 },

  header: {
    paddingTop: SPACING.sm,
    paddingBottom: SPACING.sm,
    borderBottomWidth: 1,
    borderBottomColor: COLORS.cardBorder,
    gap: SPACING.md,
  },
  title: {
    color: COLORS.textPrimary,
    fontSize: TYPE.hero,
    fontWeight: FONTS.heavy,
    letterSpacing: 0.3,
    paddingHorizontal: SPACING.lg,
  },
  searchWrap: {
    flexDirection: "row",
    alignItems: "center",
    gap: SPACING.sm,
    marginHorizontal: SPACING.lg,
    paddingHorizontal: SPACING.md,
    minHeight: 44,
    borderRadius: RADIUS.md,
    borderWidth: 1,
    borderColor: COLORS.inputBorder,
    backgroundColor: COLORS.input,
  },
  searchInput: {
    flex: 1,
    color: COLORS.textPrimary,
    fontSize: TYPE.base,
    paddingVertical: SPACING.sm,
  },
  filterRow: {
    flexDirection: "row",
    gap: SPACING.sm,
    paddingHorizontal: SPACING.lg,
  },

  centered: { flex: 1, alignItems: "center", justifyContent: "center" },

  results: { paddingVertical: SPACING.sm, flexGrow: 1 },
  separator: {
    height: 1,
    backgroundColor: COLORS.cardBorder,
    marginLeft: SPACING.lg + 48 + SPACING.md,
  },

  browse: { paddingBottom: SPACING.xxxl },
  rail: {
    flexDirection: "row",
    gap: SPACING.sm,
    paddingHorizontal: SPACING.lg,
  },

  hint: {
    color: COLORS.textMuted,
    fontSize: TYPE.caption,
    textAlign: "center",
    paddingVertical: SPACING.md,
  },
});
