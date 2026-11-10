// Training crawlers the bots edge function turns away. Each pattern is matched
// against the user agent, so a token that only appears in robots.txt, such as
// Google-Extended, does not belong here. "googleother" also covers
// GoogleOther-Image and GoogleOther-Video.
const agentDefinitions = [
  {
    name: "OpenAI GPTBot",
    pattern: "gptbot",
    documentation: "https://developers.openai.com/api/docs/bots",
  },
  {
    name: "Anthropic ClaudeBot",
    pattern: "claudebot",
    documentation:
      "https://support.claude.com/en/articles/8896518-does-anthropic-crawl-data-from-the-web-and-how-can-site-owners-block-the-crawler",
  },
  {
    name: "Anthropic anthropic-ai",
    pattern: "anthropic-ai",
    documentation:
      "https://support.claude.com/en/articles/8896518-does-anthropic-crawl-data-from-the-web-and-how-can-site-owners-block-the-crawler",
  },
  {
    name: "GoogleOther",
    pattern: "googleother",
    documentation:
      "https://developers.google.com/crawling/docs/crawlers-fetchers/google-common-crawlers",
  },
  {
    name: "Amazonbot",
    pattern: "amazonbot",
    documentation: "https://developer.amazon.com/docs/amazonbot/amazonbot.html",
  },
  {
    name: "ByteDance Bytespider",
    pattern: "bytespider",
  },
  {
    name: "Common Crawl CCBot",
    pattern: "ccbot",
    documentation: "https://commoncrawl.org/ccbot",
  },
  {
    name: "Perplexity Bot",
    pattern: "perplexitybot",
    documentation:
      "https://docs.perplexity.ai/docs/resources/perplexity-crawlers",
  },
  {
    name: "Meta-ExternalAgent",
    pattern: "meta-externalagent",
    documentation:
      "https://developers.facebook.com/docs/sharing/webmasters/web-crawlers/",
  },
  {
    name: "FacebookBot",
    pattern: "facebookbot",
    documentation:
      "https://developers.facebook.com/docs/sharing/webmasters/web-crawlers/",
  },
  {
    name: "Cohere AI",
    pattern: "cohere-ai",
  },
  {
    name: "You.com crawler",
    pattern: "youbot",
  },
  {
    name: "KagiBot",
    pattern: "kagibot",
    documentation: "https://kagi.com/bot",
  },
  {
    name: "Diffbot",
    pattern: "diffbot",
  },
  {
    name: "Omgili data crawler",
    pattern: "omgili",
    documentation:
      "https://webz.io/blog/web-data/what-is-the-omgili-bot-and-why-is-it-crawling-your-website/",
  },
] as const;

export default agentDefinitions;
