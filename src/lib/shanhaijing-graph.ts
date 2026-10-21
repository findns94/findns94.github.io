/**
 * 《山海经》知识图谱 —— 纯函数层（无 React / 无 DOM / 无 fs）。
 *
 * 输入：`public/shanhaijing/data.json` 的 `spatialRelations` / `biologyRelations`
 *       （由 scripts/build-shanhaijing-data.mjs 生成）。
 * 输出：`GraphData`（节点 / 边）与 `ForceDirectedResult`（带坐标的布局结果）。
 *
 * 本模块不读取任何文件，调用方负责把 JSON 解析后传入。
 * 力导向布局（forceDirectedLayout）为自实现的 Fruchterman-Reingold 风格算法，
 * 不依赖任何外部图库。
 */

/* ── 类型契约 ─────────────────────────────────────────────────── */

export interface GraphNode {
  id: string
  label: string
  /** mountain | creature | product | water | plant | polity | deity | other */
  type: string
  /** 章节 / 山系名（可选，用于分组着色提示） */
  group?: string
  /** 基于连接度（degree）的视觉大小 */
  size: number
}

export interface GraphEdge {
  /** 节点 id（即 GraphNode.id） */
  source: string
  /** 目标节点 id */
  target: string
  /** produces | inhabits | has_efficacy | adjacent_to | distance_from | water_connect | … */
  relation: string
  /** 权重：大多数关系为 1；重复证据合并后 >1（边更粗） */
  weight: number
}

export interface GraphData {
  nodes: GraphNode[]
  edges: GraphEdge[]
}

export interface LayoutNode extends GraphNode {
  x: number
  y: number
  vx: number
  vy: number
  showLabel?: boolean
}

export interface ForceDirectedResult {
  nodes: LayoutNode[]
  edges: GraphEdge[]
  bounds: { minX: number; maxX: number; minY: number; maxY: number }
}

/** data.json 里关系条目的最小形状（字段均为可选，模块只做防御式读取） */
export interface RelationEntry {
  subject?: string
  object?: string
  relation?: string
  chapter?: string
  chain?: string
  [key: string]: unknown
}

/* ── 常量 ─────────────────────────────────────────────────────── */

/** 默认纳入图谱的关系类型（保持可读；in_chain 与 adjacent_to 高度冗余，默认不激活） */
export const DEFAULT_RELATION_TYPES = [
  'produces',
  'inhabits',
  'has_efficacy',
  'adjacent_to',
  'water_connect',
] as const

/** 全部可选关系类型（供筛选 UI 渲染复选框） */
export const ALL_RELATION_TYPES = [
  'produces',
  'inhabits',
  'has_efficacy',
  'adjacent_to',
  'distance_from',
  'water_connect',
  'located_at',
  'in_chain',
  'sacrificed_at',
  'descends_from',
  'alias_of',
  'same_as',
] as const

export type RelationType = (typeof ALL_RELATION_TYPES)[number]

/** 节点大小：基础值 + 按 degree 的平方根缩放（上限 cap） */
const NODE_SIZE_BASE = 4
const NODE_SIZE_PER_DEGREE = 1.6
const NODE_SIZE_MAX = 18

/** 节点类型配色（与 KnowledgeGraph.tsx 的 NODE_COLORS 保持一致） */
export const NODE_TYPE_COLORS: Record<string, string> = {
  mountain: '#2e7d32',
  creature: '#e65100',
  product: '#7b1fa2',
  water: '#1565c0',
  plant: '#558b2f',
  polity: '#5d4037',
  deity: '#f9a825',
  other: '#757575',
}

/** 边（关系类型）配色 */
export const RELATION_COLORS: Record<string, string> = {
  produces: '#7b1fa2',
  inhabits: '#e65100',
  has_efficacy: '#00838f',
  adjacent_to: '#2e7d32',
  distance_from: '#558b2f',
  water_connect: '#1565c0',
  located_at: '#00838f',
  in_chain: '#9e9e9e',
  sacrificed_at: '#5d4037',
  descends_from: '#f9a825',
  alias_of: '#8e24aa',
  same_as: '#c62828',
}

/* ── 内部工具 ─────────────────────────────────────────────────── */

/**
 * data.json 的 `entities[].typeKey` → 图谱节点类型。
 * 产物（桂 / 金 / 玉 / 棪木等）在数据里是 `mineral`，图谱中归为 `product`；
 * `bird_beast` 并入 `creature`；`person`（帝俊 / 少昊等神话人物）并入 `deity`。
 */
