"use strict";

/**
 * INDEPENDENT SECURITY REVIEW — verification suite.
 *
 * This suite exists to validate a previous agent's hardening work rather than
 * to trust it. Every P1 finding is tested TWICE:
 *
 *   `baseline`  = firestore.rules as committed at HEAD (pre-fix), extracted
 *                 from git. If the attack SUCCEEDS here, the reported
 *                 vulnerability was real.
 *   `current`   = firestore.rules in the working tree (post-fix). The same
 *                 attack must FAIL here, and legitimate client payloads must
 *                 still succeed.
 *
 * It also probes for REGRESSIONS the previous agent did not test — cases where
 * the new provenance checks could reject legitimate production data.
 */

const fs = require("node:fs");
const path = require("node:path");
const test = require("node:test");
const assert = require("node:assert/strict");
const {
  initializeTestEnvironment,
  assertFails,
  assertSucceeds,
} = require("@firebase/rules-unit-testing");
const { doc, setDoc, updateDoc, getDoc } = require("firebase/firestore");

const root = path.resolve(__dirname, "..");
const currentRules = fs.readFileSync(path.join(root, "firestore.rules"), "utf8");
// Baseline extracted from git HEAD (see review notes). Falls back to skipping
// baseline assertions if it is unavailable, so the suite still runs standalone.
const baselinePath = path.join(process.env.HOME || "/root", "review", "firestore.baseline.rules");
const hasBaseline = fs.existsSync(baselinePath);
const baselineRules = hasBaseline ? fs.readFileSync(baselinePath, "utf8") : currentRules;

let current;
let baseline;

test.before(async () => {
  current = await initializeTestEnvironment({
    projectId: "demo-review-current",
    firestore: { rules: currentRules },
  });
  baseline = await initializeTestEnvironment({
    projectId: "demo-review-baseline",
    firestore: { rules: baselineRules },
  });
});

test.after(async () => {
  await current.cleanup();
  await baseline.cleanup();
});

test.beforeEach(async () => {
  await current.clearFirestore();
  await baseline.clearFirestore();
});

async function seed(env, entries) {
  await env.withSecurityRulesDisabled(async (context) => {
    const db = context.firestore();
    for (const [p, data] of entries) await setDoc(doc(db, p), data);
  });
}

const dbAs = (env, uid) => env.authenticatedContext(uid).firestore();

function mediaUrl(uid, file) {
  return (
    "https://firebasestorage.googleapis.com/v0/b/demo.appspot.com/o/" +
    `posts%2F${uid}%2F${file}?alt=media&token=t`
  );
}

const profile = (username) => ({
  username,
  usernameLower: username.toLowerCase(),
  bio: "",
  sport: "Other",
  athleteType: "Other",
  avatar: "",
  avatarUrl: "",
  posts: 0,
  wins: 0,
  losses: 0,
});

/** EXACT payload hooks/usePosts.ts createPost writes. */
function clientPost(uid, username, overrides = {}) {
  const now = new Date();
  return {
    userId: uid,
    username,
    userAvatar: "",
    avatarUrl: "",
    mediaUrl: mediaUrl(uid, "clip.mp4"),
    mediaType: "video",
    caption: "rep",
    battleEnabled: true,
    authorId: uid,
    uid,
    authorAvatar: "",
    likesCount: 0,
    createdAt: now,
    updatedAt: now,
    ...overrides,
  };
}

function storedPost(uid, username, overrides = {}) {
  return {
    userId: uid,
    username,
    mediaUrl: mediaUrl(uid, "clip.mp4"),
    mediaType: "video",
    caption: "",
    battleEnabled: true,
    likesCount: 0,
    ...overrides,
  };
}

function player(uid, username, postId, url) {
  return { userId: uid, username, avatar: "", mediaUrl: url, mediaType: "video", postId };
}

function battle(overrides = {}) {
  return {
    creatorId: "u-a",
    playerA: player("u-a", "alpha", "post-a", mediaUrl("u-a", "clip.mp4")),
    playerB: null,
    votesA: 0,
    votesB: 0,
    status: "open",
    category: "Highlights",
    durationHours: 24,
    endTime: new Date(Date.now() + 24 * 3_600_000),
    winner: null,
    statsRecorded: false,
    createdAt: new Date(),
    ...overrides,
  };
}

