# Momentum MVP — Handoff Note

July 8, 2026 · Expo SDK 50 / RN 0.73 / expo-router 3 / Firebase web SDK 10

## Status

Closed-beta ready pending device QA. All work is **uncommitted in the working tree** (this includes pre-existing changes to `hooks/usePosts.ts`, `hooks/useProfile.ts`, `services/postRepository.ts`, and `storage.rules` that predate this pass — review those before committing). `tsc --noEmit` passes. Firebase integrations untouched.

## Latest UI changes (beta-polish pass)

- Design tokens centralized in `constants/theme.ts` (TYPE/LINE scale, scrims, warning colors, HIT_SLOP, GLOW); stale `#A6FF00` greens corrected to brand `#C6FF00`.
- New shared components: `IconButton`, `SegmentedTabs`, `Chip`, `StatsRow`, `PostGridThumb`, `BattleHistoryCard`, `PostDetailModal`, plus `utils/format.ts` (handles/timestamps). The two profile screens now share these (~880 lines removed).
- All emoji-glyph UI icons replaced with Feather/MaterialCommunityIcons; accessibility roles/labels/states and pressed feedback added across all interactive elements.
- Fake hardcoded video durations removed; feed videos show a real mute/unmute indicator. Handles unified as `@first.last` everywhere.
- Stray files deleted (duplicate `VideoPostEditor 2.tsx`, 27 debug logs, etc.).

## Latest performance changes (audit: `docs/performance-audit.md`)

- `MediaTile`: mis-gated `Image.prefetch` now DEV-only (was a duplicate download per image tile in prod).
- `useBattles(userId, includeVotes)`: profile screens skip vote lookups (−3 Firestore `in` queries per visit); Battles tab unchanged.
- Battles screen: ScrollView→FlatList; My/Completed card lists virtualized (30 → 3 initial mounts). `removeClippedSubviews` deliberately omitted (blanks native video/absolute overlays).
- `BattleCard` memoized; Home feed no longer re-renders per scroll tick (prepared-video Set bails on equal contents); profile lists windowSize 21→9.
- Ungated create-screen `console.log` now DEV-only.

## Reliability + load pass (August 9, 2026)

Publishing:

- **Retry no longer duplicates a post or orphans an upload.** `create.tsx` keeps resume refs (uploaded media URL, uploaded cover URL, created post id), all keyed by source URI. A failure at the post-doc or challenge step used to re-upload the same file on retry — leaving a billed, unreferenced copy in Storage — and write a second post document.
- **Challenge failure is reported honestly.** `createBattle` failing after `createPost` succeeded showed "Couldn't publish" even though the highlight was live, pushing athletes to re-publish. It now reports the partial outcome and retries only the challenge.
- **Custom video covers work for other viewers, and no longer kill playback.** The editor returns a local `file://` thumbnail URI that was written straight to Firestore: unresolvable on every device except the author's. Covers are now uploaded to Storage (`posts/{uid}/cover_*`) and stored as download URLs. Separately, a cover used to render an `<Image>` *instead of* the `<Video>` — picking one silently turned the highlight into a still photo. It's the poster frame now. `normalizePost` drops any non-remote `coverUri`, which repairs existing docs at read time; no migration needed.

Loading:

- **Home no longer re-reads the feed on every focus.** Was up to 80 post documents plus follows on each return from Profile/Battles/a modal. Focus now refreshes only when the pool is stale (60 s TTL, or invalidated by `createPost`), so publishing still lands on a feed containing the new post. Pull-to-refresh is unchanged and always forces a fetch.
- **Author-query consolidation is ready but off.** `scripts/backfill-post-user-id.js` (dry run by default; `--commit` to apply) stamps `userId`/`createdAt` onto legacy posts. Then set `EXPO_PUBLIC_POSTS_USERID_BACKFILLED=true`: the three-alias fan-out collapses to one indexed query (~66% fewer reads on profile grids and the Following feed) and finally uses `orderBy("createdAt","desc")`. That last part is a correctness fix, not just cost — the unordered path returns an arbitrary 30 posts for any athlete with more than 30, not their newest 30. Rollback is unsetting the flag; no data change.

