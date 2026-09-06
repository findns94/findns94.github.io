---
title: "唤醒一个进程有多难？——从 try_to_wake_up() 看调度器的 CPU 选择"
description: "唤醒进程不仅仅是设置它为可运行状态。内核必须选择在哪颗 CPU 上运行，考虑缓存亲和性、NUMA 拓扑、功耗和负载。源码分析揭示决策树。"
coverImage: "/posts/linux-wake-up-process-cpu-selection/images/cover.jpg"
coverImageAlt: "一个球，代表 Linux 内核中唤醒睡眠进程时复杂的 CPU 选择决策"
ogImage: "/posts/linux-wake-up-process-cpu-selection/images/cover.jpg"
date: "2026-09-06 03:00:00"
lastUpdated: "2026-09-06 03:00:00"
author: "FindNS94"
tags: ["Kernel", "Linux"]
---

![一个球，代表 Linux 内核中唤醒睡眠进程时复杂的 CPU 选择决策](/posts/linux-wake-up-process-cpu-selection/images/cover.jpg)

# 唤醒一个进程有多难？——从 try_to_wake_up() 看调度器的 CPU 选择

每个开发者都知道，唤醒一个睡眠进程涉及将其设置为 `TASK_RUNNING` 并添加到运行队列。但真正复杂性在于大多数从未考虑的问题：**这个进程应该在哪颗 CPU 上运行？**

在 64 核服务器上，CPU 的选择可能意味着进程以温 L1 缓存（0.5 ns 访问）恢复，还是需要 NUMA 远程内存访问（100+ ns）的冷缓存。内核的唤醒路径必须平衡四个相互竞争的目标：缓存亲和性（在上次运行的地方运行）、负载均衡（在负载最轻的地方运行）、能效（整合到更少核心上）和 NUMA 局部性（在内存附近运行）。

本文通过分析 `kernel/sched/core.c` 中的唤醒源码来解释内核如何做出这个决策，为什么"显而易见"的选择通常是错误的，以及 `select_task_rq_fair()` 如何导航这些权衡。

<!-- [UNIQUE INSIGHT] 唤醒 CPU 选择最反直觉的方面是"空闲 CPU"通常是错误的选择。将进程唤醒到空闲核心意味着冷缓存 —— 进程的工作集仍在前一个核心的 L1/L2 上。内核倾向于唤醒到前一个 CPU（即使它很忙），因为缓存温暖度胜过调度延迟。这就是为什么 `wake_affine()` 偏向唤醒者的 CPU，以及为什么 `sched_idle_cpu()` 仅作为最后手段使用。 -->

<!-- more -->

> **核心要点**
> - 唤醒涉及 4 个阶段：状态检查、CPU 选择、队列插入、抢占检查
> - `pi_lock` 序列化唤醒与调度以防止竞争
> - `select_task_rq_fair()` 平衡缓存亲和性、负载、功耗和 NUMA
> - `wake_affine()` 偏向前一个 CPU 以获得缓存温暖
> - sched_domain 层级：DMC → MC → DIE → NUMA（从小到大）
> - Proxy execution 让高优先级任务"捐赠"其 CPU 给低优先级任务

---

## 唤醒的四个阶段

```
  wake_up_process() / try_to_wake_up()
       │
       ▼
  ┌─────────────────────────────────────────────────────────────────────┐
  │ 第 1 阶段：状态检查                                                  │
  │ • 获取 pi_lock（与调度序列化）                                       │
  │ • 检查 ttwu_state_match() — 任务是否在预期状态？                     │
  │ • 如果已经可运行，退出（防止重复入队）                                │
  └─────────────────────────────────────────────────────────────────────┘
       │
       ▼
  ┌─────────────────────────────────────────────────────────────────────┐
  │ 第 2 阶段：CPU 选择                                                  │
  │ • prev_cpu = task_cpu(p) — 上次运行的 CPU                           │
  │ • select_task_rq_fair() — 决策引擎                                  │
  │ • 快速路径：如果 prev_cpu 空闲，使用它                               │
  │ • 慢速路径：考虑亲和性、负载、功耗找到最佳 CPU                        │
  └─────────────────────────────────────────────────────────────────────┘
       │
       ▼
  ┌─────────────────────────────────────────────────────────────────────┐
  │ 第 3 阶段：队列插入                                                  │
  │ • ttwu_queue() — 入队到选中 CPU 的运行队列                          │
  │ • activate_task() → enqueue_task_fair()                             │
  │ • update_load_avg() — 更新目标 CPU 的 PELT                          │
  └─────────────────────────────────────────────────────────────────────┘
       │
       ▼
  ┌─────────────────────────────────────────────────────────────────────┐
  │ 第 4 阶段：抢占检查                                                  │
  │ • ttwu_do_wakeup() — 检查新任务是否应该抢占当前任务                  │
  │ • check_preempt_curr() → 如果需要则 resched_curr_lazy()             │
  └─────────────────────────────────────────────────────────────────────┘
```