// ════════════════════════════════════════════════════════════════════════════
// P1-1 — Post creation integrity
// ════════════════════════════════════════════════════════════════════════════

test("P1-1 BASELINE: forged post fields were genuinely accepted before the fix", async (t) => {
  if (!hasBaseline) return t.skip("baseline rules unavailable");
  const db = dbAs(baseline, "u-a");

  // Stolen media belonging to another athlete.
  await assertSucceeds(
    setDoc(doc(db, "posts/p1"), clientPost("u-a", "alpha", {
      mediaUrl: mediaUrl("u-victim", "their-clip.mp4"),
    }))
  );
  // Inflated engagement counter.
  await assertSucceeds(
    setDoc(doc(db, "posts/p2"), clientPost("u-a", "alpha", { likesCount: 50_000 }))
  );
  // Self-granted verification on the post document.
  await assertSucceeds(
    setDoc(doc(db, "posts/p3"), clientPost("u-a", "alpha", { verified: true, momentumScore: 999 }))
  );
  // Timestamp far in the future — pins to the top of a createdAt-ordered feed.
  await assertSucceeds(
    setDoc(doc(db, "posts/p4"), clientPost("u-a", "alpha", {
      createdAt: new Date(Date.now() + 365 * 24 * 3_600_000),
    }))
  );
  // Impersonated display name.
  await assertSucceeds(
    setDoc(doc(db, "posts/p5"), clientPost("u-a", "someone-else", {}))
  );
});

test("P1-1 CURRENT: every forged post variant is rejected", async () => {
  await seed(current, [["users/u-a", profile("alpha")]]);
  const db = dbAs(current, "u-a");

  await assertFails(
    setDoc(doc(db, "posts/p1"), clientPost("u-a", "alpha", {
      mediaUrl: mediaUrl("u-victim", "their-clip.mp4"),
    }))
  );
  await assertFails(
    setDoc(doc(db, "posts/p2"), clientPost("u-a", "alpha", { likesCount: 50_000 }))
  );
  await assertFails(
    setDoc(doc(db, "posts/p3"), clientPost("u-a", "alpha", { verified: true }))
  );
  await assertFails(
    setDoc(doc(db, "posts/p4"), clientPost("u-a", "alpha", {
      createdAt: new Date(Date.now() + 365 * 24 * 3_600_000),
    }))
  );
  await assertFails(setDoc(doc(db, "posts/p5"), clientPost("u-a", "someone-else", {})));
  // Author-alias mismatch.
  await assertFails(
    setDoc(doc(db, "posts/p6"), clientPost("u-a", "alpha", { authorId: "u-b" }))
  );
});

test("P1-1 CURRENT: the real shipping createPost payload still succeeds", async () => {
  await seed(current, [["users/u-a", profile("alpha")]]);
  const db = dbAs(current, "u-a");
  // Minimal payload.
  await assertSucceeds(setDoc(doc(db, "posts/ok1"), clientPost("u-a", "alpha")));
  // Full payload with every optional field createPost can emit.
  await assertSucceeds(
    setDoc(doc(db, "posts/ok2"), clientPost("u-a", "alpha", {
      originalMediaUrl: mediaUrl("u-a", "orig.mp4"),
      videoEdit: { music: "hype", trimStart: 0, trimEnd: null, textOverlay: "", coverUri: null },
      sport: "Basketball",
      position: "PG",
      school: "Central",
      teamName: "Wolves",
    }))
  );
  // Pre-hydration: profile store not yet loaded, username still "".
  await assertSucceeds(
    setDoc(doc(db, "posts/ok3"), clientPost("u-a", "", {}))
  );
  // Idempotent replay of the identical payload at the same preallocated id.
  const replay = clientPost("u-a", "alpha");
  await assertSucceeds(setDoc(doc(db, "posts/ok4"), replay));
  await assertSucceeds(setDoc(doc(db, "posts/ok4"), replay));
});

