// Assembles the static site and blog from modular capsules into public/

import crypto from "crypto";
import fs from "fs/promises";
import path from "path";
import { execFile } from "child_process";
import { promisify } from "util";
import { fileURLToPath } from "url";
import fm from "front-matter";
import { marked } from "marked";
import Handlebars from "handlebars";
import { createEngine } from "gachakit";
import { getSiteUrl, getCanonicalBlogPath } from "./lib/site-url.js";
import { canonicalizeUrl, toAbsoluteUrl } from "./lib/url.js";
import {
  BRIDGY_PUBLISH_TARGETS,
  normalizeSyndicateTargets,
  normalizeSyndicationMap,
} from "./lib/bridgy-syndication.js";

const __dirname = path.dirname(fileURLToPath(import.meta.url));

const SRC_DIR = path.join(__dirname, "src");
const PUBLIC_DIR = path.join(__dirname, "public");

const engine = createEngine({ root: __dirname });

const BLOG_DIR = path.join(SRC_DIR, "blog");
const BLOG_POSTS_DIR = path.join(BLOG_DIR, "posts");
const BLOG_TEMPLATES_DIR = path.join(BLOG_DIR, "templates");
const BLOG_OUTPUT_DIR = path.join(PUBLIC_DIR, "blog");
const BLOG_STYLES_FILE = path.join(BLOG_DIR, "styles.css");
const BLOG_SCRIPTS_DIR = path.join(BLOG_DIR, "scripts");
const DEFAULT_POST_READ_CONCURRENCY = 4;
const POST_READ_CONCURRENCY = (() => {
  const raw = Number.parseInt(process.env.POST_READ_CONCURRENCY || "", 10);
  return Number.isFinite(raw) && raw > 0 ? raw : DEFAULT_POST_READ_CONCURRENCY;
})();

const DATE_ONLY_RE = /^\d{4}-\d{2}-\d{2}$/;
const DEFAULT_EMPTY_FEED_UPDATED_ISO = "1970-01-01T00:00:00Z";

function parsePostDate(value, source = "blog post") {
  let raw;
  if (value instanceof Date) {
    if (Number.isNaN(value.getTime())) {
      throw new Error(
        `Invalid blog post date "${value}" in ${source}. Use YYYY-MM-DD or ISO 8601.`
      );
    }
    const iso = value.toISOString();
    raw = iso.endsWith("T00:00:00.000Z") ? iso.slice(0, 10) : iso;
  } else {
    raw = String(value || "").trim();
  }
  if (!raw) {
    throw new Error(
      `Missing required blog post date in ${source}. Use YYYY-MM-DD or ISO 8601.`
    );
  }

  const parsed = DATE_ONLY_RE.test(raw)
    ? new Date(`${raw}T00:00:00Z`)
    : new Date(raw);

  if (Number.isNaN(parsed.getTime())) {
    throw new Error(
      `Invalid blog post date "${raw}" in ${source}. Use YYYY-MM-DD or ISO 8601.`
    );
  }

  return { raw, parsed };
}

function resolveEmptyFeedUpdatedDate() {
  const configured = String(
    process.env.BLOG_EMPTY_FEED_UPDATED || DEFAULT_EMPTY_FEED_UPDATED_ISO
  ).trim();

  try {
    const { parsed } = parsePostDate(configured, "BLOG_EMPTY_FEED_UPDATED");
    return parsed;
  } catch (err) {
    const { parsed } = parsePostDate(
      DEFAULT_EMPTY_FEED_UPDATED_ISO,
      "default empty feed date"
    );
    console.warn(
      `${err?.message || "Invalid BLOG_EMPTY_FEED_UPDATED value."} Falling back to ${DEFAULT_EMPTY_FEED_UPDATED_ISO}.`
    );
    return parsed;
  }
}

const EMPTY_FEED_UPDATED_DATE = resolveEmptyFeedUpdatedDate();

