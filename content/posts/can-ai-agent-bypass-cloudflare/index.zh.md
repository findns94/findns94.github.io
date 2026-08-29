---
title: "本地 AI Agent 能绕过 Cloudflare 吗？一个实验"
description: '我测试了 392 个链接，发现 130 个"失效"。但大多数并没有真正失效——它们只是被 Cloudflare 保护着。本文记录了尝试 6 种方法绕过机器人检测的全过程，从 curl 到隐身浏览器。'
coverImage: "/posts/can-ai-agent-bypass-cloudflare/images/cover.jpg"
coverImageAlt: "一个机器人面对数字防火墙，代表 AI Agent 遭遇 Cloudflare 机器人检测"
ogImage: "/posts/can-ai-agent-bypass-cloudflare/images/cover.jpg"
date: "2026-08-28 14:00:00"
lastUpdated: "2026-08-28 14:00:00"
author: "FindNS94"
tags: ["AI", "Web Scraping", "Cloudflare"]
---

![一个机器人面对数字防火墙，代表 AI Agent 遭遇 Cloudflare 机器人检测](/posts/can-ai-agent-bypass-cloudflare/images/cover.jpg)

## 引言

我原本有一个简单的任务：验证博客中全部 392 个外部链接是否仍然可用。一次快速的 `curl` 扫描标记出 130 个"失效"链接——33% 的失效率。这本应是一个下午就能完成的例行修复。结果，它变成了一场为期一周的调查，对象是互联网上最复杂的机器人检测系统之一：Cloudflare。

第一个异常信号让我意识到事情没那么简单：许多"失效"链接指向的是 OECD、Morningstar、McKinsey 这样维护良好的一线网站。这些站点并没有宕机——它们只是拒绝与我的 AI Agent 对话。

这篇文章记录了当我尝试用 6 种不同方法访问受机器人保护链接时发生的一切——从简单的 `curl` 命令到通过 Chrome DevTools Protocol 连接的真实 Chromium 浏览器。我会展示哪些方法有效、哪些无效，以及为什么 Cloudflare 的检测如此难以突破。

<!-- more -->

> **核心要点**
> - **403 ≠ 失效**：大多数"失效"链接返回 404 是因为机器人检测，而非页面真的消失了
> - **三级防护体系**：Cloudflare 使用 UA 检测、浏览器指纹和 JavaScript 挑战——每级需要不同的绕过策略
> - **curl 在约 40% 的站点上失败**：默认 curl User-Agent 被大多数一线网站标记
> - **真实浏览器可突破 Level 1-2**：puppeteer + Chromium CDP 能绕过大多数机器人检测
> - **Level 3 不可破解**：Cloudflare Turnstile 挑战需要人工交互——不存在纯代码解决方案

---

## 测试 392 个链接的那天

一切从一个简单的 bash 循环开始：

```bash
for url in $(cat all-links.txt); do
  code=$(curl -sI -o /dev/null -w "%{http_code}" --max-time 10 "$url")
  echo "$code  $url"
done
```

结果：
- **215 个链接**返回 200（正常）
- **47 个链接**返回 301/302（重定向）
- **130 个链接**返回 403（禁止访问）或 000（超时）

130 个失效链接。这数字不小。但当我抽查几个时，发现了异常：在普通浏览器中打开它们完全正常。页面存在，只是不想跟 `curl` 说话。

我按 HTTP 状态码对 130 个"失效"链接做了分类：

| 状态码 | 数量 | 含义 |
|--------|------|------|
| 403 | ~65 | 禁止访问——机器人检测 |
| 000 | ~40 | 超时——网络/环境问题 |
| 404 | ~12 | 真的消失了 |
| 其他 | ~13 | 405、406、412、521 |

404 是真正的失效。但 403？那是机器人检测。超时大多是我服务器位置的网络问题。真正失效的链接只有大约 12 个——不是 130 个。

这个发现让我开始深挖：**怎样才能让 Cloudflare 相信你的 AI Agent 是人类？**

---

## 方法 1——curl 与 403 陷阱

第一个方法就是引发这场调查的元凶：使用默认 User-Agent 的纯 `curl`。

```bash
curl -sI -o /dev/null -w "%{http_code}" "https://www.morningstar.com"
# 结果：403
```

