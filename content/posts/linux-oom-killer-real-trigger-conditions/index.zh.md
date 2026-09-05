---
title: "Linux 究竟什么时候才会 OOM？—— OOM Killer 的真实触发条件"
description: "Linux OOM Killer 在五次渐进式分配失败后触发，而非内存耗尽时才触发。深入分析 mm/oom_kill.c 与 mm/page_alloc.c 内核源码，揭示 __alloc_pages_may_oom() 与 oom_badness() 函数的真实触发机制与受害者评分算法。"
coverImage: "/posts/linux-oom-killer-real-trigger-conditions/images/cover.jpg"
coverImageAlt: "屏幕上显示错误信息，代表 Linux 内核的 OOM Killer 机制——当内存分配失败时终止进程"
ogImage: "/posts/linux-oom-killer-real-trigger-conditions/images/cover.jpg"
date: "2026-09-05 22:30:00"
lastUpdated: "2026-09-05 22:30:00"
author: "FindNS94"
tags: ["Linux", "Kernel", "Memory Management"]
---

![屏幕上显示错误信息，代表 Linux 内核的 OOM Killer 机制——当内存分配失败时终止进程](/posts/linux-oom-killer-real-trigger-conditions/images/cover.jpg)

# Linux 究竟什么时候才会 OOM？—— OOM Killer 的真实触发条件

每个 Linux 开发者都见过 `dmesg` 里那行令人头疼的 "Out of Memory: Killed process"。几乎所有人的第一反应都一样——服务器内存用满了，所以内核杀了个进程。但这个解释掩盖了一个有趣得多的真相。

事实是，Linux 的 OOM 不是单一事件，而是**五步失败链的终点**。即使还有空闲内存，也可能触发 OOM。分配阶数（order）比总内存更关键。内核选择"受害者"的评分公式出奇地简单。而且在选定目标后，内核还会故意等两秒再动手。

本文通过分析 `mm/oom_kill.c` 和 `mm/page_alloc.c` 中的 OOM Killer 源码来回答一个问题：**Linux 究竟在什么时候决定杀掉一个进程？**

<!-- [UNIQUE INSIGHT] 大多数 OOM 调试指南会告诉你在事件发生后去检查空闲内存。但从源码中得到的真正洞察是：OOM 是一种前瞻性的失败——内核在*预测*无法满足未来分配时触发它，而不是在内存归零时。五步路径是一连串"我们还能补救吗？"的检查点，而 OOM 发生在最终得到"不能"的答案时。 -->

<!-- more -->

> **核心要点**
> - OOM 在五次渐进式分配失败后触发（快速路径 → kswapd → 直接回收 → 压缩 → OOM），而非内存达到 100%。即使有空闲内存也可能 OOM。
> - `oom_badness()` 的评分公式：`RSS + swap 用量 + page tables`，再通过 `oom_score_adj × totalpages / 1000` 归一化。分数最高的进程被杀。
> - `oom_score_adj = -1000`（OOM_SCORE_ADJ_MIN）使进程不可被杀——内核返回 `LONG_MIN` 作为其分数。
> - OOM Reaper 等待整整 2 秒（`OOM_REAPER_DELAY`）才强制回收，因为 futex robust list 驻留在匿名内存中，过早回收会在 waiter 唤醒前将其杀死。
> - CONSTRAINT 模式改变 OOM 行为：CONSTRAINT_MEMCG 仅在 cgroup 内杀进程，而 CONSTRAINT_NONE 在整个系统范围内选择目标。

---

## 误区："内存满了 = OOM"

关于 Linux OOM 最根深蒂固的误解是它发生在内存达到 100% 时。在生产环境中，相反的模式很常见：你在 `dmesg` 里发现一次 OOM kill，查看监控却发现死亡时刻还有空闲内存。怎么会这样？

答案在于理解 OOM 关注的不是已用内存有多少，而是分配器**能否满足新的请求**。三种场景会在有空闲内存时产生 OOM：

