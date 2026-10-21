/**
 * 《山海经》山系全景图 —— 纯函数层（无 React / 无 DOM / 无 fs）。
 *
 * 单山系地铁图风格布局：山节点从左到右排列。
 * 方位 + 里程决定相对偏移，距离按里数缩放后归一化到合理宽度。
 *
 * 数据契约：`public/shanhaijing/data.json`
 */

import type { Line, Sighting, Product } from '@/lib/shanhaijing-map'

/* ── 类型定义 ─────────────────────────────────────────────────── */

export interface PanoramaNode {
  id: string
  name: string
  x: number
  y: number
  seq: number
  direction: string | null
  distanceLi: number | null
  distanceText: string | null
  confidence: string
  isFirst: boolean
  creatures: string[]
  productsCount: number
  water: string | null
}

export interface PanoramaChain {
  id: string
  name: string
  label: string
  color: string
  group: string
  chapterName: string
  nodes: PanoramaNode[]
  totalLi: number
}

export interface PanoramaLayout {
  chain: PanoramaChain
  bounds: { minX: number; maxX: number; minY: number; maxY: number }
}

/* ── 方位向量表 ───────────────────────────────────────────────── */

/** 方位 → [dx, dy] 单位向量（南 = +y 向下，北 = -y 向上） */
const DIRECTION_VECTORS: Record<string, [number, number]> = {
  东: [1, 0],
  西: [-1, 0],
  南: [0, 1],
  北: [0, -1],
  东南: [1, 1],
  东北: [1, -1],
  西南: [-1, 1],
  西北: [-1, -1],
  东偏南: [1, 0.5],
  东偏北: [1, -0.5],
  南偏东: [0.5, 1],
  南偏西: [-0.5, 1],
  西偏南: [-1, 0.5],
  西偏北: [-1, -0.5],
  北偏东: [0.5, -1],
  北偏西: [-0.5, -1],
}

/** 解析方位字符串为 [dx, dy] 向量 */
function parseDirection(dir: string | null): [number, number] | null {
  if (!dir) return null
  const v = DIRECTION_VECTORS[dir]
  if (v) return v
  // 尝试模糊匹配
  for (const key of Object.keys(DIRECTION_VECTORS)) {
    if (dir.includes(key)) return DIRECTION_VECTORS[key]
  }
  return null
}

/* ── 布局常量 ─────────────────────────────────────────────────── */

/** 最小节点间距 */
const MIN_NODE_SPACING = 24

/** 碰撞检测最小像素间距（node radius 7 + 视觉间隙） */
const COLLISION_DIST = 24

/** 左右内边距 */
const PADDING_X = 60

/** 上下内边距 */
const PADDING_Y = 40

/** 垂直方向最大偏移（保持扁平布局） */
const MAX_Y_OFFSET = 60

/* ── 碰撞辅助 ─────────────────────────────────────────────────── */

/** 检测聚类（间距 < minDist 的连通分量）并均匀分布 */
function resolveClusters(nodes: PanoramaNode[], minDist: number): boolean {
  if (nodes.length < 2) return false

  // 构建邻接表（间距 < minDist 的节点相连）
  const adj = new Map<number, number[]>()
  for (let i = 0; i < nodes.length; i++) adj.set(i, [])
  for (let i = 0; i < nodes.length; i++) {
    for (let j = i + 1; j < nodes.length; j++) {
      const dx = nodes[j].x - nodes[i].x
      const dy = nodes[j].y - nodes[i].y
      if (Math.sqrt(dx * dx + dy * dy) < minDist) {
        adj.get(i)!.push(j)
        adj.get(j)!.push(i)
      }
    }
  }

  // BFS 找连通分量
  const visited = new Set<number>()
  let anySpread = false

  for (let start = 0; start < nodes.length; start++) {
    if (visited.has(start)) continue
    const cluster: number[] = []
    const queue = [start]
    visited.add(start)
    while (queue.length > 0) {
      const idx = queue.pop()!
      cluster.push(idx)
      for (const nb of adj.get(idx)!) {
        if (!visited.has(nb)) {
          visited.add(nb)
          queue.push(nb)
        }
      }
    }

    if (cluster.length < 2) continue

    // 按序号排序后均匀分布
    cluster.sort((a, b) => nodes[a].seq - nodes[b].seq)
    const centerX =
      cluster.reduce((s, i) => s + nodes[i].x, 0) / cluster.length
    const centerY =
      cluster.reduce((s, i) => s + nodes[i].y, 0) / cluster.length

    const totalWidth = (cluster.length - 1) * minDist
    const startX = Math.max(centerX - totalWidth / 2, PADDING_X)
    for (let k = 0; k < cluster.length; k++) {
      const node = nodes[cluster[k]]
      const newX = startX + k * minDist
      const newY = centerY + (k % 2 === 0 ? -8 : 8) // 上下交错
      if (Math.abs(newX - node.x) > 0.5 || Math.abs(newY - node.y) > 0.5) {
        node.x = newX
        node.y = newY
        anySpread = true
      }
    }
  }

  return anySpread
}

