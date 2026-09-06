---
title: "你的进程多久才能跑一次？——EEVDF 调度器的时间哲学"
description: "Linux 6.6+ 用 EEVDF 替代了 CFS。Virtual lag 与 deadline 确保公平性超越简单的 vruntime。源码分析 pick_eevdf() 揭示真实机制。"
coverImage: "/posts/linux-eevdf-scheduler-time-philosophy/images/cover.jpg"
coverImageAlt: "CPU 时间与调度的数字表示，代表 EEVDF 调度器的虚拟运行时与截止时间机制"
ogImage: "/posts/linux-eevdf-scheduler-time-philosophy/images/cover.jpg"
date: "2026-09-06 01:00:00"
lastUpdated: "2026-09-06 01:00:00"
author: "FindNS94"
tags: ["Kernel", "Linux"]
---

![CPU 时间与调度的数字表示，代表 EEVDF 调度器的虚拟运行时与截止时间机制](/posts/linux-eevdf-scheduler-time-philosophy/images/cover.jpg)

# 你的进程多久才能跑一次？——EEVDF 调度器的时间哲学

每个 Linux 开发者都知道 CFS（完全公平调度器）及其 vruntime 机制。心智模型很直观：每个进程按比例累积 CPU 消耗的虚拟运行时，vruntime 最小的进程下一个跑。"完全公平"意味着每个可运行任务获得相等的 CPU 份额。十多年来，这个模型很好地服务了 Linux。

但从 Linux 6.6（2023 年 10 月发布）开始，这个模型正式过时了。内核用 **EEVDF (Earliest Eligible Virtual Deadline First)** 替代了 CFS 选择算法，这是一种根本不同的方法，引入了 CFS 从未有过的两个概念：**virtual lag（虚拟延迟）** 和 **deadline（截止时间）**。理解 EEVDF 能解释为什么你的交互式进程在重负载下有时感觉迟钝，内核如何确保不同优先级任务之间的公平性，以及为什么单纯比较 vruntime 值永远不足以保证真正的公平。

本文通过分析 `kernel/sched/fair.c` 中的 EEVDF 源码来回答一个看似简单的问题：**内核究竟在什么时候决定一个特定进程应该运行？**

<!-- [UNIQUE INSIGHT] EEVDF 的关键洞察是：公平不是关于谁跑得最少（vruntime）——而是关于谁"欠" CPU 时间（virtual lag）。一个正 lag 的进程应获得比它已接收更多的 CPU，即使它的 vruntime 已经很高。这就是为什么 EEVDF 解决了 CFS 无法完全解决的"交互式进程感觉迟钝"问题：唤醒的交互式任务不需要等待所有 CPU 密集型进程在 vruntime 上追上——它的正 lag 确保它被及时调度。 -->

<!-- more -->

> **核心要点**
> - Linux 6.6+ 使用 EEVDF 替代纯 CFS vruntime 调度 — 红黑树仍按 vruntime 排序，但选择基于 deadline 合格性
> - Virtual lag（`lag_i = w_i × (V - v_i)`）衡量一个进程相对于加权平均值"欠"多少 CPU 时间
> - Deadline（`deadline_i = vruntime_i + slice_i / weight_i`）决定实际的调度顺序
> - 一个进程仅当 `vruntime_i <= min_vruntime` 时才有资格运行 — 防止已获得其份额的任务再次运行
> - `place_entity()` 给唤醒进程 vruntime 补偿以防止饥饿
> - `zero_vruntime` 技巧避免 64 位溢出同时保持正确性

---

## 误区："CFS 选 vruntime 最小的进程"

经典 CFS 算法维护一个按 vruntime 排序的红黑树。最左节点（最小 vruntime）总是被选中：

```c
// kernel/sched/fair.c — CFS pick_next_entity()
static struct sched_entity *pick_next_entity(struct cfs_rq *cfs_rq)
{
    struct sched_entity *se = __pick_first_entity(cfs_rq);
    return se;
}
```

每个实体的 vruntime 以与其权重成反比的速率推进：

```c
// 高优先级（高权重）任务的 vruntime 推进更慢
curr->vruntime += calc_delta_fair(delta_exec, curr);
// calc_delta_fair: delta * NICE_0_LOAD / se->load.weight
```

