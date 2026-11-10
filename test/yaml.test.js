// serializeYaml output is committed straight to main by the post-deploy run,
// so whatever it writes has to parse back into the same frontmatter.

import assert from "node:assert/strict";
import test from "node:test";
import fm from "front-matter";
import { serializeYaml } from "../lib/bridgy-syndication.js";

const roundTrip = (attrs) =>
  fm(`---\n${serializeYaml(attrs)}\n---\nbody\n`).attributes;

test("keys that are not plain identifiers survive", () => {
  const attrs = {
    "a: b": 1,
    "#x": 2,
    "- a": 3,
    "": 4,
    1: 5,
    "<<": 6,
    "key with spaces": 7,
    'quo"te': 8,
    "it's": 9,
    ünïcode: 10,
    "?q": 11,
    "&anchor": 12,
    "*alias": 13,
    "!tag": 14,
    "@at": 15,
    "[x]": 16,
    "{x}": 17,
    "a\nb": 18,
    true: 19,
    null: 20,
    nested: { "a: b": [{ "#c": "d" }] },
  };
  assert.deepEqual(roundTrip(attrs), attrs);
});

test("awkward strings, numbers, booleans and null survive", () => {
  const attrs = {
    title: "Colons: \"quotes\" and 'apostrophes' # not a comment",
    body: "line one\nline two\r\n\ttabbed",
    emoji: `café \u{1F600} ${String.fromCodePoint(0x2028)} \u0000`,
    yes: "yes",
    no: "no",
    looksNumeric: "0123",
    looksNull: "null",
    looksDate: "2024-01-02",
    dash: "- item",
    empty: "",
    int: 42,
    negative: -1.5,
    big: 1e21,
    nan: NaN,
    inf: -Infinity,
    on: true,
    off: false,
    nothing: null,
  };
  const parsed = roundTrip(attrs);
  assert.deepEqual(parsed, attrs);
});

test("nested and empty collections survive", () => {
  const attrs = {
    tags: ["a", "b: c", ""],
    empty_list: [],
    empty_map: {},
    matrix: [[1, 2], [], [[]]],
    syndication: [
      { site: "mastodon", url: "https://example.social/@x/1" },
      { site: "bluesky", meta: { ok: true, list: [{}] } },
    ],
    status: { mastodon: "confirmed", "odd key": { deeper: [null, 0] } },
  };
  assert.deepEqual(roundTrip(attrs), attrs);
});

test("undefined is dropped from maps and becomes null in lists", () => {
  const parsed = roundTrip({
    a: undefined,
    b: { c: undefined, d: 1 },
    e: [1, undefined],
  });
  assert.deepEqual(parsed, { b: { d: 1 }, e: [1, null] });
});

// build.js parsePostDate reads a midnight Date as a date-only string and
// anything else as an ISO timestamp, so both shapes have to come back that way
test("dates come back the way build.js normalises them", () => {
  const parsed = roundTrip({
    date: new Date("2024-01-02T00:00:00Z"),
    updated: new Date("2024-01-02T03:04:05.678Z"),
    invalid: new Date("nope"),
    plain: "2024-01-02",
  });
  assert.equal(parsed.date, "2024-01-02");
  assert.equal(parsed.updated, "2024-01-02T03:04:05.678Z");
  assert.equal(parsed.invalid, null);
  assert.equal(parsed.plain, "2024-01-02");
});
