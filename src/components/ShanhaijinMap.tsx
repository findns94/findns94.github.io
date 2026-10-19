'use client'

/**
 * 山海经 · 山形聚焦视图（React 版）
 *
 * 移植来源：`doc/shanhaijin/app/shanhai/focus.js`（vanilla-JS 独立页，394 行）
 * DOM 蓝本：`doc/shanhaijin/app/shanhai/index.html`
 * 纯逻辑：`src/lib/shanhaijin-map.ts`（邻居 / 原文 / 搜索 / 索引构建，一律 import，不重写）
 * 样式：`src/app/shanhaijin/map/shanhaijin-map.css`（作用域根 `.sh-map`，类名全部复用）
 * 文案：`src/i18n/messages.ts` 的 `shanhaijin.map`
 *
 * 数据：`public/shanhaijin/map-data.json`（由 scripts/build-shanhaijin-data.mjs 生成，
 * 内含构建期预计算的搜索索引 `ctx`，运行时直接反序列化；缺失时回退 buildCtx）。
 * 静态导出（output: 'export'）没有 API 路由，因此必须在客户端 fetch。
 *
 * 与 focus.js 的行为差异见文件末尾「与 focus.js 的行为差异」。
 */

import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import Link from 'next/link'
import { useLanguage } from '@/contexts/LanguageContext'
import { getMessages, type Messages } from '@/i18n/messages'
import {
  buildCtx,
  findText,
  neighbors,
  normalizeChainName,
  search,
  type Confidence,
  type MapData,
  type Product,
  type Scope,
  type SearchCtx,
  type SearchResult,
  type Station,
} from '@/lib/shanhaijin-map'

/* ── 常量 ─────────────────────────────────────────────────────── */

/** 数据文件（public/shanhaijin/data.json；trailingSlash 下路径不变） */
const DATA_URL = '/shanhaijin/map-data.json'

/** 搜索结果上限（与 focus.js 一致；lib 的 search() 内部也会截到 30 条） */
const SEARCH_LIMIT = 30

/** 搜索 scope 按钮顺序（与 index.html 一致） */
const SCOPES: Scope[] = ['mountain', 'creature', 'product', 'all']

/**
 * 搜索结果类型的 CSS 类名。
 * 文案走 i18n（`t.search.kindMountain` 等），类名不可翻译故留在此处。
 * CSS 里对应 `.si-kind-山` / `.si-kind-异兽` / `.si-kind-物产`。
 */
const KIND_CLS: Record<SearchResult['kind'], string> = {
  mountain: 'si-kind-山',
  creature: 'si-kind-异兽',
  product: 'si-kind-物产',
}

/** 置信度徽章文案，取 i18n（CSS 类名 badge-confirmed / -inferred / -unknown） */
function confidenceLabel(t: MapMessages, c: Confidence): string {
  return t.detail.confidence[c] ?? t.detail.confidence.unknown
}

/**
 * map-data.json 中序列化的预计算搜索上下文（buildCtx 的产物）。
 * Map 以 Object/Array 形式存盘（键为字符串），运行时反序列化回 Map。
 */
interface SerializedSearchCtx {
  stations: Station[]
  byName: Record<string, number>
  chainIndex: Record<string, number>
  creatureIndex: Record<string, string[]>
}

/** 数据文件里的 MapData + 可选预计算 ctx */
type MapDataFile = MapData & { ctx?: SerializedSearchCtx }

/**
 * 反序列化构建期预计算的搜索上下文（flatten + 三个索引）。
 * 字段缺失时返回 null，调用方回退到运行时 buildCtx。
 */
function deserializeCtx(d: MapDataFile): SearchCtx | null {
  const c = d.ctx
  if (!c || !Array.isArray(c.stations) || !c.byName || !c.chainIndex || !c.creatureIndex) {
    return null
  }
  return {
    stations: c.stations,
    byName: new Map<string, number>(Object.entries(c.byName)),
    chainIndex: new Map<string, number>(Object.entries(c.chainIndex)),
    creatureIndex: new Map<string, string[]>(Object.entries(c.creatureIndex)),
    lines: d.lines,
    products: d.products,
  }
}

/** 搜索结果类型标签，取 i18n */
function kindLabel(t: MapMessages, k: SearchResult['kind']): string {
  if (k === 'mountain') return t.search.kindMountain
  if (k === 'creature') return t.search.kindCreature
  return t.search.kindProduct
}

type MapMessages = Messages['shanhaijin']['map']

/* ── 工具函数 ─────────────────────────────────────────────────── */

