import { timestampToMs } from "@/services/postRepository";
import type { Post, UserProfile } from "@/types";

/**
 * For You feed ranking — fair-exposure model.
 *
 * THE PROBLEM THIS SOLVES
 * ───────────────────────
 * Rank by raw likes and the feed calcifies within weeks. A post with 400 likes
 * outranks a post with 4 forever, regardless of how many people actually saw
 * either one, so the athletes who arrived first keep winning and a freshman
 * who posts their first highlight is never seen by anyone. On a recruiting
 * platform that failure mode isn't just boring, it's the product not working.
 *
 * THE MODEL
 * ─────────
 * Score is a weighted sum of five terms, each normalised to roughly 0–1 so the
 * weights below are directly comparable and directly tunable.
 *
 *   1. NEW-POST EXPOSURE  (weight 0.30, decays to 0)
 *      Every post gets a guaranteed boost for its first EXPOSURE_WINDOW_HOURS,
 *      full strength at minute zero and decaying linearly to nothing. This is
 *      the "guaranteed impressions" idea: a new post is placed in front of
 *      people on merit-of-being-new, and what happens next decides its fate.
 *
 *   2. ENGAGEMENT RATE    (weight 0.28)
 *      Likes per hour since posting, dampened with log1p and squashed into
 *      0–1. Rate, not total, is what makes a 6-hour-old post with 20 likes
 *      beat a 3-week-old post with 200. Log damping stops one viral post from
 *      flattening the rest of the distribution to zero.
 *
 *   3. RECENCY            (weight 0.18)
 *      Exponential half-life decay. Independent of engagement so the feed
 *      stays current even when nobody has engaged with anything yet — which is
 *      the state a young platform is actually in.
 *
 *   4. RELEVANCE          (weight 0.16)
 *      Same sport, same school, same state as the viewer. Partial credit for
 *      each. This is what makes the feed feel local without hard-filtering
 *      anyone out of it.
 *
 *   5. UNDER-EXPOSED      (weight 0.08)
 *      A gentle lift for posts from athletes the viewer doesn't already
 *      follow, and for authors with few wins on record. Counteracts the
 *      rich-get-richer pull of terms 2 and 4.
 *
 * Then two DIVERSITY PENALTIES are applied during selection, not scoring:
 * consecutive posts by the same author are pushed down hard, and each
 * additional post by an already-seen author costs a little more. Without these
 * one prolific athlete fills the screen no matter how the scoring goes.
 *
 * A per-session random jitter breaks ties so two people with identical
 * profiles don't see an identical feed, and so refreshing shows movement.
 * It's deliberately small — 0.06 — and seeded, so the order stays stable
 * while you scroll rather than reshuffling underneath your thumb.
 *
 * WHAT THIS MODEL DOES NOT DO
 * ───────────────────────────
 * It ranks the pool the client already fetched (~80 newest posts). It is not a
 * retrieval system: it can only order what it was given, so nothing here can
 * surface a great post from six months ago. It also can't measure true
 * engagement RATE, because impressions aren't tracked — likes-per-hour is a
 * proxy for it. Both are the right next investments if this needs to scale;
 * see docs/feed-ranking.md.
 */

// ─── Tunable weights. These sum to 1.0 by convention, not by requirement. ─────
export const FEED_WEIGHTS = {
  newPostExposure: 0.3,
  engagementRate: 0.28,
  recency: 0.18,
  relevance: 0.16,
  underExposed: 0.08,
} as const;

/** How long a new post keeps its guaranteed-exposure boost. */
export const EXPOSURE_WINDOW_HOURS = 24;

/** Recency half-life: a 72-hour-old post scores half a brand-new one. */
export const RECENCY_HALF_LIFE_HOURS = 72;

/** Likes-per-hour that counts as a "strong" rate — the top of the 0–1 squash. */
const STRONG_LIKES_PER_HOUR = 4;

