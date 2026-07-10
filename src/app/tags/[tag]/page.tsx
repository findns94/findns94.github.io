import Link from 'next/link'
import type { Metadata } from 'next'
import { getAllTags, getPostsByTag } from '@/lib/posts'
import { formatDate } from '@/lib/utils'

interface Props {
  params: {
    tag: string
  }
}

export function generateStaticParams() {
  const tags = getAllTags()
  return tags.map((t) => ({ tag: t.tag }))
}

export async function generateMetadata({ params }: Props): Promise<Metadata> {
  return {
    title: `Tag: ${params.tag}`,
  }
}

export default function TagPage({ params }: Props) {
  const tag = params.tag
  const posts = getPostsByTag(tag)

  return (
    <div>
      <h1 className="text-3xl font-bold mb-2">
        <span className="text-gray-500 font-normal">Tag:</span> {tag}
      </h1>
      <p className="text-gray-500 mb-8">{posts.length} post{posts.length !== 1 ? 's' : ''}</p>

      <ul className="space-y-5">
        {posts.map((post) => (
          <li key={post.slug}>
            <Link href={`/posts/${post.slug}/`} className="block no-underline group">
              <article>
                <h2 className="text-lg font-semibold text-gray-900 group-hover:text-blue-600 transition-colors">
                  {post.title}
                </h2>
                <time className="text-sm text-gray-500">
                  {formatDate(post.date)}
                </time>
                {post.excerpt && (
                  <p className="mt-1 text-sm text-gray-600 line-clamp-2">{post.excerpt}</p>
                )}
              </article>
            </Link>
          </li>
        ))}
      </ul>
    </div>
  )
}
