/**
 * 《山海经》山形聚焦视图 —— 纯函数层（无 React / 无 DOM / 无 fs）。
 *
 * 移植来源：`doc/shanhaijin/app/shanhai/focus.js`（vanilla-JS 独立页）。
 * 本模块只做「数据 → 数据」的纯计算，供 client component 与自检脚本消费：
 *   - `flattenStations` 把山系展平成按原书顺序排列的站点数组
 *   - `buildByName` / `buildChainIndex` / `buildCreatureIndex` 建索引
 *   - `neighbors` 算某站点的上下游邻居（含跨山系判断）
 *   - `findText` 查原文（含「之尾/之首」「之山/之丘/之野」后缀剥离变体）
 *   - `search` 搜索（scope 过滤 / 去重 / 最多 30 条）
 *
 * 数据契约：`public/shanhaijin/data.json`（由并行任务生成）。
 * 本模块不读取任何文件，调用方负责把 JSON 解析成 `MapData` 后传入。
 *
 * 与 focus.js 的行为差异见文件末尾「与 focus.js 的行为差异」注释，
 * 以及 `scripts/verify-shanhaijin-map.mjs` 的自检输出。
 */

/* ── 数据契约（与 public/shanhaijin/data.json 对齐） ───────────────── */

export type Scope = 'mountain' | 'creature' | 'product' | 'all'

export type Confidence = 'confirmed' | 'inferred' | 'unknown'

/** 置信度（本模块不做映射，仅透传） */
export interface Station {
  id: string
  name: string
  /** 山系内序号（从 1 开始） */
  seq: number
  /** 里程（里），山系首山为 null */
  li: number | null
  /** 方位（如「东」「东北」），山系首山为 null */
  direction: string | null
  /** 里程原文（如「三百里」） */
  distanceText: string | null
  confidence: Confidence
  /** 是否山系首山 */
  isFirst: boolean
  /** 原文段落号（如「（001-1.1）」） */
  pn: string | null
  lineId: string
  lineName: string
  lineGroup: string
  lineColor: string
  chapterName: string
  /** 山系名（如「䧿山」「太行之山」），无山系名时为 null */
  shanXiName: string | null
}

export interface Line {
  id: string
  /** 山系名（如「南山經之首」「北次三經」） */
  name: string
  /** 短标签（如「南山」） */
  label: string
  color: string
  group: string
  chapterId: string
  chapterName: string
  confidence: Confidence
  checkStatus: string
  totalMountains: number
  totalLi: number
  /** 山系名（如「䧿山」「太行之山」），无山系名时为 null */
  shanXiName: string | null
  stations: Station[]
}

export interface MapData {
  meta: { title: string; totalLines: number; totalStations: number; generated: string }
  lines: Line[]
  /** 异兽名 → 出现记录 */
  sightings: Record<string, Sighting[]>
  /** 物产：`mountain_id`（PN，如「001-1」）→ 物产列表 */
  products: Record<string, Product[]>
  /** 山名 → 原文 */
  texts: Record<string, string>
  /** 实体列表（2,141 条） */
  entities: Array<{ typeKey: string; symbol: string; canonical: string; display: string; pn: string | null; chapter: string | null }>
  /** 分类表：typeKey → (典名 → { subclass, level, confidence }) */
  taxonomy: Record<string, Record<string, { subclass: string; level: string; confidence: number }>>
  /** 别名：典名 → 变体数组 */
  aliases: Record<string, string[]>
  /** 空间关系：按类型分组 */
  spatialRelations: Record<string, Array<Record<string, unknown>>>
  /** 生物关系：按类型分组 */
  biologyRelations: Record<string, Array<Record<string, unknown>>>
  /** 跨卷重出消歧 */
  disambiguation: Record<string, { display: string; chapters: string[]; note: string }>
  /** 山系内位置：chapter → chain → seq → 位置信息 */
  positions: Record<string, Record<string, Record<string, unknown>>>
}

export interface Sighting {
  recordId: string
  mountain: string
  chapter: string
  pn: string
  chain: string | null
  direction: string | null
}

export interface Product {
  productType: string
  name: string
  side: string | null
  count: number
  pn: string
}

/* ── 繁简归一化 ───────────────────────────────────────────────────── */

