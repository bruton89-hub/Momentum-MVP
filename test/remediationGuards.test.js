"use strict";

const assert = require("node:assert/strict");
const { readFileSync } = require("node:fs");
const { test } = require("node:test");
const ts = require("typescript");

const source = readFileSync("utils/remediationGuards.ts", "utf8");
const output = ts.transpileModule(source, {
  compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022 },
}).outputText;
const moduleUnderTest = { exports: {} };
Function("module", "exports", output)(moduleUnderTest, moduleUnderTest.exports);
const { isLatestGeneration, canCommitProfile, shouldPlayCreatePreview } = moduleUnderTest.exports;

test("an older Following generation cannot commit over the newest query", () => {
  assert.equal(isLatestGeneration(4, 5), false);
  assert.equal(isLatestGeneration(5, 5), true);
});

test("a previous account profile cannot commit after the live UID changes", () => {
  assert.equal(canCommitProfile("user-a", "user-b"), false);
  assert.equal(canCommitProfile("user-a", null), false);
  assert.equal(canCommitProfile("user-a", "user-a"), true);
});

test("Create playback requires intent, focus, and foreground state", () => {
  assert.equal(shouldPlayCreatePreview(true, true, true), true);
  assert.equal(shouldPlayCreatePreview(true, false, true), false);
  assert.equal(shouldPlayCreatePreview(true, true, false), false);
  assert.equal(shouldPlayCreatePreview(false, true, true), false);
});

test("confirmed Create discard clears retained workflow state before navigation", () => {
  const createSource = readFileSync("app/(tabs)/create.tsx", "utf8");
  assert.match(
    createSource,
    /if \(discard\) \{[\s\S]*?resetForm\(\);[\s\S]*?router\.replace\("\/"\);[\s\S]*?\}/
  );
});
