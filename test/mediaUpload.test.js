const assert = require("node:assert/strict");
const { readFileSync } = require("node:fs");
const { test } = require("node:test");
const ts = require("typescript");

function loadMediaUploadModule() {
  const source = readFileSync("utils/mediaUpload.ts", "utf8");
  const output = ts.transpileModule(source, {
    compilerOptions: {
      module: ts.ModuleKind.CommonJS,
      target: ts.ScriptTarget.ES2022,
    },
  }).outputText;
  const module = { exports: {} };
  Function("module", "exports", "require", output)(module, module.exports, require);
  return module.exports;
}

const { loadMediaBlob } = loadMediaUploadModule();

test("Create image and profile images decode picker data URIs without fetch", async () => {
  const originalFetch = global.fetch;
  let fetchCalls = 0;
  global.fetch = async () => {
    fetchCalls += 1;
    throw new Error("fetch(data:) must not run");
  };
  try {
    const blob = await loadMediaBlob(
      {
        uri: "data:image/png;base64,iVBORw0KGgo=",
        mimeType: "image/png",
        fileName: "picked.png",
      },
      "web"
    );
    assert.equal(blob.type, "image/png");
    assert.equal(blob.size, 8);
    assert.equal(fetchCalls, 0);
  } finally {
    global.fetch = originalFetch;
  }
});

test("Create video decodes a picker data URI and preserves video MIME type", async () => {
  const blob = await loadMediaBlob(
    {
      uri: "data:video/mp4;base64,AAAAHGZ0eXBtcDQy",
      mimeType: "video/mp4",
      fileName: "highlight.mp4",
    },
    "web"
  );
  assert.equal(blob.type, "video/mp4");
  assert.ok(blob.size > 0);
});

test("browser blob URLs use fetch and apply picker MIME metadata", async () => {
  const originalFetch = global.fetch;
  global.fetch = async () =>
    new Response(new Blob([new Uint8Array([1, 2, 3])]), { status: 200 });
  try {
    const blob = await loadMediaBlob(
      { uri: "blob:https://momentum.test/picker", mimeType: "image/jpeg" },
      "web"
    );
    assert.equal(blob.type, "image/jpeg");
    assert.equal(blob.size, 3);
  } finally {
    global.fetch = originalFetch;
  }
});

test("native picker URIs use XHR rather than fetch", async () => {
  const OriginalXHR = global.XMLHttpRequest;
  const originalFetch = global.fetch;
  let fetchCalls = 0;
  global.fetch = async () => {
    fetchCalls += 1;
    throw new Error("native local URI must not use fetch");
  };
  global.XMLHttpRequest = class FakeXHR {
    open(_method, _uri) {}
    send() {
      this.response = new Blob([new Uint8Array([4, 5])], { type: "image/jpeg" });
      this.onload();
    }
  };
  try {
    const blob = await loadMediaBlob("file:///picked.jpg", "ios");
    assert.equal(blob.type, "image/jpeg");
    assert.equal(blob.size, 2);
    assert.equal(fetchCalls, 0);
  } finally {
    global.XMLHttpRequest = OriginalXHR;
    global.fetch = originalFetch;
  }
});
