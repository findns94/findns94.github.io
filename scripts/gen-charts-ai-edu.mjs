// Generates SVG charts for young-children-ai-education-shanghai post
// Run: node scripts/gen-charts-ai-edu.mjs
import { writeFileSync, mkdirSync } from 'fs';

const SLUG = 'young-children-ai-education-shanghai';
const OUT_DIR = `public/posts/${SLUG}/charts`;
mkdirSync(OUT_DIR, { recursive: true });

const STYLE = `<style>
  :root { --fg: #1f2937; --fg-min: #374151; --grid: rgba(0,0,0,0.08); --axis: rgba(0,0,0,0.32); }
  @media (prefers-color-scheme: dark) {
    :root { --fg: #f3f4f6; --fg-min: #9ca3af; --grid: rgba(255,255,255,0.08); --axis: rgba(255,255,255,0.32); }
  }
  text { fill: var(--fg); }
  .tick { fill: var(--fg-min); opacity: 0.55; }
  .lbl  { fill: var(--fg-min); opacity: 0.8; }
  .op35 { fill: var(--fg-min); opacity: 0.35; }
  .line-grid { stroke: var(--grid); stroke-width: 0.3; }
  .axis     { stroke: var(--axis); stroke-width: 1; }
</style>`;

// ---------- chart 1: Screen Time Guidelines Comparison (Grouped Bar) ----------
// Data: minutes per session/day max, by age group and source
const c1 = `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 640 420" width="640" height="420" role="img" aria-label="Screen time guidelines comparison by age group: China NHC 2024, WHO, and AAP recommendations in minutes">
<title>Screen Time Guidelines Comparison by Age Group (minutes)</title>
<desc>Grouped bar chart comparing maximum recommended screen time across three authoritative sources. For ages under 1: China NHC says no screen time, WHO says none, AAP says none. Ages 1-2: China NHC under 10 min/session, WHO under 1 hour/day, AAP emphasizes video-chat only. Ages 3-6: China NHC under 20 min/session, WHO under 1 hour/day, AAP 1 hour/day high quality. Ages 7-12: China NHC under 30 min/session, WHO no strict limit, AAP consistent limits. Ages 13-18: China NHC under 40 min/session.</desc>
${STYLE}
<g class="line-grid">
  <line class="line-grid" x1="120" y1="60"  x2="600" y2="60"/>
  <line class="line-grid" x1="120" y1="120" x2="600" y2="120"/>
  <line class="line-grid" x1="120" y1="180" x2="600" y2="180"/>
  <line class="line-grid" x1="120" y1="240" x2="600" y2="240"/>
  <line class="line-grid" x1="120" y1="300" x2="600" y2="300"/>
</g>
<line class="axis" x1="120" y1="340" x2="600" y2="340"/>
<line class="axis" x1="120" y1="40"  x2="120"  y2="340"/>
<!-- Y axis labels: 0, 10, 20, 30, 40, 50, 60 min -->
<text class="tick" x="114" y="344" text-anchor="end" font-size="10">0</text>
<text class="tick" x="114" y="294" text-anchor="end" font-size="10">10</text>
<text class="tick" x="114" y="244" text-anchor="end" font-size="10">20</text>
<text class="tick" x="114" y="194" text-anchor="end" font-size="10">30</text>
<text class="tick" x="114" y="144" text-anchor="end" font-size="10">40</text>
<text class="tick" x="114" y="94"  text-anchor="end" font-size="10">60</text>
<text class="op35" x="114" y="44"  text-anchor="end" font-size="9">∞</text>
<!-- y mapping: value min → y = 340 - (val/60)*280 ; val=∞ → y=60 -->

<g>
  <!-- Row 1: Under 1 (all zero/none) -->
  <rect x="140"  y="332" width="30" height="8"  rx="3" fill="#f97316"/>
  <rect x="176"  y="332" width="30" height="8"  rx="3" fill="#38bdf8"/>
  <rect x="212"  y="332" width="30" height="8"  rx="3" fill="#a78bfa"/>
  <text class="op35" x="157" y="358" text-anchor="middle" font-size="9">None</text>

  <!-- Row 2: Ages 1-2 (NHC 10min, WHO 60min, AAP ~0/vid only) -->
  <rect x="280"  y="290" width="30" height="50"  rx="3" fill="#f97316"/>
  <rect x="316"  y="40"  width="30" height="300" rx="3" fill="#38bdf8"/>
  <rect x="352"  y="332" width="30" height="8"  rx="3" fill="#a78bfa"/>
  <text class="lbl" x="295" y="284" text-anchor="middle" font-size="8" font-weight="700">10</text>
  <text class="lbl" x="331" y="34"  text-anchor="middle" font-size="8" font-weight="700">60</text>

  <!-- Row 3: Ages 3-6 (NHC 20min, WHO 60min, AAP 60min) -->
  <rect x="400"  y="240" width="30" height="100" rx="3" fill="#f97316"/>
  <rect x="436"  y="40"  width="30" height="300" rx="3" fill="#38bdf8"/>
  <rect x="472"  y="40"  width="30" height="300" rx="3" fill="#a78bfa"/>
  <text class="lbl" x="415" y="234" text-anchor="middle" font-size="8" font-weight="700">20</text>
  <text class="lbl" x="451" y="34"  text-anchor="middle" font-size="8" font-weight="700">60</text>
  <text class="lbl" x="487" y="34"  text-anchor="middle" font-size="8" font-weight="700">60</text>

  <!-- Row 4: Ages 7-12 (NHC 30min) -->
  <rect x="520"  y="190" width="30" height="150" rx="3" fill="#f97316"/>
  <text class="lbl" x="535" y="184" text-anchor="middle" font-size="8" font-weight="700">30</text>
</g>

<!-- X axis labels -->
<text class="op35" x="178" y="380" text-anchor="middle" font-size="10">Under 1 yr</text>
<text class="op35" x="318" y="380" text-anchor="middle" font-size="10">Ages 1–2</text>
<text class="op35" x="438" y="380" text-anchor="middle" font-size="10">Ages 3–6</text>
<text class="op35" x="538" y="380" text-anchor="middle" font-size="10">Ages 7–12</text>

<!-- Legend -->
<g transform="translate(140, 396)">
  <rect x="0"   y="0" width="12" height="12" rx="2" fill="#f97316"/>
  <text class="lbl" x="16" y="10" font-size="9">China NHC 2024</text>
  <rect x="120" y="0" width="12" height="12" rx="2" fill="#38bdf8"/>
  <text class="lbl" x="136" y="10" font-size="9">WHO</text>
  <rect x="190" y="0" width="12" height="12" rx="2" fill="#a78bfa"/>
  <text class="lbl" x="206" y="10" font-size="9">AAP</text>
</g>
</svg>`;

