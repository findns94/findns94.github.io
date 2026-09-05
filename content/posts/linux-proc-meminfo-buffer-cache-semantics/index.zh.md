---
title: "/proc/meminfo 中的 Buffers 和 Cache 究竟是什么？—— Linux 内存统计的隐秘语义"
description: "/proc/meminfo 中的 Buffers 和 Cache 并非同一概念。Buffers 统计块设备元数据 (buffer_head)，Cache 统计页缓存减去 swapcache。深入分析 fs/proc/meminfo.c 源码揭示真实语义。"
coverImage: "/posts/linux-proc-meminfo-buffer-cache-semantics/images/cover.jpg"
coverImageAlt: "黑暗背景中流动的二进制代码，代表 Linux 内核的内存会计结构——区分 /proc/meminfo 中 Buffers 与 Cache 的机制"
ogImage: "/posts/linux-proc-meminfo-buffer-cache-semantics/images/cover.jpg"
date: "2026-09-05 23:30:00"
lastUpdated: "2026-09-05 23:30:00"
author: "FindNS94"
tags: ["Linux", "Kernel", "Memory Management"]
---

![黑暗背景中流动的二进制代码，代表 Linux 内核的内存会计结构——区分 /proc/meminfo 中 Buffers 与 Cache 的机制](/posts/linux-proc-meminfo-buffer-cache-semantics/images/cover.jpg)

# /proc/meminfo 中的 Buffers 和 Cache 究竟是什么？—— Linux 内存统计的隐秘语义

每个 Linux 管理员都盯着 `/proc/meminfo` 思考过：Buffers 和 Cache 有什么区别？名字听起来很像。读取文件时两者都会增长。应用需要内存时两者都会缩小。它们大概都是某种"缓存"吧？

不是。Buffers 和 Cache 跟踪的是完全不同的结构，由不同的内核子系统维护，具有不同的回收语义。而且 Cached 的计算公式并非大多数人所想：它是页缓存减去 swapcache 再减去 buffers。

本文通过分析 `fs/proc/meminfo.c` 和 `mm/page_alloc.c` 源码来解码 `/proc/meminfo` 中的每个字段。读完后你会理解为什么一台 2 GB "空闲"、40 GB "可用" 的服务器是健康的，为什么 Buffers 在现代系统上通常很小，以及为什么 `MemAvailable`（而非 `MemFree`）才是真正有意义的指标。

<!-- [UNIQUE INSIGHT] /proc/meminfo 中的 "Cached" 字段是通过减法计算得出的：NR_FILE_PAGES 减去 swapcache 再减去 buffers。这意味着 Cached 不是直接计数的结果——它是一个导出值。如果 swapcache 增长（页被换入但保留了 swap 副本），Cached 会缩小，即使相同的文件内容仍在内存中。这种反直觉的行为解释了为什么"实际文件缓存增加"时"Cache"反而可能减少。 -->

<!-- more -->

> **核心要点**
> - Buffers ≠ Cache：Buffers 统计 `buffer_head` 块设备元数据。Cache 统计页缓存中的文件内容减去 swapcache 和 buffers。
> - 真正公式：`Cached = NR_FILE_PAGES - total_swapcache_pages() - Buffers`。它是导出的，不是直接计数的。
> - `MemAvailable`（kernel 3.14+）估算可回收内存。它是"能用多少"的正确指标，而非 `MemFree`。
> - "空闲内存是浪费的内存"：Linux 积极使用 RAM 作为页缓存。低 MemFree 高 Cached 是健康的。
> - AnonPages vs Mapped：AnonPages = 映射到页表的匿名页。Mapped = 映射到页表的文件页。它们跟踪不同的东西。

---

## 误区："Cache 就是文件缓存，Buffer 也是缓存，差不多"

Buffers 和 Cache 的混淆可以理解——两个名字都带"缓存"，系统从磁盘读取时两者都会增长。但它们服务于完全不同的目的：

| 方面 | Buffers | Cache |
|------|---------|-------|
| 统计什么 | `buffer_head` 块设备元数据 | 页缓存中的文件内容 |
| 来源子系统 | 块层 (`block/bdev.c`) | VM 子系统 (`mm/filemap.c`) |
| 典型大小 | 小 (MB 到低的 GB) | 大 (可达数十 GB) |
| 回收方式 | 很少直接回收 | 压力时首先被回收 |
| 何时增长 | 原始块 I/O、元数据操作 | 读取文件 |

