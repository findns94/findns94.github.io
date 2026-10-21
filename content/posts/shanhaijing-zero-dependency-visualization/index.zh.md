---
title: "不用 D3、不装图表库：从零写一个力导向图与地铁图"
description: "静态导出、没有 API 路由：我用 9.7 KB(gzip) 手写了 300 轮 Fruchterman-Reingold 力导向布局与地铁图，零图表库(项目数据，2026)。"
coverImage: "/posts/shanhaijing-zero-dependency-visualization/images/cover.jpg"
coverImageAlt: "一张印刷版地铁图的特写：橙色、蓝色、绿色与红色线路在换乘站交汇，呼应本项目用「地铁图」隐喻绘制 447 座山海经山峦的做法"
ogImage: "/posts/shanhaijing-zero-dependency-visualization/images/cover.jpg"
date: "2026-10-21 10:00:00"
lastUpdated: "2026-10-21 10:00:00"
author: "FindNS94"
tags: [Shanhaijing, Web Development, Knowledge Graph]
---

![一张印刷版地铁图的特写：橙色、蓝色、绿色与红色线路在换乘站交汇，呼应本项目用「地铁图」隐喻绘制 447 座山海经山峦的做法](/posts/shanhaijing-zero-dependency-visualization/images/cover.jpg)

## 引言

山海经站点的第一版只有一个数据文件，而每个页面都会去取它。`/shanhaijin/data.json` 有 6,474,522 字节——6.2 MB 的 JSON，gzip 之后 302 KB。全景图页面下载全部内容，只为画出 26 条山系；山形聚焦页面下载全部内容，只为显示一座山；首页也下载全部内容，只为显示十五个数字——十五种实体各自的条目数。

站点没有崩。它一直能用。它只是慢得不像一个 bug，而像一个设计缺陷——因为它确实就是：一个 6.2 MB 的数据块作为构建产物很合理，作为运行时接口很糟糕。

修它的过程变成了一次前端工程实践，分三块：把单体文件拆成 6 个按视图划分的文件；把昂贵的几何计算从浏览器搬进构建期；以及——我真正想写的部分——用 TypeScript 和 SVG 手写这两个可视化，不引入 D3、不引入 cytoscape、不引入任何图表库。

本文讲的是工程本身。它假设你知道力导向布局是什么，但想知道自己动手实现会发生什么、Fruchterman-Reingold 的那几个常数为什么重要、一张地铁图如何从「又东三百里」这句话里推导出来，以及「零依赖」这个说法在哪里诚实、在哪里只是营销。项目的数据侧请见[知识图谱管线那篇](/posts/shanhaijing-knowledge-graph-pipeline/)；站点到底装了什么，请见[系列总览](/posts/machine-reading-shanhaijin-knowledge-graph/)。

<!-- more -->

> **核心要点**
> - **零图表依赖。** 整个力导向图——300 轮 Fruchterman-Reingold 布局、连通分量装箱、标签碰撞——打包后只有 9.7 KB(gzip)。
> - **6.2 MB 变成 539 KB。** 按视图拆分 `data.json` 后，全景图的首屏载荷降到 1/8.8。
> - **地铁图是确定性的。** 26 条山系的布局全部在构建期算好。
> - **25.6 KB 换 50 个显示不出的汉字。** BabelStone Han 扩展 B 子集覆盖了 𪁺(U+2A07A)，思源宋体没有它。
> - **体积不是真正的理由。** 单是 d3-force 就只有 3.0 KB(gzip)；手写是为了控制力。

---

## `output: 'export'` 到底禁掉了什么？

