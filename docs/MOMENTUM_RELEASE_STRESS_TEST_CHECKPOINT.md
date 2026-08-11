# Momentum Release Stress-Test Checkpoint

## Release identity

- Version: 1.0.1
- iOS build: 34
- Android version code: 26
- Release commit: `b45124543837cfdb5cdd360f8b46ab2b2f4b68e6`
- EAS build ID: `99c83062-bfae-4f06-b98a-4bf194d08569`
- EAS build: production iOS, finished successfully
- EAS artifact: https://expo.dev/artifacts/eas/KW6hCxIV4qlhJ5eEhMXXpy-qJJdgDi2PfaPj13XwKLs.ipa

## Stress-test progression

- Phase 1: RED
- Phase 2: GREEN
- Phase 3: GREEN
- Physical-device verification: passed based on user testing, including the athlete-profile back control and legacy post deletion

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
- Legacy post ownership compatibility in deletion rules and the deletion callable
- Athlete-profile back control positioning and touch reliability on iPhone safe areas

## Security architecture changes

- Battle creation rules now accept only validated open and direct challenge shapes.
- Post and battle creation use deterministic, operation-scoped IDs for idempotent retries.
- Battle result notifications are created by the authoritative finalization Function.
- Client-created notifications must match their backing follow, comment, post, or battle resource.
- Finalization reconciles stored counters with authoritative vote-marker documents.
- Stats and result notifications are committed atomically and exactly once.

## Validation

Final release validation completed with **78/78 automated tests passing and 0 failures**:

- Battle behavior: 9/9
- Media upload: 4/4
- Mutation and remediation guards: 7/7
- Firestore rules: 34/34
- Storage rules: 8/8
- Functions contracts: 7/7
- Battle-finalization integration: 3/3
- Post-deletion integration: 6/6

Additional successful gates:

- App TypeScript
- Functions TypeScript
- Expo dependency compatibility check: 16/16
- Web production export
- iOS production export
- Android production export
- `git diff --check`

## Deployment

- Firebase project: `momentum-app-prod-1e870`
- Firestore rules: deployed successfully first
- Cloud Functions: deployed successfully immediately afterward
- Functions deployed: `finalizeBattle`, `castBattleVote`, `setPostLike`, and `deletePost`
- Post-deployment Function hash: `3c392376e15d06d7c11a1d8eaeba0cfca5b46304`
- Post-deployment verification: all four Functions reported `ACTIVE` in `us-central1`; `finalizeBattle` was present and healthy by deployment/inventory status
- Backend conclusion: ready for client version 1.0.1 build 34

## Device verification

The changed build was physically exercised by the user. The user reported that the athlete-profile back button works reliably and that deletion succeeds for a legitimate legacy-owned post. This checkpoint records those user results and does not assert that any additional device scenarios were independently executed during the final release task.

## Remaining non-blocking risks

- `firebase-functions` remains outdated; upgrading can include breaking changes and was outside this release scope.
- The Node.js 20 Functions runtime is deprecated and is scheduled for decommissioning on October 30, 2026; a runtime migration must be planned before then.
- Force-quitting between a Storage upload and its Firestore write can leave an orphaned Storage object.
- Follow and individually deleted comment notifications can remain as historical records.
- Historical production data was not fully audited.

## Release conclusion

**RELEASE CHECKPOINT PASSED**
