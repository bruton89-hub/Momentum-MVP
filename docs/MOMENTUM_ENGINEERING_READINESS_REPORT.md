# Momentum — Professional-Grade Engineering Readiness Report

**Date:** 17 August 2026
**Scope:** Architecture audit, P0/P1 hardening, test expansion, and safe non-production capacity benchmarking
**Production project:** `momentum-app-prod-1e870` — **never contacted during this mission**

---

## 1. Executive Summary

Momentum's backend was already in better shape than most MVPs: battle finalization, voting, liking and post deletion are server-authoritative callables, vote counters are reconciled against authoritative markers, notifications use deterministic IDs, and creation paths use pre-allocated document IDs for idempotent retries. The August release pass closed a genuinely serious set of forgery and duplication defects.

What this mission found is that the **server-authoritative paths are solid, but the client-write paths were under-validated**. Six verified P1 issues all shared one root cause: Firestore rules validated *who* was writing but not *what* they were writing. A modified client could publish a post carrying another athlete's video, self-grant a `verified` badge, pin content to the top of the feed with a forged timestamp, enter a battle with stolen media, or impersonate another athlete in a comment — all through documented, ordinary API calls.

Six narrow fixes were implemented (five in `firestore.rules`, one in `functions/src/index.ts`). No product behaviour was redesigned. The test suite grew from **78 to 114 automated tests, all passing**, including a new concurrency/integrity suite that verifies persisted state rather than return values.

A complete, production-guarded load-test harness now lives in `tools/load-test/`. It refuses to run against production, is proven to refuse by 15 mandatory safety tests, and was used to benchmark the app against the Firebase Emulator Suite.

**The single most important integrity result: across every concurrency level tested — including 50 users voting simultaneously on one battle — not one duplicate vote, lost write, counter drift, or incorrect battle winner was observed.** Momentum's transactional core is correct under contention. That is the hardest property to get right and Momentum has it.

The most important capacity finding is a cost-structure finding, not a latency one: **a single feed session costs 80 Firestore document reads plus a full re-read of the user's follow list, and this is paid on every feed load.** At the modelled behaviour that is ~578 reads per active user per day, which is what actually governs Momentum's economics as it grows.

---

## 2. Architecture Findings

### 2.1 Stack

Expo SDK 50 / React Native 0.73 / expo-router 3, Firebase Web SDK 10, Zustand for auth state, Cloud Functions v2 (Node 20) in `us-central1`.

### 2.2 Data model

| Collection | Doc ID convention | Written by |
|---|---|---|
| `users/{uid}` | Firebase Auth uid | client (profile), **server only** for `wins`/`losses`/`posts` |
| `posts/{id}` | `post_{base36}_{random}` (pre-allocated) | client create; server delete |
| `battles/{id}` | `battle_{base36}_{random}` | client create/accept; **server only** for `status:completed\|expired`, `winner`, `statsRecorded`, vote counters |
| `votes/{battleId}_{uid}` | deterministic compound | **server only** (`castBattleVote`) |
| `likes/{postId}_{uid}` | deterministic compound | **server only** (`setPostLike`) |
| `follows/{follower}_{following}` | deterministic compound | client |
| `saves/{postId}_{uid}` | deterministic compound | client, **private to owner** |
| `comments/{autoId}` | auto | client |
| `notifications/{typed deterministic id}` | e.g. `follow_{a}_{b}` | client (rules-validated) + server (battle results) |

Four callables: `finalizeBattle`, `castBattleVote`, `setPostLike`, `deletePost`.

### 2.3 Notable architectural properties

**No Firestore listeners anywhere.** Every read is a one-shot `getDocs`/`getDoc`. This is a deliberate and, at this stage, correct cost decision — it avoids sustained connection billing — but it means all freshness comes from explicit refetches and TTL caches (60s feed freshness, 30s battle cache).

**Feed retrieval and feed ranking are separate concerns.** `usePosts` fetches the newest 24 posts, paints, then expands by 56 more in the background; `services/feedRanking.ts` then ranks only what was already fetched. The ranker is client-side, so weights ship with the app binary and cannot be tuned or A/B tested without a release.

**A three-alias author fan-out is still active in production.** `services/postRepository.ts` queries `userId`, `authorId` *and* `uid` in parallel because early posts carried only one of them. Modern posts carry all three, so they are returned — and billed — three times. The consolidation is written and ready behind `EXPO_PUBLIC_POSTS_USERID_BACKFILLED`, which is currently `false`. Measured impact below.

**`users.posts` is never incremented.** `deletePost` decrements it, rules forbid clients writing it, and no code path increments it. Both profile screens render `posts.length` from the fetched grid instead, so the field is dead but harmless — and it silently floors at 0, so it cannot go negative.

---

## 3. Risks Found

### P0 — none

