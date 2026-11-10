// Auto-generates heading anchor links in blog posts

(function () {
  // Matches build.js heading ids; textContent has no markup to strip
  function slugify(text) {
    return text
      .toLowerCase()
      .replace(/[^\p{L}\p{N}\s-]/gu, "")
      .replace(/\s+/g, "-")
      .replace(/-+/g, "-")
      .replace(/^-+|-+$/g, "");
  }

  function uniqueId(base) {
    var id = base;
    for (var n = 2; document.getElementById(id); n += 1) {
      id = base + "-" + n;
    }
    return id;
  }

  function init() {
    var container = document.querySelector(".blog-post-content");
    if (!container) return;

    container.querySelectorAll("h1, h2, h3, h4").forEach(function (h) {
      if (h.parentElement.classList.contains("heading-anchor")) return;

      if (!h.id) {
        var base = slugify(h.textContent);
        if (!base) return;
        h.id = uniqueId(base);
      }

      var link = document.createElement("a");
      link.className = "heading-link";
      link.href = "#" + h.id;
      link.setAttribute(
        "aria-label",
        "Copy link to section: " + h.textContent.trim()
      );
      link.textContent = "#";

      link.addEventListener("click", function (e) {
        e.preventDefault();
        e.stopPropagation();
        var url = new URL(window.location.href);
        url.hash = h.id;
        navigator.clipboard.writeText(url.href).catch(function () {
          var ta = document.createElement("textarea");
          ta.value = url.href;
          ta.style.position = "fixed";
          ta.style.opacity = "0";
          document.body.appendChild(ta);
          ta.select();
          document.execCommand("copy");
          document.body.removeChild(ta);
        });
        history.replaceState(null, "", url.href);
        var reduce = window.matchMedia(
          "(prefers-reduced-motion: reduce)"
        ).matches;
        h.scrollIntoView({ behavior: reduce ? "auto" : "smooth" });
      });

      // Kept outside the heading so its accessible name stays the heading text
      var wrap = document.createElement("div");
      wrap.className = "heading-anchor";
      h.replaceWith(wrap);
      wrap.append(h, link);
    });
  }

  if (document.readyState === "loading") {
    document.addEventListener("DOMContentLoaded", init);
  } else {
    init();
  }
  document.addEventListener("th-nav-changed", init);
})();
