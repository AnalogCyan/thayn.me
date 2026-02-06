const ALLOWED_HOST = "thayn.me";

function isPrivateMention(item) {
  if (!item) return false;
  const candidates = [
    item["wm-private"],
    item.wmPrivate,
    item.private,
    item.visibility,
  ];

  return candidates.some((value) => {
    if (value === true || value === 1) return true;
    if (typeof value !== "string") return false;
    const normalized = value.trim().toLowerCase();
    return (
      normalized === "1" ||
      normalized === "true" ||
      normalized === "private" ||
      normalized === "yes"
    );
  });
}

function sanitizeMentionsPayload(payload) {
  const base = payload && typeof payload === "object" ? payload : {};
  const items = Array.isArray(base.children) ? base.children : [];
  // Keep private mentions out of all public responses, including token-backed fetches.
  const children = items.filter((item) => !isPrivateMention(item));
  return { ...base, children };
}

function countMentions(payload) {
  const sanitized = sanitizeMentionsPayload(payload);
  return sanitized.children.length;
}

function isAllowedTarget(target) {
  let url;
  try {
    url = new URL(target);
  } catch {
    return false;
  }

  if (!["http:", "https:"].includes(url.protocol)) return false;
  const host = url.hostname.toLowerCase();
  return host === ALLOWED_HOST || host.endsWith(`.${ALLOWED_HOST}`);
}

export const handler = async (event) => {
  if (event.httpMethod !== "GET") {
    return {
      statusCode: 405,
      headers: { Allow: "GET" },
      body: "Method Not Allowed",
    };
  }

  const target = event.queryStringParameters?.target;
  const mode = String(event.queryStringParameters?.mode || "").toLowerCase();
  const wantsCount =
    mode === "count" || event.queryStringParameters?.count === "1";
  if (!target || !isAllowedTarget(target)) {
    return {
      statusCode: 400,
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ error: "Invalid target" }),
    };
  }

  const apiUrl = new URL("https://webmention.io/api/mentions.jf2");
  apiUrl.searchParams.set("target", target);
  const token = process.env.WEBMENTION_IO_TOKEN;
  if (token) {
    apiUrl.searchParams.set("token", token);
  }

  try {
    const res = await fetch(apiUrl.toString(), {
      headers: { Accept: "application/json" },
    });

    if (!res.ok) {
      const upstreamBody = await res.text();
      console.warn("webmentions upstream error", {
        status: res.status,
        body: upstreamBody.slice(0, 300),
      });
      return {
        statusCode: res.status,
        headers: {
          "Content-Type": "application/json",
          "Cache-Control": "public, max-age=30",
        },
        body: JSON.stringify({ error: "Webmention upstream request failed" }),
      };
    }

    const payload = await res.json();
    const sanitizedPayload = sanitizeMentionsPayload(payload);
    if (!wantsCount) {
      return {
        statusCode: 200,
        headers: {
          "Content-Type": "application/json",
          "Cache-Control": "public, max-age=30",
        },
        body: JSON.stringify(sanitizedPayload),
      };
    }

    return {
      statusCode: 200,
      headers: {
        "Content-Type": "application/json",
        "Cache-Control": "public, max-age=30",
      },
      body: JSON.stringify({ count: countMentions(sanitizedPayload) }),
    };
  } catch {
    return {
      statusCode: 502,
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ error: "Upstream fetch failed" }),
    };
  }
};
