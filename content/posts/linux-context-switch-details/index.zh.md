---
title: "上下文切换时究竟发生了什么？——从 __schedule() 到 switch_to()"
description: "上下文切换远不止保存/恢复寄存器。完整路径涉及运行队列锁、lazy TLB、内存屏障、PELT 更新和缓存感知数据结构。源码分析揭示每一步。"
coverImage: "/posts/linux-context-switch-details/images/cover.jpg"
coverImageAlt: "一个运动中的球，代表 Linux 上下文切换期间复杂的状态转换"
ogImage: "/posts/linux-context-switch-details/images/cover.jpg"
date: "2026-09-06 02:00:00"
lastUpdated: "2026-09-06 02:00:00"
author: "FindNS94"
tags: ["Kernel", "Linux"]
---

![一个运动中的球，代表 Linux 上下文切换期间复杂的状态转换](/posts/linux-context-switch-details/images/cover.jpg)

# 上下文切换时究竟发生了什么？——从 __schedule() 到 switch_to()

每本操作系统教科书都将上下文切换描述为"保存当前进程的状态并恢复下一个进程的状态"。这个定义在技术上是正确的，但实际上毫无用处 —— 它没有告诉你为什么上下文切换花费 1-20 微秒，涉及哪些子系统，或者内核如何最小化开销。

Linux 上的单次上下文切换至少涉及六个不同的子系统：调度器（运行队列管理）、内存子系统（页表切换）、TLB（缓存管理）、CPU 架构层（寄存器保存/恢复）、负载追踪系统（PELT）和缓存层次结构（数据局部性）。所有这些都必须通过仔细的内存屏障、锁顺序和缓存感知数据结构布局来协调。

本文追踪从调用 `__schedule()` 开始，经过 `context_switch()`，进入 `switch_to()`，最后到 `finish_task_switch()` 的完整上下文切换路径。读完后，你将理解为什么上下文切换昂贵，内核如何最小化成本，以及为什么上下文切换最反直觉的方面是 `switch_to()` 从不返回到同一个任务。

<!-- [UNIQUE INSIGHT] 关于上下文切换最反直觉的事实是当 `switch_to()` 返回时，你正在*不同任务的*上下文中执行。一个再次被调度的任务在*先前*切换的 `switch_to()` 调用处恢复执行 —— 不是在它被抢占的点。这就是为什么 `finish_task_switch()` 为*前一个*任务（当此任务被调度时正在运行的任务）处理清理，而不是当前运行的任务。 -->

<!-- more -->

> **核心要点**
> - 上下文切换涉及 4 个不同阶段：调度决策、内存切换、寄存器切换、清理
> - `smp_mb__after_spinlock()` 至关重要 —— 它确保调度器状态跨 CPU 的可见性
> - Lazy TLB 优化：内核线程借用前一个任务的 `active_mm` 避免昂贵的 TLB 刷新
> - `switch_to()` 返回到*不同*任务的执行上下文 —— 返回点是当此任务下次被调度时
> - `struct rq` 缓存行布局最小化频繁读取和频繁写入字段之间的伪共享
> - `DELAY_DEQUEUE` 让短暂睡眠的任务留在运行队列上以避免入队/出队开销

---

## 上下文切换的四个阶段

上下文切换不是单一操作 —— 是一个精心编排的四阶段序列，每个涉及不同的内核子系统：

