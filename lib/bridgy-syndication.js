export const BRIDGY_WEBMENTION_ENDPOINT = "https://brid.gy/publish/webmention";
export const BRIDGY_PUBLISH_TARGETS = {
  mastodon: "https://brid.gy/publish/mastodon",
  bluesky: "https://brid.gy/publish/bluesky",
};

const TARGET_ALIASES = {
  fediverse: "mastodon",
};

const REQUEST_TIMEOUT_MS = 10000;
const MAX_ERROR_LENGTH = 160;

export function normalizeTarget(value) {
  if (!value) return "";
  const key = String(value).trim().toLowerCase();
  return TARGET_ALIASES[key] || key;
}

export function normalizeSyndicationKey(value) {
  if (!value) return "";
  const raw = String(value).trim();
  if (!raw) return "";
  const normalized = normalizeTarget(raw);
  if (BRIDGY_PUBLISH_TARGETS[normalized]) return normalized;
  return raw;
}

export function normalizeSyndicateTargets(raw) {
  const targets = new Set();
  const addTarget = (value) => {
    const key = normalizeTarget(value);
    if (!key) return;
    targets.add(key);
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
          if (enabled) addTarget(key);
        });
      }
    });
  } else if (raw && typeof raw === "object") {
    Object.entries(raw).forEach(([key, enabled]) => {
      if (enabled) addTarget(key);
    });
  } else if (typeof raw === "string") {
    addTarget(raw);
  }

  return Array.from(targets);
}

export function normalizeSyndicationMap(raw) {
  const map = {};
  if (!raw) return map;

  if (Array.isArray(raw)) {
    raw.forEach((entry) => {
      if (!entry || typeof entry !== "object") return;
      const key = normalizeSyndicationKey(
        entry.site || entry.network || entry.service,
      );
      const url = entry.url || entry.href;
      if (key && url) map[key] = url;
    });
    return map;
  }

  if (typeof raw === "object") {
    Object.entries(raw).forEach(([key, value]) => {
      if (!value) return;
      const normalizedKey = normalizeSyndicationKey(key);
      if (!normalizedKey) return;
      if (typeof value === "string") {
        map[normalizedKey] = value;
        return;
      }
      if (Array.isArray(value) && value[0]) {
        map[normalizedKey] = value[0];
        return;
      }
      if (typeof value === "object") {
        const url = value.url || value.href;
        if (url) map[normalizedKey] = url;
      }
    });
  }

  return map;
}

export function getSyndicationUrl(map, target) {
  if (!map) return "";
  if (map[target]) return map[target];
  if (target === "mastodon" && map.fediverse) return map.fediverse;
  return "";
}

function coerceObject(value) {
  return value && typeof value === "object" && !Array.isArray(value)
    ? { ...value }
    : {};
}

export function normalizeStatusMap(raw) {
  const map = coerceObject(raw);
  Object.entries(map).forEach(([key, value]) => {
    const normalized = normalizeTarget(key);
    if (!normalized) return;
    map[normalized] = String(value || "")
      .trim()
      .toLowerCase();
    if (normalized !== key) delete map[key];
  });
  return map;
}

export function normalizeTimestampMap(raw) {
  const map = coerceObject(raw);
  Object.entries(map).forEach(([key, value]) => {
    const normalized = normalizeTarget(key);
    if (!normalized) return;
    map[normalized] = String(value || "").trim();
    if (normalized !== key) delete map[key];
  });
  return map;
}

export function normalizeErrorMap(raw) {
  const map = coerceObject(raw);
  Object.entries(map).forEach(([key, value]) => {
    const normalized = normalizeTarget(key);
    if (!normalized) return;
    map[normalized] = String(value || "").trim();
    if (normalized !== key) delete map[key];
  });
  return map;
}

export function hasOwn(obj, key) {
  return Object.prototype.hasOwnProperty.call(obj, key);
}

export function truncateError(value) {
  if (!value) return "";
  const trimmed = String(value).trim();
  if (trimmed.length <= MAX_ERROR_LENGTH) return trimmed;
  return `${trimmed.slice(0, MAX_ERROR_LENGTH - 1)}…`;
}

export function summarizeSyndicationResult(result, phase) {
  if (result?.error) return truncateError(`${phase}-${result.error}`);
  if (!result?.ok) {
    return truncateError(`${phase}-status-${result?.status || "unknown"}`);
  }
  if (!result?.syndicatedUrl) return `${phase}-no-url`;
  return "";
}

export async function sendBridgyWebmention({
  source,
  target,
  fetchImpl = fetch,
}) {
  const body = new URLSearchParams({ source, target }).toString();
  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), REQUEST_TIMEOUT_MS);

  try {
    const res = await fetchImpl(BRIDGY_WEBMENTION_ENDPOINT, {
      method: "POST",
      headers: { "Content-Type": "application/x-www-form-urlencoded" },
      body,
      signal: controller.signal,
    });

    const text = await res.text();
    let payload = null;
    try {
      payload = JSON.parse(text);
    } catch {
      payload = null;
    }

    const syndicatedUrl =
      payload?.url ||
      payload?.location ||
      res.headers.get("location") ||
      res.headers.get("Location") ||
      "";

    return { ok: res.ok, status: res.status, syndicatedUrl };
  } catch (err) {
    const error =
      err && err.name === "AbortError" ? "timeout" : "network-error";
    return { ok: false, status: 0, syndicatedUrl: "", error };
  } finally {
    clearTimeout(timeout);
  }
}

function yamlScalar(value) {
  if (typeof value === "string") return JSON.stringify(value);
  if (typeof value === "number" || typeof value === "boolean") {
    return String(value);
  }
  if (value === null) return "null";
  return JSON.stringify(String(value));
}

function isScalar(value) {
  return (
    value === null ||
    value === undefined ||
    typeof value === "string" ||
    typeof value === "number" ||
    typeof value === "boolean"
  );
}

function serializeYamlValue(value, indent) {
  const pad = "  ".repeat(indent);
  if (isScalar(value)) {
    return `${pad}${yamlScalar(value)}`;
  }

  if (Array.isArray(value)) {
    if (value.length === 0) return `${pad}[]`;
    return value
      .map((item) => {
        if (isScalar(item)) {
          return `${pad}- ${yamlScalar(item)}`;
        }
        const nested = serializeYamlValue(item, indent + 1);
        return `${pad}-\n${nested}`;
      })
      .join("\n");
  }

  const entries = Object.entries(value);
  if (entries.length === 0) return `${pad}{}`;
  return entries
    .map(([key, val]) => {
      if (isScalar(val)) {
        return `${pad}${key}: ${yamlScalar(val)}`;
      }
      const nested = serializeYamlValue(val, indent + 1);
      return `${pad}${key}:\n${nested}`;
    })
    .join("\n");
}

export function serializeYaml(attributes) {
  return Object.entries(attributes)
    .filter(([, value]) => value !== undefined)
    .map(([key, value]) => {
      if (isScalar(value)) {
        return `${key}: ${yamlScalar(value)}`;
      }
      const nested = serializeYamlValue(value, 1);
      return `${key}:\n${nested}`;
    })
    .join("\n");
}
