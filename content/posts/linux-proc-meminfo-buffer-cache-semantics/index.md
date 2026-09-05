---
title: "What Do Buffers and Cache Actually Mean in /proc/meminfo? — The Hidden Semantics of Linux Memory Stats"
description: "Buffers and Cache in /proc/meminfo are not the same. Buffers are block device metadata; Cache is page cache minus swapcache. Source analysis reveals why."
coverImage: "/posts/linux-proc-meminfo-buffer-cache-semantics/images/cover.jpg"
coverImageAlt: "Binary code streaming on a dark background, representing the Linux kernel's memory accounting structures that distinguish Buffers from Cache in /proc/meminfo"
ogImage: "/posts/linux-proc-meminfo-buffer-cache-semantics/images/cover.jpg"
date: "2026-09-05 23:30:00"
lastUpdated: "2026-09-05 23:30:00"
author: "FindNS94"
tags: ["Linux", "Kernel", "Memory Management"]
---

![Binary code streaming on a dark background, representing the Linux kernel's memory accounting structures that distinguish Buffers from Cache in /proc/meminfo](/posts/linux-proc-meminfo-buffer-cache-semantics/images/cover.jpg)

# What Do Buffers and Cache Actually Mean in /proc/meminfo? — The Hidden Semantics of Linux Memory Stats

Every Linux administrator has stared at `/proc/meminfo` and wondered: what is the difference between Buffers and Cache? The names sound similar. Both grow when you read files. Both shrink when applications need memory. Surely they are both "cache" in some sense?

They are not. Buffers and Cache track fundamentally different structures, maintained by different kernel subsystems, with different reclaim semantics. And the formula for Cached is not what most people assume: it is page cache minus swapcache minus buffers.

This article walks through the `fs/proc/meminfo.c` and `mm/page_alloc.c` source to decode every field in `/proc/meminfo`. By the end, you will understand why a server with 2 GB "free" and 40 GB "available" is healthy, why Buffers is usually small on modern systems, and why `MemAvailable` (not `MemFree`) is the metric that actually matters.

<!-- [UNIQUE INSIGHT] The "Cached" field in /proc/meminfo is computed by subtraction: NR_FILE_PAGES minus swapcache minus buffers. This means Cached is not a direct counter — it is a derived value. If swapcache grows (pages swapped in but swap copy kept), Cached shrinks even though the same file content is still in memory. This counterintuitive behavior explains why "Cached" can decrease while actual file caching increases. -->

<!-- more -->

> **Key Takeaways**
> - Buffers ≠ Cache: Buffers count `buffer_head` block device metadata. Cached counts file content in page cache minus swapcache and buffers.
> - The real formula: `Cached = NR_FILE_PAGES - total_swapcache_pages() - Buffers`. It is derived, not directly counted.
> - `MemAvailable` (kernel 3.14+) estimates reclaimable memory. It is the correct "how much can I use" metric, not `MemFree`.
> - "Free memory is wasted memory": Linux aggressively uses RAM for page cache. Low MemFree with high Cached is healthy.
> - AnonPages vs Mapped: AnonPages = anonymous pages mapped to page tables. Mapped = file pages mapped to page tables. They track different things.

---

## The Myth: "Cached Is Just File Cache, Buffer Is Also Cache"

The confusion between Buffers and Cache is understandable — both names contain "cache" and both grow when the system reads from disk. But they serve completely different purposes:

| Aspect | Buffers | Cached |
|--------|---------|--------|
| What it counts | `buffer_head` block device metadata | File content in page cache |
| Source subsystem | Block layer (`block/bdev.c`) | VM subsystem (`mm/filemap.c`) |
| Typical size | Small (MB to low GB) | Large (can be tens of GB) |
| Reclaim method | Rarely reclaimed directly | First to be reclaimed under pressure |
| Grows when | Raw block I/O, metadata operations | Reading files |

The key insight: Buffers are about **block device mapping** (which blocks belong to which file), while Cached are about **file content** (the actual data you read from a file). They are tracked by different subsystems for different reasons.

---

## The /proc/meminfo Source: Where Numbers Come From

Every number in `/proc/meminfo` traces to a specific source function. Understanding the source reveals what each field actually measures.

### si_meminfo() — The Main Function

The primary memory info function lives in `fs/proc/meminfo.c`:

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

`si_meminfo()` itself is simple — it collects basic counters:

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

### The Cached Calculation

Cached is not a direct counter. It is computed by subtraction:

```c
// fs/proc/meminfo.c
cached = global_node_page_state(NR_FILE_PAGES)
       - total_swapcache_pages()
       - i.bufferram;
if (cached < 0) cached = 0;
```

This formula reveals three important facts:

1. **NR_FILE_PAGES** counts ALL file-backed pages (including those also in swap)
2. **total_swapcache_pages()** subtracts pages that are both in swap and memory
3. **bufferram** subtracts pages already counted as Buffers

The result: Cached counts file content that is ONLY in page cache (not in swap, not counted as Buffers).

```
  ┌─────────────────────────────────────────────────────────────────────┐
  │                    NR_FILE_PAGES (all file-backed pages)            │
  │                                                                     │
  │  ┌─────────────────────────────────────────────────────────────┐   │
  │  │              Cached (what /proc/meminfo reports)             │   │
  │  │                                                             │   │
  │  │  = NR_FILE_PAGES - swapcache - buffers                      │   │
  │  │                                                             │   │
  │  └─────────────────────────────────────────────────────────────┘   │
  │                                                                     │
  │  ┌──────────────────┐  ┌──────────────────┐                       │
  │  │   SwapCached     │  │    Buffers       │                       │
  │  │ (pages in both   │  │ (block device    │                       │
  │  │  swap AND memory)│  │  metadata)       │                       │
  │  └──────────────────┘  └──────────────────┘                       │
  └─────────────────────────────────────────────────────────────────────┘
```

---

## Buffers: Block Device Metadata

Buffers count `buffer_head` structures — the kernel's legacy mechanism for tracking block device I/O.

### What Buffers Actually Count

- `buffer_head` structures for raw block I/O operations
- Inode pages from the inode cache (when accessed via block layer)
- Dentry cache entries (when accessed via block layer)
- Superblock buffers
- Block device mapping metadata

### The Source: nr_blockdev_pages()

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

This function iterates all block devices and counts pages in their inode mappings. These are the buffer_head pages used for block-level I/O.

### Why Buffers Are Usually Small

On modern systems, Buffers is typically small (megabytes to low gigabytes) because:

1. **Page cache dominates**: Most file I/O goes through page cache, not buffer cache
2. **Direct I/O bypasses buffers**: `O_DIRECT` and raw block I/O skip the buffer cache
3. **Slab caches metadata**: Dentry and inode caches use slab allocators, not buffer_head

Buffers grows significantly only when:
- Doing raw block I/O (e.g., `dd if=/dev/sda`)
- Accessing files on filesystems without page cache support
- Heavy metadata operations on block devices

---

## Cached: Page Cache Minus Swapcache

Cached counts file content in the page cache, excluding pages also in swap and pages counted as Buffers.

### What Cached Actually Counts

- File-backed pages in page cache (executables, libraries, data files)
- The content you get when you read a file (first read populates, subsequent reads hit)
- Minus: pages that are also in swap (counted under SwapCached)
- Minus: pages already counted as Buffers

### NR_FILE_PAGES — The Global Counter

```c
// include/linux/mm.h
enum node_stat_item {
    NR_FILE_PAGES,    // total file-backed pages in page cache
    NR_ANON_MAPPED,   // anonymous pages mapped to page tables
    NR_PAGETABLE,     // page table pages
    NR_SLAB_RECLAIMABLE_B,
    NR_SLAB_UNRECLAIMABLE_B,
    ...
};
```

`NR_FILE_PAGES` is a global counter maintained by the VM subsystem. It increments when a file page is added to page cache and decrements when removed.

### The Counterintuitive Behavior

Because Cached is derived by subtraction, it can decrease even when actual file caching increases. This happens when:

1. Pages are swapped out and back in → swapcache grows → Cached shraps
2. Block device metadata grows → Buffers grows → Cached shraps

This is why "Cached" is not always a reliable indicator of "how much file content is cached." For that, you want `NR_FILE_PAGES` directly (available via `/proc/vmstat`).

---

## MemAvailable: The Metric That Actually Matters

`MemAvailable` was added in kernel 3.14 to answer the question: "How much memory can a new application use without swapping?"

### Why MemFree Is Misleading

`MemFree` counts completely unused pages. But Linux uses almost all available RAM for page cache. A server with 64 GB RAM might show:

```
MemTotal:       65536000 kB
MemFree:          524288 kB    ← looks scary: only 0.8% free!
MemAvailable:   45875200 kB    ← reality: 70% available
```

The 524 MB "free" is the tiny fraction not used for anything. The 45 GB "available" is the page cache that can be instantly reclaimed.

### The si_memavailable() Implementation

```c
// mm/page_alloc.c — si_memavailable()
u64 si_memavailable(void)
{
    unsigned long available;

    available = global_zone_page_state(NR_FREE_PAGES);
    available -= totalreserve_pages;  // subtract low watermark reserves
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

### What MemAvailable Includes

```
  ┌─────────────────────────────────────────────────────────────────────┐
  │                       MemAvailable                                 │
  │                                                                     │
  │  ┌─────────────────────────────────────────────────────────────┐   │
  │  │  NR_FREE_PAGES (completely free)                            │   │
  │  │  + NR_INACTIVE_FILE (cold file cache — instant reclaim)     │   │
  │  │  + NR_ACTIVE_FILE (hot file cache — reclaimable with work)  │   │
  │  │  + NR_INACTIVE_ANON (cold anon — reclaimable via swap)      │   │
  │  │  + NR_SLAB_RECLAIMABLE_B / 2 (reclaimable kernel caches)    │   │
  │  │  - totalreserve_pages (low watermark reserves)              │   │
  │  │  - swapcache adjustment (pages already counted in swap)     │   │
  │  │  - pagetable adjustment (page table overhead)               │   │
  │  └─────────────────────────────────────────────────────────────┘   │
  └─────────────────────────────────────────────────────────────────────┘
```

The `/2` fractions on slab and pagetable are conservative estimates — not all reclaimable slab can actually be reclaimed, and page tables are needed for any new process.

---

## The Full /proc/meminfo Field Map

Every field in `/proc/meminfo` has a specific source. Here is the complete map:

| Field | Source | Meaning |
|-------|--------|---------|
| `MemFree` | `NR_FREE_PAGES` | Completely unused pages |
| `MemAvailable` | `si_memavailable()` | Estimated reclaimable memory |
| `Buffers` | `nr_blockdev_pages()` | Block device metadata (buffer_head) |
| `Cached` | `NR_FILE_PAGES - swapcache - buffers` | File page cache (derived) |
| `SwapCached` | `total_swapcache_pages()` | Pages in both swap AND memory |
| `Active(anon)` | `NR_ACTIVE_ANON` | Hot anonymous pages |
| `Inactive(anon)` | `NR_INACTIVE_ANON` | Cold anonymous pages |
| `Active(file)` | `NR_ACTIVE_FILE` | Hot file-backed pages |
| `Inactive(file)` | `NR_INACTIVE_FILE` | Cold file-backed pages |
| `Dirty` | `NR_FILE_DIRTY` | Pages needing writeback |
| `Writeback` | `NR_WRITEBACK` | Pages under writeback |
| `AnonPages` | `NR_ANON_MAPPED` | Anonymous pages mapped to pagetables |
| `Mapped` | `NR_FILE_MAPPED` | File pages mapped to pagetables |
| `Shmem` | `NR_SHMEM` | Shared memory (tmpfs, SYSV SHM) |
| `Slab` | `SReclaimable + SUnreclaim` | Kernel slab caches |
| `SReclaimable` | `NR_SLAB_RECLAIMABLE_B` | Reclaimable slab (dcache, inode_cache) |
| `SUnreclaim` | `NR_SLAB_UNRECLAIMABLE_B` | Non-reclaimable slab |
| `PageTables` | `NR_PAGETABLE` | Page table pages |
| `NFS_Unstable` | 0 (legacy) | Always 0 |

### AnonPages vs Mapped

These two fields cause frequent confusion:

- **AnonPages** (`NR_ANON_MAPPED`): Anonymous pages (heap, stack, mmap'd anonymous memory) that are mapped into page tables. These pages are NOT backed by files and must be swapped to reclaim.

- **Mapped** (`NR_FILE_MAPPED`): File-backed pages that are mapped into page tables (executables, libraries, mmap'd files). These pages can be reclaimed by dropping from page cache (if clean) or writing back (if dirty).

The key difference: `Mapped` pages have a backing file and can be re-read. `AnonPages` have no backing file and must go to swap.

---

## "Free Memory Is Wasted Memory"

Linux's design philosophy: unused RAM is wasted RAM. The kernel aggressively caches files to improve performance.

### The Page Cache Lifecycle

```
     read()                  reaccess              memory pressure
       │                       │                       │
       ▼                       ▼                       ▼
  ┌─────────┐   populate   ┌─────────┐   reclaim   ┌─────────┐
  │  Disk   │ ───────────► │  Cache  │ ──────────► │  Free   │
  └─────────┘              └─────────┘             └─────────┘
                                │
                                │ write()
                                ▼
                           ┌─────────┐
                           │  Dirty  │ ──► writeback ──► Disk
                           └─────────┘
```

1. **First read**: Page fetched from disk, stored in page cache (Cached++)
2. **Subsequent reads**: Hit page cache (no disk I/O)
3. **Memory pressure**: Clean pages dropped from cache (Cached--)
4. **Dirty pages**: Written back to disk, then dropped

### Why "Low Free Memory" Is Normal

- Page cache grows to fill available RAM
- Cached pages are the first to be reclaimed under memory pressure
- Clean file pages: instant reclaim (just drop from cache)
- The system performs BETTER with high cache, not worse

### The Monitoring Fallacy

Alerting on "low free memory" is counterproductive. A healthy system has:
- Low `MemFree` (most RAM is used for cache)
- High `Cached` (file content cached for fast access)
- High `MemAvailable` (cache can be reclaimed when needed)
- Low swap I/O (no thrashing)

Better alerting metrics:
- `MemAvailable` < 5-10% of total → memory pressure
- Rising `si`/`so` in `vmstat` → swap thrashing
- Rising `pgmajfault` → disk I/O from page faults
- High `kswapd` CPU → reclaim overhead

---

## How to Read /proc/meminfo in Practice

### Quick Memory Health Check

```bash
# The one-liner that matters
awk '/MemTotal|MemFree|MemAvailable|Cached|Buffers|SwapCached|Dirty|AnonPages|Shmem/ {
    printf "%-15s %s kB\n", $1, $2
}' /proc/meminfo
```

### Understanding Memory Pressure

```bash
# Check page fault rate (minor = cache miss, major = disk I/O)
vmstat 1 5 | awk '{print "minor_faults:", $10, "major_faults:", $11}'

