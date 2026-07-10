import Link from 'next/link'
import { getAllPosts } from '@/lib/posts'
import { formatDateZh } from '@/lib/utils'

export default function HomePage() {
  const posts = getAllPosts()

  return (
    <div>
      <h1 className="text-3xl font-bold mb-8">文章</h1>

      {posts.length === 0 ? (
        <p className="text-gray-500">暂无文章</p>
      ) : (
        <ul className="space-y-6">
          {posts.map((post) => (
            <li key={post.slug} className="group">
              <Link href={`/posts/${post.slug}/`} className="block no-underline">
                <article>
                  <h2 className="text-xl font-semibold text-gray-900 group-hover:text-blue-600 transition-colors">
                    {post.title}
                  </h2>
                  <time className="text-sm text-gray-500 mt-1 block">
                    {formatDateZh(post.date)}
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
                  {post.excerpt && (
                    <p className="mt-2 text-sm text-gray-600 line-clamp-2">
                      {post.excerpt}
                    </p>
                  )}
                </article>
              </Link>
            </li>
          ))}
        </ul>
      )}
    </div>
  )
}
