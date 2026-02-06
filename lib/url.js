const ABSOLUTE_URL_RE = /^https?:\/\//i;

function normalizeBaseUrl(baseUrl) {
  return String(baseUrl || "")
    .trim()
    .replace(/\/+$/, "");
}

function coerceUrlValue(value) {
  if (typeof value === "string") return value;
  if (value instanceof URL) return value.toString();
  return "";
}

function looksLikeFilePath(pathname) {
  const last = pathname.split("/").filter(Boolean).pop() || "";
  return /\.[a-z0-9]+$/i.test(last);
}

function normalizePathname(pathname) {
  if (!pathname) return "/";
  let result = pathname.replace(/\/{2,}/g, "/");
  if (!result.startsWith("/")) result = `/${result}`;
  if (result === "/") return result;
  if (result.endsWith("/")) return result;
  if (looksLikeFilePath(result)) return result;
  return `${result}/`;
}

export function toAbsoluteUrl(baseUrl, value) {
  const trimmed = coerceUrlValue(value).trim();
  if (!trimmed) return "";
  if (ABSOLUTE_URL_RE.test(trimmed)) return trimmed;

  const base = normalizeBaseUrl(baseUrl);
  if (!base) return trimmed;

  try {
    return new URL(trimmed, `${base}/`).toString();
  } catch {
    return "";
  }
}

export function canonicalizeUrl(baseUrl, value) {
  const absolute = toAbsoluteUrl(baseUrl, value);
  if (!absolute) return "";

  try {
    const url = new URL(absolute);
    const base = normalizeBaseUrl(baseUrl);
    if (base) {
      const baseUrl = new URL(base);
      if (url.origin === baseUrl.origin) {
        url.pathname = normalizePathname(url.pathname);
      }
    }
    return url.toString();
  } catch {
    return absolute;
  }
}
