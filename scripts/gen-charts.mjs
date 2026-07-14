// Generates standalone SVG chart files + rewrites MDX to reference them via <img>.
// Run: node scripts/gen-charts.mjs
import { readFileSync, writeFileSync, mkdirSync } from 'fs';

const SLUG = 'shanghai-house-buying-strategy-young-couples';
const OUT_DIR = `public/posts/${SLUG}`;
const MDX = `content/posts/${SLUG}/index.md`;
mkdirSync(OUT_DIR, { recursive: true });

// shared inline stylesheet so each chart looks correct both as light & dark,
// even when loaded through <img> (where currentColor won't inherit from page CSS).
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

// ---------- chart 1: Shanghai second-hand price index ----------
const c1 = `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 640 380" width="640" height="380" role="img" aria-label="Shanghai second-hand home price index, 2015=100, quarterly from Q1 2018 through Q1 2026">
<title>Shanghai Second-Hand Home Price Index, Q1 2018 – Q1 2026 (2015 = 100)</title>
<desc>Shanghai's second-hand home price index, with the 2015 quarterly average set to 100. The series rises from roughly 108 in early 2018 to a peak near 140 in mid-2022, then declines to about 131 by early 2026, after a brief volume-led stabilisation.</desc>
${STYLE}
<g>
  <line class="line-grid" x1="60" y1="60"  x2="620" y2="60"/>
  <line class="line-grid" x1="60" y1="120" x2="620" y2="120"/>
  <line class="line-grid" x1="60" y1="180" x2="620" y2="180"/>
  <line class="line-grid" x1="60" y1="240" x2="620" y2="240"/>
  <line class="line-grid" x1="60" y1="300" x2="620" y2="300"/>
</g>
<line class="axis" x1="60" y1="340" x2="620" y2="340"/>
<line class="axis" x1="60" y1="40"  x2="60"  y2="340"/>
<text class="tick" x="54" y="64"  text-anchor="end" font-size="10">145</text>
<text class="tick" x="54" y="124" text-anchor="end" font-size="10">135</text>
<text class="tick" x="54" y="184" text-anchor="end" font-size="10">125</text>
<text class="tick" x="54" y="244" text-anchor="end" font-size="10">115</text>
<text class="tick" x="54" y="304" text-anchor="end" font-size="10">105</text>
<text class="op35" x="60"  y="360" text-anchor="middle" font-size="9">Q1'18</text>
<text class="op35" x="180" y="360" text-anchor="middle" font-size="9">Q1'20</text>
<text class="op35" x="320" y="360" text-anchor="middle" font-size="9">Q1'22</text>
<text class="op35" x="460" y="360" text-anchor="middle" font-size="9">Q1'24</text>
<text class="op35" x="600" y="360" text-anchor="middle" font-size="9">Q1'26</text>
<polyline fill="none" stroke="#38bdf8" stroke-width="3" stroke-linejoin="round" stroke-linecap="round" points="60,300 100,290 140,280 180,265 220,245 250,220 280,190 300,165 320,150 345,142 365,138 390,136 420,138 460,143 500,148 540,155 580,158 620,158"/>
<circle cx="390" cy="136" r="5" fill="#f97316" stroke="white" stroke-width="2"/>
<text class="lbl" x="390" y="126" text-anchor="middle" font-size="9" font-weight="700">Peak ~140</text>
<circle cx="620" cy="158" r="5" fill="#22c55e" stroke="white" stroke-width="2"/>
<text class="lbl" x="620" y="172" text-anchor="middle" font-size="9" font-weight="700">~131</text>
<text class="op35" x="320" y="374" text-anchor="middle" font-size="10">Source: National Bureau of Statistics (NBS), Shanghai Second-Hand Price Index (2015=100), quarterly, 2026</text>
</svg>`;

