import { notFound } from 'next/navigation'
import type { Metadata } from 'next'
import { getAllPosts, getPostBySlug } from '@/lib/posts'
import { compileMarkdown } from '@/lib/markdown'
import { PostDetail } from '@/components/PostDetail'
import { StructuredData } from '@/components/StructuredData'

interface Props {
  params: {
    slug: string
  }
}

const siteUrl = 'https://findns.cc'

export function generateStaticParams() {
  const posts = getAllPosts()
  return posts.map((post) => ({ slug: post.slug }))
}

export async function generateMetadata({ params }: Props): Promise<Metadata> {
  const post = getPostBySlug(params.slug)
  if (!post) return { title: 'Not Found' }

  const { meta } = post
  const description = meta.description || meta.excerpt?.slice(0, 160) || ''

  return {
    title: meta.title,
    description,
    openGraph: {
      type: 'article',
      title: meta.title,
      description,
      url: `${siteUrl}/posts/${meta.slug}/`,
      siteName: 'Silver Bullet',
      images: meta.ogImage
        ? [{ url: meta.ogImage, alt: meta.coverImageAlt, width: 1200, height: 630 }]
        : undefined,
      publishedTime: meta.date,
      modifiedTime: meta.lastUpdated,
      authors: [meta.author],
      tags: meta.tags,
    },
    twitter: {
      card: 'summary_large_image',
      title: meta.title,
      description,
      images: meta.ogImage ? [meta.ogImage] : undefined,
    },
  }
}

export default async function PostPage({ params }: Props) {
  const result = getPostBySlug(params.slug)

  if (!result) return notFound()

  const { meta, contentEn, contentZh } = result
  const htmlEn = await compileMarkdown(contentEn)
  const htmlZh = contentZh ? await compileMarkdown(contentZh) : null

  const blogPosting = {
    '@context': 'https://schema.org',
    '@type': 'BlogPosting',
    headline: meta.title,
    description: meta.description || meta.excerpt?.slice(0, 160) || '',
    image: meta.ogImage || undefined,
    author: { '@type': 'Person', name: meta.author },
    publisher: {
      '@type': 'Organization',
      name: 'Silver Bullet',
      logo: { '@type': 'ImageObject', url: `${siteUrl}/images/logo.png` },
    },
    datePublished: meta.date,
    dateModified: meta.lastUpdated,
    keywords: meta.tags.join(', '),
    mainEntityOfPage: `${siteUrl}/posts/${meta.slug}/`,
  }

  return (
    <>
      <StructuredData data={blogPosting} />
      <PostDetail
        title={meta.title}
        titleZh={meta.titleZh}
        date={meta.date}
        tags={meta.tags}
        htmlEn={htmlEn}
        htmlZh={htmlZh}
      />
    </>
  )
}