No unauthenticated data access, no destructive production path, no account-compromise vector, and no youth-safety exposure was found. The `users`, `posts`, `battles`, `votes`, `likes`, `saves`, `follows`, `comments` and `notifications` rules all require authentication, and `saves` are correctly private to their owner.

### P1 — six verified issues (all fixed)

Each was verified by writing a test that performed the attack against the real rules in the emulator and observing it succeed before the fix, then fail after.

---

**P1-1 · Post creation accepted arbitrary fields, forged counters, forged timestamps, and stolen media**

*File:* `firestore.rules`, `match /posts/{postId}` → `allow create`
*Original rule:* `isSignedIn() && request.resource.data.userId == request.auth.uid` — ownership only.

*Failure scenarios:*
- Publish a post whose `mediaUrl` points at `posts/{victimUid}/...` — another athlete's highlight republished as your own. Storage rules protect *writing* objects but nothing bound a post document to media the author actually owns.
- Create a post with `likesCount: 50000` — `normalizePost` reads the field directly, and `feedRanking` scores on engagement, so a forged counter buys feed placement.
- Create a post with `verified: true`, `momentumScore: 999`, `battleWon: true`, `isLive: true` — all read and rendered by `normalizePost`. Self-granted credibility in a recruiting app aimed at minors.
- Create a post with `createdAt` a year in the future. The feed's sole ordering key is `createdAt desc`, so the post pins to the top of every feed permanently.

*Fix:* `hasValidNewPostShape()` — an exact key allowlist (exactly the fields `createPost` writes, nothing more), all three author aliases forced to the writer, `likesCount == 0`, `mediaType` constrained, caption length bounded, media path required to live under the author's own `posts/{uid}/` prefix, timestamps bounded to `[now-48h, now+15m]`, and displayed `username` required to match the writer's real profile handle (`''` tolerated for the pre-hydration window the client genuinely has).

---

**P1-2 · Any athlete could self-grant verification badges and ranking status**

*File:* `firestore.rules`, `match /users/{userId}`
*Original rule:* blocked only `wins`, `losses`, `posts`.

*Failure scenario:* `updateDoc(doc(db,'users',myUid), { verified: true, coachVerified: true, topRanked: true, momentumScore: 100 })`. `normalizeUserProfile` reads every one of these and `ProfileHeader` renders them as badges. In a platform where college coaches evaluate teenage athletes, a self-granted "coach verified" badge is a serious integrity and safety problem.

*Fix:* `touchesProtectedUserFields()` blocks `verified`, `isVerified`, `coachVerified`, `tournamentChampion`, `topRanked`, `momentumScore` alongside the existing stat fields, on both create and update.

---

**P1-3 · Battle entries were not bound to real posts owned by the players**

*File:* `firestore.rules`, `match /battles/{battleId}`
*Original rule:* validated battle *shape* (neutral counters, valid category/duration) and *who* the creator was, but treated `playerA`/`playerB` — including `mediaUrl`, `postId`, `username` — as free-form data.

*Failure scenarios:*
- Enter a battle with `playerB.mediaUrl` set to a victim's video: their highlight competes under your name, and every vote it earns is recorded to you.
- Challenge a victim with a `playerA` entry whose media they never posted — they appear in a contest they cannot recognise, and `finalizeBattle` records a real loss against their profile.
- Forge `playerA.username` so the battle displays an impersonated athlete.

*Fix:* `playerEntryBackedByOwnPost()` — each entry's `postId` must resolve to a real post whose resolved owner equals that entry's `userId`, its `mediaUrl` must equal that post's `mediaUrl` or `originalMediaUrl`, and its `username` must match the backing post's. Applied to open creates, direct-challenge creates (both entries), *and* challenge acceptance. `createdAt` also bounded.

---

**P1-4 · Comment author identity could be forged, and propagated into notifications**

*File:* `firestore.rules`, `match /comments/{commentId}`
*Original rule:* validated `userId`, `postId` and text length, but not `username`, `avatar`, or the key set.

*Failure scenario:* write a comment with `username: "CoachSmith"`. The comment-notification rule (`isValidCommentNotification`) validates the notification's `subjectUsername` *against the comment document* — so a forged comment name propagates into the recipient's notification feed with full server-side blessing.

*Fix:* exact key allowlist, bounded `createdAt`, and `matchesAuthorUsername()` on the displayed name.

---

**P1-5 · `finalizeBattle` read every vote document inside its transaction**

*File:* `functions/src/index.ts`, `finalizeBattle`
*Original code:* `await tx.get(db.collection("votes").where("battleId","==",battleId))` then counted in a loop.

*Failure scenario:* the reconciliation read scales linearly with vote volume. A popular battle with thousands of votes pushes the transaction toward Firestore's transaction size and time limits; once exceeded, the battle can **never** finalize — no winner, no stats, permanently stuck — and every client retry re-reads the whole vote set, amplifying cost against a battle that is already failing.

