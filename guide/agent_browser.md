# Agent 网页访问经验总结

本文档总结了 AI Agent 在验证和访问网页链接时的各种方法、适用场景和限制。

## 方法对比

### 1. `curl`（默认 User-Agent）

**命令：**
```bash
curl -sI -o /dev/null -w "%{http_code}" "https://example.com"
```

**特点：**
- 最轻量，适合快速批量检查
- 默认 UA 为 `curl/x.x.x`，很多网站直接返回 403
- 无法执行 JavaScript，无法绕过 Cloudflare 挑战

**适用场景：** 检查服务器是否在线、获取 HTTP 状态码

**局限性：** 大量网站（约 30-40%）会返回 403，即使页面实际存在

---

### 2. `curl` + 浏览器 User-Agent

**命令：**
```bash
UA="Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36"
curl -sI -o /dev/null -w "%{http_code}" -H "User-Agent: $UA" "https://example.com"
```

**特点：**
- 模拟浏览器 UA，通过大部分简单的 UA 检测
- 仍然无法执行 JavaScript

**适用场景：** 绕过基于 UA 的简单拦截

**实测效果：**
| 站点 | 默认 UA | 浏览器 UA | 真实浏览器 |
|------|---------|-----------|-----------|
| morningstar.com | 403 | **200** ✅ | 200 ✅ |
| forrester.com | 403 | **302** ✅ | 302 ✅ |
| spglobal.com | 403 | **301** ✅ | 301 ✅ |
| mfa.gov.tr | 403 | **302** ✅ | 302 ✅ |
| microsoft.com | 403 | **200** ✅ | 200 ✅ |
| chinatelecom.com.cn | 403 | **200** ✅ | 200 ✅ |
| oecd.org | 403 | 403 ❌ | **200** ✅ |
| grandviewresearch.com | 403 | 403 ❌ | 403 ❌ |
| zillow.com | 403 | 403 ❌ | 403 ❌ |

---

### 3. `curl` + 完整浏览器请求头

**命令：**
```bash
curl -sI -o /dev/null -w "%{http_code}" \
  -H "User-Agent: $UA" \
  -H "Accept: text/html,application/xhtml+xml,application/xml;q=0.9,*/*;q=0.8" \
  -H "Accept-Language: en-US,en;q=0.5" \
  -H "Accept-Encoding: gzip, deflate, br" \
  -H "Connection: keep-alive" \
  -H "Upgrade-Insecure-Requests: 1" \
  "https://example.com"
```

**特点：**
- 模拟完整的浏览器请求头
- 比单纯换 UA 效果更好，但仍无法执行 JS

**适用场景：** 绕过需要特定请求头的 WAF 规则

---

### 4. `wget --spider`

**命令：**
```bash
wget --spider --max-redirect=0 --timeout=10 -q -S "https://example.com" 2>&1 | grep "HTTP/"
```

**特点：**
- 自动处理 cookie 和重定向
- 与 curl 类似，无法执行 JavaScript

**适用场景：** 需要跟踪重定向链时比 curl 更方便

---

### 5. `puppeteer-core` + 本地 Chromium（CDP 连接）

**命令：**
```javascript
import puppeteer from 'puppeteer-core';
const browser = await puppeteer.connect({
  browserURL: "http://localhost:9222",
  defaultViewport: { width: 1280, height: 800 }
});
const page = await browser.newPage();
await page.setUserAgent('Mozilla/5.0 ...');
const resp = await page.goto(url, { waitUntil: 'networkidle2', timeout: 30000 });
const status = resp.status();
const title = await page.title();
```

**前置步骤：**
```bash
# 1. 安装 puppeteer-core
npm install puppeteer-core

# 2. 启动 Chromium 并开启远程调试端口
chromium --remote-debugging-port=9222 --user-data-dir=/tmp/chrome-profile --no-sandbox --disable-gpu --headless=new &

# 3. 等待启动后用 NODE_PATH 运行脚本
NODE_PATH=/tmp/node_modules node check-links.mjs
```

**特点：**
- 真实的 Chromium 浏览器引擎，支持 JavaScript 执行
- 通过 CDP（Chrome DevTools Protocol）连接，继承真实浏览器指纹
- 可以获取页面标题、内容等完整信息
- 能绕过大部分 bot 检测

**适用场景：** 需要验证页面真实内容、执行 JavaScript 渲染

**局限性：**
- 无法自动完成 Cloudflare Turnstile 验证（需要人工点击）
- 启动较慢（snap 包更慢）
- 需要本地安装 Chromium/Chrome

