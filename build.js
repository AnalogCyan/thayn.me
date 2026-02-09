import fs from "fs/promises";
import path from "path";
import { fileURLToPath } from "url";
import fm from "front-matter";
import { marked } from "marked";
import Handlebars from "handlebars";
import {
  getSiteUrl,
  getCanonicalBlogPath,
  isProductionBuild,
} from "./site-url.js";
import { canonicalizeUrl, toAbsoluteUrl } from "./lib/url.js";
import { sanitizeExternalUrl } from "./lib/sanitize-url.js";

const __dirname = path.dirname(fileURLToPath(import.meta.url));

const SRC_DIR = path.join(__dirname, "src");
const PAGES_DIR = path.join(SRC_DIR, "pages");
const CAPSULES_DIR = path.join(SRC_DIR, "capsules");
const STYLES_DIR = path.join(SRC_DIR, "styles");
const SCRIPTS_DIR = path.join(SRC_DIR, "scripts");
const PUBLIC_DIR = path.join(__dirname, "public");
const CONFIG_PATH = path.join(SRC_DIR, "config.json");
const STANDALONE_SCRIPTS = new Set(["theme-init.js"]);

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
const WEBMENTIONS_BUILD_FETCH_ENABLED = (() => {
  const raw = String(process.env.WEBMENTIONS_BUILD_FETCH || "")
    .trim()
    .toLowerCase();
  if (["0", "false", "off", "no"].includes(raw)) return false;
  if (["1", "true", "on", "yes"].includes(raw)) return true;
  return isProductionBuild();
})();

marked.setOptions({
  gfm: true,
  breaks: false,
  headerIds: true,
  mangle: false,
});

