// The per-post social card: its text, its cache key, and the meta tags the
// build writes for it. The build test runs the real build.js on a copy of
// the site with only the fixture posts below.

import assert from "node:assert/strict";
import { execFile } from "node:child_process";
import {
  cp,
  mkdir,
  mkdtemp,
  readFile,
  readdir,
  rm,
  symlink,
  writeFile,
} from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import test from "node:test";
import { promisify } from "node:util";
import { parse } from "parse5";
import {
  cardAlt,
  cardFields,
  cardKey,
  cardText,
  formatCardDate,
} from "../lib/og-card.js";

const run = promisify(execFile);
const ROOT = path.resolve(import.meta.dirname, "..");

const FIELDS = cardFields({
  title: "Eternal October",
  excerpt: "Eternal September never ended.",
  dateIso: "2026-11-19T17:17:00Z",
  tags: ["Security", "AI"],
});

test("the card text has no em or en dashes", () => {
  assert.equal(cardText("Before — after"), "Before, after");
  assert.equal(cardText("2020–2026"), "2020-2026");
  assert.equal(cardText("Q3–Q4"), "Q3-Q4");
  assert.equal(cardText("2020 – present"), "2020, present");
  assert.equal(cardText("x ‒ y ― z"), "x, y, z");
  assert.equal(cardText("  spaced\n out "), "spaced out");
  assert.doesNotMatch(
    JSON.stringify(cardFields({ title: "A — B", tags: ["C – D"] })),
    /[‒-―]/
  );
});

test("the card date is short and in UTC, and blank without one", () => {
  assert.equal(formatCardDate("2026-11-19T23:30:00Z"), "Nov 19, 2026");
  assert.equal(formatCardDate(""), "");
  assert.equal(formatCardDate(null), "");
  assert.equal(formatCardDate("nonsense"), "");
});

test("tags that would overflow the pill row are left off whole", () => {
  const { tags } = cardFields({
    title: "T",
    tags: ["Web Development", "Security Research", "Artificial Intelligence"],
  });
  assert.deepEqual(tags, ["Web Development", "Security Research"]);
  assert.equal(
    cardFields({ title: "T", tags: ["a", "b", "c", "d"] }).tags.length,
    3
  );
});

test("the alt text is the title, then the excerpt", () => {
  assert.equal(
    cardAlt(FIELDS),
    "Eternal October: Eternal September never ended."
  );
  assert.equal(cardAlt({ ...FIELDS, excerpt: "" }), "Eternal October");
});

test("the cache key follows what the card shows and the renderer", () => {
  const key = cardKey(FIELDS, "r1");
  assert.match(key, /^[0-9a-f]{12}$/);
  assert.equal(cardKey(structuredClone(FIELDS), "r1"), key);
  for (const change of [
    { title: "Eternal November" },
    { excerpt: "Something else." },
    { date: "Nov 20, 2026" },
    { tags: ["Security"] },
    { tags: ["AI", "Security"] },
  ]) {
    assert.notEqual(cardKey({ ...FIELDS, ...change }, "r1"), key, change);
  }
  assert.notEqual(cardKey(FIELDS, "r2"), key);
});

const metas = (doc) => {
  const out = {};
  (function walk(node) {
    if (node.nodeName === "meta") {
      const a = Object.fromEntries(node.attrs.map((x) => [x.name, x.value]));
      const name = a.property || a.name;
      if (name) out[name] = a.content;
    }
    for (const child of node.childNodes || []) walk(child);
  })(doc);
  return out;
};

const pngSize = (bytes) => [bytes.readUInt32BE(16), bytes.readUInt32BE(20)];

