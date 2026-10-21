'use client'

import { Suspense } from 'react'
import { useSearchParams } from 'next/navigation'
import type { Scope } from '@/lib/shanhaijing-map'
import { SearchPage } from '@/components/SearchPage'

function SearchPageInner() {
  const searchParams = useSearchParams()
  const q = searchParams.get('q') ?? ''
  const scopeParam = searchParams.get('scope')
  const scope: Scope =
    scopeParam === 'mountain' || scopeParam === 'creature' || scopeParam === 'product'
      ? scopeParam
      : 'all'
  return <SearchPage initialQuery={q} initialScope={scope} />
}

export default function Page() {
  return (
    <Suspense
      fallback={
        <div className="max-w-3xl mx-auto px-4 py-16 text-center text-gray-500">
          Loading…
        </div>
      }
    >
      <SearchPageInner />
    </Suspense>
  )
}
