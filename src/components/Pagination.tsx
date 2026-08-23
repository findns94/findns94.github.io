'use client'

import { useSearchParams, useRouter, usePathname } from 'next/navigation'
import { useLanguage } from '@/contexts/LanguageContext'
import { useCallback, useMemo } from 'react'

interface Props {
  totalPosts: number
  postsPerPage: number
}

function getPageNumbers(currentPage: number, totalPages: number): (number | 'ellipsis')[] {
  const pages: (number | 'ellipsis')[] = []

  if (totalPages <= 7) {
    // Show all pages if 7 or fewer
    for (let i = 1; i <= totalPages; i++) {
      pages.push(i)
    }
    return pages
  }

  // Always show first page
  pages.push(1)

  if (currentPage <= 4) {
    // Near the beginning: show 1, 2, 3, 4, 5, ..., last
    for (let i = 2; i <= 5; i++) {
      pages.push(i)
    }
    pages.push('ellipsis')
    pages.push(totalPages)
  } else if (currentPage >= totalPages - 3) {
    // Near the end: show 1, ..., last-4, last-3, last-2, last-1, last
    pages.push('ellipsis')
    for (let i = totalPages - 4; i <= totalPages; i++) {
      pages.push(i)
    }
  } else {
    // In the middle: show 1, ..., current-1, current, current+1, ..., last
    pages.push('ellipsis')
    pages.push(currentPage - 1)
    pages.push(currentPage)
    pages.push(currentPage + 1)
    pages.push('ellipsis')
    pages.push(totalPages)
  }

  return pages
}

export function Pagination({ totalPosts, postsPerPage }: Props) {
  const router = useRouter()
  const pathname = usePathname()
  const searchParams = useSearchParams()
  const { language } = useLanguage()
  const isZh = language === 'zh'

  const totalPages = Math.ceil(totalPosts / postsPerPage)
  const currentPage = Math.min(
    Math.max(1, Number(searchParams.get('page')) || 1),
    totalPages
  )

  const goToPage = useCallback(
    (page: number) => {
      const params = new URLSearchParams(searchParams.toString())
      if (page === 1) {
        params.delete('page')
      } else {
        params.set('page', String(page))
      }
      const query = params.toString()
      router.push(query ? `${pathname}?${query}` : pathname)
    },
    [router, pathname, searchParams]
  )

  const pages = useMemo(
    () => getPageNumbers(currentPage, totalPages),
    [currentPage, totalPages]
  )

  if (totalPages <= 1) return null

  const startPost = (currentPage - 1) * postsPerPage + 1
  const endPost = Math.min(currentPage * postsPerPage, totalPosts)

  return (
    <nav aria-label={isZh ? '分页导航' : 'Pagination'} className="mt-10">
      {/* Showing info */}
      <p className="text-sm text-gray-500 text-center mb-4">
        {isZh
          ? `显示第 ${startPost}–${endPost} 篇，共 ${totalPosts} 篇`
          : `Showing ${startPost}–${endPost} of ${totalPosts} posts`}
      </p>

      <div className="flex items-center justify-center gap-1 flex-wrap">
        {/* Previous button */}
        <button
          onClick={() => goToPage(currentPage - 1)}
          disabled={currentPage === 1}
          aria-label={isZh ? '跳转到上一页' : 'Go to previous page'}
          className="px-3 py-2 text-sm font-medium rounded-md border border-gray-300 text-gray-600 hover:bg-gray-100 hover:text-gray-900 transition-colors cursor-pointer disabled:opacity-40 disabled:cursor-not-allowed disabled:hover:bg-transparent"
        >
          <span aria-hidden>&larr;</span> {isZh ? '上一页' : 'Previous'}
        </button>

        {/* Page numbers */}
        <div className="flex items-center gap-1 mx-2">
          {pages.map((page, index) =>
            page === 'ellipsis' ? (
              <EllipsisMenu
                key={`ellipsis-${index}`}
                direction={index < pages.indexOf(currentPage) ? 'backward' : 'forward'}
                currentPage={currentPage}
                totalPages={totalPages}
                onGoToPage={goToPage}
              />
            ) : (
              <button
                key={page}
                onClick={() => goToPage(page)}
                aria-label={isZh ? `跳转到第 ${page} 页` : `Go to page ${page}`}
                aria-current={currentPage === page ? 'page' : undefined}
                className={`min-w-[40px] px-3 py-2 text-sm font-medium rounded-md transition-colors cursor-pointer ${
                  currentPage === page
                    ? 'bg-blue-600 text-white'
                    : 'border border-gray-300 text-gray-600 hover:bg-gray-100 hover:text-gray-900'
                }`}
              >
                {page}
              </button>
            )
          )}
        </div>

        {/* Next button */}
        <button
          onClick={() => goToPage(currentPage + 1)}
          disabled={currentPage === totalPages}
          aria-label={isZh ? '跳转到下一页' : 'Go to next page'}
          className="px-3 py-2 text-sm font-medium rounded-md border border-gray-300 text-gray-600 hover:bg-gray-100 hover:text-gray-900 transition-colors cursor-pointer disabled:opacity-40 disabled:cursor-not-allowed disabled:hover:bg-transparent"
        >
          {isZh ? '下一页' : 'Next'} <span aria-hidden>&rarr;</span>
        </button>
      </div>
    </nav>
  )
}

function EllipsisMenu({
  direction,
  currentPage,
  totalPages,
  onGoToPage,
}: {
  direction: 'forward' | 'backward'
  currentPage: number
  totalPages: number
  onGoToPage: (page: number) => void
}) {
  const { language } = useLanguage()
  const isZh = language === 'zh'

  const targetPage =
    direction === 'forward'
      ? Math.min(currentPage + 5, totalPages)
      : Math.max(currentPage - 5, 1)

  const label = direction === 'forward'
    ? isZh ? '向前跳5页' : 'Jump forward 5 pages'
    : isZh ? '向后跳5页' : 'Jump backward 5 pages'

  return (
    <button
      onClick={() => onGoToPage(targetPage)}
      aria-label={label}
      title={label}
      className="min-w-[40px] px-2 py-2 text-sm font-medium rounded-md border border-gray-300 text-gray-500 hover:bg-gray-100 hover:text-gray-900 transition-colors cursor-pointer"
    >
      &hellip;
    </button>
  )
}
