/**
 * 构建山海经「山形聚焦」视图所需的合并数据：public/shanhaijin/data.json
 *
 * 输入（全部只读，位于 doc/ 下，CI 环境不存在，因此产物必须提交到 git）：
 *   doc/shanhaijin/app/shanhai/data/shanhai_map_data.json  山系 / 山条目（含里程、方位）
 *   doc/shanhaijin/kg/route/ROUTE-*.json                   26 条山系方位链（取 stops[0].raw 提取山系名）
 *   doc/shanhaijin/kg/space/data/creature_sightings.json   异兽出现位置
 *   doc/shanhaijin/kg/place/data/place_products.json       物产产地
 *   doc/shanhaijin/app/shanhai/data/texts.json             山形原文
 *   ── 新增 KG 数据（Phase 1 扩展） ─────────────────────────────
 *   doc/shanhaijin/kg/entity_index.json                    2,141 个实体索引
 *   doc/shanhaijin/kg/taxonomy/taxonomy.json              133 个实体分类
 *   doc/shanhaijin/kg/entity_aliases.json                  实体别名映射
 *   doc/shanhaijin/kg/relations/spatial_relations.json     5,896 条空间关系
 *   doc/shanhaijin/kg/relations/biology_relations.json     1,217 条生物关系
 *   doc/shanhaijin/kg/disambiguation_map.json              241 条消歧记录
 *   doc/shanhaijin/kg/geo/data/mountain_positions.json      447 山方位坐标
 *
 * 输出契约（React 组件按此消费，键名一律 camelCase）：
 *   { meta, lines[], sightings{}, products{}, texts{},
 *     entities[], taxonomy{}, aliases{},
 *     spatialRelations{}, biologyRelations{}, disambiguation{}, positions{} }
 *
 * 零依赖：仅使用 node:fs / node:path / node:url。可从任意 cwd 运行。
 */
import { readFileSync, writeFileSync, mkdirSync, readdirSync, existsSync } from 'node:fs'
import { dirname, join } from 'node:path'
import { fileURLToPath } from 'node:url'
import ts from 'typescript'

const __dirname = dirname(fileURLToPath(import.meta.url))
const root = join(__dirname, '..')

// ── 路径 ────────────────────────────────────────────────────────────────
const MAP_DATA = join(root, 'doc/shanhaijin/app/shanhai/data/shanhai_map_data.json')
const SIGHTINGS = join(root, 'doc/shanhaijin/kg/space/data/creature_sightings.json')
const PRODUCTS = join(root, 'doc/shanhaijin/kg/place/data/place_products.json')
const TEXTS = join(root, 'doc/shanhaijin/app/shanhai/data/texts.json')
const ROUTE_DIR = join(root, 'doc/shanhaijin/kg/route')
const ENTITY_INDEX = join(root, 'doc/shanhaijin/kg/entity_index.json')
const TAXONOMY = join(root, 'doc/shanhaijin/kg/taxonomy/taxonomy.json')
const ALIASES = join(root, 'doc/shanhaijin/kg/entity_aliases.json')
const SPATIAL_RELATIONS = join(root, 'doc/shanhaijin/kg/relations/spatial_relations.json')
const BIOLOGY_RELATIONS = join(root, 'doc/shanhaijin/kg/relations/biology_relations.json')
const DISAMBIGUATION = join(root, 'doc/shanhaijin/kg/disambiguation_map.json')
const MOUNTAIN_POSITIONS = join(root, 'doc/shanhaijin/kg/geo/data/mountain_positions.json')
const OUT_FILE = join(root, 'public/shanhaijin/data.json')

