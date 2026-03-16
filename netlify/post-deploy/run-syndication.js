import fm from "front-matter";
import fs from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";
import {
  BRIDGY_PUBLISH_TARGETS,
  getSyndicationUrl,
  hasOwn,
  normalizeErrorMap,
  normalizeStatusMap,
  normalizeSyndicateTargets,
  normalizeSyndicationMap,
  normalizeTimestampMap,
  sendBridgyWebmention,
  serializeYaml,
  summarizeSyndicationResult,
  truncateError,
} from "../../lib/bridgy-syndication.js";
import {
  FAILED_BACKOFF_HOURS,
  getRequestedConfirmAction,
  hoursSince,
  normalizeStatusValue,
  pickForwardStatus,
  shouldMarkRequested,
} from "../../lib/syndication-policy.js";
import { sanitizeExternalUrl } from "../../lib/sanitize-url.js";
import { canonicalizeUrl, toAbsoluteUrl } from "../../lib/url.js";
import { getCanonicalBlogPath, getSiteUrl } from "../../lib/site-url.js";

const POSTS_DIR = "src/blog/posts";
const COMMIT_PREFIX = process.env.SYNDICATION_COMMIT_PREFIX || "Syndication:";
const LEASE_MAX_ATTEMPTS = 4;
const REQUIRED_GITHUB_ENV = ["GITHUB_TOKEN", "GITHUB_OWNER", "GITHUB_REPO"];
const BLUESKY_HOST_PATTERNS = [
  ".bsky.app",
  ".bsky.social",
  ".brid.gy",
];

function toSkipCiMessage(message) {
  if (/\[(?:skip ci|ci skip)\]/i.test(message)) {
    return message;
  }
  return `${message} [skip ci]`;
}

function getMissingEnv(keys) {
  return keys.filter((key) => !String(process.env[key] || "").trim());
}

async function hasLocalMarkdownPosts() {
  try {
    const entries = await fs.readdir(POSTS_DIR, { withFileTypes: true });
    return entries.some((entry) => entry.isFile() && entry.name.endsWith(".md"));
  } catch (err) {
    if (err && err.code === "ENOENT") {
      return false;
    }
    throw err;
  }
}

function hasHostSuffix(hostname, suffixes) {
  const host = `.${String(hostname || "").trim().toLowerCase()}`;
  if (!host || host === ".") return false;
  return suffixes.some((suffix) => host.endsWith(suffix));
}

function getLegacySyndicationCandidates(attributes = {}) {
  const directCandidates = [
    attributes.socialUrl,
    attributes.socialURL,
    attributes.social,
    attributes.linkedSocialUrl,
    attributes.linkedSocialURL,
    attributes.linkedSocial,
    attributes.socialPost,
    attributes.syndicationUrl,
    attributes.syndicationURL,
  ];

  const unique = new Set();
  for (const candidate of directCandidates) {
    const safe = sanitizeExternalUrl(candidate);
    if (safe) unique.add(safe);
  }
  return Array.from(unique);
}

function isTargetUrl(urlValue, target) {
  if (!urlValue || !target) return false;
  if (target === "bluesky") {
    try {
      const parsed = new URL(urlValue);
      return hasHostSuffix(parsed.hostname, BLUESKY_HOST_PATTERNS);
    } catch {
      return false;
    }
  }
  return false;
}

function inferLegacySyndicationUrl(attributes, target) {
  const candidates = getLegacySyndicationCandidates(attributes);
  for (const candidate of candidates) {
    if (isTargetUrl(candidate, target)) {
      return candidate;
    }
  }
  return "";
}