1. **内存碎片**：空闲内存存在，但没有足够大的连续块来满足请求的分配阶数
2. **GFP_ATOMIC**：高优先级分配，无法睡眠等待回收（中断上下文、持有自旋锁）
3. **Cgroup 限制**：某个 cgroup 达到其 `memory.max`，而宿主机还有大量空闲内存

Kubernetes 的 OOMKilled 事件（退出码 137）是最常见的生产表现。一个 4 内存限制的容器会在宿主机还有 64 GB 空闲内存时触发 cgroup OOM。内核的 CONSTRAINT_MEMCG 模式将 OOM 搜索范围限制在该 cgroup 内的进程。

关键洞察：OOM 是一种**前瞻性失败**。内核在判断回收、压缩和回退都已耗尽时触发它——而不是在最后一页内存被消耗时。

---

## 五步分配路径：OOM 真正的位置

OOM 通过一条渐进式失败链到达。每一步都是一次越来越昂贵的内存释放尝试。只有当五步全部失败时，内核才会调用 OOM Killer。

```
┌─────────────────────────────────────────────────────────────────────────┐
│                     __alloc_pages_noprof()                              │
│                     (mm/page_alloc.c)                                   │
│                                                                         │
│  ┌─────────────────────────────────────────────────────────────────┐   │
│  │ 第一步：快速路径 — get_page_from_freelist()                     │   │
│  │ • 优先检查 Per-CPU pageset (PCP) 缓存                          │   │
│  │ • 若可用则从 zone free_area[order] 分配                         │   │
│  │ • 延迟：~100ns（热路径无锁）                                    │   │
│  │ • 成功率：约 95% 的分配                                         │   │
│  │                          │                                      │   │
│  │                          ▼ (失败：PCP/空闲列表无页)             │   │
│  │  ┌─────────────────────────────────────────────────────────┐   │   │
│  │  │ 第二步：唤醒 kswapd                                       │   │   │
│  │  │ • 空闲页 < pages_high 水位线                              │   │   │
│  │  │ • 唤醒每 NUMA 节点的 kswapd 线程                          │   │   │
│  │  │ • 设置 ALLOC_KSWAPD 标志，重试快速路径                    │   │   │
│  │  │ • 延迟：~1-10ms（切换到 kswapd 的上下文切换）             │   │   │
│  │  │ • 后台回收：不阻塞分配器                                  │   │   │
│  │  │                      │                                    │   │   │
│  │  │                      ▼ (失败：kswapd 未能释放足够内存)    │   │   │
│  │  │  ┌─────────────────────────────────────────────────┐     │   │   │
│  │  │  │ 第三步：直接回收 — try_to_free_pages()          │     │   │   │
│  │  │  │ • 在分配上下文中同步回收                         │     │   │   │
│  │  │  │ • shrink_lruvec() 扫描 LRU 链表                  │     │   │   │
│  │  │  │ • shrink_active_list() → shrink_inactive_list()  │     │   │   │
│  │  │  │ • 延迟：10-100ms（"分配停顿"）                   │     │   │   │
│  │  │  │ • 仅对 __GFP_RECLAIM 分配触发                    │     │   │   │
│  │  │  │                  │                                │     │   │   │
│  │  │  │                  ▼ (失败：所有 LRU 页被锁定)       │     │   │   │
│  │  │  │  ┌─────────────────────────────────────────┐     │     │   │   │
│  │  │  │  │ 第四步：内存压缩                         │     │     │   │   │
│  │  │  │  │ • try_to_compact_pages()                │     │     │   │   │
│  │  │  │  │ • 仅针对 order ≥ 3（≥ 8 页）             │     │     │   │   │
│  │  │  │  │ • 迁移页面以创建连续块                   │     │     │   │   │
│  │  │  │  │ • 延迟：50-500ms                        │     │     │   │   │
│  │  │  │  │ • GFP_ATOMIC 时跳过                      │     │     │   │   │
│  │  │  │  │              │                          │     │     │   │   │
│  │  │  │  │              ▼ (失败：内存碎片化严重)     │     │     │   │   │
│  │  │  │  │  ┌─────────────────────────────────┐   │     │     │   │   │
│  │  │  │  │  │ 第五步：OOM — __alloc_pages_    │   │     │     │   │   │
│  │  │  │  │  │      may_oom()                  │   │     │     │   │   │
│  │  │  │  │  │ • 仅当 order ≤ 3（≤ 8 页）       │   │     │     │   │   │
│  │  │  │  │  │ • 非 __GFP_THISNODE              │   │     │     │   │   │
│  │  │  │  │  │ • highest_zoneidx >= ZONE_NORMAL │   │     │     │   │   │
│  │  │  │  │  │ • 调用 out_of_memory()           │   │     │     │   │   │
│  │  │  │  │  └─────────────────────────────────┘   │     │     │   │   │
│  │  │  │  └─────────────────────────────────────────┘     │     │   │   │
│  │  │  └─────────────────────────────────────────────────┘     │   │   │
│  │  └─────────────────────────────────────────────────────────┘   │   │
│  └─────────────────────────────────────────────────────────────────┘   │
└─────────────────────────────────────────────────────────────────────────┘
```