// ── 山系名（shanXiName）提取 ─────────────────────────────────────────────
// 26 条 route 的原文有且仅有三种句式，山系名（「山系」= 一条山经的范围名）取法不同：
//
//   甲式  《北次三經》之首，曰〖=太行之山〗。其首曰〖=歸山〗
//           → 山系名 = 太行之山（其后紧跟「其首曰〈首峰〉」作为区分）
//   乙式  西山經華山之首，曰〖=錢來之山〗   /  《中次九經》岷山之首，曰〖=女几之山〗
//           → 山系名 = 「之首」前的 華山 / 岷山（其后「曰〈首峰〉」）
//   丙式  《南次二經》之首，曰〖=柜山〗     /  北山經之首，曰〖=單狐之山〗
//           → 原文未给范围名，此处「曰」后是首峰；山系名回退为经名本身
//
// 因此必须先乙、后甲、再丙，不能只用一条正则（否则乙式会误取首峰）。
const HAN = '一-鿿'

// 乙式：取「之首」前紧邻的汉字串，再剥掉经名前缀（西山經 / 中次二經 / 中山經）
const RE_RANGE_BEFORE_SHOU = new RegExp(`([${HAN}]{1,8})$`)
const RE_JING_PREFIX = new RegExp(`^[${HAN}]{1,6}經`)

// 甲式：之首，曰Y（可夹「在河之東，」「其首枕汾，」「其名」等插入语）
const RE_SHOU_ZHI_YUE = new RegExp(
  `之首[，,]?\\s*(?:在[^，,]*[，,])?\\s*(?:其首[^，,]*[，,])?\\s*(?:其名)?曰?\\s*〖[=+]([^〗]+)〗`
)

/** 从 route JSON 中提取山系名；失败则回退 chain → stops[0].place */
function extractShanXiName(route) {
  const first = (route.stops && route.stops[0]) || {}
  const raw = typeof first.raw === 'string' ? first.raw : ''

  // 乙式：Z山之首
  const i = raw.indexOf('之首')
  if (i > 0) {
    const pre = raw.slice(0, i)
    const m = pre.match(RE_RANGE_BEFORE_SHOU)
    if (m) {
      const name = m[1].replace(RE_JING_PREFIX, '')
      if (/[山川丘澤原]$/.test(name) && name.length >= 2) return name
    }
  }

  // 甲式：之首，曰Y。仅当原文确实有「其首〈曰/枕〉…」时才认定 Y 是范围名，
  // 否则（丙式）「曰」后是首峰，不能当山系名。
  if (raw.includes('其首')) {
    const m2 = raw.match(RE_SHOU_ZHI_YUE)
    if (m2 && m2[1]) return m2[1]
  }

  // 丙式 / 兜底：经名本身即山系标识
  if (route.chain) return route.chain
  return first.place || null
}

/** 检查输入文件是否存在；不存在时优雅退出（CI 环境使用已提交的 data.json） */
if (!existsSync(MAP_DATA)) {
  console.warn('[build-shanhaijin-data] doc/shanhaijin/ 不存在（CI 环境），跳过重建，使用已提交的 public/shanhaijin/data.json')
  process.exit(0)
}

/** 读取并解析 JSON 文件 */
function readJson(file) {
  return JSON.parse(readFileSync(file, 'utf8'))
}

/** 断言：条件不成立时打印实际值并抛出错误 */
function assert(cond, msg, actual) {
  if (!cond) {
    throw new Error(`[build-shanhaijin-data] 断言失败：${msg}（实际值：${JSON.stringify(actual)}）`)
  }
}

// ── 1. 山系与山条目 ─────────────────────────────────────────────────────
const map = readJson(MAP_DATA)
const rawLines = map.lines || []

// 预读 26 个 route 文件，建立 id → shanXiName 映射
const shanXiByName = new Map()
const routeFiles = readdirSync(ROUTE_DIR).filter((f) => /^ROUTE-.*\.json$/.test(f)).sort()
for (const file of routeFiles) {
  const route = readJson(join(ROUTE_DIR, file))
  shanXiByName.set(route.id, extractShanXiName(route))
}