*Fix:* three `count()` aggregation queries (total, side A, side B) through `tx.get`, keeping the check exact and serialized against concurrent votes while costing ~1 read per 1,000 markers instead of one per marker. Malformed markers are still detected: `total != A + B`. Verified by a new test that plants a `side: "Z"` marker and asserts finalization refuses.

---

**P1-6 · Username search index could drift from the displayed username**

*File:* `firestore.rules`, `match /users/{userId}`

*Failure scenario:* `isUsernameTaken` queries `usernameLower` only. Writing `username: "VictimName"` with `usernameLower: "zzz"` claims the display handle while evading every duplicate check — two athletes visibly sharing one handle, with the impersonator invisible to search.

*Fix:* `usernameSearchFieldConsistent()` requires `usernameLower == username.lower()` on create and update. Legacy docs with no `usernameLower` can still edit unrelated fields (verified by test).

*Also fixed alongside:* `follows` accepted self-follows and empty targets (client-side guard only). Rules now require a non-empty `followingId != auth.uid`.

### P2 — professional-grade gaps, not fixed this phase

1. **Username uniqueness is checked, not enforced.** `isUsernameTaken` is a read-then-write race; two simultaneous registrations can claim the same handle. A proper fix is a `usernames/{normalized}` reservation collection written in a transaction — the hardened fixture already anticipates it. This is a schema addition, out of scope for a no-redesign phase.
2. **App Check is not enforced** on any callable (`enforceAppCheck: false`). Documented as deliberate in `FIREBASE_COST_GUARDRAILS.md`, but it means the callables are reachable by any client with a valid ID token.
3. **Node 20 Functions runtime is deprecated**, decommissioning 30 Oct 2026. Migration must be planned.
4. **Votes and likes have no client retry.** `submitVote` calls the callable once; a transient failure surfaces an error and the athlete's vote is simply gone. Measured directly (§7.5): at 25–50 concurrent voters, timed-out votes did *not* commit — the work is genuinely lost, not silently applied.
5. **`cleanup-firestore.js` guards production only by a `FIREBASE_PROJECT_ID` env var and a free-text prompt.** It is the most destructive script in the repo. It should adopt the same hard project-ID guard the new harness uses.

### P3 — future scale / maintainability

1. `fetchFollowedIds` reads the user's entire follow list on every feed load, unbounded — 25 reads/session at the modelled average, and it grows without limit for popular users.
2. Force-quitting between a Storage upload and its Firestore write still orphans the object (known, documented).
3. Feed ranking is client-side; weights cannot be tuned without a release, and there is no impression data, so "engagement rate" is a likes-per-hour proxy.
4. The three-alias fan-out remains on in production (see §7.4 for measured cost).

---

## 4. P0/P1 Fixes — implementation and proof

| # | Issue | Files changed | Tests proving the fix |
|---|---|---|---|
| P1-1 | Post shape/media/identity/timestamp forgery | `firestore.rules` | `test/firestore.rules.hardening.test.js` — 6 tests: exact client payload accepted; forged counters rejected; credibility keys rejected; implausible timestamps rejected; foreign/external media rejected; impersonated identity rejected |
| P1-2 | Self-granted credibility badges | `firestore.rules` | 2 tests: create + update rejection of all six fields; normal profile lifecycle still works |
| P1-3 | Battle entry provenance | `firestore.rules` | 2 tests: both legitimate creation shapes accepted; stolen media / foreign post / ghost post / forged name / pinned timestamp rejected; accept-path smuggling rejected |
| P1-4 | Comment identity forgery | `firestore.rules` | 1 test: legitimate + empty-username accepted; forged name, extra keys, pinned timestamp rejected |
| P1-5 | Unbounded transactional vote scan | `functions/src/index.ts` | `functions/test/engagementConcurrency.test.js` — tampered counters refused; malformed markers detected via aggregate path; 25-voter concurrent test finalizes correctly |
| P1-6 | Search-index drift | `firestore.rules` | 1 test: create + update drift rejected; legacy docs still editable |
| — | Self-follow / empty follow target | `firestore.rules` | 1 test |

**Deliberate compatibility work:** every "legitimate" assertion replays the *exact* payload the shipping client writes — `createPost`'s full field set including `authorId`/`uid`/`authorAvatar`/`userAvatar`/`updatedAt`, `createBattle`/`createLiveBattle`/`acceptChallenge`, and `createComment`. Three pre-existing rules tests had their fixtures updated (backing posts seeded, media URLs given real owned-object paths) because the new provenance checks require them; **no assertion was weakened or removed.**

---

## 5. Validation

All suites run in the cloud sandbox against the Firebase Emulator Suite.

