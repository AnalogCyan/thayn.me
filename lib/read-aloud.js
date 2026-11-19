// Read-aloud narration on the build side: the words a post's player
// highlights, a hash of them, and the per-post manifest that pairs a
// recording with the text it was made from.

import crypto from "node:crypto";
import fs from "node:fs/promises";
import path from "node:path";
import { parse } from "parse5";
import {
  SKIP,
  TITLE_SELECTOR,
  CONTENT_SELECTOR,
  normalize,
  splitWords,
} from "../src/blog/scripts/audio-sync.js";

export const MANIFEST_DIR = "src/blog/read-aloud";
export const MEDIA_URL_PREFIX = "/media/blog/read-aloud/";
const STATIC_DIR = "src/static";

// Elements that start a new stretch of speech, so the narration pauses
// between them the way a reader would
const BLOCK_TAGS = new Set(
  (
    "address article aside blockquote caption dd details div dl dt " +
    "figcaption footer h1 h2 h3 h4 h5 h6 header hr li main nav ol p " +
    "section summary table td th tr ul"
  ).split(" ")
);

function compileSimple(selector) {
  const s = selector.trim();
  let m;
  if ((m = /^\.([\w-]+)$/.exec(s))) return { cls: m[1] };
  if ((m = /^\[([\w-]+)\]$/.exec(s))) return { attr: m[1] };
  if ((m = /^([a-z][a-z0-9]*)$/.exec(s))) return { tag: m[1] };
  throw new Error(`read-aloud: unsupported selector "${selector}"`);
}

const SKIP_MATCHERS = SKIP.split(",").map(compileSimple);

function isElement(node) {
  return Boolean(node && node.tagName);
}

function attr(el, name) {
  return el.attrs.find((a) => a.name === name)?.value;
}

function matchesSimple(el, m) {
  if (m.tag) return el.tagName === m.tag;
  if (m.attr) return attr(el, m.attr) !== undefined;
  return (attr(el, "class") || "").split(/\s+/).includes(m.cls);
}

// Element.closest(SKIP): the element itself or any ancestor
function skipped(el) {
  for (let node = el; isElement(node); node = node.parentNode) {
    if (SKIP_MATCHERS.some((m) => matchesSimple(node, m))) return true;
  }
  return false;
}

// querySelector for descendant chains of simple selectors, such as
// ".blog-post-header .p-name"
function querySelector(root, selector) {
  const chain = selector.trim().split(/\s+/).map(compileSimple);
  const last = chain[chain.length - 1];
  const fits = (el) => {
    if (!matchesSimple(el, last)) return false;
    let i = chain.length - 2;
    for (let node = el.parentNode; i >= 0 && isElement(node);) {
      if (matchesSimple(node, chain[i])) i -= 1;
      node = node.parentNode;
    }
    return i < 0;
  };
  const stack = [root];
  while (stack.length) {
    const node = stack.pop();
    if (isElement(node) && fits(node)) return node;
    const children = node.content?.childNodes || node.childNodes || [];
    for (let i = children.length - 1; i >= 0; i -= 1) stack.push(children[i]);
  }
  return null;
}

function blockOf(node, root) {
  for (let el = node.parentNode; isElement(el); el = el.parentNode) {
    if (el === root || BLOCK_TAGS.has(el.tagName)) return el;
  }
  return root;
}

function collect(root, blocks) {
  let current = null;
  const visit = (node) => {
    if (node.nodeName === "#text") {
      if (skipped(node.parentNode)) return;
      const block = blockOf(node, root);
      if (!current || current.el !== block) {
        current = { el: block, text: "", words: [] };
        blocks.push(current);
      }
      current.text += node.value;
      // Same acceptance as the browser's TreeWalker: a text node with no
      // word characters adds spacing for the voice but no words
      if (!normalize(node.value)) return;
      for (const part of splitWords(node.value)) {
        if (part && normalize(part)) current.words.push(part);
      }
      return;
    }
    if (!isElement(node)) return;
    if (node.tagName === "br") {
      if (current) current.text += " ";
      return;
    }
    if (BLOCK_TAGS.has(node.tagName)) current = null;
    for (const child of node.childNodes) visit(child);
    if (BLOCK_TAGS.has(node.tagName)) current = null;
  };
  visit(root);
}