const lines = rawLines.map((line) => {
  const stations = (line.stations || []).map((st) => ({
    id: st.id,
    name: st.name,
    seq: st.seq,
    li: st.li ?? null,
    direction: st.direction ?? null,
    distanceText: st.distance_text ?? null,
    confidence: st.confidence,
    isFirst: st.is_first,
    pn: st.pn,
    // 冗余的所属山系信息，便于扁平化后直接消费
    lineId: line.id,
    lineName: line.name,
    lineGroup: line.group,
    lineColor: line.color,
    chapterName: line.chapter_name,
    shanXiName: shanXiByName.get(line.id) ?? null
  }))

  return {
    id: line.id,
    name: line.name,
    label: line.label,
    color: line.color,
    group: line.group,
    chapterId: line.chapter_id,
    chapterName: line.chapter_name,
    confidence: line.confidence,
    checkStatus: line.check_status,
    totalMountains: line.total_mountains,
    totalLi: line.total_li,
    shanXiName: shanXiByName.get(line.id) ?? null,
    stations
  }
})

// ── 2. 异兽出现位置（键名统一 camelCase） ────────────────────────────────
const sightingsRaw = readJson(SIGHTINGS)
const sightings = {}
for (const [creature, list] of Object.entries(sightingsRaw.sightings || {})) {
  sightings[creature] = (list || []).map((e) => ({
    recordId: e.record_id,
    mountain: e.mountain,
    chapter: e.chapter,
    pn: e.pn,
    chain: e.chain,
    direction: e.direction
  }))
}

// ── 3. 物产（改为以 mountain_id 为键的对象，O(1) 查找） ──────────────────
const productsRaw = readJson(PRODUCTS)
const products = {}
for (const m of productsRaw.mountains || []) {
  products[m.mountain_id] = (m.products || []).map((p) => ({
    productType: p.product_type,
    name: p.name,
    side: p.side ?? null,
    count: p.count,
    pn: p.pn
  }))
}

// ── 4. 山形原文（原样透传，不加工） ──────────────────────────────────────
const texts = readJson(TEXTS)

// ── 4.5. KG 实体索引（2,141 个实体，按类型分组） ─────────────────────────
const entityIndexRaw = readJson(ENTITY_INDEX)
const entities = entityIndexRaw.map((e) => ({
  typeKey: e.type_key,
  symbol: e.symbol,
  canonical: e.canonical,
  display: e.display,
  pn: e.pn,
  chapter: e.chapter
}))

// ── 4.6. KG 分类学（133 个实体，按类型分组） ────────────────────────────
const taxonomyRaw = readJson(TAXONOMY)
const taxonomy = taxonomyRaw.entities || {}

// ── 4.7. 实体别名映射 ────────────────────────────────────────────────────
const aliasesRaw = readJson(ALIASES)
const aliases = {}
for (const [canonical, variants] of Object.entries(aliasesRaw)) {
  aliases[canonical] = variants
}

// ── 4.8. 空间关系（5,896 条，按关系类型分组） ─────────────────────────────
const spatialRaw = readJson(SPATIAL_RELATIONS)
const spatialRelations = spatialRaw.relations || {}

// ── 4.9. 生物关系（1,217 条，按关系类型分组） ─────────────────────────────
const biologyRaw = readJson(BIOLOGY_RELATIONS)
const biologyRelations = biologyRaw.relations || {}

// ── 4.10. 消歧记录（241 条） ─────────────────────────────────────────────
const disambiguationRaw = readJson(DISAMBIGUATION)
const disambiguation = {}
for (const [name, info] of Object.entries(disambiguationRaw)) {
  disambiguation[name] = {
    display: info.display,
    chapters: info.chapter || [],
    note: info.note || null
  }
}

// ── 4.11. 山方位坐标（447 山，按章节→山系→序号分层） ──────────────────────
const positionsRaw = readJson(MOUNTAIN_POSITIONS)
const positions = {}
for (const [chapterKey, chains] of Object.entries(positionsRaw)) {
  positions[chapterKey] = {}
  for (const [chainName, stops] of Object.entries(chains)) {
    positions[chapterKey][chainName] = {}
    for (const [seq, pos] of Object.entries(stops)) {
      positions[chapterKey][chainName][seq] = {
        mountain: pos.mountain,
        sequence: pos.sequence,
        directionFromPrev: pos.direction_from_prev ?? null,
        distanceFromPrev: pos.distance_from_prev ?? null,
        distanceLi: pos.distance_li ?? null,
        water: pos.water ?? null,
        isFirst: pos.is_first,
        chain: pos.chain,
        pn: pos.pn
      }
    }
  }
}

