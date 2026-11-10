import fm from "front-matter";
import fs from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";
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
import { canonicalizeUrl } from "../../lib/url.js";
import { getCanonicalBlogPath, getSiteUrl } from "../../lib/site-url.js";

const POSTS_DIR = "src/blog/posts";
const COMMIT_PREFIX = process.env.SYNDICATION_COMMIT_PREFIX || "Syndication:";
const LEASE_MAX_ATTEMPTS = 4;
const REQUIRED_GITHUB_ENV = ["GITHUB_TOKEN", "GITHUB_OWNER", "GITHUB_REPO"];
const BLUESKY_HOST_PATTERNS = [".bsky.app", ".bsky.social", ".brid.gy"];

const DEFAULT_READY_TIMEOUT_MS = 90000;
const DEFAULT_READY_INTERVAL_MS = 5000;
const DEFAULT_READY_FETCH_TIMEOUT_MS = 10000;

function parsePositiveInteger(value, fallback) {
  const parsed = Number.parseInt(String(value || ""), 10);
  return Number.isFinite(parsed) && parsed > 0 ? parsed : fallback;
}

const READY_TIMEOUT_MS = parsePositiveInteger(
  process.env.SYNDICATION_READY_TIMEOUT_MS,
  DEFAULT_READY_TIMEOUT_MS
);
const READY_INTERVAL_MS = parsePositiveInteger(
  process.env.SYNDICATION_READY_INTERVAL_MS,
  DEFAULT_READY_INTERVAL_MS
);
const READY_FETCH_TIMEOUT_MS = parsePositiveInteger(
  process.env.SYNDICATION_READY_FETCH_TIMEOUT_MS,
  DEFAULT_READY_FETCH_TIMEOUT_MS
);

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
    return entries.some(
      (entry) => entry.isFile() && entry.name.endsWith(".md")
    );
  } catch (err) {
    if (err && err.code === "ENOENT") {
      return false;
    }
    throw err;
  }
}

function hasHostSuffix(hostname, suffixes) {
  const host = `.${String(hostname || "")
    .trim()
    .toLowerCase()}`;
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
    let attributes;
    try {
      const raw = await fs.readFile(filePath, "utf-8");
      attributes = fm(raw).attributes || {};
    } catch (err) {
      throw new Error(
        `Failed to scan local post ${filePath}: ${err?.message || String(err)}`,
        { cause: err }
      );
    }

    if (attributes.draft) continue;

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
        !getSyndicationUrl(effectiveSyndicationMap, target)
    );
    summary.pendingTotal += pendingTargets.length;
    if (!summary.syncNeeded) {
      const needsSyndicateCleanup = syndicateTargets.some((target) =>
        getSyndicationUrl(effectiveSyndicationMap, target)
      );
      const needsStatusConfirm = Object.keys(effectiveSyndicationMap).some(
        (target) =>
          BRIDGY_PUBLISH_TARGETS[target] && statusMap[target] !== "confirmed"
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
    `/contents/${POSTS_DIR}?ref=${encodeURIComponent(branch)}`
  );
  // A 404 is a wrong branch or a token without access, not an empty blog;
  // saying so beats reporting nothing to do
  if (!res.ok) {
    throw new Error(`Failed to list posts (status ${res.status})`);
  }
  const data = await res.json();
  return (Array.isArray(data) ? data : []).filter(
    (entry) => entry.type === "file" && entry.name.endsWith(".md")
  );
}

