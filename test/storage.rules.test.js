const { readFileSync } = require("node:fs");
const { after, before, test } = require("node:test");
const {
  assertSucceeds,
  initializeTestEnvironment,
} = require("@firebase/rules-unit-testing");

const projectId = "demo-momentum-media";
const userId = "media-owner";
let testEnv;

before(async () => {
  testEnv = await initializeTestEnvironment({
    projectId,
    storage: { rules: readFileSync("storage.rules", "utf8") },
  });
});

after(async () => {
  await testEnv.cleanup();
});

function ownerStorage() {
  return testEnv.authenticatedContext(userId).storage();
}

test("Create image bytes are accepted by the posts rule", async () => {
  await assertSucceeds(
    ownerStorage().ref(`posts/${userId}/post_image.jpg`).put(
      new Uint8Array([1, 2, 3]),
      { contentType: "image/jpeg" }
    )
  );
});

test("Create video bytes are accepted by the posts rule", async () => {
  await assertSucceeds(
    ownerStorage().ref(`posts/${userId}/post_video.mp4`).put(
      new Uint8Array([0, 0, 0, 1]),
      { contentType: "video/mp4" }
    )
  );
});

test("profile banner bytes are accepted by the local banner rule", async () => {
  await assertSucceeds(
    ownerStorage().ref(`banners/${userId}/banner.jpg`).put(
      new Uint8Array([1, 2, 3]),
      { contentType: "image/jpeg" }
    )
  );
});

test("avatar bytes remain accepted by the existing profile image rule", async () => {
  await assertSucceeds(
    ownerStorage().ref(`profileImages/${userId}/avatar.jpg`).put(
      new Uint8Array([1, 2, 3]),
      { contentType: "image/jpeg" }
    )
  );
});
