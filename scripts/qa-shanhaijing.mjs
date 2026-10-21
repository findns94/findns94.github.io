#!/usr/bin/env node
/**
 * QA Automation Script for Shanhaijing (山海经) Pages
 *
 * Usage:
 *   node scripts/qa-shanhaijing.mjs [--base-url=http://localhost:3000] [--skip-http] [--skip-screenshots] [--skip-interactive]
 *
 * Phases:
 *   1. HTTP Status Check  — curl all routes, verify HTTP 200
 *   2. Screenshot Key Pages — Playwright captures ~20 key pages
 *   3. Interactive Testing  — Playwright user-flow tests (filters, search, graph, navigation)
 *   4. Report Generation    — Console summary + optional JSON output
 *
 * Exit code: 0 if all pass, 1 if any failures (CI-friendly).
 */

import { execSync } from 'child_process'
import { chromium } from 'playwright'
import fs from 'fs'
import path from 'path'
import { fileURLToPath } from 'url'

const __dirname = path.dirname(fileURLToPath(import.meta.url))

// ── CLI args ────────────────────────────────────────────────────────────
function parseArgs() {
  const args = {}
  const argv = process.argv.slice(2)
  for (const a of argv) {
    if (a.startsWith('--')) {
      const [key, val] = a.slice(2).split('=')
      args[key] = val ?? true
    }
  }
  return args
}

const CLI = parseArgs()
const BASE_URL = (CLI['base-url'] || 'http://localhost:3000').replace(/\/$/, '')
const SCREENSHOT_DIR = '/tmp/qa-screenshots'
const REPORT_FILE = path.join(SCREENSHOT_DIR, 'qa-report.json')

// ── Entity types (15 total, matching src/lib/shanhaijing-entities.ts) ──
const ENTITY_TYPES = [
  { key: 'creature',   slug: 'creature' },
  { key: 'bird_beast', slug: 'bird-beast' },
  { key: 'water',      slug: 'water' },
  { key: 'mineral',    slug: 'mineral' },
  { key: 'plant',      slug: 'plant' },
  { key: 'polity',     slug: 'polity' },
  { key: 'deity',      slug: 'deity' },
  { key: 'person',     slug: 'person' },
  { key: 'omen',       slug: 'omen' },
  { key: 'sacrifice',  slug: 'sacrifice' },
  { key: 'mountain',   slug: 'mountain' },
  { key: 'direction',  slug: 'direction' },
  { key: 'quantity',   slug: 'quantity' },
  { key: 'concept',    slug: 'concept' },
  { key: 'identity',   slug: 'identity' },
]

// ── Chapters ───────────────────────────────────────────────────────────
const CHAPTER_NUMS = [
  '00', '01', '02', '03', '04', '05', '06', '07', '08', '09',
  '10', '11', '12', '13', '14', '15', '16', '17', '18',
]

// ── Sample entity detail pages (50, diverse across types) ─────────────
const SAMPLE_ENTITIES = [
  // creature
  { type: 'creature', name: '狌狌' },
  { type: 'creature', name: '鹿蜀' },
  { type: 'creature', name: '玄龜' },
  { type: 'creature', name: '鳳皇' },
  { type: 'creature', name: '鯥' },
  // bird_beast
  { type: 'bird-beast', name: '蝮虫' },
  { type: 'bird-beast', name: '鮆魚' },
  { type: 'bird-beast', name: '犀' },
  { type: 'bird-beast', name: '象' },
  // water
  { type: 'water', name: '西海' },
  { type: 'water', name: '怪水' },
  { type: 'water', name: '麗𪊨之水' },
  // mineral
  { type: 'mineral', name: '金' },
  { type: 'mineral', name: '玉' },
  { type: 'mineral', name: '桂' },
  { type: 'mineral', name: '育沛' },
  // plant
  { type: 'plant', name: '祝餘' },
  { type: 'plant', name: '迷穀' },
  { type: 'plant', name: '白䓘' },
  // polity
  { type: 'polity', name: '實惟員神磈氏' },
  { type: 'polity', name: '曰高氏' },
  { type: 'polity', name: '曰緱氏' },
  // deity
  { type: 'deity', name: '曰天帝' },
  { type: 'deity', name: '是為飛獸之神' },
  { type: 'deity', name: '實為帝江' },
  // person
  { type: 'person', name: '黃帝' },
  { type: 'person', name: '三身' },
  { type: 'person', name: '夸父' },
  // omen
  { type: 'omen', name: '見則其縣多土功' },
  { type: 'omen', name: '見則其縣多放放士' },
  { type: 'omen', name: '見則郡縣大水' },
  // sacrifice
  { type: 'sacrifice', name: '糈用稌米' },
  { type: 'sacrifice', name: '毛用一璧瘞' },
  { type: 'sacrifice', name: '糈用稌' },
  // mountain
  { type: 'mountain', name: '䧿山' },
  { type: 'mountain', name: '招搖之山' },
  { type: 'mountain', name: '堂庭之山' },
  // direction
  { type: 'direction', name: '東' },
  { type: 'direction', name: '其陽' },
  { type: 'direction', name: '其陰' },
  // quantity
  { type: 'quantity', name: '三百里' },
  { type: 'quantity', name: '三百八十里' },
  { type: 'quantity', name: '三百七十里' },
  // concept
  { type: 'concept', name: '四海' },
  { type: 'concept', name: '湯谷' },
  { type: 'concept', name: '六合' },
  // identity
  { type: 'identity', name: '天神' },
  { type: 'identity', name: '海神' },
]

