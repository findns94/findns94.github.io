'use client'

import Link from 'next/link'
import { useLanguage } from '@/contexts/LanguageContext'
import { getMessages, type Messages } from '@/i18n/messages'
import { type Product } from '@/lib/shanhaijin-map'
import {
  type EntityRelations,
  type TaxonomyEntry,
} from '@/lib/shanhaijin-entities'

type EntityMessages = Messages['shanhaijin']['entities']

interface EntityDetailProps {
  canonical: string
  display: string
  symbol: string
  typeKey: string
  typeLabel: string
  zh: boolean
  t: EntityMessages
  taxonomy?: TaxonomyEntry
  relations: EntityRelations
  products: Product[]
  pn: string | null
  chapter: string | null
}

/** 标注符号 → CSS class 映射 */
const MARK_CLASS_MAP: Record<string, string> = {
  '=': 'mark-mountain',
  '•': 'mark-product',
  '+': 'mark-creature',
  '~': 'mark-water',
  '*': 'mark-plant',
  '!': 'mark-direction',
  $: 'mark-distance',
  '^': 'mark-sacrifice',
}

/** 把 〖X〗 标记渲染为带高亮的内容（自动去除标注符号并按类型着色） */
function renderMarked(text: string): string {
  // 将〖X〗替换为带样式的 span（纯字符串，由调用方用 dangerouslySetInnerHTML 渲染）
  // 捕获标注符号和文本内容，用符号对应的 CSS class 渲染
  return text.replace(/〖([=~$+*^!•])(.+?)〗/g, (_match, symbol: string, content: string) => {
    const cls = MARK_CLASS_MAP[symbol] ?? 'mark-default'
    return `<mark class="${cls} rounded px-0.5">${content}</mark>`
  })
}