async function getFileContent(path, branch) {
  const res = await githubRequest(
    `/contents/${path}?ref=${encodeURIComponent(branch)}`
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

// Reads the post fresh, lets mutate change it, and writes it against the sha
// it read. A 409 means something else wrote first, so read and apply again.
async function updatePost({ filePath, branch, message, mutate }) {
  for (let attempt = 0; attempt < LEASE_MAX_ATTEMPTS; attempt += 1) {
    const fetched = await getFileContent(filePath, branch);
    const parsed = fm(fetched.content);
    const attributes = parsed.attributes || {};
    const outcome = mutate(attributes);
    if (!outcome.write) {
      return { written: false, reason: outcome.reason };
    }

    const res = await updateFileContent(
      filePath,
      branch,
      fetched.sha,
      buildFrontmatter(attributes, parsed.body || ""),
      message
    );
    if (res.ok) {
      return { written: true };
    }
    if (res.status !== 409) {
      return { written: false, reason: "error", status: res.status };
    }
  }

  return { written: false, reason: "lease-conflict" };
}

function findSyndicatedUrl(attributes, state, target) {
  return (
    getSyndicationUrl(state.syndicationMap, target) ||
    inferLegacySyndicationUrl(attributes, target)
  );
}

async function acquirePublishLease({ filePath, branch, target, now }) {
  const nowIso = now.toISOString();
  const slug = filePath.split("/").pop()?.replace(/\.md$/, "") || filePath;
  const message = toSkipCiMessage(
    `${COMMIT_PREFIX} lease publish ${slug} ${target}`
  );

  const res = await updatePost({
    filePath,
    branch,
    message,
    mutate: (attributes) => {
      if (!normalizeSyndicateTargets(attributes.syndicate).includes(target)) {
        return { write: false, reason: "not-syndicated" };
      }
      const state = collectSyndicationState(attributes);
      if (findSyndicatedUrl(attributes, state, target)) {
        return { write: false, reason: "already-syndicated" };
      }
      const eligibility = canAttemptPublishNow({
        target,
        state,
        now,
      });
      if (!eligibility.ok) {
        return { write: false, reason: eligibility.reason };
      }

      state.statusMap[target] =
        pickForwardStatus(state.statusMap[target], "requested") || "requested";
      state.requestedAtMap[target] = nowIso;
      state.checkedAtMap[target] = nowIso;
      delete state.lastErrorMap[target];
      applySyndicationState(attributes, state);
      return { write: true };
    },
  });

  if (res.written) {
    return { acquired: true, nowIso };
  }
  if (res.reason === "error") {
    throw new Error(
      `Lease publish update failed for ${filePath} -> ${target} (status ${res.status})`
    );
  }
  return { acquired: false, reason: res.reason };
}

async function acquireConfirmLease({ filePath, branch, target, now }) {
  const nowIso = now.toISOString();
  const slug = filePath.split("/").pop()?.replace(/\.md$/, "") || filePath;
  const message = toSkipCiMessage(
    `${COMMIT_PREFIX} lease confirm ${slug} ${target}`
  );

  const res = await updatePost({
    filePath,
    branch,
    message,
    mutate: (attributes) => {
      const state = collectSyndicationState(attributes);
      // A confirm re-sends the publish, so a URL added by hand must stop it
      if (findSyndicatedUrl(attributes, state, target)) {
        return { write: false, reason: "already-syndicated" };
      }
      const status = normalizeStatusValue(state.statusMap[target]);
      if (status !== "requested") {
        return { write: false, reason: "not-requested" };
      }

      const requestedAction = getRequestedConfirmAction({
        status,
        requestedAt: state.requestedAtMap[target],
        checkedAt: state.checkedAtMap[target],
        now,
      });
      if (requestedAction.action !== "confirm") {
        return { write: false, reason: `requested-${requestedAction.action}` };
      }

      state.checkedAtMap[target] = nowIso;
      applySyndicationState(attributes, state);
      return { write: true };
    },
  });

  if (res.written) {
    return { acquired: true, nowIso };
  }
  if (res.reason === "error") {
    throw new Error(
      `Lease confirm update failed for ${filePath} -> ${target} (status ${res.status})`
    );
  }
  return { acquired: false, reason: res.reason };
}

function toOutcome(result, leaseIso, phase) {
  if (result.ok && result.syndicatedUrl) {
    return { url: result.syndicatedUrl };
  }
  const lastError = summarizeSyndicationResult(result, phase);
  if (shouldMarkRequested(result)) {
    return {
      status: "requested",
      requestedAt: leaseIso,
      // A confirm keeps the original request time so the request can go stale
      keepRequestedAt: phase === "confirm",
      checkedAt: leaseIso,
      lastError,
    };
  }
  // A refusal is final for this request. pickForwardStatus would keep
  // "requested", and with the fresh timestamp it would never go stale.
  return { status: "failed", requestedAt: leaseIso, checkedAt: "", lastError };
}

// Settles the syndication keys of a post as read now: adopts URLs that are
// already there (legacy fields, by hand, another run), applies this run's
// Bridgy outcomes, and seeds or expires requests. Nothing else is touched,
// so edits made during the run survive the write-back.
function reconcilePost(attributes, outcomes, now) {
  const nowIso = now.toISOString();
  const syndicateTargets = normalizeSyndicateTargets(attributes.syndicate);
  const state = collectSyndicationState(attributes);
  const {
    syndicationMap,
    statusMap,
    requestedAtMap,
    checkedAtMap,
    lastErrorMap,
  } = state;

  for (const target of syndicateTargets) {
    if (getSyndicationUrl(syndicationMap, target)) continue;
    const legacyUrl = inferLegacySyndicationUrl(attributes, target);
    if (legacyUrl) syndicationMap[target] = legacyUrl;
  }

  for (const [target, outcome] of outcomes) {
    if (getSyndicationUrl(syndicationMap, target)) continue;
    if (outcome.url) {
      syndicationMap[target] = outcome.url;
      continue;
    }
    // A refusal this run is newer than the "requested" it conflicts with
    const status =
      outcome.status === "failed" &&
      normalizeStatusValue(statusMap[target]) === "requested"
        ? "failed"
        : pickForwardStatus(statusMap[target], outcome.status);
    statusMap[target] = status;
    if (status === "confirmed") continue;
    requestedAtMap[target] =
      (outcome.keepRequestedAt && requestedAtMap[target]) ||
      outcome.requestedAt;
    if (outcome.checkedAt) {
      checkedAtMap[target] = outcome.checkedAt;
    } else {
      delete checkedAtMap[target];
    }
    lastErrorMap[target] = outcome.lastError;
  }

  const settle = (target) => {
    statusMap[target] = "confirmed";
    delete requestedAtMap[target];
    delete checkedAtMap[target];
    delete lastErrorMap[target];
  };

  for (const target of Object.keys(syndicationMap)) {
    if (BRIDGY_PUBLISH_TARGETS[target]) settle(target);
  }

  for (const target of syndicateTargets) {
    const status = normalizeStatusValue(statusMap[target]);
    if (getSyndicationUrl(syndicationMap, target) || status === "confirmed") {
      settle(target);
      continue;
    }
    if (status !== "requested") continue;

    const { action } = getRequestedConfirmAction({
      status,
      requestedAt: requestedAtMap[target],
      checkedAt: checkedAtMap[target],
      now,
    });
    if (action === "seed-requested-at") {
      requestedAtMap[target] = nowIso;
      checkedAtMap[target] = nowIso;
      if (!lastErrorMap[target]) {
        lastErrorMap[target] = "requested-missing-timestamp";
      }
    } else if (action === "stale-failed") {
      statusMap[target] = "failed";
      requestedAtMap[target] = nowIso;
      delete checkedAtMap[target];
      lastErrorMap[target] = truncateError("requested-stale");
    }
  }

  const remainingSyndicate = syndicateTargets.filter(
    (target) => !getSyndicationUrl(syndicationMap, target)
  );
  if (remainingSyndicate.length > 0) {
    attributes.syndicate = remainingSyndicate;
    delete attributes.syndicationComplete;
  } else if (
    syndicateTargets.length > 0 ||
    attributes.syndicate !== undefined
  ) {
    delete attributes.syndicate;
    attributes.syndicationComplete = true;
  }

  applySyndicationState(attributes, state);
  return state;
}

// Normalized so reformatting alone never counts as a change worth a commit
function syndicationSnapshot(attributes) {
  return JSON.stringify(
    {
      ...collectSyndicationState(attributes),
      syndicate: normalizeSyndicateTargets(attributes.syndicate),
      hasSyndicate: attributes.syndicate !== undefined,
      complete: attributes.syndicationComplete ?? null,
    },
    (key, value) =>
      value && typeof value === "object" && !Array.isArray(value)
        ? Object.fromEntries(
            Object.entries(value).sort(([a], [b]) => (a < b ? -1 : 1))
          )
        : value
  );
}

function sleep(ms) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

async function fetchWithTimeout(url, options = {}) {
  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), READY_FETCH_TIMEOUT_MS);
  try {
    return await fetch(url, {
      ...options,
      headers: {
        ...(options.headers || {}),
        "Cache-Control": "no-cache",
        Pragma: "no-cache",
      },
      signal: controller.signal,
    });
  } finally {
    clearTimeout(timeout);
  }
}

