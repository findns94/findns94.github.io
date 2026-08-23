'use client'

import { useSearchParams } from 'next/navigation'
import { PostList } from './PostList'
import { Pagination } from './Pagination'
import { type PostMeta } from '@/lib/posts'

interface Props {
  posts: PostMeta[]
  postsPerPage: number
}

export function PostListWithPagination({ posts, postsPerPage }: Props) {
  const searchParams = useSearchParams()
  const totalPages = Math.ceil(posts.length / postsPerPage)
  const currentPage = Math.min(
    Math.max(1, Number(searchParams.get('page')) || 1),
    totalPages
  )

  const startIndex = (currentPage - 1) * postsPerPage
  const endIndex = startIndex + postsPerPage
  const currentPosts = posts.slice(startIndex, endIndex)

  return (
    <>
      <PostList posts={currentPosts} compact />
      <Pagination totalPosts={posts.length} postsPerPage={postsPerPage} />
    </>
  )
}
