// Social preview cards for blog posts: a 1200x630 PNG per post, drawn at
// build time in the site's own look (Nunito, the gradient blobs, a glass
// panel and tag pills).
//
// How it is drawn, and why: satori lays the card out (flexbox, wrapping,
// line clamping) and turns it into an SVG with the text as paths, and
// @resvg/resvg-js rasterises that SVG. Both are MPL-2.0 and maintained,
// add about 30 MB to node_modules, and draw a card in a few hundred
// milliseconds. The other options were worse fits:
// - a headless browser (puppeteer) draws real CSS, but needs a ~170 MB
//   Chromium download on uncached Netlify builds, which the site installs
//   without (PUPPETEER_SKIP_DOWNLOAD=1);
// - a hand-written SVG template plus resvg has no text wrapping, so long
//   titles would need hand-rolled font metrics;
// - an edge or serverless image function adds a runtime path for
//   something that only changes when a post does.
// Satori draws a variable font at its default instance only, so the
// shipped Nunito woff2 files are pinned to the card's weights with
// subset-font (harfbuzz), which the icon pipeline already uses.
//
// Cards are cached by a hash of what they show (title, excerpt, date,
// tags) and of the renderer (this file, the fonts and the avatar), so a
// build only draws cards that changed. The hash also names the file.

import crypto from "node:crypto";
import fs from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
// The same split Google Fonts serves, in fonts.css order
const FONT_FILES = [
  "src/static/fonts/nunito-latin.woff2",
  "src/static/fonts/nunito-latin-ext.woff2",
  "src/static/fonts/nunito-vietnamese.woff2",
  "src/static/fonts/nunito-cyrillic.woff2",
  "src/static/fonts/nunito-cyrillic-ext.woff2",
];
const FONT_WEIGHTS = [600, 800];
// Satori only falls back between differently named fonts, so each file is
// its own family, listed in order
const FAMILIES = FONT_FILES.map((_, i) => `Nunito${i}`);
const AVATAR_FILE = "src/static/media/icon-512.png";
const SELF_FILE = "lib/og-card.js";

export const CARD_WIDTH = 1200;
export const CARD_HEIGHT = 630;
export const OG_CARD_DIR = "/media/og";
const MAX_TAGS = 3;

// Every code point the Nunito files could cover; harfbuzz keeps the ones
// each file has
const CHARSET = [
  [0x20, 0x52f],
  [0x1c80, 0x1c8a],
  [0x1e00, 0x1eff],
  [0x2000, 0x20cf],
  [0x2100, 0x215f],
  [0x2de0, 0x2dff],
  [0xa640, 0xa69f],
]
  .flatMap(([from, to]) =>
    Array.from({ length: to - from + 1 }, (_, i) =>
      String.fromCodePoint(from + i)
    )
  )
  .join("");

// No em or en dash (or their figure and bar cousins) reaches a card: a
// dash joining two words or numbers becomes a hyphen, any other a comma
export function cardText(value) {
  return String(value ?? "")
    .replace(/(?<=[\p{L}\p{N}])[‒-―](?=[\p{L}\p{N}])/gu, "-")
    .replace(/\s*[‒-―]\s*/g, ", ")
    .replace(/\s+/g, " ")
    .trim();
}

export function formatCardDate(dateIso) {
  if (!dateIso) return "";
  const parsed = new Date(dateIso);
  if (Number.isNaN(parsed.getTime())) return "";
  return parsed.toLocaleDateString("en-US", {
    year: "numeric",
    month: "short",
    day: "numeric",
    timeZone: "UTC",
  });
}

// What a card shows, in a stable shape; it is also the cache key's input
export function cardFields({ title, excerpt, dateIso, tags }) {
  return {
    title: cardText(title),
    excerpt: cardText(excerpt),
    date: formatCardDate(dateIso),
    tags: fittingTags((tags || []).map(cardText).filter(Boolean)),
  };
}

// The pill row is one line: tags that would run past it are left off
// whole, by a width estimate for 26px Nunito, rather than cut mid-word
const PILL_ROW_WIDTH = 860;
function fittingTags(tags) {
  const kept = [];
  let width = 0;
  for (const tag of tags.slice(0, MAX_TAGS)) {
    width += tag.length * 14 + 60;
    if (width > PILL_ROW_WIDTH) break;
    kept.push(tag);
  }
  return kept;
}

// The card's alt text says what it says: the title, then the excerpt
export function cardAlt(fields) {
  return fields.excerpt ? `${fields.title}: ${fields.excerpt}` : fields.title;
}

