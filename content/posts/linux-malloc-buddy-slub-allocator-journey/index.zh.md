---
title: "调用 malloc 时究竟发生了什么？——从 Buddy 系统到 SLUB 分配器的旅程"
description: "malloc 并不直接向操作系统请求内存。完整路径：glibc 分配器 → brk/mmap → alloc_pages() → Buddy 系统 → SLUB。深入分析 mm/page_alloc.c 与 mm/slub.c 源码揭示每层机制。"
coverImage: "/posts/linux-malloc-buddy-slub-allocator-journey/images/cover.jpg"
coverImageAlt: "屏幕上显示错误消息，代表从 malloc 到 Linux 内核 Buddy 和 SLUB 分配器的复杂内存分配路径"
ogImage: "/posts/linux-malloc-buddy-slub-allocator-journey/images/cover.jpg"
date: "2026-09-06 00:00:00"
lastUpdated: "2026-09-06 00:00:00"
author: "FindNS94"
tags: ["Linux", "Kernel", "Memory Management"]
---

![屏幕上显示错误消息，代表从 malloc 到 Linux 内核 Buddy 和 SLUB 分配器的复杂内存分配路径](/posts/linux-malloc-buddy-slub-allocator-journey/images/cover.jpg)

# 调用 malloc 时究竟发生了什么？——从 Buddy 系统到 SLUB 分配器的旅程

每个 C 和 C++ 开发者都调用过 `malloc()`。大多数人假设它直接向操作系统请求内存。不是。在你的 `malloc(64)` 调用和实际物理页分配之间，至少有四层分配：glibc 分配器、内核页分配器 (Buddy 系统)、slab 分配器 (SLUB) 和虚拟内存子系统。

本文走完 `malloc()` 调用的完整路径，从 glibc 分配器的堆管理到 Buddy 系统的页拆分，再到 SLUB 分配器的无锁快速路径。读完后你会理解为什么大多数分配从不进入内核空间，为什么 Buddy 系统跟踪"迁移类型"，以及为什么 SLUB 可以在不获取任何锁的情况下分配内存。

<!-- [UNIQUE INSIGHT] 关于 malloc 最反直觉的事实是：小分配几乎从不进入内核空间。glibc 分配器管理通过 mmap() 获取的预分配内存池，内核的 SLUB 分配器管理通过 Buddy 系统获取的预分配物理页。实际的系统调用 (brk, mmap) 很少发生 —— 仅在这些池耗尽时。这解释了为什么 malloc 很快（大多数调用无系统调用开销）以及为什么内存碎片化主要是小分配的用户态问题。 -->

<!-- more -->

> **核心要点**
> - malloc 不直接调用内核：glibc 分配器通过 brk()（小分配）或 mmap()（大分配，默认 >128KB）管理内存池
> - Buddy 系统以 2 的幂次方块（阶 0-10）管理物理页，分配时拆分，释放时合并
> - 迁移类型（MOVABLE、UNMOVABLE、RECLAIMABLE）通过隔离不兼容的页类型来防止碎片化
> - Per-CPU Pageset (PCP) 从每 CPU 热/冷页列表提供无锁 order-0 分配
> - SLUB 的 per-CPU sheaves 使大多数 kmalloc 调用可以无锁分配和释放
> - SLUB 尺寸等级（8, 16, 24, 32, 40, 48, 56, 64, 96, 128...）不是纯 2 的幂次 —— 中间尺寸减少浪费

---

## 误区："malloc 向 OS 请求内存"

大多数开发者的心智模型：`malloc(64)` → 内核分配 64 字节 → 返回指针。这几乎在每个细节上都是错的。

实际路径有四层，只有当上层内存耗尽时才会涉及内核：

