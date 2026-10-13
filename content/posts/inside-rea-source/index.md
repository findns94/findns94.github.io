---
title: "Inside REA's Source: How a Single MCP Orchestration Layer Unifies Ghidra, Hopper, and IDA"
description: "REA's hexagonal architecture unifies 3 RE engines behind 128 tool contracts, processing 262K+ lines of TypeScript with an Evidence-First design that makes every AI-driven conclusion verifiable."
coverImage: "/posts/inside-rea-source/images/cover.jpg"
coverImageAlt: "Architecture diagram showing REA's MCP orchestration layer connecting Ghidra, Hopper, and IDA"
ogImage: "/posts/inside-rea-source/images/cover.jpg"
date: "2026-10-13 14:00:00"
lastUpdated: "2026-10-13 14:00:00"
author: "FindNS94"
tags: ["MCP", "Reverse Engineering", "AI Agents"]
---

![Architecture diagram showing REA's MCP orchestration layer connecting Ghidra, Hopper, and IDA](/posts/inside-rea-source/images/cover.jpg)

Reverse Engineer Anything (REA) hit 120,000+ GitHub stars in just three days after its October 2026 debut. Yet the hype obscures a more interesting story: how do you build a single system that makes Ghidra, Hopper, and IDA interchangeable? REA's answer is a hexagonal architecture with an Evidence-First design philosophy, 128 tool contracts, and a provider-agnostic bridge layer. This post unpacks the source-level decisions that let one orchestration layer serve three competing reverse engineering engines — and why every AI-driven conclusion carries verifiable proof.

<!-- more -->

> **Key Takeaways**
> - REA's core innovation is Evidence-First design philosophy
> - Provider agnosticism enables true engine pluggability
> - 128 tool contracts create unified abstraction layer
> - Fail-Closed security design throughout the architecture

## Why Is Unifying Reverse Engineering Engines So Hard?

Each reverse engineering engine speaks a different language. Hopper uses a Python API over a Unix socket, Ghidra runs headless Java scripts, and IDA exposes an MCP adapter. Their data models, analysis pipelines, and output formats share almost no common ground. Building a unified layer means abstracting away those differences without losing the unique strengths that make each tool valuable.

<!-- [UNIQUE INSIGHT] -->
REA's insight is that the abstraction should live at the evidence level, not the engine level. Rather than forcing Ghidra and Hopper to produce identical outputs, REA normalizes every observation into a common Evidence record (`src/domain/evidence.ts`). Each record carries a semantic hash (`ev_{sha256}`), a confidence level (observed, derived, or inferred), and an authority ranking from `shipped-artifact` down to `analyst-inference`. The result: a decompiled function from Hopper and a string table from Ghidra become interchangeable data points in the same evidence graph.

> **Citation Capsule:** REA processes 262,000+ lines of TypeScript across 36 source directories, with 98,000+ lines of tests in 12 Vitest projects. The `src/domain/` layer alone contains pure functions for evidence hashing, canonical JSON serialization, and residual-unknown tracking — all with zero external runtime dependencies beyond Zod schemas (Source: `doc/zhihu/rea/architecture-overview.md`).

<figure class="chart-img" style="margin:2.5rem 0;text-align:center;padding:1.5rem 0"><img src="/posts/inside-rea-source/charts/chart-1-hexagonal-architecture.svg" alt="Hexagonal architecture diagram showing Domain, Application, Composition, and Adapters layers" loading="lazy" style="max-width:100%;height:auto"></figure>

## How Does REA's Hexagonal Architecture Work?

The architecture follows a strict inward dependency flow: Adapters → Composition → Application → Domain. The Domain layer (`src/domain/`) contains pure business logic — Evidence models, error algebra, analysis profiles, and artifact graphs — with zero imports from Node.js-specific modules or third-party libraries except Zod. This makes the core testable in isolation.

The Application layer (`src/application/`) orchestrates sessions through `BinarySession.ts` and `DirectAnalysis.ts`. The Composition layer (`src/composition/`) acts as the composition root, wiring up providers via `binary.ts` and `directAnalysis.ts`. Two adapters — CLI (`src/cli.ts`) and MCP (`src/main.ts`) — share the same composition root, ensuring identical behavior whether you invoke REA from a terminal or an AI agent.

<!-- [PERSONAL EXPERIENCE] -->
What stands out is how cleanly the CLI and MCP paths converge. Both call `snapshotEnvironment()` at entry, then `parseConfig()`, then either `createDirectAnalysis()` or `createBinarySession()`. The CLI gets a stateless one-shot session; MCP gets a persistent `BinarySession` that survives across tool calls. But the provider selection logic, evidence semantics, and error handling are shared code paths — not duplicated.

> **Citation Capsule:** REA's composition root connects two entry points through shared factories: `createBinarySession()` for MCP's long-lived process and `createDirectAnalysis()` for CLI's one-shot execution. Both consume the same `parseConfig()` configuration parser and the same provider registry, guaranteeing that a Ghidra analysis produces identical Evidence whether triggered by `rea ghidra <target>` or by an MCP `open_binary` tool call (Source: `src/composition/binary.ts`, `src/composition/directAnalysis.ts`).

## How Does the Provider System Enable Pluggable Analysis?

Providers implement the `AnalysisProvider` interface defined in `src/application/AnalysisProvider.ts`. Each provider exposes an `identity()`, a `capabilities()` descriptor list, and a `createClient()` method that returns a bound `AnalysisClient`. The `AnalysisProviderRegistry` sorts candidates by ID and runs deterministic selection — registration order never affects which engine gets picked.

When `selector` is set to `"auto"`, the registry evaluates all candidates in parallel, checking availability and target support before resolving an analysis profile. If exactly one provider passes, it wins. If multiple pass, the system returns an ambiguity error rather than guessing. This fail-closed behavior prevents silent misattribution of analysis results.

The `CompositeProvider` (`src/application/binary/CompositeProvider.ts`) adds a fallback layer: when no deep analysis engine binds to a target, auxiliary providers — Android, Go, WASM, EVM, SQLite — still deliver value. Each operation routes to the correct sub-provider by name, and clients are created lazily on first use.

![Architecture diagram](/posts/inside-rea-source/images/architecture-diagram.jpg)

> **Citation Capsule:** Three deep providers — Hopper, Ghidra, and IDA — implement the `AnalysisProvider` interface with distinct transport mechanisms: Hopper uses a Python bridge over Unix socket (`bridge/hopper_bridge.py`), Ghidra uses a Java HeadlessScript (`bridge/ghidra/ReaGhidraBridge.java`, 3,956 lines), and IDA uses an external MCP server. Despite these differences, all three produce Evidence records with the same schema (Source: `doc/zhihu/rea/provider-and-bridge.md`).

## What Makes REA's Evidence System Different?

Traditional reverse engineering tools produce session-scoped output that vanishes when the GUI closes. REA's Evidence v2 system (`src/domain/evidence.ts`) treats every observation as a first-class, immutable record. Each Evidence record includes a semantic hash, a confidence level, an authority ranking, and an optional `analysis_profile` link that binds it to a specific provider version and parameter set.

The `ResidualUnknown` system (`src/domain/residualUnknown.ts`) goes further by modeling what the analysis *didn't* find. Each unknown gets a stable identifier (`unk_{sha256}`), a revision chain with optimistic concurrency control, and a dependency graph validated for cycles. When an analyst marks an unknown as resolved, the system requires evidence meeting the declared authority and confidence thresholds.

EvidenceBundles (`src/domain/evidenceBundle.ts`) seal these records into immutable, canonically ordered collections. `freezeJsonSnapshot()` deep-freezes every nested object, and a WeakMap authenticates that no tampering occurred. The `serializeEvidenceBundle()` function outputs RFC 8785 canonical JSON, making bundles portable across sessions and tools.

<!-- [ORIGINAL DATA] -->
The numbers tell the story: 128 unique tool contracts, 70+ MCP tools across 6 categories, and 27 distinct error types in the `AnalysisError` hierarchy (`src/domain/analysisErrorCore.ts`). Every error carries diagnostics, captured output, cleanup status, and partial observations — so even a failed analysis contributes verified facts to the evidence graph.

> **Citation Capsule:** REA's Evidence system uses three confidence levels (observed, derived, inferred) and five authority levels (shipped-artifact, controlled-replay, historical-reference, external-service, analyst-inference). Evidence IDs are computed as `ev_{sha256}` over a semantic projection that excludes display-only fields like `subject.name`, ensuring that two providers returning identical analysis content produce the same evidence ID (Source: `src/domain/evidence.ts`).

<figure class="chart-img" style="margin:2.5rem 0;text-align:center;padding:1.5rem 0"><img src="/posts/inside-rea-source/charts/chart-2-provider-selection.svg" alt="Provider selection flowchart showing auto-selection strategy" loading="lazy" style="max-width:100%;height:auto"></figure>

## How Does the Bridge Layer Connect to External Tools?

Bridges translate between REA's JSON-RPC protocol and each engine's native API. The common pattern is: REA spawns a bridge process, passes a session descriptor over a secure channel, and the bridge proxies method calls to the engine. Authentication uses constant-time token comparison — `MessageDigest.isEqual` in Java (`ReaGhidraBridge.java` line 3862) and `hmac.compare_digest` in Python (`hopper_bridge.py` line 1043).

The Ghidra bridge runs as a 3,956-line Java `HeadlessScript` inside Ghidra's own process. It reads a JSON descriptor containing the transport mode, endpoint path, auth token, target SHA-256, and analysis extensions. On POSIX systems, the descriptor file is deleted immediately after reading (consume-and-delete). On Windows, it persists with a protected DACL until the bridge closes.

The Hopper bridge uses lazy API resolution — the `_api()` function in `hopper_bridge.py` only touches Hopper globals when first called, so the module imports cleanly outside the Hopper runtime. It implements two-level caching: a search inventory cache for address-sorted procedure and string tables, and a pseudocode cache that reuses decompilation results across repeated projections.

![Bridge protocol](/posts/inside-rea-source/images/bridge-protocol.jpg)

> **Citation Capsule:** Every REA bridge authenticates requests using constant-time comparison and a bearer token delivered through a secure session descriptor. The Ghidra bridge supports both Unix domain sockets (POSIX, `0600` permissions) and loopback TCP (Windows), while the Hopper bridge uses a single-client Unix socket with `server.listen(1)` to prevent concurrent connections (Source: `doc/zhihu/rea/security-and-patterns.md`).

## How Do 128 Tool Contracts Create a Unified Abstraction?

Tool contracts live in `src/contracts/` and define the name, input schema, output schema, and effect declarations for each of REA's 128 tools. They fall into three layers: official tools (`officialToolContracts.ts`) are thin proxies mapping one-to-one to provider operations; enhanced tools (`enhancedToolContracts.ts`) compose multiple operations into workflows like `batch_decompile` and `get_call_graph`; session tools (`sessionToolContracts.ts`) manage long-lived analysis state and evidence lifecycle.

The contract system enforces read-only semantics by default. Only contracts that explicitly declare `returnsTargetContent` add the `_meta.provenance.untrusted_content` marker to their output, signaling to AI agents that the content originates from the analysis target and should be treated as data, not instructions.

The `EvidenceMcpServer` (`src/server/EvidenceMcpServer.ts`) extends the MCP SDK's `McpServer` with two critical overrides: `registerTool()` compresses advertised input schemas to fit within response budgets, and `connect()` wraps the transport in an `ErrorEvidenceTransport` that intercepts oversized error responses, stores them in the evidence ledger, and returns a compact error with an evidence reference.

> **Citation Capsule:** REA registers 70+ MCP tools across 15+ domain-specific modules (`registerOfficialTools.ts`, `registerAndroidTools.ts`, `registerFridaTools.ts`, etc.), all sharing 128 underlying tool contracts. Each contract declares its effect profile — `mutatesArtifact`, `launchesProcess`, `mayAccessNetwork` — letting the composition root enforce capability-based access control before any provider process starts (Source: `src/contracts/toolContracts.ts`).

<figure class="chart-img" style="margin:2.5rem 0;text-align:center;padding:1.5rem 0"><img src="/posts/inside-rea-source/charts/chart-3-evidence-lifecycle.svg" alt="Evidence lifecycle diagram showing creation, sealing, and bundling" loading="lazy" style="max-width:100%;height:auto"></figure>

## How Does REA Implement Fail-Closed Security?

Fail-Closed means the system defaults to denial when verification fails. In REA's process cleanup (`src/process/ProcessOwnership.ts`), each provider process is injected with a unique `REA_PROCESS_RUN_ID` at spawn. Before killing any process, the system verifies the run token via constant-time comparison. If the token is unreadable and the process is still alive, cleanup is refused — the system will not risk killing a PID that the OS has recycled for an unrelated process.

The same principle applies at every layer. Windows batch command quoting (`src/process/WindowsBatchCommand.ts`) rejects arguments containing cmd.exe metacharacters rather than attempting to escape them. The `PrivateRuntimeRoot` (`src/process/PrivateRuntimeRoot.ts`) creates temp directories with `mkdtemp` (POSIX) or native DACL (Windows), and if Windows native capabilities are unavailable, it throws `PrivateRuntimeRootUnavailableError` instead of falling back to an insecure path.

Prompt injection defense adds another layer: every tool result that carries target-derived content gets the `_meta.provenance.untrusted_content: true` marker (`src/server/toolResultEncoding.ts`). AI agents consuming MCP responses can distinguish between REA's instructions and potentially malicious content embedded in decompiled pseudocode or string tables.

> **Citation Capsule:** REA's security model spans four layers: (1) process ownership via `REA_PROCESS_RUN_ID` tokens with PID-reuse protection, (2) constant-time bridge authentication, (3) Zod schema validation at every boundary, and (4) untrusted-content marking for all target-derived output. The `ToolResultDelivery` system enforces a byte budget on MCP responses, storing oversized results in the evidence ledger rather than dropping them (Source: `doc/zhihu/rea/security-and-patterns.md`).

## Frequently Asked Questions

### Does REA work without Ghidra or IDA installed?

Yes. REA's `CompositeProvider` combines auxiliary providers — Android (JADX), Go, WASM (WABT), EVM (EVMole), SQLite, and more — when no deep analysis engine binds to the target. You can analyze APKs, WebAssembly modules, or EVM bytecode without ever installing Ghidra, Hopper, or IDA. The provider selection system degrades gracefully rather than failing.

### What evidence does REA provide for AI-generated conclusions?

Every analysis operation produces an Evidence record with a semantic hash, confidence level (observed, derived, inferred), authority ranking, and links to the provider profile that generated it. These records are immutable once created and bundled into EvidenceBundles that can be exported, shared, and audited. An AI agent's conclusion is only as strong as the evidence chain backing it.

### How does REA prevent prompt injection from malicious binaries?

Results that carry target-derived content — decompiled code, string tables, network captures — are marked with `_meta.provenance.untrusted_content: true`. This marker is set in `src/server/toolResultEncoding.ts` and propagates through the MCP response. AI agents and hooks can read this marker to treat the content as data, never as instructions, neutralizing embedded prompt injection attempts.

### Can I use REA from both CLI and AI agents simultaneously?

Yes. The CLI adapter (`src/cli.ts`) and MCP adapter (`src/main.ts`) share the same composition root, provider registry, and evidence semantics. You can run `rea binary_overview <target>` in a terminal while an MCP-connected agent performs `batch_decompile` on the same file. Both paths produce identical Evidence records through the same code paths.

### What happens when a provider process crashes mid-analysis?

REA's error system (`src/domain/analysisErrorCore.ts`) defines 27 tagged error types, each carrying diagnostics, captured process output, cleanup status, and partial observations. When a provider crashes, the system retains all evidence collected before the failure and records the crash as a `ProviderCleanupError` with the partial observation attached. The evidence graph stays consistent — no orphaned claims.

## Conclusion

REA's architecture proves that unifying competing reverse engineering engines is possible without building a new decompiler. The key decisions are: abstract at the evidence level, not the engine level; make every observation immutable and semantically hashed; track unknowns as first-class citizens; and enforce Fail-Closed security at every boundary. The 128 tool contracts and 70+ MCP tools are the user-facing expression of those decisions, but the real innovation lives in `src/domain/evidence.ts` and the provider registry. If you're building AI-native tools for any specialized domain, REA's source is a masterclass in how to make every conclusion verifiable.

## Sources

- GitHub, morluto/rea, retrieved 2026-10-13, https://github.com/morluto/rea
- REA Official Website, retrieved 2026-10-13, https://rea.tools/
- Zhihu, "REA: When Agent Learns Reverse Engineering", retrieved 2026-10-13, https://zhuanlan.zhihu.com/p/2092932306054993395