/** Session jitter — enough to vary the feed, small enough not to lead it. */
const JITTER_WEIGHT = 0.06;

/** Diversity penalties, applied at selection time. */
const CONSECUTIVE_AUTHOR_PENALTY = 0.35;
const REPEAT_AUTHOR_PENALTY = 0.16;

/** Below this many wins an athlete counts as still building a record. */
const ESTABLISHED_WINS = 5;

export interface ViewerContext {
  userId?: string | null;
  sport?: string | null;
  school?: string | null;
  state?: string | null;
  followedIds: Set<string>;
}

export interface ScoredPost {
  post: Post;
  score: number;
  /** Per-term contributions — powers the debug overlay and makes tuning legible. */
  terms: Record<keyof typeof FEED_WEIGHTS | "jitter", number>;
}

/** Deterministic 0–1 hash. Same seed + id always yields the same value. */
function seededUnit(seed: number, value: string): number {
  let hash = seed ^ 2166136261;
  for (let index = 0; index < value.length; index += 1) {
    hash ^= value.charCodeAt(index);
    hash = Math.imul(hash, 16777619);
  }
  return (hash >>> 0) / 4294967296;
}

export function createFeedSeed(): number {
  return Math.floor(Math.random() * 2147483647);
}

function hoursSince(post: Post, now: number): number {
  const createdMs = timestampToMs(post.createdAt);
  if (!createdMs) return EXPOSURE_WINDOW_HOURS; // undated → treat as mid-window
  return Math.max(0, (now - createdMs) / 3_600_000);
}

/** Case- and whitespace-insensitive comparison for free-text identity fields. */
function sameText(a?: string | null, b?: string | null): boolean {
  if (!a || !b) return false;
  return a.trim().toLowerCase() === b.trim().toLowerCase();
}

// ─── Individual terms, each returning 0–1 ────────────────────────────────────

/** 1 at posting time, 0 once the exposure window has elapsed. */
export function newPostExposureTerm(ageHours: number): number {
  if (ageHours >= EXPOSURE_WINDOW_HOURS) return 0;
  return 1 - ageHours / EXPOSURE_WINDOW_HOURS;
}

/**
 * Likes per hour, log-damped and squashed to 0–1.
 *
 * The first hour is clamped to 1 so a post that gets two likes in its opening
 * minutes doesn't register an absurd 120/hour rate.
 */
export function engagementRateTerm(likesCount: number, ageHours: number): number {
  const hours = Math.max(1, ageHours);
  const perHour = Math.max(0, likesCount) / hours;
  const damped = Math.log1p(perHour) / Math.log1p(STRONG_LIKES_PER_HOUR);
  return Math.min(1, damped);
}

/** Exponential decay on the configured half-life. */
export function recencyTerm(ageHours: number): number {
  return Math.pow(0.5, ageHours / RECENCY_HALF_LIFE_HOURS);
}

/**
 * Shared context with the viewer. Partial credit per signal, so an athlete at
 * the same school in a different sport still ranks above a stranger.
 */
export function relevanceTerm(post: Post, viewer: ViewerContext): number {
  let score = 0;
  if (sameText(post.sport, viewer.sport)) score += 0.45;
  if (sameText(post.school, viewer.school)) score += 0.35;
  if (sameText(post.state, viewer.state)) score += 0.2;
  return Math.min(1, score);
}

/**
 * Lift for athletes the viewer hasn't already followed, and for those without
 * an established win record. Own posts get nothing — the viewer has seen them.
 */
export function underExposedTerm(post: Post, viewer: ViewerContext): number {
  if (!post.userId || post.userId === viewer.userId) return 0;
  let score = 0;
  if (!viewer.followedIds.has(post.userId)) score += 0.6;
  // likesCount is the only per-post reach proxy available client-side.
  if (post.likesCount < ESTABLISHED_WINS) score += 0.4;
  return Math.min(1, score);
}

