---
title: "PELT 的数学——内核如何量化\"负载\""
description: "CPU 负载不是 CPU 使用率。PELT 使用 32ms 半衰期的指数移动平均来跟踪每任务负载。源码分析 __accumulate_pelt_segments() 揭示数学原理。"
coverImage: "/posts/linux-pelt-load-tracking-math/images/cover.jpg"
coverImageAlt: "一个球，代表 PELT 用于追踪 Linux 内核 CPU 负载的指数移动平均计算"
ogImage: "/posts/linux-pelt-load-tracking-math/images/cover.jpg"
date: "2026-09-06 05:00:00"
lastUpdated: "2026-09-06 05:00:00"
author: "FindNS94"
tags: ["Linux", "Kernel", "Scheduler"]
---

![一个球，代表 PELT 用于追踪 Linux 内核 CPU 负载的指数移动平均计算](/posts/linux-pelt-load-tracking-math/images/cover.jpg)

# PELT 的数学——内核如何量化"负载"

每个系统管理员都见过 CPU 负载平均值：`load average: 1.23, 0.89, 0.67`。大多数人将其解释为"CPU 使用率百分比"。这是错误的。负载不是使用率 —— 它是**需求**的度量：如果任务有 CPU 时间，它们会做多少工作。阻塞在 I/O 上的任务仍然贡献负载，因为当 I/O 完成时它*想要* CPU。

Linux 的负载追踪系统，**PELT (Per-Entity Load Tracking)**，是负载均衡、频率调节和容量规划背后的数学引擎。它回答一个微妙的问题："这个任务*应得*多少 CPU 时间？"答案决定了调度器是否在 CPU 之间迁移任务，CPU 频率调节器是否提升频率，以及系统是否"过载"。

本文通过分析 `kernel/sched/pelt.c` 中的 PELT 源码来解释指数移动平均数学、32ms 半衰期、容量/频率缩放，以及使这一切足够快以在每个调度器 tick 运行的近似方法。

<!-- [UNIQUE INSIGHT] PELT 最优雅的方面是使用整数算术和位移来近似指数衰减。内核从不直接计算 `y^n` —— 它使用恒等式 `y^32 ≈ 0.5` 将指数衰减转换为简单的移位加法操作。这使得 PELT 足够快以在每颗 CPU 上每 1ms 调度器 tick 运行。 -->

<!-- more -->

> **核心要点**
> - 负载 ≠ CPU 使用率：负载度量*需求*（任务会做什么），使用率度量*消耗*（它们做了什么）
> - PELT 使用 32ms 半衰期的指数移动平均：近期活动比旧的更重要
> - 公式：`load = load * y + active * (1 - y)` 其中 `y ≈ 0.978` 每毫秒
> - `y^32 ≈ 0.5` 通过位移启用纯整数近似
> - 容量缩放归一化异构 CPU（big.LITTLE）上的负载
> - 频率缩放考虑 DVFS：不同频率下相同工作 = 不同负载

---

## 误区："负载 = CPU 使用率"

运行 `top` 你会看到两个不同的数字：
- **CPU 使用率**：45%（CPU 45% 的时间在忙）
- **负载平均值**：2.34（相当于 2.34 个任务同时想要 CPU）

它们度量根本不同的东西：

| 指标 | 度量什么 | 包含阻塞任务？ |
|------|---------|---------------|
| CPU 使用率 | CPU 活跃时间 | 否 |
| 负载平均值 | 对 CPU 的需求 | 是的 |

阻塞在磁盘 I/O 上的任务对 CPU 使用率贡献 0%，但对负载平均值贡献约 1.0（当 I/O 完成时它想要 CPU）。这就是为什么有许多 I/O 绑定任务的系统可以有高负载但低 CPU 使用率。---

## 指数移动平均：数学

PELT 将负载建模为指数移动平均（EMA）：

```
load(n) = load(n-1) * y + active * (1 - y)
```

其中：
- `y` = 衰减因子（≈ 0.978 每毫秒）
- `active` = 如果任务在运行为 1，睡眠为 0
- `load(n)` = 时间步 n 的负载

### 32ms 半衰期

衰减因子 `y` 的选择使得 32ms 前的活动贡献当前活动的一半：

```
y^32 = 0.5
y = 0.5^(1/32) ≈ 0.9785
```

这意味着：
- 现在的活动：权重 1.0
- 32ms 前的活动：权重 0.5
- 64ms 前的活动：权重 0.25
- 320ms 前的活动：权重 0.001（实际上已遗忘）

