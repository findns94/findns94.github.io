/**
 * 《山海经》实体索引 —— 纯函数层（无 React / 无 DOM / 无 fs）。
 *
 * 数据来源：`public/shanhaijing/data.json`（由 scripts/build-shanhaijing-data.mjs 生成）。
 * 本模块只做「数据 → 数据」的纯计算，供 client component 消费：
 *   - `buildEntityIndex` 把 entities[] 建成按类型分组、按典名索引的结构
 *   - `getEntityRelations` 汇总某实体的山系出没 / 物产 / 栖息 / 其他关系
 *   - `searchEntities` 按典名 / 显示名模糊搜索
 *   - `getEntitiesByType` 取某类型下的实体列表
 *   - `normalizeEntityName` 做 URL slug ↔ 典名双向转换
 *
 * 本模块不读取任何文件，调用方负责把 JSON 解析后传入。
 */

import type { Sighting, Product } from '@/lib/shanhaijing-map'

/* ── 数据契约（与 public/shanhaijing/data.json 对齐） ───────────────── */

export interface EntityItem {
  typeKey: string
  symbol: string
  canonical: string
  display: string
  pn: string | null
  chapter: string | null
}

export interface TaxonomyEntry {
  subclass: string
  level: string
  confidence: number
}

export interface EntityIndex {
  /** typeKey → 实体列表（按数据原序） */
  byType: Record<string, EntityItem[]>
  /** 典名 → 实体（含 taxonomy，若该类型有分类表） */
  byName: Map<string, EntityItem & { taxonomy?: TaxonomyEntry }>
  /** typeKey → (典名 → TaxonomyEntry) */
  taxonomyByType: Record<string, Record<string, TaxonomyEntry>>
  /** 所有出现过的 typeKey（按数据首次出现顺序） */
  typeOrder: string[]
}

export interface EntityRelationEntry {
  name: string
  relation: string
  direction: string
}

export interface EntityRelations {
  /** 实体出没的山名（含 sightings 与 inhabits 反查） */
  mountains: string[]
  /** 该山出产的物产名（仅山类型有值） */
  produces: string[]
  /** 栖息于该山的生物名（仅山类型有值） */
  inhabitedBy: string[]
  /** 其他关系（produces / inhabits / has_efficacy / descends_from / alias_of / same_as 等） */
  related: EntityRelationEntry[]
  /** 原文摘录（去重后的 context 列表） */
  passages: string[]
}

/* ── URL slug ↔ typeKey 映射 ───────────────────────────────────────── */

/**
 * URL slug → typeKey。
 * 多数类型 slug 与 typeKey 同形，仅 bird_beast 用连字符（bird-beast）。
 */
export function slugToTypeKey(slug: string): string {
  return slug.replace(/-/g, '_')
}

/* ── 典名归一化（URL slug 双向转换） ─────────────────────────────── */

/**
 * 把典名转成 URL slug：NFKC → 小写 → 去空白 → 非 [a-z0-9一-鿿] 字符转连字符。
 * 中文保留原样（URL 里用 encodeURIComponent 百分号编码），只处理 ASCII 部分。
 */
export function entityNameToSlug(name: string): string {
  return name
    .normalize('NFKC')
    .toLowerCase()
    .replace(/\s+/g, '-')
    .replace(/[^a-z0-9一-鿿-]+/g, '-')
    .replace(/-+/g, '-')
    .replace(/^-|-$/g, '')
}

/**
 * URL slug → 典名候选：NFKC 归一化后去连字符、去空白。
 * 注意：典名里的中文可能被 slug 保留，但 ASCII 部分的大小写/连字符信息已丢失，
 * 因此 `getEntityBySlug` 需要在 `byName` 里做归一化匹配。
 */
export function normalizeEntitySlug(slug: string): string {
  return slug
    .normalize('NFKC')
    .toLowerCase()
    .replace(/-/g, '')
    .replace(/\s+/g, '')
}

/* ── 索引构建 ─────────────────────────────────────────────────────── */

/**
 * 把 entities[] 建成索引：按类型分组 + 按典名建 Map + 挂载 taxonomy。
 *
 * - `byName` 保留首次出现的实体（同名跨卷重出时取首条，与 buildByName 一致）。
 * - 典名同时写入归一化键（`normalizeEntitySlug(canonical)`），使 URL slug 能命中。
 * - taxonomy 按 typeKey 挂载：仅当该类型在 taxonomy 表里时才写入 `taxonomy` 字段。
 */