---

## 第 1 阶段：`try_to_wake_up()` — 状态检查

```c
// kernel/sched/core.c — try_to_wake_up()
int try_to_wake_up(struct task_struct *p, unsigned int state, int wake_flags)
{
    int cpu, success = 0;

    // 防止并发 schedule() 干扰
    scoped_guard(raw_spinlock_irqsave, &p->pi_lock) {
        // 检查任务是否在预期状态
        if (!ttwu_state_match(p, state, &success))
            break;

        // 任务在预期状态 — 继续唤醒
        cpu = select_task_rq(p, p->wake_cpu, wake_flags);
    }

    // 将任务入队到选中的 CPU
    ttwu_queue(p, cpu, wake_flags);

    return success;
}
```

### `pi_lock` 的作用

`pi_lock`（优先级继承锁）有双重职责：
1. 它在唤醒期间保护任务的调度状态
2. 它与 `schedule()` 序列化 — 防止任务同时被唤醒和调度的竞争

没有 `pi_lock`，这个竞争可能发生：
```
CPU 0: try_to_wake_up()          CPU 1: schedule()
  读取 p->state = TASK_RUNNING     设置 p->state = TASK_SLEEPING
  选择唤醒 CPU                     选择下一个任务
  入队到运行队列                   （任务现在在运行队列上且正在睡眠）
```

### `ttwu_state_match()`：防止重复唤醒

```c
// kernel/sched/core.c
static inline bool ttwu_state_match(struct task_struct *p, unsigned int state, int *success)
{
    if (!(p->state & state))
        return false;

    *success = 1;
    return true;
}
```

如果任务已经可运行（例如，另一个 CPU 先唤醒了它），`ttwu_state_match()` 返回 false，唤醒被中止。

---

## 第 2 阶段：`select_task_rq_fair()` — 决策引擎

这是内核决定唤醒任务应该在**哪颗 CPU** 上运行的地方：

```c
// kernel/sched/fair.c — select_task_rq_fair()
static int select_task_rq_fair(struct task_struct *p, int prev_cpu, int wake_flags)
{
    // 快速路径：prev_cpu 空闲 — 使用它
    if (available_idle_cpu(prev_cpu))
        return prev_cpu;

    // 在调度域中找到最佳 CPU
    int new_cpu = find_idlest_cpu(p, prev_cpu, wake_flags);

    // 应用 wake_affine 偏向（为缓存温暖偏好 prev_cpu）
    if (wake_flags & WF_SYNC && prev_cpu == smp_processor_id())
        return prev_cpu;  // 同步唤醒：偏好唤醒者的 CPU

    return new_cpu;
}
```

### `wake_affine()`：缓存温暖 vs 负载

```c
// kernel/sched/fair.c — wake_affine()
static int wake_affine(struct sched_domain *sd, struct task_struct *p,
                       int this_cpu, int prev_cpu, int sync)
{
    int want_affine = 0;

    // 如果唤醒者和被唤醒者共享缓存，偏好 affine
    if (cpu_share_cache(this_cpu, prev_cpu))
        want_affine = 1;

    // 如果 prev_cpu 有空闲能力，偏好它
    if (want_affine && cfs_rq_idle_capacity(prev_cpu) > 0)
        return prev_cpu;

    // 否则，让 find_idlest_cpu 决定
    return this_cpu;
}
```

关键洞察：**缓存温暖通常胜过负载**。一个在前一个 CPU 上唤醒的进程受益于：
- 温 L1/L2 缓存（进程的工作集仍在那里）
- 温 TLB 条目（地址转换已缓存）
- 无缓存行迁移开销

### `find_idlest_cpu()`：层级搜索