```
  malloc(64)
       │
       ▼
  ┌─────────────────────────────────────────────────────────────────────┐
  │  第 1 层：glibc 分配器 (用户态)                                     │
  │  • 通过 brk() 管理小分配的堆                                       │
  │  • 通过 mmap() 管理大分配的匿名映射                                 │
  │  • 在 bins 中缓存已释放的内存（fast bins, small bins, large bins）  │
  │  • 大多数分配不进入内核                                             │
  └─────────────────────────────────────────────────────────────────────┘
       │ (仅当 glibc 缓存耗尽时)
       ▼
  ┌─────────────────────────────────────────────────────────────────────┐
  │  第 2 层：虚拟内存子系统 (内核)                                     │
  │  • brk()/mmap() 扩展进程的地址空间                                  │
  │  • 创建 VMA (Virtual Memory Area) 条目                             │
  │  • 此时不分配物理页（延迟分配）                                     │
  └─────────────────────────────────────────────────────────────────────┘
       │ (仅在首次访问新页时 —— 页错误)
       ▼
  ┌─────────────────────────────────────────────────────────────────────┐
  │  第 3 层：页分配器 — Buddy 系统 (内核)                              │
  │  │  • 以 2 的幂次方块分配物理页                                    │
  │  • 拆分大块以满足较小的请求                                         │
  │  • 释放时将块合并回更大的块                                         │
  └─────────────────────────────────────────────────────────────────────┘
       │ (用于内核内分配：kmalloc, slab 缓存)
       ▼
  ┌─────────────────────────────────────────────────────────────────────┐
  │  第 4 层：Slab 分配器 — SLUB (内核)                                 │
  │  • 管理固定大小内核对象的缓存                                       │
  │  • 每 CPU sheaves 用于无锁分配                                     │
  │  • 需要时从 Buddy 系统获取物理页                                    │
  └─────────────────────────────────────────────────────────────────────┘
```

---

## 第 1 层：glibc 分配器 (用户态)

glibc 分配器 (ptmalloc2) 是一个用户态内存管理器，管理从内核获取的内存池。对于大多数 `malloc()` 调用，它不进入内核空间。

### 两条系统调用路径

```c
// glibc malloc/malloc.c — _int_malloc() 决策
if (nb <= MAX_FAST_SIZE) {
    // Fast bin：无系统调用，使用缓存的 chunk
} else if (nb <= M_MMAP_THRESHOLD) {  // 默认 128KB
    // 小/中：通过 brk() 扩展堆
    result = sysmalloc(nb, av);
    // ... 使用 brk() 扩展堆
} else {
    // 大分配：mmap() 匿名内存
    mmap_threshold:
    tp = mmap(NULL, tsize, PROT_READ|PROT_WRITE,
              MAP_PRIVATE|MAP_ANONYMOUS, -1, 0);
}
```

| 分配大小 | 路径 | 系统调用 | 典型延迟 |
|----------|------|----------|----------|
| < 64 字节 (fast bin) | 缓存命中 | 无 | ~10 ns |
| < 128KB (堆) | brk() | brk() (很少) | ~100 ns (缓存) |
| > 128KB (mmap) | mmap() | mmap() (总是) | ~1-10 us |

### 为什么 brk() 很少被调用

glibc 分配器从内核请求大块内存（通过 brk() 或 mmap()），然后子分配它们。一次 brk() 调用可能扩展堆 128KB 或更多，满足后续数千次 malloc() 调用而无需进入内核。

### M_MMAP_THRESHOLD 可调参数

```c
// 默认：128 KB (131072 字节)
// 可通过以下方式调整：
mallopt(M_MMAP_THRESHOLD, 65536);  // 降到 64KB
```

降低此阈值使大分配使用 mmap() 而非 brk()。这有助于减少碎片（mmap 的内存会在 free 时归还 OS），但增加系统调用开销。

---

## 第 2 层：虚拟内存 (延迟分配)

当 glibc 分配器调用 brk() 或 mmap() 时，内核不分配物理页。它只记录虚拟地址范围：

```c
// mm/mmap.c — do_brk_flags()
unsigned long do_brk_flags(struct mm_struct *mm, unsigned long addr,
                           unsigned long len, unsigned long flags)
{
    // 1. 在 VMA 树中查找空隙
    // 2. 创建新的 VMA
    // 3. 不分配物理页
    // 物理页在首次访问时分配（页错误）
}
```

这是**延迟分配**：内核承诺内存存在，但在进程实际读写之前不分配物理页。

### 页错误：物理页的诞生地

当进程首次访问新 VMA 中的页时：

```
  进程访问地址 0x7f1234000000
       │
       ▼
  ┌─────────────────────────────────────────┐
  │  CPU 检查页表：PTE 不存在               │
  │  → 页错误 (x86 上异常 14)               │
  └─────────────────────────────────────────┘
       │
       ▼
  ┌─────────────────────────────────────────┐
  │  handle_mm_fault()                      │
  │  → __handle_mm_fault()                  │
  │  → handle_pte_fault()                   │
  │  → do_anonymous_page()                  │
  │  → alloc_pages(GFP_HIGHUSER)            │
  └─────────────────────────────────────────┘
       │
       ▼
  Buddy 系统分配物理页
```

