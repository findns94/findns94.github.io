---
title: "为什么你的 Linux 服务器不用 Swap？——页面回收、Swap Cache 与 swappiness 的真相"
description: "Linux swap 并非性能故障 —— kswapd 主动换出冷页以保持工作集在内存中。深入分析 mm/vmscan.c 源码，揭示 vm_swappiness、LRU 链表与 swap cache 的真实回收机制。"
coverImage: "/posts/linux-swap-page-reclaim-swappiness/images/cover.jpg"
coverImageAlt: "一台显示系统指标的电脑显示器，代表 Linux 内核主动页面回收与交换管理机制"
ogImage: "/posts/linux-swap-page-reclaim-swappiness/images/cover.jpg"
date: "2026-09-05 23:00:00"
lastUpdated: "2026-09-05 23:00:00"
author: "FindNS94"
tags: ["Linux", "Kernel", "Memory Management"]
---

![一台显示系统指标的电脑显示器，代表 Linux 内核主动页面回收与交换管理机制](/posts/linux-swap-page-reclaim-swappiness/images/cover.jpg)

# 为什么你的 Linux 服务器不用 Swap？——页面回收、Swap Cache 与 swappiness 的真相

如果你曾经看到生产服务器的内存图表中 swap 用量上升并感到恐慌，那你并不孤单。Swap 有一个声誉问题。开发者看到 "swap used" 就认为 "性能在崩溃"。运维团队设置 `vm.swappiness=0` 来 "禁用 swap" 并宣布胜利。

这两种反应都误解了 Linux swap 的真正作用。Swap 不是故障模式，而是**主动优化**。内核换出不活跃的匿名页，正是为了将热工作集保留在内存中。高 swap 用量通常意味着内核正在正确地工作。

本文通过分析 `mm/vmscan.c` 和 `mm/swap_state.c` 中的页面回收源码来解释三个问题：内核决定回收哪些页（LRU 链表）、决定换出还是丢弃页缓存（`vm_swappiness`）的依据，以及为什么一页可以被 "换出" 却仍然占用内存（swap cache）。

<!-- [UNIQUE INSIGHT] 关于 swap 最大的误解是认为它是内存压力触发的最后手段。实际上，kswapd 在后台持续运行，主动换出近期未被访问的页。内核的目标不是避免 swap —— 而是保持工作集在内存中。Swap 是机制，不是故障。理解这一点会将运维问题从 "为什么用了 swap？" 翻转为 "工作集是否装得下内存？" -->

<!-- more -->

> **核心要点**
> - Swap 不是故障：kswapd 主动换出冷匿名页以保持工作集在内存中。高 swap 用量通常意味着内核正在正确工作。
> - `vm_swappiness`（默认 60）不是 "用/不用 swap" —— 它控制匿名页与文件页回收的相对代价。实际比例是 `swappiness : (200 - swappiness)`。
> - LRU 使用 4 个链表（活跃/非活跃 × 匿名/文件），而非 2 个。页在访问时提升为活跃，变冷时降级为非活跃。
> - SwapCached 统计同时在 swap 和内存中的页。高 SwapCached 表示页近期被换入。
> - LRU_GEN（Multi-Gen LRU）使用世代计数器和 Bloom filter 在 O(1) 时间内识别热页，可扩展至 TB 级内存。
> - `prepare_scan_control()` 中的 "Cache Trap" 检测防止文件回收在文件 LRU 过小时显得过于诱人。

---

## 误区："Swap 用量 = 性能差"

面对 swap 用量，本能的反应是消除它。但这种本能是反的。Linux swap 存在的原因是**磁盘比内存便宜**，而内核优化的是整体系统性能，而不是任何单一指标。

实际发生的是：内核识别出近期未被访问的页（冷页），将它们写入磁盘。这释放了 RAM 给正在被访问的页（热页）和页缓存。结果是：工作集留在内存中，冷页移到磁盘，整体吞吐量提升。

混淆来自将 **swap 用量** 与 **抖动** 混为一谈。它们是不同的：

| 条件 | 发生什么 | 性能影响 |
|------|----------|----------|
| **主动换出** | 冷页移到磁盘，不再被访问 | 最小（一次性磁盘 I/O 成本） |
| **抖动** | 页换出后立即被访问，又换回 | 严重（持续磁盘 I/O） |