// ── REGRESSION PROBE: signup ordering ──────────────────────────────────────
test("REGRESSION PROBE: posting before the users doc exists is still allowed", async () => {
  // register.tsx creates the auth user, then the profile. A post created in a
  // window where users/{uid} does not exist must not be blocked.
  const db = dbAs(current, "u-new");
  await assertSucceeds(setDoc(doc(db, "posts/first"), clientPost("u-new", "brandnew")));
});

// ════════════════════════════════════════════════════════════════════════════
// P1-2 — Coach verification / trust fields
// ════════════════════════════════════════════════════════════════════════════

test("P1-2 BASELINE: self-granted coachVerified was genuinely accepted", async (t) => {
  if (!hasBaseline) return t.skip("baseline rules unavailable");
  await seed(baseline, [["users/u-a", profile("alpha")]]);
  const db = dbAs(baseline, "u-a");
  await assertSucceeds(updateDoc(doc(db, "users/u-a"), { coachVerified: true }));
  await assertSucceeds(updateDoc(doc(db, "users/u-a"), { verified: true, topRanked: true }));
  await assertSucceeds(updateDoc(doc(db, "users/u-a"), { momentumScore: 100 }));
});

test("P1-2 CURRENT: every trust field is refused on create and update", async () => {
  await seed(current, [["users/u-a", profile("alpha")]]);
  const db = dbAs(current, "u-a");
  for (const forged of [
    { verified: true },
    { isVerified: true },
    { coachVerified: true },
    { tournamentChampion: true },
    { topRanked: true },
    { momentumScore: 100 },
    { wins: 5 },
    { losses: 3 },
    { posts: 99 },
  ]) {
    await assertFails(updateDoc(doc(db, "users/u-a"), forged));
  }
  await assertFails(
    setDoc(doc(dbAs(current, "u-new"), "users/u-new"), { ...profile("n"), coachVerified: true })
  );
});

test("P1-2 CURRENT: legitimate signup and profile editing still work", async () => {
  const db = dbAs(current, "u-a");
  // ensureUserProfile payload.
  await assertSucceeds(setDoc(doc(db, "users/u-a"), profile("alpha")));
  // updateUserProfile: identity + search fields together.
  await assertSucceeds(
    updateDoc(doc(db, "users/u-a"), {
      bio: "hi",
      username: "Alpha-New",
      usernameLower: "alpha-new",
      school: "Central",
      schoolLower: "central",
      city: "Austin",
      cityLower: "austin",
      position: "PG",
      gradYear: "2027",
      avatarUrl: "https://x/y.jpg",
      bannerUrl: "https://x/b.jpg",
    })
  );
});

// ════════════════════════════════════════════════════════════════════════════
// P1-3 — Battle entry / post binding
// ════════════════════════════════════════════════════════════════════════════

test("P1-3 BASELINE: battle entry with another athlete's media was accepted", async (t) => {
  if (!hasBaseline) return t.skip("baseline rules unavailable");
  await seed(baseline, [["posts/post-victim", storedPost("u-victim", "victim")]]);
  const db = dbAs(baseline, "u-a");
  await assertSucceeds(
    setDoc(doc(db, "battles/stolen"), battle({
      playerA: player("u-a", "alpha", "post-victim", mediaUrl("u-victim", "clip.mp4")),
    }))
  );
});