Not verified here: `npm run test:rules` needs Java 21 and could not run in this environment. `firestore.rules` was not modified. `tsc --noEmit` passes.

## Profile pass (August 9, 2026)

Look:

- **New `components/ProfileBanner.tsx`.** Uploaded banner, or a sport-coded gradient fallback (`SPORT_BANNERS` in `constants/theme.ts`) so a brand-new athlete still gets a deliberate header instead of an empty bar. Stretches on pull-to-refresh and parallaxes on scroll, both UI-thread and both disabled under Reduce Motion. Uploaded banners get a scrim so overlaid text survives any photo.
- **Header relaid out around it** — avatar overlaps the banner edge with a background-colored ring, identity left-aligned, badges moved beside the avatar instead of eating a full row.
- **Stat card no longer wraps.** Posts/Battles/Wins/Losses is a fixed 4-column row; Win % and Momentum moved to a labelled strip beneath. Previously a fifth 25%-wide cell wrapped and stranded itself against the left edge (visible on any athlete with a decided battle).
- Grid `paddingTop: COMPACT_BAR_HEIGHT` removed on both profile screens so the banner runs edge-to-edge; the compact bar floats over it with a scrim that hands off to the solid background as it fades in.

Buttons:

- **Save was fake.** `isSaved` was local component state that reset on unmount, and the Saved tab was hardcoded `[]`. Now a real `saves` collection (`services/saveRepository.ts`, `hooks/useSaves.ts`) with Firestore rules, optimistic toggle with revert, and a working Saved tab. Saves are **private** — rules restrict reads to the owner. `usePostSave` is scoped to a single post id on purpose: a shared-Set subscription would re-render all ~24 mounted feed cards on every save.
- **Saved tab removed from other athletes' profiles** (`app/profile/[userId].tsx`) — private by design, so it could only ever render empty there.
- **Share Profile** now includes a `momentum://profile/{userId}` deep link, matching `utils/shareBattle`. It previously shared bare text with nothing to tap.

Edit Profile:

- **Added position, school/team, city, state, and graduation year.** The header has always rendered these, but no screen in the app could set them — they were permanently blank. They're the fields a coach scans first.
- **Banner picker** added, cropped 16:9 (avatar crops 1:1) so what's framed is what ships.
- **Username uniqueness is now enforced.** `isUsernameTaken` has existed since registration but the edit path never called it, so two athletes could claim the same handle.
- Grad year validated as four digits; Save disabled until something actually changes; closing with unsaved edits asks first.
- `athleteType` is now written alongside `sport` so older readers don't drift after an edit.

New Storage rule for `banners/{userId}/banner.jpg` (fixed filename → overwrite in place, no per-edit object accumulation). New Firestore rules for `saves`, with tests added to `test/firestore.rules.test.js` and the hardened fixture.

## Discovery + ranking pass (August 9, 2026)

**Back button fixed.** `ProfileCompactBar` floats over the profile header and grid, which contain image- and AVPlayer-backed views. On iOS those can win hit testing against an overlaid sibling even when it's visually on top, so taps on Back and Sign out were being swallowed. `PostDetailModal` already hit this exact problem and solved it with `zIndex/elevation: 1000` on the bar and `1001` on the button — the compact bar now does the same, and its edge slots are 44×44 minimum targets. `goBack` also falls back to `router.replace("/(tabs)")` when `canGoBack()` is false (deep link or cold start), where `router.back()` was a silent no-op.

**Athlete discovery** — new `discover` tab, placed second so Create lands dead centre in a five-tab bar.