| Suite | Result |
|---|---|
| App TypeScript (`tsc --noEmit`) | **PASS** |
| Functions TypeScript build | **PASS** |
| Battle sections / creation mutation / remediation guards / media upload | **20/20** |
| Firestore rules (existing 34 + new 13) | **47/47** |
| Storage rules | **8/8** |
| Functions contracts | **7/7** |
| Battle finalization integration | **3/3** |
| Post deletion integration | **6/6** |
| **Engagement concurrency & integrity (new)** | **8/8** |
| **Load-test safety guard (new, mandatory)** | **15/15** |
| **Total** | **114 passing, 0 failing** (baseline: 78) |

Not run: Expo Doctor and production EAS/web exports were out of scope for this phase and unnecessary — no application source, navigation, or UI file was modified. The changed files are `firestore.rules`, `functions/src/index.ts`, `firebase.json` (emulator ports), `package.json` (scripts), test files, and the new `tools/load-test/` tree.

---

## 6. Production Safety

| Assertion | Status |
|---|---|
| Production load tested | **NO** — all traffic went to `demo-momentum-loadtest` on the local Emulator Suite |
| Production data seeded | **NO** |
| Production data deleted or altered | **NO** |
| Deployed to production | **NO** — no `firebase deploy` was run |
| Production credentials used | **NO** — no service account key exists in the sandbox; `demo-*` projects are offline-only by construction |

**Identified write/deploy-capable surfaces:** `.firebaserc` (default `momentum-app-prod-1e870`), `.env` and `GoogleService-Info.plist` (both → prod), `google-services.json` (Android → `momentum-live-483819`), `scripts/cleanup-firestore.js`, `scripts/rollback-firestore.js`, `scripts/backfill-*.js`, `scripts/expire-unmatched-battles.js`, `functions/package.json` `deploy` script, `eas.json` production profile.

**The guard** (`tools/load-test/src/guard.js`) refuses on the *actual Firebase project ID*, never on environment names. Both production IDs are blocklisted, including case variants, whitespace, and embedding. Refusal happens **before any client, Admin SDK, or connection is constructed**, and returns:

```
MOMENTUM LOAD TEST REFUSED — PRODUCTION PROJECT DETECTED
```

No override can bypass it: a test asserts that even with `LOADTEST_ALLOW_PROJECT` *and* `LOADTEST_ALLOW_CLOUD` both set to production, the guard still refuses. Non-production, non-`demo-*` projects require two explicit acknowledgements. `demo-*` projects additionally require loopback-only emulator hosts. Seeder and cleanup share the identical guard, proven by their own tests.

---

## 7. Capacity Benchmark

### 7.1 Environment — and what it can and cannot tell us

| | |
|---|---|
| Where | Anthropic cloud sandbox, **2 vCPU / 7 GB RAM** |
| Backend | Firebase Emulator Suite (Firestore 1.21.0, Auth, Functions, Storage), single Java process |
| Project | `demo-momentum-loadtest` (offline-only) |
| Driver | Node 22 REST client issuing the app's exact query shapes, security rules fully enforced |
| Dataset | 1,200 synthetic athletes; 1k / 10k / 50k / 100k posts; 41 live battles; 8 follows per athlete |
| Workload mix | 60% browsing / 25% engaged / 10% creator / 5% battle — **unchanged from the brief** |

**This is a single-process emulator on 2 vCPUs. It is not a distributed Firestore.** Latency and throughput numbers below therefore describe *this environment*, and I have separated them from the findings that are properties of Momentum's architecture and hold anywhere. Two controlled probes were built specifically to make that separation evidence-based rather than asserted.

### 7.2 Concurrency tiers

| Concurrent users | Status | P50 | P90 | P95 | P99 | Error rate | Throughput | Integrity |
|---|---|---|---|---|---|---|---|---|
| 10 | PASS | 48.6 ms | 110.9 ms | 129 ms | 3084 ms | 0.00% | 10.1 ops/s | clean |
| 25 | PASS | 50.9 ms | 165.3 ms | 277 ms | 5693 ms | 0.00% | 16.7 ops/s | clean |
| 50 | PASS | 32.9 ms | 85.4 ms | 143.5 ms | 280.5 ms | 0.14% | 35.4 ops/s | clean |
| 100 | **FAIL** | 2542 ms | 4944 ms | 5723 ms | 30003 ms | 1.51% | 26.0 ops/s | clean |
| 250 | **FAIL** | 4970 ms | 13928 ms | 15000 ms | 15168 ms | 5.13% | 41.8 ops/s | clean |

Escalation stopped at 250 per the brief's rule — tier 100 had already crossed a clear failure threshold, so 500/1,000/2,500/5,000/10,000 were **not run**. Running them would have measured the emulator's saturation curve, not Momentum's.

Driver event-loop lag stayed ≤ 120 ms p95 at every tier (`saturated: false`), so **the harness was never the bottleneck** — the limit is genuinely backend-side.

