'use client'

import Link from 'next/link'
import { useLanguage } from '@/contexts/LanguageContext'

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

  const blocks = toBlocks(text)
  const chars = text.replace(/\s/g, '').length

  return (
    <article>
      <nav className="mb-6 text-sm">
        <Link href="/shanhaijin" className="text-blue-600 hover:underline">
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

      <div className="max-w-3xl leading-loose text-gray-800">
        {blocks.map((b) =>
          b.type === 'heading' ? (
            <h2 key={b.key} className="text-xl font-semibold text-gray-900 mt-10 mb-4">
              {b.text}
            </h2>
          ) : (
            <p key={b.key} className="mb-4">
              {b.text}
            </p>
          ),
        )}
      </div>

      <footer className="mt-12 border-t border-gray-200 pt-6 text-sm text-gray-500">
        <p>
          {zh
            ? '底本：维基文库《山海經》（公有领域，郭璞注本）'
            : 'Source: Wikisource 山海經 (public domain, Guo Pu annotated edition)'}
        </p>
        <p className="mt-2">
          <Link href="/shanhaijin" className="text-blue-600 hover:underline">
            ← {zh ? '返回山海经' : 'Back to Shanhaijing'}
          </Link>
        </p>
      </footer>
    </article>
  )
}