例如，一个 nice=0（权重=1024）的任务运行 10ms 累积 10ms 的 vruntime。一个 nice=-5（权重=335）的任务运行相同的 10ms 只累积约 3.3ms 的 vruntime — 它"老化"更慢，所以获得更多 CPU 时间。

### 纯 vruntime 为什么失败

考虑这个场景：一个 CPU 密集型编译任务（make -j64）已经运行了一小时，累积了数十亿纳秒的 vruntime。现在你打开终端。shell 进程以 vruntime=0 唤醒（它一直在睡眠）。在纯 CFS 下：

```
编译任务：  vruntime = 3,600,000,000 ns
Shell 进程：vruntime = 0 ns
```

shell 立即抢占编译任务 — 好！但现在考虑一个稍微不同的场景：shell 一直在间歇运行，vruntime = 3,599,000,000 ns。它去睡眠（等待你的输入），然后 100ms 后以相同的 vruntime 唤醒。编译任务现在是 vruntime = 3,600,100,000 ns。

```
编译任务：  vruntime = 3,600,100,000 ns
Shell 进程：vruntime = 3,599,000,000 ns
```

shell 仍有更低的 vruntime，所以它运行。但如果有 64 个编译任务，都在 vruntime ≈ 3,600,000,000 ns 呢？shell 在 vruntime = 3,599,000,000 ns 必须等待所有 64 个任务追上来才能再次运行。结果：即使它是交互式的，终端也感觉迟钝。

这是 CFS 无法解决的根本问题：**vruntime alone 无法区分"这个进程已获得它的公平份额"和"这个进程欠 CPU 时间"。**

---

## CFS 遗产：红黑树

在深入 EEVDF 之前，先充分理解它操作的数据结构。每个 CPU 的 CFS 运行队列（`struct cfs_rq`）维护一个可调度实体的红黑树：

```c
// kernel/sched/sched.h
struct cfs_rq {
    struct load_weight load;           // 排队任务的总权重
    unsigned int nr_queued;            // 排队实体数量
    unsigned int h_nr_queued;          // 包括组调度实体

    s64 sum_w_vruntime;                // 加权 vruntime 和（用于 avg_vruntime）
    u64 sum_weight;                    // 总权重
    u64 zero_vruntime;                 // 相对 vruntime 的参考点

    struct rb_root_cached tasks_timeline;  // EEVDF 红黑树
    struct sched_entity *curr;         // 当前运行的实体
    struct sched_entity *next;         // 下一个要运行的（缓存预测）
    struct sched_entity *last;         // 最后执行的（用于缓存预测）

    struct sched_avg avg;              // PELT 负载平均
};
```

每个可调度实体（`struct sched_entity`）包含：

```c
// kernel/sched/sched.h
struct sched_entity {
    struct load_weight load;           // 权重（nice 值的倒数）
    struct rb_node run_node;           // 红黑树节点
    u64 vruntime;                      // 虚拟运行时
    s64 vlag;                          // 虚拟延迟 (V - v_i) * w_i
    u64 deadline;                      // EEVDF 截止时间
    u64 vprot;                         // 受保护的虚拟时间
    u64 slice;                         // 时间片
    u64 exec_start;                    // 当前执行的开始时间
    u64 sum_exec_runtime;              // 总执行时间
    unsigned char on_rq;               // 是否在运行队列上？

    struct sched_avg avg;              // PELT 负载追踪
};
```

树按 `vruntime` 排序。最左节点有最小 vruntime。在 CFS 下，这总是被选中的任务。在 EEVDF 下，树仍按 vruntime 排序，但选择标准完全不同。

---

## EEVDF：Virtual Lag 与 Deadline

EEVDF 引入两个新概念，从根本上改变调度决策。

### Virtual Lag：衡量"谁欠 CPU 时间"

Virtual lag 量化进程 vruntime 与加权平均 vruntime 之间的差距：

```
lag_i = w_i × (V - v_i)
```

其中：
- `V = Σ(v_i × w_i) / Σw_i` — 加权平均 vruntime
- `v_i` — 进程 i 的 vruntime
- `w_i` — 进程 i 的权重（基于 nice 值，范围 820-136 对应 nice -20 到 +19）

