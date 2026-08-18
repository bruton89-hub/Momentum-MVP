# Momentum — Controlled Security Deployment: Attempt Record & Runbook

**Date:** 18 August 2026
**Scope:** reviewed backend security changes (Firestore Rules + `finalizeBattle`)
**Outcome:** **STOPPED at the pre-deployment gate — no deployment performed**

---

## Deployment Verdict

# SECURITY DEPLOYMENT FAILED / STOPPED

**Reason: this environment has neither Firebase credentials nor network access to Google APIs. Deployment is not technically possible from here — it is not a failure of the code, which passed every gate.**

This is a hard environmental stop, established by evidence before any deployment was attempted:

| Check | Device VM (Cowork workspace) | Cloud sandbox |
|---|---|---|
| `firebase login:list` | `No authorized accounts` | `No authorized accounts` |
| `GOOGLE_APPLICATION_CREDENTIALS` | unset | unset |
| Service account key | none present | none present |
| Credential tokens in configstore | none (`has_tokens=false`) | none |
| `firebase.googleapis.com` | `000` (proxy 403) | `000` |
| `firebaserules.googleapis.com` | `000` | `000` |
| `cloudfunctions.googleapis.com` | `000` | `000` |
| `oauth2.googleapis.com` | `000` | `000` |

A controlled, non-interactive deployment attempt was made to capture the exact blocker:

```
$ npx firebase deploy --only firestore:rules --project momentum-app-prod-1e870 --non-interactive
Error: Failed to authenticate, have you run firebase login?
```

**Nothing was deployed. Production was never contacted.** With no credentials and no network path, no request could reach `momentum-app-prod-1e870` even in principle.

Per the instruction — *"If any production target is ambiguous: STOP. Do not guess"* — I stopped rather than fabricate verification results. **Every production-verification gate below is reported as NOT TESTED, because none of them could be executed.** I will not mark a flow PASS that I did not observe.

---

## Git

| | |
|---|---|
| **Branch** | `main` |
| **Pre-deployment HEAD** | `2dfd8cdf docs: add Momentum product screenshots` |
| **Security commit** | **NOT CREATED** — see below |
| **Pushed** | **NO** |
| **Final working tree** | 9 modified, 6 untracked (unchanged in substance from the reviewed state, plus a `.gitignore` hardening) |

### The Git checkpoint could not be created either

Git **write** operations cannot complete on this mounted filesystem. Every `git add` creates `.git/index.lock` and then fails to clean it up, and object temp files cannot be unlinked:

```
warning: unable to unlink '.git/objects/5a/tmp_obj_kGPzGM': Operation not permitted
fatal: Unable to create '.git/index.lock': File exists.
```

Result: `git diff --cached --name-only` returned **0 files** — nothing staged, so no commit was possible. This is the same `Operation not permitted` restriction that prevents file deletion in this environment.

**I cleared every stale `index.lock` I created** and verified the repository is left in a clean, usable state — `git status` works and no lock is present. Your own `git` commands will work normally.

### One preparatory change I did make

I appended two exclusions to `.gitignore`, because the checkpoint instructions explicitly require that transfer artifacts and load-test outputs stay out of history:

```gitignore
# Temporary transfer artifacts from agent sessions (never commit)
_to_delete/

# Load-test benchmark outputs are regenerable evidence, not source
tools/load-test/results/
```

Verified effective: `_to_delete/` (1.1 GB) and `tools/load-test/results/` no longer appear in `git status`.

⚠ **One judgement call to confirm or override.** This also excludes `tools/load-test/results/cost-model.json`, which the readiness report cites as its cost-table source. I excluded it because it is a generated artifact, regenerable with `node tools/load-test/src/cli.js cost-model`, and every figure it contains is reproduced in the two reports. If you would rather keep it in history, delete the second `.gitignore` block before committing.

### Pre-commit verification I completed for you

So the checkpoint is ready to make in one command, I ran the full pre-commit inspection:

