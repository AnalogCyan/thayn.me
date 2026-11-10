# Site Header Capsule

The page header: the `header` capsule filled with the primary nav. Adding a
page to the nav is one edit here.

## Usage

```html
<body class="page-shell" data-nav-page="about">
  <drop capsule="site-header"></drop>
</body>
```

## Technical Notes

- The active link is the one whose `data-nav` matches `data-nav-page` on
  `<body>`. An empty value, as on the 404 page, marks none
- Wraps `header` rather than editing it, so `header` stays in step with
  GachaKit's copy
