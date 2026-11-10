// The post-deploy run end to end against a fake GitHub and a fake Bridgy:
// what it writes back, and when it must not post.

import assert from "node:assert/strict";
import fs from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import test, { beforeEach } from "node:test";
import fm from "front-matter";

const tmp = await fs.mkdtemp(path.join(os.tmpdir(), "syndication-"));
await fs.mkdir(path.join(tmp, "src/blog/posts"), { recursive: true });
process.chdir(tmp);
Object.assign(process.env, {
  CONTEXT: "production",
  GITHUB_TOKEN: "test",
  GITHUB_OWNER: "o",
  GITHUB_REPO: "r",
  GITHUB_BRANCH: "main",
  SYNDICATION_READY_TIMEOUT_MS: "20",
  SYNDICATION_READY_INTERVAL_MS: "5",
});
const { runSyndicationPostDeploy } =
  await import("../netlify/post-deploy/run-syndication.js");

const NOW = Date.now();
const hoursAgo = (h) => new Date(NOW - h * 3600 * 1000).toISOString();
const REPO = "https://api.github.com/repos/o/r/contents/";
const BRIDGY = "https://brid.gy/publish/webmention";
const PAGE_LINKS =
  '<a href="https://brid.gy/publish/mastodon"></a><a href="https://brid.gy/publish/bluesky"></a>';

let files;
let sha;
let bridgyCalls;
let hooks;

function setFile(name, content) {
  sha += 1;
  files.set(`src/blog/posts/${name}`, { content, sha: `sha${sha}` });
}

function read(name) {
  return fm(files.get(`src/blog/posts/${name}`).content);
}

// Cyan editing the post on GitHub while the run is going
function edit(name, change) {
  const { content } = files.get(`src/blog/posts/${name}`);
  setFile(name, change(content));
}

async function addPost(name, frontmatter, body = "Hello.\n") {
  const content = `---\n${frontmatter.trim()}\n---\n${body}`;
  setFile(name, content);
  await fs.writeFile(path.join(tmp, "src/blog/posts", name), content);
}

const json = (status, body) =>
  new Response(JSON.stringify(body), {
    status,
    headers: { "Content-Type": "application/json" },
  });

beforeEach(async () => {
  files = new Map();
  sha = 0;
  bridgyCalls = [];
  hooks = {
    get: () => {},
    put: () => {},
    bridgy: (target) =>
      json(201, {
        url: target.endsWith("bluesky")
          ? "https://bsky.app/profile/thayn.me/post/new"
          : "https://mastodon.social/@cyan/new",
      }),
    page: () => new Response(PAGE_LINKS, { status: 200 }),
  };
  for (const name of await fs.readdir(path.join(tmp, "src/blog/posts"))) {
    await fs.rm(path.join(tmp, "src/blog/posts", name));
  }
});

globalThis.fetch = async (input, options = {}) => {
  const url = String(input);
  const method = options.method || "GET";

  if (url === BRIDGY) {
    const params = new URLSearchParams(options.body);
    bridgyCalls.push({
      source: params.get("source"),
      target: params.get("target"),
    });
    return hooks.bridgy(params.get("target"));
  }

  if (url.startsWith("https://thayn.me/")) return hooks.page(url);

  if (!url.startsWith(REPO)) throw new Error(`unexpected fetch ${url}`);
  const filePath = decodeURIComponent(url.slice(REPO.length).split("?")[0]);

  if (method === "GET" && filePath === "src/blog/posts") {
    return json(
      200,
      [...files.keys()].map((p) => ({
        type: "file",
        name: p.split("/").pop(),
        path: p,
      }))
    );
  }

  if (method === "GET") {
    const file = files.get(filePath);
    if (!file) return json(404, {});
    const reply = json(200, {
      sha: file.sha,
      content: Buffer.from(file.content).toString("base64"),
    });
    hooks.get(filePath);
    return reply;
  }

  if (method === "PUT") {
    const payload = JSON.parse(options.body);
    hooks.put(filePath, payload);
    const file = files.get(filePath);
    if (!file || file.sha !== payload.sha) return json(409, {});
    setFile(
      filePath.split("/").pop(),
      Buffer.from(payload.content, "base64").toString("utf-8")
    );
    return json(200, { content: { sha: files.get(filePath).sha } });
  }

  throw new Error(`unexpected ${method} ${url}`);
};