```
  __schedule() — 入口点
       │
       ▼
  ┌─────────────────────────────────────────────────────────────────────┐
  │ 第 1 阶段：调度决策                                                  │
  │ 位置：kernel/sched/core.c                                           │
  │                                                                     │
  │ • 锁定运行队列：raw_spin_lock_irq(&rq->lock)                        │
  │ • 内存屏障：smp_mb__after_spinlock()                                │
  │ • 更新时钟：update_rq_clock(rq)                                     │
  │ • 处理 prev 状态：try_to_block_task() 如果睡眠                      │
  │ • 选择下一个任务：pick_next_task(rq) → 遍历调度类                    │
  │ • 检查是否需要切换：prev != next？                                   │
  └─────────────────────────────────────────────────────────────────────┘
       │ (如果选择了不同任务)
       ▼
  ┌─────────────────────────────────────────────────────────────────────┐
  │ 第 2 阶段：内存切换                                                  │
  │ 位置：kernel/sched/core.c → switch_mm()                             │
  │                                                                     │
  │ • 如果相同 mm（相同进程或内核线程）：跳过                            │
  │ • 如果不同 mm：switch_mm_irqs_off() → load_cr3()                    │
  │ • 内核线程：enter_lazy_tlb() → 借用 active_mm                       │
  │ • TLB 刷新：CR3 写入时隐式（或使用 lazy TLB 避免）                   │
  └─────────────────────────────────────────────────────────────────────┘
       │
       ▼
  ┌─────────────────────────────────────────────────────────────────────┐
  │ 第 3 阶段：寄存器切换                                                │
  │ 位置：arch/x86/kernel/process_64.c → __switch_to_asm()             │
  │                                                                     │
  │ • 保存：栈指针 → prev->thread.sp                                    │
  │ • 保存：被调用者保存的寄存器（rbp, rbx, r12-r15）到栈               │
  │ • 加载：next->thread.sp → rsp                                       │
  │ • 恢复：从新任务的栈恢复被调用者保存的寄存器                          │
  │ • 跳转：__switch_to() → 当此任务下次被调度时返回                     │
  └─────────────────────────────────────────────────────────────────────┘
       │
       ▼
  ┌─────────────────────────────────────────────────────────────────────┐
  │ 第 4 阶段：清理                                                      │
  │ 位置：kernel/sched/core.c → finish_task_switch()                    │
  │                                                                     │
  │ • 释放：prev->pi_lock（优先级继承锁）                                │
  │ • TLB 清理：mmdrop_lazy_tlb() 用于延迟 TLB 击落                     │
  │ • PELT 更新：前一个任务的负载贡献在此结束                            │
  │ • 延迟出队：处理短暂睡眠的任务                                       │
  └─────────────────────────────────────────────────────────────────────┘
```

---

## 第 1 阶段：`__schedule()` — 决策

所有上下文切换的入口点都是 `__schedule()`。当内核确定应该运行不同的任务时调用此函数 —— 要么因为当前任务已让出 CPU（阻塞 I/O、睡眠），要么因为调度器 tick 已设置 `TIF_NEED_RESCHED`。

```c
// kernel/sched/core.c — __schedule()
static void __sched notrace __schedule(int sched_mode)
{
    int cpu = smp_processor_id();
    struct rq *rq = cpu_rq(cpu);
    struct task_struct *prev, *next;
    struct rq_flags rf;

    prev = rq->curr;

    // 1. 禁用抢占并锁定运行队列
    rq_lock(rq, &rf);
    smp_mb__after_spinlock();  // ← 关键内存屏障

    // 2. 更新运行队列时钟
    update_rq_clock(rq);

    // 3. 处理前一个任务的状态
    if (!preempt && prev_state) {
        // 任务正在阻塞（非抢占）
        try_to_block_task(rq, prev, &prev_state, ...);
    }

    // 4. 选择下一个要运行的任务
    next = pick_next_task(rq, &rf);

    // 5. 清除 need_resched 标志
    clear_tsk_need_resched(prev);

    // 6. 如果不同任务则上下文切换
    if (prev != next) {
        rq = context_switch(rq, prev, next, &rf);
    }

    // 7. 完成清理（在新任务上下文中运行）
    barrier();
    return finish_task_switch(prev);
}
```

### 关键内存屏障：`smp_mb__after_spinlock()`

这一行是整个调度器中最重要的部分之一。它确保：

1. **远程写入的可见性**：在锁之前在另一个 CPU 上发生的任何写入现在可见
2. **一致的运行队列状态**：调度器看到最新的 `nr_running`、`curr` 和负载值
3. **无陈旧决策**：没有此屏障，CPU 可能看到过时的运行队列状态并做出错误的调度决策

该屏障与 `rq_unlock()` 中的释放端屏障协同工作 —— 它们共同形成跨 CPU 序列化调度器状态的 happens-before 关系。

### `pick_next_task()`：遍历调度类

```c
// kernel/sched/core.c — __pick_next_task()
static inline struct task_struct *__pick_next_task(struct rq *rq, struct rq_flags *rf)
{
    for_each_active_class(class) {
        p = class->pick_task(rq, rf);
        if (p)
            return p;
    }
    return idle_task;  // 总是返回 idle 线程
}
```

遍历顺序是：STOP → DL → RT → FAIR → IDLE。第一个返回任务的类获胜。这就是为什么实时任务总是抢占普通任务 —— 它们的 `pick_task()` 首先被调用。

---

## 第 2 阶段：`context_switch()` — 内存与寄存器

