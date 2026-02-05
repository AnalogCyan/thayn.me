(function () {
  function updateContainerMaxWidth() {
    const navWrap = document.querySelector(".nav-pill-wrap");
    if (!navWrap) return;
    const container = navWrap.closest(".container");
    if (!container) return;

    const navRect = navWrap.getBoundingClientRect();
    const styles = window.getComputedStyle(container);
    const padLeft = parseFloat(styles.paddingLeft) || 0;
    const padRight = parseFloat(styles.paddingRight) || 0;
    const width = Math.ceil(navRect.width + padLeft + padRight);

    document.documentElement.style.setProperty(
      "--container-max-width",
      `${width}px`
    );
  }

  function init() {
    updateContainerMaxWidth();

    if (document.fonts && document.fonts.ready) {
      document.fonts.ready.then(updateContainerMaxWidth);
    }

    window.addEventListener("resize", () => {
      window.requestAnimationFrame(updateContainerMaxWidth);
    });

    if (window.ResizeObserver) {
      const navWrap = document.querySelector(".nav-pill-wrap");
      if (!navWrap) return;
      const observer = new ResizeObserver(() => updateContainerMaxWidth());
      observer.observe(navWrap);
    }
  }

  if (document.readyState === "loading") {
    document.addEventListener("DOMContentLoaded", init);
  } else {
    init();
  }
})();
