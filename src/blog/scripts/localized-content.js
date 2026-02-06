(() => {
  const LANG_STORAGE_KEY = "thayn-lang";

  function getPreferredLanguage() {
    const rootLang = document.documentElement.getAttribute("data-lang");
    if (rootLang) return String(rootLang).toLowerCase();

    if (window.JG_I18N && typeof window.JG_I18N.getState === "function") {
      const state = window.JG_I18N.getState();
      if (state && state.setting) return String(state.setting).toLowerCase();
    }

    try {
      const stored = localStorage.getItem(LANG_STORAGE_KEY);
      if (stored) return String(stored).toLowerCase();
    } catch {
      // ignore storage read failures
    }

    return "en";
  }

  function chooseVariant(nodes, preferred) {
    if (nodes.length === 0) return null;
    const exact = nodes.find((node) => node.dataset.blogLang === preferred);
    if (exact) return exact;

    const english = nodes.find((node) => node.dataset.blogLang === "en");
    if (english) return english;

    return nodes[0];
  }

  function applyLocalizedContent() {
    const preferred = getPreferredLanguage();
    const groups = document.querySelectorAll("[data-blog-l10n-group]");

    groups.forEach((group) => {
      const options = Array.from(group.querySelectorAll("[data-blog-lang]"));
      if (options.length === 0) return;

      const selected = chooseVariant(options, preferred);
      options.forEach((option) => {
        option.hidden = option !== selected;
      });
    });
  }

  if (document.readyState === "loading") {
    document.addEventListener("DOMContentLoaded", applyLocalizedContent);
  } else {
    applyLocalizedContent();
  }

  document.addEventListener("th-i18n-ready", applyLocalizedContent);
  window.addEventListener("storage", (event) => {
    if (event.key === LANG_STORAGE_KEY) {
      applyLocalizedContent();
    }
  });
})();
