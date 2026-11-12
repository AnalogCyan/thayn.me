# Header Capsule

Responsive navigation pill with embedded theme toggle and mobile hamburger menu.

## Features

- Glassmorphic nav pill with sliding active indicator
- Embedded theme toggle (light/dark/auto)
- Mobile hamburger with dropdown menu and Escape-to-close
- Configurable via `data-theme-key` attribute

## Usage

```html
<drop capsule="header" data-theme-key="thayn_theme">
  <li class="nav-pill__item">
    <a href="/" class="nav-pill__link" data-nav="home">
      <i class="ri-home-5-line"></i>
      <span class="nav-pill__text">Home</span>
    </a>
  </li>
</drop>
```

## Technical Notes

- The active link is the one whose `data-nav` matches `data-nav-page` on an enclosing element, usually `<body>` or `page-header`. It gets `is-active` and `aria-current="page"`
- The sliding pill is CSS only: links share one grid column width and the pill moves by whole columns to the hovered or focused link, resting on the current one. The index rules cover up to eight links
- The mobile menu is a `popover`; the script only closes it after a link swaps the page in place or focus leaves it
- Theme toggle uses `data-theme-key` for localStorage key (defaults to `thayn_theme`)
