# QA 山海经页面质量检测 Skill

## 概述

本文档描述了对山海经可视化页面进行系统化质量验证的完整流程。适用于每次功能迭代后的回归检测。

## 前置条件

```bash
# 安装依赖（一次性）
pnpm install
pnpm install -D playwright
npx playwright install chromium
```

## QA 流程（4 层检测）

### Layer 1: 数据完整性校验

**目标**：验证 data.json 的数据质量

```bash
node --input-type=module << 'EOF'
import { readFileSync } from 'fs';
const data = JSON.parse(readFileSync('public/shanhaijin/data.json', 'utf8'));
let pass = 0, fail = 0;
function check(label, actual, expected) {
  if (actual === expected) { pass++; console.log(`  PASS  ${label}`); }
  else { fail++; console.log(`  FAIL  ${label}: expected ${expected}, got ${actual}`); }
}

// 实体唯一性
const canonicals = new Set(data.entities.map(e => e.canonical));
check('Entity canonical unique', canonicals.size, data.entities.length);

// 关系引用完整性
const entityNames = new Set(data.entities.map(e => e.canonical));
let dangling = 0;
for (const list of Object.values(data.spatialRelations))
  for (const r of list) {
    if (r.subject && !entityNames.has(r.subject)) dangling++;
    if (r.object && !entityNames.has(r.object)) dangling++;
  }
for (const list of Object.values(data.biologyRelations))
  for (const r of list) {
    if (r.subject && !entityNames.has(r.subject)) dangling++;
    if (r.object && !entityNames.has(r.object)) dangling++;
  }
check('Dangling refs', dangling, 0);

// 原文覆盖度
const stationNames = new Set();
for (const line of data.lines) for (const st of line.stations) stationNames.add(st.name);
const textKeys = new Set(Object.keys(data.texts));
let covered = 0;
for (const name of stationNames) {
  if (textKeys.has(name) || textKeys.has(name.replace(/之山$/, '')) ||
      textKeys.has(name.replace(/之[尾首]$/, ''))) covered++;
}
console.log(`  INFO  Text coverage: ${covered}/${stationNames.size}`);

// 坐标完整性
let posCount = 0;
for (const chains of Object.values(data.positions))
  for (const stops of Object.values(chains))
    posCount += Object.keys(stops).length;
check('Position coverage', posCount, 447);

// 距离合理性
let badDist = 0;
for (const line of data.lines) for (const st of line.stations)
  if (st.li != null && (st.li < 10 || st.li > 5000)) badDist++;
check('Distance valid', badDist, 0);

// 方向合理性
const validDirs = new Set(['东','南','西','北','东南','东北','西南','西北',null]);
let badDir = 0;
for (const line of data.lines) for (const st of line.stations)
  if (!validDirs.has(st.direction)) badDir++;
check('Direction valid', badDir, 0);

console.log(`\n=== Layer 1: ${pass} passed, ${fail} failed ===`);
EOF
```

### Layer 2: 纯函数单元测试

**目标**：验证 lib 层的纯函数逻辑

```bash
node scripts/verify-shanhaijin-map.mjs
```

**预期**：所有断言通过（当前 42/43，1 个已有测试问题）

### Layer 3: 构建产物校验

**目标**：验证构建输出和路由可达性

```bash
pnpm build

# 路由可达性抽查
for route in "/shanhaijin/" "/shanhaijin/panorama/" "/shanhaijin/graph/" \
  "/shanhaijin/search/?q=狌狌" "/shanhaijin/entities/" \
  "/shanhaijin/entities/direction/" "/shanhaijin/entities/quantity/" \
  "/shanhaijin/entities/creature/%E7%8B%8C%E7%8B%8C"; do
  code=$(curl -s -o /dev/null -w "%{http_code}" "http://localhost:3000$route")
  echo "$code $route"
done
```

### Layer 4: 视觉与交互检测

#### 4a: HTTP 状态批量检查

```bash
# 所有页面类型
for route in \
  "/shanhaijin/" "/shanhaijin/map/" "/shanhaijin/panorama/" \
  "/shanhaijin/graph/" "/shanhaijin/entities/" \
  "/shanhaijin/entities/creature/" "/shanhaijin/entities/mineral/" \
  "/shanhaijin/entities/water/" "/shanhaijin/entities/plant/" \
  "/shanhaijin/entities/polity/" "/shanhaijin/entities/deity/" \
  "/shanhaijin/entities/person/" "/shanhaijin/entities/omen/" \
  "/shanhaijin/entities/sacrifice/" "/shanhaijin/entities/mountain/" \
  "/shanhaijin/entities/direction/" "/shanhaijin/entities/quantity/" \
  "/shanhaijin/entities/concept/" "/shanhaijin/entities/identity/" \
  "/shanhaijin/chapters/01" "/shanhaijin/chapters/05" "/shanhaijin/chapters/10" \
  "/shanhaijin/search/?q=狌狌"; do
  code=$(curl -s -o /dev/null -w "%{http_code}" "http://localhost:3000$route")
  [ "$code" != "200" ] && echo "FAIL $code $route" || echo "PASS $code $route"
done
```

#### 4b: 关键页面截图（Chrome headless）