async function scanLocalPostsForWork() {
  const summary = { pendingTotal: 0, syncNeeded: false };
  let entries;
  try {
    entries = await fs.readdir(POSTS_DIR, { withFileTypes: true });
  } catch (err) {
    if (err && err.code === "ENOENT") {
      return summary;
    }
    throw err;
  }

  const files = entries
    .filter((entry) => entry.isFile() && entry.name.endsWith(".md"))
    .map((entry) => entry.name)
    .sort();

  for (const file of files) {
    const filePath = path.join(POSTS_DIR, file);
    let attributes = {};
    try {
      const raw = await fs.readFile(filePath, "utf-8");
      attributes = fm(raw).attributes || {};
    } catch (err) {
      throw new Error(
        `Failed to scan local post ${filePath}: ${err?.message || String(err)}`,
      );
    }

    const syndicationMap = normalizeSyndicationMap(attributes.syndication);
    const syndicateTargets = normalizeSyndicateTargets(attributes.syndicate);
    const statusMap = normalizeStatusMap(attributes.syndicationStatus);
    const effectiveSyndicationMap = { ...syndicationMap };
    for (const target of syndicateTargets) {
      if (!BRIDGY_PUBLISH_TARGETS[target]) continue;
      if (getSyndicationUrl(effectiveSyndicationMap, target)) continue;
      const legacyUrl = inferLegacySyndicationUrl(attributes, target);
      if (legacyUrl) {
        effectiveSyndicationMap[target] = legacyUrl;
      }
    }

    const pendingTargets = syndicateTargets.filter(
      (target) =>
        BRIDGY_PUBLISH_TARGETS[target] &&
        !getSyndicationUrl(effectiveSyndicationMap, target),
    );
    summary.pendingTotal += pendingTargets.length;
    if (!summary.syncNeeded) {
      const needsSyndicateCleanup = syndicateTargets.some((target) =>
        getSyndicationUrl(effectiveSyndicationMap, target),
      );
      const needsStatusConfirm = Object.keys(effectiveSyndicationMap).some(
        (target) =>
          BRIDGY_PUBLISH_TARGETS[target] &&
          statusMap[target] !== "confirmed",
      );
      summary.syncNeeded = needsSyndicateCleanup || needsStatusConfirm;
    }
  }

  return summary;
}

function isProductionDeploy() {
  const envContext =
    process.env.CONTEXT ||
    process.env.DEPLOY_CONTEXT ||
    process.env.NETLIFY_CONTEXT ||
    "";
  return String(envContext).trim().toLowerCase() === "production";
}

async function githubRequest(path, options = {}) {
  const token = process.env.GITHUB_TOKEN;
  const owner = process.env.GITHUB_OWNER;
  const repo = process.env.GITHUB_REPO;
  if (!token || !owner || !repo) {
    throw new Error("Missing GitHub configuration");
  }

  const url = `https://api.github.com/repos/${owner}/${repo}${path}`;
  const res = await fetch(url, {
    method: options.method || "GET",
    headers: {
      Accept: "application/vnd.github+json",
      Authorization: `Bearer ${token}`,
      "User-Agent": "thayn.me-syndication",
    },
    body: options.body,
  });

  return res;
}

async function listPostFiles(branch) {
  const res = await githubRequest(
    `/contents/${POSTS_DIR}?ref=${encodeURIComponent(branch)}`,
  );
  if (res.status === 404) {
    return [];
  }
  if (!res.ok) {
    throw new Error(`Failed to list posts (status ${res.status})`);
  }
  const data = await res.json();
  return (Array.isArray(data) ? data : []).filter(
    (entry) => entry.type === "file" && entry.name.endsWith(".md"),
  );
}

async function getFileContent(path, branch) {
  const res = await githubRequest(
    `/contents/${path}?ref=${encodeURIComponent(branch)}`,
  );
  if (!res.ok) {
    throw new Error(`Failed to fetch ${path} (status ${res.status})`);
  }
  const data = await res.json();
  const buffer = Buffer.from(data.content || "", "base64");
  return {
    sha: data.sha,
    content: buffer.toString("utf-8"),
  };
}

async function updateFileContent(path, branch, sha, content, message) {
  const payload = {
    message,
    content: Buffer.from(content, "utf-8").toString("base64"),
    sha,
    branch,
  };

  const res = await githubRequest(`/contents/${path}`, {
    method: "PUT",
    body: JSON.stringify(payload),
  });

  return res;
}