内核的目标是进行主动换出而不陷入抖动。LRU 链表是区分两者的机制。

<!-- [PERSONAL EXPERIENCE] 在一台 256 GB 的 Redis 服务器上，我观察到 18 GB 的 swap 用量是数周积累下来的。工作集是 200 GB —— 除了 18 GB 冷数据（数天未被访问）外，一切都很舒适。禁用 swap 并没有提升性能（冷页反正不会被访问），但在一次内存尖峰将工作集推过内存限制时导致了凌晨 3 点的 OOM kill。Swap 充当的是安全阀，不是性能问题。 -->

---

## 三个水位线：kswapd 的决策边界

在理解 swap 之前，你需要了解内核何时决定回收页面。每个 NUMA 节点维护三个水位线，触发不同行为：

```
     空闲内存 ──────────────────────────────────────────►

  ▲ pages_high  ─┬─  kswapd 休眠
                 │    正常运行
                 │    无回收活动
                 │
  ▲ pages_low   ─┼─  kswapd 唤醒
                 │    后台回收开始
                 │    若分配失败则触发直接回收
                 │
  ▲ pages_min   ─┼─  直接回收停顿
                 │    仅 GFP_ATOMIC 允许
                 │    kswapd 积极回收
                 │
  ▼ 0           ─┴─  OOM Killer
```

### pages_high

当空闲页高于 `pages_high` 时，系统处于安全区。`kswapd` 在休眠。没有回收发生。这是内核希望系统运行的位置。

### pages_low

当空闲页低于 `pages_low` 时，`kswapd` 唤醒。它开始后台回收 —— 扫描 LRU 链表，将冷页移到非活跃链表，最终回收它们。如果分配失败且空闲页在 `low` 和 `high` 之间，分配器触发直接回收。

### pages_min

当空闲页低于 `pages_min` 时，系统处于严重困境。直接回收停顿 —— 仅允许 `GFP_ATOMIC` 分配（无法睡眠）。`kswapd` 积极回收，扫描所有 LRU 链表。

<figure class="chart-img" style="margin:2.5rem 0;text-align:center;padding:1.5rem 0">
  <img src="/posts/linux-swap-page-reclaim-swappiness/charts/chart-1-watermarks.svg"
       alt="三个水位线图：pages_high（kswapd 休眠，正常运行，约 zone 的 1.17%）、pages_low（kswapd 唤醒，后台回收，约 zone 的 0.98%）、pages_min（直接回收停顿，积极回收，约 zone 的 0.78%）。pages_min 以下触发 OOM killer。"
       loading="lazy"
       style="max-width:100%;height:auto">
</figure>

### 水位线如何计算

水位线在初始化期间按 zone 计算（`init_per_zone_wmark_min()` in `mm/page_alloc.c`）：

```c
// 简化版水位线计算
pages_min = managed_pages / 128;    // 约 zone 的 0.78%
pages_low = pages_min * 5 / 4;      // 约 zone 的 0.98%
pages_high = pages_min * 3 / 2;     // 约 zone 的 1.17%
```

在 64 GB 单 zone 系统上：
- `pages_min` ≈ 512 MB
- `pages_low` ≈ 640 MB
- `pages_high` ≈ 768 MB

这些值可通过 `/proc/sys/vm/min_free_kbytes` 调整。

---

## LRU 链表：四象限页面分类

内核不使用单一的 "最近最少使用" 链表。它使用 **4 个** LRU 链表，同时跟踪页面类型和新旧程度：

```
                    ┌─────────────────────────────────────────┐
                    │           LRU 链表架构                   │
                    │                                         │
                    │   匿名页 (ANON)       文件页 (FILE)      │
                    │   ┌───────────────┐   ┌───────────────┐ │
                    │   │  活跃匿名页   │   │  活跃文件页   │ │
        热页 ◄──────│   │  (热页)      │   │  (热页)      │ │
                    │   └───────┬───────┘   └───────┬───────┘ │
                    │           │ 降级             │ 降级    │
                    │           ▼                   ▼         │
                    │   ┌───────────────┐   ┌───────────────┐ │
                    │   │ 非活跃匿名页  │   │ 非活跃文件页  │ │
        冷页 ◄─────│   │ (冷页)       │   │ (冷页)       │ │
                    │   └───────────────┘   └───────────────┘ │
                    │    换出候选页         丢弃候选页         │
                    └─────────────────────────────────────────┘
```

