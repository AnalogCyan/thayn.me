const ALLOWED_PROTOCOLS = new Set(["http:", "https:"]);

function toStringValue(value) {
  if (typeof value === "string") return value;
  if (value instanceof URL) return value.toString();
  return "";
}

export function sanitizeExternalUrl(value) {
  const raw = toStringValue(value).trim();
  if (!raw) return null;

  let parsed;
  try {
    parsed = new URL(raw);
  } catch {
    return null;
  }

  if (!ALLOWED_PROTOCOLS.has(parsed.protocol)) {
    return null;
  }

  return parsed.toString();
}
