# Momentum MVP — Setup & Launch Guide

## Prerequisites
- Node.js 18+
- Expo CLI: `npm install -g expo-cli`
- EAS CLI: `npm install -g eas-cli`
- Xcode 15+ (for iOS / TestFlight)
- Firebase project: `momentum-live-483819` (already configured)

---

## Step 1 — Install Dependencies

```bash
cd Momentum-MVP
npm install
```

---

## Step 2 — Environment Variables

Copy `.env.example` to `.env`:

```bash
cp .env.example .env
```

The `.env.example` already contains the correct values for the existing
`momentum-live-483819` Firebase project. No changes needed unless you
want a separate Firebase project.

---

## Step 3 — Firebase Service Files

Copy from `momentum-mobile-v3` (same project):

```bash
cp ../momentum-mobile-v3/GoogleService-Info.plist ./GoogleService-Info.plist
cp ../momentum-mobile-v3/google-services.json ./google-services.json
```

---

## Step 4 — Firebase Rules & Indexes

Deploy the Firestore rules and indexes:

```bash
npx firebase deploy --only firestore:rules --project momentum-live-483819
npx firebase deploy --only firestore:indexes --project momentum-live-483819
```

---

## Step 5 — Run Locally

```bash
# Start Expo dev server
npm start

# Or run directly on iOS simulator
npm run ios

# Scan QR with Expo Go on device
```

---

## Step 6 — TestFlight Build

### 6a. Configure EAS (first time only)
```bash
eas login
eas build:configure
```

### 6b. Development build (for physical device testing)
```bash
eas build --profile development --platform ios
```

### 6c. Preview build (internal TestFlight distribution)
```bash
eas build --profile preview --platform ios
```

### 6d. Production build (App Store / TestFlight public)
```bash
eas build --profile production --platform ios
eas submit --platform ios
```

---

## Firestore Collections

| Collection | Purpose |
|---|---|
| `users/{userId}` | User profiles |
| `posts/{postId}` | Posts with media |
| `likes/{postId_userId}` | Like records |
| `battles/{battleId}` | Battle records |
| `votes/{battleId_userId}` | Vote records |

---

## User Flow

```
Register → Pick Sport
    ↓
Home Feed → Double-tap to like
    ↓
Create Post → Toggle "Enter Battle" → Upload
    ↓
Battles Tab → Accept Open Challenge → Live Battle
    ↓
Vote → See Results
    ↓
Profile → Stats (Posts / Wins / Losses)
```

---

## Assets Required

Before building for TestFlight, add these to `assets/`:
- `icon.png` — 1024×1024 app icon (black bg, neon green ⚡)
- `splash.png` — 1242×2436 splash screen

You can copy from `momentum-mobile-v3/assets/` for now:
```bash
cp -r ../momentum-mobile-v3/assets ./assets
```

---

## Known MVP Limitations (intentional)

- No push notifications
- No in-app messaging
- No leaderboards or XP
- Battle winner calculated client-side (by vote count at expiry)
- No Cloud Functions for battle settlement — add post-MVP

---

## Quick Troubleshooting

| Issue | Fix |
|---|---|
| Metro bundler error | `npm start -- --clear` |
| Firebase auth error | Check `.env` values are correct |
| Image not uploading | Check Firebase Storage rules are deployed |
| Blank screen on launch | Check `GoogleService-Info.plist` is present |
| Reanimated crash | Ensure `babel.config.js` has the plugin |