/**
 * 繁简归一化：把名字里的繁体字换成简体，使「北次三經」「太行之山」「華山」
 * 能与数据里的「北次三经」「太行之山」「华山」对上。
 *
 * 映射表**只收录本数据集实际用到的字**，不是通用繁简转换。
 * 覆盖三类：
 *   1. 山系名用字（搜索「华山」「太行之山」「中次十一经」必需）：
 *      經 華 濟 荊 釐 縞 陰 東 …
 *   2. 山名/异兽/物产常用字（搖 歸 龍 馬 鳥 魚 貝 鐵 銅 銀 鳳 龜 …）
 *   3. 原文里的虚字（於 無 與 從 復 為 …）
 *
 * 繁简同形的字（山、之、水、玉、金、人、大、小 …）不收录；
 * 生僻异体（䧿、騩、縞羝、狌、鱬 …）繁简同形，也无需映射。
 *
 * 若将来数据扩充出现新繁体字，这里会漏命中 —— 属于已知取舍。
 */
const TRAD_TO_SIMP_RAW = `
搖|摇 會|会 餘|余 陰|阴 雞|鸡 侖|仑 塗|涂 鈐|钤 歷|历 龍|龙 鳥|鸟
眾|众 獸|兽 萊|莱 鍾|钟 樂|乐 遊|游 軒|轩 轅|辕 積|积 勞|劳 罷|罢
號|号 於|于 涇|泾 剛|刚 單|单 譙|谯 邊|边 聯|联 張|张 題|题 嶽|岳
渾|浑 羆|罴 鮮|鲜 縣|县 爾|尔 頭|头 鈎|钩 歸|归 馬|马 賁|贲 聞|闻
門|门 蟲|虫 謁|谒 鳩|鸠 錫|锡 繡|绣 與|与 維|维 戲|戏 陸|陆 饒|饶
倫|伦 鴈|雁 東|东 狀|状 條|条 兒|儿 獨|独 嶧|峄 峩|峨 盧|卢 緱|缑
鳧|凫 麗|丽 鉤|钩 無|无 欽|钦 棗|枣 豬|猪 蔥|葱 聾|聋 脫|脱 鐙|镫
繢|缋 復|复 荊|荆 視|视 豐|丰 瑤|瑶 離|离 軲|轱 從|从 嬰|婴 畢|毕
鯢|鲵 嫗|妪 聲|声 奧|奥 雲|云 龜|龟 風|风 榮|荣 濟|济 蘇|苏 釐|厘
舉|举 蠱|蛊 虛|虚 縞|缟 婁|娄 講|讲 陘|陉 驕|骄 綸|纶 銅|铜 靈|灵
師|师 崍|崃 賈|贾 魚|鱼 騅|骓 極|极 螻|蝼 貝|贝 鰩|鳐 厭|厌 櫟|栎
鴞|鸮 當|当 窮|穷 竊|窃 衛|卫 羅|罗 遺|遗 蠻|蛮 懷|怀 貍|狸 雙|双
領|领 顒|颙 類|类 飛|飞 騶|驺 婦|妇 鱅|鳙 鳳|凤 鳴|鸣 鴆|鸩 鴒|鸰
鴟|鸱 鴣|鸪 鶘|鹕 鶉|鹑 鸚|鹦 鸞|鸾 銀|银 鐵|铁 喬|乔 穀|榖 葯|药
鮭|鲑 鳲|鸤 蒼|苍 藥|药 礪|砺 鱣|鳣 鮪|鲔 閭|闾 纍|累 櫧|槠 蕭|萧
楊|杨 華|华 經|经 裡|里 裏|里 澤|泽 恆|恒 長|长 陽|阳
`

const TRAD_TO_SIMP_MAP: ReadonlyMap<string, string> = new Map(
  TRAD_TO_SIMP_RAW.trim()
    .split(/\s+/)
    .map((pair) => {
      const [trad, simp] = pair.split('|')
      return [trad, simp] as const
    })
)

/** 繁简归一化（經→经、東→东、無→无、裡→里、于→于） */
export function normalizeChainName(s: string): string {
  return Array.from(s)
    .map((ch) => TRAD_TO_SIMP_MAP.get(ch) ?? ch)
    .join('')
}