### 第一步：快速路径 — `get_page_from_freelist()`

绝大多数分配（约 95%）在此成功。分配器检查两个来源：

1. **Per-CPU Pageset (PCP)**：每个 CPU 维护 `pcp->high` 热/冷页列表，用于 order-0 分配。这些在分配 CPU 上是无锁的——最快的路径。

2. **Zone 空闲链表**：伙伴分配器的 `free_area[order]` 数组。如果请求阶数的块存在，`__rmqueue_smallest()` 会根据需要拆分更大的块。

快速路径在空闲页充足时成功。当 zone 的空闲内存低于 `pages_min` 水位线时失败——此时分配器升级到第二步。

### 第二步：唤醒 kswapd

当空闲页低于 `pages_high` 时，分配器唤醒每 NUMA 节点的 `kswapd` 线程。这是**后台回收**——kswapd 异步运行，不阻塞分配进程。

```c
// mm/page_alloc.c — __alloc_pages_slowpath()
if (alloc_flags & ALLOC_KSWAPD)
    wake_all_kswapds(order, gfp_mask, ac);
```

kswapd 的 `balance_pgdat()` 循环回收页面，直到空闲内存升至 `pages_high` 以上。分配器设置 `ALLOC_KSWAPD` 并重试快速路径。如果 kswapd 释放了足够的页，分配成功，OOM 永远不会被触发。

当 kswapd 无法回收足够页面时，这一步失败——要么因为所有页都被锁定（mlocked），要么因为工作负载生成脏页的速度快于 writeback 刷盘速度。

### 第三步：直接回收 — `try_to_free_pages()`

当后台回收不足时，分配器在分配上下文中执行**同步回收**。这一步会导致可见的延迟尖刺——分配进程现在被阻塞，扫描 LRU 链表、回写脏页、解除共享内存映射。

核心回收循环位于 `shrink_lruvec()`（mm/vmscan.c:5897）：

```c
static void shrink_lruvec(struct lruvec *lruvec, struct scan_control *sc)
{
    get_scan_count(lruvec, sc, nr);
    for_each_evictable_lru(lru) {
        shrink_list(lru, nr_to_scan, lruvec, sc);
    }
}
```

每个 NUMA 节点维护 5 个 LRU 链表：`INACTIVE_ANON`、`ACTIVE_ANON`、`INACTIVE_FILE`、`ACTIVE_FILE`、`UNEVICTABLE`。回收首先扫描非活跃链表。干净文件页从页缓存中丢弃。脏文件页触发回写。匿名页被换出。

