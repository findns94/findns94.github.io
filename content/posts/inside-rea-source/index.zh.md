---
title: "深入 REA 源码：一个 MCP 编排层如何统一 Ghidra、Hopper 和 IDA 三大逆向引擎"
description: "REA 的六边形架构在 128 个工具契约背后统一了 3 个逆向引擎，处理 262K+ 行 TypeScript 代码，采用 Evidence-First 设计使每个 AI 驱动的结论可验证。"
coverImage: "/posts/inside-rea-source/images/cover.jpg"
coverImageAlt: "架构图展示了 REA 的 MCP 编排层如何连接 Ghidra、Hopper 和 IDA"
ogImage: "/posts/inside-rea-source/images/cover.jpg"
date: "2026-10-13 14:00:00"
lastUpdated: "2026-10-13 14:00:00"
author: "FindNS94"
tags: ["MCP", "Reverse Engineering", "AI Agents"]
---

![架构图展示了 REA 的 MCP 编排层如何连接 Ghidra、Hopper 和 IDA](/posts/inside-rea-source/images/cover.jpg)

Reverse Engineer Anything(REA) 在 2026 年 10 月发布后三天内斩获 120,000+ GitHub Star。然而喧嚣之下藏着一个更有趣的故事：如何构建一个系统，让 Ghidra、Hopper 和 IDA 三大逆向引擎实现可互换？REA 的答案是一套六边形架构(Evidence-First 设计哲学)、128 个工具契约，以及一个 Provider 无关的桥接层。本文将拆解源码层面的关键决策——一个编排层如何同时服务三个互相竞争的逆向引擎，以及为什么每个 AI 驱动的结论都携带可验证的证明。

<!-- more -->

> **核心要点**
> - REA 的核心创新是 Evidence-First(证据优先) 设计哲学
> - Provider 无关性实现真正的引擎可插拔
> - 128 个工具契约构建统一抽象层
> - 全架构贯穿 Fail-Closed(失败即拒绝) 安全设计

## 为什么统一逆向工程引擎如此困难？

每个逆向引擎都说着自己的语言。Hopper 通过 Unix socket 暴露 Python API，Ghidra 运行无头 Java 脚本，IDA 则提供 MCP 适配器。它们的数据模型、分析管线和输出格式几乎没有共同点。构建统一层意味着抽象掉这些差异，同时不丢失每个工具独有的价值。

<!-- [UNIQUE INSIGHT] -->
REA 的洞察是：抽象应该存在于证据层，而非引擎层。REA 不强迫 Ghidra 和 Hopper 产出相同格式，而是将每一条观察规范化为统一的 Evidence 记录(`src/domain/evidence.ts`)。每条记录携带语义哈希(`ev_{sha256}`)、置信度(observed/derived/inferred)和权威等级(从 `shipped-artifact` 到 `analyst-inference`)。结果是：Hopper 的反编译函数和 Ghidra 的字符串表成为同一证据图中可互换的数据点。

> **引用胶囊:** REA 在 36 个源码目录中处理 262,000+ 行 TypeScript，在 12 个 Vitest 项目中包含 98,000+ 行测试。仅 `src/domain/` 层就包含证据哈希、规范化 JSON 序列化和残差未知跟踪的纯函数——除 Zod schema 外零外部运行时依赖(来源: `doc/zhihu/rea/architecture-overview.md`)。

<figure class="chart-img" style="margin:2.5rem 0;text-align:center;padding:1.5rem 0"><img src="/posts/inside-rea-source/charts/chart-1-hexagonal-architecture.svg" alt="Hexagonal architecture diagram showing Domain, Application, Composition, and Adapters layers" loading="lazy" style="max-width:100%;height:auto"></figure>

## REA 的六边形架构如何运作？

架构遵循严格的向内依赖流：Adapters → Composition → Application → Domain。Domain 层(`src/domain/`)包含纯业务逻辑——Evidence 模型、错误代数、分析 Profile、工件图——不导入任何 Node.js 特定模块或第三方库(Zod 除外)。这使得核心可以独立测试。

Application 层(`src/application/`)通过 `BinarySession.ts` 和 `DirectAnalysis.ts` 编排会话。Composition 层(`src/composition/`)作为组合根，通过 `binary.ts` 和 `directAnalysis.ts` 装配 Provider。两个适配器——CLI(`src/cli.ts`)和 MCP(`src/main.ts`)——共享同一个组合根，确保从终端或 AI Agent 调用 REA 时行为完全一致。