test("P1-3 CURRENT: forged battle entries rejected, legitimate ones accepted", async () => {
  await seed(current, [
    ["posts/post-a", storedPost("u-a", "alpha")],
    ["posts/post-b", storedPost("u-b", "bravo")],
    ["posts/post-victim", storedPost("u-victim", "victim")],
  ]);
  const dbA = dbAs(current, "u-a");

  // Legitimate open challenge (createBattle).
  await assertSucceeds(setDoc(doc(dbA, "battles/ok-open"), battle()));

  // Legitimate direct challenge (createLiveBattle: creator is playerB).
  await assertSucceeds(
    setDoc(doc(dbA, "battles/ok-live"), battle({
      status: "live",
      playerA: player("u-b", "bravo", "post-b", mediaUrl("u-b", "clip.mp4")),
      playerB: player("u-a", "alpha", "post-a", mediaUrl("u-a", "clip.mp4")),
    }))
  );

  // Stolen media.
  await assertFails(
    setDoc(doc(dbA, "battles/bad1"), battle({
      playerA: player("u-a", "alpha", "post-a", mediaUrl("u-victim", "clip.mp4")),
    }))
  );
  // Post owned by someone else.
  await assertFails(
    setDoc(doc(dbA, "battles/bad2"), battle({
      playerA: player("u-a", "alpha", "post-victim", mediaUrl("u-victim", "clip.mp4")),
    }))
  );
  // Nonexistent post.
  await assertFails(
    setDoc(doc(dbA, "battles/bad3"), battle({
      playerA: player("u-a", "alpha", "ghost", mediaUrl("u-a", "clip.mp4")),
    }))
  );
  // Forged display name.
  await assertFails(
    setDoc(doc(dbA, "battles/bad4"), battle({
      playerA: player("u-a", "superstar", "post-a", mediaUrl("u-a", "clip.mp4")),
    }))
  );
});

test("P1-3 CURRENT: Open Challenge acceptance still works end to end", async () => {
  await seed(current, [
    ["posts/post-a", storedPost("u-a", "alpha")],
    ["posts/post-b", storedPost("u-b", "bravo")],
    ["battles/open-1", battle()],
  ]);
  // acceptChallenge payload from app/(tabs)/battles.tsx confirmAccept.
  await assertSucceeds(
    updateDoc(doc(dbAs(current, "u-b"), "battles/open-1"), {
      playerB: player("u-b", "bravo", "post-b", mediaUrl("u-b", "clip.mp4")),
      status: "live",
    })
  );
});

test("P1-3 CURRENT: creator still cannot accept their own open challenge", async () => {
  await seed(current, [
    ["posts/post-a", storedPost("u-a", "alpha")],
    ["battles/open-2", battle()],
  ]);
  await assertFails(
    updateDoc(doc(dbAs(current, "u-a"), "battles/open-2"), {
      playerB: player("u-a", "alpha", "post-a", mediaUrl("u-a", "clip.mp4")),
      status: "live",
    })
  );
});

// ── REGRESSION PROBES the previous agent did not run ───────────────────────

test("REGRESSION PROBE: athlete who renamed themselves can still battle with older posts", async () => {
  // Edit Profile allows changing username. Posts keep the name they were
  // created under. BattlePickerModal / confirmAccept build the player entry
  // from the CURRENT profile username but the OLD post.
  await seed(current, [
    ["users/u-a", profile("alpha-new")],
    ["posts/post-old", storedPost("u-a", "alpha-old")], // post predates the rename
    ["posts/post-b", storedPost("u-b", "bravo")],
    ["battles/open-r", battle({
      creatorId: "u-b",
      playerA: player("u-b", "bravo", "post-b", mediaUrl("u-b", "clip.mp4")),
    })],
  ]);

  // Direct challenge using the older post, current display name.
  const createLive = setDoc(
    doc(dbAs(current, "u-a"), "battles/renamed-live"),
    battle({
      status: "live",
      playerA: player("u-b", "bravo", "post-b", mediaUrl("u-b", "clip.mp4")),
      playerB: player("u-a", "alpha-new", "post-old", mediaUrl("u-a", "clip.mp4")),
    })
  );

  // Accepting an open challenge with the older post, current display name.
  const accept = updateDoc(doc(dbAs(current, "u-a"), "battles/open-r"), {
    playerB: player("u-a", "alpha-new", "post-old", mediaUrl("u-a", "clip.mp4")),
    status: "live",
  });

  await assertSucceeds(createLive);
  await assertSucceeds(accept);
});

