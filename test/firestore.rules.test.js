"use strict";

const fs = require("node:fs");
const path = require("node:path");
const test = require("node:test");
const {
  initializeTestEnvironment,
  assertFails,
  assertSucceeds,
} = require("@firebase/rules-unit-testing");
const {
  doc,
  getDoc,
  setDoc,
  updateDoc,
  deleteDoc,
} = require("firebase/firestore");

const root = path.resolve(__dirname, "..");
const currentRules = fs.readFileSync(
  path.join(root, "firestore.rules"),
  "utf8"
);
const hardenedRules = fs.readFileSync(
  path.join(root, "test/fixtures/firestore.hardened.rules"),
  "utf8"
);

let current;
let hardened;

test.before(async () => {
  current = await initializeTestEnvironment({
    projectId: "demo-momentum-rules-current",
    firestore: { rules: currentRules },
  });
  hardened = await initializeTestEnvironment({
    projectId: "demo-momentum-rules-hardened",
    firestore: { rules: hardenedRules },
  });
});

test.after(async () => {
  await current.cleanup();
  await hardened.cleanup();
});

test.beforeEach(async () => {
  await current.clearFirestore();
  await hardened.clearFirestore();
});

async function seed(environment, entries) {
  await environment.withSecurityRulesDisabled(async (context) => {
    const db = context.firestore();
    for (const [documentPath, data] of entries) {
      await setDoc(doc(db, documentPath), data);
    }
  });
}

function authenticatedDb(environment, uid) {
  return environment.authenticatedContext(uid).firestore();
}

function unauthenticatedDb(environment) {
  return environment.unauthenticatedContext().firestore();
}

const profile = {
  username: "athlete-a",
  bio: "",
  sport: "Other",
  athleteType: "Other",
  avatar: "",
  avatarUrl: "",
  posts: 0,
  wins: 0,
  losses: 0,
};

const post = {
  userId: "user-a",
  username: "athlete-a",
  mediaUrl: "https://example.test/post.jpg",
  mediaType: "image",
  caption: "",
  battleEnabled: true,
  likesCount: 0,
};

const openBattle = {
  creatorId: "user-a",
  playerA: { userId: "user-a" },
  playerB: null,
  status: "open",
  votesA: 0,
  votesB: 0,
  winner: null,
  statsRecorded: false,
};

test("current rules require authentication for reads", async () => {
  await seed(current, [["posts/post-a", post]]);
  await assertFails(getDoc(doc(unauthenticatedDb(current), "posts/post-a")));
  await assertSucceeds(
    getDoc(doc(authenticatedDb(current, "user-a"), "posts/post-a"))
  );
});

test("current rules allow owners to create profiles and edit normal fields", async () => {
  const db = authenticatedDb(current, "user-a");
  await assertSucceeds(setDoc(doc(db, "users/user-a"), profile));
  await assertSucceeds(updateDoc(doc(db, "users/user-a"), { bio: "Updated" }));
});

test("current rules reject client profile stat updates", async () => {
  await seed(current, [["users/user-a", profile]]);
  const db = authenticatedDb(current, "user-a");
  await assertFails(updateDoc(doc(db, "users/user-a"), { wins: 99 }));
  await assertFails(updateDoc(doc(db, "users/user-a"), { posts: 99 }));
});

test("current rules limit post owner updates to editable fields", async () => {
  await seed(current, [["posts/post-a", post]]);
  const db = authenticatedDb(current, "user-a");
  await assertSucceeds(
    updateDoc(doc(db, "posts/post-a"), {
      caption: "Updated caption",
    })
  );
  await assertFails(
    updateDoc(doc(db, "posts/post-a"), {
      mediaUrl: "https://example.test/replaced.jpg",
    })
  );
});

test("hardened fixture limits post owner updates to editable fields", async () => {
  await seed(hardened, [["posts/post-a", post]]);
  const db = authenticatedDb(hardened, "user-a");
  await assertSucceeds(
    updateDoc(doc(db, "posts/post-a"), {
      caption: "Updated caption",
    })
  );
  await assertSucceeds(
    updateDoc(doc(db, "posts/post-a"), { battleEnabled: false })
  );
  await assertFails(
    updateDoc(doc(db, "posts/post-a"), {
      mediaUrl: "https://example.test/replaced.jpg",
    })
  );
});

