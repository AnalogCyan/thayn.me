document.getElementById('quoteDisplay').addEventListener('click', function () {
  const motion = window.matchMedia("(prefers-reduced-motion: no-preference)");

  // Check if users don't have a preference for reduced motion
  if (motion.matches) {
    let hue = 0;
    let color;

    setInterval(() => {
      color = `hsl(${hue += 5} 50% 30%)`;
      document.documentElement.style.setProperty('--glow-color', color);
      document.documentElement.style.setProperty('--link-color', color);
      document.querySelector('.name').style.color = color;
      this.style.color = color;
    }, 50);

    this.textContent = "🪩 Disco mode enabled!";
    quoteDisplay.removeEventListener('click', handleClick);
  }
});

// Add pointer cursor on hover
document.getElementById('quoteDisplay').style.cursor = 'pointer';
