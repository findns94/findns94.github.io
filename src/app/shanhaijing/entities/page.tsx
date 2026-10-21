'use client'

import Link from 'next/link'
import { useLanguage } from '@/contexts/LanguageContext'
import { getMessages, type Messages } from '@/i18n/messages'
import { ENTITY_TYPE_COUNTS } from '@/lib/shanhaijing-data'

type EntityMessages = Messages['shanhaijing']['entities']

export default function EntitiesOverviewPage() {
  const { language } = useLanguage()
  const zh = language === 'zh'
  const t = getMessages(language)

  const typeMessages = t.shanhaijing.entities.types
  const types = Object.entries(ENTITY_TYPE_COUNTS).map(([typeKey, count]) => ({
    typeKey,
    count,
  }))

  return (
    <div>
      <header className="mb-8 border-b border-gray-200 pb-6">
        <h1 className="text-3xl font-bold text-gray-900">
          {t.shanhaijing.entities.title}
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
              href={`/shanhaijing/entities/${slug}/`}
              className="block rounded-lg border border-gray-200 bg-white p-4 no-underline transition-colors hover:border-blue-400 hover:shadow-sm"
            >
              <div className="text-sm font-medium text-gray-900">{label}</div>
              <div className="mt-1 text-xs text-gray-500 tabular-nums">
                {count} {t.shanhaijing.entities.count}
              </div>
            </Link>
          )
        })}
      </div>
    </div>
  )
}
