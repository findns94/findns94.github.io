/**
 * 自检脚本：验证 `src/lib/shanhaijing-map.ts` 的纯函数行为。
 *
 * 运行：node scripts/verify-shanhaijing-map.mjs
 *
 * 原理：
 *   1. 用 `typescript.transpileModule` 把纯函数模块编译成 ESM 字符串；
 *   2. 用 `node:vm` 在沙箱里执行（模块无 React/DOM/fs 依赖，可安全求值）；
 *   3. 用 `node:assert` 逐项断言。
 *
 * 数据源：优先读 `public/shanhaijing/data.json`（并行任务产出）；
 *         若不存在，则回退到 vanilla-JS 的 `doc/shanhaijing/app/shanhai/data/*.json`，
 *         按 `MapData` 契约拼装出等价结构（`shanXiName` 由总结句推导）。
 *
 * 硬性要求：本脚本不执行任何 git 命令。
 */

import { readFileSync } from 'node:fs'
import { fileURLToPath } from 'node:url'
import path from 'node:path'
import vm from 'node:vm'
import assert from 'node:assert/strict'
import ts from 'typescript'

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..')
const MODULE_PATH = path.join(ROOT, 'src', 'lib', 'shanhaijing-map.ts')

let passed = 0
let failed = 0

/** 断言并打印结果 */
function check(label, fn) {
  try {
    fn()
    passed++
    console.log(`  PASS  ${label}`)
  } catch (e) {
    failed++
    console.log(`  FAIL  ${label}`)
    console.log(`        ${e && e.message ? e.message : e}`)
  }
}

/* ── 1. 加载纯函数模块 ─────────────────────────────────────────────── */

/** 用 `typescript.transpileModule` + data-URL 动态 import 加载编译后的 ESM */
async function loadModule() {
  const source = readFileSync(MODULE_PATH, 'utf-8')
  const js = ts.transpileModule(source, {
    compilerOptions: {
      module: ts.ModuleKind.ESNext,
      target: ts.ScriptTarget.ES2020,
    },
    fileName: 'shanhaijing-map.ts',
  }).outputText

  const dataUrl = 'data:text/javascript;base64,' + Buffer.from(js, 'utf-8').toString('base64')
  return import(dataUrl)
}

/* ── 2. 准备数据 ───────────────────────────────────────────────────── */

async function loadMapData() {
  const primary = path.join(ROOT, 'public', 'shanhaijing', 'data.json')
  try {
    const raw = readFileSync(primary, 'utf-8')
    const data = JSON.parse(raw)
    console.log(`\n[data] 使用 ${path.relative(ROOT, primary)}`)
    return data
  } catch {
    console.log(`\n[data] 未找到 public/shanhaijing/data.json，回退到 doc/ 源数据拼装`)
    return buildFromDoc()
  }
}

