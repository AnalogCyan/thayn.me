const PROD_URL = "https://thayn.me";

function normalizeUrl(value) {
  return String(value || "")
    .trim()
    .replace(/\/+$/, "");
}

function getDeployContext() {
  return String(
    process.env.CONTEXT ||
      process.env.DEPLOY_CONTEXT ||
      process.env.NETLIFY_CONTEXT ||
      "",
  )
    .trim()
    .toLowerCase();
}

export function isProductionBuild() {
  const context = getDeployContext();
  if (context === "production") {
    return true;
  }
  const envUrl = normalizeUrl(process.env.SITE_URL || process.env.URL || "");
  return envUrl === PROD_URL;
}

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
