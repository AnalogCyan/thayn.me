// Sends outbound webmentions for links in recent feed entries.
// Replaces netlify-plugin-webmentions, which crashed on non-HTML targets
// (it parsed a 10MB PDF as HTML and blew the stack in css-select).
// Zero external deps; a failure here must never fail the deploy.

const dns = require("node:dns");
const { BlockList, isIP } = require("node:net");

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
// Pages without an endpoint are looked at again sooner, in case they add one
const RECHECK_AFTER_DAYS = 30;
const NO_ENDPOINT = "no-endpoint ";
const MAX_REDIRECTS = 4;

// Special-purpose ranges (RFC 6890 and the IANA registries), plus anything
// that embeds an IPv4 address in IPv6 and so could smuggle one of these in.
// Two lists, because BlockList also tests IPv4 against ::ffff:0:0/96.
const NON_PUBLIC_V4 = new BlockList();
const NON_PUBLIC_V6 = new BlockList();
for (const [net, prefix] of [
  ["0.0.0.0", 8],
  ["10.0.0.0", 8],
  ["100.64.0.0", 10],
  ["127.0.0.0", 8],
  ["169.254.0.0", 16],
  ["172.16.0.0", 12],
  ["192.0.0.0", 24],
  ["192.0.2.0", 24],
  ["192.88.99.0", 24],
  ["192.168.0.0", 16],
  ["198.18.0.0", 15],
  ["198.51.100.0", 24],
  ["203.0.113.0", 24],
  ["224.0.0.0", 4],
  ["240.0.0.0", 4],
]) {
  NON_PUBLIC_V4.addSubnet(net, prefix, "ipv4");
}
for (const [net, prefix] of [
  ["::", 96],
  ["::ffff:0:0", 96],
  ["64:ff9b::", 96],
  ["64:ff9b:1::", 48],
  ["100::", 64],
  ["2001::", 32],
  ["2001:2::", 48],
  ["2001:db8::", 32],
  ["2002::", 16],
  ["fc00::", 7],
  ["fe80::", 10],
  ["fec0::", 10],
  ["ff00::", 8],
]) {
  NON_PUBLIC_V6.addSubnet(net, prefix, "ipv6");
}

function isPublicAddress(address) {
  const family = isIP(address);
  if (family === 4) return !NON_PUBLIC_V4.check(address, "ipv4");
  if (family === 6) return !NON_PUBLIC_V6.check(address, "ipv6");
  return false;
}

// Endpoints come from other people's pages, so the build never talks to
// loopback, private or link-local addresses named by one. Every address the
// name resolves to must be public.
async function isPublicEndpoint(endpoint) {
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
  if (isIP(host) !== 0) return isPublicAddress(host);
  let addresses;
  try {
    addresses = await dns.promises.lookup(host, { all: true });
  } catch {
    return false;
  }
  return (
    addresses.length > 0 &&
    addresses.every(({ address }) => isPublicAddress(address))
  );
}