32ms 半衰期是一个折中：足够短以快速响应负载变化，足够长以平滑短暂尖峰。

### 可视化衰减

```
  负载
  1.0 ┤ ████
      │ ████
  0.5 ┤ ████ ████
      │ ████ ████
  0.25┤ ████ ████ ████
      │ ████ ████ ████
  0.0 ┤ ████ ████ ████ ████ ████ ████ ████ ████
      └──┬───┬───┬───┬───┬───┬───┬───┬───┬──→
        0  32  64  96  128 160 192 224 256  ms
      └──┘   └──┘   └──┘   └──┘   └──┘   └──┘
     半衰期  半衰期  半衰期  半衰期  半衰期  半衰期
```

---

## `__accumulate_pelt_segments()`：实现

内核不直接计算 `y^n` —— 那需要浮点算术。它使用整数近似：

```c
// kernel/sched/pelt.c — __accumulate_pelt_segments()
static u32 __accumulate_pelt_segments(u64 periods, u32 d1, u32 d3)
{
    u64 p_half = periods >> 1;      // periods / 2
    u64 p_quarter = periods >> 2;    // periods / 4

    /*
     * 使用恒等式近似 y^periods：
     * y^32 ≈ 0.5
     * y^n ≈ (1 - n/32) 对于小的 n
     *
     * d1：有活动的时间（全额贡献）
     * d3：无活动的时间（衰减）
     */
    return d1 + p_half * d2 / 32 + p_quarter * d3 / 64;
}
```

### 为什么这个近似有效

`periods` 个 tick 的精确衰减公式是：

```
y^periods = (0.5)^(periods/32)
```

对于小的 `periods`，这近似线性：

```
y^periods ≈ 1 - periods/32
```

内核使用分段线性近似：
- `d1`（活跃期）：以全额权重贡献
- `d2`（半权重期）：以约 0.5 权重贡献
- `d3`（四分之一权重期）：以约 0.25 权重贡献

这完全避免了浮点运算 —— 所有算术都是整数加法/移位/乘法。

---

## `update_load_avg()`：每 Tick 更新

```c
// kernel/sched/fair.c — update_load_avg()
void update_load_avg(struct cfs_rq *cfs_rq, struct sched_entity *se, int flags)
{
    u64 now = cfs_rq->clock_pelt;
    u64 delta;

    // 计算自上次更新以来的时间
    delta = now - se->avg.last_update_time;
    if (!delta)
        return;

    // 累积到 3 个段（活跃、半权、四分之一权）
    __accumulate_pelt_segments(delta >> 24,   // periods（每个 = 2^24 ns ≈ 16ms）
                              d1, d2, d3);

    // 更新负载平均
    se->avg.util_avg = decay_load(se->avg.util_avg, periods)
                     + active * CONTRIBUTION;

    // 传播到 cfs_rq 和 rq 级别
    cfs_rq_load_avg(cfs_rq);
    rq_load_avg(rq_of(cfs_rq));
}
```

PELT 在三个级别追踪负载：
1. **每任务**（`sched_entity->avg`）：单个任务负载
2. **每 cfs_rq**（`cfs_rq->avg`）：运行队列中所有任务的总和
3. **每 rq**（`rq->avg`）：CPU 上的总负载

---

## 容量与频率缩放

### 问题：异构 CPU

在 big.LITTLE 系统上，"小"核心在 1.0 GHz 和"大"核心在 2.5 GHz 具有非常不同的容量。使用小核心 50% 容量的任务只使用大核心容量的 20%。PELT 必须归一化这些不同容量上的负载。

### 容量缩放

```c
// kernel/sched/pelt.c — scale_load()
static inline u64 scale_load_down(unsigned long load, unsigned int capacity)
{
    return (load * capacity) >> SCHED_CAPACITY_SHIFT;
}
```

`capacity` 范围 0-1024（1024 = 最大容量）。在小核心（capacity=384）上运行的任务的负载被缩放到其原始值的 37.5%。

### 频率缩放

```c
// kernel/sched/pelt.c — cap_scale()
static inline u64 cap_scale(u64 delta, unsigned int capacity)
{
    return (delta * capacity) >> SCHED_CAPACITY_SHIFT;
}
```

当 CPU 频率变化（DVFS）时，相同的工作量对负载的贡献不同：
- 在 2.5 GHz：1ms 工作 = 负载 1.0
- 在 1.0 GHz：1ms 工作 = 负载 0.4（相同工作，更低频率）

