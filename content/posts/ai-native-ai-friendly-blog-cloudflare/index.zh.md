---
title: "如何让博客对 AI 更原生、更友好：以一个 Cloudflare 托管网站为例"
description: "Cloudflare blocks AI crawlers by default since July 2025. Unblock GPTBot, ClaudeBot and PerplexityBot, add llms.txt and schema, and make your blog AI-native."
coverImage: "/posts/ai-native-ai-friendly-blog-cloudflare/images/cover.jpg"
coverImageAlt: "一座发光的屏幕前，AI 机器人正在阅读数字博客文章，象征 AI 爬虫对博客内容的访问与抽取"
ogImage: "/posts/ai-native-ai-friendly-blog-cloudflare/images/cover.jpg"
date: 2026-08-10 22:00:00
lastUpdated: 2026-08-10 22:00:00
author: "FindNS94"
tags: ["AI", "SEO", "Web Development"]
categories: ["SEO", "Web Development"]
math: false
---

![一座发光的屏幕前，AI 机器人正在阅读数字博客文章，象征 AI 爬虫对博客内容的访问与抽取](/posts/ai-native-ai-friendly-blog-cloudflare/images/cover.jpg)

# 如何让博客对 AI 更原生、更友好：以一个 Cloudflare 托管网站为例

