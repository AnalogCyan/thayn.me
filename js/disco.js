document.getElementById('quoteDisplay').addEventListener('click', function () {
  const motion = window.matchMedia("(prefers-reduced-motion: no-preference)");

  // Check if users don't have a preference for reduced motion
  if (motion.matches) {
    let hue = 0;
    let color;

    setInterval(() => {
      color = `hsl(${hue += 5} 50% 30%)`;
      // Change the --glow-color CSS variable
      document.documentElement.style.setProperty('--glow-color', color);
    }, 50);

    // Change the text of the element
    this.textContent = "🪩 Disco mode enabled!";
  }
});

// Add pointer cursor on hover
document.getElementById('quoteDisplay').style.cursor = 'pointer';