- **Secrets:** clean. Scanned the entire tracked diff for private keys, service-account blobs, `AIza…` API keys and hardcoded passwords — no matches.
- **No `_to_delete/` artifacts** will be committed (now gitignored).
- **No emulator datasets:** `.firebase-config/`, `.firebase-cache/`, `.firebase-data/` were already gitignored.
- **No generated credentials:** the throwaway RSA key used for the earlier backfill dry run was deleted; `scripts/serviceAccountKey.json` is absent and gitignored.
- **No unrelated app/UI changes:** verified zero modified files under `app/`, `components/`, `hooks/`, `services/`, `utils/`, `store/`, `types/`, `constants/`, `assets/`, and no dependency changes.
- **Debug logs:** `firestore-debug.log` is gitignored.

---

## Pre-Deployment Tests

Run against the exact bytes that would be deployed — I verified the eight deployable files are **checksum-identical** between the sandbox and your Mac before running.

| Suite | Result |
|---|---|
| App TypeScript (`tsc --noEmit`) | **PASS** |
| Functions TypeScript build | **PASS** |
| Unit (battles / mutation / remediation / media) | **20 / 20** |
| Firestore rules (34 existing + 13 hardening + 21 review) | **68 / 68** |
| Storage rules | **8 / 8** |
| Functions contracts | **7 / 7** |
| Battle finalization | **3 / 3** |
| Post deletion | **6 / 6** |
| Engagement concurrency | **8 / 8** |
| Review finalization | **9 / 9** |
| Load-test production guard | **15 / 15** |
| **TOTAL** | **144 passing, 0 failures** |

**Exactly matches the reviewed expectation of 144/0. No discrepancy to investigate.**

Expo Doctor: **NOT RUN** — npm registry access is blocked in both environments. Not required here: this release contains no bundled application changes, and no dependency was modified to enable it (as instructed).

---

## Pre-Deployment Gate

| # | Check | Result |
|---|---|---|
| 1 | Repository path | ✅ `Momentum-MVP`, remote `github.com/bruton89-hub/Momentum-MVP.git` |
| 2 | Branch | ✅ `main` |
| 3 | HEAD | ✅ `2dfd8cdf` |
| 4/5 | Working tree / uncommitted changes | ✅ enumerated above |
| 6 | Scope is reviewed backend only | ✅ rules, `finalizeBattle`, tests, tooling, docs — **no app/UI source, no dependencies** |
| 7 | Production project ID | ✅ `momentum-app-prod-1e870` (`.firebaserc`) |
| 8 | **Firebase CLI authenticated** | ❌ **NO AUTHORIZED ACCOUNTS — this is the blocker** |
| 9 | No load-test / seed / cleanup / backfill running | ✅ none |
| 10 | Backfill flag unchanged | ✅ `.env` untouched; flag not set anywhere |

Gate items 1–7, 9 and 10 pass. **Item 8 fails, which halts the deployment.**

---

## Firestore Rules

| | |
|---|---|
| Project | `momentum-app-prod-1e870` (confirmed, never contacted) |
| Deployment result | **NOT DEPLOYED** — authentication failed before any request |
| Normal post creation | **NOT TESTED** |
| Profile editing | **NOT TESTED** |
| **Renamed-athlete battle flow** | **NOT TESTED in production** |
| **Legacy media-alias battle flow** | **NOT TESTED in production** |
| Representative malicious rejection | **NOT TESTED in production** |

All six are covered by automated tests against the identical ruleset (68/68 passing), including dedicated regression probes for the renamed-athlete and legacy-media cases. **That is emulator evidence, not production evidence, and I am not presenting it as a substitute.** The production verification gate remains genuinely outstanding.

## Functions

| | |
|---|---|
| Functions deployed | **NONE** |
| Target | `momentum-app-prod-1e870` (never contacted) |
| Deployment result | **NOT ATTEMPTED** — blocked by the Stage 1 gate, correctly not reached |
| Finalization verification | **NOT TESTED in production** |

