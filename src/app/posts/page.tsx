import type { Metadata } from 'next'
import { getAllPosts } from '@/lib/posts'
import { PostList } from '@/components/PostList'

export const metadata: Metadata = {
  title: 'All Posts',
}

export default function PostsPage() {
  const posts = getAllPosts()

  return (
    <div>
      <h1 className="text-3xl font-bold mb-8">All Posts</h1>
      <PostList posts={posts} compact />
    </div>
  )
}
