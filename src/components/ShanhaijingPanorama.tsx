'use client'

import { useEffect, useMemo, useState, useCallback } from 'react'
import Link from 'next/link'
import { useLanguage } from '@/contexts/LanguageContext'
import { getMessages, type Messages } from '@/i18n/messages'
import {
  layoutChain,
  type PanoramaChain,
  type PanoramaNode,
} from '@/lib/shanhaijing-panorama'
import { findText, type MapData, type Line } from '@/lib/shanhaijing-map'

type PanoramaMessages = Messages['shanhaijing']['panorama']

/** 构建期预计算的 bounds（与组件运行时算法一致：min 含 0 下界，max 含 800/100 兜底） */
export interface PrecomputedChainLayout {
  nodes: PanoramaNode[]
  bounds: { minX: number; maxX: number; minY: number; maxY: number }
}

/** panorama-layout.json 的契约：{ chains: { [chainId]: { nodes, bounds } } } */
export interface PrecomputedPanoramaLayout {
  chains: Record<string, PrecomputedChainLayout>
}

interface ShanhaijingPanoramaProps {
  data: MapData
  /** 构建期预计算的布局（panorama-layout.json）；缺失时回退运行时 layoutChain */
  layout?: PrecomputedPanoramaLayout | null
}

/** 置信度样式类名 */
function confidenceClass(confidence: string): string {
  if (confidence === 'confirmed') return 'node-confirmed'
  if (confidence === 'inferred') return 'node-inferred'
  return 'node-unknown'
}

/** 单个山节点 */
const PanoramaNodeDot = PanoramaNodeDotImpl
function PanoramaNodeDotImpl({
  node,
  chainColor,
  selected,
  onSelect,
}: {
  node: PanoramaNode
  chainColor: string
  selected: boolean
  onSelect: (n: PanoramaNode) => void
}) {
  const r = selected ? 10 : 7
  return (
    <g
      className="p-node"
      transform={`translate(${node.x}, ${node.y})`}
      onClick={(e) => {
        e.stopPropagation()
        onSelect(node)
      }}
      style={{ cursor: 'pointer' }}
    >
      <circle r={r + 4} className="p-node-hit" fill="transparent" />
      <circle
        r={r}
        className={`p-node-circle ${confidenceClass(node.confidence)}`}
        stroke={chainColor}
        strokeWidth={selected ? 3 : 2}
      />
      {(node.creatures.length > 0 || node.productsCount > 0) && (
        <circle r={2.5} cy={-r - 3} className="p-node-marker" fill={chainColor} />
      )}
    </g>
  )
}

/** 详情面板 */
function DetailPanel({
  node,
  chain,
  text,
  t,
  zh,
  onClose,
}: {
  node: PanoramaNode | null
  chain: PanoramaChain | null
  text: string
  t: PanoramaMessages
  zh: boolean
  onClose: () => void
}) {
  if (!node) {
    return (
      <div className="p-detail-empty">
        <p className="muted">{t.selectMountain}</p>
      </div>
    )
  }

  const focusUrl = `/shanhaijing/map/#${encodeURIComponent(node.name)}`

  return (
    <div className="p-detail">
      <div className="p-detail-head">
        <div>
          <span className="p-detail-chain" style={{ borderColor: chain?.color }}>
            {chain?.name}
          </span>
          <h3 className="p-detail-name">{node.name}</h3>
        </div>
        <button className="p-detail-close" onClick={onClose} aria-label="Close">
          ×
        </button>
      </div>

      <div className="p-detail-meta">
        <span className="p-detail-seq">
          {zh ? `第 ${node.seq} 座` : `#${node.seq}`}
        </span>
        {node.direction && (
          <span className="p-detail-dir">
            {node.direction} {node.distanceText ?? ''}
          </span>
        )}
        {node.distanceLi != null && (
          <span className="p-detail-li">
            {t.totalLi} {node.distanceLi} {t.li}
          </span>
        )}
        {node.water && <span className="p-detail-water">{node.water}</span>}
      </div>

      {node.creatures.length > 0 && (
        <div className="p-detail-section">
          <h4>{t.creatures}</h4>
          <div className="p-detail-tags">
            {node.creatures.map((c) => (
              <Link
                key={c}
                href={`/shanhaijing/entities/creature/${encodeURIComponent(c)}`}
                className="p-tag p-tag-creature"
              >
                {c}
              </Link>
            ))}
          </div>
        </div>
      )}

      {node.productsCount > 0 && (
        <div className="p-detail-section">
          <h4>
            {t.products} ({node.productsCount} {t.productsCount})
          </h4>
        </div>
      )}

      {text && (
        <div className="p-detail-section">
          <h4>{t.original}</h4>
          <p className="p-detail-text">{text}</p>
        </div>
      )}

      <div className="p-detail-actions">
        <Link href={focusUrl} className="p-focus-link">
          {t.focusLink}
        </Link>
      </div>
    </div>
  )
}

