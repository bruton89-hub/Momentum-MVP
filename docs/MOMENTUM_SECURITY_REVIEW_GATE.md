# Momentum — Independent Security Review & Production Gate

**Reviewer:** independent validation pass
**Date:** 18 August 2026
**Subject:** hardening + capacity work performed by a previous agent
**Method:** verify from primary sources (git history, emulator execution, code paths) — not from the previous agent's report

---

## Overall Verdict

# APPROVED FOR CONTROLLED DEPLOYMENT

**with two mandatory corrections already applied and re-validated (below).**

The six reported P1 findings are **all real**. I proved each one by extracting `firestore.rules` as committed at HEAD and executing the attacks against it: every attack succeeded against the pre-fix rules and fails against the current rules. That is the strongest available evidence and it holds.

However, the previous agent's fix for P1-3 shipped **two confirmed regressions that would have broken legitimate production users**, neither of which their test suite covered. Both were found by probing production data shapes the previous agent did not model. Both are now fixed and covered by tests.

I also found and de-flaked one brittle test, corrected one factually wrong severity characterisation (the profile bug is worse than reported), and corrected one overstated cost conclusion.

Approval is for **backend-only deployment (Firestore rules + Cloud Functions)**. I verified that no file shipping in the Expo bundle changed and no dependency changed, so **no client rebuild or App Store submission is required**.

---

## Git State

| | |
|---|---|
| **Branch** | `main` |
| **HEAD** | `2dfd8cdf docs: add Momentum product screenshots` |
| **Previous-agent commits** | **None.** HEAD is unchanged; the previous agent committed nothing. |
| **Working tree** | 8 modified, 6 untracked entries — all deliverables from the hardening pass plus this review |

### Resolving the reported contradiction

The previous report contained both "working tree was clean/all committed" and "nothing was committed/changes are reviewable modifications". **Both are true of different moments**, and the contradiction is only apparent:

- **Before** the hardening work: tree clean, `git diff HEAD` empty, HEAD `2dfd8cdf`.
- **After**: the same HEAD, with their work written to disk as uncommitted changes.

The genuinely wrong statement was in the *first* version of their report, which claimed the tree already held pre-existing uncommitted work and cited `docs/handoff.md` as evidence. That was wrong: `hooks/usePosts.ts`, `hooks/useProfile.ts`, `services/postRepository.ts` and `storage.rules` are all **committed** (in `35438f82`). They corrected this themselves before finishing. `handoff.md` was the stale source and I have now corrected it.

### My modifications

| File | Change |
|---|---|
| `firestore.rules` | **2 regression fixes** (media aliases; username anchor) + new `currentProfileUsername()` helper |
| `test/review.verification.test.js` | **NEW** — 21 tests, baseline-vs-current for all six P1s + regression probes |
| `functions/test/reviewFinalization.test.js` | **NEW** — 9 tests targeting P1-5 gaps |
| `functions/test/engagementConcurrency.test.js` | **De-flaked** one brittle test |
| `tools/load-test/src/reviewProfileBug.js` | **NEW** — empirical verification of the profile defect |
| `scripts/run-firestore-rules-tests.js`, `package.json`, `functions/package.json` | wire the new suites into `npm run verify` |
| `docs/handoff.md` | stale status correction only |
| `_to_delete/review-baseline/index.baseline.ts` | renamed `.ts.txt` — my own artifact was breaking `tsc` (see Self-Review) |

Nothing committed. Nothing pushed. Nothing deployed. No production configuration touched.

---

## P1 Verification

### P1-1 — Post creation integrity

- **Original vulnerability: VERIFIED.** Against HEAD's rules (`allow create: if isSignedIn() && request.resource.data.userId == request.auth.uid` — ownership only), I successfully created posts carrying another athlete's media path, `likesCount: 50000`, `verified: true`, `momentumScore: 999`, a `createdAt` one year in the future, and an impersonated `username`. All five attacks succeeded.
- **Fix: PASS.** All five fail against current rules, plus author-alias mismatch.
- **Legitimate behaviour preserved: YES.** The exact shipping `createPost` payload succeeds — minimal form, full form with every optional field (`originalMediaUrl`, `videoEdit`, sport/position/school/teamName), the pre-hydration `username: ""` case, and idempotent same-id replay. I additionally verified posting works when `users/{uid}` does not yet exist (the signup ordering window).
- **Evidence:** `test/review.verification.test.js` tests 1–4.

