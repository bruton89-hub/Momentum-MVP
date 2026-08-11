# Momentum Release Stress-Test Checkpoint

## Release identity

- Version: 1.0.1
- iOS build: 33
- Android version code: 25
- Release commit: `35438f826858241f2c51acfe80d0af91dcdedb06`
- EAS build ID: `f8a55b3e-9548-4c12-ac63-3a4b39d4f6bc`
- EAS build: production iOS, finished successfully
- EAS artifact: https://expo.dev/artifacts/eas/bgeHjbpwna-UVkNLdHhxsMTznhMZblZ21HUGhfEO8nU.ipa

## Stress-test progression

- Phase 1: RED
- Phase 2: GREEN
- Phase 3: GREEN
- Physical-device verification: passed based on user testing of the changed build, which the user reported was running smoothly

## Major defects discovered and remediated

- Forged battle and stat-integrity vulnerability
- Acknowledgement-loss duplicate creation
- Notification provenance forgery
- Following-feed stale-request race
- Profile account-switch race
- Create preview lifecycle issue
- Phase 3 Create discard retention issue
- Follow-notification hydration issue
- Missing authoritative battle vote reconciliation

## Security architecture changes

- Battle creation rules now accept only validated open and direct challenge shapes.
- Post and battle creation use deterministic, operation-scoped IDs for idempotent retries.
- Battle result notifications are created by the authoritative finalization Function.
- Client-created notifications must match their backing follow, comment, post, or battle resource.
- Finalization reconciles stored counters with authoritative vote-marker documents.
- Stats and result notifications are committed atomically and exactly once.

## Validation

Final release validation completed with **75/75 automated tests passing and 0 failures**:

- Battle behavior: 9/9
- Media upload: 4/4
- Mutation and remediation guards: 6/6
- Firestore rules: 33/33
- Storage rules: 8/8
- Functions contracts: 7/7
- Battle-finalization integration: 3/3
- Post-deletion integration: 5/5

Additional successful gates:

- App TypeScript
- Functions TypeScript
- Expo dependency compatibility check
- Web production export
- iOS production export
- Android production export
- `git diff --check`

## Deployment

- Firebase project: `momentum-app-prod-1e870`
- Firestore rules: deployed successfully first
- Cloud Functions: deployed successfully immediately afterward
- Functions deployed: `finalizeBattle`, `castBattleVote`, `setPostLike`, and `deletePost`
- Post-deployment Function hash: `8a5b42f4c83badb3903fb4c437837aa3fe947922`
- Post-deployment verification: all four Functions reported `ACTIVE` in `us-central1`; `finalizeBattle` was present and healthy by deployment/inventory status
- Backend conclusion: ready for client version 1.0.1

## Device verification

The changed build was physically exercised by the user and reported as running smoothly. This checkpoint records that user report and does not assert that any additional device scenarios were independently executed during the final release task.

## Remaining non-blocking risks

- `firebase-functions` remains outdated; upgrading can include breaking changes and was outside this release scope.
- The Node.js 20 Functions runtime is deprecated and is scheduled for decommissioning on October 30, 2026; a runtime migration must be planned before then.
- Force-quitting between a Storage upload and its Firestore write can leave an orphaned Storage object.
- Follow and individually deleted comment notifications can remain as historical records.
- Historical production data was not fully audited.
- Expo dependency validation ran offline and warns that offline compatibility validation is less authoritative.

## Release conclusion

**RELEASE CHECKPOINT PASSED**
