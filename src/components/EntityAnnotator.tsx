'use client'

import Link from 'next/link'
import { useState, type ReactNode } from 'react'
import { useLanguage } from '@/contexts/LanguageContext'
import { annotateText, type AnnotatedSegment } from '@/lib/shanhaijing-annotator'

/** typeKey → URL slug 映射（与 EntityDetail 保持一致） */
function typeKeyToSlug(typeKey: string): string {
  return typeKey === 'bird_beast' ? 'bird-beast' : typeKey
}

/** typeKey → 可读标签（用于 tooltip 展示） */
const TYPE_LABELS: Record<string, string> = {
  mountain: '山',
  water: '水',
  creature: '兽',
  bird_beast: '鸟兽',
  plant: '草',
  product: '产',
  direction: '方',
  distance: '里',
  sacrifice: '祭',
  other: '他',
}

interface EntityName {
  canonical: string
  typeKey: string
  display: string
}

/* ── EntityLink：实体名跳转链接 + hover tooltip ─────────────────────── */

interface EntityLinkProps {
  canonical: string
  typeKey: string
  display: string
  zh: boolean
  children: ReactNode
}

export function EntityLink({ canonical, typeKey, display, zh, children }: EntityLinkProps) {
  const [hover, setHover] = useState(false)
  const slug = typeKeyToSlug(typeKey)
  const typeLabel = TYPE_LABELS[typeKey] ?? typeKey
  const entityUrl = `/shanhaijing/entities/${slug}/${canonical}/`

  return (
    <span className="relative inline-block">
      <Link
        href={entityUrl}
        className="text-blue-700 underline decoration-blue-300 decoration-dotted underline-offset-2 hover:text-blue-900 hover:decoration-solid no-underline"
        onMouseEnter={() => setHover(true)}
        onMouseLeave={() => setHover(false)}
        onFocus={() => setHover(true)}
        onBlur={() => setHover(false)}
      >
        {children}
      </Link>
      {hover && (
        <span
          role="tooltip"
          className="pointer-events-none absolute bottom-full left-1/2 z-50 mb-1.5 -translate-x-1/2 whitespace-nowrap rounded-md bg-gray-900 px-2.5 py-1.5 text-xs text-white shadow-lg"
        >
          <span className="font-medium">{zh ? display : canonical}</span>
          <span className="ml-1.5 text-gray-400">{typeLabel}</span>
          <span className="absolute top-full left-1/2 -translate-x-1/2 border-4 border-transparent border-t-gray-900" />
        </span>
      )}
    </span>
  )
}

/* ── AnnotatedText：把 annotateText 的片段数组渲染为富文本 ─────────────── */

interface AnnotatedTextProps {
  text: string
  entityNames: EntityName[]
}

export function AnnotatedText({ text, entityNames }: AnnotatedTextProps) {
  const { language } = useLanguage()
  const zh = language === 'zh'

  const segments: AnnotatedSegment[] = annotateText(text, entityNames)

  return (
    <>
      {segments.map((seg, i) =>
        seg.entity ? (
          <EntityLink
            key={i}
            canonical={seg.entity.canonical}
            typeKey={seg.entity.typeKey}
            display={seg.entity.display}
            zh={zh}
          >
            {zh ? seg.entity.display : seg.entity.canonical}
          </EntityLink>
        ) : (
          <span key={i}>{seg.text}</span>
        ),
      )}
    </>
  )
}
