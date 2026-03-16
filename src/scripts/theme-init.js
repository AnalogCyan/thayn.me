(() => {
  try {
    const mode = localStorage.getItem("thayn_theme");
    const root = document.documentElement;
    if (mode === "light") {
      root.classList.add("light-theme");
    } else if (mode === "dark") {
      root.classList.add("dark-theme");
    }
  } catch {
    // ignore theme init failures
  }
})();
