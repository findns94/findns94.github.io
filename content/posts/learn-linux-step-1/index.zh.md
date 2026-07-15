---
title: Linux内核学习 — 第一篇
date: 2021-12-05 20:22:30
tags: [Linux, Kernel, OS]
---


# 概览

![linux_kernel_map](/posts/learn-linux-step-1/images/LKM.svg)

<!-- more -->

面对Linux内核的全景，很容易在众多子系统中感到不知所措。一个有效的思路是从Linux的诊断（measurement）工具及其功能切片的角度来观察内核的功能。

![linux_observability_tools](/posts/learn-linux-step-1/images/linux_observability_tools.png)

# 中断子系统

- 中断
    - `硬中断`（hard interrupt）
    - `软中断`（soft interrupt）
    - 中断嵌套
        - `硬中断`可以嵌套
        - `软中断`不可嵌套
    - `硬中断`和`软中断`的区别
        - `软中断`由执行中断指令产生，而`硬中断`由外部设备触发。
        - `硬中断`的中断号由中断控制器提供；`软中断`的中断号由指令直接指定，无需中断控制器。
        - `硬中断`可屏蔽，`软中断`不可屏蔽。
        - `硬中断`处理程序必须确保快速完成任务，以免程序执行长时间等待，这称为上半部（top half）。
        - `软中断`负责处理`硬中断`未完成的工作，是一种延迟执行机制，属于下半部（bottom half）。

# 其他子系统

- 调度（Schedule）
    - CFS（Completely Fair Scheduler，完全公平调度器）
        - 默认的"公平"调度类，模拟一个"理想多任务处理器"，每个可运行任务均分CPU时间。
        - 每个任务累积**虚拟运行时间**（`vruntime`，定义在`struct sched_entity`中），调度器优先选择`vruntime`最小的任务运行。
        - 任务以`vruntime`为键保存在**红黑树**中，因此选取下一个任务以及在时间片结束后重新插入的复杂度均为$O(\log n)$。
        - `SCHED_NORMAL`、`SCHED_BATCH`和`SCHED_IDLE`任务均由CFS服务。
    - EEVDF（Earliest Eligible Virtual Deadline First，最早合格虚拟截止时间优先）
        - 在6.6版本内核中引入，是一种新的调度算法，计划最终取代CFS。
        - 每个任务携带一个**虚拟截止时间**（virtual deadline），调度器始终运行截止时间最早的任务，比纯公平模型提供更强的延迟保证。
        - 使用时间片较少的任务会获得更早的截止时间，交互型和延迟敏感型任务因此得到优先处理，而无需单独的"交互式"启发式机制。
    - 实时调度器（Real-time schedulers）
        - `SCHED_FIFO`和`SCHED_RR`是固定优先级的实时调度类，总是抢占CFS；`SCHED_DEADLINE`使用EDF算法并带有运行时间预算，面向硬实时工作负载。
    - 运行队列与负载均衡（Runqueues and load balancing）
        - 每CPU对应一个运行队列（`struct rq`）；通过周期性**负载均衡**（load balancing）和**空闲均衡**（idle balancing）将任务迁移到不同运行队列中，保持所有核心处于忙碌状态。
        - **调度类**（scheduling classes）组成一条优先级链（stop → deadline → rt → fair → idle），每个类决定是否运行自己的任务，然后再让位于优先级更低的类。
    - 上下文切换与时钟滴答（Context switch and tick）
        - `context_switch()`负责切换页表（`switch_mm`）和CPU寄存器状态（`switch_to`）；调度器时钟滴答（`scheduler_tick`）更新`vruntime`并可能设置`TIF_NEED_RESCHED`标志。
        - `NO_HZ_IDLE`/`NO_HZ_FULL`在空闲或安静的CPU上停止周期性时钟滴答，以节省功耗并减少抖动。