- Search by username, school, or city; sport filter; browse rails for the empty state (same school → same sport → top records), deduped across rails.
- Prefix matching via Firestore range queries over lowercased fields (`services/athleteSearchRepository.ts`). Limits are stated in the code and in the empty state: **matches only from the start of a field, no typo tolerance** — "fly" will not find "ChrisFly". `searchAthletes` is the single seam to swap for Algolia/Typesense later.
- `searchFieldsFor` in `hooks/useProfile.ts` writes `usernameLower`/`schoolLower`/`cityLower` on every profile create and edit. **Run `scripts/backfill-search-fields.js` (dry run by default, `--commit` to apply) or existing athletes are invisible to search** — Firestore omits documents missing the queried field. Then deploy indexes.
- `isUsernameTaken` now checks `usernameLower`, so "ChrisFly" and "chrisfly" are correctly the same handle. This also depends on the backfill.

**Feed formula** — `services/feedRanking.ts`, spec in `docs/feed-ranking.md`.

Fair-exposure model: every post gets a guaranteed 24-hour exposure boost (weight 0.30), then engagement *rate* (0.28), recency (0.18), relevance to the viewer's sport/school/state (0.16), and an under-exposed lift (0.08) take over. Diversity penalties are applied at selection rather than in scoring, since they depend on what's already placed.

The old inline model gave its **random** term weight 0.45 of ~1.0 — the feed was mostly shuffle, and nothing about the viewer mattered. Jitter is now 0.06.

Verified against hand-built cases: a freshman's 2-hour-old post with one like scores 0.730 against an established athlete's 400-like post at 0.103, and a brand-new post with zero likes and no shared context still scores 0.546 — above both established posts. Earned engagement can still win (a 6-hour-old post with 20 likes in your sport tops the set at 0.770), which is the intended balance.

Three limits are called out in the doc and worth repeating: it **ranks, it doesn't retrieve** (only the ~80 newest posts the client already fetched); there is **no impression data**, so "engagement rate" is likes-per-hour as a proxy — logging impressions is the highest-value next investment; and it's **client-side**, so weights ship with the app and can't be A/B tested.

Open product call: own posts currently appear in For You (scored 0.626 in the test set). Many platforms exclude them.

## Unmatched battles fall off (August 9, 2026)

An open challenge nobody accepted was being marked `completed` by `finalizeBattle` once its window closed — which is why "Waiting for challenger" cards with 0 votes were sitting in the Completed tab and inflating every athlete's battle count with contests that never happened.

- **New `"expired"` battle status.** Distinct from `completed` on purpose: a challenge nobody answered was never a contest.
- **`finalizeBattle` now expires unmatched battles** instead of completing them. The unmatched check runs *before* the winner logic — with `playerB` null, a single vote on A would otherwise have crowned a walkover winner. No stats are written, and no battle-result notifications fire (those are gated on `"finalized"`).
- **`getBattleStatus` reclassifies on read.** Unmatched-and-over returns `"expired"` even when the stored status says `completed`, so pre-existing bad rows vanish from the UI immediately, before the backfill runs.
- **Filtered from every surface:** Battles screen tabs *and* their counts (`mine` filtered on participation alone, so it needed the guard explicitly), the Home Battles feed, and `profileBattles` on both profile screens via the new `isCountableBattle` helper.
- **Highlights stay challengeable.** `battleEnabled` is untouched, so a post whose challenge fizzled can be challenged again.
- **`scripts/expire-unmatched-battles.js`** reclassifies the existing rows. Dry run by default, `--commit` to apply. It also reports any unmatched battle carrying a `winner` rather than quietly rewriting it — that would suggest a stat was recorded against a phantom opponent. (It shouldn't be possible: the old code only incremented wins/losses when both a winner *and* a loser resolved, which needs a playerB.)

Classification verified against 8 cases including the exact bug (`status:"completed"`, no `playerB`, past end time → `expired`) and the malformed no-playerA case. App `tsc` and `functions` build both pass.

## Home feed + web alerts (August 9, 2026)

**Every alert in the app was silent on web.** `react-native-web` ships `Alert` as `class Alert { static alert() {} }` — an empty function, not a partial polyfill. All 40 `Alert.alert` call sites did nothing in the browser, so every carefully-caught failure ("Couldn't publish", "Save failed", "Couldn't delete post") produced no dialog at all. A pre-existing comment claimed web "only polyfills a basic window.alert that ignores the buttons array"; the buttons array was ignored because the whole function was.

New `utils/alert.ts` — `showAlert`, `confirm` (promise-based, so one code path works on both platforms), `showAlertWithAction`, `copyToClipboard`. All 40 sites converted, and the three hand-rolled `Platform.OS === "web"` confirm branches collapsed into it.

**That's why delete looked broken.** The delete callable was failing and the only feedback was an alert that never rendered, so the confirm sheet just sat there with the button re-enabled. `PostOwnerMenu` now renders the failure inline and stays open for a retry, and `postDeletionErrorMessage` distinguishes `not-found`/`internal` (the callable isn't deployed — says so explicitly in DEV) from `unavailable` (network) and from real permission errors.

