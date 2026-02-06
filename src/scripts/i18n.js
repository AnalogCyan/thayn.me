/*
  thayn.me – i18n.js
  Purpose: Client-side language selection + content swapping.
  Notes: Uses JSON dictionaries in /i18n/{lang}.json and falls back to English.
*/
(function () {
  const STORAGE_KEY = "thayn-lang";
  const DEFAULT_LANG = "en";
  const SUPPORTED = ["en", "tok"];
  const LOCALE_MAP = {
    en: "en-US",
    tok: "en-US",
  };
  const cache = new Map();

  let setting = null; // en | tok
  let dict = null;
  let fallback = null;

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

  function getStoredSetting() {
    try {
      const stored = normalizeLang(localStorage.getItem(STORAGE_KEY));
      if (stored) return stored;
    } catch (err) {
      // ignore storage failures and fall back to browser preference
    }
    return detectLanguage();
  }

  function getLocale(lang) {
    return LOCALE_MAP[lang] || "en-US";
  }

  async function loadDict(lang) {
    if (cache.has(lang)) return cache.get(lang);
    const res = await fetch(`/i18n/${lang}.json`);
    if (!res.ok) throw new Error(`Failed to load i18n ${lang}`);
    const data = await res.json();
    cache.set(lang, data);
    return data;
  }

  function getValue(obj, path) {
    if (!obj) return null;
    const parts = String(path).split(".");
    let current = obj;
    for (const part of parts) {
      if (current == null) return null;
      current = current[part];
    }
    return current == null ? null : current;
  }

  function translate(key) {
    const value = getValue(dict, key);
    if (value != null) return value;
    const fb = getValue(fallback, key);
    return fb != null ? fb : null;
  }

  function applyAttributes(el, spec) {
    const pairs = String(spec)
      .split(",")
      .map((item) => item.trim())
      .filter(Boolean);
    pairs.forEach((pair) => {
      const [attr, key] = pair.split(":").map((v) => v.trim());
      if (!attr || !key) return;
      if (!el.__thI18nAttrDefault) el.__thI18nAttrDefault = {};
      if (!(attr in el.__thI18nAttrDefault)) {
        el.__thI18nAttrDefault[attr] = el.getAttribute(attr) || "";
      }
      const value = translate(key);
      if (value != null) {
        el.setAttribute(attr, value);
      } else {
        el.setAttribute(attr, el.__thI18nAttrDefault[attr]);
      }
    });
  }

  function applyTranslations(root) {
    const scope = root || document;

    scope.querySelectorAll("[data-i18n]").forEach((el) => {
      const key = el.getAttribute("data-i18n");
      if (!el.dataset.i18nDefault) {
        el.dataset.i18nDefault = el.textContent || "";
      }
      const value = translate(key);
      el.textContent = value != null ? value : el.dataset.i18nDefault;
    });

    scope.querySelectorAll("[data-i18n-html]").forEach((el) => {
      const key = el.getAttribute("data-i18n-html");
      if (!el.dataset.i18nHtmlDefault) {
        el.dataset.i18nHtmlDefault = el.innerHTML || "";
      }
      const value = translate(key);
      el.innerHTML = value != null ? value : el.dataset.i18nHtmlDefault;
    });

    scope.querySelectorAll("[data-i18n-attr]").forEach((el) => {
      applyAttributes(el, el.getAttribute("data-i18n-attr"));
    });
  }

  async function refresh() {
    setting = getStoredSetting();

    try {
      const [langDict, enDict] = await Promise.all([
        loadDict(setting),
        setting === "en" ? Promise.resolve(null) : loadDict("en"),
      ]);
      dict = langDict;
      fallback = enDict || langDict;
    } catch (err) {
      dict = null;
      fallback = null;
      console.warn("i18n load failed", err);
    }

    document.documentElement.setAttribute("lang", setting);
    document.documentElement.setAttribute("data-lang", setting);

    applyTranslations(document);

    const event = new CustomEvent("th-i18n-ready", {
      detail: {
        setting,
        locale: getLocale(setting),
      },
    });
    document.dispatchEvent(event);
  }

  function setLanguage(nextSetting) {
    const normalized = normalizeLang(nextSetting) || DEFAULT_LANG;
    try {
      localStorage.setItem(STORAGE_KEY, normalized);
    } catch (err) {
      // ignore storage failures
    }
    return refresh();
  }

  function t(key, fallbackText) {
    const value = translate(key);
    if (value == null) return fallbackText != null ? fallbackText : key;
    return value;
  }

  function getState() {
    return {
      setting,
      locale: getLocale(setting || DEFAULT_LANG),
    };
  }

  document.addEventListener("DOMContentLoaded", () => {
    refresh();
  });

  window.JG_I18N = {
    t,
    setLanguage,
    getState,
    refresh,
    getLocale,
  };
})();
