# Momentum Load-Test & Capacity Benchmark Harness

Safe, repeatable capacity benchmarking for Momentum. **Refuses to run against production.**

## Safety first

Every entry point — benchmark, seeder, cleanup — passes through
`src/guard.js` before any client, Admin SDK instance, or network connection is
constructed. The guard validates the **actual Firebase project ID**, never an
environment name like "prod" or "staging".

Refusal message:

```
MOMENTUM LOAD TEST REFUSED — PRODUCTION PROJECT DETECTED
```

Blocklisted (from this repository's own config):

- `momentum-app-prod-1e870` — `.firebaserc` default, `.env`, `GoogleService-Info.plist`
- `momentum-live-483819` — `google-services.json` (Android)

Matching is case-insensitive, whitespace-tolerant, and catches embedded
variants. **No override bypasses it** — a test asserts that even with both
allowlist variables set to production, the guard still refuses.

Run the mandatory safety suite any time:

```bash
npm run loadtest:safety     # 15 tests, no emulator required
```

## Target selection

| Target | Requirement |
|---|---|
| `demo-*` project | Default. Emulator-only; requires loopback emulator hosts. |
| Any other non-production project | Requires **both** `LOADTEST_ALLOW_PROJECT=<exact id>` and `LOADTEST_ALLOW_CLOUD=I_UNDERSTAND_THIS_TARGETS_A_REAL_FIREBASE_PROJECT` |
| Production | **Impossible.** |

## Environment variables

| Variable | Default | Purpose |
|---|---|---|
| `GCLOUD_PROJECT` / `LOADTEST_PROJECT_ID` | `demo-momentum-loadtest` | Target project ID (set automatically by `emulators:exec`) |
| `FIRESTORE_EMULATOR_HOST` | `127.0.0.1:8080` | Firestore emulator |
| `FIREBASE_AUTH_EMULATOR_HOST` | `127.0.0.1:9099` | Auth emulator |
| `FIREBASE_STORAGE_EMULATOR_HOST` | `127.0.0.1:9199` | Storage emulator |
| `LOADTEST_FUNCTIONS_EMULATOR_HOST` | `127.0.0.1:5001` | Functions emulator |
| `LOADTEST_ALLOW_PROJECT` | unset | Explicit non-demo allowlist |
| `LOADTEST_ALLOW_CLOUD` | unset | Second acknowledgement for non-demo targets |

## Usage

All commands run inside the emulator wrapper:

```bash
npm run loadtest:emulator "<command>"
```

| Command | What it does |
|---|---|
| `cli.js seed --users N --posts N --battles N` | Create synthetic athletes, posts, follows, battles |
| `cli.js seed-more-posts --from A --to B` | Grow the post corpus for dataset-scale tests |
| `cli.js tier --users N [--warmup/--ramp/--sustain/--cooldown S]` | Full concurrency tier with ramp profile |
| `cli.js battle-stress --voters N` | Concentrated voting on one battle + reconciliation |
| `cli.js feed-bench [--sessions N --refreshes N]` | Feed pagination, duplicates, reads/session |
| `cli.js profile-bench` | Legacy 3-alias vs consolidated profile reads |
| `cli.js media-bench [--uploads N --sizeKb N]` | Isolated Storage track (small fixtures only) |
| `cli.js index-probe` | Distinguishes result-size cost from collection-scan cost |
| `cli.js contention-probe --concurrency N` | Distinguishes per-document contention from env-wide serialization |
| `cli.js integrity` | Reconciles all counters against authoritative markers |
| `cli.js cleanup [--dry-run]` | Removes all synthetic data |

Shortcuts: `npm run loadtest:100 | :250 | :500 | :1000`, `loadtest:battle`, `loadtest:feed`, `loadtest:seed`, `loadtest:cleanup`.

Results are written as JSON to `tools/load-test/results/`.

## Synthetic data is always identifiable

- Document IDs prefixed `lt-`
- Every seeded document carries `loadtest: true`
- Auth users use `@loadtest.momentum.test`

`cleanup` removes exactly these, including dependent documents (votes, likes,
notifications) created by the callables during a run.

## Workload model

Mirrors real client code paths — each is annotated in `src/workloads.js` with
the file it mirrors. Page sizes are the app's own constants (feed 24 + 56,
battles 30, profile 30/alias, notifications 100).

| Workload | Share | Behaviour |
|---|---|---|
| A — Browsing | 60% | auth, feed + follows, scroll (think time), profiles, posts, periodic refresh |
| B — Engaged | 25% | browsing + likes, follow/unfollow, battles tab, voting |
| C — Creator | 10% | browsing + post creation metadata, open battle creation, own profile, notifications |
| D — Battle | 5% | repeated battles-tab loads + voting on one hot battle |
| E — Mixed | — | the 60/25/10/5 population above (unchanged from the brief) |

Client-side pagination windows an already-fetched pool in the real app, so it
is modelled as think time, not extra reads — matching `usePosts`.

## Why REST instead of the Firebase JS SDK

One SDK app instance per virtual user costs enough driver memory and CPU to
distort measurements at hundreds of VUs. The app issues only one-shot
reads/writes/callables (no snapshot listeners anywhere — verified in the
architecture audit), so authenticated REST requests reproduce the identical
query shapes, the identical security-rules evaluation, and identical billing
characteristics at a fraction of the driver cost.

**Security rules are fully enforced for all synthetic traffic.** The harness
never bypasses the app's security controls. Seeding and cleanup use the Admin
SDK deliberately and are separately guarded.

## Interpreting results honestly

The Firestore emulator is a single Java process, not a distributed database.
Two probes exist specifically so environment artifacts are never reported as
Momentum bottlenecks:

- **`index-probe`** — if `limit(1)` costs the same as `limit(24)` on a large
  collection while the same query shape on a small collection is far faster,
  latency is tracking collection size (emulator scan), not result size.
- **`contention-probe`** — if writes to *disjoint* documents are as slow as
  writes to one *shared* document, the serialization is environment-wide, not
  per-document contention in Momentum's data model.

Every tier result also reports driver event-loop lag (`driver.saturated`), so a
harness-side limit is never mistaken for a backend limit.

## Classification

| Status | Criteria |
|---|---|
| PASS | error rate < 1%, no integrity violations, P95 acceptable, no sustained backend failure |
| DEGRADED | error rate > 1%, P95 > 1.5 s, or transaction contention present |
| FAIL | error rate > 5%, timeouts > 1% of operations, **or any integrity violation** |

An integrity violation fails the tier regardless of latency.