### P1-2 — Coach verification / trust fields

- **Original vulnerability: VERIFIED.** Against HEAD's rules I self-granted `coachVerified: true`, `verified: true`, `topRanked: true` and `momentumScore: 100`.
- **Fix: PASS.** All nine protected fields refused on create and update.
- **Legitimate behaviour preserved: YES.** `ensureUserProfile` creation and a full `updateUserProfile` edit (bio, username+usernameLower, school, city, position, gradYear, avatarUrl, bannerUrl) all succeed.
- **Equivalent weaknesses checked:** I swept for other trust-bearing fields read by `normalizeUserProfile`. The protected set (`verified`, `isVerified`, `coachVerified`, `tournamentChampion`, `topRanked`, `momentumScore`, `wins`, `losses`, `posts`) is **complete** — no rendered trust field is left writable.
- **Note (not a defect):** writing a protected field to its *existing* value is permitted, because `diff().affectedKeys()` correctly excludes unchanged fields. This is a no-op and not exploitable.

### P1-3 — Battle entry / post binding

- **Original vulnerability: VERIFIED.** Against HEAD's rules I created a battle whose `playerA` claimed a victim's post and media while crediting the attacker.
- **Fix: PASS — after two corrections.** Forged entries (stolen media, foreign post, nonexistent post, forged name, future timestamp) all rejected; both legitimate creation shapes and Open Challenge acceptance succeed; creator still cannot accept their own challenge.
- **Legitimate behaviour preserved: YES — but only after my fixes.** As delivered, it was **NO**:

> #### ⚠ Regression 1 (CONFIRMED, now fixed) — renamed athletes locked out of battles
> The rule required `player.username == post.get('username', ...)`. Edit Profile allows changing username, but posts keep the name they were created under, while `BattlePickerModal` and `confirmAccept` build the entry from the **current** profile. Any athlete who renamed themselves could no longer create a direct challenge or accept an open challenge using any older post — permanent `PERMISSION_DENIED` on a core flow.
> **Fix:** the name must match the backing post's username **or** the athlete's current profile handle. Both anchors are legitimate; requiring either one alone breaks a real case (the symmetric case — challenging an athlete who has since renamed — breaks under the opposite anchor).

> #### ⚠ Regression 2 (CONFIRMED, now fixed) — legacy media posts un-battleable
> The rule compared only against `mediaUrl` and `originalMediaUrl`, but `normalizePost` resolves `mediaUrl || mediaURL || photoURL`. A legacy post storing media under the `mediaURL` or `photoURL` alias surfaces a URL in the client that is in none of the checked fields, so every such post became permanently un-battleable.
> **Fix:** accept all four fields `normalizePost` actually reads.

> **Security impact of both fixes: none.** The property that prevents content theft and false stat attribution is the `userId` ↔ post-ownership binding, which is untouched. I documented in the rules that the username check is defence-in-depth only — an attacker can set their own profile handle to any unclaimed value, so it never was the primary control.

- **Cost of the fix:** `currentProfileUsername()` is only evaluated when the post-name comparison fails (short-circuit `||`), so renamed athletes pay one extra document read on battle create/accept and everyone else pays zero. Worst case is 4 document accesses per battle create, well inside the 10-access rules limit.
- **Evidence:** `test/review.verification.test.js` tests 8–14, incl. two dedicated regression probes and a legacy-`authorId`-ownership probe.

### P1-4 — Comment identity forgery

- **Original vulnerability: VERIFIED.** Against HEAD's rules I created a comment with `username: "CoachSmith"`.
- **Fix: PASS.** Forged username, forged `userId`, extra keys and future timestamps all rejected; legitimate and pre-hydration (`""`) comments succeed.
- **Chain traced:** client → comment → Firestore → notification → recipient. The notification rule validates `subjectUsername` **against the comment document**, so locking the comment is what protects the notification. Verified the notification rules are **byte-identical to baseline** — the previous agent correctly fixed this at the source rather than redesigning notifications.
- **Residual, documented:** any *pre-existing* forged comment already in production remains a valid basis for a matching notification. New forgeries are impossible. Worth a one-off data audit; not a deployment blocker.
- **Legitimate behaviour preserved: YES.**

### P1-5 — Battle finalization scaling