test("current rules deny arbitrary like counter writes", async () => {
  await seed(current, [["posts/post-a", post]]);
  await assertFails(
    updateDoc(doc(authenticatedDb(current, "user-b"), "posts/post-a"), {
      likesCount: 1000,
    })
  );
});

test("hardened fixture denies all client like counter writes", async () => {
  await seed(hardened, [["posts/post-a", post]]);
  await assertFails(
    updateDoc(doc(authenticatedDb(hardened, "user-b"), "posts/post-a"), {
      likesCount: 1,
    })
  );
});

test("current rules deny client like marker writes", async () => {
  const db = authenticatedDb(current, "user-a");
  const likeRef = doc(db, "likes/post-a_user-a");
  await assertFails(
    setDoc(likeRef, {
      postId: "post-a",
      userId: "user-a",
    })
  );
  await seed(current, [["likes/post-a_user-a", {
    postId: "post-a",
    userId: "user-a",
  }]]);
  await assertFails(deleteDoc(likeRef));
});

test("hardened fixture denies client like marker writes", async () => {
  const db = authenticatedDb(hardened, "user-a");
  await assertFails(
    setDoc(doc(db, "likes/post-a_user-a"), {
      postId: "post-a",
      userId: "user-a",
    })
  );
});

test("current rules allow open challenge acceptance", async () => {
  await seed(current, [["battles/battle-a", openBattle]]);
  await assertSucceeds(
    updateDoc(doc(authenticatedDb(current, "user-b"), "battles/battle-a"), {
      playerB: { userId: "user-b" },
      status: "live",
    })
  );
});

test("hardened fixture preserves transitional challenge acceptance", async () => {
  await seed(hardened, [["battles/battle-a", openBattle]]);
  await assertSucceeds(
    updateDoc(doc(authenticatedDb(hardened, "user-b"), "battles/battle-a"), {
      playerB: { userId: "user-b" },
      status: "live",
    })
  );
});

test("current rules deny arbitrary battle vote counter writes", async () => {
  await seed(current, [["battles/battle-a", openBattle]]);
  await assertFails(
    updateDoc(doc(authenticatedDb(current, "user-c"), "battles/battle-a"), {
      votesA: 500,
      votesB: 300,
    })
  );
});

test("hardened fixture denies battle vote counter writes", async () => {
  await seed(hardened, [["battles/battle-a", openBattle]]);
  await assertFails(
    updateDoc(doc(authenticatedDb(hardened, "user-c"), "battles/battle-a"), {
      votesA: 1,
    })
  );
});

test("current rules deny client vote marker writes", async () => {
  const db = authenticatedDb(current, "user-c");
  await assertFails(
    setDoc(doc(db, "votes/battle-a_user-c"), {
      battleId: "battle-a",
      userId: "user-c",
      side: "A",
    })
  );
});

test("hardened fixture denies client vote marker writes", async () => {
  const db = authenticatedDb(hardened, "user-c");
  await assertFails(
    setDoc(doc(db, "votes/battle-a_user-c"), {
      battleId: "battle-a",
      userId: "user-c",
      side: "A",
    })
  );
});

test("current and hardened rules preserve follow creation and deletion", async () => {
  for (const environment of [current, hardened]) {
    const db = authenticatedDb(environment, "user-a");
    const followRef = doc(db, "follows/user-a_user-b");
    await assertSucceeds(
      setDoc(followRef, {
        followerId: "user-a",
        followingId: "user-b",
      })
    );
    await assertSucceeds(deleteDoc(followRef));
  }
});

test("hardened fixture reserves username writes for the server", async () => {
  await assertFails(
    setDoc(
      doc(authenticatedDb(hardened, "user-a"), "usernames/athlete-a"),
      {
        userId: "user-a",
        normalizedUsername: "athlete-a",
      }
    )
  );
});