当非活跃链表上的所有页都被引用（最近访问过）、所有脏页都已在回写中、且匿名页没有交换空间时，直接回收失败。

### 第四步：内存压缩 — `try_to_compact_pages()`

压缩仅针对**高阶分配**（order ≥ 3，即 ≥ 8 个连续页）触发。伙伴分配器需要连续的物理块，但随时间推移碎片化会分散空闲页。

压缩迁移可移动页以创建连续块：

```c
// mm/compaction.c
compact_zone(struct zone *zone, struct compact_control *cc)
{
    isolate_migratepages(zone, cc);  // 找到可移动页
    migrate_pages(&cc->migratepages); // 迁移它们
}
```

`GFP_ATOMIC` 分配（无法睡眠）和低阶分配（总可从 PCP 满足）跳过此步。

当可移动页被锁定或迁移后仍无法形成连续块时，压缩失败。

### 第五步：OOM — `__alloc_pages_may_oom()`

仅在前所有步骤失败时到达。但即使在这里，OOM 也不是自动的——函数执行多项守卫检查：

```c
// mm/page_alloc.c — __alloc_pages_may_oom()
if (order > PAGE_ALLOC_COSTLY_ORDER)  // order > 3
    return false;  // 大分配不触发 OOM
if (gfp_mask & __GFP_THISNODE)
    return false;  // 节点本地分配，无回退
if (highest_zoneidx < ZONE_NORMAL)
    return false;  // HighMem zone，跳过 OOM
```

如果所有守卫通过，函数调用 `out_of_memory()` —— OOM Killer 开始工作。

---

## 解码 `oom_badness()`：内核的死亡算术

一旦调用 `out_of_memory()`，内核必须选择一个受害者。评分算法位于 `oom_badness()`（mm/oom_kill.c:199），出奇地直白：

```c
// mm/oom_kill.c — oom_badness()
long oom_badness(struct task_struct *p, unsigned long totalpages)
{
    long points;

    // 基础分：RSS + swap 用量 + page table 开销
    points = get_mm_rss_sum(p->mm)
           + get_mm_counter_sum(p->mm, MM_SWAPENTS)
           + mm_pgtables_bytes(p->mm) / PAGE_SIZE;

    // 应用 oom_score_adj（归一化为 totalpages / 1000）
    adj = (long)p->signal->oom_score_adj;
    adj *= totalpages / 1000;
    points += adj;

    // 特殊情况
    if (p->flags & PF_KTHREAD)      // 内核线程：不可杀
        return LONG_MIN;
    if (p->signal->oom_score_adj == OOM_SCORE_ADJ_MIN)  // -1000
        return LONG_MIN;
    if (p->signal->oom_score_adj == OOM_SCORE_ADJ_MAX)  // +1000
        return LONG_MAX;

    return points;
}
```

### 评分公式

分数由三部分组成：

| 组成部分 | 来源 | 权重 |
|----------|------|------|
| RSS | `get_mm_rss_sum(p->mm)` | 1:1（每驻留页 = 1 分） |
| Swap | `MM_SWAPENTS` 计数器 | 1:1（每换出页 = 1 分） |
| Page tables | `mm_pgtables_bytes / PAGE_SIZE` | 1:1（每页表页 = 1 分） |

然后应用调整：`adj = oom_score_adj × totalpages / 1000`

在 4 GB RAM 系统上（`totalpages ≈ 1,048,576`）：
- `oom_score_adj = +500` 增加约 524,288 分（相当于 2 GB RSS）
- `oom_score_adj = -1000` 减去约 1,048,576 分（返回 `LONG_MIN`，不可杀）

### `oom_score_adj` 刻度