- **Original problem: VERIFIED.** HEAD's `finalizeBattle` did `tx.get(db.collection("votes").where("battleId","==",battleId))` and counted in a loop — read cost linear in vote volume, inside the transaction.
- **Fix: PASS.** I did **not** accept this on passing tests alone:
  - **API validity:** `Transaction.get(AggregateQuery)` is a first-class overload in the installed `@google-cloud/firestore` 7.11.6 (`firebase-admin` 12.7.0) — an officially supported production API, not an emulator quirk.
  - **Index requirement (the real production risk):** the change adds a second equality filter (`battleId == X && side == "A"`), and the emulator never validates index requirements — a classic passes-in-test/fails-in-prod trap. **Resolved with in-repo production evidence:** `fetchUnreadNotificationCount` already ships the identical shape (`recipientId == X && read == false`, `count()` aggregate) and runs in production today. No composite index is required. **I deliberately did not add a defensive index** — it would add write amplification to `votes`, the hottest write collection, for no benefit.
  - **Serialization correctness (the property that matters):** aggregates are safe here only because `castBattleVote` also writes `battles/{id}`, which `finalizeBattle` reads in the same transaction — so a vote committing mid-finalization forces a retry rather than a counter/marker mismatch. I tested this interleaving directly (8 concurrent votes racing a finalization) and asserted the invariant `counters == markers` regardless of ordering.
  - **Semantics:** verified zero-vote battles (tie, no stats, notifications still sent), ties, winner calculation, unauthenticated rejection, not-yet-ended rejection, missing battle, unmatched-challenge expiry (no stats, no result notification), 10 concurrent finalizations recording stats **exactly once**, repeat finalization as a no-op, and exact reconciliation at **250 vote markers**.
- **Legitimate behaviour preserved: YES.**
- **Evidence:** `functions/test/reviewFinalization.test.js` (9 tests) + existing 3 + 8.

### P1-6 — Username canonicalization

- **Original vulnerability: VERIFIED.** Against HEAD's rules I registered `username: "VictimName"` with `usernameLower: "zzz-unrelated"`, evading the duplicate-handle check (`isUsernameTaken` queries `usernameLower` only).
- **Fix: PASS.** Divergence rejected on create and update; capitalisation-only renames with a matching index succeed; legacy docs without `usernameLower` can still edit unrelated fields.
- **Legitimate behaviour preserved: YES.**
- **Scope limit (unchanged, pre-existing):** this enforces *canonicalisation*, not *uniqueness*. `isUsernameTaken` remains a read-then-write race, so two simultaneous registrations can still claim one handle. That is the still-open P2 the previous agent correctly declined to fix in a no-redesign phase.

---

## Regression Validation

I established the blast radius precisely by diffing against HEAD rather than reasoning speculatively:

- **The only changed `allow` line in the entire ruleset is `posts` create.** Everything else changed via helper functions inside `users`, `battles`, `comments` and `follows`.
- **All `allow delete` rules are byte-identical to baseline** → post deletion, comment deletion, unfollow and unsave are untouched.
- **The entire notifications block is byte-identical to baseline** → notification authorization is untouched.
- **No file shipping in the Expo bundle changed** (`app/`, `components/`, `hooks/`, `services/`, `utils/`, `store/`, `types/`, `constants/`, `assets/` all clean), **no dependency changed**, and `app.config.js` / `eas.json` / `google-services.json` / `GoogleService-Info.plist` are untouched.

| Flow | Result | Basis |
|---|---|---|
| Signup | PASS | profile create incl. posting before `users/{uid}` exists |
| Profile creation / editing | PASS | full `updateUserProfile` field set |
| Create/Post | PASS | exact shipping payload, minimal + full + pre-hydration + replay |
| Likes | PASS | server-only rule unchanged; callable tests 8/8 |
| Comments | PASS | legitimate + pre-hydration accepted |
| Follows | PASS | follow/unfollow; self-follow correctly refused |
| Open Challenge | PASS | create + accept, incl. renamed athletes and legacy posts |
| Battle joining | PASS | accept path; creator self-accept still refused |
| Voting | PASS | 8/8 concurrency tests; duplicate protection intact |
| Finalization | PASS | 9 new + 3 existing tests |
| Notifications | PASS | rules byte-identical to baseline |
| Post deletion | PASS | delete rules byte-identical; 6/6 callable tests |
| Account deletion | PASS | only `deleteUser` is the registration rollback (Auth, not Firestore) — unaffected |

