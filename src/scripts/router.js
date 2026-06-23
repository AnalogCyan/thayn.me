/* thayn.me – router.js – SPA navigation with sliding animations */

(function () {
  if (!window.history || !window.history.pushState) return;

  var NAV_ORDER = [
    "home",
    "about",
    "blog",
    "projects",
    "photos",
    "music",
    "more",
  ];

  var TRANSITION_MS = 300;
  var navigating = false;

  var baseScripts = new Set(
    Array.from(document.querySelectorAll("script[src]")).map(function (s) {
      return s.getAttribute("src");
    })
  );

  var baseStylesheets = new Set(
    Array.from(document.querySelectorAll('link[rel="stylesheet"]')).map(
      function (l) {
        return l.getAttribute("href");
      }
    )
  );

  function getPageKey(url) {
    var path;
    try {
      path = new URL(url, location.href).pathname;
    } catch {
      return null;
    }

    if (path === "/" || path === "/index.html") return "home";

    var page = path
      .replace(/^\//, "")
      .replace(/\.html$/, "")
      .replace(/\/$/, "");

    if (page === "blog" || page.startsWith("blog/")) return "blog";

    return page || "home";
  }

  function getDirection(from, to) {
    if (!from || !to || from === to) return null;
    var fromIdx = NAV_ORDER.indexOf(from);
    var toIdx = NAV_ORDER.indexOf(to);
    if (fromIdx === -1 || toIdx === -1) return null;
    return toIdx > fromIdx ? "slide-left" : "slide-right";
  }

  function shouldIntercept(anchor) {
    if (anchor.target === "_blank") return false;
    if (anchor.hasAttribute("download")) return false;

    var url;
    try {
      url = new URL(anchor.href, location.origin);
    } catch {
      return false;
    }

    if (url.origin !== location.origin) return false;
    if (url.hash && url.pathname === location.pathname) return false;
    if (url.pathname === location.pathname) return false;

    var path = url.pathname;

    if (
      path.startsWith("/blog/") &&
      path !== "/blog/" &&
      path !== "/blog/index.html"
    )
      return false;

    return true;
  }

  function extractPageData(doc) {
    var main = doc.querySelector("main");
    var shell = doc.querySelector(".page-shell");
    var title = doc.querySelector("title");
    var desc = doc.querySelector('meta[name="description"]');

    var scripts = [];
    doc.querySelectorAll("body script[src]").forEach(function (s) {
      scripts.push(s.getAttribute("src"));
    });
    doc.querySelectorAll("head script[src]").forEach(function (s) {
      scripts.push(s.getAttribute("src"));
    });

    var stylesheets = [];
    doc.querySelectorAll('link[rel="stylesheet"]').forEach(function (l) {
      var href = l.getAttribute("href");
      if (href) stylesheets.push(href);
    });

    return {
      mainHTML: main ? main.innerHTML : null,
      hero: shell ? shell.getAttribute("data-hero") : "false",
      navPage: shell ? shell.getAttribute("data-nav-page") : "",
      title: title ? title.textContent : document.title,
      description: desc ? desc.getAttribute("content") : "",
      scripts: scripts,
      stylesheets: stylesheets,
    };
  }

  function syncStylesheets(sheets) {
    sheets.forEach(function (href) {
      if (baseStylesheets.has(href)) return;
      if (document.querySelector('link[data-spa][href="' + href + '"]')) return;
      var link = document.createElement("link");
      link.rel = "stylesheet";
      link.href = href;
      link.setAttribute("data-spa", "");
      document.head.appendChild(link);
    });
  }

  function syncScripts(scripts) {
    document.querySelectorAll("script[data-spa]").forEach(function (s) {
      s.remove();
    });

    var chain = Promise.resolve();
    scripts.forEach(function (src) {
      if (baseScripts.has(src)) return;
      chain = chain.then(function () {
        return new Promise(function (resolve) {
          var el = document.createElement("script");
          el.src = src;
          el.setAttribute("data-spa", "");
          el.onload = resolve;
          el.onerror = resolve;
          document.body.appendChild(el);
        });
      });
    });
    return chain;
  }

  function updateNavActive(navPage) {
    document.querySelectorAll(".nav-pill__link").forEach(function (link) {
      if (link.getAttribute("data-nav") === navPage) {
        link.classList.add("is-active");
      } else {
        link.classList.remove("is-active");
      }
    });
  }

  function swapMain(main, newHTML) {
    while (main.firstChild) main.removeChild(main.firstChild);
    var temp = document.createElement("div");
    temp.innerHTML = newHTML;
    while (temp.firstChild) main.appendChild(temp.firstChild);
  }

  function navigate(url, push) {
    if (navigating) return;
    navigating = true;

    var main = document.querySelector("main");
    if (!main) {
      location.href = url;
      return;
    }

    var fromPage = getPageKey(location.href);
    var toPage = getPageKey(url);
    var dir = getDirection(fromPage, toPage);
    if (!dir) dir = "slide-left";
    var dirClass = "dir-" + dir;

    var footerEl = document.querySelector('[data-capsule="footer"]');
    var footerFirst = footerEl ? footerEl.getBoundingClientRect().top : null;

    var fetchDone = fetch(url).then(function (r) {
      if (!r.ok) throw new Error(r.status);
      return r.text();
    });

    main.classList.add("spa-out", dirClass);

    var outDone = new Promise(function (r) {
      setTimeout(r, TRANSITION_MS);
    });

    Promise.all([fetchDone, outDone])
      .then(function (results) {
        var html = results[0];
        var doc = new DOMParser().parseFromString(html, "text/html");
        var data = extractPageData(doc);

        if (data.mainHTML == null) throw new Error("no main");

        main.classList.remove("spa-out", "dir-slide-left", "dir-slide-right");

        swapMain(main, data.mainHTML);

        if (footerEl && footerFirst !== null) {
          var footerLast = footerEl.getBoundingClientRect().top;
          var delta = Math.round(footerLast - footerFirst);
          if (Math.abs(delta) >= 3) {
            footerEl.style.transform = "translateY(" + -delta + "px)";
            footerEl.getBoundingClientRect();
            footerEl.style.transition =
              "transform 0.3s cubic-bezier(0.68, -0.3, 0.27, 1.3)";
            footerEl.style.transform = "translateY(0)";
            setTimeout(function () {
              footerEl.style.transition = "";
              footerEl.style.transform = "";
            }, 300);
          }
        }

        var shell = document.querySelector(".page-shell");
        if (shell) {
          shell.setAttribute("data-hero", data.hero);
          shell.setAttribute("data-nav-page", data.navPage);
        }

        document.title = data.title;
        var descEl = document.querySelector('meta[name="description"]');
        if (descEl) descEl.setAttribute("content", data.description);

        syncStylesheets(data.stylesheets);
        syncScripts(data.scripts);

        main.classList.add("spa-in");
        if (dirClass) main.classList.add(dirClass);

        if (push !== false) {
          history.pushState(null, "", url);
        }

        window.scrollTo(0, 0);
        window.dispatchEvent(new Event("resize"));

        document.dispatchEvent(
          new CustomEvent("th-nav-changed", {
            detail: { navPage: data.navPage },
          })
        );

        setTimeout(function () {
          main.classList.remove("spa-in", dirClass);
          navigating = false;
        }, TRANSITION_MS);
      })
      .catch(function () {
        main.classList.remove(
          "spa-out",
          "spa-in",
          "dir-slide-left",
          "dir-slide-right"
        );
        navigating = false;
        location.href = url;
      });
  }

  document.addEventListener("click", function (e) {
    if (e.metaKey || e.ctrlKey || e.shiftKey || e.altKey) return;
    if (e.defaultPrevented) return;

    var anchor = e.target.closest("a[href]");
    if (!anchor) return;
    if (!shouldIntercept(anchor)) return;

    e.preventDefault();
    navigate(anchor.href);
  });

  window.addEventListener("popstate", function () {
    navigate(location.href, false);
  });
})();
