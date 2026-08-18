"use strict";

/**
 * Hardening coverage for the 2026-08 security pass.
 *
 * Verifies the new Firestore rule protections:
 *  1. Post creation shape validation (forged counters, timestamps, stolen
 *     media paths, impersonated author identity, reserved presentation keys).
 *  2. User profile credibility fields are server-only (verified badges,
 *     momentum score, ranking flags) and the search index cannot drift from
 *     the display username.
 *  3. Battle player entries must be backed by a real post owned by the
 *     athlete they represent, on create AND accept.
 *  4. Comment author identity cannot be forged.
 *  5. Follows cannot target self or empty ids.
 *
 * Every "legitimate" case replicates the exact payload the current client
 * code writes (hooks/usePosts.ts createPost, hooks/useBattles.ts
 * createBattle/createLiveBattle/acceptChallenge, services/commentRepository.ts
 * createComment, hooks/useFollows.ts follow) so a rules deploy cannot brick
 * the shipping app.
 */

const fs = require("node:fs");
const path = require("node:path");
const test = require("node:test");
const {
  initializeTestEnvironment,
  assertFails,
  assertSucceeds,
} = require("@firebase/rules-unit-testing");
const { doc, setDoc, updateDoc } = require("firebase/firestore");

const root = path.resolve(__dirname, "..");
const currentRules = fs.readFileSync(
  path.join(root, "firestore.rules"),
  "utf8"
);

let env;

test.before(async () => {
  env = await initializeTestEnvironment({
    projectId: "demo-momentum-rules-hardening",
    firestore: { rules: currentRules },
  });
});

test.after(async () => {
  await env.cleanup();
});

test.beforeEach(async () => {
  await env.clearFirestore();
});

async function seed(entries) {
  await env.withSecurityRulesDisabled(async (context) => {
    const db = context.firestore();
    for (const [documentPath, data] of entries) {
      await setDoc(doc(db, documentPath), data);
    }
  });
}

function authedDb(uid) {
  return env.authenticatedContext(uid).firestore();
}

function ownedMediaUrl(uid, file) {
  return (
    "https://firebasestorage.googleapis.com/v0/b/demo-momentum.appspot.com/o/" +
    `posts%2F${uid}%2F${file}?alt=media&token=test-token`
  );
}

const profileA = {
  username: "athlete-a",
  usernameLower: "athlete-a",
  bio: "",
  sport: "Other",
  athleteType: "Other",
  avatar: "",
  avatarUrl: "",
  posts: 0,
  wins: 0,
  losses: 0,
};

/** The exact field set hooks/usePosts.ts createPost writes. */
function clientPostPayload(uid, overrides = {}) {
  const now = new Date();
  return {
    userId: uid,
    username: "athlete-a",
    userAvatar: "",
    avatarUrl: "",
    mediaUrl: ownedMediaUrl(uid, "clip.mp4"),
    mediaType: "video",
    caption: "training day",
    battleEnabled: true,
    authorId: uid,
    uid: uid,
    authorAvatar: "",
    likesCount: 0,
    createdAt: now,
    updatedAt: now,
    ...overrides,
  };
}

function backingPost(uid, name, file) {
  return {
    userId: uid,
    username: name,
    mediaUrl: ownedMediaUrl(uid, file),
    mediaType: "image",
    caption: "",
    battleEnabled: true,
    likesCount: 0,
  };
}

function playerEntry(uid, name, postId, mediaUrl) {
  return {
    userId: uid,
    username: name,
    avatar: "",
    mediaUrl,
    mediaType: "image",
    postId,
  };
}

function battleShape(overrides = {}) {
  return {
    creatorId: "user-a",
    playerA: playerEntry(
      "user-a",
      "athlete-a",
      "post-a",
      ownedMediaUrl("user-a", "a.jpg")
    ),
    playerB: null,
    status: "open",
    votesA: 0,
    votesB: 0,
    category: "Highlights",
    durationHours: 24,
    endTime: new Date(Date.now() + 24 * 3_600_000),
    winner: null,
    statsRecorded: false,
    createdAt: new Date(),
    ...overrides,
  };
}

