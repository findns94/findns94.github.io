---
title: "What Happens When You mmap Anonymous Memory? — The Magic of the Zero Page, Lazy Allocation, and Copy-on-Write"
description: "mmap anonymous memory does not allocate physical pages. Kernel uses zero page for reads, allocates on first write, copies on write-after-fork. Source reveals why."
coverImage: "/posts/linux-zero-page-lazy-allocation-cow/images/cover.jpg"
coverImageAlt: "A screen displaying an error message, representing the Linux kernel's zero page mechanism that defers physical allocation until first write in anonymous mappings"
ogImage: "/posts/linux-zero-page-lazy-allocation-cow/images/cover.jpg"
date: "2026-09-06 00:30:00"
lastUpdated: "2026-09-06 00:30:00"
author: "FindNS94"
tags: ["Linux", "Kernel", "Memory Management"]
---

![A screen displaying an error message, representing the Linux kernel's zero page mechanism that defers physical allocation until first write in anonymous mappings](/posts/linux-zero-page-lazy-allocation-cow/images/cover.jpg)

# What Happens When You mmap Anonymous Memory? — The Magic of the Zero Page, Lazy Allocation, and Copy-on-Write

Every C developer has called `mmap(NULL, size, PROT_READ|PROT_WRITE, MAP_PRIVATE|MAP_ANONYMOUS, -1, 0)`. The mental model is simple: request memory, get memory, use memory. But what actually happens inside the kernel is far more subtle.

When you mmap anonymous memory, the kernel does NOT allocate physical pages. It records a VMA (Virtual Memory Area) and returns. When you first read from that memory, you get the global zero page — a single physical page (page 0) shared by all zero-filled mappings. When you first write, the kernel finally allocates a real physical page. And when you fork, both parent and child share the same pages until either writes — triggering a copy.

This article walks through the page fault handler in `mm/memory.c` to explain three mechanisms that make anonymous memory efficient: the zero page trick, lazy allocation, and copy-on-write.

<!-- [UNIQUE INSIGHT] The zero page is one of Linux's most elegant optimizations. A single physical page (page 0, the first 4 KB of physical memory) is mapped read-only into every zero-filled anonymous mapping. This means a process that mmaps 1 GB of anonymous memory but only reads it consumes exactly 4 KB of physical RAM (one page table page). The "1 GB allocation" is virtual — it costs nothing until the process actually writes. This is why Linux can overcommit memory: most allocated memory is never touched. -->

<!-- more -->

> **Key Takeaways**
> - mmap anonymous memory does NOT allocate physical pages — it only creates a VMA (Virtual Memory Area) entry
> - First read returns the global zero page (physical page 0), shared by all zero-filled mappings — no allocation needed
> - First write triggers page fault → `do_anonymous_page()` → `alloc_anon_folio()` allocates a real physical page
> - After fork(), parent and child share pages via Copy-on-Write (COW) — `do_wp_page()` copies on first write
> - Overcommit modes control whether the kernel allows allocations beyond physical RAM + swap

---

## The Myth: "mmap Allocates Memory"

The mental model: `mmap(NULL, 1GB, ...)` → kernel allocates 1 GB of physical RAM → returns pointer. This is wrong.

What actually happens:

```
  mmap(NULL, 1GB, PROT_READ|PROT_WRITE, MAP_PRIVATE|MAP_ANONYMOUS, -1, 0)
       │
       ▼
  ┌─────────────────────────────────────────────────────────────────────┐
  │  Kernel: do_mmap()                                                  │
  │  • Find a 1GB gap in the VMA tree                                   │
  │  • Create a new VMA: vm_start=..., vm_end=..., vm_flags=READ|WRITE  │
  │  • Do NOT allocate any physical pages                               │
  │  • Return virtual address                                           │
  └─────────────────────────────────────────────────────────────────────┘
       │
       ▼
  Process has a 1GB virtual address range backed by NOTHING
```

The kernel has promised 1 GB of address space but backed it with zero physical pages. This is **lazy allocation** — physical pages are allocated only when actually accessed.

---

## The Zero Page: Free Reads

When the process first reads from the mmap'd region:

```
  Process reads *ptr (first access to this page)
       │
       ▼
  ┌─────────────────────────────────────────┐
  │  CPU: Check page table — PTE not present│
  │  → Page fault (exception 14 on x86)     │
  └─────────────────────────────────────────┘
       │
       ▼
  ┌─────────────────────────────────────────┐
  │  handle_mm_fault()                      │
  │  → __handle_mm_fault()                  │
  │  → handle_pte_fault()                   │
  │  → do_anonymous_page()                  │
  └─────────────────────────────────────────┘
       │
       ▼
  ┌─────────────────────────────────────────┐
  │  Is this a READ fault?                  │
  │  → YES: Use the zero page               │
  │  → Map PTE to global zero page (page 0) │
  │  → Set PTE flags: READ-ONLY, PRESENT    │
  │  → Return (NO allocation!)              │
  └─────────────────────────────────────────┘
```

### The Global Zero Page

The zero page is a special physical page (the first page of physical memory, page frame 0) that is always filled with zeros. The kernel maps it read-only into every zero-filled anonymous mapping:

```c
// mm/memory.c — do_anonymous_page()
static vm_fault_t do_anonymous_page(struct vm_fault *vmf)
{
    // ...

    /* Read-only mapping of anonymous memory? Use the zero page. */
    if (!(vmf->flags & FAULT_FLAG_WRITE) && !mm_forbids_zeropage(vma->vm_mm)) {
        /*
         * This is a read fault on an anonymous mapping.
         * Map the zero page — no allocation needed.
         */
        vmf->pte = pte_offset_map_lock(vma->vm_mm, vmf->pmd, vmf->address, &vmf->ptl);
        if (!pte_none(vmf->pte))
            goto unlock;
        entry = pte_mkspecial(pfn_pte(my_zero_pfn, vma->vm_page_prot));
        vmf->pte = pte_offset_map_lock(vma->vm_mm, vmf->pmd, vmf->address, &vmf->ptl);
        set_pte_at(vma->vm_mm, vmf->address, vmf->pte, entry);
        ...
        goto unlock;
    }

    /* Write fault — fall through to allocate a real page */
    // ...
}
```

### Why This Matters

The zero page trick means that a process can mmap terabytes of anonymous memory and read it all without consuming any physical RAM (beyond page tables). This is the foundation of Linux's overcommit strategy.

---

## Lazy Allocation: Allocate on First Write

When the process first writes to the mmap'd region:

```
  Process writes *ptr = 42 (first write to this page)
       │
       ▼
  ┌─────────────────────────────────────────┐
  │  CPU: Check page table — PTE not present│
  │  (or PTE present but read-only)         │
  │  → Page fault                           │
  └─────────────────────────────────────────┘
       │
       ▼
  ┌─────────────────────────────────────────┐
  │  handle_mm_fault()                      │
  │  → do_anonymous_page()                  │
  │  → This is a WRITE fault                │
  └─────────────────────────────────────────┘
       │
       ▼
  ┌─────────────────────────────────────────┐
  │  Allocate a real physical page:          │
  │  → alloc_anon_folio(vmf)                │
  │  → alloc_pages(GFP_HIGHUSER_MOVABLE)    │
  │  → Buddy system returns a page          │
  └─────────────────────────────────────────┘
       │
       ▼
  ┌─────────────────────────────────────────┐
  │  Map the page into the PTE:             │
  │  → map_anon_folio_pte_pf()              │
  │  → Set PTE: READ|WRITE, PRESENT         │
  │  → Zero-fill the page (security)        │
  └─────────────────────────────────────────┘
```

### The Allocation Path

```c
// mm/memory.c — do_anonymous_page() (write fault path)
static vm_fault_t do_anonymous_page(struct vm_fault *vmf)
{
    struct folio *folio;

    /* Allocate an anonymous folio */
    folio = alloc_anon_folio(vmf);
    if (!folio) {
        /* No memory available → OOM */
        return VM_FAULT_OOM;
    }

    /* Map the folio into the PTE */
    vmf->pte = pte_offset_map_lock(vma->vm_mm, vmf->pmd, vmf->address, &vmf->ptl);
    map_anon_folio_pte_pf(folio, vmf->pte, vma, vmf->address, ...);

    /* Account the page */
    vm_stat_account(vma->vm_mm, mm_counter_file(vma->vm_mm), folio_nr_pages(folio));
    ...
}
```

### Zero-Fill for Security

The kernel always zero-fills newly allocated anonymous pages. This prevents information leakage between processes — without zero-filling, a process could read leftover data from a page previously used by another process.

---

## Copy-on-Write: Sharing After Fork

When a process forks, the child inherits the parent's address space. But instead of copying all pages (expensive), the kernel shares them via Copy-on-Write (COW).

### Fork: Share Pages as Read-Only

```
  fork()
       │
       ▼
  ┌─────────────────────────────────────────────────────────────────────┐
  │  Kernel: copy_mm() → dup_mm() → dup_mmap()                        │
  │  • Copy VMA tree (virtual address layout)                          │
  │  • Copy page table entries (PTEs)                                  │
  │  • Mark SHARED pages as READ-ONLY in BOTH parent and child        │
  │  • Increment page reference count (page now has 2 users)          │
  │  • Do NOT copy physical pages                                      │
  └─────────────────────────────────────────────────────────────────────┘
       │
       ▼
  Parent and child share the same physical pages, both mapped read-only
```

### Write After Fork: COW Break

```
  Parent or child writes to a shared page
       │
       ▼
  ┌─────────────────────────────────────────┐
  │  CPU: Write to read-only PTE            │
  │  → Page fault (write protection fault)  │
  └─────────────────────────────────────────┘
       │
       ▼
  ┌─────────────────────────────────────────┐
  │  handle_mm_fault()                      │
  │  → do_wp_page() (Write-Protect Page)    │
  └─────────────────────────────────────────┘
       │
       ▼
  ┌─────────────────────────────────────────┐
  │  Is the page shared (refcount > 1)?     │
  │  → YES: Copy-on-Write                   │
  │  → Allocate a new page                  │
  │  → Copy contents from old page          │
  │  → Map new page as READ|WRITE           │
  │  → Decrement old page's refcount        │
  └─────────────────────────────────────────┘
       │
       ▼
  ┌─────────────────────────────────────────┐
  │  Is the page exclusively owned?         │
  │  → YES: Just make it writable           │
  │  → Set PTE: READ|WRITE (no copy!)       │
  └─────────────────────────────────────────┘
```

### The do_wp_page() Implementation

```c
// mm/memory.c — do_wp_page()
static vm_fault_t do_wp_page(struct vm_fault *vmf)
{
    struct folio *folio = vmf->folio;

    if (folio_maybe_dma_pinned(folio)) {
        /* Pinned page — cannot COW, return error */
        return VM_FAULT_NOPAGE;
    }

    if (folio_ref_count(folio) == 1) {
        /* Exclusive owner — just make writable */
        struct vm_area_struct *vma = vmf->vma;
        folio_lock(folio);
        if (pte_write(pte)) {
            /* Already writable — spurious fault */
            folio_unlock(folio);
            return VM_FAULT_NOPAGE;
        }
        /* Upgrade PTE to writable */
        entry = pte_mkwrite(pte_mkdirty(entry));
        set_pte_at(vma->vm_mm, vmf->address, vmf->pte, entry);
        folio_unlock(folio);
        return VM_FAULT_WRITE;
    }

    /* Shared page — must copy */
    new_folio = alloc_anon_folio(vmf);
    if (!new_folio)
        return VM_FAULT_OOM;

    /* Copy contents */
    copy_user_highpage(new_folio, folio, vmf->address, vma);

    /* Map new page */
    __folio_mark_uptodate(new_folio);
    map_anon_folio_pte_pf(new_folio, vmf->pte, vma, vmf->address, ...);

    /* Decrement old page's refcount */
    folio_put(folio);

    return VM_FAULT_WRITE;
}
```

### Why COW Matters

Without COW, forking a process with 1 GB of resident memory would require copying 1 GB of physical pages — a massive expense. With COW, the fork is nearly free (just page table copying). Pages are only copied when actually modified.

---

## Overcommit: Promising More Memory Than Exists

Linux's lazy allocation enables **overcommit** — allowing more memory to be "allocated" than physically exists. This works because most allocated memory is never actually used.

### The Three Overcommit Modes

```bash
# Check current mode
cat /proc/sys/vm/overcommit_memory

# Set mode
echo 2 > /proc/sys/vm/overcommit_memory
```

| Mode | Value | Behavior |
|------|-------|----------|
| Heuristic | 0 | Kernel guesses whether allocation is reasonable (default) |
| Always | 1 | Never refuse an allocation (overcommit everything) |
| Strict | 2 | Refuse allocations beyond CommitLimit |

### The Strict Mode Calculation

In mode 2 (strict), the kernel enforces:

```
CommitLimit = (total_ram - total_huge_pages) * overcommit_ratio / 100 + total_swap
```

Default `overcommit_ratio` is 50, so on a 8 GB RAM + 8 GB swap system:

```
CommitLimit = 8GB * 50/100 + 8GB = 12 GB
```

Any allocation that would push `Committed_As` above `CommitLimit` is refused.

### /proc/meminfo Overcommit Fields

```
CommitLimit:     12582912 kB    ← maximum allowed committed memory
Committed_AS:     4194304 kB    ← currently committed memory
```

`Committed_AS` is the total of all "promised" memory (all VMAs that were not `MAP_NORESERVE`).

---

## How to Observe Zero Page and COW Behavior

### Observing Page Faults

```bash
# Count page faults for a process
/usr/bin/time -v ./your_program 2>&1 | grep -E "page faults"

# Minor faults = zero page / COW (no disk I/O)
# Major faults = swap / file read (disk I/O)
```

### Observing COW in Action

```bash
# Create a test program that:
# 1. mmaps 100MB anonymous memory
# 2. Writes to every page (forces allocation)
# 3. Forks
# 4. Both parent and child write to every page (COW break)

# Before fork: RSS = 100MB
# After fork: RSS = 100MB (shared, COW)
# After both write: RSS = 200MB (COW broken, pages copied)

# Monitor with:
watch -n 0.5 'cat /proc/<pid>/status | grep -E "VmRSS|VmSwap"'
```

### Observing Overcommit

```bash
# Check overcommit settings
cat /proc/sys/vm/overcommit_memory
cat /proc/sys/vm/overcommit_ratio

# Check committed memory
grep -E "CommitLimit|Committed_AS" /proc/meminfo
```

### Using bpftrace to Trace Page Faults

```bash
#!/usr/bin/env bpftrace
// trace_faults.bt

kprobe:do_anonymous_page
{
    printf("[%s] anonymous page fault at %lx (write=%d)\n",
           comm, arg1, (arg2 & FAULT_FLAG_WRITE) ? 1 : 0);
}

kprobe:do_wp_page
{
    printf("[%s] COW break at %lx\n", comm, arg1);
}
```

---

## Frequently Asked Questions

### Does mmap allocate physical pages immediately?

No. `mmap` with `MAP_ANONYMOUS` only creates a VMA (Virtual Memory Area) entry. Physical pages are allocated on first write (via page fault → `do_anonymous_page()`). First reads use the global zero page without allocation.

### What is the zero page?

The zero page is physical page 0 — the first 4 KB of physical memory, always filled with zeros. The kernel maps it read-only into every zero-filled anonymous mapping. This allows reads from unmapped anonymous memory to succeed without allocating physical pages.

### Why does Linux use Copy-on-Write for fork()?

COW avoids the expensive copy of all physical pages during fork(). Instead, parent and child share pages as read-only. Pages are only copied when either process writes to them (COW break). This makes fork() fast even for processes with large memory footprints.

### What happens if the system runs out of memory during a COW break?

If `alloc_anon_folio()` in `do_wp_page()` fails (no memory available), the fault handler returns `VM_FAULT_OOM`. This may trigger the OOM killer to kill a process and free memory.

### What is the difference between overcommit and swap?

Overcommit allows the kernel to promise more memory than physically exists, relying on the fact that most allocations are never used. Swap provides backing store for anonymous pages that are actually used. Overcommit without swap is risky — if all "promised" memory is actually used, the OOM killer must fire.

### Why does my process's RSS grow slowly after malloc?

Because physical pages are allocated lazily — only on first write. A process that mallocs 1 GB but only touches 10 MB will show RSS of ~10 MB, not 1 GB. This is normal and expected.

---

## Conclusion

Anonymous memory in Linux is built on three elegant tricks: the zero page provides free reads, lazy allocation defers physical page allocation until first write, and Copy-on-Write shares pages across fork() until modification. Together, these mechanisms enable Linux's overcommit strategy — allowing more memory to be "allocated" than physically exists, because most allocations are never actually used.

Understanding these mechanisms explains why `mmap` is fast (no physical allocation), why fork is cheap (no page copying), and why monitoring tools show different "memory usage" depending on what they measure (virtual size from mmap, resident size from page faults).

---

## Sources

- Linux kernel source, `mm/memory.c`, `do_anonymous_page()` and zero page mapping
- Linux kernel source, `mm/memory.c`, `do_wp_page()` and Copy-on-Write
- Linux kernel source, `mm/mmap.c`, `do_mmap()` and VMA creation
- Linux kernel source, `mm/oom_kill.c`, OOM handling
- Linux kernel Documentation, admin-guide/sysctl/vm.rst (overcommit), https://www.kernel.org/doc/html/latest/admin-guide/sysctl/vm.html
- Linux kernel Documentation, admin-guide/mm/page_cache, https://www.kernel.org/doc/html/latest/admin-guide/mm/page_cache.html