The two failures at tier 50 were both *correct system behaviour*, not defects: one `ALREADY_EXISTS` (duplicate-vote protection working) and one `PERMISSION_DENIED` (a follow write correctly refused).

At tier 100 the failure signature is specific and worth naming: **all 25 failures were `setPostLike` timeouts. Every read operation succeeded.** At tier 250 the failures spread into feed reads (136 timeouts).

### 7.3 Feed benchmark and dataset scaling

| Dataset | P50 | P95 | Duplicate docs | **Firestore reads per feed session** |
|---|---|---|---|---|
| 1,000 posts | 588 ms | 1573 ms | 0 | **80** |
| 10,000 posts | 982 ms | 1640 ms | 0 | **80** |
| 50,000 posts | 4942 ms | 6136 ms | 0 | **80** |
| 100,000 posts | *emulator became unresponsive* | — | — | — |

**Reads per feed session are exactly constant at 80 across a 50× dataset increase**, and zero duplicate documents were returned at any size. The pagination is cursor-based (`startAfter`) and correct.

The latency growth needed to be explained rather than assumed, so an index probe was built (`tools/load-test/src/indexProbe.js`). At 50k posts:

- `limit(1)` on posts: **355 ms**
- `limit(24)` on posts: **390 ms** → limit sensitivity **1.10×**
- `limit(30)` on the 41-document battles collection, identical query shape: **36 ms** → collection sensitivity **10.7×**

Asking for 1 document costs the same as asking for 24, while the same query shape on a small collection is 10× faster. **Latency tracks collection size, not result size** — the emulator is scanning. Production Firestore serves `orderBy(createdAt desc).limit(24)` from its automatic single-field index in time proportional to the page, not the corpus.

**Conclusion: the feed latency degradation at 50k posts is an emulator artifact and must not be read as a production forecast. The architecturally meaningful result is the constant 80 reads/session — Momentum's feed cost scales with *users*, not with corpus size.** That is the right property to have.

### 7.4 Athlete profile benchmark

20 concurrent profile views, ~8 posts per athlete:

| Path | P50 | P95 | Firestore reads (20 sessions) | Reads/view |
|---|---|---|---|---|
| Legacy 3-alias fan-out (**production default today**) | 6724 ms | 6820 ms | 560 | 28 |
| Consolidated single query (`EXPO_PUBLIC_POSTS_USERID_BACKFILLED=true`) | 156 ms | 1604 ms | 200 | 10 |

**2.8× the reads and ~43× the P50 latency**, for identical rendered output. The read multiple is architecture-derived and holds in production; the latency multiple is inflated by the emulator's scan behaviour but the *direction* is real (three round trips vs one, and up to 90 documents deserialized vs 30).

The backfill script and the flag already exist and are tested. This is the single highest-value change available and it requires no new code.

### 7.5 Battle stress test

| Concurrent voters | Status | Expected votes | Persisted votes | Vote markers | Duplicates applied | Winner correct | Error rate (round 1) | P95 |
|---|---|---|---|---|---|---|---|---|
| 25 | **integrity clean** | 4 | **4** | 4 | **0** | ✅ | 100% (all timeouts) | 30.0 s |
| 50 | **integrity clean** | 2 | **2** | 2 | **0** | ✅ | 100% (all timeouts) | 48.4 s |
| 100+ | not completed — exceeded the environment's transaction throughput | | | | | | | |

Read this table carefully, because it contains both the best and the worst news in this report.

**The integrity result is excellent and is environment-independent.** Every vote that committed was counted exactly once. `votesA`/`votesB` matched the authoritative vote markers exactly, every time. Not a single duplicate vote was applied — every second attempt by a user who already held a marker was refused. Every vote marker carried its correct deterministic `{battleId}_{uid}` ID. Finalization computed the correct winner from persisted counters in every run, and recorded stats exactly once. **No lost writes, no double counting, no phantom votes.**

**The throughput result is dominated by the environment.** Only 4 of 25 votes committed within the 30-second client timeout. Before attributing that to Momentum, a second controlled probe (`tools/load-test/src/contentionProbe.js`) ran the same concurrency twice — once with every writer hitting its *own* document, once with all writers hitting *one shared* document:

| Concurrency | Disjoint docs | Shared doc | Latency ratio | Integrity |
|---|---|---|---|---|
| 10 | 10/10 ok, p95 8.3 s | 10/10 ok, p95 7.4 s | 0.90× | consistent |
| 25 | 25/25 ok, p95 13.0 s | 25/25 ok, p95 16.7 s | 1.28× | consistent |

Writes to **completely disjoint documents are just as slow as writes to one shared document**. That is the signature of environment-wide transaction serialization in the emulator, not per-document contention in Momentum's data model. Production Firestore does not serialize transactions across unrelated documents.

