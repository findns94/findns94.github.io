'use client'

/**
 * 山海经 · 知识图谱（力导向 SVG 交互图）
 *
 * 数据：`public/shanhaijin/data.json`（客户端 fetch，无 API 路由）。
 * 纯逻辑：`src/lib/shanhaijin-graph.ts`（buildGraphData / forceDirectedLayout /
 *   filterByRelationType / getConnectedSubgraph，一律 import，不重写）。
 * 文案：`src/i18n/messages.ts` 的 `shanhaijin.graph`。
 * 样式：`src/app/shanhaijin/graph/graph.css`（作用域根 `.kg`）。
 *
 * 渲染为自实现 SVG（无 D3 / 无外部图库）：
 *   拖拽节点、悬停高亮邻域、点击查看详情、关系类型筛选、
 *   滚轮缩放、拖拽平移、「重置布局」重算力导向。
 */

import React, { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import Link from 'next/link'
import { useLanguage } from '@/contexts/LanguageContext'
import { getMessages, type Messages } from '@/i18n/messages'
import {
  ALL_RELATION_TYPES,
  DEFAULT_RELATION_TYPES,
  NODE_TYPE_COLORS,
  RELATION_COLORS,
  buildGraphData,
  filterByRelationType,
  forceDirectedLayout,
  getConnectedSubgraph,
  type ForceDirectedResult,
  type GraphData,
  type GraphEdge,
  type GraphNode,
} from '@/lib/shanhaijin-graph'

/* ── 常量 ─────────────────────────────────────────────────────── */

const DATA_URL = '/shanhaijin/data.json'

/** 布局画布逻辑尺寸（SVG viewBox 基准） */
const CANVAS_W = 1400
const CANVAS_H = 900

/** 默认最大节点数（性能截断） */
const DEFAULT_MAX_NODES = 200

/** 关系类型显示顺序与 i18n 键 */
const RELATION_I18N: Record<string, keyof Messages['shanhaijin']['graph']> = {
  produces: 'produces',
  inhabits: 'inhabits',
  has_efficacy: 'hasEfficacy',
  adjacent_to: 'adjacentTo',
  distance_from: 'distanceFrom',
  water_connect: 'waterConnect',
  located_at: 'locatedAt',
  in_chain: 'inChain',
  sacrificed_at: 'sacrificedAt',
  descends_from: 'descendsFrom',
  alias_of: 'aliasOf',
  same_as: 'sameAs',
}

/** 节点类型 i18n 键（图例用） */
const NODE_TYPE_I18N: Record<string, string> = {
  mountain: 'mountain',
  creature: 'creature',
  product: 'product',
  water: 'water',
  plant: 'plant',
  polity: 'polity',
  deity: 'deity',
  other: 'other',
}

type GraphMessages = Messages['shanhaijin']['graph']

interface ViewTransform {
  x: number
  y: number
  k: number
}

/* ── 主组件 ───────────────────────────────────────────────────── */

export function KnowledgeGraph() {
  const { language } = useLanguage()
  const zh = language === 'zh'
  const t = getMessages(language).shanhaijin.graph

  // ── 数据 ──
  const [data, setData] = useState<Record<string, unknown> | null>(null)
  const [loadError, setLoadError] = useState<string | null>(null)

  useEffect(() => {
    let cancelled = false
    fetch(DATA_URL)
      .then((r) => {
        if (!r.ok) throw new Error(`HTTP ${r.status}`)
        return r.json()
      })
      .then((json: Record<string, unknown>) => {
        if (!cancelled) setData(json)
      })
      .catch((err: Error) => {
        if (!cancelled) setLoadError(err.message)
      })
    return () => {
      cancelled = true
    }
  }, [])

  // ── 图谱构建（数据到达后一次） ──
  const graph: GraphData | null = useMemo(() => {
    if (!data) return null
    return buildGraphData(
      (data.spatialRelations as Record<string, Array<{ subject?: string; object?: string; relation?: string; chain?: string }>>) ?? null,
      (data.biologyRelations as Record<string, Array<{ subject?: string; object?: string; relation?: string; chapter?: string }>>) ?? null,
      DEFAULT_MAX_NODES,
      (data.entities as Array<{ canonical?: string; typeKey?: string; display?: string }>) ?? null,
    )
  }, [data])

  // ── 关系类型筛选 ──
  const [activeRelations, setActiveRelations] = useState<Set<string>>(
    () => new Set<string>(DEFAULT_RELATION_TYPES),
  )

  const toggleRelation = useCallback((rel: string) => {
    setActiveRelations((prev) => {
      const next = new Set(prev)
      if (next.has(rel)) next.delete(rel)
      else next.add(rel)
      return next
    })
  }, [])

  const filteredGraph = useMemo(
    () => (graph ? filterByRelationType(graph, [...activeRelations]) : null),
    [graph, activeRelations],
  )

  // ── 焦点模式：只看某节点的 1 跳邻域 ──
  const [focusNodeId, setFocusNodeId] = useState<string | null>(null)

  const displayGraph = useMemo(() => {
    if (!filteredGraph) return null
    if (focusNodeId) return getConnectedSubgraph(filteredGraph, focusNodeId, 1)
    return filteredGraph
  }, [filteredGraph, focusNodeId])

  // ── 力导向布局（筛选 / 焦点变化时重算；setTimeout 让加载态先绘制） ──
  const [layout, setLayout] = useState<ForceDirectedResult | null>(null)
  const [computing, setComputing] = useState(false)
  const layoutSeq = useRef(0)

  useEffect(() => {
    if (!displayGraph || displayGraph.nodes.length === 0) {
      setLayout(null)
      return
    }
    const seq = ++layoutSeq.current
    setComputing(true)
    const timer = setTimeout(() => {
      if (seq !== layoutSeq.current) return
      setLayout(forceDirectedLayout(displayGraph, CANVAS_W, CANVAS_H))
      setComputing(false)
    }, 40)
    return () => clearTimeout(timer)
  }, [displayGraph])

  // ── 视图变换（缩放 / 平移） ──
  const [view, setView] = useState<ViewTransform>({ x: 0, y: 0, k: 1 })
  const zoom = useCallback((factor: number, cx = CANVAS_W / 2, cy = CANVAS_H / 2) => {
    setView((v) => {
      const k = Math.min(6, Math.max(0.3, v.k * factor))
      // 以 (cx, cy) 为锚点缩放
      const scale = k / v.k
      return { k, x: cx - (cx - v.x) * scale, y: cy - (cy - v.y) * scale }
    })
  }, [])

  // ── 选中 / 悬停 ──
  const [selectedId, setSelectedId] = useState<string | null>(null)
  const [hoveredId, setHoveredId] = useState<string | null>(null)

  // 邻接表（用于悬停高亮与详情面板）
  const adjacency = useMemo(() => {
    const map = new Map<string, Array<{ edge: GraphEdge; otherId: string }>>()
    if (!displayGraph) return map
    for (const e of displayGraph.edges) {
      if (!map.has(e.source)) map.set(e.source, [])
      if (!map.has(e.target)) map.set(e.target, [])
      map.get(e.source)!.push({ edge: e, otherId: e.target })
      map.get(e.target)!.push({ edge: e, otherId: e.source })
    }
    return map
  }, [displayGraph])

  // 悬停高亮的邻域集合
  const highlightSet = useMemo(() => {
    if (!hoveredId) return null
    const set = new Set<string>([hoveredId])
    const nb = adjacency.get(hoveredId)
    if (nb) for (const { otherId } of nb) set.add(otherId)
    return set
  }, [hoveredId, adjacency])

  // 选中节点信息
  const selectedNode = useMemo(
    () => layout?.nodes.find((nd) => nd.id === selectedId) ?? null,
    [layout, selectedId],
  )

  // 画布容器尺寸（用于指针事件换算）
  const svgRef = useRef<SVGSVGElement>(null)

  const toScreen = useCallback((clientX: number, clientY: number) => {
    const rect = svgRef.current?.getBoundingClientRect()
    if (!rect) return { x: 0, y: 0 }
    // SVG 以 viewBox 等比缩放（preserveAspectRatio 默认 xMidYMid meet）
    const scale = Math.min(rect.width / CANVAS_W, rect.height / CANVAS_H)
    const offsetX = (rect.width - CANVAS_W * scale) / 2
    const offsetY = (rect.height - CANVAS_H * scale) / 2
    return { x: (clientX - rect.left - offsetX) / scale, y: (clientY - rect.top - offsetY) / scale }
  }, [])

  // ── 节点拖拽（鼠标 + 触摸统一走 pointer events） ──
  const dragRef = useRef<{
    nodeId: string
    startX: number
    startY: number
    nodeX: number
    nodeY: number
    moved: boolean
  } | null>(null)

  const onNodePointerDown = useCallback(
    (e: React.PointerEvent, nodeId: string) => {
      e.stopPropagation()
      const nd = layout?.nodes.find((n) => n.id === nodeId)
      if (!nd) return
      ;(e.target as Element).setPointerCapture(e.pointerId)
      const p = toScreen(e.clientX, e.clientY)
      dragRef.current = { nodeId, startX: p.x, startY: p.y, nodeX: nd.x, nodeY: nd.y, moved: false }
    },
    [layout, toScreen],
  )

  const onPointerMove = useCallback(
    (e: React.PointerEvent) => {
      const drag = dragRef.current
      if (!drag) return
      e.preventDefault()
      const p = toScreen(e.clientX, e.clientY)
      const dx = p.x - drag.startX
      const dy = p.y - drag.startY
      if (Math.abs(dx) + Math.abs(dy) > 2) drag.moved = true
      setLayout((prev) => {
        if (!prev) return prev
        return {
          ...prev,
          nodes: prev.nodes.map((nd) =>
            nd.id === drag.nodeId ? { ...nd, x: drag.nodeX + dx, y: drag.nodeY + dy } : nd,
          ),
        }
      })
    },
    [toScreen],
  )

  const onPointerUp = useCallback(
    (e: React.PointerEvent) => {
      const drag = dragRef.current
      if (!drag) return
      dragRef.current = null
      if ((e.target as Element).hasPointerCapture?.(e.pointerId)) {
        ;(e.target as Element).releasePointerCapture(e.pointerId)
      }
      if (!drag.moved) {
        // 未移动 → 视为点击，选中节点
        setSelectedId(drag.nodeId)
      }
    },
    [],
  )

  // ── 背景拖拽平移 ──
  const panRef = useRef<{ startX: number; startY: number; viewX: number; viewY: number } | null>(null)

  const onBackgroundPointerDown = useCallback(
    (e: React.PointerEvent) => {
      if (e.target !== e.currentTarget && !(e.target as Element).classList?.contains('kg-bg')) return
      ;(e.currentTarget as Element).setPointerCapture(e.pointerId)
      panRef.current = { startX: e.clientX, startY: e.clientY, viewX: view.x, viewY: view.y }
    },
    [view],
  )

  const onBackgroundPointerMove = useCallback((e: React.PointerEvent) => {
    const pan = panRef.current
    if (!pan) return
    const rect = svgRef.current?.getBoundingClientRect()
    if (!rect) return
    const scale = Math.min(rect.width / CANVAS_W, rect.height / CANVAS_H)
    setView((v) => ({
      ...v,
      x: pan.viewX + (e.clientX - pan.startX) / scale,
      y: pan.viewY + (e.clientY - pan.startY) / scale,
    }))
  }, [])

  const onBackgroundPointerUp = useCallback((e: React.PointerEvent) => {
    panRef.current = null
    if ((e.currentTarget as Element).hasPointerCapture?.(e.pointerId)) {
      ;(e.currentTarget as Element).releasePointerCapture(e.pointerId)
    }
  }, [])

  // ── 滚轮缩放 ──
  useEffect(() => {
    const svg = svgRef.current
    if (!svg) return
    const onWheel = (e: WheelEvent) => {
      e.preventDefault()
      const rect = svg.getBoundingClientRect()
      const scale = Math.min(rect.width / CANVAS_W, rect.height / CANVAS_H)
      const offsetX = (rect.width - CANVAS_W * scale) / 2
      const offsetY = (rect.height - CANVAS_H * scale) / 2
      const cx = (e.clientX - rect.left - offsetX) / scale
      const cy = (e.clientY - rect.top - offsetY) / scale
      zoom(e.deltaY < 0 ? 1.15 : 1 / 1.15, cx, cy)
    }
    svg.addEventListener('wheel', onWheel, { passive: false })
    return () => svg.removeEventListener('wheel', onWheel)
  }, [zoom])

  // ── 重置布局 ──
  const resetLayout = useCallback(() => {
    setFocusNodeId(null)
    setSelectedId(null)
    setView({ x: 0, y: 0, k: 1 })
    if (!displayGraph) return
    setComputing(true)
    const seq = ++layoutSeq.current
    setTimeout(() => {
      if (seq !== layoutSeq.current) return
      setLayout(forceDirectedLayout(displayGraph, CANVAS_W, CANVAS_H))
      setComputing(false)
    }, 40)
  }, [displayGraph])

  // ── 加载 / 错误态 ──
  if (loadError) {
    return <div className="kg-state">Failed to load: {loadError}</div>
  }
  if (!data || !graph) {
    return <div className="kg-state">Loading…</div>
  }

  const nodeById = new Map(layout?.nodes.map((nd) => [nd.id, nd]) ?? [])

  return (
    <div className="kg">
      {/* ── 顶栏 ── */}
      <header className="kg-topbar">
        <div className="kg-title">
          <h1>{t.title}</h1>
          <p>{t.subtitle}</p>
        </div>
        <div className="kg-stats">
          {layout && (
            <span>
              {layout.nodes.length} {t.nodeCount} · {layout.edges.length} {t.edgeCount}
            </span>
          )}
        </div>
      </header>

      {/* ── 关系类型筛选 ── */}
      <div className="kg-filters">
        <span className="kg-filters-label">{t.relations}</span>
        {ALL_RELATION_TYPES.map((rel) => (
          <label key={rel} className={'kg-chip' + (activeRelations.has(rel) ? ' on' : '')}>
            <input
              type="checkbox"
              checked={activeRelations.has(rel)}
              onChange={() => toggleRelation(rel)}
            />
            <span className="kg-chip-dot" style={{ background: RELATION_COLORS[rel] ?? '#757575' }} />
            {t[RELATION_I18N[rel]] ?? rel}
          </label>
        ))}
      </div>

      {/* ── 主区域：画布 + 详情面板 ── */}
      <div className="kg-main">
        <div className="kg-stage">
          <svg
            ref={svgRef}
            className="kg-svg"
            viewBox={`0 0 ${CANVAS_W} ${CANVAS_H}`}
            role="img"
            aria-label={t.title}
            onPointerMove={onPointerMove}
            onPointerUp={onPointerUp}
            onPointerDown={onBackgroundPointerDown}
            onPointerMoveCapture={onBackgroundPointerMove}
            onPointerUpCapture={onBackgroundPointerUp}
          >
            <rect className="kg-bg" x={0} y={0} width={CANVAS_W} height={CANVAS_H} fill="transparent" />
            <g transform={`translate(${view.x},${view.y}) scale(${view.k})`}>
              {/* 边 */}
              {layout?.edges.map((e) => {
                const a = nodeById.get(e.source)
                const b = nodeById.get(e.target)
                if (!a || !b) return null
                const dim = highlightSet && !(highlightSet.has(e.source) && highlightSet.has(e.target))
                const active =
                  (hoveredId && (e.source === hoveredId || e.target === hoveredId)) ||
                  selectedId === e.source ||
                  selectedId === e.target
                return (
                  <line
                    key={`${e.source}|${e.target}|${e.relation}`}
                    className={active ? 'edge active' : dim ? 'edge dim' : 'edge'}
                    x1={a.x}
                    y1={a.y}
                    x2={b.x}
                    y2={b.y}
                    stroke={RELATION_COLORS[e.relation] ?? '#757575'}
                    strokeWidth={Math.min(3, 0.6 + e.weight * 0.4)}
                  />
                )
              })}
              {/* 节点 */}
              {layout?.nodes.map((nd) => (
                <GraphNodeShape
                  key={nd.id}
                  node={nd}
                  dim={highlightSet ? !highlightSet.has(nd.id) : false}
                  selected={selectedId === nd.id || hoveredId === nd.id}
                  onPointerDown={onNodePointerDown}
                  onEnter={() => setHoveredId(nd.id)}
                  onLeave={() => setHoveredId(null)}
                />
              ))}
            </g>
          </svg>

          {/* 缩放 / 重置控件 */}
          <div className="kg-controls">
            <button type="button" onClick={() => zoom(1.3)} aria-label={t.zoomIn}>
              +
            </button>
            <button type="button" onClick={() => zoom(1 / 1.3)} aria-label={t.zoomOut}>
              −
            </button>
            <button type="button" onClick={resetLayout}>
              {t.resetLayout}
            </button>
          </div>

          {/* 布局计算中的加载提示 */}
          {computing && <div className="kg-computing">…</div>}

          {/* 空筛选结果提示 */}
          {filteredGraph && filteredGraph.edges.length === 0 && !computing && (
            <div className="kg-empty">{t.selectNode}</div>
          )}

          {/* 悬停/选中提示 */}
          <div className="kg-hint">{t.selectNode}</div>
        </div>

        {/* ── 详情面板 ── */}
        {selectedNode && (
          <aside className="kg-panel">
            <div className="kg-panel-head">
              <span
                className="kg-panel-dot"
                style={{ background: NODE_TYPE_COLORS[selectedNode.type] ?? '#757575' }}
              />
              <strong className="kg-panel-name">{selectedNode.label}</strong>
              <button
                type="button"
                className="kg-panel-close"
                onClick={() => setSelectedId(null)}
                aria-label="×"
              >
                ×
              </button>
            </div>
            <div className="kg-panel-meta">
              <span className="kg-badge">{NODE_TYPE_LABEL(language)[selectedNode.type] ?? selectedNode.type}</span>
              <span>
                {adjacency.get(selectedNode.id)?.length ?? 0} {t.degree}
              </span>
              {selectedNode.group && <span className="kg-group">{selectedNode.group}</span>}
            </div>

            <div className="kg-panel-actions">
              {selectedNode.type === 'mountain' && (
                <Link
                  className="kg-panel-link"
                  href={`/shanhaijin/map#${encodeURIComponent(selectedNode.label)}`}
                >
                  → /shanhaijin/map#{selectedNode.label}
                </Link>
              )}
              {focusNodeId === selectedNode.id ? (
                <button type="button" className="kg-panel-link" onClick={() => setFocusNodeId(null)}>
                  ⊘ clear focus
                </button>
              ) : (
                <button
                  type="button"
                  className="kg-panel-link"
                  onClick={() => setFocusNodeId(selectedNode.id)}
                >
                  ◎ focus neighbors
                </button>
              )}
            </div>

            <h2 className="kg-panel-h">{t.connections}</h2>
            <ul className="kg-panel-list">
              {(adjacency.get(selectedNode.id) ?? []).map(({ edge, otherId }) => {
                const other = nodeById.get(otherId)
                return (
                  <li key={`${edge.source}|${edge.target}|${edge.relation}`}>
                    <span
                      className="kg-panel-rel"
                      style={{ background: RELATION_COLORS[edge.relation] ?? '#757575' }}
                    >
                      {t[RELATION_I18N[edge.relation]] ?? edge.relation}
                    </span>
                    <button
                      type="button"
                      className="kg-panel-other"
                      onClick={() => setSelectedId(otherId)}
                    >
                      <span
                        className="kg-panel-dot sm"
                        style={{
                          background: NODE_TYPE_COLORS[other?.type ?? 'other'] ?? '#757575',
                        }}
                      />
                      {other?.label ?? otherId}
                    </button>
                  </li>
                )
              })}
            </ul>
          </aside>
        )}
      </div>

      {/* ── 图例 ── */}
      <footer className="kg-legend">
        {Object.keys(NODE_TYPE_COLORS).map((type) => (
          <span key={type} className="kg-legend-item">
            <span className="kg-panel-dot" style={{ background: NODE_TYPE_COLORS[type] }} />
            {NODE_TYPE_LABEL(language)[type] ?? type}
          </span>
        ))}
      </footer>
    </div>
  )
}

/* ── 子组件 ───────────────────────────────────────────────────── */

/** 节点类型本地化标签 */
function NODE_TYPE_LABEL(lang: 'en' | 'zh'): Record<string, string> {
  return {
    mountain: lang === 'zh' ? '山' : 'Mountain',
    creature: lang === 'zh' ? '异兽' : 'Creature',
    product: lang === 'zh' ? '物产' : 'Product',
    water: lang === 'zh' ? '水' : 'Water',
    plant: lang === 'zh' ? '草木' : 'Plant',
    polity: lang === 'zh' ? '国/邦' : 'Polity',
    deity: lang === 'zh' ? '神/人' : 'Deity',
    other: lang === 'zh' ? '其他' : 'Other',
  }
}

/** 单个节点（圆 + 文字），memo 避免无关重绘 */
interface GraphNodeShapeProps {
  node: GraphNode & { x: number; y: number; showLabel?: boolean }
  dim: boolean
  selected: boolean
  onPointerDown: (e: React.PointerEvent, id: string) => void
  onEnter: () => void
  onLeave: () => void
}

const GraphNodeShape = React.memo(function GraphNodeShape({
  node,
  dim,
  selected,
  onPointerDown,
  onEnter,
  onLeave,
}: GraphNodeShapeProps) {
  // 由力导向布局的碰撞检测决定显示哪些标签；选中节点始终显示
  const showLabel = node.showLabel === true || selected
  return (
    <g
      className={selected ? 'node sel' : dim ? 'node dim' : 'node'}
      transform={`translate(${node.x},${node.y})`}
      onPointerDown={(e) => onPointerDown(e, node.id)}
      onPointerEnter={onEnter}
      onPointerLeave={onLeave}
      style={{ cursor: 'grab' }}
    >
      <circle r={node.size} fill={NODE_TYPE_COLORS[node.type] ?? '#757575'} stroke="#fff" strokeWidth={1.2} />
      {showLabel && (
        <text className="node-label" y={node.size + 11} textAnchor="middle">
          {node.label}
        </text>
      )}
      {/* 命中区域放大，方便拖拽/点击 */}
      <circle r={Math.max(node.size + 4, 12)} fill="transparent" />
    </g>
  )
})
