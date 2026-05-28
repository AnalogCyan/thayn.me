(function () {
  function init() {
    const DATE_ONLY_RE = /^\d{4}-\d{2}-\d{2}$/;
    const MIDNIGHT_UTC_RE = /T00:00:00(?:\.000)?Z$/i;

    function formatDates() {
      const locale = window.JG_I18N
        ? window.JG_I18N.getState().locale
        : undefined;
      document.querySelectorAll("time[datetime]").forEach((el) => {
        const raw = el.getAttribute("datetime");
        if (!raw) return;
        const isDateOnly = DATE_ONLY_RE.test(raw) || MIDNIGHT_UTC_RE.test(raw);
        const date = isDateOnly
          ? new Date(`${raw.slice(0, 10)}T12:00:00Z`)
          : new Date(raw);
        if (Number.isNaN(date.getTime())) return;

        if (isDateOnly) {
          el.textContent = date.toLocaleDateString(locale, {
            year: "numeric",
            month: "long",
            day: "numeric",
          });
          return;
        }

        el.textContent = date.toLocaleString(locale, {
          year: "numeric",
          month: "short",
          day: "numeric",
          hour: "2-digit",
          minute: "2-digit",
        });
      });
    }

    const blogSearch = document.getElementById("blog-search");
    const tagFilter = document.getElementById("tag-filter");
    const posts = document.querySelectorAll(".blog-card");

    let debounceTimeout;

    function debounce(func, wait) {
      return function executedFunction(...args) {
        const later = () => {
          clearTimeout(debounceTimeout);
          func(...args);
        };
        clearTimeout(debounceTimeout);
        debounceTimeout = setTimeout(later, wait);
      };
    }

    function normalizeValue(value) {
      return String(value || "")
        .toLowerCase()
        .trim()
        .replace(/\s+/g, " ");
    }

    function getVisibleLocalizedText(container, selector) {
      const target = container.querySelector(selector);
      if (!target) return "";
      const localized = target.querySelector?.(
        "[data-blog-lang]:not([hidden])"
      );
      const content = localized || target;
      return normalizeValue(content.textContent);
    }

    function filterPosts() {
      const searchQuery = normalizeValue(blogSearch?.value || "");
      const selectedTag = normalizeValue(tagFilter?.value || "");

      posts.forEach((post) => {
        const postTitle = getVisibleLocalizedText(post, "h3");
        const postExcerpt = getVisibleLocalizedText(post, ".p-summary");
        const postTagText = getVisibleLocalizedText(post, ".tag");
        const postTagKey = normalizeValue(post.dataset.tagKey);

        const matchesSearch =
          !searchQuery ||
          postTitle.includes(searchQuery) ||
          postTagText.includes(searchQuery) ||
          postExcerpt.includes(searchQuery);

        const matchesTag = !selectedTag || postTagKey === selectedTag;

        if (matchesSearch && matchesTag) {
          post.classList.remove("hidden");
          requestAnimationFrame(() => post.classList.remove("fade-out"));
        } else {
          post.classList.add("fade-out");
          const onFade = (event) => {
            if (event.propertyName !== "opacity") return;
            if (post.classList.contains("fade-out")) {
              post.classList.add("hidden");
            }
          };
          post.addEventListener("transitionend", onFade, { once: true });
        }
      });
    }

    const debouncedFilter = debounce(filterPosts, 300);

    blogSearch?.addEventListener("input", debouncedFilter);
    tagFilter?.addEventListener("change", filterPosts);

    posts.forEach((post) => {
      post.classList.remove("hidden", "fade-out");
    });
    filterPosts();

    formatDates();
    document.addEventListener("th-i18n-ready", () => {
      formatDates();
      filterPosts();
    });
  }

  if (document.readyState === "loading") {
    document.addEventListener("DOMContentLoaded", init);
  } else {
    init();
  }
})();
