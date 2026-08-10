import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import {
  fetchDiscoverPool,
  peekDiscoverPool,
  deriveRisingNow,
  deriveUnderTheRadar,
  deriveTrendingHighlights,
  resolveBattleSport,
  type DiscoverAthlete,
} from "@/services/discoverRepository";
import { fetchRisingAthletes } from "@/services/athleteSearchRepository";
import { getBattleStatus } from "@/hooks/useBattles";
import type { Battle, Post, UserProfile } from "@/types";

/** How many items each rail shows before "See All". */
export const RAIL_PREVIEW_COUNT = 10;

export type DiscoverSectionKey =
  | "rising"
  | "battles"
  | "highlights"
  | "radar"
  | "records";

export const SECTION_TITLES: Record<DiscoverSectionKey, string> = {
  rising: "Rising Now",
  battles: "Hot Battles",
  highlights: "Trending Highlights",
  radar: "Under the Radar",
  records: "Top Records",
};

export const SECTION_SUBTITLES: Record<DiscoverSectionKey, string> = {
  rising: "Athletes posting the most right now",
  battles: "Live challenges you can vote on",
  highlights: "The most-liked highlights on Momentum",
  radar: "Great work that hasn't been seen much yet",
  records: "Athletes with the strongest battle records",
};

/**
 * Discover data.
 *
 * All five sections derive from two cached sources — the shared post pool
 * (`discoverRepository`) and the shared battle cache (`useBattles`) — plus one
 * `users` query for Top Records. Nothing here opens a real-time listener, and
 * the See All screens reuse the same caches, so navigating into one costs no
 * additional reads.
 */
export function useDiscover(
  viewerId: string | null,
  battles: Battle[],
  sportFilter: string | null,
  /**
   * Top Records is the one section backed by its own `users` query. See All
   * screens for the other rails pass false so opening them costs zero reads.
   */
  loadRecords = true
) {
  // Paint instantly from cache when Discover is revisited within the TTL.
  const [pool, setPool] = useState<Post[]>(() => peekDiscoverPool() ?? []);
  const [poolLoading, setPoolLoading] = useState(() => peekDiscoverPool() === null);
  const [topRecords, setTopRecords] = useState<UserProfile[]>([]);
  const [recordsLoading, setRecordsLoading] = useState(true);
  const requestIdRef = useRef(0);

  const loadPool = useCallback(
    async (force = false) => {
      const requestId = ++requestIdRef.current;
      if (peekDiscoverPool() === null) setPoolLoading(true);
      try {
        const posts = await fetchDiscoverPool(force);
        if (requestId === requestIdRef.current) setPool(posts);
      } catch (err) {
        console.error("[useDiscover] pool load failed", err);
      } finally {
        if (requestId === requestIdRef.current) setPoolLoading(false);
      }
    },
    []
  );

  const loadTopRecords = useCallback(async () => {
    if (!loadRecords) {
      setTopRecords([]);
      setRecordsLoading(false);
      return;
    }
    setRecordsLoading(true);
    try {
      setTopRecords(await fetchRisingAthletes(viewerId, 24));
    } catch (err) {
      console.error("[useDiscover] top records failed", err);
      setTopRecords([]);
    } finally {
      setRecordsLoading(false);
    }
  }, [viewerId, loadRecords]);

  useEffect(() => {
    void loadPool();
  }, [loadPool]);

  useEffect(() => {
    void loadTopRecords();
  }, [loadTopRecords]);

  const refresh = useCallback(async () => {
    await Promise.all([loadPool(true), loadTopRecords()]);
  }, [loadPool, loadTopRecords]);

  // ── Section derivations. Pure functions over already-fetched data, so
  //    changing the sport chip re-filters without touching the network.
  const rising = useMemo(
    () => deriveRisingNow(pool, { sport: sportFilter, excludeUserId: viewerId }),
    [pool, sportFilter, viewerId]
  );

  const risingIds = useMemo(
    () => new Set(rising.slice(0, RAIL_PREVIEW_COUNT).map((a) => a.userId)),
    [rising]
  );

  const underRadar = useMemo(
    () =>
      deriveUnderTheRadar(pool, {
        sport: sportFilter,
        excludeUserId: viewerId,
        excludeUserIds: risingIds,
      }),
    [pool, sportFilter, viewerId, risingIds]
  );

  const highlights = useMemo(
    () => deriveTrendingHighlights(pool, { sport: sportFilter }),
    [pool, sportFilter]
  );

  /**
   * Live battles only. Expired and completed are excluded by getBattleStatus,
   * which also reclassifies unmatched challenges as expired.
   *
   * Battle documents don't store a sport, so when a sport chip is active the
   * sport is resolved from the players' posts. Battles whose posts aren't in
   * the pool can't be classified and are excluded rather than guessed at.
   */
  const hotBattles = useMemo(() => {
    const live = battles.filter((battle) => getBattleStatus(battle) === "live");
    if (!sportFilter) return live;
    return live.filter(
      (battle) =>
        resolveBattleSport(battle, pool)?.toLowerCase() ===
        sportFilter.toLowerCase()
    );
  }, [battles, sportFilter, pool]);

  const records = useMemo(() => {
    if (!sportFilter) return topRecords;
    return topRecords.filter(
      (athlete) =>
        (athlete.sport || athlete.athleteType || "").toLowerCase() ===
        sportFilter.toLowerCase()
    );
  }, [topRecords, sportFilter]);

  return {
    pool,
    rising,
    underRadar,
    highlights,
    hotBattles,
    records,
    loading: poolLoading,
    recordsLoading,
    refresh,
  };
}

/** Shape shared by the athlete rails so one card component serves all three. */
export function profileToDiscoverAthlete(
  profile: UserProfile
): DiscoverAthlete {
  return {
    userId: profile.userId,
    username: profile.username,
    avatarUrl: profile.avatarUrl || profile.avatar || "",
    sport: profile.sport || profile.athleteType,
    position: profile.position,
    school: profile.school || profile.teamName,
    postCount: 0,
    totalLikes: 0,
    latestPostMs: 0,
  };
}