test("an edit pushed during the run survives the write-back", async () => {
  await addPost(
    "a.md",
    `
title: "A"
date: "2026-11-01"
syndicate:
  - mastodon
`
  );
  // During the readiness wait, so before the publish lease reads the file
  hooks.page = () => {
    edit("a.md", (c) =>
      c
        .replace("Hello.", "Hello, edited.")
        .replace('title: "A"', 'title: "A, retitled"')
    );
    hooks.page = () => new Response(PAGE_LINKS, { status: 200 });
    return new Response(PAGE_LINKS, { status: 200 });
  };

  const report = await runSyndicationPostDeploy();

  assert.equal(bridgyCalls.length, 1);
  const post = read("a.md");
  assert.match(post.body, /Hello, edited\./);
  assert.equal(post.attributes.title, "A, retitled");
  assert.match(post.attributes.syndication.mastodon, /mastodon\.social/);
  assert.equal(post.attributes.syndicationStatus.mastodon, "confirmed");
  assert.equal(post.attributes.syndicate, undefined);
  assert.equal(post.attributes.syndicationComplete, true);
  assert.equal(report.updated.length, 1);
});

test("a URL added by hand before the confirm lease stops the confirm", async () => {
  await addPost(
    "b.md",
    `
title: "B"
date: "2026-11-01"
syndicate:
  - bluesky
syndicationStatus:
  bluesky: "requested"
syndicationRequestedAt:
  bluesky: "${hoursAgo(3)}"
syndicationCheckedAt:
  bluesky: "${hoursAgo(2)}"
`
  );
  let gets = 0;
  hooks.get = () => {
    gets += 1;
    // After the scan read, before the lease read
    if (gets === 1) {
      edit("b.md", (c) =>
        c.replace(
          'title: "B"',
          'title: "B"\nsyndication:\n  bluesky: "https://bsky.app/profile/thayn.me/post/manual"'
        )
      );
    }
  };

  await runSyndicationPostDeploy();

  assert.equal(bridgyCalls.length, 0);
  const post = read("b.md");
  assert.equal(
    post.attributes.syndication.bluesky,
    "https://bsky.app/profile/thayn.me/post/manual"
  );
  assert.equal(post.attributes.syndicationStatus.bluesky, "confirmed");
  assert.equal(post.attributes.syndicate, undefined);
});

test("two pending posts are both published in one run", async () => {
  for (const name of ["c.md", "d.md"]) {
    await addPost(
      name,
      `
title: "${name}"
date: "2026-11-01"
syndicate:
  - mastodon
`
    );
  }

  const report = await runSyndicationPostDeploy();

  assert.deepEqual(
    bridgyCalls.map((call) => call.source),
    ["https://thayn.me/blog/c/", "https://thayn.me/blog/d/"]
  );
  for (const name of ["c.md", "d.md"]) {
    assert.equal(
      read(name).attributes.syndication.mastodon,
      "https://mastodon.social/@cyan/new"
    );
  }
  assert.equal(report.updated.length, 2);
  assert.equal(report.errors.length, 0);
});

test("a 409 on the write-back re-reads, keeps the edit, and keeps a refusal", async () => {
  await addPost(
    "e.md",
    `
title: "E"
date: "2026-11-01"
syndicate:
  - bluesky
`
  );
  hooks.bridgy = () => json(400, { error: "no link" });
  let conflicted = false;
  hooks.put = (filePath, payload) => {
    if (!conflicted && payload.message.includes(" update ")) {
      conflicted = true;
      edit("e.md", (c) => c.replace("Hello.", "Hello again."));
    }
  };

  const report = await runSyndicationPostDeploy();

  assert.equal(conflicted, true);
  assert.equal(bridgyCalls.length, 1);
  const post = read("e.md");
  assert.match(post.body, /Hello again\./);
  assert.equal(post.attributes.syndicationStatus.bluesky, "failed");
  assert.equal(
    post.attributes.syndicationLastError.bluesky,
    "publish-status-400"
  );
  assert.deepEqual(post.attributes.syndicate, ["bluesky"]);
  assert.equal(report.errors.length, 0);
});

test("a confirm result is kept when the page is not ready to publish", async () => {
  await addPost(
    "f.md",
    `
title: "F"
date: "2026-11-01"
syndicate:
  - mastodon
  - bluesky
syndicationStatus:
  mastodon: "requested"
syndicationRequestedAt:
  mastodon: "${hoursAgo(3)}"
syndicationCheckedAt:
  mastodon: "${hoursAgo(2)}"
`
  );
  hooks.page = () => new Response("not yet", { status: 404 });

  const report = await runSyndicationPostDeploy();

  assert.deepEqual(
    bridgyCalls.map((call) => call.target),
    ["https://brid.gy/publish/mastodon"]
  );
  const post = read("f.md");
  assert.equal(post.attributes.syndicationStatus.mastodon, "confirmed");
  assert.equal(post.attributes.syndicationStatus.bluesky, undefined);
  assert.deepEqual(post.attributes.syndicate, ["bluesky"]);
  assert.equal(report.skipped[0].reason, "page-not-ready");
});