// ── 5. 断言 ─────────────────────────────────────────────────────────────
assert(lines.length === 26, 'lines.length 应为 26', lines.length)
const totalStations = lines.reduce((sum, l) => sum + l.stations.length, 0)
assert(totalStations === 447, 'stations 总数应为 447', totalStations)
assert(Object.keys(sightings).length === 202, 'sightings 键数应为 202', Object.keys(sightings).length)
assert('001-1' in products, "products 应包含键 '001-1'", Object.keys(products).slice(0, 5))
const r33 = lines.find((l) => l.id === 'ROUTE-003-3')
assert(r33 && r33.shanXiName === '太行之山', "ROUTE-003-3.shanXiName 应为 '太行之山'", r33 && r33.shanXiName)
assert(r33 && r33.stations[0].name === '歸山', "ROUTE-003-3.stations[0].name 应为 '歸山'", r33 && r33.stations[0].name)

// KG 数据断言
assert(entities.length === 2141, 'entities.length 应为 2141', entities.length)
assert(Object.keys(taxonomy).length >= 6, 'taxonomy 应包含至少 6 个类型', Object.keys(taxonomy))
assert(Object.keys(spatialRelations).length === 5, 'spatialRelations 应有 5 种关系类型', Object.keys(spatialRelations))
assert(Object.keys(biologyRelations).length === 7, 'biologyRelations 应有 7 种关系类型', Object.keys(biologyRelations))
assert(Object.keys(disambiguation).length > 200, 'disambiguation 应包含 200+ 条记录', Object.keys(disambiguation).length)
assert(Object.keys(positions).length === 5, 'positions 应包含 5 个章节', Object.keys(positions))

// 山系名三式回归（乙式取范围名、甲式取范围名、丙式回退经名）
const EXPECTED_SHANXI = {
  'ROUTE-001-1': '䧿山', // 甲式
  'ROUTE-002-1': '華山', // 乙式
  'ROUTE-003-2': '管涔之山', // 甲式（插入语：在河之東，其首枕汾，其名曰）
  'ROUTE-003-3': '太行之山', // 甲式
  'ROUTE-005-1': '薄山', // 乙式
  'ROUTE-005-2': '濟山', // 乙式
  'ROUTE-005-3': '萯山', // 乙式
  'ROUTE-005-4': '釐山', // 乙式
  'ROUTE-005-5': '薄山', // 乙式
  'ROUTE-005-6': '縞羝山', // 乙式
  'ROUTE-005-7': '苦山', // 乙式
  'ROUTE-005-8': '荊山', // 乙式
  'ROUTE-005-9': '岷山', // 乙式
  'ROUTE-005-11': '荊山', // 乙式
  'ROUTE-005-12': '洞庭山', // 乙式
  'ROUTE-001-2': '南次二經', // 丙式：回退经名
  'ROUTE-003-1': '北山經之首' // 丙式：回退经名
}
for (const [id, want] of Object.entries(EXPECTED_SHANXI)) {
  const line = lines.find((l) => l.id === id)
  assert(line && line.shanXiName === want, `${id}.shanXiName 应为 '${want}'`, line && line.shanXiName)
}

// ── 6. 打印 26 条 route 的 shanXiName 提取结果（供人工核对） ─────────────
console.log('\n=== shanXiName 提取结果（26 条 route，供人工核对） ===')
console.log('routeId         | chain      | stops[0].place | shanXiName')
console.log('----------------|------------|----------------|------------------')
for (const line of lines) {
  const first = line.stations[0]
  console.log(
    line.id.padEnd(15) +
    ' | ' + String(line.name).padEnd(10) +
    ' | ' + String(first ? first.name : '').padEnd(14) +
    ' | ' + String(line.shanXiName)
  )
}
console.log('')

