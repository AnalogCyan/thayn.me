// What Bridgy Publish posts: the blurb, the hashtags, and the hidden markup
// it reads them from. The build test runs the real build.js on a copy of the
// site with only the fixture posts below.

import assert from "node:assert/strict";
import { execFile } from "node:child_process";
import {
  cp,
  mkdir,
  mkdtemp,
  readFile,
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
  SOCIAL_BLURB_LIMIT,
  countGraphemes,
  normalizeHashtags,
  socialBlurbWarning,
  toSocialBlurb,
  toSocialFields,
} from "../lib/social-post.js";

const run = promisify(execFile);
const ROOT = path.resolve(import.meta.dirname, "..");

test("the blurb is social, then excerpt, then title", () => {
  const all = { social: " Social  text ", excerpt: "Excerpt", title: "Title" };
  assert.equal(toSocialBlurb(all), "Social text");
  assert.equal(toSocialBlurb({ ...all, social: "" }), "Excerpt");
  assert.equal(toSocialBlurb({ ...all, social: "  " }), "Excerpt");
  assert.equal(toSocialBlurb({ title: "Title", excerpt: null }), "Title");
  assert.equal(toSocialBlurb({}), "");
});

test("a title-only post does not repeat its title on Mastodon", () => {
  assert.equal(toSocialFields({ title: "Title" }).socialMastodonBlurb, "");
  assert.equal(
    toSocialFields({ title: "Title", excerpt: "Excerpt" }).socialMastodonBlurb,
    "Excerpt"
  );
});

test("hashtags lose a leading #, keep their case and drop duplicates", () => {
  assert.deepEqual(
    normalizeHashtags(["#InfoSec", "CyberSecurity", "infosec"]),
    ["InfoSec", "CyberSecurity"]
  );
  assert.deepEqual(normalizeHashtags("##One"), ["One"]);
  assert.deepEqual(normalizeHashtags(["Café_2026", ""]), ["Café_2026"]);
  assert.deepEqual(normalizeHashtags(undefined), []);
  assert.equal(
    toSocialFields({ title: "T", hashtags: ["a", "#b"] }).socialHashtags,
    "#a #b"
  );
});

test("a hashtag with a space or punctuation fails the build", () => {
  assert.throws(() => normalizeHashtags(["Info Sec"]), /Info Sec/);
  assert.throws(() => normalizeHashtags(["#"]), /not a single hashtag/);
  assert.throws(() => normalizeHashtags(["a-b"]), /a-b/);
});

test("a blurb over the limit warns, counting graphemes", () => {
  assert.equal(countGraphemes("🏳️‍⚧️ab"), 3);
  assert.equal(socialBlurbWarning("x".repeat(SOCIAL_BLURB_LIMIT)), null);
  assert.match(
    socialBlurbWarning("x".repeat(SOCIAL_BLURB_LIMIT + 1)),
    /281 graphemes, over 280/
  );
  assert.equal(socialBlurbWarning("🏳️‍⚧️".repeat(SOCIAL_BLURB_LIMIT)), null);
});

// Finds elements whose class list has the given class
function byClass(node, name, found = []) {
  const cls = node.attrs?.find((a) => a.name === "class")?.value.split(/\s+/);
  if (cls?.includes(name)) found.push(node);
  for (const child of node.childNodes || []) byClass(child, name, found);
  return found;
}
const attr = (node, name) => node.attrs.find((a) => a.name === name)?.value;
const text = (node) =>
  node.nodeName === "#text"
    ? node.value
    : (node.childNodes || []).map(text).join("");
const paragraphs = (node) =>
  node.childNodes.filter((c) => c.nodeName === "p").map((p) => text(p).trim());

async function build(posts) {
  const dir = await mkdtemp(path.join(tmpdir(), "social-post-test-"));
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
  const { stdout, stderr } = await run(process.execPath, ["build.js"], {
    cwd: dir,
    env: {
      ...process.env,
      BLOG_INCLUDE_DRAFTS: "",
      CONTEXT: "",
      OG_CARD_CACHE_DIR: path.join(dir, "og-cache"),
    },
  });
  const page = async (slug) =>
    parse(
      await readFile(path.join(dir, "public/blog", slug, "index.html"), "utf8")
    );
  return { dir, log: stdout + stderr, page };
}