function buildFrontmatter(attributes, body) {
  const yaml = serializeYaml(attributes);
  return `---\n${yaml}\n---\n${body}`;
}

function buildCanonicalUrl(attributes, slug, siteUrl) {
  const canonicalOverride = canonicalizeUrl(siteUrl, attributes.canonical);
  if (canonicalOverride) return canonicalOverride;
  return canonicalizeUrl(siteUrl, getCanonicalBlogPath(slug));
}

async function extractContentSha(response, fallbackSha) {
  try {
    const payload = await response.json();
    return payload?.content?.sha || fallbackSha;
  } catch {
    return fallbackSha;
  }
}

function collectSyndicationState(attributes = {}) {
  return {
    syndicationMap: normalizeSyndicationMap(attributes.syndication),
    statusMap: normalizeStatusMap(attributes.syndicationStatus),
    requestedAtMap: normalizeTimestampMap(attributes.syndicationRequestedAt),
    checkedAtMap: normalizeTimestampMap(attributes.syndicationCheckedAt),
    lastErrorMap: normalizeErrorMap(attributes.syndicationLastError),
  };
}

function applySyndicationState(attributes, state) {
  attributes.syndication = state.syndicationMap;

  if (Object.keys(state.statusMap).length > 0) {
    attributes.syndicationStatus = state.statusMap;
  } else {
    delete attributes.syndicationStatus;
  }

  if (Object.keys(state.requestedAtMap).length > 0) {
    attributes.syndicationRequestedAt = state.requestedAtMap;
  } else {
    delete attributes.syndicationRequestedAt;
  }

  if (Object.keys(state.checkedAtMap).length > 0) {
    attributes.syndicationCheckedAt = state.checkedAtMap;
  } else {
    delete attributes.syndicationCheckedAt;
  }

  if (Object.keys(state.lastErrorMap).length > 0) {
    attributes.syndicationLastError = state.lastErrorMap;
  } else {
    delete attributes.syndicationLastError;
  }
}

function canAttemptPublishNow({ target, state, now }) {
  const syndicatedUrl = getSyndicationUrl(state.syndicationMap, target);
  if (syndicatedUrl) {
    return { ok: false, reason: "already-syndicated" };
  }

  const status = normalizeStatusValue(state.statusMap[target]) || "pending";
  if (status === "confirmed") {
    return { ok: false, reason: "already-confirmed" };
  }

  if (status === "requested") {
    const requestedAction = getRequestedConfirmAction({
      status,
      requestedAt: state.requestedAtMap[target],
      checkedAt: state.checkedAtMap[target],
      now,
    });
    return {
      ok: false,
      reason: `requested-${requestedAction.action}`,
    };
  }

  if (status === "failed") {
    const ageHours = hoursSince(state.requestedAtMap[target], now);
    if (ageHours < FAILED_BACKOFF_HOURS) {
      return { ok: false, reason: "failed-backoff" };
    }
  }

  return { ok: true, status };
}

async function acquirePublishLease({ filePath, branch, target, now }) {
  const nowIso = now.toISOString();
  const slug = filePath.split("/").pop()?.replace(/\.md$/, "") || filePath;
  const message = toSkipCiMessage(
    `${COMMIT_PREFIX} lease publish ${slug} ${target}`,
  );

  for (let attempt = 0; attempt < LEASE_MAX_ATTEMPTS; attempt += 1) {
    const fetched = await getFileContent(filePath, branch);
    const parsed = fm(fetched.content);
    const attributes = parsed.attributes || {};
    const state = collectSyndicationState(attributes);
    const eligibility = canAttemptPublishNow({
      target,
      state,
      now,
    });

    if (!eligibility.ok) {
      return { acquired: false, reason: eligibility.reason };
    }

    state.statusMap[target] =
      pickForwardStatus(state.statusMap[target], "requested") || "requested";
    state.requestedAtMap[target] = nowIso;
    state.checkedAtMap[target] = nowIso;
    delete state.lastErrorMap[target];
    applySyndicationState(attributes, state);

    const updated = buildFrontmatter(attributes, parsed.body || "");
    const res = await updateFileContent(
      filePath,
      branch,
      fetched.sha,
      updated,
      message,
    );

    if (res.ok) {
      const sha = await extractContentSha(res, fetched.sha);
      return { acquired: true, sha, nowIso };
    }

    if (res.status === 409) {
      continue;
    }

    throw new Error(
      `Lease publish update failed for ${filePath} -> ${target} (status ${res.status})`,
    );
  }

  return { acquired: false, reason: "lease-conflict" };
}

