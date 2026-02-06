(() => {
  try {
    const mode = localStorage.getItem("thayn_theme");
    const root = document.documentElement;
    if (mode === "light") {
      root.classList.add("light-theme");
    } else if (mode === "dark") {
      root.classList.add("dark-theme");
    } else if (mode === "auto") {
      if (window.matchMedia("(prefers-color-scheme: dark)").matches) {
        root.classList.add("dark-theme");
      } else {
        root.classList.add("light-theme");
      }
    }
  } catch {
    // ignore theme init failures
  }
})();
