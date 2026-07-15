import Link from 'next/link'
import type { Metadata } from 'next'
import { getAllTags, getPostsByTag } from '@/lib/posts'
import { PostList } from '@/components/PostList'

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

      <PostList posts={posts} />
    </div>
  )
}