2025 年，Cloudflare 报告称超过一半的互联网请求来自机器而非人类（[Cloudflare, "Agent Readiness"](https://blog.cloudflare.com/aeo/), 2026）。然而自 2025 年 7 月起，同一家公司却默认拦截了所有新域名上的 AI 爬虫——包括你的博客。这意味着 GPTBot、ClaudeBot 和 PerplexityBot 在阅读你写的任何一个字之前就会撞上墙。你的内容之所以在 ChatGPT、Claude 和 Perplexity 中不可见，可能并非内容质量问题，而是因为你从未注意过后台的一个开关。本指南会先带你修复这个问题，再走得更远。你将学会"对 AI 友好"（AI 能找到并阅读你的博客）和"对 AI 原生"（AI 愿意引用你的博客）的区别，并在一个真实托管于 Cloudflare 的域名上实践每一步——也就是本博客 findns.cc 所使用的同一套架构。

<!-- more -->

> **核心要点**
> - 自 2025 年 7 月起，Cloudflare 默认拦截 GPTBot、ClaudeBot、PerplexityBot、CCBot 和 Google-Extended，每个爬虫只需拨动一个开关即可放行（Cloudflare, 2025）。
> - "对 AI 友好"意味着 AI 能抓取和渲染你的页面；"对 AI 原生"意味着你的内容结构让 AI 系统愿意抽取并引用它。
> - GPTBot 在数亿次抓取中从未执行过 JavaScript——Hexo、Hugo 等静态站点天然具备可见性优势（Vercel, 2025）。
> - 答案前置段落和引用胶囊让内容变得可引用；llms.txt 添加成本低，但收益尚未被证实。
> - 用 `curl` 模拟每个爬虫的 user-agent 来验证一切——永远不要假设爬虫看到的和你看到的一样。

## "对 AI 友好"和"对 AI 原生"有什么区别？

大多数指南把两个截然不同的目标混为一谈，这里先把它们分开。一篇**对 AI 友好**的博客，是 AI 系统能够访问、渲染并解析的：爬虫能进来，HTML 中包含完整文本，页面加载速度足以让内容留在抽取预算之内。一篇**对 AI 原生**的博客则走得更远——它从初稿起就为机器消费而设计。标题读起来像问题，每个章节以一个带来源的独立答案开头，内容中包含可供 AI 原封不动搬进回答的"引用胶囊"。

为什么要区分这两者？因为只有访问权而没有内容结构，你的内容会被抓取但很少被引用。只有内容结构而没有访问权，你的内容则不可见——AI 根本看不到你的精心打磨。两者都需要，而且顺序很重要：先修复爬虫访问，再优化内容。可以把"对 AI 友好"想象成打开门、打开灯，"对 AI 原生"则是把房间布置好，让访客无需开口就能找到所需。

## 为什么 Cloudflare 默认拦截 AI 爬虫？

2025 年 7 月，Cloudflare 修改了 Security > Bots > AI Crawlers 的默认设置：所有已知的 AI 爬虫现在都会被拦截，除非你明确放行。其出发点是机器人管理的安全卫生——在审查之前，把未知代理视为不可信。副作用是，成千上万的域名一夜之间对 AI 搜索变得不可见。

默认拦截名单几乎涵盖了所有主流 AI 索引服务。GPTBot（OpenAI）、ClaudeBot（Anthropic）、PerplexityBot（Perplexity）、CCBot（Common Crawl）和 Google-Extended（Google 的 AI 训练爬虫）一开始全部被拦截。只有 Applebot-Extended 和标准 Googlebot 默认放行。如果你的域名是在 2025 年 7 月之后注册的，并且从未看过这个面板，那么你的博客很可能正处于墙的错误一侧。

<figure class="chart-img" style="margin:2.5rem 0;text-align:center;padding:1.5rem 0">
  <img src="/posts/ai-native-ai-friendly-blog-cloudflare/charts/chart-1-cloudflare-ai-crawler-status.svg" alt="图表：自 2025 年 7 月起 Cloudflare 新域名的 AI 爬虫默认访问状态。GPTBot、ClaudeBot、PerplexityBot、CCBot 和 Google-Extended 默认被拦截，Applebot-Extended 和 Googlebot 默认放行。" loading="lazy" style="max-width:100%;height:auto">
  <figcaption>来源：Cloudflare, Security &gt; Bots &amp; AI Crawlers 文档（2025 年 7 月）</figcaption>
</figure>

> **引用胶囊：** 自 2025 年 7 月起，Cloudflare 在新域名上默认拦截 GPTBot、ClaudeBot、PerplexityBot、CCBot 和 Google-Extended——只有 Applebot-Extended 和标准 Googlebot 无需配置即可放行（Cloudflare, Security &gt; Bots &amp; AI Crawlers, 2025）。从未检查过 AI Crawler 设置的域名，很可能对 ChatGPT、Claude 和 Perplexity 不可见。

好消息是：修复只需点击几下。难点在于知道去找它。

## 如何在 Cloudflare 上放行 AI 爬虫并配置 robots.txt？

打开 Cloudflare 面板，进入 **Security > Bots > AI Crawlers**，为你要允许的每个爬虫拨动"Allow"开关。优先放行搜索索引类爬虫——OAI-SearchBot、Claude-SearchBot 和 PerplexityBot——因为拦截它们会让你的内容彻底从该平台的回答中消失。训练类爬虫如 GPTBot 和 ClaudeBot 则由你决定；拦截它们不会影响你的搜索可见度，但会阻止你的内容影响未来的模型训练。

![一只机器人玩具代表自动化爬虫访问网站，象征流向你博客的 AI 爬虫流量](/posts/ai-native-ai-friendly-blog-cloudflare/images/ai-bot-crawling.jpg)

接下来，用一份正确的 `robots.txt` 来配合面板设置。AI 爬虫尊重 `robots.txt`，而一条缺失的规则可能被不同平台作出不同解读。所以请明确表态。放行主要爬虫并指向你的 sitemap。以下是一份最简化的 AI 感知模板——替换为你自己的域名和 sitemap URL 即可：

```
# AI Search & LLM Crawlers
User-agent: GPTBot
Allow: /

User-agent: OAI-SearchBot
Allow: /

User-agent: ClaudeBot
Allow: /

User-agent: Claude-SearchBot
Allow: /

User-agent: PerplexityBot
Allow: /

User-agent: Google-Extended
Allow: /

User-agent: CCBot
Allow: /

# Traditional search
User-agent: Googlebot
Allow: /

User-agent: Bingbot
Allow: /

Sitemap: https://findns.cc/sitemap.xml
```

对不同类型的爬虫要区别对待。**搜索索引类爬虫**（OAI-SearchBot、Claude-SearchBot、PerplexityBot）控制你的内容是否出现在实时的 AI 回答中——放行它们。**训练类爬虫**（GPTBot、ClaudeBot、CCBot）塑造未来的模型；如果你想施加影响就放行，不想则拦截。**检索类爬虫**（ChatGPT-User、Perplexity-User）由用户实时查询触发，可能无视 `robots.txt` 抓取内容，所以不要仅依赖那份文件来保护隐私。

<!-- [PERSONAL EXPERIENCE] 当我自己查看 findns.cc 的 Cloudflare 面板时，发现 AI Crawlers 设置数月来一直停留在默认值。修复花了不到一分钟，但如果没有这次研究，我根本不会想到去检查。 -->

在继续之前先验证改动。用 `curl` 模拟每个爬虫，观察是否返回干净的 200——而不是 403，也不是 Cloudflare 挑战页：

```bash
curl -s -o /dev/null -w "%{http_code}" \
  -A "Mozilla/5.0 AppleWebKit/537.36 (KHTML, like Gecko; compatible; GPTBot/1.0; +https://openai.com/gptbot)" \
  https://findns.cc/
```

返回 `200` 表示爬虫畅通无阻。任何其他结果都意味着仍有东西挡路——重新检查面板开关，以及任何可能挑战未知代理的页面规则。

## 如何让内容在不依赖 JavaScript 的情况下可见？

关于 AI 爬虫有一个令人不适的事实：它们不执行 JavaScript。2025 年，Vercel 分析了超过 5 亿次 GPTBot 抓取，未发现任何 JavaScript 执行的证据（[Vercel, "GPTBot rendering analysis"](https://vercel.com/blog), 2025）。GPTBot 只读取原生 HTML，没有例外。通过 React hydration、Vue 挂载或任何客户端框架加载的内容，对它来说都是不可见的。ClaudeBot 和 PerplexityBot 同理。只有 Googlebot、AppleBot 以及 ChatGPT Operator 等新代理工具才会渲染页面。

你的平台选择比任何内容技巧都更重要。静态站点生成器——Hexo、Hugo、Jekyll、Eleventy——把完成的 HTML 直接送到边缘节点。这份 HTML 无需额外工作就能被每个 AI 爬虫完整看到。如果你用的是这类生成器，你就已经拥有了一个客户端 React 博客需要靠 SSR 或预渲染才能追回的固有可见性优势。

<figure class="chart-img" style="margin:2.5rem 0;text-align:center;padding:1.5rem 0">
  <img src="/posts/ai-native-ai-friendly-blog-cloudflare/charts/chart-2-ai-crawler-traffic-growth.svg" alt="图表：Cloudflare Radar 2025 年 AI 爬虫流量同比增长。PerplexityBot 增长 157,490%，GPTBot 增长 305%，整体 AI 抓取量增长 32%。" loading="lazy" style="max-width:100%;height:auto">
  <figcaption>来源：Cloudflare Radar, AI crawler traffic growth data (2025)</figcaption>
</figure>

<!-- [UNIQUE INSIGHT] 平台选择本身就是 AI 可见性决策。静态 Hexo 博客默认对 AI 爬虫可见；使用客户端渲染的 Next.js 博客除非加上 SSR，否则不可见。大多数"AI 优化"建议忽略了这一基础层面。 -->

像爬虫那样测试你自己的页面。拉取原生 HTML 并 grep 你的主要内容——如果内容不在里面，AI 同样看不到：

```bash
curl -s https://findns.cc/your-post | grep -c "<article"
curl -s https://findns.cc/your-post | grep -c "id=\"__next\""
```

健康的 `<article` 计数加上空的 `__next` 检查，说明内容存在于 HTML 源码中。如果你看到的只是一个空的 `<div id="root"></div>`，或者文本只出现在 `<noscript>` 标签里，那么你的内容就在 JavaScript 背后，对大多数 AI 系统不可见。

## 如何构建让 AI 愿意引用的内容结构？

被抓取是必要条件。被引用则需要另一种努力。2025 年，Ahrefs 发现 76% 的 AI Overview 引用来自前 10 名自然搜索结果，而 28.9% 的全部 AI 引用集中在仅 50 个域名上（[Ahrefs, "AI Overviews citation study"](https://ahrefs.com/blog), 2025）。在场是不够的——你还需要成为那个房间里最清晰的声音。

单一影响力最大的技巧是**答案前置格式**。每个 H2 章节以一个 40 到 60 词的段落开头，包含一个具体数据、一个具名来源，以及对标题隐含问题的直接回答。AI 抽取系统青睐这种倒金字塔风格，因为它匹配了它们构建回答的方式：先结论，后证据。一个标题为"页面速度如何影响 AI 抓取？"的章节，应该以数字和来源开头，而不是以铺垫性的轶事开场。

![几何数字图案，代表用于 AI 引用追踪的网站数据分析](/posts/ai-native-ai-friendly-blog-cloudflare/images/website-analytics.jpg)

除了答案前置段落，还要加入**引用胶囊**——自包含的 40 到 60 词段落，脱离上下文也能读懂。每个胶囊承载一个主张、一个数据点和一处来源归属。用陈述性的、可引用的语气来写。当 AI 系统扫描你的页面寻找可以摘录的句子时，引用胶囊就是最显眼的候选。本指南通篇都在使用它们——你现在正在阅读的就是这种技巧。

保持标题层级干净：一个 H1，H2 作为主要章节（大约三分之二读作问题），H3 仅作为 H2 的子项。让主要关键词自然地出现在两到三个标题中。段落保持简短——40 到 80 词——因为密集的文本墙会抵抗抽取。

## 如何添加 llms.txt 和结构化数据？

有两个信号处于"对 AI 友好"和"对 AI 原生"的交叉点：机器可读的站点摘要和显式的 schema 标记。它们不是万能药，但实现成本低，并且能消除关于你的站点包含什么的歧义。

**结构化数据**是两者中更成熟的一个。2024 年，JSON-LD 使用率增长了 21%（从 34% 到 41%），Schema.org 标记现已覆盖 4500 万个域名和超过 4500 亿个对象（[Web Almanac 2024, Structured Data](https://almanac.httparchive.org/en/2024/structured-data)）。对于博客，为每篇文章添加 `BlogPosting` schema，为 FAQ 部分添加 `FAQPage` schema。放在 `<head>` 或 `<body>` 中的 JSON-LD 既帮助 Google 构建富结果，又为 AI 系统提供显式的实体与关系数据，而不是强迫它们从标记中推断结构。

**llms.txt** 则是较新、风险更高的赌注。它由 Anthropic 在 2024 年提出，是一个放在站点根目录的 markdown 文件（`findns.cc/llms.txt`），向 LLM 列出你的关键页面及其用途。Claude 会主动读取它。Perplexity 表示认同这一理念。OpenAI 未确认支持（[llmstxt.org](https://llmstxt.org/), 2026）。Google 的 Gary Illyes 在 2025 年 7 月表示 Google 不使用它，Semrush 的测试在 9 个测试站点上未记录到任何 AI 爬虫访问 `llms.txt` 文件。实现它——大约花费一小时——但不要把它当作你的可见性策略依赖。

一份最简的 `llms.txt` 如下所示：

```
# Your Blog

> A technical blog about web development, AI visibility, and content strategy.

## Essential

- [Home](https://findns.cc/): Latest articles and topic clusters
- [About](https://findns.cc/about): Author background and site mission

## Popular Articles

- [How to Make Your Blog AI-Friendly](https://findns.cc/blog/ai-friendly-blog): Step-by-step guide to AI crawler access and content structure.
```

保持在 10KB 以内——LLM 可能会截断更大的文件。发布重要新内容时更新它。请记住：它补充 `sitemap.xml`，绝不替代它。

> **引用胶囊：** 2022 至 2024 年间，JSON-LD 采用率增长了 21%（从 34% 升至 41%），Schema.org 标记现已覆盖 4500 万个域名和超过 4500 亿个对象（Web Almanac 2024, Structured Data; schema.org, 2024）。对博客而言，添加 BlogPosting 和 FAQPage schema 为 AI 系统提供显式实体数据，而非让它们猜测你的结构。

## 如何端到端验证 AI 爬虫访问？

你已经拨动了面板开关，写好了 `robots.txt`，确认了 HTML 是静态的，并添加了 schema。现在证明这一切——因为假设正是不可见博客一直不可见的原因。

为每个主流 AI 爬虫运行这份检查清单：

| 检查项 | 命令 | 通过条件 |
|-------|------|----------------|
| 爬虫能到达页面 | `curl -A "<bot-ua>" -o /dev/null -w "%{http_code}" URL` | 返回 200，不是 403 或挑战页 |
| 内容在 HTML 源码中 | `curl -s URL \| grep -c "your-unique-heading"` | 计数 > 0 |
| 非 JS 渲染 | `curl -s URL \| grep -c "id=\"root\""` | 计数 == 0 |
| schema 存在 | `curl -s URL \| grep -c "application/ld+json"` | 计数 > 0 |
| sitemap 可访问 | `curl -o /dev/null -w "%{http_code}" URL/sitemap.xml` | 返回 200 |

如果任何一项检查失败，你就在搜索引擎之前发现了缺口。最常见的失败是第一项：面板开关虽然拨动了，但某条页面规则或速率限制仍在覆盖它。用一个爬虫从未见过的新 URL 来测试，并测试你声称放行的每一个爬虫——GPTBot、ClaudeBot 和 PerplexityBot 各自拥有独立的 user-agent 字符串和行为特征。

## 常见误区

**拦截了 AI 爬虫却不知情。** 2025 年 7 月的 Cloudflare 默认设置是当下最常见的失效模式。如果你没有明确放行 AI 爬虫，它们就被拦截了。今天就去检查面板。

**把"对 AI 友好"和"对 AI 原生"混为一谈。** 只有爬虫访问而没有内容结构，会被抓取但很少被引用。只有内容结构而没有访问权，则不可见。两者都做，且按顺序来。

**把 llms.txt 当作策略依赖。** 它是一个锦上添花的信号，但三大 AI 平台中有两个尚未确认收益。把真正的时间花在答案前置内容和 schema 标记上。

**通过 JavaScript 注入 schema。** 不执行 JavaScript 的 AI 爬虫永远不会看到客户端注入的 schema。把 JSON-LD 放在服务端渲染的 HTML 里，而不是 React effect 里。

**假设爬虫看到的就是你的页面。** 不是的。它看到的是原生 HTML。如果你的内容靠客户端加载，爬虫看到的只是一个空壳。永远用 `curl` 验证。

## 常见问题

### 让博客对 AI 友好会伤害我的 Google 排名吗？

不会——两个目标互相强化。2025 年 Ahrefs 发现 76% 的 AI Overview 引用来自前 10 名自然搜索结果，所以扎实的传统 SEO 是 AI 可见性的前提，而非竞争对手。本文的技巧——干净的 HTML、快速加载、结构化数据——同样也是 Google 的核心排名信号。

### 我需要放行每一个 AI 爬虫吗？

不需要。优先放行搜索索引类爬虫（OAI-SearchBot、Claude-SearchBot、PerplexityBot），因为它们驱动实时引用。训练类爬虫（GPTBot、ClaudeBot）是可选的——拦截它们会限制你对未来模型的影响，但不影响当前可见度。放行重要的，忽略其余的。

### llms.txt 值得实现吗？

值得，作为一个低成本信号——但不值得当作策略。Claude 读取它；ChatGPT 和 Google 未确认使用。花一小时构建它，保持在 10KB 以内，然后把时间投入到更高回报的 schema 标记和答案前置内容上。

### 我的博客用静态站点生成器。它已经对 AI 友好了吗？

很大程度上是的。静态 HTML 无需额外渲染即可被 AI 爬虫完整看到。你仍然需要验证爬虫访问（Cloudflare 开关）、添加 schema 标记，并为引用优化内容结构——但你跳过了最难的步骤，即让客户端内容变得可见。

### 怎么知道 Cloudflare 是否拦截了我的 AI 爬虫？

用 `curl` 模拟爬虫并检查 HTTP 状态码。200 表示畅通。403、重定向或 HTML 挑战页表示被拦截。按名称分别测试 GPTBot、ClaudeBot 和 PerplexityBot，因为每个爬虫在面板中都是独立开关。

## 结语

让博客对 AI 原生且友好，不是一次改动——而是按正确顺序完成的一连串小步骤。先在边缘放行爬虫，确认内容以原生 HTML 输出，再构建内容结构让 AI 系统无需改写就能引用它。用 `curl` 验证每一步，因为爬虫对页面的视角才是唯一重要的视角。

从影响力最大的动作开始：打开 Cloudflare，进入 **Security > Bots > AI Crawlers**，为搜索索引类爬虫拨动"Allow"。这个不到一分钟的改动，修复的是 2026 年博客对 AI 不可见的最常见原因。然后按本文顺序完成其余步骤。

## 来源

- Cloudflare, "Agent Readiness and AEO metrics", blog.cloudflare.com/aeo/, retrieved August 10, 2026
- Cloudflare, Security > Bots > AI Crawlers 文档, July 2025
- Cloudflare Radar, "AI crawler traffic growth year-over-year", 2025
- Vercel, "GPTBot rendering analysis — 500M fetches, zero JavaScript execution", 2025
- Ahrefs, "AI Overviews citation study — top domains and CTR impact", ahrefs.com/blog, 2025
- Web Almanac 2024, "Structured Data", almanac.httparchive.org/en/2024/structured-data, 2024
- schema.org, "45 million domains, 450 billion objects", 2024
- llmstxt.org, "llms.txt standard and adoption", retrieved August 10, 2026
- Anthropic, "llms.txt proposal and Claude crawler support", 2024–2026
- Stack Overflow, "Developer Survey 2025 — AI tool usage", 2025
