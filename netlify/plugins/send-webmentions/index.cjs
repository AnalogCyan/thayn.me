// Sends outbound webmentions for links in recent feed entries.
// Replaces netlify-plugin-webmentions, which crashed on non-HTML targets
// (it parsed a 10MB PDF as HTML and blew the stack in css-select).
// Zero external deps; a failure here must never fail the deploy.

const { isIP } = require("node:net");

const FEED_URL = "https://thayn.me/blog/atom.xml";
const SITE_ORIGIN = "https://thayn.me";
const SITE_HOSTNAME = new URL(SITE_ORIGIN).hostname;
const ENTRY_LIMIT = 20;
const TIMEOUT_MS = 10000;
const MAX_BYTES = 2 * 1024 * 1024;
const DRY_RUN = process.env.WEBMENTIONS_DRY_RUN === "1";
const STORE_NAME = "webmentions";
const STORE_KEY = "sent.json";
const RESEND_AFTER_DAYS = 180;

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
      url: res.url || url,
      headers: res.headers,
      text: Buffer.concat(chunks).toString("utf-8"),
    };
  } finally {
    clearTimeout(timer);
  }
}

function isSameSite(url) {
  try {
    return new URL(url).hostname === SITE_HOSTNAME;
  } catch {
    return false;
  }
}

function decodeEntities(value) {
  return value
    .replace(/&lt;/g, "<")
    .replace(/&gt;/g, ">")
    .replace(/&quot;/g, '"')
    .replace(/&apos;/g, "'")
    .replace(/&#39;/g, "'")
    .replace(/&amp;/g, "&");
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
    // content is post HTML escaped into XML, so hrefs are entity-encoded twice
    const html = decodeEntities(content);
    const links = new Set();
    for (const m of html.matchAll(/href="(https?:\/\/[^"]+)"/g)) {
      links.add(decodeEntities(m[1]));
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
  // Relative endpoints resolve against the page after redirects
  const fromHeader = endpointFromLinkHeader(res.headers.get("link"));
  if (fromHeader) return new URL(fromHeader, res.url).toString();
  const type = res.headers.get("content-type") || "";
  if (!type.startsWith("text/html")) return null;
  return endpointFromHtml(res.text, res.url);
}

// Endpoints come from other people's pages, so the build never posts to
// loopback, private or link-local addresses named by one
function isPublicEndpoint(endpoint) {
  let url;
  try {
    url = new URL(endpoint);
  } catch {
    return false;
  }
  if (url.protocol !== "https:" && url.protocol !== "http:") return false;
  // "localhost." is localhost too
  const host = url.hostname
    .replace(/^\[|\]$/g, "")
    .replace(/\.$/, "")
    .toLowerCase();
  if (
    host === "localhost" ||
    host.endsWith(".localhost") ||
    host.endsWith(".local") ||
    host.endsWith(".internal")
  ) {
    return false;
  }
  if (isIP(host) === 4) {
    const [a, b] = host.split(".").map(Number);
    return !(
      a === 0 ||
      a === 10 ||
      a === 127 ||
      (a === 100 && b >= 64 && b <= 127) ||
      (a === 169 && b === 254) ||
      (a === 172 && b >= 16 && b <= 31) ||
      (a === 192 && b === 168)
    );
  }
  if (isIP(host) === 6) {
    // IPv4-mapped addresses have no business being a public endpoint
    if (host.startsWith("::ffff:")) return false;
    return !(
      host === "::" ||
      host === "::1" ||
      /^f[cd]/.test(host) ||
      /^fe[89ab]/.test(host)
    );
  }
  return true;
}

// Redirects are followed by hand, so each hop gets the same public check
async function sendMention(endpoint, source, target) {
  if (DRY_RUN) return { label: "dry-run", delivered: false };
  let url = endpoint;
  for (let hop = 0; hop < 4; hop += 1) {
    const res = await fetch(url, {
      method: "POST",
      headers: { "content-type": "application/x-www-form-urlencoded" },
      body: new URLSearchParams({ source, target }).toString(),
      signal: AbortSignal.timeout(TIMEOUT_MS),
      redirect: "manual",
    });
    const location = res.headers.get("location");
    if (res.status < 300 || res.status >= 400 || !location) {
      return { label: `HTTP ${res.status}`, delivered: res.ok };
    }
    url = new URL(location, url).toString();
    if (!isPublicEndpoint(url)) {
      return { label: "redirect-to-non-public", delivered: false };
    }
  }
  return { label: "too-many-redirects", delivered: false };
}

// Remembers what has already been delivered, so a deploy that changes nothing
// does not re-POST to every link in the feed. Unavailable storage is not fatal:
// the run falls back to sending, which is what it did before.
async function openLedger() {
  try {
    const { getStore } = await import("@netlify/blobs");
    const store = getStore({ name: STORE_NAME, consistency: "strong" });
    const sent = (await store.get(STORE_KEY, { type: "json" })) || {};
    return {
      has: (key) => Boolean(sent[key]),
      record: (key) => {
        sent[key] = new Date().toISOString();
      },
      save: async () => {
        const cutoff = Date.now() - RESEND_AFTER_DAYS * 86400000;
        const kept = Object.fromEntries(
          Object.entries(sent).filter(
            ([, iso]) =>
              Date.parse(iso) >= cutoff || Number.isNaN(Date.parse(iso))
          )
        );
        await store.setJSON(STORE_KEY, kept);
      },
    };
  } catch (error) {
    console.log(`send-webmentions: no ledger available (${error})`);
    return { has: () => false, record: () => {}, save: async () => {} };
  }
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

    const ledger = await openLedger();
    const seen = new Set();
    let skipped = 0;

    for (const { permalink, links } of extractEntries(feed).slice(
      0,
      ENTRY_LIMIT
    )) {
      for (const target of links) {
        const pair = `${permalink} -> ${target}`;
        if (seen.has(pair) || isSameSite(target)) continue;
        seen.add(pair);
        if (ledger.has(pair)) {
          skipped += 1;
          continue;
        }
        try {
          const endpoint = await discoverEndpoint(target);
          if (!endpoint) {
            console.log(`send-webmentions: no endpoint for ${target}`);
            continue;
          }
          if (!isPublicEndpoint(endpoint)) {
            console.log(
              `send-webmentions: refusing non-public endpoint for ${target}`
            );
            continue;
          }
          const { label, delivered } = await sendMention(
            endpoint,
            permalink,
            target
          );
          if (delivered) ledger.record(pair);
          console.log(`send-webmentions: ${pair} via ${endpoint} (${label})`);
        } catch (error) {
          console.log(`send-webmentions: failed for ${target}: ${error}`);
        }
      }
    }

    if (skipped > 0) {
      console.log(`send-webmentions: ${skipped} already sent, skipped`);
    }
    await ledger.save();
  },
};