```c
// kernel/sched/core.c — context_switch()
static __always_inline struct rq *
context_switch(struct rq *rq, struct task_struct *prev,
               struct task_struct *next, struct rq_flags *rf)
{
    // 通知调度器即将切换
    prepare_task_switch(rq, prev, next);
    arch_start_context_switch(prev);

    // === 内存空间切换 ===
    if (!next->mm) {
        // 内核线程：没有自己的内存映射
        // 借用前一个任务的 mm（lazy TLB 优化）
        enter_lazy_tlb(prev->active_mm, next);
        next->active_mm = prev->active_mm;
        prev->active_mm->mm_users++;
    } else {
        // 真正的用户进程：切换页表
        switch_mm_irqs_off(prev->active_mm, next->mm, next);
    }

    // === 寄存器状态切换 ===
    switch_to(prev, next, prev);
    barrier();

    // === 清理（在新任务上下文中运行） ===
    return finish_task_switch(prev);
}
```

### Lazy TLB：内核线程优化

内核线程（`kworker`、`ksoftirqd` 等）没有自己的内存映射 —— `next->mm` 为 NULL。内核不刷新 TLB（这会花费数百个周期），而是借用前一个任务的 `active_mm`：

```c
// kernel/sched/core.c — enter_lazy_tlb()
static void enter_lazy_tlb(struct mm_struct *mm, struct task_struct *tsk)
{
    // 内核线程共享地址空间的内核部分
    // 不需要 TLB 刷新 —— 内核映射在所有进程中相同
}
```

这之所以有效，是因为内核地址空间（虚拟内存的上部）在所有进程中是相同的。只有用户空间部分不同，而内核线程从不访问用户空间。

### 真正的内存切换：`switch_mm_irqs_off()`

对于用户进程，内核必须切换页表：

```c
// arch/x86/mm/tlb.c — switch_mm_irqs_off()
void switch_mm_irqs_off(struct mm_struct *prev, struct mm_struct *next,
                        struct task_struct *tsk)
{
    // 加载新页表基址寄存器
    load_cr3(next->pgd);

    // CR3 写入时隐式刷新 TLB
    //（除非启用了 PCID —— 见下文）
}
```

在启用 PCID（进程上下文标识符）的现代 x86 处理器上，TLB 不会完全刷新 —— 条目用 PCID 标记，仅在 PCID 被重用时才刷新。这大大降低了进程间上下文切换的成本。

---

## 第 3 阶段：`switch_to()` — 寄存器之舞

这是实际 CPU 状态转换发生的地方。在 x86-64 上，切换用汇编实现：

```asm
// arch/x86/kernel/process_64.c — __switch_to_asm()
__visible __notrace_funcgraph struct task_struct *
__switch_to_asm(struct task_struct *prev, struct task_struct *next)
{
    ; 将被调用者保存的寄存器保存到 prev 的栈
    pushq %rbp
    pushq %rbx
    pushq %r12
    pushq %r13
    pushq %r14
    pushq %r15

    ; 将栈指针保存到 prev->thread.sp
    movq %rsp, TASK_threadsp(%rdi)

    ; 从 next->thread.sp 加载栈指针
    movq TASK_threadsp(%rsi), %rsp

    ; 从新任务的栈恢复被调用者保存的寄存器
    popq %r15
    popq %r14
    popq %r13
    popq %r12
    popq %rbx
    popq %rbp

    ; 跳转到新任务上次执行的位置
    jmp __switch_to
}
```

### 关键洞察：栈跨越

在 `movq TASK_threadsp(%rsi), %rsp` 之后，CPU 现在运行在**新任务的栈**上。当我们 `popq` 寄存器时，我们正在恢复**新任务的**寄存器状态。`jmp __switch_to` 从新任务上次调用 `switch_to()` 的地方继续执行。

这意味着：**当一个任务再次被调度时，它在*先前*切换的 `switch_to()` 调用处恢复** —— 不是在它被抢占的点。`switch_to()` 下方的整个调用栈属于*先前*的执行上下文。

### `__switch_to()`：C 部分

```c
// arch/x86/kernel/process_64.c — __switch_to()
__notrace_funcgraph struct task_struct *
__switch_to(struct task_struct *prev, struct task_struct *next)
{
    // 保存/恢复 FPU 状态
    fpu__save(prev);
    fpu__restore(next);

    // 保存/恢复调试寄存器
    update_debugctlmsr();

    // 更新 GS 段（per-CPU 数据）
    loadsegment(fs, next->thread.fsindex);
    load_gs_index(next->thread.gsindex);

    // 更新 TLS（线程局部存储）
    loadsegment(es, next->thread.es);
    loadsegment(ds, next->thread.ds);

    // 更新 MSR（模型特定寄存器）
    wrmsrl(MSR_FS_BASE, next->thread.fsbase);
    wrmsrl(MSR_KERNEL_GS_BASE, next->thread.gsbase);

    return prev;
}
```