async function acquireConfirmLease({ filePath, branch, target, now }) {
  const nowIso = now.toISOString();
  const slug = filePath.split("/").pop()?.replace(/\.md$/, "") || filePath;
  const message = toSkipCiMessage(
    `${COMMIT_PREFIX} lease confirm ${slug} ${target}`,
  );

  for (let attempt = 0; attempt < LEASE_MAX_ATTEMPTS; attempt += 1) {
    const fetched = await getFileContent(filePath, branch);
    const parsed = fm(fetched.content);
    const attributes = parsed.attributes || {};
    const state = collectSyndicationState(attributes);
    const status = normalizeStatusValue(state.statusMap[target]);
    if (status !== "requested") {
      return { acquired: false, reason: "not-requested" };
    }

    const requestedAction = getRequestedConfirmAction({
      status,
      requestedAt: state.requestedAtMap[target],
      checkedAt: state.checkedAtMap[target],
      now,
    });

    if (requestedAction.action !== "confirm") {
      return {
        acquired: false,
        reason: `requested-${requestedAction.action}`,
      };
    }

    state.checkedAtMap[target] = nowIso;
    applySyndicationState(attributes, state);

    const updated = buildFrontmatter(attributes, parsed.body || "");
    const res = await updateFileContent(
      filePath,
      branch,
      fetched.sha,
      updated,
      message,
    );

    if (res.ok) {
      const sha = await extractContentSha(res, fetched.sha);
      return { acquired: true, sha, nowIso };
    }

    if (res.status === 409) {
      continue;
    }

    throw new Error(
      `Lease confirm update failed for ${filePath} -> ${target} (status ${res.status})`,
    );
  }

  return { acquired: false, reason: "lease-conflict" };
}

