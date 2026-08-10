import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import {
  searchAthletes,
  fetchAthletesBySport,
  fetchAthletesBySchool,
  fetchRisingAthletes,
} from "@/services/athleteSearchRepository";
import type { UserProfile } from "@/types";

/** Wait this long after the last keystroke before querying. */
const DEBOUNCE_MS = 280;
/** Prefix queries below this length match most of the collection. */
export const MIN_SEARCH_LENGTH = 2;

/**
 * Debounced athlete search.
 *
 * Every keystroke firing a query would bill three Firestore reads per
 * character typed. Debouncing collapses a burst of typing into one query, and
 * a request-id guard drops any in-flight response that a newer query has
 * already superseded — without it, a slow early query can land after a fast
 * later one and overwrite good results with stale ones.
 */
export function useAthleteSearch(
  term: string,
  options: { sport?: string | null; excludeUserId?: string | null } = {}
) {
  const [results, setResults] = useState<UserProfile[]>([]);
  const [loading, setLoading] = useState(false);
  const requestIdRef = useRef(0);

  const { sport, excludeUserId } = options;
  const trimmed = term.trim();
  const active = trimmed.length >= MIN_SEARCH_LENGTH;

  useEffect(() => {
    if (!active) {
      requestIdRef.current += 1;
      setResults([]);
      setLoading(false);
      return;
    }

    setLoading(true);
    const requestId = ++requestIdRef.current;
    const timer = setTimeout(() => {
      searchAthletes(trimmed, { sport, excludeUserId })
        .then((found) => {
          if (requestId === requestIdRef.current) setResults(found);
        })
        .catch(() => {
          if (requestId === requestIdRef.current) setResults([]);
        })
        .finally(() => {
          if (requestId === requestIdRef.current) setLoading(false);
        });
    }, DEBOUNCE_MS);

    return () => clearTimeout(timer);
  }, [trimmed, active, sport, excludeUserId]);

  return { results, loading, active };
}

export interface BrowseRail {
  key: string;
  title: string;
  subtitle: string;
  athletes: UserProfile[];
}

/**
 * Browse rails for the empty-search state — same school, same sport, top
 * records. Loaded once per viewer profile, not per keystroke.
 */
export function useAthleteBrowse(viewer: UserProfile | null) {
  const [rails, setRails] = useState<BrowseRail[]>([]);
  const [loading, setLoading] = useState(true);
  const requestIdRef = useRef(0);

  const sport = viewer?.sport || viewer?.athleteType || "";
  const school = viewer?.school || "";
  const viewerId = viewer?.userId ?? null;

  const load = useCallback(async () => {
    const requestId = ++requestIdRef.current;
    setLoading(true);
    try {
      const [sameSchool, sameSport, rising] = await Promise.all([
        school ? fetchAthletesBySchool(school, viewerId) : Promise.resolve([]),
        sport ? fetchAthletesBySport(sport, viewerId) : Promise.resolve([]),
        fetchRisingAthletes(viewerId),
      ]);
      if (requestId !== requestIdRef.current) return;

      // An athlete shown in an earlier rail is not repeated in a later one —
      // three rails of the same six people is not discovery.
      const seen = new Set<string>();
      const dedupe = (list: UserProfile[]) =>
        list.filter((athlete) => {
          if (seen.has(athlete.userId)) return false;
          seen.add(athlete.userId);
          return true;
        });

      const next: BrowseRail[] = [];
      const schoolRail = dedupe(sameSchool);
      if (schoolRail.length > 0) {
        next.push({
          key: "school",
          title: `At ${school}`,
          subtitle: "Teammates and classmates on Momentum",
          athletes: schoolRail,
        });
      }
      const sportRail = dedupe(sameSport);
      if (sportRail.length > 0) {
        next.push({
          key: "sport",
          title: `${sport} athletes`,
          subtitle: "Competing in your sport",
          athletes: sportRail,
        });
      }
      const risingRail = dedupe(rising);
      if (risingRail.length > 0) {
        next.push({
          key: "rising",
          title: "Top records",
          subtitle: "Athletes winning the most battles",
          athletes: risingRail,
        });
      }
      setRails(next);
    } catch (err) {
      console.error("[useAthleteBrowse] load failed", err);
      if (requestId === requestIdRef.current) setRails([]);
    } finally {
      if (requestId === requestIdRef.current) setLoading(false);
    }
  }, [school, sport, viewerId]);

  useEffect(() => {
    void load();
  }, [load]);

  return useMemo(
    () => ({ rails, loading, refresh: load }),
    [rails, loading, load]
  );
}