**One genuinely production-relevant reliability finding did come out of this**, and it is not an emulator artifact: of the 25 timed-out votes at 25 voters, **0 had actually committed**; at 50 voters, 1 of 50 had. So when a vote fails, the athlete's vote is truly gone — and `submitVote` in `hooks/useBattles.ts` **does not retry**. The user sees an error and must notice and re-tap. Under any real burst (the exact moment a battle goes viral), votes will be silently dropped from the user's perspective. This is P2-4 above and is the highest-value reliability fix available.

### 7.6 Media benchmark (isolated track)

25 concurrent uploads of 64 KB synthetic fixtures — deliberately **not** mixed into the Firestore benchmark, and no large real video was transferred.

| Metric | Result |
|---|---|
| Upload success | 25/25 |
| Upload P50 / P95 | 405 ms / 619 ms |
| Metadata writes | all succeeded |
| Download/playback read-back | all succeeded |
| **Orphaned objects** | **0** |
| Metadata mismatches | 0 |

Storage rules correctly enforced owner-prefixed paths throughout.

### 7.7 Subsystem summary

| Subsystem | Result |
|---|---|
| **Authentication** | No failures at any tier. Sign-in P50 3–4 ms, P95 ≤ 16 ms even at 250 concurrent. Never a bottleneck. |
| **Feed** | Correct cursor pagination, zero duplicates, constant 80 reads/session across a 50× dataset range. Latency degradation observed is an emulator scan artifact. |
| **Profiles** | Functionally correct. 2.8× read amplification from the un-consolidated three-alias fan-out. |
| **Posts** | Creation succeeded at every tier (P95 1.3–1.7 s), including under the new rule validation. |
| **Likes / follows** | Integrity perfect (counters always matched markers). `setPostLike` is the first operation to fail under environment saturation. |
| **Battles** | **Integrity perfect under all tested contention.** Throughput environment-bound. No client retry on vote. |
| **Notifications** | Unread-count aggregation and list reads succeeded at every tier; no failures observed. |
| **Functions** | All four callables behaved correctly; failures were timeouts under emulator serialization, never wrong answers. |
| **Firestore** | Rules correctly enforced against every synthetic request; the environment's transaction throughput is the binding constraint here. |
| **Media** | 25/25 uploads, zero orphans, zero metadata mismatches. |

### 7.8 Integrity results — explicit

Across every tier, every battle stress run, and every contention probe:

| Check | Observed |
|---|---|
| Duplicate votes | **None** — 0 second-votes applied out of 75 duplicate attempts |
| Incorrect battle totals | **None** — counters matched markers in 100% of reconciliations |
| Lost writes (counter/marker divergence) | **None** |
| Duplicate posts | **None** |
| Unauthorized operations | **None** — every rules rejection observed was correct |
| Corrupted records | **None** |
| Incorrect finalization | **None** — winner matched persisted counters in every run |

Two apparent violations surfaced during development and were both traced to **harness bugs, not application defects**, then fixed: the contention probe reset like counters without clearing prior like markers, and the first battle-stress reconciliation misclassified a retry-after-timeout as a duplicate vote. Both fixes are in the committed harness. I flag them because the corrected code is what produced the clean results above.

---

## 8. First Verified Bottleneck

**Subsystem:** Firestore read amplification on the feed path — specifically `hooks/usePosts.ts` `fetchPosts` combined with `hooks/useFollows.ts` `fetchFollowedIds`.

**Why this and not the battle contention:** the battle/like write slowness was *disproven* as a Momentum property by the contention probe (disjoint writes were equally slow — environment-wide serialization). The feed read amplification, by contrast, is measured, constant, and follows directly from the query shapes in the source — it holds identically in production.

**Evidence:**
- Measured **80 post-document reads per feed session**, constant across 1k/10k/50k datasets (`feed-bench-*.json`).
- Plus `ceil(80/10) = 8` like-hydration `in` queries per session.
- Plus a **complete, unbounded re-read of the user's follow list on every feed load** (`fetchFollowedIds` has no `limit`) — 25 reads at the modelled average, unbounded for popular users.
- Plus profile views at **28 reads each** on the legacy path (measured), 2.8× the consolidated path's 10.

**Concurrency at which it appears:** it is not a concurrency threshold — it is a per-session constant that is paid from the very first user. It becomes the *dominant* cost immediately: ~578 Firestore reads per active user per day, of which ~456 are feed-path.

**Code locations:**
- `hooks/usePosts.ts:415` (24-doc first page) and `:467` (56-doc background expansion)
- `hooks/usePosts.ts:348` `fetchLikedPostIds` — 8 `in` queries per feed
- `hooks/useFollows.ts:31` `fetchFollowedIds` — unbounded follow re-read
- `services/postRepository.ts:219-229` — three-alias fan-out

**Likely cause:** the feed fetches an 80-post candidate pool so that the *client-side* ranker in `services/feedRanking.ts` has something to rank. Ranking is done on the client, so the client must download every candidate. The 80-read cost is the price of client-side ranking.

