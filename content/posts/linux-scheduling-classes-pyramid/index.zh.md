---
title: "调度类的金字塔——STOP/DL/RT/FAIR/IDLE 的优先级世界"
description: "并非所有进程都使用 CFS。Linux 有 5 个调度类按优先级排列：STOP > DL > RT > FAIR > IDLE。源码分析 pick_next_task() 揭示类遍历机制。"
coverImage: "/posts/linux-scheduling-classes-pyramid/images/cover.jpg"
coverImageAlt: "一座建筑，代表 Linux 调度类层级结构，从 STOP（最高）到 IDLE（最低）"
ogImage: "/posts/linux-scheduling-classes-pyramid/images/cover.jpg"
date: "2026-09-06 04:00:00"
lastUpdated: "2026-09-06 04:00:00"
author: "FindNS94"
tags: ["Kernel", "Linux"]
---

![一座建筑，代表 Linux 调度类层级结构，从 STOP（最高）到 IDLE（最低）](/posts/linux-scheduling-classes-pyramid/images/cover.jpg)

# 调度类的金字塔——STOP/DL/RT/FAIR/IDLE 的优先级世界

大多数 Linux 开发者认为所有进程都由 CFS（完全公平调度器）调度。这是错误的。CFS 只是按严格优先级层级排列的**五个**调度类之一。当实时进程需要运行时，它不会等待 CFS 任务完成 —— 它会立即抢占它们。当截止时间敏感的任务有定时约束时，它根本不与普通进程竞争。

调度类层级是 Linux 最重要却最不被理解的机制之一。它决定了当系统加载时你的音频播放是否卡顿，你的实时控制循环是否满足截止时间，以及系统在极端负载下是否保持响应。

本文通过分析 `kernel/sched/core.c` 中的调度类源码来解释层级如何工作、每个类做什么，以及 `__pick_next_task()` 如何遍历它们来选择下一个任务。

<!-- [UNIQUE INSIGHT] 调度类层级不仅仅是一个优先级排序 —— 它是一个故障安全机制。即使 FAIR 类（CFS/EEVDF）被数千个任务超载，单个 RT 任务总是会抢占它们所有。即使 RT 正在运行，截止时间紧迫的 DL 任务也会抢占它们。这种严格层级保证关键任务从不被不太重要的任务延迟。 -->

<!-- more -->

> **核心要点**
> - Linux 有 5 个调度类：STOP > DL > RT > FAIR > IDLE（从高到低优先级）
> - `__pick_next_task()` 从高到低遍历类 —— 第一个返回任务的类获胜
> - STOP 类：CPU 停止器任务，最高优先级，用于 CPU 热插拔
> - DL 类：EDF + CBS 用于截止时间调度任务，有运行时/截止时间/周期约束
> - RT 类：固定优先级 (0-99) FIFO 或轮转用于实时任务
> - FAIR 类：CFS/EEVDF 用于普通进程 (SCHED_NORMAL/BATCH/IDLE)
> - IDLE 类：仅当其他类无工作时运行

---

## 误区："所有进程都用 CFS"

在任何 Linux 系统上运行 `ps -eo pid,class,prio,comm`，你会看到：

```
  PID CLS PRI COMMAND
    1 FF  119 systemd          (FF = SCHED_FIFO, RT 类)
   10 TS  139 migration/0      (TS = SCHED_OTHER, FAIR 类)
   20 FF  120 irq/16           (FF = SCHED_FIFO, RT 类)
   30 FF   90 ksoftirqd/0      (FF = SCHED_FIFO, RT 类)
   40 DL   99 my_rt_app        (DL = SCHED_DEADLINE, DL 类)
   50 FF    1 my_control_loop   (FF = SCHED_FIFO, RT 类)
```

`CLS` 列揭示调度类：`TS`（FAIR）、`FF`（RT FIFO）、`RR`（RT RR）、`DL`（Deadline）、`B`（Batch）、`IDLE`（Idle）。大多数进程使用 FAIR（TS），但内核线程和实时应用使用 RT 或 DL。---

## 调度类层级