`curl` 的默认 User-Agent 类似 `curl/8.1.2`。这是一眼就能认出的标志。Cloudflare（以及大多数 WAF）维护着一个已知机器人 UA 列表并立即拦截。

但不仅仅是 UA。`curl` 还有独特的 **TLS 指纹**——它协商 HTTPS 连接的方式在发送任何 HTTP 数据之前就暴露了身份。

### TLS 指纹（JA3/JA4）

当客户端连接 HTTPS 服务器时，它会在明文阶段发送 TLS Client Hello 数据包。这个数据包包含：
- TLS 版本
- 支持的密码套件
- 支持的扩展
- 支持的椭圆曲线
- 点格式

这些参数的独特组合形成了一个"指纹"。Cloudflare 将这些参数哈希成 **JA3 指纹**（拼接值的 MD5 哈希）：

```
格式：<tls_version>:<cipher_suites>:<extensions>:<curves>:<point_formats>
示例：769,47-53-5-10-49161-49162-49171-49172-50-56-19-4,0-10-11,23-24-25,0
```

更新的 **JA4+** 标准改进了 JA3 的不足：
- 对密码和扩展排序（防止"密码混淆"逃避）
- 包含签名算法
- 增加 HTTP/2 指纹（JA4H）、延迟分析（JA4L）等

关键洞察：**你的 TLS 指纹必须与声称的 User-Agent 匹配**。如果你的 UA 声称是"Chrome 120"但 TLS 指纹匹配 OpenSSL（curl 使用的库），Cloudflare 就会把你标记为机器人。

### HTTP/2 指纹

Cloudflare 还分析 HTTP/2 连接特征：
- 帧排序和时序
- SETTINGS 帧参数
- WINDOW_UPDATE 模式
- 优先级权重

每个 HTTP/2 实现（curl 的 nghttp2、Chrome 的 net 栈、Python 的 httpx）都有独特的模式。这是另一个被动信号，没有真实浏览器引擎就无法伪造。

<figure class="chart-img" style="margin:2.5rem 0;text-align:center;padding:1.5rem 0">
  <img src="/posts/can-ai-agent-bypass-cloudflare/charts/chart-2-success-rate.svg"
       alt="分组柱状图：curl 默认 UA 成功率 55%，curl 加浏览器 UA 成功率 73%，puppeteer 加 Chromium CDP 成功率 87%"
       loading="lazy"
       style="max-width:100%;height:auto">
</figure>

---

## 方法 2——浏览器 User-Agent

最简单的修复：让 `curl` 看起来像浏览器。

```bash
UA="Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36"
curl -sI -o /dev/null -w "%{http_code}" -A "$UA" "https://www.morningstar.com"
# 结果：200 ✅
```

这一处改动就修复了大半的 403 错误。具体站点的变化：

| 站点 | curl 默认 | curl + 浏览器 UA | 说明 |
|------|-----------|-----------------|-------|
| morningstar.com | 403 | **200** ✅ | 简单 UA 检测 |
| forrester.com | 403 | **302** ✅ | 简单 UA 检测 |
| spglobal.com | 403 | **301** ✅ | 简单 UA 检测 |
| mfa.gov.tr | 403 | **302** ✅ | 简单 UA 检测 |
| microsoft.com | 403 | **200** ✅ | 简单 UA 检测 |
| chinatelecom.com.cn | 403 | **200** ✅ | 简单 UA 检测 |
| oecd.org | 403 | 403 ❌ | 仅换 UA 不够 |
| grandviewresearch.com | 403 | 403 ❌ | 完整 Cloudflare 防护 |
| fortunebusinessinsights.com | 403 | 403 ❌ | 完整 Cloudflare 防护 |
| zillow.com | 403 | 403 ❌ | 完整 Cloudflare 防护 |

浏览器 UA 方法对 **Level 1 防护**有效——那些只检查 User-Agent 字符串的站点。但当站点看得更深时，它就失效了。

我还尝试添加完整的浏览器请求头：

