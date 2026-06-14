# Firestore Test Environment Cleanup

Wipes test/demo data from `posts`, `battles`, `likes`, `votes`, and `follows`
before a fresh test run.
**Never touches:** `users`, Auth accounts, Firestore rules, Storage files.

---

## Prerequisites (one-time setup)

### 1. Get a Firebase service account key

1. Open [Firebase Console](https://console.firebase.google.com) → select **momentum-app-prod-1e870**
2. Go to **Project Settings** (gear icon) → **Service Accounts** tab
3. Click **Generate New Private Key**
4. Save the downloaded file as:
   ```
   Momentum-MVP/scripts/serviceAccountKey.json
   ```
   > ⚠️ **Never commit this file.** It is already in `.gitignore`.

### 2. Install firebase-admin

From the `Momentum-MVP` project root:

```bash
npm install --save-dev firebase-admin
```

---

## Run the cleanup

```bash
# From Momentum-MVP root:
node scripts/cleanup-firestore.js
```

The script will:

1. **Count** documents in each target collection and print a summary table
2. Ask for your **confirmation** before any deletes
3. **Export a backup** to `scripts/backups/backup-<timestamp>.json`
4. **Delete** all documents from: `posts` · `battles` · `likes` · `votes` · `follows`
5. **Verify** post-delete counts and print the final result

### Dry run (count + backup, no deletes)

```bash
DRY_RUN=true node scripts/cleanup-firestore.js
```

---

## Rollback (restore from backup)

If you need to undo the cleanup:

```bash
# Restore the most recent backup automatically:
node scripts/rollback-firestore.js --latest

# Or restore a specific backup file:
node scripts/rollback-firestore.js backup-2025-01-01T12-00-00.json
```

---

## Expected app state after cleanup

| Screen    | Expected UI                                          |
|-----------|------------------------------------------------------|
| Home → For You    | "No highlights yet. Be the first to post."   |
| Home → Following  | "Follow athletes to build your feed."        |
| Battles → Live    | "No battles yet."                            |
| Profile           | User profile loads normally (users kept)     |

---

## Fresh test flow

Once cleanup is done, run this flow in the simulator:

1. **Profile** — confirm username, avatar/initials, 0 posts/wins/losses
2. **Create** — add a photo post (no battle toggle)
3. **Home → For You** — confirm post appears
4. **Home** — tap **Follow** on another user's post
5. **Home → Following** — confirm followed user's posts appear
6. **Home** — tap **⚔️ Start Battle** on your own post → confirm open challenge
7. **Battles → Live** — confirm open challenge appears
8. **Home** — tap **⚔️ Challenge** on another user's post → pick your post → confirm live battle
9. **Battles → Live** — confirm live battle appears with Vote buttons
10. **Battles** — vote on the live battle → confirm vote bar updates

---

## Files

```
scripts/
  cleanup-firestore.js      ← main cleanup script
  rollback-firestore.js     ← restore from backup
  CLEANUP.md                ← this file
  serviceAccountKey.json    ← YOU create this (gitignored)
  backups/                  ← auto-created, timestamped JSON exports
```
