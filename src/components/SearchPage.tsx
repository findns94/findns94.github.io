'use client'

/**
 * 山海经 · 搜索结果页组件
 *
 * 数据：`public/shanhaijin/data.json`（客户端 fetch，与 ShanhaijinMap 一致）
 * 搜索逻辑：复用 `src/lib/shanhaijin-map.ts` 的 `buildCtx` + `search`
 * 文案：`src/i18n/messages.ts` 的 `shanhaijin.search`
 *
 * 由 `src/app/shanhaijin/search/page.tsx` 包裹在 Suspense 中，
 * 从 URL `?q=xxx&scope=xxx` 读取初始查询词与 scope，作为 props 传入。
 */

import { useCallback, useEffect, useMemo, useState } from 'react'
import Link from 'next/link'
import { useRouter } from 'next/navigation'
import { useLanguage } from '@/contexts/LanguageContext'
import { getMessages, type Messages } from '@/i18n/messages'
import {
  buildCtx,
  search,
  type MapData,
  type Scope,
  type SearchResult,
} from '@/lib/shanhaijin-map'

/* ── 常量 ─────────────────────────────────────────────────────── */

const DATA_URL = '/shanhaijin/search-data.json'

const SCOPES: Scope[] = ['all', 'mountain', 'creature', 'product']

/** scope → i18n 键映射（search 部分） */
const SCOPE_I18N_KEY: Record<Scope, 'all' | 'mountains' | 'creatures' | 'products'> = {
  all: 'all',
  mountain: 'mountains',
  creature: 'creatures',
  product: 'products',
}

/** 结果类型的 CSS 类名（与 ShanhaijinMap 的 KIND_CLS 一致） */
const KIND_CLS: Record<SearchResult['kind'], string> = {
  mountain: 'si-kind-山',
  creature: 'si-kind-异兽',
  product: 'si-kind-物产',
}

type SearchMessages = Messages['shanhaijin']['search']

/* ── 工具函数 ─────────────────────────────────────────────────── */

function scopeLabel(st: SearchMessages, s: Scope, zh: boolean): string {
  const entry = st[SCOPE_I18N_KEY[s]]
  return zh ? entry.zh : entry.en
}

function kindLabel(st: SearchMessages, k: SearchResult['kind']): string {
  if (k === 'mountain') return st.mountains.zh
  if (k === 'creature') return st.creatures.zh
  return st.products.zh
}

/** 各类结果的跳转链接 */
function resultLink(r: SearchResult): string {
  if (r.kind === 'mountain') return `/shanhaijin/map/#${encodeURIComponent(r.name)}`
  if (r.kind === 'creature') return `/shanhaijin/entities/creature/${encodeURIComponent(r.name)}`
  return `/shanhaijin/entities/mineral/${encodeURIComponent(r.name)}`
}

/* ── 组件 ─────────────────────────────────────────────────────── */

export interface SearchPageProps {
  initialQuery: string
  initialScope: Scope
}

