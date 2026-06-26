# Momentum MVP - Setup & Launch Guide

## Prerequisites
- Node.js 18+
- Expo CLI through `npx expo`
- EAS CLI: `npm install -g eas-cli` if you build with EAS
- Xcode 15+ (for iOS / TestFlight)
- Firebase project with Auth, Firestore, Storage, and Functions enabled

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

Fill `.env` with your own Firebase Web App config from Firebase Console.
Do not commit `.env`.

---

## Step 3 — Firebase Service Files

Download these from Firebase Console for your iOS and Android apps:

```bash
# keep both files local; they are ignored by Git
GoogleService-Info.plist
google-services.json
```

---

## Step 4 — Firebase Rules & Indexes

Deploy the Firestore rules and indexes:

```bash
npx firebase deploy --only firestore:rules --project "$FIREBASE_PROJECT_ID"
npx firebase deploy --only firestore:indexes --project "$FIREBASE_PROJECT_ID"
npx firebase deploy --only storage --project "$FIREBASE_PROJECT_ID"
```

---

## Step 5 — Run Locally

```bash
# Start Expo dev server
npm start

# Or run directly on iOS simulator
npm run ios

# Scan the QR code with Expo Go on a device
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

Before building for TestFlight, confirm these exist in `assets/`:
- `icon.png` — 1024×1024 app icon (black bg, neon green ⚡)
- `splash.png` — 1242×2436 splash screen

---

## Known MVP Limitations (intentional)

- No push notifications
- No in-app messaging
- No leaderboards or XP
- Battle settlement, votes, and likes require deployed Cloud Functions.
- App Check enforcement remains a post-validation release hardening step.

---

## Quick Troubleshooting

| Issue | Fix |
|---|---|
| Metro bundler error | `npm start -- --clear` |
| Firebase auth error | Check `.env` values are correct |
| Image not uploading | Check Firebase Storage rules are deployed |
| Blank screen on launch | Check `GoogleService-Info.plist` is present |
| Reanimated crash | Ensure `babel.config.js` has the plugin |
