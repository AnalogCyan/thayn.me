#!/usr/bin/env node
// Records a post's read-aloud: narration text from the built page, speech
// from a TTS command, word timings by forced alignment, then hashed media
// and a manifest the build pairs with the post. Runs locally, never on
// Netlify. See "Narrating a post" in the README.

import crypto from "node:crypto";
import { execFile, spawn } from "node:child_process";
import fs from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { promisify } from "node:util";
import { fileURLToPath } from "node:url";
import {
  MANIFEST_DIR,
  hashedMediaName,
  MEDIA_URL_PREFIX,
  manifestPath,
  narrationFromHtml,
} from "../../lib/read-aloud.js";

const run = promisify(execFile);

// Like run(), with the command's output shown as it goes
function live(cmd, args) {
  return new Promise((resolve, reject) => {
    const child = spawn(cmd, args, { stdio: ["ignore", "inherit", "inherit"] });
    child.on("error", reject);
    child.on("exit", (code) =>
      code === 0 ? resolve() : reject(new Error(`${cmd} exited with ${code}`))
    );
  });
}
const HERE = path.dirname(fileURLToPath(import.meta.url));
const ROOT = path.resolve(HERE, "../..");
const RATE = 24000;

function usage(message) {
  if (message) console.error(message);
  console.error(
    "Usage: node tools/read-aloud/narrate.js <slug> [--tts <command>] " +
      "[--pause <seconds>] [--no-build]"
  );
  process.exit(2);
}

function parseArgs(argv) {
  const opts = {
    tts: process.env.READ_ALOUD_TTS || "",
    pause: 0.6,
    build: true,
  };
  const rest = [];
  for (let i = 0; i < argv.length; i += 1) {
    const arg = argv[i];
    if (arg === "--tts") opts.tts = argv[++i] || "";
    else if (arg === "--pause") opts.pause = Number(argv[++i]);
    else if (arg === "--no-build") opts.build = false;
    else if (arg.startsWith("-")) usage(`Unknown option ${arg}`);
    else rest.push(arg);
  }
  if (rest.length !== 1) usage();
  if (!/^[\w-]+$/.test(rest[0])) usage(`Not a post slug: ${rest[0]}`);
  if (!opts.tts) usage("Set READ_ALOUD_TTS or pass --tts.");
  if (!(opts.pause >= 0)) usage("--pause takes a number of seconds.");
  return { slug: rest[0], ...opts };
}

async function has(cmd) {
  try {
    await run("/bin/sh", ["-c", `command -v ${cmd}`]);
    return true;
  } catch {
    return false;
  }
}

// macOS ships afconvert; elsewhere ffmpeg does the same jobs
async function audioTools() {
  if (process.platform === "darwin" && (await has("afconvert"))) {
    return {
      toPcm: (src, dest) =>
        run("afconvert", [
          "-f",
          "WAVE",
          "-d",
          `LEI16@${RATE}`,
          "-c",
          "1",
          src,
          dest,
        ]),
      toAac: (src, dest) =>
        run("afconvert", ["-f", "m4af", "-d", "aac", "-b", "64000", src, dest]),
    };
  }
  if (await has("ffmpeg")) {
    const ff = (args) => run("ffmpeg", ["-y", "-loglevel", "error", ...args]);
    return {
      toPcm: (src, dest) =>
        ff([
          "-i",
          src,
          "-ac",
          "1",
          "-ar",
          String(RATE),
          "-c:a",
          "pcm_s16le",
          dest,
        ]),
      toAac: (src, dest) =>
        ff([
          "-i",
          src,
          "-c:a",
          "aac",
          "-b:a",
          "64k",
          "-movflags",
          "+faststart",
          dest,
        ]),
    };
  }
  throw new Error("Needs afconvert (macOS) or ffmpeg to convert audio.");
}

// The samples of a 16-bit mono WAV this tool wrote itself
function pcmData(buf) {
  for (let at = 12; at + 8 <= buf.length;) {
    const id = buf.toString("ascii", at, at + 4);
    const size = buf.readUInt32LE(at + 4);
    if (id === "data") return buf.subarray(at + 8, at + 8 + size);
    at += 8 + size + (size % 2);
  }
  throw new Error("WAV has no data chunk");
}

function wavFile(samples) {
  const header = Buffer.alloc(44);
  header.write("RIFF", 0, "ascii");
  header.writeUInt32LE(36 + samples.length, 4);
  header.write("WAVEfmt ", 8, "ascii");
  header.writeUInt32LE(16, 16);
  header.writeUInt16LE(1, 20);
  header.writeUInt16LE(1, 22);
  header.writeUInt32LE(RATE, 24);
  header.writeUInt32LE(RATE * 2, 28);
  header.writeUInt16LE(2, 32);
  header.writeUInt16LE(16, 34);
  header.write("data", 36, "ascii");
  header.writeUInt32LE(samples.length, 40);
  return Buffer.concat([header, samples]);
}

// A venv outside the repo, rebuilt when requirements.txt changes
async function aligner() {
  const venv =
    process.env.READ_ALOUD_VENV ||
    path.join(os.homedir(), ".cache", "thayn-me", "read-aloud-venv");
  const python = path.join(venv, "bin", "python");
  const requirements = path.join(HERE, "requirements.txt");
  const wanted = crypto
    .createHash("sha256")
    .update(await fs.readFile(requirements))
    .digest("hex");
  const stamp = path.join(venv, ".requirements-sha256");
  const current = await fs.readFile(stamp, "utf8").catch(() => "");
  if (current.trim() !== wanted) {
    const base = process.env.READ_ALOUD_PYTHON || "python3";
    console.log(`Setting up the aligner in ${venv} (one time)...`);
    await run(base, ["-m", "venv", venv]);
    await live(python, [
      "-m",
      "pip",
      "install",
      "-q",
      "--disable-pip-version-check",
      "-r",
      requirements,
    ]);
    await fs.writeFile(stamp, wanted + "\n");
  }
  return python;
}

