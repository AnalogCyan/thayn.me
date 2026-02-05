document.addEventListener("DOMContentLoaded", () => {
  const nav = document.querySelector(".nav-pill");
  if (!nav) return;

  const toggle = nav.querySelector(".nav-pill__toggle");
  const list = nav.querySelector(".nav-pill__list");
  if (!toggle || !list) return;

  const icon = toggle.querySelector("i");
  const openClass = "nav-pill--open";
  const mediaQuery = window.matchMedia("(max-width: 720px)");

  const setOpen = (open) => {
    if (!mediaQuery.matches) {
      nav.classList.remove(openClass);
      toggle.setAttribute("aria-expanded", "false");
      if (icon) {
        icon.classList.remove("ri-close-line");
        icon.classList.add("ri-menu-line");
      }
      return;
    }

    nav.classList.toggle(openClass, open);
    toggle.setAttribute("aria-expanded", open ? "true" : "false");
    if (icon) {
      icon.classList.toggle("ri-menu-line", !open);
      icon.classList.toggle("ri-close-line", open);
    }
  };

  const toggleMenu = () => {
    if (!mediaQuery.matches) return;
    setOpen(!nav.classList.contains(openClass));
  };

  toggle.addEventListener("click", (event) => {
    event.preventDefault();
    toggleMenu();
  });

  document.addEventListener("click", (event) => {
    if (!mediaQuery.matches) return;
    if (!nav.contains(event.target)) {
      setOpen(false);
    }
  });

  document.addEventListener("keydown", (event) => {
    if (!mediaQuery.matches) return;
    if (event.key === "Escape") {
      setOpen(false);
    }
  });

  list.querySelectorAll("a").forEach((link) => {
    link.addEventListener("click", () => setOpen(false));
  });

  mediaQuery.addEventListener("change", () => setOpen(false));

  setOpen(false);
});
