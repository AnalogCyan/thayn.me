
// === card-hover.js ===
document.addEventListener('DOMContentLoaded', () => {
  const projects = document.querySelectorAll('.project');

  // Function to generate a random tilt that's visibly noticeable
  const getRandomTilt = () => {
    // Create two ranges: -3 to -1.5 for left tilt, and 1.5 to 3 for right tilt
    const isLeftTilt = Math.random() < 0.5;

    if (isLeftTilt) {
      // Random number between -3 and -1.5
      return (Math.random() * -1.5 - 1.5).toFixed(2);
    } else {
      // Random number between 1.5 and 3
      return (Math.random() * 1.5 + 1.5).toFixed(2);
    }
  };

  projects.forEach((project) => {
    // Add mouseenter event to apply a new random tilt each time
    project.addEventListener('mouseenter', () => {
      const randomTilt = getRandomTilt();
      project.style.transform = `scale(var(--hover-scale)) rotate(${randomTilt}deg)`;
    });

    // Add mouseleave event to reset the transform
    project.addEventListener('mouseleave', () => {
      project.style.transform = 'scale(1) rotate(0deg)';
    });
  });

  // Update for prefers-reduced-motion
  const mediaQuery = window.matchMedia('(prefers-reduced-motion: reduce)');

  function handleReducedMotion(e) {
    if (e.matches) {
      projects.forEach((project) => {
        project.style.transform = 'none';
        project.removeEventListener('mouseenter', null);
        project.removeEventListener('mouseleave', null);
      });
    }
  }

  mediaQuery.addEventListener('change', handleReducedMotion);
  handleReducedMotion(mediaQuery);
});
// === disco.js ===
const quoteDisplay = document.getElementById('quoteDisplay');
let isClicked = false;

function activateDiscoMode() {
  if (isClicked) return;

  const motion = window.matchMedia("(prefers-reduced-motion: no-preference)");

  // Check if users don't have a preference for reduced motion
  if (motion.matches) {
    let hue = 0;
    let color, gradientColor;

    setInterval(() => {
      if (window.matchMedia && window.matchMedia('(prefers-color-scheme: light)').matches) {
        color = `hsl(${hue += 5} 50% 40%)`;
        gradientColor = `hsla(${hue} 50% 40% / 0.25)`; // Increased opacity from 0.1 to 0.25
      } else {
        color = `hsl(${hue += 5} 50% 50%)`;
        gradientColor = `hsla(${hue} 50% 50% / 0.25)`; // Increased opacity from 0.1 to 0.25
      }

      // Update all the existing color properties
      document.documentElement.style.setProperty('--glow-color', color);
      document.documentElement.style.setProperty('--link-color', color);
      document.documentElement.style.setProperty('--gradient-end', gradientColor);
      document.querySelector('.name').style.color = color;
      quoteDisplay.style.color = color;
    }, 50);

    quoteDisplay.textContent = "🏳️‍🌈 Gay mode enabled!";
  }

  isClicked = true;
}

// Automatically activate Disco mode if visiting via thayn.gay
if (window.location.hostname === 'thayn.gay') {
  activateDiscoMode();
}

// Allow users to manually activate Disco mode by clicking
quoteDisplay.addEventListener('click', activateDiscoMode);

// Add pointer cursor on hover
quoteDisplay.style.cursor = 'pointer';
// === i18n.js ===
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
      return stored || "en";
    } catch (err) {
      return "en";
    }
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

// === layout.js ===
(function () {
  function updateContainerMaxWidth() {
    const navWrap = document.querySelector(".nav-pill-wrap");
    if (!navWrap) return;
    const container = navWrap.closest(".container");
    if (!container) return;

    const navRect = navWrap.getBoundingClientRect();
    const styles = window.getComputedStyle(container);
    const padLeft = parseFloat(styles.paddingLeft) || 0;
    const padRight = parseFloat(styles.paddingRight) || 0;
    const width = Math.ceil(navRect.width + padLeft + padRight);

    document.documentElement.style.setProperty(
      "--container-max-width",
      `${width}px`
    );
  }

  function init() {
    updateContainerMaxWidth();

    if (document.fonts && document.fonts.ready) {
      document.fonts.ready.then(updateContainerMaxWidth);
    }

    window.addEventListener("resize", () => {
      window.requestAnimationFrame(updateContainerMaxWidth);
    });

    if (window.ResizeObserver) {
      const navWrap = document.querySelector(".nav-pill-wrap");
      if (!navWrap) return;
      const observer = new ResizeObserver(() => updateContainerMaxWidth());
      observer.observe(navWrap);
    }
  }

  if (document.readyState === "loading") {
    document.addEventListener("DOMContentLoaded", init);
  } else {
    init();
  }
})();

