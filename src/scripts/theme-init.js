(() => {
  try {
    const root = document.documentElement;

    const mode = localStorage.getItem("thayn_theme");
    if (mode === "light") {
      root.classList.add("light-theme");
    } else if (mode === "dark") {
      root.classList.add("dark-theme");
    }

    // Randomize background gradient hue for variety across page loads
    const hue = Math.floor(Math.random() * 360);
    root.style.setProperty("--accent-hue", hue);
  } catch {
    // ignore theme init failures
  }
})();