// ---------- chart 2: Annual rent vs own ----------
const c2 = `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 640 380" width="640" height="380" role="img" aria-label="Annual cost of renting vs owning a typical 80m2 apartment by Shanghai district ring, 2026">
<title>Annual Rent vs Annual Ownership Cost by Shanghai Ring, 2026 (¥)</title>
<desc>Grouped bar chart comparing annual rent and annual ownership cost (mortgage principal+interest+fees) for a typical apartment in each of Shanghai's district rings: Inner, Middle, Outer, and New Towns.</desc>
${STYLE}
<g class="line-grid" data-marker="grid">
  <line class="line-grid" x1="60"  y1="60"  x2="620" y2="60"/>
  <line class="line-grid" x1="60"  y1="120" x2="620" y2="120"/>
  <line class="line-grid" x1="60"  y1="180" x2="620" y2="180"/>
  <line class="line-grid" x1="60"  y1="240" x2="620" y2="240"/>
  <line class="line-grid" x1="60"  y1="300" x2="620" y2="300"/>
</g>
<line class="axis" x1="60" y1="340" x2="620" y2="340"/>
<line class="axis" x1="60" y1="40"  x2="60"  y2="340"/>
<text class="tick" x="54" y="64"  text-anchor="end" font-size="10">220k</text>
<text class="tick" x="54" y="124" text-anchor="end" font-size="10">180k</text>
<text class="tick" x="54" y="184" text-anchor="end" font-size="10">140k</text>
<text class="tick" x="54" y="244" text-anchor="end" font-size="10">100k</text>
<text class="tick" x="54" y="304" text-anchor="end" font-size="10">60k</text>
<!-- y mapping: val k → y = 340 - (val/220)*280 ; height = (val/220)*280 -->
<g>
  <rect x="80"  y="209" width="42" height="131" rx="4" fill="#38bdf8"/>
  <rect x="128" y="100" width="42" height="240" rx="4" fill="#f97316"/>
  <rect x="200" y="244" width="42" height="96"  rx="4" fill="#38bdf8"/>
  <rect x="248" y="131" width="42" height="209" rx="4" fill="#f97316"/>
  <rect x="320" y="269" width="42" height="71"  rx="4" fill="#38bdf8"/>
  <rect x="368" y="174" width="42" height="166" rx="4" fill="#f97316"/>
  <rect x="440" y="288" width="42" height="52"  rx="4" fill="#38bdf8"/>
  <rect x="488" y="206" width="42" height="134" rx="4" fill="#f97316"/>
</g>
<text class="op35" x="130" y="360" text-anchor="middle" font-size="9">Inner Ring</text>
<text class="op35" x="248" y="360" text-anchor="middle" font-size="9">Middle Ring</text>
<text class="op35" x="368" y="360" text-anchor="middle" font-size="9">Outer Ring</text>
<text class="op35" x="488" y="360" text-anchor="middle" font-size="9">New Towns</text>
<g transform="translate(420,58)">
  <rect width="12" height="12" rx="2" fill="#38bdf8"/>
</g>
<text class="lbl" x="436" y="69" font-size="10">Annual rent</text>
<g transform="translate(520,58)">
  <rect width="12" height="12" rx="2" fill="#f97316"/>
</g>
<text class="lbl" x="536" y="69" font-size="10">Annual ownership (P+I+fees)</text>
<text class="op35" x="320" y="374" text-anchor="middle" font-size="10">Source: Beike Research, JLL, CBRE estimates, Q1 2026</text>
</svg>`;

