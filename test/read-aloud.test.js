// Read-aloud: which posts get a player, and which recordings get published.
// The build tests run the real build.js on a copy of the site with only the
// fixture posts below.

import assert from "node:assert/strict";
import { execFile } from "node:child_process";
import {
  cp,
  mkdir,
  mkdtemp,
  readFile,
  rm,
  stat,
  symlink,
  writeFile,
} from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import test from "node:test";
import { promisify } from "node:util";
import {
  MEDIA_URL_PREFIX,
  hashedMediaName,
  narrationFromHtml,
  textHash,
} from "../lib/read-aloud.js";

const run = promisify(execFile);
const ROOT = path.resolve(import.meta.dirname, "..");

function page(title, content) {
  return `<!doctype html><html><body><article>
    <header class="blog-post-header"><h1 class="p-name"><a>${title}</a></h1>
      <p hidden><span class="p-author h-card"><span class="p-name">Cyan Thayn</span></span></p>
    </header>
    <div class="blog-post-content e-content">${content}</div>
  </article></body></html>`;
}

test("narration covers the title and body, minus what the player skips", () => {
  const { blocks, words } = narrationFromHtml(
    page(
      "A Title",
      `<p>One <a href="#">two</a> <em>three</em>.<sup>1</sup></p>
       <figure><img alt="no" /><figcaption>caption</figcaption></figure>
       <pre><code>code</code></pre>
       <p data-read-aloud-skip>skipped</p>
       <h2>Heading &amp; more</h2>
       <ul><li>Item, one</li><li>Item&nbsp;two — done</li></ul>
       <script>ignored()</script>
       <p hidden>hidden</p><p aria-hidden="true">decor</p>
       <noscript>noscript</noscript><template>template</template>
       <textarea>textarea</textarea>`
    )
  );
  assert.deepEqual(words, [
    "A",
    "Title",
    "One",
    "two",
    "three",
    "Heading",
    "more",
    "Item,",
    "one",
    "Item",
    "two",
    "done",
  ]);
  assert.deepEqual(
    blocks.map((b) => b.text),
    [
      "A Title",
      "One two three.",
      "Heading & more",
      "Item, one",
      "Item two — done",
    ]
  );
});

test("the text hash follows the words, not punctuation or spacing", () => {
  assert.equal(textHash(["Hello,", "World!"]), textHash(["hello", "world"]));
  assert.notEqual(textHash(["Hello", "world"]), textHash(["Hello", "word"]));
});

test("media names carry a hash of their content", () => {
  const a = hashedMediaName("post", Buffer.from("one"), "m4a");
  const b = hashedMediaName("post", Buffer.from("two"), "m4a");
  assert.match(a, /^post\.[0-9a-f]{12}\.m4a$/);
  assert.notEqual(a, b);
  assert.equal(a, hashedMediaName("post", Buffer.from("one"), "m4a"));
});

// A copy of the site whose blog holds only the given posts and recordings
async function site({ posts, recordings = {}, staticFiles = {}, env = {} }) {
  const dir = await mkdtemp(path.join(tmpdir(), "read-aloud-test-"));
  for (const name of ["build.js", "package.json", "lib", "tools", "src"]) {
    await cp(path.join(ROOT, name), path.join(dir, name), { recursive: true });
  }
  await symlink(
    path.join(ROOT, "node_modules"),
    path.join(dir, "node_modules")
  );
  for (const sub of [
    "src/blog/posts",
    "src/blog/read-aloud",
    "src/static/media/blog",
  ]) {
    await rm(path.join(dir, sub), { recursive: true, force: true });
    await mkdir(path.join(dir, sub), { recursive: true });
  }
  for (const [slug, markdown] of Object.entries(posts)) {
    await writeFile(path.join(dir, "src/blog/posts", `${slug}.md`), markdown);
  }
  const mediaDir = path.join(dir, "src/static", MEDIA_URL_PREFIX);
  await mkdir(mediaDir, { recursive: true });
  for (const [slug, rec] of Object.entries(recordings)) {
    const audio = hashedMediaName(slug, Buffer.from(`audio ${slug}`), "m4a");
    const timings = hashedMediaName(
      slug,
      Buffer.from(`timings ${slug}`),
      "json"
    );
    if (rec.audio !== false)
      await writeFile(path.join(mediaDir, audio), `audio ${slug}`);
    await writeFile(path.join(mediaDir, timings), `timings ${slug}`);
    await writeFile(
      path.join(dir, "src/blog/read-aloud", `${slug}.json`),
      JSON.stringify({
        text: textHash(rec.words),
        words: rec.words.length,
        duration: 75.4,
        audio: MEDIA_URL_PREFIX + audio,
        timings: MEDIA_URL_PREFIX + timings,
      })
    );
  }
  for (const [file, body] of Object.entries(staticFiles)) {
    await mkdir(path.dirname(path.join(dir, "src/static", file)), {
      recursive: true,
    });
    await writeFile(path.join(dir, "src/static", file), body);
  }
  let stdout, stderr, failed;
  try {
    ({ stdout, stderr } = await run(process.execPath, ["build.js"], {
      cwd: dir,
      env: {
        ...process.env,
        BLOG_INCLUDE_DRAFTS: "",
        CONTEXT: "",
        OG_CARD_CACHE_DIR: path.join(dir, "og-cache"),
        ...env,
      },
    }));
  } catch (err) {
    ({ stdout, stderr } = err);
    failed = true;
  }
  const read = (file) => readFile(path.join(dir, "public", file), "utf8");
  const exists = (file) =>
    stat(path.join(dir, "public", file)).then(
      () => true,
      () => false
    );
  return { dir, log: stdout + stderr, failed, read, exists };
}