/* ── 索引构建 ─────────────────────────────────────────────────────── */

/** 把 lines 展平成按原书顺序排列的站点数组（山经 → 海经，逐山系逐站） */
export function flattenStations(lines: Line[]): Station[] {
  const out: Station[] = []
  for (const line of lines) {
    for (const st of line.stations) {
      out.push(st)
    }
  }
  return out
}

/**
 * 山名 → 站点下标（用于 hash 定位）。
 *
 * 注意：全书有重出山名（如「箕尾之山」「玉山」跨山系重出），
 * 同名时保留**首次出现**的下标（与 focus.js 的 `byName[s.name] = s` 一致）。
 */
export function buildByName(stations: Station[]): Map<string, number> {
  const m = new Map<string, number>()
  stations.forEach((s, i) => {
    const k = normalizeChainName(s.name)
    if (!m.has(k)) m.set(k, i)
  })
  return m
}

/**
 * 山系名 → 该山系首个站点下标（支持繁简归一化）。
 *
 * 为每个 line 建这些键（键一律经 normalizeChainName 归一化后写入）：
 *   - `line.name`       如「南山經之首」→「南山经之首」
 *   - `line.shanXiName` 如「䧿山」
 *   - `line.label`      如「南山」
 *   - `line.stations[0].name` 如「招搖之山」
 *
 * 这样搜「太行之山」命中 `shanXiName`，搜「北次三经」（简体）经归一化后也能命中。
 * 注意：键已归一化，故繁体查询「北次三經」也能直接命中同一键。
 */
export function buildChainIndex(lines: Line[], stations: Station[]): Map<string, number> {
  const m = new Map<string, number>()
  const put = (key: string | null | undefined, idx: number): void => {
    if (!key) return
    const k = normalizeChainName(key)
    if (!m.has(k)) m.set(k, idx)
  }

  let offset = 0
  for (const line of lines) {
    const firstIdx = offset
    put(line.name, firstIdx)
    put(line.shanXiName, firstIdx)
    put(line.label, firstIdx)
    if (line.stations.length > 0) put(line.stations[0].name, firstIdx)
    offset += line.stations.length
  }

  // stations 里的下标与 lines 顺序一致（flattenStations 的契约），此处仅做防御性校验
  if (offset !== stations.length) {
    // 数据异常时仍以 stations 实际长度为准，不抛错（纯函数、无副作用）
    return m
  }
  return m
}

/** 异兽名 → 出现它的山名列表（去重，保持首次出现顺序） */
export function buildCreatureIndex(sightings: Record<string, Sighting[]>): Map<string, string[]> {
  const m = new Map<string, string[]>()
  for (const name of Object.keys(sightings)) {
    const seen = new Set<string>()
    const mountains: string[] = []
    for (const s of sightings[name]) {
      if (s.mountain && !seen.has(s.mountain)) {
        seen.add(s.mountain)
        mountains.push(s.mountain)
      }
    }
    m.set(name, mountains)
  }
  return m
}

/** 山系内最大序号（用于「山系内第 N 座」显示） */
export function maxSeq(line: Line): number {
  if (line.stations.length === 0) return 0
  return Math.max(...line.stations.map((s) => s.seq))
}

/* ── 邻居关系 ─────────────────────────────────────────────────────── */

export interface Neighbor {
  prev: Station | null
  next: Station | null
  /** prev 与当前站是否同山系（lineId 相同） */
  prevSame: boolean
  /** next 与当前站是否同山系（lineId 相同） */
  nextSame: boolean
  /** 从 prev 走到当前站的方位+里程；跨山系或当前站无方位时为 null */
  fromPrev: string | null
  /** 从当前站走到 next 的方位+里程；跨山系或 next 无方位时为 null */
  toNext: string | null
}

/**
 * 某站点的上下游邻居（同山系判断：lineId 相同）。
 *
 * `fromPrev` 语义 = 「从 prev 走到当前站」的方位+里程，即
 * `cur.direction + ' ' + cur.distanceText`，且仅当 `prev.lineId === cur.lineId`；
 * `toNext` 同理用 `next` 的 direction/distanceText。
 */