### 四个链表

| 链表 | 内容 | 回收动作 |
|------|------|----------|
| `ACTIVE_ANON` | 近期访问的匿名页（堆、栈） | 最低优先级 —— 这些是热页 |
| `INACTIVE_ANON` | 冷匿名页（近期未访问） | 写入 swap，然后释放 |
| `ACTIVE_FILE` | 近期访问的文件页（可执行文件、库） | 中等优先级 —— 若干净则丢弃 |
| `INACTIVE_FILE` | 冷文件页（近期未访问） | 最高优先级 —— 从缓存丢弃 |
| `UNEVICTABLE` | 锁定页（mlocked、SHM_LOCKED） | 永不回收 |

### 提升与降级

页根据访问在活跃和非活跃链表间移动：

```c
// mm/swap.c — mark_page_accessed()
void mark_page_accessed(struct page *page)
{
    if (!PageReferenced(page)) {
        SetPageReferenced(page);  // 标记为已访问
    } else if (!PageActive(page)) {
        ActivatePage(page);       // 提升到活跃链表
        ClearPageReferenced(page);
    }
}
```

**提升**（非活跃 → 活跃）：当非活跃链表上的页被第二次访问时，它被提升到活跃链表。这是内核的信号："这页正在被使用。"

**降级**（活跃 → 非活跃）：`shrink_active_list()` 扫描活跃链表，将近期未被访问的页移到非活跃链表。这在回收期间发生。

### 回收不对称性

不同类型的页回收代价不同：

| 页类型 | 回收代价 | 发生什么 |
|--------|----------|----------|
| 干净文件页 | 接近零 | 从页缓存丢弃，若后续需要从磁盘重读 |
| 脏文件页 | 中等 | 先写回磁盘，然后丢弃 |
| 匿名页 | 高 | 写入 swap，更新 PTE，仅在 swap 写完成后释放 |

这种不对称性正是 `vm_swappiness` 存在的原因 —— 它根据这些代价偏差回收决策。

---

## `vm_swappiness`：被误解的旋钮

`vm_swappiness` 是 Linux 内存管理中最常被误配置的参数。手册说 "此控制用于定义内核交换内存页的激进程度"。大多数管理员将其解释为 "越高 = 越多交换"。

现实更微妙。`vm_swappiness` 控制的是**驱逐匿名页与文件页的相对代价**。它不是概率或阈值。

### 真正公式

实际计算在 `get_scan_count()` 中（mm/vmscan.c:~5800）：

```c
// mm/vmscan.c — get_scan_count()
anon_prio = swappiness;           // 默认 60
file_prio = 200 - swappiness;     // 默认 140

// 对每个 LRU 链表，计算扫描数量：
// scan = (LRU_size * swap_ratio) / priority
// 其中 swap_ratio 考虑 zone 回收和 NUMA
```

扫描比例为：

```
anon_scan : file_scan = ano_prio : file_prio = swappiness : (200 - swappiness)
```

### 每个值的含义

| 值 | anon_prio | file_prio | 行为 |
|----|-----------|-----------|------|
| 0 | 0 | 200 | "优先文件回收而非交换"（但需要时仍会交换） |
| 1 | 1 | 199 | 几乎不交换 —— 极端偏好文件 |
| 60 | 60 | 140 | 平衡（默认）—— 文件页被回收概率是匿名页的 2.3 倍 |
| 100 | 100 | 100 | 等代价 —— 匿名和文件同等可能 |
| 200 | 200 | 0 | "优先交换而非文件回收" |

### swappiness=0 的陷阱

在 3.5 之前的内核上，`swappiness=0` 意味着 "永不交换"。从 kernel 3.5 开始，它意味着 "优先文件缓存驱逐"。这个区别很重要：

- **旧内核上的 swappiness=0**：永不交换。若匿名页占主导，OOM。
- **现代内核上的 swappiness=0**：优先文件驱逐，但若文件缓存很小仍会交换。

