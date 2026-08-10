# Who sees what — the Momentum feed formula

August 9, 2026 · implemented in `services/feedRanking.ts`

This document is the spec. The code follows it. If you want to change how the
feed behaves, change the weights here and in `FEED_WEIGHTS`, in that order.

---

## The problem

Rank by raw like count and a social feed calcifies in weeks. A post with 400
likes outranks a post with 4 forever — regardless of how many people ever saw
either one. The athletes who arrived first keep winning, and a freshman who
posts their first highlight is seen by nobody.

On a recruiting platform that isn't a boring feed, it's the product failing at
its one job. A sophomore with 11 followers and one extraordinary clip has to be
able to get seen, or there is no reason for them to be here.

The previous model didn't do this either, in the opposite direction: its random
term carried weight `0.45` out of ~1.0, so the feed was mostly shuffle. A great
new highlight and a stale one had near-identical odds, and nothing about the
viewer mattered at all.

---

## The model

Score is a weighted sum of five terms. Each term returns **0–1**, so the
weights are directly comparable — a weight of `0.30` really is roughly twice as
influential as `0.15`.

| # | Term | Weight | What it measures |
|---|------|--------|------------------|
| 1 | New-post exposure | **0.30** | How much of the guaranteed opening window is left |
| 2 | Engagement rate | **0.28** | Likes per hour, log-damped |
| 3 | Recency | **0.18** | Exponential decay, 72-hour half-life |
| 4 | Relevance | **0.16** | Shared sport / school / state with the viewer |
| 5 | Under-exposed | **0.08** | Not-yet-followed author, low like count |
|   | *Session jitter* | *0.06* | *Tie-breaking variety* |

### 1 · New-post exposure — 0.30

Every post gets a boost for its first **24 hours** (`EXPOSURE_WINDOW_HOURS`),
full strength at minute zero, decaying linearly to zero.

This is the fairness guarantee. A new post is put in front of people on the
merit of being new; what happens in that window then decides whether terms 2
and 3 keep it alive. Nobody has to earn their first impression.

It's the largest single weight on purpose. It's the term that makes a brand-new
athlete's first highlight competitive with an established athlete's.

### 2 · Engagement rate — 0.28

`likes / hours since posting`, passed through `log1p` and squashed to 0–1
against a reference "strong" rate of **4 likes/hour**.

Rate, not total, is the whole point: a 6-hour-old post with 20 likes beats a
3-week-old post with 200. Log damping keeps one viral post from flattening
everything else to near-zero.

The first hour is clamped to 1 so two likes in the opening minutes don't
register as 120/hour.

### 3 · Recency — 0.18

`0.5 ^ (age / 72h)`. A three-day-old post scores half a brand-new one.

Kept independent of engagement so the feed stays current even when nobody has
engaged with anything — which is the state a young platform is actually in.

### 4 · Relevance — 0.16

Partial credit, capped at 1:

- same sport → **0.45**
- same school → **0.35**
- same state → **0.20**

Additive rather than exclusive, so an athlete at your school in a different
sport still ranks above a stranger. This makes the feed feel local without
hard-filtering anyone out of it — there is no "only my school" mode, because
that's how a feed dies.

Requires the viewer's profile. If it hasn't hydrated, this term is 0 and
ranking degrades to recency + engagement. Nothing breaks.

### 5 · Under-exposed — 0.08

- author not already followed → **0.6**
- author has fewer than 5 likes on this post → **0.4**

A deliberate counterweight to terms 2 and 4, both of which naturally favour
the already-popular and the already-connected. Small, because it's a
correction, not a thumb on the scale.

Own posts score 0 — you've seen them.

### Session jitter — 0.06

A seeded hash of the post id. Small enough not to lead the ranking, large
enough that two athletes with identical profiles don't see an identical feed
and that pull-to-refresh visibly moves.

**Seeded, not random per render.** The seed changes only on pull-to-refresh, so
the order stays stable while you scroll rather than reshuffling under your
thumb.

---

## Diversity penalties

Applied during **selection**, not scoring — they depend on what has already
been placed, which a plain sort cannot express.

| Penalty | Value | Applies when |
|---------|-------|--------------|
| Consecutive author | **−0.35** | Previous slot was the same athlete |
| Repeat author | **−0.16** each | Per post already placed by that athlete |

Selection is greedy: fill each slot with the highest adjusted score, then
update the counts. Without these, one prolific athlete fills the screen no
matter how the scoring goes.

−0.35 is larger than any single term's full weight except exposure, which is
intentional: back-to-back posts by the same person should essentially never
happen unless there's nothing else in the pool.

---

## What this model does NOT do

Stated plainly, because these limits matter more than the tuning:

**It ranks, it doesn't retrieve.** It orders the ~80 newest posts the client
already fetched. Nothing here can surface a great post from six months ago —
it was never in the pool. Real retrieval means a server-side candidate
generator.

**It has no impression data.** "Engagement rate" is likes-per-hour, a *proxy*
for the real thing (likes per person who saw it). A post shown to 10 people
that got 5 likes is far stronger than one shown to 1,000 that got 8, and this
model cannot tell them apart. **Logging impressions is the single highest-value
next investment** — it's what turns terms 1 and 2 from approximations into
measurements.

**It's client-side.** Every viewer computes their own ranking. That's fine at
this scale and means no ranking infrastructure to run, but it also means the
weights ship in the app and can't be tuned without a release, and there's no
way to A/B test them.

**Comments and battle activity aren't counted.** `commentsCount` is optional
and often absent, and battle participation isn't joined into the post document.
Both are stronger engagement signals than likes and should be folded into term
2 once they're reliably present.

---

## Tuning

Weights live in one place:

```ts
// services/feedRanking.ts
export const FEED_WEIGHTS = {
  newPostExposure: 0.3,
  engagementRate:  0.28,
  recency:         0.18,
  relevance:       0.16,
  underExposed:    0.08,
};
```

They sum to 1.0 by convention, not requirement — the sum only sets the scale
relative to the fixed penalties, so if you change the total, revisit
`CONSECUTIVE_AUTHOR_PENALTY` and `REPEAT_AUTHOR_PENALTY` too.

Common adjustments:

| Complaint | Change |
|-----------|--------|
| "Feed feels stale" | Raise `recency`, lower `engagementRate` |
| "New athletes never get seen" | Raise `newPostExposure` or `EXPOSURE_WINDOW_HOURS` |
| "Too many strangers" | Raise `relevance`, lower `underExposed` |
| "Same people every time" | Raise `underExposed` and the repeat-author penalty |
| "Feels random" | Lower `JITTER_WEIGHT` |

`explainScore(scored)` returns a per-term breakdown of any post's score —
useful for a DEV overlay when a specific post ranks somewhere surprising.

---

## Where it's used

`hooks/usePosts.ts` → `rankFeed(posts, viewer, seed)` for the For You feed.

The Following feed is deliberately **not** ranked — it's reverse-chronological
posts from athletes you chose to follow. Ranking a feed the user curated
themselves takes away the one place they have full control.
