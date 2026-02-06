(() => {
  const footer = document.querySelector('[data-capsule="site-footer"]');
  if (!footer) return;

  const counter = footer.querySelector("[data-webmention-count]");
  if (!counter) return;

  const canonical = document.querySelector('link[rel="canonical"]');
  const url =
    (canonical && canonical.href) ||
    window.location.origin + window.location.pathname;
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
})();