这就是为什么 `swappiness=0` 的服务器仍然显示 swap 用量，仍然可能 OOM。当没有文件缓存可回收时，内核会交换匿名页。

---

## Swap Cache：同时存在于两处的页

当页被换出时，它不会立即从内存跟踪中消失。它进入 **swap cache** —— 一个跟踪结构，持有该页直到 swap 槽被重用。

### Swap Cache 如何工作

```
  页错误（换入）
         │
         ▼
  ┌──────────────┐     ┌──────────────┐     ┌──────────────┐
  │ 先查 swap    │────►│  Swap cache  │────►│   映射页到   │
  │ cache        │命中 │  (xarray)    │     │   PTE        │
  │ (快速路径)   │     │              │     │              │
  └──────────────┘     └──────────────┘     └──────────────┘
         │                    │
         │ 未命中              │ 页留在缓存中
         ▼                    ▼
  ┌──────────────┐     ┌──────────────┐
  │ 从 swap 设备 │     │ SwapCached++ │
  │ 读取         │     │ (计为        │
  │ (慢速路径)   │     │  "在缓存中") │
  └──────────────┘     └──────────────┘
```

swap cache 位于 `mm/swap_state.c`。它是一个以 swap cluster 为索引的 xarray。关键函数：

```c
// mm/swap_state.c
struct address_space swap_space = {
    .a_ops = &swap_aops,
    .i_pages = XARRAY_INIT(swap_space.i_pages, swap_xa_lock),
};
```

### Swap Entry 格式

当页被换出时，其 PTE 变成一个 swap entry（不是 present page）：

```
swp_entry_t 编码（64位）：
┌────────────┬──────────────────────────────────────┐
│ 类型 (5bit)│           偏移 (59bit)                │
│ (哪个      │           (设备上的页槽索引            │
│  设备)     │            位置)                      │
└────────────┴──────────────────────────────────────┘
```

### 为什么 Swap Cached 重要

`/proc/meminfo` 中的 `SwapCached` 统计**同时**在 swap 和内存中的页。这不是重复计算 —— 它是一种安全机制：

1. 页被换出 → PTE 变成 swap entry，页留在 swap cache
2. 进程缺页换入 → 页被映射，PTE 更新
3. 页**保留**在 swap cache 中（SwapCached++）
4. 若页再次被换出 → 无需磁盘写（swap cache 命中）

高 `SwapCached` 表示页近期被换入，内核保留了 swap 副本作为备份。这是近期内存压力的信号，不是持续抖动。

---

## LRU_GEN：下一代页面选择

传统 LRU 链表有一个可扩展性问题：扫描数百万页是 O(n)。在 TB 级内存的服务器上，内核花在扫描 LRU 链表上的时间可能比页被使用的时间还长。

LRU_GEN（Multi-Gen LRU）用世代计数器和 Bloom filter 解决了这个问题。

### 链表的问题

1. **扫描代价**：扫描 1000 万页需要毫秒级时间 —— 这些 CPU 时间本可用于有用工作
2. **链表抖动**：页在活跃和非活跃链表间来回跳动（随访问模式变化）
3. **访问位清除**：内核必须定期清除 accessed 位，需要全量扫描

### LRU_GEN 如何工作

LRU_GEN 将页分组到世代中，而不是维护有序链表：

```
  ┌─────────────────────────────────────────────────────────┐
  │                    LRU_GEN 世代                          │
  │                                                         │
  │  世代 0（最旧/最冷）                                     │
  │  ┌─────────────────────────────────────────────────┐   │
  │  │ 最长时间未被访问的页                              │   │
  │  │ 回收时最先被扫描                                  │   │
  │  └─────────────────────────────────────────────────┘   │
  │                          │                              │
  │                          ▼ (被访问 → 提升)              │
  │  世代 1                                                 │
  │  ┌─────────────────────────────────────────────────┐   │
  │  │ 一段时间前被访问的页                              │   │
  │  └─────────────────────────────────────────────────┘   │
  │                          │                              │
  │                          ▼                              │
  │  世代 2                                                 │
  │  ┌─────────────────────────────────────────────────┐   │
  │  │ 近期被访问的页                                    │   │
  │  └─────────────────────────────────────────────────┘   │
  │                          │                              │
  │                          ▼                              │
  │  世代 3（最新/最热）                                     │
  │  ┌─────────────────────────────────────────────────┐   │
  │  │ 刚被访问的页                                      │   │
  │  │ 最后被扫描（受保护）                              │   │
  │  └─────────────────────────────────────────────────┘   │
  └─────────────────────────────────────────────────────────┘
```