// ─── 1. Post creation shape ──────────────────────────────────────────────────

test("hardened posts: the exact current-client payload is accepted", async () => {
  await seed([["users/user-a", profileA]]);
  const db = authedDb("user-a");
  await assertSucceeds(
    setDoc(doc(db, "posts/new-post"), clientPostPayload("user-a"))
  );
  // Optional athlete-context fields the client writes when provided.
  await assertSucceeds(
    setDoc(doc(db, "posts/new-post-2"), clientPostPayload("user-a", {
      sport: "Basketball",
      position: "PG",
      school: "Central High",
      teamName: "Wolves",
      originalMediaUrl: ownedMediaUrl("user-a", "original.mp4"),
      videoEdit: {
        music: "hype",
        trimStart: 0,
        trimEnd: null,
        textOverlay: "",
        coverUri: null,
      },
    }))
  );
  // Pre-hydration client: empty username is tolerated.
  await assertSucceeds(
    setDoc(doc(db, "posts/new-post-3"), clientPostPayload("user-a", {
      username: "",
    }))
  );
});

test("hardened posts: forged engagement counters are rejected", async () => {
  await seed([["users/user-a", profileA]]);
  const db = authedDb("user-a");
  await assertFails(
    setDoc(doc(db, "posts/forged-likes"), clientPostPayload("user-a", {
      likesCount: 1_000_000,
    }))
  );
  await assertFails(
    setDoc(doc(db, "posts/forged-comments"), clientPostPayload("user-a", {
      commentsCount: 5_000,
    }))
  );
});

test("hardened posts: forged credibility/presentation keys are rejected", async () => {
  await seed([["users/user-a", profileA]]);
  const db = authedDb("user-a");
  for (const forged of [
    { verified: true },
    { isVerified: true },
    { momentumScore: 99 },
    { battleWon: true },
    { isLive: true },
    { pinned: true },
  ]) {
    await assertFails(
      setDoc(doc(db, "posts/forged-key"), clientPostPayload("user-a", forged))
    );
  }
});

test("hardened posts: implausible client timestamps are rejected", async () => {
  await seed([["users/user-a", profileA]]);
  const db = authedDb("user-a");
  const nextYear = new Date(Date.now() + 365 * 24 * 3_600_000);
  const lastWeek = new Date(Date.now() - 7 * 24 * 3_600_000);
  await assertFails(
    setDoc(doc(db, "posts/pinned-future"), clientPostPayload("user-a", {
      createdAt: nextYear,
    }))
  );
  await assertFails(
    setDoc(doc(db, "posts/backdated"), clientPostPayload("user-a", {
      createdAt: lastWeek,
    }))
  );
  await assertFails(
    setDoc(doc(db, "posts/missing-time"), (() => {
      const payload = clientPostPayload("user-a");
      delete payload.createdAt;
      return payload;
    })())
  );
});

test("hardened posts: media outside the author's storage prefix is rejected", async () => {
  await seed([["users/user-a", profileA]]);
  const db = authedDb("user-a");
  // Another athlete's object path — content theft.
  await assertFails(
    setDoc(doc(db, "posts/stolen-media"), clientPostPayload("user-a", {
      mediaUrl: ownedMediaUrl("user-victim", "their-highlight.mp4"),
    }))
  );
  // Arbitrary external URL.
  await assertFails(
    setDoc(doc(db, "posts/external-media"), clientPostPayload("user-a", {
      mediaUrl: "https://example.test/whatever.mp4",
    }))
  );
  await assertFails(
    setDoc(doc(db, "posts/stolen-original"), clientPostPayload("user-a", {
      originalMediaUrl: ownedMediaUrl("user-victim", "original.mp4"),
    }))
  );
});