- 内存（Memory）
    - 物理内存
        - 内存组织为**NUMA节点**（`struct pglist_data`），每个节点内再分为多个**区**（zone），如DMA、DMA32、Normal、HighMem，反映硬件寻址限制。
        - 最小单位是**页**（page，通常4 KiB），由`struct page`跟踪（每个物理页对应一个，保存在`mem_map`中）。
        - **伙伴分配器**（buddy allocator）分配连续的二的幂次页组，并通过合并空闲伙伴（buddy）来应对外部碎片。
        - **slab分配器**（`slub`/`slab`/`slob`）缓存频繁分配的内核对象（`task_struct`、`inode`、`dentry`等），避免伙伴层级的碎片和重复初始化。
    - 虚拟内存（Virtual memory）
        - 每个进程拥有独立的地址空间，由`struct mm_struct`描述；连续的逻辑区域称为**VMA**（`struct vm_area_struct`），各自具有标志位和文件映射。
        - 多级**页表**（PGD → PUD → PMD → PTE）完成虚拟地址到物理地址的转换；x86-64和AArch64通常使用4级页表，更大地址空间可支持5级。
        - **按需分页**（Demand paging）：首次访问触发缺页异常（`do_page_fault`/`handle_mm_fault`），映射零页、从交换空间读取或映射文件。
        - `kmalloc`返回物理上连续的内存（适合DMA）；`vmalloc`返回虚拟连续的内存，物理上可能不连续。
        - **大页**（Huge pages，2 MiB / 1 GiB）和**透明大页**（THP, Transparent Huge Pages）可减少TLB压力和页表遍历开销。
    - 回收与OOM（Reclaim and OOM）
        - 当可用内存减少时，**kswapd**负责回收页面缓存和匿名页；**zswap**/**zram**在内存中压缩页面以减少交换I/O。
        - 若回收无法释放足够内存，**OOM killer**根据评分机制（badness score）选择牺牲进程并将其杀死，以维持系统存活。
- IO
    - VFS（Virtual File System，虚拟文件系统）
        - VFS层为userspace提供统一的`open`/`read`/`write`/`close`接口，屏蔽底层文件系统的差异。
        - 核心对象：`struct superblock`（已挂载文件系统）、`struct inode`（文件元数据）、`struct dentry`（目录项缓存，加速路径查找）和`struct file`（打开的文件实例，包含独立偏移量和`file_operations`）。
        - `file_operations`函数表（`open`、`read`、`write`、`ioctl`、`mmap`、`release`等）是文件系统或设备驱动程序将自身行为注入VFS的方式。
    - 块层（Block layer）
        - 文件I/O和文件系统请求被转换为**bio**结构（`struct bio`），每个描述一个或多个连续的内存缓冲区段用于读写。
        - bio被合并并入**请求队列**；**blk-mq**（多队列）框架将提交映射到每CPU或硬件队列，面向现代高速存储。
        - I/O调度器/调度算法——`mq-deadline`、`kyber`、`bfq`、`none`——对请求重新排序和合并，在吞吐量、延迟和公平性之间取得平衡。
        - **页面缓存**（page cache）保存近期读取的文件页面；脏页面由周期性**回写**（writeback）线程刷新到磁盘。
    - 内存映射与直接I/O（Memory-mapped and direct I/O）
        - `mmap`将文件直接映射到进程地址空间，使读写操作变为内存访问（通过页面缓存按需分页）。
        - **直接I/O**（`O_DIRECT`）绕过页面缓存，直接通过DMA在用户缓冲区和设备之间传输，数据库和`qemu`常使用该机制。
- 网络（Network）
    - `sk_buff`（socket buffer，套接字缓冲区）
        - `struct sk_buff`是核心数据包描述符：携带协议头、数据分散聚合列表（scatter-gather list）以及元数据（时间戳、优先级、入口设备）。
        - SKB从slab缓存分配，并采用引用计数管理；相同的`sk_buff`在协议栈各层之间克隆传递，而无需复制数据载荷。
    - NAPI与设备轮询（NAPI and device polling）
        - **NAPI**（New API）以中断驱动方式接收数据包，然后在单个硬IRQ内切换到**轮询**（`poll()`）循环，在高流量下分摊中断开销。
        - `netif_napi_add`注册驱动程序的轮询函数；`napi_schedule`触发`NET_RX_SOFTIRQ`运行之。
    - 协议栈与netfilter（Protocol stack and netfilter）
        - 入口路径：L2（`netif_receive_skb`）→ L3（`ip_rcv` → `ip_route_input`）→ L4（`tcp_v4_rcv`/`udp_rcv`）→ socket缓冲区 → 用户空间。
        - **Netfilter**钩子（`NF_INET_PRE_ROUTING`、`LOCAL_IN`、`FORWARD`、`LOCAL_OUT`、`POST_ROUTING`）是`iptables`/`nftables`进行数据包过滤、NAT和改写的地方。
        - 出口路径：`dev_queue_xmit`将数据包交给设备；**qdisc**（排队规则，如`fq_codel`、`htb`）对出站流量进行整形和调速。
    - eBPF/XDP
        - **XDP**（eXpress Data Path）在最早期（驱动层）运行eBPF程序，甚至在`sk_buff`分配之前——用于DDoS缓解、负载均衡和快速转发。
        - **TC eBPF**挂载到流量控制层，提供更丰富的协议栈内处理能力。
- 驱动（Driver）
    - 字符设备（Character devices）
        - **字符设备**（`struct cdev`）以字节流方式访问；驱动程序需要注册一个主次设备号对和一个`file_operations`表。
        - `register_chrdev_region`预留静态的主/次设备号范围；`alloc_chdev_region`请求动态分配。`cdev_add`使设备上线。
        - `class_create` + `device_create`填充**sysfs**（`/dev`、`/sys/class/…`），使`udev`可以自动创建设备节点。
    - 设备模型与总线（Device model and buses）
        - 内核设备模型是**总线 → 设备 → 驱动**的树形结构：驱动程序（`struct device_driver`）在总线（`struct bus_type`）上注册；当发现匹配的设备时，调用其`probe()`方法。
        - **平台设备**（Platform devices）表示集成在SoC中的设备（无可发现总线）；**设备树**（`*.dts`）或ACPI描述其资源（MMIO范围、IRQ）。
        - **PCI**和**USB**是可发现总线，具有各自的核心驱动程序负责枚举设备并匹配功能驱动程序。
    - 中断与下半部（Interrupts and bottom halves in drivers）
        - 驱动程序通过`request_irq`（或线程化变体`request_threaded_irq`）申请IRQ；**上半部**（top half）完成最小化的确认和通知工作，其余部分延迟处理。
        - **下半部**（bottom half）机制：`tasklet`（在softirq上下文中、同一CPU上运行）、`workqueue`（在进程上下文中运行，可睡眠）和**线程化IRQ**（每个IRQ对应一个专用内核线程）。
    - DMA与IOMMU（DMA and IOMMU）
        - **DMA**允许设备直接读写RAM而无需CPU参与数据拷贝；`dma_alloc_coherent`提供设备可访问且缓存一致的缓冲区。
        - **IOMMU**（VT-d、SMMU）将设备可见的"IO虚拟地址"重映射到物理页面，使设备可以寻址分散的内存，并与其他设备的内存访问隔离。

# 参考文献

[1]	https://makelinux.github.io/kernel/map/
