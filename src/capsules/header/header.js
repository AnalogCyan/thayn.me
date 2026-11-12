// Nav-pill active link, mobile menu closing, and theme cycle

(() => {
  function initNav(root) {
    const nav = root.querySelector(".nav-pill");
    const list = nav?.querySelector(".nav-pill__list");
    if (!list) return;

    // Browsers older than popover get a class toggle instead
    const native = "popover" in HTMLElement.prototype;
    if (!native) {
      nav
        .querySelector(".nav-pill__toggle")
        ?.addEventListener("click", () => list.classList.toggle("is-open"));
    }

    // The menu does not close on its own when a link swaps the page in
    // place or when focus leaves it
    const close = () => {
      if (!native) list.classList.remove("is-open");
      else if (list.matches(":popover-open")) list.hidePopover();
    };
    list.addEventListener("click", (event) => {
      if (event.target.closest("a")) close();
    });
    nav.addEventListener("focusout", (event) => {
      if (event.relatedTarget && !nav.contains(event.relatedTarget)) close();
    });
    window.matchMedia("(max-width: 720px)").addEventListener("change", close);

    const shell = root.closest("[data-nav-page]");
    if (!shell) return;

    // An empty value, as on the 404 page, means no link is current
    const syncActive = () => {
      const navPage = shell.dataset.navPage;
      list.querySelectorAll(".nav-pill__link").forEach((link) => {
        const active = navPage !== "" && link.dataset.nav === navPage;
        link.classList.toggle("is-active", active);
        // is-active is colour only; aria-current is what a screen reader reads
        if (active) link.setAttribute("aria-current", "page");
        else link.removeAttribute("aria-current");
      });
    };

    syncActive();
    new MutationObserver(syncActive).observe(shell, {
      attributes: true,
      attributeFilter: ["data-nav-page"],
    });
  }

  function initThemeToggle(root) {
    const STORAGE_KEY = root.dataset.themeKey || "thayn_theme";
    const THEMES = {
      AUTO: "auto",
      LIGHT: "light",
      DARK: "dark",
    };

    const toggles = Array.from(
      root.querySelectorAll("[data-theme-button='true']")
    );
    if (toggles.length === 0) return;
    const status = root.querySelector("[data-theme-status]");

    const systemPrefersDark = window.matchMedia("(prefers-color-scheme: dark)");
    const ICON_MAP = {
      [THEMES.AUTO]: { icon: "ri-contrast-2-line", label: "Auto" },
      [THEMES.LIGHT]: { icon: "ri-sun-line", label: "Light" },
      [THEMES.DARK]: { icon: "ri-moon-line", label: "Dark" },
    };

    function readStoredMode() {
      try {
        return localStorage.getItem(STORAGE_KEY) || THEMES.AUTO;
      } catch {
        return THEMES.AUTO;
      }
    }

    // Held in memory so cycling still works when storage is unavailable
    let currentMode = readStoredMode();

    function savePreference(mode) {
      currentMode = mode;
      try {
        localStorage.setItem(STORAGE_KEY, mode);
      } catch {
        /* noop */
      }
    }

    function updatePresentation(mode) {
      const meta = ICON_MAP[mode] || ICON_MAP[THEMES.AUTO];
      toggles.forEach((toggle) => {
        toggle.dataset.themeMode = mode;
        toggle.setAttribute("aria-label", `Theme: ${meta.label}`);
        const iconEl = toggle.querySelector(".theme-toggle__icon");
        const textEl = toggle.querySelector(".theme-toggle__text");

        if (iconEl) {
          iconEl.classList.remove(
            "ri-contrast-2-line",
            "ri-sun-line",
            "ri-moon-line"
          );
          iconEl.classList.add(meta.icon);
        }

        if (textEl) {
          textEl.textContent = meta.label;
        }
      });
    }

    function applyTheme(mode) {
      document.documentElement.classList.remove("light-theme", "dark-theme");

      switch (mode) {
        case THEMES.LIGHT:
          document.documentElement.classList.add("light-theme");
          break;
        case THEMES.DARK:
          document.documentElement.classList.add("dark-theme");
          break;
        case THEMES.AUTO:
        default: {
          mode = THEMES.AUTO;
          if (systemPrefersDark.matches) {
            document.documentElement.classList.add("dark-theme");
          } else {
            document.documentElement.classList.add("light-theme");
          }
          break;
        }
      }

      updatePresentation(mode);
    }

    function cycleTheme() {
      let newMode;

      switch (currentMode) {
        case THEMES.AUTO:
          newMode = THEMES.LIGHT;
          break;
        case THEMES.LIGHT:
          newMode = THEMES.DARK;
          break;
        case THEMES.DARK:
        default:
          newMode = THEMES.AUTO;
          break;
      }

      savePreference(newMode);
      applyTheme(newMode);
      if (status) {
        status.textContent = `Theme: ${ICON_MAP[newMode].label}`;
      }
    }

    toggles.forEach((toggle) => {
      if (toggle.dataset.themeToggleBound === "true") return;
      toggle.addEventListener("click", cycleTheme);
      toggle.dataset.themeToggleBound = "true";
    });

    systemPrefersDark.addEventListener("change", () => {
      if (currentMode === THEMES.AUTO) {
        applyTheme(THEMES.AUTO);
      }
    });

    applyTheme(currentMode);
  }

  function init() {
    const roots = document.querySelectorAll('[data-capsule="header"]');

    roots.forEach((root) => {
      if (root.dataset.headerReady === "true") return;
      root.dataset.headerReady = "true";

      initNav(root);
      initThemeToggle(root);
    });
  }

  if (document.readyState === "loading") {
    document.addEventListener("DOMContentLoaded", init);
  } else {
    init();
  }
})();
