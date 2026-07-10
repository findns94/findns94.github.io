import { notFound } from 'next/navigation'
import type { Metadata } from 'next'
import { getAllPosts, getPostBySlug } from '@/lib/posts'
import { compileMarkdown } from '@/lib/markdown'
import { formatDateZh } from '@/lib/utils'

interface Props {
  params: {
    slug: string
  }
}

export function generateStaticParams() {
  const posts = getAllPosts()
  return posts.map((post) => ({ slug: post.slug }))
}

export async function generateMetadata({ params }: Props): Promise<Metadata> {
  const post = getPostBySlug(params.slug)
  if (!post) return { title: 'Not Found' }

  return {
    title: post.meta.title,
    description: post.meta.excerpt?.slice(0, 160) || '',
  }
}

export default async function PostPage({ params }: Props) {
  const result = getPostBySlug(params.slug)

  if (!result) return notFound()

  const { meta: postMatter, content } = result
  const html = await compileMarkdown(content)

  return (
    <article>
      <header className="mb-8">
        <h1 className="text-3xl font-bold text-gray-900">{postMatter.title}</h1>
        <time className="block mt-2 text-gray-500">
          {formatDateZh(postMatter.date)}
        </time>
        {postMatter.tags.length > 0 && (
          <div className="mt-3 flex flex-wrap gap-2">
            {postMatter.tags.map((tag) => (
              <a
                key={tag}
                href={`/tags/${encodeURIComponent(tag)}/`}
                className="text-xs px-2 py-0.5 bg-gray-100 text-gray-600 rounded hover:bg-blue-100 hover:text-blue-700 no-underline transition-colors"
              >
                {tag}
              </a>
            ))}
          </div>
        )}
      </header>

      <div
        className="prose prose-gray max-w-none prose-headings:text-gray-900 prose-a:text-blue-600 prose-a:no-underline hover:prose-a:underline prose-img:rounded-lg"
        dangerouslySetInnerHTML={{ __html: html }}
      />
    </article>
  )
}
