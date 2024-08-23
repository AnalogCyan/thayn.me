const quoteDisplay = document.getElementById('quoteDisplay');
let isClicked = false;

function activateDiscoMode() {
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