关键洞察：Buffers 是关于**块设备映射**（哪些块属于哪个文件），而 Cache 是关于**文件内容**（你从文件读取的实际数据）。它们由不同的子系统出于不同的原因跟踪。

---

## /proc/meminfo 源码：数字从何而来

`/proc/meminfo` 中的每个数字都追溯到特定的源码函数。理解来源才能揭示每个字段实际测量的内容。

### si_meminfo() — 主函数

主内存信息函数位于 `fs/proc/meminfo.c`：

```c
// fs/proc/meminfo.c
static int show_meminfo(struct seq_file *m, void *v)
{
    struct sysinfo i;

    si_meminfo(&i);
    ...
    seq_printf(m, "MemTotal:       %8lu kB\n", i.totalram);
    seq_printf(m, "MemFree:        %8lu kB\n", i.freeram);
    seq_printf(m, "MemAvailable:   %8lu kB\n", si_memavailable());
    seq_printf(m, "Buffers:        %8lu kB\n", i.bufferram);
    ...
}
```

`si_meminfo()` 本身很简单——它收集基础计数器：

```c
// fs/proc/meminfo.c
void si_meminfo(struct sysinfo *val)
{
    val->totalram = totalram_pages();
    val->freeram = global_zone_page_state(NR_FREE_PAGES);
    val->bufferram = nr_blockdev_pages();
    ...
}
```

### Cached 的计算

Cached 不是直接计数器。它通过减法计算：

```c
// fs/proc/meminfo.c
cached = global_node_page_state(NR_FILE_PAGES)
       - total_swapcache_pages()
       - i.bufferram;
if (cached < 0) cached = 0;
```

这个公式揭示了三个重要事实：

1. **NR_FILE_PAGES** 统计所有文件页（包括那些也在 swap 中的）
2. **total_swapcache_pages()** 减去同时在 swap 和内存中的页
3. **bufferram** 减去已计入 Buffers 的页

结果：Cached 统计仅在页缓存中的文件内容（不在 swap 中，未被计为 Buffers）。

```
  ┌─────────────────────────────────────────────────────────────────────┐
  │                    NR_FILE_PAGES (所有文件页)                        │
  │                                                                     │
  │  ┌─────────────────────────────────────────────────────────────┐   │
  │  │              Cached (/proc/meminfo 报告的)                   │   │
  │  │                                                             │   │
  │  │  = NR_FILE_PAGES - swapcache - buffers                      │   │
  │  │                                                             │   │
  │  └─────────────────────────────────────────────────────────────┘   │
  │                                                                     │
  │  ┌──────────────────┐  ┌──────────────────┐                       │
  │  │   SwapCached     │  │    Buffers       │                       │
  │  │ (同时在 swap     │  │ (块设备元数据)    │                       │
  │  │  和内存中的页)   │  │                  │                       │
  │  └──────────────────┘  └──────────────────┘                       │
  └─────────────────────────────────────────────────────────────────────┘
```

---

## Buffers：块设备元数据

Buffers 统计 `buffer_head` 结构 —— 内核用于跟踪块设备 I/O 的传统机制。

### Buffers 实际统计什么

- 原始块 I/O 操作的 `buffer_head` 结构
- 来自 inode cache 的 inode 页（通过块层访问时）
- Dentry cache 条目（通过块层访问时）
- Superblock 缓冲区
- 块设备映射元数据

### 源码：nr_blockdev_pages()

```c
// block/bdev.c
long nr_blockdev_pages(void)
{
    struct block_device *bdev;
    long ret = 0;
    spin_lock(&all_bdevs_lock);
    list_for_each_entry(bdev, &all_bdevs, bd_list)
        ret += bdev->bd_inode->i_mapping->nrpages;
    spin_unlock(&all_bdevs_lock);
    return ret;
}
```

此函数遍历所有块设备并统计其 inode 映射中的页。这些是用于块级 I/O 的 buffer_head 页。

### Buffers 为什么通常很小

在现代系统上，Buffers 通常很小（兆字节到低的千兆字节），因为：

1. **页缓存占主导**：大多数文件 I/O 通过页缓存，不经过 buffer cache
2. **直接 I/O 绕过 buffers**：`O_DIRECT` 和原始块 I/O 跳过 buffer cache
3. **Slab 缓存元数据**：Dentry 和 inode 缓存使用 slab 分配器，不用 buffer_head

Buffers 仅在以下情况显著增长：
- 执行原始块 I/O（如 `dd if=/dev/sda`）
- 访问不支持页缓存的文件系统上的文件
- 大量块设备元数据操作

---

## Cache：页缓存减去 Swapcache