### Full validation results

| Suite | Result |
|---|---|
| App TypeScript (`tsc --noEmit`) | **PASS** (verified on both sandbox and your Mac) |
| Functions TypeScript build | **PASS** |
| Unit (battles / mutation / remediation / media) | **20/20** |
| Firestore rules (34 existing + 13 hardening + **21 review**) | **68/68** |
| Storage rules | **8/8** |
| Functions contracts | **7/7** |
| Battle finalization | **3/3** |
| Post deletion | **6/6** |
| Engagement concurrency | **8/8** |
| **Review finalization (new)** | **9/9** |
| Load-test safety guard | **15/15** |
| **TOTAL** | **144 passing, 0 failing** |

**The previous agent's claimed baseline of 114 is accurate** — I reproduced it exactly (20+15+47+7+3+6+8+8). My 30 additional tests bring it to 144.

**Expo Doctor: NOT RUN.** `expo-doctor` is not installed and the npm registry is blocked in both available environments. I am not claiming it passed. The mitigating evidence is stronger than a re-run would be: the bundled source and dependency graph are byte-identical to the release where it last passed 16/16, so its result cannot have changed. Production export validation was skipped for the same reason — the bundle is unchanged.

---

## Production Guard

# PASS

- **Blocklist verified against actual repo config.** Exactly two real Firebase project IDs exist anywhere in configuration — `momentum-app-prod-1e870` (`.firebaserc`, `.env`, `GoogleService-Info.plist`) and `momentum-live-483819` (`google-services.json`). Both are blocklisted. There is no third project the guard misses. (`momentum-app` is the Expo slug, not a Firebase project.)
- **Executes before any connection.** Verified by code ordering: `assertSafeTarget()` runs at `adminContext.js:16`, before `require("firebase-admin")` at :30 and `initializeApp` at :34. The SDK is not even loaded until the guard passes. `seed.js` guards at :58 before its context at :65; `cleanup.js` at :63 before :65; `cli.js` resolves the target as its first statement.
- **Bypass battery: 36/36 refused.** Six commands (`integrity`, `seed`, `cleanup`, `tier`, `battle-stress`, `feed-bench`) × six configurations (both production IDs; both `LOADTEST_PROJECT_ID` and `GCLOUD_PROJECT` paths; the full double-acknowledgement override; uppercase; and emulator host pointed at real `firestore.googleapis.com`). Every one returned `MOMENTUM LOAD TEST REFUSED — PRODUCTION PROJECT DETECTED`.
- **Coverage confirmed** for load tests, seeding and cleanup.
- **Re-verified on your Mac** after delivery: guard refuses production, 15/15 safety tests pass.
- **No synthetic load was sent to either protected project at any point in this review.**

---

## Capacity Assessment

Reviewed from stored evidence; no expensive benchmarks re-run.

| # | Claim | Status |
|---|---|---|
| 1 | 100k-post timeout was an environment ceiling, not production feed failure | **VERIFIED** as an environment failure — the emulator *process* became unresponsive (load average 141 on 2 vCPU), which is infrastructure, not a query result. Correctly **NOT ESTABLISHED** for production, and correctly not claimed. |
| 2 | Latency tracked collection size, not result size | **VERIFIED** for the emulator, by a clean control: at 50k posts `limit(1)`=355ms vs `limit(24)`=390ms (1.10×) while the same query shape on a 41-doc collection = 36ms (10.7×). The within-collection limit comparison is the right control. The inference that production serves this from an index is **PROBABLE** (documented Firestore behaviour) but was not directly measured. |
| 3 | Disjoint and shared writes slowed similarly → emulator-wide serialization | **VERIFIED at ≤25 concurrent** (at C=10 disjoint was *slower* than shared, 0.90×; at C=25, 1.28×; zero failures in both). **NOT ESTABLISHED above 25** — C=50 and C=100 never completed. |
| 4 | No integrity failures in completed battle tests | **VERIFIED**, and I strengthened it. Caveat the previous report should have stated: at 25 and 50 voters only **4 and 2 votes actually persisted**, so those runs verified integrity across very few writes. My additional tests raise the evidence substantially — exact reconciliation at **250 markers**, 10 concurrent finalizations, and a vote-vs-finalization race. |
| 5 | The benchmark cannot establish production concurrency ceiling | **VERIFIED.** |

