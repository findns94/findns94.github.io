'use client'

import { useState, useMemo } from 'react'
import Link from 'next/link'
import { useLanguage } from '@/contexts/LanguageContext'
import { getMessages, type Messages } from '@/i18n/messages'
import { searchEntities, type EntityIndex, type EntityItem } from '@/lib/shanhaijing-entities'

type EntityMessages = Messages['shanhaijing']['entities']

const PAGE_SIZE = 20

interface EntityListProps {
  typeKey: string
  entityIndex: EntityIndex
  zh: boolean
  t: EntityMessages
}

function EntityCard({
  entity,
  typeKey,
  zh,
  taxonomy,
}: {
  entity: EntityItem
  typeKey: string
  zh: boolean
  taxonomy?: { subclass: string; level: string; confidence: number }
}) {
  const { language } = useLanguage()
  const msgs = getMessages(language)
  const typeLabel = msgs.shanhaijing.entities.types[typeKey as keyof typeof msgs.shanhaijing.entities.types] ?? typeKey

  return (
    <Link
      href={`/shanhaijing/entities/${typeKey === 'bird_beast' ? 'bird-beast' : typeKey}/${encodeURIComponent(entity.canonical)}/`}
      className="group block rounded-lg border border-gray-200 bg-white p-4 no-underline transition-colors hover:border-blue-400 hover:shadow-sm"
    >
      <div className="flex items-start gap-3">
        <span className="inline-flex h-8 w-8 shrink-0 items-center justify-center rounded-full bg-gray-100 font-mono text-sm text-gray-600">
          {entity.symbol}
        </span>
        <div className="min-w-0 flex-1">
          <h3 className="truncate font-medium text-gray-900 group-hover:text-blue-600">
            {zh ? entity.display : entity.canonical}
          </h3>
          {zh && entity.display !== entity.canonical && (
            <p className="truncate text-xs text-gray-400">{entity.canonical}</p>
          )}
          <div className="mt-1 flex flex-wrap items-center gap-2 text-xs text-gray-500">
            <span className="rounded bg-gray-100 px-1.5 py-0.5">{typeLabel}</span>
            {taxonomy?.subclass && (
              <span className="rounded bg-blue-50 px-1.5 py-0.5 text-blue-700">{taxonomy.subclass}</span>
            )}
            {entity.chapter && (
              <span className="tabular-nums text-gray-400">{entity.chapter}</span>
            )}
          </div>
        </div>
      </div>
    </Link>
  )
}

export function EntityList({ typeKey, entityIndex, zh, t }: EntityListProps) {
  const [query, setQuery] = useState('')
  const [page, setPage] = useState(1)

  const allEntities = useMemo(() => {
    const list = entityIndex.byType[typeKey] ?? []
    if (!query.trim()) return list
    return searchEntities(query, entityIndex, 200).filter((e) => e.typeKey === typeKey)
  }, [typeKey, query, entityIndex])

  const totalPages = Math.ceil(allEntities.length / PAGE_SIZE)
  const paged = allEntities.slice((page - 1) * PAGE_SIZE, page * PAGE_SIZE)

  const typeLabel = t.types[typeKey as keyof typeof t.types] ?? typeKey

  return (
    <div>
      {/* Search / filter bar */}
      <div className="mb-6 flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between">
        <div className="flex items-center gap-3">
          <h2 className="text-lg font-semibold text-gray-900">{typeLabel}</h2>
          <span className="rounded-full bg-gray-100 px-2.5 py-0.5 text-xs text-gray-600 tabular-nums">
            {allEntities.length} {t.count}
          </span>
        </div>
        <input
          type="search"
          value={query}
          onChange={(e) => {
            setQuery(e.target.value)
            setPage(1)
          }}
          placeholder={t.searchPlaceholder}
          className="w-full rounded-lg border border-gray-300 px-3 py-2 text-sm focus:border-blue-500 focus:outline-none focus:ring-1 focus:ring-blue-500 sm:w-64"
        />
      </div>

      {/* Card grid */}
      {paged.length === 0 ? (
        <p className="py-12 text-center text-sm text-gray-500">{t.noMatch}</p>
      ) : (
        <div className="grid grid-cols-1 gap-3 sm:grid-cols-2 lg:grid-cols-3">
          {paged.map((e) => (
            <EntityCard
              key={e.canonical + (e.pn ?? '')}
              entity={e}
              typeKey={typeKey}
              zh={zh}
              taxonomy={entityIndex.byName.get(e.canonical)?.taxonomy}
            />
          ))}
        </div>
      )}

      {/* Pagination */}
      {totalPages > 1 && (
        <div className="mt-6 flex items-center justify-center gap-2 text-sm">
          <button
            onClick={() => setPage((p) => Math.max(1, p - 1))}
            disabled={page <= 1}
            className="rounded border border-gray-300 px-3 py-1.5 text-gray-700 transition-colors hover:bg-gray-50 disabled:cursor-not-allowed disabled:opacity-40"
          >
            ←
          </button>
          <span className="text-gray-600 tabular-nums">
            {page} / {totalPages}
          </span>
          <button
            onClick={() => setPage((p) => Math.min(totalPages, p + 1))}
            disabled={page >= totalPages}
            className="rounded border border-gray-300 px-3 py-1.5 text-gray-700 transition-colors hover:bg-gray-50 disabled:cursor-not-allowed disabled:opacity-40"
          >
            →
          </button>
        </div>
      )}
    </div>
  )
}
