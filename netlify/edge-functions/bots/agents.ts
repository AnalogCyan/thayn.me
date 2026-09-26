const agentDefinitions = [
  {
    name: "OpenAI GPTBot",
    pattern: "gptbot",
    documentation: "https://platform.openai.com/docs/gptbot",
  },
  {
    name: "Anthropic ClaudeBot",
    pattern: "claudebot",
    documentation:
      "https://docs.anthropic.com/claude/docs/claudebot-web-crawler",
  },
  {
    name: "Anthropic anthropic-ai",
    pattern: "anthropic-ai",
    documentation:
      "https://docs.anthropic.com/claude/docs/claudebot-web-crawler",
  },
  {
    name: "Google-Extended",
    pattern: "google-extended",
    documentation: "https://ai.google.dev/docs/ai-search-guidelines",
  },
  {
    name: "GoogleOther",
    pattern: "googleother",
    documentation:
      "https://developers.google.com/search/docs/crawling-indexing/googlebot",
  },
  {
    name: "GoogleOther-Image",
    pattern: "googleother-image",
    documentation:
      "https://developers.google.com/search/docs/crawling-indexing/googlebot",
  },
  {
    name: "Amazonbot",
    pattern: "amazonbot",
    documentation: "https://developer.amazon.com/support/amazonbot",
  },
  {
    name: "ByteDance Bytespider",
    pattern: "bytespider",
    documentation: "https://www.bytedance.com/en/bytespider",
  },
  {
    name: "Common Crawl CCBot",
    pattern: "ccbot",
    documentation: "https://commoncrawl.org/bp/CCBot",
  },
  {
    name: "Perplexity Bot",
    pattern: "perplexitybot",
    documentation: "https://www.perplexity.ai/hc/en/articles/2087021059",
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
    documentation: "https://docs.cohere.com/docs/crawler",
  },
  {
    name: "You.com crawler",
    pattern: "youbot",
    documentation: "https://about.you.com/youbot",
  },
  {
    name: "KagiBot",
    pattern: "kagibot",
    documentation: "https://help.kagi.com/kagi/search/kagibot.html",
  },
  {
    name: "Diffbot",
    pattern: "diffbot",
    documentation:
      "https://docs.diffbot.com/docs/why-is-diffbot-crawling-my-site",
  },
  {
    name: "Omgili data crawler",
    pattern: "omgili",
    documentation: "https://www.omgili.com/",
  },
] as const;

export default agentDefinitions;