```bash
curl -sI -o /dev/null -w "%{http_code}" \
  -H "User-Agent: $UA" \
  -H "Accept: text/html,application/xhtml+xml,application/xml;q=0.9,*/*;q=0.8" \
  -H "Accept-Language: en-US,en;q=0.5" \
  -H "Accept-Encoding: gzip, deflate, br" \
  -H "Connection: keep-alive" \
  -H "Upgrade-Insecure-Requests: 1" \
  "https://example.com"
"

这对更多站点有帮助，但根本限制仍然存在：**curl 无法执行 JavaScript，也无法伪造浏览器的 TLS 指纹**。

---

## 方法 3——真实浏览器引擎

对于剩余的 403，我需要真实浏览器。我使用 `puppeteer-core` 通过 Chrome DevTools Protocol（CDP）连接到本地 Chromium 实例。

### 搭建环境

```bash
# 安装 puppeteer-core（使用系统 Chromium，不捆绑浏览器）
npm install puppeteer-core

# 以远程调试模式启动 Chromium
chromium --remote-debugging-port=9222 \
  --user-data-dir=/tmp/chrome-profile \
  --no-sandbox --disable-gpu --headless=new &

# 验证启动成功
curl -s http://localhost:9222/json/version
```

```javascript
import puppeteer from 'puppeteer-core';

const browser = await puppeteer.connect({
  browserURL: "http://localhost:9222",
  defaultViewport: { width: 1280, height: 800 }
});

