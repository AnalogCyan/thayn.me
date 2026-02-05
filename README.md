# thayn.me

Personal website & portfolio for Cyan.

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

[!WARNING]
Redesign in progress — some pages may be incomplete or broken.

What’s in here:

• Source for my personal site, built and deployed via Netlify.

• Code is open-source; content is share-alike (see Licensing).

## Local development

**Requirements:** Node.js **≥ v24**.

```sh
# install dependencies
npm install

# build + serve the site locally (builds to ./public)
npm run dev

# build only
npm run build

# format the repo
npm run format
```

## Blog frontmatter

Optional syndication links can be added per post. Use a `syndication` map keyed by site, with a single URL or a list:

```yaml
---
title: Example Post
date: 2026-02-01
syndication:
  bluesky: https://bsky.app/profile/you/post/123
  fediverse:
    - https://tech.lgbt/@AnalogCyan/123456
  instagram: https://www.instagram.com/p/ABC123/
  github: https://github.com/AnalogCyan/example
  musicbrainz: https://musicbrainz.org/release/...
  lastfm: https://www.last.fm/user/AnalogCyan
  discogs: https://www.discogs.com/release/...
  pronouns: https://en.pronouns.page/@AnalogCyan
---
```

Supported sites match those linked elsewhere on the site: `bluesky`, `fediverse`, `instagram`, `github`, `musicbrainz`, `lastfm`, `discogs`, `pronouns`.

# Licensing

This repository uses two licenses:
• Code: GNU Affero General Public License v3.0 — see LICENSE￼
• Content (text, images, media): Creative Commons Attribution–ShareAlike 4.0 — see LICENSE-CONTENT￼

If you reuse content, please attribute and keep derivatives under CC BY-SA 4.0.
