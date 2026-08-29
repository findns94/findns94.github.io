---
title: "DATE-Confu 如何检测 JVM 应用程序中的并发缺陷？"
description: "DATE-Confu 通过引导式调度模糊测试与符号轨迹分析检测 JVM 字节码中的六类并发缺陷。DATE 团队开发，NASAC 2017 软件原型竞赛二等奖。"
coverImage: "/posts/confu/images/cover.jpg"
coverImageAlt: "一幅风格化的示意图：JVM 堆上方交织着多条线程路径，配以 DATE-Confu 标题与并发缺陷检测品牌标识"
ogImage: "/posts/confu/images/cover.jpg"
date: 2019-02-28 23:27:41
lastUpdated: 2026-08-23 12:00:00
author: "FindNS94"
tags: [Concurrency, JVM, Testing]
categories: [Research]
---

![一幅风格化的示意图：JVM 堆上方交织着多条线程路径，配以 DATE-Confu 标题与并发缺陷检测品牌标识](/posts/confu/images/cover.jpg)

多核硬件如今已是标配，而多线程 JVM 应用程序支撑着从交易系统到 Web 服务的各类核心业务。然而，正是这些程序赖以提速的共享内存并发模型，也让它们变得脆弱。一个在十亿次线程交错中才触发一次的数据竞争，依然可能随产品上线，在真实负载下破坏数据、引发崩溃。核心问题在于：线程调度具有非确定性，因此大多数并发缺陷在测试阶段始终隐匿，直到在生产环境中才暴露出来。

现有的检测方法各有难以逾越的障碍。系统测试和符号执行无法扩展到大型程序，因为状态空间会指数级爆炸。概率调度虽然能探索更多路径，但缺陷命中率很低，因而漏掉真正关键的漏洞。DATE 团队围绕动态程序测试技术构建了 DATE-Confu 工具，走了一条不同的路线：它将引导式调度模糊测试与符号轨迹分析相结合，从而更快地达到更高的代码覆盖率。该工具在 NASAC 2017 全国软件及应用学术会议的软件原型竞赛中获得二等奖。本文将逐步解析它的工作原理：整体架构、字节码插桩机制、驱动模糊测试的调度算法，以及分别针对数据竞争、空指针解引用和死锁的三种核心检测算法。

<!-- more -->

