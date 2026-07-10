import Link from 'next/link'
import { getAllTags } from '@/lib/posts'

export const metadata = {
  title: '标签',
}

export default function TagsPage() {
  const tags = getAllTags()

  return (
    <div>
      <h1 className="text-3xl font-bold mb-8">标签</h1>

      {tags.length === 0 ? (
        <p className="text-gray-500">暂无标签</p>
      ) : (
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
      )}
    </div>
  )
}
