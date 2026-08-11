import type { MetadataRoute } from 'next'

const siteUrl = 'https://findns.cc'

// AI search & LLM crawlers: explicit allow signals for each major bot.
// An absent rule is interpreted differently per platform, so we name them.
export default function robots(): MetadataRoute.Robots {
  return {
    rules: [
      // AI search-indexing & training bots
      { userAgent: 'GPTBot', allow: ['/'] },
      { userAgent: 'OAI-SearchBot', allow: ['/'] },
      { userAgent: 'ClaudeBot', allow: ['/'] },
      { userAgent: 'Claude-SearchBot', allow: ['/'] },
      { userAgent: 'PerplexityBot', allow: ['/'] },
      { userAgent: 'Google-Extended', allow: ['/'] },
      { userAgent: 'CCBot', allow: ['/'] },
      { userAgent: 'Applebot-Extended', allow: ['/'] },
      // Traditional search
      { userAgent: 'Googlebot', allow: ['/'] },
      { userAgent: 'Bingbot', allow: ['/'] },
      // Catch-all: allow everything else
      { userAgent: '*', allow: ['/'] },
    ],
    sitemap: `${siteUrl}/sitemap.xml`,
  }
}