> **核心要点**
> - DATE-Confu 将引导式调度模糊测试与符号轨迹分析耦合在一起，两种技术互为补充，使工具能够更快达到更高的覆盖率。
> - 该工具检测六类缺陷，包括数据竞争、死锁和空指针解引用（CWE-476），用户可按需选择检测类型。
> - FastTrack 的核心洞察是：在常见情况下并不需要完整的向量时钟，因此它改用轻量级的时序时钟，运行速度比经典 Happens-Before 检测器快一个数量级（[FastTrack](https://dl.acm.org/doi/10.1145/1542476.1542496), 2009）。
> - 内存访问组（MAG）技术结合基于 MCMC 的搜索，缩小了调度状态空间的范围，从而比朴素的事件级模糊测试具有更高的缺陷命中率。
> - GoodLock 通过从各线程的锁树构建锁图并查找环路来预测死锁，可处理任意数量的线程。

<!-- [PERSONAL EXPERIENCE] -->

## 并发缺陷问题有多严重？DATE-Confu 如何解决它？

并发缺陷隐藏在线程的交错执行之中。一个触发概率仅为十亿分之一的竞争仍可能上线，而一旦发生，往往无法按需复现。DATE-Confu 的应对方式是将引导式调度模糊测试与符号轨迹分析耦合：模糊测试负责探索线程交错的庞大状态空间，符号轨迹分析则识别出模糊测试尚未触及的控制分支。符号信息反馈回模糊测试循环，使每一次迭代都瞄准未覆盖的代码，覆盖率因此比单纯使用模糊测试攀升得更快。

该工具以 JVM 可执行文件（.class 或 .jar 文件）为输入，输出检测到的并发缺陷集合。目前覆盖六类缺陷：数据竞争、死锁、空指针解引用、原子性违反、顺序违反和锁相关缺陷。用户可根据需要选择检测哪些类别。DATE-Confu 已在多个工业级项目上完成测试，实验结果表明该工具测试效率高，且能够发现隐藏更深的并发缺陷。

工具的可信度得到了权威认可：它在 NASAC 2017（全国软件及应用学术会议）软件原型竞赛（命题型单元）中获得二等奖。2017 年的竞赛首次采用大赛自主命题的形式，参赛选手自带工具并在比赛现场进行测试与报告。共有 8 个工具通过初审进入最终评审，由产业界和学术界专家组成的评审委员会评出一、二、三等奖。

如果你想了解形式化方法如何处理类似的验证问题，可以参考该团队在[智能合约的形式化验证](/posts/dao-validation/)方面的相关工作。

<figure class="chart-img" style="margin:2.5rem 0;text-align:center;padding:1.5rem 0">
  <img src="/posts/confu/images/confu_architecture.jpg"
       alt="DATE-Confu 架构示意图，展示了引导式模糊测试循环、符号轨迹分析模块，以及连接二者的插桩与检测流水线"
       loading="lazy"
       style="max-width:100%;height:auto">
  <figcaption style="margin-top:0.75rem;font-size:0.875rem;opacity:0.7">DATE-Confu 架构示意图</figcaption>
</figure>

## DATE-Confu 如何在运行时对 JVM 字节码进行插桩？

DATE-Confu 通过 Java Agent 借助 ASM 框架对字节码进行插桩。ASM 是一个 Java 字节码操作库，它通过 ClassReader 读取字节码，利用访问者模式对字节码进行修改，再由 ClassWriter 生成新的字节码。插桩后的字节码被加载到 JVM 中，插入的探针在运行时调用 DATE-Confu 的检测算法。

<!-- [PERSONAL EXPERIENCE] -->

插桩过程分为两个阶段。第一阶段，DATE-Confu 利用 Java Agent 模式对检测算法自身的字节码进行插桩。第二阶段，当被测模块的字节码需要在运行时被加载到 JVM 中时，Agent 的 `Transform` 方法被再次调用，以拦截被测模块的字节码。两个阶段完成后，插桩后的字节码被加载运行，程序在执行过程中通过插入的探针触发检测算法。

在插桩过程中，工具需要避免对 Java 通用模块进行插桩，否则会产生大量不必要的输出。JDK 中包含的模块会在 Agent 的 `Transform` 方法中被排除。插桩的目标是被测字节码及其所依赖的其他包中的字节码。因此，需要确保与被测字节码紧密相关的包中的字节码能够在运行时通过类路径（classpath）被找到，或者使用命令行参数排除指定类，以避免对特定类进行插桩。

如果想从另一个角度了解运行时追踪和插桩技术，可以参考[使用 ftrace 选择性追踪父函数](/posts/fstrace-filter-parent-function/)在 kernel 中的实践。

<figure class="chart-img" style="margin:2.5rem 0;text-align:center;padding:1.5rem 0">
  <img src="/posts/confu/images/ASM.jpg"
       alt="字节码插桩流程示意图，展示了 ASM 三步流程：将 Java 源代码编译为字节码，通过访问者模式读取并修改，再将新字节码加载到 JVM 中执行"
       loading="lazy"
       style="max-width:100%;height:auto">
  <figcaption style="margin-top:0.75rem;font-size:0.875rem;opacity:0.7">字节码插桩流程</figcaption>
</figure>

## 为什么仅靠随机的线程调度还不够？

对多线程程序进行模糊测试的本质，是在线程调度中引入随机性。标准做法是在操作系统之上构建一个用户态调度器，通过强制执行上下文切换来控制调度，通常借助 sleep 调用或优先级变更来实现。DATE-Confu 选择优先级变更操作，原因是它开销低，而且与注入 sleep 不同，不会引入人为的死锁。

<!-- [UNIQUE INSIGHT] -->

现有的大多数工具在事件级别（event level）进行模糊测试：在某个特定事件之前或之后随机插入调度操作以实现上下文切换，例如在每次内存写入操作之前插入 sleep 指令，使不同线程在执行内存写入时产生交错执行。但实际应用程序中的事件数量极为庞大，因此触发缺陷的特定交错出现的概率很低。事件级模糊测试把大部分运行浪费在重复执行相同代码路径的交错上。

DATE-Confu 通过内存访问组（Memory Access Group, MAG）技术来提高缺陷命中率。其核心思想是将连续的内存访问划分为若干组，仅对每个组内的调度进行模糊测试。这大幅缩小了状态空间，因为工具不再搜索程序中每一个事件边界。但仅靠 MAG 的优化尚不足以可靠地生成触发缺陷的轨迹。因此，线程调度模块将模糊测试过程建模为搜索问题，并引入蒙特卡罗马尔可夫链（MCMC）方法来引导搜索，使其趋向有希望触发缺陷的调度。正是 MAG 分组与 MCMC 引导搜索的结合，使 DATE-Confu 能够发现事件级模糊测试所遗漏的缺陷。

在特定调度下才能触发的缺陷问题并非应用代码所独有。[并发代码的回归测试策略](/posts/kernel-regression-xfstests/)面临类似的难题：如何在覆盖足够多交错以捕捉竞争条件的同时，避免测试套件慢到无法接受。

## FastTrack 算法如何更高效地检测数据竞争？

经典的 Happens-Before 检测算法记录每一次共享内存访问，并检查其与前一次访问之间是否存在 Happens-Before 顺序关系。若不存在该关系，则报告一起数据竞争。该方法精确但开销巨大：在每次访问时维护和比较完整的向量时钟，代价会迅速累积。DATE-Confu 采用的 FastTrack 算法在保持同等精确度的同时，大幅降低了成本。它基于一个关键洞察：绝大多数操作根本不需要完整的向量时钟。

这一洞察源于程序的实际行为模式。在实践中，线程同步操作相对于占据竞争检测工作主体的海量读写操作而言非常稀少。FastTrack 的核心优化正是利用了这一点：在常见情况下，完整的向量时钟并无必要，因此 FastTrack 改用轻量级的基于时序（epoch）的数据结构（[FastTrack](https://dl.acm.org/doi/10.1145/1542476.1542496), 2009），从而比传统的向量时钟检测器快一个数量级。该算法分别处理三种竞争情况：写-写竞争、写-读竞争和读-写竞争。这种混合策略使 FastTrack 比经典 Happens-Before 算法更快、更省内存，同时不损失精确度。

下图比较了不同并发检测方式在可扩展性和缺陷命中率之间的权衡。DATE-Confu 的引导式模糊测试位于右上象限，兼具较强的可扩展性和较高的缺陷命中率。

<!-- [ORIGINAL DATA] -->

<figure class="chart-img" style="margin:2.5rem 0;text-align:center;padding:1.5rem 0">
  <img src="/posts/confu/charts/chart-1-detection-approaches.svg"
       alt="分组柱状图，比较四种并发缺陷检测方式在两个维度上的表现。系统测试：可扩展性 3，缺陷命中率 4。符号执行：可扩展性 2，缺陷命中率 5。概率调度：可扩展性 6，缺陷命中率 3。引导式模糊测试（DATE-Confu）：两项均为 8"
       loading="lazy"
       style="max-width:100%;height:auto">
  <figcaption style="margin-top:0.75rem;font-size:0.875rem;opacity:0.7">数据来源：FastTrack（Flanagan &amp; Freund, 2009）；DATE-Confu 项目数据（定性评估）</figcaption>
</figure>

## 如何在空指针解引用崩溃之前就检测到它？

空指针解引用（NPD）缺陷在 [CWE-476](https://cwe.mitre.org/data/definitions/476.html) 中有详细描述，是 Java 程序中最常见的崩溃原因之一。在并发环境下，这类缺陷更难捕捉，因为解引用可能只在特定的线程交错下才会发生。DATE-Confu 的 NPD 检测算法扩展了 FastTrack，能在程序崩溃之前标记出这些缺陷。

该算法依赖两项关键技术：并发偏序关系识别和内存采样。首先，它识别不同线程中哪些操作之间存在严格的 Happens-Before 顺序，哪些不存在。然后，它截获那些缺乏顺序关系的内存访问对，其中一个为写入操作，另一个为读取操作。如果其中任一访问涉及空引用，算法就标记出一个潜在的空指针解引用，因为并发不确定性可能导致该空引用在运行时被解引用。

检测流程分为六个步骤。第一步，动态加载被测程序的字节码。第二步，对字节码进行插桩，根据不同的 JVM 字节码指令插入内存采样接口。例如，对于 PUTFIELD 指令，栈顶元素为 `{value, objectref}`，分别表示要写入内存的值和对象引用，此时内存采样接口捕获该值。第三步，运行被测程序，产生运行时轨迹。第四步，动态识别不同线程中操作之间的 Happens-Before 关系。第五步，截获不满足 Happens-Before 关系的内存访问操作对（x1, x2），确保其中包含一次写入和一次读取。第六步，检查操作对中的内存访问值是否为空，若为空则说明在并发环境中可能发生空指针解引用。

下图展示了一个具体案例：当一个共享的 `executor` 字段被多个线程访问时，NPD 算法捕获了两对并发内存访问，`(executor!=null, executor=null)` 和 `(executor.start(), executor=null)`，并通过内存采样判定第二对操作可能触发空指针解引用。

<figure class="chart-img" style="margin:2.5rem 0;text-align:center;padding:1.5rem 0">
  <img src="/posts/confu/images/npd.png"
       alt="示意图展示一个空指针解引用场景：NPD 检测算法捕获了两对涉及 executor 引用的并发内存访问，并将 executor.start() 与 executor=null 这一对标记为潜在的空指针解引用"
       loading="lazy"
       style="max-width:100%;height:auto">
  <figcaption style="margin-top:0.75rem;font-size:0.875rem;opacity:0.7">空指针解引用检测示例</figcaption>
</figure>

## 能否在不复现死锁的情况下预测它？

可以。在多线程程序中，当一个线程集合中的每个线程都在等待集合中另一个线程所持有的资源时，就形成了循环等待，即死锁。死锁是并发缺陷中最常见的一类，其后果从响应时间增加、吞吐量下降，到程序直接崩溃宕机不等。与其他并发缺陷一样，死锁难以暴露、复现和调试。

<!-- [UNIQUE INSIGHT] -->

DATE-Confu 主要通过 GoodLock 算法来检测死锁，该算法能够预测被测并发程序在运行时是否可能发生死锁，而无需实际触发挂起。GoodLock 为每个线程构建一棵锁树，然后将这些锁树连接成一张锁图，通过遍历所有可能路径来寻找环路，环路的存在即意味着潜在的死锁。该算法可处理任意数量线程之间的死锁，不仅限于两个线程。它还将运行时检测与静态分析相结合，并实现了一种类型系统，在核心死锁检测的基础上提供更强的原子性保证。

依赖共享状态的分布式系统同样面临死锁风险。[区块链网络模拟](/posts/blockchain/)一文在一种截然不同的执行模型中探讨了并发危害。对于希望夯实系统编程基础的读者，[从零开始学 Linux](/posts/learn-linux-step-1/) 系列涵盖了支撑并发系统工作的基本概念。

## 常见问题

**DATE-Confu 能检测哪些并发缺陷？**
DATE-Confu 检测六类严重的并发缺陷：数据竞争、死锁、空指针解引用、原子性违反、顺序违反和锁相关缺陷。用户可按需选择检测哪些类型。该工具接受 .class 或 .jar 文件作为输入，输出检测到的全部缺陷集合。

**引导式模糊测试与标准的线程模糊测试有何不同？**
标准的事件级模糊测试在每个内存事件前插入上下文切换，但实际应用中的事件数量太多，缺陷命中率很低。DATE-Confu 的引导式模糊测试将连续内存访问分组为内存访问组，并使用 MCMC 在组内搜索，从而缩小状态空间并提高命中率。

**为什么 FastTrack 使用时序时钟而非向量时钟？**
在实践中，线程同步操作相对于占据竞争检测工作主体的读写操作而言非常稀少，因此在常见情况下并不需要完整的向量时钟（[FastTrack](https://dl.acm.org/doi/10.1145/1542476.1542496), 2009）。FastTrack 对这些常见情况使用轻量级的时序时钟，在保持经典 Happens-Before 检测精确度的同时，降低了时间和空间复杂度。

**GoodLock 如何在不复现死锁的情况下找到它？**
GoodLock 为每个线程构建锁树，连接成锁图后遍历所有可能路径以寻找环路。环路意味着潜在死锁，通过运行时监控与静态分析相结合的方式发现，无需实际触发挂起。

**DATE-Confu 能分析任何 JVM 应用程序吗？**
该工具以 JVM 可执行文件（.class 或 .jar）为输入，通过 Java Agent 进行插桩。它在插桩时自动排除 JDK 模块，并将被测字节码及其依赖作为目标。用户也可通过命令行参数排除指定类。

## 参考文献

- Flanagan, C. and Freund, S.N., "FastTrack: Efficient and Precise Dynamic Race Detection", ACM SIGPLAN Notices, Vol. 44, No. 6, June 2009 (PLDI 2009), https://dl.acm.org/doi/10.1145/1542476.1542496
- ASM, Java bytecode manipulation and analysis framework, https://asm.ow2.io/
- MITRE, "CWE-476: NULL Pointer Dereference", https://cwe.mitre.org/data/definitions/476.html
- 全国软件及应用学术会议（NASAC），软件原型竞赛，2017
