import fs from "fs/promises";
import path from "path";
import { fileURLToPath } from "url";
import fm from "front-matter";
import { marked } from "marked";
import Handlebars from "handlebars";

const __dirname = path.dirname(fileURLToPath(import.meta.url));

const SRC_DIR = path.join(__dirname, "src");
const PAGES_DIR = path.join(SRC_DIR, "pages");
const CAPSULES_DIR = path.join(SRC_DIR, "capsules");
const STYLES_DIR = path.join(SRC_DIR, "styles");
const SCRIPTS_DIR = path.join(SRC_DIR, "scripts");
const PUBLIC_DIR = path.join(__dirname, "public");
const CONFIG_PATH = path.join(SRC_DIR, "config.json");

const BLOG_DIR = path.join(SRC_DIR, "blog");
const BLOG_POSTS_DIR = path.join(BLOG_DIR, "posts");
const BLOG_TEMPLATES_DIR = path.join(BLOG_DIR, "templates");
const BLOG_OUTPUT_DIR = path.join(PUBLIC_DIR, "blog");
const BLOG_STYLES_FILE = path.join(BLOG_DIR, "styles.css");
const BLOG_SCRIPTS_DIR = path.join(BLOG_DIR, "scripts");

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

async function pathExists(p) {
  try {
    await fs.access(p);
    return true;
  } catch {
    return false;
  }
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

function generateResourcesHTML(config) {
  let html = "";

  if (config.fonts) {
    for (const font of Object.values(config.fonts)) {
      if (!font.url) continue;
      html += `\n    <link rel="preconnect" href="https://fonts.googleapis.com" />`;
      html += `\n    <link rel="preconnect" href="https://fonts.gstatic.com" crossorigin />`;
      html += `\n    <link href="${font.url}" rel="stylesheet" />`;
    }
  }

  if (config.externalResources) {
    for (const resource of Object.values(config.externalResources)) {
      if (resource.type === "stylesheet") {
        html += `\n    <link href="${resource.url}" rel="stylesheet" />`;
      } else if (resource.type === "script") {
        html += `\n    <script src="${resource.url}"${resource.defer ? " defer" : ""}></script>`;
      }
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
  let output = content.replace(placeholder, resourcesHTML);

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

    capsuleHtml = capsuleHtml.replace(/{{\s*([a-zA-Z0-9_-]+)\s*}}/g, (_, key) => {
      return key in dataAttrs ? String(dataAttrs[key]) : "";
    });

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
    const { html: nextHtml, used } = await injectCapsules(html, capsules, `${pageName}#${pass}`);
    used.forEach((u) => globalUsed.add(u));
    if (nextHtml === html) break;
    html = nextHtml;
  }

  if (html.includes("<drop ")) {
    console.warn(`expandAllDrops reached MAX_PASSES for ${pageName}`);
  }

  return html;
}

async function buildPages(capsules, config, globalUsed) {
  const files = await fs.readdir(PAGES_DIR);
  const resourcesHTML = generateResourcesHTML(config);

  await Promise.all(
    files.map(async (file) => {
      const srcPath = path.join(PAGES_DIR, file);
      const destPath = path.join(PUBLIC_DIR, file);
      let content = await fs.readFile(srcPath, "utf-8");

      content = injectResources(content, resourcesHTML, config);
      const contentFinal = await expandAllDrops(content, capsules, file, globalUsed);

      await fs.writeFile(destPath, contentFinal);
    })
  );
}

async function bundleStyles(capsules) {
  const files = (await fs.readdir(STYLES_DIR)).sort();
  const ordered = ["variables.css", "reset.css", "base.css", "home.css"];
  const remaining = files.filter((f) => f.endsWith(".css") && !ordered.includes(f));
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
    for (const file of files) {
      if (!file.endsWith(".js")) continue;
      const js = await fs.readFile(path.join(SCRIPTS_DIR, file), "utf-8");
      output += `\n// === ${file} ===\n${js}`;
    }
  }

  const orderedCapsules = Array.from(usedCapsules).sort();
  for (const capName of orderedCapsules) {
    const cap = capsules[capName];
    if (!cap || !cap.jsPath) continue;
    const js = await fs.readFile(cap.jsPath, "utf-8");
    output += `\n// === Capsule: ${capName} ===\n${js}`;
  }

  await fs.writeFile(path.join(PUBLIC_DIR, "scripts.js"), output);
}

async function copyStatic() {
  await copyDir(path.join(SRC_DIR, "media"), path.join(PUBLIC_DIR, "media"));
  await copyDir(path.join(SRC_DIR, ".well-known"), path.join(PUBLIC_DIR, ".well-known"));
  await copyDir(path.join(SRC_DIR, "i18n"), path.join(PUBLIC_DIR, "i18n"));

  const manifestSrc = path.join(SRC_DIR, "manifest.json");
  if (await pathExists(manifestSrc)) {
    await fs.copyFile(manifestSrc, path.join(PUBLIC_DIR, "manifest.json"));
  }
}

function getSiteUrl() {
  const raw =
    process.env.SITE_URL ||
    process.env.URL ||
    process.env.DEPLOY_PRIME_URL ||
    process.env.DEPLOY_URL ||
    "http://localhost:8888";
  return String(raw).replace(/\/+$/, "");
}

function xmlEscape(s = "") {
  return String(s)
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/\"/g, "&quot;")
    .replace(/'/g, "&apos;");
}

function absUrl(siteUrl, p = "") {
  return p.startsWith("http") ? p : siteUrl + p;
}

function rfc2822(dateStr) {
  return new Date(dateStr).toUTCString();
}

function iso8601(dateStr) {
  return new Date(dateStr).toISOString();
}

function buildRSS(posts, meta, siteUrl) {
  const lastBuild = posts[0]?.date ? rfc2822(posts[0].date) : new Date().toUTCString();
  const items = posts
    .map((p) => {
      const link = absUrl(siteUrl, p.url);
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
  <link>${absUrl(siteUrl, "/blog/")}</link>
  <description>${xmlEscape(meta.description)}</description>
  <language>${xmlEscape(meta.language)}</language>
  <lastBuildDate>${lastBuild}</lastBuildDate>
${items}
</channel>
</rss>
`;
}

function buildAtom(posts, meta, siteUrl) {
  const updated = posts[0]?.date ? iso8601(posts[0].date) : new Date().toISOString();
  const entries = posts
    .map((p) => {
      const link = absUrl(siteUrl, p.url);
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
  <id>${absUrl(siteUrl, "/blog/")}</id>
  <updated>${updated}</updated>
  <link href=\"${absUrl(siteUrl, "/blog/atom.xml")}\" rel=\"self\"/>
  <link href=\"${absUrl(siteUrl, "/blog/")}\"/>
  <author><name>${xmlEscape(meta.author)}</name></author>
${entries}
</feed>
`;
}

async function buildBlog(capsules, config, globalUsed) {
  if (!(await pathExists(BLOG_TEMPLATES_DIR))) return;

  await fs.mkdir(BLOG_OUTPUT_DIR, { recursive: true });

  if (await pathExists(BLOG_STYLES_FILE)) {
    await fs.copyFile(BLOG_STYLES_FILE, path.join(BLOG_OUTPUT_DIR, "styles.css"));
  }

  if (await pathExists(BLOG_SCRIPTS_DIR)) {
    await copyDir(BLOG_SCRIPTS_DIR, path.join(BLOG_OUTPUT_DIR, "scripts"));
  }

  const indexTemplatePath = path.join(BLOG_TEMPLATES_DIR, "index-template.html");
  const postTemplatePath = path.join(BLOG_TEMPLATES_DIR, "post-template.html");

  const indexTemplateRaw = await fs.readFile(indexTemplatePath, "utf-8");
  const postTemplateRaw = await fs.readFile(postTemplatePath, "utf-8");

  const resourcesHTML = generateResourcesHTML(config);
  const indexWithResources = injectResources(indexTemplateRaw, resourcesHTML, config);
  const postWithResources = injectResources(postTemplateRaw, resourcesHTML, config);

  const indexTemplateSource = await expandAllDrops(indexWithResources, capsules, "blog-index", globalUsed);
  const postTemplateSource = await expandAllDrops(postWithResources, capsules, "blog-post", globalUsed);

  const indexTemplate = Handlebars.compile(indexTemplateSource);
  const postTemplate = Handlebars.compile(postTemplateSource);

  let blogIndex = [];

  if (await pathExists(BLOG_POSTS_DIR)) {
    const files = (await fs.readdir(BLOG_POSTS_DIR)).filter((file) => file.endsWith(".md"));

    for (const file of files) {
      const filePath = path.join(BLOG_POSTS_DIR, file);
      const markdown = await fs.readFile(filePath, "utf-8");
      const { attributes, body } = fm(markdown);

      if (attributes.draft && process.env.BLOG_INCLUDE_DRAFTS !== "1") {
        continue;
      }

      if (!attributes.title) {
        attributes.title = path.basename(file, ".md");
      }

      if (!attributes.date || isNaN(new Date(attributes.date).getTime())) {
        const stat = await fs.stat(filePath);
        attributes.date = new Date(stat.mtime).toISOString().slice(0, 10);
      }

      if (attributes.categories && !Array.isArray(attributes.categories)) {
        attributes.categories = [String(attributes.categories)];
      }

      const htmlContent = marked(body);
      const plainBody = body
        .replace(/```[\s\S]*?```/g, "")
        .replace(/`[^`]*`/g, "")
        .replace(/!\[[^\]]*\]\([^\)]+\)/g, "")
        .replace(/\[[^\]]+\]\([^\)]+\)/g, "")
        .replace(/[#>*_~\-]+/g, " ")
        .replace(/\s+/g, " ")
        .trim();
      const rawExcerpt = (attributes.excerpt || plainBody.slice(0, 180)).trim();
      const excerpt = /[.!?…]$/.test(rawExcerpt) ? rawExcerpt : rawExcerpt + "…";

      const outputFileName = file.replace(".md", ".html");
      const data = {
        title: attributes.title,
        author: attributes.author || "Cyan Thayn",
        date: attributes.date,
        categories: attributes.categories || [],
        content: htmlContent,
        excerpt,
        url: `/blog/${outputFileName}`,
        siteUrl: getSiteUrl(),
      };

      const filledTemplate = postTemplate(data);
      const outputPath = path.join(BLOG_OUTPUT_DIR, outputFileName);
      await fs.writeFile(outputPath, filledTemplate);

      blogIndex.push(data);
    }
  }

  blogIndex.sort((a, b) => new Date(b.date).getTime() - new Date(a.date).getTime());

  const indexData = {
    posts: blogIndex,
  };
  const filledIndexTemplate = indexTemplate(indexData);
  await fs.writeFile(path.join(BLOG_OUTPUT_DIR, "index.html"), filledIndexTemplate);

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
    JSON.stringify(recentPosts, null, 2)
  );

  const meta = {
    title: process.env.BLOG_TITLE || "Cyan Thayn Blog",
    description: process.env.BLOG_DESC || "Notes, updates, and experiments.",
    language: process.env.BLOG_LANG || "en-us",
    author: process.env.BLOG_AUTHOR || "Cyan Thayn",
  };

  const rssXml = buildRSS(blogIndex, meta, getSiteUrl());
  await fs.writeFile(path.join(BLOG_OUTPUT_DIR, "rss.xml"), rssXml);

  const atomXml = buildAtom(blogIndex, meta, getSiteUrl());
  await fs.writeFile(path.join(BLOG_OUTPUT_DIR, "atom.xml"), atomXml);
}

async function build() {
  const config = await loadConfig();
  const capsules = await loadCapsules();
  const usedCapsules = new Set();

  await cleanPublic();
  await buildPages(capsules, config, usedCapsules);
  await buildBlog(capsules, config, usedCapsules);
  await bundleStyles(capsules);
  await bundleScripts(usedCapsules, capsules);
  await copyStatic();

  console.log("Build complete -> public/");
}

build().catch((err) => {
  console.error(err);
  process.exit(1);
});
