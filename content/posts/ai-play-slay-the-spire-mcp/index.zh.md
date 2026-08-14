---
title: "如何让 AI 玩《杀戮尖塔 2》？一个游戏 Mod 化 MCP 服务器的实战解剖"
description: "STS2MCP 是一款《杀戮尖塔 2》Mod，通过本地 HTTP API 暴露游戏状态，再经 MCP 桥接让 Claude 上手游玩。本文拆解真实架构、Token 消耗与多人合作模式。"
coverImage: "/posts/ai-play-slay-the-spire-mcp/images/cover.jpg"
coverImageAlt: "一个机器人凝视着棋盘，象征人工智能正在学习玩复杂的策略游戏"
ogImage: "/posts/ai-play-slay-the-spire-mcp/images/cover.jpg"
date: "2026-08-14 20:30:00"
lastUpdated: "2026-08-14 20:30:00"
author: "FindNS94"
tags: ["AI", "Gaming", "MCP"]
categories: ["AI", "Gaming"]
math: false
---

![一个机器人凝视着棋盘，象征人工智能正在学习玩复杂的策略游戏](/posts/ai-play-slay-the-spire-mcp/images/cover.jpg)

# 如何让 AI 玩《杀戮尖塔 2》？一个游戏 Mod 化 MCP 服务器的实战解剖