export function SearchPage({ initialQuery, initialScope }: SearchPageProps) {
  const { language } = useLanguage()
  const zh = language === 'zh'
  const t = getMessages(language)
  const st = t.shanhaijin.search
  const router = useRouter()

  const [data, setData] = useState<MapData | null>(null)
  const [query, setQuery] = useState(initialQuery)
  const [scope, setScope] = useState<Scope>(initialScope)

  /* 数据加载：静态导出无 API 路由，必须客户端 fetch */
  useEffect(() => {
    let alive = true
    fetch(DATA_URL)
      .then((r) => r.json() as Promise<MapData>)
      .then((d) => {
        if (alive) setData(d)
      })
      .catch(() => {
        // 静默失败：搜索结果页降级为空状态
      })
    return () => {
      alive = false
    }
  }, [])

  const ctx = useMemo(() => (data ? buildCtx(data) : null), [data])

  const results = useMemo(() => {
    if (!ctx || !query.trim()) return []
    return search(query, scope, ctx)
  }, [ctx, query, scope])

  /* 按 kind 分组 */
  const grouped = useMemo(() => {
    const g: Record<SearchResult['kind'], SearchResult[]> = { mountain: [], creature: [], product: [] }
    for (const r of results) g[r.kind].push(r)
    return g
  }, [results])

  const hasQuery = query.trim().length > 0
  const totalResults = results.length

  const updateScope = useCallback(
    (newScope: Scope) => {
      setScope(newScope)
      const params = new URLSearchParams({ q: query, scope: newScope })
      router.replace(`/shanhaijin/search/?${params.toString()}`)
    },
    [query, router],
  )

  const handleQueryChange = useCallback((value: string) => {
    setQuery(value)
  }, [])

  const viewAllHref = useMemo(() => {
    const params = new URLSearchParams({ q: query, scope })
    return `/shanhaijin/search/?${params.toString()}`
  }, [query, scope])

  /* ── 加载态 ─────────────────────────────────────────── */

  if (!ctx) {
    return (
      <div className="max-w-3xl mx-auto px-4 py-16 text-center text-gray-500">
        {zh ? '加载中…' : 'Loading…'}
      </div>
    )
  }

  /* ── 渲染 ───────────────────────────────────────────── */

  return (
    <div className="max-w-3xl mx-auto px-4 py-8">
      <h1 className="text-2xl font-bold text-gray-900 mb-6">
        {zh ? st.title.zh : st.title.en}
      </h1>

      {/* 搜索输入 + scope 按钮 */}
      <div className="flex flex-col sm:flex-row gap-3 mb-2">
        <input
          type="text"
          value={query}
          onChange={(e) => handleQueryChange(e.target.value)}
          placeholder={zh ? st.placeholder.zh : st.placeholder.en}
          autoComplete="off"
          className="flex-1 border border-gray-300 rounded px-4 py-2 text-gray-900 placeholder-gray-400 focus:outline-none focus:border-blue-500"
        />
        <div className="flex gap-1">
          {SCOPES.map((s) => (
            <button
              key={s}
              type="button"
              className={`px-3 py-2 rounded text-sm border transition-colors ${
                scope === s
                  ? 'bg-blue-600 text-white border-blue-600'
                  : 'bg-white text-gray-600 border-gray-300 hover:border-blue-400'
              }`}
              onClick={() => updateScope(s)}
            >
              {scopeLabel(st, s, zh)}
            </button>
          ))}
        </div>
      </div>

      {/* 结果统计 */}
      {hasQuery && (
        <p className="text-sm text-gray-500 mb-6">
          {totalResults}{' '}
          {zh ? st.results.zh : st.results.en}
        </p>
      )}

      {/* 空状态 */}
      {!hasQuery && (
        <div className="text-center py-16 text-gray-400">
          {zh ? st.noQuery.zh : st.noQuery.en}
        </div>
      )}
      {hasQuery && totalResults === 0 && (
        <div className="text-center py-16 text-gray-400">
          {zh ? st.noResults.zh : st.noResults.en}
        </div>
      )}

      {/* 分组结果 */}
      {hasQuery && totalResults > 0 && (
        <div className="space-y-8">
          {(['mountain', 'creature', 'product'] as const).map((kind) => {
            const items = grouped[kind]
            if (items.length === 0) return null
            return (
              <section key={kind}>
                <h2 className="text-lg font-semibold text-gray-800 mb-3 flex items-center gap-2">
                  <span className={`si-kind ${KIND_CLS[kind]}`}>
                    {kindLabel(st, kind)}
                  </span>
                  <span className="text-sm font-normal text-gray-400">
                    {items.length}
                  </span>
                </h2>
                <ul className="space-y-1">
                  {items.map((r) => (
                    <li key={r.kind + '|' + r.name + '|' + r.idx}>
                      <Link
                        href={resultLink(r)}
                        className="flex items-baseline gap-3 px-3 py-2 rounded border border-gray-200 hover:border-blue-400 hover:text-blue-600 transition-colors no-underline text-gray-700"
                      >
                        <span className={`si-kind ${KIND_CLS[kind]}`}>
                          {kindLabel(st, kind)}
                        </span>
                        <span className="font-medium">{r.name}</span>
                        {r.hint && (
                          <span className="text-sm text-gray-400 truncate">{r.hint}</span>
                        )}
                      </Link>
                    </li>
                  ))}
                </ul>
              </section>
            )
          })}
        </div>
      )}

      {/* 查看全部结果 */}
      {hasQuery && totalResults > 0 && (
        <div className="mt-8 pt-4 border-t border-gray-200">
          <Link
            href={viewAllHref}
            className="text-sm text-blue-600 hover:underline no-underline"
          >
            {zh ? st.viewAll.zh : st.viewAll.en} →
          </Link>
        </div>
      )}
    </div>
  )
}