function toPublishedIso(rawDate, parsedDate) {
  if (DATE_ONLY_RE.test(rawDate)) {
    return `${rawDate}T00:00:00Z`;
  }
  return parsedDate.toISOString();
}

const execFileAsync = promisify(execFile);

async function getGitLastCommitIso(filePath) {
  try {
    const { stdout } = await execFileAsync(
      "git",
      [
        "log",
        "-1",
        "--format=%cI",
        "--invert-grep",
        "--grep=^Syndication:",
        "--",
        filePath,
      ],
      { cwd: __dirname }
    );
    return stdout.trim() || null;
  } catch {
    return null;
  }
}

function stripTags(str) {
  let out = str;
  let prev;
  do {
    prev = out;
    out = out.replace(/<[^>]*>/g, "");
  } while (out !== prev);
  return out;
}

const markedRenderer = new marked.Renderer();
// Reset per post, so ids stay stable and unique within a page
let headingSlugs = new Map();

markedRenderer.heading = function (tok) {
  const text = tok.text || "";
  const level = tok.depth || 1;
  const base = stripTags(text.toLowerCase())
    .replace(/[^\p{L}\p{N}\s-]/gu, "")
    .replace(/\s+/g, "-")
    .replace(/-+/g, "-")
    .replace(/^-+|-+$/g, "");
  const seen = headingSlugs.get(base) || 0;
  headingSlugs.set(base, seen + 1);
  const id = seen === 0 ? base : `${base}-${seen + 1}`;
  const inner = this.parser ? this.parser.parseInline(tok.tokens) : text;
  return `<h${level} id="${id}">${inner}</h${level}>`;
};

function renderMarkdown(body) {
  headingSlugs = new Map();
  return marked(body);
}

marked.setOptions({
  gfm: true,
  breaks: false,
  renderer: markedRenderer,
});

Handlebars.registerHelper("formatDate", function (date) {
  const options = {
    year: "numeric",
    month: "long",
    day: "numeric",
    timeZone: "UTC",
  };
  const { parsed } = parsePostDate(date, "template date");
  return parsed.toLocaleDateString("en-US", options);
});

Handlebars.registerHelper("formatDateTime", function (date) {
  if (!date) return "";
  const parsed = new Date(date);
  if (Number.isNaN(parsed.getTime())) return "";
  return parsed.toLocaleString("en-US", {
    year: "numeric",
    month: "short",
    day: "numeric",
    hour: "2-digit",
    minute: "2-digit",
    timeZone: "UTC",
  });
});

async function pathExists(p) {
  try {
    await fs.access(p);
    return true;
  } catch {
    return false;
  }
}

async function mapWithConcurrency(items, limit, mapper) {
  if (items.length === 0) return [];

  const results = new Array(items.length);
  let nextIndex = 0;
  const workerCount = Math.max(1, Math.min(limit, items.length));

  async function worker() {
    while (true) {
      const current = nextIndex;
      if (current >= items.length) return;
      nextIndex += 1;
      results[current] = await mapper(items[current], current);
    }
  }

  await Promise.all(Array.from({ length: workerCount }, () => worker()));
  return results;
}

async function cleanPublic() {
  if (await pathExists(PUBLIC_DIR)) {
    await fs.rm(PUBLIC_DIR, { recursive: true, force: true });
  }
  await fs.mkdir(PUBLIC_DIR, { recursive: true });
}

async function copyDir(src, dest) {
  if (!(await pathExists(src))) return;
  await fs.mkdir(dest, { recursive: true });
  const entries = await fs.readdir(src, { withFileTypes: true });
  for (const entry of entries) {
    if (entry.name === ".DS_Store") continue;
    const srcPath = path.join(src, entry.name);
    const destPath = path.join(dest, entry.name);
    if (entry.isDirectory()) {
      await copyDir(srcPath, destPath);
    } else {
      await fs.copyFile(srcPath, destPath);
    }
  }
}