# Check page cache activity
cat /proc/vmstat | grep -E "pgpgin|pgpgout|pgfault|pgmajfault"

# Check kswapd activity
cat /proc/vmstat | grep -E "kswapd|direct_reclaim"
```

### Per-Process Memory Breakdown

```bash
# Detailed memory map for a process
cat /proc/<pid>/status | grep -E "VmSize|VmRSS|VmSwap|VmData|VmStk|VmExe|VmLib"

# Smaps for granular breakdown
cat /proc/<pid>/smaps | grep -E "^(Rss|Shared|Private|Swap|Pss):"

# Check which files a process has mmap'd
cat /proc/<pid>/maps | head -20
```

### Calculating Real Cache Hit Ratio

```bash
# Before and after workload, compare:
# pgpgin (pages read from disk) vs pgfault (total page faults)
# Hit ratio ≈ 1 - (pgpgin / pgfault)
cat /proc/vmstat | grep -E "pgpgin|pgfault"
```

---

## Frequently Asked Questions

### Why is MemFree so low on my server?

This is normal and desirable. Linux uses available RAM for page cache. Low MemFree with high Cached means the kernel is effectively using memory to cache file I/O. Check MemAvailable for the real "how much can I use" number. A healthy server often has MemFree < 5% of total.

### Should I worry about high Cached?

No. High Cached means the kernel is effectively caching file content. These pages are the first to be reclaimed when applications need memory. High Cached is a sign of healthy memory utilization — the kernel is doing its job.

### What is the difference between Cached and SwapCached?

Cached = file content in page cache that is NOT in swap. SwapCached = pages that are BOTH in swap AND in memory (recently swapped in, swap copy kept as backup). They are mutually exclusive in the accounting. If a page is in both swap and memory, it counts toward SwapCached, not Cached.

### Why does Buffers matter?

On modern systems, Buffers is usually small (most metadata uses slab caches, not buffer_head). But on systems with raw block I/O or many small files, Buffers can be significant. It tracks block device metadata (buffer_head), not file content.

### What is Slab and why does it grow?

Slab is the kernel object cache (dcache, inode_cache, task_struct, etc.). SReclaimable can be shrunk under memory pressure (e.g., shrinking dentry cache). SUnreclaim cannot — it holds kernel metadata that must stay in memory. Slab grows as the kernel creates more objects (files opened, processes started).

### How do I know if my system is running out of memory?

Watch MemAvailable (not MemFree). If MemAvailable drops below 5-10% of total RAM, the system is under memory pressure. Also watch for: rising swap I/O (si/so in vmstat), increasing major page faults (pgmajfault), and high kswapd CPU usage.

### What is the difference between AnonPages and Mapped?

AnonPages counts anonymous pages (heap, stack, anonymous mmap) mapped into page tables. Mapped counts file-backed pages (executables, libraries, file mmap) mapped into page tables. AnonPages must be swapped to reclaim; Mapped can be re-read from disk.

---

## Conclusion

`/proc/meminfo` is subtle. Buffers and Cache are not the same — they track different structures from different subsystems. Cached is a derived value (NR_FILE_PAGES minus swapcache minus buffers), not a direct counter. MemAvailable, not MemFree, is the metric that tells you how much memory your applications can actually use.

The "free memory is wasted memory" philosophy explains why Linux servers show low MemFree and high Cached. This is not a problem — it is the kernel doing its job. The page cache makes file I/O faster, and the kernel instantly reclaims cached pages when applications need memory.

For production monitoring, the practical takeaways are: alert on MemAvailable (not MemFree), watch for swap I/O (not swap usage), and understand that high Cached is a feature, not a bug.

---

## Sources

- Linux kernel source, `fs/proc/meminfo.c`, `si_meminfo()` and Cached calculation
- Linux kernel source, `mm/page_alloc.c`, `si_memavailable()`
- Linux kernel source, `block/bdev.c`, `nr_blockdev_pages()`
- Linux kernel source, `mm/vmstat.c`, `global_node_page_state()`
- Linux kernel source, `mm/swap_state.c`, `total_swapcache_pages()`
- Linux kernel Documentation, admin-guide/mm/page_cache, https://www.kernel.org/doc/html/latest/admin-guide/mm/page_cache.html
