# Footer Capsule

Minimal slot-based site footer for thayn.me. Content is provided via the `<drop>` slot.

## Usage

```html
<drop capsule="footer">
  <div class="footer-links">
    <!-- Your footer content here -->
  </div>
</drop>
```

## Dependencies

- Uses CSS variables from `variables.css`
- CSS selector: `footer[data-capsule="footer"]`

## Features

- Centered, low-opacity footer pinned to bottom of page
- Slot-based content injection
