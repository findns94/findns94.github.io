'use client'

import { useEffect, useState } from 'react'
import Link from 'next/link'
import { useLanguage } from '@/contexts/LanguageContext'
import { getMessages, type Messages } from '@/i18n/messages'
import {
  buildEntityIndex,
  type EntityIndex,
  type EntityItem,
} from '@/lib/shanhaijin-entities'

const DATA_URL = '/shanhaijin/data.json'

type EntityMessages = Messages['shanhaijin']['entities']

interface TypeSummary {
  typeKey: string
  count: number
}

export default function EntitiesOverviewPage() {
  const { language } = useLanguage()
  const zh = language === 'zh'
  const t = getMessages(language)
  const [index, setIndex] = useState<EntityIndex | null>(null)
  const [error, setError] = useState<string | null>(null)

  useEffect(() => {
    fetch(DATA_URL)
      .then((r) => r.json())
      .then((data: { entities: EntityItem[]; taxonomy: Record<string, Record<string, unknown>> }) => {
        setIndex(buildEntityIndex(data.entities, data.taxonomy as never))
      })
      .catch((e: Error) => setError(e.message))
  }, [])

  if (error) {
    return <p className="text-red-600">Failed to load: {error}</p>
  }

  if (!index) {
    return <p className="text-gray-500">Loading…</p>
  }

  const typeMessages = t.shanhaijin.entities.types
  const types: TypeSummary[] = index.typeOrder.map((tk) => ({
    typeKey: tk,
    count: (index.byType[tk] ?? []).length,
  }))

  return (
    <div>
      <header className="mb-8 border-b border-gray-200 pb-6">
        <h1 className="text-3xl font-bold text-gray-900">
          {t.shanhaijin.entities.title}
        </h1>
        <p className="mt-2 text-sm text-gray-500">
          {zh
            ? '《山海经》结构化实体总览 — 异兽、草木、物产、方国、神祇、祭礼等。'
            : 'Structured entity overview of the Shanhaijing — creatures, plants, products, polities, deities, sacrifices, and more.'}
        </p>
      </header>

      <div className="grid grid-cols-2 gap-3 sm:grid-cols-3 lg:grid-cols-4">
        {types.map(({ typeKey, count }) => {
          const slug = typeKey === 'bird_beast' ? 'bird-beast' : typeKey
          const label = typeMessages[typeKey as keyof typeof typeMessages] ?? typeKey
          return (
            <Link
              key={typeKey}
              href={`/shanhaijin/entities/${slug}/`}
              className="block rounded-lg border border-gray-200 bg-white p-4 no-underline transition-colors hover:border-blue-400 hover:shadow-sm"
            >
              <div className="text-sm font-medium text-gray-900">{label}</div>
              <div className="mt-1 text-xs text-gray-500 tabular-nums">
                {count} {t.shanhaijin.entities.count}
              </div>
            </Link>
          )
        })}
      </div>
    </div>
  )
}
