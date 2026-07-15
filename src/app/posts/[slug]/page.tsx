import { notFound } from 'next/navigation'
import type { Metadata } from 'next'
import { getAllPosts, getPostBySlug } from '@/lib/posts'
import { compileMarkdown } from '@/lib/markdown'
import { PostDetail } from '@/components/PostDetail'

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

  const { meta, contentEn, contentZh } = result
  const htmlEn = await compileMarkdown(contentEn)
  const htmlZh = contentZh ? await compileMarkdown(contentZh) : null

  return (
    <PostDetail
      title={meta.title}
      titleZh={meta.titleZh}
      date={meta.date}
      tags={meta.tags}
      htmlEn={htmlEn}
      htmlZh={htmlZh}
    />
  )
}