export function mapEntityType(typeKey: string | undefined): string {
  switch (typeKey) {
    case 'mountain':
      return 'mountain'
    case 'creature':
    case 'bird_beast':
      return 'creature'
    case 'mineral':
      return 'product'
    case 'plant':
      return 'plant'
    case 'water':
      return 'water'
    case 'polity':
      return 'polity'
    case 'deity':
    case 'person':
      return 'deity'
    default:
      return 'other'
  }
}

/**
 * 关系两端在「无 entities 索引」时的类型推断（按关系语义）。
 * endpoints: 'subject' | 'object'
 */
function inferTypeByRole(relation: string, endpoint: 'subject' | 'object'): string {
  switch (relation) {
    case 'produces':
      return endpoint === 'subject' ? 'mountain' : 'product'
    case 'inhabits':
      return endpoint === 'subject' ? 'creature' : 'mountain'
    case 'has_efficacy':
      return endpoint === 'subject' ? 'creature' : 'other'
    case 'sacrificed_at':
      return endpoint === 'subject' ? 'other' : 'mountain'
    case 'descends_from':
    case 'same_as':
    case 'alias_of':
      return 'creature' // 默认；alias_of/same_as 多为神祇/异兽
    case 'located_at':
      return endpoint === 'subject' ? 'mountain' : 'water'
    default:
      return 'other'
  }
}

/** 计算节点视觉大小：degree 越高越大，平方根压缩长尾 */
function sizeForDegree(degree: number): number {
  const s = NODE_SIZE_BASE + Math.sqrt(degree) * NODE_SIZE_PER_DEGREE
  return Math.min(NODE_SIZE_MAX, Math.round(s * 10) / 10)
}

/* ── 构建图谱 ─────────────────────────────────────────────────── */

/**
 * 由关系数据构建图谱。
 *
 * - 按 `relationTypes` 过滤（默认 DEFAULT_RELATION_TYPES，保持可读）；
 * - 同 (source, target, relation) 的多条证据合并为一条边，weight = 证据数；
 * - 去除自环；
 * - 节点类型优先由 `entities`（data.json 的 entities 数组）查 typeKey 得到，
 *   查不到时按关系语义推断；
 * - 节点数超过 `maxNodes`（默认 200）时，保留度数最高的节点。
 *
 * @param spatialRelations data.json 的 spatialRelations
 * @param biologyRelations data.json 的 biologyRelations
 * @param maxNodes         保留的最大节点数（按度数截断）
 * @param entities         data.json 的 entities（可选，用于精确类型）
 * @param relationTypes    纳入的关系类型（默认 DEFAULT_RELATION_TYPES）
 */
