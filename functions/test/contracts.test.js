"use strict";

const test = require("node:test");
const assert = require("node:assert/strict");

const engagement = require("../lib/contracts/engagement");
const profiles = require("../lib/contracts/profiles");
const battles = require("../lib/contracts/battles");
const {
  COMMAND_ERROR_CODES,
  commandError,
} = require("../lib/shared/errors");
const {
  requireAuthenticatedUid,
} = require("../lib/shared/auth");
const {
  requireBattleVoteSide,
  requireBoolean,
  requireClientMutationId,
  requireRecord,
  requireString,
} = require("../lib/shared/validation");
const {
  buildCommandLogEntry,
  currentReleaseIdentifier,
} = require("../lib/shared/logging");

test("future callable command names remain stable", () => {
  assert.equal(engagement.SET_POST_LIKE_COMMAND, "setPostLike");
  assert.equal(engagement.CAST_BATTLE_VOTE_COMMAND, "castBattleVote");
  assert.equal(profiles.CLAIM_USERNAME_COMMAND, "claimUsernameAndCreateProfile");
  assert.equal(profiles.RENAME_USERNAME_COMMAND, "renameUsername");
  assert.equal(battles.FINALIZE_BATTLE_COMMAND, "finalizeBattle");
});

test("command errors use the agreed callable error vocabulary", () => {
  assert.deepEqual(COMMAND_ERROR_CODES, [
    "unauthenticated",
    "invalid-argument",
    "not-found",
    "already-exists",
    "failed-precondition",
    "permission-denied",
    "aborted",
    "internal",
  ]);
  const error = commandError("already-exists", "Duplicate command.");
  assert.equal(error.code, "already-exists");
});

test("auth helper accepts only a non-empty Firebase uid", () => {
  assert.equal(requireAuthenticatedUid({ uid: "user-a" }), "user-a");
  assert.throws(
    () => requireAuthenticatedUid(undefined),
    (error) => error.code === "unauthenticated"
  );
  assert.throws(
    () => requireAuthenticatedUid({ uid: " " }),
    (error) => error.code === "unauthenticated"
  );
});

test("validation helpers reject malformed future command payloads", () => {
  assert.deepEqual(requireRecord({ postId: "post-a" }), { postId: "post-a" });
  assert.equal(requireString(" post-a ", "postId"), "post-a");
  assert.equal(requireBoolean(false, "liked"), false);
  assert.equal(requireBattleVoteSide("A"), "A");
  assert.equal(
    requireClientMutationId("device:123.request-1"),
    "device:123.request-1"
  );

  assert.throws(
    () => requireRecord([]),
    (error) => error.code === "invalid-argument"
  );
  assert.throws(
    () => requireBattleVoteSide("C"),
    (error) => error.code === "invalid-argument"
  );
  assert.throws(
    () => requireClientMutationId("contains spaces"),
    (error) => error.code === "invalid-argument"
  );
});

test("structured command logs expose only the approved fields", () => {
  const entry = buildCommandLogEntry(
    {
      command: "setPostLike",
      callerUid: "user-a",
      targetId: "post-a",
      startedAtMs: 100,
      release: "test-release",
    },
    "failed",
    145,
    { code: "aborted", email: "must-not-appear@example.com" }
  );

  assert.deepEqual(entry, {
    command: "setPostLike",
    callerUid: "user-a",
    targetId: "post-a",
    outcome: "failed",
    latencyMs: 45,
    release: "test-release",
    errorCode: "aborted",
  });
  assert.equal(JSON.stringify(entry).includes("must-not-appear"), false);
});

test("release identifier distinguishes emulator and deployed revisions", () => {
  assert.equal(
    currentReleaseIdentifier({ FUNCTIONS_EMULATOR: "true" }),
    "emulator"
  );
  assert.equal(
    currentReleaseIdentifier({ K_REVISION: "momentum-00042" }),
    "momentum-00042"
  );
  assert.equal(currentReleaseIdentifier({}), "unknown");
});

test("functions contract tests execute inside the emulator harness", () => {
  assert.equal(process.env.FUNCTIONS_EMULATOR, "true");
});