<!-- [PERSONAL EXPERIENCE] -->
令人印象深刻的是 CLI 和 MCP 路径的收敛如此干净。两者都在入口调用 `snapshotEnvironment()`，然后 `parseConfig()`，再分别调用 `createDirectAnalysis()` 或 `createBinarySession()`。CLI 获得无状态的一次性会话；MCP 获得跨工具调用持久存在的 `BinarySession`。但 Provider 选择逻辑、证据语义和错误处理都是共享代码路径——而非复制粘贴。

> **引用胶囊:** REA 的组合根通过共享工厂连接两个入口：`createBinarySession()` 用于 MCP 的长驻进程，`createDirectAnalysis()` 用于 CLI 的一次性执行。两者消费同一个 `parseConfig()` 配置解析器和同一个 Provider 注册表，保证 Ghidra 分析无论是通过 `rea ghidra <target>` 还是 MCP `open_binary` 工具调用触发，都产出完全相同的 Evidence(来源: `src/composition/binary.ts`, `src/composition/directAnalysis.ts`)。

## Provider 系统如何实现可插拔分析？

Provider 实现 `src/application/AnalysisProvider.ts` 中定义的 `AnalysisProvider` 接口。每个 Provider 暴露 `identity()`、`capabilities()` 描述符列表，以及返回绑定 `AnalysisClient` 的 `createClient()` 方法。`AnalysisProviderRegistry` 按 ID 排序候选并执行确定性选择——注册顺序永远不影响选中哪个引擎。

当 `selector` 设为 `"auto"` 时，注册表并行评估所有候选，检查可用性和目标支持，然后解析分析 Profile。如果恰好一个 Provider 通过，它胜出。如果多个通过，系统返回歧义错误而非猜测。这种 Fail-Closed 行为防止了分析结果的静默错误归因。

`CompositeProvider`(`src/application/binary/CompositeProvider.ts`)增加了一层回退：当没有深度分析引擎绑定到目标时，辅助 Provider——Android、Go、WASM、EVM、SQLite——仍然交付价值。每个操作按名称路由到正确的子 Provider，客户端在首次使用时延迟创建。

![Architecture diagram](/posts/inside-rea-source/images/architecture-diagram.jpg)

> **引用胶囊:** 三个深度 Provider——Hopper、Ghidra 和 IDA——实现 `AnalysisProvider` 接口，传输机制各不相同：Hopper 使用 Unix socket 上的 Python 桥(`bridge/hopper_bridge.py`)，Ghidra 使用 Java HeadlessScript(`bridge/ghidra/ReaGhidraBridge.java`，3,956 行)，IDA 使用外部 MCP 服务器。尽管差异巨大，三者都产出相同 schema 的 Evidence 记录(来源: `doc/zhihu/rea/provider-and-bridge.md`)。

## REA 的证据系统有何不同？

传统逆向工具产出会话级输出，GUI 关闭即消失。REA 的 Evidence v2 系统(`src/domain/evidence.ts`)将每条观察视为一等公民、不可变记录。每条 Evidence 记录包含语义哈希、置信度、权威等级，以及可选的 `analysis_profile` 链接——将其绑定到特定 Provider 版本和参数集。

`ResidualUnknown` 系统(`src/domain/residualUnknown.ts`)更进一步，对分析*未发现*的内容建模。每个未知获得稳定标识符(`unk_{sha256}`)、带乐观并发控制的修订链，以及经过环验证的依赖图。当分析师将未知标记为已解决时，系统要求证据满足声明的权威和置信度阈值。

EvidenceBundle(`src/domain/evidenceBundle.ts`)将这些记录密封为不可变的、规范化排序的集合。`freezeJsonSnapshot()` 深度冻结每个嵌套对象，WeakMap 认证未被篡改。`serializeEvidenceBundle()` 输出 RFC 8785 规范化 JSON，使 Bundle 可跨会话和工具移植。

<!-- [ORIGINAL DATA] -->
数字说明一切：128 个唯一工具契约、6 大类 70+ MCP 工具，以及 `AnalysisError` 层次中的 27 种不同错误类型(`src/domain/analysisErrorCore.ts`)。每个错误携带诊断信息、捕获输出、清理状态和部分观察——即使失败的分析也为证据图贡献了经过验证的事实。

> **引用胶囊:** REA 的证据系统使用三级置信度(observed/derived/inferred)和五级权威(shipped-artifact/controlled-replay/historical-reference/external-service/analyst-inference)。Evidence ID 计算为 `ev_{sha256}`，基于排除 `subject.name` 等仅显示字段的语义投影，确保两个 Provider 返回相同分析内容时产生相同的证据 ID(来源: `src/domain/evidence.ts`)。

