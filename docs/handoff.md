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