export function buildEntityIndex(
  entities: EntityItem[],
  taxonomy: Record<string, Record<string, TaxonomyEntry>>,
): EntityIndex {
  const byType: Record<string, EntityItem[]> = {}
  const byName = new Map<string, EntityItem & { taxonomy?: TaxonomyEntry }>()
  const taxonomyByType: Record<string, Record<string, TaxonomyEntry>> = {}
  const typeOrder: string[] = []
  const seenType = new Set<string>()
  const seenNorm = new Set<string>()

  // taxonomy 表按 typeKey 复制（浅拷贝，避免外部修改影响）
  for (const [tk, map] of Object.entries(taxonomy)) {
    taxonomyByType[tk] = map
  }

  for (const e of entities) {
    // 按类型分组
    if (!byType[e.typeKey]) {
      byType[e.typeKey] = []
      if (!seenType.has(e.typeKey)) {
        seenType.add(e.typeKey)
        typeOrder.push(e.typeKey)
      }
    }
    byType[e.typeKey].push(e)

    // 按典名索引（保留首次出现）
    if (!byName.has(e.canonical)) {
      const tax = taxonomy[e.typeKey]?.[e.canonical]
      byName.set(e.canonical, tax ? { ...e, taxonomy: tax } : { ...e })

      // 归一化键（URL slug 命中用）
      const norm = normalizeEntitySlug(e.canonical)
      if (norm && !seenNorm.has(norm)) {
        seenNorm.add(norm)
        byName.set(norm, tax ? { ...e, taxonomy: tax } : { ...e })
      }
    }
  }

  return { byType, byName, taxonomyByType, typeOrder }
}

/* ── 关系汇总 ─────────────────────────────────────────────────────── */

/** 最大原文摘录条数（避免详情页过长） */
const MAX_PASSAGES = 12

/**
 * 汇总某实体的关系：
 * - `mountains`：sightings（生物）+ inhabits 反查（以 object 为山）+ located_at（以 subject 为山）
 * - `produces`：produces 关系里 subject=该实体 的 object 列表（山 → 物产）
 * - `inhabitedBy`：inhabits 关系里 object=该实体 的 subject 列表（山 ← 生物）
 * - `related`：所有 biology/spatial 关系里涉及该实体的其他端（去重）
 * - `passages`：所有关系的 context 去重（最多 MAX_PASSAGES 条）
 */
export function getEntityRelations(
  name: string,
  sightings: Record<string, Sighting[]>,
  products: Record<string, Product[]>,
  spatialRelations: Record<string, Record<string, unknown>[]>,
  biologyRelations: Record<string, Record<string, unknown>[]>,
): EntityRelations {
  const mountains: string[] = []
  const produces: string[] = []
  const inhabitedBy: string[] = []
  const related: EntityRelationEntry[] = []
  const passages: string[] = []
  const seenMountain = new Set<string>()
  const seenRelated = new Set<string>()
  const seenPassage = new Set<string>()

  const addMountain = (m: string | null | undefined) => {
    if (m && !seenMountain.has(m)) {
      seenMountain.add(m)
      mountains.push(m)
    }
  }
  const addPassage = (ctx: unknown) => {
    if (typeof ctx === 'string' && ctx && !seenPassage.has(ctx) && passages.length < MAX_PASSAGES) {
      seenPassage.add(ctx)
      passages.push(ctx)
    }
  }
  const addRelated = (other: string, relation: string, direction: string) => {
    if (!other || other === name) return
    const key = `${relation}|${other}`
    if (seenRelated.has(key)) return
    seenRelated.add(key)
    related.push({ name: other, relation, direction })
  }

  // 1) sightings：生物 → 山
  const sigs = sightings[name]
  if (sigs) {
    for (const s of sigs) {
      addMountain(s.mountain)
    }
  }

  // 2) products：mountain_id (PN) → 物产列表
  //    若该实体是山，用 pn 作为 mountain_id 查 products
  //    注意：这里需要外部传入 pn，因此 produces 在调用方按需查询

  // 3) spatialRelations：located_at / water_connect / adjacent_to / distance_from / in_chain
  for (const list of Object.values(spatialRelations)) {
    for (const r of list) {
      const subject = r.subject as string | undefined
      const object = r.object as string | undefined
      const relation = r.relation as string | undefined
      const direction = (r.direction as string | undefined) ?? ''

      if (subject === name) {
        addPassage(r.context)
        addRelated(object ?? '', relation ?? '', direction)
        // located_at: subject=山, object=水域 → 山的「位于」关系
        if (relation === 'located_at') {
          // 不把水域当山
        } else if (relation === 'adjacent_to' || relation === 'in_chain' || relation === 'distance_from') {
          addMountain(object)
        }
      }
      if (object === name) {
        addPassage(r.context)
        addRelated(subject ?? '', relation ?? '', direction)
        if (relation === 'adjacent_to' || relation === 'in_chain' || relation === 'distance_from') {
          addMountain(subject)
        }
      }
    }
  }

  // 4) biologyRelations：produces / inhabits / has_efficacy / sacrificed_at / descends_from / alias_of / same_as
  for (const [relType, list] of Object.entries(biologyRelations)) {
    for (const r of list) {
      const subject = r.subject as string | undefined
      const object = r.object as string | undefined
      const direction = (r.direction as string | undefined) ?? ''

      if (subject === name) {
        addPassage(r.context)
        addRelated(object ?? '', relType, direction)
        if (relType === 'produces') produces.push(object ?? '')
      }
      if (object === name) {
        addPassage(r.context)
        addRelated(subject ?? '', relType, direction)
        if (relType === 'inhabits') inhabitedBy.push(subject ?? '')
      }
    }
  }

  // Fallback: for entities with no structured relations, extract passages
  // where the entity name appears as an inline 〖〗 marker
  if (passages.length === 0) {
    const inlineRe = new RegExp(`〖[^〗]*${name.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')}[^〗]*〗`)

    for (const list of Object.values(spatialRelations)) {
      for (const r of list) {
        if (r.context && typeof r.context === 'string' && inlineRe.test(r.context)) {
          addPassage(r.context)
        }
      }
    }
    for (const list of Object.values(biologyRelations)) {
      for (const r of list) {
        if (r.context && typeof r.context === 'string' && inlineRe.test(r.context)) {
          addPassage(r.context)
        }
      }
    }
  }

  return { mountains, produces, inhabitedBy, related, passages }
}