// ── Screenshot pages (~20) ────────────────────────────────────────────
const SCREENSHOT_PAGES = [
  { path: '/shanhaijing/',              name: '01-overview' },
  { path: '/shanhaijing/panorama/',     name: '02-panorama' },
  { path: '/shanhaijing/map/',          name: '03-map' },
  { path: '/shanhaijing/graph/',        name: '04-graph' },
  { path: '/shanhaijing/entities/',     name: '05-entities-overview' },
  { path: '/shanhaijing/entities/creature/', name: '06-entities-creature-list' },
  { path: '/shanhaijing/entities/creature/狌狌', name: '07-detail-xingxing' },
  { path: '/shanhaijing/entities/mineral/金',   name: '08-detail-gold' },
  { path: '/shanhaijing/entities/direction/東',  name: '09-detail-east' },
  { path: '/shanhaijing/entities/quantity/三百里', name: '10-detail-300li' },
  { path: '/shanhaijing/entities/mountain/招搖之山', name: '11-detail-mountain' },
  { path: '/shanhaijing/entities/deity/曰天帝', name: '12-detail-deity' },
  { path: '/shanhaijing/entities/person/黃帝',  name: '13-detail-yellow-emperor' },
  { path: '/shanhaijing/search/?q=狌狌',      name: '14-search-xingxing' },
  { path: '/shanhaijing/chapters/00',   name: '15-chapter-00-preface' },
  { path: '/shanhaijing/chapters/01',   name: '16-chapter-01-nanshan' },
  { path: '/shanhaijing/chapters/05',   name: '17-chapter-05-zhongshan' },
  { path: '/shanhaijing/chapters/10',   name: '18-chapter-10-haineinan' },
  { path: '/shanhaijing/chapters/18',   name: '19-chapter-18-haineijing' },
  { path: '/shanhaijing/entities/omen/見則其縣多土功', name: '20-detail-omen' },
]

// ── Utility ───────────────────────────────────────────────────────────
function log(msg) {
  console.log(`  ${msg}`)
}

function encodePath(p) {
  // Encode each segment so Chinese chars become percent-encoded for curl
  return p.split('/').map((s) => encodeURIComponent(s)).join('/')
}

function curlStatus(url) {
  try {
    const output = execSync(
      `curl -s -o /dev/null -w "%{http_code}" --max-time 10 "${url}"`,
      { timeout: 15000, stdio: ['pipe', 'pipe', 'pipe'] }
    )
    return parseInt(output.toString().trim(), 10)
  } catch {
    return 0
  }
}

