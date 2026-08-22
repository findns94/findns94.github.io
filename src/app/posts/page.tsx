import type { Metadata } from 'next'
import { getAllPosts } from '@/lib/posts'
import { PostList } from '@/components/PostList'
import { getMessages } from '@/i18n/messages'

export const metadata: Metadata = {
  title: 'All Posts',
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
      <PostList posts={posts} compact />
    </div>
  )
}
