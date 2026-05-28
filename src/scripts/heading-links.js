(function () {
  function slugify(text) {
    return text
      .toLowerCase()
      .replace(/<[^>]*>/g, "")
      .replace(/[^\p{L}\p{N}\s-]/gu, "")
      .replace(/\s+/g, "-")
      .replace(/-+/g, "-")
      .replace(/^-+|-+$/g, "");
  }

  function init() {
    var container = document.querySelector(".blog-post-content");
    if (!container) return;

    container.querySelectorAll("h1, h2, h3, h4").forEach(function (h) {
      if (h.querySelector(".heading-link")) return;

      if (!h.id) {
        h.id = slugify(h.textContent);
      }

      var link = document.createElement("a");
      link.className = "heading-link";
      link.href = "#" + h.id;
      link.setAttribute("aria-label", "Copy link to this section");
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
        h.scrollIntoView({ behavior: "smooth" });
      });

      h.insertBefore(link, h.firstChild);
    });
  }

  if (document.readyState === "loading") {
    document.addEventListener("DOMContentLoaded", init);
  } else {
    init();
  }
  document.addEventListener("th-nav-changed", init);
})();
