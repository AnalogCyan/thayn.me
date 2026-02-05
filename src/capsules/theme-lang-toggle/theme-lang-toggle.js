document.addEventListener("DOMContentLoaded", () => {
  const STORAGE_KEY = "thayn_theme";
  const LANG_STORAGE_KEY = "thayn-lang";
  const THEMES = {
    AUTO: "auto",
    LIGHT: "light",
    DARK: "dark",
  };

  const toggles = Array.from(
    document.querySelectorAll("[data-theme-button='true']")
  );
  const langButtons = Array.from(
    document.querySelectorAll(".language-toggle")
  );
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
    [THEMES.LIGHT]: { icon: "ri-sun-line", key: "theme.light", fallback: "Light" },
    [THEMES.DARK]: { icon: "ri-moon-line", key: "theme.dark", fallback: "Dark" },
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
        `${t("theme.label", "Theme")}: ${t(meta.key, meta.fallback)}`
      );
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
        `${t("language.label", "Language")}: ${code}`
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
});
