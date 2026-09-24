// Resolves the canonical site URL for the current deploy context

const PROD_URL = "https://thayn.me";

export function getSiteUrl() {
  // Canonical URLs must always use the production origin.
  return PROD_URL;
}

export function getCanonicalBlogPath(slug) {
  const clean = String(slug || "")
    .trim()
    .replace(/^\/+|\/+$/g, "");
  if (!clean) return "/blog/";
  return `/blog/${clean}/`;
}