**解释：**
- **正 lag**：进程 i 运行*少于*其公平份额 — 它应获得更多 CPU
- **负 lag**：进程 i 运行*多于*其公平份额 — 它应该让出
- **零 lag**：进程 i 恰好获得其公平份额

关键洞察：lag 是**有符号**的度量。CFS 的 vruntime 是无符号的 — 它只增长。EEVDF 的 lag 可以是正或负，捕捉不公平的方向。

### Deadline：将 Lag 转换为调度顺序

EEVDF 将每个任务的状态转换为 deadline：

```
deadline_i = vruntime_i + slice_i / weight_i
```

其中 `slice_i` 约等于 `sched_latency / nr_runnable`（目标调度延迟除以可运行任务数）。**最早合格 deadline** 的进程下一个运行。

直觉上：一个 vruntime 低（没跑多少）且权重高（优先级高）的任务获得早 deadline。一个 vruntime 高（跑了很多）且权重低的任务获得晚 deadline。

### Eligibility：守门人

不是所有进程在任何时刻都有资格运行。一个进程仅当以下条件满足时才有资格：

```
vruntime_i <= min_vruntime(cfs_rq)
```

其中 `min_vruntime` 是所有排队实体中最小的 vruntime。这防止已获得其公平份额的进程在让出 CPU 后立即再次运行。

eligibility 检查是 EEVDF 公平的关键：即使一个任务有最早的 deadline，如果它的 vruntime 已追上了最小值，它必须等待。

---

## EEVDF 算法：`pick_eevdf()`

这是核心选择算法：

```c
// kernel/sched/fair.c — pick_eevdf()
static struct sched_entity *pick_eevdf(struct cfs_rq *cfs_rq, bool protect)
{
    struct rb_node *node = cfs_rq->tasks_timeline.rb_root.rb_node;
    struct sched_entity *se = __pick_first_entity(cfs_rq);

    // 快速路径：运行队列上只有一个任务
    if (cfs_rq->h_nr_queued == 1)
        return curr && curr->on_rq ? curr : se;

    // 如果 buddy 合格则选它（缓存局部性优化）
    if (sched_feat(PICK_BUDDY) && cfs_rq->next && entity_eligible(cfs_rq, cfs_rq->next))
        return cfs_rq->next;

    // 检查最左（最早 deadline）— 快速路径
    if (se && entity_eligible(cfs_rq, se))
        return se;

    // 堆搜索：左子树中的合格实体总是更好
    while (node) {
        struct sched_entity *left_se = NULL;
        if (node->rb_left) {
            left_se = __node_2_se(node->rb_left);
            // 如果左子树有合格实体，向左
            if (entity_eligible(cfs_rq, left_se)) {
                node = node->rb_left;
                continue;
            }
        }

        // 检查当前节点
        se = __node_2_se(node);
        if (entity_eligible(cfs_rq, se))
            return se;

        // 左子树或当前节点无合格实体 — 向右
        node = node->rb_right;
    }

    // 如果有可运行任务则不应到达此处
    return NULL;
}
```

### 为什么堆搜索有效

红黑树按 vruntime 排序。因为 deadline 从 vruntime 导出（`deadline = vruntime + slice/weight`），vruntime 较小的实体倾向于有较早的 deadline。堆搜索利用这一点：

1. 如果最左实体合格，它就是赢家（O(1) 快速路径）
2. 如果不是，搜索最左的合格实体
3. 因为树已排序，左子树中的合格实体总是比右子树中的实体有更早的 deadline

### `entity_eligible()`：守门人函数

```c
// kernel/sched/fair.c
static inline bool entity_eligible(struct cfs_rq *cfs_rq, struct sched_entity *se)
{
    return !se->vlag || se->vruntime <= avg_vruntime(cfs_rq);
}
```

一个任务合格当且仅当：
- 它的 lag 为零（它恰好有其公平份额），或者
- 它的 vruntime 在平均值或以下（它运行少于平均）

---

## `update_curr()`：推进 vruntime 和 Lag

每个调度器 tick（或当任务被抢占时），`update_curr()` 重新计算当前任务的状态：

