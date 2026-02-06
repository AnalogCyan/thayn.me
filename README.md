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

> [!WARNING]
> Redesign in progress — some pages may be incomplete or broken.

What’s in here:

• Source for my personal site, built and deployed via Netlify.

• Code is open-source; content is share-alike (see Licensing).

## Syndication flow

Production deploys trigger the `deploy-succeeded-background` Netlify function,
which publishes Bridgy targets listed in post frontmatter `syndicate` and
writes back confirmed URLs under `syndication` plus status metadata
(`syndicationStatus`, `syndicationRequestedAt`, `syndicationCheckedAt`,
`syndicationLastError`). There is no public HTTP endpoint for syndication.

## Blog post frontmatter schema

All files in `src/blog/posts/*.md` are treated as published posts (no draft
system). The schema below is the canonical layout.

Template (copy‑paste for new posts):

```yaml
---
title: "My Post Title"
date: "YYYY-MM-DD"
author: "Cyan Thayn"
categories:
  - category-one
  - category-two
excerpt: ""
canonical: ""
syndicate:
  - mastodon
  - bluesky
syndication: {}
syndicationStatus: {}
syndicationRequestedAt: {}
syndicationCheckedAt: {}
syndicationLastError: {}
syndicationComplete: false
---
```

### Field reference:

1. `title` (optional): Post title. Defaults to the filename slug if omitted.
2. `date` (required): Publish date (`YYYY-MM-DD` or ISO). Used for feeds and
   `dt-published`.
3. `author` (optional): Defaults to `Cyan Thayn`.
4. `categories` (optional): Array of category strings (single string is
   normalized to an array).
5. `excerpt` (optional): Listing/feed summary. Leave blank to auto‑generate
   from the body.
6. `canonical` (optional): Absolute or site‑relative canonical URL. Leave blank
   to use the default `/blog/<slug>/` canonical (normalized).
7. `syndicate` (optional, manual): Array of target platforms to publish
   (`mastodon`, `bluesky`). `fediverse` is accepted as an alias for
   `mastodon`.
8. `syndication` (automation): Map of platform → syndicated URL. Leave empty
   for the pipeline to fill.
9. `syndicationStatus` (automation): Map of platform → `pending`, `requested`,
   `confirmed`, or `failed`. Leave empty for the pipeline to fill.
10. `syndicationRequestedAt` (automation): Map of platform → ISO timestamp for
    when a publish entered/updated requested/failed state.
11. `syndicationCheckedAt` (automation): Map of platform → ISO timestamp for the
    last background confirmation check while status is `requested`.
12. `syndicationLastError` (automation): Map of platform → short error string
    (truncated). Leave empty for the pipeline to fill.
13. `syndicationComplete` (automation): `true` when all targets in `syndicate`
    are completed and the list is empty. Leave `false` or omit for new posts.

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

# Licensing

This repository uses two licenses:

- Code: GNU Affero General Public License v3.0 — see LICENSE￼
- Content (text, images, media): Creative Commons Attribution–ShareAlike 4.0 — see LICENSE-CONTENT￼

If you reuse content, please attribute and keep derivatives under CC BY-SA 4.0.