// ---------- chart 2: Learning Improvement from AI Tools (Horizontal Bar) ----------
const c2 = `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 640 340" width="640" height="340" role="img" aria-label="Literacy improvement comparison. Guided AI co-engagement shows 25% improvement in literacy benchmarks. Traditional instruction is baseline at 0%. Unsupervised AI use shows 3% improvement.">
<title>Early Literacy Improvement by Instruction Method (Ages 4–8, one school year)</title>
<desc>Horizontal bar chart comparing literacy benchmark improvement over one school year. Guided AI co-engagement with a parent or teacher present shows approximately 25% improvement (range 15-30% per OECD synthesis 2024). Traditional teacher-led instruction is the baseline at 0% differential. Unsupervised AI use on a tablet alone shows approximately 3% improvement — statistically marginal. The data shows that AI tools are effective supplements but only under guided, co-engaged conditions.</desc>
${STYLE}
<g class="line-grid">
  <line class="line-grid" x1="180" y1="60"  x2="600" y2="60"/>
  <line class="line-grid" x1="180" y1="120" x2="600" y2="120"/>
  <line class="line-grid" x1="180" y1="180" x2="600" y2="180"/>
  <line class="line-grid" x1="180" y1="240" x2="600" y2="240"/>
</g>
<line class="axis" x1="180" y1="280" x2="180" y2="40"/>
<!-- Y labels (improvement %) -->
<text class="tick" x="174" y="64"  text-anchor="end" font-size="10">60%</text>
<text class="tick" x="174" y="124" text-anchor="end" font-size="10">45%</text>
<text class="tick" x="174" y="184" text-anchor="end" font-size="10">30%</text>
<text class="tick" x="174" y="244" text-anchor="end" font-size="10">15%</text>
<text class="tick" x="174" y="284" text-anchor="end" font-size="10">0%</text>
<!-- y mapping: val% → y = 280 - (val/60)*240 -->

<g>
  <!-- Row 1: Guided AI co-engagement → 25% → y = 280 - (25/60)*240 = 180; bar height from 280 to 180 = 100 -->
  <rect x="180" y="160" width="340" height="40" rx="6" fill="#22c55e"/>
  <text x="530" y="184" font-size="13" font-weight="800" fill="white">25%</text>
  <text class="lbl" x="180" y="148" text-anchor="start" font-size="11" font-weight="700">Guided AI + co-engagement</text>

  <!-- Row 2: Traditional instruction → baseline 0% -->
  <rect x="180" y="216" width="6"   height="40" rx="3" fill="#38bdf8"/>
  <text class="lbl" x="192" y="240" font-size="11" font-weight="700">Traditional instruction (baseline)</text>

  <!-- Row 3: Unsupervised AI → 3% → y = 280 - (3/60)*240 = 268; height = 12 -->
  <rect x="180" y="264" width="20"  height="40" rx="3" fill="#f97316"/>
  <text class="lbl" x="206" y="288" font-size="11" font-weight="700">Unsupervised AI only — 3%</text>
</g>

<text class="op35" x="360" y="320" text-anchor="middle" font-size="10">Source: OECD Digital Education Outlook 2024, MIT Media Lab 2024, American Educator Winter 2024/25 — synthesis of adaptive reading program RCTs</text>
</svg>`;

