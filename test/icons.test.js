// The icon font is a committed subset, so these fail when it falls behind the
// markup. `npm run icons` brings it back in line.

import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";
import {
  ICONS_CSS,
  ICONS_FONT,
  fontHash,
  usedIcons,
} from "../tools/subset-icons.js";

test("icons.css defines exactly the icons the site uses", async () => {
  const css = await readFile(ICONS_CSS, "utf8");
  const defined = [...css.matchAll(/\.(ri-[a-z0-9-]+):before/g)]
    .map(([, name]) => name)
    .sort();
  assert.deepEqual(defined, await usedIcons());
});

test("icons.css points at the font file as it is now", async () => {
  const css = await readFile(ICONS_CSS, "utf8");
  const hash = fontHash(await readFile(ICONS_FONT));
  assert.match(css, new RegExp(`/fonts/remixicon\\.woff2\\?v=${hash}"`));
});