// ── 7. 写出 ─────────────────────────────────────────────────────────────
const out = {
  meta: {
    title: '山海经 · 山形聚焦',
    totalLines: lines.length,
    totalStations,
    totalEntities: entities.length,
    totalTaxonomy: Object.values(taxonomy).reduce((sum, t) => sum + Object.keys(t).length, 0),
    totalSpatialRelations: Object.values(spatialRelations).reduce((sum, r) => sum + r.length, 0),
    totalBiologyRelations: Object.values(biologyRelations).reduce((sum, r) => sum + r.length, 0),
    totalDisambiguation: Object.keys(disambiguation).length,
    generated: new Date().toISOString()
  },
  lines,
  sightings,
  products,
  texts,
  entities,
  taxonomy,
  aliases,
  spatialRelations,
  biologyRelations,
  disambiguation,
  positions
}

mkdirSync(dirname(OUT_FILE), { recursive: true })
const json = JSON.stringify(out, null, 2)
writeFileSync(OUT_FILE, json, 'utf8')

// Output entity-names.json for client-side annotation
const entityNames = entities.map(e => ({
  canonical: e.canonical,
  typeKey: e.typeKey,
  display: e.display
}))
writeFileSync(join(root, 'public/shanhaijin/entity-names.json'), JSON.stringify(entityNames, null, 2))

const bytes = Buffer.byteLength(json, 'utf8')
console.log(`[build-shanhaijin-data] 已生成 ${OUT_FILE}`)
console.log(`[build-shanhaijin-data] 字节数：${bytes}`)
console.log(`[build-shanhaijin-data] lines=${lines.length} stations=${totalStations} ` +
  `sightings=${Object.keys(sightings).length} products=${Object.keys(products).length} ` +
  `texts=${Object.keys(texts).length} entities=${entities.length} ` +
  `taxonomyTypes=${Object.keys(taxonomy).length} spatialRelTypes=${Object.keys(spatialRelations).length} ` +
  `biologyRelTypes=${Object.keys(biologyRelations).length} disambiguation=${Object.keys(disambiguation).length} ` +
  `positionsChapters=${Object.keys(positions).length}`)

// ── 7.5 预计算（构建期完成运行时 O(n) 计算） ────────────────────────────
//
// panorama：layoutChain 对每条山系做后置碰撞检测（最多 500 轮 O(n²) 推开迭代），
//           且组件每次链切换都要重算；这里在构建期一次性算好 26 条山系的节点坐标。
// map：buildCtx 展平 447 个站点并建 byName / chainIndex / creatureIndex 索引；
//      这里在构建期序列化好（Map → Object），运行时直接反序列化。
//
// 纯函数模块用 typescript.transpileModule 编译成 ESM 后以 data-URL 动态导入
// （与 scripts/verify-shanhaijin-map.mjs 同法；两个模块均无 React/DOM/fs 依赖，
// 且 shanhaijin-panorama.ts 对 shanhaijin-map.ts 仅为 import type，编译后擦除）。

/** 用 typescript.transpileModule + data-URL 动态 import 加载编译后的 ESM */
async function loadTsModule(relPath) {
  const source = readFileSync(join(root, relPath), 'utf-8')
  const js = ts.transpileModule(source, {
    compilerOptions: {
      module: ts.ModuleKind.ESNext,
      target: ts.ScriptTarget.ES2020,
    },
    fileName: relPath,
  }).outputText
  const dataUrl = 'data:text/javascript;base64,' + Buffer.from(js, 'utf-8').toString('base64')
  return import(dataUrl)
}

const [panoramaMod, mapMod] = await Promise.all([
  loadTsModule('src/lib/shanhaijin-panorama.ts'),
  loadTsModule('src/lib/shanhaijin-map.ts'),
])

