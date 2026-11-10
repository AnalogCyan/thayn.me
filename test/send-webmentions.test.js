// The webmention sender talks to whatever other people's pages name, from
// inside the build. fetch and DNS are stubbed: nothing here leaves the box.

import assert from "node:assert/strict";
import dns from "node:dns";
import test, { afterEach, mock } from "node:test";
import plugin from "../netlify/plugins/send-webmentions/index.cjs";

const {
  isPublicAddress,
  isPublicEndpoint,
  fetchWithCap,
  endpointFromLinkHeader,
  endpointFromHtml,
  discoverEndpoint,
  sendMention,
} = plugin.internals;

afterEach(() => mock.restoreAll());

function stubDns(table) {
  return mock.method(dns.promises, "lookup", async (host) => {
    if (!(host in table)) {
      throw Object.assign(new Error(`ENOTFOUND ${host}`), {
        code: "ENOTFOUND",
      });
    }
    return table[host].map((address) => ({
      address,
      family: address.includes(":") ? 6 : 4,
    }));
  });
}

// routes: url -> Response factory. Anything else is a test failure.
function stubFetch(routes) {
  return mock.method(globalThis, "fetch", async (url, init) => {
    assert.equal(init.redirect, "manual", `followed redirects for ${url}`);
    const route = routes[url];
    assert.ok(route, `unexpected fetch ${url}`);
    return route(init);
  });
}

const html =
  (body, headers = {}) =>
  () =>
    new Response(body, {
      status: 200,
      headers: { "content-type": "text/html; charset=utf-8", ...headers },
    });
const redirect =
  (location, status = 302) =>
  () =>
    new Response(null, { status, headers: { location } });

test("Netlify sees only event handlers on the plugin", () => {
  assert.deepEqual(Object.keys(plugin), ["onSuccess"]);
  assert.equal(typeof plugin.onSuccess, "function");
});

test("non-public addresses are refused", () => {
  for (const address of [
    "0.0.0.0",
    "10.1.2.3",
    "100.64.0.1",
    "127.0.0.1",
    "169.254.169.254",
    "172.16.0.1",
    "172.31.255.255",
    "192.0.0.8",
    "192.0.2.1",
    "192.168.1.1",
    "198.18.0.1",
    "198.19.255.255",
    "203.0.113.9",
    "224.0.0.1",
    "239.255.255.250",
    "255.255.255.255",
    "::",
    "::1",
    "::7f00:1",
    "::127.0.0.1",
    "::ffff:127.0.0.1",
    "::ffff:7f00:1",
    "::ffff:8.8.8.8",
    "64:ff9b::7f00:1",
    "64:ff9b::a9fe:a9fe",
    "2001:db8::1",
    "2001:0:4136:e378:8000:63bf:3fff:fdd2",
    "2002:7f00:1::1",
    "fc00::1",
    "fd12:3456::1",
    "fe80::1",
    "fec0::1",
    "ff02::1",
    "not-an-ip",
  ]) {
    assert.equal(isPublicAddress(address), false, address);
  }
});

test("public addresses are allowed", () => {
  for (const address of [
    "1.1.1.1",
    "8.8.8.8",
    "172.15.0.1",
    "172.32.0.1",
    "198.20.0.1",
    "100.128.0.1",
    "2606:4700:4700::1111",
    "2a00:1450:4001::200e",
  ]) {
    assert.equal(isPublicAddress(address), true, address);
  }
});

test("literal hosts are checked without DNS, in every spelling", async () => {
  const lookup = stubDns({});
  for (const url of [
    "http://127.0.0.1/",
    "http://0x7f.1/",
    "http://2130706433/",
    "http://[::1]/",
    "http://[::7f00:1]/",
    "http://[::ffff:127.0.0.1]/",
    "http://[64:ff9b::169.254.169.254]/",
    "https://localhost./",
    "https://foo.localhost/",
    "https://printer.local/",
    "https://metadata.google.internal/",
    "ftp://example.com/",
    "file:///etc/passwd",
    "not a url",
  ]) {
    assert.equal(await isPublicEndpoint(url), false, url);
  }
  assert.equal(await isPublicEndpoint("https://1.1.1.1/wm"), true);
  assert.equal(lookup.mock.callCount(), 0);
});

