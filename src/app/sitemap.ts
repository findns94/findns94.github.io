import type { MetadataRoute } from 'next'
import { getAllPosts } from '@/lib/posts'

const siteUrl = 'https://findns94.github.io'

export default function sitemap(): MetadataRoute.Sitemap {
  const posts = getAllPosts()

  const postEntries = posts.map((post) => ({
    url: `${siteUrl}/posts/${post.slug}/`,
    lastModified: post.date,
    changeFrequency: 'monthly' as const,
    priority: 0.8,
  }))

  const staticEntries = [
    { url: `${siteUrl}/`, changeFrequency: 'weekly' as const, priority: 1.0 },
    { url: `${siteUrl}/posts/`, changeFrequency: 'weekly' as const, priority: 0.9 },
    { url: `${siteUrl}/tags/`, changeFrequency: 'weekly' as const, priority: 0.7 },
    { url: `${siteUrl}/about/`, changeFrequency: 'monthly' as const, priority: 0.5 },
    { url: `${siteUrl}/contact/`, changeFrequency: 'monthly' as const, priority: 0.5 },
    { url: `${siteUrl}/privacy/`, changeFrequency: 'yearly' as const, priority: 0.3 },
    { url: `${siteUrl}/terms/`, changeFrequency: 'yearly' as const, priority: 0.3 },
    { url: `${siteUrl}/disclaimer/`, changeFrequency: 'yearly' as const, priority: 0.3 },
  ]

  return [...staticEntries, ...postEntries]
}
