'use client'

import Link from 'next/link'

interface Props {
  tags: { tag: string; count: number }[]
}

export function TagsList({ tags }: Props) {
  return (
    <div className="flex flex-wrap gap-3">
      {tags.map(({ tag, count }) => (
        <Link
          key={tag}
          href={`/tags/${encodeURIComponent(tag)}/`}
          className="inline-flex items-center gap-1.5 px-3 py-1.5 bg-gray-100 text-gray-700 rounded-lg hover:bg-blue-100 hover:text-blue-700 no-underline transition-colors"
        >
          <span>{tag}</span>
          <span className="text-xs text-gray-500">({count})</span>
        </Link>
      ))}
    </div>
  )
}