```
  ┌─────────────────────────────────────────────────────────────────────┐
  │                    __pick_next_task()                               │
  │                    kernel/sched/core.c                              │
  │                                                                     │
  │  for_each_active_class(class) {                                     │
  │      p = class->pick_task(rq, rf);                                  │
  │      if (p) return p;  ← 第一个返回任务的类获胜                     │
  │  }                                                                  │
  │  return idle_task;  ← 回退                                         │
  └─────────────────────────────────────────────────────────────────────┘
       │
       │ 遍历顺序（从高到低优先级）：
       ▼
  ┌─────────────────────────────────────────────────────────────────────┐
  │  1. stop_sched_class    — CPU 停止器（最高）                        │
  │     • 每 CPU 单任务                                                  │
  │     • 用于 CPU 热插拔、迁移                                         │
  │     • 不能被任何东西抢占                                             │
  └─────────────────────────────────────────────────────────────────────┘
       │ (如果没有 STOP 任务)
       ▼
  ┌─────────────────────────────────────────────────────────────────────┐
  │  2. dl_sched_class      — 截止时间调度 (EDF + CBS)                   │
  │     • SCHED_DEADLINE 策略                                           │
  │     • 任务有运行时、截止时间、周期                                    │
  │     • 最早截止时间优先                                               │
  └─────────────────────────────────────────────────────────────────────┘
       │ (如果没有 DL 任务)
       ▼
  ┌─────────────────────────────────────────────────────────────────────┐
  │  3. rt_sched_class      — 实时调度 (FIFO/RR)                        │
  │     • SCHED_FIFO / SCHED_RR 策略                                    │
  │     • 固定优先级 0-99                                                │
  │     • FIFO：运行到完成；RR：时间片轮转                                │
  └─────────────────────────────────────────────────────────────────────┘
       │ (如果没有 RT 任务)
       ▼
  ┌─────────────────────────────────────────────────────────────────────┐
  │  4. fair_sched_class    — 完全公平 (CFS/EEVDF)                      │
  │     • SCHED_NORMAL / SCHED_BATCH / SCHED_IDLE 策略                  │
  │     • 大多数进程的"默认"类                                           │
  │     • 使用 vruntime/deadline 实现公平                                │
  └─────────────────────────────────────────────────────────────────────┘
       │ (如果没有 FAIR 任务)
       ▼
  ┌─────────────────────────────────────────────────────────────────────┐
  │  5. idle_sched_class    — 空闲调度（最低）                          │
  │     • 每 CPU 单空闲线程                                              │
  │     • 仅当其他都无法运行时才运行                                      │
  │     • 确保 CPU 从不"无任务"                                          │
  └─────────────────────────────────────────────────────────────────────┘
```

### 遍历代码

```c
// kernel/sched/core.c — __pick_next_task()
static inline struct task_struct *__pick_next_task(struct rq *rq, struct rq_flags *rf)
{
    for_each_active_class(class) {
        p = class->pick_task(rq, rf);
        if (p)
            return p;
    }
    return idle_task;
}
```

`for_each_active_class()` 宏按优先级顺序遍历调度类链表。第一个返回非 NULL 任务指针的类获胜。这意味着：
- 单个 STOP 任务抢占一切
- 单个 DL 任务抢占 RT、FAIR 和 IDLE
- 单个 RT 任务抢占 FAIR 和 IDLE
- FAIR 任务仅在无 STOP、DL 或 RT 任务可运行时运行
- IDLE 仅作为最后手段运行

---

## STOP 类：不可阻挡

STOP 类在系统中具有最高优先级。每颗 CPU 恰好有一个 STOP 任务：

```c
// kernel/sched/stop_task.c
static struct task_struct *stop_task;

static struct task_struct *pick_task_stop(struct rq *rq, struct rq_flags *rf)
{
    return rq->stop;  // 如果存在则总是返回停止任务
}
```

STOP 任务用于：
- **CPU 热插拔**：将任务从正在下线的 CPU 迁移
- **CPU 迁移**：在 CPU 之间移动任务
- **停止机器**：需要所有 CPU 同步的操作

STOP 任务不能被任何东西抢占 —— 甚至不能被另一个 STOP 任务抢占。它运行到完成（或直到自愿让出）。

---

## DL 类：截止时间调度

DL 类实现 **EDF (Earliest Deadline First)** 与 **CBS (Constant Bandwidth Server)** 用于带宽隔离。

### 任务参数

每个 DL 任务有三个参数：
- **运行时 (Q)**：每周期需要的 CPU 时间
- **截止时间 (D)**：CPU 时间必须可用的时间
- **周期 (P)**：任务重复的频率

```c
// kernel/sched/sched.h — sched_dl_entity
struct sched_dl_entity {
    u64 runtime;        // 本周期剩余运行时
    u64 deadline;       // 绝对截止时间
    u64 period;         // 周期长度
    u64 flags;

    // ...
};
```