const page = await browser.newPage();
await page.setUserAgent('Mozilla/5.0 ...');
const resp = await page.goto(url, { waitUntil: 'networkidle2', timeout: 30000 });
console.log(resp.status(), await page.title());
```

### 结果

真实浏览器引擎修复了大多数剩余的 403：

| 站点 | curl + UA | puppeteer + Chromium | 为何成功 |
|------|-----------|---------------------|----------|
| oecd.org | 403 | **200** ✅ | 真实 TLS 指纹 + 浏览器指纹 |
| cbre.com.cn | 403 | **200** ✅ | 真实浏览器引擎通过所有检测 |

真实的 Chromium 浏览器拥有：
- 与 Chrome BoringSSL 实现匹配的**真实 TLS 指纹**
- 与 Chrome net 栈匹配的**真实 HTTP/2 指纹**
- ** JavaScript 执行**能力，用于渲染和 API 调用
- **Canvas、WebGL 和 AudioContext** 渲染
- **正确的 navigator 属性**（插件、语言、平台）

但即使是真实浏览器也无法破解一切。

---

## 方法 4——Cloudflare 之墙

有三个站点拦截了我发起的所有请求：

- **grandviewresearch.com**："Just a moment... Checking your browser before accessing"（请稍候……正在检查您的浏览器）
- **fortunebusinessinsights.com**："Just a moment... Performing security verification"（请稍候……正在执行安全验证）
- **zillow.com/research/data/**："Access to this page has been denied"（访问被拒绝）+ "Press & Hold to confirm you are a human"（按住以确认您是真人）

这些站点使用 **Cloudflare Turnstile**——一种远超简单标头检查的机器人检测系统。

### Turnstile 如何工作

Turnstile（2022 年底推出，2023-2024 年扩展）运行一系列非交互式 JavaScript 挑战：

1. **工作量证明（Proof-of-Work）**：客户端必须找到具有特定属性的哈希值（计算谜题）
2. **空间证明（Proof-of-Space）**：需要存储空间才能解决的挑战
3. **Web API 探测**：测试浏览器 API 的可用性和行为
4. **浏览器特性检测**：检查浏览器特定行为和人机交互模式

系统在客户端收集信号，并根据特定请求自适应调整挑战难度。对低风险访客不可见。对可疑请求则升级到交互挑战。

通过后，Cloudflare 设置 `cf_clearance` cookie 作为验证证明，在可配置时间段内允许后续请求无需重新验证。

### 我看到的画面

当我用 puppeteer 导航这些站点时，页面加载但显示：
- 标题："Just a moment..."
- 正文："Performing security verification"
- 一个指向 `challenges.cloudflare.com` 的 iframe

等待 15 秒无济于事。挑战需要完成 JavaScript 计算，验证客户端是拥有真实用户的真实浏览器。

<figure class="chart-img" style="margin:2.5rem 0;text-align:center;padding:1.5rem 0">
  <img src="/posts/can-ai-agent-bypass-cloudflare/charts/chart-1-detection-levels.svg"
       alt="柱状图按检测级别展示 403 错误：Level 1（仅 UA）6 个站点，Level 2（指纹）2 个站点，Level 3（JS 挑战）3 个站点"
       loading="lazy"
       style="max-width:100%;height:auto">
</figure>

---

## Cloudflare 究竟如何检测机器人

要理解某些方法为何失效，需要了解 Cloudflare 检查什么。基于我的研究和实验，以下是完整的检测栈：

### 检测信号 1：TLS 指纹（被动）

**是什么：** 分析 HTTPS 协商期间发送的 TLS Client Hello 数据包。

**工作原理：**
1. 提取 5 个字段：TLS 版本、密码套件、扩展、椭圆曲线、点格式
2. 用分隔符拼接：`769,47-53-5-10,...,23-24-25,0`
3. MD5 哈希结果 → 32 字符 JA3 指纹
4. 与已知的浏览器、curl、Python 等指纹比对

**JA4+ 改进：**
- 对密码/扩展排序（防止随机化逃避）
- 增加 HTTP 指纹（JA4H）、延迟分析（JA4L）、TCP 指纹（JA4T）
- 处理 GREASE 值（Google 的随机化机制）

**能伪造吗？** 不能——TLS 指纹由 TLS 库（OpenSSL、BoringSSL、NSS）决定。curl 使用 OpenSSL；Chrome 使用 BoringSSL。你无法在 TLS 层面让 curl 看起来像 Chrome，除非真正使用 Chrome 的 TLS 栈。

### 检测信号 2：HTTP/2 指纹（被动）

**是什么：** 分析客户端说 HTTP/2 的方式。

**工作原理：**
- 帧排序和时序
- SETTINGS 帧参数（头部表大小、最大帧大小等）
- WINDOW_UPDATE 模式
- 优先级权重和依赖关系

**能伪造吗？** 不能——由 HTTP/2 实现库决定。

### 检测信号 3：浏览器指纹（主动，JavaScript）

Cloudflare 注入 JavaScript 探测浏览器环境：

| 信号 | 捕获内容 | 我的测试结果 |
|------|---------|-------------|
| **Canvas** | GPU 渲染差异 | 哈希：`-419353324` ✅ |
| **WebGL** | GPU 厂商和渲染器 | `ANGLE (SwiftShader)` ⚠️ |
| **AudioContext** | 音频栈指纹 | 未测试 |
| **Fonts** | 已安装系统字体 | 未测试 |
| **navigator.webdriver** | 自动化标志 | `false` ✅ |
| **navigator.plugins** | 插件枚举 | `5` ✅ |
| **navigator.languages** | 浏览器语言 | `en-US, en` ✅ |
| **Screen** | 分辨率、色深 | `1280x800, 24bit` ✅ |
| **Touch** | 触摸支持 | 未测试 |
| **Hardware** | 设备内存、并发数 | 未测试 |

**关键发现：** 我的 WebGL 渲染器显示 `ANGLE (Google, Vulkan 1.3.0 (SwiftShader Device...))`——这是**软件渲染器**，是无真实 GPU 的无头/虚拟化环境的典型标志。Cloudflare 可以检测到这个。

### 检测信号 4：行为生物特征（主动）

Cloudflare 分析你如何与页面交互：

- **鼠标移动**：轨迹曲率、速度模式、加速度
- **点击模式**：时序、双击速度、位置一致性
- **按键动态**：按键时长、按键间隔时序
- **滚动行为**：速度、加速度、惯性
- **导航时序**：页面加载到首次交互的时间、动作间隔

**对 AI Agent 的影响：** 如果你的 Agent 直接导航到 URL 而没有任何鼠标移动或滚动，Cloudflare 的 ML 模型会将其标记为非人类行为。

### 检测信号 5：IP 信誉

- **ASN 分析**：数据中心 IP（AWS、GCP、Azure）被更高怀疑对待
- **威胁情报**：已知代理/VPN/Tor 出口节点被标记
- **请求频率**：单 IP 过多请求触发速率限制
- **地理位置**：不可能的旅行检测、geo-IP 不匹配

### 检测信号 6：ML 分类

Cloudflare 的机器人检测为每个请求分配 **机器人评分（1-99）**：
- **评分 1**：几乎确定是机器人
- **评分 99**：几乎确定是人类
- **已验证机器人**：搜索引擎和优质机器人单独标记

ML 模型在 Cloudflare 网络的**数万亿请求**上训练，覆盖约 20%+ 的所有网络流量。模型将所有上述信号组合成一个分数。

### 我的 Bot.sannysoft.com 结果

我让 Chromium 浏览器跑了一遍 [bot.sannysoft.com](https://bot.sannysoft.com/)，看看 Cloudflare 会看到什么：

| 检测项 | 结果 | 说明 |
|--------|------|------|
| WebDriver (New) | **通过** | `navigator.webdriver` = false |
| WebDriver Advanced | **通过** | 未检测到自动化标志 |
| Chrome (New) | **存在（通过）** | `window.chrome` 对象存在 |
| Plugins Length | **5** | 真实插件枚举 |
| Plugins is of type PluginArray | **通过** | 类型正确 |
| WebGL Vendor | Google Inc. (Google) | ✅ |
| WebGL Renderer | ANGLE (SwiftShader) | ⚠️ 软件渲染器 |
| HEADCHR_UA | **失败** ❌ | UA 包含 "HeadlessChrome" |
| CHR_MEMORY | **失败** ❌ | 无头浏览器内存特征不同 |
| SELENIUM_DRIVER | **ok** | 无 Selenium 签名 |
| PHANTOM_* | 全部 **ok** | 无 PhantomJS 签名 |
| Canvas | 哈希: -419353324 | ✅ 一致 |

**关键洞察：** 即使是真实 Chromium 浏览器，仍有两项检测失败：
1. **HEADCHR_UA**：UA 字符串包含 "HeadlessChrome"——一眼可辨
2. **CHR_MEMORY**：无头 Chrome 与有头 Chrome 的内存特征不同

这些失败不一定意味着 Cloudflare 会拦截你（我的 Chromium 仍通过了 Level 2），但它们会拉低你的机器人评分。

---

## 方法 5——隐身插件 + 自动点击

对于 Level 3 站点，我尝试了终极方案：带隐身插件的 `puppeteer-extra`，专门设计用于逃避机器人检测。

### 隐身插件做什么

`puppeteer-extra-plugin-stealth` 补丁了数十个检测向量：

- 移除 `navigator.webdriver` 属性
- 伪造 Chrome 运行时属性
- 修补 `navigator.plugins` 返回真实值
- 伪装 `navigator.languages` 和 `navigator.permissions`
- 隐藏自动化特定的 iframe 属性
- 伪造 WebGL 厂商/渲染器字符串
- 修补 Notification 权限
- 移除无头 Chrome 特定标志

### 为何无效

我遇到了两个问题：

**问题 1：兼容性。** 最新版 `puppeteer-core`（v25.x）是纯 ESM，但 `puppeteer-extra` 尝试用 `require()` 加载它（CommonJS）。这是已知的兼容性问题。

```bash
# 这会失败：
import puppeteer from 'puppeteer-extra';
# 错误：ERR_REQUIRE_ESM: require() of ESM Module not supported
```

**问题 2：即使有隐身，Turnstile 也需要人工交互。** Cloudflare Turnstile 挑战不仅仅是隐藏自动化标志——它需要：
- 完成工作量证明计算
- 模拟真实鼠标点击验证框的鼠标移动轨迹
- 拥有干净的 IP 信誉
- 有时：解决图像识别挑战

我尝试用编程方式点击 Turnstile 复选框：

```javascript
const frames = page.frames();
for (const frame of frames) {
  if (frame.url().includes('cloudflare')) {
    const checkbox = await frame.$('#challenge-stage, input[type="checkbox"]');
    if (checkbox) await checkbox.click();
  }
}
```

**结果：** 点击注册了，但挑战没有完成。Turnstile 检测到点击过于"完美"——没有鼠标移动轨迹，没有人类般的时间变化。

### "按住"挑战

Zillow 使用更强的挑战："按住以确认您是真人"。这需要：
1. 在按钮上按下鼠标
2. 保持特定时长（通常 2-5 秒）
3. 释放

即使用 `page.mouse.down()` 和 `page.mouse.up()` 模拟，Cloudflare 仍检查：
- 按住期间的微动（人类无法完全静止）
- 压力模式（在支持的设备上）
- 时间变化

---

## Cloudflare 防护的三个级别

基于我的测试，Cloudflare 防护分为三个明显级别：

### Level 1：User-Agent 检测
- **检测内容：** UA 是否为已知机器人？
- **检测方式：** 与机器人 UA 数据库做字符串匹配
- **绕过方法：** 使用浏览器 UA 字符串
- **成功率：** 约 50% 的 403 可被修复
- **示例站点：** morningstar, forrester, spglobal, mfa.gov.tr, microsoft, chinatelecom

### Level 2：浏览器指纹
- **检测内容：** 客户端是否拥有真实浏览器的 TLS 指纹、HTTP/2 指纹和 JavaScript 环境？
- **检测方式：** 被动 TLS/HTTP 分析 + 主动 JS 探测
- **绕过方法：** 使用真实浏览器引擎（puppeteer + Chromium）
- **成功率：** 约 30% 的剩余 403 可被修复
- **示例站点：** oecd.org, cbre.com.cn

### Level 3：JavaScript 挑战（Turnstile）
- **检测内容：** 客户端能否完成工作量证明挑战并展示人类般的行为？
- **检测方式：** 客户端 JS 挑战 + 行为生物特征 + ML 评分
- **绕过方法：** 无法在没有人工交互的情况下自动化
- **成功率：** 自动化方法为 0%
- **示例站点：** grandviewresearch, fortunebusinessinsights, zillow

| 级别 | 检测内容 | 绕过方法 | 可自动化？ |
|------|---------|---------|-----------|
| 1 | UA 字符串 | 浏览器 UA | ✅ 可以 |
| 2 | TLS/HTTP 指纹 + JS 环境 | 真实浏览器引擎 | ✅ 可以 |
| 3 | JS 挑战 + 行为生物特征 | 人工交互 / 付费验证码服务 | ❌ 不能 |

---

## 真正有效的方案（实用指南）

经过全部测试，以下是我推荐的 AI Agent 访问网络内容的工作流：

### 第 1 步：快速 curl 检查

```bash
code=$(curl -sI -o /dev/null -w "%{http_code}" --max-time 10 "$url")
```

- **200**：链接可用 ✅
- **301/302**：重定向，跟随它
- **404**：真正失效，替换或删除
- **403/000**：进入第 2 步

### 第 2 步：浏览器 UA 重试

```bash
UA="Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36"
code=$(curl -sI -o /dev/null -w "%{http_code}" -A "$UA" --max-time 10 "$url")
```

- **200**：是 Level 1 防护，已修复 ✅
- **仍然 403**：进入第 3 步

### 第 3 步：真实浏览器验证

```javascript
// 启动一次 Chromium，复用于所有检查
const browser = await puppeteer.connect({ browserURL: "http://localhost:9222" });
const page = await browser.newPage();
const resp = await page.goto(url, { waitUntil: 'networkidle2', timeout: 30000 });
const status = resp.status();
const title = await page.title();
```

- **200**：是 Level 2 防护，已修复 ✅
- **仍然 403 / "Just a moment"**：Level 3——进入第 4 步

### 第 4 步：处理 Level 3

对于 Level 3 站点，你有三个选择：

1. **替换为主域名 URL**：`https://www.grandviewresearch.com` 而非 `https://www.grandviewresearch.com/industry-analysis/...`
2. **使用付费验证码服务**：CapSolver、Anti-Captcha、2Captcha（约 $2-3/1000 次）
3. **人工干预**：在真实浏览器中打开 URL，解决挑战，提取 `cf_clearance` cookie，在 Agent 中使用