---

## 第 3 层：Buddy 系统 (物理页分配器)

Buddy 系统是内核的物理页分配器。它以 2 的幂次大小的块（称为"阶"）管理页。

### 数据结构

```c
// include/linux/mmzone.h
struct zone {
    struct free_area free_area[MAX_ORDER];  // 11 阶 (0-10)
    // ...
};

struct free_area {
    struct list_head free_list[MIGRATE_TYPES];  // 每迁移类型链表
    unsigned long nr_free;
};
```

每个 zone (DMA, DMA32, Normal, Movable) 维护 11 个空闲链表（阶 0-10），其中阶 `n` 跟踪 `2^n` 个连续页的块：

| 阶 | 块大小 | 页数 |
|----|--------|------|
| 0 | 4 KB | 1 |
| 1 | 8 KB | 2 |
| 2 | 16 KB | 4 |
| 3 | 32 KB | 8 |
| 4 | 64 KB | 16 |
| 5 | 128 KB | 32 |
| 6 | 256 KB | 64 |
| 7 | 512 KB | 128 |
| 8 | 1 MB | 256 |
| 9 | 2 MB | 512 |
| 10 | 4 MB | 1024 |

### 分配：`__rmqueue_smallest()`

```c
// mm/page_alloc.c — __rmqueue_smallest()
static __always_inline
struct page *__rmqueue_smallest(struct zone *zone, unsigned int order,
                                int migratetype)
{
    unsigned int current_order;

    // 从请求的阶向上搜索
    for (current_order = order; current_order < MAX_ORDER; ++current_order) {
        area = &(zone->free_area[current_order]);
        page = get_page_from_free_area(area, migratetype);
        if (!page) continue;
        // 找到块 — 拆分到请求的大小
        page_del_and_expand(zone, page, order, current_order, migratetype);
        return page;
    }
    return NULL;  // 任何阶都没有可用块
}
```

算法：找到请求阶或以上最小的可用块，然后重复拆分直到大小合适。

### 释放：Buddy 合并

```c
// mm/page_alloc.c — __free_one_page()
static inline void __free_one_page(struct page *page, unsigned long pfn,
                                   struct zone *zone, unsigned int order,
                                   int migratetype)
{
    // 检查"伙伴"（相同大小的相邻块）是否也空闲
    while (order < MAX_ORDER - 1) {
        buddy = find_buddy_page_pfn(page, pfn, order, &buddy_pfn);
        if (!buddy || !buddy_is_free(buddy, order, migratetype))
            goto done_merging;
        // 合并：从链表中移除伙伴，组合，向上一阶移动
        __del_page_from_free_list(buddy, zone, order, migratetype);
        combined_pfn = buddy_pfn & pfn;
        order++;
    }
}
```

当页被释放时，内核检查其"伙伴"（相同大小的相邻块）是否也空闲。如果是，它们合并成一个高一阶的块。这种合并递归进行。

### 迁移类型：碎片化预防

页按迁移类型分类以防止碎片化：

| 类型 | 内容 | 可与谁合并 |
|------|------|-----------|
| `MIGRATE_UNMOVABLE` | 内核数据、页表 | 仅 UNMOVABLE |
| `MIGRATE_MOVABLE` | 用户页、页缓存 | 仅 MOVABLE |
| `MIGRATE_RECLAIMABLE` | Slab 缓存 | 仅 RECLAIMABLE |
| `MIGRATE_HIGHATOMIC` | 紧急预留 | (特殊) |
| `MIGRATE_CMA` | 连续内存分配器 | (特殊) |

**回退顺序**：当一种迁移类型耗尽时，分配器从其他类型窃取：`UNMOVABLE → RECLAIMABLE → MOVABLE`。

### Per-CPU Pageset (PCP)

对于 order-0 分配（最常见的情况），内核维护每 CPU 页列表以避免锁竞争：

```c
// mm/page_alloc.c
struct per_cpu_pages {
    unsigned int count;      // 列表中页的数量
    unsigned int high;       // 补充阈值
    unsigned int batch;      // 补充数量
    struct list_head lists[2];  // 热和冷列表
};
```

- **热列表**：可能在 CPU 缓存中的页（近期释放）
- **冷列表**：不在 CPU 缓存中的页
- **补充**：当 `count` 低于 `high` 时，从 zone 补充 `batch` 个页
- **排放**：当 `count` 超过 `high + batch` 时，将 `batch` 个页归还 zone

