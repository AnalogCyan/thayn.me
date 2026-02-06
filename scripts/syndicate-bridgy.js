import fs from "fs/promises";
import path from "path";
import { fileURLToPath } from "url";
import fm from "front-matter";
import { getSiteUrl, getCanonicalBlogPath } from "../site-url.js";
import { canonicalizeUrl } from "../lib/url.js";
import {
  BRIDGY_PUBLISH_TARGETS,
  getSyndicationUrl,
  normalizeErrorMap,
  normalizeStatusMap,
  normalizeSyndicateTargets,
  normalizeSyndicationMap,
  normalizeTimestampMap,
  sendBridgyWebmention,
  serializeYaml,
  summarizeSyndicationResult,
} from "../lib/bridgy-syndication.js";
import {
  FAILED_BACKOFF_HOURS,
  getRequestedConfirmAction,
  hoursSince,
  normalizeStatusValue,
  pickForwardStatus,
  shouldMarkRequested,
} from "../lib/syndication-policy.js";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const ROOT_DIR = path.join(__dirname, "..");
const POSTS_DIR = path.join(ROOT_DIR, "src", "blog", "posts");

async function pathExists(p) {
  try {
    await fs.access(p);
    return true;
  } catch {
    return false;
  }
}

async function resolvePostFile(identifier) {
  if (!identifier) return null;

  const directPath = path.isAbsolute(identifier)
    ? identifier
    : path.join(POSTS_DIR, identifier);
  if (await pathExists(directPath)) return directPath;

  const withMd = `${identifier}.md`;
  const mdPath = path.join(POSTS_DIR, withMd);
  if (await pathExists(mdPath)) return mdPath;

  if (identifier.startsWith("http")) {
    try {
      const url = new URL(identifier);
      const slug = path.basename(url.pathname.replace(/\/+$/, ""), ".html");
      const urlPath = path.join(POSTS_DIR, `${slug}.md`);
      if (await pathExists(urlPath)) return urlPath;
    } catch {
      return null;
    }
  }

  return null;
}