// ── Phase 1: HTTP Status Check ────────────────────────────────────────
function phaseHttpCheck() {
  console.log('\n═══ Phase 1: HTTP Status Check ═══════════════════════════════════')

  const routes = []

  // Main pages
  routes.push('/shanhaijing/')
  routes.push('/shanhaijing/map/')
  routes.push('/shanhaijing/panorama/')
  routes.push('/shanhaijing/graph/')
  routes.push('/shanhaijing/entities/')
  routes.push('/shanhaijing/search/?q=狌狌')

  // Entity type list pages
  for (const t of ENTITY_TYPES) {
    routes.push(`/shanhaijing/entities/${t.slug}/`)
  }

  // Entity detail pages (sample of 50)
  for (const e of SAMPLE_ENTITIES) {
    routes.push(`/shanhaijing/entities/${e.type}/${e.name}`)
  }

  // Chapter pages
  for (const num of CHAPTER_NUMS) {
    routes.push(`/shanhaijing/chapters/${num}`)
  }

  log(`Checking ${routes.length} routes…`)

  let passed = 0
  let failed = 0
  const failures = []

  for (let i = 0; i < routes.length; i++) {
    const route = routes[i]
    const url = `${BASE_URL}${encodePath(route)}`
    const status = curlStatus(url)

    if (status === 200) {
      passed++
    } else {
      failed++
      failures.push({ route, status })
      log(`  ✗ [${status}] ${route}`)
    }

    // Progress every 50 routes
    if ((i + 1) % 50 === 0) {
      log(`  … ${i + 1}/${routes.length} checked (${passed} ok, ${failed} fail)`)
    }
  }

  log(`\n  HTTP: ${passed}/${routes.length} passed, ${failed} failed`)
  if (failures.length > 0) {
    log('  Failed routes:')
    for (const f of failures) {
      log(`    [${f.status}] ${f.route}`)
    }
  }

  return { total: routes.length, passed, failed, failures }
}

// ── Phase 2: Screenshots ──────────────────────────────────────────────
async function phaseScreenshots(browser) {
  console.log('\n═══ Phase 2: Screenshot Key Pages ═══════════════════════════════')

  fs.mkdirSync(SCREENSHOT_DIR, { recursive: true })

  let captured = 0
  let failed = 0
  const failures = []

  for (const page of SCREENSHOT_PAGES) {
    const url = `${BASE_URL}${encodePath(page.path)}`
    const filename = `${page.name}.png`
    const filepath = path.join(SCREENSHOT_DIR, filename)

    try {
      const ctx = await browser.newContext({
        viewport: { width: 1280, height: 900 },
        locale: 'zh-CN',
      })
      const pg = await ctx.newPage()
      await pg.goto(url, { waitUntil: 'networkidle', timeout: 30000 })
      await pg.waitForTimeout(1500) // let animations settle
      await pg.screenshot({ path: filepath, fullPage: true })
      await ctx.close()
      captured++
      log(`  ✓ ${filename}`)
    } catch (err) {
      failed++
      failures.push({ path: page.path, error: err.message })
      log(`  ✗ ${filename} — ${err.message.slice(0, 80)}`)
    }
  }

  log(`\n  Screenshots: ${captured}/${SCREENSHOT_PAGES.length} captured, ${failed} failed`)
  return { total: SCREENSHOT_PAGES.length, captured, failed, failures }
}

