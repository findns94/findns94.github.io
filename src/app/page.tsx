import { getAllPosts } from '@/lib/posts'
import { PostList } from '@/components/PostList'

export default function HomePage() {
  const posts = getAllPosts()

  return (
    <div>
      <h1 className="text-3xl font-bold mb-8">Posts</h1>
      <PostList posts={posts} />
    </div>
  )
}