/* ── 主组件 ───────────────────────────────────────────────────── */

export function ShanhaijingPanorama({ data, layout }: ShanhaijingPanoramaProps) {
  const { language } = useLanguage()
  const zh = language === 'zh'
  const t = getMessages(language).shanhaijing.panorama

  const [selectedChainId, setSelectedChainId] = useState<string | null>(null)
  const [selected, setSelected] = useState<PanoramaNode | null>(null)

  /* 所有山系 */
  const allChains = useMemo(() => {
    if (!data) return []
    return data.lines
  }, [data])

  /* 当前山系：优先使用构建期预计算的节点坐标，缺失时回退运行时 layoutChain */
  const currentChain = useMemo(() => {
    if (!data || !selectedChainId) return null
    const line = allChains.find((l) => l.id === selectedChainId)
    if (!line) return null
    const precomputed = layout?.chains[selectedChainId]
    if (precomputed) {
      return {
        id: line.id,
        name: line.name,
        label: line.label,
        color: line.color,
        group: line.group,
        chapterName: line.chapterName,
        nodes: precomputed.nodes,
        totalLi: line.totalLi,
      }
    }
    return layoutChain(line as Line, data.sightings, data.products, data.positions)
  }, [data, selectedChainId, allChains, layout])

  /* 原文 */
  const original = useMemo(() => {
    if (!selected || !data) return ''
    return findText(selected.name, data.texts ?? {})
  }, [selected, data])

  /* 事件处理 */
  const handleSelect = useCallback((node: PanoramaNode) => {
    setSelected((prev) => (prev?.id === node.id ? null : node))
  }, [])

  const switchChain = useCallback((chainId: string) => {
    setSelectedChainId(chainId)
    setSelected(null)
  }, [])

  /* 键盘 Esc 关闭详情 */
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape') setSelected(null)
    }
    document.addEventListener('keydown', onKey)
    return () => document.removeEventListener('keydown', onKey)
  }, [])

  if (!data) return null

  /* 计算 SVG 尺寸：优先使用构建期预计算的 bounds，缺失时按运行时算法计算 */
  const precomputedBounds =
    layout && selectedChainId ? layout.chains[selectedChainId]?.bounds : undefined
  const bounds =
    precomputedBounds ??
    (currentChain
      ? {
          minX: Math.min(...currentChain.nodes.map((n) => n.x), 0),
          maxX: Math.max(...currentChain.nodes.map((n) => n.x), 800),
          minY: Math.min(...currentChain.nodes.map((n) => n.y), 0),
          maxY: Math.max(...currentChain.nodes.map((n) => n.y), 100),
        }
      : { minX: 0, maxX: 800, minY: 0, maxY: 100 })

  return (
    <div className="sh-panorama">
      {/* 顶栏 */}
      <header className="p-topbar">
        <h1>{t.title}</h1>
        <div className="p-sub">{t.subtitle}</div>
        <nav>
          <Link href="/shanhaijing/map/">{t.nav.focus}</Link>
          <Link href="/shanhaijing/" className="on">
            {t.nav.overview}
          </Link>
        </nav>
      </header>

      <main className="p-main">
        {/* 山系选择器 */}
        <div className="p-chain-selector">
          {allChains.map((line) => (
            <button
              key={line.id}
              className={selectedChainId === line.id ? 'on' : ''}
              onClick={() => switchChain(line.id)}
              title={line.name}
            >
              {line.name}
            </button>
          ))}
        </div>

        {/* SVG 单山系全景图 */}
        {currentChain && (
          <div className="p-scroll">
            <svg
              className="p-svg"
              viewBox={`0 0 ${bounds.maxX + 80} ${bounds.maxY + 80}`}
            >
              {/* 山系标签 */}
              <text x={10} y={30} className="p-chain-label" fill={currentChain.color}>
                {currentChain.name} ({currentChain.nodes.length} {zh ? '座' : 'mountains'})
              </text>

              {/* 连线 */}
              <polyline
                className="p-chain-line"
                points={currentChain.nodes.map((n) => `${n.x},${n.y}`).join(' ')}
                fill="none"
                stroke={currentChain.color}
                strokeWidth={2}
                opacity={0.4}
              />

              {/* 节点 */}
              {currentChain.nodes.map((node) => (
                <PanoramaNodeDot
                  key={node.id}
                  node={node}
                  chainColor={currentChain.color}
                  selected={selected?.id === node.id}
                  onSelect={handleSelect}
                />
              ))}
            </svg>
          </div>
        )}

        {/* 详情面板 */}
        <DetailPanel
          node={selected}
          chain={currentChain}
          text={original}
          t={t}
          zh={zh}
          onClose={() => setSelected(null)}
        />
      </main>
    </div>
  )
}