// Redirects are followed by hand so each hop gets the public check
async function fetchWithCap(url, { htmlOnly = false } = {}) {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), TIMEOUT_MS);
  try {
    let res;
    for (let hop = 0; ; hop += 1) {
      if (!(await isPublicEndpoint(url))) {
        throw new Error(`refusing non-public address ${url}`);
      }
      res = await fetch(url, {
        signal: controller.signal,
        headers: { "user-agent": "thayn.me send-webmentions" },
        redirect: "manual",
      });
      const location = res.headers.get("location");
      if (res.status < 300 || res.status >= 400 || !location) break;
      if (hop >= MAX_REDIRECTS) throw new Error(`too many redirects ${url}`);
      await res.body?.cancel();
      url = new URL(location, url).toString();
    }
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
      status: res.status,
      url,
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

function hasWebmentionRel(value) {
  return value.toLowerCase().split(/\s+/).includes("webmention");
}

// Returns the raw URL reference, which may be "" for the page itself.
// Scanned with indexOf: a regex here backtracks quadratically on a header
// full of unclosed "<"
function endpointFromLinkHeader(header) {
  if (!header) return null;
  let start = header.indexOf("<");
  while (start !== -1) {
    const end = header.indexOf(">", start + 1);
    if (end === -1) break;
    const next = header.indexOf("<", end + 1);
    const params = header.slice(end + 1, next === -1 ? undefined : next);
    const rel = params.match(/;\s*rel\s*=\s*(?:"([^"]*)"|([^\s;,]+))/i);
    if (rel && hasWebmentionRel(rel[1] ?? rel[2])) {
      return header.slice(start + 1, end).trim();
    }
    start = next;
  }
  return null;
}

function parseAttributes(source) {
  const attrs = Object.create(null);
  for (const m of source.matchAll(
    /([^\s"'=<>/]+)(?:\s*=\s*(?:"([^"]*)"|'([^']*)'|([^\s"'=<>`]+)))?/g
  )) {
    const name = m[1].toLowerCase();
    if (!(name in attrs)) attrs[name] = m[2] ?? m[3] ?? m[4] ?? "";
  }
  return attrs;
}

// End of the tag whose attributes start at `from`: the first ">" outside a
// quoted value, or -1 when the tag runs to the end of the document
function tagEnd(html, from) {
  let quote = "";
  for (let i = from; i < html.length; i += 1) {
    const ch = html[i];
    if (quote) {
      if (ch === quote) quote = "";
    } else if (ch === '"' || ch === "'") {
      quote = ch;
    } else if (ch === ">") {
      return i;
    }
  }
  return -1;
}

// First <link> or <a> in document order with rel webmention and an href.
// One pass that never revisits a character; target pages are untrusted and up
// to MAX_BYTES, so a backtracking regex could stall the deploy.
function endpointFromHtml(html) {
  const tagName = /(link|a)(?!\w)/iy;
  let i = html.indexOf("<");
  while (i !== -1) {
    if (html.startsWith("<!--", i)) {
      const close = html.indexOf("-->", i + 4);
      if (close === -1) return null;
      i = html.indexOf("<", close + 3);
      continue;
    }
    tagName.lastIndex = i + 1;
    const name = tagName.exec(html);
    if (!name) {
      i = html.indexOf("<", i + 1);
      continue;
    }
    const from = i + 1 + name[0].length;
    const end = tagEnd(html, from);
    if (end === -1) return null;
    const attrs = parseAttributes(html.slice(from, end));
    if ("href" in attrs && attrs.rel && hasWebmentionRel(attrs.rel)) {
      return decodeEntities(attrs.href.trim());
    }
    i = html.indexOf("<", end + 1);
  }
  return null;
}

async function discoverEndpoint(target) {
  const res = await fetchWithCap(target, { htmlOnly: true });
  if (!res.ok) throw new Error(`target returned HTTP ${res.status}`);
  let ref = endpointFromLinkHeader(res.headers.get("link"));
  const type = res.headers.get("content-type") || "";
  if (ref === null && type.startsWith("text/html")) {
    ref = endpointFromHtml(res.text);
  }
  // Relative endpoints resolve against the page after redirects
  return ref === null ? null : new URL(ref, res.url).toString();
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
    // 303 means accepted, with the result elsewhere
    if (res.status === 303) {
      return { label: "HTTP 303", delivered: true };
    }
    const location = res.headers.get("location");
    if (res.status < 300 || res.status >= 400 || !location) {
      return { label: `HTTP ${res.status}`, delivered: res.ok };
    }
    url = new URL(location, url).toString();
    if (!(await isPublicEndpoint(url))) {
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
      has: (key) => Boolean(sent[key] || sent[NO_ENDPOINT + key]),
      record: (key) => {
        sent[key] = new Date().toISOString();
      },
      save: async () => {
        const cutoff = (days) => Date.now() - days * 86400000;
        const kept = Object.fromEntries(
          Object.entries(sent).filter(
            ([key, iso]) =>
              Date.parse(iso) >=
                cutoff(
                  key.startsWith(NO_ENDPOINT)
                    ? RECHECK_AFTER_DAYS
                    : RESEND_AFTER_DAYS
                ) || Number.isNaN(Date.parse(iso))
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
            if (!DRY_RUN) ledger.record(NO_ENDPOINT + pair);
            console.log(`send-webmentions: no endpoint for ${target}`);
            continue;
          }
          if (!(await isPublicEndpoint(endpoint))) {
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
      console.log(
        `send-webmentions: ${skipped} already sent or without an endpoint, skipped`
      );
    }
    // Losing the ledger only means some mentions are sent again next time
    try {
      await ledger.save();
    } catch (error) {
      console.log(`send-webmentions: ledger save failed (${error})`);
    }
  },
};

// Non-enumerable, so Netlify's loader, which rejects any export that is not
// an event handler, never sees these. Tests reach them through require().
Object.defineProperty(module.exports, "internals", {
  value: {
    isPublicAddress,
    isPublicEndpoint,
    fetchWithCap,
    endpointFromLinkHeader,
    endpointFromHtml,
    discoverEndpoint,
    sendMention,
  },
});
