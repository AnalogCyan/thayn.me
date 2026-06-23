# Gradient Background Capsule

Flowing gradient background with grain overlay.

## Usage

Add this capsule at the top of your page template:

```html
<drop capsule="gradient-background"></drop>
```

## Features

- Gradient uses theme's accent color
- Grain overlay for texture
- z-index ensures behind all content
- Full viewport span

## Customization

The gradient uses CSS variables from your theme:

- `--accent-hue`: Controls the base hue of the gradient (defaults to 205)

You can modify the intensity of the grain by adjusting the opacity in the CSS.

## Example

```html
<body>
  <drop capsule="gradient-background"></drop>
  <drop capsule="header"></drop>
  <!-- Rest of your content -->
</body>
```
