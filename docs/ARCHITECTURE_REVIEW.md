# Momentum MVP Architecture Review

## Current architecture

### Client runtime

- Expo Router owns navigation and route-level authentication redirects.
- Firebase Auth is observed once in `app/_layout.tsx`.
- Zustand stores the authenticated user ID, hydrated profile, and bootstrap state.
- Screens and components call Firestore-backed hooks directly.
- Firebase Storage holds post media and avatars.
- Firestore stores users, posts, likes, follows, battles, and votes.

### Server runtime

- Firebase Cloud Functions currently exposes one callable:
  `finalizeBattle`.
- The function atomically closes an expired battle and increments winner/loser
  statistics.
- Firestore and Storage rules provide the authorization boundary for all other
  client writes.

### Primary data flows

1. Authentication
   - Firebase Auth emits the current user.
   - The root layout fetches `users/{uid}`.
   - Zustand publishes the user and profile to the route tree.

2. Post creation
   - The client selects and uploads media to Storage.
   - The client writes a post document to Firestore.
   - The client attempts to increment the user's post counter.

3. Feed loading
   - The global feed reads the latest post documents.
   - The following feed reads the follow graph, fans out author queries, merges
     legacy schemas, deduplicates, and sorts locally.
   - Likes are loaded in a separate query and joined in memory.

4. Battle lifecycle
   - The client creates an open battle.
   - Another client accepts it and supplies player B.
   - Votes are written in a transaction with a battle counter increment.
   - A client that reads an expired battle invokes `finalizeBattle`.
   - The callable closes the battle and records profile statistics.

5. Profiles
   - Profile documents are fetched directly.
   - User posts are queried by three author-field aliases for legacy
     compatibility.
   - Follow state is loaded and mutated directly from the client.

## Critical problem areas

### P0: authorization rules do not validate counter deltas

The post rule permits any signed-in user to modify `likesCount` as long as it is
the only changed field. The battle rule has the same weakness for `votesA` and
`votesB`. A modified client can write arbitrary counter values without creating
the corresponding like or vote document.

Move likes and votes behind callable functions or Firestore triggers. Validate
identity, uniqueness, battle state, participant restrictions, and exact counter
deltas in one server-side transaction.

### P0: post counters are intentionally blocked and silently fail

`createPost` increments `users/{uid}.posts`, while Firestore rules explicitly
forbid clients from changing `posts`. The error is swallowed, so the UI reports
success while profile counts drift.

Move post creation and the profile counter update into one callable transaction,
or derive post counts asynchronously with a trusted trigger.

### P1: battle finalization is driven by reads

Every battle-list load reads the full collection, finds expired battles, calls a
function for each one, then reads the full collection again. Cost and latency
grow with historical battle count and active clients.

Finalize battles with scheduled server work or per-battle Cloud Tasks. Query
active and completed battles separately with indexes and cursors.

### P1: unbounded and fan-out reads

- The battle list has no limit or cursor.
- User post queries read all posts three times under legacy aliases.
- Following-feed reads scale as `3 * ceil(followedUsers / 10)` queries.
- The per-query limit is applied before the global merge, so results can be
  biased and over-read.

Migrate legacy documents to one canonical schema, remove alias writes, and use
indexed cursor pagination. At larger scale, materialize home timelines or use a
backend aggregation endpoint.

### P1: multi-step battle creation is not atomic

The direct-challenge flow creates an open battle and then accepts it. A failure
between writes leaves an unintended open battle.

Use a single server command for live battle creation. Keep open-challenge
creation and acceptance as separate commands only when that is the intended
product flow.

### P1: username uniqueness is race-prone

Checking `users where username == value` before writing is not an atomic
uniqueness guarantee. Concurrent registrations can claim the same username.

Reserve a normalized username document such as `usernames/{normalizedName}` in
the same trusted transaction that creates or renames the profile.

### P2: domain, persistence, and UI responsibilities are mixed

Several `use*` files contain Firestore queries, schema migration compatibility,
write commands, optimistic state, and React lifecycle code. Components also
perform direct Firestore reads.

Use the following dependency direction:

```text
screens/components
        |
application hooks/controllers
        |
domain services and repository interfaces
        |
Firebase repository implementations
        |
Firebase SDK
```

### P2: denormalized identity fields have no refresh policy

Posts and battles copy username and avatar data. This is efficient for reads but
becomes stale after a profile edit.

Choose and document one policy: immutable snapshot identity, background
propagation, or render-time profile joins. Do not leave the behavior implicit.

### P2: operational quality gates are incomplete

The repository had no root typecheck/verification command, automated tests,
linting, or CI workflow. Security rules and transaction behavior need emulator
tests before server-side mutation refactors.

## Refactoring strategy

### Phase 1: establish boundaries without changing behavior

- Centralize Firestore normalization and compatibility queries.
- Keep Firebase SDK imports out of presentation components.
- Extract upload, error normalization, and logging adapters.
- Add a single verification command.
- Add unit tests for pure normalizers and battle-state calculations.

### Phase 2: canonicalize data

- Backfill posts to `userId`, `createdAt`, `mediaUrl`, and `mediaType`.
- Stop writing `authorId` and `uid`.
- Add required composite indexes and cursor-based repository methods.
- Remove client-side alias fan-out after migration verification.

### Phase 3: move invariants server-side

- Add callable commands for post creation, likes, votes, challenge acceptance,
  and direct live-battle creation.
- Make each command idempotent and transactional.
- Tighten Firestore rules so clients cannot write counters or protected state.

### Phase 4: scale read models

- Split active/open/completed battle queries.
- Schedule battle finalization.
- Add cursor pagination and cache policy.
- Materialize following timelines if fan-out reads become a cost or latency
  problem.

## Changes applied in this review

- Added `services/postRepository.ts` as the single compatibility boundary for
  post normalization, legacy author queries, deduplication, and sorting.
- Removed duplicate Firestore query/merge implementations from the battle
  picker, acceptance modal, user-post hook, and following-feed hook.
- Stabilized battle voting against stale React closures and duplicate rapid
  submissions.
- Added `npm run typecheck` and `npm run verify`.

These changes preserve the existing Firebase schema and user-visible behavior.