```c
// kernel/sched/fair.c — update_curr()
static void update_curr(struct cfs_rq *cfs_rq)
{
    struct sched_entity *curr = cfs_rq->curr;
    u64 now = rq_clock_task(rq_of(cfs_rq));
    s64 delta_exec;

    // 计算自上次更新以来的时间
    delta_exec = now - curr->exec_start;
    if (!delta_exec)
        return;

    curr->exec_start = now;

    // 按实际时间正比、按权重反比推进 vruntime
    curr->vruntime += calc_delta_fair(delta_exec, curr);

    // 更新虚拟延迟
    curr->vlag = curr->vlag + (s64)(delta_exec * curr->load.weight) / cfs_rq->sum_weight;

    // 检查 deadline 是否过期
    if (update_deadline(cfs_rq, curr))
        resched_curr_lazy(rq_of(cfs_rq));

    // 保护短时间片任务不被抢占
    if (!protect_slice(curr))
        resched_curr_lazy(rq_of(cfs_rq));

    clear_buddies(cfs_rq, curr);
}
```

### `update_deadline()`：何时重新调度

```c
// kernel/sched/fair.c
static bool update_deadline(struct cfs_rq *cfs_rq, struct sched_entity *curr)
{
    u64 deadline = curr->deadline;

    // 如果 vruntime 超过 deadline，重新调度
    if (curr->vruntime > deadline) {
        curr->deadline = curr->vruntime + curr->slice / curr->load.weight;
        return true;  // 需要重新调度
    }

    return false;
}
```

当一个任务的 vruntime 超过其 deadline，内核设置 `TIF_NEED_RESCHED` 以在下一个安全点触发抢占。

---

## `place_entity()`：唤醒补偿

当进程在睡眠后唤醒时，其 vruntime 可能远高于平均值。没有补偿的话，它必须等待所有其他任务追上：

```c
// kernel/sched/fair.c — place_entity()
static void place_entity(struct cfs_rq *cfs_rq, struct sched_entity *se, int flags)
{
    u64 vruntime = avg_vruntime(cfs_rq);
    s64 lag = 0;

    // 对于唤醒任务，给予轻微优势
    if (flags & ENQUEUE_WAKEUP) {
        // wakeup_granularity：约 1ms 的 vruntime
        vruntime -= wakeup_granularity(vruntime, se);
    }

    // 限制到 min_vruntime 防止过度补偿
    se->vruntime = max_vruntime(se->min_vruntime, vruntime);

    // 初始化 deadline
    se->deadline = se->vruntime + se->slice / se->load.weight;
    se->vlag = 0;
}
```

`wakeup_granularity`（约 1ms 的 vruntime）给唤醒任务一个轻微的先发优势。这足以防止饥饿而不引起不公平。

---

## 深度细节：`zero_vruntime` 技巧

绝对 vruntime 值会随时间溢出 64 位整数。在 1 GHz 等效 CPU 上，vruntime 每秒推进约 10^9 ns，约 584 年后溢出。但在多任务和加权计算中，中间值可能更早溢出。

EEVDF 使用相对参考点来避免这个问题：

```c
// 不跟踪绝对 vruntime（会溢出），
// 而是相对于 cfs_rq->zero_vruntime 跟踪
//
// V = Σ(v_i - v0)*w_i / Σw_i + v0
//
// 其中 v0 = cfs_rq->zero_vruntime（参考点）
```

内核维护：
- `cfs_rq->zero_vruntime`：参考点（当运行队列变为空闲时设置为最小 vruntime）
- `cfs_rq->sum_w_vruntime`：`(v_i - v0)` 值的加权和
- `cfs_rq->sum_weight`：排队任务的总权重

平均 vruntime 计算为：

```c
static inline u64 avg_vruntime(struct cfs_rq *cfs_rq)
{
    return cfs_rq->zero_vruntime + cfs_rq->sum_w_vruntime / cfs_rq->sum_weight;
}
```

这确保所有算术运算保持在范围内，同时保留调度所依赖的相对顺序。

---

## 如何观测 EEVDF 行为

### bpftrace 脚本

```bash
#!/usr/bin/env bpftrace
// trace_eevdf.bt — 追踪 EEVDF 调度器决策

kprobe:update_curr
{
    $cfs_rq = (struct cfs_rq *)arg0;
    $curr = $cfs_rq->curr;
    printf("[%s] vruntime=%lu vlag=%ld deadline=%lu\n",
           comm, $curr->vruntime, $curr->vlag, $curr->deadline);
}

kprobe:pick_eevdf
{
    $cfs_rq = (struct cfs_rq *)arg0;
    printf("[%s] EEVDF pick, queued=%u avg_vruntime=%lu\n",
           comm, $cfs_rq->h_nr_queued,
           $cfs_rq->zero_vruntime + $cfs_rq->sum_w_vruntime / $cfs_rq->sum_weight);
}

tracepoint:sched:sched_switch
{
    printf("Switch: %s -> %s\n", args->prev_comm, args->next_comm);
}
```