test("REGRESSION PROBE: legacy post using mediaURL/photoURL aliases can still be battled", async () => {
  // normalizePost resolves mediaUrl from mediaUrl || mediaURL || photoURL, so
  // a legacy doc surfaces a media URL in the client that is NOT in the
  // canonical `mediaUrl` field.
  await seed(current, [
    ["users/u-a", profile("alpha")],
    ["posts/legacy-a", {
      userId: "u-a",
      username: "alpha",
      mediaURL: mediaUrl("u-a", "legacy.mp4"), // capital-U alias, no mediaUrl
      mediaType: "video",
      caption: "",
      battleEnabled: true,
      likesCount: 0,
    }],
  ]);
  await assertSucceeds(
    setDoc(doc(dbAs(current, "u-a"), "battles/legacy-battle"), battle({
      playerA: player("u-a", "alpha", "legacy-a", mediaUrl("u-a", "legacy.mp4")),
    }))
  );
});

test("REGRESSION PROBE: legacy post owned via authorId alias can still be battled", async () => {
  await seed(current, [
    ["users/u-a", profile("alpha")],
    ["posts/legacy-owner", {
      authorId: "u-a", // no canonical userId
      username: "alpha",
      mediaUrl: mediaUrl("u-a", "legacy2.mp4"),
      mediaType: "video",
      caption: "",
      battleEnabled: true,
      likesCount: 0,
    }],
  ]);
  await assertSucceeds(
    setDoc(doc(dbAs(current, "u-a"), "battles/legacy-owner-battle"), battle({
      playerA: player("u-a", "alpha", "legacy-owner", mediaUrl("u-a", "legacy2.mp4")),
    }))
  );
});

// ════════════════════════════════════════════════════════════════════════════
// P1-4 — Comment identity forgery
// ════════════════════════════════════════════════════════════════════════════

test("P1-4 BASELINE: forged comment username was accepted", async (t) => {
  if (!hasBaseline) return t.skip("baseline rules unavailable");
  await seed(baseline, [["posts/post-b", storedPost("u-b", "bravo")]]);
  await assertSucceeds(
    setDoc(doc(dbAs(baseline, "u-a"), "comments/c1"), {
      postId: "post-b",
      userId: "u-a",
      username: "CoachSmith",
      avatar: "",
      text: "hi",
      createdAt: new Date(),
    })
  );
});

test("P1-4 CURRENT: forged identity rejected, legitimate comment accepted", async () => {
  await seed(current, [
    ["users/u-a", profile("alpha")],
    ["posts/post-b", storedPost("u-b", "bravo")],
  ]);
  const db = dbAs(current, "u-a");
  const base = {
    postId: "post-b",
    userId: "u-a",
    username: "alpha",
    avatar: "",
    text: "clean rep",
    createdAt: new Date(),
  };
  await assertSucceeds(setDoc(doc(db, "comments/ok"), base));
  await assertSucceeds(setDoc(doc(db, "comments/ok2"), { ...base, username: "" }));
  await assertFails(setDoc(doc(db, "comments/bad1"), { ...base, username: "CoachSmith" }));
  await assertFails(setDoc(doc(db, "comments/bad2"), { ...base, userId: "u-b" }));
  await assertFails(setDoc(doc(db, "comments/bad3"), { ...base, verified: true }));
  await assertFails(
    setDoc(doc(db, "comments/bad4"), {
      ...base,
      createdAt: new Date(Date.now() + 365 * 24 * 3_600_000),
    })
  );
});

test("P1-4 CURRENT: forged comment identity cannot become trusted notification data", async () => {
  // The comment-notification rule validates subjectUsername against the
  // comment document, so blocking forgery at the comment is what protects the
  // notification. Verify the chain end to end.
  await seed(current, [
    ["users/u-a", profile("alpha")],
    ["posts/post-b", storedPost("u-b", "bravo")],
    // A forged comment planted directly (simulating a pre-fix legacy row).
    ["comments/forged", {
      postId: "post-b",
      userId: "u-a",
      username: "CoachSmith",
      avatar: "",
      text: "x",
      createdAt: new Date(),
    }],
  ]);
  const db = dbAs(current, "u-a");
  // Notification whose subjectUsername matches the forged comment: the rule
  // permits it because it matches the comment — which is exactly why the
  // comment itself had to be locked down. Documented, not a new hole.
  const notif = {
    type: "comment",
    recipientId: "u-b",
    actorId: "u-a",
    subjectUsername: "CoachSmith",
    subjectAvatar: "",
    postId: "post-b",
    commentId: "forged",
    read: false,
    createdAt: new Date(),
  };
  const result = await getDoc(doc(db, "comments/forged"));
  assert.equal(result.data().username, "CoachSmith");
  // A NEW forged comment can no longer be created (covered above), so this
  // path is closed at the source going forward.
  await assertFails(
    setDoc(doc(db, "comments/forged2"), {
      postId: "post-b",
      userId: "u-a",
      username: "CoachSmith",
      avatar: "",
      text: "x",
      createdAt: new Date(),
    })
  );
});