test("hardened posts: impersonated author identity is rejected", async () => {
  await seed([
    ["users/user-a", profileA],
    ["users/user-b", { ...profileA, username: "athlete-b", usernameLower: "athlete-b" }],
  ]);
  const db = authedDb("user-a");
  // Alias fields must all be the writer.
  await assertFails(
    setDoc(doc(db, "posts/alias-forgery"), clientPostPayload("user-a", {
      authorId: "user-b",
    }))
  );
  // Displayed name must be the writer's real handle.
  await assertFails(
    setDoc(doc(db, "posts/name-forgery"), clientPostPayload("user-a", {
      username: "athlete-b",
    }))
  );
});

// ─── 2. User profile credibility fields ──────────────────────────────────────

test("hardened users: self-granted credibility fields are rejected", async () => {
  const db = authedDb("user-a");
  // At create.
  await assertFails(
    setDoc(doc(db, "users/user-a"), { ...profileA, verified: true })
  );
  await assertFails(
    setDoc(doc(db, "users/user-a"), { ...profileA, momentumScore: 100 })
  );
  // At update.
  await seed([["users/user-a", profileA]]);
  for (const forged of [
    { verified: true },
    { isVerified: true },
    { coachVerified: true },
    { tournamentChampion: true },
    { topRanked: true },
    { momentumScore: 100 },
  ]) {
    await assertFails(updateDoc(doc(db, "users/user-a"), forged));
  }
});

test("hardened users: normal profile lifecycle still works", async () => {
  const db = authedDb("user-a");
  await assertSucceeds(setDoc(doc(db, "users/user-a"), profileA));
  await assertSucceeds(
    updateDoc(doc(db, "users/user-a"), {
      bio: "Updated",
      username: "New-Handle",
      usernameLower: "new-handle",
      school: "Central High",
      schoolLower: "central high",
    })
  );
});

test("hardened users: search index cannot drift from the display username", async () => {
  const db = authedDb("user-a");
  // Registering a handle whose usernameLower does not match evades the
  // client-side duplicate/impersonation check.
  await assertFails(
    setDoc(doc(db, "users/user-a"), {
      ...profileA,
      username: "VictimName",
      usernameLower: "zzz-unrelated",
    })
  );
  await seed([["users/user-a", profileA]]);
  await assertFails(
    updateDoc(doc(db, "users/user-a"), {
      username: "VictimName",
      usernameLower: "zzz-unrelated",
    })
  );
  // Legacy docs without usernameLower can still update unrelated fields.
  await seed([["users/legacy-user", {
    username: "OldTimer",
    bio: "",
    sport: "Other",
    athleteType: "Other",
    avatar: "",
    avatarUrl: "",
    posts: 0,
    wins: 0,
    losses: 0,
  }]]);
  await assertSucceeds(
    updateDoc(doc(authedDb("legacy-user"), "users/legacy-user"), { bio: "hi" })
  );
});

// ─── 3. Battle player provenance ─────────────────────────────────────────────

test("hardened battles: entries must be backed by the player's own real post", async () => {
  await seed([
    ["posts/post-a", backingPost("user-a", "athlete-a", "a.jpg")],
    ["posts/post-b", backingPost("user-b", "athlete-b", "b.jpg")],
    ["posts/post-victim", backingPost("user-victim", "victim", "v.jpg")],
  ]);
  const db = authedDb("user-a");

  // Legitimate open challenge (exact createBattle payload).
  await assertSucceeds(
    setDoc(doc(db, "battles/legit-open"), battleShape())
  );

  // Legitimate direct challenge (exact createLiveBattle payload:
  // creator = playerB, challenged athlete = playerA).
  await assertSucceeds(
    setDoc(doc(db, "battles/legit-live"), battleShape({
      status: "live",
      playerA: playerEntry("user-b", "athlete-b", "post-b", ownedMediaUrl("user-b", "b.jpg")),
      playerB: playerEntry("user-a", "athlete-a", "post-a", ownedMediaUrl("user-a", "a.jpg")),
    }))
  );

  // Entry media stolen from another athlete's post.
  await assertFails(
    setDoc(doc(db, "battles/stolen-media"), battleShape({
      playerA: playerEntry("user-a", "athlete-a", "post-a", ownedMediaUrl("user-victim", "v.jpg")),
    }))
  );

  // Entry postId referencing a post the player does not own.
  await assertFails(
    setDoc(doc(db, "battles/foreign-post"), battleShape({
      playerA: playerEntry("user-a", "athlete-a", "post-victim", ownedMediaUrl("user-victim", "v.jpg")),
    }))
  );

  // Entry referencing a post that does not exist.
  await assertFails(
    setDoc(doc(db, "battles/ghost-post"), battleShape({
      playerA: playerEntry("user-a", "athlete-a", "no-such-post", ownedMediaUrl("user-a", "a.jpg")),
    }))
  );

  // Forged display name on a legitimate post.
  await assertFails(
    setDoc(doc(db, "battles/forged-name"), battleShape({
      playerA: playerEntry("user-a", "impersonated-star", "post-a", ownedMediaUrl("user-a", "a.jpg")),
    }))
  );

  // Battle pinned to the future.
  await assertFails(
    setDoc(doc(db, "battles/pinned"), battleShape({
      createdAt: new Date(Date.now() + 365 * 24 * 3_600_000),
    }))
  );
});