async function site(posts) {
  const dir = await mkdtemp(path.join(tmpdir(), "og-card-test-"));
  for (const name of ["build.js", "package.json", "lib", "tools", "src"]) {
    await cp(path.join(ROOT, name), path.join(dir, name), { recursive: true });
  }
  await symlink(
    path.join(ROOT, "node_modules"),
    path.join(dir, "node_modules")
  );
  const postsDir = path.join(dir, "src/blog/posts");
  await rm(postsDir, { recursive: true, force: true });
  await mkdir(postsDir, { recursive: true });
  for (const [slug, markdown] of Object.entries(posts)) {
    await writeFile(path.join(postsDir, `${slug}.md`), markdown);
  }
  const cacheDir = path.join(dir, "og-cache");
  const build = async () => {
    const { stdout, stderr } = await run(process.execPath, ["build.js"], {
      cwd: dir,
      env: {
        ...process.env,
        BLOG_INCLUDE_DRAFTS: "",
        CONTEXT: "",
        OG_CARD_CACHE_DIR: cacheDir,
      },
    });
    return stdout + stderr;
  };
  const read = (rel) => readFile(path.join(dir, "public", rel));
  const meta = async (rel) => metas(parse(String(await read(rel))));
  return { dir, cacheDir, build, read, meta };
}

test("a post gets its own card, unless it names an image", async (t) => {
  const s = await site({
    carded: [
      "---",
      'title: "Carded Post"',
      "date: 2026-11-01",
      'excerpt: "What it is about."',
      'categories: ["Web Dev"]',
      "---",
      "",
      "Body.",
    ].join("\n"),
    custom: [
      "---",
      'title: "Custom Image"',
      "date: 2026-11-01",
      "ogImage: /media/blog/custom.png",
      'ogImageAlt: "A custom picture."',
      "---",
      "",
      "Body.",
    ].join("\n"),
    emoji: [
      "---",
      'title: "Shipping ✨"',
      "date: 2026-11-01",
      "---",
      "",
      "Body.",
    ].join("\n"),
  });
  t.after(() => rm(s.dir, { recursive: true, force: true }));

  const firstLog = await s.build();
  assert.match(firstLog, /Social cards: 1 drawn, 0 from cache/);

  const carded = await s.meta("blog/carded/index.html");
  const match = carded["og:image"].match(
    /^https:\/\/thayn\.me(\/media\/og\/carded\.[0-9a-f]{12}\.png)$/
  );
  assert.ok(match, carded["og:image"]);
  assert.equal(carded["twitter:image"], carded["og:image"]);
  assert.equal(carded["og:image:alt"], "Carded Post: What it is about.");
  assert.equal(carded["twitter:image:alt"], carded["og:image:alt"]);
  assert.equal(carded["og:image:width"], "1200");
  assert.equal(carded["og:image:height"], "630");
  assert.deepEqual(pngSize(await s.read(match[1])), [1200, 630]);

  // A post that names its own image keeps it, and gets no card
  const custom = await s.meta("blog/custom/index.html");
  assert.equal(custom["og:image"], "https://thayn.me/media/blog/custom.png");
  assert.equal(custom["twitter:image"], custom["og:image"]);
  assert.equal(custom["og:image:alt"], "A custom picture.");
  assert.equal(custom["og:image:width"], undefined);
  const cards = await readdir(path.join(s.dir, "public/media/og"));
  assert.deepEqual(cards, [path.basename(match[1])]);

  // A title the font cannot draw falls back to the site-wide image
  assert.match(firstLog, /emoji: no social card, using the default image/);
  const emoji = await s.meta("blog/emoji/index.html");
  assert.equal(emoji["og:image"], "https://thayn.me/media/og-image.png");
  assert.match(emoji["og:image:alt"], /Memoji/);

  // Pages that are not posts keep the site-wide image
  const about = await s.meta("about.html");
  assert.equal(about["og:image"], "https://thayn.me/media/og-image.png");

  // An unchanged post comes from the cache, under the same name
  const secondLog = await s.build();
  assert.match(secondLog, /Social cards: 0 drawn, 1 from cache/);
  const again = await s.meta("blog/carded/index.html");
  assert.equal(again["og:image"], carded["og:image"]);
  assert.deepEqual(await readdir(s.cacheDir), cards);
});