// ─── Scoring ─────────────────────────────────────────────────────────────────

export function scorePost(
  post: Post,
  viewer: ViewerContext,
  seed: number,
  now: number = Date.now()
): ScoredPost {
  const ageHours = hoursSince(post, now);

  const terms = {
    newPostExposure: newPostExposureTerm(ageHours),
    engagementRate: engagementRateTerm(post.likesCount, ageHours),
    recency: recencyTerm(ageHours),
    relevance: relevanceTerm(post, viewer),
    underExposed: underExposedTerm(post, viewer),
    jitter: seededUnit(seed, post.id),
  };

  const score =
    terms.newPostExposure * FEED_WEIGHTS.newPostExposure +
    terms.engagementRate * FEED_WEIGHTS.engagementRate +
    terms.recency * FEED_WEIGHTS.recency +
    terms.relevance * FEED_WEIGHTS.relevance +
    terms.underExposed * FEED_WEIGHTS.underExposed +
    terms.jitter * JITTER_WEIGHT;

  return { post, score, terms };
}

/**
 * Rank a pool of posts for one viewer.
 *
 * Selection is greedy with diversity penalties applied as each slot is filled,
 * rather than a plain sort. A sort can't express "this post is excellent but
 * the last three were all by the same athlete" — the penalty has to depend on
 * what has already been placed.
 */
export function rankFeed(
  posts: Post[],
  viewer: ViewerContext,
  seed: number,
  now: number = Date.now()
): Post[] {
  if (posts.length <= 1) return posts.slice();

  const candidates = posts.map((post) => scorePost(post, viewer, seed, now));
  const ranked: Post[] = [];
  const authorCounts = new Map<string, number>();

  while (candidates.length > 0) {
    let bestIndex = 0;
    let bestAdjusted = Number.NEGATIVE_INFINITY;

    for (let index = 0; index < candidates.length; index += 1) {
      const candidate = candidates[index];
      const authorId = candidate.post.userId;
      const seenCount = authorCounts.get(authorId) ?? 0;
      const followsPrevious =
        ranked.length > 0 && ranked[ranked.length - 1].userId === authorId;

      const adjusted =
        candidate.score -
        seenCount * REPEAT_AUTHOR_PENALTY -
        (followsPrevious ? CONSECUTIVE_AUTHOR_PENALTY : 0);

      if (adjusted > bestAdjusted) {
        bestAdjusted = adjusted;
        bestIndex = index;
      }
    }

    const [chosen] = candidates.splice(bestIndex, 1);
    ranked.push(chosen.post);
    authorCounts.set(
      chosen.post.userId,
      (authorCounts.get(chosen.post.userId) ?? 0) + 1
    );
  }

  return ranked;
}

/** Build a viewer context from the signed-in profile. */
export function viewerContextFrom(
  userId: string | null | undefined,
  profile: UserProfile | null | undefined,
  followedIds: Set<string>
): ViewerContext {
  return {
    userId: userId ?? null,
    sport: profile?.sport || profile?.athleteType || null,
    school: profile?.school || profile?.teamName || null,
    state: profile?.state || null,
    followedIds,
  };
}

/**
 * Human-readable explanation of why a post ranked where it did.
 * Used by the DEV-only debug overlay; safe to call anywhere.
 */
export function explainScore(scored: ScoredPost): string {
  const parts = (
    Object.keys(FEED_WEIGHTS) as (keyof typeof FEED_WEIGHTS)[]
  ).map(
    (key) =>
      `${key} ${(scored.terms[key] * FEED_WEIGHTS[key]).toFixed(3)} (raw ${scored.terms[key].toFixed(2)})`
  );
  parts.push(`jitter ${(scored.terms.jitter * JITTER_WEIGHT).toFixed(3)}`);
  return `total ${scored.score.toFixed(3)} = ${parts.join(" + ")}`;
}