### 组合缩放

```c
// kernel/sched/pelt.c — 带缩放的 update_load_avg()
delta = cap_scale(delta, arch_scale_cpu_capacity(cpu));
delta = cap_scale(delta, arch_scale_freq_capacity(cpu));
```

最终负载值同时考虑了 CPU 的固有容量（大 vs 小）和当前频率（DVFS）。

---

## 深度细节：长空闲衰减

当任务长时间空闲时，其负载应衰减至零。但指数衰减永远不会恰好达到零 —— 它只是接近。PELT 使用实际截止：

```c
// kernel/sched/pelt.c
#define LOAD_AVG_PERIOD 32
#define LOAD_AVG_MAX 47742  // 最大负载平均值

static inline unsigned long decay_load(unsigned long val, unsigned long n)
{
    unsigned int local_n;

    if (val < 0)
        return 0;

    if (n > LOAD_AVG_MAX_FACTOR)
        return 0;  // 约 345ms 后，负载实际上为零

    return val >> n;  // 长空闲期的快速衰减
}
```

在不活动约 345ms（11 个半衰期）后，负载被视为零。这防止陈旧负载值影响调度决策。

---

## 如何观测 PELT 行为

### 读取 /proc

```bash
// 每任务负载平均
cat /proc/<pid>/sched | grep -E "load_avg|util_avg"

// CPU 负载平均
cat /proc/loadavg

// 每 CPU 负载
cat /sys/devices/system/cpu/cpu0/sched_load_avg
```

### 使用 bpftrace

```bash
#!/usr/bin/env bpftrace
// trace_pelt.bt

kprobe:update_load_avg
{
    $se = (struct sched_entity *)arg1;
    printf("[%s] util=%lu load=%lu\n",
           comm, $se->avg.util_avg, $se->avg.load_avg);
}

tracepoint:sched:sched_load_avg_cpu
{
    @util[args->cpu] = args->util_avg;
    @load[args->cpu] = args->load_avg;
}
```

### 使用 ftrace

```bash
// 启用 PELT 追踪
echo 1 > /sys/kernel/debug/tracing/events/sched/sched_pelt_se/enable
echo 1 > /sys/kernel/debug/tracing/events/sched/sched_pelt_cfs/enable
cat /sys/kernel/debug/tracing/trace_pipe
```

---

## 常见问题

### 负载和使用率的区别是什么？
使用率度量 CPU 活跃的时间。负载度量需求 —— 如果任务有 CPU 时间它们*会做*什么。阻塞任务贡献负载但不贡献使用率。

### 为什么半衰期是 32ms？
32ms 是响应性和稳定性之间的折中。更短的半衰期（例如 8ms）会更快响应负载变化但对短暂尖峰更敏感。更长的半衰期（例如 128ms）会更平滑但响应更慢。

### PELT 如何处理 CPU 频率变化？
当频率变化时，`arch_scale_freq_capacity()` 返回不同的缩放因子。在较低频率下相同的工作量贡献更少的负载，反映 CPU 在该频率下具有更少的容量。

### 最大负载值是多少？
`LOAD_AVG_MAX = 47742`（归一化到 1024 时约 47.7）。这表示在最快速核心上以最大容量连续运行的任务。

### PELT 如何与负载均衡交互？
调度器比较 CPU 之间的 `rq->avg.load_avg`。如果一个 CPU 的负载明显更高，调度器迁移任务以平衡负载。PELT 提供驱动这些决策的负载值。

---

## 总结

PELT 是 Linux 负载追踪的数学基础。它使用 32ms 半衰期的指数移动平均来量化每个任务*应得*多少 CPU 时间。实现通过巧妙的整数近似避免浮点算术，使其足够快以在每个调度器 tick 运行。

对于生产系统，实际要点是：负载不是使用率（阻塞任务贡献负载），32ms 半衰期平衡响应性和稳定性，容量/频率缩放确保异构 CPU 之间的公平比较。理解 PELT 有助于诊断负载均衡问题、频率调节行为和容量规划决策。

---

## 来源

- Linux 内核源码, `kernel/sched/pelt.c`, `__accumulate_pelt_segments()`
- Linux 内核源码, `kernel/sched/pelt.h`, `update_load_avg()`
- Linux 内核源码, `kernel/sched/fair.c`, `update_load_avg()`
- Linux 内核文档, scheduler/sched-stats.rst
