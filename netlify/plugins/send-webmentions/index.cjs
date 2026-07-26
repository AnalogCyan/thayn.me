// Sends outbound webmentions for links in recent feed entries.
// Replaces netlify-plugin-webmentions, which crashed on non-HTML targets
// (it parsed a 10MB PDF as HTML and blew the stack in css-select).
// Zero external deps; a failure here must never fail the deploy.

const FEED_URL = "https://thayn.me/blog/atom.xml";
const SITE_ORIGIN = "https://thayn.me";
const ENTRY_LIMIT = 20;
const TIMEOUT_MS = 10000;
const MAX_BYTES = 2 * 1024 * 1024;
const DRY_RUN = process.env.WEBMENTIONS_DRY_RUN === "1";

async function fetchWithCap(url, { htmlOnly = false } = {}) {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), TIMEOUT_MS);
  try {
    const res = await fetch(url, {
      signal: controller.signal,
      headers: { "user-agent": "thayn.me send-webmentions" },
      redirect: "follow",
    });
    const type = res.headers.get("content-type") || "";
    const chunks = [];
    let size = 0;
    if (res.body && (!htmlOnly || type.startsWith("text/html"))) {
      for await (const chunk of res.body) {
        size += chunk.length;
        if (size > MAX_BYTES) break;
        chunks.push(chunk);
      }
    }
    controller.abort();
    return {
      ok: res.ok,
      headers: res.headers,
      text: Buffer.concat(chunks).toString("utf-8"),
    };
  } finally {
    clearTimeout(timer);
  }
}

function extractEntries(xml) {
  const entries = [];
  for (const match of xml.matchAll(/<entry>([\s\S]*?)<\/entry>/g)) {
    const body = match[1];
    const permalink = body.match(/<link href="([^"]+)"\/>/)?.[1];
    const content = body.match(
      /<content type="html">([\s\S]*?)<\/content>/
    )?.[1];
    if (!permalink || !content) continue;
    const links = new Set();
    for (const m of content.matchAll(/href=&quot;(https?:\/\/[^&]+)&quot;/g)) {
      links.add(m[1]);
    }
    for (const m of content.matchAll(/href="(https?:\/\/[^"]+)"/g)) {
      links.add(m[1]);
    }
    entries.push({ permalink, links: [...links] });
  }
  return entries;
}

function endpointFromLinkHeader(header) {
  if (!header) return null;
  for (const part of header.split(",")) {
    if (/rel="?webmention"?/.test(part)) {
      return part.match(/<([^>]+)>/)?.[1] || null;
    }
  }
  return null;
}

function endpointFromHtml(html, baseUrl) {
  const tag =
    html.match(/<link[^>]+rel="[^"]*webmention[^"]*"[^>]*>/i) ||
    html.match(/<a[^>]+rel="[^"]*webmention[^"]*"[^>]*>/i);
  if (!tag) return null;
  const href = tag[0].match(/href="([^"]+)"/i)?.[1];
  return href ? new URL(href, baseUrl).toString() : null;
}

async function discoverEndpoint(target) {
  const res = await fetchWithCap(target, { htmlOnly: true });
  if (!res.ok) return null;
  const fromHeader = endpointFromLinkHeader(res.headers.get("link"));
  if (fromHeader) return new URL(fromHeader, target).toString();
  const type = res.headers.get("content-type") || "";
  if (!type.startsWith("text/html")) return null;
  return endpointFromHtml(res.text, target);
}

async function sendMention(endpoint, source, target) {
  if (DRY_RUN) return "dry-run";
  const res = await fetch(endpoint, {
    method: "POST",
    headers: { "content-type": "application/x-www-form-urlencoded" },
    body: new URLSearchParams({ source, target }).toString(),
    signal: AbortSignal.timeout(TIMEOUT_MS),
  });
  return `HTTP ${res.status}`;
}

module.exports = {
  onSuccess: async ({ constants }) => {
    if (constants.IS_LOCAL || process.env.CONTEXT !== "production") {
      console.log("send-webmentions: skipping (not a production build)");
      return;
    }

    let feed;
    try {
      const res = await fetchWithCap(FEED_URL);
      if (!res.ok) throw new Error(`feed returned HTTP ${res.status}`);
      feed = res.text;
    } catch (error) {
      console.log(`send-webmentions: feed fetch failed, skipping: ${error}`);
      return;
    }

    const seen = new Set();
    for (const { permalink, links } of extractEntries(feed).slice(
      0,
      ENTRY_LIMIT
    )) {
      for (const target of links) {
        if (seen.has(target) || target.startsWith(SITE_ORIGIN)) continue;
        seen.add(target);
        try {
          const endpoint = await discoverEndpoint(target);
          if (!endpoint) {
            console.log(`send-webmentions: no endpoint for ${target}`);
            continue;
          }
          const result = await sendMention(endpoint, permalink, target);
          console.log(
            `send-webmentions: ${permalink} -> ${endpoint} (${result})`
          );
        } catch (error) {
          console.log(`send-webmentions: failed for ${target}: ${error}`);
        }
      }
    }
  },
};