/**
 * 读取 URL hash 里的山名并解析为站点下标。
 *
 * 写 hash 时用 `encodeURIComponent`，但浏览器对中文 fragment 的返回形式不一致
 * （有的保留原文、有的返回百分号编码），因此两种形式都尝试。
 * 解析不到时返回 null（调用方保持当前选中，不跳转）。
 */
function readHashIndex(ctx: SearchCtx): number | null {
  if (typeof window === 'undefined') return null
  const raw = window.location.hash.replace(/^#/, '')
  if (!raw) return null

  const candidates: string[] = [raw]
  try {
    const decoded = decodeURIComponent(raw)
    if (decoded !== raw) candidates.push(decoded)
  } catch {
    // 非法转义序列（如单独的 %）：忽略，退回原始串
  }

  // 繁简归一化候选（byName 键已归一化）
  for (const c of [...candidates]) {
    const normalized = normalizeChainName(c)
    if (normalized !== c && !candidates.includes(normalized)) candidates.push(normalized)
  }

  for (const c of candidates) {
    const i = ctx.byName.get(c)
    if (i != null) return i
  }
  return null
}

/* ── 子组件 ───────────────────────────────────────────────────── */

interface SearchBoxProps {
  query: string
  scope: Scope
  results: SearchResult[]
  open: boolean
  zh: boolean
  t: MapMessages
  viewAllLabel: string
  onQuery: (value: string) => void
  onScope: (scope: Scope) => void
  onPick: (result: SearchResult) => void
  onClose: () => void
}

/** 搜索区：输入框 + 4 个 scope 按钮 + 结果下拉 */
function SearchBox({
  query,
  scope,
  results,
  open,
  zh,
  t,
  viewAllLabel,
  onQuery,
  onScope,
  onPick,
  onClose,
}: SearchBoxProps) {
  const boxRef = useRef<HTMLDivElement>(null)

  // 点击搜索区外部时收起结果（focus.js 的 document click 监听）
  useEffect(() => {
    const onDocClick = (e: MouseEvent) => {
      const target = e.target as HTMLElement | null
      if (target && boxRef.current && !boxRef.current.contains(target)) onClose()
    }
    document.addEventListener('click', onDocClick)
    return () => document.removeEventListener('click', onDocClick)
  }, [onClose])

  const hasQuery = query.trim().length > 0

  return (
    <section className="search" ref={boxRef}>
      <div className="search-row">
        <input
          type="text"
          value={query}
          placeholder={t.search.placeholder}
          autoComplete="off"
          onChange={(e) => onQuery(e.target.value)}
          onKeyDown={(e) => {
            if (e.key === 'Enter') {
              const first = results[0]
              if (first && first.idx >= 0) onPick(first)
            } else if (e.key === 'Escape') {
              onClose()
            }
          }}
        />
        <div className="scope">
          {SCOPES.map((s) => (
            <button
              key={s}
              type="button"
              className={scope === s ? 'on' : ''}
              onClick={() => onScope(s)}
            >
              {t.search[s]}
            </button>
          ))}
        </div>
      </div>

      <div className={'results' + (open ? ' on' : '')}>
        {open && hasQuery && results.length === 0 && (
          <div className="search-empty">{t.search.noMatch}</div>
        )}
        {open &&
          results.map((r) => {
            const meta = { cls: KIND_CLS[r.kind], label: kindLabel(t, r.kind) }
            return (
              <button
                key={r.kind + '|' + r.name + '|' + r.idx}
                type="button"
                className="search-item"
                onClick={() => onPick(r)}
              >
                <span className={'si-kind ' + meta.cls}>{meta.label}</span>
                <span className="si-name">{r.name}</span>
                <span className="si-hint">{r.hint}</span>
              </button>
            )
          })}
        {/* lib 的 search() 已截到 30 条，组件拿不到截断前的总数，故只提示「过多」 */}
        {open && results.length >= SEARCH_LIMIT && (
          <div className="search-empty">{t.search.truncated}</div>
        )}
        {/* 查看全部结果：跳转到搜索结果页 */}
        {open && hasQuery && results.length > 0 && (
          <Link
            href={`/shanhaijin/search/?q=${encodeURIComponent(query)}&scope=${scope}`}
            className="search-view-all"
            onClick={onClose}
          >
            {viewAllLabel} →
          </Link>
        )}
      </div>
    </section>
  )
}

interface FocusCardProps {
  s: Station
  nb: ReturnType<typeof neighbors>
  zh: boolean
  t: MapMessages
}

/** 聚焦卡：当前山的山系、序号、置信度、上下游方位里程、原文段落号、里程 */
function FocusCard({ s, nb, zh, t }: FocusCardProps) {
  const conf = confidenceLabel(t, s.confidence)
  const liText = s.distanceText || (s.li != null ? s.li + ' 里' : '')

  return (
    <div className="focus-card">
      <div className="focus-card-head">
        <span className="focus-chain" title={t.focus.chain}>
          {s.lineName}
        </span>
        <span className="focus-group">{s.lineGroup}</span>
      </div>

      <h2 className="focus-name">{s.name}</h2>

      <div className="focus-meta">
        <span className="focus-seq">{t.focus.seq(s.seq)}</span>
        <span className="focus-sep">·</span>
        <span>{s.chapterName}</span>
        <span className="focus-sep">·</span>
        <span className={'badge badge-' + s.confidence}>{conf}</span>
      </div>

      <div className="focus-rel">
        {nb.prev && (
          <div className={'focus-rel-row' + (nb.fromPrev ? '' : ' muted')}>
            <span>{t.focus.fromPrev}</span>
            <b>{nb.prev.name}</b>
            {nb.fromPrev && <span className="rel-arrow">{nb.fromPrev}</span>}
          </div>
        )}
        {nb.next && (
          <div className={'focus-rel-row' + (nb.toNext ? '' : ' muted')}>
            <span>{t.focus.toNext}</span>
            <b>{nb.next.name}</b>
            {nb.toNext && <span className="rel-arrow">{nb.toNext}</span>}
          </div>
        )}
      </div>

      <div className="focus-pn">
        {t.focus.originalPn} <code>{s.pn ?? ''}</code>
      </div>

      {s.li != null ? (
        <div className="focus-li-line">
          {t.focus.li} <span className="focus-li">{liText}</span>
          {s.direction && (
            <>
              {' '}
              <span className="focus-dir-inline">{s.direction}</span>
            </>
          )}
        </div>
      ) : (
        <div className="focus-li-line muted">{t.focus.noLi}</div>
      )}
    </div>
  )
}

interface NeighborCardProps {
  m: Station | null
  sameChain: boolean
  side: 'prev' | 'next'
  /** 从当前山走到该邻居的方位+里程（跨山系时为 null） */
  rel: string | null
  /** 该邻居在站点数组中的真实下标（用于跳转，避免重名山跳错） */
  index: number | null
  t: MapMessages
  onPick: (index: number) => void
}

/** 邻居卡：前一座 / 后一座（含方位里程、跨山系标记、原文段落号） */
function NeighborCard({ m, sameChain, side, rel, index, t, onPick }: NeighborCardProps) {
  const sideLabel = side === 'prev' ? t.focus.prev : t.focus.next

  if (!m) {
    return (
      <div className="neighbor-empty">
        <div className="neighbor-side">{sideLabel}</div>
        <div className="neighbor-name">{t.focus.firstLast}</div>
        <div className="neighbor-note muted">{t.focus.boundary}</div>
      </div>
    )
  }

  return (
    <button
      type="button"
      className={'neighbor-card' + (sameChain ? '' : ' neighbor-card-cross')}
      onClick={() => {
        if (index != null) onPick(index)
      }}
    >
      <div className="neighbor-side">
        {sideLabel}
        {!sameChain && <span className="cross-chain">{t.focus.crossChain}</span>}
      </div>
      <div className="neighbor-name">{m.name}</div>
      <div className="neighbor-meta">{m.lineName}</div>
      {rel && (
        <div className="neighbor-rel">
          <span className="rel-arrow">{rel}</span>
        </div>
      )}
      <div className="neighbor-pn">{m.pn ?? ''}</div>
    </button>
  )
}

interface DetailPanelProps {
  creatures: string[]
  products: Product[]
  text: string
  t: MapMessages
}

/** 详情面板：异兽标签、物产标签、原文 */
function DetailPanel({ creatures, products, text, t }: DetailPanelProps) {
  return (
    <section className="detail-card">
      <h3>{t.detail.creatures}</h3>
      {creatures.length > 0 ? (
        <div className="detail-tags">
          {creatures.map((c) => (
            <span key={c} className="tag tag-creature">
              {'〖+'}
              {c}
              {'〗'}
            </span>
          ))}
        </div>
      ) : (
        <p className="muted">{t.detail.none}</p>
      )}

      <h3>{t.detail.products}</h3>
      {products.length > 0 ? (
        <div className="detail-tags">
          {products.map((p, i) => (
            <span key={p.name + '-' + i} className="tag tag-product">
              {'〖•'}
              {p.name}
              {'〗'}
              {p.side && <span className="tag-side">{p.side}</span>}
            </span>
          ))}
        </div>
      ) : (
        <p className="muted">{t.detail.none}</p>
      )}

      <h3>{t.detail.original}</h3>
      {text ? (
        <p className="detail-text">{text}</p>
      ) : (
        <p className="muted">{t.detail.notFound}</p>
      )}
    </section>
  )
}

interface MapFooterProps {
  index: number
  total: number
  chainLabel: string
  t: MapMessages
  onPrev: () => void
  onNext: () => void
}

/** 底栏：位置、山系内位置、前后切换按钮、键盘提示 */
function MapFooter({ index, total, chainLabel, t, onPrev, onNext }: MapFooterProps) {
  return (
    <footer className="footer">
      <span className="pos">{t.footer.position(index + 1, total)}</span>
      <span className="pos">{chainLabel}</span>
      <div className="nav-btns">
        <button type="button" onClick={onPrev} disabled={index <= 0}>
          {t.footer.prev}
        </button>
        <button type="button" onClick={onNext} disabled={index >= total - 1}>
          {t.footer.next}
        </button>
      </div>
      <div className="hint">{t.footer.hint}</div>
    </footer>
  )
}

/* ── 主组件 ───────────────────────────────────────────────────── */

/**
 * 山形聚焦视图。
 *
 * 无 props：数据、语言、文案全部自取（数据客户端 fetch，文案走 i18n context）。
 */
export function ShanhaijinMap() {
  const { language } = useLanguage()
  const zh = language === 'zh'
  const msgs = getMessages(language)
  const t = msgs.shanhaijin.map
  const nav = msgs.shanhaijin.nav
  const searchI18n = msgs.shanhaijin.search

  const [data, setData] = useState<MapData | null>(null)
  const [error, setError] = useState<string | null>(null)
  const [idx, setIdx] = useState(0)
  const [query, setQuery] = useState('')
  const [scope, setScope] = useState<Scope>('mountain')
  const [open, setOpen] = useState(false)

  /** 只在数据就绪后按 hash 定位一次（之后由 hashchange / select 维护） */
  const initializedRef = useRef(false)

  /* 数据加载：静态导出无 API 路由，必须客户端 fetch */
  useEffect(() => {
    let alive = true
    fetch(DATA_URL)
      .then((r) => {
        if (!r.ok) throw new Error(String(r.status))
        return r.json() as Promise<MapDataFile>
      })
      .then((d) => {
        if (alive) setData(d)
      })
      .catch((e: unknown) => {
        if (alive) setError(e instanceof Error ? e.message : String(e))
      })
    return () => {
      alive = false
    }
  }, [])

  /**
   * 搜索上下文：优先反序列化构建期预计算的索引（flatten / byName / chainIndex /
   * creatureIndex），缺失时回退运行时 buildCtx。
   */
  const ctx = useMemo(() => {
    if (!data) return null
    return deserializeCtx(data) ?? buildCtx(data)
  }, [data])

  /** 把 creatureIndex（异兽 → 山名列表）反转成「山名 → 异兽列表」，供详情面板渲染 */
  const creatureByMountain = useMemo(() => {
    if (!ctx) return null
    const m = new Map<string, string[]>()
    for (const [creature, mountains] of ctx.creatureIndex) {
      for (const name of mountains) {
        const list = m.get(name)
        if (list) list.push(creature)
        else m.set(name, [creature])
      }
    }
    return m
  }, [ctx])

  /** 山系 id → 山系数（用于「山系内第 N / M 座」） */
  const chainCounts = useMemo(() => {
    if (!ctx) return null
    const m = new Map<string, number>()
    for (const line of ctx.lines) m.set(line.id, line.stations.length)
    return m
  }, [ctx])

  const station: Station | null = ctx ? ctx.stations[idx] ?? null : null
  const nb = useMemo(() => (ctx ? neighbors(ctx.stations, idx) : null), [ctx, idx])

  const results = useMemo(() => {
    if (!ctx || !query.trim()) return []
    return search(query, scope, ctx)
  }, [ctx, query, scope])

  const creatures = useMemo(
    () => (ctx && station ? creatureByMountain?.get(station.name) ?? [] : []),
    [ctx, station, creatureByMountain],
  )

  /** 物产：新契约里 products 的键是站点 id（PN，如「001-1」） */
  const products = useMemo(
    () => (ctx && station ? ctx.products[station.id] ?? [] : []),
    [ctx, station],
  )

  const original = useMemo(
    () => (ctx && station ? findText(station.name, data?.texts ?? {}) : ''),
    [ctx, station, data],
  )

  /** 写 hash：replaceState 而非 pushState，避免污染浏览历史 */
  const writeHash = useCallback((name: string) => {
    try {
      const h = '#' + encodeURIComponent(name)
      if (window.location.hash !== h) window.history.replaceState(null, '', h)
    } catch {
      // 非浏览器环境 / 隐私模式：忽略
    }
  }, [])

  const select = useCallback(
    (i: number, silent = false) => {
      if (!ctx) return
      const total = ctx.stations.length
      if (total === 0) return
      const next = Math.max(0, Math.min(total - 1, i))
      setIdx(next)
      if (!silent) writeHash(ctx.stations[next].name)
    },
    [ctx, writeHash],
  )

  /* 初始化：数据就绪后按 hash 定位（silent，不写 hash） */
  useEffect(() => {
    if (!ctx || initializedRef.current) return
    initializedRef.current = true
    const fromHash = readHashIndex(ctx)
    if (fromHash != null) setIdx(fromHash)
  }, [ctx])

  /* 直接改 URL hash 时同步选中 */
  useEffect(() => {
    if (!ctx) return
    const onHashChange = () => {
      const i = readHashIndex(ctx)
      if (i != null) setIdx(i)
    }
    window.addEventListener('hashchange', onHashChange)
    return () => window.removeEventListener('hashchange', onHashChange)
  }, [ctx])

  /* 键盘 ← / →：输入框、文本域、可编辑元素内不拦截 */
  useEffect(() => {
    if (!ctx) return
    const onKeyDown = (e: KeyboardEvent) => {
      if (e.key !== 'ArrowLeft' && e.key !== 'ArrowRight') return
      const el = document.activeElement as HTMLElement | null
      if (el && (el.tagName === 'INPUT' || el.tagName === 'TEXTAREA' || el.isContentEditable)) {
        return
      }
      e.preventDefault()
      select(idx + (e.key === 'ArrowLeft' ? -1 : 1))
    }
    document.addEventListener('keydown', onKeyDown)
    return () => document.removeEventListener('keydown', onKeyDown)
  }, [ctx, idx, select])

  const handleQuery = useCallback((value: string) => {
    setQuery(value)
    setOpen(value.trim().length > 0)
  }, [])

  const handleScope = useCallback(
    (s: Scope) => {
      setScope(s)
      // 有查询词时保持结果展开
      setOpen((prev) => (query.trim() ? true : prev))
    },
    [query],
  )

  const handlePick = useCallback(
    (r: SearchResult) => {
      setOpen(false)
      if (r.kind === 'mountain') {
        // idx 为 -1 表示解析不到站点（focus.js 会错误地跳到第一座山）
        if (r.idx >= 0) select(r.idx)
      } else {
        // 异兽/物产：跳转到搜索结果页
        const params = new URLSearchParams({ q: r.name, scope: r.kind })
        window.location.href = `/shanhaijin/search/?${params.toString()}`
      }
    },
    [select],
  )

  const handleClose = useCallback(() => setOpen(false), [])

  /* ── 加载 / 错误态 ─────────────────────────────────────────── */

  if (error) {
    return (
      <div className="sh-map">
        <div className="wrap">
          <div className="detail-card">
            <p className="muted">{t.loadError(error)}</p>
          </div>
        </div>
      </div>
    )
  }

  if (!ctx || !station || !nb || !creatureByMountain || !chainCounts) {
    return (
      <div className="sh-map">
        <div className="wrap">
          <div className="neighbor-empty">{t.loading}</div>
        </div>
      </div>
    )
  }

  const chainLabel = t.footer.chainPosition(
    station.lineName,
    station.seq,
    chainCounts.get(station.lineId) ?? 0,
  )

  return (
    <div className="sh-map">
      <header className="topbar">
        <h1>{t.title}</h1>
        <div className="sub">{t.subtitle}</div>
        <nav>
          <Link href="/shanhaijin/panorama/">
            {zh ? nav.panorama.zh : nav.panorama.en}
          </Link>
          <Link href="/shanhaijin/entities/creature/">
            {zh ? nav.entities.zh : nav.entities.en}
          </Link>
          <Link href="/shanhaijin/graph/">
            {zh ? nav.graph.zh : nav.graph.en}
          </Link>
          <Link href="/shanhaijin/search/">
            {zh ? nav.search.zh : nav.search.en}
          </Link>
          <Link href="/shanhaijin/map/" className="on">
            {zh ? nav.map.zh : nav.map.en}
          </Link>
        </nav>
      </header>

      <main className="wrap">
        <SearchBox
          query={query}
          scope={scope}
          results={results}
          open={open}
          zh={zh}
          t={t}
          viewAllLabel={zh ? searchI18n.viewAll.zh : searchI18n.viewAll.en}
          onQuery={handleQuery}
          onScope={handleScope}
          onPick={handlePick}
          onClose={handleClose}
        />

        <section className="stage">
          <div className="stage-label stage-label-left">{t.focus.prev}</div>
          <div className="stage-label stage-label-right">{t.focus.next}</div>

          <div className="neighbors">
            <div className="neighbor-col">
              <NeighborCard
                m={nb.prev}
                sameChain={nb.prevSame}
                side="prev"
                rel={nb.fromPrev}
                index={nb.prev ? idx - 1 : null}
                t={t}
                onPick={select}
              />
            </div>
            <div className="neighbor-col neighbor-col-right">
              <NeighborCard
                m={nb.next}
                sameChain={nb.nextSame}
                side="next"
                rel={nb.toNext}
                index={nb.next ? idx + 1 : null}
                t={t}
                onPick={select}
              />
            </div>
          </div>

          <div className="focus-wrap">
            <FocusCard s={station} nb={nb} zh={zh} t={t} />
          </div>
        </section>

        <DetailPanel creatures={creatures} products={products} text={original} t={t} />

        <MapFooter
          index={idx}
          total={ctx.stations.length}
          chainLabel={chainLabel}
          t={t}
          onPrev={() => select(idx - 1)}
          onNext={() => select(idx + 1)}
        />
      </main>
    </div>
  )
}

/* ── 与 focus.js 的行为差异 ─────────────────────────────────────
 *
 * 修掉的 bug：
 * 1. 邻居卡跳转用「位置下标」而不是「按山名 findIndex」：全书有重出山名
 *    （如「玉山」「箕尾之山」），focus.js 点击重名邻居会跳到首次出现的那座山。
 * 2. 搜索结果 idx === -1（异兽/物产解析不到站点）时不再跳转：focus.js 的
 *    `select(-1)` 会被 clamp 成 0，误跳到第一座山；现在直接不跳转。
 * 3. 键盘 ← / → 增加 `TEXTAREA` 与 `isContentEditable` 判断：focus.js 只排除了
 *    `INPUT`，在文本域里按方向键会同时改光标和切山。
 * 4. 异兽索引改用 lib 的 `buildCreatureIndex`：focus.js 直接取
 *    `sightings[name][0]`，遇到空数组会抛错。
 * 5. `li` 判断从 truthy 改为 `!= null`：里程为 0 时 focus.js 会误显示「本条目无里程」。
 * 6. `findText` 委托 lib：补全了「之野」变体（focus.js 只处理「之山/之丘」）。
 *
 * 有意的行为调整：
 * 7. 底栏前后按钮在边界处 `disabled`（CSS 已定义 `:disabled` 样式），
 *    focus.js 是 clamp 成无操作。
 * 8. `focus-rel` 跨山系时仍渲染该行，但去掉方位标签并加 `muted` 样式，
 *    让「有前一座山、但方位跨山系」这件事可见（focus.js 直接不渲染该行）。
 * 9. 加载 / 错误态复用已有 CSS 类（`.neighbor-empty` / `.detail-card` +
 *    `.muted`）；focus.js 用的 `.focus-error` 在作用域化 CSS 里没有定义。
 * 10. 顶栏「全图总览」指向 `/shanhaijin/`（博客的知识图谱总览页），
 *     focus.js 指向同目录的 `metro.html`。
 *
 * 已知缺陷：
 * 11. lib 的 `search()` 内部已截到 30 条，组件拿不到截断前的总数，因此
 *     「… 共 N 条」的 i18n 键 `shanhaijin.map.search.more` 无法按原义使用，
 *     改用本地文案「… 结果过多，仅显示前 30 条」。
 * 12. i18n 缺少 loading / 置信度徽章 / 结果类型标签三类文案，用本地常量补齐。
 * 13. CSS 里的 `.focus-rel-row.muted .rel-arrow` 规则在「muted 行不带
 *     rel-arrow」的实现下不会命中，属于无害的死规则。
 */