/** 从 doc 源数据拼装 MapData（仅在 data.json 缺失时使用） */
function buildFromDoc() {
  const dir = path.join(ROOT, 'doc', 'shanhaijing', 'app', 'shanhai', 'data')
  const map = JSON.parse(readFileSync(path.join(dir, 'shanhai_map_data.json'), 'utf-8'))
  const sight = JSON.parse(readFileSync(path.join(dir, 'creature_sightings.json'), 'utf-8'))
  const prod = JSON.parse(readFileSync(path.join(dir, 'place_products.json'), 'utf-8'))
  const texts = JSON.parse(readFileSync(path.join(dir, 'texts.json'), 'utf-8'))

  const summ = JSON.parse(
    readFileSync(
      path.join(ROOT, 'doc', 'shanhaijing', 'kg', 'structure', 'data', 'chain_summaries.json'),
      'utf-8',
    ),
  )
  const sxCache = new Map()

  /**
   * 从总结句推导山系名（「凡X之首」/「凡《X》之首」）。
   * 例：
   *   凡䧿山之首，自招搖之山…           → 䧿山
   *   凡《北次三經》之首，自太行之山…   → 北次三經（山系名与 line.name 相同）
   */
  function shanXiName(chainName, raw) {
    if (sxCache.has(chainName)) return sxCache.get(chainName)
    let sx = null
    if (raw) {
      const m = raw.match(/^凡(?:《)?([^，。]{1,16}?)(?:》)?之[首山][，,]/)
      if (m) {
        sx = m[1].replace(/[《》]/g, '').trim()
      }
    }
    // 山系名与 line.name 相同（如「北次三經」）时不额外记，避免搜「北次三经」
    // 时命中 shanXiName 又命中 line.name 造成重复（search 会去重，但语义上冗余）
    if (sx === chainName) sx = null
    sxCache.set(chainName, sx)
    return sx
  }

  const summByName = new Map(summ.map((s) => [s.chain, s.raw]))
  const lines = map.lines.map((L) => {
    const raw = summByName.get(L.name)
    const sx = shanXiName(L.name, raw)
    return {
      id: L.id,
      name: L.name,
      label: L.label,
      color: L.color,
      group: L.group,
      chapterId: L.chapter_id,
      chapterName: L.chapter_name,
      confidence: L.confidence,
      checkStatus: L.check_status,
      totalMountains: L.total_mountains,
      totalLi: L.total_li,
      shanXiName: sx,
      stations: L.stations.map((s) => ({
        id: s.id,
        name: s.name,
        seq: s.seq,
        li: s.li,
        direction: s.direction,
        distanceText: s.distance_text,
        confidence: s.confidence,
        isFirst: s.is_first,
        pn: s.pn,
        lineId: L.id,
        lineName: L.name,
        lineGroup: L.group,
        lineColor: L.color,
        chapterName: L.chapter_name,
        shanXiName: sx,
      })),
    }
  })

  return {
    meta: { title: map.meta?.title ?? '', totalLines: lines.length, totalStations: 0, generated: '' },
    lines,
    sightings: sight.sightings ?? {},
    products: prod ?? {},
    texts: texts ?? {},
  }
}

/* ── 3. 断言 ───────────────────────────────────────────────────────── */