// ---------- chart 3: price tier lollipop ----------
const c3 = `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 640 420" width="640" height="420" role="img" aria-label="Shanghai median second-hand price per square metre by district tier, Q1 2026">
<title>Median Shanghai Second-Hand Price (¥/m²) by District Tier, Q1 2026</title>
<desc>Lollipop chart. Inner ring ¥125k/m², middle ring ¥78k/m², outer ring ¥48k/m², new towns ¥29k/m².</desc>
${STYLE}
<g>
  <line class="line-grid" x1="140" y1="60"  x2="600" y2="60"/>
  <line class="line-grid" x1="140" y1="140" x2="600" y2="140"/>
  <line class="line-grid" x1="140" y1="220" x2="600" y2="220"/>
  <line class="line-grid" x1="140" y1="300" x2="600" y2="300"/>
  <line class="line-grid" x1="140" y1="380" x2="600" y2="380"/>
</g>
<line class="axis" x1="140" y1="50" x2="140" y2="390"/>
<text class="tick" x="130" y="64"  text-anchor="end" font-size="10">140,000</text>
<text class="tick" x="130" y="144" text-anchor="end" font-size="10">105,000</text>
<text class="tick" x="130" y="224" text-anchor="end" font-size="10">70,000</text>
<text class="tick" x="130" y="304" text-anchor="end" font-size="10">35,000</text>
<text class="tick" x="130" y="384" text-anchor="end" font-size="10">0</text>
<line x1="220" y1="60"  x2="220" y2="350" stroke="#38bdf8" stroke-width="2"/>
<circle cx="220" cy="60"  r="9" fill="#38bdf8" stroke="white" stroke-width="2"/>
<text class="lbl" x="220" y="50" text-anchor="middle" font-size="10" font-weight="700">¥125k</text>
<line x1="340" y1="178" x2="340" y2="350" stroke="#38bdf8" stroke-width="2"/>
<circle cx="340" cy="178" r="9" fill="#38bdf8" stroke="white" stroke-width="2"/>
<text class="lbl" x="340" y="168" text-anchor="middle" font-size="10" font-weight="700">¥78k</text>
<line x1="460" y1="234" x2="460" y2="350" stroke="#a78bfa" stroke-width="2"/>
<circle cx="460" cy="234" r="9" fill="#a78bfa" stroke="white" stroke-width="2"/>
<text class="lbl" x="460" y="224" text-anchor="middle" font-size="10" font-weight="700">¥48k</text>
<line x1="570" y1="320" x2="570" y2="350" stroke="#22c55e" stroke-width="2"/>
<circle cx="570" cy="320" r="9" fill="#22c55e" stroke="white" stroke-width="2"/>
<text class="lbl" x="570" y="310" text-anchor="middle" font-size="10" font-weight="700">¥29k</text>
<text class="op35" x="220" y="375" text-anchor="middle" font-size="9">Inner Ring</text>
<text class="op35" x="340" y="375" text-anchor="middle" font-size="9">Middle Ring</text>
<text class="op35" x="460" y="375" text-anchor="middle" font-size="9">Outer Ring</text>
<text class="op35" x="570" y="375" text-anchor="middle" font-size="9">New Towns</text>
<text class="op35" x="380" y="402" text-anchor="middle" font-size="10">Source: Beike Research, transaction data, Q1 2026</text>
</svg>`;

