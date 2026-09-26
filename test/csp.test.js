// The CSP has no 'unsafe-inline'. A browser blocks an inline style or script
// silently apart from a console line, so these guard it at the source.

import assert from "node:assert/strict";
import { readFile, readdir } from "node:fs/promises";
import path from "node:path";
import test from "node:test";
import vm from "node:vm";

const ROOT = path.resolve(import.meta.dirname, "..");
const GRADIENT = path.join(ROOT, "src/capsules/gradient-background");

async function sourceFiles(dir, exts) {
  const out = [];
  for (const entry of await readdir(dir, { withFileTypes: true })) {
    const full = path.join(dir, entry.name);
    if (entry.isDirectory()) out.push(...(await sourceFiles(full, exts)));
    else if (exts.includes(path.extname(entry.name))) out.push(full);
  }
  return out;
}

async function cspDirectives() {
  const toml = await readFile(path.join(ROOT, "netlify.toml"), "utf8");
  const policy = toml.match(/Content-Security-Policy\s*=\s*"([^"]+)"/)?.[1];
  assert.ok(policy, "netlify.toml sets a Content-Security-Policy");
  return Object.fromEntries(
    policy
      .split(";")
      .map((d) => d.trim().split(/\s+/))
      .filter(([name]) => name)
      .map(([name, ...values]) => [name, values])
  );
}

test("the CSP allows no inline styles or scripts", async () => {
  const csp = await cspDirectives();
  for (const directive of ["style-src", "script-src"]) {
    assert.ok(csp[directive], `${directive} is set`);
    assert.ok(
      !csp[directive].includes("'unsafe-inline'"),
      `${directive} has no 'unsafe-inline'`
    );
  }
});

test("no script writes a style element or style attribute", async () => {
  const banned = [
    /createElement\(\s*["']style["']/,
    /setAttribute\(\s*["']style["']/,
    /\.cssText\s*=/,
    /style=/,
  ];
  for (const file of await sourceFiles(path.join(ROOT, "src"), [".js"])) {
    const js = await readFile(file, "utf8");
    for (const pattern of banned) {
      assert.doesNotMatch(js, pattern, path.relative(ROOT, file));
    }
  }
});

test("no template carries inline styles or inline scripts", async () => {
  const files = await sourceFiles(path.join(ROOT, "src"), [".html"]);
  for (const file of files) {
    const html = await readFile(file, "utf8");
    const where = path.relative(ROOT, file);
    assert.doesNotMatch(html, /<style[\s>]/i, where);
    assert.doesNotMatch(html, /\sstyle\s*=/i, where);
    assert.doesNotMatch(html, /\son[a-z]+\s*=/i, where);
    // JSON-LD is data, which script-src does not govern
    for (const [tag] of html.matchAll(/<script\b[^>]*>/gi)) {
      assert.match(tag, /\ssrc=|type="application\/ld\+json"/, where);
    }
  }
});

// Runs the capsule script against a minimal DOM and returns what it wrote
async function runGradient({ reducedMotion = false, session = {} } = {}) {
  const code = await readFile(
    path.join(GRADIENT, "gradient-background.js"),
    "utf8"
  );
  const nodes = Array.from({ length: 4 }, () => {
    const props = {};
    return {
      props,
      style: {
        animation: "",
        transform: "",
        setProperty: (name, value) => (props[name] = String(value)),
      },
    };
  });
  const store = { ...session };
  const document = {
    documentElement: { classList: { contains: () => false } },
    querySelector: () => ({ dataset: { animated: "true" } }),
    querySelectorAll: () => nodes,
    createElement: () => assert.fail("the script created an element"),
  };
  vm.runInNewContext(code, {
    document,
    sessionStorage: {
      getItem: (k) => store[k] ?? null,
      setItem: (k, v) => (store[k] = v),
    },
    window: {
      innerWidth: 1280,
      innerHeight: 800,
      matchMedia: () => ({ matches: reducedMotion }),
    },
    JSON,
    Math,
  });
  return { nodes, store };
}

test("every property the drift keyframes read is set on each node", async () => {
  const css = await readFile(
    path.join(GRADIENT, "gradient-background.css"),
    "utf8"
  );
  const keyframes = css.match(/@keyframes ambient-float\s*{[\s\S]*?\n}/)?.[0];
  assert.ok(keyframes, "the stylesheet defines @keyframes ambient-float");
  const read = new Set(
    [...keyframes.matchAll(/var\((--[\w-]+)\)/g)].map((m) => m[1])
  );
  assert.equal(read.size, 12);

  const { nodes } = await runGradient();
  for (const node of nodes) {
    assert.deepEqual(new Set(Object.keys(node.props)), read);
    for (const name of read) {
      assert.ok(Number.isFinite(parseFloat(node.props[name])), name);
    }
    assert.match(
      node.style.animation,
      /^ambient-float [\d.]+s ease-in-out infinite$/
    );
    // The first keyframe starts where the resting transform puts the node
    assert.equal(
      node.style.transform,
      `translate3d(${node.props["--float-x0"]},${node.props["--float-y0"]}, 0)`
    );
  }
});

test("reduced motion places the nodes but does not animate them", async () => {
  const { nodes } = await runGradient({ reducedMotion: true });
  for (const node of nodes) {
    assert.match(node.style.transform, /^translate3d\(/);
    assert.equal(node.style.animation, "");
    assert.deepEqual(node.props, {});
  }
});

test("a cached layout is reused so navigation does not reshuffle", async () => {
  const first = await runGradient();
  const second = await runGradient({ session: first.store });
  assert.deepEqual(
    second.nodes.map((n) => n.props),
    first.nodes.map((n) => n.props)
  );
});