function injectResources(content, resourcesHTML, config) {
  const placeholder = "<!-- EXTERNAL_RESOURCES -->";
  let output = content.includes(placeholder)
    ? content.replace(placeholder, resourcesHTML)
    : content.replace(/<\/head>/i, `${resourcesHTML}\n  </head>`);

  if (config.meta && config.meta.title) {
    const hasTitle = /<title>[\s\S]*?<\/title>/i.test(output);
    if (!hasTitle) {
      output = output.replace(
        /<\/head>/i,
        `    <title>${config.meta.title}</title>\n  </head>`
      );
    }
  }

  return output;
}

function ensureSiteBundleScript(html) {
  if (/<script\s+[^>]*src=["'][^"']*scripts\.js["']/i.test(html)) {
    return html;
  }
  return html.replace(
    /<\/body>/i,
    `    <script src="/scripts.js" defer></script>\n  </body>`
  );
}

async function copyStatic() {
  await engine.copyStaticFiles();

  const sanitizeUrlSrc = path.join(__dirname, "lib", "sanitize-url.js");
  if (await pathExists(sanitizeUrlSrc)) {
    const libOutDir = path.join(PUBLIC_DIR, "lib");
    await fs.mkdir(libOutDir, { recursive: true });
    await fs.copyFile(sanitizeUrlSrc, path.join(libOutDir, "sanitize-url.js"));
  }
}

function xmlEscape(s = "") {
  return String(s)
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;")
    .replace(/'/g, "&apos;");
}

function cdataEscape(s = "") {
  return String(s).replace(/]]>/g, "]]]]><![CDATA[>");
}

function rfc2822(dateStr, source = "feed date") {
  const { parsed } = parsePostDate(dateStr, source);
  return parsed.toUTCString();
}

function iso8601(dateStr, source = "feed date") {
  const { parsed } = parsePostDate(dateStr, source);
  return parsed.toISOString();
}

function normalizeTags(value) {
  if (Array.isArray(value)) {
    return value.map((item) => String(item).trim()).filter(Boolean);
  }
  if (value == null) return [];
  const single = String(value).trim();
  return single ? [single] : [];
}

function normalizeFilterValue(value) {
  return String(value || "")
    .trim()
    .toLowerCase()
    .replace(/\s+/g, " ");
}

function buildFilterOptions(values) {
  const byValue = new Map();
  for (const raw of values) {
    const label = String(raw || "").trim();
    if (!label) continue;
    const value = normalizeFilterValue(label);
    if (!value || byValue.has(value)) continue;
    byValue.set(value, label);
  }
  return Array.from(byValue.entries())
    .sort((a, b) => a[1].localeCompare(b[1]))
    .map(([value, label]) => ({ value, label }));
}