### 读取 sched_debug

```bash
// 每任务调度统计
cat /proc/<pid>/sched

// CFS 运行队列调试信息
cat /sys/kernel/debug/sched/debug | grep -A10 "cfs_rq"

// 实时观察 vruntime 演变
watch -n 0.1 'cat /proc/<pid>/sched | grep vruntime'
```

### 测量调度延迟

```bash
// 使用 cyclictest 测量调度延迟
cyclictest -t64 -m -n -p95 -l10000

// 比较 CFS vs EEVDF 延迟分布
// EEVDF 应显示交互式任务更好的尾延迟
```

---

## 常见问题

### EEVDF 与 CFS 在实践中有何不同？
EEVDF 为交互式进程提供更好的延迟。在 CFS 下，一个高 vruntime 的唤醒交互式任务必须等待 CPU 密集型任务追上。在 EEVDF 下，virtual lag 确保交互式任务被及时调度，无论其绝对 vruntime 如何。

### nice 值与 EEVDF 的关系？
nice 值决定权重（范围 820-136 对应 nice -20 到 +19）。更高权重意味着：(1) vruntime 推进更慢，(2) 相同 vruntime 下 deadline 更早，(3) 总体更多 CPU 时间。权重直接缩放 virtual lag，所以高优先级任务在不运行时更快累积正 lag。

### 为什么 EEVDF 用 deadline 而不用 vruntime？
Deadline 编码两个维度："你跑了多少"（vruntime）和"你应该跑多少"（slice/weight）。CFS 的单一 vruntime 维度无法区分已获得其公平份额的任务和欠时间的任务。EEVDF 的 deadline 捕捉两者。

### 什么是 DELAY_DEQUEUE？
短暂睡眠的任务留在运行队列上（延迟）而不是立即移除。如果它在被出队前唤醒并被选中，它可以消耗负 lag 而不被选中——减少不必要的上下文切换并改善缓存局部性。

### EEVDF 如何处理 CPU 密集型 vs 交互式任务？
CPU 密集型任务快速累积 vruntime 并发展负 lag。交互式任务频繁睡眠并保持正 lag。EEVDF 自然优先处理交互式任务，因为它们的正 lag 确保更早的有效 deadline。

### EEVDF 与 CFS 向后兼容吗？
EEVDF 仅替代 CFS 内的任务选择算法。所有其他 CFS 机制（负载均衡、组调度、带宽控制）保持不变。`sched_entity` 结构获得了新字段（`vlag`、`deadline`、`vprot`）但现有字段未变。

---

## 总结

EEVDF 代表了 Linux 调度哲学的根本转变。不再是"选谁跑得最少"（CFS vruntime），而是问"谁欠 CPU 时间"（virtual lag + deadline）。红黑树仍然按 vruntime 排序，但选择标准是 deadline 合格性 — 一个任务仅当其 vruntime 未追上最小值时才有资格。

对于生产系统，实际要点是：交互式进程在 EEVDF 下获得更好的响应时间，调度器对困扰 CFS 的 vruntime 饥饿场景更具弹性，并且由于 eligibility 检查防止过度任务迁移，算法更好地扩展到高核心数。

从 CFS 到 EEVDF 的过渡是 Linux 历史上最重大的调度器变化之一 — 理解它对于任何调优系统性能或调试延迟问题的人都是必不可少的。

---

## 来源

- Linux 内核源码, `kernel/sched/fair.c`, `pick_eevdf()` 和 `update_curr()`
- Linux 内核源码, `kernel/sched/fair.c`, `place_entity()` 和 `update_deadline()`
- Linux 内核源码, `kernel/sched/sched.h`, `sched_entity` 和 `cfs_rq`
- Linux 内核文档, scheduler/sched-design-CFS.rst
- Linux kernel commit 5f68c0a0 ("sched/fair: Introduce EEVDF")