PCP 使 order-0 分配在快速路径上无锁 —— 只需从每 CPU 列表弹出。

---

## 第 4 层：SLUB 分配器 (内核对象分配器)

SLUB (Unqueued Slab Allocator) 是固定大小内核对象的默认分配器。`kmalloc()` 使用的就是它。

### 架构概览

```
  kmalloc(64)
       │
       ▼
  ┌─────────────────────────────────────────────────────────────────────┐
  │  SLUB 分配器                                                        │
  │                                                                    │
  │  ┌──────────────────────────────────────────────────────────────┐ │
  │  │  第 1 步：找到尺寸 64 对应的 kmem_cache                       │ │
  │  │  (尺寸等级：8, 16, 24, 32, 40, 48, 56, 64, 96, 128...)       │ │
  │  └──────────────────────────────────────────────────────────────┘ │
  │       │                                                          │
  │       ▼                                                          │
  │  ┌──────────────────────────────────────────────────────────────┐ │
  │  │  第 2 步：尝试 per-CPU sheaf (无锁快速路径)                   │ │
  │  │  → alloc_from_pcs()：从 CPU sheaf 空闲链表弹出               │ │
  │  │  │  → 若为空，换入备用 sheaf                                  │ │
  │  │  → 成功率：约 95% 的分配                                    │ │
  │  └──────────────────────────────────────────────────────────────┘ │
  │       │ (sheaf 为空)                                             │
  │       ▼                                                          │
  │  ┌──────────────────────────────────────────────────────────────┐ │
  │  │  第 3 步：尝试 node barn (每节点池)                          │ │
  │  │  → 获取 barn->lock                                           │ │
  │  │  │  → 从 barn 补充 sheaf                                      │ │
  │  └──────────────────────────────────────────────────────────────┘ │
  │       │ (barn 为空)                                              │
  │       ▼                                                          │
  │  ┌──────────────────────────────────────────────────────────────┐ │
  │  │  第 4 步：尝试部分 slab (node 链表)                          │ │
  │  │  → 获取 node->list_lock                                      │ │
  │  │  │  → 找到有空闲对象的部分 slab                               │ │
  │  └──────────────────────────────────────────────────────────────┘ │
  │       │ (无部分 slab)                                            │
  │       ▼                                                          │
  │  ┌──────────────────────────────────────────────────────────────┐ │
  │  │  第 5 步：从 Buddy 系统分配新 slab                           │ │
  │  │  → alloc_pages() → Buddy 系统                               │ │
  │  │  │  → 创建新 slab，填充空闲链表                                │ │
  │  └──────────────────────────────────────────────────────────────┘ │
  └─────────────────────────────────────────────────────────────────────┘
```

### 无锁快速路径

```c
// mm/slub.c — alloc_from_pcs()
static __always_inline void *alloc_from_pcs(struct kmem_cache *s,
                                            gfp_t gfpflags, int node)
{
    struct sheaf *sheaf = READ_ONCE(s->cpu_sheaves->main);

    if (sheaf) {
        // 从 sheaf 空闲链表无锁弹出
        object = sheaf->freelist;
        if (object) {
            sheaf->freelist = get_freelist_ptr(s, object);
            return object;
        }
        // 主 sheaf 为空 — 尝试备用
        sheaf = swap_in_spare(s);
        if (sheaf) {
            object = sheaf->freelist;
            if (object) {
                sheaf->freelist = get_freelist_ptr(s, object);
                return object;
            }
        }
    }
    return NULL;  // 回退到慢路径
}
```

快速路径是从链表中单次弹出指针，无原子操作。这就是为什么 kmalloc 在 64 核机器上也很快。

### 无锁释放

```c
// mm/slub.c — free_to_pcs()
static __always_inline bool free_to_pcs(struct kmem_cache *s, void *object)
{
    struct sheaf *sheaf = READ_ONCE(s->cpu_sheaves->main);

    if (sheaf) {
        // 无锁推入 sheaf 空闲链表 (使用 cmpxchg_double)
        do {
            freelist = sheaf->freelist;
            counters = sheaf->counters;
            set_freelist_ptr(s, object, freelist);
        } while (!__sheaf_cmpxchg_double(&sheaf->freelist, &sheaf->counters,
                                          freelist, counters,
                                          object, new_counters));
        return true;
    }
    return false;  // 回退到慢路径
}
```

