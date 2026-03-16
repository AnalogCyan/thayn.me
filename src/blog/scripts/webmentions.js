import { sanitizeExternalUrl } from "/lib/sanitize-url.js";

(() => {
  const container = document.getElementById("webmentions");
  if (!container) return;

  const target = sanitizeExternalUrl(container.dataset.target);
  if (!target) return;

  const reactionsContainer = document.getElementById("post-reactions");

  const DEFAULT_REFRESH_SECONDS = 180;
  const MIN_REFRESH_SECONDS = 60;
  const MAX_REFRESH_SECONDS = 900;
  const RESUME_BACKOFF_MS = 2000;
  const FAILURE_BACKOFF_BASE_MS = 15000;
  const FAILURE_BACKOFF_MAX_MS = 10 * 60 * 1000;
  const POLL_JITTER_MS = 5000;

  function parseRefreshSeconds(value) {
    const parsed = Number.parseInt(value || "", 10);
    if (!Number.isFinite(parsed) || parsed <= 0) {
      return DEFAULT_REFRESH_SECONDS;
    }
    return Math.max(MIN_REFRESH_SECONDS, Math.min(MAX_REFRESH_SECONDS, parsed));
  }

  const refreshSeconds = parseRefreshSeconds(container.dataset.refreshSeconds);

  let controller = null;
  let timer = null;
  let paused = false;
  let hasFetchedBuckets = false;
  let latestBuckets = createBuckets();
  let lastKnownCount = null;
  let consecutiveFailures = 0;

  function createBuckets() {
    return {
      replies: [],
      likes: [],
      reposts: [],
      mentions: [],
      bookmarks: [],
    };
  }

  function bucketCount(buckets) {
    return Object.values(buckets).reduce(
      (total, items) => total + (Array.isArray(items) ? items.length : 0),
      0,
    );
  }

  function endpoint({ countOnly = false } = {}) {
    const params = new URLSearchParams({ target });
    if (countOnly) {
      params.set("mode", "count");
    }
    return `/.netlify/functions/webmentions?${params.toString()}`;
  }

  const t = (key, fallback) => {
    if (window.JG_I18N && typeof window.JG_I18N.t === "function") {
      return window.JG_I18N.t(key, fallback);
    }
    return fallback;
  };

  const extractText = (item) => {
    if (!item || !item.content) return "";
    if (typeof item.content === "string") return item.content.trim();
    if (typeof item.content === "object") {
      return String(item.content.text || item.content.value || "").trim();
    }
    return "";
  };

  const normalizeAuthor = (item) => {
    const author = (item && item.author) || {};
    const authorName =
      String(author.name || author.url || item.url || "Someone").trim() ||
      "Someone";
    const authorUrl = sanitizeExternalUrl(author.url || item.url);
    const authorPhoto = sanitizeExternalUrl(author.photo);
    return { authorName, authorUrl, authorPhoto };
  };

  const normalizeReply = (item) => {
    const author = normalizeAuthor(item);
    const published = item.published || item["wm-received"] || "";
    const received = item["wm-received"] || item.published || "";
    const text = extractText(item);
    const url = sanitizeExternalUrl(item.url);
    const authorLink = author.authorUrl || url || null;
    return {
      ...author,
      authorLink,
      published,
      received,
      text,
      url,
    };
  };

  const normalizePerson = (item) => {
    const author = normalizeAuthor(item);
    const url = sanitizeExternalUrl(item.url) || author.authorUrl || null;
    const authorLink = author.authorUrl || url || null;
    return {
      ...author,
      authorLink,
      url,
    };
  };

  const toTime = (value) => {
    if (!value) return 0;
    const parsed = Date.parse(value);
    return Number.isNaN(parsed) ? 0 : parsed;
  };

  const groupMentions = (payload) => {
    const buckets = createBuckets();
    const items = Array.isArray(payload?.children) ? payload.children : [];

    for (const item of items) {
      if (!item) continue;
      const isPrivate =
        item["wm-private"] === true ||
        item["wm-private"] === "true" ||
        item["wm-private"] === 1;
      if (isPrivate) continue;

      const prop = item["wm-property"];
      if (prop === "in-reply-to") {
        buckets.replies.push(normalizeReply(item));
      } else if (prop === "like-of") {
        buckets.likes.push(normalizePerson(item));
      } else if (prop === "repost-of") {
        buckets.reposts.push(normalizePerson(item));
      } else if (prop === "mention-of") {
        buckets.mentions.push(normalizePerson(item));
      } else if (prop === "bookmark-of") {
        buckets.bookmarks.push(normalizePerson(item));
      }
    }

    buckets.replies.sort((a, b) => toTime(a.received) - toTime(b.received));

    return buckets;
  };

  const REACTION_TYPES = [
    { key: "likes", iconClass: "ri-heart-3-fill", iconColor: "#e11d48", labelKey: "blog.webmentions.likes", labelFallback: "Likes" },
    { key: "reposts", iconClass: "ri-repeat-fill", iconColor: "#16a34a", labelKey: "blog.webmentions.reposts", labelFallback: "Reposts" },
    { key: "mentions", iconClass: "ri-at-line", iconColor: "#2563eb", labelKey: "blog.webmentions.mentions", labelFallback: "Mentions" },
    { key: "bookmarks", iconClass: "ri-bookmark-fill", iconColor: "#d97706", labelKey: "blog.webmentions.bookmarks", labelFallback: "Bookmarks" },
  ];

  const renderReactions = (buckets) => {
    if (!reactionsContainer) return;
    reactionsContainer.textContent = "";

    const active = REACTION_TYPES.filter(({ key }) => buckets[key]?.length > 0);
    if (active.length === 0) {
      reactionsContainer.hidden = true;
      return;
    }

    reactionsContainer.hidden = false;
    for (const { key, iconClass, iconColor, labelKey, labelFallback } of active) {
      const count = buckets[key].length;
      const pill = document.createElement("span");
      pill.className = "post-reaction";
      pill.setAttribute("aria-label", `${count} ${t(labelKey, labelFallback)}`);

      const icon = document.createElement("i");
      icon.className = iconClass;
      icon.style.color = iconColor;
      icon.setAttribute("aria-hidden", "true");
      pill.appendChild(icon);
      pill.appendChild(document.createTextNode(` ${count}`));

      reactionsContainer.appendChild(pill);
    }
  };

  const render = (buckets) => {
    renderReactions(buckets);

    container.textContent = "";

    const title = document.createElement("h2");
    title.textContent = t("blog.webmentions.title", "Comments");
    container.appendChild(title);

    if (buckets.replies.length === 0) {
      const empty = document.createElement("p");
      empty.className = "webmentions-empty";
      empty.textContent = t("blog.webmentions.empty", "No comments yet.");
      container.appendChild(empty);
      return;
    }

    const list = document.createElement("ul");
    list.className = "webmentions-replies";

    for (const item of buckets.replies) {
      const li = document.createElement("li");
      li.className = "webmention-reply";

      const meta = document.createElement("div");
      meta.className = "webmention-meta";

      const linkUrl = item.authorLink;
      const hasLink = Boolean(linkUrl);
      const authorEl = hasLink
        ? document.createElement("a")
        : document.createElement("span");
      if (hasLink) {
        authorEl.href = linkUrl;
        authorEl.rel = "nofollow ugc";
      }
      authorEl.textContent = item.authorName || "Someone";
      meta.appendChild(authorEl);

      if (item.published) {
        const date = new Date(item.published);
        if (!Number.isNaN(date.getTime())) {
          const time = document.createElement("time");
          time.dateTime = item.published;
          time.textContent = date.toLocaleString("en-US", {
            year: "numeric",
            month: "short",
            day: "numeric",
            hour: "2-digit",
            minute: "2-digit",
          });
          meta.appendChild(time);
        }
      }

      li.appendChild(meta);

      if (item.text) {
        const body = document.createElement("p");
        body.textContent = item.text;
        li.appendChild(body);
      }

      if (item.url) {
        const source = document.createElement("a");
        source.className = "webmention-source";
        source.href = item.url;
        source.rel = "nofollow ugc";
        source.textContent = t("blog.webmentions.source", "View source");
        li.appendChild(source);
      }

      list.appendChild(li);
    }

    container.appendChild(list);
  };

  function isAbortError(err) {
    return Boolean(err && typeof err === "object" && err.name === "AbortError");
  }

  async function fetchJson({ countOnly = false } = {}) {
    if (controller) {
      controller.abort();
    }

    const currentController = new AbortController();
    controller = currentController;

    try {
      const res = await fetch(endpoint({ countOnly }), {
        signal: currentController.signal,
        headers: { Accept: "application/json" },
      });

      if (!res.ok) {
        throw new Error(`webmentions-http-${res.status}`);
      }

      return await res.json();
    } finally {
      if (controller === currentController) {
        controller = null;
      }
    }
  }

  async function refreshFull() {
    const payload = await fetchJson({ countOnly: false });
    const buckets = groupMentions(payload);
    latestBuckets = buckets;
    hasFetchedBuckets = true;
    lastKnownCount = bucketCount(buckets);
    render(buckets);
  }

  async function fetchCount() {
    const payload = await fetchJson({ countOnly: true });
    const count = Number(payload?.count);
    if (!Number.isFinite(count) || count < 0) {
      throw new Error("webmentions-invalid-count");
    }
    return count;
  }

  function clearTimer() {
    if (timer) {
      window.clearTimeout(timer);
      timer = null;
    }
  }

  function withJitter(delayMs) {
    const jitter = Math.floor(Math.random() * POLL_JITTER_MS);
    return delayMs + jitter;
  }

  function computeDelay(baseDelayMs) {
    if (consecutiveFailures <= 0) {
      return withJitter(baseDelayMs);
    }

    const failureDelay = Math.min(
      FAILURE_BACKOFF_MAX_MS,
      FAILURE_BACKOFF_BASE_MS * 2 ** (consecutiveFailures - 1),
    );

    return withJitter(Math.max(baseDelayMs, failureDelay));
  }

  function schedule(delayMs) {
    if (paused || document.visibilityState === "hidden") return;

    clearTimer();
    const base =
      typeof delayMs === "number" ? delayMs : refreshSeconds * 1000;
    timer = window.setTimeout(() => {
      void poll();
    }, computeDelay(base));
  }

  async function poll() {
    if (paused || document.visibilityState === "hidden") return;

    try {
      if (!hasFetchedBuckets) {
        await refreshFull();
      } else {
        const remoteCount = await fetchCount();
        if (lastKnownCount === null || remoteCount !== lastKnownCount) {
          await refreshFull();
        }
      }

      consecutiveFailures = 0;
    } catch (err) {
      if (isAbortError(err)) {
        return;
      }
      consecutiveFailures += 1;
    }

    schedule();
  }

  function pause() {
    paused = true;
    if (controller) controller.abort();
    clearTimer();
  }

  function resume() {
    if (!paused && timer) return;
    paused = false;
    schedule(RESUME_BACKOFF_MS);
  }

  void poll();

  document.addEventListener("th-i18n-ready", () => {
    if (!hasFetchedBuckets) return;
    render(latestBuckets);
  });

  document.addEventListener("visibilitychange", () => {
    if (document.visibilityState === "hidden") {
      pause();
    } else {
      resume();
    }
  });

  window.addEventListener("beforeunload", () => {
    if (controller) controller.abort();
    clearTimer();
  });
})();
