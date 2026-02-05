document.addEventListener("DOMContentLoaded", () => {
  const projects = document.querySelectorAll(".project");

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
    project.addEventListener("mouseenter", () => {
      const randomTilt = getRandomTilt();
      project.style.transform = `scale(var(--hover-scale)) rotate(${randomTilt}deg)`;
    });

    // Add mouseleave event to reset the transform
    project.addEventListener("mouseleave", () => {
      project.style.transform = "scale(1) rotate(0deg)";
    });
  });

  // Update for prefers-reduced-motion
  const mediaQuery = window.matchMedia("(prefers-reduced-motion: reduce)");

  function handleReducedMotion(e) {
    if (e.matches) {
      projects.forEach((project) => {
        project.style.transform = "none";
        project.removeEventListener("mouseenter", null);
        project.removeEventListener("mouseleave", null);
      });
    }
  }

  mediaQuery.addEventListener("change", handleReducedMotion);
  handleReducedMotion(mediaQuery);
});
