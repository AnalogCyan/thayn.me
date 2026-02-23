import { sanitizeExternalUrl } from "/lib/sanitize-url.js";

(() => {
  const container = document.getElementById("webmentions");
  if (!container) return;

  const target = sanitizeExternalUrl(container.dataset.target);
  if (!target) return;

  const refreshSeconds = Number.parseInt(
    container.dataset.refreshSeconds || "60",
    10,
  );

  let controller = null;
  let timer = null;
  let paused = false;
  const resumeBackoffMs = 2000;

  const createBuckets = () => ({
    replies: [],
    likes: [],
    reposts: [],
    mentions: [],
    bookmarks: [],
  });
  let latestBuckets = createBuckets();

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
    return {
      ...author,
      published,
      received,
      text,
      url,
    };
  };

  const normalizePerson = (item) => {
    const author = normalizeAuthor(item);
    const url = sanitizeExternalUrl(item.url) || author.authorUrl || null;
    return {
      ...author,
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

  const renderPeopleGroup = (labelKey, labelFallback, items, className) => {
    const group = document.createElement("div");
    group.className = `webmentions-group ${className}`;

    const heading = document.createElement("h3");
    heading.textContent = `${t(labelKey, labelFallback)} (${items.length})`;
    group.appendChild(heading);

    const list = document.createElement("ul");
    list.className = "webmentions-people";

    for (const item of items) {
      const li = document.createElement("li");
      const hasLink = item.authorUrl;
      const wrapper = hasLink
        ? document.createElement("a")
        : document.createElement("span");
      if (hasLink) {
        wrapper.href = item.authorUrl;
        wrapper.rel = "nofollow ugc";
      }

      const name = document.createElement("span");
      name.textContent = item.authorName || "Someone";
      wrapper.appendChild(name);

      li.appendChild(wrapper);
      list.appendChild(li);
    }

    group.appendChild(list);
    return group;
  };

  const renderRepliesGroup = (items) => {
    const group = document.createElement("div");
    group.className = "webmentions-group webmentions-replies";

    const heading = document.createElement("h3");
    heading.textContent = `${t("blog.webmentions.replies", "Replies")} (${items.length})`;
    group.appendChild(heading);

    const list = document.createElement("ul");
    list.className = "webmentions-replies";

    for (const item of items) {
      const li = document.createElement("li");
      li.className = "webmention-reply";

      const meta = document.createElement("div");
      meta.className = "webmention-meta";

      const hasLink = item.authorUrl;
      const authorEl = hasLink
        ? document.createElement("a")
        : document.createElement("span");
      if (hasLink) {
        authorEl.href = item.authorUrl;
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

    group.appendChild(list);
    return group;
  };

  const render = (buckets) => {
    container.textContent = "";

    const title = document.createElement("h2");
    title.textContent = t("blog.webmentions.title", "Webmentions");
    container.appendChild(title);

    const hasAny = Object.values(buckets).some((items) => items.length > 0);
    if (!hasAny) {
      const empty = document.createElement("p");
      empty.className = "webmentions-empty";
      empty.textContent = t("blog.webmentions.empty", "No webmentions yet.");
      container.appendChild(empty);
      return;
    }

    if (buckets.likes.length > 0) {
      container.appendChild(
        renderPeopleGroup(
          "blog.webmentions.likes",
          "Likes",
          buckets.likes,
          "webmentions-likes",
        ),
      );
    }
    if (buckets.reposts.length > 0) {
      container.appendChild(
        renderPeopleGroup(
          "blog.webmentions.reposts",
          "Reposts",
          buckets.reposts,
          "webmentions-reposts",
        ),
      );
    }
    if (buckets.mentions.length > 0) {
      container.appendChild(
        renderPeopleGroup(
          "blog.webmentions.mentions",
          "Mentions",
          buckets.mentions,
          "webmentions-mentions",
        ),
      );
    }
    if (buckets.bookmarks.length > 0) {
      container.appendChild(
        renderPeopleGroup(
          "blog.webmentions.bookmarks",
          "Bookmarks",
          buckets.bookmarks,
          "webmentions-bookmarks",
        ),
      );
    }
    if (buckets.replies.length > 0) {
      container.appendChild(renderRepliesGroup(buckets.replies));
    }
  };

  const refresh = async () => {
    if (controller) controller.abort();
    controller = new AbortController();

    try {
      const res = await fetch(
        `/.netlify/functions/webmentions?target=${encodeURIComponent(target)}`,
        { signal: controller.signal, headers: { Accept: "application/json" } },
      );
      if (!res.ok) return;
      const payload = await res.json();
      const buckets = groupMentions(payload);
      latestBuckets = buckets;
      render(buckets);
    } catch (err) {
      if (err.name === "AbortError") {
        return;
      }
    } finally {
      controller = null;
    }
  };

  const clearTimer = () => {
    if (timer) {
      window.clearTimeout(timer);
      timer = null;
    }
  };

  const schedule = (delayMs) => {
    if (!Number.isFinite(refreshSeconds) || refreshSeconds <= 0) return;
    if (paused || document.visibilityState === "hidden") return;
    clearTimer();
    const delay = typeof delayMs === "number" ? delayMs : refreshSeconds * 1000;
    timer = window.setTimeout(async () => {
      await refresh();
      schedule();
    }, delay);
  };

  const pause = () => {
    paused = true;
    if (controller) controller.abort();
    clearTimer();
  };

  const resume = () => {
    if (!paused && timer) return;
    paused = false;
    schedule(resumeBackoffMs);
  };

  refresh();
  schedule();
  document.addEventListener("th-i18n-ready", () => {
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