test("the post page carries the hidden Bridgy markup", async (t) => {
  const long = "word ".repeat(70).trim();
  const s = await build({
    full: [
      "---",
      'title: "Full Post"',
      "date: 2026-11-01",
      'excerpt: "The excerpt."',
      'social: "The hand-written blurb."',
      'hashtags: ["#InfoSec", CyberSecurity]',
      "---",
      "",
      "Body.",
    ].join("\n"),
    bare: [
      "---",
      'title: "Bare Post"',
      "date: 2026-11-01",
      "---",
      "",
      "Body.",
    ].join("\n"),
    long: [
      "---",
      'title: "Long Post"',
      "date: 2026-11-01",
      `social: "${long}"`,
      "---",
      "",
      "Body.",
    ].join("\n"),
  });
  t.after(() => rm(s.dir, { recursive: true, force: true }));

  const full = await s.page("full");
  const [header] = byClass(full, "blog-post-header");
  const [summary] = byClass(header, "p-summary");
  assert.equal(summary.nodeName, "p");
  assert.equal(attr(summary, "hidden"), "");
  assert.equal(text(summary), "The hand-written blurb.");

  const [mastodon] = byClass(header, "e-bridgy-mastodon-content");
  assert.equal(attr(mastodon, "hidden"), "");
  const url = "https://thayn.me/blog/full/";
  assert.deepEqual(paragraphs(mastodon), [
    "Full Post",
    "The hand-written blurb.",
    url,
    "#InfoSec #CyberSecurity",
  ]);
  const [link] = mastodon.childNodes
    .filter((c) => c.nodeName === "p")[2]
    .childNodes.filter((c) => c.nodeName === "a");
  assert.equal(attr(link, "href"), url);

  const [omit] = byClass(header, "p-bridgy-omit-link");
  assert.equal(omit.nodeName, "data");
  assert.equal(attr(omit, "value"), "maybe");

  // The summary must not become the title the read-aloud and Bridgy read
  const [name] = byClass(header, "p-name");
  assert.equal(text(name).trim(), "Full Post");

  const bare = await s.page("bare");
  assert.equal(text(byClass(bare, "p-summary")[0]), "Bare Post");
  assert.deepEqual(paragraphs(byClass(bare, "e-bridgy-mastodon-content")[0]), [
    "Bare Post",
    "https://thayn.me/blog/bare/",
  ]);

  assert.match(s.log, /long: social blurb is 349 graphemes, over 280/);
  assert.doesNotMatch(s.log, /(full|bare): social blurb/);
});

function meta(doc, property, found = []) {
  if (doc.nodeName === "meta" && attr(doc, "property") === property) {
    found.push(attr(doc, "content"));
  }
  for (const child of doc.childNodes || []) meta(child, property, found);
  return found;
}

test("the card image has alt text and a size, and a post can replace it", async (t) => {
  const s = await build({
    plain: [
      "---",
      'title: "Plain"',
      "date: 2026-11-01",
      "---",
      "",
      "Body.",
    ].join("\n"),
    own: [
      "---",
      'title: "Own Image"',
      "date: 2026-11-01",
      "ogImage: /media/blog/own.png",
      'ogImageAlt: "A hand-drawn title card."',
      "---",
      "",
      "Body.",
    ].join("\n"),
  });
  t.after(() => rm(s.dir, { recursive: true, force: true }));

  // Without an image of its own, a post gets its generated card
  const plain = await s.page("plain");
  assert.match(
    meta(plain, "og:image")[0],
    /^https:\/\/thayn\.me\/media\/og\/plain\.[0-9a-f]{12}\.png$/
  );
  assert.deepEqual(meta(plain, "og:image:alt"), ["Plain: Body."]);
  assert.deepEqual(meta(plain, "og:image:width"), ["1200"]);
  assert.deepEqual(meta(plain, "og:image:height"), ["630"]);

  const own = await s.page("own");
  assert.deepEqual(meta(own, "og:image"), [
    "https://thayn.me/media/blog/own.png",
  ]);
  assert.deepEqual(meta(own, "og:image:alt"), ["A hand-drawn title card."]);
  // Its size is unknown, so none is claimed
  assert.deepEqual(meta(own, "og:image:width"), []);
  assert.deepEqual(meta(own, "og:image:height"), []);
});

test("a hashtag needs a letter and may carry combining marks", () => {
  assert.throws(() => normalizeHashtags(["2026"]), /not a single hashtag/);
  assert.deepEqual(normalizeHashtags(["Cafe\u0301", "हिन्दी", "web2026"]), [
    "Cafe\u0301",
    "हिन्दी",
    "web2026",
  ]);
});