function post(
  title,
  { readAloud = true, draft = false, body = "Hello there, reader." } = {}
) {
  return [
    "---",
    `title: "${title}"`,
    "date: 2026-11-01",
    ...(readAloud ? ["readAloud: true"] : []),
    ...(draft ? ["draft: true"] : []),
    "---",
    "",
    body,
    "",
  ].join("\n");
}

const WORDS = (title) => [...title.split(" "), "Hello", "there,", "reader."];

test("the build renders a player only for opted-in posts with a matching recording", async (t) => {
  const s = await site({
    posts: {
      "ra-on": post("Read Aloud On"),
      "ra-off": post("Read Aloud Off", { readAloud: false }),
      "ra-none": post("No Recording"),
      "ra-noaudio": post("No Audio"),
      "ra-stale": post("Stale Text", { body: "Hello there, edited reader." }),
    },
    recordings: {
      "ra-on": { words: WORDS("Read Aloud On") },
      "ra-off": { words: WORDS("Read Aloud Off") },
      "ra-noaudio": { words: WORDS("No Audio"), audio: false },
      "ra-stale": { words: WORDS("Stale Text") },
    },
  });
  t.after(() => rm(s.dir, { recursive: true, force: true }));

  const on = await s.read("blog/ra-on/index.html");
  const audio = on.match(/<audio[^>]*src="([^"]+)"/)?.[1];
  const timings = on.match(/data-timings="([^"]+)"/)?.[1];
  assert.match(audio, /^\/media\/blog\/read-aloud\/ra-on\.[0-9a-f]{12}\.m4a$/);
  assert.match(
    timings,
    /^\/media\/blog\/read-aloud\/ra-on\.[0-9a-f]{12}\.json$/
  );
  assert.match(on, /data-duration="75.4"/);
  assert.match(on, /data-role="duration"\s*>1:15</);
  assert.match(
    on,
    /<script type="module" src="\/blog\/scripts\/audio-sync\.js\?v=/
  );
  assert.ok(await s.exists(audio.slice(1)), "the recording is published");
  assert.ok(await s.exists(timings.slice(1)), "the timings are published");
  // What the narration tool reads from the built page is what was hashed
  assert.deepEqual(narrationFromHtml(on).words, WORDS("Read Aloud On"));

  for (const slug of ["ra-off", "ra-none", "ra-noaudio", "ra-stale"]) {
    const html = await s.read(`blog/${slug}/index.html`);
    assert.doesNotMatch(html, /read-aloud-player|audio-sync\.js/, slug);
  }
  assert.match(s.log, /Read-aloud left out of ra-none: no recording/);
  assert.match(s.log, /Read-aloud left out of ra-noaudio: missing/);
  assert.match(
    s.log,
    /Read-aloud left out of ra-stale: the post's text changed/
  );
  assert.doesNotMatch(s.log, /left out of ra-(on|off)\b/);

  // Only a rendered player's files ship
  for (const slug of ["ra-off", "ra-stale"]) {
    assert.ok(
      !(await s.exists(
        `media/blog/read-aloud/${hashedMediaName(slug, Buffer.from(`audio ${slug}`), "m4a")}`
      )),
      `${slug} audio is not published`
    );
  }

  // Feeds carry the post, never the player
  for (const feed of ["blog/rss.xml", "blog/atom.xml"]) {
    const xml = await s.read(feed);
    assert.match(xml, /Hello there, reader\./);
    assert.doesNotMatch(xml, /read-aloud|<audio|&lt;audio|\.m4a/, feed);
  }
});

test("a production build fails on a stale recording", async (t) => {
  const s = await site({
    posts: { "ra-stale": post("Stale Text", { body: "Edited." }) },
    recordings: { "ra-stale": { words: WORDS("Stale Text") } },
    env: { CONTEXT: "production" },
  });
  t.after(() => rm(s.dir, { recursive: true, force: true }));
  assert.ok(s.failed, "the build exits with an error");
  assert.match(s.log, /Read-aloud for ra-stale: the post's text changed/);
});

test("a draft's recording stays out of the build", async (t) => {
  const s = await site({
    posts: { "ra-draft": post("Draft Post", { draft: true }) },
    recordings: { "ra-draft": { words: WORDS("Draft Post") } },
  });
  t.after(() => rm(s.dir, { recursive: true, force: true }));

  assert.ok(!(await s.exists("blog/ra-draft/index.html")));
  const draftAudio = hashedMediaName(
    "ra-draft",
    Buffer.from("audio ra-draft"),
    "m4a"
  );
  assert.ok(
    !(await s.exists(`media/blog/read-aloud/${draftAudio}`)),
    "draft narration dropped"
  );
});
