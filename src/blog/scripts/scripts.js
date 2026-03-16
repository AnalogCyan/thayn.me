(function () {
  function init() {
  const DATE_ONLY_RE = /^\d{4}-\d{2}-\d{2}$/;
  const MIDNIGHT_UTC_RE = /T00:00:00(?:\.000)?Z$/i;

  function formatDates() {
    const locale = window.JG_I18N ? window.JG_I18N.getState().locale : undefined;
    document.querySelectorAll("time[datetime]").forEach((el) => {
      const raw = el.getAttribute("datetime");
      if (!raw) return;
      const isDateOnly = DATE_ONLY_RE.test(raw) || MIDNIGHT_UTC_RE.test(raw);
      const date = isDateOnly ? new Date(`${raw.slice(0, 10)}T12:00:00Z`) : new Date(raw);
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
  const authorFilter = document.getElementById("author-filter");
  const categoryFilter = document.getElementById("category-filter");
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
    const localized = target.querySelector?.("[data-blog-lang]:not([hidden])");
    const content = localized || target;
    return normalizeValue(content.textContent);
  }

  function filterPosts() {
    const searchQuery = normalizeValue(blogSearch?.value || "");
    const selectedAuthor = normalizeValue(authorFilter?.value || "");
    const selectedCategory = normalizeValue(categoryFilter?.value || "");

    posts.forEach((post) => {
      const postTitle = getVisibleLocalizedText(post, "h3");
      const postAuthorText = getVisibleLocalizedText(post, ".p-author");
      const postExcerpt = getVisibleLocalizedText(post, ".p-summary");
      const postCategoryText = getVisibleLocalizedText(post, ".tag");
      const postAuthorKey = normalizeValue(post.dataset.authorKey);
      const postCategoryKey = normalizeValue(post.dataset.categoryKey);

      const matchesSearch =
        !searchQuery ||
        postTitle.includes(searchQuery) ||
        postAuthorText.includes(searchQuery) ||
        postCategoryText.includes(searchQuery) ||
        postExcerpt.includes(searchQuery);

      const matchesAuthor = !selectedAuthor || postAuthorKey === selectedAuthor;
      const matchesCategory =
        !selectedCategory || postCategoryKey === selectedCategory;

      if (matchesSearch && matchesAuthor && matchesCategory) {
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
  authorFilter?.addEventListener("change", filterPosts);
  categoryFilter?.addEventListener("change", filterPosts);

  posts.forEach((post) => {
    post.classList.remove("hidden", "fade-out");
  });
  filterPosts();

  document.querySelectorAll('a[href^="#"]').forEach((anchor) => {
    anchor.addEventListener("click", function (e) {
      e.preventDefault();
      const targetId = this.getAttribute("href");
      const targetElement = document.querySelector(targetId);

      if (targetElement) {
        const headerOffset = 80;
        const elementPosition = targetElement.getBoundingClientRect().top;
        const offsetPosition =
          elementPosition + window.pageYOffset - headerOffset;

        window.scrollTo({
          top: offsetPosition,
          behavior: "smooth",
        });
      }
    });
  });

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