async function isUrlReady(url, { requiredText = [] } = {}) {
  const needed = [].concat(requiredText).filter(Boolean);
  try {
    const head = await fetchWithTimeout(url, { method: "HEAD" });
    if (head.ok && needed.length === 0) return true;
  } catch {
    // Some CDNs reject HEAD before GET is ready.
  }

  try {
    const res = await fetchWithTimeout(url, { method: "GET" });
    if (!res.ok) return false;
    if (needed.length === 0) return true;
    const text = await res.text();
    return needed.every((item) => text.includes(item));
  } catch {
    return false;
  }
}

async function waitForUrlReady(url, options = {}) {
  const deadline = Date.now() + READY_TIMEOUT_MS;
  let attempts = 0;

  while (Date.now() <= deadline) {
    attempts += 1;
    if (await isUrlReady(url, options)) {
      return { ok: true, attempts };
    }
    await sleep(READY_INTERVAL_MS);
  }

  return { ok: false, attempts };
}

// Bridgy reads the page for a link to each target it publishes to, so every
// target about to be published needs its link live
async function waitForPublishAssets({ canonicalUrl, publishTargets = [] }) {
  const pageReady = await waitForUrlReady(canonicalUrl, {
    requiredText: publishTargets.map(
      (target) => BRIDGY_PUBLISH_TARGETS[target]
    ),
  });
  if (!pageReady.ok) {
    return { ok: false, reason: "page-not-ready", url: canonicalUrl };
  }

  return { ok: true };
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
      `Missing required syndication configuration: ${missingEnv.join(", ")}`
    );
  }

  const branch = process.env.GITHUB_BRANCH || "main";
  const now = new Date();
  const report = {
    skipped: [],
    updated: [],
    errors: [],
  };

  let files;
  try {
    files = await listPostFiles(branch);
  } catch (err) {
    throw new Error(
      `Failed to list posts for syndication: ${err?.message || String(err)}`,
      { cause: err }
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

      if (attributes.draft) continue;

      const syndicationMap = normalizeSyndicationMap(attributes.syndication);
      const syndicateTargets = normalizeSyndicateTargets(attributes.syndicate);
      const statusMap = normalizeStatusMap(attributes.syndicationStatus);
      const pendingTargets = syndicateTargets.filter(
        (target) =>
          BRIDGY_PUBLISH_TARGETS[target] &&
          !getSyndicationUrl(syndicationMap, target)
      );
      pendingTotal += pendingTargets.length;
      if (!syncNeeded) {
        const needsSyndicateCleanup = syndicateTargets.some((target) =>
          getSyndicationUrl(syndicationMap, target)
        );
        const needsStatusConfirm = Object.keys(syndicationMap).some(
          (target) =>
            BRIDGY_PUBLISH_TARGETS[target] && statusMap[target] !== "confirmed"
        );
        syncNeeded = needsSyndicateCleanup || needsStatusConfirm;
      }

      posts.push({ filePath, attributes });
    } catch (err) {
      report.errors.push({ file: filePath, error: err.message });
    }
  }

  if (pendingTotal === 0 && !syncNeeded) {
    return { skipped: true, reason: "no-pending" };
  }

  const siteUrl = getSiteUrl();

  for (const post of posts) {
    const { filePath, attributes } = post;
    const slug = filePath.split("/").pop()?.replace(/\.md$/, "") || "";
    const canonicalUrl = buildCanonicalUrl(attributes, slug, siteUrl);
    const syndicateTargets = normalizeSyndicateTargets(attributes.syndicate);

    // Plan from the scan; leases and the write-back each read the file again
    const planned = structuredClone(attributes);
    const state = reconcilePost(planned, new Map(), now);
    const outcomes = new Map();
    const pendingTargets = [];
    // A lease reads the file again and may find it changed, so settle it
    let leased = false;

    for (const target of syndicateTargets) {
      if (getSyndicationUrl(state.syndicationMap, target)) continue;
      const status = normalizeStatusValue(state.statusMap[target]);
      if (status === "confirmed") continue;

      if (status !== "requested") {
        const ageHours = hoursSince(state.requestedAtMap[target], now);
        if (status === "failed" && ageHours < FAILED_BACKOFF_HOURS) continue;
        pendingTargets.push(target);
        continue;
      }

      const requestedAction = getRequestedConfirmAction({
        status,
        requestedAt: state.requestedAtMap[target],
        checkedAt: state.checkedAtMap[target],
        now,
      });
      if (requestedAction.action !== "confirm") continue;

      leased = true;
      const lease = await acquireConfirmLease({
        filePath,
        branch,
        target,
        now,
      });
      if (!lease.acquired) continue;

      const result = await sendBridgyWebmention({
        source: canonicalUrl,
        target: BRIDGY_PUBLISH_TARGETS[target],
      });
      outcomes.set(target, toOutcome(result, lease.nowIso, "confirm"));
    }

    if (pendingTargets.length > 0) {
      const ready = await waitForPublishAssets({
        canonicalUrl,
        publishTargets: pendingTargets,
      });
      if (!ready.ok) {
        report.skipped.push({
          file: filePath,
          reason: ready.reason,
          url: ready.url,
        });
      } else {
        for (const target of pendingTargets) {
          leased = true;
          const lease = await acquirePublishLease({
            filePath,
            branch,
            target,
            now,
          });
          if (!lease.acquired) continue;

          const result = await sendBridgyWebmention({
            source: canonicalUrl,
            target: BRIDGY_PUBLISH_TARGETS[target],
          });
          outcomes.set(target, toOutcome(result, lease.nowIso, "publish"));
        }
      }
    }

    if (
      !leased &&
      syndicationSnapshot(planned) === syndicationSnapshot(attributes)
    ) {
      report.skipped.push({ file: filePath, reason: "no-changes" });
      continue;
    }

    const message = toSkipCiMessage(`${COMMIT_PREFIX} update ${slug}`);
    let written = state;
    let res;
    try {
      res = await updatePost({
        filePath,
        branch,
        message,
        mutate: (fresh) => {
          const before = syndicationSnapshot(fresh);
          written = reconcilePost(fresh, outcomes, now);
          return syndicationSnapshot(fresh) === before
            ? { write: false, reason: "no-changes" }
            : { write: true };
        },
      });
    } catch (err) {
      report.errors.push({ file: filePath, error: err.message });
      continue;
    }

    if (res.reason === "no-changes") {
      report.skipped.push({ file: filePath, reason: "no-changes" });
      continue;
    }
    if (!res.written) {
      report.errors.push({
        file: filePath,
        error: `Update failed (${res.status ? `status ${res.status}` : res.reason})`,
      });
      continue;
    }

    report.updated.push({
      file: filePath,
      updatedTargets: Object.keys(written.syndicationMap).filter(
        (key) => BRIDGY_PUBLISH_TARGETS[key]
      ),
    });
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
        `Post-deploy syndication failed: ${err?.message || String(err)}`
      );
      process.exit(1);
    });
}