test("a public name that resolves anywhere private is refused", async () => {
  stubDns({
    "good.example": ["93.184.216.34", "2606:2800:220:1::1"],
    "loop.example": ["127.0.0.1"],
    "meta.example": ["169.254.169.254"],
    "mixed.example": ["93.184.216.34", "10.0.0.5"],
    "mapped.example": ["::ffff:127.0.0.1"],
    "empty.example": [],
  });
  assert.equal(await isPublicEndpoint("https://good.example/wm"), true);
  for (const host of [
    "loop.example",
    "meta.example",
    "mixed.example",
    "mapped.example",
    "empty.example",
    "missing.example",
  ]) {
    assert.equal(await isPublicEndpoint(`https://${host}/wm`), false, host);
  }
});

test("Link headers: first rel token webmention wins, quoted or not", () => {
  assert.equal(
    endpointFromLinkHeader('<https://a.example/wm>; rel="foo webmention bar"'),
    "https://a.example/wm"
  );
  assert.equal(endpointFromLinkHeader("</wm>; rel=webmention"), "/wm");
  assert.equal(
    endpointFromLinkHeader(
      '<https://a.example/x?a=1,2>; rel="stylesheet", </second>; rel="WebMention", </third>; rel=webmention'
    ),
    "/second"
  );
  assert.equal(endpointFromLinkHeader('<>; rel="webmention"'), "");
  assert.equal(endpointFromLinkHeader('</nope>; rel="webmentions"'), null);
  assert.equal(endpointFromLinkHeader('</nope>; rel="not-webmention"'), null);
  assert.equal(endpointFromLinkHeader(""), null);
  assert.equal(endpointFromLinkHeader(null), null);
});

test("HTML: first <link> or <a> in document order, any quoting", () => {
  assert.equal(
    endpointFromHtml(
      `<a href="/from-a" rel="webmention">x</a><link rel="webmention" href="/from-link">`
    ),
    "/from-a"
  );
  assert.equal(
    endpointFromHtml(`<link rel='me webmention' href='/single'>`),
    "/single"
  );
  assert.equal(
    endpointFromHtml(`<link href=/unquoted rel=webmention>`),
    "/unquoted"
  );
  assert.equal(endpointFromHtml(`<link rel="webmention" href="">`), "");
  assert.equal(
    endpointFromHtml(`<link rel="webmention" href="/wm?a=1&amp;b=2" />`),
    "/wm?a=1&b=2"
  );
  assert.equal(
    endpointFromHtml(
      `<!-- <link rel="webmention" href="/commented"> --><link rel="webmention"><link title="a > b" rel="webmention" href="/real">`
    ),
    "/real"
  );
  assert.equal(
    endpointFromHtml(
      `<abbr rel="webmention" href="/no"><LINK REL="Webmention" HREF="/caps">`
    ),
    "/caps"
  );
  assert.equal(endpointFromHtml(`<link rel="webmentions" href="/no">`), null);
  assert.equal(endpointFromHtml(`<p>nothing</p>`), null);
});

test("discovery stays linear on hostile pages and headers", () => {
  const n = 200_000;
  const cases = [
    () => endpointFromHtml("<!--".repeat(n)),
    () => endpointFromHtml("<a ".repeat(n)),
    () => endpointFromHtml('<a "'.repeat(n)),
    () => endpointFromHtml("<".repeat(n) + "<p>"),
    () => endpointFromLinkHeader("<" + "<=".repeat(n)),
    () => endpointFromLinkHeader("<a>;".repeat(n)),
  ];
  for (const run of cases) {
    const started = performance.now();
    assert.equal(run(), null);
    assert.ok(performance.now() - started < 500, run.toString());
  }
});

test("an unclosed comment or tag hides everything after it", () => {
  assert.equal(
    endpointFromHtml(`<!-- <link rel="webmention" href="/no">`),
    null
  );
  assert.equal(
    endpointFromHtml(`<a title="open <link rel=webmention href=/no>`),
    null
  );
  assert.equal(
    endpointFromHtml(`<p><!-- x --><link rel="webmention" href="/yes"><p>`),
    "/yes"
  );
});