test("hardened battles: accepting requires the accepter's own backing post", async () => {
  await seed([
    ["posts/post-a", backingPost("user-a", "athlete-a", "a.jpg")],
    ["posts/post-b", backingPost("user-b", "athlete-b", "b.jpg")],
    ["posts/post-victim", backingPost("user-victim", "victim", "v.jpg")],
    ["battles/open-1", battleShape()],
    ["battles/open-2", battleShape()],
  ]);
  const db = authedDb("user-b");

  // Legitimate accept (exact acceptChallenge payload).
  await assertSucceeds(
    updateDoc(doc(db, "battles/open-1"), {
      playerB: playerEntry("user-b", "athlete-b", "post-b", ownedMediaUrl("user-b", "b.jpg")),
      status: "live",
    })
  );

  // Accept smuggling another athlete's post/media.
  await assertFails(
    updateDoc(doc(db, "battles/open-2"), {
      playerB: playerEntry("user-b", "athlete-b", "post-victim", ownedMediaUrl("user-victim", "v.jpg")),
      status: "live",
    })
  );
});

// ─── 4. Comment identity ─────────────────────────────────────────────────────

test("hardened comments: author identity cannot be forged", async () => {
  await seed([
    ["users/user-a", profileA],
    ["posts/post-b", backingPost("user-b", "athlete-b", "b.jpg")],
  ]);
  const db = authedDb("user-a");
  const comment = {
    postId: "post-b",
    userId: "user-a",
    username: "athlete-a",
    avatar: "",
    text: "clean rep",
    createdAt: new Date(),
  };
  await assertSucceeds(setDoc(doc(db, "comments/comment-1"), comment));
  await assertSucceeds(
    setDoc(doc(db, "comments/comment-2"), { ...comment, username: "" })
  );
  await assertFails(
    setDoc(doc(db, "comments/forged-name"), {
      ...comment,
      username: "some-famous-athlete",
    })
  );
  await assertFails(
    setDoc(doc(db, "comments/extra-keys"), { ...comment, verified: true })
  );
  await assertFails(
    setDoc(doc(db, "comments/pinned-time"), {
      ...comment,
      createdAt: new Date(Date.now() + 365 * 24 * 3_600_000),
    })
  );
});

// ─── 5. Follows ──────────────────────────────────────────────────────────────

test("hardened follows: self-follows and empty targets are rejected", async () => {
  const db = authedDb("user-a");
  await assertFails(
    setDoc(doc(db, "follows/user-a_user-a"), {
      followerId: "user-a",
      followingId: "user-a",
      createdAt: new Date(),
    })
  );
  await assertFails(
    setDoc(doc(db, "follows/user-a_"), {
      followerId: "user-a",
      followingId: "",
      createdAt: new Date(),
    })
  );
  await assertSucceeds(
    setDoc(doc(db, "follows/user-a_user-b"), {
      followerId: "user-a",
      followingId: "user-b",
      createdAt: new Date(),
    })
  );
});