export function EntityDetail({
  canonical,
  display,
  symbol,
  typeKey,
  typeLabel,
  zh,
  t,
  taxonomy,
  relations,
  products,
  pn,
  chapter,
}: EntityDetailProps) {
  const typeSlug = typeKey === 'bird_beast' ? 'bird-beast' : typeKey
  const entityUrl = `/shanhaijin/entities/${typeSlug}/${encodeURIComponent(canonical)}/`
  const typeUrl = `/shanhaijin/entities/${typeSlug}/`

  return (
    <div className="space-y-8">
      <style>{`
        .mark-mountain { background-color: #d1fae5; color: #065f46; }
        .mark-product { background-color: #ede9fe; color: #5b21b6; }
        .mark-creature { background-color: #ffedd5; color: #9a3412; }
        .mark-water { background-color: #dbeafe; color: #1e40af; }
        .mark-plant { background-color: #dcfce7; color: #166534; }
        .mark-direction { background-color: #f3f4f6; color: #374151; }
        .mark-distance { background-color: #f3f4f6; color: #374151; }
        .mark-sacrifice { background-color: #fee2e2; color: #991b1b; }
        .mark-default { background-color: #fef9c3; color: #854d0e; }
      `}</style>
      {/* Header */}
      <header className="border-b border-gray-200 pb-6">
        {/* Breadcrumb */}
        <nav className="mb-4 text-xs text-gray-500" aria-label="Breadcrumb">
          <ol className="flex flex-wrap items-center gap-1">
            <li>
              <Link href="/" className="hover:text-blue-600 hover:underline">
                {zh ? '首页' : 'Home'}
              </Link>
            </li>
            <li aria-hidden="true">/</li>
            <li>
              <Link href="/shanhaijin/entities/" className="hover:text-blue-600 hover:underline">
                {t.title}
              </Link>
            </li>
            <li aria-hidden="true">/</li>
            <li>
              <Link href={typeUrl} className="hover:text-blue-600 hover:underline">
                {typeLabel}
              </Link>
            </li>
            <li aria-hidden="true">/</li>
            <li className="text-gray-900">{zh ? display : canonical}</li>
          </ol>
        </nav>

        <div className="flex items-start gap-4">
          <span className="inline-flex h-12 w-12 shrink-0 items-center justify-center rounded-full bg-gray-100 font-mono text-lg text-gray-700">
            {symbol}
          </span>
          <div>
            <h1 className="text-2xl font-bold text-gray-900 sm:text-3xl">
              {zh ? display : canonical}
            </h1>
            {zh && display !== canonical && (
              <p className="mt-1 text-sm text-gray-500">{canonical}</p>
            )}
            <div className="mt-2 flex flex-wrap items-center gap-2 text-xs">
              <span className="rounded-full bg-blue-50 px-2.5 py-1 text-blue-700">{typeLabel}</span>
              {taxonomy && (
                <>
                  <span className="rounded-full bg-purple-50 px-2.5 py-1 text-purple-700">
                    {taxonomy.subclass}
                  </span>
                  <span className="rounded-full bg-gray-100 px-2.5 py-1 text-gray-600">
                    {t.level} {taxonomy.level}
                  </span>
                  <span className="rounded-full bg-gray-100 px-2.5 py-1 text-gray-600">
                    {t.confidence} {taxonomy.confidence.toFixed(2)}
                  </span>
                </>
              )}
              {chapter && (
                <span className="rounded-full bg-gray-100 px-2.5 py-1 text-gray-600 tabular-nums">
                  {chapter}
                </span>
              )}
            </div>
          </div>
        </div>
      </header>

      {/* Mountains where it appears */}
      {relations.mountains.length > 0 && (
        <section>
          <h2 className="mb-3 text-lg font-semibold text-gray-900">{t.mountains}</h2>
          <ul className="grid grid-cols-1 gap-2 sm:grid-cols-2">
            {relations.mountains.map((m) => (
              <li key={m}>
                <Link
                  href={`/shanhaijin/map/#${encodeURIComponent(m)}`}
                  className="block rounded-lg border border-gray-200 px-4 py-2.5 text-sm text-gray-700 transition-colors hover:border-blue-400 hover:text-blue-600 no-underline"
                >
                  <span className="mr-2 font-mono text-xs text-gray-400">=</span>
                  {m}
                </Link>
              </li>
            ))}
          </ul>
        </section>
      )}

      {/* For mountains: produces + inhabitedBy */}
      {products.length > 0 && (
        <section>
          <h2 className="mb-3 text-lg font-semibold text-gray-900">{t.produces}</h2>
          <ul className="grid grid-cols-1 gap-2 sm:grid-cols-2">
            {products.map((p, i) => (
              <li
                key={`${p.name}-${i}`}
                className="rounded-lg border border-gray-200 px-4 py-2.5 text-sm text-gray-700"
              >
                <span className="mr-2 font-mono text-xs text-gray-400">•</span>
                {p.name}
                {p.side && <span className="ml-2 text-xs text-gray-500">{p.side}</span>}
                {p.count > 1 && (
                  <span className="ml-2 text-xs text-gray-400 tabular-nums">×{p.count}</span>
                )}
              </li>
            ))}
          </ul>
        </section>
      )}

      {relations.inhabitedBy.length > 0 && (
        <section>
          <h2 className="mb-3 text-lg font-semibold text-gray-900">{t.inhabitedBy}</h2>
          <ul className="grid grid-cols-1 gap-2 sm:grid-cols-2">
            {relations.inhabitedBy.map((name) => (
              <li key={name}>
                <Link
                  href={`/shanhaijin/entities/${typeSlug}/${encodeURIComponent(name)}/`}
                  className="block rounded-lg border border-gray-200 px-4 py-2.5 text-sm text-gray-700 transition-colors hover:border-blue-400 hover:text-blue-600 no-underline"
                >
                  <span className="mr-2 font-mono text-xs text-gray-400">+</span>
                  {name}
                </Link>
              </li>
            ))}
          </ul>
        </section>
      )}

      {/* Relations */}
      {relations.related.length > 0 && (
        <section>
          <h2 className="mb-3 text-lg font-semibold text-gray-900">{t.relations}</h2>
          <ul className="space-y-2">
            {relations.related.slice(0, 20).map((r, i) => (
              <li
                key={`${r.relation}-${r.name}-${i}`}
                className="flex items-start gap-3 rounded-lg border border-gray-200 px-4 py-2.5 text-sm"
              >
                <span className="shrink-0 rounded bg-gray-100 px-2 py-0.5 font-mono text-xs text-gray-600">
                  {r.relation}
                </span>
                <span className="text-gray-700">{r.name}</span>
                {r.direction && (
                  <span className="ml-auto shrink-0 text-xs text-gray-400">{r.direction}</span>
                )}
              </li>
            ))}
          </ul>
        </section>
      )}

      {/* Original passages */}
      {relations.passages.length > 0 ? (
        <section>
          <h2 className="mb-3 text-lg font-semibold text-gray-900">{t.originalText}</h2>
          <ul className="space-y-3">
            {relations.passages.map((p, i) => (
              <li
                key={i}
                className="rounded-lg border border-gray-200 bg-gray-50 px-4 py-3 text-sm leading-relaxed text-gray-700"
                dangerouslySetInnerHTML={{ __html: renderMarked(p) }}
              />
            ))}
          </ul>
        </section>
      ) : (
        <section>
          <h2 className="mb-3 text-lg font-semibold text-gray-900">{t.originalText}</h2>
          <p className="rounded-lg border border-gray-200 bg-gray-50 px-4 py-3 text-sm text-gray-500">
            {zh ? '无原文记录' : 'No original text recorded'}
          </p>
        </section>
      )}

      {/* Back link */}
      <div className="border-t border-gray-200 pt-6">
        <Link
          href={typeUrl}
          className="text-sm text-blue-600 hover:underline"
        >
          ← {t.backToList}
        </Link>
      </div>
    </div>
  )
}
