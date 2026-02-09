const agentDefinitions = [
  {
    name: "OpenAI GPTBot",
    pattern: "gptbot",
    documentation: "https://platform.openai.com/docs/gptbot",
  },
  {
    name: "OpenAI ChatGPT User",
    pattern: "chatgpt-user",
    documentation: "https://platform.openai.com/docs/gptbot",
  },
  {
    name: "OpenAI ChatGPT Bot",
    pattern: "chatgpt",
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
    name: "Applebot",
    pattern: "applebot",
    documentation: "https://support.apple.com/HT204683",
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
    name: "NeevaAI",
    pattern: "neeva",
    documentation: "https://neeva.com/neevabot",
  },
  {
    name: "Omgili data crawler",
    pattern: "omgili",
    documentation: "https://www.omgili.com/",
  },
] as const;

export default agentDefinitions;
