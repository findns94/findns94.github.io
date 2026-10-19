'use client'

import { useEffect, useState } from 'react'
import { useLanguage } from '@/contexts/LanguageContext'
import { getMessages, type Messages } from '@/i18n/messages'
import {
  buildEntityIndex,
  getEntityBySlug,
  getEntityRelations,
  getMountainProducts,
  type EntityIndex,
  type EntityItem,
  type EntityRelations,
} from '@/lib/shanhaijin-entities'
import { EntityDetail } from '@/components/EntityDetail'
import type { Sighting, Product } from '@/lib/shanhaijin-map'

type EntityMessages = Messages['shanhaijin']['entities']

interface EntityDetailClientProps {
  typeKey: string
  rawName: string
}

export function EntityDetailClient({ typeKey, rawName }: EntityDetailClientProps) {
  const { language } = useLanguage()
  const zh = language === 'zh'
  const t = getMessages(language).shanhaijin.entities
  const [index, setIndex] = useState<EntityIndex | null>(null)
  const [relations, setRelations] = useState<EntityRelations | null>(null)
  const [products, setProducts] = useState<Product[]>([])
  const [error, setError] = useState<string | null>(null)

  useEffect(() => {
    fetch('/shanhaijin/entity-data.json')
      .then((r) => r.json())
      .then(
        (data: {
          entities: EntityItem[]
          taxonomy: Record<string, Record<string, unknown>>
          sightings: Record<string, Sighting[]>
          products: Record<string, Product[]>
          spatialRelations: Record<string, Record<string, unknown>[]>
          biologyRelations: Record<string, Record<string, unknown>[]>
        }) => {
          const idx = buildEntityIndex(data.entities, data.taxonomy as never)
          setIndex(idx)

          const entity = getEntityBySlug(rawName, idx)
          if (entity) {
            const rels = getEntityRelations(
              entity.canonical,
              data.sightings,
              data.products,
              data.spatialRelations,
              data.biologyRelations,
            )
            setRelations(rels)
            setProducts(getMountainProducts(entity.pn, data.products))
          }
        },
      )
      .catch((e: Error) => setError(e.message))
  }, [rawName])

  const entity = index ? getEntityBySlug(rawName, index) : undefined
  const typeLabel = t.types[typeKey as keyof typeof t.types] ?? typeKey
  const typeSlug = typeKey === 'bird_beast' ? 'bird-beast' : typeKey

  if (error) return <p className="text-red-600">{t.loadError(error)}</p>
  if (!index) return <p className="text-gray-500">{t.loading}</p>

  if (!entity) {
    return (
      <div>
        <p className="text-gray-600">Entity not found: {rawName}</p>
        <a
          href={`/shanhaijin/entities/${typeSlug}/`}
          className="text-blue-600 hover:underline"
        >
          &larr; {t.backToList}
        </a>
      </div>
    )
  }

  return (
    <EntityDetail
      canonical={entity.canonical}
      display={entity.display}
      symbol={entity.symbol}
      typeKey={typeKey}
      typeLabel={typeLabel}
      zh={zh}
      t={t}
      taxonomy={entity.taxonomy}
      relations={
        relations ?? { mountains: [], produces: [], inhabitedBy: [], related: [], passages: [] }
      }
      products={products}
      pn={entity.pn}
      chapter={entity.chapter}
    />
  )
}
