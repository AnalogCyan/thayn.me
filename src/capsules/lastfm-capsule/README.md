# Last.fm Capsule

Fetches and displays now-playing track from Last.fm. Shows album art, track name, artist, and listening context.

## Usage

```html
<drop capsule="lastfm-capsule"></drop>
```

## Dependencies

- Netlify function at `/api/lastfm-now-playing`
- `lastfm-capsule.js` bundled via build

## Features

- Now-playing track with album art
- Expandable recent tracks list
- Visualizer wave animation when playing
- Color extraction from album art for visualizer