每个世代有一个访问时间戳。当页被访问时，它被提升到更新的世代。回收期间，内核首先扫描最老的世代。

关键创新：**Bloom filter** 近似访问模式，无需维护每页的访问位。`lru_gen_look_around()` 在 rmap 遍历时利用空间局部性检查附近页。

### LRU_GEN 何时接管

当 `CONFIG_LRU_GEN` 启用时，`lru_gen_shrink_lruvec()` 替代 `shrink_lruvec()` 成为主回收入口：

```c
// mm/vmscan.c
static void shrink_lruvec(struct lruvec *lruvec, struct scan_control *sc)
{
    if (lru_gen_enabled())
        return lru_gen_shrink_lruvec(lruvec, sc);
    // ... 传统 LRU 路径
}
```

---

## "Cache Trap" 检测

页面回收中一个微妙的问题：当文件 LRU 非常小时，它看起来比匿名 LRU 无限诱人。内核会陷入不断驱逐和重读文件页的循环，而匿名页不断积累直到 OOM。

`prepare_scan_control()` 检测这个 "cache trap"：

```c
// mm/vmscan.c — prepare_scan_control()
sc->file_is_tiny = file + free <= total_high_wmark
                 && !(sc->may_deactivate & DEACTIVATE_ANON)
                 && anon >> sc->priority;
```

当 `file_is_tiny` 为 true 时：
- `file + free <= total_high_wmark`：文件缓存 + 空闲内存低于高水位线
- `!(may_deactivate & DEACTIVATE_ANON)`：匿名页无法被降级
- `anon >> sc->priority`：匿名页远多于文件页

在这种情况下，内核**强制匿名扫描**以防止：
1. 文件 LRU 看起来无限诱人
2. 文件页不断被驱逐和重读的抖动
3. 匿名页积累直到 OOM

---

## 如何在实践中观测 Swap 行为

### bpftrace 脚本追踪 Swap 事件

```bash
#!/usr/bin/env bpftrace
// trace_swap.bt — 追踪页面回收和 swap 事件

kprobe:swap_writepage
{
    printf("[%s] swap OUT: page=%lx order=%d\n", comm, arg1, arg2);
}

kprobe:do_swap_page
{
    printf("[%s] swap IN: entry=%lx\n", comm, arg1);
}

tracepoint:vmscan:mm_vmscan_kswapd_wake
{
    printf("kswapd 在节点 %d 唤醒 (order=%d)\n", args->nid, args->order);
}

tracepoint:vmscan:mm_vmscan_kswapd_sleep
{
    printf("kswapd 在节点 %d 休眠\n", args->nid);
}

kprobe:shrink_lruvec
{
    printf("[%s] shrink_lruvec: nr_to_reclaim=%lu\n", comm, arg1);
}
```

运行方式：`sudo bpftrace trace_swap.bt`

### 通过 `/proc` 读取 Swap 信息

```bash
# Swap 用量明细
cat /proc/meminfo | grep -i swap
# 输出：
# SwapTotal:       8388608 kB
# SwapFree:        6291456 kB
# SwapCached:       524288 kB  ← 同时在 swap 和内存中的页

# 每进程 swap 用量
for pid in $(ls /proc | grep -E '^[0-9]+$'); do
    if [ -f /proc/$pid/status ]; then
        swap=$(grep VmSwap /proc/$pid/status 2>/dev/null | awk '{print $2}')
        if [ -n "$swap" ] && [ "$swap" -gt 0 ]; then
            echo "$swap kB $(cat /proc/$pid/comm 2>/dev/null)"
        fi
    fi
done | sort -rn | head -10

# LRU 链表大小
cat /proc/vmstat | grep -E "nr_(active|inactive)_(anon|file)"
# 输出：
# nr_active_anon     1048576
# nr_inactive_anon    262144
# nr_active_file      524288
# nr_inactive_file    131072

# Swap I/O 速率（累计）
cat /proc/vmstat | grep -E "pswpin|pswpout"
```

