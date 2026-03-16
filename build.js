import fs from "fs/promises";
import path from "path";
import { fileURLToPath } from "url";
import fm from "front-matter";
import { marked } from "marked";
import Handlebars from "handlebars";
import {
  getSiteUrl,
  getCanonicalBlogPath,
} from "./lib/site-url.js";
import { canonicalizeUrl, toAbsoluteUrl } from "./lib/url.js";
import { sanitizeExternalUrl } from "./lib/sanitize-url.js";
import {
  BRIDGY_PUBLISH_TARGETS,
  normalizeSyndicateTargets,
  normalizeSyndicationMap,
} from "./lib/bridgy-syndication.js";

const __dirname = path.dirname(fileURLToPath(import.meta.url));

const SRC_DIR = path.join(__dirname, "src");
const PAGES_DIR = path.join(SRC_DIR, "pages");
const CAPSULES_DIR = path.join(SRC_DIR, "capsules");
const STYLES_DIR = path.join(SRC_DIR, "styles");
const SCRIPTS_DIR = path.join(SRC_DIR, "scripts");
const PUBLIC_DIR = path.join(__dirname, "public");
const CONFIG_PATH = path.join(SRC_DIR, "config.json");
const STANDALONE_SCRIPTS = new Set(["theme-init.js", "i18n-init.js"]);

const BLOG_DIR = path.join(SRC_DIR, "blog");
const BLOG_POSTS_DIR = path.join(BLOG_DIR, "posts");
const BLOG_TEMPLATES_DIR = path.join(BLOG_DIR, "templates");
const BLOG_OUTPUT_DIR = path.join(PUBLIC_DIR, "blog");
const BLOG_STYLES_FILE = path.join(BLOG_DIR, "styles.css");
const BLOG_SCRIPTS_DIR = path.join(BLOG_DIR, "scripts");
const DEFAULT_WEBMENTION_FETCH_TIMEOUT_MS = 8000;
const DEFAULT_WEBMENTION_FETCH_CONCURRENCY = 4;
const WEBMENTION_FETCH_TIMEOUT_MS = (() => {
  const raw = Number.parseInt(
    process.env.WEBMENTION_FETCH_TIMEOUT_MS || "",
    10,
  );
  return Number.isFinite(raw) && raw > 0
    ? raw
    : DEFAULT_WEBMENTION_FETCH_TIMEOUT_MS;
})();
const WEBMENTION_FETCH_CONCURRENCY = (() => {
  const raw = Number.parseInt(
    process.env.WEBMENTION_FETCH_CONCURRENCY || "",
    10,
  );
  return Number.isFinite(raw) && raw > 0
    ? raw
    : DEFAULT_WEBMENTION_FETCH_CONCURRENCY;
})();
const WEBMENTIONS_BUILD_FETCH_ENABLED = false;

const DATE_ONLY_RE = /^\d{4}-\d{2}-\d{2}$/;
const DEFAULT_EMPTY_FEED_UPDATED_ISO = "1970-01-01T00:00:00Z";

function parsePostDate(value, source = "blog post") {
  let raw = "";
  if (value instanceof Date) {
    if (Number.isNaN(value.getTime())) {
      throw new Error(
        `Invalid blog post date "${value}" in ${source}. Use YYYY-MM-DD or ISO 8601.`,
      );
    }
    const iso = value.toISOString();
    raw = iso.endsWith("T00:00:00.000Z") ? iso.slice(0, 10) : iso;
  } else {
    raw = String(value || "").trim();
  }
  if (!raw) {
    throw new Error(
      `Missing required blog post date in ${source}. Use YYYY-MM-DD or ISO 8601.`,
    );
  }

  const parsed = DATE_ONLY_RE.test(raw)
    ? new Date(`${raw}T12:00:00Z`)
    : new Date(raw);

  if (Number.isNaN(parsed.getTime())) {
    throw new Error(
      `Invalid blog post date "${raw}" in ${source}. Use YYYY-MM-DD or ISO 8601.`,
    );
  }

  return { raw, parsed };
}