```bash
mkdir -p /tmp/qa-screenshots

google-chrome --headless --no-sandbox --disable-gpu \
  --screenshot=/tmp/qa-screenshots/panorama.png --window-size=1440,900 \
  "http://localhost:3000/shanhaijin/panorama/"

google-chrome --headless --no-sandbox --disable-gpu \
  --screenshot=/tmp/qa-screenshots/graph.png --window-size=1440,900 \
  "http://localhost:3000/shanhaijin/graph/"

google-chrome --headless --no-sandbox --disable-gpu \
  --screenshot=/tmp/qa-screenshots/entity.png --window-size=1440,900 \
  "http://localhost:3000/shanhaijin/entities/creature/%E7%8B%8C%E7%8B%8C"

google-chrome --headless --no-sandbox --disable-gpu \
  --screenshot=/tmp/qa-screenshots/rare-chars.png --window-size=1440,900 \
  "http://localhost:3000/shanhaijin/entities/creature/%F0%A2%95%9F%F0%A2%93%A8"

google-chrome --headless --no-sandbox --disable-gpu \
  --screenshot=/tmp/qa-screenshots/map.png --window-size=1440,900 \
  "http://localhost:3000/shanhaijin/map/"
```

#### 4c: 截图视觉分析清单

| 检查项 | 页面 | 判定标准 | 通过？ |
|--------|------|----------|--------|
| 节点无重叠 | panorama | 任意两节点间距 >= 24px | |
| 节点不超出画布 | panorama | 所有节点 x >= 60，无负值 | |
| 按钮名唯一 | panorama | 每个山系按钮显示完整名称，无重复 | |
| 标签可读 | graph | 节点标签无重叠或仅高度数显示 | |
| 原文无标注符号 | entity | 不出现 !, $, •, =, ~, + 等 | |
| 原文内容正确 | entity | 显示该实体相关原文而非其他实体 | |
| 生僻字非 tofu | entity | 𪁺𩩧 等字符渲染为字形而非方框 | |
| 空状态提示 | entities | 无关联数据时显示提示 | |
| 导航链接可用 | 所有页面 | 顶部导航可点击，路由正确跳转 | |
| 加载状态 | 所有页面 | 数据加载时显示 loading 而非空白 | |
| 筛选按钮 | panorama | 只有"全部"和"山经"两个按钮 | |
| 译文无占位符 | chapters | 不出现 [待译] 或 [Translation pending] | |
| 双栏段落对齐 | chapters | 左右列段落数量相同、按 index 对齐 | |
| 实体链接可见 | chapters | 原文中实体名有下划线高亮 | |
| Tooltip 可见 | chapters | hover 实体名显示 tooltip | |
| 搜索去重 | search | 同名山岳只返回 1 条结果 | |
| 繁简搜索 | search | 简体查询匹配繁体数据 | |

#### 4d: Playwright 交互测试

```bash
node scripts/qa-shanhaijin.mjs --skip-http --skip-screenshots --skip-interactive 2>/dev/null
# 或完整运行
node scripts/qa-shanhaijin.mjs
```

## QA 执行流程

```
1. pnpm build
2. pnpm dev &  (等待 5 秒)
3. Layer 1: 数据校验
4. Layer 2: 纯函数测试
5. Layer 3: 构建产物 + HTTP 检查
6. Layer 4: 截图 + 视觉分析
7. 汇总问题，按优先级修复
8. 重复直到全部通过
```

## 修复优先级

| 级别 | 定义 | 处理 |
|------|------|------|
| P0 严重 | 功能不可用、数据错误、崩溃 | 立即修复 |
| P1 高 | 显示错误、布局混乱、交互失效 | 本轮修复 |
| P2 中 | 体验不佳、文案错位、样式问题 | 记录后修复 |
| P3 低 | 优化建议、边角 case | 记录待排期 |

## 各轮修复经验

### 第一轮：基础功能
- 海经/附录空状态 → 直接删除筛选按钮
- 山点堆叠 → BFS 聚类检测 + 均匀分布碰撞解决
- 实体原文相同 → addPassage 移入条件块
- 标注符号 → renderMarked 正则剥离
- 图谱堆叠 → 扩大画布 + 标签碰撞检测
- 生僻字 tofu → Noto Serif CJK SC + BabelStone Han subset

### 第二轮：UI 质量
- 按钮名重复 → line.label 改为 line.name
- 节点溢出画布 → resolveClusters 左边界 clamp
- 实体入口缺失 → 主页面添加全部 15 种类型卡片

### 第三轮：部署修复
- 章节文本缺失 → 文本文件从 doc/ 移到 public/
- 实体 404 → 移除 generateStaticParams 中的 encodeURIComponent
- CI 构建失败 → build-shanhaijin-data.mjs 优雅降级

### 第四轮：搜索 + 章节阅读
- 搜索重复 → dedup key 移除 idx
- 繁简搜索 → 模糊匹配改用 matchKey
- 双栏对照 → ChapterReader 添加 sideBySide 模式
- 翻译占位符 → 完成全部 19 章现代汉语 + 英语翻译
- Tooltip 不显示 → ChapterReader 集成 AnnotatedText
- 翻译文件过大 → 拆分为独立章节文件

## 已知数据问题

| 问题 | 影响 | 处理 |
|------|------|------|
| 24 个重复 canonical 名 | 索引中可能重复 | buildEntityIndex 首次出现策略 |
| 768 个悬空关系引用 | 不显示 | 悬空引用不渲染 |
| 原文覆盖率 92.8% | 32 座山无原文 | 不显示原文摘录 |
| 5 个极缺字符无字体 | 显示为 tofu | 所有免费字体均不覆盖 |
