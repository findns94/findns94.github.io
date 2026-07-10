import fs from 'fs'
import path from 'path'
import matter from 'gray-matter'

const POSTS_DIR = path.join(process.cwd(), 'content/posts')

export interface PostMeta {
  slug: string
  title: string
  date: string
  tags: string[]
  categories: string[]
  math?: boolean
  excerpt: string
}

// Read and parse a single post's markdown file
function readPost(slug: string): { meta: PostMeta; content: string } | null {
  const postDir = path.join(POSTS_DIR, slug)
  const filePath = path.join(postDir, 'index.md')

  if (!fs.existsSync(filePath)) return null

  const fileContents = fs.readFileSync(filePath, 'utf-8')
  const { data, content } = matter(fileContents)

  // Extract excerpt from <!-- more --> separator
  const moreIndex = content.indexOf('<!-- more -->')
  const excerpt = moreIndex > -1
    ? content.slice(0, moreIndex).trim()
    : content.slice(0, 200).trim()

  const meta: PostMeta = {
    slug,
    title: data.title || slug,
    date: data.date ? new Date(data.date).toISOString() : new Date().toISOString(),
    tags: Array.isArray(data.tags) ? data.tags : [],
    categories: Array.isArray(data.categories) ? data.categories : [],
    math: data.math === true || data.mathjax === true,
    excerpt,
  }

  return { meta, content }
}

// Get all posts sorted by date descending
export function getAllPosts(): PostMeta[] {
  if (!fs.existsSync(POSTS_DIR)) return []

  const slugs = fs.readdirSync(POSTS_DIR).filter((name) => {
    const stat = fs.statSync(path.join(POSTS_DIR, name))
    return stat.isDirectory() && fs.existsSync(path.join(POSTS_DIR, name, 'index.md'))
  })

  const posts = slugs
    .map((slug) => readPost(slug))
    .filter((p): p is { meta: PostMeta; content: string } => p !== null)
    .map((p) => p.meta)

  posts.sort((a, b) => new Date(b.date).getTime() - new Date(a.date).getTime())

  return posts
}

// Get a single post by slug
export function getPostBySlug(slug: string): { meta: PostMeta; content: string } | null {
  return readPost(slug)
}

// Get all unique tags with post counts
export function getAllTags(): { tag: string; count: number }[] {
  const allPosts = getAllPosts()
  const tagMap = new Map<string, number>()

  for (const post of allPosts) {
    for (const tag of post.tags) {
      tagMap.set(tag, (tagMap.get(tag) || 0) + 1)
    }
  }

  return Array.from(tagMap.entries())
    .map(([tag, count]) => ({ tag, count }))
    .sort((a, b) => b.count - a.count || a.tag.localeCompare(b.tag))
}

// Get all posts for a specific tag
export function getPostsByTag(tag: string): PostMeta[] {
  return getAllPosts().filter((post) => post.tags.includes(tag))
}
