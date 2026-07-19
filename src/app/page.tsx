import { getAllPosts } from '@/lib/posts'
import { PostList } from '@/components/PostList'

const HOME_POST_LIMIT = 10

export default function HomePage() {
  const allPosts = getAllPosts()
  const posts = allPosts.slice(0, HOME_POST_LIMIT)
  const hasMore = allPosts.length > HOME_POST_LIMIT

  return (
    <div>
      <h1 className="text-3xl font-bold mb-8">Posts</h1>
      <PostList posts={posts} moreHref={hasMore ? '/posts/' : undefined} />
    </div>
  )
}
