// Minifies the built HTML on Netlify deploys. Replaces
// netlify-plugin-minify-html, whose html-minifier and mkdirp are
// unmaintained and carry advisories with no fix.

const fs = require("node:fs/promises");
const path = require("node:path");
const { minify } = require("html-minifier-terser");

const CONTEXTS = ["production", "branch-deploy", "deploy-preview"];

// What the old plugin ran: node-minify's html-minifier defaults with
// whitespace, JS and CSS left alone
const OPTIONS = {
  collapseBooleanAttributes: true,
  removeAttributeQuotes: true,
  removeComments: true,
  removeEmptyAttributes: true,
  removeOptionalTags: true,
  removeRedundantAttributes: true,
  removeScriptTypeAttributes: true,
  removeStyleLinkTypeAttributes: true,
  useShortDoctype: true,
};

async function htmlFiles(dir) {
  const entries = await fs.readdir(dir, {
    recursive: true,
    withFileTypes: true,
  });
  return entries
    .filter((entry) => entry.isFile() && entry.name.endsWith(".html"))
    .map((entry) => path.join(entry.parentPath, entry.name));
}

async function minifyDir(dir) {
  const files = await htmlFiles(dir);
  for (const file of files) {
    const html = await fs.readFile(file, "utf8");
    await fs.writeFile(file, await minify(html, OPTIONS));
  }
  return files.length;
}

module.exports = {
  async onPostBuild({ constants, utils }) {
    if (!CONTEXTS.includes(process.env.CONTEXT)) return;
    try {
      const count = await minifyDir(constants.PUBLISH_DIR);
      console.log(`Minified ${count} HTML files`);
    } catch (error) {
      utils.build.failPlugin("Could not minify the HTML", { error });
    }
  },
};