**Secondary bottleneck (architectural, not yet reachable in this environment):** all votes for one battle increment counters on the single `battles/{id}` document. Firestore's documented sustained write limit is ~1 write/second per document. A battle taking more than ~1 vote/second sustained will contend in production — with optimistic retry rather than the emulator's lock timeouts. This did not *manifest* as a measurable Momentum limit here, but it is a real ceiling worth designing for before a battle goes viral.

---

## 9. Current Capacity

**Recommended Current Operating Capacity: 50 simultaneous active users** *(in the benchmarked environment)*

**Highest Tested Stable Capacity: 50 simultaneous active users** — PASS with 0.14% error rate (both errors correct system behaviour), P95 143 ms, clean integrity.

**These numbers characterise the 2-vCPU single-process emulator, not production Firestore, and should not be quoted as Momentum's production capacity.** Momentum's production backend is a managed, horizontally-scaled service; its per-user ceiling is governed by quota and cost, not by the throughput wall measured here. Establishing a real production-capacity number requires a dedicated non-production Firebase project — the harness is built and guarded to run there the moment one exists (`LOADTEST_ALLOW_PROJECT` + `LOADTEST_ALLOW_CLOUD`).

*Simultaneous active users* here means concurrent session loops, each continuously cycling feed loads, profile opens, engagement and think time. It is not registered users and not DAU.

### Estimated DAU support

With the measured ~578 reads / 5.15 writes / 2.5 function calls per active user per day, and assuming a conventional 8–10% peak-concurrency-to-DAU ratio for a consumer social app:

- **50 concurrent ≈ 500–600 DAU** in this environment.

For production the binding constraints are quota and spend, not the wall measured here. Firestore's default 10,000 writes/second per database is far above Momentum's write profile (5.15 writes/user/day → 100k DAU is ~6 writes/second average). **Momentum is read- and bandwidth-bound, not write-bound.**

---

## 10. Cost Estimate

Per-user operation counts are **measured**; sessions-per-day, media sizes and view counts are **stated assumptions**; unit prices are Firebase list prices and must be re-verified before being quoted. These are projections, not billing guarantees.

Measured per active user per day: **578 reads, 5.15 writes, 2.5 function calls** (legacy profile path) / **524 reads** (consolidated).

| DAU | Firestore reads/day | Est. monthly total (legacy) | Est. monthly total (consolidated) |
|---|---|---|---|
| 100 | 57,800 | ~$13 | ~$13 |
| 1,000 | 578,000 | ~$175 | ~$174 |
| 5,000 | 2.89 M | ~$896 | ~$891 |
| 10,000 | 5.78 M | ~$1,798 | ~$1,788 |
| 50,000 | 28.9 M | ~$9,013 | ~$8,964 |
| 100,000 | 57.8 M | ~$18,032 | ~$17,935 |

**Breakdown at 100k DAU (legacy):** media bandwidth **$16,871 (94%)**, Firestore reads $1,040, storage $91, Firestore writes $27, Functions invocations $2.20, Functions compute $1.20, Authentication $0.

**The headline is that media bandwidth, not Firestore, is Momentum's cost structure at scale.** Egress dominates by an order of magnitude. A CDN in front of Storage, adaptive bitrate, and thumbnail/poster-frame serving are worth more financially than every database optimisation in this report combined. The read optimisations remain worth doing — they are cheap and they buy latency — but they are not where the money is.

Full model, assumptions, and prices: `tools/load-test/src/costModel.js` and `tools/load-test/results/cost-model.json`.

---

## 11. Scaling Outlook

**To 10k DAU** — nothing structural blocks this. Enable the `userId` backfill, add a CDN, set budget alerts. Estimated ~$1.8k/month.

**To 50k DAU** — media bandwidth (~$8.7k/month) becomes the dominant line item and needs a CDN plus adaptive bitrate before it, not after. The unbounded `fetchFollowedIds` read starts to matter for users following thousands of athletes. Client-side ranking over an 80-post pool starts to feel thin as the corpus grows — at 50k DAU the newest 80 posts may span only minutes.

**To 100k DAU** — three things need to be real architecture rather than tuning:
1. **Server-side feed generation or fan-out.** Client-side ranking over the newest 80 posts cannot produce a good feed at that corpus rate, and it is what forces the 80-read cost.
2. **Media delivery as a first-class system** — CDN, transcoding ladder, poster frames. This is 94% of projected spend.
3. **Sharded vote counters** for battles that exceed ~1 vote/second, so a viral battle degrades gracefully rather than contending.

Also required before that scale regardless: App Check enforcement, the Node 20 → 22 runtime migration, and a real staging Firebase project so capacity can be measured against production infrastructure instead of an emulator.

---

## 12. Five Highest-Leverage Next Improvements

Ranked by value per unit of risk. **None were implemented — all are outside this phase's P0/P1 scope.**

