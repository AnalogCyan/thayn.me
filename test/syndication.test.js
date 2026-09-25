// The decisions that reach real accounts: what gets posted, and what gets linked.
// Everything else this site builds is visible in a browser; these are not.

import assert from "node:assert/strict";
import test from "node:test";
import {
  REQUEST_STALE_HOURS,
  getRequestedConfirmAction,
  hoursSince,
  pickForwardStatus,
  shouldMarkRequested,
} from "../lib/syndication-policy.js";
import { sanitizeExternalUrl } from "../lib/sanitize-url.js";

const NOW = new Date("2026-09-24T12:00:00Z");
const hoursAgo = (h) => new Date(NOW.getTime() - h * 3600 * 1000).toISOString();

test("a confirmed target can never be walked back to an earlier status", () => {
  for (const earlier of ["pending", "failed", "requested"]) {
    assert.equal(pickForwardStatus("confirmed", earlier), "confirmed");
  }
  assert.equal(pickForwardStatus("requested", "pending"), "requested");
  assert.equal(pickForwardStatus("failed", "pending"), "failed");
});

test("a status still moves forward, and garbage is ignored", () => {
  assert.equal(pickForwardStatus("pending", "requested"), "requested");
  assert.equal(pickForwardStatus("requested", "confirmed"), "confirmed");
  assert.equal(pickForwardStatus("CONFIRMED", "pending"), "confirmed");
  assert.equal(pickForwardStatus("confirmed", "nonsense"), "confirmed");
  assert.equal(pickForwardStatus("nonsense", "pending"), "pending");
});

test("an unparseable timestamp reads as infinitely old, not as now", () => {
  assert.equal(hoursSince("", NOW), Infinity);
  assert.equal(hoursSince("not a date", NOW), Infinity);
  assert.equal(hoursSince(hoursAgo(3), NOW), 3);
});

test("a request older than the stale window is given up on", () => {
  const action = getRequestedConfirmAction({
    status: "requested",
    requestedAt: hoursAgo(REQUEST_STALE_HOURS + 1),
    checkedAt: hoursAgo(1),
    now: NOW,
  });
  assert.equal(action.action, "stale-failed");
});

test("a request inside its cooldown waits, outside it confirms", () => {
  // 3h old falls in the 6h rule, so the cooldown is 1h
  const base = { status: "requested", requestedAt: hoursAgo(3), now: NOW };
  assert.equal(
    getRequestedConfirmAction({ ...base, checkedAt: hoursAgo(0.5) }).action,
    "wait"
  );
  assert.equal(
    getRequestedConfirmAction({ ...base, checkedAt: hoursAgo(2) }).action,
    "confirm"
  );
});

test("a request with no timestamp seeds one instead of acting on it", () => {
  const action = getRequestedConfirmAction({
    status: "requested",
    requestedAt: "",
    checkedAt: "",
    now: NOW,
  });
  assert.equal(action.action, "seed-requested-at");
});

test("a target that is not requested is left alone", () => {
  for (const status of ["pending", "failed", "confirmed", ""]) {
    assert.equal(
      getRequestedConfirmAction({ status, now: NOW }).action,
      "not-requested"
    );
  }
});

test("only retryable outcomes are marked requested", () => {
  assert.equal(shouldMarkRequested({ ok: true, syndicatedUrl: "" }), true);
  assert.equal(shouldMarkRequested({ error: new Error("network") }), true);
  assert.equal(shouldMarkRequested({ ok: false, status: 503 }), true);
  assert.equal(shouldMarkRequested({ ok: false, status: 429 }), true);

  // a real URL came back, or the request was refused for good
  assert.equal(
    shouldMarkRequested({ ok: true, syndicatedUrl: "https://bsky.app/x" }),
    false
  );
  assert.equal(shouldMarkRequested({ ok: false, status: 400 }), false);
});

test("only http and https URLs survive sanitizing", () => {
  assert.equal(
    sanitizeExternalUrl("https://tech.lgbt/@AnalogCyan"),
    "https://tech.lgbt/@AnalogCyan"
  );
  for (const hostile of [
    "javascript:alert(1)",
    "data:text/html,<script>alert(1)</script>",
    "file:///etc/passwd",
    "not a url",
    "",
    null,
  ]) {
    assert.equal(sanitizeExternalUrl(hostile), null);
  }
});

test("Bridgy's already-published refusal counts as the earlier post's URL", async () => {
  const { sendBridgyWebmention } = await import("../lib/bridgy-syndication.js");
  const reply = (status, body) => async () =>
    new Response(JSON.stringify(body), { status });

  const already = await sendBridgyWebmention({
    source: "https://thayn.me/blog/x/",
    target: "https://brid.gy/publish/bluesky",
    fetchImpl: reply(400, {
      error: "Sorry, you've already published that page",
      original: { url: "https://bsky.app/profile/thayn.me/post/abc" },
    }),
  });
  assert.equal(already.ok, true);
  assert.equal(
    already.syndicatedUrl,
    "https://bsky.app/profile/thayn.me/post/abc"
  );

  const refused = await sendBridgyWebmention({
    source: "https://thayn.me/blog/x/",
    target: "https://brid.gy/publish/bluesky",
    fetchImpl: reply(400, {
      error: "no link",
      original: { url: "javascript:x" },
    }),
  });
  assert.equal(refused.ok, false);
  assert.equal(shouldMarkRequested(refused), false);
});