export async function runSyndicationPostDeploy() {
  if (!isProductionDeploy()) {
    return { skipped: true, reason: "non-production" };
  }

  if (!(await hasLocalMarkdownPosts())) {
    return { skipped: true, reason: "no-local-posts" };
  }

  const localScan = await scanLocalPostsForWork();
  if (localScan.pendingTotal === 0 && !localScan.syncNeeded) {
    return { skipped: true, reason: "no-pending" };
  }

  const missingEnv = getMissingEnv(REQUIRED_GITHUB_ENV);
  if (missingEnv.length > 0) {
    throw new Error(
      `Missing required syndication configuration: ${missingEnv.join(", ")}`,
    );
  }

  const branch = process.env.GITHUB_BRANCH || "main";
  const now = new Date();
  const report = {
    skipped: [],
    updated: [],
    errors: [],
  };
  let committedWriteback = false;

  let files;
  try {
    files = await listPostFiles(branch);
  } catch (err) {
    throw new Error(
      `Failed to list posts for syndication: ${err?.message || String(err)}`,
    );
  }

  const posts = [];
  let pendingTotal = 0;
  let syncNeeded = false;

  for (const file of files) {
    const filePath = file.path || `${POSTS_DIR}/${file.name}`;
    try {
      const fetched = await getFileContent(filePath, branch);
      const parsedPost = fm(fetched.content);
      const attributes = parsedPost.attributes || {};
      const syndicationMap = normalizeSyndicationMap(attributes.syndication);
      const syndicateTargets = normalizeSyndicateTargets(attributes.syndicate);
      const statusMap = normalizeStatusMap(attributes.syndicationStatus);
      const pendingTargets = syndicateTargets.filter(
        (target) =>
          BRIDGY_PUBLISH_TARGETS[target] &&
          !getSyndicationUrl(syndicationMap, target),
      );
      pendingTotal += pendingTargets.length;
      if (!syncNeeded) {
        const needsSyndicateCleanup = syndicateTargets.some((target) =>
          getSyndicationUrl(syndicationMap, target),
        );
        const needsStatusConfirm = Object.keys(syndicationMap).some(
          (target) =>
            BRIDGY_PUBLISH_TARGETS[target] &&
            statusMap[target] !== "confirmed",
        );
        syncNeeded = needsSyndicateCleanup || needsStatusConfirm;
      }

      posts.push({
        filePath,
        sha: fetched.sha,
        content: fetched.content,
        attributes,
        body: parsedPost.body || "",
        pendingTargets,
      });
    } catch (err) {
      report.errors.push({ file: filePath, error: err.message });
    }
  }

  if (pendingTotal === 0 && !syncNeeded) {
    return { skipped: true, reason: "no-pending" };
  }

  const siteUrl = getSiteUrl();

  for (const post of posts) {
    const { filePath, attributes, body } = post;
    if (committedWriteback) {
      report.skipped.push({ file: filePath, reason: "deferred-after-writeback" });
      continue;
    }
    let currentSha = post.sha;
    const slug = post.filePath.split("/").pop()?.replace(/\.md$/, "") || "";
    const syndicateTargets = normalizeSyndicateTargets(attributes.syndicate);
    const syndicationMap = normalizeSyndicationMap(attributes.syndication);
    const statusMap = normalizeStatusMap(attributes.syndicationStatus);
    const requestedAtMap = normalizeTimestampMap(
      attributes.syndicationRequestedAt,
    );
    const checkedAtMap = normalizeTimestampMap(attributes.syndicationCheckedAt);
    const lastErrorMap = normalizeErrorMap(attributes.syndicationLastError);
    const touchedTargets = new Set();
    const touch = (target) => {
      if (target) touchedTargets.add(target);
    };

    let dirty = false;
    const canonicalUrl = buildCanonicalUrl(attributes, slug, siteUrl);
    const nowIso = now.toISOString();
    for (const target of syndicateTargets) {
      if (!BRIDGY_PUBLISH_TARGETS[target]) continue;
      if (getSyndicationUrl(syndicationMap, target)) continue;
      const legacyUrl = inferLegacySyndicationUrl(attributes, target);
      if (!legacyUrl) continue;
      syndicationMap[target] = legacyUrl;
      const next = pickForwardStatus(statusMap[target], "confirmed");
      if (next !== statusMap[target]) {
        statusMap[target] = next || "confirmed";
      }
      delete requestedAtMap[target];
      delete checkedAtMap[target];
      delete lastErrorMap[target];
      dirty = true;
      touch(target);
    }

    for (const target of Object.keys(syndicationMap)) {
      if (!BRIDGY_PUBLISH_TARGETS[target]) continue;
      if (statusMap[target] !== "confirmed") {
        const next = pickForwardStatus(statusMap[target], "confirmed");
        if (next !== statusMap[target]) {
          statusMap[target] = next;
          dirty = true;
          touch(target);
        }
      }
      if (requestedAtMap[target]) {
        delete requestedAtMap[target];
        dirty = true;
        touch(target);
      }
      if (checkedAtMap[target]) {
        delete checkedAtMap[target];
        dirty = true;
        touch(target);
      }
      if (lastErrorMap[target]) {
        delete lastErrorMap[target];
        dirty = true;
        touch(target);
      }
    }

    const pendingTargets = [];
    for (const target of syndicateTargets) {
      const syndicatedUrl = getSyndicationUrl(syndicationMap, target);
      const currentStatus = normalizeStatusValue(statusMap[target]);
      const hasConfirmed =
        Boolean(syndicatedUrl) || currentStatus === "confirmed";
      if (hasConfirmed) {
        const next = pickForwardStatus(statusMap[target], "confirmed");
        if (next !== statusMap[target]) {
          statusMap[target] = next;
          dirty = true;
          touch(target);
        }
        if (requestedAtMap[target]) {
          delete requestedAtMap[target];
          dirty = true;
          touch(target);
        }
        if (checkedAtMap[target]) {
          delete checkedAtMap[target];
          dirty = true;
          touch(target);
        }
        if (lastErrorMap[target]) {
          delete lastErrorMap[target];
          dirty = true;
          touch(target);
        }
        continue;
      }
      if (currentStatus === "requested") {
        const requestedAction = getRequestedConfirmAction({
          status: currentStatus,
          requestedAt: requestedAtMap[target],
          checkedAt: checkedAtMap[target],
          now,
        });

        if (requestedAction.action === "seed-requested-at") {
          if (requestedAtMap[target] !== nowIso) {
            requestedAtMap[target] = nowIso;
            dirty = true;
            touch(target);
          }
          if (checkedAtMap[target] !== nowIso) {
            checkedAtMap[target] = nowIso;
            dirty = true;
            touch(target);
          }
          if (!lastErrorMap[target]) {
            lastErrorMap[target] = "requested-missing-timestamp";
            dirty = true;
            touch(target);
          }
          continue;
        }

        if (requestedAction.action === "wait") {
          continue;
        }

        if (requestedAction.action === "stale-failed") {
          if (statusMap[target] !== "failed") {
            statusMap[target] = "failed";
            dirty = true;
            touch(target);
          }
          requestedAtMap[target] = nowIso;
          if (checkedAtMap[target]) {
            delete checkedAtMap[target];
          }
          lastErrorMap[target] = truncateError("requested-stale");
          dirty = true;
          touch(target);
          continue;
        }

        if (requestedAction.action === "confirm") {
          const lease = await acquireConfirmLease({
            filePath,
            branch,
            target,
            now,
          });
          if (!lease.acquired) {
            continue;
          }
          currentSha = lease.sha;
          if (checkedAtMap[target] !== lease.nowIso) {
            checkedAtMap[target] = lease.nowIso;
            dirty = true;
            touch(target);
          }

          const publishTarget = BRIDGY_PUBLISH_TARGETS[target];
          if (!publishTarget) {
            continue;
          }
          const result = await sendBridgyWebmention({
            source: canonicalUrl,
            target: publishTarget,
          });

          if (result.ok && result.syndicatedUrl) {
            if (!syndicationMap[target]) {
              syndicationMap[target] = result.syndicatedUrl;
              dirty = true;
              touch(target);
            }
            const next = pickForwardStatus(statusMap[target], "confirmed");
            if (next !== statusMap[target]) {
              statusMap[target] = next;
              dirty = true;
              touch(target);
            }
            delete requestedAtMap[target];
            delete checkedAtMap[target];
            delete lastErrorMap[target];
            touch(target);
            continue;
          }

          if (shouldMarkRequested(result)) {
            const next = pickForwardStatus(statusMap[target], "requested");
            if (next !== statusMap[target]) {
              statusMap[target] = next;
              dirty = true;
              touch(target);
            }
            if (!requestedAtMap[target]) {
              requestedAtMap[target] = lease.nowIso;
              dirty = true;
              touch(target);
            }
            checkedAtMap[target] = lease.nowIso;
            lastErrorMap[target] = summarizeSyndicationResult(result, "confirm");
            dirty = true;
            touch(target);
            continue;
          }

          const next = pickForwardStatus(statusMap[target], "failed");
          if (next !== statusMap[target]) {
            statusMap[target] = next;
            dirty = true;
            touch(target);
          }
          requestedAtMap[target] = lease.nowIso;
          delete checkedAtMap[target];
          lastErrorMap[target] = summarizeSyndicationResult(result, "confirm");
          dirty = true;
          touch(target);
          continue;
        }

        continue;
      }
      if (BRIDGY_PUBLISH_TARGETS[target]) {
        pendingTargets.push(target);
      }
    }

    if (pendingTargets.length > 0) {
      for (const targetKey of pendingTargets) {
        const status = normalizeStatusValue(statusMap[targetKey]) || "pending";
        const requestedAt = requestedAtMap[targetKey];
        const ageHours = hoursSince(requestedAt, now);

        if (status === "failed" && ageHours < FAILED_BACKOFF_HOURS) {
          continue;
        }

        const lease = await acquirePublishLease({
          filePath,
          branch,
          target: targetKey,
          now,
        });
        if (!lease.acquired) {
          continue;
        }
        currentSha = lease.sha;

        const leasedStatus =
          pickForwardStatus(statusMap[targetKey], "requested") || "requested";
        if (leasedStatus !== statusMap[targetKey]) {
          statusMap[targetKey] = leasedStatus;
          dirty = true;
          touch(targetKey);
        }
        if (requestedAtMap[targetKey] !== lease.nowIso) {
          requestedAtMap[targetKey] = lease.nowIso;
          dirty = true;
          touch(targetKey);
        }
        if (checkedAtMap[targetKey] !== lease.nowIso) {
          checkedAtMap[targetKey] = lease.nowIso;
          dirty = true;
          touch(targetKey);
        }
        if (lastErrorMap[targetKey]) {
          delete lastErrorMap[targetKey];
          dirty = true;
          touch(targetKey);
        }

        const target = BRIDGY_PUBLISH_TARGETS[targetKey];
        const result = await sendBridgyWebmention({
          source: canonicalUrl,
          target,
        });

        if (result.ok && result.syndicatedUrl) {
          if (!syndicationMap[targetKey]) {
            syndicationMap[targetKey] = result.syndicatedUrl;
            dirty = true;
            touch(targetKey);
          }
          const next = pickForwardStatus(statusMap[targetKey], "confirmed");
          if (next !== statusMap[targetKey]) {
            statusMap[targetKey] = next;
            dirty = true;
            touch(targetKey);
          }
          delete requestedAtMap[targetKey];
          delete checkedAtMap[targetKey];
          delete lastErrorMap[targetKey];
          touch(targetKey);
          continue;
        }

        if (shouldMarkRequested(result)) {
          const next = pickForwardStatus(statusMap[targetKey], "requested");
          if (next !== statusMap[targetKey]) {
            statusMap[targetKey] = next;
            dirty = true;
            touch(targetKey);
          }
          requestedAtMap[targetKey] = lease.nowIso;
          checkedAtMap[targetKey] = lease.nowIso;
          lastErrorMap[targetKey] = summarizeSyndicationResult(
            result,
            "publish",
          );
          dirty = true;
          touch(targetKey);
        } else {
          const next = pickForwardStatus(statusMap[targetKey], "failed");
          if (next !== statusMap[targetKey]) {
            statusMap[targetKey] = next;
            dirty = true;
            touch(targetKey);
          }
          requestedAtMap[targetKey] = lease.nowIso;
          delete checkedAtMap[targetKey];
          lastErrorMap[targetKey] = summarizeSyndicationResult(
            result,
            "publish",
          );
          dirty = true;
          touch(targetKey);
        }
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
      report.skipped.push({ file: filePath, reason: "no-changes" });
      continue;
    }

    const updated = buildFrontmatter(attributes, body);
    const message = toSkipCiMessage(`${COMMIT_PREFIX} update ${slug}`);
    const res = await updateFileContent(
      filePath,
      branch,
      currentSha,
      updated,
      message,
    );

    if (!res.ok && res.status === 409) {
      const retry = await getFileContent(filePath, branch);
      const retryParsed = fm(retry.content);
      const retryAttrs = retryParsed.attributes || {};
      retryAttrs.syndicate = attributes.syndicate;
      retryAttrs.syndicationComplete = attributes.syndicationComplete;

      const retrySyndicationMap = normalizeSyndicationMap(
        retryAttrs.syndication,
      );
      const retryStatusMap = normalizeStatusMap(retryAttrs.syndicationStatus);
      const retryRequestedAtMap = normalizeTimestampMap(
        retryAttrs.syndicationRequestedAt,
      );
      const retryCheckedAtMap = normalizeTimestampMap(
        retryAttrs.syndicationCheckedAt,
      );
      const retryLastErrorMap = normalizeErrorMap(
        retryAttrs.syndicationLastError,
      );

      const localSyndicationMap = normalizeSyndicationMap(
        attributes.syndication,
      );
      const localStatusMap = normalizeStatusMap(attributes.syndicationStatus);
      const localRequestedAtMap = normalizeTimestampMap(
        attributes.syndicationRequestedAt,
      );
      const localCheckedAtMap = normalizeTimestampMap(
        attributes.syndicationCheckedAt,
      );
      const localLastErrorMap = normalizeErrorMap(
        attributes.syndicationLastError,
      );

      for (const target of touchedTargets) {
        const localUrl = getSyndicationUrl(localSyndicationMap, target);
        const remoteUrl = getSyndicationUrl(retrySyndicationMap, target);
        if (localUrl && !remoteUrl) {
          retrySyndicationMap[target] = localUrl;
        }

        const mergedStatus = pickForwardStatus(
          retryStatusMap[target],
          localStatusMap[target],
        );
        if (mergedStatus) {
          retryStatusMap[target] = mergedStatus;
        }

        if (retryStatusMap[target] === "confirmed") {
          delete retryRequestedAtMap[target];
          delete retryCheckedAtMap[target];
          delete retryLastErrorMap[target];
          continue;
        }

        if (hasOwn(localRequestedAtMap, target)) {
          retryRequestedAtMap[target] = localRequestedAtMap[target];
        }
        if (hasOwn(localCheckedAtMap, target)) {
          retryCheckedAtMap[target] = localCheckedAtMap[target];
        } else {
          delete retryCheckedAtMap[target];
        }
        if (hasOwn(localLastErrorMap, target)) {
          retryLastErrorMap[target] = localLastErrorMap[target];
        }
      }

      retryAttrs.syndication = retrySyndicationMap;
      if (Object.keys(retryStatusMap).length > 0) {
        retryAttrs.syndicationStatus = retryStatusMap;
      } else {
        delete retryAttrs.syndicationStatus;
      }
      if (Object.keys(retryRequestedAtMap).length > 0) {
        retryAttrs.syndicationRequestedAt = retryRequestedAtMap;
      } else {
        delete retryAttrs.syndicationRequestedAt;
      }
      if (Object.keys(retryCheckedAtMap).length > 0) {
        retryAttrs.syndicationCheckedAt = retryCheckedAtMap;
      } else {
        delete retryAttrs.syndicationCheckedAt;
      }
      if (Object.keys(retryLastErrorMap).length > 0) {
        retryAttrs.syndicationLastError = retryLastErrorMap;
      } else {
        delete retryAttrs.syndicationLastError;
      }

      const retryUpdated = buildFrontmatter(retryAttrs, retryParsed.body || "");
      const retryRes = await updateFileContent(
        filePath,
        branch,
        retry.sha,
        retryUpdated,
        message,
      );
      if (!retryRes.ok) {
        report.errors.push({
          file: filePath,
          error: `Update failed (status ${retryRes.status})`,
        });
        continue;
      }
    } else if (!res.ok) {
      report.errors.push({
        file: filePath,
        error: `Update failed (status ${res.status})`,
      });
      continue;
    }

    report.updated.push({
      file: filePath,
      updatedTargets: Object.keys(syndicationMap).filter(
        (key) => BRIDGY_PUBLISH_TARGETS[key],
      ),
    });
    committedWriteback = true;
  }

  return report;
}

function isDirectInvocation() {
  const entry = process.argv[1];
  if (!entry) return false;
  return path.resolve(entry) === fileURLToPath(import.meta.url);
}

if (isDirectInvocation()) {
  runSyndicationPostDeploy()
    .then((result) => {
      console.log(JSON.stringify(result, null, 2));
    })
    .catch((err) => {
      console.error(
        `Post-deploy syndication failed: ${err?.message || String(err)}`,
      );
      process.exit(1);
    });
}