Cache 统计页缓存中的文件内容，排除同时在 swap 中的页和已计为 Buffers 的页。

### Cache 实际统计什么

- 页缓存中的文件页（可执行文件、库、数据文件）
- 读取文件时获得的内容（首次读取填充，后续读取命中）
- 减去：也在 swap 中的页（计为 SwapCached）
- 减去：已计为 Buffers 的页

### NR_FILE_PAGES —— 全局计数器

```c
// include/linux/mm.h
enum node_stat_item {
    NR_FILE_PAGES,    // 页缓存中的文件页总数
    NR_ANON_MAPPED,   // 映射到页表的匿名页
    NR_PAGETABLE,     // 页表页
    NR_SLAB_RECLAIMABLE_B,
    NR_SLAB_UNRECLAIMABLE_B,
    ...
};
```

`NR_FILE_PAGES` 是由 VM 子系统维护的全局计数器。当文件页被添加到页缓存时递增，移除时递减。

### 反直觉的行为

因为 Cached 通过减法导出，即使实际文件缓存增加，它也可能减少。这发生在：

1. 页被换出又换回 → swapcache 增长 → Cached 缩小
2. 块设备元数据增长 → Buffers 增长 → Cached 缩小

这就是为什么 "Cached" 不总是"缓存了多少文件内容"的可靠指标。要获得那个值，你需要直接查看 `NR_FILE_PAGES`（通过 `/proc/vmstat`）。

---

## MemAvailable：真正有意义的指标

`MemAvailable` 在 kernel 3.14 中加入，回答这个问题："新应用可以使用多少内存而不触发交换？"

### 为什么 MemFree 有误导性

`MemFree` 统计完全未使用的页。但 Linux 几乎将所有可用 RAM 都用于页缓存。一台 64 GB RAM 的服务器可能显示：

```
MemTotal:       65536000 kB
MemFree:          524288 kB    ← 看起来吓人：只有 0.8% 空闲！
MemAvailable:   45875200 kB    ← 现实：70% 可用
```

524 MB "空闲"是未被任何用途使用的微小部分。45 GB "可用"是可以立即回收的页缓存。

### si_memavailable() 实现

```c
// mm/page_alloc.c — si_memavailable()
u64 si_memavailable(void)
{
    unsigned long available;

    available = global_zone_page_state(NR_FREE_PAGES);
    available -= totalreserve_pages;  // 减去低水位线预留
    available += global_node_page_state(NR_INACTIVE_FILE);
    available += global_node_page_state(NR_ACTIVE_FILE);
    available -= min(available / 2, total_swapcache_pages());
    available += global_node_page_state(NR_SLAB_RECLAIMABLE_B) / 2;
    available -= min(available / 2, global_node_page_state(NR_PAGETABLE));
    available += global_node_page_state(NR_INACTIVE_ANON);

    if (available < 0)
        available = 0;

    return available;
}
```

### MemAvailable 包含什么

```
  ┌─────────────────────────────────────────────────────────────────────┐
  │                       MemAvailable                                 │
  │                                                                     │
  │  ┌─────────────────────────────────────────────────────────────┐   │
  │  │  NR_FREE_PAGES (完全空闲)                                    │   │
  │  │  + NR_INACTIVE_FILE (冷文件缓存 — 即时回收)                  │   │
  │  │  + NR_ACTIVE_FILE (热文件缓存 — 可回收但需工作)              │   │
  │  │  + NR_INACTIVE_ANON (冷匿名页 — 通过 swap 回收)              │   │
  │  │  + NR_SLAB_RECLAIMABLE_B / 2 (可回收内核缓存)                │   │
  │  │  - totalreserve_pages (低水位线预留)                         │   │
  │  │  - swapcache 调整 (已在 swap 中计数的页)                    │   │
  │  │  - pagetable 调整 (页表开销)                                 │   │
  │  └─────────────────────────────────────────────────────────────┘   │
  └─────────────────────────────────────────────────────────────────────┘
```

slab 和 pagetable 上的 `/2` 分数是保守估计 —— 并非所有可回收 slab 都能实际回收，任何新进程都需要页表。

---

## 完整的 /proc/meminfo 字段映射

`/proc/meminfo` 中的每个字段都有特定来源。这里是完整映射：