### Additional finding — the previous agent's attribution was imprecise

The battle-stress ceiling was attributed to "environment-wide transaction serialization". The dominant factor is more specific: **the Functions emulator's HTTP invocation layer**, not Firestore.

Evidence: `engagementConcurrency` invokes `castBattleVote.run()` **in-process** and lands **25 of 25** concurrent votes with exact reconciliation. `battle-stress` drives the **same function against the same Firestore** through the Functions emulator over HTTP and loses 21 of 25 to 30-second timeouts. Same logic, same database — the difference is the invocation path.

This *strengthens* the conclusion that Momentum's own transaction logic is sound, and further undercuts any reading of the battle-stress throughput as a Momentum limit.

### What the benchmark proves and does not prove

**Proves:** feed reads are constant at 80/session across a 50× dataset range with zero duplicate documents (cursor pagination is correct); the legacy profile path costs ~3× the reads of the consolidated path; transactional integrity holds under every contention level reached; the harness itself was never the bottleneck (event-loop lag ≤120ms p95 at every tier).

**Does not prove:** any production latency figure; any production concurrency ceiling; that the app degrades gracefully at 100k posts; anything at all above 250 concurrent virtual users.

**No production user-capacity number is supportable from this evidence, and I decline to state one.** The previous agent's "50 simultaneous active users" is correctly scoped as an emulator-environment figure, but it is prominent enough that it risks being quoted as a product capability. It should be read as "the 2-vCPU emulator saturates at ~50", nothing more.

---

## Cost Assessment

I recomputed the model from its own inputs: **578 reads/user/day reproduces exactly** (feed 456 + profile 84 + battles 33 + engagement 5). The arithmetic is sound.

| Figure | Classification |
|---|---|
| 80 reads per feed session | **DIRECTLY MEASURED**, constant across 1k/10k/50k |
| 28 reads/profile view legacy vs 10 consolidated | **DIRECTLY MEASURED** at ~8 posts/athlete |
| 3.0× profile read amplification | **DIRECTLY MEASURED** (I re-measured it — see below) |
| 578 reads/user/day | **MODELED** — measured per-op costs × *assumed* session frequencies (4 feed sessions/day, 3 profile views, 25 follows) |
| Media = 94% of spend at 100k DAU | **PROJECTION on an unvalidated assumption** — see below |

### Correction: the 94% media figure is false precision

It rests entirely on assuming **40 media views/day × 1.2 MB = 48 MB per user per day**, which was never measured — the media benchmark transferred **1.6 MB in total**. At a still-plausible 12 MB/day the media share falls to **78%** and the 100k-DAU total drops from ~$18.0k to ~$5.4k.

**The qualitative conclusion is defensible and important: media egress dominates Momentum's cost structure at scale, and a CDN is worth more than any database optimisation.** The specific "94%" should be replaced by a sensitivity range. Everything downstream of media consumption is a projection, not a forecast.

### Correction: the profile amplification was understated

Reported as 2.8×. That was measured at ~8 posts per athlete, where the alias queries return fewer rows than the page limit. For any athlete at or above the 30-post page size it is exactly **3.0×** (90 reads vs 30) — I measured this directly. 2.8× is a floor, not a typical value.

---

## Backfill Assessment

# NOT READY — one operational precondition must be satisfied first

**Not executed.** No `--commit`. No production data touched. `EXPO_PUBLIC_POSTS_USERID_BACKFILLED` not set anywhere.

I ran a **dry run against the emulator** using purpose-built legacy fixtures and a throwaway RSA key (generated locally, emulator-only, zero value, deleted immediately afterward — verified absent).

**Script behaviour verified:**

| Property | Result |
|---|---|
| Targets | every doc in `posts` |
| Ownership inference | `userId` → `authorId` → `uid` → `ownerId`, **identical precedence to `normalizePost` and the deletion callable** — verified correct for all three alias shapes |
| Conflicting aliases | correctly keeps canonical `userId`, does not overwrite with lower-priority aliases |
| Idempotent | yes — additive `set(..., {merge:true})` of only missing fields; already-complete docs skipped |
| Ambiguous posts | **detected, skipped, and reported for human review** — not guessed |
| Partial failure | safe — batched writes, additive only; a failed batch leaves prior batches valid and re-running resumes |
| Rollback | field-level rollback is not provided, but the *feature* rollback is instant: unset the flag. The written fields are additive and inert until the flag flips. |
| Dry run default | confirmed — I verified **nothing was written**: all four legacy fixtures still had `userId: undefined` afterward |