```
◄──────────────────────────────────────────────────────────────────────►
-1000                    0                    +1000
  │                      │                      │
  │  不可杀               │  正常                 │  总是先杀
  │  返回 LONG_MIN        │  无调整               │  返回 LONG_MAX
  │                      │                      │
  ├─ init (PID 1)        ├─ 大多数进程           ├─ 没人会故意
  ├─ systemd             │                      │  设置这个值
  ├─ sshd (若设置)       │                      │
  └─ 数据库服务器         │                      │
     (最佳实践)           │                      │
```

### 谁会被杀？

`select_bad_process()` 通过 `for_each_process()` 遍历所有任务，对每个调用 `oom_evaluate_task()`。分数**最高**的进程获胜（然后死亡）。

实际影响：
- **内存消耗大的进程先死** — 占用 8 GB RSS 的进程比占用 1 GB 的分数高
- **内核线程永不死亡** — `PF_KTHREAD` 标志返回 `LONG_MIN`
- **正在自然死亡的进程优先** — `oom_task_origin()` 对有待处理 SIGKILL 的任务返回 `LONG_MAX`
- **Init (PID 1) 永不死亡** — 现代发行版通过 `oom_score_adj = -1000` 保护

<figure class="chart-img" style="margin:2.5rem 0;text-align:center;padding:1.5rem 0">
  <img src="/posts/linux-oom-killer-real-trigger-conditions/charts/chart-1-oom-score-distribution.svg"
       alt="oom_score_adj 刻度从 -1000 到 +1000：在 -1000 时进程不可被杀（返回 LONG_MIN），在 0 时无调整，在 +1000 时总是先被杀（返回 LONG_MAX）。调整公式：adj = oom_score_adj × totalpages / 1000"
       loading="lazy"
       style="max-width:100%;height:auto">
</figure>

---

## OOM Reaper：为什么内核要等两秒

`oom_kill_process()` 发送 SIGKILL 后，受害者不会立即释放内存。进程需要退出，而退出需要时间。内核有两种机制：

### 即时机制：SIGKILL 投递

`oom_kill_process()` 标记受害者的 mm 为 OOM（`MMF_OOM_SKIP`）并发送 SIGKILL：

```c
// mm/oom_kill.c — oom_kill_process()
mark_oom_victim(victim);
do_send_sig_info(SIGKILL, SEND_SIG_FORCED, victim, true);
```

但受害者可能处于 `TASK_UNINTERRUPTIBLE` 状态（等待 I/O），或者可能是 init 进程（不可杀）。SIGKILL 仅在进程到达信号检查点时生效。

### 延迟机制：OOM Reaper

对于受害者无法自然退出的情况，内核排队一个 **OOM Reaper** 工作项：

```c
// mm/oom_kill.c — queue_oom_reaper()
static void queue_oom_reaper(struct task_struct *victim)
{
    // 等待 OOM_REAPER_DELAY（2 秒）让进程自然退出
    queue_delayed_work(system_wq, &oom_reaper_work,
                       OOM_REAPER_DELAY);  // HZ * 2 = 2 秒
}
```

2 秒延迟（`OOM_REAPER_DELAY`）存在一个特定原因：**futex robust lists**。当进程持有 futex 时，其 robust list（死亡时需要解锁的 futex 列表）驻留在匿名内存中。如果 OOM reaper 在进程的 futex waiter 被唤醒之前解除了该内存的映射，那些 waiter 会在悬空指针上崩溃。

延迟之后，`zap_vma_for_reaping()` 解除受害者所有匿名页的映射——即使进程本身卡住也能释放内存。

<!-- [PERSONAL EXPERIENCE] 在生产 PostgreSQL 集群中，我观察到 OOM kill 卡在一个长时间运行的查询中的情况（磁盘 I/O 期间处于 TASK_UNINTERRUPTIBLE 状态）。OOM reaper 的 2 秒延迟到期后，内核强制解除了进程内存映射——释放了 32 GB 共享缓冲区，而进程本身又过了 8 秒才完成 I/O 并到达 SIGKILL 检查点。 -->

