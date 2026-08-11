import { getAllPosts } from '@/lib/posts'

const siteUrl = 'https://findns.cc'

// llms.txt — a plain-text site index for LLM consumption.
// Proposed by Anthropic; Claude reads it, Perplexity has expressed alignment.
// Keep under 10KB — LLMs may truncate larger files.
// Supplements (never replaces) sitemap.xml.
export async function GET() {
  const posts = getAllPosts()

  const lines: string[] = []

  lines.push('# Silver Bullet')
  lines.push('')
  lines.push(
    "> Martin Zhao's blog — Linux kernel, systems programming, AI visibility, finance, and life."
  )
  lines.push('')
  lines.push('## Essential')
  lines.push('')
  lines.push(`- [Home](${siteUrl}/): Latest articles and topic clusters`)
  lines.push(`- [About](${siteUrl}/about): Author background and site mission`)
  lines.push(`- [Posts](${siteUrl}/posts): Full article archive`)
  lines.push(`- [Tags](${siteUrl}/tags): Browse by topic`)
  lines.push('')
  lines.push('## Popular Articles')
  lines.push('')

  // Top posts by recency, capped to keep the file under 10KB.
  const topPosts = posts.slice(0, 20)
  for (const post of topPosts) {
    const desc = (post.description || post.excerpt || '').slice(0, 120)
    lines.push(
      `- [${post.title}](${siteUrl}/posts/${post.slug}/): ${desc}`
    )
  }

  lines.push('')

  return new Response(lines.join('\n'), {
    headers: {
      'Content-Type': 'text/plain; charset=utf-8',
    },
  })
}