## Production Smoke Test

| Flow | Result |
|---|---|
| Feed | **NOT TESTED** |
| Profile | **NOT TESTED** |
| Posts | **NOT TESTED** |
| Likes | **NOT TESTED** |
| Comments | **NOT TESTED** |
| Follows | **NOT TESTED** |
| Battles | **NOT TESTED** |
| Voting | **NOT TESTED** |
| Notifications | **NOT TESTED** |
| Deletion | **NOT TESTED** |

No production flow was exercised, because no deployment occurred and no production access exists.

---

## Security Findings — production status

**None of the six P1 protections are active in production.** They remain exactly as they were before this work began: fixed and verified in the repository, **undeployed**.

| # | Protection | In repo | Active in production |
|---|---|---|---|
| P1-1 | Post creation integrity (counters, media ownership, timestamps, identity) | ✅ fixed, tested | ❌ **NOT ACTIVE** |
| P1-2 | Self-granted verification badges blocked | ✅ fixed, tested | ❌ **NOT ACTIVE** |
| P1-3 | Battle entry bound to owned posts (+ 2 regression fixes) | ✅ fixed, tested | ❌ **NOT ACTIVE** |
| P1-4 | Comment identity forgery blocked | ✅ fixed, tested | ❌ **NOT ACTIVE** |
| P1-5 | `finalizeBattle` aggregate reconciliation | ✅ fixed, tested | ❌ **NOT ACTIVE** |
| P1-6 | Username canonicalisation enforced | ✅ fixed, tested | ❌ **NOT ACTIVE** |

**Production remains exposed to all six.** They are live-exploitable today. This is the single most important line in this report.

---

## Backfill

# NOT RUN

# POSTS_USERID_BACKFILLED FLAG UNCHANGED

- `scripts/backfill-post-user-id.js --commit` — **not executed**, in any environment.
- `EXPO_PUBLIC_POSTS_USERID_BACKFILLED` — **not set**; `.env` is untouched (`git status` on `.env`/`.env.example` is empty).
- No environment change enabling the new post query path was made or deployed.
- The backfill remains blocked pending a production dry run confirming `Unresolvable: 0`, exactly as the security gate required.

## Client Release

**No new client build was created, and none is required.**

Verified: zero modified files under `app/`, `components/`, `hooks/`, `services/`, `utils/`, `store/`, `types/`, `constants/` or `assets/`; no dependency changes; `app.config.js`, `eas.json`, `google-services.json` and `GoogleService-Info.plist` untouched. The shipped bundle is byte-identical to build 34. No TestFlight build, no App Store submission.

## Cleanup

**`_to_delete/` — NOT DELETED. 1.1 GB. Safe for you to delete.**

Attempted; refused by the environment:

```
rm: cannot remove '_to_delete/...': Operation not permitted
```

Contents re-verified as exclusively temporary: `node_modules` tarballs and split parts, two git extracts from the security review, and a handful of stale `index.lock` files I moved there during the checkpoint attempt. Nothing original; everything reconstructable from `npm ci` or `git show`. It is now gitignored, so it cannot enter history.

```bash
rm -rf ~/Documents/Momentum-MVP/_to_delete
```

---

## Runbook — the deployment, for you to execute

Everything is staged and verified; these are the exact commands. Run them from `~/Documents/Momentum-MVP` on your Mac (which has network and can authenticate).