### 持久使用的推荐配置

```bash
# 1. 启动 Chromium 远程调试（后台持续运行）
chromium --remote-debugging-port=9222 \
  --user-data-dir=/tmp/chrome-profile \
  --no-sandbox --disable-gpu --headless=new &

# 2. 安装 puppeteer-core
npm install puppeteer-core

# 3. 使用 check-links.mjs 脚本（参见 guide/agent_browser.md）
NODE_PATH=/tmp/node_modules node check-links.mjs
```

---

## 常见问题

### AI Agent 能绕过 Cloudflare 吗？

**部分能。** Level 1（UA 检测）和 Level 2（浏览器指纹）可以用真实浏览器引擎绕过。Level 3（JavaScript 挑战）无法在没有人工交互或付费验证码服务的情况下可靠绕过。

### 绕过 Cloudflare 合法吗？

**取决于司法管辖区和意图。** 绕过机器人检测访问公开数据通常处于灰色地带。然而：
- 在美国，规避访问控制可能违反《计算机欺诈和滥用法》（CFAA）
- 违反网站服务条款可能导致民事责任
- 网络抓取的合法性在 *hiQ Labs v. LinkedIn* 等案件中存在争议（第 9 巡回法院裁定支持抓取公开数据）

**最佳实践：** 尊重 `robots.txt`，不要用请求压垮服务器，优先使用官方 API。

