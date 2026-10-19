'use client'

import { useEffect, useState } from 'react'
import { useLanguage } from '@/contexts/LanguageContext'
import { getMessages, type Messages } from '@/i18n/messages'
import {
  buildEntityIndex,
  type EntityIndex,
  type EntityItem,
} from '@/lib/shanhaijin-entities'
import { EntityList } from '@/components/EntityList'

const DATA_URL = '/shanhaijin/data.json'

type EntityMessages = Messages['shanhaijin']['entities']

interface EntityTypeClientProps {
  typeKey: string
}

export function EntityTypeClient({ typeKey }: EntityTypeClientProps) {
  const { language } = useLanguage()
  const zh = language === 'zh'
  const t = getMessages(language).shanhaijin.entities
  const [index, setIndex] = useState<EntityIndex | null>(null)
  const [error, setError] = useState<string | null>(null)

  useEffect(() => {
    fetch(DATA_URL)
      .then((r) => r.json())
      .then(
        (data: {
          entities: EntityItem[]
          taxonomy: Record<string, Record<string, unknown>>
        }) => {
          setIndex(buildEntityIndex(data.entities, data.taxonomy as never))
        },
      )
      .catch((e: Error) => setError(e.message))
  }, [])

  const typeLabel = t.types[typeKey as keyof typeof t.types] ?? typeKey

  if (error) return <p className="text-red-600">{t.loadError(error)}</p>
  if (!index) return <p className="text-gray-500">{t.loading}</p>

  return (
    <div>
      <header className="mb-6 border-b border-gray-200 pb-4">
        <h1 className="text-2xl font-bold text-gray-900">{typeLabel}</h1>
      </header>
      <EntityList typeKey={typeKey} entityIndex={index} zh={zh} t={t} />
    </div>
  )
}
