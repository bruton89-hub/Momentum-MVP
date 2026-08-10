import { fetchRecentPosts, timestampToMs } from "@/services/postRepository";
import type { Battle, Post } from "@/types";

/**
 * Discover data derivations.
 *
 * DATA INTEGRITY RULE
 * ───────────────────
 * Every number rendered on Discover is either stored in Firestore or counted
 * from documents fetched here. Nothing is invented. Momentum does not track
 * impressions, follower counts, view counts, or a trending score, so no
 * section displays any of those — where a design would want one, the section
 * shows real identity fields (sport, school) instead.
 *
 * ONE QUERY, FIVE SECTIONS
 * ────────────────────────
 * Rising Now, Under the Radar, and Trending Highlights are all derived from a
 * single ordered `posts` read, cached module-level with a TTL. The expanded
 * "See All" screens read the same cache, so opening one costs zero additional
 * Firestore reads. Hot Battles reuses the existing `useBattles` cache, and Top
 * Records reuses `fetchRisingAthletes`. No new listeners are created anywhere —
 * Discover is entirely fetch-on-demand.
 */

/** Size of the shared pool. Matches the Home feed's background page size. */
const POOL_LIMIT = 80;

/** How long a fetched pool stays warm before Discover re-reads. */
const POOL_TTL_MS = 120_000;

/** Window that counts as "now" for the Rising Now rail. */
const RISING_WINDOW_MS = 14 * 24 * 3_600_000;

let cachedPool: Post[] | null = null;
let cachedAt = 0;
let inFlight: Promise<Post[]> | null = null;

/** An athlete summarized from their own posts — no extra `users` read needed. */
export interface DiscoverAthlete {
  userId: string;
  username: string;
  avatarUrl: string;
  sport?: string;
  position?: string;
  school?: string;
  /** Posts by this athlete inside the pool. Counted, never estimated. */
  postCount: number;
  /** Sum of likesCount across those posts. Stored values only. */
  totalLikes: number;
  /** createdAt of their most recent post in the pool. */
  latestPostMs: number;
}

/**
 * The shared post pool.
 *
 * Concurrent callers share one in-flight promise, so mounting Discover and
 * immediately opening a See All screen issues a single read, not two.
 */
export async function fetchDiscoverPool(force = false): Promise<Post[]> {
  const fresh = cachedPool && Date.now() - cachedAt < POOL_TTL_MS;
  if (!force && fresh && cachedPool) return cachedPool;
  if (!force && inFlight) return inFlight;

  inFlight = fetchRecentPosts(POOL_LIMIT)
    .then((posts) => {
      cachedPool = posts;
      cachedAt = Date.now();
      return posts;
    })
    .finally(() => {
      inFlight = null;
    });

  return inFlight;
}

/** Synchronous peek — lets a screen paint from cache before awaiting. */
export function peekDiscoverPool(): Post[] | null {
  return cachedPool;
}

/** Invalidate after a publish so a new highlight can appear in Discover. */
export function invalidateDiscoverPool(): void {
  cachedPool = null;
  cachedAt = 0;
}

// ─── Derivations ─────────────────────────────────────────────────────────────

function matchesSport(value: string | undefined, sport: string | null): boolean {
  if (!sport) return true;
  return !!value && value.trim().toLowerCase() === sport.trim().toLowerCase();
}

/**
 * Collapse a post list into per-athlete summaries.
 *
 * Identity comes from the post's own denormalized author fields (username,
 * avatarUrl, sport, school) — which `createPost` always writes — so building
 * an athlete rail costs no `users` reads at all.
 */
function summarizeAthletes(
  posts: Post[],
  options: { sport?: string | null; excludeUserId?: string | null } = {}
): DiscoverAthlete[] {
  const { sport = null, excludeUserId = null } = options;
  const byUser = new Map<string, DiscoverAthlete>();

  for (const post of posts) {
    if (!post.userId || !post.username) continue;
    if (excludeUserId && post.userId === excludeUserId) continue;
    if (!matchesSport(post.sport, sport)) continue;

    const createdMs = timestampToMs(post.createdAt);
    const existing = byUser.get(post.userId);
    if (existing) {
      existing.postCount += 1;
      existing.totalLikes += Math.max(0, post.likesCount);
      existing.latestPostMs = Math.max(existing.latestPostMs, createdMs);
      // Backfill identity from whichever post actually carries it.
      existing.sport ||= post.sport;
      existing.position ||= post.position;
      existing.school ||= post.school || post.teamName;
      existing.avatarUrl ||= post.avatarUrl || post.userAvatar;
    } else {
      byUser.set(post.userId, {
        userId: post.userId,
        username: post.username,
        avatarUrl: post.avatarUrl || post.userAvatar || "",
        sport: post.sport,
        position: post.position,
        school: post.school || post.teamName,
        postCount: 1,
        totalLikes: Math.max(0, post.likesCount),
        latestPostMs: createdMs,
      });
    }
  }

  return Array.from(byUser.values());
}

