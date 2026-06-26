#!/usr/bin/env node
"use strict";

const fs = require("node:fs");
const path = require("node:path");
const { spawnSync } = require("node:child_process");

const root = path.resolve(__dirname, "..");
const minimumJavaMajor = 21;

function javaMajor(javaBinary) {
  const result = spawnSync(javaBinary, ["-version"], {
    encoding: "utf8",
  });
  if (result.status !== 0) return null;

  const output = `${result.stdout}\n${result.stderr}`;
  const match = output.match(/version\s+"(?:1\.)?(\d+)/);
  return match ? Number(match[1]) : null;
}

function candidateJavaBinaries() {
  const candidates = [];
  if (process.env.JAVA_HOME) {
    candidates.push(path.join(process.env.JAVA_HOME, "bin", "java"));
  }

  candidates.push(
    "/opt/homebrew/opt/openjdk@21/bin/java",
    "/usr/local/opt/openjdk@21/bin/java",
    "java"
  );

  return [...new Set(candidates)];
}

const javaBinary = candidateJavaBinaries().find((candidate) => {
  if (candidate !== "java" && !fs.existsSync(candidate)) return false;
  const major = javaMajor(candidate);
  return major !== null && major >= minimumJavaMajor;
});

if (!javaBinary) {
  console.error(
    [
      `Firestore emulator tests require Java ${minimumJavaMajor}+ with the installed Firebase CLI.`,
      "Set JAVA_HOME to a compatible JDK or install one, for example:",
      "  brew install openjdk@21",
      "Then rerun: npm run test:rules",
    ].join("\n")
  );
  process.exit(1);
}

const javaBinDir =
  javaBinary === "java" ? null : path.dirname(path.resolve(javaBinary));
const firebaseBinary = path.join(
  root,
  "node_modules",
  ".bin",
  process.platform === "win32" ? "firebase.cmd" : "firebase"
);

const env = {
  ...process.env,
  CI: "1",
  XDG_CONFIG_HOME: path.join(root, ".firebase-config"),
  XDG_CACHE_HOME: path.join(root, ".firebase-cache"),
  FIREBASE_EMULATORS_PATH: path.join(root, ".firebase-data"),
  PATH: javaBinDir
    ? `${javaBinDir}${path.delimiter}${process.env.PATH ?? ""}`
    : process.env.PATH,
};

const result = spawnSync(
  firebaseBinary,
  [
    "emulators:exec",
    "--project",
    "demo-momentum-phase0",
    "--only",
    "firestore",
    "node --test test/firestore.rules.test.js",
  ],
  {
    cwd: root,
    env,
    stdio: "inherit",
  }
);

if (result.error) {
  console.error(result.error.message);
  process.exit(1);
}

process.exit(result.status ?? 1);
