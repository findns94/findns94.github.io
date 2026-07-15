'use client'

import Link from 'next/link'
import { useLanguage } from '@/contexts/LanguageContext'
import { formatDate, formatDateZh } from '@/lib/utils'
import { type PostMeta } from '@/lib/posts'

interface Props {
  posts: PostMeta[]
  emptyMessage?: string
}

export function PostList({ posts, emptyMessage }: Props) {
  const { language } = useLanguage()
  const isZh = language === 'zh'

  return (
    <>
      {posts.length === 0 ? (
        <p className="text-gray-500">{emptyMessage ?? (isZh ? '暂无文章' : 'No posts yet.')}</p>
      ) : (
        <ul className="space-y-6">
          {posts.map((post) => (
            <li key={post.slug} className="group">
              <Link href={`/posts/${post.slug}/`} className="block no-underline">
                <article>
                  <h2 className="text-xl font-semibold text-gray-900 group-hover:text-blue-600 transition-colors">
                    {isZh ? post.titleZh : post.title}
                  </h2>
                  <time className="text-sm text-gray-500 mt-1 block">
                    {isZh ? formatDateZh(post.date) : formatDate(post.date)}
                  </time>
                  {post.tags.length > 0 && (
                    <div className="mt-2 flex flex-wrap gap-2">
                      {post.tags.map((tag) => (
                        <span
                          key={tag}
                          className="text-xs px-2 py-0.5 bg-gray-100 text-gray-600 rounded"
                        >
                          {tag}
                        </span>
                      ))}
                    </div>
                  )}
                  {(isZh ? post.excerptZh : post.excerpt) && (
                    <p className="mt-2 text-sm text-gray-600 line-clamp-2">
                      {isZh ? post.excerptZh : post.excerpt}
                    </p>
                  )}
                </article>
              </Link>
            </li>
          ))}
        </ul>
      )}
    </>
  )
}
