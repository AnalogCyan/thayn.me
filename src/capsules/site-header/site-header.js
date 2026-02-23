(() => {
  function initNav(root) {
    const nav = root.querySelector(".nav-pill");
    if (!nav) return;

    const toggle = nav.querySelector(".nav-pill__toggle");
    const list = nav.querySelector(".nav-pill__list");
    if (!toggle || !list) return;

    const icon = toggle.querySelector("i");
    const openClass = "nav-pill--open";
    const mediaQuery = window.matchMedia("(max-width: 720px)");

    const setOpen = (open) => {
      if (!mediaQuery.matches) {
        nav.classList.remove(openClass);
        toggle.setAttribute("aria-expanded", "false");
        if (icon) {
          icon.classList.remove("ri-close-line");
          icon.classList.add("ri-menu-line");
        }
        return;
      }

      nav.classList.toggle(openClass, open);
      toggle.setAttribute("aria-expanded", open ? "true" : "false");
      if (icon) {
        icon.classList.toggle("ri-menu-line", !open);
        icon.classList.toggle("ri-close-line", open);
      }

      if (open) {
        const firstLink = list.querySelector("a");
        if (firstLink) requestAnimationFrame(() => firstLink.focus());
      }
    };

    const toggleMenu = () => {
      if (!mediaQuery.matches) return;
      setOpen(!nav.classList.contains(openClass));
    };

    toggle.addEventListener("click", (event) => {
      event.preventDefault();
      toggleMenu();
    });

    document.addEventListener("click", (event) => {
      if (!mediaQuery.matches) return;
      if (!nav.contains(event.target)) {
        setOpen(false);
      }
    });

    document.addEventListener("keydown", (event) => {
      if (!mediaQuery.matches) return;
      if (event.key === "Escape" && nav.classList.contains(openClass)) {
        setOpen(false);
        toggle.focus();
      }
    });

    list.addEventListener("click", (event) => {
      if (event.target.closest("a")) setOpen(false);
    });

    mediaQuery.addEventListener("change", () => setOpen(false));

    setOpen(false);

    const navPage = root.closest("[data-nav-page]")?.dataset.navPage;
    if (navPage) {
      const activeLink = list.querySelector(`[data-nav="${navPage}"]`);
      if (activeLink) activeLink.classList.add("is-active");
    }
  }

  function initThemeToggle(root) {
    const STORAGE_KEY = "thayn_theme";
    const LANG_STORAGE_KEY = "thayn-lang";
    const THEMES = {
      AUTO: "auto",
      LIGHT: "light",
      DARK: "dark",
    };

    const toggles = Array.from(
      root.querySelectorAll("[data-theme-button='true']"),
    );
    const langButtons = Array.from(root.querySelectorAll(".language-toggle"));
    if (toggles.length === 0) return;

    const systemPrefersDark = window.matchMedia("(prefers-color-scheme: dark)");
    const LANGS = ["en", "tok"];
    const LANG_CODES = { en: "ENG", tok: "TOK" };
    const ICON_MAP = {
      [THEMES.AUTO]: {
        icon: "ri-contrast-2-line",
        key: "theme.auto",
        fallback: "Auto",
      },
      [THEMES.LIGHT]: {
        icon: "ri-sun-line",
        key: "theme.light",
        fallback: "Light",
      },
      [THEMES.DARK]: {
        icon: "ri-moon-line",
        key: "theme.dark",
        fallback: "Dark",
      },
    };

    function t(key, fallback) {
      if (window.JG_I18N && typeof window.JG_I18N.t === "function") {
        return window.JG_I18N.t(key, fallback);
      }
      return fallback;
    }

    function getCurrentMode() {
      try {
        return localStorage.getItem(STORAGE_KEY) || THEMES.AUTO;
      } catch {
        return THEMES.AUTO;
      }
    }

    function savePreference(mode) {
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
        toggle.setAttribute(
          "aria-label",
          `${t("theme.label", "Theme")}: ${t(meta.key, meta.fallback)}`,
        );
        const iconEl = toggle.querySelector(".theme-toggle__icon");
        const textEl = toggle.querySelector(".theme-toggle__text");

        if (iconEl) {
          iconEl.classList.remove(
            "ri-contrast-2-line",
            "ri-sun-line",
            "ri-moon-line",
          );
          iconEl.classList.add(meta.icon);
        }

        if (textEl) {
          textEl.textContent = t(meta.key, meta.fallback);
        }
      });
    }

    function getCurrentLang() {
      try {
        return localStorage.getItem(LANG_STORAGE_KEY) || LANGS[0];
      } catch {
        return LANGS[0];
      }
    }

    function saveLang(lang) {
      try {
        localStorage.setItem(LANG_STORAGE_KEY, lang);
      } catch {
        /* noop */
      }
    }

    function updateLangPresentation(lang) {
      const code = LANG_CODES[lang] || "ENG";
      langButtons.forEach((button) => {
        const textEl = button.querySelector(".lang-toggle__text");
        if (textEl) textEl.textContent = code;
        button.setAttribute(
          "aria-label",
          `${t("language.label", "Language")}: ${code}`,
        );
      });
    }

    function cycleLang() {
      const current = getCurrentLang();
      const idx = LANGS.indexOf(current);
      const next = LANGS[(idx + 1) % LANGS.length];
      saveLang(next);
      updateLangPresentation(next);
      if (window.JG_I18N && typeof window.JG_I18N.setLanguage === "function") {
        window.JG_I18N.setLanguage(next);
      }
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
        default:
          if (systemPrefersDark.matches) {
            document.documentElement.classList.add("dark-theme");
          } else {
            document.documentElement.classList.add("light-theme");
          }
          mode = THEMES.AUTO;
          break;
      }

      updatePresentation(mode);
    }

    function cycleTheme() {
      const currentMode = getCurrentMode();
      let newMode = THEMES.AUTO;

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
    }

    toggles.forEach((toggle) => {
      if (toggle.dataset.themeToggleBound === "true") return;
      toggle.addEventListener("click", cycleTheme);
      toggle.dataset.themeToggleBound = "true";
    });

    langButtons.forEach((button) => {
      if (button.dataset.langToggleBound === "true") return;
      button.addEventListener("click", cycleLang);
      button.dataset.langToggleBound = "true";
    });

    systemPrefersDark.addEventListener("change", () => {
      if (getCurrentMode() === THEMES.AUTO) {
        applyTheme(THEMES.AUTO);
      }
    });

    applyTheme(getCurrentMode());
    updateLangPresentation(getCurrentLang());

    document.addEventListener("th-i18n-ready", () => {
      updatePresentation(getCurrentMode());
      updateLangPresentation(getCurrentLang());
    });
  }

  function initLayout(root) {
    const navWrap = root.matches(".nav-pill-wrap")
      ? root
      : root.querySelector(".nav-pill-wrap");
    if (!navWrap) return;
    const container = navWrap.closest(".container");
    if (!container) return;

    function updateContainerMaxWidth() {
      const viewportWidth =
        window.innerWidth || document.documentElement.clientWidth || 0;
      const mobileBreakpoint = 720;

      if (viewportWidth <= mobileBreakpoint) {
        document.documentElement.style.setProperty(
          "--container-max-width",
          `${viewportWidth}px`,
        );
        return;
      }

      const navRect = navWrap.getBoundingClientRect();
      const styles = window.getComputedStyle(container);
      const padLeft = parseFloat(styles.paddingLeft) || 0;
      const padRight = parseFloat(styles.paddingRight) || 0;
      const width = Math.ceil(navRect.width + padLeft + padRight);

      document.documentElement.style.setProperty(
        "--container-max-width",
        `${width}px`,
      );
    }

    updateContainerMaxWidth();

    if (document.fonts && document.fonts.ready) {
      document.fonts.ready.then(updateContainerMaxWidth);
    }

    let _rafId = null;
    window.addEventListener("resize", () => {
      if (_rafId !== null) cancelAnimationFrame(_rafId);
      _rafId = requestAnimationFrame(() => {
        _rafId = null;
        updateContainerMaxWidth();
      });
    });

    if (window.ResizeObserver) {
      const observer = new ResizeObserver(() => updateContainerMaxWidth());
      observer.observe(navWrap);
    }
  }

  function init() {
    const root = document.querySelector('[data-capsule="site-header"]');
    if (!root) return;

    initNav(root);
    initThemeToggle(root);
    initLayout(root);
  }

  if (document.readyState === "loading") {
    document.addEventListener("DOMContentLoaded", init);
  } else {
    init();
  }
})();