/**
 * 取某山的物产列表（通过 pn 作为 mountain_id 查 products）。
 * 在 `getEntityRelations` 之外单独提供，因为需要 entity.pn。
 */
export function getMountainProducts(
  pn: string | null,
  products: Record<string, Product[]>,
): Product[] {
  if (!pn) return []
  return products[pn] ?? []
}

/* ── 查询 ─────────────────────────────────────────────────────────── */

/**
 * 按典名精确查找（含归一化键，使 URL slug 能命中）。
 */
export function getEntityBySlug(
  slug: string,
  index: EntityIndex,
): (EntityItem & { taxonomy?: TaxonomyEntry }) | undefined {
  // 1) 直接命中
  const direct = index.byName.get(slug)
  if (direct) return direct

  // 2) 归一化命中（slug → 归一化键）
  const norm = normalizeEntitySlug(slug)
  return index.byName.get(norm)
}

/**
 * 按典名精确查找（不含归一化，用于内部调用）。
 */
export function getEntityByName(
  name: string,
  index: EntityIndex,
): (EntityItem & { taxonomy?: TaxonomyEntry }) | undefined {
  return index.byName.get(name)
}

/**
 * 搜索：对 canonical / display 做大小写不敏感的子串匹配。
 * 结果按「典名包含查询词」优先，最多返回 `limit` 条。
 */
export function searchEntities(query: string, index: EntityIndex, limit = 30): EntityItem[] {
  const q = query.trim().toLowerCase()
  if (!q) return []

  const out: EntityItem[] = []
  const seen = new Set<string>()

  // 第一遍：canonical 命中
  for (const e of index.byType ? Object.values(index.byType).flat() : []) {
    if (seen.size >= limit) break
    if (seen.has(e.canonical)) continue
    if (e.canonical.toLowerCase().includes(q)) {
      seen.add(e.canonical)
      out.push(e)
    }
  }

  // 第二遍：display 命中（补足到 limit）
  if (seen.size < limit) {
    for (const e of Object.values(index.byType).flat()) {
      if (seen.size >= limit) break
      if (seen.has(e.canonical)) continue
      if (e.display.toLowerCase().includes(q)) {
        seen.add(e.canonical)
        out.push(e)
      }
    }
  }

  return out.slice(0, limit)
}

/**
 * 取某类型下的实体列表（按数据原序）。
 */
export function getEntitiesByType(typeKey: string, index: EntityIndex): EntityItem[] {
  return index.byType[typeKey] ?? []
}