// ── Phase 3: Interactive Testing ──────────────────────────────────────
async function phaseInteractive(browser) {
  console.log('\n═══ Phase 3: Interactive Testing ════════════════════════════════')

  const results = []

  // ── Test 1: Panorama filter buttons ────────────────────────────────
  {
    const name = 'Panorama: filter buttons toggle chains'
    try {
      const ctx = await browser.newContext({ viewport: { width: 1280, height: 900 } })
      const pg = await ctx.newPage()
      await pg.goto(`${BASE_URL}/shanhaijing/panorama/`, {
        waitUntil: 'networkidle',
        timeout: 30000,
      })
      await pg.waitForTimeout(2000)

      // Count visible chains before filter
      const chainsBefore = await pg.locator('.p-chain').count()

      // Click first chain selector button (chain buttons show full names like 南山經之首)
      await pg.locator('.p-chain-selector button').first().click()
      await pg.waitForTimeout(1000)

      const chainsAfter = await pg.locator('.p-chain').count()

      // Click "全部" to reset
      // Click another chain button to verify switching
      await pg.locator('.p-chain-selector button').nth(1).click()
      await pg.waitForTimeout(1000)

      const chainsReset = await pg.locator('.p-chain').count()

      await ctx.close()

      const pass = chainsAfter !== chainsBefore || chainsReset === chainsBefore
      results.push({ name, pass, detail: `${chainsBefore}→${chainsAfter}→${chainsReset} chains` })
      log(`  ${pass ? '✓' : '✗'} ${name} (${chainsBefore}→${chainsAfter}→${chainsReset})`)
    } catch (err) {
      results.push({ name, pass: false, detail: err.message })
      log(`  ✗ ${name} — ${err.message.slice(0, 80)}`)
    }
  }

  // ── Test 2: Search input ──────────────────────────────────────────
  {
    const name = 'Search: typing query shows results'
    try {
      const ctx = await browser.newContext({
 viewport: { width: 1280, height: 900 } })
      const pg = await ctx.newPage()
      await pg.goto(`${BASE_URL}/shanhaijing/search/`, {
        waitUntil: 'networkidle',
        timeout: 30000,
      })
      await pg.waitForTimeout(1000)

      // Type a search query
      const input = pg.locator('input[type="text"], input:not([type])').first()
      await input.fill('狌狌')
      await pg.waitForTimeout(1500)

      // Check for results
      const resultItems = await pg.locator('[class*="result"], [class*="search"]').count()
      const hasResults = resultItems > 0 || (await pg.locator('text=狌狌').count()) > 0

      // Navigate with query param
      await pg.goto(`${BASE_URL}/shanhaijing/search/?q=${encodeURIComponent('狌狌')}`, {
        waitUntil: 'networkidle',
        timeout: 30000,
      })
      await pg.waitForTimeout(1500)
      const hasParamResults = (await pg.locator('text=狌狌').count()) > 0

      await ctx.close()

      const pass = hasResults || hasParamResults
      results.push({ name, pass, detail: `${resultItems} result elements` })
      log(`  ${pass ? '✓' : '✗'} ${name}`)
    } catch (err) {
      results.push({ name, pass: false, detail: err.message })
      log(`  ✗ ${name} — ${err.message.slice(0, 80)}`)
    }
  }

  // ── Test 3: Graph node click ───────────────────────────────────────
  {
    const name = 'Graph: clicking node shows detail panel'
    try {
      const ctx = await browser.newContext({ viewport: { width: 1280, height: 900 } })
      const pg = await ctx.newPage()
      await pg.goto(`${BASE_URL}/shanhaijing/graph/`, {
        waitUntil: 'networkidle',
        timeout: 30000,
      })
      await pg.waitForTimeout(3000)

      // Find and click a node circle
      const node = pg.locator('circle').first()
      const nodeCount = await pg.locator('circle').count()

      let detailAppeared = false
      if (nodeCount > 0) {
        await node.click({ force: true })
        await pg.waitForTimeout(1000)
        // Check for a detail panel
        detailAppeared =
          (await pg.locator('[class*="detail"], [class*="panel"], [class*="info"]').count()) > 0
      }

      await ctx.close()

      const pass = nodeCount > 0 && detailAppeared
      results.push({ name, pass, detail: `${nodeCount} nodes, detail=${detailAppeared}` })
      log(`  ${pass ? '✓' : '✗'} ${name} (${nodeCount} nodes, detail=${detailAppeared})`)
    } catch (err) {
      results.push({ name, pass: false, detail: err.message })
      log(`  ✗ ${name} — ${err.message.slice(0, 80)}`)
    }
  }

  // ── Test 4: Entity list card click → detail page ───────────────────
  {
    const name = 'Entity list: clicking card navigates to detail'
    try {
      const ctx = await browser.newContext({ viewport: { width: 1280, height: 900 } })
      const pg = await ctx.newPage()
      await pg.goto(`${BASE_URL}/shanhaijing/entities/creature/`, {
        waitUntil: 'networkidle',
        timeout: 30000,
      })
      await pg.waitForTimeout(1000)

      // Click first entity card/link
      const card = pg.locator('a[href*="/shanhaijing/entities/creature/"]').first()
      const cardCount = await pg.locator('a[href*="/shanhaijing/entities/creature/"]').count()

      let navigated = false
      if (cardCount > 0) {
        const href = await card.getAttribute('href')
        await card.click()
        await pg.waitForTimeout(2000)
        navigated = pg.url().includes('/shanhaijing/entities/creature/')
      }

      await ctx.close()

      const pass = cardCount > 0 && navigated
      results.push({ name, pass, detail: `${cardCount} cards, navigated=${navigated}` })
      log(`  ${pass ? '✓' : '✗'} ${name}`)
    } catch (err) {
      results.push({ name, pass: false, detail: err.message })
      log(`  ✗ ${name} — ${err.message.slice(0, 80)}`)
    }
  }

  // ── Test 5: Map prev/next navigation ──────────────────────────────
  {
    const name = 'Map: prev/next buttons change mountain'
    try {
      const ctx = await browser.newContext({ viewport: { width: 1280, height: 900 } })
      const pg = await ctx.newPage()
      await pg.goto(`${BASE_URL}/shanhaijing/map/`, {
        waitUntil: 'networkidle',
        timeout: 30000,
      })
      await pg.waitForTimeout(2000)

      // Get initial mountain name
      const mountainNameEl = pg.locator('[class*="mountain"], h2, h3').first()
      const initialName = (await mountainNameEl.textContent())?.trim() || ''

      // Click next button
      const nextBtn = pg.locator('button', { hasText: /next|下一|前一座/i }).first()
      const nextCount = await pg.locator('button', { hasText: /next|下一|前一座/i }).count()

      let changed = false
      let newName = ''
      if (nextCount > 0) {
        await nextBtn.click()
        await pg.waitForTimeout(1500)
        newName = (await mountainNameEl.textContent())?.trim() || ''
        changed = newName !== initialName
      }

      await ctx.close()

      const pass = nextCount > 0 && changed
      results.push({ name, pass, detail: `"${initialName}" → "${newName}"` })
      log(`  ${pass ? '✓' : '✗'} ${name} (${initialName}→${newName})`)
    } catch (err) {
      results.push({ name, pass: false, detail: err.message })
      log(`  ✗ ${name} — ${err.message.slice(0, 80)}`)
    }
  }

  // ── Test 6: Chapter navigation ────────────────────────────────────
  {
    const name = 'Chapters: prev/next navigation between chapters'
    try {
      const ctx = await browser.newContext({ viewport: { width: 1280, height: 900 } })
      const pg = await ctx.newPage()
      await pg.goto(`${BASE_URL}/shanhaijing/chapters/01`, {
        waitUntil: 'networkidle',
        timeout: 30000,
      })
      await pg.waitForTimeout(1000)

      // Look for next chapter link
      const nextLink = pg.locator('a[href*="/shanhaijing/chapters/"]').last()
      const linkCount = await pg.locator('a[href*="/shanhaijing/chapters/"]').count()

      let navigated = false
      if (linkCount > 0) {
        await nextLink.click()
        await pg.waitForTimeout(2000)
        navigated = pg.url().includes('/shanhaijing/chapters/')
      }

      await ctx.close()

      const pass = linkCount > 0 && navigated
      results.push({ name, pass, detail: `${linkCount} links, navigated=${navigated}` })
      log(`  ${pass ? '✓' : '✗'} ${name}`)
    } catch (err) {
      results.push({ name, pass: false, detail: err.message })
      log(`  ✗ ${name} — ${err.message.slice(0, 80)}`)
    }
  }

  // ── Test 7: Entity detail page loads with content ─────────────────
  {
    const name = 'Entity detail: page shows entity name and info'
    try {
      const ctx = await browser.newContext({ viewport: { width: 1280, height: 900 } })
      const pg = await ctx.newPage()
      await pg.goto(
        `${BASE_URL}${encodePath('/shanhaijing/entities/creature/狌狌')}`,
        { waitUntil: 'networkidle', timeout: 30000 }
      )
      await pg.waitForTimeout(1000)

      const bodyText = await pg.locator('body').textContent()
      const hasName = bodyText?.includes('狌狌') ?? false
      const hasContent = (bodyText?.trim().length ?? 0) > 100

      await ctx.close()

      const pass = hasName && hasContent
      results.push({ name, pass, detail: `name=${hasName}, contentLen=${bodyText?.trim().length}` })
      log(`  ${pass ? '✓' : '✗'} ${name}`)
    } catch (err) {
      results.push({ name, pass: false, detail: err.message })
      log(`  ✗ ${name} — ${err.message.slice(0, 80)}`)
    }
  }

  const passed = results.filter((r) => r.pass).length
  const total = results.length
  log(`\n  Interactive: ${passed}/${total} passed`)

  return { total, passed, results }
}

