'use client'

import Link from 'next/link'
import { useLanguage } from '@/contexts/LanguageContext'
import { getMessages } from '@/i18n/messages'
import { formatDate, formatDateZh } from '@/lib/utils'
import { type PostMeta } from '@/lib/posts'

interface Props {
  posts: PostMeta[]
  emptyMessage?: string
  // When true, render a title + date only list (no excerpt, no tags).
  compact?: boolean
  // When set, render a "more posts" link at the bottom pointing here.
  moreHref?: string
}

export function PostList({ posts, emptyMessage, compact, moreHref }: Props) {
  const { language } = useLanguage()
  const isZh = language === 'zh'
  const t = getMessages(language)

  return (
    <>
      {posts.length === 0 ? (
        <p className="text-gray-500">{emptyMessage ?? (isZh ? '暂无文章' : 'No posts yet.')}</p>
      ) : (
        <ul className={compact ? 'space-y-3' : 'space-y-6'}>
          {posts.map((post) => (
            <li key={post.slug} className="group">
              <Link href={`/posts/${post.slug}/`} className="block no-underline">
                {compact ? (
                  <div className="flex items-baseline gap-3">
                    <time className="text-sm text-gray-500 shrink-0 w-24">
                      {isZh ? formatDateZh(post.date) : formatDate(post.date)}
                    </time>
                    <span className="text-base font-medium text-gray-900 group-hover:text-blue-600 transition-colors">
                      {isZh ? post.titleZh : post.title}
                    </span>
                  </div>
                ) : (
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
                    {(isZh ? post.excerptZh : (post.description || post.excerpt)) && (
                      <p className="mt-2 text-sm text-gray-600 line-clamp-3">
                        {isZh ? post.excerptZh : (post.description || post.excerpt)}
                      </p>
                    )}
                  </article>
                )}
              </Link>
            </li>
          ))}
        </ul>
      )}
      {moreHref && (
        <div className="mt-8 text-center">
          <Link
            href={moreHref}
            className="inline-flex items-center gap-1.5 px-5 py-2.5 bg-gray-100 text-gray-700 rounded-lg hover:bg-blue-100 hover:text-blue-700 no-underline transition-colors"
          >
            <span>{t.posts.more}</span>
            <span aria-hidden>→</span>
          </Link>
        </div>
      )}
    </>
  )
}