function stripMarkdown(markdown = "") {
  return stripTags(
    String(markdown)
      .replace(/```[\s\S]*?```/g, "")
      .replace(/`[^`]*`/g, "")
  )
    .replace(/!\[[^\]]*\]\([^)]+\)/g, "")
    .replace(/\[[^\]]+\]\([^)]+\)/g, "")
    .replace(/^[#>\s]*[-*+]?\s+/gm, " ")
    .replace(/(\*\*|__|~~|\*)/g, "")
    .replace(/(^|\s)_([^_]+)_(?=[\s.,;:!?)]|$)/g, "$1$2")
    .replace(/\s+/g, " ")
    .trim();
}

// Cuts at the last space before the limit, so an excerpt never ends mid-word
function truncateOnWord(text, limit) {
  if (text.length <= limit) return text;
  const cut = text.slice(0, limit);
  const lastSpace = cut.lastIndexOf(" ");
  return (lastSpace > limit * 0.6 ? cut.slice(0, lastSpace) : cut).trim();
}

function toExcerpt(rawExcerpt, markdownBody) {
  const plainBody = stripMarkdown(markdownBody);
  const candidate =
    String(rawExcerpt || "").trim() || truncateOnWord(plainBody, 180);
  if (!candidate) return "";
  return /[.!?…]$/.test(candidate) ? candidate : `${candidate}…`;
}

// Serializes JSON-LD for a <script> block. "<" is escaped so a title
// containing </script> cannot close it early.
function toJsonLdScript(data) {
  return JSON.stringify(data, null, 2).replace(/</g, "\\u003c");
}

// Feed readers resolve links against their own origin, so root-relative
// hrefs and image sources have to be absolute before they leave the site
function absolutizeHtml(html, siteUrl) {
  return String(html).replace(
    /\b(href|src)=("|')(\/[^"']*)\2/g,
    (match, attr, quote, value) =>
      `${attr}=${quote}${toAbsoluteUrl(siteUrl, value)}${quote}`
  );
}

function buildRSS(posts, meta, siteUrl) {
  const channelUrl = toAbsoluteUrl(siteUrl, "/blog/");
  const selfUrl = toAbsoluteUrl(siteUrl, "/blog/rss.xml");
  const lastBuild = new Date().toUTCString();
  const items = posts
    .map((p) => {
      const link = p.canonicalUrl || toAbsoluteUrl(siteUrl, p.url);
      const cats = (p.tags || [])
        .map((c) => `    <category>${xmlEscape(c)}</category>`)
        .join("\n");
      return [
        "  <item>",
        `    <title>${xmlEscape(p.title)}</title>`,
        `    <link>${xmlEscape(link)}</link>`,
        `    <guid isPermaLink="true">${xmlEscape(link)}</guid>`,
        `    <pubDate>${rfc2822(p.date, `post "${p.title || p.url || "unknown"}"`)}</pubDate>`,
        cats,
        `    <description>${xmlEscape(p.excerpt || "")}</description>`,
        `    <content:encoded><![CDATA[${cdataEscape(p.content || "")}]]></content:encoded>`,
        "  </item>",
      ]
        .filter(Boolean)
        .join("\n");
    })
    .join("\n");

  return `<?xml version="1.0" encoding="UTF-8"?>
<rss version="2.0" xmlns:content="http://purl.org/rss/1.0/modules/content/" xmlns:atom="http://www.w3.org/2005/Atom">
<channel>
  <title>${xmlEscape(meta.title)}</title>
  <link>${xmlEscape(channelUrl)}</link>
  <atom:link href="${xmlEscape(selfUrl)}" rel="self" type="application/rss+xml" />
  <description>${xmlEscape(meta.description)}</description>
  <language>${xmlEscape(meta.language)}</language>
  <lastBuildDate>${lastBuild}</lastBuildDate>
${items}
</channel>
</rss>
`;
}

function buildAtom(posts, meta, siteUrl) {
  const channelUrl = toAbsoluteUrl(siteUrl, "/blog/");
  const selfUrl = toAbsoluteUrl(siteUrl, "/blog/atom.xml");
  const entryUpdated = (p) =>
    p.updatedIso || iso8601(p.date, `post "${p.title || p.url || "unknown"}"`);
  // The feed changed when any entry last did, not only the newest post
  const updated =
    posts.length > 0
      ? posts
          .map(entryUpdated)
          .reduce((a, b) => (Date.parse(b) > Date.parse(a) ? b : a))
      : EMPTY_FEED_UPDATED_DATE.toISOString();
  const entries = posts
    .map((p) => {
      const link = p.canonicalUrl || toAbsoluteUrl(siteUrl, p.url);
      const cats = (p.tags || [])
        .map((c) => `    <category term="${xmlEscape(c)}"/>`)
        .join("\n");
      return [
        "  <entry>",
        `    <title>${xmlEscape(p.title)}</title>`,
        `    <id>${xmlEscape(link)}</id>`,
        `    <link href="${xmlEscape(link)}"/>`,
        `    <updated>${entryUpdated(p)}</updated>`,
        `    <published>${iso8601(p.date, `post "${p.title || p.url || "unknown"}"`)}</published>`,
        `    <author><name>${xmlEscape(p.author || meta.author)}</name></author>`,
        cats,
        `    <summary type="html">${xmlEscape(p.excerpt || "")}</summary>`,
        `    <content type="html">${xmlEscape(p.content || "")}</content>`,
        "  </entry>",
      ]
        .filter(Boolean)
        .join("\n");
    })
    .join("\n");

  return `<?xml version="1.0" encoding="UTF-8"?>
<feed xmlns="http://www.w3.org/2005/Atom">
  <title>${xmlEscape(meta.title)}</title>
  <id>${xmlEscape(channelUrl)}</id>
  <updated>${updated}</updated>
  <link href="${xmlEscape(selfUrl)}" rel="self"/>
  <link href="${xmlEscape(channelUrl)}"/>
  <author><name>${xmlEscape(meta.author)}</name></author>
${entries}
</feed>
`;
}

// The blog's own stylesheet and scripts live outside the engine's bundles,
// so they need the same query string to avoid being served stale
function bustBlogAssets(html, hash) {
  if (!hash) return html;
  return html.replace(
    /(href|src)=("|')(\/blog\/(?:styles\.css|scripts\/[\w.-]+\.js))\2/gi,
    (match, attr, quote, value) => `${attr}=${quote}${value}?v=${hash}${quote}`
  );
}

// Everything under src/blog feeds the blog output, so it belongs in the hash
async function hashBlogSources() {
  const hash = crypto.createHash("sha1");
  const entries = (await pathExists(BLOG_DIR))
    ? await fs.readdir(BLOG_DIR, { withFileTypes: true, recursive: true })
    : [];

  const files = entries
    .filter((entry) => entry.isFile() && /\.(css|js|html|md)$/.test(entry.name))
    .map((entry) => path.join(entry.parentPath, entry.name))
    .sort();

  for (const file of files) {
    hash.update(path.relative(SRC_DIR, file));
    hash.update(await fs.readFile(file));
  }
  return hash.digest("hex").slice(0, 8);
}

async function buildBlog(capsules, config, globalUsed, siteUrl) {
  if (!(await pathExists(BLOG_TEMPLATES_DIR))) return;

  await fs.mkdir(BLOG_OUTPUT_DIR, { recursive: true });

  if (await pathExists(BLOG_STYLES_FILE)) {
    await fs.copyFile(
      BLOG_STYLES_FILE,
      path.join(BLOG_OUTPUT_DIR, "styles.css")
    );
  }

  if (await pathExists(BLOG_SCRIPTS_DIR)) {
    await copyDir(BLOG_SCRIPTS_DIR, path.join(BLOG_OUTPUT_DIR, "scripts"));
  }

  const indexTemplatePath = path.join(
    BLOG_TEMPLATES_DIR,
    "index-template.html"
  );
  const postTemplatePath = path.join(BLOG_TEMPLATES_DIR, "post-template.html");

  const indexTemplateRaw = await fs.readFile(indexTemplatePath, "utf-8");
  const postTemplateRaw = await fs.readFile(postTemplatePath, "utf-8");

  const resourcesHTML = engine.generateResourcesHTML(config);
  const indexWithResources = engine.injectIndieWebTags(
    injectResources(indexTemplateRaw, resourcesHTML, config),
    config,
    "blog/index.html"
  );
  const postWithResources = engine.injectIndieWebTags(
    injectResources(postTemplateRaw, resourcesHTML, config),
    config,
    "blog/post.html"
  );

  const indexTemplateSourceRaw = await engine.expandAllDrops(
    indexWithResources,
    capsules,
    "blog-index",
    globalUsed
  );
  const postTemplateSourceRaw = await engine.expandAllDrops(
    postWithResources,
    capsules,
    "blog-post",
    globalUsed
  );
  const indexTemplateSource = bustBlogAssets(
    engine.bustAssetPaths(
      ensureSiteBundleScript(indexTemplateSourceRaw),
      config.buildHash,
      config.scripts?.standalone
    ),
    config.buildHash
  );
  const postTemplateSource = bustBlogAssets(
    engine.bustAssetPaths(
      ensureSiteBundleScript(postTemplateSourceRaw),
      config.buildHash,
      config.scripts?.standalone
    ),
    config.buildHash
  );

  const indexTemplate = Handlebars.compile(indexTemplateSource);
  const postTemplate = Handlebars.compile(postTemplateSource);

  let blogIndex = [];
  if (await pathExists(BLOG_POSTS_DIR)) {
    const files = (await fs.readdir(BLOG_POSTS_DIR))
      .filter((file) => file.endsWith(".md"))
      .sort();

    const postEntries = await mapWithConcurrency(
      files,
      POST_READ_CONCURRENCY,
      async (file) => {
        const filePath = path.join(BLOG_POSTS_DIR, file);
        const markdown = await fs.readFile(filePath, "utf-8");
        const { attributes, body } = fm(markdown);

        if (!attributes.title) {
          attributes.title = path.basename(file, ".md");
        }

        if (attributes.draft && process.env.BLOG_INCLUDE_DRAFTS !== "1") {
          return null;
        }
        const { raw: normalizedDate, parsed: parsedDate } = parsePostDate(
          attributes.date,
          `frontmatter in ${filePath}`
        );
        attributes.date = normalizedDate;

        let updatedIso;
        if (attributes.updated) {
          const { raw: rawUpdated, parsed: parsedUpdated } = parsePostDate(
            attributes.updated,
            `frontmatter in ${filePath}`
          );
          updatedIso = toPublishedIso(rawUpdated, parsedUpdated);
        } else {
          updatedIso = await getGitLastCommitIso(filePath);
        }

        const postTags = normalizeTags(
          attributes.categories?.length
            ? attributes.categories
            : attributes.tags
        );

        const slug = path.basename(file, ".md");
        const defaultPath = getCanonicalBlogPath(slug);
        const defaultCanonical = canonicalizeUrl(siteUrl, defaultPath);
        const canonicalOverride = canonicalizeUrl(
          siteUrl,
          attributes.canonical
        );
        const canonicalUrl = canonicalOverride || defaultCanonical;

        const url = defaultPath;
        const syndicationMap = normalizeSyndicationMap(attributes.syndication);
        const syndicateTargets = normalizeSyndicateTargets(
          attributes.syndicate
        );
        const pendingTargets = syndicateTargets.filter(
          (target) => !syndicationMap[target]
        );
        const bridgyPublishTargets = pendingTargets.map(
          (target) => BRIDGY_PUBLISH_TARGETS[target]
        );

        return {
          slug,
          data: {
            title: attributes.title,
            author: attributes.author || "Cyan Thayn",
            date: normalizedDate,
            dateIso: toPublishedIso(normalizedDate, parsedDate),
            dateMs: parsedDate.getTime(),
            updatedIso,
            tags: postTags,
            tagFilterKey: postTags.map(normalizeFilterValue).join("|"),
            content: absolutizeHtml(renderMarkdown(body), siteUrl),
            excerpt: toExcerpt(attributes.excerpt, body),
            url,
            siteUrl,
            canonicalUrl,
            ogImage: attributes.image
              ? toAbsoluteUrl(siteUrl, attributes.image)
              : `${siteUrl}/media/og-image.png`,
            blueskyDiscussionUrl:
              syndicationMap["bluesky"] || "https://bsky.app/profile/thayn.me",
            mastodonDiscussionUrl:
              syndicationMap["mastodon"] || "https://tech.lgbt/@AnalogCyan",
            // Set only when the post really was syndicated there, since
            // u-syndication must point at a copy of this post
            blueskySyndicationUrl: syndicationMap["bluesky"] || "",
            mastodonSyndicationUrl: syndicationMap["mastodon"] || "",
            bridgyPublishTargets,
            jsonLd: toJsonLdScript({
              "@context": "https://schema.org",
              "@type": "BlogPosting",
              headline: attributes.title,
              description: toExcerpt(attributes.excerpt, body),
              author: {
                "@type": "Person",
                name: attributes.author || "Cyan Thayn",
                url: `${siteUrl}/about`,
              },
              datePublished: toPublishedIso(normalizedDate, parsedDate),
              ...(updatedIso ? { dateModified: updatedIso } : {}),
              image: attributes.image
                ? toAbsoluteUrl(siteUrl, attributes.image)
                : `${siteUrl}/media/og-image.png`,
              ...(postTags.length ? { keywords: postTags.join(", ") } : {}),
              url: canonicalUrl,
              mainEntityOfPage: canonicalUrl,
            }),
          },
        };
      }
    );

    for (const entry of postEntries) {
      if (!entry) continue;
      const filledTemplate = postTemplate(entry.data);
      const outputDir = path.join(BLOG_OUTPUT_DIR, entry.slug);
      await fs.mkdir(outputDir, { recursive: true });
      const outputPath = path.join(outputDir, "index.html");
      await fs.writeFile(outputPath, filledTemplate);

      blogIndex.push(entry.data);
    }
  }

  blogIndex.sort((a, b) => b.dateMs - a.dateMs);

  const indexData = {
    posts: blogIndex,
    tagOptions: buildFilterOptions(blogIndex.flatMap((post) => post.tags)),
    siteUrl,
  };
  const filledIndexTemplate = indexTemplate(indexData);
  await fs.writeFile(
    path.join(BLOG_OUTPUT_DIR, "index.html"),
    filledIndexTemplate
  );

  const meta = {
    title: process.env.BLOG_TITLE || "Cyan's Blog",
    description: process.env.BLOG_DESC || "Notes, updates, and experiments.",
    language: process.env.BLOG_LANG || "en-us",
    author: process.env.BLOG_AUTHOR || "Cyan Thayn",
  };

  const rssXml = buildRSS(blogIndex, meta, siteUrl);
  await fs.writeFile(path.join(BLOG_OUTPUT_DIR, "rss.xml"), rssXml);

  const atomXml = buildAtom(blogIndex, meta, siteUrl);
  await fs.writeFile(path.join(BLOG_OUTPUT_DIR, "atom.xml"), atomXml);
}

// Built pages a search engine should list: noindex stubs stay out, and the
// engine leaves out 404.html itself
async function indexablePages() {
  const pages = [];
  async function walk(dir) {
    for (const entry of await fs.readdir(dir, { withFileTypes: true })) {
      const full = path.join(dir, entry.name);
      if (entry.isDirectory()) await walk(full);
      else if (entry.name.endsWith(".html")) {
        const html = await fs.readFile(full, "utf8");
        if (!/<meta\s+name="robots"\s+content="[^"]*noindex/i.test(html)) {
          pages.push(path.relative(PUBLIC_DIR, full));
        }
      }
    }
  }
  await walk(PUBLIC_DIR);
  return pages;
}

async function build() {
  const config = await engine.loadConfig();
  const capsules = await engine.loadCapsules();
  const usedCapsules = new Set();
  const siteUrl = getSiteUrl();
  (config.meta ??= {}).siteUrl = siteUrl;

  // The engine's steps are composed here rather than calling engine.build(),
  // so the sitemap is written after the blog, which engine.build() never sees
  await cleanPublic();
  config.buildHash = crypto
    .createHash("sha1")
    .update((await engine.generateHash()) + (await hashBlogSources()))
    .digest("hex")
    .slice(0, 8);
  await engine.buildPages(capsules, config, usedCapsules);
  await buildBlog(capsules, config, usedCapsules, siteUrl);
  await engine.bundleStyles(
    capsules,
    usedCapsules,
    await engine.renderVariablesCSS(config),
    config
  );
  await engine.bundleScripts(usedCapsules, capsules, config);
  await copyStatic();
  await engine.writeSitemap(config, await indexablePages());

  console.log("Build complete -> public/");
}

build().catch((err) => {
  console.error(err);
  process.exit(1);
});
