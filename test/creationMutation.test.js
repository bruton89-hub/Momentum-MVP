"use strict";

const assert = require("node:assert/strict");
const { readFileSync } = require("node:fs");
const { test } = require("node:test");
const ts = require("typescript");

function loadModule() {
  const source = readFileSync("utils/creationMutation.ts", "utf8");
  const output = ts.transpileModule(source, {
    compilerOptions: {
      module: ts.ModuleKind.CommonJS,
      target: ts.ScriptTarget.ES2022,
    },
  }).outputText;
  const module = { exports: {} };
  Function("module", "exports", output)(module, module.exports);
  return module.exports;
}

const { createCreationMutation } = loadModule();

test("a logical retry retains its preallocated document identity", () => {
  const mutation = createCreationMutation("post");
  const simulatedWrites = new Map();
  simulatedWrites.set(mutation.documentId, { acknowledged: false });
  simulatedWrites.set(mutation.documentId, { acknowledged: true });
  assert.equal(simulatedWrites.size, 1);
});

test("a genuinely new operation receives a different identity", () => {
  const first = createCreationMutation("battle");
  const second = createCreationMutation("battle");
  assert.notEqual(first.documentId, second.documentId);
  assert.match(first.documentId, /^battle_/);
  assert.match(second.documentId, /^battle_/);
});