export function neighbors(stations: Station[], i: number): Neighbor {
  const cur = stations[i]
  if (!cur) {
    return { prev: null, next: null, prevSame: false, nextSame: false, fromPrev: null, toNext: null }
  }
  const prev = i > 0 ? stations[i - 1] : null
  const next = i < stations.length - 1 ? stations[i + 1] : null
  const prevSame = prev != null && prev.lineId === cur.lineId
  const nextSame = next != null && next.lineId === cur.lineId
  return {
    prev,
    next,
    prevSame,
    nextSame,
    fromPrev: prevSame && cur.direction ? cur.direction + ' ' + (cur.distanceText || '') : null,
    toNext: nextSame && next.direction ? next.direction + ' ' + (next.distanceText || '') : null,
  }
}

/* ── 原文查找 ─────────────────────────────────────────────────────── */

/**
 * 原文查找：先精确匹配，再剥离「之尾/之首」「之山/之丘/之野」等后缀变体。
 *
 * 移植 `focus.js:209-221` 的剥离逻辑，并补全「之野」变体：
 *   1. `texts[name]`
 *   2. 去「之尾 / 之首」→ `texts[name.replace(/之[尾首]$/, '')]`
 *   3. 去「之山 / 之丘 / 之野」→ `texts[name.replace(/之[山丘野]$/, '')]`
 *   4. 「之山$」↔「山$」、「之丘$」↔「丘$」、「之野$」↔「野$」互换
 */
export function findText(name: string, texts: Record<string, string>): string {
  const t = texts
  if (t[name]) return t[name]

  const stripEndpoint = name.replace(/之[尾首]$/, '')
  if (t[stripEndpoint]) return t[stripEndpoint]

  const stripSuffix = name.replace(/之[山丘野]$/, '')
  if (t[stripSuffix]) return t[stripSuffix]

  const toMountain = name.replace(/之山$/, '') + '之山'
  if (t[toMountain]) return t[toMountain]

  const toHill = name.replace(/之丘$/, '') + '之丘'
  if (t[toHill]) return t[toHill]

  const toField = name.replace(/之野$/, '') + '之野'
  if (t[toField]) return t[toField]

  return ''
}

/* ── 搜索 ─────────────────────────────────────────────────────────── */

export interface SearchResult {
  kind: 'mountain' | 'creature' | 'product'
  name: string
  /** 站点下标；异兽/物产无法解析到站点时为 -1 */
  idx: number
  hint: string
}

export interface SearchCtx {
  stations: Station[]
  byName: Map<string, number>
  chainIndex: Map<string, number>
  creatureIndex: Map<string, string[]>
  lines: Line[]
  products: Record<string, Product[]>
}

/** 从 MapData 构建搜索上下文（一次性算好全部索引） */
export function buildCtx(data: MapData): SearchCtx {
  const stations = flattenStations(data.lines)
  return {
    stations,
    byName: buildByName(stations),
    chainIndex: buildChainIndex(data.lines, stations),
    creatureIndex: buildCreatureIndex(data.sightings),
    lines: data.lines,
    products: data.products,
  }
}

/** 搜索结果上限（与 focus.js 的 30 条一致） */
const SEARCH_LIMIT = 30

/** 山名在数据中不存在时下标记为 -1（与 focus.js 的 findIndex 一致） */
const NOT_FOUND = -1

/**
 * 判断「数据里的名字」是否命中查询词。
 * 对两侧都做繁简归一化，使「狌狌」「北次三經」这类含繁体的输入也能命中简体数据。
 */
function matchKey(name: string, query: string): boolean {
  const n = normalizeChainName(name)
  const q = normalizeChainName(query)
  return n.indexOf(q) >= 0
}

/**
 * 搜索：支持 scope 过滤、去重、最多 30 条。
 *
 * 匹配优先级（移植 `focus.js:276-341`）：
 *   - `mountain`：先 `byName` 精确命中 → 再 `chainIndex` 命中 → 再 `stations` 名字 `indexOf` 模糊匹配
 *   - `creature`：`creatureIndex` 命中，`hint` 为山名
 *   - `product`：遍历 `products`，`hint` 为 `mountain_id`（PN）
 *   - `all`：三类都跑，合并去重（键 `kind|name|idx`），最多 30 条
 *
 * 空查询返回空数组（由调用方决定是否清空输入框）。
 */