### CBS：带宽强制

没有 CBS，DL 任务可以通过设置 runtime = period 来垄断 CPU。CBS 强制带宽限制：

```c
// kernel/sched/deadline.c — task_tick_dl()
static void task_tick_dl(struct rq *rq, struct task_struct *p, int queued)
{
    struct sched_dl_entity *dl_se = &p->dl;

    // 减少剩余运行时
    dl_se->runtime -= rq->clock_task - p->se.exec_start;

    // 如果运行时耗尽，限流任务直到下一周期
    if (dl_se->runtime <= 0) {
        // 任务已用其带宽 — 重新调度
        resched_curr(rq);
    }
}
```

### EDF 选择

```c
// kernel/sched/deadline.c — pick_task_dl()
static struct task_struct *pick_task_dl(struct rq *rq, struct rq_flags *rf)
{
    struct sched_dl_entity *dl_se;
    struct task_struct *p;

    // 找到截止时间最早的任务
    dl_se = pick_earliest_dl_entity(rq);
    if (!dl_se)
        return NULL;

    p = dl_task_of(dl_se);
    return p;
}
```

DL 类维护一个按 deadline 排序的红黑树。最左节点（最早 deadline）总是被选中。

---

## RT 类：实时调度

RT 类处理 `SCHED_FIFO` 和 `SCHED_RR` 策略，固定优先级 0-99（99 最高）。

### FIFO vs RR

| 策略 | 行为 | 抢占 |
|------|------|------|
| SCHED_FIFO | 运行到阻塞或让出 | 仅由更高优先级 RT 任务抢占 |
| SCHED_RR | 运行一个时间片，然后轮转 | 更高优先级 RT 任务或时间片到期 |

### 优先级选择：`rt_prio_array`

```c
// kernel/sched/rt.c
struct rt_prio_array {
    DECLARE_BITMAP(bitmap, MAX_RT_PRIO+1);  // 每优先级一个位
    struct list_head queue[MAX_RT_PRIO];     // 每优先级一个队列
};

static struct task_struct *pick_next_rt_entity(struct rq *rq, struct rt_rq *rt_rq)
{
    struct rt_prio_array *array = &rt_rq->active;
    struct sched_rt_entity *next = NULL;
    struct list_head *queue;
    int idx;

    // 找到有可运行任务的最高优先级
    idx = sched_find_first_bit(array->bitmap, MAX_RT_PRIO);

    queue = array->queue + idx;
    next = list_first_entry(queue, struct sched_rt_entity, run_list);

    return rt_task_of(next);
}
```

`bitmap` 提供 O(1) 查找最高优先级非空队列。`sched_find_first_bit()` 是单条硬件指令（x86 上的 BSF/BSR）。

---

## FAIR 类：默认

FAIR 类是大多数开发者认为的"调度器"。它处理：
- `SCHED_NORMAL`：普通进程（默认）
- `SCHED_BATCH`：CPU 密集型批处理作业（更低优先级，更长时间片）
- `SCHED_IDLE`：极低优先级（仅当其他都不想要 CPU 时运行）

FAIR 类使用 CFS（旧内核）或 EEVDF（Linux 6.6+）进行任务选择。参见文章 6 了解完整的 EEVDF 分析。

```c
// kernel/sched/fair.c — pick_task_fair()
static struct task_struct *pick_task_fair(struct rq *rq, struct rq_flags *rf)
{
    struct cfs_rq *cfs_rq = &rq->cfs;
    struct sched_entity *se;

    if (!cfs_rq->nr_queued)
        return NULL;  // 无 FAIR 任务 — 让更低类尝试

    // EEVDF 选择 (Linux 6.6+)
    se = pick_eevdf(cfs_rq, true);

    return task_of(se);
}
```

---

## IDLE 类：最后手段

IDLE 类最简单 — 它总是返回每 CPU 的空闲线程：

```c
// kernel/sched/idle.c
static struct task_struct *pick_task_idle(struct rq *rq, struct rq_flags *rf)
{
    return idle_task;  // 总是返回空闲线程
}
```

空闲线程运行 `mwait` 或 `halt` 指令循环，将 CPU 置于低功耗状态直到中断唤醒它。

---

## 深度细节：SCX (Sched Class Ext)

Linux 6.13+ 引入 **SCX (Sched Class Ext)**，一个基于 BPF 的可扩展调度类：