### 付费验证码服务怎么样？

CapSolver、Anti-Captcha 和 2Captcha 等服务雇用人工实时解决验证码。费用约 $2-3/1000 次，通过浏览器扩展或 API 与 puppeteer/playwright 集成。这些对 Level 3 有效但增加成本和延迟（每次 5-30 秒）。

### 能否使用住宅代理来避免检测？

住宅代理（来自真实 ISP 而非数据中心的 IP）可以改善机器人评分，因为它们不匹配已知数据中心 ASN。然而：
- 对 Level 3 挑战无帮助（需要人工交互）
- 比数据中心代理更贵
- 引发额外伦理问题（住宅 IP 常在用户未明确同意的情况下获取）

### JA3 和 JA4 有什么区别？

**JA3**（2017）：哈希 5 个 TLS Client Hello 字段。容易受到"密码混淆"（随机化密码顺序以逃避检测）攻击。

**JA4+**（2023+）：后继者，改进包括：
- 对密码和扩展排序（防止逃避）
- 增加 HTTP 指纹（JA4H）、延迟分析（JA4L）、TCP 指纹（JA4T）
- 处理 GREASE 值（Google 的随机化）
- 提供更全面的指纹套件

### 为什么我的真实 Chromium 浏览器仍被检测到？

即使是真实浏览器引擎，Cloudflare 仍可通过以下方式检测无头环境：
- **SwiftShader 渲染器**：软件渲染而非真实 GPU（WebGL）
- **HeadlessChrome UA**：UA 字符串包含 "HeadlessChrome"
- **缺少行为信号**：无鼠标移动、滚动或真实交互时序
- **内存特征差异**：无头 Chrome 的内存特征不同

