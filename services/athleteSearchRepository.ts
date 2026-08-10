import {
  collection,
  getDocs,
  limit as fsLimit,
  orderBy,
  query,
  where,
} from "firebase/firestore";
import { db } from "@/config/firebase";
import type { UserProfile } from "@/types";

/**
 * Athlete discovery — prefix search and browse rails.
 *
 * WHY PREFIX SEARCH
 * ─────────────────
 * Firestore has no full-text index. The standard workaround is a range query
 * over a lowercased copy of the field:
 *
 *     where(field, '>=', term) && where(field, '<', term + '')
 *
 * '' is a very high code point, so the range covers every string starting
 * with `term`. That gives case-insensitive, start-of-field matching for free.
 *
 * KNOWN LIMITS — deliberate, and worth stating plainly:
 *   • Anchored at the start. "fly" will NOT find "ChrisFly".
 *   • No typo tolerance. "chrsi" finds nothing.
 *   • One range field per query, so username and school are searched as
 *     separate queries and merged client-side.
 *
 * Those are acceptable for MVP scale and cost nothing to run. When they stop
 * being acceptable, `searchAthletes` is the single seam to swap for
 * Algolia/Typesense — nothing above this module knows how matching works.
 */

/** Highest code point Firestore will sort before, for prefix upper bounds. */
const PREFIX_END = "";
const SEARCH_LIMIT = 20;
const BROWSE_LIMIT = 12;

function normalizeTerm(term: string): string {
  return term.trim().toLowerCase();
}

function toProfile(id: string, data: Record<string, unknown>): UserProfile {
  const str = (value: unknown): string =>
    typeof value === "string" && value.trim() ? value.trim() : "";
  const avatarUrl = str(data.avatarUrl) || str(data.avatar);
  const sport = str(data.sport) || str(data.athleteType) || "Other";

  return {
    userId: id,
    username: str(data.username),
    avatar: avatarUrl,
    avatarUrl,
    bannerUrl: str(data.bannerUrl) || undefined,
    athleteType: sport,
    sport,
    bio: str(data.bio),
    posts: typeof data.posts === "number" ? data.posts : 0,
    wins: typeof data.wins === "number" ? data.wins : 0,
    losses: typeof data.losses === "number" ? data.losses : 0,
    createdAt: null,
    position: str(data.position) || undefined,
    school: str(data.school) || undefined,
    teamName: str(data.teamName) || undefined,
    city: str(data.city) || undefined,
    state: str(data.state) || undefined,
    gradYear: str(data.gradYear) || undefined,
    verified: data.verified === true || undefined,
    momentumScore:
      typeof data.momentumScore === "number" ? data.momentumScore : undefined,
  };
}

/** One prefix range query over a lowercased field. */
async function prefixQuery(
  field: "usernameLower" | "schoolLower" | "cityLower",
  term: string,
  max: number
): Promise<UserProfile[]> {
  try {
    const snapshot = await getDocs(
      query(
        collection(db, "users"),
        where(field, ">=", term),
        where(field, "<", term + PREFIX_END),
        orderBy(field),
        fsLimit(max)
      )
    );
    return snapshot.docs.map((userDoc) =>
      toProfile(userDoc.id, userDoc.data() as Record<string, unknown>)
    );
  } catch (err) {
    // A missing composite index surfaces as failed-precondition. Log the real
    // code rather than swallowing it as "no results" — an empty search screen
    // and a misconfigured index look identical to the user otherwise.
    const code = (err as { code?: string })?.code ?? "unknown";
    console.error(`[athleteSearch] ${field} query failed — code:`, code, err);
    return [];
  }
}

export interface AthleteSearchOptions {
  /** Restrict to one sport. */
  sport?: string | null;
  /** Never return the searcher themselves. */
  excludeUserId?: string | null;
  limit?: number;
}

/**
 * Search athletes by username, school, or city prefix.
 *
 * The three field queries run in parallel and are merged with username matches
 * ranked first — someone typing a name expects people, not institutions.
 */
export async function searchAthletes(
  rawTerm: string,
  options: AthleteSearchOptions = {}
): Promise<UserProfile[]> {
  const term = normalizeTerm(rawTerm);
  if (term.length < 2) return [];

  const max = options.limit ?? SEARCH_LIMIT;
  const [byUsername, bySchool, byCity] = await Promise.all([
    prefixQuery("usernameLower", term, max),
    prefixQuery("schoolLower", term, max),
    prefixQuery("cityLower", term, max),
  ]);

  const seen = new Set<string>();
  const merged: UserProfile[] = [];
  // Order matters: username, then school, then city.
  for (const group of [byUsername, bySchool, byCity]) {
    for (const athlete of group) {
      if (seen.has(athlete.userId)) continue;
      if (options.excludeUserId && athlete.userId === options.excludeUserId) continue;
      if (options.sport && athlete.sport !== options.sport) continue;
      if (!athlete.username) continue;
      seen.add(athlete.userId);
      merged.push(athlete);
    }
  }
  return merged.slice(0, max);
}

/** Athletes in the same sport — the default browse rail. */
export async function fetchAthletesBySport(
  sport: string,
  excludeUserId?: string | null,
  max = BROWSE_LIMIT
): Promise<UserProfile[]> {
  if (!sport) return [];
  try {
    const snapshot = await getDocs(
      query(collection(db, "users"), where("sport", "==", sport), fsLimit(max + 1))
    );
    return snapshot.docs
      .map((userDoc) => toProfile(userDoc.id, userDoc.data() as Record<string, unknown>))
      .filter((athlete) => athlete.username && athlete.userId !== excludeUserId)
      .slice(0, max);
  } catch (err) {
    const code = (err as { code?: string })?.code ?? "unknown";
    console.error("[athleteSearch] sport browse failed — code:", code, err);
    return [];
  }
}

/** Athletes at the same school — strongest real-world signal we have. */
export async function fetchAthletesBySchool(
  school: string,
  excludeUserId?: string | null,
  max = BROWSE_LIMIT
): Promise<UserProfile[]> {
  const term = normalizeTerm(school);
  if (!term) return [];
  const results = await prefixQuery("schoolLower", term, max + 1);
  return results
    .filter((athlete) => athlete.username && athlete.userId !== excludeUserId)
    .slice(0, max);
}

/**
 * Athletes with the strongest competitive records.
 *
 * Ordered by wins rather than momentumScore because wins is written by
 * `finalizeBattle` on every athlete, while momentumScore is optional and
 * absent on most documents — ordering by it would silently hide everyone
 * who doesn't have one (Firestore omits docs missing the ordered field).
 */
export async function fetchRisingAthletes(
  excludeUserId?: string | null,
  max = BROWSE_LIMIT
): Promise<UserProfile[]> {
  try {
    const snapshot = await getDocs(
      query(collection(db, "users"), orderBy("wins", "desc"), fsLimit(max + 1))
    );
    return snapshot.docs
      .map((userDoc) => toProfile(userDoc.id, userDoc.data() as Record<string, unknown>))
      .filter((athlete) => athlete.username && athlete.userId !== excludeUserId)
      .slice(0, max);
  } catch (err) {
    const code = (err as { code?: string })?.code ?? "unknown";
    console.error("[athleteSearch] rising athletes failed — code:", code, err);
    return [];
  }
}
