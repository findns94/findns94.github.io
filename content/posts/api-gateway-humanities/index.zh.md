---
title: "什么是 API 网关？一个人文社科学生的视角"
description: "API 网关是互联网的守门人。2025 年，82% 的组织采用了 API 优先策略。人文学科的视角，让你重新理解「把关」这件事。"
coverImage: "/posts/api-gateway-humanities/images/cover.svg"
coverImageAlt: "什么是 API 网关——人文社科学生视角，将 API 网关比作数字守门人，并呈现 2025 年的采用率与安全统计"
ogImage: "/posts/api-gateway-humanities/images/cover.svg"
date: 2026-07-19 22:00:00
lastUpdated: 2026-07-19 22:00:00
author: "FindNS94"
tags: ["API", "Software Architecture", "Technology"]
categories: ["Technology", "Software Architecture"]
math: false
---

![什么是 API 网关——人文社科学生视角，将 API 网关比作数字守门人，并呈现 2025 年的采用率与安全统计](/posts/api-gateway-humanities/images/cover.svg)

# 什么是 API 网关？一个人文社科学生的视角

1947 年，心理学家库尔特·勒温（Kurt Lewin）注意到一件平常的事：摆上家庭餐桌的食物，并非偶然到达那里。总有人——在勒温的论述里，通常是家庭主妇——决定哪些东西能通过厨房的"门"，哪些不能。勒温把这种行为称为"把关"（gatekeeping），这个概念后来重塑了我们对权力、媒体与准入的理解。它从餐桌走向了新闻编辑室：1950 年，一项关于一位绰号"盖茨先生"的研究显示，编辑个人的取舍，决定了成千上万读者眼中何为重要新闻。