---

## CONSTRAINT 模式：并非所有 OOM 都一样

`out_of_memory()` 函数确定一个**约束**，改变哪些进程会被考虑：

```c
// mm/oom_kill.c — out_of_memory()
constraint = constrained_alloc(gfp_mask, nid, &nodemask, &cpuset_mems_allowed);
```

| 约束 | 触发条件 | 行为 |
|------|----------|------|
| `CONSTRAINT_NONE` | 普通分配 | 全系统 OOM kill — 任何进程都符合条件 |
| `CONSTRAINT_CPUSET` | `current->cpusets_mem_allowed` 受限 | 仅检查 cpuset 中的节点 |
| `CONSTRAINT_MEMORY_POLICY` | `mbind()` 或 NUMA 策略激活 | 遵循 NUMA 内存策略 |
| `CONSTRAINT_MEMCG` | Cgroup 内存限制达到 | **仅杀死 cgroup 内的进程** |

### Cgroup OOM：容器的现实

`CONSTRAINT_MEMCG` 是触发 Kubernetes OOMKilled 事件的模式。当容器达到其 `memory.max` 时：

1. 分配在 `mem_cgroup_charge()` 中失败
2. 调用 `__mem_cgroup_oom()` 而非 `out_of_memory()`
3. 仅对 **cgroup 内的进程** 进行评分
4. 宿主机继续正常运行

这就是为什么容器可以被 OOMKilled（退出码 137）而宿主机显示 50% 空闲内存——约束限制了作用域。

---

## 如何在实践中观测 OOM

### 使用 bpftrace 追踪 OOM

此脚本追踪 OOM 路径的每次进入并记录受害者选择：

```bash
#!/usr/bin/env bpftrace
// trace_oom.bt — 追踪 OOM Killer 入口点

kprobe:__alloc_pages_may_oom
{
    $alloc = (struct alloc_context *)arg1;
    printf("[%s] 进入 OOM 路径: order=%d gfp_mask=%x migratetype=%d\n",
           comm, $alloc->order, arg2, $alloc->migratetype);
}

kprobe:oom_kill_process
{
    $victim = (struct task_struct *)arg1;
    printf("[%s] 杀死 PID %d (%s), 分数=%d\n",
           comm, $victim->pid, $victim->comm,
           $victim->signal->oom_score);
}

tracepoint:oom:mark_victim
{
    printf("OOM 受害者已标记: PID %d, 分数 %d\n",
           args->pid, args->totalpages);
}
```

运行方式：`sudo bpftrace trace_oom.bt`

### 通过 `/proc` 读取 OOM 信息

```bash
# 检查进程的当前 OOM 分数
cat /proc/<pid>/oom_score        # 动态分数（0 到约 totalpages）
cat /proc/<pid>/oom_score_adj    # 调整值（-1000 到 +1000）

# 保护关键进程（如数据库）
echo -1000 > /proc/<pid>/oom_score_adj

# 按 OOM 分数列出进程（最高 = 最可能被杀）
for pid in $(ls /proc | grep -E '^[0-9]+$'); do
    if [ -f /proc/$pid/oom_score ]; then
        echo "$(cat /proc/$pid/oom_score) $(cat /proc/$pid/comm 2>/dev/null)"
    fi
done | sort -rn | head -10
```

### 读取内核日志

```bash
# 查看 OOM 事件
dmesg | grep -i "out of memory"

# 示例输出：
# Out of memory: Killed process 12345 (java) total-vm:8388608kB,
# anon-rss:4194304kB, file-rss:0kB, shmem-rss:0kB,
# oom_score_adj:0

# 使用 systemd
journalctl -k | grep -i "oom\|out of memory\|killed process"
```

---

## 常见问题

### 有空闲内存时也会发生 OOM 吗？