---

## 第 4 阶段：`finish_task_switch()` — 清理

```c
// kernel/sched/core.c — finish_task_switch()
static struct rq *finish_task_switch(struct task_struct *prev)
{
    struct rq *rq = this_rq();
    long prev_state;

    // 1. 释放我们在调度期间持有的 pi_lock
    if (prev->pi_lock_owner)
        raw_spin_unlock_irq(&prev->pi_blocked_on->pi_lock);

    // 2. 处理待处理的 TLB 击落
    mmdrop_lazy_tlb(rq, prev->active_mm);

    // 3. 更新 PELT：前一个任务的负载贡献在此结束
    if (prev->sched_class->task_tick)
        prev->sched_class->task_tick(rq, prev, 0);

    // 4. 处理延迟出队
    if (prev->on_rq)
        prev->sched_class->dequeue_task(rq, prev, DEQUEUE_SLEEP);

    return rq;
}
```

此函数在**新任务**的上下文中运行，但为**前一个**任务进行清理。这是可能的，因为新任务在 `switch_to()` 调用处恢复 —— `prev` 指针仍然有效（它存储在寄存器或栈上）。

---

## 深度细节：`struct rq` 缓存行布局

运行队列结构（`struct rq`）经过精心布局以最小化伪共享 —— 一种性能问题，其中两个 CPU 频繁访问恰好位于同一缓存行的不同字段，导致不断的缓存失效。

```c
// kernel/sched/sched.h — struct rq (简化)
struct rq {
    /* === 缓存行 0：热读取为主 ===
     * 每个 CPU 为负载均衡访问。
     * 不得与写密集字段在同一行。
     */
    unsigned int nr_running;        // 所有 CPU 读取
    unsigned int cpu_capacity;      // 调度器读取
    unsigned int nr_switches;       // 统计读取

    ____cacheline_aligned

    /* === 缓存行 1：写密集（调度器热路径） ===
     * 每次切换和 tick 时写入。
     * 与读取为主的字段隔离。
     */
    struct task_struct *curr;       // 每次切换时写入
    u64 clock_task;                 // 每个 tick 写入
    u64 nr_load_balance;            // 均衡期间写入

    ____cacheline_aligned

    /* === 缓存行 2：CFS 特定 ===
     * 主要由 CFS 调度器访问。
     */
    struct cfs_rq cfs;
    struct rt_rq rt;
    struct dl_rq dl;
    struct rq *idle_rq;             // 指向 idle 运行队列的指针

    ____cacheline_aligned

    /* === 缓存行 3：Per-CPU 数据 ===
     * 初始化时写入一次，频繁读取。
     */
    int cpu;                        // CPU 编号
    u64 clock;                      // 运行队列时钟
    u64 clock_pelt;                 // PELT 时钟
};
```

### 为什么这很重要

没有缓存行隔离：
- CPU A 读取 `nr_running`（缓存行 0）
- CPU B 写入 `curr`（缓存行 1）
- 如果它们共享一行，CPU A 的读取会使 CPU B 的写入失效，反之亦然

有隔离：
- CPU A 读取缓存行 0（从不被调度器写入失效）
- CPU B 写入缓存行 1（从不被负载均衡读取失效）
- 结果：显著减少缓存一致性流量

---

## 深度细节：`DELAY_DEQUEUE` 优化

当任务短暂睡眠（例如，等待自旋锁）时，从运行队列中移除它并在唤醒时重新添加是昂贵的。`DELAY_DEQUEUE` 特性让任务留在运行队列上：

```c
// kernel/sched/fair.c — dequeue_task_fair()
static void dequeue_task_fair(struct rq *rq, struct task_struct *p, int flags)
{
    struct cfs_rq *cfs_rq = task_cfs_rq(p);

    if (p->on_rq) {
        // 不立即从运行队列移除
        // 标记为延迟
        p->sched_delayed = 1;
        p->on_rq = TASK_ON_RQ_MIGRATING;
        return;
    }

    // 完全出队
    __dequeue_entity(cfs_rq, se);
}
```

