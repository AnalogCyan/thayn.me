// SPA navigation with sliding animations

(function () {
  if (!window.history || !window.history.pushState) return;

  var NAV_ORDER = ["home", "about", "blog", "projects", "music", "more"];

  var TRANSITION_MS = 300;
  var STYLESHEET_TIMEOUT_MS = 2000;
  var reducedMotion = window.matchMedia("(prefers-reduced-motion: reduce)");
  var navigating = false;
  // Path of the page <main> holds, which lags location during a navigation
  var renderedPath = location.pathname;

  // A popstate swap lands long after the browser would restore scroll, so
  // each entry keeps its own position in history.state
  history.scrollRestoration = "manual";
  var saveTimer;

  function saveScroll() {
    clearTimeout(saveTimer);
    history.replaceState(
      Object.assign({}, history.state, { scrollY: window.scrollY }),
      ""
    );
  }

  window.addEventListener(
    "scroll",
    function () {
      // Mid-navigation the entry already names the next page
      if (navigating) return;
      clearTimeout(saveTimer);
      saveTimer = setTimeout(saveScroll, 150);
    },
    { passive: true }
  );

  window.addEventListener("pagehide", function () {
    if (!navigating) saveScroll();
  });

  // A reload or a full-page Back keeps the entry's state
  if (history.state && typeof history.state.scrollY === "number") {
    var savedY = history.state.scrollY;
    window.addEventListener("load", function () {
      window.scrollTo({ top: savedY, left: 0, behavior: "instant" });
    });
  }

  function hashTarget(hash) {
    if (hash.length < 2) return null;
    try {
      return document.getElementById(decodeURIComponent(hash.slice(1)));
    } catch {
      return null;
    }
  }

  // Scripts are keyed by path, so a ?v= suffix on one page and not another
  // is still the same script
  function scriptKey(src) {
    try {
      return new URL(src, location.href).pathname;
    } catch {
      return src;
    }
  }

  // Scripts the current page lists. One the next page also lists keeps
  // running; any other runs again when its page comes back.
  var activeScripts = new Set(
    Array.from(document.querySelectorAll("script[src]")).map(function (s) {
      return scriptKey(s.getAttribute("src"));
    })
  );

  var baseStylesheets = new Set(
    Array.from(document.querySelectorAll('link[rel="stylesheet"]')).map(
      function (l) {
        return l.href;
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

  // Blog posts load as full pages; their comments script is a module, and a
  // module does not run twice from the same URL
  function isSpaPath(path) {
    // Files such as /llms.txt are not pages
    if (/\.(?!html$)[a-z0-9]+$/i.test(path)) return false;
    return !(
      path.startsWith("/blog/") &&
      path !== "/blog/" &&
      path !== "/blog/index.html"
    );
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

    // Leaving a post as a full page keeps its history entry a real one, so
    // Back restores the reading position
    return isSpaPath(url.pathname) && isSpaPath(location.pathname);
  }

  function extractPageData(doc) {
    var main = doc.querySelector("main");
    var shell = doc.querySelector(".page-shell");
    var title = doc.querySelector("title");
    var desc = doc.querySelector('meta[name="description"]');
    var canonical = doc.querySelector('link[rel="canonical"]');
    var ogUrl = doc.querySelector('meta[property="og:url"]');
    var ogTitle = doc.querySelector('meta[property="og:title"]');
    var ogDesc = doc.querySelector('meta[property="og:description"]');

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
      canonical: canonical ? canonical.getAttribute("href") : "",
      ogUrl: ogUrl ? ogUrl.getAttribute("content") : "",
      ogTitle: ogTitle ? ogTitle.getAttribute("content") : "",
      ogDescription: ogDesc ? ogDesc.getAttribute("content") : "",
      scripts: scripts,
      stylesheets: stylesheets,
    };
  }

  // Resolves once new sheets have loaded (or timed out) and the old ones are
  // off, so the caller can swap with the next page already styled
  function syncStylesheets(sheets, pageUrl) {
    var wanted = new Set();
    sheets.forEach(function (href) {
      try {
        wanted.add(new URL(href, pageUrl).href);
      } catch {
        // skip unparseable href
      }
    });

    var existing = Array.from(document.querySelectorAll("link[data-spa]"));
    var loads = [];

    wanted.forEach(function (href) {
      if (baseStylesheets.has(href)) return;
      var alreadyAdded = existing.some(function (link) {
        return link.isConnected && link.href === href;
      });
      if (alreadyAdded) return;
      var link = document.createElement("link");
      link.rel = "stylesheet";
      link.href = href;
      link.setAttribute("data-spa", "");
      loads.push(
        new Promise(function (resolve) {
          link.onload = resolve;
          link.onerror = resolve;
        })
      );
      document.head.appendChild(link);
    });

    var loaded = loads.length
      ? Promise.race([
          Promise.all(loads),
          new Promise(function (resolve) {
            setTimeout(resolve, STYLESHEET_TIMEOUT_MS);
          }),
        ])
      : Promise.resolve();

    return loaded.then(function () {
      // Sheets from the first page load stay in place, switched off while
      // the current page does not list them
      document
        .querySelectorAll('link[rel="stylesheet"]:not([data-spa])')
        .forEach(function (link) {
          if (baseStylesheets.has(link.href)) {
            link.disabled = !wanted.has(link.href);
          }
        });

      existing.forEach(function (link) {
        if (!wanted.has(link.href)) link.remove();
      });
    });
  }

  function syncScripts(scripts) {
    document.querySelectorAll("script[data-spa]").forEach(function (s) {
      s.remove();
    });

    var previous = activeScripts;
    activeScripts = new Set(scripts.map(scriptKey));

    var chain = Promise.resolve();
    scripts.forEach(function (src) {
      if (previous.has(scriptKey(src))) return;
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
    var wait = reducedMotion.matches ? 0 : TRANSITION_MS;
    var targetUrl = new URL(url, location.href);
    // Back and Forward return to where the entry was left
    var restoreY =
      push === false &&
      history.state &&
      typeof history.state.scrollY === "number"
        ? history.state.scrollY
        : null;

    // Pushed now, not after the swap, so Back pressed during the transition
    // has an entry to go back from; the replay below then follows it
    if (push !== false) {
      saveScroll();
      history.pushState(null, "", url);
    } else {
      // A save still pending belongs to the entry just left
      clearTimeout(saveTimer);
    }

    var footerEl = document.querySelector('[data-capsule="footer"]');
    var footerFirst = footerEl ? footerEl.getBoundingClientRect().top : null;

    var fetchDone = fetch(url).then(function (r) {
      if (!r.ok) throw new Error(r.status);
      return r.text();
    });

    main.classList.add("spa-out", dirClass);

    var outDone = new Promise(function (r) {
      setTimeout(r, wait);
    });

    var data;
    Promise.all([fetchDone, outDone])
      .then(function (results) {
        var html = results[0];
        var doc = new DOMParser().parseFromString(html, "text/html");
        data = extractPageData(doc);

        if (data.mainHTML == null) throw new Error("no main");

        return syncStylesheets(data.stylesheets, url);
      })
      .then(function () {
        main.classList.remove("spa-out", "dir-slide-left", "dir-slide-right");

        swapMain(main, data.mainHTML);
        renderedPath = targetUrl.pathname;

        if (
          footerEl &&
          footerFirst !== null &&
          !window.matchMedia("(prefers-reduced-motion: reduce)").matches
        ) {
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

        var canonicalEl = document.querySelector('link[rel="canonical"]');
        if (canonicalEl && data.canonical) {
          canonicalEl.setAttribute("href", data.canonical);
        }
        // the whole og: set moves together, or a share widget reads a
        // title from one page and a URL from another
        [
          ["og:url", data.ogUrl],
          ["og:title", data.ogTitle],
          ["og:description", data.ogDescription],
        ].forEach(function (pair) {
          var el = document.querySelector('meta[property="' + pair[0] + '"]');
          if (el && pair[1]) el.setAttribute("content", pair[1]);
        });

        document.title = data.title;
        var descEl = document.querySelector('meta[name="description"]');
        if (descEl) descEl.setAttribute("content", data.description);

        syncScripts(data.scripts);

        main.classList.add("spa-in");
        if (dirClass) main.classList.add(dirClass);

        var target = hashTarget(targetUrl.hash);
        if (restoreY !== null) {
          window.scrollTo({ top: restoreY, left: 0, behavior: "instant" });
        } else if (target) {
          target.scrollIntoView({ behavior: "instant" });
        } else {
          window.scrollTo({ top: 0, left: 0, behavior: "instant" });
        }
        window.dispatchEvent(new Event("resize"));

        // A swapped <main> is a new page; move focus so it is announced
        var heading = main.querySelector("h1") || main;
        heading.setAttribute("tabindex", "-1");
        heading.focus({ preventScroll: true });

        document.dispatchEvent(
          new CustomEvent("th-nav-changed", {
            detail: { navPage: data.navPage },
          })
        );

        setTimeout(function () {
          main.classList.remove("spa-in", dirClass);
          navigating = false;
          // Back or Forward pressed mid-navigation lands here
          if (location.pathname !== renderedPath) {
            onHistoryChange();
          }
        }, wait);
      })
      .catch(function () {
        main.classList.remove(
          "spa-out",
          "spa-in",
          "dir-slide-left",
          "dir-slide-right"
        );
        navigating = false;
        // The URL was pushed before the fetch, so it already names the page
        // to load, or wherever Back or Forward has moved it since.
        // Assigning it again would only change the fragment of a #hash link.
        location.reload();
      });
  }

  document.addEventListener("click", function (e) {
    if (e.metaKey || e.ctrlKey || e.shiftKey || e.altKey) return;
    if (e.defaultPrevented) return;

    var anchor = e.target.closest("a[href]");
    if (!anchor) return;
    // Clicked again mid-navigation: already on its way there
    if (navigating && anchor.href === location.href) {
      e.preventDefault();
      return;
    }
    if (!shouldIntercept(anchor)) return;

    e.preventDefault();
    if (navigating) {
      // Queued: the running swap follows the URL when it finishes, as it
      // does for Back pressed mid-navigation
      history.pushState(null, "", anchor.href);
      return;
    }
    navigate(anchor.href);
  });

  function onHistoryChange() {
    // A hash-only change is the browser's to scroll, and one made while a
    // navigation runs is picked up when it finishes
    if (navigating || location.pathname === renderedPath) return;
    if (!isSpaPath(location.pathname)) {
      location.reload();
      return;
    }
    navigate(location.href, false);
  }

  window.addEventListener("popstate", onHistoryChange);
})();
