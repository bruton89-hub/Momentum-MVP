const fs = require("node:fs");
const path = require("node:path");

const SAMPLE_RATE = 22050;
const DURATION_SECONDS = 8;
const SAMPLE_COUNT = SAMPLE_RATE * DURATION_SECONDS;
const OUTPUT_DIR = path.join(__dirname, "..", "assets", "audio");

const tracks = {
  hype: { bpm: 132, notes: [110, 164.81, 220, 164.81], beat: 0.7 },
  cinematic: { bpm: 82, notes: [73.42, 110, 146.83, 110], beat: 0.35 },
  victory: { bpm: 120, notes: [130.81, 164.81, 196, 261.63], beat: 0.55 },
  chill: { bpm: 92, notes: [98, 123.47, 146.83, 123.47], beat: 0.28 },
  intense: { bpm: 148, notes: [82.41, 82.41, 123.47, 110], beat: 0.8 },
};

function envelope(position, length) {
  const attack = Math.min(1, position / Math.max(1, length * 0.04));
  const release = Math.min(1, (length - position) / Math.max(1, length * 0.18));
  return Math.max(0, Math.min(attack, release));
}

function createTrack({ bpm, notes, beat }) {
  const samples = new Int16Array(SAMPLE_COUNT);
  const beatSamples = Math.round((60 / bpm) * SAMPLE_RATE);

  for (let index = 0; index < SAMPLE_COUNT; index += 1) {
    const time = index / SAMPLE_RATE;
    const beatIndex = Math.floor(index / beatSamples);
    const beatPosition = index % beatSamples;
    const note = notes[beatIndex % notes.length];
    const toneEnvelope = envelope(beatPosition, beatSamples);
    const bass =
      Math.sin(2 * Math.PI * note * time) * 0.32 +
      Math.sin(2 * Math.PI * note * 2 * time) * 0.12;
    const kickPosition = beatPosition / SAMPLE_RATE;
    const kick =
      kickPosition < 0.14
        ? Math.sin(2 * Math.PI * (62 - kickPosition * 180) * time) *
          Math.exp(-kickPosition * 24) *
          beat
        : 0;
    const hat =
      beatPosition < SAMPLE_RATE * 0.035
        ? (Math.random() * 2 - 1) *
          Math.exp(-(beatPosition / SAMPLE_RATE) * 75) *
          0.08
        : 0;
    const sample = Math.max(
      -1,
      Math.min(1, bass * toneEnvelope + kick + hat)
    );
    samples[index] = Math.round(sample * 32767 * 0.72);
  }

  const dataBytes = samples.length * 2;
  const wav = Buffer.alloc(44 + dataBytes);
  wav.write("RIFF", 0);
  wav.writeUInt32LE(36 + dataBytes, 4);
  wav.write("WAVE", 8);
  wav.write("fmt ", 12);
  wav.writeUInt32LE(16, 16);
  wav.writeUInt16LE(1, 20);
  wav.writeUInt16LE(1, 22);
  wav.writeUInt32LE(SAMPLE_RATE, 24);
  wav.writeUInt32LE(SAMPLE_RATE * 2, 28);
  wav.writeUInt16LE(2, 32);
  wav.writeUInt16LE(16, 34);
  wav.write("data", 36);
  wav.writeUInt32LE(dataBytes, 40);
  for (let index = 0; index < samples.length; index += 1) {
    wav.writeInt16LE(samples[index], 44 + index * 2);
  }
  return wav;
}

fs.mkdirSync(OUTPUT_DIR, { recursive: true });
for (const [name, definition] of Object.entries(tracks)) {
  fs.writeFileSync(
    path.join(OUTPUT_DIR, `${name}.wav`),
    createTrack(definition)
  );
}

console.log(`Generated ${Object.keys(tracks).length} original audio loops.`);