**`deletePost` may simply not be deployed.** It isn't in the handoff's original list of required functions and its test file is untracked, so it was almost certainly added after the last deploy. Run `npx firebase deploy --only functions` — that also ships the `finalizeBattle` expiry change.

Dead buttons found and fixed on the home feed:

- **Share had no `onPress` at all.** It rendered, animated on press, announced itself to screen readers, and did nothing. Now shares a message with a `momentum://profile/{userId}` deep link (there is no `/post/[id]` route, so linking to one would be a dead URL), with a clipboard fallback — RN's `Share` on web delegates to `navigator.share` and *rejects* where that's unavailable, which would have been another silent no-op.
- **Comment said "coming soon"** because the home feed never passed `onComment`, even though `CommentsSheet` is fully built and already reachable from the post detail modal. Wired up, with the sheet held as screen state so only one thread mounts at a time.
- **Comment count always read 0.** Nothing in the app or in Cloud Functions ever writes `post.commentsCount`, so `?? 0` printed a confident zero under every post regardless of the real count. Shows the "Comment" label until a real counter exists. **A server-side counter incremented on comment create is the proper fix** and needs a new Cloud Function.

Everything else on the card and the header verified wired: like, double-tap like, save, more/delete, follow, challenge, avatar→profile, mute toggle, notification bell, discovery tabs, pull-to-refresh, infinite scroll, viewability-driven autoplay.

## Known tradeoffs / open items

- Memoized BattleCards don't opportunistically refresh "Xh remaining" labels; there's no countdown timer (never was). Add one if live countdowns are wanted.
- ~3× Firestore read amplification remains in `fetchPostsByUser(s)` (userId/authorId/uid alias queries). Fix is server-side: backfill `userId` on legacy docs, then query one field.
- Home focus refresh reads up to ~80 post docs per focus — intentional (new posts must appear after Create). Revisit with TTL + create-invalidation at scale.
- 1.74 MB of uncompressed WAV music beds ship in the bundle; AAC would save ~1.5 MB but test loop seams first. `assets/placeholders/` holds 3.15 MB of unreferenced PNGs (repo bloat only).
- Bundle size not measured (sandbox limit): run `npx expo export --platform ios` and check `_expo/static/js/ios/*.hbc`.
- `VideoPostEditor` shows "Edit Video" tools for image posts — product call needed.
- Login's "Forgot Password?" is a non-functional placeholder.
- Device QA needed for: new vector iconography, battles FlatList scroll, hero video autoplay.

## Exact next commands → TestFlight

```bash
# 1. Full verification (typecheck + functions build + rules & contract tests)
npm run verify

# 2. Commit the working tree (review pre-existing hook/rules changes first)
git add -A && git commit -m "Beta polish: design system, shared components, a11y, perf audit fixes"

# 3. Build for TestFlight (production profile; auto-increments build number)
npx eas build --platform ios --profile production

# 4. Submit to TestFlight (ascAppId 6759392911 already configured in eas.json)
npx eas submit --platform ios --latest

# Optional: internal-device smoke build first
npx eas build --platform ios --profile preview
```

Prereqs: logged into EAS (`npx eas whoami`), Apple credentials configured, `.env` populated (see `.env.example`), and Cloud Functions deployed (`finalizeBattle`, `castBattleVote`, `setPostLike`) or stats/likes/votes will fail at runtime.
