# thayn.me

Personal website and portfolio for Cyan.

<p>
  <a href="https://app.netlify.com/projects/thayn/deploys">
    <img alt="Netlify Status" src="https://api.netlify.com/api/v1/badges/1ebab9b0-26fa-4390-81d4-8f3a6e388630/deploy-status" />
  </a>
  <a href="./LICENSE">
    <img alt="License: AGPL v3" src="https://img.shields.io/badge/Code-AGPL%20v3-blue.svg?style=flat-square" />
  </a>
  <a href="./LICENSE-CONTENT">
    <img alt="License: CC BY-SA 4.0" src="https://img.shields.io/badge/Content-CC%20BY--SA%204.0-lightgrey.svg?style=flat-square" />
  </a>
</p>

> [!WARNING]
> Redesign in progress. Some pages may be incomplete or broken.

## About

Source for [thayn.me](https://thayn.me), built without frameworks or bundlers.
The entire build is a single Node.js script (`build.js`) that compiles
Handlebars templates and Markdown into static HTML/CSS/JS, deployed on Netlify.

Three production dependencies: `front-matter`, `handlebars`, `marked`.

### How it’s put together

- **Capsules** are self-contained components (HTML + CSS + JS) that compose into
  pages. See `src/capsules/` for the header, footer, ambient background, etc.
- **Blog** posts are Markdown with YAML frontmatter, syndicated to Mastodon and
  Bluesky via Bridgy on deploy.
- **i18n** supports English and Toki Pona with client-side language switching.
- **Edge functions** block AI crawlers. Serverless functions proxy Last.fm data
  and fetch webmentions.

## Local development

Requires Node.js **>= v24**.

```sh
npm install
npm run dev      # build + serve at localhost:3000
npm run build    # build only (outputs to ./public)
npm run format   # prettier
```

## Licensing

- **Code:** [AGPL v3](./LICENSE)
- **Content** (text, images, media): [CC BY-SA 4.0](./LICENSE-CONTENT)

If you reuse content, please attribute and keep derivatives under CC BY-SA 4.0.