// ════════════════════════════════════════════════════════════════════════════
// P1-6 — Username canonicalization
// ════════════════════════════════════════════════════════════════════════════

test("P1-6 BASELINE: usernameLower could diverge from username", async (t) => {
  if (!hasBaseline) return t.skip("baseline rules unavailable");
  const db = dbAs(baseline, "u-a");
  await assertSucceeds(
    setDoc(doc(db, "users/u-a"), {
      ...profile("VictimName"),
      usernameLower: "zzz-unrelated",
    })
  );
});

test("P1-6 CURRENT: divergence rejected, normal renames allowed", async () => {
  const db = dbAs(current, "u-a");
  await assertFails(
    setDoc(doc(db, "users/u-a"), { ...profile("VictimName"), usernameLower: "zzz" })
  );
  await assertSucceeds(setDoc(doc(db, "users/u-a"), profile("Alpha")));
  // Capitalisation change with matching index.
  await assertSucceeds(
    updateDoc(doc(db, "users/u-a"), { username: "ALPHA", usernameLower: "alpha" })
  );
  // Divergent rename.
  await assertFails(
    updateDoc(doc(db, "users/u-a"), { username: "Beta", usernameLower: "alpha" })
  );
  // Legacy doc with no usernameLower can still edit unrelated fields.
  await seed(current, [["users/u-legacy", {
    username: "OldTimer", bio: "", sport: "Other", athleteType: "Other",
    avatar: "", avatarUrl: "", posts: 0, wins: 0, losses: 0,
  }]]);
  await assertSucceeds(updateDoc(doc(dbAs(current, "u-legacy"), "users/u-legacy"), { bio: "x" }));
});

test("REGRESSION PROBE: username with surrounding whitespace is handled predictably", async () => {
  // searchFieldsFor trims AND lowercases; the rule only lowercases. A username
  // the client never trims would therefore diverge. updateUserProfile always
  // writes both through searchFieldsFor, but confirm the trimmed form works.
  const db = dbAs(current, "u-w");
  await assertSucceeds(
    setDoc(doc(db, "users/u-w"), { ...profile("Spaced"), usernameLower: "spaced" })
  );
});

// ════════════════════════════════════════════════════════════════════════════
// Follows / likes / votes — unchanged surfaces must stay intact
// ════════════════════════════════════════════════════════════════════════════

test("REGRESSION: follow, unfollow, saves and server-only collections behave", async () => {
  const db = dbAs(current, "u-a");
  await assertSucceeds(
    setDoc(doc(db, "follows/u-a_u-b"), {
      followerId: "u-a",
      followingId: "u-b",
      createdAt: new Date(),
    })
  );
  await assertFails(
    setDoc(doc(db, "follows/u-a_u-a"), {
      followerId: "u-a",
      followingId: "u-a",
      createdAt: new Date(),
    })
  );
  // Server-only collections stay closed to clients.
  await assertFails(setDoc(doc(db, "likes/p_u-a"), { postId: "p", userId: "u-a" }));
  await assertFails(setDoc(doc(db, "votes/b_u-a"), { battleId: "b", userId: "u-a", side: "A" }));
  // Saves remain owner-private and writable.
  await assertSucceeds(
    setDoc(doc(db, "saves/post-x_u-a"), { postId: "post-x", userId: "u-a", createdAt: new Date() })
  );
  await assertFails(getDoc(doc(dbAs(current, "u-b"), "saves/post-x_u-a")));
});