export function buildGraphData(
  spatialRelations: Record<string, RelationEntry[] | undefined> | null | undefined,
  biologyRelations: Record<string, RelationEntry[] | undefined> | null | undefined,
  maxNodes = 200,
  entities?: Array<{ canonical?: string; typeKey?: string; display?: string }> | null,
  relationTypes: readonly string[] = DEFAULT_RELATION_TYPES,
): GraphData {
  // 名称 → 节点类型（来自 entities 索引）
  const typeByName = new Map<string, string>()
  const displayByName = new Map<string, string>()
  if (entities) {
    for (const e of entities) {
      if (!e?.canonical) continue
      typeByName.set(e.canonical, mapEntityType(e.typeKey))
      if (e.display && e.display !== e.canonical) displayByName.set(e.canonical, e.display)
    }
  }

  // 去重合并边：key = source|target|relation
  const edgeMap = new Map<string, GraphEdge>()
  // 度数统计（合并前，用于截断时排名）
  const degree = new Map<string, number>()
  // 每个名称的类型（可能来自多条关系，以首次 / entities 为准）
  const typeOf = new Map<string, string>()
  // 每个名称的分组（章节 / 山系）
  const groupOf = new Map<string, string>()

  const ensureType = (name: string, relation: string, endpoint: 'subject' | 'object') => {
    if (!typeOf.has(name)) {
      typeOf.set(name, typeByName.get(name) ?? inferTypeByRole(relation, endpoint))
    }
  }

  // 每个关系类型内，各节点的度数（用于按类型均衡截断，保证每种关系都有代表节点）
  const typeDegree = new Map<string, Map<string, number>>()
  const bumpTypeDegree = (name: string, relation: string) => {
    let m = typeDegree.get(relation)
    if (!m) {
      m = new Map()
      typeDegree.set(relation, m)
    }
    m.set(name, (m.get(name) ?? 0) + 1)
  }

  const addEdge = (subject: string, object: string, relation: string, group?: string) => {
    if (!subject || !object || !relation) return
    if (subject === object) return // 去自环
    ensureType(subject, relation, 'subject')
    ensureType(object, relation, 'object')
    if (group) {
      if (!groupOf.has(subject)) groupOf.set(subject, group)
      if (!groupOf.has(object)) groupOf.set(object, group)
    }
    const key = `${subject}|${object}|${relation}`
    const existing = edgeMap.get(key)
    if (existing) {
      existing.weight += 1
    } else {
      edgeMap.set(key, { source: subject, target: object, relation, weight: 1 })
    }
    degree.set(subject, (degree.get(subject) ?? 0) + 1)
    degree.set(object, (degree.get(object) ?? 0) + 1)
    bumpTypeDegree(subject, relation)
    bumpTypeDegree(object, relation)
  }

  const relSet = new Set(relationTypes)
  const allBuckets: Array<Record<string, RelationEntry[] | undefined>> = [
    spatialRelations ?? {},
    biologyRelations ?? {},
  ]
  for (const bucket of allBuckets) {
    for (const [relation, entries] of Object.entries(bucket)) {
      if (!relSet.has(relation)) continue
      const list = Array.isArray(entries) ? entries : []
      for (const entry of list) {
        if (!entry || typeof entry !== 'object') continue
        const { subject, object } = entry as RelationEntry
        if (typeof subject !== 'string' || typeof object !== 'string') continue
        const group = typeof entry.chain === 'string' ? entry.chain : undefined
        addEdge(subject, object, relation, group)
      }
    }
  }

  // 均衡截断：先给每种关系类型保留「该类型内度数最高」的 quota 个节点，
  // 保证不会因单一关系（如 produces）的节点度数整体偏高而挤掉其它关系
  // （如 inhabits 的异兽）；剩余名额再按总度数补齐到 maxNodes。
  const keep = new Set<string>()
  if (degree.size > maxNodes) {
    const activeTypes = [...typeDegree.entries()].filter(([, m]) => m.size > 0)
    const quota = Math.ceil(maxNodes / Math.max(1, activeTypes.length))
    for (const [, m] of activeTypes) {
      const ranked = [...m.entries()].sort((a, b) => b[1] - a[1])
      for (const [name] of ranked.slice(0, quota)) keep.add(name)
    }
    if (keep.size < maxNodes) {
      const ranked = [...degree.entries()]
        .filter(([n]) => !keep.has(n))
        .sort((a, b) => b[1] - a[1])
      for (const [name] of ranked.slice(0, maxNodes - keep.size)) keep.add(name)
    }
  } else {
    for (const n of degree.keys()) keep.add(n)
  }

  // 最终节点列表（按总度数降序，便于 UI 与布局稳定）
  const names = [...degree.entries()]
    .filter(([n]) => keep.has(n))
    .sort((a, b) => b[1] - a[1])

  const nodes: GraphNode[] = names.map(([name, deg]) => ({
    id: name,
    label: displayByName.get(name) ?? name,
    type: typeOf.get(name) ?? 'other',
    group: groupOf.get(name),
    size: sizeForDegree(deg),
  }))

  const edges = [...edgeMap.values()].filter((e) => keep.has(e.source) && keep.has(e.target))

  // 剪除孤立节点：均衡截断按度数保留节点，但某节点的邻居可能全部被截掉，
  // 于是它成为「无边孤立点」——UI 仍会渲染，视觉上却悬空（实测 200 保留点中
  // 有 21 个无任何边，真正连通的是 179 个）。这里只保留至少有一条边的节点。
  const connected = new Set<string>()
  for (const e of edges) {
    connected.add(e.source)
    connected.add(e.target)
  }
  const connectedNodes = nodes.filter((n) => connected.has(n.id))

  return { nodes: connectedNodes, edges }
}

/* ── 力导向布局 ───────────────────────────────────────────────── */

/**
 * Fruchterman-Reingold 风格力导向布局（自实现，无外部依赖）。
 *
 * - 节点间斥力：f = k² / d
 * - 边引力：f = d² / k
 * - 向心重力：防止连通分量飞出画布
 * - 温度冷却：位移逐轮受限并衰减，保证收敛
 *
 * @param graph          图谱数据
 * @param width          画布宽（默认 1400）
 * @param height         画布高（默认 900）
 * @param maxIterations  迭代轮数（默认 300）
 */
