import type { Metadata } from 'next'
import { Suspense } from 'react'
import { getAllPosts } from '@/lib/posts'
import { PostListWithPagination } from '@/components/PostListWithPagination'
import { getMessages } from '@/i18n/messages'

const POSTS_PER_PAGE = 20

export const metadata: Metadata = {
  title: 'All Posts',
}

function PaginationFallback() {
  return <div className="mt-10 h-20" />
}

export default function PostsPage() {
  const posts = getAllPosts()
  const tEn = getMessages('en')
  const tZh = getMessages('zh')

  return (
    <div>
      <h1 className="text-3xl font-bold mb-8">
        <span className="en-only">{tEn.posts.allPostsTitle(posts.length)}</span>
        <span className="zh-only">{tZh.posts.allPostsTitle(posts.length)}</span>
      </h1>
      <Suspense fallback={<PaginationFallback />}>
        <PostListWithPagination posts={posts} postsPerPage={POSTS_PER_PAGE} />
      </Suspense>
    </div>
  )
}