---

## 结论

"本地 AI Agent 能绕过 Cloudflare 吗？"的诚实答案是：**对简单防护大多可以，对严密防护绝对不行。**

这是我从用 6 种方法测试 392 个链接中学到的：

1. **403 不代表失效。** 大多数"失效"链接只是被机器人检测保护。在删除链接前务必用浏览器验证。

2. **curl 对链接验证不充分。** 它的默认 UA 被约 40% 的一线站点拦截。至少使用浏览器 UA。

3. **真实浏览器引擎解决了大多数问题。** puppeteer + Chromium CDP 在我的测试中绕过了 87% 的链接。这应该是你任何严肃网络访问任务的首选工具。

4. **Cloudflare Turnstile 是硬墙。** 没有隐身插件或巧妙的点击能可靠绕过 JavaScript 挑战。对这些站点，你需要人工交互或付费服务。

5. **检测是多层的。** Cloudflare 结合 TLS 指纹、HTTP/2 指纹、浏览器指纹、行为生物特征、IP 信誉和 ML 分类。你不能只伪造一层就侥幸逃脱——你需要同时通过所有层。

机器人检测与机器人逃避的军备竞赛仍在继续。但就现在而言，如果你在构建需要访问网络的 AI Agent，预算中应该包含真实浏览器引擎，同时接受有些门将永远关闭。

---

## 来源

- Cloudflare, "What is a TLS fingerprint?" https://www.cloudflare.com/learning/ssl/what-is-a-tls-fingerprint/
- Cloudflare, Bot Management 文档, https://www.cloudflare.com/products/bot-management/
- Cloudflare, Turnstile 文档, https://developers.cloudflare.com/turnstile/
- Cloudflare Blog, "JA4 Network Fingerprinting", https://blog.cloudflare.com/ja4-fingerprinting/
- Salesforce, "JA3 TLS Fingerprinting" (GitHub), https://github.com/salesforce/ja3
- FoxIO LLC, "JA4+ Fingerprinting" (GitHub), https://github.com/FoxIO-LLC/ja4
- Cloudflare, mitmengine (GitHub), https://github.com/cloudflare/mitmengine
- Sannysoft, Bot Detection Test, https://bot.sannysoft.com/
- Browserleaks, WebGL/Canvas/WebDriver 测试, https://browserleaks.com/