<figure class="chart-img" style="margin:2.5rem 0;text-align:center;padding:1.5rem 0"><img src="/posts/inside-rea-source/charts/chart-2-provider-selection.svg" alt="Provider selection flowchart showing auto-selection strategy" loading="lazy" style="max-width:100%;height:auto"></figure>

## 桥接层如何连接外部工具？

桥接层在 REA 的 JSON-RPC 协议与各引擎原生 API 之间翻译。通用模式是：REA 启动桥接进程，通过安全通道传递会话描述符，桥接代理方法调用到引擎。认证使用常量时间令牌比较——Java 中的 `MessageDigest.isEqual`(`ReaGhidraBridge.java` 第 3862 行)和 Python 中的 `hmac.compare_digest`(`hopper_bridge.py` 第 1043 行)。

Ghidra 桥接作为 3,956 行 Java `HeadlessScript` 运行在 Ghidra 自身进程内。它读取包含传输模式、端点路径、认证令牌、目标 SHA-256 和分析扩展的 JSON 描述符。在 POSIX 系统上，描述符文件读取后立即删除(consume-and-delete)。在 Windows 上，它以受保护的 DACL 持久存在直到桥接关闭。

Hopper 桥接使用延迟 API 解析——`hopper_bridge.py` 中的 `_api()` 函数仅在首次调用时接触 Hopper 全局变量，因此模块可在 Hopper 运行时之外干净导入。它实现两级缓存：地址排序的过程和字符串表搜索库存缓存，以及跨重复投影复用反编译结果的伪代码缓存。

![Bridge protocol](/posts/inside-rea-source/images/bridge-protocol.jpg)

> **引用胶囊:** 每个 REA 桥接使用常量时间比较和通过安全会话描述符传递的 bearer token 认证请求。Ghidra 桥接同时支持 Unix domain socket(POSIX，`0600` 权限)和 loopback TCP(Windows)，而 Hopper 桥接使用单客户端 Unix socket 并设置 `server.listen(1)` 防止并发连接(来源: `doc/zhihu/rea/security-and-patterns.md`)。

## 128 个工具契约如何创建统一抽象？

工具契约位于 `src/contracts/`，定义 REA 128 个工具的名称、输入 schema、输出 schema 和效果声明。它们分为三层：官方工具(`officialToolContracts.ts`)是映射到 Provider 操作的薄代理；增强工具(`enhancedToolContracts.ts`)将多个操作组合成 `batch_decompile` 和 `get_call_graph` 等工作流；会话工具(`sessionToolContracts.ts`)管理长驻分析状态和证据生命周期。

契约系统默认强制执行只读语义。只有显式声明 `returnsTargetContent` 的契约才在输出中添加 `_meta.provenance.untrusted_content` 标记，向 AI Agent 表明内容源自分析目标，应视为数据而非指令。

`EvidenceMcpServer`(`src/server/EvidenceMcpServer.ts`)扩展 MCP SDK 的 `McpServer`，有两个关键覆盖：`registerTool()` 压缩 advertised input schema 以适应响应预算；`connect()` 用 `ErrorEvidenceTransport` 包装传输层，拦截超大错误响应，将其存入证据账本，返回带证据引用的精简错误。

> **引用胶囊:** REA 在 15+ 领域特定模块中注册 70+ MCP 工具(`registerOfficialTools.ts`、`registerAndroidTools.ts`、`registerFridaTools.ts` 等)，共享 128 个底层工具契约。每个契约声明其效果配置——`mutatesArtifact`、`launchesProcess`、`mayAccessNetwork`——让组合根在任何 Provider 进程启动前执行基于能力的访问控制(来源: `src/contracts/toolContracts.ts`)。

<figure class="chart-img" style="margin:2.5rem 0;text-align:center;padding:1.5rem 0"><img src="/posts/inside-rea-source/charts/chart-3-evidence-lifecycle.svg" alt="Evidence lifecycle diagram showing creation, sealing, and bundling" loading="lazy" style="max-width:100%;height:auto"></figure>

## REA 如何实现 Fail-Closed 安全？

Fail-Closed 意味着验证失败时系统默认拒绝。在 REA 的进程清理(`src/process/ProcessOwnership.ts`)中，每个 Provider 进程在启动时注入唯一的 `REA_PROCESS_RUN_ID`。在杀死任何进程之前，系统通过常量时间比较验证运行令牌。如果令牌不可读且进程仍然存活，清理被拒绝——系统不会冒险杀死已被操作系统回收给无关进程的 PID。