// ---------- chart 3: AI Education Participation by City Tier (Lollipop) ----------
const c3 = `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 640 360" width="640" height="360" role="img" aria-label="AI education participation rates among K-12 children by city tier, 2024. Tier 1 cities Shanghai Beijing Shenzhen Guangzhou 50%. National average 13.5%. Rural areas 4%.">
<title>AI Education Participation Rate by City Tier, China 2024</title>
<desc>Lollipop chart showing the share of school-aged children participating in AI-related education courses by city tier. Tier 1 cities (Shanghai, Beijing, Shenzhen, Guangzhou) lead at approximately 50% participation rate (range 40-60% per iResearch 2024). Tier 2 cities sit at approximately 25%. The national average across all urban and rural areas is approximately 13.5% (range 12-15%). Rural areas trail below 5%. Shanghai specifically is among the highest adopters within Tier 1. The gap between Tier 1 cities and rural areas is more than 12x.</desc>
${STYLE}
<g class="line-grid">
  <line class="line-grid" x1="180" y1="60"  x2="600" y2="60"/>
  <line class="line-grid" x1="180" y1="120" x2="600" y2="120"/>
  <line class="line-grid" x1="180" y1="180" x2="600" y2="180"/>
  <line class="line-grid" x1="180" y1="240" x2="600" y2="240"/>
</g>
<line class="axis" x1="180" y1="280" x2="180" y2="40"/>
<!-- Y axis: 0, 10, 20, 30, 40, 50% -->
<text class="tick" x="174" y="284" font-size="10" text-anchor="end">0%</text>
<text class="tick" x="174" y="236" font-size="10" text-anchor="end">10%</text>
<text class="tick" x="174" y="188" font-size="10" text-anchor="end">20%</text>
<text class="tick" x="174" y="140" font-size="10" text-anchor="end">30%</text>
<text class="tick" x="174" y="92"  font-size="10" text-anchor="end">40%</text>
<text class="tick" x="174" y="44"  font-size="10" text-anchor="end">50%</text>
<!-- y mapping: val% → y = 280 - (val/50)*240 -->

<g>
  <!-- Tier 1: 50% → y = 40, line from 280 to 40 -->
  <line x1="180" y1="280" x2="540" y2="40" stroke="currentColor" opacity="0.15" stroke-width="2"/>
  <circle cx="540" cy="40" r="10" fill="#f97316" stroke="white" stroke-width="2"/>
  <text class="lbl" x="556" y="44" font-size="11" font-weight="800">50%</text>
  <text class="lbl" x="180" y="296" text-anchor="start" font-size="11" font-weight="700">Tier 1 (Shanghai, Beijing, SZ, GZ)</text>

  <!-- Tier 2: 25% → y = 160, line from 280 to 160 -->
  <line x1="180" y1="280" x2="360" y2="160" stroke="currentColor" opacity="0.15" stroke-width="2"/>
  <circle cx="360" cy="160" r="8" fill="#38bdf8" stroke="white" stroke-width="2"/>
  <text class="lbl" x="374" y="164" font-size="11" font-weight="800">25%</text>
  <text class="lbl" x="180" y="296" text-anchor="start" font-size="11" font-weight="700" opacity="0"></text>

  <!-- National avg: 13.5% → y = 215.2, line from 280 -->
  <line x1="180" y1="280" x2="280" y2="215" stroke="currentColor" opacity="0.15" stroke-width="2"/>
  <circle cx="280" cy="215" r="7" fill="#a78bfa" stroke="white" stroke-width="2"/>
  <text class="lbl" x="294" y="219" font-size="11" font-weight="800">13.5%</text>

  <!-- Rural: 4% → y = 260.8, line from 280 -->
  <line x1="180" y1="280" x2="216" y2="261" stroke="currentColor" opacity="0.15" stroke-width="2"/>
  <circle cx="216" cy="261" r="6" fill="#22c55e" stroke="white" stroke-width="2"/>
  <text class="lbl" x="230" y="265" font-size="11" font-weight="800">4%</text>
</g>

<text class="op35" x="390" y="336" text-anchor="middle" font-size="10">Source: iResearch (艾瑞咨询) 2024, Tencent Education synthesis, Ministry of Education curriculum data</text>
</svg>`;

writeFileSync(`${OUT_DIR}/chart-1-screen-time-comparison.svg`, c1);
writeFileSync(`${OUT_DIR}/chart-2-literacy-improvement.svg`, c2);
writeFileSync(`${OUT_DIR}/chart-3-participation-by-tier.svg`, c3);

console.log(`Charts written to ${OUT_DIR}/`);
console.log('  chart-1-screen-time-comparison.svg (grouped bar)');
console.log('  chart-2-literacy-improvement.svg (horizontal bar)');
console.log('  chart-3-participation-by-tier.svg (lollipop)');
