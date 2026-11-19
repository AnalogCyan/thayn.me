// What Bridgy Publish posts for a blog post. Bluesky gets the blurb alone
// (p-summary, so the article card stays); Mastodon gets title, blurb, link
// and hashtags (e-bridgy-mastodon-content).

// Bluesky cuts at 300 graphemes and then appends the link; leave headroom
export const SOCIAL_BLURB_LIMIT = 280;

const segmenter = new Intl.Segmenter("en", { granularity: "grapheme" });

export function countGraphemes(text) {
  return [...segmenter.segment(String(text))].length;
}

function clean(value) {
  return typeof value === "string" ? value.replace(/\s+/g, " ").trim() : "";
}

// social, then excerpt, then title
export function toSocialBlurb(attributes = {}) {
  return (
    clean(attributes.social) ||
    clean(attributes.excerpt) ||
    clean(attributes.title)
  );
}

export function socialBlurbWarning(blurb, limit = SOCIAL_BLURB_LIMIT) {
  const length = countGraphemes(blurb);
  if (length <= limit) return null;
  return `social blurb is ${length} graphemes, over ${limit}; Bluesky will cut it and append the link`;
}

// Strips a leading #, drops duplicates, and throws on anything Mastodon
// would not read as one hashtag
export function normalizeHashtags(value, where = "front matter") {
  if (value == null || value === "") return [];
  const list = Array.isArray(value) ? value : [value];
  const seen = new Set();
  const tags = [];
  for (const raw of list) {
    const trimmed = String(raw ?? "").trim();
    if (!trimmed) continue;
    const tag = trimmed.replace(/^#+/, "");
    if (!/^[\p{L}\p{N}_]+$/u.test(tag)) {
      throw new Error(
        `hashtags in ${where}: "${raw}" is not a single hashtag (letters, digits and _ only, no spaces)`
      );
    }
    const key = tag.toLowerCase();
    if (seen.has(key)) continue;
    seen.add(key);
    tags.push(tag);
  }
  return tags;
}

export function toSocialFields(attributes = {}, where) {
  const blurb = toSocialBlurb(attributes);
  const hashtags = normalizeHashtags(attributes.hashtags, where);
  return {
    socialBlurb: blurb,
    // A title-only post would repeat its title on Mastodon
    socialMastodonBlurb: blurb === clean(attributes.title) ? "" : blurb,
    socialHashtags: hashtags.map((tag) => `#${tag}`).join(" "),
    socialWarning: socialBlurbWarning(blurb),
  };
}