在支持 `cmpxchg_double` 的架构上，SLUB 可以无锁地原子更新空闲链表和计数器。

### SLUB 尺寸等级

kmalloc 使用预分级的缓存：

```
8, 16, 24, 32, 40, 48, 56, 64, 96, 128, 192, 256, 384, 512, 768, 1024,
1536, 2048, 3072, 4096, 8192, ...
```

这些不是纯 2 的幂次。中间尺寸（24, 40, 48, 56, 96, 192, 384, 768, 1536, 3072）减少常见分配尺寸的内部碎片。

### SLUB 锁顺序

当走慢路径时，SLUB 遵循严格的锁顺序：

```
0. cpu_hotplug_lock
1. slab_mutex (全局)
2a. cpu_sheaves->lock (本地 trylock)
2b. barn->lock (spinlock)
2c. node->list_lock (spinlock)
3. slab_lock(slab) (bit spinlock, 架构相关)
```

此顺序防止多个 CPU 竞争同一缓存时发生死锁。

---

## 完整路径：malloc(64) 逐步解析

这是调用 `malloc(64)` 时实际发生的事：

```
  malloc(64)
       │
       ▼
  ┌─────────────────────────────────────────────────────────────────────┐
  │  glibc：检查 fast bins 和 small bins                               │
  │  → 如果 bin 中有 64 字节 chunk：返回它 (~10 ns)                    │
  │  → 如果没有：                                                       │
  └─────────────────────────────────────────────────────────────────────┘
       │ (缓存未命中)
       ▼
  ┌─────────────────────────────────────────────────────────────────────┐
  │  glibc：通过 brk() 扩展堆 (若堆有空间)                              │
  │  → brk() 系统调用：扩展程序 break 128KB+                           │
  │  │  → 从新堆区域子分配 64 字节                                      │
  │  → 返回指针 (~100 ns + brk 成本，若需系统调用)                     │
  └─────────────────────────────────────────────────────────────────────┘
       │ (首次访问这 64 字节)
       ▼
  ┌─────────────────────────────────────────────────────────────────────┐
  │  CPU：页错误 (PTE 不存在)                                          │
  │  → handle_mm_fault() → do_anonymous_page()                        │
  │  │  → alloc_pages(GFP_HIGHUSER_MOVABLE)                            │
  └─────────────────────────────────────────────────────────────────────┘
       │
       ▼
  ┌─────────────────────────────────────────────────────────────────────┐
  │  Buddy：get_page_from_freelist()                                   │
  │  → 首先检查 PCP 热列表 (无锁)                                      │
  │  │  → 若为空：检查 zone free_area[0]                                │
  │  │  → 若为空：唤醒 kswapd，重试                                     │
  │  → 返回物理页 (~100 ns 从 PCP, ~1-10 us 从 zone)                  │
  └─────────────────────────────────────────────────────────────────────┘
       │
       ▼
  ┌─────────────────────────────────────────────────────────────────────┐
  │  MMU：将页映射到 PTE，返回用户态                                   │
  │  → 进程现在有了物理页支持其 64 字节                                │
  └─────────────────────────────────────────────────────────────────────┘
```

### 何时涉及每一层？

| 场景 | 涉及层 | 典型延迟 |
|------|--------|----------|
| 重复小分配 | 仅 glibc | ~10 ns |
| 堆扩展后的首次 malloc | glibc + brk() | ~1-10 us |
| 新页的首次访问 | glibc + 页错误 + Buddy | ~1-10 us |
| 大 malloc (>128KB) | glibc + mmap() + 页错误 + Buddy | ~10-100 us |
| kmalloc (内核) | SLUB 快速路径 | ~50 ns |
| kmalloc (内核，慢) | SLUB 慢路径 + Buddy | ~1-10 us |

---

## 如何在实践中观测分配行为

### 观测 glibc 分配器行为

```bash
# 追踪 brk() 和 mmap() 系统调用
strace -e brk,mmap ./your_program 2>&1 | head -20

# 检查进程内存映射
cat /proc/<pid>/maps | grep -E "heap|stack|anon"

# 详细内存统计
cat /proc/<pid>/status | grep -E "VmSize|VmRSS|VmData|VmStk"
```

### 观测页错误

```bash
# 统计进程的页错误
/usr/bin/time -v ./your_program 2>&1 | grep -E "page faults"

# 实时监控页错误
vmstat 1  # 看 "faults" 列

# 每进程页错误率
cat /proc/<pid>/stat | awk '{print "minor:", $10, "major:", $11}'
```