// 7.5.1 panorama 布局：{ chains: { [chainId]: { nodes, bounds } } }
const panoramaChains = {}
for (const line of lines) {
  const chain = panoramaMod.layoutChain(line, sightings, products, positions)
  panoramaChains[line.id] = {
    nodes: chain.nodes,
    bounds:
      chain.nodes.length > 0
        ? {
            minX: Math.min(...chain.nodes.map((n) => n.x), 0),
            maxX: Math.max(...chain.nodes.map((n) => n.x), 800),
            minY: Math.min(...chain.nodes.map((n) => n.y), 0),
            maxY: Math.max(...chain.nodes.map((n) => n.y), 100),
          }
        : { minX: 0, maxX: 800, minY: 0, maxY: 100 },
  }
}

// 7.5.2 map 搜索上下文：buildCtx 的序列化产物（运行时反序列化回 Map，省去索引重建）
const searchCtx = mapMod.buildCtx(out)
const mapCtx = {
  stations: searchCtx.stations,
  byName: Object.fromEntries(searchCtx.byName),
  chainIndex: Object.fromEntries(searchCtx.chainIndex),
  creatureIndex: Object.fromEntries(searchCtx.creatureIndex),
}

console.log(`[build-shanhaijin-data] 预计算完成：panorama-layout ${Object.keys(panoramaChains).length} 条山系 / ` +
  `map-ctx stations=${mapCtx.stations.length} byName=${Object.keys(mapCtx.byName).length} ` +
  `chainIndex=${Object.keys(mapCtx.chainIndex).length} creatureIndex=${Object.keys(mapCtx.creatureIndex).length}`)

// ── 8. 拆分文件（按需加载，减小首屏体积） ──────────────────────────────
const OUT_DIR = dirname(OUT_FILE)

// 8.1 各组件专属数据文件
const SPLIT_FILES = {
  'panorama-data.json': { lines, positions, sightings, products, meta: out.meta },
  'panorama-layout.json': { chains: panoramaChains },
  'map-data.json': { lines, sightings, products, texts, meta: out.meta, ctx: mapCtx },
  'graph-data.json': { entities, spatialRelations, biologyRelations },
  'entity-data.json': { entities, taxonomy, aliases, disambiguation, sightings, products, spatialRelations, biologyRelations },
  'search-data.json': { entities, sightings, products, lines }
}

for (const [filename, data] of Object.entries(SPLIT_FILES)) {
  const splitJson = JSON.stringify(data, null, 2)
  const splitPath = join(OUT_DIR, filename)
  writeFileSync(splitPath, splitJson, 'utf8')
  const splitBytes = Buffer.byteLength(splitJson, 'utf8')
  console.log(`[build-shanhaijin-data] 已生成 ${filename}（${(splitBytes / 1024).toFixed(1)} KB）`)
}

// 8.2 meta.json — 轻量元信息（供概览页 / SEO 使用）
const entityTypeCounts = {}
for (const e of entities) {
  entityTypeCounts[e.typeKey] = (entityTypeCounts[e.typeKey] || 0) + 1
}
const chapterIds = new Set(lines.map((l) => l.chapterId))
const totalLi = lines.reduce(
  (sum, l) => sum + l.stations.reduce((s, st) => s + (st.li ?? 0), 0),
  0
)
const totalChars = Object.values(texts).reduce((sum, t) => sum + t.length, 0)
const META_FILE = {
  entityTypeCounts,
  stats: {
    chapters: chapterIds.size,
    mountains: totalStations,
    chains: lines.length,
    li: totalLi,
    chars: totalChars
  }
}
const metaJson = JSON.stringify(META_FILE, null, 2)
const metaPath = join(OUT_DIR, 'meta.json')
writeFileSync(metaPath, metaJson, 'utf8')
const metaBytes = Buffer.byteLength(metaJson, 'utf8')
console.log(`[build-shanhaijin-data] 已生成 meta.json（${(metaBytes / 1024).toFixed(1)} KB）`)
console.log(`[build-shanhaijin-data] entityTypeCounts: ${JSON.stringify(entityTypeCounts)}`)
console.log(`[build-shanhaijin-data] stats: ${JSON.stringify(META_FILE.stats)}`)