function resolveEmptyFeedUpdatedDate() {
  const configured = String(
    process.env.BLOG_EMPTY_FEED_UPDATED || DEFAULT_EMPTY_FEED_UPDATED_ISO,
  ).trim();

  try {
    const { parsed } = parsePostDate(configured, "BLOG_EMPTY_FEED_UPDATED");
    return parsed;
  } catch (err) {
    const { parsed } = parsePostDate(
      DEFAULT_EMPTY_FEED_UPDATED_ISO,
      "default empty feed date",
    );
    console.warn(
      `${err?.message || "Invalid BLOG_EMPTY_FEED_UPDATED value."} Falling back to ${DEFAULT_EMPTY_FEED_UPDATED_ISO}.`,
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

marked.setOptions({
  gfm: true,
  breaks: false,
  headerIds: true,
  mangle: false,
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

const SYNDICATION_SITES = {
  bluesky: { label: "Bluesky" },
  mastodon: { label: "Mastodon" },
  fediverse: { label: "Mastodon" },
  instagram: { label: "Instagram" },
  github: { label: "GitHub" },
  musicbrainz: { label: "MusicBrainz" },
  lastfm: { label: "Last.fm" },
  discogs: { label: "Discogs" },
  pronouns: { label: "Pronouns" },
};

function normalizeSyndication(raw) {
  const links = [];
  if (!raw) return links;

  function addLink(site, url, labelOverride) {
    if (!url || typeof url !== "string") return;
    const trimmed = url.trim();
    if (!trimmed) return;
    const safeUrl = sanitizeExternalUrl(trimmed);
    if (!safeUrl) return;
    const meta = site ? SYNDICATION_SITES[site] : null;
    const label = labelOverride || (meta && meta.label);
    if (!label) return;
    links.push({ site, label, url: safeUrl });
  }

  if (Array.isArray(raw)) {
    for (const item of raw) {
      if (!item) continue;
      if (typeof item === "object") {
        const site = item.site || item.network || item.service;
        const url = item.url || item.href;
        addLink(site, url, item.label);
      }
    }
    return links;
  }

  if (typeof raw === "object") {
    for (const [site, value] of Object.entries(raw)) {
      if (Array.isArray(value)) {
        value.forEach((url) => addLink(site, url));
      } else if (typeof value === "string") {
        addLink(site, value);
      } else if (value && typeof value === "object") {
        addLink(site, value.url || value.href, value.label);
      }
    }
  }

  return links;
}

function resolveWebmentionTarget(attributes, canonicalUrl) {
  if (!attributes || typeof attributes !== "object") return canonicalUrl;

  const directCandidates = [
    attributes.webmentionTarget,
    attributes.socialUrl,
    attributes.socialURL,
    attributes.social,
    attributes.linkedSocialUrl,
    attributes.linkedSocialURL,
    attributes.linkedSocial,
    attributes.socialPost,
    attributes.syndicationUrl,
    attributes.syndicationURL,
  ];

  for (const candidate of directCandidates) {
    const safe = sanitizeExternalUrl(candidate);
    if (safe) return safe;
  }

  return canonicalUrl;
}

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

async function loadConfig() {
  try {
    const raw = await fs.readFile(CONFIG_PATH, "utf-8");
    return JSON.parse(raw);
  } catch {
    return { fonts: {}, externalResources: {}, meta: {} };
  }
}

function generateResourcesHTML(config, siteUrl) {
  let html = "";
  const preconnects = new Set();

  if (config.fonts) {
    for (const font of Object.values(config.fonts)) {
      if (!font.url) continue;
      preconnects.add("https://fonts.googleapis.com");
      preconnects.add("https://fonts.gstatic.com");
      html += `\n    <link href="${font.url}" rel="stylesheet" />`;
    }
  }

  if (config.externalResources) {
    for (const resource of Object.values(config.externalResources)) {
      if (resource.url) {
        try {
          const host = new URL(resource.url).hostname;
          if (host === "cdn.jsdelivr.net") {
            preconnects.add("https://cdn.jsdelivr.net");
          }
        } catch {
          // ignore invalid URLs
        }
      }
      if (resource.type === "stylesheet") {
        html += `\n    <link href="${resource.url}" rel="stylesheet" />`;
      } else if (resource.type === "script") {
        html += `\n    <script src="${resource.url}"${resource.defer ? " defer" : ""}></script>`;
      }
    }
  }

  if (preconnects.size > 0) {
    const ordered = Array.from(preconnects).sort();
    const tags = ordered.map((href) => {
      const crossorigin = href.includes("fonts.gstatic.com")
        ? " crossorigin"
        : "";
      return `\n    <link rel="preconnect" href="${href}"${crossorigin} />`;
    });
    html = `${tags.join("")}${html}`;
  }

  if (siteUrl) {
    let siteHost = "";
    try {
      siteHost = new URL(siteUrl).hostname;
    } catch {
      siteHost = "";
    }

    html += `\n    <link rel="alternate" type="application/rss+xml" title="RSS" href="${toAbsoluteUrl(
      siteUrl,
      "/blog/rss.xml",
    )}" />`;
    html += `\n    <link rel="alternate" type="application/atom+xml" title="Atom" href="${toAbsoluteUrl(
      siteUrl,
      "/blog/atom.xml",
    )}" />`;
    html += `\n    <link rel="alternate" type="application/mf2+html" title="Microformats" href="${toAbsoluteUrl(
      siteUrl,
      "/blog/",
    )}" />`;
    html += `\n    <link rel="feed" href="${toAbsoluteUrl(
      siteUrl,
      "/blog/",
    )}" />`;

    if (siteHost) {
      html += `\n    <link rel="webmention" href="https://webmention.io/${siteHost}/webmention" />`;
      html += `\n    <link rel="pingback" href="https://webmention.io/${siteHost}/xmlrpc" />`;
    }

    const relMeLinks = Array.isArray(config?.meta?.relMe)
      ? config.meta.relMe.filter((entry) => typeof entry === "string")
      : [];
    for (const href of relMeLinks) {
      const trimmed = href.trim();
      if (!trimmed) continue;
      html += `\n    <link rel="me" href="${trimmed}" />`;
    }
  }

  return html;
}

async function loadCapsules() {
  if (!(await pathExists(CAPSULES_DIR))) return {};
  const entries = await fs.readdir(CAPSULES_DIR, { withFileTypes: true });
  const capsules = {};

  for (const entry of entries) {
    if (!entry.isDirectory()) continue;
    const name = entry.name;
    const base = path.join(CAPSULES_DIR, name);
    const capsule = { name };

    const htmlPath = path.join(base, `${name}.html`);
    if (await pathExists(htmlPath)) {
      capsule.html = await fs.readFile(htmlPath, "utf-8");
    }

    const cssPath = path.join(base, `${name}.css`);
    if (await pathExists(cssPath)) {
      capsule.cssPath = cssPath;
    }

    const jsPath = path.join(base, `${name}.js`);
    if (await pathExists(jsPath)) {
      capsule.jsPath = jsPath;
    }

    capsules[name] = capsule;
  }

  return capsules;
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
        `    <title>${config.meta.title}</title>\n  </head>`,
      );
    }
  }

  return output;
}

function ensureCanonicalLink(html, canonicalUrl) {
  if (!canonicalUrl) return html;
  if (/<link\s+[^>]*rel=["']canonical["']/i.test(html)) return html;
  return html.replace(
    /<\/head>/i,
    `    <link rel="canonical" href="${canonicalUrl}" />\n  </head>`,
  );
}

function ensureI18nInitScript(html) {
  if (/<script\s+[^>]*src=["']\/scripts\/i18n-init\.js["'][^>]*>/i.test(html)) {
    return html;
  }

  const initTag = `    <script src="/scripts/i18n-init.js"></script>`;

  if (/<script\s+[^>]*src=["']\/scripts\/theme-init\.js["'][^>]*>/i.test(html)) {
    return html.replace(
      /(<script\s+[^>]*src=["']\/scripts\/theme-init\.js["'][^>]*>)/i,
      `${initTag}\n    $1`,
    );
  }

  if (/<\/head>/i.test(html)) {
    return html.replace(/<\/head>/i, `${initTag}\n  </head>`);
  }

  return `${initTag}\n${html}`;
}

function ensureSiteBundleScript(html) {
  if (/<script\s+[^>]*src=["']\/scripts\.js["']/i.test(html)) {
    return html;
  }
  return html.replace(/<\/body>/i, `    <script src="/scripts.js" defer></script>\n  </body>`);
}

function escapeRegExp(value) {
  return String(value).replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
}

function ensureCapsuleScripts(html, usedCapsules, capsules) {
  const scriptPaths = Array.from(usedCapsules)
    .sort()
    .map((name) => {
      const cap = capsules[name];
      if (!cap || !cap.jsPath) return null;
      return `/capsules/${name}/${name}.js`;
    })
    .filter(Boolean);

  if (scriptPaths.length === 0) return html;

  const missing = scriptPaths.filter((src) => {
    const pattern = new RegExp(
      `<script\\s+[^>]*src=["']${escapeRegExp(src)}["']`,
      "i",
    );
    return !pattern.test(html);
  });
  if (missing.length === 0) return html;

  const tags = missing.map((src) => `    <script src="${src}" defer></script>`).join("\n");
  if (/<\/body>/i.test(html)) {
    return html.replace(/<\/body>/i, `${tags}\n  </body>`);
  }
  return `${html}\n${tags}`;
}

async function injectCapsules(content, capsules, pageName) {
  const used = new Set();
  const dropRegex = /<drop\s+capsule=['"]([^'" ]+)['"]([^>]*)><\/drop>/g;

  let result = "";
  let lastIndex = 0;
  let match;

  while ((match = dropRegex.exec(content)) !== null) {
    result += content.slice(lastIndex, match.index);
    const capsuleName = match[1];
    const attributes = match[2];
    const capsule = capsules[capsuleName];

    if (!capsule || !capsule.html) {
      console.warn(`Missing capsule "${capsuleName}" on page ${pageName}`);
      result += match[0];
      lastIndex = match.index + match[0].length;
      continue;
    }

    used.add(capsuleName);
    let capsuleHtml = capsule.html;
    const dataAttrs = {};

    if (attributes.trim()) {
      const attrRegex = /data-([a-zA-Z0-9-]+)=['"]([^'"]+)['"]/g;
      let attrMatch;
      while ((attrMatch = attrRegex.exec(attributes)) !== null) {
        const [, name, value] = attrMatch;
        dataAttrs[name] = value;
      }
    }

    capsuleHtml = capsuleHtml.replace(
      /{{\s*([a-zA-Z0-9_-]+)\s*}}/g,
      (_, key) => {
        return key in dataAttrs ? String(dataAttrs[key]) : "";
      },
    );

    result += capsuleHtml;
    lastIndex = match.index + match[0].length;
  }

  result += content.slice(lastIndex);
  return { html: result, used };
}

async function expandAllDrops(
  inputHtml,
  capsules,
  pageName,
  globalUsed,
  localUsed = null,
) {
  const MAX_PASSES = 20;
  let html = inputHtml;

  for (let pass = 0; pass < MAX_PASSES; pass += 1) {
    if (!html.includes("<drop ")) break;
    const { html: nextHtml, used } = await injectCapsules(
      html,
      capsules,
      `${pageName}#${pass}`,
    );
    used.forEach((u) => {
      globalUsed.add(u);
      if (localUsed) localUsed.add(u);
    });
    if (nextHtml === html) break;
    html = nextHtml;
  }

  if (html.includes("<drop ")) {
    console.warn(`expandAllDrops reached MAX_PASSES for ${pageName}`);
  }

  return html;
}

async function buildPages(capsules, config, globalUsed, siteUrl) {
  async function collectEntries(dir, base = dir) {
    const entries = await fs.readdir(dir, { withFileTypes: true });
    const files = [];
    for (const entry of entries) {
      const fullPath = path.join(dir, entry.name);
      if (entry.name === ".DS_Store") continue;
      if (entry.isDirectory()) {
        files.push(...(await collectEntries(fullPath, base)));
        continue;
      }
      files.push({
        relPath: path.relative(base, fullPath),
        fullPath,
      });
    }
    return files;
  }

  const files = await collectEntries(PAGES_DIR);
  const resourcesHTML = generateResourcesHTML(config, siteUrl);

  await Promise.all(
    files.map(async ({ relPath, fullPath }) => {
      const normalizedRelPath = relPath.replace(/\\/g, "/");
      const destPath = path.join(PUBLIC_DIR, relPath);

      if (!normalizedRelPath.toLowerCase().endsWith(".html")) {
        await fs.mkdir(path.dirname(destPath), { recursive: true });
        await fs.copyFile(fullPath, destPath);
        return;
      }

      let content = await fs.readFile(fullPath, "utf-8");

      content = injectResources(content, resourcesHTML, config);
      content = ensureI18nInitScript(content);
      const canonicalPath =
        normalizedRelPath === "index.html"
          ? "/"
          : normalizedRelPath.endsWith("/index.html")
            ? `/${normalizedRelPath.slice(0, -"index.html".length)}`
            : `/${normalizedRelPath}`;
      content = ensureCanonicalLink(
        content,
        canonicalizeUrl(siteUrl, canonicalPath),
      );
      const pageUsedCapsules = new Set();
      const withCapsules = await expandAllDrops(
        content,
        capsules,
        normalizedRelPath,
        globalUsed,
        pageUsedCapsules,
      );
      const withSiteBundle = ensureSiteBundleScript(withCapsules);
      const contentFinal = ensureCapsuleScripts(
        withSiteBundle,
        pageUsedCapsules,
        capsules,
      );

      await fs.mkdir(path.dirname(destPath), { recursive: true });
      await fs.writeFile(destPath, contentFinal);
    }),
  );
}

async function bundleStyles(capsules) {
  const files = (await fs.readdir(STYLES_DIR)).sort();
  const ordered = ["variables.css", "reset.css", "base.css", "home.css"];
  const remaining = files.filter(
    (f) => f.endsWith(".css") && !ordered.includes(f),
  );
  const cssFiles = [...ordered.filter((f) => files.includes(f)), ...remaining];

  let output = "";
  for (const file of cssFiles) {
    const css = await fs.readFile(path.join(STYLES_DIR, file), "utf-8");
    output += `\n/* === ${file} === */\n${css}`;
  }

  for (const name of Object.keys(capsules).sort()) {
    const cap = capsules[name];
    if (!cap.cssPath) continue;
    const css = await fs.readFile(cap.cssPath, "utf-8");
    output += `\n/* === Capsule: ${name} === */\n${css}`;
  }

  await fs.writeFile(path.join(PUBLIC_DIR, "styles.css"), output);
}

async function bundleScripts(usedCapsules, capsules) {
  let output = "";

  if (await pathExists(SCRIPTS_DIR)) {
    const files = (await fs.readdir(SCRIPTS_DIR)).sort();
    const standalone = [];
    for (const file of files) {
      if (!file.endsWith(".js")) continue;
      if (STANDALONE_SCRIPTS.has(file)) {
        standalone.push(file);
        continue;
      }
      const js = await fs.readFile(path.join(SCRIPTS_DIR, file), "utf-8");
      output += `\n// === ${file} ===\n${js}`;
    }

    if (standalone.length > 0) {
      const standaloneDir = path.join(PUBLIC_DIR, "scripts");
      await fs.mkdir(standaloneDir, { recursive: true });
      await Promise.all(
        standalone.map((file) =>
          fs.copyFile(
            path.join(SCRIPTS_DIR, file),
            path.join(standaloneDir, file),
          ),
        ),
      );
    }
  }

  const orderedCapsules = Array.from(usedCapsules).sort();
  const capsuleScripts = orderedCapsules.filter(
    (capName) => capsules[capName] && capsules[capName].jsPath,
  );
  if (capsuleScripts.length > 0) {
    const capsulesDir = path.join(PUBLIC_DIR, "capsules");
    await fs.mkdir(capsulesDir, { recursive: true });
    await Promise.all(
      capsuleScripts.map(async (capName) => {
        const cap = capsules[capName];
        if (!cap || !cap.jsPath) return;
        const destDir = path.join(capsulesDir, capName);
        await fs.mkdir(destDir, { recursive: true });
        await fs.copyFile(cap.jsPath, path.join(destDir, `${capName}.js`));
      }),
    );
  }

  await fs.writeFile(path.join(PUBLIC_DIR, "scripts.js"), output);
}

async function copyStatic() {
  await copyDir(path.join(SRC_DIR, "media"), path.join(PUBLIC_DIR, "media"));
  await copyDir(
    path.join(SRC_DIR, ".well-known"),
    path.join(PUBLIC_DIR, ".well-known"),
  );
  await copyDir(path.join(SRC_DIR, "i18n"), path.join(PUBLIC_DIR, "i18n"));

  const manifestSrc = path.join(SRC_DIR, "manifest.json");
  if (await pathExists(manifestSrc)) {
    await fs.copyFile(manifestSrc, path.join(PUBLIC_DIR, "manifest.json"));
  }

  const sanitizeUrlSrc = path.join(__dirname, "lib", "sanitize-url.js");
  if (await pathExists(sanitizeUrlSrc)) {
    const libOutDir = path.join(PUBLIC_DIR, "lib");
    await fs.mkdir(libOutDir, { recursive: true });
    await fs.copyFile(sanitizeUrlSrc, path.join(libOutDir, "sanitize-url.js"));
  }
}

function getFunctionsBaseUrl(siteUrl) {
  return siteUrl;
}

function initWebmentionBuckets() {
  return {
    replies: [],
    likes: [],
    reposts: [],
    mentions: [],
    bookmarks: [],
  };
}

function extractWebmentionText(item) {
  if (!item || !item.content) return "";
  if (typeof item.content === "string") return item.content.trim();
  if (typeof item.content === "object") {
    return String(item.content.text || item.content.value || "").trim();
  }
  return "";
}

function normalizeWebmentionAuthor(item) {
  const author = (item && item.author) || {};
  const authorName =
    String(author.name || author.url || item.url || "Someone").trim() ||
    "Someone";
  const authorUrl = sanitizeExternalUrl(author.url || item.url);
  const authorPhoto = sanitizeExternalUrl(author.photo);
  return { authorName, authorUrl, authorPhoto };
}

function normalizeWebmentionReply(item) {
  const author = normalizeWebmentionAuthor(item);
  const published = item.published || item["wm-received"] || "";
  const received = item["wm-received"] || item.published || "";
  const text = extractWebmentionText(item);
  const url = sanitizeExternalUrl(item.url);
  const authorLink = author.authorUrl || url || null;

  return {
    ...author,
    authorLink,
    published,
    received,
    text,
    url,
  };
}

function normalizeWebmentionPerson(item) {
  const author = normalizeWebmentionAuthor(item);
  const url = sanitizeExternalUrl(item.url) || author.authorUrl || null;
  const authorLink = author.authorUrl || url || null;

  return {
    ...author,
    authorLink,
    url,
  };
}

function toTime(value) {
  if (!value) return 0;
  const parsed = Date.parse(value);
  return Number.isNaN(parsed) ? 0 : parsed;
}

function buildWebmentionBuckets(payload) {
  const buckets = initWebmentionBuckets();
  const items = Array.isArray(payload?.children) ? payload.children : [];

  for (const item of items) {
    if (!item) continue;
    const isPrivate =
      item["wm-private"] === true ||
      item["wm-private"] === "true" ||
      item["wm-private"] === 1;
    if (isPrivate) continue;

    const prop = item["wm-property"];
    if (prop === "in-reply-to") {
      buckets.replies.push(normalizeWebmentionReply(item));
    } else if (prop === "like-of") {
      buckets.likes.push(normalizeWebmentionPerson(item));
    } else if (prop === "repost-of") {
      buckets.reposts.push(normalizeWebmentionPerson(item));
    } else if (prop === "mention-of") {
      buckets.mentions.push(normalizeWebmentionPerson(item));
    } else if (prop === "bookmark-of") {
      buckets.bookmarks.push(normalizeWebmentionPerson(item));
    }
  }

  buckets.replies.sort((a, b) => toTime(a.received) - toTime(b.received));

  return buckets;
}

async function fetchWebmentions(targetUrl, functionsBaseUrl) {
  if (!WEBMENTIONS_BUILD_FETCH_ENABLED) return null;
  if (!functionsBaseUrl) return null;
  const endpoint = `${functionsBaseUrl}/.netlify/functions/webmentions?target=${encodeURIComponent(
    targetUrl,
  )}`;
  const controller = new AbortController();
  const timeout = setTimeout(
    () => controller.abort(),
    WEBMENTION_FETCH_TIMEOUT_MS,
  );

  try {
    const res = await fetch(endpoint, {
      headers: { Accept: "application/json" },
      signal: controller.signal,
    });
    if (!res.ok) return null;
    return await res.json();
  } catch {
    return null;
  } finally {
    clearTimeout(timeout);
  }
}

function xmlEscape(s = "") {
  return String(s)
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/\"/g, "&quot;")
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

function normalizeLanguageKey(value) {
  if (!value) return "en";
  const normalized = String(value).trim().toLowerCase();
  if (!normalized) return "en";
  return normalized.split(/[-_]/)[0] || "en";
}

function normalizeLanguageList(value) {
  if (Array.isArray(value)) {
    return value
      .map((item) => normalizeLanguageKey(item))
      .filter((item, index, array) => item && array.indexOf(item) === index);
  }
  if (typeof value === "string") {
    return value
      .split(",")
      .map((item) => normalizeLanguageKey(item))
      .filter((item, index, array) => item && array.indexOf(item) === index);
  }
  return [];
}

function normalizeCategories(value) {
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
  return String(markdown)
    .replace(/```[\s\S]*?```/g, "")
    .replace(/`[^`]*`/g, "")
    .replace(/<[^>]+>/g, "")
    .replace(/!\[[^\]]*\]\([^\)]+\)/g, "")
    .replace(/\[[^\]]+\]\([^\)]+\)/g, "")
    .replace(/[#>*_~\-]+/g, " ")
    .replace(/\s+/g, " ")
    .trim();
}

function toExcerpt(rawExcerpt, markdownBody) {
  const plainBody = stripMarkdown(markdownBody);
  const candidate = String(rawExcerpt || "").trim() || plainBody.slice(0, 180);
  if (!candidate) return "";
  return /[.!?…]$/.test(candidate) ? candidate : `${candidate}…`;
}

function parseTranslationEntry(entry) {
  if (typeof entry === "string") {
    return { body: entry };
  }
  if (!entry || typeof entry !== "object") return null;

  const bodyValue =
    typeof entry.body === "string"
      ? entry.body
      : typeof entry.content === "string"
        ? entry.content
        : typeof entry.markdown === "string"
          ? entry.markdown
          : null;

  return {
    title:
      typeof entry.title === "string" && entry.title.trim()
        ? entry.title.trim()
        : null,
    excerpt:
      typeof entry.excerpt === "string" && entry.excerpt.trim()
        ? entry.excerpt.trim()
        : null,
    author:
      typeof entry.author === "string" && entry.author.trim()
        ? entry.author.trim()
        : null,
    categories:
      entry.categories != null ? normalizeCategories(entry.categories) : null,
    body: bodyValue,
  };
}

function parseLocalizedBodySections(markdown, source = "blog post content") {
  const sections = new Map();
  const lines = String(markdown || "").split("\n");
  const remainder = [];

  let activeLang = null;
  let sectionLines = [];

  const startPattern = /^:::lang\s+([a-zA-Z0-9_-]+)\s*$/;
  const endPattern = /^:::\s*$/;

  function flushSection() {
    if (!activeLang) return;
    const sectionBody = sectionLines.join("\n").trim();
    sections.set(activeLang, { body: sectionBody });
    activeLang = null;
    sectionLines = [];
  }

  for (const line of lines) {
    if (!activeLang) {
      const start = line.match(startPattern);
      if (start) {
        activeLang = normalizeLanguageKey(start[1]);
        sectionLines = [];
        continue;
      }
      remainder.push(line);
      continue;
    }

    if (endPattern.test(line)) {
      flushSection();
      continue;
    }

    sectionLines.push(line);
  }

  if (activeLang) {
    throw new Error(
      `Unclosed :::lang block for "${activeLang}" in ${source}. Add a closing ":::" line.`,
    );
  }

  return {
    sections,
    remainder: remainder.join("\n").trim(),
  };
}

function buildLocalizedVariants(attributes, body, fallbackTitle, source) {
  const defaultLang = normalizeLanguageKey(
    attributes.defaultLanguage || attributes.defaultLang || "en",
  );
  const declaredLanguages = normalizeLanguageList(
    attributes.languages || attributes.langs,
  );
  const { sections: bodySections, remainder } = parseLocalizedBodySections(
    body,
    source || fallbackTitle || "blog post content",
  );
  const defaultSectionBody = bodySections.get(defaultLang)?.body || "";
  const declaredSectionBody = declaredLanguages[0]
    ? bodySections.get(declaredLanguages[0])?.body || ""
    : "";
  const firstSectionBody = Array.from(bodySections.values())[0]?.body || "";
  const baseBody =
    defaultSectionBody ||
    remainder ||
    declaredSectionBody ||
    firstSectionBody ||
    (typeof body === "string" ? body : "");
  const baseVariant = {
    title: fallbackTitle,
    author: attributes.author || "Cyan Thayn",
    date: attributes.date,
    categories: normalizeCategories(attributes.categories),
    content: marked(baseBody),
    excerpt: toExcerpt(attributes.excerpt, baseBody),
  };

  const variants = new Map([[defaultLang, baseVariant]]);
  const translations = attributes.translations;
  const translationEntriesByLang = new Map();
  const languageSet = new Set([defaultLang, ...declaredLanguages]);

  Array.from(bodySections.keys()).forEach((lang) => languageSet.add(lang));
  if (translations && typeof translations === "object") {
    Object.entries(translations).forEach(([lang, entry]) => {
      const normalizedLang = normalizeLanguageKey(lang);
      if (!normalizedLang) return;
      languageSet.add(normalizedLang);

      if (!translationEntriesByLang.has(normalizedLang) || lang === normalizedLang) {
        translationEntriesByLang.set(normalizedLang, entry);
      }
    });
  }

  for (const lang of languageSet) {
    if (!lang) continue;
    const translationEntry = translationEntriesByLang.get(lang) || null;
    const parsedTranslation = parseTranslationEntry(translationEntry);
    const section = bodySections.get(lang) || null;
    const sectionBody = section ? section.body : "";

    const markdownBody =
      (parsedTranslation && typeof parsedTranslation.body === "string"
        ? parsedTranslation.body
        : "") ||
      (sectionBody || "") ||
      baseBody;

    variants.set(lang, {
      title:
        (parsedTranslation && parsedTranslation.title) ||
        baseVariant.title,
      author:
        (parsedTranslation && parsedTranslation.author) ||
        baseVariant.author,
      date: baseVariant.date,
      categories:
        (parsedTranslation && parsedTranslation.categories) ||
        baseVariant.categories,
      content: marked(markdownBody),
      excerpt: toExcerpt(
        (parsedTranslation && parsedTranslation.excerpt) ||
          attributes.excerpt ||
          "",
        markdownBody,
      ),
    });
  }

  const localizedVariants = Array.from(variants.entries())
    .map(([lang, data]) => ({
      lang,
      isDefault: lang === defaultLang,
      ...data,
    }))
    .sort((a, b) => {
      if (a.isDefault && !b.isDefault) return -1;
      if (!a.isDefault && b.isDefault) return 1;
      return a.lang.localeCompare(b.lang);
    });

  return {
    defaultLang,
    localizedVariants,
  };
}

function buildRSS(posts, meta, siteUrl) {
  const channelUrl = toAbsoluteUrl(siteUrl, "/blog/");
  const selfUrl = toAbsoluteUrl(siteUrl, "/blog/rss.xml");
  const lastBuild = posts[0]?.date
    ? rfc2822(posts[0].date, "latest post date")
    : EMPTY_FEED_UPDATED_DATE.toUTCString();
  const items = posts
    .map((p) => {
      const link = p.canonicalUrl || toAbsoluteUrl(siteUrl, p.url);
      const cats = (p.categories || [])
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
  const updated = posts[0]?.date
    ? iso8601(posts[0].date, "latest post date")
    : EMPTY_FEED_UPDATED_DATE.toISOString();
  const entries = posts
    .map((p) => {
      const link = p.canonicalUrl || toAbsoluteUrl(siteUrl, p.url);
      const cats = (p.categories || [])
        .map((c) => `    <category term="${xmlEscape(c)}"/>`)
        .join("\n");
      return [
        "  <entry>",
        `    <title>${xmlEscape(p.title)}</title>`,
        `    <id>${xmlEscape(link)}</id>`,
        `    <link href="${xmlEscape(link)}"/>`,
        `    <updated>${iso8601(p.date, `post "${p.title || p.url || "unknown"}"`)}</updated>`,
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

async function buildBlog(capsules, config, globalUsed, siteUrl) {
  if (!(await pathExists(BLOG_TEMPLATES_DIR))) return;

  await fs.mkdir(BLOG_OUTPUT_DIR, { recursive: true });

  if (await pathExists(BLOG_STYLES_FILE)) {
    await fs.copyFile(
      BLOG_STYLES_FILE,
      path.join(BLOG_OUTPUT_DIR, "styles.css"),
    );
  }

  if (await pathExists(BLOG_SCRIPTS_DIR)) {
    await copyDir(BLOG_SCRIPTS_DIR, path.join(BLOG_OUTPUT_DIR, "scripts"));
  }

  const indexTemplatePath = path.join(
    BLOG_TEMPLATES_DIR,
    "index-template.html",
  );
  const postTemplatePath = path.join(BLOG_TEMPLATES_DIR, "post-template.html");

  const indexTemplateRaw = await fs.readFile(indexTemplatePath, "utf-8");
  const postTemplateRaw = await fs.readFile(postTemplatePath, "utf-8");

  const resourcesHTML = generateResourcesHTML(config, siteUrl);
  const indexWithResources = ensureI18nInitScript(
    injectResources(indexTemplateRaw, resourcesHTML, config),
  );
  const postWithResources = ensureI18nInitScript(
    injectResources(postTemplateRaw, resourcesHTML, config),
  );

  const indexUsedCapsules = new Set();
  const postUsedCapsules = new Set();
  const indexTemplateSourceRaw = await expandAllDrops(
    indexWithResources,
    capsules,
    "blog-index",
    globalUsed,
    indexUsedCapsules,
  );
  const postTemplateSourceRaw = await expandAllDrops(
    postWithResources,
    capsules,
    "blog-post",
    globalUsed,
    postUsedCapsules,
  );
  const indexTemplateSource = ensureCapsuleScripts(
    ensureSiteBundleScript(indexTemplateSourceRaw),
    indexUsedCapsules,
    capsules,
  );
  const postTemplateSource = ensureCapsuleScripts(
    ensureSiteBundleScript(postTemplateSourceRaw),
    postUsedCapsules,
    capsules,
  );

  const indexTemplate = Handlebars.compile(indexTemplateSource);
  const postTemplate = Handlebars.compile(postTemplateSource);

  let blogIndex = [];
  const functionsBaseUrl = getFunctionsBaseUrl(siteUrl);
  if (await pathExists(BLOG_POSTS_DIR)) {
    const files = (await fs.readdir(BLOG_POSTS_DIR))
      .filter((file) => file.endsWith(".md"))
      .sort();

    const postEntries = await mapWithConcurrency(
      files,
      WEBMENTION_FETCH_CONCURRENCY,
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
          `frontmatter in ${filePath}`,
        );
        attributes.date = normalizedDate;

        const { localizedVariants } = buildLocalizedVariants(
          attributes,
          body,
          attributes.title,
          filePath,
        );
        const primaryVariant = localizedVariants[0];
        const primaryCategory = primaryVariant.categories[0] || "";

        const slug = path.basename(file, ".md");
        const defaultPath = getCanonicalBlogPath(slug);
        const defaultCanonical = canonicalizeUrl(siteUrl, defaultPath);
        const canonicalOverride = canonicalizeUrl(
          siteUrl,
          attributes.canonical,
        );
        const canonicalUrl = canonicalOverride || defaultCanonical;

        const url = defaultPath;
        const syndicationMap = normalizeSyndicationMap(attributes.syndication);
        const webmentionTarget = resolveWebmentionTarget(
          attributes,
          canonicalUrl,
        );

        const webmentionPayload = await fetchWebmentions(
          webmentionTarget,
          functionsBaseUrl,
        );
        const webmentions = buildWebmentionBuckets(webmentionPayload);
        const hasWebmentions = Object.values(webmentions).some(
          (items) => items.length > 0,
        );
        const syndicateTargets = normalizeSyndicateTargets(
          attributes.syndicate,
        );
        const pendingTargets = syndicateTargets.filter(
          (target) => !syndicationMap[target],
        );
        const bridgyPublishTargets = pendingTargets.map(
          (target) => BRIDGY_PUBLISH_TARGETS[target],
        );

        return {
          slug,
          data: {
            title: primaryVariant.title,
            author: primaryVariant.author,
            date: normalizedDate,
            dateIso: toPublishedIso(normalizedDate, parsedDate),
            dateMs: parsedDate.getTime(),
            categories: primaryVariant.categories,
            authorFilterKey: normalizeFilterValue(primaryVariant.author),
            categoryFilterKey: normalizeFilterValue(primaryCategory),
            content: primaryVariant.content,
            excerpt: primaryVariant.excerpt,
            localizedVariants,
            url,
            siteUrl,
            canonicalUrl,
            webmentionTarget,
            ogImage: attributes.image
              ? toAbsoluteUrl(siteUrl, attributes.image)
              : `${siteUrl}/media/profile.svg`,
            syndicationLinks: normalizeSyndication(attributes.syndication),
            blueskyDiscussionUrl: syndicationMap["bluesky"] || "https://bsky.app/profile/thayn.me",
            webmentions,
            hasWebmentions,
            bridgyPublishTargets,
          },
        };
      },
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
    authorOptions: buildFilterOptions(blogIndex.map((post) => post.author)),
    categoryOptions: buildFilterOptions(
      blogIndex.map((post) => post.categories[0] || ""),
    ),
    siteUrl,
  };
  const filledIndexTemplate = indexTemplate(indexData);
  await fs.writeFile(
    path.join(BLOG_OUTPUT_DIR, "index.html"),
    filledIndexTemplate,
  );

  const recentCount = Math.max(
    0,
    Number.parseInt(process.env.BLOG_RECENT_COUNT || "3", 10) || 3,
  );
  const recentPosts = blogIndex.slice(0, recentCount).map((post) => ({
    title: post.title,
    date: post.date,
    category: post.categories[0] || "",
    excerpt: post.excerpt,
    author: post.author,
    url: post.url,
  }));
  await fs.writeFile(
    path.join(BLOG_OUTPUT_DIR, "recent-posts.json"),
    JSON.stringify(recentPosts, null, 2),
  );

  const meta = {
    title: process.env.BLOG_TITLE || "Cyan Thayn Blog",
    description: process.env.BLOG_DESC || "Notes, updates, and experiments.",
    language: process.env.BLOG_LANG || "en-us",
    author: process.env.BLOG_AUTHOR || "Cyan Thayn",
  };

  const rssXml = buildRSS(blogIndex, meta, siteUrl);
  await fs.writeFile(path.join(BLOG_OUTPUT_DIR, "rss.xml"), rssXml);

  const atomXml = buildAtom(blogIndex, meta, siteUrl);
  await fs.writeFile(path.join(BLOG_OUTPUT_DIR, "atom.xml"), atomXml);
}

async function build() {
  const config = await loadConfig();
  const capsules = await loadCapsules();
  const usedCapsules = new Set();
  const siteUrl = getSiteUrl();

  await cleanPublic();
  await buildPages(capsules, config, usedCapsules, siteUrl);
  await buildBlog(capsules, config, usedCapsules, siteUrl);
  await bundleStyles(capsules);
  await bundleScripts(usedCapsules, capsules);
  await copyStatic();

  console.log("Build complete -> public/");
}

build().catch((err) => {
  console.error(err);
  process.exit(1);
});
