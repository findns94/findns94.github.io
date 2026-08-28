---
title: "如何学习Linux内核：面向软件工程师的子系统概览"
description: "Linux内核7.2版本的源代码约3000万行，分布在66个顶级目录中。本文以代码引用和学习路径为线索，梳理六大核心子系统——中断、调度器、内存、I/O、网络、驱动程序。"
coverImage: "/posts/learn-linux-step-1/images/cover.jpg"
coverImageAlt: "昏暗的服务器机房中成排的机架式设备与闪烁的状态LED灯，代表Linux内核基础设施"
ogImage: "/posts/learn-linux-step-1/images/cover.jpg"
date: 2021-12-05 20:22:30
lastUpdated: 2026-08-23 10:00:00
author: "FindNS94"
tags: [Linux, Kernel, Open Source]
---

![昏暗的服务器机房中成排的机架式设备与闪烁的状态LED灯，代表Linux内核基础设施](/posts/learn-linux-step-1/images/cover.jpg)

# 如何学习Linux内核：面向软件工程师的子系统概览

Linux内核是历史上最大的开源项目之一——7.2版本约3000万行代码，分布在68个顶级目录中（[GitHub torvalds/linux](https://github.com/torvalds/linux)）。对软件工程师而言，挑战不在于找不到资料，而在于不知从何下手。内核的六大核心子系统——中断、调度器、内存、I/O、网络、驱动程序——各自构成了一个独立的世界，拥有专属的数据结构、算法和源文件。

本文从学习者的视角出发，为这些子系统画一张地图。与其自底向上地通读源码（这很容易让人中途放弃），不如通过内核的诊断与可观测性工具来观察——这和生产环境中工程师调试系统的方法完全一致。每一节都先给出核心思想，再指出值得优先阅读的源文件。

<!-- [UNIQUE INSIGHT] 以可观测性为切入点学习内核：不必按任意顺序逐个子系统阅读，而是沿着测量工具（ftrace、perf、eBPF、/proc）的功能切分来发现哪些子系统对真实工作负载至关重要。每个工具的功能切片都对应一个内核子系统——学会工具的同时，也就学会了子系统。 -->

> **核心要点**
> - Linux内核有六大核心子系统：中断、调度器、内存、I/O、网络、驱动程序。每个子系统对应`doc/linux/`下的一组源目录，可以自上而下地阅读。
> - 调度器从CFS（内核2.6.23）演进到EEVDF（内核6.6）——理解两者，才能理解Linux如今如何处理交互式与批处理工作负载。
> - 内存管理分为三层：物理层（伙伴分配器+slab）、虚拟层（多级页表+按需分页）和回收层（kswapd+OOM killer）。
> - VFS→块设备层→设备驱动是I/O路径；sk_buff→NAPI→netfilter→XDP是网络路径。两者都遵循分层设计，可以在源码中逐层追踪。
> - 从与你目标匹配的子系统入手：硬件工作选驱动程序，分布式系统选网络，性能调优选内存。

---

## Linux内核是如何组织的？

内核源码按子系统划分，顶层目录的布局反映了整个架构。六大核心区域——`kernel/`、`mm/`、`fs/`、`net/`、`drivers/`、`arch/`——占据了代码的绝大部分。理解这张地图，是在源码中不迷路的第一个关键。

```
┌─────────────────────────────────────────────────────────────────────┐
│                         Linux 内核                                  │
│                                                                     │
│  ┌──────────┐  ┌──────────┐  ┌──────────┐  ┌──────────┐           │
│  │ kernel/  │  │   mm/    │  │   fs/    │  │   net/   │           │
│  │ 调度器   │  │ 内存管理 │  │ VFS      │  │ 协议栈   │           │
│  │ 中断     │  │          │  │ 文件系统 │  │ 套接字   │           │
│  │ 时间     │  │          │  │ 块层     │  │          │           │
│  └────┬─────┘  └────┬─────┘  └────┬─────┘  └────┬─────┘           │
│       │              │              │              │                 │
│  ┌────┴──────────────┴──────────────┴──────────────┴────┐          │
│  │                    drivers/                           │          │
│  │   字符设备   │   块设备   │   网络设备                    │          │
│  └───────────────────────────────────────────────────────┘          │
│                                                                     │
│  ┌──────────┐  ┌──────────┐  ┌──────────┐                         │
│  │  arch/   │  │ include/ │  │ lib/     │                         │
│  │ x86 arm  │  │ 头文件   │  │ 公共     │                         │
│  │ riscv    │  │          │  │ 辅助函数 │                         │
│  └──────────┘  └──────────┘  └──────────┘                         │
└─────────────────────────────────────────────────────────────────────┘
```

`kernel/`目录包含调度器、中断处理和时间管理。`mm/`负责物理和虚拟内存。`fs/`包含VFS层、各个文件系统和块层。`net/`实现协议栈。`drivers/`是最大的目录——所有设备驱动都在这里。`include/`存放跨子系统共享的核心数据结构定义。

一个实操性的起点：参考我们的[如何从源码编译Linux内核](/posts/compile-ubuntu-kernel-source-6.8.0-90.91/)指南——亲手编译内核能让源码树变得具体可触。

![Linux内核地图，展示主要子系统之间的关系——可观测性工具与内核功能的对应](/posts/learn-linux-step-1/images/LKM.svg)

---

## 中断在Linux内核中是如何工作的？

硬件中断是设备向内核发出"需要关注"信号的方式。Linux把中断处理分成两半：**上半部**（硬中断）在中断关闭状态下运行，只做最少的工作；然后**下半部**（软中断/tasklet/workqueue）在中断重新开启后完成剩余部分。这种设计保证了系统在高负载下的响应性。

```
┌──────────────┐     ┌──────────────────┐     ┌─────────────────────┐
│ 硬件         │     │   上半部         │     │   下半部            │
│ 设备         │     │   (硬中断)       │     │   (软中断/          │
│              │     │                  │     │    tasklet/         │
│  IRQ 信号    │────►│  • 应答设备      │────►│    workqueue)       │
│              │     │  • 记录状态      │     │                     │
│              │     │  • 触发软中断    │     │  • 处理数据         │
│              │     │  • 快速返回      │     │  • 通知用户空间     │
└──────────────┘     └──────────────────┘     └─────────────────────┘
      │                     │                          │
      │              中断关闭                    中断开启
      │              原子上下文                  可睡眠(wq)
```

**硬中断**由外设通过中断控制器触发。中断号来自控制器（如x86上的APIC）。硬中断是可屏蔽的——CPU可以临时禁用它们。硬中断可以嵌套：高优先级中断可以抢占低优先级中断。

**软中断**由执行`INT`指令产生（软件触发）。中断号直接在指令中指定——不需要控制器。软中断不可屏蔽，也不能嵌套。

下半部机制在上下文和能力上有所不同：
- **Tasklet** — 在软中断上下文中、由调度它的同一CPU执行。不可睡眠。速度快。
- **Workqueue** — 在进程上下文（内核线程）中运行。可以睡眠。用于延迟工作可能阻塞的场景。
- **Threaded IRQ** — 每个IRQ对应一个专用内核线程，通过`request_threaded_irq()`注册。让硬中断处理程序保持最简。

<!-- [PERSONAL EXPERIENCE] 我第一次读中断源码时，追踪一个网络数据包从IRQ到socket buffer的全程，是整个子系统突然"咔哒"一声变清晰的那个练习。从`kernel/irq/manage.c`（request_irq）开始，沿着NET_RX_SOFTIRQ路径追进`net/core/dev.c`。 -->

关键源文件：`kernel/irq/`（中断注册与处理）、`kernel/softirq.c`（软中断分发）、`include/linux/interrupt.h`（下半部声明）。

---

## 调度器如何决定下一个运行哪个任务？

调度器从每CPU的运行队列中挑选下一个可运行任务。Linux使用一条**调度类**链——每个类都有机会运行自己的任务，然后再让位给优先级更低的类。优先级链为：**stop → deadline → rt → fair → idle**。大多数任务是`SCHED_NORMAL`，由CFS或EEVDF公平类服务。

```
优先级链（高 ──────────────────────────────────────► 低）

  ┌─────────┐   ┌─────────────┐   ┌──────┐   ┌─────────┐   ┌──────┐
  │  stop   │──►│  deadline   │──►│  rt  │──►│  fair   │──►│ idle │
  │         │   │SCHED_DEADLINE│   │FIFO/RR│   │CFS/EEVDF│   │      │
  └─────────┘   └─────────────┘   └──────┘   └─────────┘   └──────┘
   最高优先级                                          最低优先级

  CFS/EEVDF内部：以vruntime为键的红黑树
  ┌──────────────────────────────────────────────────┐
  │              红黑树 (vruntime)                    │
  │                  [task A: 5]                      │
  │                 /                \                 │
  │         [task B: 3]          [task C: 8]         │
  │           /        \                               │
  │    [task D: 1]  [task E: 4]                       │
  │                                                   │
  │  选取最左侧节点（最小vruntime）→ task D            │
  └──────────────────────────────────────────────────┘
```

**CFS（完全公平调度器）** — 自内核2.6.23起的默认公平类。它模拟一个"理想多任务处理器"，每个可运行任务均分CPU时间。每个任务累积一个**虚拟运行时间**（`vruntime`，定义在`struct sched_entity`中）；`vruntime`最小的任务优先运行。任务以`vruntime`为键保存在**红黑树**中，选取下一个任务和时间片用完后重新插入都是O(log n)。`SCHED_NORMAL`、`SCHED_BATCH`和`SCHED_IDLE`任务都由CFS服务。

**EEVDF（最早合格虚拟截止时间优先）** — 在内核6.6中引入，计划最终取代CFS。每个任务携带一个**虚拟截止时间**；调度器始终运行截止时间最早的任务，比纯公平模型提供更强的延迟保证。使用时间片较少的任务获得更早的截止时间，交互式工作因此得到优先处理，无需单独的启发式机制。

**实时调度器** — `SCHED_FIFO`和`SCHED_RR`是固定优先级类，总是抢占CFS。`SCHED_DEADLINE`使用EDF算法并带有运行时间预算，面向硬实时工作负载。

每CPU运行队列（`struct rq`）保存可运行任务。周期性的**负载均衡**和**空闲均衡**在运行队列之间迁移任务，保持所有核心忙碌。`context_switch()`函数切换页表（`switch_mm`）和CPU寄存器状态（`switch_to`）；调度器时钟滴答（`scheduler_tick`）更新`vruntime`并可能设置`TIF_NEED_RESCHED`。`NO_HZ_IDLE`/`NO_HZ_FULL`在空闲或安静的CPU上停止周期性时钟滴答，以节省功耗并减少抖动。

关键源文件：`kernel/sched/fair.c`（CFS与EEVDF——EEVDF在内核6.6中集成进`fair.c`，`pick_eevdf()`位于第1177行）、`kernel/sched/core.c`（运行队列与类链）、`kernel/sched/sched.h`（struct rq，调度类）。

---

## Linux如何管理内存？

内存管理分为三层：**物理分配**（伙伴分配器分配页组，slab缓存内核对象）、**虚拟内存**（多级页表完成虚拟到物理的转换，按需分页处理缺页）和**回收**（kswapd回收页面，OOM killer是最后手段）。

```
物理内存                                  虚拟内存
┌─────────────────────┐                 ┌─────────────────────┐
│     NUMA 节点       │                 │   进程地址空间      │
│  ┌───────────────┐  │                 │                     │
│  │    区（zone）  │  │                 │  ┌───────────────┐  │
│  │ DMA|DMA32|    │  │                 │  │     VMA       │  │
│  │ Normal|HighMem│  │                 │  │ (vm_area_     │  │
│  └───────┬───────┘  │                 │  │  struct)      │  │
│          │          │                 │  └───────┬───────┘  │
│  ┌───────┴───────┐  │                 │          │          │
│  │  伙伴分配器   │  │                 │  ┌───────┴───────┐  │
│  │  (页组分配)   │──┼─── 页 ─────────┼─►│    页表       │  │
│  │               │  │                 │  │  PGD→PUD→    │  │
│  └───────┬───────┘  │                 │  │  PMD→PTE     │  │
│          │          │                 │  └───────┬───────┘  │
│  ┌───────┴───────┐  │                 │          │          │
│  │  slab/slub    │  │                 │  ┌───────┴───────┐  │
│  │ (task_struct, │  │                 │  │   物理页框    │  │
│  │  inode, ...)  │  │                 │  └───────────────┘  │
│  └───────────────┘  │                 └─────────────────────┘
└─────────────────────┘
```

**物理内存**组织为**NUMA节点**（`struct pglist_data`），每个节点分为多个**区**（DMA、DMA32、Normal、HighMem），反映硬件寻址限制。最小单位是**页**（通常4 KiB），由`struct page`跟踪（每个物理页对应一个，保存在`mem_map`中）。**伙伴分配器**分配连续的二的幂次页组，并通过合并空闲伙伴来应对外部碎片。**slab分配器**（默认SLUB）缓存频繁分配的内核对象——`task_struct`、`inode`、`dentry`等——避免重复初始化和伙伴层级的碎片。

**虚拟内存**：每个进程拥有独立的地址空间，由`struct mm_struct`描述；连续的逻辑区域称为**VMA**（`struct vm_area_struct`），各自具有标志位和文件映射。多级**页表**（PGD → PUD → PMD → PTE）完成虚拟地址到物理地址的转换；x86-64和AArch64通常使用4级页表，更大地址空间可支持5级。**按需分页**指首次访问触发缺页异常（`handle_mm_fault`），映射零页、从交换空间读取或映射文件。`kmalloc`返回物理上连续的内存（适合DMA）；`vmalloc`返回虚拟连续的内存，物理上可能不连续。**大页**（2 MiB / 1 GiB）和**透明大页**（THP）可减少大映射的TLB压力。

**回收与OOM**：当可用内存减少时，**kswapd**回收页面缓存和匿名页；**zswap**/**zram**在内存中压缩页面以减少交换I/O。若回收无法释放足够内存，**OOM killer**根据评分机制选择牺牲进程并将其杀死，以维持系统存活。

关键源文件：`mm/page_alloc.c`（伙伴分配器）、`mm/slub.c`（SLUB）、`mm/vmalloc.c`、`mm/vmscan.c`（kswapd）、`mm/oom_kill.c`、`include/linux/mm_types.h`（struct page，struct mm_struct）。

![Linux可观测性工具与内核子系统的对应关系——展示诊断工具如何揭示内核功能](/posts/learn-linux-step-1/images/linux_observability_tools.png)

---

## Linux如何处理I/O、文件系统和网络？

I/O和网络共享一个分层设计：虚拟层向用户空间提供统一接口，块/协议层对请求排队和调度，设备驱动处理硬件。一次`read()`调用要经过VFS→页缓存→块层→驱动——理解这条路径是性能调优的基础。

```
用户read()调用——I/O在内核中的路径
┌──────────┐    ┌──────────┐    ┌──────────┐    ┌──────────┐    ┌──────────┐
│ 应用     │    │   VFS    │    │  页缓存  │    │  块层    │    │  设备    │
│ read(fd) │───►│ sys_read │───►│          │───►│          │───►│  驱动    │
│          │    │          │    │ (命中?)  │    │ bio/blk  │    │ DMA/IRQ  │
│          │    │          │    │          │    │   -mq    │    │          │
└──────────┘    └──────────┘    └────┬─────┘    └──────────┘    └──────────┘
                                     │
                               未命中 │ → 从磁盘读取
                                     ▼
                              ┌──────────────┐
                              │   文件系统    │
                              │ (ext4/xfs)   │
                              └──────────────┘
```

**VFS（虚拟文件系统）**为userspace提供统一的`open`/`read`/`write`/`close`接口，屏蔽底层文件系统的差异。核心对象：`struct superblock`（已挂载文件系统）、`struct inode`（文件元数据）、`struct dentry`（目录项缓存，加速路径查找）和`struct file`（打开的文件实例，包含独立偏移量和`file_operations`）。`file_operations`函数表（`open`、`read`、`write`、`ioctl`、`mmap`、`release`等）是文件系统或设备驱动程序将自身行为注入VFS的方式。

**块层**：文件I/O被转换为**bio**结构（`struct bio`），每个描述一个或多个连续的内存缓冲区段。bio被合并入**请求队列**；**blk-mq**（多队列）框架将提交映射到每CPU或硬件队列，面向现代高速存储。I/O调度器——`mq-deadline`、`kyber`、`bfq`、`none`——对请求重新排序和合并，在吞吐量、延迟和公平性之间取得平衡。**页缓存**保存近期读取的文件页面；脏页面由周期性**回写**（writeback）线程刷新到磁盘。

**内存映射与直接I/O**：`mmap`将文件直接映射到进程地址空间，使读写操作变为内存访问（通过页缓存按需分页）。**直接I/O**（`O_DIRECT`）绕过页缓存，直接通过DMA在用户缓冲区和设备之间传输——数据库和`qemu`常使用该机制。

**网络栈**：`struct sk_buff`是核心数据包描述符——携带协议头、数据分散聚合列表（scatter-gather list）以及元数据（时间戳、优先级、入口设备）。SKB从slab缓存分配，并采用引用计数管理；相同的`sk_buff`在协议栈各层之间克隆传递，而无需复制数据载荷。

**NAPI**（New API）以中断驱动方式接收数据包，然后在单个硬IRQ内切换到**轮询**（`poll()`）循环，在高流量下分摊中断开销。`netif_napi_add`注册驱动程序的轮询函数；`napi_schedule`触发`NET_RX_SOFTIRQ`运行之。

**协议栈与netfilter**：入口路径为L2（`netif_receive_skb`）→ L3（`ip_rcv` → `ip_route_input`）→ L4（`tcp_v4_rcv`/`udp_rcv`）→ socket缓冲区 → 用户空间。**Netfilter**钩子（`NF_INET_PRE_ROUTING`、`LOCAL_IN`、`FORWARD`、`LOCAL_OUT`、`POST_ROUTING`）是`iptables`/`nftables`进行数据包过滤、NAT和改写的地方。出口路径：`dev_queue_xmit`将数据包交给设备；**qdisc**（排队规则，如`fq_codel`、`htb`）对出站流量进行整形和调速。

**eBPF/XDP**：**XDP**（eXpress Data Path）在最早期（驱动层）运行eBPF程序，甚至在`sk_buff`分配之前——用于DDoS缓解、负载均衡和快速转发。**TC eBPF**挂载到流量控制层，提供更丰富的协议栈内处理能力。

关键源文件：`include/linux/fs.h`（`struct inode`、`struct file`）、`include/linux/fs/super_types.h`（`struct super_block`）、`include/linux/dcache.h`（`struct dentry`）、`include/linux/blk_types.h`（`struct bio`）、`include/linux/skbuff.h`（`struct sk_buff`）、`net/core/dev.c`（NAPI）。

关于VFS如何将请求转发给用户空间的具体走读，参见我们的[FUSE内核模块深入剖析](/posts/fuse-kernel-module-deep-dive/)。

---

## 设备驱动如何融入内核？

设备驱动是内核的硬件接口。驱动模型是一棵**总线→设备→驱动**的树：驱动程序在总线上注册；当发现匹配的设备时，内核调用`probe()`。同一个模型覆盖了从键盘到网卡的一切。

**字符设备**（`struct cdev`）以字节流方式访问。驱动程序注册一个主次设备号对和一个`file_operations`表。`register_chrdev_region`预留静态的主/次设备号范围；`alloc_chrdev_region`请求动态分配。`cdev_add`使设备上线。`class_create` + `device_create`填充**sysfs**（`/dev`、`/sys/class/…`），使`udev`可以自动创建设备节点。

**设备模型与总线**：内核设备模型是**总线→设备→驱动**的树形结构。驱动程序（`struct device_driver`）在总线（`struct bus_type`）上注册；当发现匹配的设备时，调用`probe()`。**平台设备**表示集成在SoC中的设备（无可发现总线）；**设备树**（`*.dts`）或ACPI描述其资源（MMIO范围、IRQ）。**PCI**和**USB**是可发现总线，具有各自的核心驱动程序负责枚举设备并匹配功能驱动程序。

**中断与下半部**：驱动程序通过`request_irq`（或线程化变体`request_threaded_irq`）申请IRQ；**上半部**完成最小化的确认和通知工作，其余部分延迟处理。下半部机制：`tasklet`（在softirq上下文中、同一CPU上运行）、`workqueue`（在进程上下文中运行，可睡眠）和**线程化IRQ**（每个IRQ对应一个专用内核线程）。

**DMA与IOMMU**：**DMA**允许设备直接读写RAM而无需CPU参与数据拷贝；`dma_alloc_coherent`提供设备可访问且缓存一致的缓冲区。**IOMMU**（VT-d、SMMU）将设备可见的"IO虚拟地址"重映射到物理页面，使设备可以寻址分散的内存，并与其他设备的内存访问隔离。

<!-- [UNIQUE INSIGHT] 总线→设备→驱动模型是内核中最优雅的抽象之一——它意味着驱动作者永远不需要知道设备是如何被枚举的。无论设备位于PCI、USB、平台总线还是设备树上，驱动的probe()函数都会收到相同结构化的资源（MMIO、IRQ、DMA）。这就是为什么一个单一驱动可以跨硬件版本工作而无需修改。 -->

关键源文件：`drivers/char/`、`drivers/base/`（设备模型）、`include/linux/interrupt.h`（`request_irq`内联包装）、`kernel/irq/manage.c`（`request_threaded_irq`实现）、`include/linux/dma-mapping.h`（`dma_alloc_coherent`内联）、`kernel/dma/`（DMA一致性内存池）、`drivers/pci/`、`drivers/usb/`。

---

## 应该如何开始阅读Linux内核源码？

最佳学习路径取决于你的目标。与其线性地阅读源码，不如选择一个与你工作匹配的子系统，然后从头到尾追踪一个具体操作。

| 目标 | 从这里开始 | 然后阅读 |
|------|-----------|---------|
| 构建/编译内核 | [从源码编译内核](/posts/compile-ubuntu-kernel-source-6.8.0-90.91/) | `Makefile`、`Kconfig`、`scripts/` |
| 深入理解某个子系统 | [FUSE内核模块深入剖析](/posts/fuse-kernel-module-deep-dive/) | `fs/fuse/`、`fs/` |
| 追踪特定函数 | [ftrace：按父函数过滤](/posts/fstrace-filter-parent-function/) | `kernel/trace/` |
| 贡献补丁 | [内核贡献指南](/posts/kernel-contribution-guide-ai-era/) | `Documentation/process/` |
| 调试回归问题 | [使用xfstests调试内核回归](/posts/kernel-regression-xfstests/) | `tools/testing/` |
| 在虚拟机中运行内核 | [QEMU aarch64 Linux in WSL](/posts/qemu-aarch64-linux-in-wsl/) | `drivers/virtio/` |
| 提交第一个补丁 | [提交内核补丁](/posts/submit-linux-kernel-patch/) | `Documentation/process/submitting-patches.rst` |

一个实用的第一次练习：选一个系统调用（比如`read()`），然后追踪它从VFS入口点（`fs/read_write.c`）经过页缓存、块层，一直到某个驱动程序。你会在一次追踪中触及四个子系统——而这种跨子系统的视角，正是内核各部分如何组合在一起的关键。

---

## 常见问题

### Linux内核源码有多大？

7.2版本约3000万行代码，分布在68个顶级目录中。最大的子系统是`drivers/`（代码量远超其他）、`arch/`（x86、ARM、RISC-V等架构相关代码）、`fs/`、`net/`、`mm/`和`kernel/`。核心调度器在`kernel/sched/`中相对紧凑——几千行——但它是内核中算法最密集的部分之一。

### 应该从哪个子系统开始？

从与你目标匹配的子系统开始。如果你做性能工作，从`mm/`（内存）和`kernel/sched/`（调度器）入手。如果你做硬件支持，从`drivers/`开始。如果你做分布式系统，`net/`是自然的切入点。VFS层（`fs/`）是一个好的第二站——几乎每个子系统最终都会与文件交互。

### CFS和EEVDF有什么区别？

CFS（自内核2.6.23起）使用虚拟运行时间（`vruntime`）给每个任务均分的CPU时间——`vruntime`最小的任务优先运行。EEVDF（自内核6.6起）用虚拟截止时间取代`vruntime`，为交互式工作提供更强延迟保证。EEVDF计划最终取代CFS成为默认的公平调度器。两者都使用红黑树实现O(log n)的任务选择。

### 如何阅读内核源码而不迷失？

不要线性阅读。选一个具体的操作（一个系统调用、一个中断、一个数据包），用`grep`或IDE在源码中追踪它的路径。`include/linux/`和`kernel/`下的头文件定义了核心数据结构——先读这些。`Documentation/`目录（以及`https://www.kernel.org/doc/html/latest/`）解释了设计原理。并且先自己动手编译内核——这会让源码树变得具体可触。

---

## 结语

Linux内核的六大子系统——中断、调度器、内存、I/O、网络、驱动程序——各自构成了一个拥有独立数据结构和算法的世界。学习它们的关键，是沿着一个具体操作（一个系统调用、一次中断、一个数据包）跨越子系统边界进行追踪，而不是孤立地阅读每个子系统。

从与你工作匹配的子系统开始，追踪一条具体的源码路径，并使用可观测性工具（ftrace、perf、eBPF、`/proc/`）将代码与真实行为联系起来。源码虽大，但它的模式却惊人地一致——一旦你追踪过一条路径，其余的都会遵循相同的分层设计。

这是内核学习系列的第一篇。下一步是选一个子系统深入下去——[FUSE内核模块深入剖析](/posts/fuse-kernel-module-deep-dive/)和[ftrace内部原理](/posts/fstrace-filter-parent-function/)是I/O和追踪路径的良好延续。

## 参考文献

- Linux内核源码（torvalds/linux），https://github.com/torvalds/linux
- 内核文档，https://www.kernel.org/doc/html/latest/
- Linux内核地图（交互式子系统关系图），https://makelinux.github.io/kernel/map/
- 内核调度文档（CFS、EEVDF），https://www.kernel.org/doc/html/latest/scheduler/
- 内核内存管理文档，https://www.kernel.org/doc/html/latest/mm/