// The cache key for a card: what it shows, plus the renderer's version
export function cardKey(fields, renderer = "") {
  return crypto
    .createHash("sha256")
    .update(JSON.stringify([renderer, fields]))
    .digest("hex")
    .slice(0, 12);
}

let rendererHashPromise;
// When the design, fonts or avatar change, every card's key changes too
export function rendererHash() {
  rendererHashPromise ??= (async () => {
    const hash = crypto.createHash("sha256");
    for (const file of [SELF_FILE, AVATAR_FILE, ...FONT_FILES]) {
      hash.update(file);
      hash.update(await fs.readFile(path.join(ROOT, file)));
    }
    return hash.digest("hex");
  })();
  return rendererHashPromise;
}

let fontsPromise;
function loadFonts() {
  fontsPromise ??= (async () => {
    const { default: subsetFont } = await import("subset-font");
    const sources = await Promise.all(
      FONT_FILES.map((file) => fs.readFile(path.join(ROOT, file)))
    );
    const fonts = [];
    for (const weight of FONT_WEIGHTS) {
      for (const [i, source] of sources.entries()) {
        const data = await subsetFont(source, CHARSET, {
          targetFormat: "sfnt",
          variationAxes: { wght: weight },
        });
        fonts.push({ name: FAMILIES[i], data, weight, style: "normal" });
      }
    }
    return fonts;
  })();
  return fontsPromise;
}

let avatarPromise;
function loadAvatar() {
  avatarPromise ??= fs
    .readFile(path.join(ROOT, AVATAR_FILE))
    .then((bytes) => `data:image/png;base64,${bytes.toString("base64")}`);
  return avatarPromise;
}

// A satori element without React
function h(type, style, ...children) {
  const flat = children.flat().filter((c) => c != null && c !== false);
  const props = {
    style: { display: "flex", boxSizing: "border-box", ...style },
  };
  if (type === "img") {
    props.src = flat[0];
    return { type, props };
  }
  props.children = flat.length === 1 ? flat[0] : flat;
  return { type, props };
}

// The light theme's tokens from variables.css and the
// gradient-background capsule's resting nodes
const T = {
  page: "hsl(205, 30%, 95%)",
  nodes: [
    "hsla(205, 80%, 70%, 0.7)",
    "hsla(265, 80%, 75%, 0.7)",
    "hsla(5, 80%, 80%, 0.6)",
    "hsla(85, 80%, 70%, 0.6)",
  ],
  text: "#111827",
  muted: "#4b5563",
  accent: "#0e6aaa",
  glass:
    "linear-gradient(135deg, rgba(255, 255, 255, 0.78), rgba(255, 255, 255, 0.5))",
  glassBorder: "rgba(255, 255, 255, 0.75)",
  pill: "linear-gradient(135deg, rgba(255, 255, 255, 0.7), rgba(255, 255, 255, 0.35))",
  pillBorder: "rgba(17, 24, 39, 0.12)",
  shadow: "0 18px 40px rgba(17, 24, 39, 0.18)",
};

const BACKGROUND = [
  [8, 10, 55],
  [92, 6, 60],
  [12, 100, 55],
  [88, 100, 60],
]
  .map(
    ([x, y, r], i) =>
      `radial-gradient(circle at ${x}% ${y}%, ${T.nodes[i]} 0%, transparent ${r}%)`
  )
  .join(", ");

function pill(text) {
  return h(
    "div",
    {
      flexShrink: 0,
      alignItems: "center",
      padding: "8px 22px",
      borderRadius: 9999,
      fontSize: 26,
      fontWeight: 600,
      whiteSpace: "nowrap",
      color: T.text,
      backgroundImage: T.pill,
      border: `1.5px solid ${T.pillBorder}`,
    },
    text
  );
}

// Long titles step down in size, and leave the excerpt less room, before
// they would need a fourth line
export function titleLayout(title) {
  const len = title.length;
  if (len <= 18) return { size: 96, excerptLines: 2 };
  if (len <= 34) return { size: 84, excerptLines: 2 };
  if (len <= 60) return { size: 70, excerptLines: 1 };
  if (len <= 90) return { size: 60, excerptLines: 0 };
  return { size: 52, excerptLines: 0 };
}

const clamp = (lines) => ({
  display: "block",
  lineClamp: lines,
  overflow: "hidden",
});