| 字段 | 来源 | 含义 |
|------|------|------|
| `MemFree` | `NR_FREE_PAGES` | 完全未使用的页 |
| `MemAvailable` | `si_memavailable()` | 估算可回收内存 |
| `Buffers` | `nr_blockdev_pages()` | 块设备元数据 (buffer_head) |
| `Cached` | `NR_FILE_PAGES - swapcache - buffers` | 文件页缓存 (导出值) |
| `SwapCached` | `total_swapcache_pages()` | 同时在 swap 和内存中的页 |
| `Active(anon)` | `NR_ACTIVE_ANON` | 热匿名页 |
| `Inactive(anon)` | `NR_INACTIVE_ANON` | 冷匿名页 |
| `Active(file)` | `NR_ACTIVE_FILE` | 热文件页 |
| `Inactive(file)` | `NR_INACTIVE_FILE` | 冷文件页 |
| `Dirty` | `NR_FILE_DIRTY` | 需要回写的页 |
| `Writeback` | `NR_WRITEBACK` | 正在回写的页 |
| `AnonPages` | `NR_ANON_MAPPED` | 映射到页表的匿名页 |
| `Mapped` | `NR_FILE_MAPPED` | 映射到页表的文件页 |
| `Shmem` | `NR_SHMEM` | 共享内存 (tmpfs, SYSV SHM) |
| `Slab` | `SReclaimable + SUnreclaim` | 内核 slab 缓存 |
| `SReclaimable` | `NR_SLAB_RECLAIMABLE_B` | 可回收 slab (dcache, inode_cache) |
| `SUnreclaim` | `NR_SLAB_UNRECLAIMABLE_B` | 不可回收 slab |
| `PageTables` | `NR_PAGETABLE` | 页表页 |
| `NFS_Unstable` | 0 (遗留) | 始终为 0 |

### AnonPages vs Mapped

这两个字段经常引起混淆：

- **AnonPages** (`NR_ANON_MAPPED`)：匿名页（堆、栈、匿名 mmap）映射到页表的数量。这些页没有后备文件，必须通过 swap 回收。

- **Mapped** (`NR_FILE_MAPPED`)：文件页（可执行文件、库、文件 mmap）映射到页表的数量。这些页可以通过从页缓存丢弃（若干净）或写回（若脏）来回收。

关键区别：`Mapped` 页有后备文件，可以重新读取。`AnonPages` 没有后备文件，必须写入 swap。

---

## "空闲内存是浪费的内存"

Linux 的设计哲学：未使用的 RAM 是浪费的 RAM。内核积极缓存文件以提高性能。

### 页缓存生命周期

```
     读取()                 重新访问              内存压力
       │                       │                       │
       ▼                       ▼                       ▼
  ┌─────────┐   填充       ┌─────────┐   回收      ┌─────────┐
  │  磁盘   │ ───────────► │  缓存   │ ──────────► │  空闲   │
  └─────────┘              └─────────┘             └─────────┘
                                │
                                │ 写入()
                                ▼
                           ┌─────────┐
                           │  脏页   │ ──► 回写 ──► 磁盘
                           └─────────┘
```

1. **首次读取**：从磁盘获取页，存入页缓存 (Cached++)
2. **后续读取**：命中页缓存（无磁盘 I/O）
3. **内存压力**：干净页从缓存丢弃 (Cached--)
4. **脏页**：写回磁盘，然后丢弃

### "低空闲内存"为什么是正常的

- 页缓存增长以填满可用 RAM
- 内存压力时缓存页首先被回收
- 干净文件页：即时回收（从缓存丢弃）
- 系统在高缓存下性能更好，不是更差

### 监控的谬误

对"低空闲内存"告警是反生产力的。健康的系统具有：
- 低 `MemFree`（大部分 RAM 用于缓存）
- 高 `Cached`（文件内容被缓存以加速访问）
- 高 `MemAvailable`（缓存在需要时可回收）
- 低 swap I/O（无抖动）

更好的告警指标：
- `MemAvailable` < 总内存的 5-10% → 内存压力
- `vmstat` 中 `si`/`so` 上升 → swap 抖动
- `pgmajfault` 增加 → 页错误导致的磁盘 I/O
- 高 `kswapd` CPU → 回收开销

---

## 如何在实践中读取 /proc/meminfo

### 快速内存健康检查

```bash
# 关键一行命令
awk '/MemTotal|MemFree|MemAvailable|Cached|Buffers|SwapCached|Dirty|AnonPages|Shmem/ {
    printf "%-15s %s kB\n", $1, $2
}' /proc/meminfo
```

### 理解内存压力

```bash
# 检查页错误率 (minor = 缓存未命中, major = 磁盘 I/O)
vmstat 1 5 | awk '{print "minor_faults:", $10, "major_faults:", $11}'

# 检查页缓存活动
cat /proc/vmstat | grep -E "pgpgin|pgpgout|pgfault|pgmajfault"

# 检查 kswapd 活动
cat /proc/vmstat | grep -E "kswapd|direct_reclaim"
```

