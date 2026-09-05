---
title: "What Really Happens When You Call malloc? — Journey from Buddy System to SLUB Allocator"
description: "malloc does not directly request memory from the OS. The path: glibc allocator → brk/mmap → alloc_pages() → Buddy → SLUB. Source analysis reveals why."
coverImage: "/posts/linux-malloc-buddy-slub-allocator-journey/images/cover.jpg"
coverImageAlt: "A screen displaying an error message, representing the complex memory allocation path from malloc through the Linux kernel's Buddy and SLUB allocators"
ogImage: "/posts/linux-malloc-buddy-slub-allocator-journey/images/cover.jpg"
date: "2026-09-06 00:00:00"
lastUpdated: "2026-09-06 00:00:00"
author: "FindNS94"
tags: ["Linux", "Kernel", "Memory Management"]
---

![A screen displaying an error message, representing the complex memory allocation path from malloc through the Linux kernel's Buddy and SLUB allocators](/posts/linux-malloc-buddy-slub-allocator-journey/images/cover.jpg)

# What Really Happens When You Call malloc? — Journey from Buddy System to SLUB Allocator

Every C and C++ developer has called `malloc()`. Most assume it directly requests memory from the operating system. It does not. Between your `malloc(64)` call and the actual allocation of a physical page, there are at least four layers of allocation: the glibc allocator, the kernel's page allocator (Buddy system), the slab allocator (SLUB), and the virtual memory subsystem.

This article walks through the complete path of a `malloc()` call, from the glibc allocator's heap management to the Buddy system's page splitting and the SLUB allocator's lockless fastpath. By the end, you will understand why most allocations never enter kernel space, why the Buddy system tracks "migration types," and why SLUB can allocate memory without taking a single lock.

<!-- [UNIQUE INSIGHT] The most counterintuitive fact about malloc is that it almost never enters kernel space for small allocations. The glibc allocator manages pools of pre-allocated memory obtained via mmap(), and the kernel's SLUB allocator manages pools of pre-obtained physical pages. The actual system calls (brk, mmap) happen rarely — only when these pools run dry. Understanding this explains why malloc is fast (no syscall overhead for most calls) and why memory fragmentation is primarily a userspace concern for small allocations. -->

<!-- more -->

> **Key Takeaways**
> - malloc does not directly call the kernel: glibc allocator manages pools obtained via brk() (small) or mmap() (large, >128KB by default)
> - The Buddy system manages physical pages in power-of-2 blocks (orders 0-10), split on allocation and merged on free
> - Migration types (MOVABLE, UNMOVABLE, RECLAIMABLE) prevent fragmentation by isolating incompatible page types
> - Per-CPU Pageset (PCP) provides lockless order-0 allocation from per-CPU hot/cold page lists
> - SLUB's per-CPU sheaves enable lockless allocation and freeing for most kmalloc calls
> - SLUB size classes (8, 16, 24, 32, 40, 48, 56, 64, 96, 128...) are not pure powers of 2 — intermediate sizes reduce waste

---

## The Myth: "malloc Asks the OS for Memory"

The mental model most developers have: `malloc(64)` → kernel allocates 64 bytes → returns pointer. This is wrong in almost every detail.

The actual path has four layers, and the kernel is only involved when the upper layers run out of pre-allocated memory:

```
  malloc(64)
       │
       ▼
  ┌─────────────────────────────────────────────────────────────────────┐
  │  Layer 1: glibc Allocator (userspace)                              │
  │  • Manages heap via brk() for small allocations                   │
  │  • Manages anonymous mappings via mmap() for large allocations    │
  │  • Caches freed memory in bins (fast bins, small bins, large bins)│
  │  • Does NOT enter kernel for most allocations                     │
  └─────────────────────────────────────────────────────────────────────┘
       │ (only when glibc runs out of cached memory)
       ▼
  ┌─────────────────────────────────────────────────────────────────────┐
  │  Layer 2: Virtual Memory Subsystem (kernel)                       │
  │  • brk()/mmap() expand the process's address space                │
  │  • Creates VMA (Virtual Memory Area) entries                      │
  │  • Does NOT allocate physical pages yet (lazy allocation)         │
  └─────────────────────────────────────────────────────────────────────┘
       │ (only on first access to a new page — page fault)
       ▼
  ┌─────────────────────────────────────────────────────────────────────┐
  │  Layer 3: Page Allocator — Buddy System (kernel)                  │
  │  • Allocates physical pages in power-of-2 blocks                  │
  │  • Splits larger blocks to satisfy smaller requests               │
  │  • Merges freed blocks back into larger blocks                    │
  └─────────────────────────────────────────────────────────────────────┘
       │ (for kernel-internal allocations: kmalloc, slab caches)
       ▼
  ┌─────────────────────────────────────────────────────────────────────┐
  │  Layer 4: Slab Allocator — SLUB (kernel)                          │
  │  • Manages caches of fixed-size kernel objects                    │
  │  • Per-CPU sheaves for lockless allocation                       │
  │  • Obtains physical pages from Buddy system as needed            │
  └─────────────────────────────────────────────────────────────────────┘
```

---

## Layer 1: The glibc Allocator (Userspace)

The glibc allocator (ptmalloc2) is a userspace memory allocator that manages pools of memory obtained from the kernel. It does not enter kernel space for most `malloc()` calls.

### Two Syscall Paths

```c
// glibc malloc/malloc.c — _int_malloc() decision
if (nb <= MAX_FAST_SIZE) {
    // Fast bin: no syscall, use cached chunk
} else if (nb <= M_MMAP_THRESHOLD) {  // default 128KB
    // Small/medium: extend heap via brk()
    result = sysmalloc(nb, av);
    // ... uses brk() to expand heap
} else {
    // Large: mmap() anonymous memory
    mmap_threshold:
    tp = mmap(NULL, tsize, PROT_READ|PROT_WRITE,
              MAP_PRIVATE|MAP_ANONYMOUS, -1, 0);
}
```

| Allocation Size | Path | Syscall | Typical Latency |
|-----------------|------|---------|-----------------|
| < 64 bytes (fast bin) | Cache hit | None | ~10 ns |
| < 128KB (heap) | brk() | brk() (rarely) | ~100 ns (cached) |
| > 128KB (mmap) | mmap() | mmap() (always) | ~1-10 us |

### Why brk() Is Rare

The glibc allocator requests large chunks from the kernel (via brk() or mmap()) and sub-allocates them. A single brk() call might expand the heap by 128KB or more, which satisfies thousands of subsequent malloc() calls without entering the kernel.

### The M_MMAP_THRESHOLD Tunable

```c
// Default: 128 KB (131072 bytes)
// Tunable via:
mallopt(M_MMAP_THRESHOLD, 65536);  // lower to 64KB
```

Lowering this threshold causes large allocations to use mmap() instead of brk(). This can help with fragmentation (mmap'd memory is returned to the OS on free), but increases syscall overhead.

---

## Layer 2: Virtual Memory (Lazy Allocation)

When the glibc allocator calls brk() or mmap(), the kernel does NOT allocate physical pages. It only records the virtual address range:

```c
// mm/mmap.c — do_brk_flags()
unsigned long do_brk_flags(struct mm_struct *mm, unsigned long addr,
                           unsigned long len, unsigned long flags)
{
    // 1. Find a gap in the VMA tree
    // 2. Create a new VMA
    // 3. Do NOT allocate physical pages
    // Physical pages are allocated on first access (page fault)
}
```

This is **lazy allocation**: the kernel promises the memory exists but doesn't back it with physical pages until the process actually reads or writes.

### Page Fault: Where Physical Pages Are Born

When the process first accesses a page in the new VMA:

```
  Process accesses address 0x7f1234000000
       │
       ▼
  ┌─────────────────────────────────────────┐
  │  CPU checks page table: PTE not present │
  │  → Page fault (exception 14 on x86)     │
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
  Buddy system allocates a physical page
```

---

## Layer 3: The Buddy System (Physical Page Allocator)

The Buddy system is the kernel's physical page allocator. It manages pages in power-of-2 sized blocks called "orders."

### The Data Structure

```c
// include/linux/mmzone.h
struct zone {
    struct free_area free_area[MAX_ORDER];  // 11 orders (0-10)
    // ...
};

struct free_area {
    struct list_head free_list[MIGRATE_TYPES];  // per-migratetype lists
    unsigned long nr_free;
};
```

Each zone (DMA, DMA32, Normal, Movable) maintains 11 free lists (orders 0-10), where order `n` tracks blocks of `2^n` contiguous pages:

| Order | Block Size | Pages |
|-------|-----------|-------|
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

### Allocation: `__rmqueue_smallest()`

```c
// mm/page_alloc.c — __rmqueue_smallest()
static __always_inline
struct page *__rmqueue_smallest(struct zone *zone, unsigned int order,
                                int migratetype)
{
    unsigned int current_order;

    // Search from requested order upward
    for (current_order = order; current_order < MAX_ORDER; ++current_order) {
        area = &(zone->free_area[current_order]);
        page = get_page_from_free_area(area, migratetype);
        if (!page) continue;
        // Found a block — split it down to the requested size
        page_del_and_expand(zone, page, order, current_order, migratetype);
        return page;
    }
    return NULL;  // No block available at any order
}
```

The algorithm: find the smallest available block at or above the requested order, then split it repeatedly until it is the right size.

### Freeing: Buddy Merging

```c
// mm/page_alloc.c — __free_one_page()
static inline void __free_one_page(struct page *page, unsigned long pfn,
                                   struct zone *zone, unsigned int order,
                                   int migratetype)
{
    // Check if the "buddy" (adjacent block of same size) is also free
    while (order < MAX_ORDER - 1) {
        buddy = find_buddy_page_pfn(page, pfn, order, &buddy_pfn);
        if (!buddy || !buddy_is_free(buddy, order, migratetype))
            goto done_merging;
        // Merge: remove buddy from its list, combine, move up one order
        __del_page_from_free_list(buddy, zone, order, migratetype);
        combined_pfn = buddy_pfn & pfn;
        order++;
    }
}
```

When a page is freed, the kernel checks if its "buddy" (the adjacent block of the same size) is also free. If so, they merge into a block one order larger. This merging continues recursively.

### Migration Types: Fragmentation Prevention

Pages are categorized into migration types to prevent fragmentation:

| Type | Contents | Can Merge With |
|------|----------|----------------|
| `MIGRATE_UNMOVABLE` | Kernel data, page tables | UNMOVABLE only |
| `MIGRATE_MOVABLE` | User pages, page cache | MOVABLE only |
| `MIGRATE_RECLAIMABLE` | Slab caches | RECLAIMABLE only |
| `MIGRATE_HIGHATOMIC` | Emergency reserves | (special) |
| `MIGRATE_CMA` | Contiguous Memory Allocator | (special) |

**Fallback order**: When a migratetype is exhausted, the allocator steals from other types: `UNMOVABLE → RECLAIMABLE → MOVABLE`.

### Per-CPU Pageset (PCP)

For order-0 allocations (the most common case), the kernel maintains per-CPU page lists to avoid lock contention:

```c
// mm/page_alloc.c
struct per_cpu_pages {
    unsigned int count;      // number of pages in the list
    unsigned int high;       // refill threshold
    unsigned int batch;      // refill amount
    struct list_head lists[2];  // hot and cold lists
};
```

- **Hot list**: Pages likely in CPU cache (recently freed)
- **Cold list**: Pages not in CPU cache
- **Refill**: When `count` drops below `high`, refill `batch` pages from the zone
- **Drain**: When `count` exceeds `high + batch`, return `batch` pages to the zone

PCP makes order-0 allocation lockless on the fast path — just pop from the per-CPU list.

---

## Layer 4: SLUB Allocator (Kernel Object Allocator)

SLUB (the Unqueued Slab Allocator) is the default kernel allocator for fixed-size objects. It is what `kmalloc()` uses.

### Architecture Overview

```
  kmalloc(64)
       │
       ▼
  ┌─────────────────────────────────────────────────────────────────────┐
  │  SLUB Allocator                                                    │
  │                                                                    │
  │  ┌──────────────────────────────────────────────────────────────┐ │
  │  │  Step 1: Find the kmem_cache for size 64                    │ │
  │  │  (size classes: 8, 16, 24, 32, 40, 48, 56, 64, 96, 128...)  │ │
  │  └──────────────────────────────────────────────────────────────┘ │
  │       │                                                          │
  │       ▼                                                          │
  │  ┌──────────────────────────────────────────────────────────────┐ │
  │  │  Step 2: Try per-CPU sheaf (lockless fastpath)              │ │
  │  │  → alloc_from_pcs(): pop from CPU sheaf freelist            │ │
  │  │  → If empty, swap in spare sheaf                            │ │
  │  │  → Success rate: ~95% of allocations                        │ │
  │  └──────────────────────────────────────────────────────────────┘ │
  │       │ (sheaf empty)                                            │
  │       ▼                                                          │
  │  ┌──────────────────────────────────────────────────────────────┐ │
  │  │  Step 3: Try node barn (per-node pool)                      │ │
  │  │  → Take barn->lock                                           │ │
  │  │  → Refill sheaf from barn                                    │ │
  │  └──────────────────────────────────────────────────────────────┘ │
  │       │ (barn empty)                                             │
  │       ▼                                                          │
  │  ┌──────────────────────────────────────────────────────────────┐ │
  │  │  Step 4: Try partial slabs (node list)                      │ │
  │  │  → Take node->list_lock                                      │ │
  │  │  → Find a partial slab with free objects                    │ │
  │  └──────────────────────────────────────────────────────────────┘ │
  │       │ (no partial slabs)                                       │
  │       ▼                                                          │
  │  ┌──────────────────────────────────────────────────────────────┐ │
  │  │  Step 5: Allocate new slab from Buddy system                │ │
  │  │  → alloc_pages() → Buddy system                             │ │
  │  │  → Create new slab, populate freelist                       │ │
  │  └──────────────────────────────────────────────────────────────┘ │
  └─────────────────────────────────────────────────────────────────────┘
```

### The Lockless Fastpath

```c
// mm/slub.c — alloc_from_pcs()
static __always_inline void *alloc_from_pcs(struct kmem_cache *s,
                                            gfp_t gfpflags, int node)
{
    struct sheaf *sheaf = READ_ONCE(s->cpu_sheaves->main);

    if (sheaf) {
        // Lockless pop from sheaf freelist
        object = sheaf->freelist;
        if (object) {
            sheaf->freelist = get_freelist_ptr(s, object);
            return object;
        }
        // Main sheaf empty — try spare
        sheaf = swap_in_spare(s);
        if (sheaf) {
            object = sheaf->freelist;
            if (object) {
                sheaf->freelist = get_freelist_ptr(s, object);
                return object;
            }
        }
    }
    return NULL;  // Fall back to slow path
}
```

The fastpath is a single pointer pop from a linked list with no atomic operations. This is why kmalloc is fast even on 64-core machines.

### Lockless Freeing

```c
// mm/slub.c — free_to_pcs()
static __always_inline bool free_to_pcs(struct kmem_cache *s, void *object)
{
    struct sheaf *sheaf = READ_ONCE(s->cpu_sheaves->main);

    if (sheaf) {
        // Lockless push to sheaf freelist (using cmpxchg_double)
        do {
            freelist = sheaf->freelist;
            counters = sheaf->counters;
            set_freelist_ptr(s, object, freelist);
        } while (!__sheaf_cmpxchg_double(&sheaf->freelist, &sheaf->counters,
                                          freelist, counters,
                                          object, new_counters));
        return true;
    }
    return false;  // Fall back to slow path
}
```

On architectures with `cmpxchg_double`, SLUB can update the freelist and counter atomically without locks.

### SLUB Size Classes

kmalloc uses pre-sized caches:

```
8, 16, 24, 32, 40, 48, 56, 64, 96, 128, 192, 256, 384, 512, 768, 1024,
1536, 2048, 3072, 4096, 8192, ...
```

These are NOT pure powers of 2. Intermediate sizes (24, 40, 48, 56, 96, 192, 384, 768, 1536, 3072) reduce internal fragmentation for common allocation sizes.

### SLUB Lock Order

When the slow path is taken, SLUB follows a strict lock ordering:

```
0. cpu_hotplug_lock
1. slab_mutex (global)
2a. cpu_sheaves->lock (local trylock)
2b. barn->lock (spinlock)
2c. node->list_lock (spinlock)
3. slab_lock(slab) (bit spinlock, arch-specific)
```

This ordering prevents deadlocks when multiple CPUs contend on the same cache.

---

## The Complete Path: malloc(64) Step by Step

Here is what actually happens when you call `malloc(64)`:

```
  malloc(64)
       │
       ▼
  ┌─────────────────────────────────────────────────────────────────────┐
  │  glibc: Check fast bins and small bins                             │
  │  → If a 64-byte chunk is available in a bin: return it (~10 ns)   │
  │  → If not:                                                         │
  └─────────────────────────────────────────────────────────────────────┘
       │ (cache miss)
       ▼
  ┌─────────────────────────────────────────────────────────────────────┐
  │  glibc: Extend heap via brk() (if heap has space)                 │
  │  → brk() syscall: expand program break by 128KB+                  │
  │  → Sub-allocate 64 bytes from the new heap region                 │
  │  → Return pointer (~100 ns + brk cost if syscall needed)          │
  └─────────────────────────────────────────────────────────────────────┘
       │ (first access to the 64 bytes)
       ▼
  ┌─────────────────────────────────────────────────────────────────────┐
  │  CPU: Page fault (PTE not present)                                 │
  │  → handle_mm_fault() → do_anonymous_page()                        │
  │  → alloc_pages(GFP_HIGHUSER_MOVABLE)                               │
  └─────────────────────────────────────────────────────────────────────┘
       │
       ▼
  ┌─────────────────────────────────────────────────────────────────────┐
  │  Buddy: get_page_from_freelist()                                   │
  │  → Check PCP hot list first (lockless)                             │
  │  → If empty: check zone free_area[0]                               │
  │  → If empty: wake kswapd, retry                                    │
  │  → Return a physical page (~100 ns from PCP, ~1-10 us from zone)   │
  └─────────────────────────────────────────────────────────────────────┘
       │
       ▼
  ┌─────────────────────────────────────────────────────────────────────┐
  │  MMU: Map page into PTE, return to userspace                       │
  │  → Process now has a physical page backing its 64 bytes            │
  └─────────────────────────────────────────────────────────────────────┘
```

### When Does Each Layer Get Involved?

| Scenario | Layers Involved | Typical Latency |
|----------|-----------------|-----------------|
| Repeated small malloc | glibc only | ~10 ns |
| First malloc after heap expansion | glibc + brk() | ~1-10 us |
| First access to new page | glibc + page fault + Buddy | ~1-10 us |
| Large malloc (>128KB) | glibc + mmap() + page fault + Buddy | ~10-100 us |
| kmalloc (kernel) | SLUB fastpath | ~50 ns |
| kmalloc (kernel, slow) | SLUB slowpath + Buddy | ~1-10 us |

---

## How to Observe Allocation Behavior

### Observing glibc Allocator Behavior

```bash
# Trace brk() and mmap() syscalls
strace -e brk,mmap ./your_program 2>&1 | head -20

# Check process memory maps
cat /proc/<pid>/maps | grep -E "heap|stack|anon"

# Detailed memory statistics
cat /proc/<pid>/status | grep -E "VmSize|VmRSS|VmData|VmStk"
```

### Observing Page Faults

```bash
# Count page faults for a process
/usr/bin/time -v ./your_program 2>&1 | grep -E "page faults"

# Monitor page faults in real-time
vmstat 1  # look at "faults" column

# Per-process page fault rate
cat /proc/<pid>/stat | awk '{print "minor:", $10, "major:", $11}'
```

### Observing Buddy System

```bash
# Fragmentation information
cat /proc/buddyinfo
# Output:
# Node 0, zone   DMA     1    0    0    1    2    1    1    0    1    1    3
# Node 0, zone  Normal  234  145   89   45   23   12    5    3    1    0    0
# Each column is an order (0-10), value is number of free blocks

# Zone information
cat /proc/zoneinfo | grep -E "Node|zone|free|min|low|high"
```

### Observing SLUB

```bash
# SLUB cache information
cat /proc/slabinfo | head -30
# Output:
# name            <active_objs> <num_objs> <objsize> <objperslab> <pagesperslab> : ...
# kmalloc-64           1234      2048        64          62               1
# kmalloc-128           512      1024       128          32               1
# dentry               4567      8192       192          42               1

# Per-cache details
slabtop  # real-time slab cache viewer
```

---

## Frequently Asked Questions

### Why is malloc fast if it goes through so many layers?

Because most allocations never enter kernel space. The glibc allocator caches memory in bins, and most malloc() calls are satisfied from these caches. The kernel is only involved when the caches run dry (brk/mmap) or when a new physical page is needed (page fault).

### What is the difference between brk() and mmap() for malloc?

brk() expands the heap segment (contiguous with data segment). mmap() creates a new anonymous mapping anywhere in the address space. brk() is used for small allocations (≤128KB), mmap() for large. mmap'd memory is returned to the OS on free(); brk'd memory is only returned if it is at the end of the heap.

### Why does the Buddy system use power-of-2 block sizes?

Power-of-2 blocks enable efficient splitting and merging. A block of size 2^n can be split into two blocks of size 2^(n-1). Two adjacent free blocks of size 2^n can merge into one block of size 2^(n+1). This binary buddy property ensures that buddies can be found by simple address arithmetic.

### What happens when the Buddy system runs out of memory?

When no block is available at any order, the allocator wakes kswapd (background reclaim), then tries direct reclaim (synchronous reclaim in allocation context). If reclaim fails, it tries compaction (moving pages to create contiguous blocks). If all fail, it triggers the OOM killer.

### Why does SLUB have non-power-of-2 size classes?

Pure power-of-2 sizes (8, 16, 32, 64, 128, 256...) would waste up to 50% of memory due to internal fragmentation. Intermediate sizes (24, 40, 48, 56, 96, 192...) reduce waste for common allocation sizes at the cost of slightly more complex cache management.

### What is the difference between SLAB, SLUB, and SLOB?

SLAB is the original slab allocator (complex, high overhead). SLUB (Unqueued Slab) is the default — simpler, per-CPU sheaves, lockless fastpath. SLOB (Simple List of Blocks) is for embedded systems with very little memory. SLUB replaced SLAB as the default in kernel 2.6.23.

---

## Conclusion

malloc is not a simple syscall. It is a multi-layered allocation system where the kernel is only involved when pre-allocated pools run dry. The glibc allocator manages userspace pools via brk() and mmap(). The kernel's Buddy system allocates physical pages in power-of-2 blocks with migration type isolation to prevent fragmentation. SLUB provides lockless allocation for kernel objects using per-CPU sheaves.

Understanding this path explains why malloc is fast (no syscall for most calls), why page faults are the real cost of first access, and why monitoring tools show different "memory usage" depending on which layer they measure (virtual size from brk/mmap, resident size from page faults, physical pages from Buddy system).

---

## Sources

- Linux kernel source, `mm/page_alloc.c`, `__rmqueue_smallest()` and `__free_one_page()`
- Linux kernel source, `mm/slub.c`, `alloc_from_pcs()` and `free_to_pcs()`
- Linux kernel source, `mm/mmap.c`, `do_brk_flags()` and page fault handling
- Linux kernel source, `include/linux/mmzone.h`, zone and free_area structures
- Linux kernel Documentation, admin-guide/mm/slab_allocator, https://www.kernel.org/doc/html/latest/admin-guide/mm/slab_allocator.html
- glibc source, `malloc/malloc.c`, `_int_malloc()` and `sysmalloc()`