它禁掉了服务器。本站是 Next.js 14 App Router 项目，配置为 `output: 'export'`、`trailingSlash: true`、`images: { unoptimized: true }`，产物是一堆静态文件，背后没有任何 Node 进程([Next.js](https://nextjs.org/docs/app/building-your-application/deploying/static-exports)，2026)。没有 route handler、没有 server action、没有按需渲染、没有图片优化服务、没有 `/api/*`。

这一个约束会级联影响本文里的每一个设计决策。其中三条影响最大。

**第一，任何动态内容要么预渲染，要么靠 fetch。** 山海经站点最终两者都用上了：2,141 个实体页面是预渲染的 HTML——构建期从磁盘读 `data.json`，为每个实体输出一个页面；而五个交互视图(全景图、山形聚焦、知识图谱、搜索、经文阅读器)是客户端组件，它们 fetch 静态 JSON 然后在浏览器里渲染 SVG。没有第三种选择：没有任何端点能按需计算一次布局。

**第二，静态导出意味着 JSON 文件本身就是 API。** 它们放在 `public/` 下，原样提供，由 CDN 缓存，体积是每位访客都要付的首屏成本。没有查询语言、没有字段选择、没有分页。如果某个视图只需要 12% 的数据，而文件里有 100%，浏览器就会下载 100%。这就是后文拆分文件的全部理由。

**第三，只有预渲染的 HTML 才是非 JS 爬虫能看到的内容。** 交互视图渲染进一个空的 `<div>`，再由 JavaScript 填充，所以 GPTBot 和 ClaudeBot 从这里什么也拿不到。需要被引用的部分——实体页、经文页、总览页——因此必须在构建期生成完整 HTML。这是真实的取舍，不是白捡的便宜，也正是站点宁可要 2,141 个静态实体页、也不要一个快速的客户端实体浏览器的原因。

一句话总结这个约束：由于本站是无 route handler 的静态导出，所有数据必须以静态 JSON 交付，所有可被引用的内容必须预渲染——这就是为什么构建期要从一个 6,474,522 字节的 `data.json` 生成 2,141 个实体页、15 个类型页和 19 个经文页([项目数据](https://findns.cc/shanhaijin)，2026)。

---

## 为什么要手写力导向布局？

因为布局本身是最简单的部分，它周围的一切都不是。Fruchterman-Reingold 算法大约四十行算术；`src/lib/shanhaijin-graph.ts` 剩下那 580 行是图谱构建、均衡截断、连通分量分离、标签碰撞，以及 UI 需要的四种筛选操作。库能给我那四十行，其余部分我照样得写——只不过是在别人的数据模型上写。默认视图渲染 179 个节点、250 条边，而这 100% 是手写 TypeScript。

那四十行到底在做什么，下面逐条说。

### 300 轮 Fruchterman-Reingold

这个算法把图当成一个物理系统：任意两点互相排斥，每条边互相吸引，两个力都只依赖一个长度常数 `k`，也就是「理想边长」：

```
k = sqrt(画布宽 × 画布高 / 节点数)
```

默认画布 1400 × 900、200 个节点时，`k = sqrt(1400 × 900 / 200) = 79.4`。距离为 `d` 的两点，斥力是 `k² / d`；长度为 `d` 的边，引力是 `d² / k`。这个不对称就是全部的诀窍：斥力随距离衰减，所以远处的点几乎互不影响；引力随距离增长，所以被拉长的边会强烈回缩。平衡点大致落在 `k` 附近。

三个常数负责不让它炸掉：

- **温度。** 初始温度是 `min(宽, 高) / 10 = 90`，每轮线性冷却 `90 / 301 = 0.299`，下限 0.5。任何节点单轮位移都不能超过当前温度，于是前几轮是探索性的，最后几轮是微调。
- **重力。** 每轮向画布中心加一个系数 0.1 的拉力。没有它，不连通的分量会飘出画布，最后的 `viewBox` 也就失去意义。
- **退化保护。** 当两个节点落在 0.01 单位以内时，斥力方向改用随机抖动。用趋近于零的 `d` 去除 `k² / d` 会得到无穷大，污染此后所有坐标；这个保护只花一次比较，却避免了一整类壮观的失败。

```ts
// 斥力：f = k²/d —— 遍历所有节点对，两端都受力
const d = Math.sqrt(d2)
const f = (k * k) / d
a.vx += (dx / d) * f;  a.vy += (dy / d) * f
b.vx -= (dx / d) * f;  b.vy -= (dy / d) * f

// 引力：f = d²/k —— 只沿边计算
const f2 = (d * d) / k
a.vx += (dx / d) * f2;  a.vy += (dy / d) * f2
b.vx -= (dx / d) * f2;  b.vy -= (dy / d) * f2
```

斥力循环每轮是 `O(n²)`——200 个节点就是 19,900 次节点对计算，乘 300 轮——所以一次布局大约要做 600 万次距离计算。在这台机器的 Node 里，默认图谱完整跑完 300 轮需要 **24 ms**；新进程里的第一次因为 JIT 预热是 39 ms。浏览器里会更慢，所以组件把计算放在 `setTimeout(…, 40)` 之后，让加载态先画出来再阻塞主线程。

### 让它变得可读的三个后处理

原生的 Fruchterman-Reingold 在这种图上会得到一团无法阅读的毛线球，因为山海经图谱不是连通图。它是一团密集的山峦—矿物簇、一个中等大小的水系网络，以及一条由两三个节点组成的长尾碎片。三个后处理负责解决这件事。

**1. 布局前的均衡截断。** 默认关系类型下有 1,350 个候选节点，200 个名额必须花得有目的。按总度数直接截断会把名额全给山峦和矿物，因为 `produces` 关系占绝对多数。代码改为计算每个节点在**每种关系类型内部**的度数，为每种类型预留 `ceil(200 / 活跃类型数) = 40` 个名额，剩余的再按总度数补齐。没有这一步，异兽节点永远不会出现——它们的边数远少于矿物节点，而图谱恰好会丢掉大家真正想看的东西。

**2. 连通分量分离。** 模拟收敛后，对边表做一次 BFS 把节点切成连通分量，按大小降序排列，再装进网格单元(`pad = 48`，`cols = ceil(sqrt(分量数))`)，每个分量缩放到单元尺寸并居中。这一步把一团歪斜的云变成下面截图里那种可读的三区布局。

**3. 标签碰撞检测。** 节点标签是矩形——`标签长度 × 11` 像素宽、14 像素高，锚在节点下方——给 200 个标签排版是一个稠密矩形问题。代码按节点半径降序排序，贪心地逐个放置标签，只要不与已放置的矩形相交就放；唯一的例外是半径 ≥ 12 的节点(度数 ≥ 25，真正的枢纽)无论是否碰撞都强制显示标签。默认图谱的最终结果是 **200 个标签里显示 83 个**，这个数字很诚实：三分之一的图有标签，活下来的都是最大节点上的那些。

<figure class="chart-img" style="margin:2.5rem 0;text-align:center;padding:1.5rem 0">
  <img src="/posts/shanhaijing-zero-dependency-visualization/images/force-directed-graph-179-nodes.jpg"
       alt="山海经站点中手写力导向知识图谱的截图：179 个节点与 250 条边分成三个区域，左侧是绿色山峦与紫色矿物构成的密集簇，中间是蓝色水系网络，右侧是两条小型链条"
       loading="lazy"
       style="max-width:100%;height:auto">
</figure>

<!-- [UNIQUE INSIGHT] 连通分量处理正是手写版本胜过通用库的地方。现成的力导向布局都假定图是连通的；当图碎裂时，它们要么用人为的力把碎片拉到一起(扭曲拓扑)，要么任其飘到角落。用网格装箱加逐单元归一化只要十五行代码，就能得到真正可读的布局——但前提是你知道自己的图是碎的，而这就要求你从数据到像素全程自己掌控。 -->

### 写这篇文章时发现的 bug

为本文测量布局时，我注意到 UI 报的是 179 个节点，而不是截断本该保留的 200 个。原因在于截断与筛选之间一处小小的漏洞。

均衡截断是按「关系类型内度数排名」来决定保留哪些节点的，但一条边只有在**两端都存活**时才会输出。于是一个节点可能因为 `adjacent_to` 类型内的排名被选中，而它的邻居全部被截掉，结果它在建成的图里一条边都没有。客户端随后调用 `filterByRelationType`，它只保留出现在筛选后边表里的节点，于是这些孤立点被丢弃。两百个被选中的节点里有 21 个这样变成孤儿——蒼玉(因 `produces` 入选)、䃌山(因 `adjacent_to` 入选)、毒魚(因 `has_efficacy` 入选)，以及另外十八个。这不是崩溃，也不是错误答案；它是节点预算与读者所见之间 10.5% 的缺口。修法是加一趟闭包遍历——截断后丢弃没有存活边的节点并补足名额——它已经进了待办列表。

<!-- [ORIGINAL DATA] 在默认图谱上实测：均衡截断选中 200 个节点，输出 250 条边，其中 179 个节点至少有一条存活边，21 个成为孤儿。250 条边的构成是 `produces` 133 条、`adjacent_to` 41 条、`water_connect` 35 条、`inhabits` 26 条、`has_efficacy` 15 条。若把 12 种关系类型全部打开(默认只开 5 种)，同样的截断会得到 200 个节点与 1,645 条边。 -->

---

## 怎么把「又东三百里」变成一张地铁图？

累加向量，再把结果压平。《山经》用方向和距离描述每座山相对前一座山的位置——又東三百里，「向东再走三百里」。这本身就是一个向量。十六个方位字符串(东、东南、东偏南、北偏西……)映射到 `DIRECTION_VECTORS` 里的 16 个单位向量，每座山的原始坐标就是 `方向 × 里数` 的累加和。最长的山系中次十一經有 48 座山，它累加出来的路径就是下图的样子。

<figure class="chart-img" style="margin:2.5rem 0;text-align:center;padding:1.5rem 0">
  <img src="/posts/shanhaijing-zero-dependency-visualization/images/panorama-chain-48-mountains.jpg"
       alt="山海经中次十一經山系的地铁图全景截图：48 座山作为站点由一条折线串联，左段爬升到高点，中段下降，右半段拉平成一段间距均匀的节点串"
       loading="lazy"
       style="max-width:100%;height:auto">
</figure>

原始累加结果没法直接画，原因有两个。距离从几里到几千里不等，线性缩放会把 40 个站点压在一起、把一个站点甩到 900 像素之外。而垂直分量几乎总是零，因为多数条目只写「东」或「西」，画出来是一条毫无视觉结构的直线。

两个归一化同时解决这两个问题。横向上，整条山系被重新缩放，使最小间距至少达到 `MIN_NODE_SPACING × (n − 1) = 24 × 47 = 1,128` 单位宽——也就是说，不管原文声称多远，图都会被拉伸到铺满宽度，这正是地铁图对真实地理所行使的那种特权。纵向上，整条山系被压进 `MAX_Y_OFFSET = 60` 单位，所以一条累计漂移了四千里垂直距离的山系，读起来仍是一条带驼峰的横线，而不是一条斜线。

### 先找簇，再均匀分布，最后互相推开

归一化之后站点仍会重叠：相距四十里的两座山，缩放后可能只差不到一个像素。碰撞消解器最多跑 500 轮，每轮做两件事。

**簇消解**先构建一张邻近图：任意两点距离小于 `COLLISION_DIST = 24` 单位就相连，再用 BFS 找出连通簇。长度 ≥ 2 的簇会被**均匀**重排到以簇质心为中心、总长 `(簇大小 − 1) × 24` 单位的水平段上，并施加 ±8 单位的上下交错偏移，让相邻站点在视觉上可区分。重排前先按序号排序，所以这个过程绝不会打乱路线顺序。

**互相推开**负责收尾：对任何仍小于 24 单位的节点对，各自沿连线方向移动重叠量的一半。这一趟专门处理被上一趟**制造出来**的簇——把一组推开，可能刚好把它的最后一个节点推进下一组的第一个节点。

循环在两次处理都没有移动、或跑满 500 轮时结束。26 条山系全部算完在 Node 里只要 **10.0 ms**；那条 48 座山的山系单独算是 **0.55 ms**。它快是因为链条本身很小——平均 17.2 座山，最长 48 座——也因为簇消解通常几轮就收敛，而不是真的跑 500 轮。

最后还有一道硬钳位：任何节点都不得位于 `PADDING_X = 60` 左侧。因为均匀重排是以质心为中心的对称操作，密集簇最左侧的站点可能被推出画布。

一句话总结这个布局：地铁图全景把每座山的「方位 + 里程」短语转成按里数缩放的向量，沿山系累加，再重缩放使山系至少跨 1,128 单位、把纵轴压平到 60 单位，最后用邻近簇重排加迭代推开消解碰撞——26 条山系全部算完 10.0 ms([项目数据](https://findns.cc/shanhaijin)，2026)。

---

## 为什么要把布局算在构建期？

因为静态站点可以这么做，而另一种做法是让每位访客的浏览器在每个交互动作上重算同样的算术。`scripts/build-shanhaijin-data.mjs` 在构建时对 26 条山系各跑一次 `layoutChain`，把得到的节点坐标写进 `public/shanhaijin/panorama-layout.json`——原始 187,347 字节，gzip 后 12.0 KB。客户端组件读这些坐标直接渲染，只有在预计算文件缺失时才回退到运行时调用 `layoutChain`。

同样的模式也用在山形聚焦视图的搜索索引上。`buildCtx` 把 447 个站点展平，并建立四份查找表：`byName`(419 项)、`chainIndex`(69 项)、`creatureIndex`(202 项)以及扁平站点数组。这些在 TypeScript 里是 `Map` 对象，无法直接 JSON 序列化，所以构建脚本用 `Object.fromEntries` 转成普通对象写进 `map-data.json` 的 `ctx` 键，客户端再用 `new Map(Object.entries(...))` 转回去。反序列化函数在结构不匹配时返回 `null`，组件随即回退到 `buildCtx`——两行优雅降级，让这次改动不必挑日子上线。

不过还有一个更微妙、也更重要的理由，它和性能无关。

<!-- [PERSONAL EXPERIENCE] 我原本以为预计算可以用 CPU 开销来论证，结果做不到。最长山系的 `layoutChain` 只要 0.55 ms，`buildCtx` 只要 0.6 ms，连解析那个 6.2 MB 的单体文件在 Node 里也只有 18.4 ms、在 Chromium 里 7.2 ms。在快电脑上这些都不是问题。在四年前的安卓手机上大约会差五到八倍，那也仍然不到 10 ms。预计算并没有在毫秒上回本，它回本在确定性上，也回本在载荷上——如果我没实测，我会用错误的理由说服自己。 -->

**确定性。** `forceDirectedLayout` 用 `Math.random()` 生成初始位置。对一张探索性的图这没问题——按一下「重置布局」就换一种排布，这甚至算个特性——但对全景图就是灾难。一张每次切换山系站点都会挪位的地铁图不是地图。把 `layoutChain` 的输出冻结进 JSON，意味着每位读者、每台设备、每次会话看到的都是同样的 26 条线。坐标从此属于数据，而不属于渲染。

**载荷。** 这才是真正的收益，也是下一节的主题。

---

## 把一个 6.2 MB 文件拆成六个，到底买到了什么？

它把全景图视图的载荷降到 1/8.8，把地图视图也降到 1/8.8，而对那两个确实需要大部分数据的视图几乎毫无帮助。这就是诚实的总结，下面这张图刻意排成让你同时看到这两半。

<figure class="chart-img" style="margin:2.5rem 0;text-align:center;padding:1.5rem 0">
  <img src="/posts/shanhaijing-zero-dependency-visualization/charts/chart-1-data-payload-before-after.svg"
       alt="分组水平条形图，对比拆分 data.json 前后各山海经视图的原始 JSON 载荷：全景图从 6,322.8 KB 降到 722.1 KB，地图视图降到 720.9 KB，搜索降到 755.5 KB，知识图谱降到 5,543.7 KB，实体详情降到 5,856.3 KB，总览页降到零"
       loading="lazy"
       style="max-width:100%;height:auto">
</figure>

拆分依据是**消费者**而不是数据类型，这就是全部设计。六个文件：

| 文件 | 原始 | gzip | 谁在取 |
|---|---|---|---|
| `panorama-data.json` | 539.1 KB | 28.4 KB | 全景图视图 |
| `panorama-layout.json` | 183.0 KB | 12.0 KB | 全景图视图(预计算坐标) |
| `map-data.json` | 720.9 KB | 64.3 KB | 山形聚焦视图(内含序列化的搜索索引) |
| `search-data.json` | 755.5 KB | 48.7 KB | 限定范围搜索 |
| `graph-data.json` | 5,543.7 KB | 222.8 KB | 知识图谱(实体 + 全部关系) |
| `entity-data.json` | 5,856.3 KB | 256.2 KB | 实体详情页 |
| `meta.json` | 0.4 KB | 0.2 KB | 总览页、SEO |

有三点值得说明。

**gzip 比高得离谱，而它改变了论证方式。** 满是重复中文实体名和重复键名的 JSON 能压到原始体积的 4%–9%：6.2 MB 的单体文件过网只有 302 KB，`graph-data.json` 只有 222 KB。所以拆分带来的**网络**收益真实但有限——全景图是从 302 KB 降到 40 KB，而不是从 6.2 MB 降到 539 KB。真正随设备档次拉开差距的是**解析**：在主线程上，Node 里 18.4 ms、Chromium 里 7.2 ms 的 JSON 解析，而且必须在任何布局开始之前完成。从一台中端手机上拿走 5.6 MB 的解析量，比省下带宽更值钱。

**总览页现在一个字节都不取。** 它以前要下载完整的 6.2 MB 文件，只为算十五个数字。这些数字现在是 `src/lib/shanhaijing-data.ts` 里一个冻结的 TypeScript 常量 `ENTITY_TYPE_COUNTS`，并附了一行注释说明它由 `data.json` 生成、必须保持同步。实体索引页也做了同样的改造。这是整个重构中最大的一笔收益：从 6.2 MB 到零，靠的是承认「每次构建才变一次的数字不该出现在运行时请求里」。

**有两个视图没有改善，我不打算假装它们改善了。** `graph-data.json` 是 5.5 MB，因为力导向图确实需要全部 2,141 个实体和 7,113 条关系，才能从中挑出 200 个节点的子集；`entity-data.json` 是 5.9 MB，因为实体页需要分类学、别名、消歧记录和两套关系。这两个的正确解法不是拆分而是**投影**——预先生成一份截断到 200 节点的图，以及按实体切好的关系切片——那是一次比这轮重构更大的改动。

还有一件小事很重要：总览页会输出 `<link rel="prefetch" href="/shanhaijin/panorama-data.json" as="fetch">`，让那 539 KB 的全景图数据在读者还在看总览时就开始下载。在静态站点上你没有任何服务端提示可用，但 HTML 在你手里，而 prefetch 提示是最便宜的一次延迟优化。

<!-- [ORIGINAL DATA] 所有体积用 `stat` 在 `public/shanhaijin/` 下的已提交文件上测得，gzip 使用 `gzip -9`。JSON.parse 耗时在 Node 20 测得，并在 Chromium 中用 `performance.now()` 包住 fetch 加解析复核：`data.json` 5,106,894 字符 / 解析 7.2 ms；`panorama-data.json` 507,153 字符 / 0.7 ms；`map-data.json` 620,136 字符 / 1.3 ms。Chromium 的数字比 Node 好 2.5 倍，这提醒我们 Node 不是浏览器基准。 -->

---

## 没有字体能渲染的汉字，怎么显示？

给一个有的字体做子集化，再用 `unicode-range` 把门，这样不需要它的人一分钱都不付。山海经需要 50 个主字体画不出来的扩展 B 汉字。最有名的是 𪁺(U+2A07A)，它出现在南山经的基山，原文那里记了一种叫 𪁺𩿧 的鸟——三个头、六只眼睛、六只脚、三只翅膀，吃了它的肉不会犯困。思源宋体(Noto Serif CJK SC)有 44,777 个码位，其中包含 2,057 个扩展 B 汉字，偏偏没有这一个；也没有 𩿧(U+29FE7)——正文需要的 50 个扩展 B 汉字里，有 48 个不在它的 cmap 中。

解法是一份 26,196 字节的 BabelStone Han WOFF2 子集，里面恰好 159 个码位：95 个 ASCII、14 个排版与中文标点，以及正文需要的 50 个扩展 B 汉字。完整的 BabelStone Han WOFF2 有 7,438,036 字节，所以这份子集是它的 0.35%。

<figure class="chart-img" style="margin:2.5rem 0;text-align:center;padding:1.5rem 0">
  <img src="/posts/shanhaijing-zero-dependency-visualization/charts/chart-2-font-subset-lollipop.svg"
       alt="对数刻度棒棒糖图，对比三个中文字体文件：思源宋体 16,317 KB、完整 BabelStone Han WOFF2 7,264 KB、实际发布的 BabelStone Han 扩展 B 子集 25.6 KB，仅为完整字体的 0.35%"
       loading="lazy"
       style="max-width:100%;height:auto">
</figure>

真正有意思的是这道门怎么把。`src/app/fonts.css` 用 `unicode-range: U+20000-2A6DF` 声明回退字体，同时主字体自己的 `@font-face` 规则显式**排除**了这个区段——它的扩展 B 范围从 `U+2A700` 开始，而不是 `U+20000`。两个范围不重叠，任何文件都不会下载，直到真的渲染到属于它范围的字符([MDN](https://developer.mozilla.org/en-US/docs/Web/CSS/@font-face/unicode-range)，2026)。

这意味着那 25.6 KB 只会由「打开了含 50 个生僻字之一的经文页或实体页」的读者付出。浏览知识图谱的读者看到的全是常用字，一个字节都不用下载；打开南山经的读者付一次 25.6 KB，换来的是 𪁺𩿧 而不是两个豆腐块。

主字体是另一回事，而且不太好看：自托管的思源宋体 WOFF2 文件是 16.7 MB 和 17.8 MB。它们也用同样的方式把门——只看拉丁字母的读者两个都不下载——但任何读者只要看到一个汉字，就会触发整份下载。这是待办清单上的下一项，而那份 25.6 KB 的扩展 B 子集恰好证明了子集化这条路走得通。

<!-- [UNIQUE INSIGHT] 这类失败的诡异之处在于：开发者完全看不见，读者一眼就看见。中文字体缺字不会抛异常、不会打日志、不会改变布局——它渲染成一个豆腐块，或者更糟，回退到一套字重完全不同的系统字体，于是那个字看起来**几乎**是对的。我能发现这 50 个字的缺口，只是因为写了个脚本遍历项目自己的文本，用 fontTools 把每个码位对着字体的 cmap 查一遍，把查不到的打印出来。针对自己语料的覆盖测试，是唯一可靠的办法。 -->

---

## 2,141 个静态页面要付什么代价？

代价是构建时间和磁盘，换来的是可抓取性。`src/app/shanhaijin/entities/[type]/[name]/page.tsx` 里的 `generateStaticParams` 在构建期用 `readFileSync` 同步读取 `public/shanhaijin/data.json`，遍历 2,141 个实体，把每个 `typeKey` 过一个 15 项的表映射成 slug(`bird_beast` → `bird-beast`)，返回 2,141 组 `{ type, name }`([Next.js](https://nextjs.org/docs/app/api-reference/functions/generate-static-params)，2026)。产物是 2,141 个预渲染实体页，加上 15 个类型索引页和 19 个经文页——18 篇正文加郭璞序。

构建产物里的数字：

| 指标 | 数值 |
|---|---|
| 实体详情页 | 2,141 |
| 类型索引页 | 15 |
| 经文页 | 19 |
| 全站 `index.html` 总数 | 2,304 |
| 实体页平均体积 | 12,547 字节 |
| 静态产物总量 | 222 MB |
| 其中山海经部分 | 81 MB |

这个设计有两点必须点出来，因为它们是锋利的边角而不是特性。

**`generateStaticParams` 会吞掉失败。** 这个函数包在 `try/catch` 里，读不到文件就返回 `[]`。静态导出没有服务器可以按需渲染缺失路径，所以如果某次构建时 `data.json` 不在——比如某个 `.gitignore` 改动把它排除了——构建会成功，并输出零个实体页。站点会带着 2,141 个死链上线，一声不吭。这个 catch 本来是为 CI 环境准备的(那里没有 `doc/shanhaijin/`，预构建脚本会提前退出)，但它同时兼任了一个静默失败模式。

**预渲染不免费，也不总是正确答案。** 一个博客产出 222 MB 是很多；光山海经部分就 81 MB。每个实体页都把自己的关系数据和章节上下文以 HTML 形式再嵌一遍。若换成客户端实体浏览器加一个 5.9 MB 的 JSON 文件，磁盘占用更小，重复访问时渲染更快——而它对所有不执行 JavaScript 的爬虫都是隐形的。考虑到这个项目的全部意义就是让一部 2,300 年前的文本可被机器读取、可被引用，预渲染 2,141 个页面是正确取舍。但它不是显然正确的取舍，下一个同类型的项目完全有理由做出不同选择。

---

## 常见问题

### 真的可以不用 D3 写出力导向图吗？

可以，而且算法比它周围的管道更小。Fruchterman-Reingold 模拟大约 40 行，`src/lib/shanhaijin-graph.ts` 里另外 580 行负责图谱构建、200 节点的均衡截断、连通分量装箱和标签碰撞。完整的交互图谱——布局、SVG 渲染、拖拽、平移、缩放、筛选——打包后 27,861 字节原始、9,704 字节 gzip([项目数据](https://findns.cc/shanhaijin)，2026)。

### 力导向布局需要迭代多少轮？

这个规模的图 300 轮够了，而温度曲线比轮数更重要。初始温度 90 单位、每轮冷却 0.299 时，默认的 200 节点图谱在 Node 里约 24 ms 收敛。跑到 500 轮对布局的改变比随机种子还小——这才是真正的限制：结果是局部最优，不是唯一答案。

### 为什么地铁图是确定性的，力导向图却不是？

因为地铁图的坐标在构建期算一次就冻结进 JSON，而力导向图的初始位置来自 `Math.random()`。全景图的 `layoutChain` 输出会为全部 26 条山系写进 `panorama-layout.json`(原始 183.0 KB、gzip 12.0 KB)，所以每位读者看到的站点位置完全一致。力导向图每次加载都重新播种，排布会变——这是有意为之的取舍，它让「重置布局」这个按钮有了意义。

### 没有字体支持的汉字怎么发布？

给一个有的字体做子集，并用 `unicode-range` 把门。项目发布的 BabelStone Han WOFF2 只有 26,196 字节，含 159 个码位——95 个 ASCII、14 个标点、50 个扩展 B 汉字，包括 𪁺(U+2A07A)——是完整字体 7,438,036 字节的 0.35%。`unicode-range: U+20000-2A6DF` 声明意味着只有这些字符真的渲染时浏览器才会下载它。

### 「零依赖」真的更快吗？

没有这类文章通常暗示的那么快。覆盖同样范围的四个 D3 模块——selection、drag、zoom、force——合计 35,992 字节原始、12,441 字节 gzip，而手写等价物是 9,704 字节 gzip，省下约 2.7 KB(22%)。对上完整图表库差距就大得多：cytoscape.js 是 116,568 字节 gzip，vis-network 是 127,278 字节。手写的诚实理由是控制布局与数据模型，不是体积。

---

## 结论

这个项目的工程故事，本质上是一个关于「把工作放在哪里」的故事。力模拟属于浏览器，因为它是交互的、由用户重新播种的；地铁图布局属于构建期，因为它必须对每位读者完全一致；实体类型计数属于一个 TypeScript 常量，因为它每次构建才变一次。那个 6.2 MB 的单体文件哪个地方都不属于——所以它现在变成了六个文件。

手写可视化是我原本以为会后悔、结果没有的部分。不是因为库不好——d3-force 只有 3 KB(gzip)，久经考验，在它擅长的事情上比我写得好——而是因为我要画的图不是通用图。它是一张碎裂的图，带着刻意的 200 节点预算、跨关系类型的均衡采样需求、按节点大小决定标签优先级的需求，以及「视视图而定，布局要么冻结要么新鲜」的需求。每一条需求都是通用库需要绕道的地方，而其中大多数只需要十五行手写代码。

诚实的保留意见都写在上文里了：21 个节点掉进了截断与筛选之间的缝隙；总览页用一个可能漂移的常量换掉了一次请求；六个拆分文件里有两个仍然超过 5 MB；自托管的主字体有 16.7 MB，因为我目前只子集化了**生僻**字。站点在 [findns.cc/shanhaijin](https://findns.cc/shanhaijin)，你可以打开[知识图谱](https://findns.cc/shanhaijin/graph)、[全景图](https://findns.cc/shanhaijin/panorama)或[山形聚焦视图](https://findns.cc/shanhaijin/map)，用你自己的浏览器核对这里的任何一个数字。

如果你想看项目的其余部分：[系列总览](/posts/machine-reading-shanhaijin-knowledge-graph/)讲图谱里有什么，[63 处矛盾那篇](/posts/shanhaijing-63-contradictions-machine-reading/)讲机器发现了什么，[管线那篇](/posts/shanhaijing-knowledge-graph-pipeline/)讲关系是怎么抽出来的，[九尾狐那篇](/posts/shanhaijing-nine-tailed-fox-missing/)讲数据里最有名的那个「不存在」，[缺字那篇](/posts/shanhaijing-missing-character-429-percent/)讲一个 萬 如何让一条山系差了 10,090 里。

---

## 参考来源

- Fruchterman, T. M. J. and Reingold, E. M., "Graph Drawing by Force-directed Placement," *Software: Practice and Experience* 21(11), 1991, https://doi.org/10.1002/spe.4380211102
- Next.js, "Static Exports"(App Router 部署文档)，检索于 2026-10-21，https://nextjs.org/docs/app/building-your-application/deploying/static-exports
- Next.js, "generateStaticParams"(API 参考)，检索于 2026-10-21，https://nextjs.org/docs/app/api-reference/functions/generate-static-params
- MDN Web Docs, "@font-face: unicode-range"，检索于 2026-10-21，https://developer.mozilla.org/en-US/docs/Web/CSS/@font-face/unicode-range
- BabelStone, "BabelStone Han"(字体项目与扩展 B 覆盖)，检索于 2026-10-21，https://www.babelstone.co.uk/Fonts/Han.html
- Google Noto Fonts, "Noto Serif CJK"(源码与码位覆盖)，检索于 2026-10-21，https://github.com/notofonts/noto-cjk
- D3, "d3-force"(v3.0.0，压缩后 8,300 字节)，检索于 2026-10-21，https://d3js.org/d3-force
- Cytoscape.js, "Graph theory library for visualization and analysis"(v3.30.2，压缩后 373,304 字节)，检索于 2026-10-21，https://js.cytoscape.org
- vis.js, "vis-network"(v9.1.9，压缩后 476,620 字节)，检索于 2026-10-21，https://github.com/visjs/vis-network
- npm/unpkg 包分发文件，压缩与 gzip -9 体积实测，检索于 2026-10-21，https://unpkg.com/d3-force@3.0.0/dist/d3-force.min.js
- 项目数据，"山海经知识图谱"(源文件、布局产物与实测载荷体积)，检索于 2026-10-21，https://findns.cc/shanhaijin