如果任务在完全出队前唤醒，它可以消耗负 lag 而不被选中 —— 避免不必要的上下文切换。

---

## 如何测量上下文切换

### 使用 perf

```bash
// 计算进程的上下文切换
perf stat -e context-switches,cpu-migrations -p <pid> sleep 5

// 测量调度延迟分布
perf sched record -- sleep 1
perf sched latency

// 可视化调度行为
perf sched record -- sleep 1
perf sched map
```

### 使用 bpftrace

```bash
#!/usr/bin/env bpftrace
// trace_cs.bt — 追踪上下文切换延迟

kprobe:__schedule
{
    @start[tid] = nsecs;
    @prev_comm[tid] = comm;
}

kretprobe:__schedule
/@start[tid]/
{
    $latency = nsecs - @start[tid];
    @us = hist($latency / 1000);
    @switches[@prev_comm[tid]->comm] = count();
    delete(@start[tid]);
    delete(@prev_comm[tid]);
}

END
{
    printf("\nContext switch latency (us):\n");
    print(@us);
    printf("\nSwitches per task pair:\n");
    print(@switches);
}
```

### 使用 ftrace

```bash
// 启用 sched_switch tracer
echo sched_switch > /sys/kernel/debug/tracing/current_tracer
echo 1 > /sys/kernel/debug/tracing/tracing_on
cat /sys/kernel/debug/tracing/trace_pipe

// 每任务上下文切换计数
cat /proc/<pid>/status | grep voluntary_ctxt_switches
cat /proc/<pid>/status | grep nonvoluntary_ctxt_switches
```

---

## 常见问题

### 上下文切换的成本是多少？
典型成本："热"切换（相同进程，温缓存）1-10 微秒。"冷"切换（不同进程，冷缓存，TLB 刷新）可能花费 10-20 微秒。细分：
- 寄存器保存/恢复：~0.5 μs
- TLB 刷新（如果需要）：~1-5 μs
- 缓存预热：~1-10 μs（取决于工作集）
- 调度器开销：~0.5-1 μs

### 为什么内核线程不需要完整的 mm 切换？
内核地址空间在所有进程中是相同的（x86 上虚拟内存的上部）。内核线程借用前一个任务的 `active_mm` 并共享内核页表 —— 无需 TLB 刷新。这为每次切换节省了数百个周期。

### PCID 是什么？它如何帮助？
PCID（进程上下文标识符）用每进程标识符标记 TLB 条目。切换进程时，TLB 不会刷新 —— 来自前一个进程的条目保留但会被忽略，因为它们有不同的 PCID。这大大降低了上下文切换的成本。

### 为什么 `finish_task_switch()` 在新任务的上下文中运行？
因为 `switch_to()` 从不返回到同一个调用点。当一个任务再次被调度时，它在*先前*切换的 `switch_to()` 处恢复。`prev` 指针（在此任务之前运行的任务）仍然可以访问，所以清理可以继续进行。

### 自愿和非自愿上下文切换有什么区别？
- **自愿**：任务自愿让出 CPU（阻塞 I/O、睡眠、锁争用）
- **非自愿**：任务被抢占（时间片到期、高优先级任务唤醒）
高非自愿切换率表示 CPU 过度订阅。

---

## 总结

上下文切换远不止寄存器保存/恢复。它们涉及带内存屏障的调度决策、内核线程的 lazy TLB 优化、跨越任务边界的仔细寄存器切换，以及在新任务上下文中的清理。内核通过多种优化最小化成本：lazy TLB 避免内核线程的 TLB 刷新，PCID 避免进程间的刷新，缓存感知数据结构布局减少伪共享，DELAY_DEQUEUE 避免不必要的入队/出队周期。

理解这条路径解释了为什么上下文切换昂贵（1-20 μs），内核如何最小化成本，以及为什么最反直觉的方面 —— `switch_to()` 在不同任务的上下文中返回 —— 实际上是高效调度的关键。

---

## 来源

- Linux 内核源码, `kernel/sched/core.c`, `__schedule()`
- Linux 内核源码, `kernel/sched/core.c`, `context_switch()`
- Linux 内核源码, `kernel/sched/core.c`, `finish_task_switch()`
- Linux 内核源码, `arch/x86/kernel/process_64.c`, `__switch_to_asm()`
- Linux 内核源码, `arch/x86/mm/tlb.c`, `switch_mm_irqs_off()`
- Linux 内核源码, `kernel/sched/sched.h`, `struct rq`