**Why NOT READY:** the script correctly warns that posts with **no author field in any alias** will be **invisible** after the flag flips, because the consolidated query filters on `userId`. My dry run reproduced exactly this (1 orphan detected and skipped). **The gate is: run the dry run against production, confirm `Unresolvable (no author) : 0`, and only then commit.** If it is non-zero, those posts must be resolved or accepted as lost from profile grids first.

**Second precondition:** the composite index `posts (userId ASC, createdAt DESC)` must be deployed *before* the flag flips, or the consolidated query fails. It is present in `firestore.indexes.json`.

**Note:** the backfill script has **no hard production-project guard** — it runs against whatever `FIREBASE_PROJECT_ID` is set to. This is by design (it must eventually target production) but a typo targets the wrong project. Mitigated by dry-run-by-default and additive-only writes. The same gap in `cleanup-firestore.js` is far more dangerous and should be closed.

### The reported profile bug is REAL — and worse than described

Reported as "athletes with more than 30 posts see an arbitrary 30 instead of their newest". I verified this empirically (`tools/load-test/src/reviewProfileBug.js`) with a 45-post athlete:

- Legacy path returns 30 posts, of which **only 15 are among the athlete's newest 30** — 15 of their most recent posts are missing from their own profile.
- The returned set is `post_…0000` through `post_…0029` — **deterministically their oldest 30**, not an arbitrary sample. The legacy query has no `orderBy`, so Firestore returns `__name__` order, and modern post IDs (`post_{base36 millis}_{random}`) sort ascending by time.
- Consolidated path returns exactly the newest 30, at **one third of the reads**.

For an athlete with 100 posts, their 70 most recent highlights would be invisible on their own profile in a recruiting app. **"Arbitrary" understates this; it is systematically the oldest.** This raises the priority of the backfill from optimisation to product-correctness fix.

---

## Deployment Plan

**Do not execute any of this from this session.** Backend-only — no client rebuild or App Store submission is required.

1. **Git checkpoint** — review the diff, then commit to a branch (e.g. `harden/security-review-aug-2026`). Do not commit `_to_delete/` or any `serviceAccountKey.json`. Tag the current production state for rollback reference.
2. **Deploy Firestore rules** — `npx firebase deploy --only firestore:rules`. Rules first: they are the security fix and are backward-compatible with the currently shipped client.
3. **Verify rules** — in the Firebase console Rules Playground, confirm: a legitimate post create succeeds; a post with `likesCount: 5000` fails; a self-granted `verified: true` fails. Then exercise the live app: publish a post, comment, follow, create and accept a battle. **Specifically re-test with an account that has renamed itself and with a legacy post**, since those are the two regressions found here.
4. **Deploy Cloud Functions** — `npx firebase deploy --only functions`. Confirm all four report `ACTIVE` in `us-central1`.
5. **Verify functions** — finalize one real ended battle; confirm the winner matches persisted counters, `statsRecorded` is true, wins/losses incremented once, and both result notifications delivered. Watch logs for `failed-precondition` on the aggregate path (would indicate an unexpected index requirement — the one residual production-vs-emulator risk).
6. **TestFlight smoke test** — the existing build 34 is unchanged and compatible. Exercise feed, profile, post creation, like, comment, follow, battle create/accept/vote, notifications, post deletion.
7. **Backfill dry run and review** — `FIREBASE_PROJECT_ID=momentum-app-prod-1e870 node scripts/backfill-post-user-id.js` (no `--commit`). **Confirm `Unresolvable (no author) : 0`.** Take a backup first.
8. **Production backfill** — only if step 7 is clean: re-run with `--commit`.
9. **Feature flag** — confirm the `posts (userId, createdAt DESC)` index is deployed and serving, then set `EXPO_PUBLIC_POSTS_USERID_BACKFILLED=true` and ship a client build. Rollback is unsetting the flag; no data change.
10. **Post-deployment monitoring** — for 48 hours watch Firestore denied-write rate (a spike means a legitimate flow is blocked — the failure mode of this change), callable error rates, `finalizeBattle` `failed-precondition` counts, read volume, and Storage egress. Set budget alerts before step 2.