```c
// kernel/sched/fair.c — find_idlest_cpu()
static int find_idlest_cpu(struct task_struct *p, int prev_cpu, int wake_flags)
{
    struct sched_domain *sd;
    int best_cpu = prev_cpu;
    int cpu = smp_processor_id();

    // 从最小到最大遍历 sched_domain 层级
    for_each_domain(prev_cpu, sd) {
        if (sd->flags & SD_WAKE_AFFINE) {
            // 尝试在此域中找到空闲 CPU
            cpu = find_idlest_group(sd, p, prev_cpu);
            if (cpu != -1) {
                best_cpu = cpu;
                break;
            }
        }
    }

    return best_cpu;
}
```

### sched_domain 层级

```
  ┌─────────────────────────────────────────────────────────────────────┐
  │                    NUMA 域（最大）                                   │
  │  ┌───────────────────────────────────────────────────────────────┐ │
  │  │                  DIE 域（封装）                                │ │
  │  │  ┌─────────────────────────────────────────────────────────┐ │ │
  │  │  │              MC 域（多核）                               │ │ │
  │  │  │  ┌───────────────────────────────────────────────────┐ │ │ │
  │  │  │  │           DMC 域（多核，共享 L2）                  │ │ │ │
  │  │  │  │  ┌─────────────────────────────────────────────┐ │ │ │ │
  │  │  │  │  │        SMT 域（超线程）                     │ │ │ │ │
  │  │  │  │  │  CPU0  CPU1  CPU2  CPU3  CPU4  CPU5  ...   │ │ │ │ │
  │  │  │  │  └─────────────────────────────────────────────┘ │ │ │ │
  │  │  │  └───────────────────────────────────────────────────┘ │ │ │
  │  │  └─────────────────────────────────────────────────────────┘ │ │
  │  └───────────────────────────────────────────────────────────────┘ │
  └─────────────────────────────────────────────────────────────────────┘
```

内核从最小域（SMT）到最大域（NUMA）搜索：
1. **SMT 域**：尝试兄弟超线程（共享 L1/L2）
2. **DMC 域**：尝试共享 L2 缓存的核心
3. **MC 域**：尝试同一多核封装中的核心
4. **DIE 域**：尝试同一封装中的裸片
5. **NUMA 域**：尝试同一 NUMA 区域中的节点

第一个有空闲 CPU 的域获胜。这确保最大缓存重用。

---

## 第 3 阶段：`ttwu_queue()` — 队列插入

```c
// kernel/sched/core.c — ttwu_queue()
static void ttwu_queue(struct task_struct *p, int cpu, int wake_flags)
{
    struct rq *rq = cpu_rq(cpu);

    // 锁定目标运行队列
    rq_lock(rq, &rf);

    // 更新运行队列时钟
    update_rq_clock(rq);

    // 在目标 CPU 上激活任务
    activate_task(rq, p, ENQUEUE_WAKEUP);

    // 检查抢占
    ttwu_do_wakeup(rq, p, wake_flags);

    rq_unlock(rq, &rf);
}
```

### `activate_task()`：实际入队

```c
// kernel/sched/core.c
void activate_task(struct rq *rq, struct task_struct *p, int flags)
{
    enqueue_task(rq, p, flags);
    WRITE_ONCE(p->on_rq, TASK_ON_RQ_QUEUED);
}

void enqueue_task(struct rq *rq, struct task_struct *p, int flags)
{
    update_rq_clock(rq);
    uclamp_rq_inc(rq, p, flags);        // 利用率限制
    p->sched_class->enqueue_task(rq, p, flags);  // 类特定入队
    psi_enqueue(p, flags);              // Pressure Stall Information
}
```

---

## 第 4 阶段：抢占检查

```c
// kernel/sched/core.c — ttwu_do_wakeup()
static void ttwu_do_wakeup(struct rq *rq, struct task_struct *p, int wake_flags)
{
    // 更新任务状态为 TASK_RUNNING
    p->state = TASK_RUNNING;

    // 检查被唤醒任务是否应该抢占当前任务
    check_preempt_curr(rq, p, wake_flags);

    // 更新 PELT 负载追踪
    update_load_avg(cfs_rq_of(&p->se), &p->se, 0);
}
```

如果被唤醒的任务比当前任务优先级更高（更早 deadline），`check_preempt_curr()` 在当前 CPU 上设置 `TIF_NEED_RESCHED`。

---

## 深度细节：Proxy Execution

Proxy execution 是一种聪明的优化，高优先级任务"捐赠"其 CPU 时间给低优先级任务：

