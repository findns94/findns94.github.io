import fs from 'fs'
import path from 'path'
import matter from 'gray-matter'
import { slugifyTag } from '@/lib/utils'

const POSTS_DIR = path.join(process.cwd(), 'content/posts')

export interface PostMeta {
  slug: string
  title: string
  titleZh: string
  date: string
  tags: string[]
  tagSlugs: string[]
  categories: string[]
  math?: boolean
  excerpt: string
  excerptZh: string
  hasZh: boolean
}

export { slugifyTag }

// Extract excerpt from <!-- more --> separator
function extractExcerpt(content: string): string {
  const moreIndex = content.indexOf('<!-- more -->')
  return moreIndex > -1
    ? content.slice(0, moreIndex).trim()
    : content.slice(0, 200).trim()
}

// Read a language-specific markdown file
function readLangFile(postDir: string, lang: 'en' | 'zh'): { data: Record<string, unknown>; content: string } | null {
  const filename = lang === 'zh' ? 'index.zh.md' : 'index.md'
  const filePath = path.join(postDir, filename)
  if (!fs.existsSync(filePath)) return null
  const fileContents = fs.readFileSync(filePath, 'utf-8')
  return matter(fileContents)
}

// Read and parse a single post's markdown file
function readPost(slug: string): { meta: PostMeta; contentEn: string; contentZh: string | null } | null {
  const postDir = path.join(POSTS_DIR, slug)

  // English is required
  const enResult = readLangFile(postDir, 'en')
  if (!enResult) return null

  const { data, content: contentEn } = enResult

  // Chinese is optional
  const zhResult = readLangFile(postDir, 'zh')
  const hasZh = zhResult !== null
  const contentZh = zhResult?.content ?? null

  const titleZh = hasZh && zhResult?.data?.title
    ? String(zhResult.data.title)
    : (data.title as string || slug)

  const excerpt = extractExcerpt(contentEn)
  const excerptZh = contentZh ? extractExcerpt(contentZh) : excerpt

  const tags: string[] = Array.isArray(data.tags) ? data.tags as string[] : []

  const meta: PostMeta = {
    slug,
    title: data.title as string || slug,
    titleZh,
    date: data.date ? new Date(data.date as string).toISOString() : new Date().toISOString(),
    tags,
    tagSlugs: tags.map((t) => slugifyTag(t)),
    categories: Array.isArray(data.categories) ? data.categories as string[] : [],
    math: data.math === true || data.mathjax === true,
    excerpt,
    excerptZh,
    hasZh,
  }

  return { meta, contentEn, contentZh }
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
    .filter((p): p is { meta: PostMeta; contentEn: string; contentZh: string | null } => p !== null)
    .map((p) => p.meta)

  posts.sort((a, b) => new Date(b.date).getTime() - new Date(a.date).getTime())

  return posts
}

// Get a single post by slug
export function getPostBySlug(slug: string): { meta: PostMeta; contentEn: string; contentZh: string | null } | null {
  return readPost(slug)
}

// Get raw markdown content for a specific language
export function getPostContentBySlug(slug: string, lang: 'en' | 'zh'): string | null {
  const postDir = path.join(POSTS_DIR, slug)
  const filename = lang === 'zh' ? 'index.zh.md' : 'index.md'
  const filePath = path.join(postDir, filename)
  if (!fs.existsSync(filePath)) return null
  return fs.readFileSync(filePath, 'utf-8')
}

// Get all unique tags with post counts, including their URL slug.
// De-duplicated by tag name (a tag always maps to one slug).
export function getAllTags(): { tag: string; slug: string; count: number }[] {
  const allPosts = getAllPosts()
  const tagMap = new Map<string, number>()

  for (const post of allPosts) {
    for (const tag of post.tags) {
      tagMap.set(tag, (tagMap.get(tag) || 0) + 1)
    }
  }

  return Array.from(tagMap.entries())
    .map(([tag, count]) => ({ tag, slug: slugifyTag(tag), count }))
    .sort((a, b) => b.count - a.count || a.tag.localeCompare(b.tag))
}

// Get all posts for a specific tag slug
export function getPostsByTag(slug: string): PostMeta[] {
  return getAllPosts().filter((post) => post.tagSlugs.includes(slug))
}