### 观测 Buddy 系统

```bash
# 碎片化信息
cat /proc/buddyinfo
# 输出：
# Node 0, zone   DMA     1    0    0    1    2    1    1    0    1    1    3
# Node 0, zone  Normal  234  145   89   45   23   12    5    3    1    0    0
# 每列是一个阶 (0-10)，值是空闲块数量

# Zone 信息
cat /proc/zoneinfo | grep -E "Node|zone|free|min|low|high"
```

### 观测 SLUB

```bash
# SLUB 缓存信息
cat /proc/slabinfo | head -30
# 输出：
# name            <active_objs> <num_objs> <objsize> <objperslab> <pagesperslab> : ...
# kmalloc-64           1234      2048        64          62               1
# kmalloc-128           512      1024       128          32               1
# dentry               4567      8192       192          42               1

# 每缓存详情
slabtop  # 实时 slab 缓存查看器
```

---

## 常见问题

### 如果 malloc 经过这么多层，为什么还很快？

因为大多数分配从不进入内核空间。glibc 分配器在 bins 中缓存内存，大多数 malloc() 调用从这些缓存中满足。内核仅在缓存耗尽时（brk/mmap）或需要新物理页时（页错误）才参与。

### malloc 的 brk() 和 mmap() 有什么区别？

brk() 扩展堆段（与数据段连续）。mmap() 在地址空间任意位置创建新的匿名映射。brk() 用于小分配（≤128KB），mmap() 用于大分配。mmap 的内存在 free 时归还 OS；brk 的内存在堆末端时才能归还。

### Buddy 系统为什么使用 2 的幂次块大小？

2 的幂次块支持高效拆分和合并。大小为 2^n 的块可以拆分为两个 2^(n-1) 的块。两个相邻的空闲 2^n 块可以合并为一个 2^(n+1) 块。这个二进 buddy 性质确保伙伴可以通过简单算术找到。

### Buddy 系统内存耗尽时会发生什么？

当任何阶都没有可用块时，分配器唤醒 kswapd（后台回收），然后尝试直接回收（分配上下文中的同步回收）。如果回收失败，尝试压缩（移动页以创建连续块）。如果全部失败，触发 OOM killer。

### SLUB 为什么有非 2 的幂次尺寸等级？

纯 2 的幂次尺寸（8, 16, 32, 64, 128, 256...）会因内部碎片浪费最多 50% 的内存。中间尺寸（24, 40, 48, 56, 96, 192...）减少常见分配尺寸的浪费，代价是缓存管理稍复杂。

### SLAB、SLUB 和 SLOB 有什么区别？

SLAB 是原始 slab 分配器（复杂、高开销）。SLUB (Unqueued Slab) 是默认的 —— 更简单，per-CPU sheaves，无锁快速路径。SLOB (Simple List of Blocks) 用于内存极少的嵌入式系统。SLUB 在 kernel 2.6.23 中取代 SLAB 成为默认。

---

## 总结

malloc 不是简单的系统调用。它是一个多层分配系统，内核仅在预分配池耗尽时参与。glibc 分配器通过 brk() 和 mmap() 管理用户态池。内核的 Buddy 系统以 2 的幂次块分配物理页，通过迁移类型隔离防止碎片化。SLUB 使用 per-CPU sheaves 为内核对象提供无锁分配。

理解这条路径解释了为什么 malloc 很快（大多数调用无系统调用），为什么页错误是首次访问的真正成本，以及为什么监控工具根据测量哪层显示不同的"内存使用量"（虚拟大小来自 brk/mmap，驻留大小来自页错误，物理页来自 Buddy 系统）。

---

## 来源

- Linux 内核源码, `mm/page_alloc.c`, `__rmqueue_smallest()` 和 `__free_one_page()`
- Linux 内核源码, `mm/slub.c`, `alloc_from_pcs()` 和 `free_to_pcs()`
- Linux 内核源码, `mm/mmap.c`, `do_brk_flags()` 和页错误处理
- Linux 内核源码, `include/linux/mmzone.h`, zone 和 free_area 结构
- Linux 内核文档, admin-guide/mm/slab_allocator, https://www.kernel.org/doc/html/latest/admin-guide/mm/slab_allocator.html
- glibc 源码, `malloc/malloc.c`, `_int_malloc()` 和 `sysmalloc()`