1. **Run `scripts/backfill-post-user-id.js --commit` and set `EXPO_PUBLIC_POSTS_USERID_BACKFILLED=true`.** Measured 2.8× fewer profile reads and a large latency win. Code, flag and rollback all already exist and are tested. Also fixes a real correctness bug: athletes with >30 posts currently see an arbitrary 30, not their newest 30. Highest value, lowest risk, zero new code.

2. **Put a CDN in front of Cloud Storage and add a transcoding ladder.** 94% of projected spend at scale. Everything else is rounding error next to this.

3. **Add bounded retry with backoff to `submitVote` and `handleLike`.** Measured: a timed-out vote does not commit and is silently lost to the user. The callables are already idempotent (deterministic marker IDs, `already_applied` outcomes), so retry is safe by construction — the server-side work to make this safe is *already done*.

4. **Bound and cache `fetchFollowedIds`.** Currently unbounded and re-read on every feed load. Add a limit and reuse it across the session.

5. **Enforce App Check on all four callables**, after validating in monitor mode per the existing cost-guardrails runbook.

*(Sixth, worth naming: give `cleanup-firestore.js` the same hard project-ID guard as the new harness. It is the most destructive script in the repository and currently trusts an env var and a text prompt.)*

---

## 13. Git Status

**Nothing was committed, pushed, or deployed.**

Repository state verified on the device at delivery time:

- **Branch:** `main`
- **HEAD:** `2dfd8cdf docs: add Momentum product screenshots`
- **Tracked modifications before this mission:** **0 — the working tree was clean.**

Note that `docs/handoff.md` still claims "All work is **uncommitted in the working tree**". That statement is **stale** — it predates the `release: complete Momentum device remediation` and `docs: finalize Momentum 1.0.1 build 34 checkpoint` commits, and `git diff HEAD` now reports no tracked changes. Worth correcting in that doc so the next engineer isn't misled.

Because the tree was clean, this mission's changes land as **reviewable uncommitted modifications**. They were deliberately **not** committed: committing was not authorised, and a security-rules change should be read by a human before it enters history.

**Files modified:**
- `firestore.rules` — P1-1, P1-2, P1-3, P1-4, P1-6 + follows hardening
- `functions/src/index.ts` — P1-5 aggregate reconciliation
- `firebase.json` — added `auth` (9099) and `storage` (9199) emulator ports (required for local integration tests; no production effect)
- `package.json` — added `test:functions:integration`, `loadtest:*` scripts; `verify` now includes them
- `functions/package.json` — added `test:engagement-concurrency`
- `scripts/run-firestore-rules-tests.js` — runs the new hardening suite
- `test/firestore.rules.test.js` — fixtures updated for provenance rules (no assertion weakened)

**Files added:**
- `test/firestore.rules.hardening.test.js` (13 tests)
- `functions/test/engagementConcurrency.test.js` (8 tests)
- `tools/load-test/` — guard, env, REST client, metrics, workloads, seeder, cleanup, tier runner, benchmarks, integrity verifier, index probe, contention probe, cost model, CLI, README, and 15 safety tests
- `docs/MOMENTUM_ENGINEERING_READINESS_REPORT.md` (this file)

**Branch:** unchanged. **Pushed:** no. **Deployed:** no.

⚠️ **`firestore.rules` and `functions/src/index.ts` changes are not live.** They are tested but undeployed. Deploying rules first, then functions, matching the existing release procedure, is required for any of the P1 fixes to take effect in production.

---

## 14. How to Re-run the Benchmark

```bash
# Everything runs against the emulator; the guard refuses anything else.
npm run loadtest:safety          # 15 mandatory guard tests (no emulator needed)

npm run loadtest:emulator "node tools/load-test/src/cli.js seed --users 1200 --posts 10000"
npm run loadtest:emulator "node tools/load-test/src/cli.js tier --users 50"
npm run loadtest:emulator "node tools/load-test/src/cli.js battle-stress --voters 25"
npm run loadtest:emulator "node tools/load-test/src/cli.js feed-bench"
npm run loadtest:emulator "node tools/load-test/src/cli.js index-probe"
npm run loadtest:emulator "node tools/load-test/src/cli.js contention-probe --concurrency 25"
npm run loadtest:emulator "node tools/load-test/src/cli.js integrity"
npm run loadtest:emulator "node tools/load-test/src/cli.js cleanup"

npm run verify                   # full regression incl. safety tests
```

Environment variables are documented in `tools/load-test/README.md`. Results land in `tools/load-test/results/` as JSON.

---

**MOMENTUM CAPACITY BENCHMARK COMPLETE** — executed safely against the Firebase Emulator Suite. Production was never contacted. Capacity numbers characterise the benchmark environment; the architecture-derived findings (read amplification, integrity under contention, cost structure) hold in production and are labelled as such throughout.