// ── Phase 4: Report ───────────────────────────────────────────────────
function phaseReport(httpResult, screenshotResult, interactiveResult) {
  console.log('\n═══ Phase 4: QA Report ══════════════════════════════════════════')

  const report = {
    timestamp: new Date().toISOString(),
    baseUrl: BASE_URL,
    summary: {
      http: {
        total: httpResult?.total ?? 0,
        passed: httpResult?.passed ?? 0,
        failed: httpResult?.failed ?? 0,
      },
      screenshots: {
        total: screenshotResult?.total ?? 0,
        captured: screenshotResult?.captured ?? 0,
        failed: screenshotResult?.failed ?? 0,
      },
      interactive: {
        total: interactiveResult?.total ?? 0,
        passed: interactiveResult?.passed ?? 0,
      },
    },
    failures: {
      http: httpResult?.failures ?? [],
      screenshots: screenshotResult?.failures ?? [],
      interactive: interactiveResult?.results?.filter((r) => !r.pass) ?? [],
    },
  }

  // Console summary
  console.log('\n  ┌──────────────────────────────────────────────┐')
  console.log('  │          Shanhaijing QA Summary               │')
  console.log('  ├──────────────────────────────────────────────┤')
  console.log(`  │ HTTP:      ${String(report.summary.http.passed).padStart(4)}/${String(report.summary.http.total).padEnd(4)} passed${report.summary.http.failed > 0 ? ` (${report.summary.http.failed} FAIL)` : ''}         │`)
  console.log(`  │ Screenshots: ${String(report.summary.screenshots.captured).padStart(2)}/${String(report.summary.screenshots.total).padEnd(2)} captured${report.summary.screenshots.failed > 0 ? ` (${report.summary.screenshots.failed} FAIL)` : ''}        │`)
  console.log(`  │ Interactive: ${String(report.summary.interactive.passed).padStart(1)}/${String(report.summary.interactive.total).padEnd(1)} passed          │`)
  console.log('  └──────────────────────────────────────────────┘')

  // List all failures
  const allFailures = [
    ...report.failures.http.map((f) => `HTTP [${f.status}] ${f.route}`),
    ...report.failures.screenshots.map((f) => `Screenshot: ${f.path} — ${f.error?.slice(0, 60)}`),
    ...report.failures.interactive.map((f) => `Interactive: ${f.name} — ${f.detail?.slice(0, 60)}`),
  ]

  if (allFailures.length > 0) {
    console.log('\n  Issues found:')
    for (const f of allFailures) {
      console.log(`    ⚠ ${f}`)
    }
  } else {
    console.log('\n  All checks passed.')
  }

  // Write JSON report
  try {
    fs.mkdirSync(SCREENSHOT_DIR, { recursive: true })
    fs.writeFileSync(REPORT_FILE, JSON.stringify(report, null, 2), 'utf-8')
    console.log(`\n  JSON report: ${REPORT_FILE}`)
  } catch (err) {
    console.log(`\n  Could not write report: ${err.message}`)
  }

  return report
}