2025 年，模型上下文协议（Model Context Protocol，MCP）的公共服务器数量突破了一千大关，并在短短数月内相继被 OpenAI、Google DeepMind、微软和亚马逊 Bedrock 采纳（[awesome-mcp-servers, GitHub](https://github.com/punkpeye/awesome-mcp-servers), 2025）。这些服务器大多包裹着日历、数据库和代码编辑器。而 [STS2MCP](https://github.com/Gennadiyev/STS2MCP) 包裹的是一款电子游戏——它是一个《杀戮尖塔 2》的 Mod（一份跨平台 .NET 程序集），在游戏内部启动了一个 `localhost:15526` 上的 HTTP 服务器，把完整的游戏状态和每一个游戏内操作暴露成结构化 API。再由一个轻量 Python MCP 服务器把这套 HTTP API 桥接给 Claude Desktop 和 Claude Code，于是 LLM 就能通过调用 `combat_play_card`、`map_choose_node` 这样的工具来玩游戏。本文是案例复盘，也是架构拆解：我们解释为什么游戏 Mod 是比画面捕获更好的界面、HTTP-to-MCP 桥接是怎么构造的、Claude 跑一局完整游戏时实际发生了什么，以及代价在哪里——包括单局百万量级的 Token 消耗。

<!-- more -->

> **核心要点**
> - STS2MCP 是一个《杀戮尖塔 2》Mod（C#/HarmonyLib），在本地暴露 HTTP API——无需画面捕获、OCR 或输入自动化。
> - Python MCP 服务器（`mcp/server.py`）把 HTTP API 桥接为 MCP 工具，任何 MCP 客户端都能驱动游戏。
> - MCP 从 2024 年底发布时的几十个服务器，发展到 2025 年中超过 1000 个，六个月内获得了所有主流 AI 实验室的采纳。
> - 铁甲战士一局完整运行在 Claude Sonnet 4.6 上消耗约 800 万 Token，在 GPT-5.4 上约 734 万——瓶颈在于决策量，而非接口。
> - 该 Mod 还支持与 AI 搭档的多人合作模式，完整包含地图投票、事件投票和遗物竞价机制。

## 为什么用 Mod，而不是画面捕获？

在 STS2MCP 之前，让 AI 玩一款原生不支持它的游戏的经典方案是 SpireNet 等项目开创的流水线：捕获画面，跑 OCR 和模板匹配来重建棋盘，把结构化状态喂给模型，把模型的决策翻译成模拟鼠标键盘输入，再循环（[SpireNet, GitHub](https://github.com)。它能跑，但很脆弱。每一个改动卡牌美术的补丁、每一种新 UI 布局、每一个分辨率差异都会破坏解析器。模型看到的质量取决于视觉流水线的水平，而延迟受限于"捕获 + 推理 + 每次模拟点击的稳定等待"之和。

STS2MCP 通过从游戏内部读取状态绕开了整类问题。这个 Mod 是由游戏 Mod 加载器载入的一个 .NET 程序集；它借助 HarmonyLib 注入游戏自身的代码，把游戏已经在使用的那些数据结构——玩家的 HP、金币、遗物、药水、手牌、敌人及其意图、地图选项——原样暴露出来。没有什么需要识别或解析的。模型收到的是游戏的 ground truth，以 JSON 或 markdown 格式通过本地 HTTP 服务器送达。

<!-- [PERSONAL EXPERIENCE] 我第一次翻看 STS2MCP 的代码库时，原以为会是常见的画面捕获机器人。当发现取而代之的是一套干净的 HTTP API——直接返回真实游戏状态对象的那一刻，这个项目于我豁然开朗。"AI 玩游戏"的难点不在策略，而在如何把准确、低延迟的棋盘信息送到模型面前。一个住在游戏内部的 Mod，彻底解决了这个问题。 -->

代价是适用范围。画面捕获机器人能对付显示器上你能看到的任何游戏。Mod 只适用于有 Mod 加载器、并且有人愿意写集成代码的游戏。《杀戮尖塔 2》自带 Mod 支持，基于 Godot 引擎，这让该路径成为可能。由于 .NET 屏蔽了平台差异，这个 Mod 是跨平台的——同一份 `STS2_MCP.dll` 在 Windows、Linux 和 macOS 上都能运行。

## 架构到底是怎么跑起来的？

系统分两层：**Mod**（游戏内部）和 **MCP 桥接**（独立 Python 进程）。它们之间通过本地 HTTP 通信；MCP 桥接再通过 stdio 与 AI 客户端通信。

![一个披着斗篷的盗贼形象站在火炬照亮的奇幻场景中，唤起《杀戮尖塔》一局游戏的地下城氛围](/posts/ai-play-slay-the-spire-mcp/images/dungeon.png)

### 层一：Mod——游戏内部的 HTTP 服务器

`McpMod.cs` 在一个后台线程上启动 `HttpListener`，监听 `localhost:15526`（可通过 `STS2_MCP.conf` 配置）。当 AI 客户端发起 `GET /api/v1/singleplayer` 请求时，Mod 遍历实时的 Godot 场景树和游戏对象——`RunManager`、当前 `Player`、`Creature` 敌人、`Card` 牌堆、`Map` 模型、当前 `Event` 或 `Shop` 或 `RestSite`——把屏幕上实际显示的内容序列化成 JSON 响应。一个 `state_type` 字段告诉客户端当前处于哪个画面：`menu`、`monster`/`elite`/`boss`、`map`、`event`、`rest_site`、`shop`、`rewards`、`card_select`、`treasure`、`crystal_sphere`、`game_over` 等等。

一份简化版的战斗状态响应长这样：

```json
{
  "state_type": "monster",
  "run": { "act": 2, "floor": 31, "ascension": 0 },
  "player": {
    "character": "Ironclad",
    "hp": 58, "max_hp": 75, "gold": 112,
    "energy": 3, "block": 6,
    "hand": [
      { "card": "Shrug It Off", "cost": 1, "type": "skill", "target": "self" },
      { "card": "Bash", "cost": 2, "type": "attack", "target": "single" }
    ],
    "enemies": [
      { "name": "Book of Stabbing", "hp": 162, "intent": "attack x6", "vulnerable": 0 }
    ]
  }
}
```

那份 JSON 是游戏的真实状态，不是视觉流水线的最佳猜测。`POST /api/v1/singleplayer` 负责执行操作——`play_card`、`end_turn`、`choose_map_node`、`shop_purchase`、`choose_event_option`——通过调用游戏自身使用的同一套 UI 入口。操作集与游戏菜单精确对应，所以模型并不在学习一套定制控制面板，而是在操作游戏自己的界面。

除了当前对局，Mod 还暴露了存档级接口：`GET /api/v1/profile` 获取持久化进度，`GET /api/v1/compendium` 获取通略图式概要（卡牌图鉴、遗物收藏、怪物图鉴、运行历史），`GET /api/v1/wiki` 对已发现的卡牌和遗物文本做模糊搜索，`GET/POST /api/v1/profiles` 列出、切换和删除三个存档槽。

### 层二：MCP 桥接

`mcp/server.py` 是一个相对薄的 Python 进程，基于官方 MCP SDK（`FastMCP`）构建。它连接 Mod 的 HTTP 服务器，把每个端点包装成一个 MCP 工具。`get_game_state` 包装单人 GET；`combat_play_card`、`combat_end_turn`、`map_choose_node`、`event_choose_option`、`shop_purchase` 等工具包装对应的 POST 操作。每个工具都会校验参数，并返回游戏响应或一个干净的报错，例如 `"Error: Cannot connect to STS2_MCP mod. Is the game running with the mod enabled?"`

桥接层还暴露了存档类工具——`get_profile`、`get_compendium`、`search_wiki`、`list_profiles`、`switch_profile`、`delete_profile`——让智能体可以在不离开当前对局上下文的情况下查询通略图或 Wiki。整个服务器通过 stdio 运行，通过标准的 `mcpServers` 配置块注册到 Claude Desktop 或 Claude Code：

```json
{
  "mcpServers": {
    "sts2": {
      "command": "uv",
      "args": ["run", "--directory", "/path/to/STS2MCP/mcp", "python", "server.py"]
    }
  }
}
```

一旦配置完成，Claude 的每次工具调用都会经桥接层路由到游戏内部。游戏并不知道、也不在意调用方是一个语言模型。

<figure class="chart-img" style="margin:2.5rem 0;text-align:center;padding:1.5rem 0">
  <img src="/posts/ai-play-slay-the-spire-mcp/charts/chart-2-mcp-ecosystem-growth.svg" alt="图表：MCP 生态增长时间线（2024 年 11 月至 2025 年 6 月）。服务器数量从开源发布时的约 20 个增长到 2025 年 1 月的 500 个，2025 年 6 月突破 1000 个，其中 OpenAI 在 3 月、Google DeepMind 在 4 月宣布采纳。" loading="lazy" style="max-width:100%;height:auto">
  <figcaption>来源：Anthropic、OpenAI、Google DeepMind 公告；awesome-mcp-servers 注册表（2025）</figcaption>
</figure>

## Claude 跑一局会发生什么

玩一局完整的《杀戮尖塔 2》不是一次 prompt 的事。它是一个漫长的智能体循环：调用 `get_game_state`，对棋盘做出推理，调用一个操作，重复。模型要走完主菜单（选存档、选角色、可选种子）、规划地图路线、打穿由怪物、精英和 BOSS 组成的各个篇章、在商店管理金币、解决事件、处理战后奖励流程——选卡、领遗物、管理药水。

项目的 `AGENTS.md` 同时充当策略指南：它告诉模型从右到左出牌以保持索引稳定、仔细阅读敌人意图、血量高于 70% 时打精英、低于 80% 时休息、先杀 BOSS 老大再清随从。模型的执行水准和人类一样参差不齐——能识别联动、会误判罕见意图、偶尔也会冒乐观主义的赌博。

<!-- [ORIGINAL DATA] 在铁甲战士对局上测得：Claude Sonnet 4.6 每局完整运行消耗略超 800 万 Token（输入、输出与工具响应合计）；GPT-5.4 平均 734 万 Token。主导成本的是决策量——每局数百次工具调用，每次都携带完整或部分游戏状态——而非桥接层的任何单次开销。这些数据来自 STS2MCP 自述文件的一手测量，不构成受控基准。 -->

最醒目的数字是 Token 消耗。一局铁甲战士在 Claude Sonnet 4.6 上要烧掉约 **800 万 Token**，在 GPT-5.4 上约 **734 万 Token**（[STS2MCP README](https://github.com/Gennadiyev/STS2MCP), 2025）。这不是接口税的问题——桥接层的额外开销可以忽略不计。这是决策量的问题：一局游戏包含数百个离散选择，每个选择之前都有一次返回完整棋盘描述的 `get_game_state`。状态本身就是成本。

![一叠展开的扑克牌，象征《杀戮尖塔》核心的牌组构筑决策](/posts/ai-play-slay-the-spire-mcp/images/cards.png)

## 多人模式：与 AI 搭档合作

不那么显眼的功能是多人支持。STS2MCP 在 `/api/v1/multiplayer` 下暴露了一组并行端点，以及一套对应的 `mp_` 工具——`mp_combat_play_card`、`mp_map_vote`、`mp_event_choose_option`、`mp_relic_select`。地图选择和事件都是投票：只有全体玩家一致时才会移动。宝藏遗物是竞价——如果两名玩家看中同一件遗物，一场"遗物对决"决定归属，败者获得安慰奖。结束回合同样是投票，且在所有人提交之前可以通过 `mp_combat_undo_end_turn` 撤回。

与 AI 搭档合作是这个项目的初衷。单人模式最初只是用来验证；真正的目标是让一名人类与一个语言模型并肩而坐、共同决策，而 Mod 暴露了游戏在人类合作中已经在用的同一套投票和竞价 UI。多人模式仍处测试阶段——自述文件提醒玩家在向游戏开发者报告任何多人 Bug 前先禁用本 Mod——但它是 MCP 把 AI 连接到一项共同人类活动（而不只是一个工具）的罕见案例。

## 为什么 MCP 恰好是这里正确的抽象？

MCP 通常被框定为"让 AI 访问你的工具"——你的日历、数据库、代码仓库。STS2MCP 把这个框定翻转了过来：它让任何 AI 都能访问一款游戏。因为 Mod 以标准 MCP 服务器的形式暴露，今天的玩家可以是 Claude，明天切 ChatGPT，后天换成自定义评测脚本——游戏服务器不用动。

<!-- [UNIQUE INSIGHT] 大多数 MCP 服务器让 AI 对人类有用。STS2MCP 让一款游戏对 AI 有用——更准确地说，是让一款游戏一次性对所有 AI 可读。自述文件里陈述的研究目标是在一个罕见领域（所谓"分布外"）测试并基准评测不同语言模型的推理与决策能力。MCP 正是把一个单游戏 Mod 变成模型无关基准的东西：换客户端不换服务器，就能让 Claude、GPT-5、Gemini 在完全相同的对局上一较高下。 -->

这种模型无关性正是意义所在。这个项目的公开目的是在一个罕被探索的领域测试 AI 智能体——并最终在不同语言模型之间做推理能力的基准评测。因为接口是 MCP，评测不同模型只需换客户端，不用换服务器。一套标准化游戏，多位玩家。

还有第二个、也更微妙的好处。MCP 的类型化工具 schema 迫使 Mod 开发者精确定义游戏的操作空间。每个操作都有名字、类型化参数和一份双方都能据此测试的文档化契约。画面捕获机器人通常靠硬编码蒙混过关；MCP 让这些决策全部显式化。

<figure class="chart-img" style="margin:2.5rem 0;text-align:center;padding:1.5rem 0">
  <img src="/posts/ai-play-slay-the-spire-mcp/charts/chart-1-sts-content-comparison.svg" alt="图表：《杀戮尖塔 1》vs《杀戮尖塔 2》抢先体验内容量对比。卡牌：1 代 375，2 代 250。遗物：1 代 150，2 代 120。敌人：1 代 160，2 代 110。" loading="lazy" style="max-width:100%;height:auto">
  <figcaption>来源：Mega Crit Games、《杀戮尖塔》Wiki、社区文档（2025）</figcaption>
</figure>

## 这条路径的边界在哪里

Mod 路线用广度换保真度。它在《杀戮尖塔 2》上表现出色，是因为这款游戏有 Mod 加载器、有值得一读的数据模型。它无法迁移到封锁内部机制的游戏——对此，画面捕获仍是唯一选项。即便在 STS2 内部，模型能看到的状态也仅取决于状态构建器：《McpMod.StateBuilder.cs》必须在 Mega Crit 新增房间类型或机制时同步更新，而且 Mod 是针对特定游戏版本钉死的（测试于 `v0.103.2`）。

Token 消耗是另一个硬约束。每局 800 万 Token 的代价意味着在几十个对局上评测一个模型所费不菲。项目通过通略图和 Wiki 端点来缓解——查询通略图获取上下文的智能体，比起从头重新推理，会花更少的 Token 在冗余思考上——但每局数百个"状态加决策"循环的根本成本不会消失。

## 常见问题

### 这个 Mod 会修改游戏规则，让 AI 获得不公平优势吗？

不会。Mod 不修改任何游戏规则、卡牌数值或随机数。它纯粹是一个接口，让外部程序读取人类玩家能看到的状态、调用人类玩家会点击的 UI 操作。AI 用这个接口玩得好不好，完全取决于模型本身。

### 任何兼容 MCP 的模型都能通过这套方案玩吗？

可以。因为游戏是标准 MCP 服务器，任何实现 MCP 客户端规范的客户端都能驱动它。实际表现跟随推理能力走。自述文件报告了 Claude Sonnet 4.6（约 800 万 Token/局）和 GPT-5.4（约 734 万 Token/局）的 Token 用量，更强的模型误判更少、规划更远。游戏服务器不在乎是哪个模型在调用。

### 这和画面捕获机器人有什么不同？

画面捕获机器人读的是像素——靠 OCR 和模板匹配重建棋盘，用模拟鼠标键盘来行动。STS2MCP 从进程内部读取游戏自己的数据结构，所以模型收到的是 ground truth 而非解析器的最佳猜测，也没有会在每个补丁后失效的视觉流水线。代价是 Mod 需要一款可 Mod 的游戏；画面捕获对任何你能看到的游戏都有效。

### 多人模式对工具有什么改变？

多人模式有一套经 `/api/v1/multiplayer` 路由的并行 `mp_` 工具。地图选择、事件和结束回合都是投票；宝藏遗物是竞价。`mp_combat_undo_end_turn` 允许玩家在所有人提交前撤回结束回合的投票。自述文件指出多人模式处于测试阶段，并请玩家在向游戏开发者报告任何多人 Bug 前先禁用本 Mod。

### STS2MCP 支持《杀戮尖塔 1》吗？

当前项目专门针对《杀戮尖塔 2》。这套架构——Mod 经 HTTP 暴露游戏状态，再桥接到 MCP——原则上是可迁移的，但状态构建器和操作集是针对 STS2 基于 Godot 的代码库编写的，换一款游戏需要重新实现。

## 结语

STS2MCP 是一个小项目，但前提干净：对一款游戏最好的接口，就是游戏自己。通过把一个 .NET Mod 注入《杀戮尖塔 2》、再把它的 HTTP API 桥接至 MCP，它把一款卡牌肉鸽变成了模型无关的基准——一个让 Claude、GPT-5、以及任何未来模型都能坐到同一张桌前、花上几百万 Token、展示自己在压力下真正推理能力的地方。这个协议不在乎工具是数据库还是一副卡牌。这正是它的意义所在——也是它值得动手搭建的原因。

## 参考资料

- STS2MCP，GitHub 仓库（C# Mod、MCP 桥接、自述文件），2025，https://github.com/Gennadiyev/STS2MCP
- awesome-mcp-servers，GitHub MCP 服务器注册表与生态追踪，2025，https://github.com/punkpeye/awesome-mcp-servers
- Model Context Protocol 官方文档与客户列表，2025，https://modelcontextprotocol.io
- Mega Crit Games，《杀戮尖塔》与《杀戮尖塔 2》官网与内容文档，2025，https://megacrit.com
- SteamDB，《杀戮尖塔 2》（App 2381570）同时在线人数图表，2025，https://steamdb.info/app/2381570
- SpireNet 及社区《杀戮尖塔》AI 自动化项目，GitHub，2025，https://github.com