---

## Remaining Risks

1. **Rules changes have not been exercised against real production data shapes.** I probed the two legacy shapes I could infer from `normalizePost` (media aliases, ownership aliases) and fixed both. Production may hold further shapes — for instance posts with no `username` (handled: the default makes them pass) or unusual media URL formats. **The failure mode is denial of a legitimate write, which is visible and reversible**, but step 3's verification is genuinely load-bearing, not a formality.
2. **The aggregate index assumption is evidence-based, not directly tested in production.** In-repo precedent (`fetchUnreadNotificationCount`) is strong, but step 5's log check is the confirmation.
3. **Pre-existing forged comments** (if any) remain valid bases for notifications. New forgeries are impossible. A one-off data audit would close this.
4. **Username uniqueness is still a read-then-write race** (P2, unchanged). Canonicalisation is enforced; uniqueness is not.
5. **`cleanup-firestore.js` still has no hard project guard** — the most destructive script in the repo, protected only by an env var and a text prompt. Highest-value remaining safety work.
6. **App Check remains unenforced** on all four callables; the Node 20 runtime is deprecated (decommission 30 Oct 2026).
7. **No non-production Firebase project exists.** Real capacity numbers, and a full-fidelity rules rehearsal against production-shaped data, remain impossible until one does.
8. **Votes and likes still have no client retry** — the previous agent's measurement that a timed-out vote does not commit stands, and this remains the highest-value reliability fix.

---

## Self-Review

- **Accidental production changes:** none. No deploy, no push, no commit; `.firebaserc`, `.env`, `app.config.js`, `eas.json` and the native Google config files are untouched.
- **Weakened security:** my two rules changes are strictly more permissive than as-delivered, and I want that on the record. Neither weakens the property that matters. The media change accepts exactly the fields `normalizePost` already treats as the post's media. The username change accepts a name the athlete demonstrably holds. The `userId` ↔ post-ownership binding — the actual anti-theft control — is untouched, and I documented the precise scope of what the username check does and does not protect.
- **Unnecessary refactors:** none. I changed one helper and added one, and deliberately declined to add a composite index that would have cost write amplification on the hottest collection.
- **Brittle tests:** found one in the previous agent's suite and fixed it. `concurrent votes from distinct users all land and reconcile` hard-asserted zero infrastructure failures and derived expected counts from *attempted* rather than *accepted* votes; it passed alone and failed under combined emulator load. It now asserts the real invariant (counters exactly reproduce markers, one marker per accepted vote, winner follows persisted counters) with a floor to prevent a vacuous pass. **Verified stable across three consecutive runs under the load that broke it.**
- **Hidden assumptions:** the one I relied on — that a two-equality-filter aggregate needs no composite index — I replaced with in-repo production evidence rather than leaving it as an assumption.
- **Secrets:** the throwaway RSA key generated for the backfill dry run was deleted immediately; verified absent; a scan of all review artifacts for private keys, service-account blobs and API keys is clean. It was emulator-only and never had any access to anything.
- **Generated files:** none added beyond test and tooling source.
- **A defect I introduced and fixed:** my baseline extract `_to_delete/review-baseline/index.baseline.ts` was globbed by the app's `tsconfig` and broke `tsc --noEmit` with 9 errors on your machine. Caught during final device validation, renamed to `.ts.txt`; `tsc` now exits 0 on both sandbox and device. This is exactly the kind of thing that would have wasted the next engineer's morning.
- **Re-validation after every correction:** full suite re-run — 144 passing, 0 failing, on both the sandbox and your Mac.

### `_to_delete/` disposition

**Safe to delete.** Contents are exclusively `.claude-transfer/` (tarballs and split parts of `node_modules`, reconstructable via `npm ci`) and `review-baseline/` (two git extracts, reconstructable via `git show HEAD:…`). Zero unique or original content.

**Correction:** it is **1.1 GB**, not the ~360 MB previously reported — the split parts duplicate the tarballs. **I did not delete it**: this environment cannot remove files from your disk (`rm` returns `Operation not permitted`). Delete it yourself, and note it must not be committed.

---

**MOMENTUM SECURITY GATE PASSED — READY FOR CONTROLLED DEPLOYMENT**
