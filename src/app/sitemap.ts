import type { MetadataRoute } from 'next'
import { getAllPosts } from '@/lib/posts'

const siteUrl = 'https://findns.cc'

export default function sitemap(): MetadataRoute.Sitemap {
  const posts = getAllPosts()

  const postEntries = posts.map((post) => ({
    url: `${siteUrl}/posts/${post.slug}/`,
    lastModified: post.date,
    changeFrequency: 'monthly' as const,
    priority: 0.8,
  }))

  const chapterEntries = ['00', '01', '02', '03', '04', '05', '06', '07', '08', '09', '10', '11', '12', '13', '14', '15', '16', '17', '18'].map(
    (num) => ({
      url: `${siteUrl}/shanhaijin/chapters/${num}`,
      changeFrequency: 'monthly' as const,
      priority: 0.5,
    }),
  )

  const staticEntries = [
    { url: `${siteUrl}/`, changeFrequency: 'weekly' as const, priority: 1.0 },
    { url: `${siteUrl}/posts/`, changeFrequency: 'weekly' as const, priority: 0.9 },
    { url: `${siteUrl}/tags/`, changeFrequency: 'weekly' as const, priority: 0.7 },
    { url: `${siteUrl}/about/`, changeFrequency: 'monthly' as const, priority: 0.5 },
    { url: `${siteUrl}/contact/`, changeFrequency: 'monthly' as const, priority: 0.5 },
    { url: `${siteUrl}/privacy/`, changeFrequency: 'yearly' as const, priority: 0.3 },
    { url: `${siteUrl}/terms/`, changeFrequency: 'yearly' as const, priority: 0.3 },
    { url: `${siteUrl}/disclaimer/`, changeFrequency: 'yearly' as const, priority: 0.3 },
    { url: `${siteUrl}/shanhaijin/`, changeFrequency: 'weekly' as const, priority: 0.7 },
    { url: `${siteUrl}/shanhaijin/search/`, changeFrequency: 'monthly' as const, priority: 0.4 },
    { url: `${siteUrl}/shanhaijin/panorama/`, changeFrequency: 'monthly' as const, priority: 0.5 },
    { url: `${siteUrl}/shanhaijin/graph/`, changeFrequency: 'monthly' as const, priority: 0.5 },
    { url: `${siteUrl}/shanhaijin/map/`, changeFrequency: 'monthly' as const, priority: 0.6 },
    { url: `${siteUrl}/shanhaijin/entities/`, changeFrequency: 'monthly' as const, priority: 0.6 },
    { url: `${siteUrl}/shanhaijin/entities/creature/`, changeFrequency: 'monthly' as const, priority: 0.5 },
    { url: `${siteUrl}/shanhaijin/entities/bird-beast/`, changeFrequency: 'monthly' as const, priority: 0.5 },
    { url: `${siteUrl}/shanhaijin/entities/water/`, changeFrequency: 'monthly' as const, priority: 0.4 },
    { url: `${siteUrl}/shanhaijin/entities/mineral/`, changeFrequency: 'monthly' as const, priority: 0.5 },
    { url: `${siteUrl}/shanhaijin/entities/plant/`, changeFrequency: 'monthly' as const, priority: 0.4 },
    { url: `${siteUrl}/shanhaijin/entities/polity/`, changeFrequency: 'monthly' as const, priority: 0.4 },
    { url: `${siteUrl}/shanhaijin/entities/deity/`, changeFrequency: 'monthly' as const, priority: 0.5 },
    { url: `${siteUrl}/shanhaijin/entities/person/`, changeFrequency: 'monthly' as const, priority: 0.5 },
    { url: `${siteUrl}/shanhaijin/entities/omen/`, changeFrequency: 'monthly' as const, priority: 0.5 },
    { url: `${siteUrl}/shanhaijin/entities/sacrifice/`, changeFrequency: 'monthly' as const, priority: 0.5 },
    { url: `${siteUrl}/shanhaijin/entities/mountain/`, changeFrequency: 'monthly' as const, priority: 0.5 },
  ]

  return [...staticEntries, ...chapterEntries, ...postEntries]
}