export function search(query: string, scope: Scope, ctx: SearchCtx): SearchResult[] {
  const q = query.trim()
  if (!q) return []

  const out: SearchResult[] = []
  const want = (k: Scope): boolean => scope === 'all' || scope === k

  if (want('mountain')) {
    // 1) 精确命中（含繁简归一化后的山系名 / 山名）
    const exact = ctx.byName.get(q)
    if (exact != null) {
      out.push({ kind: 'mountain', name: ctx.stations[exact].name, idx: exact, hint: ctx.stations[exact].lineName })
    }
    const exactNorm = ctx.byName.get(normalizeChainName(q))
    if (exactNorm != null && exactNorm !== exact) {
      out.push({ kind: 'mountain', name: ctx.stations[exactNorm].name, idx: exactNorm, hint: ctx.stations[exactNorm].lineName })
    }

    // 2) 山系名命中（「太行之山」「北次三经」）
    const chainIdx = ctx.chainIndex.get(q) ?? ctx.chainIndex.get(normalizeChainName(q))
    if (chainIdx != null) {
      const st = ctx.stations[chainIdx]
      if (st) out.push({ kind: 'mountain', name: st.name, idx: chainIdx, hint: st.lineName })
    }

    // 3) 模糊匹配（indexOf）
    ctx.stations.forEach((s, i) => {
      if (s.name.indexOf(q) >= 0) {
        out.push({ kind: 'mountain', name: s.name, idx: i, hint: s.lineName })
      }
    })
  }

  if (want('creature')) {
    for (const name of ctx.creatureIndex.keys()) {
      if (matchKey(name, q)) {
        const mountains = ctx.creatureIndex.get(name) || []
        const idx = mountains.length > 0 ? ctx.byName.get(mountains[0]) ?? NOT_FOUND : NOT_FOUND
        out.push({ kind: 'creature', name, idx, hint: mountains[0] ?? '' })
      }
    }
  }

  if (want('product')) {
    const seen = new Set<string>()
    for (const mountainId of Object.keys(ctx.products)) {
      for (const p of ctx.products[mountainId]) {
        if (matchKey(p.name, q) && !seen.has(p.name)) {
          seen.add(p.name)
          // mountain_id 是 PN（如「001-1」），用站点 id 反查下标
          const idx = ctx.stations.findIndex((s) => s.id === mountainId)
          out.push({ kind: 'product', name: p.name, idx, hint: mountainId })
        }
      }
    }
  }

  // 去重（键 kind|name|idx）
  const seenKey = new Set<string>()
  const dedup: SearchResult[] = []
  for (const r of out) {
    const k = r.kind + '|' + r.name + '|' + r.idx
    if (seenKey.has(k)) continue
    seenKey.add(k)
    dedup.push(r)
  }

  return dedup.slice(0, SEARCH_LIMIT)
}

/* ── 与 focus.js 的行为差异（移植时修掉的 bug / 补齐的语义） ───────────
 *
 * 1. `findText` 补全「之野」变体：focus.js 只处理了「之山/之丘」互换，
 *    漏了「之野」；本模块补上 `之野$` ↔ `野$`。
 * 2. `findText` 的 `之[尾首]$` 剥离：focus.js 会先剥离再查，本模块保留该
 *    顺序（先端点后缀，再「之山/之丘/之野」），与原文一致。
 * 3. `search` 的 creature/product 下标：focus.js 用 `sightings[name][0].mountain`
 *    反查站点下标，本模块改用 `creatureIndex`（同一语义，但提前去重）。
 * 4. `search` 的 product `hint`：focus.js 用山名（`m.mountain`），本模块按新契约
 *    用 `mountain_id`（PN），与 `MapData.products` 的键一致。
 * 5. `buildByName` 重名处理：focus.js 的 `byName[s.name] = s` 是「后者覆盖前者」，
 *    本模块改为「保留首次出现」，与 hash 定位的直觉一致（首站）。
 * 6. `search` 的 mountain 分支：focus.js 只有 `indexOf` 模糊匹配；本模块按任务
 *    要求补上「精确 → 山系名 → 模糊」三级优先级，并做繁简归一化。
 * 7. `neighbors` 与 focus.js 完全一致（含 `fromPrev`/`toNext` 语义）。
 */