---

### 6. `firefox --headless`（不推荐）

**命令：**
```bash
firefox --headless --no-remote --profile /tmp/ff-test --screenshot /tmp/test.png "https://example.com"
```

**问题：**
- snap 包启动极慢（>30 秒）
- 经常被 timeout 终止
- 不适合自动化场景

---

## Cloudflare 防护分级

根据实测，Cloudflare 保护的站点分为几个等级：

### Level 1：仅 UA 检测
- **特征：** curl 返回 403，浏览器 UA 即可通过
- **示例：** morningstar, forrester, spglobal, mfa.gov.tr, microsoft, chinatelecom
- **绕过方法：** 使用浏览器 UA 的 curl 即可

### Level 2：浏览器指纹检测
- **特征：** curl 返回 403，真实浏览器可以访问
- **示例：** oecd.org, cbre.com.cn
- **绕过方法：** 需要真实浏览器引擎（puppeteer + Chromium）

### Level 3：JavaScript 挑战（Turnstile）
- **特征：** 即使真实浏览器也显示 "Just a moment..." 或 "Press & Hold"
- **示例：** grandviewresearch, fortunebusinessinsights, zillow
- **绕过方法：** 无法自动绕过，需要人工交互或使用住宅代理 + 已登录的浏览器 session

#### Cloudflare Turnstile 挑战实测

对 Level 3 站点尝试了以下自动点击方案（参考 `cloudflare_click.md`）：

**方案 A：Stealth 插件 + 模拟点击**
```javascript
import puppeteer from 'puppeteer-extra';
import StealthPlugin from 'puppeteer-extra-plugin-stealth';
puppeteer.use(StealthPlugin());
// 尝试定位 iframe 中的 #challenge-stage 并点击
```

**结果：** 失败。原因：
1. `puppeteer-extra` 与最新版 `puppeteer-core`（ESM only）存在兼容性问题
2. 即使使用 stealth 插件隐藏了 `navigator.webdriver`，Cloudflare 仍通过 TLS 指纹、Canvas 指纹、行为分析等检测到自动化
3. Turnstile 挑战需要完成 JavaScript 计算 + 鼠标轨迹验证，单纯点击 checkbox 无法通过

**方案 B：CDP 接管 + 第三方验证扩展（CapSolver/Anti-Captcha）**
- 需要付费订阅（约 $2-3/1000 次验证）
- 需要本地 Chrome 安装扩展
- 适合生产环境批量抓取，不适合偶尔的链接验证

**结论：** 对于链接验证场景，Level 3 站点建议直接替换为主站 URL 或标注"需人工验证"。

---

## 推荐工作流

### 批量链接验证

```bash
# 1. 先用 curl 快速筛选
curl -sI -o /dev/null -w "%{http_code}" --max-time 10 "$url"

# 2. 对 403 的链接，换浏览器 UA 重试
curl -sI -o /dev/null -w "%{http_code}" -A "$BROWSER_UA" --max-time 10 "$url"

# 3. 仍然 403 的，用 puppeteer + Chromium 验证
#    （启动一次 Chromium，批量检查所有可疑链接）
```

### 安装依赖

```bash
# puppeteer-core（不需要下载 Chromium，使用系统自带的）
npm install puppeteer-core

# 系统 Chromium（Ubuntu）
sudo apt install chromium-browser
# 或 snap: sudo snap install chromium
```

### 启动 Chromium 调试服务

```bash
# 后台启动
chromium --remote-debugging-port=9222 \
  --user-data-dir=/tmp/chrome-profile \
  --no-sandbox --disable-gpu --disable-dev-shm-usage \
  --headless=new &

# 验证启动成功
curl -s http://localhost:9222/json/version
```

---

## 经验教训

1. **403 ≠ 链接失效**：大量 403 只是 bot 检测，真实用户可以正常访问
2. **curl 默认 UA 容易被拦截**：始终使用浏览器 UA 以获得更准确的结果
3. **Cloudflare 无法自动绕过**：Level 3 的 JavaScript 挑战需要人工交互
4. **snap 包启动慢**：Chromium/Firefox 的 snap 版本启动时间较长
5. **NODE_PATH 问题**：全局安装的 npm 包需要用 `NODE_PATH=$(npm root -g)` 才能被找到
6. **puppeteer-core 是 ESM 模块**：需要使用 `.mjs` 扩展名或 `import` 语法
7. **批量检查时先过滤**：先用 curl 快速筛选，只对可疑链接使用浏览器验证，节省时间