test("discovery prefers the Link header and resolves after redirects", async () => {
  stubDns({ "a.example": ["93.184.216.34"], "b.example": ["93.184.216.35"] });
  stubFetch({
    "https://a.example/post": redirect("https://b.example/moved/post", 301),
    "https://b.example/moved/post": html(
      `<link rel="webmention" href="/from-html">`,
      { link: '<wm>; rel="webmention"' }
    ),
  });
  assert.equal(
    await discoverEndpoint("https://a.example/post"),
    "https://b.example/moved/wm"
  );
});

test("an empty href makes the page its own endpoint", async () => {
  stubDns({ "a.example": ["93.184.216.34"] });
  stubFetch({
    "https://a.example/post?x=1": html(`<a rel="webmention" href="">wm</a>`),
  });
  assert.equal(
    await discoverEndpoint("https://a.example/post?x=1"),
    "https://a.example/post?x=1"
  );
});

test("a page without an endpoint is not an error, a failed fetch is", async () => {
  stubDns({ "a.example": ["93.184.216.34"] });
  stubFetch({
    "https://a.example/plain": html("<p>hi</p>"),
    "https://a.example/gone": () => new Response("no", { status: 404 }),
  });
  assert.equal(await discoverEndpoint("https://a.example/plain"), null);
  await assert.rejects(discoverEndpoint("https://a.example/gone"), /404/);
});

test("the discovery GET checks every redirect hop", async () => {
  stubDns({
    "a.example": ["93.184.216.34"],
    "sneaky.example": ["127.0.0.1"],
  });
  const fetch = stubFetch({
    "https://a.example/post": redirect("http://169.254.169.254/latest/"),
    "https://a.example/post2": redirect("https://sneaky.example/"),
  });
  await assert.rejects(
    fetchWithCap("https://a.example/post"),
    /non-public address http:\/\/169\.254\.169\.254/
  );
  await assert.rejects(
    fetchWithCap("https://a.example/post2"),
    /non-public address https:\/\/sneaky\.example/
  );
  assert.equal(fetch.mock.callCount(), 2);
});

test("the discovery GET never fetches a non-public target", async () => {
  stubDns({ "sneaky.example": ["10.0.0.1"] });
  const fetch = stubFetch({});
  await assert.rejects(discoverEndpoint("https://sneaky.example/"));
  assert.equal(fetch.mock.callCount(), 0);
});

test("the discovery GET gives up on a redirect loop", async () => {
  stubDns({ "a.example": ["93.184.216.34"] });
  stubFetch({
    "https://a.example/a": redirect("/b"),
    "https://a.example/b": redirect("/a"),
  });
  await assert.rejects(fetchWithCap("https://a.example/a"), /too many/);
});

test("a 303 from the endpoint counts as delivered", async () => {
  stubFetch({
    "https://a.example/wm": () =>
      new Response(null, { status: 303, headers: { location: "/status/1" } }),
  });
  assert.deepEqual(
    await sendMention("https://a.example/wm", "https://thayn.me/s", "t"),
    { label: "HTTP 303", delivered: true }
  );
});

test("a POST redirect to a private name is refused", async () => {
  stubDns({ "inside.example": ["192.168.0.10"] });
  const fetch = stubFetch({
    "https://a.example/wm": redirect("https://inside.example/wm", 307),
  });
  assert.deepEqual(
    await sendMention("https://a.example/wm", "https://thayn.me/s", "t"),
    { label: "redirect-to-non-public", delivered: false }
  );
  assert.equal(fetch.mock.callCount(), 1);
});

test("a POST follows a public redirect and reports the final status", async () => {
  stubDns({ "b.example": ["93.184.216.35"] });
  stubFetch({
    "https://a.example/wm": redirect("https://b.example/wm", 308),
    "https://b.example/wm": (init) => {
      assert.equal(init.method, "POST");
      assert.equal(
        init.body,
        "source=https%3A%2F%2Fthayn.me%2Fs&target=https%3A%2F%2Fx.example%2F"
      );
      return new Response(null, { status: 202 });
    },
  });
  assert.deepEqual(
    await sendMention(
      "https://a.example/wm",
      "https://thayn.me/s",
      "https://x.example/"
    ),
    { label: "HTTP 202", delivered: true }
  );
});