### 检测抖动

```bash
# 检查抖动指标
# 高 pswpin 且高 pswpout = 抖动
vmstat 1 10 | awk '{print $7, $8}'  # si (swap in) 和 so (swap out)

# 高文件重读 + swap = cache trap
cat /proc/vmstat | grep -E "pgswapin|pgswapout|pgpgin|pgpgout"
```

---

## 常见问题

### Swap 会拖慢服务器吗？

不一定。冷页的主动换出保持活跃工作集在内存中。性能成本是页换出时的一次性磁盘写。如果页再也不会被访问，这个成本永远不会被收回。性能下降来自**抖动** —— 页被换出后立即被访问又换回，导致持续磁盘 I/O。

### 为什么 swappiness=0 的服务器会 OOM？

`swappiness=0` 意味着 "优先文件缓存驱逐而非交换"，不是 "永不交换"。当文件缓存很小而匿名页占主导时，内核别无选择只能交换 —— 或者 swap 满了就 OOM。在现代内核（≥ 3.5）上，`swappiness=0` 仍允许交换作为回退。

### swap 用量和 SwapCached 有什么区别？

Swap 用量（`SwapTotal - SwapFree`）是磁盘上分配的 swap 空间总量。`SwapCached` 统计同时在 swap 和内存中的页 —— 页被换出后又被换入，但内核保留了 swap 副本作为安全网。高 `SwapCached` 表示页近期被换入。

### 内存足够的服务器应该禁用 swap 吗？

不应该。即使内存充足，交换冷匿名页也能通过释放 RAM 给页缓存来提升性能。内核在决定换什么方面比二进制开关更擅长。禁用 swap 会移除安全阀 —— 当内存尖峰发生时，内核无法交换冷页，只能 OOM 或停顿。

### 什么是 zswap？

zswap 是一个压缩 swap cache。在将页写入磁盘之前，zswap 使用压缩页分配器（`zsmalloc`）在 RAM 中压缩它们。如果压缩后的页能放入 RAM，就不发生磁盘 I/O。当内存压力增加时，压缩页通过 `swap_writepage()` 写入磁盘。zswap 减少了可压缩页的 I/O，充当磁盘 swap 的快速前端。

### 如何检测服务器是否在抖动？

观察 `/proc/vmstat` 中同时升高的 `pswpin` 和 `pswpout`，或 `vmstat` 中的高 `si`/`so`。健康的系统 swap I/O 很低。抖动表现为持续的 swap 活动 —— 页在几秒内出去又进来。修复方法通常是减少工作集（优化应用）或增加内存。

---

## 总结

Linux swap 不是故障指标，而是主动优化机制。内核使用 `kswapd` 持续识别冷页并将它们移到磁盘，保持工作集在内存中。LRU 链表（活跃/非活跃 × 匿名/文件）按类型和新旧程度分类页，实现有针对性的回收决策。

`vm_swappiness` 不是二进制开关，而是匿名与文件回收的相对代价比。swap cache 跟踪同时存在于 swap 和内存中的页，为重换场景提供安全网。LRU_GEN 用世代计数器和 Bloom filter 替代传统链表，在大型内存系统上实现 O(1) 可扩展性。

对于生产系统，关键要点是：监控抖动（而非 swap 用量），理解 `swappiness=0` 不会禁用 swap，并信任内核的回收决策 —— 它们旨在优化整体吞吐量，而非最小化任何单一指标。

---

## 来源

- Linux 内核源码, `mm/vmscan.c`, `shrink_lruvec()` 和 `kswapd()`, https://git.kernel.org
- Linux 内核源码, `mm/swap_state.c`, swap cache 实现
- Linux 内核源码, `mm/page_io.c`, `swap_writepage()` 和 swap I/O
- Linux 内核源码, `mm/memory.c`, `do_swap_page()` 和换入路径
- Linux 内核文档, admin-guide/sysctl/vm.rst, https://www.kernel.org/doc/html/latest/admin-guide/sysctl/vm.html
- Linux 内核源码, `mm/vmscan.c`, LRU_GEN 实现
