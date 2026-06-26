const crypto = require("node:crypto");
const fs = require("node:fs/promises");
const os = require("node:os");
const path = require("node:path");
const { spawn } = require("node:child_process");
const express = require("express");
const { initializeApp } = require("firebase-admin/app");
const { getAuth } = require("firebase-admin/auth");
const { getStorage } = require("firebase-admin/storage");

initializeApp();

const app = express();
app.use((request, response, next) => {
  response.set("Access-Control-Allow-Origin", "*");
  response.set("Access-Control-Allow-Headers", "Authorization, Content-Type");
  response.set("Access-Control-Allow-Methods", "GET, POST, OPTIONS");
  if (request.method === "OPTIONS") {
    response.sendStatus(204);
    return;
  }
  next();
});
app.use(express.json({ limit: "32kb" }));

const TRACKS = new Set(["hype", "cinematic", "victory", "chill", "intense"]);
const MAX_CLIP_SECONDS = 60;
const FONT_PATH = "/usr/share/fonts/truetype/dejavu/DejaVuSans-Bold.ttf";

function run(command, args) {
  return new Promise((resolve, reject) => {
    const child = spawn(command, args, { stdio: ["ignore", "pipe", "pipe"] });
    let stdout = "";
    let stderr = "";
    child.stdout.on("data", (chunk) => {
      stdout += chunk;
    });
    child.stderr.on("data", (chunk) => {
      stderr += chunk;
    });
    child.on("error", reject);
    child.on("close", (code) => {
      if (code === 0) resolve(stdout);
      else reject(new Error(`${command} failed: ${stderr.slice(-2000)}`));
    });
  });
}

async function authenticate(request) {
  const authorization = request.header("authorization") || "";
  if (!authorization.startsWith("Bearer ")) {
    throw Object.assign(new Error("Authentication required."), { status: 401 });
  }
  return getAuth().verifyIdToken(authorization.slice(7));
}

function numberOrNull(value) {
  return typeof value === "number" && Number.isFinite(value) ? value : null;
}

function escapeDrawText(text) {
  return text
    .replaceAll("\\", "\\\\")
    .replaceAll(":", "\\:")
    .replaceAll("'", "\\'")
    .replaceAll("%", "\\%")
    .replaceAll(",", "\\,")
    .replaceAll("[", "\\[")
    .replaceAll("]", "\\]");
}

async function probe(inputPath) {
  const output = await run("ffprobe", [
    "-v",
    "error",
    "-show_entries",
    "format=duration:stream=codec_type",
    "-of",
    "json",
    inputPath,
  ]);
  const parsed = JSON.parse(output);
  return {
    duration: Number(parsed.format?.duration || 0),
    hasAudio: Array.isArray(parsed.streams)
      ? parsed.streams.some((stream) => stream.codec_type === "audio")
      : false,
  };
}

app.get("/health", (_request, response) => {
  response.json({ ok: true });
});

app.post("/render", async (request, response) => {
  let tempDirectory;
  try {
    const token = await authenticate(request);
    const sourceObjectPath =
      typeof request.body.sourceObjectPath === "string"
        ? request.body.sourceObjectPath
        : "";
    const expectedPrefix = `posts/${token.uid}/`;
    if (!sourceObjectPath.startsWith(expectedPrefix)) {
      return response.status(403).json({ error: "Invalid source video." });
    }

    const audioTrackId =
      typeof request.body.audioTrackId === "string" &&
      TRACKS.has(request.body.audioTrackId)
        ? request.body.audioTrackId
        : null;
    const textOverlay =
      typeof request.body.textOverlay === "string"
        ? request.body.textOverlay.trim().slice(0, 60)
        : "";
    const requestedStart = numberOrNull(request.body.trimStartSeconds) ?? 0;
    const requestedEnd = numberOrNull(request.body.trimEndSeconds);

    tempDirectory = await fs.mkdtemp(path.join(os.tmpdir(), "momentum-render-"));
    const inputPath = path.join(tempDirectory, "input");
    const outputPath = path.join(tempDirectory, "output.mp4");
    const bucket = getStorage().bucket();
    await bucket.file(sourceObjectPath).download({ destination: inputPath });

    const source = await probe(inputPath);
    if (!source.duration || source.duration > MAX_CLIP_SECONDS + 1) {
      return response.status(400).json({ error: "Video must be 60 seconds or shorter." });
    }

    const start = Math.max(0, Math.min(requestedStart, source.duration - 1));
    const end = Math.max(
      start + 1,
      Math.min(requestedEnd ?? source.duration, source.duration)
    );
    const clipDuration = end - start;
    const args = [
      "-y",
      "-ss",
      start.toFixed(3),
      "-t",
      clipDuration.toFixed(3),
      "-i",
      inputPath,
    ];

    if (audioTrackId) {
      args.push(
        "-stream_loop",
        "-1",
        "-i",
        path.join(__dirname, "audio", `${audioTrackId}.wav`)
      );
    }

    if (textOverlay) {
      args.push(
        "-vf",
        `drawtext=fontfile=${FONT_PATH}:text='${escapeDrawText(
          textOverlay
        )}':fontcolor=white:fontsize=h/18:borderw=3:bordercolor=black@0.75:x=(w-text_w)/2:y=h-(text_h*2.4)`
      );
    }

    if (audioTrackId && source.hasAudio) {
      args.push(
        "-filter_complex",
        `[0:a]volume=1[a0];[1:a]volume=0.32,atrim=duration=${clipDuration.toFixed(
          3
        )}[music];[a0][music]amix=inputs=2:duration=first:dropout_transition=2[aout]`,
        "-map",
        "0:v:0",
        "-map",
        "[aout]"
      );
    } else if (audioTrackId) {
      args.push(
        "-filter_complex",
        `[1:a]volume=0.55,atrim=duration=${clipDuration.toFixed(3)}[aout]`,
        "-map",
        "0:v:0",
        "-map",
        "[aout]"
      );
    } else {
      args.push("-map", "0:v:0");
      if (source.hasAudio) args.push("-map", "0:a:0");
    }

    args.push(
      "-c:v",
      "libx264",
      "-preset",
      "veryfast",
      "-crf",
      "23",
      "-pix_fmt",
      "yuv420p",
      "-c:a",
      "aac",
      "-b:a",
      "160k",
      "-movflags",
      "+faststart",
      "-shortest",
      outputPath
    );
    await run("ffmpeg", args);

    const downloadToken = crypto.randomUUID();
    const outputObjectPath = `posts/${token.uid}/edited_${Date.now()}.mp4`;
    await bucket.upload(outputPath, {
      destination: outputObjectPath,
      metadata: {
        contentType: "video/mp4",
        metadata: {
          firebaseStorageDownloadTokens: downloadToken,
        },
      },
    });

    const mediaUrl =
      `https://firebasestorage.googleapis.com/v0/b/${bucket.name}/o/` +
      `${encodeURIComponent(outputObjectPath)}?alt=media&token=${downloadToken}`;
    response.json({ mediaUrl, outputObjectPath });
  } catch (error) {
    console.error("[render]", error);
    response.status(error.status || 500).json({
      error: error.status ? error.message : "Video rendering failed.",
    });
  } finally {
    if (tempDirectory) {
      await fs.rm(tempDirectory, { recursive: true, force: true }).catch(() => undefined);
    }
  }
});

app.listen(process.env.PORT || 8080, () => {
  console.log(`Momentum video renderer listening on ${process.env.PORT || 8080}`);
});