/**
 * RISING NOW — athletes actively posting.
 *
 * "Rising" here means measurable recent activity: how many highlights the
 * athlete has published inside the window, most recent first as the tiebreak.
 * That is a real count of real documents. It deliberately is NOT a momentum
 * score or a follower delta, because Momentum stores neither.
 */
export function deriveRisingNow(
  pool: Post[],
  options: { sport?: string | null; excludeUserId?: string | null } = {}
): DiscoverAthlete[] {
  const cutoff = Date.now() - RISING_WINDOW_MS;
  const recent = pool.filter(
    (post) => timestampToMs(post.createdAt) >= cutoff
  );
  return summarizeAthletes(recent, options).sort(
    (a, b) =>
      b.postCount - a.postCount ||
      b.latestPostMs - a.latestPostMs ||
      a.username.localeCompare(b.username)
  );
}

/**
 * UNDER THE RADAR — athletes whose work has drawn the least attention so far.
 *
 * Ranked by total stored likes across their posts in the pool, ascending. It is
 * a genuinely different population from Top Records (which ranks by battle
 * wins) and from Rising Now (which ranks by posting volume) — and callers
 * exclude the Rising Now set so the two rails never show the same faces.
 *
 * No "exposure" or "reach" figure is displayed, because impressions aren't
 * tracked. The card shows sport and school instead.
 */
export function deriveUnderTheRadar(
  pool: Post[],
  options: {
    sport?: string | null;
    excludeUserId?: string | null;
    excludeUserIds?: Set<string>;
  } = {}
): DiscoverAthlete[] {
  const { excludeUserIds } = options;
  return summarizeAthletes(pool, options)
    .filter((athlete) => !excludeUserIds?.has(athlete.userId))
    .sort(
      (a, b) =>
        a.totalLikes - b.totalLikes ||
        b.latestPostMs - a.latestPostMs ||
        a.username.localeCompare(b.username)
    );
}

/**
 * TRENDING HIGHLIGHTS — the pool's most-liked posts.
 *
 * likesCount is a stored, server-maintained field (written by the setPostLike
 * callable), so this is real engagement. There is no time-decay term because
 * the pool is already bounded to the newest posts.
 */
export function deriveTrendingHighlights(
  pool: Post[],
  options: { sport?: string | null } = {}
): Post[] {
  const { sport = null } = options;
  return pool
    .filter((post) => matchesSport(post.sport, sport))
    .slice()
    .sort(
      (a, b) =>
        b.likesCount - a.likesCount ||
        timestampToMs(b.createdAt) - timestampToMs(a.createdAt)
    );
}

/**
 * Resolve a battle's sport from the post pool.
 *
 * Battle documents store `category` (Highlights, Drills, …), not sport, so the
 * only honest way to sport-filter a battle is to look up the sport recorded on
 * one of its players' posts. Returns undefined when neither post is in the
 * pool — callers must decide what that means rather than guessing a sport.
 */
export function resolveBattleSport(
  battle: Battle,
  pool: Post[]
): string | undefined {
  const byId = new Map(pool.map((post) => [post.id, post]));
  const a = battle.playerA?.postId ? byId.get(battle.playerA.postId) : undefined;
  if (a?.sport) return a.sport;
  const b = battle.playerB?.postId ? byId.get(battle.playerB.postId) : undefined;
  return b?.sport;
}

/** Percentage split for a battle. Returns nulls when nobody has voted yet. */
export function voteSplit(battle: Battle): {
  total: number;
  percentA: number | null;
  percentB: number | null;
} {
  const votesA = Math.max(0, battle.votesA ?? 0);
  const votesB = Math.max(0, battle.votesB ?? 0);
  const total = votesA + votesB;
  if (total === 0) return { total: 0, percentA: null, percentB: null };
  const percentA = Math.round((votesA / total) * 100);
  return { total, percentA, percentB: 100 - percentA };
}