```c
// kernel/sched/ext.c
DEFINE_SCHED_CLASS(ext) = {
    .name = "ext",
    .pick_task = scx_pick_task,
    .enqueue_task = scx_enqueue_task,
    .dequeue_task = scx_dequeue_task,
    .task_tick = scx_task_tick,
    // ...
};
```

SCX 插入到 RT 和 FAIR 之间：

```
STOP → DL → RT → SCX → FAIR → IDLE
```

BPF 程序可以实现自定义调度策略：
- 接管所有 FAIR 任务（`scx_switched_all()`）
- 实现工作窃取调度器
- 使用 BPF map 进行调度状态管理
- 实现比内置类更好的尾延迟

这是 Linux 调度的未来 — 运营商可以用自定义 BPF 调度器替代整个 FAIR 类而无需重新编译内核。

---

## 如何观测调度类

### 使用 chrt

```bash
// 查看进程的调度策略
chrt -p <pid>

// 将进程设为 SCHED_FIFO 优先级 50
chrt -f -p 50 <pid>

// 将进程设为 SCHED_DEADLINE
chrt -d --sched-runtime 10000000 --sched-deadline 20000000 --sched-period 20000000 0 ./my_app
```

### 使用 bpftrace

```bash
#!/usr/bin/env bpftrace
// trace_sched_class.bt

tracepoint:sched:sched_switch
{
    $cls = args->prev_policy;
    printf("Switch: %s (policy=%d) -> %s (policy=%d)\n",
           args->prev_comm, $cls, args->next_comm, args->next_policy);
}

kprobe:pick_next_task
{
    printf("[%s] pick_next_task called\n", comm);
}
```

### 使用 /proc

```bash
// 每进程调度信息
cat /proc/<pid>/sched | grep -E "policy|prio|nr_migrations"

// RT 任务信息
cat /proc/sys/kernel/sched_rt_period_us
cat /proc/sys/kernel/sched_rt_runtime_us
```

---

## 常见问题

### 如何将进程设为实时？
使用 `chrt -f -p <priority> <pid>` 设为 SCHED_FIFO 或 `chrt -r -p <priority> <pid>` 设为 SCHED_RR。优先级范围 1-99（99 最高）。

### RT 任务会饿死普通任务吗？
是的，如果 RT 任务无限循环运行，普通（FAIR）任务将永远不会运行。使用 `sched_rt_runtime_us` 限制 RT 带宽：`echo 950000 > /proc/sys/kernel/sched_rt_runtime_us` 将 RT 限制为 CPU 时间的 95%。

### SCHED_FIFO 和 SCHED_RR 有什么区别？
SCHED_FIFO 运行到任务阻塞或让出。SCHED_RR 运行一个时间片，然后与同优先级任务轮转。对简单实时任务用 FIFO，对应与同优先级对等方共享 CPU 的任务用 RR。

### 什么时候用 SCHED_DEADLINE？
当任务有明确时间约束时使用 SCHED_DEADLINE（例如"必须每 20ms 完成 5ms 计算"）。内核保证如果任务可调度（利用率 < 100%）则满足截止时间。

### SCX 是什么？什么时候用？
SCX (Sched Class Ext) 允许基于 BPF 的自定义调度器。当内置类不满足需求时使用 — 例如，你想要自定义工作窃取算法或专门的延迟保证。

---

## 总结

Linux 的调度类层级是一个严格的优先级金字塔：STOP > DL > RT > FAIR > IDLE。`__pick_next_task()` 函数从高到低遍历，第一个返回任务的类获胜。这确保关键任务（STOP、DL、RT）总是抢占不太重要的任务（FAIR、IDLE）。

理解这个层级对于实时系统、延迟敏感应用和系统调试至关重要。实际要点是：对硬实时需求用 RT，对截止时间约束任务用 DL，对其他一切用 FAIR。随着 SCX 的出现，Linux 调度的未来是可编程的。

---

## 来源

- Linux 内核源码, `kernel/sched/core.c`, `__pick_next_task()`
- Linux 内核源码, `kernel/sched/stop_task.c`, `pick_task_stop()`
- Linux 内核源码, `kernel/sched/deadline.c`, `pick_task_dl()`
- Linux 内核源码, `kernel/sched/rt.c`, `pick_next_rt_entity()`
- Linux 内核源码, `kernel/sched/fair.c`, `pick_task_fair()`
- Linux 内核源码, `kernel/sched/ext.c`, `scx_sched_class`