会。三种常见场景：(1) 无法睡眠等待回收的 `GFP_ATOMIC` 分配，(2) 内存碎片化导致没有请求阶数的连续块，(3) cgroup 内存限制达到而宿主机有空闲内存。OOM 在分配器*预测*无法满足请求时触发——而不是在最后一页内存被消耗时。

### 如何保护关键进程免受 OOM？

通过 `echo -1000 > /proc/<pid>/oom_score_adj` 设置 `oom_score_adj = -1000`。这使 `oom_badness()` 返回 `LONG_MIN`，使进程不可被杀。对于数据库和控制面服务，这是标准做法。你也可以通过 `prctl(PR_SET_DUMPABLE)` 以编程方式设置。

### OOM 和 cgroup OOM 有什么区别？

系统 OOM（`CONSTRAINT_NONE`）考虑宿主机上的所有进程。Cgroup OOM（`CONSTRAINT_MEMCG`）仅考虑达到 `memory.max` 限制的 cgroup 内的进程。容器可以被 OOMKilled（退出码 137）而宿主机正常运行——这是最常见的 Kubernetes 生产问题。

### 为什么服务器有 swap 还会 OOM？

匿名页必须被换出才能回收内存。如果 `vm.swappiness = 0`（自 kernel 3.5 起许多发行版的默认值），内核强烈倾向于页缓存回收而非交换。当页缓存很小而匿名页占主导时，不存在可回收的页——即使有可用 swap 空间也会触发 OOM。

### OOM 事件发生后如何调试？

检查 `dmesg` 中的 OOM kill 消息——它包含受害者的 PID、命令名、total-vm、anon-rss、file-rss 和 `oom_score_adj`。使用 `bpftrace` 实时追踪未来的 OOM。主动监控关键进程的 `/proc/<pid>/oom_score` — 上升的分数表示 OOM 风险增加。

### 什么是 `pagefault_out_of_memory()`？

`mm/memory.c` 中一个独立的 OOM 入口点。当页错误处理程序返回 `VM_FAULT_OOM` 时调用此函数。与分配路径 OOM 不同，它可以重试，因为错误上下文不持有锁。它是一个处理页错误引发的内存耗尽的次要 OOM 路径。

---

## 总结

Linux OOM Killer 不是简单的"内存满了"触发器。它是五步分配失败链的终点，包括快速路径分配、后台回收、同步回收、压缩，最后才是 OOM。理解这条路径解释了为什么有空闲内存也会 OOM，为什么容器可以独立于宿主机 OOM，以及为什么 `oom_score_adj` 是保护关键服务最有效的工具。

内核的评分算法——RSS 加 swap 加 page tables，通过 `oom_score_adj × totalpages / 1000` 缩放——刻意保持简单。它瞄准消耗最多内存的进程，并通过可调的调整项提供操作控制。2 秒 OOM Reaper 延迟是在快速释放内存和避免 futex robust list 损坏之间的务实折中。

对于生产系统，关键要点是：主动监控 `/proc/<pid>/oom_score`，为关键服务设置 `oom_score_adj = -1000`，理解 cgroup 内存约束，并记住 OOM 是关于分配*预测*，而不是当前内存*消耗*。

---

## 来源

- Linux 内核源码, `mm/oom_kill.c`, `__alloc_pages_may_oom()` 和 `oom_badness()`, https://git.kernel.org
- Linux 内核源码, `mm/page_alloc.c`, `get_page_from_freelist()` 和 `__alloc_pages_slowpath()`
- Linux 内核源码, `mm/vmscan.c`, `shrink_lruvec()` 和 `try_to_free_pages()`
- Linux 内核源码, `mm/compaction.c`, `try_to_compact_pages()`
- Linux 内核文档, admin-guide/mm/oom_killer, https://www.kernel.org/doc/html/latest/admin-guide/mm/oom_killer.html
- Kubernetes 文档, OOMKilled 和退出码 137, https://kubernetes.io/docs/tasks/configure-pod-container/assign-memory-resource/