你不需要会写代码，也能理解 API 网关是什么。事实上，人文学科早已为你备好了合适的工具——关于翻译、边界、权力与语言的思考，恰好就是打开这个话题的钥匙。2025 年，Postman 的《API 现状报告》发现，82% 的组织已采取某种形式的 API 优先策略，其中 25% 已全面实现 API 优先（[Postman](https://www.postman.com/state-of-api/2025/), 2025）。如今你几乎每一次数字交互，都要经过一个你看不见的守门人。读完这篇你不仅会知道 API 网关究竟做什么——你还会拥有一把更锐利的、审视"把关"本身的透镜。

> **核心要点**
> - API 网关是互联网的守门人：一个控制、翻译并保护流量的单一入口（Lewin 1947）。
> - 2025 年，98% 的组织遭遇过 API 安全问题（Salt Security, 2024）。
> - 四项职能——认证、限流、协议转换、日志——对应你熟悉的概念：边防、门卫、接线员、档案馆。
> - 网关从来不是中立的——它是披着基础设施外衣的政策抉择。

<!-- more -->

## 首先，API 是什么？进门之前先说清楚

2025 年，69% 的开发者表示每周花在 API 上的时间超过十个小时（[Postman](https://www.postman.com/state-of-api/2025/), 2025）。如果数字世界真有什么根基，那根基就是这些接口。不过，在遇见守门人之前，我们得先弄明白它在守卫什么——API 本身。

![一封代表 API 的老式信件，将 API 比作软件系统之间的结构化消息](/posts/api-gateway-humanities/images/api-as-letter.jpg)

这里有一个不需要计算机科学背景的释义。API——应用程序接口——不过是一套规则，让一段软件能用双方都懂的语言，向另一段软件请求点什么。你可以把它想成一封有固定格式的信。

弗兰茨·卡夫卡精准地写过这件事。在《城堡》里，土地测量员 K. 把措辞考究的信寄给他从未谋面的官僚，盼着对方回信。每封信都遵循一种格式，每封信都期待一个回音。API 调用如出一辙：一个程序把格式化的请求发给另一个程序，然后等待回答。那种优雅——与那种挫败——都源于你几乎永远不知道对面是谁。

那么，如果 API 是信件，由谁来处理它？你需要一个邮局来分拣、一名翻译来转译、一张安检台来筛查——三者合一。这个合体，就是 API 网关。

## 那么，API 网关究竟是什么？

2025 年，65% 的组织报告称直接从其 API 获得收入（[Postman](https://www.postman.com/state-of-api/2025/), 2025）。守门人守卫的不再只是数据——它守卫的是钱。那这究竟是个什么东西？

API 网关是一个单一的入口点，坐落在外部世界与一组内部服务之间。每一份请求——每一封数字"信件"——都必须先经过它，才能抵达别处。网关决定什么放行、什么翻译、什么记录、什么拒之门外。从最字面的意义上说，它就是一扇门。

两个人文学科的隐喻可以讲清楚它的本分。第一个来自翻译研究。学者劳伦斯·韦努蒂（Lawrence Venuti）描述过译者必须在"异化"（保留原文的陌生感）与"归化"（让译文读起来像母语）之间做出选择。API 网关同时做着这两件事。对外，它讲 REST 与 HTTPS——那 93% 的 API 都在用的公共语言（[Postman](https://www.postman.com/state-of-api/2025/), 2025）；对内，它把这些请求翻译成每项内部服务各自懂的行话，无论是 gRPC、GraphQL，还是更古老的协议。外边的人不必学里面的语言，里面的人也不必学外边的。

第二个隐喻来自政治科学：边防检查站。想象一下护照查验台。官员核验你的证件，决定你是否准入，统计今天已有多少人过境，并记下你的名字。网关对每一笔请求都完成同样的四道动作——认证、授权、限流与审计日志。它不在乎你携带着什么；它在乎你是谁、以及你是否被允许通过。

根据 Postman 2025 年的《API 现状报告》，65% 的组织如今从 API 获得收入，但同年有 98% 的受访者经历过 API 安全问题（[Postman](https://www.postman.com/state-of-api/2025/), 2025）。这种张力——为商业敞开门，又为安全锁上门——恰恰是网关存在的理由。它是一个组织决定谁可以进入、多快、在什么条件之下的那个单点。

## 网关究竟做什么？四项职能

2024 年，Salt Security 的《API 安全现状报告》发现，98% 的受访者在过去 12 个月内遭遇过 API 安全问题（[Salt Security](https://www.salt.security/resource/api-security-research-report), 2024）。这个数字几乎让人难以置信——直到你意识到网关同时承担着多少本分。它不是一件工具，而是叠在一起的四件。

![棒棒糖图展示 API 网关的四项核心职能及其对应的人文学科隐喻：认证对应门卫，限流对应接线员，协议转换对应翻译，日志对应档案馆](/posts/api-gateway-humanities/images/chart-four-jobs.svg)

**认证："你来者何人？"** 每个来访者都自称拥有某个身份，而网关的第一项本分就是核验它——像夜店门口查身份证的保安。这个请求真的来自它所声称的那个应用吗？它携带着有效的令牌吗？如果答案是否定的，请求到此为止。没有例外，没有通融。

**限流："别那么急。"** 想象一位人气很高的图书馆员，每小时只能处理那么多预约申请。她不会让一拥而上的人把服务台压垮，而是发号码牌，依次办理。限流的原理一样：它在给定的时间窗口内，限制任何单一用户能发出的请求数量。这让一个吵闹的邻居不至于把其他人的资源全部挤占——它也是抵御拒绝服务攻击的主要防线。

**协议转换：翻译员的活儿。** 我们通过韦努蒂的透镜已经见过这项本分。网关用外部世界的语言接收请求，再用每项内部服务各自听得懂的语言重写它。一个单一的公共同入口可以扇出成十几场私人对话，而客户端对此一无所知。

**日志与监控：档案馆。** 每一笔经过的请求都会留下痕迹——谁、何时、请求了什么、得到了什么回复。米歇尔·福柯写过全景监狱：一座让囚犯永远不知道自己是否正被注视、于是仿佛永远被注视的监狱。网关的日志并不阴暗，但原理一样：一切都被记录这一事实本身，就会改变系统的行为方式。当你知道档案馆存在，你就会建得更审慎。

> **独到洞见：** 多数技术教程不会告诉你：这四项职能并非同等重要。实际上，对大多数组织而言，认证与限流承担了最重的工作；而协议转换在你把新旧系统衔接在一起时才最为关键。日志这项本分，是所有人最容易遗忘的——直到出了毛病，他们才急切地需要那条踪迹。

## 为什么不干脆放任一切通过？

![一群人走向敞开的大门，比喻不加管理的 API 流量](/posts/api-gateway-humanities/images/open-gate-crowd.jpg)

人们很容易憧憬一个全然没有门的数字世界——一个纯粹、开放的网，每份请求都自由流向目的地。这个愿景有着漫长的历史。早期互联网的缔造者常把自己的创造描述为无国界的公地。然而现实，或许简·雅各布斯（Jane Jacobs）早有预言，远比这复杂。

雅各布斯这位敏锐的城市观察者主张，健康的街区需要她所说的"有管理的渗透性"。一条完全对过境交通敞开的街道，会变得危险而不宜居；一条彻底封闭的街道，则会衰亡。最好的街道拥有恰到好处的门、拐角和"街道之眼"，让事物兼有安全与活力。API 网关把同样的逻辑用在软件上：让门敞得够开以维持生意，又关得够紧以保证安全。

2025 年，Postman 平台在单个 12 个月周期内记录了 753 万次对 AI API 的调用，同比增长 40%（[Postman](https://www.postman.com/state-of-api/2025/), 2025）。AI 智能体不会客气地发出一个请求然后干等。它们接连发出成千上万个调用，把一个 API 的输出串成下一个的输入。没有网关来计量这股流量，单个失控的智能体就可能冲垮它触碰到的每一项服务。

放任一切通过的后果，并非纸上谈兵。Akamai 的研究发现，约 20% 的网络攻击如今直接以 API 为目标，约三分之一的组织遭遇过与 API 相关的数据泄露（[Akamai](https://www.akamai.com/blog/security-research/state-of-api-security-2024), 2024）。放任一切通过，并不是自由——那只是没锁门而已。

## 网关从来不是中立的——这正是关键所在

![一座带有天平的边检站，比喻 API 网关中嵌入的政策抉择](/posts/api-gateway-humanities/images/customs-checkpoint.jpg)

这是人文学科的透镜最有回报的地方——也是大多数技术写作沉默失语的地方。网关从来不是一根中立的管道。它执行的每一条规则，都是关于谁能准入、以什么条件准入的抉择。

勒温最初的洞见就是：把关是一种权力行为。决定家庭伙食的主妇，决定头版新闻的编辑——两者都在行使塑造他人所得的判断力。API 网关以机器的速度做着同样的事。当一家公司设定限流阈值时，它在决定谁的请求更重要。当它屏蔽某个地区时，它在划定边界。当它要求付费订阅令牌时，它在设定入场费。

学者 Lucas Introna 与 Helen Nissenbaum 曾指出，每一个分类体系都嵌入着一种视角——那些看起来中立的分类，总在为某些人的利益服务。网关的规则看起来是技术的，但它们是披着基础设施外衣的政策抉择。网络中立性的争论问过：互联网提供商是否该被允许让某些流量快、让另一些慢。API 网关在内部面对着同样的问题：高级合作伙伴的请求该不该插队？

网关是一项披着基础设施外衣的政策抉择。2025 年，AWS API Gateway 以 47% 的份额领跑市场，Azure 占 26%，31% 的组织同时使用多个网关（[Postman](https://www.postman.com/state-of-api/2025/), 2025）。这些数字背后，是成千上万个组织在做审慎的抉择——关于谁掌控自己的门，进而，关于谁掌控对其服务的准入。

这一切并不意味着网关是坏的。它意味着网关是有权力的，而权力值得审视。下一次某个服务变慢、或者某个请求被拒绝时：记住，在某个地方，一个守门人定下了一条规则。理解那条规则，是质疑它的第一步。

## 简史：从话务员到软件

守门人并不新鲜——它和连接本身一样古老。电话时代早期，每一通电话都要经由总机前的接线员转接。你拿起听筒，报给接线员一个名字或号码，她便亲手插上一根线缆，把你们连起来。那名接线员，就是连接最初的守门人——实时决定哪些电话可以接通。

当自动交换机取代了人工总机，把关行为并未消失。它只是变得看不见了，被埋进了机器里。人变成了机械的，又变成了电子的，再变成了软件。形式在变，功能却没变。

互联网走着同样的弧线。上世纪 90 年代，一个网站通常就是一台独自应答所有请求的计算机。随着流量增长，单机不堪重负。工程师们把大应用拆成更小的"微服务"，每项负责一件事。但这带来了新问题：客户端如今需要和几十项服务对话，而非一台。API 网关便作为答案应运而生——一座拥有许多房间的建筑，只设一扇前门。

![面积图展示 API 网关市场从 2024 年的 28 亿美元增长至 2030 年预计的 68 亿美元](/posts/api-gateway-humanities/images/chart-market-growth.svg)

数字道出了这一转变的规模。Grand View Research 估计 API 网关市场在 2024 年为 28 亿美元，预计到 2030 年达到 68 亿美元（[Grand View Research](https://www.grandviewresearch.com/industry-analysis/api-gateway-market-report), 2025）。MarketsandMarkets 给出的 2024 年数字为 22 亿美元，同样预测到 2029 年达到 68 亿美元（[MarketsandMarkets](https://www.marketsandmarkets.com/Market-Reports/api-gateway-market-248389080.html), 2024）。每位预测者都同意：系统越复杂，守门人越有价值。规模永远需要守门人——唯一会变的，是握门的那个"谁"或"什么"。

## 常见问题

### 用最简单的话说，API 网关是什么？

API 网关是一个单一的入口点，控制与保护外部请求和组织内部服务之间的流量。把它想象成一个数据边境检查站：它核验身份、翻译语言、限制人流规模，并记录谁曾通过。

### 小项目需要 API 网关吗？

起初也许不需要——但一旦你的项目真正面对公网流量，账就不一样了。2024 年，98% 的组织报告在 12 个月内遭遇过 API 安全问题（[Salt Security](https://www.salt.security/resource/api-security-research-report), 2024）。小项目会成长，而网关在出事之前加装，比出事之后补救要容易得多。

### API 网关和负载均衡器有什么区别？

负载均衡器是个环岛：它把入站请求均匀分散到多台服务器，让任何一台都不会过载。API 网关是个海关柜台：它会检查每个请求的身份、内容和速率，再决定它该不该通过、该去哪。许多组织两者都用。

### API 网关只关乎安全吗？

不只如此。安全是本分里很重要的一部分，但网关同样处理翻译、路由和营收。2025 年，65% 的组织直接从其 API 获得收入（[Postman](https://www.postman.com/state-of-api/2025/), 2025）。网关正是商业逻辑与安全防护交汇之处。

### 谁在做 API 网关？

最大的玩家是云厂商：AWS API Gateway 以 47% 的采用率领跑，微软 Azure 紧随其后占 26%（[Postman](https://www.postman.com/state-of-api/2025/), 2025）。开源选项如 Kong 与 Envoy 则深受希望自建网关、又不想锁定单一厂商的团队青睐。

## 结语

API 网关是互联网的守门人——而"把关"，远非一个贬义词，正是复杂系统保持可读、公平与安全的方式。它执行的四项职能——认证、限流、转换与日志——对应你早已熟悉的人文学科概念：边防、翻译、门卫与档案馆。

数字印证了它的重要性。随着 82% 的组织采用 API 优先策略、网关市场朝 68 亿美元迈进，守门人不会退场（[Postman](https://www.postman.com/state-of-api/2025/), 2025; [Grand View Research](https://www.grandviewresearch.com/industry-analysis/api-gateway-market-report), 2025）。但最关键的洞见并非技术层面的。它是勒温在 1947 年给我们的那一条：每道门都是一个抉择。下一次你轻点应用、回复倏然出现时，请想象一下——你的请求刚刚通过的那道检查站——并且记住，在某处，有谁来定了那些规则。

---

**Sources:**

- Postman. "2025 State of the API Report." 2025. Retrieved 2026-07-19. [https://www.postman.com/state-of-api/2025/](https://www.postman.com/state-of-api/2025/)
- Salt Security. "State of API Security Report 2024." 2024. Retrieved 2026-07-19. [https://www.salt.security/resource/api-security-research-report](https://www.salt.security/resource/api-security-research-report)
- Akamai. "State of API Security 2024." 2024. Retrieved 2026-07-19. [https://www.akamai.com/blog/security-research/state-of-api-security-2024](https://www.akamai.com/blog/security-research/state-of-api-security-2024)
- Grand View Research. "API Gateway Market Size & Share Report, 2025–2032." 2025. Retrieved 2026-07-19. [https://www.grandviewresearch.com/industry-analysis/api-gateway-market-report](https://www.grandviewresearch.com/industry-analysis/api-gateway-market-report)
- MarketsandMarkets. "API Gateway Market – Global Forecast to 2029." 2024. Retrieved 2026-07-19. [https://www.marketsandmarkets.com/Market-Reports/api-gateway-market-248389080.html](https://www.marketsandmarkets.com/Market-Reports/api-gateway-market-248389080.html)
- Traceable AI. "State of API Security 2024." 2024. Retrieved 2026-07-19. [https://www.traceable.ai/blog](https://www.traceable.ai/blog)