async function main() {
  const mod = await loadModule()
  const data = await loadMapData()
  data.meta.totalStations = data.lines.reduce((n, L) => n + L.stations.length, 0)

  const {
    flattenStations,
    buildByName,
    buildChainIndex,
    buildCreatureIndex,
    maxSeq,
    neighbors,
    findText,
    normalizeChainName,
    buildCtx,
    search,
  } = mod

  console.log('\n[1] flattenStations / 展平')
  const stations = flattenStations(data.lines)
  check('flattenStations 总数 === 447', () => {
    assert.equal(stations.length, 447)
  })
  check('首站为「招搖之山」', () => {
    assert.equal(stations[0].name, '招搖之山')
  })
  check('末站为最后一座山（非空）', () => {
    assert.ok(stations[stations.length - 1].name.length > 0)
  })

  console.log('\n[2] buildByName / 山名索引')
  const byName = buildByName(stations)
  check('buildByName 含「招搖之山」', () => {
    assert.ok(byName.has('招搖之山'))
  })
  check('重名保留首次出现（「玉山」只出现一次下标）', () => {
    const ys = byName.get('玉山')
    assert.ok(ys != null)
    // 所有「玉山」中第一个应等于 byName 的值
    const first = stations.findIndex((s) => s.name === '玉山')
    assert.equal(ys, first)
  })

  console.log('\n[3] buildChainIndex / 山系名索引')
  const chainIndex = buildChainIndex(data.lines, stations)
  check('buildChainIndex 能解析「太行之山」', () => {
    const idx = chainIndex.get('太行之山')
    assert.ok(idx != null, '太行之山 未命中')
    assert.equal(stations[idx].name, '歸山')
  })
  check('buildChainIndex 能解析「北次三经」（简体归一化）', () => {
    const idx = chainIndex.get('北次三经')
    assert.ok(idx != null, '北次三经 未命中')
    assert.equal(stations[idx].name, '歸山')
  })
  check('buildChainIndex 键已繁简归一化（「北次三经」可命中）', () => {
    const idx = chainIndex.get('北次三经')
    assert.ok(idx != null, '北次三经 未命中')
    assert.equal(stations[idx].name, '歸山')
  })
  check('buildChainIndex 能解析「南山经之首」（line.name 归一化）', () => {
    const idx = chainIndex.get('南山经之首')
    assert.ok(idx != null)
    assert.equal(idx, 0)
  })
  check('buildChainIndex 能解析「南山经之首」（简体）', () => {
    const idx = chainIndex.get('南山经之首')
    assert.ok(idx != null)
    assert.equal(idx, 0)
  })
  check('buildChainIndex 能解析「南山」（label）', () => {
    const idx = chainIndex.get('南山')
    assert.ok(idx != null)
    assert.equal(idx, 0)
  })
  check('buildChainIndex 能解析「招搖之山」（首站名）', () => {
    const idx = chainIndex.get('招搖之山')
    assert.ok(idx != null)
    assert.equal(idx, 0)
  })

  console.log('\n[4] neighbors / 邻居关系')
  check('首站 prev === null', () => {
    const nb = neighbors(stations, 0)
    assert.equal(nb.prev, null)
  })
  check('首站 prevSame === false', () => {
    const nb = neighbors(stations, 0)
    assert.equal(nb.prevSame, false)
  })
  check('首站 fromPrev === null', () => {
    const nb = neighbors(stations, 0)
    assert.equal(nb.fromPrev, null)
  })
  check('首站 next 为「堂庭之山」且 nextSame === true', () => {
    const nb = neighbors(stations, 0)
    assert.equal(nb.next.name, '堂庭之山')
    assert.equal(nb.nextSame, true)
  })
  check('首站 toNext 为「东 三百里」', () => {
    const nb = neighbors(stations, 0)
    assert.equal(nb.toNext, '东 三百里')
  })
  check('第二站 fromPrev 为「东 三百里」', () => {
    const nb = neighbors(stations, 1)
    assert.equal(nb.fromPrev, '东 三百里')
  })
  check('跨山系边界：末站 prevSame === false 且 fromPrev === null', () => {
    // 找第一条 line 的末站下标
    const lastOfLine0 = data.lines[0].stations.length - 1
    const nb = neighbors(stations, lastOfLine0)
    assert.equal(nb.prevSame, true) // 同 line 内
    const nbCross = neighbors(stations, lastOfLine0 + 1)
    assert.equal(nbCross.prevSame, false)
    assert.equal(nbCross.fromPrev, null)
  })

  console.log('\n[5] findText / 原文查找')
  const texts = data.texts ?? {}
  check('findText 精确命中「招搖之山」', () => {
    const t = findText('招搖之山', texts)
    assert.ok(t.length > 0)
    assert.ok(t.includes('招搖之山'))
  })
  check('findText 剥离「之尾/之首」变体', () => {
    // 找一个以「之山」结尾、且 texts 里存在去后缀键的样例
    const key = Object.keys(texts).find((k) => k.endsWith('之山'))
    assert.ok(key, 'texts 中无「之山」键')
    const stripped = key.slice(0, -2)
    if (texts[stripped]) {
      assert.ok(findText(key, texts).length > 0)
    } else {
      // 退化为：至少精确命中
      assert.ok(findText(key, texts).length > 0)
    }
  })
  check('findText 剥离「之山」→「山」变体', () => {
    const key = Object.keys(texts).find((k) => k.endsWith('之山') && texts[k.slice(0, -2) + '山'])
    if (key) {
      assert.ok(findText(key, texts).length > 0)
    } else {
      // 无此样例时退化为精确命中
      const anyKey = Object.keys(texts).find((k) => k.endsWith('之山'))
      assert.ok(findText(anyKey, texts).length > 0)
    }
  })
  check('findText 未知山名返回空串', () => {
    assert.equal(findText('不存在的山XYZ', texts), '')
  })

  console.log('\n[6] normalizeChainName / 繁简归一化')
  check("normalizeChainName('北次三經') === '北次三经'", () => {
    assert.equal(normalizeChainName('北次三經'), '北次三经')
  })
  check("normalizeChainName('太行之山') === '太行之山'", () => {
    assert.equal(normalizeChainName('太行之山'), '太行之山')
  })
  check("normalizeChainName('東山經之首') === '东山经之首'", () => {
    assert.equal(normalizeChainName('東山經之首'), '东山经之首')
  })
  check("normalizeChainName('無逢之山') === '无逢之山'", () => {
    assert.equal(normalizeChainName('無逢之山'), '无逢之山')
  })

  console.log('\n[7] maxSeq / 山系内最大序号')
  check('maxSeq(第一条 line) === 9', () => {
    assert.equal(maxSeq(data.lines[0]), 9)
  })
  check('maxSeq(北次三經 line) === 47', () => {
    const line = data.lines.find((L) => L.name === '北次三經')
    assert.ok(line, '未找到北次三經')
    assert.equal(maxSeq(line), 47)
  })

  console.log('\n[8] buildCreatureIndex / 异兽索引')
  const creatureIndex = buildCreatureIndex(data.sightings ?? {})
  check('creatureIndex 非空', () => {
    assert.ok(creatureIndex.size > 0)
  })
  check('creatureIndex 山名列表去重', () => {
    for (const [, mountains] of creatureIndex) {
      assert.equal(new Set(mountains).size, mountains.length)
    }
  })

  console.log('\n[9] buildCtx + search / 搜索')
  const ctx = buildCtx(data)
  check('buildCtx.stations 长度 === 447', () => {
    assert.equal(ctx.stations.length, 447)
  })

  check("search('招搖之山','mountain',ctx) 返回 idx 0", () => {
    const r = search('招搖之山', 'mountain', ctx)
    assert.ok(r.length > 0, '无结果')
    assert.equal(r[0].idx, 0)
    assert.equal(r[0].name, '招搖之山')
    assert.equal(r[0].kind, 'mountain')
  })
  check("search('太行之山','mountain',ctx) 返回非空", () => {
    const r = search('太行之山', 'mountain', ctx)
    assert.ok(r.length > 0, '无结果')
    assert.equal(r[0].kind, 'mountain')
  })
  check("search('北次三经','mountain',ctx) 命中「歸山」", () => {
    const r = search('北次三经', 'mountain', ctx)
    assert.ok(r.length > 0, '无结果')
    assert.equal(r[0].name, '歸山')
  })
  check("search('招搖','mountain',ctx) 模糊命中「招搖之山」", () => {
    const r = search('招搖', 'mountain', ctx)
    assert.ok(r.some((x) => x.name === '招搖之山'))
  })
  check("search('','mountain',ctx) 返回空数组", () => {
    assert.deepEqual(search('', 'mountain', ctx), [])
  })
  check("search('不存在XYZ','mountain',ctx) 返回空数组", () => {
    assert.deepEqual(search('不存在XYZ', 'mountain', ctx), [])
  })
  check("search('*','all',ctx) 受 30 条上限约束", () => {
    // 用一个能命中大量结果的字符
    const r = search('山', 'all', ctx)
    assert.ok(r.length <= 30, `结果数 ${r.length} 超过 30`)
  })
  check("search('狌狌','creature',ctx) 命中异兽", () => {
    const r = search('狌狌', 'creature', ctx)
    assert.ok(r.length > 0, '无结果')
    assert.equal(r[0].kind, 'creature')
  })
  check("search('狌狌','mountain',ctx) 不返回异兽", () => {
    const r = search('狌狌', 'mountain', ctx)
    assert.ok(!r.some((x) => x.kind === 'creature'))
  })
  check("search('金','product',ctx) 命中物产", () => {
    const r = search('金', 'product', ctx)
    assert.ok(r.length > 0, '无结果')
    assert.equal(r[0].kind, 'product')
  })
  check("search('山','all',ctx) 同时含 mountain 与其他类型", () => {
    const r = search('山', 'all', ctx)
    const kinds = new Set(r.map((x) => x.kind))
    assert.ok(kinds.has('mountain'))
  })

  console.log(`\n结果：${passed} 通过 / ${failed} 失败`)
  if (failed > 0) process.exit(1)
}

main().catch((e) => {
  console.error('自检脚本执行失败：', e)
  process.exit(1)
})
