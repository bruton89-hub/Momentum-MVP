# Controlled TestFlight Launch Checklist

## Configuration

- [ ] `.env` Firebase project matches the intended production project.
- [ ] `EXPO_PUBLIC_EXPECTED_FIREBASE_PROJECT_ID` is set to that project ID.
- [ ] `GoogleService-Info.plist` belongs to `com.momentumapp.sports`.
- [ ] EAS project ID resolves to `4148ae9f-36be-4364-aa69-09cbf0ead6ae`.
- [ ] Firebase CLI target and explicit `--project` value match production.
- [ ] No service account keys or native Firebase files are staged for commit.

## Verify locally

```bash
npm run typecheck
npm --prefix functions run build
npm run test:rules
npm run test:functions:emulator
npx expo config --type public
eas project:info
```

## Deploy order

Deploy callables before locking client writes:

```bash
npx firebase deploy --only functions --project "$FIREBASE_PROJECT_ID"
npx firebase deploy --only firestore:rules,firestore:indexes,storage --project "$FIREBASE_PROJECT_ID"
```

Smoke-test the production backend with two non-admin test accounts:

- [ ] Register/login and profile load.
- [ ] Upload an image.
- [ ] Upload a short video under 50 MB.
- [ ] Create and accept a battle.
- [ ] Vote once; a second vote is rejected/idempotent.
- [ ] Like and unlike a post.
- [ ] Expired battle finalizes once and stats update once.
- [ ] Feed, following feed, battle list, and profiles load without crashes.

## Cost controls

- [ ] Budget alerts configured.
- [ ] Firestore/Functions/Storage dashboards opened for launch monitoring.
- [ ] Artifact Registry cleanup policy reviewed.
- [ ] App Check rollout decision documented.

## TestFlight

```bash
eas build --profile production --platform ios --non-interactive
eas build:view <BUILD_ID> --json
eas submit --platform ios --profile production --latest --non-interactive
```

- [ ] Confirm version/build number in App Store Connect.
- [ ] Add only the controlled tester group.
- [ ] Monitor crashes and Firebase usage after the first install and first day.