export function forceDirectedLayout(
  graph: GraphData,
  width = 1400,
  height = 900,
  maxIterations = 300,
): ForceDirectedResult {
  const n = graph.nodes.length
  if (n === 0) {
    return { nodes: [], edges: graph.edges, bounds: { minX: 0, maxX: 0, minY: 0, maxY: 0 } }
  }

  // 理想边长：面积 / 节点数开方
  const k = Math.sqrt((width * height) / n)
  // 初始温度与冷却
  const t0 = Math.min(width, height) / 10
  const cooling = t0 / (maxIterations + 1)
  // 向心重力系数
  const gravity = 0.1

  const idToIndex = new Map<string, number>()
  const nodes: LayoutNode[] = graph.nodes.map((nd, i) => {
    idToIndex.set(nd.id, i)
    return {
      ...nd,
      x: width / 2 + (Math.random() - 0.5) * width * 0.9,
      y: height / 2 + (Math.random() - 0.5) * height * 0.9,
      vx: 0,
      vy: 0,
    }
  })

  // 预解析边两端下标
  const edges = graph.edges
    .map((e) => ({ si: idToIndex.get(e.source), ti: idToIndex.get(e.target), e }))
    .filter((p): p is { si: number; ti: number; e: GraphEdge } =>
      p.si !== undefined && p.ti !== undefined,
    )

  let temp = t0

  for (let iter = 0; iter < maxIterations; iter++) {
    // 1) 斥力：所有节点对
    for (let i = 0; i < n; i++) {
      const a = nodes[i]
      for (let j = i + 1; j < n; j++) {
        const b = nodes[j]
        let dx = a.x - b.x
        let dy = a.y - b.y
        let d2 = dx * dx + dy * dy
        if (d2 < 0.01) {
          dx = Math.random() - 0.5
          dy = Math.random() - 0.5
          d2 = dx * dx + dy * dy + 0.01
        }
        const d = Math.sqrt(d2)
        const f = (k * k) / d
        const fx = (dx / d) * f
        const fy = (dy / d) * f
        a.vx += fx
        a.vy += fy
        b.vx -= fx
        b.vy -= fy
      }
    }

    // 2) 引力：沿边
    for (let e = 0; e < edges.length; e++) {
      const { si, ti } = edges[e]
      const a = nodes[si]
      const b = nodes[ti]
      const dx = b.x - a.x
      const dy = b.y - a.y
      const d = Math.sqrt(dx * dx + dy * dy) || 0.01
      const f = (d * d) / k
      const fx = (dx / d) * f
      const fy = (dy / d) * f
      a.vx += fx
      a.vy += fy
      b.vx -= fx
      b.vy -= fy
    }

    // 3) 重力 + 应用位移（受温度限制）
    for (let i = 0; i < n; i++) {
      const nd = nodes[i]
      nd.vx += (width / 2 - nd.x) * gravity
      nd.vy += (height / 2 - nd.y) * gravity
      const disp = Math.sqrt(nd.vx * nd.vx + nd.vy * nd.vy)
      if (disp > 0.01) {
        const scale = Math.min(disp, temp) / disp
        nd.x += nd.vx * scale
        nd.y += nd.vy * scale
      }
      nd.vx = 0
      nd.vy = 0
    }

    temp -= cooling
    if (temp < 0.5) temp = 0.5
  }

  // ── 连通分量独立布局 ──
  // BFS 找连通分量
  const adjacency = new Map<string, string[]>()
  for (const e of graph.edges) {
    if (!adjacency.has(e.source)) adjacency.set(e.source, [])
    if (!adjacency.has(e.target)) adjacency.set(e.target, [])
    adjacency.get(e.source)!.push(e.target)
    adjacency.get(e.target)!.push(e.source)
  }

  const visited = new Set<string>()
  const components: number[][] = []
  for (let i = 0; i < n; i++) {
    if (visited.has(nodes[i].id)) continue
    const component: number[] = []
    const queue = [i]
    visited.add(nodes[i].id)
    while (queue.length > 0) {
      const idx = queue.shift()!
      component.push(idx)
      const nbs = adjacency.get(nodes[idx].id) ?? []
      for (const nbId of nbs) {
        const nbIdx = idToIndex.get(nbId)
        if (nbIdx !== undefined && !visited.has(nbId)) {
          visited.add(nbId)
          queue.push(nbIdx)
        }
      }
    }
    components.push(component)
  }

  // 按分量大小降序排列（大分量优先占好位置）
  components.sort((a, b) => b.length - a.length)

  // 网格布局：将各分量放入独立网格单元
  const pad = 48
  const compCount = components.length
  const cols = Math.ceil(Math.sqrt(compCount))
  const rows = Math.ceil(compCount / cols)
  const cellW = (width - pad * 2) / cols
  const cellH = (height - pad * 2) / rows

  for (let ci = 0; ci < compCount; ci++) {
    const component = components[ci]
    const col = ci % cols
    const row = Math.floor(ci / cols)
    const cellX = pad + col * cellW
    const cellY = pad + row * cellH

    // 计算该分量的边界
    let cMinX = Infinity, cMaxX = -Infinity, cMinY = Infinity, cMaxY = -Infinity
    for (const idx of component) {
      const nd = nodes[idx]
      const r = nd.size + 2
      if (nd.x - r < cMinX) cMinX = nd.x - r
      if (nd.x + r > cMaxX) cMaxX = nd.x + r
      if (nd.y - r < cMinY) cMinY = nd.y - r
      if (nd.y + r > cMaxY) cMaxY = nd.y + r
    }

    const spanX = Math.max(1, cMaxX - cMinX)
    const spanY = Math.max(1, cMaxY - cMinY)
    const scale = Math.min(cellW / spanX, cellH / spanY)
    const offX = cellX + (cellW - spanX * scale) / 2
    const offY = cellY + (cellH - spanY * scale) / 2

    for (const idx of component) {
      const nd = nodes[idx]
      nd.x = (nd.x - cMinX) * scale + offX
      nd.y = (nd.y - cMinY) * scale + offY
    }
  }

  // ── 标签碰撞检测 ──
  const labelRects = nodes.map(nd => {
    const labelWidth = nd.label.length * 11
    const labelHeight = 14
    return {
      x: nd.x - labelWidth / 2,
      y: nd.y + nd.size + 2,
      w: labelWidth,
      h: labelHeight,
      node: nd,
    }
  })

  labelRects.sort((a, b) => b.node.size - a.node.size)

  const placedRects: typeof labelRects = []
  for (const rect of labelRects) {
    const overlaps = placedRects.some(p =>
      rect.x < p.x + p.w && rect.x + rect.w > p.x &&
      rect.y < p.y + p.h && rect.y + rect.h > p.y
    )
    if (!overlaps || rect.node.size >= 12) {
      placedRects.push(rect)
      rect.node.showLabel = true
    } else {
      rect.node.showLabel = false
    }
  }

  // 最终边界
  let minX = Infinity
  let maxX = -Infinity
  let minY = Infinity
  let maxY = -Infinity
  for (const nd of nodes) {
    const r = nd.size + 2
    if (nd.x - r < minX) minX = nd.x - r
    if (nd.x + r > maxX) maxX = nd.x + r
    if (nd.y - r < minY) minY = nd.y - r
    if (nd.y + r > maxY) maxY = nd.y + r
  }

  return { nodes, edges: graph.edges, bounds: { minX, maxX, minY, maxY } }
}