// The narration of a built post page: blocks of speakable text, and the
// flat word list the karaoke line steps through, in page order
export function narrationFromHtml(html) {
  const doc = parse(String(html));
  const blocks = [];
  const title = querySelector(doc, TITLE_SELECTOR);
  const content = querySelector(doc, CONTENT_SELECTOR);
  if (title) collect(title, blocks);
  if (content) collect(content, blocks);
  const spoken = blocks
    .map((b) => ({ text: b.text.replace(/\s+/g, " ").trim(), words: b.words }))
    .filter((b) => b.words.length);
  const words = spoken.flatMap((b) => b.words);
  return { blocks: spoken, words, hash: textHash(words) };
}

// Punctuation and spacing don't change the hash: only the words themselves,
// as the karaoke line compares them
export function textHash(words) {
  const hash = crypto.createHash("sha256");
  hash.update(words.map(normalize).filter(Boolean).join(" "));
  return `sha256-${hash.digest("hex")}`;
}

// A new recording gets new URLs, so a cached old file never pairs with new
// timings or the other way round
export function hashedMediaName(slug, bytes, ext) {
  const hash = crypto.createHash("sha256").update(bytes).digest("hex");
  return `${slug}.${hash.slice(0, 12)}.${ext}`;
}

export function manifestPath(root, slug) {
  return path.join(root, MANIFEST_DIR, `${slug}.json`);
}

function mediaFile(root, url) {
  if (typeof url !== "string" || !url.startsWith(MEDIA_URL_PREFIX)) {
    return null;
  }
  const name = url.slice(MEDIA_URL_PREFIX.length);
  if (!/^[\w.-]+$/.test(name)) return null;
  return path.join(root, STATIC_DIR, url);
}

async function exists(file) {
  try {
    return (await fs.stat(file)).isFile();
  } catch {
    return false;
  }
}

// Decides whether a post that opted in gets a player. Returns the player's
// data, or a reason it was left out
export async function resolveReadAloud({ root, slug, html }) {
  let manifest;
  try {
    manifest = JSON.parse(await fs.readFile(manifestPath(root, slug), "utf8"));
  } catch (err) {
    return {
      player: null,
      reason:
        err.code === "ENOENT"
          ? `no recording (${path.join(MANIFEST_DIR, `${slug}.json`)})`
          : `unreadable manifest: ${err.message}`,
    };
  }

  for (const key of ["audio", "timings"]) {
    const file = mediaFile(root, manifest[key]);
    if (!file) {
      return { player: null, reason: `manifest ${key} URL is not usable` };
    }
    if (!(await exists(file))) {
      return { player: null, reason: `missing ${manifest[key]}` };
    }
  }

  const { hash } = narrationFromHtml(html);
  if (manifest.text !== hash) {
    return {
      player: null,
      stale: true,
      reason:
        "the post's text changed since it was recorded; " +
        "run tools/read-aloud/narrate.js again",
    };
  }

  const duration = Number(manifest.duration);
  return {
    player: {
      audio: manifest.audio,
      timings: manifest.timings,
      duration: Number.isFinite(duration) && duration > 0 ? duration : 0,
      durationText: formatDuration(duration),
    },
    reason: null,
  };
}

// Same format as the player's own clock
export function formatDuration(seconds) {
  const total = Math.max(0, Math.floor(Number(seconds) || 0));
  return Math.floor(total / 60) + ":" + String(total % 60).padStart(2, "0");
}

// Leaves only the recordings a rendered player points at: drafts, posts that
// opted out, stale recordings and superseded versions stay unpublished
export async function pruneReadAloudMedia(publicDir, keepUrls) {
  const dir = path.join(publicDir, MEDIA_URL_PREFIX);
  let names;
  try {
    names = await fs.readdir(dir);
  } catch {
    return [];
  }
  const removed = [];
  for (const name of names) {
    if (keepUrls.has(MEDIA_URL_PREFIX + name)) continue;
    await fs.rm(path.join(dir, name), { force: true, recursive: true });
    removed.push(MEDIA_URL_PREFIX + name);
  }
  return removed;
}