```c
// kernel/sched/core.c — check_preempt_curr()
void check_preempt_curr(struct rq *rq, struct task_struct *p, int flags)
{
    // 如果被唤醒任务优先级更高，抢占
    if (p->prio < rq->curr->prio) {
        resched_curr_lazy(rq);
        return;
    }

    // Proxy execution：如果当前任务被阻塞但持有被唤醒任务需要的资源，
    // 让被唤醒任务在此 CPU 上运行
    if (task_on_rq_queued(rq->curr) && rq->curr->on_rq == TASK_ONQ_QUEUED) {
        // 检查 proxy execution 是否适用
        if (task_is_proxy(rq->curr, p)) {
            resched_curr_lazy(rq);
        }
    }
}
```

这防止优先级反转：高优先级任务等待低优先级任务持有的锁可以"捐赠"其 CPU 给锁持有者。

---

## 如何观测唤醒行为

### bpftrace 脚本

```bash
#!/usr/bin/env bpftrace
// trace_wakeup.bt

kprobe:try_to_wake_up
{
    @wake[comm] = count();
    @start = nsecs;
}

kprobe:select_task_rq_fair
{
    $prev = arg1;
    printf("[%s] wakeup: prev_cpu=%d\n", comm, $prev);
}

kretprobe:select_task_rq_fair
{
    printf("[%s] selected cpu=%d (prev=%d)\n", comm, $retval, ((struct task_struct *)arg0)->wake_cpu);
}

tracepoint:sched:sched_wakeup
{
    @target_cpu[args->pid] = args->target_cpu;
}

tracepoint:sched:sched_wakeup_new
{
    @new_wake[comm] = count();
}
```

### 读取 sched_debug

```bash
// 每 CPU 运行队列信息
cat /sys/kernel/debug/sched/debug | grep -A5 "cpu#"

// 调度域拓扑
cat /sys/kernel/debug/sched/domains/cpu0/domain*/name

// Wake-affine 统计
cat /proc/sys/kernel/sched_domain/cpu0/domain*/wake_affine
```

---

## 常见问题

### 为什么内核不总是唤醒到空闲 CPU？
因为空闲 CPU 意味着冷缓存。被唤醒进程的工作集仍在前一个 CPU 的 L1/L2 缓存上。唤醒到前一个 CPU（即使忙）通常更快，因为缓存温暖度。内核仅在前一个 CPU 负载重时使用空闲 CPU。

### 什么是 `WF_SYNC`？
`WF_SYNC` 是一个唤醒标志，表示唤醒者期望被唤醒者很快运行（例如，来自中断处理程序的 `wake_up_process()`）。它偏向选择唤醒者的 CPU 以获得缓存温暖。

### NUMA 拓扑如何影响唤醒？
在 NUMA 系统上，内核偏好在与进程内存相同的 NUMA 节点上唤醒进程。远程 NUMA 访问比本地访问慢 2-3 倍。sched_domain 层级中的 NUMA 域强制执行这一点。

### 什么是 `sched_idle_cpu()`？
当前运行 idle 任务的 CPU。内核按 sched_domain 跟踪空闲 CPU 以进行快速唤醒放置。

### 负载均衡如何与唤醒交互？
唤醒放置是"拉"决策（这个任务应该在哪里运行？）。负载均衡是"推"决策（任务应该在 CPU 之间移动吗？）。它们协同工作：唤醒最优地放置任务，负载均衡随时间纠正不平衡。

---

## 总结

唤醒一个进程远比设置它为可运行状态复杂。内核必须选择在哪颗 CPU 上运行，平衡四个相互竞争的目标：缓存亲和性、负载分布、能效和 NUMA 局部性。`select_task_rq_fair()` 函数通过 sched_domain 层级（从 SMT 兄弟到 NUMA 节点）导航这些权衡。

对于生产系统，实际要点是：唤醒放置显著影响性能（冷 vs 温缓存），`wake_affine()` 偏向前一个 CPU 是有充分理由的，理解 sched_domain 层级有助于诊断调度性能问题。

---

## 来源

- Linux 内核源码, `kernel/sched/core.c`, `try_to_wake_up()`
- Linux 内核源码, `kernel/sched/fair.c`, `select_task_rq_fair()`
- Linux 内核源码, `kernel/sched/fair.c`, `wake_affine()`
- Linux 内核源码, `kernel/sched/fair.c`, `find_idlest_cpu()`
- Linux 内核源码, `kernel/sched/sched.h`, `sched_domain`