同样的原则适用于每一层。Windows 批处理命令引用(`src/process/WindowsBatchCommand.ts`)拒绝包含 cmd.exe 元字符的参数，而非尝试转义。`PrivateRuntimeRoot`(`src/process/PrivateRuntimeRoot.ts`)使用 `mkdtemp`(POSIX)或原生 DACL(Windows)创建临时目录，如果 Windows 原生能力不可用，抛出 `PrivateRuntimeRootUnavailableError` 而非回退到不安全路径。

提示注入防御增加另一层：每个携带目标衍生内容的工具结果都获得 `_meta.provenance.untrusted_content: true` 标记(`src/server/toolResultEncoding.ts`)。消费 MCP 响应的 AI Agent 可以区分 REA 的指令和嵌入在反编译伪代码或字符串表中的潜在恶意内容。

> **引用胶囊:** REA 的安全模型跨越四层：(1) 通过 `REA_PROCESS_RUN_ID` 令牌和 PID 复用保护实现进程所有权，(2) 常量时间桥接认证，(3) 每个边界的 Zod schema 验证，(4) 所有目标衍生输出的不可信内容标记。`ToolResultDelivery` 系统对 MCP 响应执行字节预算，将超大结果存入证据账本而非丢弃(来源: `doc/zhihu/rea/security-and-patterns.md`)。

## 常见问题

### 没有安装 Ghidra 或 IDA 时 REA 能工作吗？

可以。当没有深度分析引擎绑定到目标时，REA 的 `CompositeProvider` 组合辅助 Provider——Android(JADX)、Go、WASM(WABT)、EVM(EVMole)、SQLite 等。你无需安装 Ghidra、Hopper 或 IDA 即可分析 APK、WebAssembly 模块或 EVM 字节码。Provider 选择系统优雅降级而非失败。

### REA 为 AI 生成的结论提供什么证据？

每个分析操作产出一条 Evidence 记录，包含语义哈希、置信度(observed/derived/inferred)、权威等级，以及指向生成它的 Provider Profile 的链接。这些记录一旦创建即不可变，并打包成可导出、可共享、可审计的 EvidenceBundle。AI Agent 的结论强度取决于支撑它的证据链。

### REA 如何防止恶意二进制的提示注入？

携带目标衍生内容的结果——反编译代码、字符串表、网络捕获——被标记 `_meta.provenance.untrusted_content: true`。此标记在 `src/server/toolResultEncoding.ts` 中设置，并通过 MCP 响应传播。AI Agent 和 hook 可以读取此标记，将内容视为数据而非指令，中和嵌入的提示注入尝试。

### 可以同时从 CLI 和 AI Agent 使用 REA 吗？

可以。CLI 适配器(`src/cli.ts`)和 MCP 适配器(`src/main.ts`)共享同一个组合根、Provider 注册表和证据语义。你可以在终端运行 `rea binary_overview <target>`，同时 MCP 连接的 Agent 对同一文件执行 `batch_decompile`。两条路径通过相同代码路径产出相同的 Evidence 记录。

### Provider 进程在分析中崩溃怎么办？

REA 的错误系统(`src/domain/analysisErrorCore.ts`)定义 27 种 tagged error 类型，每种携带诊断信息、捕获的进程输出、清理状态和部分观察。当 Provider 崩溃时，系统保留故障前收集的所有证据，并将崩溃记录为 `ProviderCleanupError` 并附带部分观察。证据图保持一致——没有孤立声明。

## 结论

REA 的架构证明统一互相竞争的逆向引擎是可能的，而无需构建新的反编译器。关键决策是：在证据层而非引擎层抽象；使每条观察不可变且带语义哈希；将未知跟踪为一等公民；在每个边界执行 Fail-Closed 安全。128 个工具契约和 70+ MCP 工具是这些决策的用户可见表达，但真正的创新在于 `src/domain/evidence.ts` 和 Provider 注册表。如果你正在为任何专业领域构建 AI 原生工具，REA 的源码是如何让每个结论可验证的大师课。

## 来源

- GitHub, morluto/rea, retrieved 2026-10-13, https://github.com/morluto/rea
- REA Official Website, retrieved 2026-10-13, https://rea.tools/
- Zhihu, "REA: When Agent Learns Reverse Engineering", retrieved 2026-10-13, https://zhuanlan.zhihu.com/p/2092932306054993395