Handlebars.registerHelper("formatDate", function (date) {
  const options = { year: "numeric", month: "long", day: "numeric" };
  const utcDate = new Date(date + "T12:00:00Z");
  return utcDate.toLocaleDateString("en-US", options);
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

const BRIDGY_PUBLISH_TARGETS = {
  mastodon: "https://brid.gy/publish/mastodon",
  bluesky: "https://brid.gy/publish/bluesky",
};

const TARGET_ALIASES = {
  fediverse: "mastodon",
};

function normalizeSyndication(raw) {
  const links = [];
  if (!raw) return links;

  function addLink(site, url, labelOverride) {
    if (!url || typeof url !== "string") return;
    const trimmed = url.trim();
    if (!trimmed) return;
    const meta = site ? SYNDICATION_SITES[site] : null;
    const label = labelOverride || (meta && meta.label);
    if (!label) return;
    links.push({ site, label, url: trimmed });
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

function normalizeSyndicateTargets(raw) {
  const targets = new Set();

  const normalizeTarget = (value) => {
    if (!value) return "";
    const key = String(value).trim().toLowerCase();
    return TARGET_ALIASES[key] || key;
  };

  const addTarget = (value) => {
    const key = normalizeTarget(value);
    if (BRIDGY_PUBLISH_TARGETS[key]) {
      targets.add(key);
    }
  };

  if (Array.isArray(raw)) {
    raw.forEach((entry) => {
      if (!entry) return;
      if (typeof entry === "string") {
        addTarget(entry);
        return;
      }
      if (typeof entry === "object") {
        Object.entries(entry).forEach(([key, enabled]) => {
          if (!enabled) return;
          addTarget(key);
        });
      }
    });
  } else if (typeof raw === "object") {
    Object.entries(raw).forEach(([key, enabled]) => {
      if (!enabled) return;
      addTarget(key);
    });
  } else if (typeof raw === "string") {
    addTarget(raw);
  }

  return Array.from(targets);
}

function getSyndicatedTargets(raw) {
  const targets = new Set();
  if (!raw) return targets;

  const addTarget = (value) => {
    if (!value) return;
    const key = String(value).trim().toLowerCase();
    if (BRIDGY_PUBLISH_TARGETS[key]) targets.add(key);
    if (key === "fediverse") targets.add("mastodon");
  };

  if (Array.isArray(raw)) {
    raw.forEach((entry) => {
      if (!entry) return;
      if (typeof entry === "string") return;
      if (typeof entry === "object") {
        const key = entry.site || entry.network || entry.service;
        const url = entry.url || entry.href;
        if (key && url) addTarget(key);
      }
    });
    return targets;
  }

  if (typeof raw === "object") {
    Object.entries(raw).forEach(([key, value]) => {
      if (!value) return;
      if (typeof value === "string") {
        addTarget(key);
        return;
      }
      if (Array.isArray(value)) {
        if (value.length > 0) addTarget(key);
        return;
      }
      if (typeof value === "object") {
        const url = value.url || value.href;
        if (url) addTarget(key);
      }
    });
  }

  return targets;
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
  let output = content.replace(placeholder, resourcesHTML);

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

async function expandAllDrops(inputHtml, capsules, pageName, globalUsed) {
  const MAX_PASSES = 20;
  let html = inputHtml;

  for (let pass = 0; pass < MAX_PASSES; pass += 1) {
    if (!html.includes("<drop ")) break;
    const { html: nextHtml, used } = await injectCapsules(
      html,
      capsules,
      `${pageName}#${pass}`,
    );
    used.forEach((u) => globalUsed.add(u));
    if (nextHtml === html) break;
    html = nextHtml;
  }

  if (html.includes("<drop ")) {
    console.warn(`expandAllDrops reached MAX_PASSES for ${pageName}`);
  }

  return html;
}

async function buildPages(capsules, config, globalUsed, siteUrl) {
  const files = await fs.readdir(PAGES_DIR);
  const resourcesHTML = generateResourcesHTML(config, siteUrl);

  await Promise.all(
    files.map(async (file) => {
      const srcPath = path.join(PAGES_DIR, file);
      const destPath = path.join(PUBLIC_DIR, file);
      let content = await fs.readFile(srcPath, "utf-8");

      content = injectResources(content, resourcesHTML, config);
      const canonicalPath = file === "index.html" ? "/" : `/${file}`;
      content = ensureCanonicalLink(
        content,
        canonicalizeUrl(siteUrl, canonicalPath),
      );
      const contentFinal = await expandAllDrops(
        content,
        capsules,
        file,
        globalUsed,
      );

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

  return {
    ...author,
    published,
    received,
    text,
    url,
  };
}

function normalizeWebmentionPerson(item) {
  const author = normalizeWebmentionAuthor(item);
  const url = sanitizeExternalUrl(item.url) || author.authorUrl || null;

  return {
    ...author,
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

function rfc2822(dateStr) {
  return new Date(dateStr).toUTCString();
}

function iso8601(dateStr) {
  return new Date(dateStr).toISOString();
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

function stripMarkdown(markdown = "") {
  return String(markdown)
    .replace(/```[\s\S]*?```/g, "")
    .replace(/`[^`]*`/g, "")
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

function parseLocalizedBodySections(markdown) {
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
    remainder.push(`:::lang ${activeLang}`);
    remainder.push(...sectionLines);
  }

  return {
    sections,
    remainder: remainder.join("\n").trim(),
  };
}

function buildLocalizedVariants(attributes, body, fallbackTitle) {
  const defaultLang = normalizeLanguageKey(
    attributes.defaultLanguage || attributes.defaultLang || "en",
  );
  const declaredLanguages = normalizeLanguageList(
    attributes.languages || attributes.langs,
  );
  const { sections: bodySections, remainder } = parseLocalizedBodySections(body);
  const fallbackBodyFromSections =
    bodySections.get(defaultLang)?.body ||
    (declaredLanguages[0] ? bodySections.get(declaredLanguages[0])?.body : "") ||
    Array.from(bodySections.values())[0]?.body ||
    "";
  const baseBody =
    (bodySections.size > 0 ? fallbackBodyFromSections : "") ||
    remainder ||
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

      // Keep the first translation for a normalized key, but prefer exact base keys.
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
  const lastBuild = posts[0]?.date
    ? rfc2822(posts[0].date)
    : new Date().toUTCString();
  const items = posts
    .map((p) => {
      const link = toAbsoluteUrl(siteUrl, p.url);
      const cats = (p.categories || [])
        .map((c) => `    <category>${xmlEscape(c)}</category>`)
        .join("\n");
      return [
        "  <item>",
        `    <title>${xmlEscape(p.title)}</title>`,
        `    <link>${link}</link>`,
        `    <guid isPermaLink=\"true\">${link}</guid>`,
        `    <pubDate>${rfc2822(p.date)}</pubDate>`,
        cats,
        `    <description>${xmlEscape(p.excerpt || "")}</description>`,
        `    <content:encoded><![CDATA[${p.content || ""}]]></content:encoded>`,
        "  </item>",
      ]
        .filter(Boolean)
        .join("\n");
    })
    .join("\n");

  return `<?xml version=\"1.0\" encoding=\"UTF-8\"?>
<rss version=\"2.0\" xmlns:content=\"http://purl.org/rss/1.0/modules/content/\">
<channel>
  <title>${xmlEscape(meta.title)}</title>
  <link>${toAbsoluteUrl(siteUrl, "/blog/")}</link>
  <description>${xmlEscape(meta.description)}</description>
  <language>${xmlEscape(meta.language)}</language>
  <lastBuildDate>${lastBuild}</lastBuildDate>
${items}
</channel>
</rss>
`;
}

function buildAtom(posts, meta, siteUrl) {
  const updated = posts[0]?.date
    ? iso8601(posts[0].date)
    : new Date().toISOString();
  const entries = posts
    .map((p) => {
      const link = toAbsoluteUrl(siteUrl, p.url);
      const cats = (p.categories || [])
        .map((c) => `    <category term=\"${xmlEscape(c)}\"/>`)
        .join("\n");
      return [
        "  <entry>",
        `    <title>${xmlEscape(p.title)}</title>`,
        `    <id>${link}</id>`,
        `    <link href=\"${link}\"/>`,
        `    <updated>${iso8601(p.date)}</updated>`,
        `    <published>${iso8601(p.date)}</published>`,
        `    <author><name>${xmlEscape(p.author || meta.author)}</name></author>`,
        cats,
        `    <summary type=\"html\">${xmlEscape(p.excerpt || "")}</summary>`,
        `    <content type=\"html\">${xmlEscape(p.content || "")}</content>`,
        "  </entry>",
      ]
        .filter(Boolean)
        .join("\n");
    })
    .join("\n");

  return `<?xml version=\"1.0\" encoding=\"UTF-8\"?>
<feed xmlns=\"http://www.w3.org/2005/Atom\">
  <title>${xmlEscape(meta.title)}</title>
  <id>${toAbsoluteUrl(siteUrl, "/blog/")}</id>
  <updated>${updated}</updated>
  <link href=\"${toAbsoluteUrl(siteUrl, "/blog/atom.xml")}\" rel=\"self\"/>
  <link href=\"${toAbsoluteUrl(siteUrl, "/blog/")}\"/>
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
  const indexWithResources = injectResources(
    indexTemplateRaw,
    resourcesHTML,
    config,
  );
  const postWithResources = injectResources(
    postTemplateRaw,
    resourcesHTML,
    config,
  );

  const indexTemplateSource = await expandAllDrops(
    indexWithResources,
    capsules,
    "blog-index",
    globalUsed,
  );
  const postTemplateSource = await expandAllDrops(
    postWithResources,
    capsules,
    "blog-post",
    globalUsed,
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

        const { localizedVariants } = buildLocalizedVariants(
          attributes,
          body,
          attributes.title,
        );
        const primaryVariant = localizedVariants[0];

        const slug = path.basename(file, ".md");
        const defaultPath = getCanonicalBlogPath(slug);
        const defaultCanonical = canonicalizeUrl(siteUrl, defaultPath);
        const canonicalOverride = canonicalizeUrl(
          siteUrl,
          attributes.canonical,
        );
        const canonicalUrl = canonicalOverride || defaultCanonical;

        let url = canonicalUrl;
        try {
          const parsed = new URL(canonicalUrl);
          if (parsed.origin === siteUrl) {
            url = parsed.pathname;
          }
        } catch {
          url = canonicalUrl;
        }

        const webmentionPayload = await fetchWebmentions(
          canonicalUrl,
          functionsBaseUrl,
        );
        const webmentions = buildWebmentionBuckets(webmentionPayload);
        const hasWebmentions = Object.values(webmentions).some(
          (items) => items.length > 0,
        );
        const syndicateTargets = normalizeSyndicateTargets(
          attributes.syndicate,
        );
        const syndicatedTargets = getSyndicatedTargets(attributes.syndication);
        const pendingTargets = syndicateTargets.filter(
          (target) => !syndicatedTargets.has(target),
        );
        const bridgyPublishTargets = pendingTargets.map(
          (target) => BRIDGY_PUBLISH_TARGETS[target],
        );

        return {
          slug,
          data: {
            title: primaryVariant.title,
            author: primaryVariant.author,
            date: attributes.date,
            categories: primaryVariant.categories,
            content: primaryVariant.content,
            excerpt: primaryVariant.excerpt,
            localizedVariants,
            url,
            siteUrl,
            canonicalUrl,
            syndicationLinks: normalizeSyndication(attributes.syndication),
            webmentions,
            hasWebmentions,
            bridgyPublishTargets,
          },
        };
      },
    );

    for (const entry of postEntries) {
      const filledTemplate = postTemplate(entry.data);
      const outputDir = path.join(BLOG_OUTPUT_DIR, entry.slug);
      await fs.mkdir(outputDir, { recursive: true });
      const outputPath = path.join(outputDir, "index.html");
      await fs.writeFile(outputPath, filledTemplate);

      blogIndex.push(entry.data);
    }
  }

  blogIndex.sort(
    (a, b) => new Date(b.date).getTime() - new Date(a.date).getTime(),
  );

  const indexData = {
    posts: blogIndex,
    siteUrl,
  };
  const filledIndexTemplate = indexTemplate(indexData);
  await fs.writeFile(
    path.join(BLOG_OUTPUT_DIR, "index.html"),
    filledIndexTemplate,
  );

  const recentPosts = blogIndex.slice(0, 3).map((post) => ({
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
