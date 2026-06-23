(function () {
  function init() {
    const DATE_ONLY_RE = /^\d{4}-\d{2}-\d{2}$/;
    const MIDNIGHT_UTC_RE = /T00:00:00(?:\.000)?Z$/i;

    function formatDates() {
      document.querySelectorAll("time[datetime]").forEach((el) => {
        const raw = el.getAttribute("datetime");
        if (!raw) return;
        const isDateOnly = DATE_ONLY_RE.test(raw) || MIDNIGHT_UTC_RE.test(raw);
        const date = isDateOnly
          ? new Date(`${raw.slice(0, 10)}T12:00:00Z`)
          : new Date(raw);
        if (Number.isNaN(date.getTime())) return;

        if (isDateOnly) {
          el.textContent = date.toLocaleDateString("en-US", {
            year: "numeric",
            month: "long",
            day: "numeric",
          });
          return;
        }

        el.textContent = date.toLocaleString("en-US", {
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
    const posts = document.querySelectorAll(".card-list__item");

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

    function getVisibleText(container, selector) {
      const target = container.querySelector(selector);
      if (!target) return "";
      return normalizeValue(target.textContent);
    }

    function updateCardRadius() {
      const list = document.querySelector(".card-list");
      if (!list) return;

      list.querySelectorAll(".card-list__item").forEach((item) => {
        item.classList.remove(
          "card-list__item--first",
          "card-list__item--last"
        );
      });

      const visible = Array.from(
        list.querySelectorAll(".card-list__item")
      ).filter((item) => !item.classList.contains("hidden"));

      if (visible.length > 0) {
        visible[0].classList.add("card-list__item--first");
        visible[visible.length - 1].classList.add("card-list__item--last");
      }
    }

    function filterPosts() {
      const searchQuery = normalizeValue(blogSearch?.value || "");
      const selectedTag = normalizeValue(tagFilter?.value || "");

      posts.forEach((post) => {
        const postTitle = getVisibleText(post, "h3");
        const postExcerpt = getVisibleText(post, ".p-summary");
        const postTagText = getVisibleText(post, ".tag");
        const postTagKey = normalizeValue(post.dataset.tagKey);

        const matchesSearch =
          !searchQuery ||
          postTitle.includes(searchQuery) ||
          postTagText.includes(searchQuery) ||
          postExcerpt.includes(searchQuery);

        const matchesTag = !selectedTag || postTagKey === selectedTag;

        if (matchesSearch && matchesTag) {
          post.classList.remove("hidden");
        } else {
          post.classList.add("hidden");
        }
      });

      updateCardRadius();
    }

    const debouncedFilter = debounce(filterPosts, 300);

    blogSearch?.addEventListener("input", debouncedFilter);
    tagFilter?.addEventListener("change", filterPosts);

    posts.forEach((post) => {
      post.classList.remove("hidden");
    });
    filterPosts();

    formatDates();
  }

  if (document.readyState === "loading") {
    document.addEventListener("DOMContentLoaded", init);
  } else {
    init();
  }
})();
