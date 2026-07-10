import { Feed } from 'feed'
import { getAllPosts } from '@/lib/posts'

export async function GET() {
  const posts = getAllPosts()
  const siteUrl = 'https://findns94.github.io'

  const feed = new Feed({
    title: 'Silver Bullet',
    description: 'Martin Zhao 的个人博客',
    id: siteUrl,
    link: siteUrl,
    language: 'zh-CN',
    copyright: `Martin Zhao ${new Date().getFullYear()}`,
    author: {
      name: 'Martin Zhao',
    },
  })

  for (const post of posts) {
    feed.addItem({
      title: post.title,
      id: `${siteUrl}/posts/${post.slug}/`,
      link: `${siteUrl}/posts/${post.slug}/`,
      description: post.excerpt,
      date: new Date(post.date),
      category: post.tags.map((name) => ({ name })),
    })
  }

  return new Response(feed.rss2(), {
    headers: {
      'Content-Type': 'application/rss+xml; charset=utf-8',
    },
  })
}