### 每进程内存明细

```bash
# 进程的详细内存映射
cat /proc/<pid>/status | grep -E "VmSize|VmRSS|VmSwap|VmData|VmStk|VmExe|VmLib"

# Smaps 用于更细粒度分析
cat /proc/<pid>/smaps | grep -E "^(Rss|Shared|Private|Swap|Pss):"

# 检查进程 mmap 了哪些文件
cat /proc/<pid>/maps | head -20
```

### 计算真实缓存命中率

```bash
# 工作负载前后比较：
# pgpgin (从磁盘读取的页) vs pgfault (总页错误)
# 命中率 ≈ 1 - (pgpgin / pgfault)
cat /proc/vmstat | grep -E "pgpgin|pgfault"
```

---

## 常见问题

### 为什么服务器的 MemFree 这么低？

这是正常且理想的。Linux 使用可用 RAM 作为页缓存。低 MemFree 高 Cached 意味着内核正在有效地使用内存来缓存文件 I/O。检查 MemAvailable 获取"能用多少"的真实数字。健康的服务器 MemFree 通常 < 5%。

### 需要担心高 Cached 吗？

不需要。高 Cached 意味着内核正在有效地缓存文件内容。这些页是应用需要内存时首先被回收的。高 Cached 是健康内存利用的信号 —— 内核在做它的工作。

### Cached 和 SwapCached 有什么区别？

Cached = 在页缓存中但不在 swap 中的文件内容。SwapCached = 同时在 swap 和内存中的页（近期被换入，保留了 swap 副本作为备份）。它们在会计中是互斥的。如果一页同时在 swap 和内存中，它计入 SwapCached，不是 Cached。

### Buffers 为什么重要？

在现代系统上，Buffers 通常很小（大多数元数据使用 slab 缓存，不是 buffer_head）。但在有大量原始块 I/O 或小文件的系统上，Buffers 可能很显著。它跟踪块设备元数据 (buffer_head)，不是文件内容。

### Slab 是什么？为什么会增长？

Slab 是内核对象缓存 (dcache, inode_cache, task_struct 等)。SReclaimable 可以在内存压力时被缩减（如缩小 dentry 缓存）。SUnreclaim 不能 —— 它保存必须留在内存中的内核元数据。Slab 随内核创建更多对象（打开文件、启动进程）而增长。

### 如何知道系统是否快耗尽内存了？

看 MemAvailable（不是 MemFree）。如果 MemAvailable 降到总 RAM 的 5-10% 以下，系统处于内存压力中。还要关注：vmstat 中 si/so 上升（swap 抖动）、pgmajfault 增加（主页错误）、kswapd CPU 使用率高。

### AnonPages 和 Mapped 有什么区别？

AnonPages 统计映射到页表的匿名页（堆、栈、匿名 mmap）。Mapped 统计映射到页表的文件页（可执行文件、库、文件 mmap）。AnonPages 必须通过 swap 回收；Mapped 可以从磁盘重新读取。

---

## 总结

`/proc/meminfo` 是微妙的。Buffers 和 Cache 不一样 —— 它们跟踪来自不同子系统的不同结构。Cached 是导出值（NR_FILE_PAGES 减去 swapcache 减去 buffers），不是直接计数器。MemAvailable 不是 MemFree，才是告诉你能用多少内存的指标。

"空闲内存是浪费的内存"哲学解释了为什么 Linux 服务器显示低 MemFree 高 Cached。这不是问题 —— 内核在做它的工作。页缓存使文件 I/O 更快，内核在应用需要内存时立即回收缓存页。

对于生产监控，实际要点是：对 MemAvailable 告警（不是 MemFree），关注 swap I/O（不是 swap 用量），并理解高 Cached 是特性，不是 bug。

---

## 来源

- Linux 内核源码, `fs/proc/meminfo.c`, `si_meminfo()` 和 Cached 计算
- Linux 内核源码, `mm/page_alloc.c`, `si_memavailable()`
- Linux 内核源码, `block/bdev.c`, `nr_blockdev_pages()`
- Linux 内核源码, `mm/vmstat.c`, `global_node_page_state()`
- Linux 内核源码, `mm/swap_state.c`, `total_swapcache_pages()`
- Linux 内核文档, admin-guide/mm/page_cache, https://www.kernel.org/doc/html/latest/admin-guide/mm/page_cache.html