// ---------- chart 4: mortgage rate horizontal bars ----------
const c4 = `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 640 320" width="640" height="320" role="img" aria-label="Shanghai first-home mortgage rate 2019 through 2026">
<title>Shanghai First-Home Mortgage Rate, 2019–2026</title>
<desc>Horizontal bar chart. 2019 ~5.05%, 2022 ~4.65%, 2025 ~3.55%, 2026 Q1 ~3.55% (range 3.50–3.60). Near record low.</desc>
${STYLE}
<g>
  <line class="line-grid" x1="140" y1="60"  x2="620" y2="60"/>
  <line class="line-grid" x1="140" y1="120" x2="620" y2="120"/>
  <line class="line-grid" x1="140" y1="180" x2="620" y2="180"/>
  <line class="line-grid" x1="140" y1="240" x2="620" y2="240"/>
  <line class="line-grid" x1="140" y1="300" x2="620" y2="300"/>
</g>
<line class="axis" x1="140" y1="40" x2="140" y2="320"/>
<text class="tick" x="130" y="65"  text-anchor="end" font-size="10">5.50%</text>
<text class="tick" x="130" y="125" text-anchor="end" font-size="10">5.00%</text>
<text class="tick" x="130" y="185" text-anchor="end" font-size="10">4.50%</text>
<text class="tick" x="130" y="245" text-anchor="end" font-size="10">4.00%</text>
<text class="tick" x="130" y="305" text-anchor="end" font-size="10">3.50%</text>
<g font-family="Inter, system-ui, sans-serif">
  <rect x="140" y="55"  width="398" height="24" rx="4" fill="#a78bfa"/>
  <text fill="white" font-weight="800" font-size="10" x="340" y="70"  text-anchor="middle">5.05%</text>
  <text class="lbl" x="130" y="70" text-anchor="end" font-size="10">2019</text>
  <rect x="140" y="115" width="345" height="24" rx="4" fill="#38bdf8"/>
  <text fill="white" font-weight="800" font-size="10" x="314" y="130" text-anchor="middle">4.65%</text>
  <text class="lbl" x="130" y="130" text-anchor="end" font-size="10">2022</text>
  <rect x="140" y="175" width="267" height="24" rx="4" fill="#f97316"/>
  <text fill="white" font-weight="800" font-size="10" x="275" y="190" text-anchor="middle">3.55%</text>
  <text class="lbl" x="130" y="190" text-anchor="end" font-size="10">2025</text>
  <rect x="140" y="235" width="267" height="24" rx="4" fill="#22c55e"/>
  <text fill="white" font-weight="800" font-size="10" x="275" y="250" text-anchor="middle">~3.55%</text>
  <text class="lbl" x="130" y="250" text-anchor="end" font-size="10">2026</text>
</g>
<text class="op35" x="380" y="306" text-anchor="middle" font-size="10">Source: PBOC 5Y LPR fixes, Shanghai bank quotes through Q1 2026</text>
</svg>`;

// ---------- chart 5: talent subsidy donut ----------
const c5 = `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 460 420" width="460" height="420" role="img" aria-label="Shanghai talent-housing support by Five New Town district as proportion of the combined subsidy envelope">
<title>Approximate Talent-Housing Subsidy by Shanghai New-Town District, 2025</title>
<desc>Donut chart. Share of total approximate subsidy pool by district. Songjiang ~¥300k, Qingpu ~¥200k, Fengxian ~¥150k, Jinshan ~¥120k, Baoshan-outer ~¥100k. Combined envelope near ¥900k.</desc>
${STYLE}
<g transform="translate(220,200)">
  <circle r="110" stroke="var(--grid)" stroke-width="36" fill="none"/>
  <!-- pool 900; Songjiang 300 = 120°, Qingpu 200 = 80°, Fengxian 150 = 60°, Jinshan 120 = 48°, Baoshan-outer 100 = 40° (rounding slack 12°) -->
  <circle r="110" stroke="#f97316"   stroke-width="36" fill="none" stroke-dasharray="230 692" transform="rotate(-90)"/>
  <circle r="110" stroke="#fb923c"   stroke-width="36" fill="none" stroke-dasharray="153 529" transform="rotate(-210)"/>
  <circle r="110" stroke="#38bdf8"   stroke-width="36" fill="none" stroke-dasharray="115 467" transform="rotate(-290)"/>
  <circle r="110" stroke="#a78bfa"   stroke-width="36" fill="none" stroke-dasharray="92  490" transform="rotate(-350)"/>
  <circle r="110" stroke="#22c55e"   stroke-width="36" fill="none" stroke-dasharray="76  506" transform="rotate(-398)"/>
  <text class="lbl" y="-6"  text-anchor="middle" font-size="14" font-weight="800">~900k</text>
  <text class="op35" y="14" text-anchor="middle" font-size="10">combined envelope</text>
</g>
<g font-family="Inter, system-ui, sans-serif" font-size="10" class="fg">
  <rect x="30"  y="358" width="10" height="10" fill="#f97316" rx="2"/>
  <text class="lbl" x="44"  y="368">Songjiang (¥300k)</text>
  <rect x="170" y="358" width="10" height="10" fill="#fb923c" rx="2"/>
  <text class="lbl" x="184" y="368">Qingpu (¥200k)</text>
  <rect x="310" y="358" width="10" height="10" fill="#38bdf8" rx="2"/>
  <text class="lbl" x="324" y="368">Fengxian (¥150k)</text>
  <rect x="30"  y="384" width="10" height="10" fill="#a78bfa" rx="2"/>
  <text class="lbl" x="44"  y="394">Jinshan (¥120k)</text>
  <rect x="170" y="384" width="10" height="10" fill="#22c55e" rx="2"/>
  <text class="lbl" x="184" y="394">Baoshan outer (¥100k)</text>
</g>
<text class="op35" x="230" y="412" text-anchor="middle" font-size="9">Source: Shanghai municipal talent-housing programmes, 2025 (approximate, eligibility-dependent)</text>
</svg>`;