```bash
# 0. Authenticate (the blocker for this session)
npx firebase login
npx firebase use momentum-app-prod-1e870

# 1. Git checkpoint — verified clean, ready to commit
git add -A
git status                      # confirm _to_delete/ and results/ are absent
git commit -m "security: enforce post/profile/battle/comment write integrity in Firestore rules

- posts: exact-shape create validation (counters, media ownership,
  bounded client timestamps, author identity)
- users: block self-granted verification/ranking fields; enforce
  usernameLower canonicalisation
- battles: bind player entries to a real post owned by that athlete,
  on create and on accept
- comments: block author identity forgery feeding notifications
- follows: reject self-follows and empty targets
- finalizeBattle: reconcile vote counters with count() aggregates
  instead of scanning every vote document inside the transaction

Adds 30 verification tests (baseline-vs-fixed, regression probes,
finalization semantics). 144 tests passing, 0 failures.
Backend only: no bundled client source or dependency changed."

# 2. STAGE 1 — Rules only. Nothing else in this command.
npx firebase deploy --only firestore:rules --project momentum-app-prod-1e870

# 3. RULES VERIFICATION GATE — do not proceed until all pass.
#    In the app with a real test account:
#      a. publish a normal post
#      b. edit profile fields
#      c. LOAD-BEARING: with an account that has RENAMED itself,
#         create or accept a challenge using a post made BEFORE the rename
#      d. LOAD-BEARING: battle using a legacy post whose media is stored
#         under mediaURL/photoURL rather than mediaUrl (skip if no such
#         fixture exists — do not manufacture one)
#      e. confirm a malicious write is rejected (e.g. Rules Playground:
#         post create with likesCount: 5000 must FAIL)
#      f. spot-check likes, comments, follows, battle entry, voting,
#         notifications, post deletion
#    If any legitimate flow breaks: STOP. Roll rules back. Do not deploy functions.

# 4. STAGE 2 — Functions. Only after step 3 passes.
npx firebase deploy --only functions:finalizeBattle --project momentum-app-prod-1e870

# 5. FUNCTION VERIFICATION GATE
#    - finalize one real ended battle; winner must match persisted counters
#    - statsRecorded true; wins/losses incremented exactly once
#    - both result notifications delivered
#    - re-finalize the same battle -> already_recorded, stats unchanged
#    - confirm existing battles still read and voting still works
#    - WATCH LOGS for failed-precondition on the aggregate path:
#        npx firebase functions:log --only finalizeBattle
#      (this is the one residual production-vs-emulator risk)

# 6. Push
git push origin main            # no force push
```

**Steps 3c and 3d are the ones that matter most** — they are the two regressions the independent review caught in the prior agent's work, and emulator coverage is not a substitute for seeing them work against production data.

**Do NOT run** in this deployment: the backfill, the `EXPO_PUBLIC_POSTS_USERID_BACKFILLED` flag, `firebase deploy` without `--only`, or any load-test command.

---

## Remaining Risks

1. **Production is still exposed to all six P1 vulnerabilities.** Nothing shipped. Every day undeployed is a day the self-granted `coachVerified` badge and the content-theft paths remain live in a product used by minors. This is the top risk and it is unchanged from before this session.
2. **The rules changes have still never run against real production data.** Emulator coverage is strong (68 rules tests including regression probes for both defects found in review), but production may hold document shapes neither agent inferred. The failure mode is denial of a legitimate write — visible and reversible — which is why step 3 is a gate and not a formality.
3. **The aggregate index assumption remains evidence-based, not production-tested.** In-repo precedent is strong (`fetchUnreadNotificationCount` ships the same two-equality-filter `count()` shape today), but step 5's log check is the real confirmation.
4. **No Git checkpoint exists.** The reviewed work is uncommitted on `main`, protected only by the working tree. An accidental `git checkout .` would destroy it. Committing is the single highest-value next action even before deployment.
5. **The backfill precondition is still unverified** — the production dry run confirming `Unresolvable: 0` has not been run, and the profile bug (athletes seeing their oldest 30 posts, not newest) remains live.
6. Unchanged from the review: `cleanup-firestore.js` has no hard project guard; App Check is unenforced; the Node 20 Functions runtime is decommissioned 30 Oct 2026; votes and likes have no client retry.

---

**MOMENTUM SECURITY DEPLOYMENT STOPPED — REVIEW REQUIRED**
