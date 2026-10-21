'use client'

import { useState, useEffect } from 'react'
import Link from 'next/link'
import { useLanguage } from '@/contexts/LanguageContext'
import { getMessages } from '@/i18n/messages'
import { TRANSLATIONS } from '@/lib/shanhaijing-translations'
import { CHAPTERS } from '@/lib/shanhaijing-data'
import { AnnotatedText } from '@/components/EntityAnnotator'

/** 实体典名条目（来自 /shanhaijing/entity-names.json） */
interface EntityNameEntry {
  canonical: string
  typeKey: string
  display: string
}

/** 把经文纯文本转成段落（`## 分节标题` 作为小节标题） */
function toBlocks(text: string) {
  return text
    .split('\n')
    .map((line) => line.trimEnd())
    .filter((line) => line.length > 0)
    .map((line, i) =>
      line.startsWith('## ')
        ? { type: 'heading' as const, text: line.slice(3), key: `h${i}` }
        : { type: 'para' as const, text: line, key: `p${i}` },
    )
}

interface Props {
  num: string
  name: string
  text: string
}

export function ChapterReader({ num, name, text }: Props) {
  const { language } = useLanguage()
  const zh = language === 'zh'
  const t = getMessages(language).shanhaijing.reader

  const [mode, setMode] = useState<'single' | 'sideBySide'>('sideBySide')
  const [entityNames, setEntityNames] = useState<EntityNameEntry[]>([])

  useEffect(() => {
    fetch('/shanhaijing/entity-names.json')
      .then((r) => (r.ok ? r.json() : []))
      .then((data) => {
        if (Array.isArray(data)) setEntityNames(data)
      })
      .catch(() => {})
  }, [])

  const blocks = toBlocks(text)
  const chars = text.replace(/\s/g, '').length
  const translations = TRANSLATIONS[num] || []

  return (
    <article>
      <nav className="mb-6 text-sm">
        <Link href="/shanhaijing" className="text-blue-600 hover:underline">
          ← {zh ? '山海经' : 'Shanhaijing'}
        </Link>
      </nav>

      <header className="mb-8 border-b border-gray-200 pb-6">
        <p className="text-sm text-gray-500 mb-2 tabular-nums">{num}</p>
        <h1 className="text-3xl font-bold text-gray-900 mb-2">{name}</h1>
        <p className="text-sm text-gray-500">
          {zh ? '经文 ' : ''}
          {chars.toLocaleString()} {zh ? '字' : 'characters'}
        </p>
      </header>

      {/* Mode toggle */}
      <div className="flex items-center gap-2 mb-6">
        <button
          onClick={() => setMode('sideBySide')}
          className={`px-3 py-1.5 text-sm rounded-md border transition-colors ${
            mode === 'sideBySide'
              ? 'bg-blue-600 text-white border-blue-600'
              : 'bg-white text-gray-700 border-gray-300 hover:bg-gray-50'
          }`}
        >
          {t.sideBySide[language]}
        </button>
        <button
          onClick={() => setMode('single')}
          className={`px-3 py-1.5 text-sm rounded-md border transition-colors ${
            mode === 'single'
              ? 'bg-blue-600 text-white border-blue-600'
              : 'bg-white text-gray-700 border-gray-300 hover:bg-gray-50'
          }`}
        >
          {t.single[language]}
        </button>
      </div>

      {mode === 'sideBySide' ? (
        <div className="grid grid-cols-1 lg:grid-cols-2 gap-8">
          {/* Original text */}
          <div>
            <h2 className="text-sm font-medium text-gray-500 uppercase tracking-wide mb-4">
              {t.original[language]}
            </h2>
            <div className="leading-loose text-gray-800">
              {blocks.map((b) =>
                b.type === 'heading' ? (
                  <h2 key={b.key} className="text-xl font-semibold text-gray-900 mt-10 mb-4">
                    {b.text}
                  </h2>
                ) : (
                  <p key={b.key} className="mb-4">
                    <AnnotatedText text={b.text} entityNames={entityNames} />
                  </p>
                ),
              )}
            </div>
          </div>

          {/* Translation */}
          <div>
            <h2 className="text-sm font-medium text-gray-500 uppercase tracking-wide mb-4">
              {t.translation[language]}
            </h2>
            <div className="leading-loose text-gray-600">
              {translations.length > 0 ? (
                translations.map((b, i) =>
                  b.type === 'heading' ? (
                    <h2 key={`th${i}`} className="text-xl font-semibold text-gray-700 mt-10 mb-4">
                      {zh ? b.zh : b.en}
                    </h2>
                  ) : (
                    <p key={`tp${i}`} className="mb-4">
                      {zh ? b.zh : b.en}
                    </p>
                  ),
                )
              ) : (
                <p className="text-gray-400 italic">
                  {zh ? '此章翻译尚未完成。' : 'Translation not yet available for this chapter.'}
                </p>
              )}
            </div>
          </div>
        </div>
      ) : (
        <div className="max-w-3xl leading-loose text-gray-800">
          {blocks.map((b) =>
            b.type === 'heading' ? (
              <h2 key={b.key} className="text-xl font-semibold text-gray-900 mt-10 mb-4">
                {b.text}
              </h2>
            ) : (
              <p key={b.key} className="mb-4">
                <AnnotatedText text={b.text} entityNames={entityNames} />
              </p>
            ),
          )}
        </div>
      )}

      <footer className="mt-12 border-t border-gray-200 pt-6 text-sm text-gray-500">
        <p>
          {zh
            ? '底本：维基文库《山海經》（公有领域，郭璞注本）'
            : 'Source: Wikisource 山海經 (public domain, Guo Pu annotated edition)'}
        </p>

        {/* 章节导航：上一章 / 下一章 */}
        {(() => {
          const idx = CHAPTERS.findIndex((c) => c.num === num)
          if (idx === -1) return null
          const prev = idx > 0 ? CHAPTERS[idx - 1] : null
          const next = idx < CHAPTERS.length - 1 ? CHAPTERS[idx + 1] : null
          return (
            <nav className="mt-6 flex justify-between gap-4 border-t border-gray-100 pt-4">
              {prev ? (
                <Link
                  href={`/shanhaijing/chapters/${prev.num}`}
                  className="text-blue-600 hover:underline"
                >
                  ← {zh ? `上一章：${prev.name}` : `Prev: ${prev.name}`}
                </Link>
              ) : <span />}
              {next ? (
                <Link
                  href={`/shanhaijing/chapters/${next.num}`}
                  className="text-blue-600 hover:underline"
                >
                  {zh ? `下一章：${next.name}` : `Next: ${next.name}`} →
                </Link>
              ) : <span />}
            </nav>
          )
        })()}

        <p className="mt-4">
          <Link href="/shanhaijing" className="text-blue-600 hover:underline">
            ← {zh ? '返回山海经' : 'Back to Shanhaijing'}
          </Link>
        </p>
      </footer>
    </article>
  )
}