writeFileSync(`${OUT_DIR}/chart-1-price-index.svg`, c1);
writeFileSync(`${OUT_DIR}/chart-2-rent-vs-own.svg`, c2);
writeFileSync(`${OUT_DIR}/chart-3-price-tier.svg`, c3);
writeFileSync(`${OUT_DIR}/chart-4-mortgage-rate.svg`, c4);
writeFileSync(`${OUT_DIR}/chart-5-talent-subsidy.svg`, c5);
console.log('Wrote 5 SVGs to', OUT_DIR);

// --- Now rewrite the MDX: replace each inline-chart <figure><svg>...</svg></figure> with <figure><img .../></figure> ---
let mdx = readFileSync(MDX, 'utf-8');

// Order must match the article's chart sequence; each inline chart is the next <figure>...</figure> we encounter.
const replacements = [
  { src: `/posts/${SLUG}/chart-1-price-index.svg`,  alt: 'Shanghai second-hand home price index, 2015=100, quarterly from Q1 2018 through Q1 2026 (line chart: peak ~140 in mid-2022, ~131 by Q1 2026)', w: 640, h: 380 },
  { src: `/posts/${SLUG}/chart-2-rent-vs-own.svg`,  alt: 'Annual rent vs annual ownership cost for a typical apartment, by Shanghai district ring, 2026 (grouped bars)', w: 640, h: 380 },
  { src: `/posts/${SLUG}/chart-3-price-tier.svg`,   alt: 'Shanghai median second-hand price per m² by district tier, Q1 2026 (lollipop chart)', w: 640, h: 420 },
  { src: `/posts/${SLUG}/chart-4-mortgage-rate.svg` ,alt: 'Shanghai first-home mortgage rate 2019–2026 (horizontal bar chart, trending down to ~3.55%)', w: 640, h: 320 },
  { src: `/posts/${SLUG}/chart-5-talent-subsidy.svg`, alt: 'Shanghai talent-housing subsidy by Five New Town district, 2025 (donut chart of combined ¥900k envelope)', w: 460, h: 420 },
];

const FIGURE_RE = /<figure\b[^>]*>[\s\S]*?<\/figure>/g;
let i = 0;
mdx = mdx.replace(FIGURE_RE, (block) => {
  // Only replace blocks that actually contained an <svg> (the charts); leave other <figure> blocks alone.
  if (!/<svg[\s>]/.test(block)) return block;
  if (i >= replacements.length) return block;
  const r = replacements[i++];
  return `\n<figure class="chart-img" style="margin:2.5rem 0;text-align:center;padding:1.5rem 0">\n<img src="${r.src}" alt="${r.alt}" width="${r.w}" height="${r.h}" loading="lazy" style="max-width:100%;height:auto">\n</figure>\n`;
});

// Add a touch of CSS (works inline) for figure in dark mode — optional, non-breaking.
// (The global.css already exists; we intentionally do not require styling for images to display.)

writeFileSync(MDX, mdx, 'utf-8');
console.log(`Replaced ${i} inline chart blocks with <img> references in`, MDX);

// final report
const leftover = (mdx.match(/<svg[\s>]/g) || []).length;
console.log('Remaining inline <svg> in MDX:', leftover);