async function run() {
  const args = process.argv.slice(2);
  const options = { all: false, post: null };

  for (let i = 0; i < args.length; i += 1) {
    const arg = args[i];
    if (arg === "--all") options.all = true;
    else if (arg === "--post") options.post = args[i + 1];
    else if (arg.startsWith("--post=")) options.post = arg.split("=")[1];
  }

  if (!options.all && !options.post) {
    console.log(
      "Usage: node scripts/syndicate-bridgy.js --all|--post <slug|url>",
    );
    process.exit(1);
  }

  const siteUrl = getSiteUrl();
  const now = new Date();

  let files = [];
  if (options.all) {
    const entries = await fs.readdir(POSTS_DIR);
    files = entries.filter((file) => file.endsWith(".md"));
  } else {
    const resolved = await resolvePostFile(options.post);
    if (!resolved) {
      console.error("Post not found.");
      process.exit(1);
    }
    files = [path.basename(resolved)];
  }

  for (const file of files) {
    const filePath = path.join(POSTS_DIR, file);
    const markdown = await fs.readFile(filePath, "utf-8");
    const { attributes, body } = fm(markdown);

    if (!attributes.title) {
      attributes.title = path.basename(file, ".md");
    }

    const syndicateTargets = normalizeSyndicateTargets(attributes.syndicate);
    const syndicationMap = normalizeSyndicationMap(attributes.syndication);
    const statusMap = normalizeStatusMap(attributes.syndicationStatus);
    const requestedAtMap = normalizeTimestampMap(
      attributes.syndicationRequestedAt,
    );
    const checkedAtMap = normalizeTimestampMap(attributes.syndicationCheckedAt);
    const lastErrorMap = normalizeErrorMap(attributes.syndicationLastError);

    let dirty = false;

    for (const target of Object.keys(syndicationMap)) {
      if (!BRIDGY_PUBLISH_TARGETS[target]) continue;
      const next = pickForwardStatus(statusMap[target], "confirmed");
      if (next !== statusMap[target]) {
        statusMap[target] = next;
        dirty = true;
      }
      if (requestedAtMap[target]) {
        delete requestedAtMap[target];
        dirty = true;
      }
      if (checkedAtMap[target]) {
        delete checkedAtMap[target];
        dirty = true;
      }
      if (lastErrorMap[target]) {
        delete lastErrorMap[target];
        dirty = true;
      }
    }

    const pendingTargets = [];
    for (const target of syndicateTargets) {
      const syndicatedUrl = getSyndicationUrl(syndicationMap, target);
      if (syndicatedUrl) {
        continue;
      }
      if (BRIDGY_PUBLISH_TARGETS[target]) {
        pendingTargets.push(target);
      }
    }

    const slug = path.basename(file, ".md");
    const defaultCanonical = canonicalizeUrl(
      siteUrl,
      getCanonicalBlogPath(slug),
    );
    const canonicalOverride = canonicalizeUrl(siteUrl, attributes.canonical);
    const sourceUrl = canonicalOverride || defaultCanonical;
    const nowIso = now.toISOString();

    for (const targetKey of pendingTargets) {
      const status = normalizeStatusValue(statusMap[targetKey]) || "pending";
      const requestedAt = requestedAtMap[targetKey];
      const ageHours = hoursSince(requestedAt, now);

      if (status === "requested") {
        const requestedAction = getRequestedConfirmAction({
          status,
          requestedAt: requestedAtMap[targetKey],
          checkedAt: checkedAtMap[targetKey],
          now,
        });

        if (requestedAction.action === "seed-requested-at") {
          requestedAtMap[targetKey] = nowIso;
          checkedAtMap[targetKey] = nowIso;
          if (!lastErrorMap[targetKey]) {
            lastErrorMap[targetKey] = "requested-missing-timestamp";
          }
          dirty = true;
          continue;
        }

        if (requestedAction.action === "wait") {
          continue;
        }

        if (requestedAction.action === "stale-failed") {
          if (statusMap[targetKey] !== "failed") {
            statusMap[targetKey] = "failed";
          }
          requestedAtMap[targetKey] = nowIso;
          delete checkedAtMap[targetKey];
          lastErrorMap[targetKey] = "requested-stale";
          dirty = true;
          continue;
        }

        if (requestedAction.action === "confirm") {
          console.log(`Confirming ${file} -> ${targetKey}`);
          const target = BRIDGY_PUBLISH_TARGETS[targetKey];
          const result = await sendBridgyWebmention({
            source: sourceUrl,
            target,
          });
          checkedAtMap[targetKey] = nowIso;
          dirty = true;

          if (result.ok && result.syndicatedUrl) {
            syndicationMap[targetKey] = result.syndicatedUrl;
            statusMap[targetKey] = pickForwardStatus(
              statusMap[targetKey],
              "confirmed",
            );
            delete requestedAtMap[targetKey];
            delete checkedAtMap[targetKey];
            delete lastErrorMap[targetKey];
            dirty = true;
            console.log(`Confirmed URL: ${result.syndicatedUrl}`);
          } else {
            statusMap[targetKey] = pickForwardStatus(
              statusMap[targetKey],
              "requested",
            );
            lastErrorMap[targetKey] = summarizeSyndicationResult(
              result,
              "confirm",
            );
            dirty = true;
            console.warn(
              `Still awaiting confirmation for ${file} -> ${targetKey}`,
            );
          }
        }
        continue;
      }

      if (status === "failed" && ageHours < FAILED_BACKOFF_HOURS) {
        continue;
      }

      const target = BRIDGY_PUBLISH_TARGETS[targetKey];
      console.log(`Syndicating ${file} -> ${targetKey}`);
      const result = await sendBridgyWebmention({ source: sourceUrl, target });

      if (result.ok && result.syndicatedUrl) {
        syndicationMap[targetKey] = result.syndicatedUrl;
        statusMap[targetKey] = pickForwardStatus(
          statusMap[targetKey],
          "confirmed",
        );
        delete requestedAtMap[targetKey];
        delete checkedAtMap[targetKey];
        delete lastErrorMap[targetKey];
        dirty = true;
        console.log(`Syndicated URL: ${result.syndicatedUrl}`);
        continue;
      }

      if (shouldMarkRequested(result)) {
        statusMap[targetKey] = pickForwardStatus(
          statusMap[targetKey],
          "requested",
        );
        requestedAtMap[targetKey] = nowIso;
        checkedAtMap[targetKey] = nowIso;
        lastErrorMap[targetKey] = summarizeSyndicationResult(result, "publish");
        dirty = true;
        console.warn(
          `Publish requested; awaiting confirmation for ${file} -> ${targetKey}`,
        );
      } else {
        statusMap[targetKey] = pickForwardStatus(
          statusMap[targetKey],
          "failed",
        );
        requestedAtMap[targetKey] = nowIso;
        delete checkedAtMap[targetKey];
        lastErrorMap[targetKey] = summarizeSyndicationResult(result, "publish");
        dirty = true;
        console.warn(
          `Failed ${file} -> ${targetKey} (status ${result.status})`,
        );
      }
    }

    const remainingSyndicate = syndicateTargets.filter(
      (target) => !getSyndicationUrl(syndicationMap, target),
    );
    const hadSyndicate =
      syndicateTargets.length > 0 || attributes.syndicate !== undefined;

    if (remainingSyndicate.length > 0) {
      attributes.syndicate = remainingSyndicate;
      if (attributes.syndicationComplete) {
        delete attributes.syndicationComplete;
        dirty = true;
      }
    } else if (hadSyndicate) {
      if (attributes.syndicate) {
        delete attributes.syndicate;
        dirty = true;
      }
      if (attributes.syndicationComplete !== true) {
        attributes.syndicationComplete = true;
        dirty = true;
      }
    }

    attributes.syndication = syndicationMap;

    if (Object.keys(statusMap).length > 0) {
      attributes.syndicationStatus = statusMap;
    } else if (attributes.syndicationStatus) {
      delete attributes.syndicationStatus;
      dirty = true;
    }

    if (Object.keys(requestedAtMap).length > 0) {
      attributes.syndicationRequestedAt = requestedAtMap;
    } else if (attributes.syndicationRequestedAt) {
      delete attributes.syndicationRequestedAt;
      dirty = true;
    }

    if (Object.keys(checkedAtMap).length > 0) {
      attributes.syndicationCheckedAt = checkedAtMap;
    } else if (attributes.syndicationCheckedAt) {
      delete attributes.syndicationCheckedAt;
      dirty = true;
    }

    if (Object.keys(lastErrorMap).length > 0) {
      attributes.syndicationLastError = lastErrorMap;
    } else if (attributes.syndicationLastError) {
      delete attributes.syndicationLastError;
      dirty = true;
    }

    if (!dirty) {
      console.log(`No changes for: ${file}`);
      continue;
    }

    const yaml = serializeYaml(attributes);
    const updated = `---\n${yaml}\n---\n${body.trimStart()}`;
    await fs.writeFile(filePath, updated);
    console.log(`Updated front matter for ${file}`);
  }
}

run().catch((err) => {
  console.error(err);
  process.exit(1);
});
