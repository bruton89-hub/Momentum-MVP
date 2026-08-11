"use strict";

const test = require("node:test");
const assert = require("node:assert/strict");
const { getFirestore } = require("firebase-admin/firestore");
const { getStorage } = require("firebase-admin/storage");
const { deletePost } = require("../lib/index");

const db = getFirestore();

function request(uid, postId) {
  return {
    auth: uid ? { uid, token: {} } : undefined,
    data: { postId },
  };
}

async function exists(path) {
  return (await db.doc(path).get()).exists;
}

test("deletePost cleans related records and is idempotent for the owner", async () => {
  const postId = "delete-post-owner";
  await Promise.all([
    db.doc(`posts/${postId}`).set({
      userId: "owner-a",
      mediaUrl: "https://example.test/post.jpg",
      likesCount: 1,
    }),
    db.doc("users/owner-a").set({ posts: 1 }),
    db.doc("comments/delete-comment").set({ postId, userId: "commenter" }),
    db.doc("likes/delete-like").set({ postId, userId: "liker" }),
    db.doc("notifications/delete-notification").set({
      postId,
      recipientId: "owner-a",
    }),
  ]);

  const result = await deletePost.run(request("owner-a", postId));
  assert.equal(result.outcome, "applied");
  assert.deepEqual(result.deleted, { comments: 1, likes: 1, notifications: 1 });
  assert.equal(await exists(`posts/${postId}`), false);
  assert.equal(await exists("comments/delete-comment"), false);
  assert.equal(await exists("likes/delete-like"), false);
  assert.equal(await exists("notifications/delete-notification"), false);
  assert.equal((await db.doc("users/owner-a").get()).get("posts"), 0);

  const retry = await deletePost.run(request("owner-a", postId));
  assert.equal(retry.outcome, "already_applied");
});

test("deletePost rejects another user and an unauthenticated request", async () => {
  const postId = "delete-post-auth";
  await db.doc(`posts/${postId}`).set({
    userId: "owner-b",
    mediaUrl: "https://example.test/post.jpg",
  });

  await assert.rejects(
    deletePost.run(request("other-user", postId)),
    (error) => error.code === "permission-denied"
  );
  await assert.rejects(
    deletePost.run(request(null, postId)),
    (error) => error.code === "unauthenticated"
  );
  assert.equal(await exists(`posts/${postId}`), true);
});

test("deletePost supports legacy owner aliases without allowing conflicts or non-owners", async () => {
  const legacyShapes = [
    ["authorId", "delete-post-legacy-author"],
    ["uid", "delete-post-legacy-uid"],
    ["ownerId", "delete-post-legacy-owner"],
  ];

  for (const [ownerField, postId] of legacyShapes) {
    await db.doc(`posts/${postId}`).set({
      [ownerField]: "legacy-owner",
      mediaUrl: "https://example.test/legacy.jpg",
    });
    await assert.rejects(
      deletePost.run(request("other-user", postId)),
      (error) => error.code === "permission-denied"
    );
    const result = await deletePost.run(request("legacy-owner", postId));
    assert.equal(result.outcome, "applied");
    assert.equal(await exists(`posts/${postId}`), false);
  }

  const conflictingPostId = "delete-post-conflicting-owner";
  await db.doc(`posts/${conflictingPostId}`).set({
    userId: "canonical-owner",
    authorId: "other-user",
    mediaUrl: "https://example.test/conflict.jpg",
  });
  await assert.rejects(
    deletePost.run(request("other-user", conflictingPostId)),
    (error) => error.code === "permission-denied"
  );
  assert.equal(await exists(`posts/${conflictingPostId}`), true);
});

test("deletePost blocks active battles without removing the post", async () => {
  const postId = "delete-post-active-battle";
  await Promise.all([
    db.doc(`posts/${postId}`).set({
      userId: "owner-c",
      mediaUrl: "https://example.test/post.jpg",
    }),
    db.doc("battles/delete-active-battle").set({
      status: "live",
      playerA: { postId, userId: "owner-c" },
      playerB: { postId: "opponent-post", userId: "other-user" },
    }),
  ]);

  await assert.rejects(
    deletePost.run(request("owner-c", postId)),
    (error) =>
      error.code === "failed-precondition" &&
      error.message ===
        "This post is currently part of an active battle and cannot be deleted yet."
  );
  assert.equal(await exists(`posts/${postId}`), true);
  assert.equal(await exists("battles/delete-active-battle"), true);
});

test("deletePost preserves completed battle history and its media reference", async () => {
  const postId = "delete-post-completed-battle";
  const mediaUrl = "https://example.test/history.jpg";
  await Promise.all([
    db.doc(`posts/${postId}`).set({ userId: "owner-d", mediaUrl }),
    db.doc("battles/delete-completed-battle").set({
      status: "completed",
      winner: "owner-d",
      playerA: { postId, userId: "owner-d", mediaUrl },
      playerB: { postId: "opponent-post", userId: "other-user" },
    }),
  ]);

  const result = await deletePost.run(request("owner-d", postId));
  assert.equal(result.outcome, "applied");
  assert.equal(result.mediaRetainedForBattleHistory, true);
  assert.equal(await exists(`posts/${postId}`), false);
  const battle = await db.doc("battles/delete-completed-battle").get();
  assert.equal(battle.exists, true);
  assert.equal(battle.get("winner"), "owner-d");
  assert.equal(battle.get("playerA.mediaUrl"), mediaUrl);
});

test("deletePost removes only the owned post media object", async () => {
  const postId = "delete-post-storage";
  const bucketName = "demo-momentum-phase0.appspot.com";
  const ownedPath = "posts/owner-e/post_delete.jpg";
  const unrelatedPath = "posts/other-user/keep.jpg";
  const bucket = getStorage().bucket(bucketName);
  await Promise.all([
    bucket.file(ownedPath).save(Buffer.from("owned media"), {
      contentType: "image/jpeg",
    }),
    bucket.file(unrelatedPath).save(Buffer.from("unrelated media"), {
      contentType: "image/jpeg",
    }),
    db.doc(`posts/${postId}`).set({
      userId: "owner-e",
      mediaUrl:
        `https://firebasestorage.googleapis.com/v0/b/${bucketName}/o/` +
        encodeURIComponent(ownedPath) +
        "?alt=media",
    }),
  ]);

  const result = await deletePost.run(request("owner-e", postId));
  assert.equal(result.mediaCleanupComplete, true);
  assert.equal((await bucket.file(ownedPath).exists())[0], false);
  assert.equal((await bucket.file(unrelatedPath).exists())[0], true);
});
