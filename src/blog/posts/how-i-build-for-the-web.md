---
title: "How I Build for the Web"
date: 2026-03-16
categories:
  - "Web Dev"
excerpt: "No frameworks, no bloat. Just standards, a custom build system, and opinions about glass."
syndicationComplete: true
syndication:
  bluesky: "https://bsky.app/profile/thayn.me/post/3mh5oerkcpc2m"
  mastodon: "https://tech.lgbt/@AnalogCyan/116237086956188701"
syndicationStatus:
  bluesky: "confirmed"
  mastodon: "confirmed"
---
A few people have asked me about how I build my websites, what tools I use, and why everything looks and feels the way it does. So here's the rundown: my approach to web development, the principles behind it, and the tools that make it work.

## Standards First

The web platform is incredibly powerful in 2026. Native CSS can do things that required JavaScript or preprocessors just a couple years ago: `light-dark()` for theming, `:has()` for parent selection, `@starting-style` for entry animations, individual transform properties, container queries, native nesting. The list keeps growing.

My rule is simple: **stick to vanilla web standards unless a framework genuinely earns its place.** HTML, CSS, and JavaScript can do the job. The browser *is* the framework. I don't need React to render a page. I don't need Tailwind to write styles. I don't need webpack to bundle three dependencies.

That's not framework-bashing for its own sake. If you're building a complex app with shared state and dozens of contributors, frameworks can absolutely make sense. But for personal sites, portfolios, blogs? The platform is more than enough, and the result is faster, lighter, and more durable. Your site won't break because a dependency you never heard of pushed a bad update.

If you're curious about just how far CSS has come, I'd recommend [You no longer need JavaScript](https://lyra.horse/blog/2025/08/you-dont-need-js/) by lyra. It made me realize CSS has become even more powerful than I thought, and I've been rethinking where I draw the line between CSS and JS ever since.

## GachaKit

My build system is called **GachaKit**. It's a work in progress, and this site is a live prototype of it. I know I'm not the first person to build a static site generator. There are dozens of them. But every one I've tried has been either bloated, opinionated in ways I disagree with, or built on abstractions that drift away from vanilla web standards. I'd rather build something small that works exactly how I think than fight someone else's framework.

The core idea is **capsules**: self-contained, reusable components that bundle their own HTML, CSS, and JS. Drop a `<drop capsule="site-header">` tag into any page and the build system expands it, bundles the styles, and wires up the scripts. Capsules can nest other capsules. They accept data attributes for configuration. The whole thing runs on Node.js with exactly three dependencies: `front-matter` for YAML parsing, `handlebars` for templates, and `marked` for Markdown. That's it.

<abbr title="Don't Repeat Yourself">DRY</abbr> is the philosophy. Every component lives in one place. Change the header capsule, and every page that uses it updates on the next build. No copy-paste, no sync issues, no "I forgot to update that other template."

## Stack

The full toolset is pretty short:

- **Terminal + VS Code** for writing code
- **Node.js** for the build system (begrudgingly, but it's useful and widely supported)
- **GitHub** for version control and hosting the source
- **Netlify** for publishing, edge functions, and serverless functions
- **Remix Icon** for icons (my current favorite icon set for web dev)
- **webmention.io** for receiving webmentions from around the web
- **Bridgy** for POSSE syndication to Bluesky and Mastodon
- **ESLint + Prettier** for keeping the code clean

That's genuinely it. No bundler, no CSS preprocessor, no component framework.

## Liquid Glass x Material Design

Design-wise, I'm doing something a bit opinionated. I like aspects of Apple's Liquid Glass aesthetic and Google's Material Expressive direction, but I don't love either one wholesale. So I made my own thing that borrows from both.

From the glass side: frosted transparency, backdrop blur, layered depth, soft light reflections. From the expressive side: bold color accents, playful interactions, generous spacing, personality in the details. The result is something that feels physical and tactile without being chaotic.

It's still a work in progress. I'm constantly refining the details, and things will change over time as I figure out what works and what doesn't. Once I've fully nailed down both the build system and the design language, I plan on publishing it all as part of GachaKit.

## IndieWeb

The IndieWeb is a relatively recent discovery for me, and I love everything about it.

The idea is that you should own your content. Your website is your home on the internet, not someone else's platform. You publish on your own site first, then syndicate to social networks. That's called **POSSE** (Publish on Own Site, Syndicate Elsewhere), and it means your content lives on your domain regardless of what happens to any particular platform.

This site implements several IndieWeb building blocks:

- **Microformats2** (`h-entry`, `h-card`, `u-syndication`) so other IndieWeb tools can parse the content
- **Webmentions** via [webmention.io](https://webmention.io), so when someone likes, reposts, or replies to a post on Bluesky or Mastodon, it shows up here
- **Bridgy** for POSSE syndication: when I publish a post, it automatically cross-posts to my social accounts
- **RSS and Atom feeds** because feeds are good and more things should have them
- **Fediring** membership, because web rings are cool and the indie web should feel connected

## The Small Stuff

Some things that don't get their own section but matter to me:

**Accessibility.** `focus-visible` instead of `focus` so keyboard users get outlines but mouse users don't get sticky highlights. `prefers-reduced-motion` to kill all animations and transitions for people who need that. Semantic HTML everywhere. ARIA labels on interactive elements. It's not hard to do, so there's no excuse not to.

**Anti-AI training.** The site sends `AI-Training: none` and `X-Robots-Tag: noai, noimageai` headers, and Netlify's AI User Agent Blocker is enabled to block known AI crawlers at the edge. I don't consent to having my content used to train models. You can read it, link to it, quote it. But don't feed it to a machine.

**toki pona.** I'm currently learning toki pona, and the site has a language switcher with a work-in-progress toki pona translation. It's incomplete, but it's there, and I'm adding to it as I learn.

## Build Something

You don't need a fancy stack. You don't need to npm install the world. The browser gives you an incredible platform for free. Learn what it can do, respect the standards, and go build something that's truly yours!

If any of this is interesting to you, poke around the site. View source. It's all there. The code is [on GitHub](https://github.com/AnalogCyan/thayn.me) under AGPLv3, and content is CC BY-SA 4.0.