async function main() {
  const opts = parseArgs(process.argv.slice(2));
  const { slug } = opts;

  if (opts.build) {
    console.log("Building the site (drafts included)...");
    await run(process.execPath, [path.join(ROOT, "build.js")], {
      cwd: ROOT,
      env: { ...process.env, BLOG_INCLUDE_DRAFTS: "1" },
      maxBuffer: 64 * 1024 * 1024,
    });
  }
  const page = path.join(ROOT, "public", "blog", slug, "index.html");
  const { blocks, words, hash } = narrationFromHtml(
    await fs.readFile(page, "utf8").catch(() => {
      throw new Error(`No built page at ${path.relative(ROOT, page)}`);
    })
  );
  if (!words.length) throw new Error("The page has no narration text.");

  const tools = await audioTools();
  const python = await aligner();

  const work =
    process.env.READ_ALOUD_WORK ||
    (await fs.mkdtemp(path.join(os.tmpdir(), `read-aloud-${slug}-`)));
  const clipsDir = path.join(work, "clips");
  await fs.mkdir(clipsDir, { recursive: true });
  const script = path.join(work, "script.txt");
  await fs.writeFile(script, blocks.map((b) => b.text).join("\n") + "\n");

  console.log(`Speaking ${blocks.length} blocks, ${words.length} words...`);
  await live("/bin/sh", ["-c", `${opts.tts} "$@"`, "tts", script, clipsDir]);

  const clips = [];
  for (let i = 0; i < blocks.length; i += 1) {
    const name = String(i + 1).padStart(4, "0");
    const src = path.join(clipsDir, `${name}.wav`);
    const pcm = path.join(work, `${name}.pcm.wav`);
    await fs.access(src).catch(() => {
      throw new Error(`The TTS command wrote no ${path.basename(src)}`);
    });
    await tools.toPcm(src, pcm);
    clips.push({ path: pcm, words: blocks[i].words });
  }

  console.log("Aligning words to the audio...");
  const job = path.join(work, "align-job.json");
  const aligned = path.join(work, "align-out.json");
  await fs.writeFile(job, JSON.stringify({ clips }));
  await live(python, ["-I", path.join(HERE, "align.py"), job, aligned]);
  const result = JSON.parse(await fs.readFile(aligned, "utf8"));
  const fallbacks = result.methods.filter((m) => m === "proportional").length;
  if (fallbacks) {
    console.warn(
      `⚠️ ${fallbacks} block(s) got estimated timings, not aligned.`
    );
  }

  // One track: the clips in order with a pause between, timings shifted to
  // where each clip lands
  const gap = Buffer.alloc(Math.round(opts.pause * RATE) * 2);
  const pieces = [];
  const timed = [];
  let offset = 0;
  for (let i = 0; i < clips.length; i += 1) {
    if (i) {
      pieces.push(gap);
      offset += gap.length / 2 / RATE;
    }
    const samples = pcmData(await fs.readFile(clips[i].path));
    // Well under a tenth of a second a word means the voice gave up early
    if (samples.length / 2 / RATE < clips[i].words.length * 0.05) {
      throw new Error(
        `Clip ${i + 1} is too short for its words; check the TTS`
      );
    }
    pieces.push(samples);
    clips[i].words.forEach((w, j) => {
      const [start] = result.clips[i][j];
      timed.push({ w, t: Math.round((offset + start) * 100) / 100 });
    });
    offset += samples.length / 2 / RATE;
  }
  const duration = Math.round(offset * 100) / 100;
  const wav = path.join(work, "narration.wav");
  const m4a = path.join(work, "narration.m4a");
  const timings = path.join(work, "timings.json");
  await fs.writeFile(wav, wavFile(Buffer.concat(pieces)));
  await tools.toAac(wav, m4a);
  await fs.writeFile(
    timings,
    JSON.stringify({ duration, words: timed }) + "\n"
  );

  const mediaDir = path.join(ROOT, "src", "static", MEDIA_URL_PREFIX);
  await fs.mkdir(mediaDir, { recursive: true });
  const audioName = hashedMediaName(slug, await fs.readFile(m4a), "m4a");
  const timingsName = hashedMediaName(slug, await fs.readFile(timings), "json");
  await fs.copyFile(m4a, path.join(mediaDir, audioName));
  await fs.copyFile(timings, path.join(mediaDir, timingsName));
  // Old recordings go only once the new ones are in place
  for (const old of await fs.readdir(mediaDir)) {
    if (
      old.startsWith(`${slug}.`) &&
      old !== audioName &&
      old !== timingsName
    ) {
      await fs.rm(path.join(mediaDir, old));
    }
  }

  await fs.mkdir(path.join(ROOT, MANIFEST_DIR), { recursive: true });
  const manifest = {
    text: hash,
    duration,
    audio: MEDIA_URL_PREFIX + audioName,
    timings: MEDIA_URL_PREFIX + timingsName,
  };
  await fs.writeFile(
    manifestPath(ROOT, slug),
    JSON.stringify(manifest, null, 2) + "\n"
  );

  console.log(`Wrote ${manifest.audio} (${duration}s) and ${manifest.timings}`);
  console.log(`Manifest: ${path.join(MANIFEST_DIR, `${slug}.json`)}`);
  console.log(`Work files: ${work}`);
}

main().catch((err) => {
  console.error(err.stderr || err.message || err);
  process.exit(1);
});
