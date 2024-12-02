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
        ) * 1000;

        setTimeout(() => {
          window.location.href = href;
        }, duration);
      });
    });
  }
});