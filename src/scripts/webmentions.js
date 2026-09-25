// Fetches and displays webmention counts

(() => {
  const footer = document.querySelector('[data-capsule="footer"]');
  if (!footer) return;

  const counter = footer.querySelector("[data-webmention-count]");
  if (!counter) return;

  let lastUrl = null;

  function updateCount() {
    // Blog posts load their own webmention script, which fills the counter
    // from the payload it already fetches
    if (document.getElementById("webmentions")) return;

    // Error pages carry no canonical, and counting mentions for a URL that
    // does not exist is a request with no answer
    const canonical = document.querySelector('link[rel="canonical"]');
    if (!canonical || !canonical.href) return;
    const url = canonical.href;

    if (url === lastUrl) return;
    lastUrl = url;
    counter.setAttribute("data-url", url);

    const endpoint =
      "/.netlify/functions/webmentions?mode=count&target=" +
      encodeURIComponent(url);

    fetch(endpoint)
      .then((response) => {
        if (!response.ok) throw new Error("Webmention count failed");
        return response.json();
      })
      .then((data) => {
        const count = typeof data.count === "number" ? data.count : 0;
        counter.textContent = String(count);
      })
      .catch(() => {});
  }

  updateCount();

  window.addEventListener("popstate", updateCount);

  const observer = new MutationObserver(updateCount);
  const titleEl = document.querySelector("title");
  if (titleEl) {
    observer.observe(titleEl, { childList: true });
  }
})();
