'use client'

import { useLanguage } from '@/contexts/LanguageContext'
import { formatDate, formatDateZh, slugifyTag } from '@/lib/utils'

interface Props {
  title: string
  titleZh: string
  date: string
  tags: string[]
  htmlEn: string
  htmlZh: string | null
}

export function PostDetail({ title, titleZh, date, tags, htmlEn, htmlZh }: Props) {
  const { language } = useLanguage()
  const isZh = language === 'zh'

  const displayTitle = isZh ? titleZh : title
  const displayDate = isZh ? formatDateZh(date) : formatDate(date)
  const displayHtml = isZh && htmlZh ? htmlZh : htmlEn

  return (
    <article>
      <header className="mb-8">
        <h1 className="text-3xl font-bold text-gray-900">{displayTitle}</h1>
        <time dateTime={date} className="block mt-2 text-gray-500">
          {displayDate}
        </time>
        {tags.length > 0 && (
          <div className="mt-3 flex flex-wrap gap-2">
            {tags.map((tag) => (
              <a
                key={tag}
                href={`/tags/${slugifyTag(tag)}/`}
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
        dangerouslySetInnerHTML={{ __html: displayHtml }}
      />
    </article>
  )
}