function pushApart(a: PanoramaNode, b: PanoramaNode, minDist: number): boolean {
  const dx = b.x - a.x
  const dy = b.y - a.y
  const dist = Math.sqrt(dx * dx + dy * dy)
  if (dist >= minDist) return false

  const overlap = (minDist - dist) / 2
  const angle = dist > 0.001 ? Math.atan2(dy, dx) : 0
  a.x -= Math.cos(angle) * overlap
  a.y -= Math.sin(angle) * overlap
  b.x += Math.cos(angle) * overlap
  b.y -= Math.sin(angle) * overlap
  return true
}

/* ── 核心布局函数 ─────────────────────────────────────────────── */

/**
 * 单山系地铁图风格布局。
 *
 * 算法：
 * 1. 首山位于 (0, 0)
 * 2. 后续山按方位 × 里程计算相对偏移
 * 3. 归一化 x 使左边缘为 0
 * 4. 后置碰撞检测推开过近节点
 */
export function layoutChain(
  line: Line,
  sightings: Record<string, Sighting[]>,
  products: Record<string, Product[]>,
  positions: Record<string, Record<string, Record<string, any>>>,
): PanoramaChain {
  const stations = line.stations
  if (stations.length === 0) {
    return {
      id: line.id,
      name: line.name,
      label: line.label,
      color: line.color,
      group: line.group,
      chapterName: line.chapterName,
      nodes: [],
      totalLi: line.totalLi,
    }
  }

  // 构建异兽反向索引
  const creaturesByMountain = new Map<string, string[]>()
  for (const [creature, list] of Object.entries(sightings)) {
    for (const s of list) {
      const name = s.mountain
      if (!name) continue
      const arr = creaturesByMountain.get(name)
      if (arr) {
        if (!arr.includes(creature)) arr.push(creature)
      } else {
        creaturesByMountain.set(name, [creature])
      }
    }
  }

  // 物产计数
  const productsCountById = new Map<string, number>()
  for (const [mountainId, list] of Object.entries(products)) {
    productsCountById.set(mountainId, list.length)
  }

  // 查找位置信息
  const chapterPositions = positions[line.chapterId] ?? {}
  const chainPositions = chapterPositions[line.name] ?? chapterPositions[line.shanXiName ?? ''] ?? {}

  // 计算原始相对坐标
  const rawPos: Array<{ x: number; y: number }> = []
  let cx = 0
  let cy = 0

  for (let i = 0; i < stations.length; i++) {
    const st = stations[i]
    const pos = chainPositions[String(st.seq)] ?? null
    const distLi = pos?.distanceLi ?? null
    const dir = pos?.directionFromPrev ?? st.direction

    if (i === 0) {
      rawPos.push({ x: 0, y: 0 })
      cx = 0
      cy = 0
    } else {
      const vec = parseDirection(dir)
      if (vec && distLi != null && distLi > 0) {
        cx += vec[0] * distLi
        cy += vec[1] * distLi
      } else if (vec) {
        cx += vec[0] * 50
        cy += vec[1] * 50
      }
      rawPos.push({ x: cx, y: cy })
    }
  }

  // 归一化
  const minRawX = Math.min(...rawPos.map((p) => p.x))
  const maxRawX = Math.max(...rawPos.map((p) => p.x))
  const rawWidth = maxRawX - minRawX || 1

  const minRawY = Math.min(...rawPos.map((p) => p.y))
  const maxRawY = Math.max(...rawPos.map((p) => p.y))
  const rawHeight = maxRawY - minRawY || 1

  const scaleX = Math.max(MIN_NODE_SPACING * (stations.length - 1), 200) / rawWidth
  const scaleY = MAX_Y_OFFSET / Math.max(rawHeight, 1)

  const nodes: PanoramaNode[] = stations.map((st, i) => {
    const pos = chainPositions[String(st.seq)] ?? null
    const x = PADDING_X + (rawPos[i].x - minRawX) * scaleX
    const y = PADDING_Y + 40 + (rawPos[i].y - minRawY) * scaleY

    return {
      id: st.id,
      name: st.name,
      x,
      y,
      seq: st.seq,
      direction: st.direction,
      distanceLi: pos?.distanceLi ?? st.li,
      distanceText: st.distanceText,
      confidence: st.confidence,
      isFirst: st.isFirst,
      creatures: creaturesByMountain.get(st.name) ?? [],
      productsCount: productsCountById.get(st.id) ?? 0,
      water: pos?.water ?? null,
    }
  })

  // 后置碰撞检测：聚类均匀分布 + 迭代推开
  for (let round = 0; round < 500; round++) {
    let hasOverlap = resolveClusters(nodes, COLLISION_DIST)
    for (let i = 0; i < nodes.length; i++) {
      for (let j = i + 1; j < nodes.length; j++) {
        if (pushApart(nodes[i], nodes[j], COLLISION_DIST)) {
          hasOverlap = true
        }
      }
    }
    if (!hasOverlap) break
  }

  // 全局下界 clamp：确保所有节点不超出画布左边界
  for (const node of nodes) {
    if (node.x < PADDING_X) node.x = PADDING_X
  }

  return {
    id: line.id,
    name: line.name,
    label: line.label,
    color: line.color,
    group: line.group,
    chapterName: line.chapterName,
    nodes,
    totalLi: line.totalLi,
  }
}
