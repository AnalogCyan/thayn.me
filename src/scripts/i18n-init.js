(() => {
  const STORAGE_KEY = "thayn-lang";
  const DEFAULT_LANG = "en";
  const SUPPORTED = ["en", "tok"];

  function normalizeLang(value) {
    if (!value) return null;
    const v = String(value).toLowerCase();
    if (v === "en" || v === "eng" || v.startsWith("en-")) return "en";
    if (v === "tok" || v === "toki" || v.startsWith("tok-")) return "tok";
    return null;
  }

  function detectLanguage() {
    if (typeof navigator === "undefined") return DEFAULT_LANG;
    const prefs = [];
    if (Array.isArray(navigator.languages)) {
      prefs.push(...navigator.languages);
    }
    if (navigator.language) prefs.push(navigator.language);
    for (const pref of prefs) {
      const norm = normalizeLang(pref);
      if (norm && SUPPORTED.includes(norm)) return norm;
    }
    return DEFAULT_LANG;
  }

  function getPreferredLanguage() {
    try {
      const stored = normalizeLang(localStorage.getItem(STORAGE_KEY));
      if (stored) return stored;
    } catch {
      // ignore storage read failures
    }
    return detectLanguage();
  }

  const root = document.documentElement;
  const preferred = getPreferredLanguage();
  root.setAttribute("lang", preferred);
  root.setAttribute("data-lang", preferred);
  if (preferred !== DEFAULT_LANG) {
    root.setAttribute("data-i18n-pending", "true");
  } else {
    root.removeAttribute("data-i18n-pending");
  }
})();
