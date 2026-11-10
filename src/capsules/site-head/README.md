# Site Head Capsule

The `<head>` tags every page shares: viewport, theme colors, manifest and
icons, the font preload, theme-init, and the bundles.

## Usage

```html
<head>
  <meta charset="UTF-8" />
  <drop capsule="site-head"></drop>
  <meta name="description" content="..." />
  <title>...</title>
</head>
```

## Technical Notes

- Keep `<meta charset>` on the page, ahead of the drop
- Page-specific tags (description, Open Graph, Twitter, canonical, JSON-LD)
  and extra stylesheets stay on the page, after the drop, so they load after
  `/styles.css`
- Holds the `<!-- EXTERNAL_RESOURCES -->` placeholder the engine fills from
  `config.json`