/* ── 筛选与子图 ───────────────────────────────────────────────── */

/**
 * 按关系类型筛选图谱：只保留 relation ∈ relationTypes 的边，
 * 并丢弃因此变为孤立节点的节点。
 */
export function filterByRelationType(graph: GraphData, relationTypes: string[]): GraphData {
  const keep = new Set(relationTypes)
  const edges = graph.edges.filter((e) => keep.has(e.relation))
  const used = new Set<string>()
  for (const e of edges) {
    used.add(e.source)
    used.add(e.target)
  }
  const nodes = graph.nodes.filter((nd) => used.has(nd.id))
  return { nodes, edges }
}

/**
 * 取某节点的 depth 跳邻域子图（BFS）。
 * 返回的子图包含起点、可达节点，以及这些节点之间的所有边。
 */
export function getConnectedSubgraph(graph: GraphData, nodeId: string, depth: number): GraphData {
  if (depth < 0 || !graph.nodes.some((nd) => nd.id === nodeId)) {
    return { nodes: [], edges: [] }
  }

  const adjacency = new Map<string, Set<string>>()
  for (const e of graph.edges) {
    if (!adjacency.has(e.source)) adjacency.set(e.source, new Set())
    if (!adjacency.has(e.target)) adjacency.set(e.target, new Set())
    adjacency.get(e.source)!.add(e.target)
    adjacency.get(e.target)!.add(e.source)
  }

  const included = new Set<string>([nodeId])
  let frontier = [nodeId]
  for (let d = 0; d < depth; d++) {
    const next: string[] = []
    for (const id of frontier) {
      const nb = adjacency.get(id)
      if (!nb) continue
      for (const m of nb) {
        if (!included.has(m)) {
          included.add(m)
          next.push(m)
        }
      }
    }
    frontier = next
    if (frontier.length === 0) break
  }

  const nodes = graph.nodes.filter((nd) => included.has(nd.id))
  const edges = graph.edges.filter((e) => included.has(e.source) && included.has(e.target))
  return { nodes, edges }
}
