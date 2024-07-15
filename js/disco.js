const quoteDisplay = document.getElementById('quoteDisplay');
let isClicked = false;

quoteDisplay.addEventListener('click', function handleClick() {
  if (isClicked) return;

  const motion = window.matchMedia("(prefers-reduced-motion: no-preference)");

  // Check if users don't have a preference for reduced motion
  if (motion.matches) {
    let hue = 0;
    let color;

    setInterval(() => {
      if (window.matchMedia && window.matchMedia('(prefers-color-scheme: light)').matches) {
        color = `hsl(${hue += 5} 50% 40%)`;
      } else {
        color = `hsl(${hue += 5} 50% 50%)`;
      }
      document.documentElement.style.setProperty('--glow-color', color);
      document.documentElement.style.setProperty('--link-color', color);
      document.querySelector('.name').style.color = color;
      quoteDisplay.style.color = color;
    }, 50);

    quoteDisplay.textContent = "🪩 Disco mode enabled!";
  }

  isClicked = true;
});

// Add pointer cursor on hover
quoteDisplay.style.cursor = 'pointer';