// A light glass sheet over the soft gradient, laid out like a post card on
// the blog index: date and tags, title, excerpt, then the site mark
function card(f, avatar) {
  const { size, excerptLines } = titleLayout(f.title);
  return h(
    "div",
    {
      width: CARD_WIDTH,
      height: CARD_HEIGHT,
      padding: 48,
      backgroundColor: T.page,
      backgroundImage: BACKGROUND,
      fontFamily: FAMILIES.join(", "),
    },
    h(
      "div",
      {
        width: CARD_WIDTH - 96,
        height: CARD_HEIGHT - 96,
        flexDirection: "column",
        justifyContent: "space-between",
        padding: "48px 64px",
        borderRadius: 44,
        border: `2px solid ${T.glassBorder}`,
        backgroundImage: T.glass,
        boxShadow: T.shadow,
        color: T.text,
      },
      h(
        "div",
        { gap: 14, alignItems: "center", overflow: "hidden" },
        f.date && pill(f.date),
        f.tags.map(pill)
      ),
      h(
        "div",
        { flexDirection: "column", gap: 18 },
        h(
          "div",
          {
            ...clamp(3),
            fontSize: size,
            fontWeight: 800,
            lineHeight: 1.08,
            letterSpacing: -1,
            wordBreak: "break-word",
          },
          f.title
        ),
        excerptLines > 0 &&
          f.excerpt &&
          h(
            "div",
            {
              ...clamp(excerptLines),
              fontSize: 32,
              fontWeight: 600,
              lineHeight: 1.35,
              color: T.muted,
            },
            f.excerpt
          )
      ),
      h(
        "div",
        { alignItems: "center", gap: 18 },
        h("img", { width: 64, height: 64, borderRadius: 9999 }, avatar),
        h("div", { fontSize: 30, fontWeight: 800, color: T.accent }, "thayn.me")
      )
    )
  );
}

// Draws a card. Throws when the text has characters Nunito lacks (emoji,
// CJK and the like), since satori would quietly leave them out.
export async function renderCard(fields) {
  const [{ default: satori }, { Resvg }] = await Promise.all([
    import("satori"),
    import("@resvg/resvg-js"),
  ]);
  const [fonts, avatar] = await Promise.all([loadFonts(), loadAvatar()]);
  const missing = [];
  const svg = await satori(card(fields, avatar), {
    width: CARD_WIDTH,
    height: CARD_HEIGHT,
    fonts,
    loadAdditionalAsset: async (code, segment) => {
      missing.push(segment);
      return [];
    },
  });
  if (missing.length) {
    throw new Error(`no glyphs for ${JSON.stringify(missing.join(""))}`);
  }
  return new Resvg(svg).render().asPng();
}

const PNG_SIGNATURE = Buffer.from([
  0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a,
]);
const PNG_END = Buffer.from("IEND");
function isPng(bytes) {
  return (
    bytes.length > 64 &&
    bytes.subarray(0, 8).equals(PNG_SIGNATURE) &&
    bytes.subarray(-8, -4).equals(PNG_END)
  );
}

// Writes a post's card into the build output, drawing it only when the
// cache has no card under the same key. Returns its public path.
export async function buildCard({ fields, slug, publicDir, cacheDir }) {
  const key = cardKey(fields, await rendererHash());
  const name = `${slug}.${key}.png`;
  const cached = cacheDir ? path.join(cacheDir, name) : null;

  let png = cached ? await fs.readFile(cached).catch(() => null) : null;
  // A cached file cut short by an interrupted build is drawn again
  const hit = Boolean(png && isPng(png));
  if (!hit) {
    png = await renderCard(fields);
    if (cached) {
      await fs.mkdir(cacheDir, { recursive: true });
      const partial = `${cached}.${process.pid}.tmp`;
      await fs.writeFile(partial, png);
      await fs.rename(partial, cached);
    }
  }
  const outDir = path.join(publicDir, OG_CARD_DIR);
  await fs.mkdir(outDir, { recursive: true });
  await fs.writeFile(path.join(outDir, name), png);
  return { path: `${OG_CARD_DIR}/${name}`, key, hit };
}

// Drops cached cards no post uses any more, so the cache only holds the
// current ones
export async function pruneCardCache(cacheDir, keepNames) {
  let names;
  try {
    names = await fs.readdir(cacheDir);
  } catch {
    return;
  }
  await Promise.all(
    names
      .filter((name) => name.endsWith(".png") && !keepNames.has(name))
      .map((name) => fs.rm(path.join(cacheDir, name), { force: true }))
  );
}
