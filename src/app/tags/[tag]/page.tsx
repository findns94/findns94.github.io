import type { Metadata } from 'next'
import { getAllTags, getPostsByTag, slugifyTag } from '@/lib/posts'
import { PostList } from '@/components/PostList'

interface Props {
  params: {
    tag: string
  }
}

// Pre-render one page per tag using a URL-safe slug as the route segment.
// e.g. "Machine Learning" -> "/tags/machine-learning/"
export function generateStaticParams() {
  const tags = getAllTags()
  return tags.map((t) => ({ tag: t.slug }))
}

export async function generateMetadata({ params }: Props): Promise<Metadata> {
  const displayTag = resolveTagName(params.tag)
  return {
    title: `Tag: ${displayTag}`,
  }
}

// Map a slug back to the original tag display name (falls back to the slug).
function resolveTagName(slug: string): string {
  const match = getAllTags().find((t) => t.slug === slug)
  return match?.tag ?? slug
}

export default function TagPage({ params }: Props) {
  const slug = params.tag
  const displayTag = resolveTagName(slug)
  const posts = getPostsByTag(slug)

  return (
    <div>
      <h1 className="text-3xl font-bold mb-2">
        <span className="text-gray-500 font-normal">Tag:</span> {displayTag}
      </h1>
      <p className="text-gray-500 mb-8">{posts.length} post{posts.length !== 1 ? 's' : ''}</p>

      <PostList posts={posts} />
    </div>
  )
}
