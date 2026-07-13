# Momentum MVP — Production Readiness / Performance Audit

Date: July 8, 2026
Scope: re-renders, Firestore reads, mount frequency, list virtualization, image caching, video loading, memory, bundle size.
Method: static analysis of every screen/hook/service plus measurable read/render accounting. All fixes preserve behavior and UI; `tsc --noEmit` passes.

## Fixes applied (measurable waste removed)

**1. Duplicate image downloads in production — `components/MediaTile.tsx`.**
`Image.prefetch()` was documented as a DEV-only diagnostic but ran unconditionally, issuing a second native download alongside `<Image>`'s own load for every image tile. Cost: one redundant network request per image tile per mount — on a profile grid that is up to 30 extra requests per visit. Now gated behind `__DEV__`.

**2. Unused vote lookups on profile screens — `hooks/useBattles.ts`, both profile screens.**
`useBattles` always fetched the viewer's votes (up to 3 Firestore `in` queries / 30 doc reads per fetch). Both profile screens consume only the battles list and never render or cast votes. Added an `includeVotes` flag (default `true`, so the Battles tab is unchanged) and passed `false` from both profile screens. Saves 3 queries per profile visit.

**3. No virtualization on the Battles screen — `app/(tabs)/battles.tsx`.**
The My Battles / Completed lists rendered every `BattleCard` (two media tiles, thumbnail generation, avatars each) eagerly inside a `ScrollView`. With the 30-battle page size that is 30 heavy card mounts and ~60 media tiles at once. Converted to `FlatList` (`initialNumToRender=3`, `maxToRenderPerBatch=3`, `windowSize=7`, `removeClippedSubviews`) — initial mounts drop from 30 to 3 (−90%), and off-screen cards are reclaimed. The live tab's hero + "More Battles" section renders identically as the list header (those rows are lightweight). UI is pixel-identical.

**4. Unmemoized heavy cards — `components/BattleCard.tsx`.**
Opening/closing the detail or accept modal re-rendered every visible BattleCard because the component wasn't memoized (PostCard already was). All props are primitives or `useCallback`-stable, so `memo()` now prevents those re-renders outright.

**5. One re-render per scroll tick on Home — `app/(tabs)/index.tsx`.**
The viewability handler created a new `Set` for prepared video IDs on every scroll event, forcing a full `HomeScreen` re-render per tick even when contents were identical. Now bails out by returning the previous Set when contents are equal; `setActiveVideoPostId` already bails on identical primitives.

**6. Profile list tuning — both profile screens.**
`windowSize` reduced from the default 21 to 9 with tab-appropriate `initialNumToRender` (15 grid cells / 8 battle rows), bounding off-screen render work for prolific athletes.

**7. Ungated production logging — `app/(tabs)/create.tsx`.**
A `console.log` of the full picked-asset object ran on every media selection in production builds. Now `__DEV__`-gated. (All other logging was already gated or error-path only.)

## Verified healthy (no change needed)

Feed pipeline (`usePosts`): AsyncStorage feed cache paints instantly before network; background pool expansion reuses the first query's cursor (no re-reads); `handleLike`/`refresh` identities are ref-stabilized so likes don't cascade re-renders through memoized cards. Video: only the visible card plus the next one mount a native player; players pause when inactive and unload on unmount. Thumbnails: `getVideoThumbnailUri` has an in-memory cache with in-flight request dedup. Battle finalization: module-level session guard prevents re-invoking the Cloud Function on every focus. Firebase imports are fully modular (tree-shakeable); no heavyweight JS deps (no lodash/moment/etc.).

## Identified, intentionally not changed

**Firestore read amplification (~3×) in `services/postRepository.ts`.** `fetchPostsByUser(s)` queries three userId aliases (`userId`, `authorId`, `uid`) because legacy docs may carry only one. Since `createPost` writes all three, every modern doc is returned — and billed — three times: up to 90 reads to display 30 profile posts. The safe fix is server-side: backfill `userId` onto legacy docs (scripts/ already has migration tooling), then query the single field. ~66% read reduction on profile grids and the Following feed. Client-only changes would risk hiding legacy posts, so not done here.

**Home focus refresh cost.** Every Home tab focus re-reads follows + up to 80 post docs (24 initial + 56 background). This is deliberate — it's how a just-created post appears after `router.replace("/")` — so a TTL would change behavior. If read costs matter at scale, invalidate on post-creation and add a short TTL, or move page one to `onSnapshot`.

**Bundled audio: 1.74 MB of uncompressed WAV.** The five editor music beds are `require()`d, so they always ship. AAC/M4A at the same quality would save ~1.5 MB of bundle, but these are short looping beds and AAC encoder padding can produce an audible loop gap — convert and A/B the loop seam before shipping.

**Dead assets: 3.15 MB in `assets/placeholders/`.** Four 788 KB PNGs referenced nowhere in code or config. Not in the JS bundle (Metro only bundles `require()`d assets and `assetBundlePatterns` is unset), so this is repo bloat rather than app bloat — but worth deleting or relocating.

**Bundle measurement.** `npx expo export` could not complete inside this sandboxed environment (long-running Metro processes are reaped). Dependency review shows no bundle red flags. Run `npx expo export --platform ios` locally and check `_expo/static/js/ios/*.hbc` for the authoritative number; a fresh Expo 50 + Firebase app of this size typically lands ~3–4 MB Hermes bytecode.

**Minor product note.** `VideoPostEditor` renders its editing entry points for image posts as well (mount cost is negligible — players only mount inside its modals), but "Edit Video" on a photo post may be unintended.