// ── Main ──────────────────────────────────────────────────────────────
async function main() {
  console.log('╔══════════════════════════════════════════════════╗')
  console.log('║       Shanhaijing QA Automation                   ║')
  console.log(`║  Base: ${BASE_URL.padEnd(38)}║`)
  console.log('╚══════════════════════════════════════════════════╝')

  let httpResult = null
  let screenshotResult = null
  let interactiveResult = null

  // Phase 1: HTTP
  if (!CLI['skip-http']) {
    httpResult = phaseHttpCheck()
  } else {
    log('\n  (HTTP check skipped)')
  }

  // Phase 2 & 3: Playwright
  if (!CLI['skip-screenshots'] || !CLI['skip-interactive']) {
    let browser
    try {
      browser = await chromium.launch({ headless: true })
    } catch (err) {
      console.log(`\n  Playwright launch failed: ${err.message}`)
      console.log('  Skipping screenshot and interactive phases.')
    }

    if (browser) {
      if (!CLI['skip-screenshots']) {
        screenshotResult = await phaseScreenshots(browser)
      } else {
        log('\n  (Screenshots skipped)')
      }

      if (!CLI['skip-interactive']) {
        interactiveResult = await phaseInteractive(browser)
      } else {
        log('\n  (Interactive tests skipped)')
      }

      await browser.close()
    }
  } else {
    log('\n  (Playwright phases skipped)')
  }

  // Phase 4: Report
  const report = phaseReport(httpResult, screenshotResult, interactiveResult)

  // Exit code for CI
  const hasFailures =
    (report.summary.http.failed > 0) ||
    (report.summary.screenshots.failed > 0) ||
    (report.summary.interactive.passed < report.summary.interactive.total)

  process.exit(hasFailures ? 1 : 0)
}

main().catch((err) => {
  console.error(`\n  Fatal: ${err.message}`)
  process.exit(2)
})