// === mobile-interactions.js ===
document.addEventListener('DOMContentLoaded', () => {
  // Add class to indicate JavaScript is available
  document.body.classList.add('js-enabled');

  // Only apply this behavior on touch devices
  if ('ontouchstart' in window) {
    const animatedElements = document.querySelectorAll(`
      .social-icons a,
      .project,
      .about a,
      .projects a,
      .custom-link,
      .tag,
      .footer-link
    `);

    animatedElements.forEach(element => {
      element.addEventListener('click', (e) => {
        if (!element.href && !element.closest('a')) return;

        e.preventDefault();
        const linkElement = element.href ? element : element.closest('a');
        const href = linkElement.href;

        // Check for reduced motion preference
        if (window.matchMedia('(prefers-reduced-motion: reduce)').matches) {
          window.location.href = href;
          return;
        }

        element.classList.add('animating');

        const duration = parseFloat(
          getComputedStyle(document.documentElement)
            .getPropertyValue('--transition-duration')
        ) * 2000;

        setTimeout(() => {
          window.location.href = href;
        }, duration + 100);
      });
    });
  }
});
// === profile-physics.js ===
document.addEventListener('DOMContentLoaded', () => {
  const profilePic = document.querySelector('.profile-pic');

  // Check if it's a mobile device
  const isMobile = /iPhone|iPad|iPod|Android/i.test(navigator.userAgent);

  let isDangling = false;
  let currentAngle = 0;
  let currentVelocity = 0;
  let animationFrame;

  // Physics constants
  const GRAVITY = 0.2;
  const DAMPING = 0.98;
  const SPRING = 0.01;
  const REST_ANGLE = 15; // Final resting angle
  const HOVER_SWING = 3; // Degrees to swing on hover when dangling

  // Update physics simulation
  function updatePhysics() {
    if (!isDangling) return;

    // Calculate forces
    const angleFromRest = currentAngle - REST_ANGLE;
    const springForce = -SPRING * angleFromRest;

    // Update velocity and position
    currentVelocity += springForce;
    currentVelocity *= DAMPING;
    currentAngle += currentVelocity;

    // Apply transform
    profilePic.style.transform = `rotate(${currentAngle}deg)`;

    // Stop animation if movement is very small
    if (Math.abs(currentVelocity) > 0.001 || Math.abs(angleFromRest) > 0.001) {
      animationFrame = requestAnimationFrame(updatePhysics);
    }
  }

  // Handle click to start dangling
  profilePic.addEventListener('click', () => {
    if (isMobile) return; // Disable on mobile devices

    if (isDangling) return;

    isDangling = true;
    profilePic.classList.add('dangling');

    // Initial "drop" animation
    currentAngle = 0;
    currentVelocity = GRAVITY * 20; // Initial push

    updatePhysics();
  });

  // Handle hover when dangling
  profilePic.addEventListener('mouseenter', () => {
    if (isMobile) return; // Disable on mobile devices

    if (!isDangling) return;

    // Add a small impulse to create a swinging effect
    currentVelocity += (Math.random() * 2 - 1) * HOVER_SWING;

    if (!animationFrame) {
      updatePhysics();
    }
  });

  // Reset on double click
  profilePic.addEventListener('dblclick', () => {
    if (isMobile) return; // Disable on mobile devices

    if (!isDangling) return;

    isDangling = false;
    profilePic.classList.remove('dangling');
    profilePic.style.transform = '';
    cancelAnimationFrame(animationFrame);
  });
});
// === Capsule: theme-lang-toggle ===
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
