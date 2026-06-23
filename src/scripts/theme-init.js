/* thayn.me – theme-init.js – Instant theme class injection to prevent flash */

(() => {
  try {
    const root = document.documentElement;

    const mode = localStorage.getItem("thayn_theme");
    if (mode === "light") {
      root.classList.add("light-theme");
    } else if (mode === "dark") {
      root.classList.add("dark-theme");
    }

    let hue;
    try {
      hue = sessionStorage.getItem("th_accent_hue");
    } catch {
      // ignore
    }
    if (hue === null) {
      hue = Math.floor(Math.random() * 360);
      try {
        sessionStorage.setItem("th_accent_hue", hue);
      } catch {
        // ignore
      }
    }
    root.style.setProperty("--accent-hue", hue);
  } catch {
    // ignore theme init failures
  }
})();
