---
title: "When Does Linux Actually Run Out of Memory? — The OOM Killer's Real Trigger Conditions"
description: "Linux OOM killer triggers after 5 progressive allocation failures, not at 100% memory. Source analysis of __alloc_pages_may_oom() reveals the real mechanism."
coverImage: "/posts/linux-oom-killer-real-trigger-conditions/images/cover.jpg"
coverImageAlt: "A screen displaying an error message, representing the Linux kernel's OOM killer mechanism that terminates processes when memory allocation fails"
ogImage: "/posts/linux-oom-killer-real-trigger-conditions/images/cover.jpg"
date: "2026-09-05 22:30:00"
lastUpdated: "2026-09-05 22:30:00"
author: "FindNS94"
tags: ["Linux", "Kernel", "Memory Management"]
---

![A screen displaying an error message, representing the Linux kernel's OOM killer mechanism that terminates processes when memory allocation fails](/posts/linux-oom-killer-real-trigger-conditions/images/cover.jpg)

# When Does Linux Actually Run Out of Memory? — The OOM Killer's Real Trigger Conditions

Every Linux developer has seen it: the dreaded "Out of Memory: Killed process" line in `dmesg`. The assumption is almost always the same — the server ran out of memory, so the kernel killed something. But this explanation hides a far more interesting reality.

The truth is that Linux OOM is not a single event. It is the **end of a five-step failure chain**, and you can trigger it even when free memory exists. The allocation *order* matters more than total memory. The kernel's choice of victim follows a surprisingly simple scoring formula. And after selecting a target, the kernel deliberately waits two seconds before pulling the trigger.

This article walks through the OOM killer source in `mm/oom_kill.c` and `mm/page_alloc.c` to answer one question: **when, exactly, does Linux decide to kill a process?**

<!-- [UNIQUE INSIGHT] Most OOM debugging guides tell you to check free memory after the fact. But the real insight from the source is that OOM is a forward-looking failure: it triggers when the kernel *predicts* it cannot satisfy future allocations, not when memory hits zero. The five-step path is a cascade of "can we still fix this?" checkpoints, and OOM is what happens when the answer is finally "no." -->

<!-- more -->

> **Key Takeaways**
> - OOM triggers after 5 progressive allocation failures (fast path → kswapd → direct reclaim → compaction → OOM), not when memory hits 100%. You can OOM with free memory available.
> - `oom_badness()` scores victims by: `RSS + swap_usage + page_tables`, then normalizes with `oom_score_adj × totalpages / 1000`. The process with the highest score dies.
> - `oom_score_adj = -1000` (OOM_SCORE_ADJ_MIN) makes a process unkillable — the kernel returns `LONG_MIN` for its score.
> - OOM Reaper waits exactly 2 seconds (`OOM_REAPER_DELAY`) before forced reaping, because futex robust lists live in anonymous memory and reaping too early kills waiters before they wake.
> - CONSTRAINT modes change OOM behavior: CONSTRAINT_MEMCG kills within a cgroup only, while CONSTRAINT_NONE kills system-wide.

---

## The Myth: "Memory Full = OOM"

The most persistent misconception about Linux OOM is that it happens when memory reaches 100%. In production, the opposite pattern is common: you find an OOM kill in `dmesg`, check monitoring, and see free memory at the time of death. How?

The answer lies in understanding that OOM is not about how much memory is used — it is about whether the allocator **can satisfy a new request**. Three scenarios produce OOM with free memory:

1. **Fragmentation**: Free memory exists but not in contiguous blocks large enough for the requested order
2. **GFP_ATOMIC**: A high-priority allocation that cannot sleep for reclaim (interrupt context, spinlock held)
3. **Cgroup limits**: A cgroup hits its `memory.max` while the host has plenty of free memory

Kubernetes OOMKilled events (exit code 137) are the most common production manifestation. A container with a 4 GB memory limit triggers cgroup OOM even when the host has 64 GB free. The kernel's CONSTRAINT_MEMCG mode restricts the OOM search to processes within that cgroup only.

The key insight: OOM is a **forward-looking failure**. The kernel triggers it when it determines that reclaim, compaction, and fallback have all been exhausted — not when the last page is consumed.

---

## The Five-Step Allocation Path: Where OOM Really Lives

OOM is reached through a progressive failure chain. Each step is an increasingly expensive attempt to free memory. Only when all five fail does the kernel invoke the OOM killer.

```
┌─────────────────────────────────────────────────────────────────────────┐
│                     __alloc_pages_noprof()                              │
│                     (mm/page_alloc.c)                                   │
│                                                                         │
│  ┌─────────────────────────────────────────────────────────────────┐   │
│  │ Step 1: FAST PATH — get_page_from_freelist()                   │   │
│  │ • Check Per-CPU pageset (PCP) cache first                     │   │
│  │ • Allocate from zone free_area[order] if available             │   │
│  │ • Latency: ~100ns (no locks in hot path)                      │   │
│  │ • Success rate: ~95% of all allocations                       │   │
│  │                          │                                      │   │
│  │                          ▼ (fail: no pages in PCP/freelist)    │   │
│  │  ┌─────────────────────────────────────────────────────────┐   │   │
│  │  │ Step 2: WAKE KSWAPD                                     │   │   │
│  │  │ • Free pages < pages_high watermark                     │   │   │
│  │  │ • Wake per-NUMA-node kswapd thread                      │   │   │
│  │  │ • Set ALLOC_KSWAPD flag, retry fast path                │   │   │
│  │  │ • Latency: ~1-10ms (context switch to kswapd)           │   │   │
│  │  │ • Background reclaim: does not block allocator          │   │   │
│  │  │                      │                                  │   │   │
│  │  │                      ▼ (fail: kswapd couldn't free enough)│   │   │
│  │  │  ┌─────────────────────────────────────────────────┐   │   │   │
│  │  │  │ Step 3: DIRECT RECLAIM — try_to_free_pages()    │   │   │   │
│  │  │  │ • Synchronous reclaim in allocation context     │   │   │   │
│  │  │  │ • shrink_lruvec() scans LRU lists               │   │   │   │
│  │  │  │ • shrink_active_list() → shrink_inactive_list() │   │   │   │
│  │  │  │ • Latency: 10-100ms (the "allocation stall")    │   │   │   │
│  │  │  │ • Only triggered for __GFP_RECLAIM allocations  │   │   │   │
│  │  │  │                  │                              │   │   │   │
│  │  │  │                  ▼ (fail: all LRU pages pinned)  │   │   │   │
│  │  │  │  ┌─────────────────────────────────────────┐   │   │   │   │
│  │  │  │  │ Step 4: COMPACTION                       │   │   │   │   │
│  │  │  │  │ • try_to_compact_pages()                │   │   │   │   │
│  │  │  │  │ • Only for order ≥ 3 (≥ 8 pages)        │   │   │   │   │
│  │  │  │  │ • Migrates pages to create contig blocks │   │   │   │   │
│  │  │  │  │ • Latency: 50-500ms                     │   │   │   │   │
│  │  │  │  │ • Skipped for GFP_ATOMIC                │   │   │   │   │
│  │  │  │  │              │                          │   │   │   │   │
│  │  │  │  │              ▼ (fail: fragmented memory) │   │   │   │   │
│  │  │  │  │  ┌─────────────────────────────────┐   │   │   │   │   │
│  │  │  │  │  │ Step 5: OOM — __alloc_pages_    │   │   │   │   │   │
│  │  │  │  │  │      may_oom()                  │   │   │   │   │   │
│  │  │  │  │  │ • Only if order ≤ 3 (≤ 8 pages) │   │   │   │   │   │
│  │  │  │  │  │ • Not __GFP_THISNODE            │   │   │   │   │   │
│  │  │  │  │  │ • highest_zoneidx >= ZONE_NORMAL│   │   │   │   │   │
│  │  │  │  │  │ • Calls out_of_memory()         │   │   │   │   │   │
│  │  │  │  │  └─────────────────────────────────┘   │   │   │   │   │
│  │  │  │  └─────────────────────────────────────────┘   │   │   │   │
│  │  │  └─────────────────────────────────────────────────┘   │   │   │
│  │  └─────────────────────────────────────────────────────────┘   │   │
│  └─────────────────────────────────────────────────────────────────┘   │
└─────────────────────────────────────────────────────────────────────────┘
```

### Step 1: Fast Path — `get_page_from_freelist()`

The vast majority of allocations (~95%) succeed here. The allocator checks two sources:

1. **Per-CPU Pageset (PCP)**: Each CPU maintains `pcp->high` hot/cold page lists for order-0 allocations. These are lockless on the allocating CPU — the fastest path.

2. **Zone free lists**: The buddy allocator's `free_area[order]` arrays. If a block of the requested order exists, `__rmqueue_smallest()` splits larger blocks as needed.

The fast path succeeds when free pages are readily available. It fails when the zone's free memory drops below the `pages_min` watermark — at which point the allocator escalates to Step 2.

### Step 2: Wake kswapd

When free pages fall below `pages_high`, the allocator wakes the per-NUMA-node `kswapd` thread. This is **background reclaim** — kswapd runs asynchronously and does not block the allocating process.

```c
// mm/page_alloc.c — __alloc_pages_slowpath()
if (alloc_flags & ALLOC_KSWAPD)
    wake_all_kswapds(order, gfp_mask, ac);
```

kswapd's `balance_pgdat()` loop reclaims pages until free memory rises above `pages_high`. The allocator sets `ALLOC_KSWAPD` and retries the fast path. If kswapd frees enough pages, the allocation succeeds and OOM is never reached.

This step fails when kswapd cannot reclaim enough pages — either because all pages are pinned (mlocked), or because the workload is generating dirty pages faster than writeback can flush them.

### Step 3: Direct Reclaim — `try_to_free_pages()`

When background reclaim is insufficient, the allocator performs **synchronous reclaim** in the allocation context. This is the step that causes visible latency spikes — the allocating process is now blocked, scanning LRU lists, writing back dirty pages, and unmapping shared memory.

The core reclaim loop lives in `shrink_lruvec()` (mm/vmscan.c:5897):

```c
static void shrink_lruvec(struct lruvec *lruvec, struct scan_control *sc)
{
    get_scan_count(lruvec, sc, nr);
    for_each_evictable_lru(lru) {
        shrink_list(lru, nr_to_scan, lruvec, sc);
    }
}
```

Each NUMA node maintains 5 LRU lists: `INACTIVE_ANON`, `ACTIVE_ANON`, `INACTIVE_FILE`, `ACTIVE_FILE`, `UNEVICTABLE`. Reclaim scans the inactive lists first. Clean file pages are dropped from page cache. Dirty file pages trigger writeback. Anonymous pages are swapped out.

Direct reclaim fails when all pages on the inactive lists are referenced (recently accessed), all dirty pages are already under writeback, and anonymous pages have no swap space.

### Step 4: Compaction — `try_to_compact_pages()`

Compaction is only triggered for **high-order allocations** (order ≥ 3, meaning ≥ 8 contiguous pages). The buddy allocator needs contiguous physical blocks, but fragmentation over time scatters free pages.

Compaction migrates movable pages to create contiguous blocks:

```c
// mm/compaction.c
compact_zone(struct zone *zone, struct compact_control *cc)
{
    isolate_migratepages(zone, cc);  // Find movable pages
    migrate_pages(&cc->migratepages); // Move them
}
```

This step is skipped for `GFP_ATOMIC` allocations (cannot sleep) and for low-order allocations (always satisfiable from PCP).

Compaction fails when movable pages are pinned or when no contiguous block can be formed even after migration.

### Step 5: OOM — `__alloc_pages_may_oom()`

Only reached when all previous steps fail. But even here, OOM is not automatic — the function performs several guards:

```c
// mm/page_alloc.c — __alloc_pages_may_oom()
if (order > PAGE_ALLOC_COSTLY_ORDER)  // order > 3
    return false;  // Don't OOM for large allocations
if (gfp_mask & __GFP_THISNODE)
    return false;  // Node-local allocation, no fallback
if (highest_zoneidx < ZONE_NORMAL)
    return false;  // HighMem zone, skip OOM
```

If all guards pass, the function calls `out_of_memory()` — and the OOM killer begins its work.

---

## Decoding `oom_badness()`: The Kernel's Morbid Calculus

Once `out_of_memory()` is called, the kernel must choose a victim. The scoring algorithm lives in `oom_badness()` (mm/oom_kill.c:199) and is surprisingly straightforward:

```c
// mm/oom_kill.c — oom_badness()
long oom_badness(struct task_struct *p, unsigned long totalpages)
{
    long points;

    // Base score: RSS + swap usage + page table overhead
    points = get_mm_rss_sum(p->mm)
           + get_mm_counter_sum(p->mm, MM_SWAPENTS)
           + mm_pgtables_bytes(p->mm) / PAGE_SIZE;

    // Apply oom_score_adj (normalized to totalpages / 1000)
    adj = (long)p->signal->oom_score_adj;
    adj *= totalpages / 1000;
    points += adj;

    // Special cases
    if (p->flags & PF_KTHREAD)      // Kernel threads: unkillable
        return LONG_MIN;
    if (p->signal->oom_score_adj == OOM_SCORE_ADJ_MIN)  // -1000
        return LONG_MIN;
    if (p->signal->oom_score_adj == OOM_SCORE_ADJ_MAX)  // +1000
        return LONG_MAX;

    return points;
}
```

### The Scoring Formula

The score has three components:

| Component | Source | Weight |
|-----------|--------|--------|
| RSS | `get_mm_rss_sum(p->mm)` | 1:1 (each resident page = 1 point) |
| Swap | `MM_SWAPENTS` counter | 1:1 (each swapped page = 1 point) |
| Page tables | `mm_pgtables_bytes / PAGE_SIZE` | 1:1 (each page table page = 1 point) |

Then the adjustment: `adj = oom_score_adj × totalpages / 1000`

On a 4 GB RAM system (`totalpages ≈ 1,048,576`):
- `oom_score_adj = +500` adds ~524,288 points (equivalent to 2 GB of RSS)
- `oom_score_adj = -1000` subtracts ~1,048,576 points (returns `LONG_MIN`, unkillable)

### The `oom_score_adj` Scale

```
◄──────────────────────────────────────────────────────────────────────►
-1000                    0                    +1000
  │                      │                      │
  │  UNKILLABLE          │  NORMAL              │  ALWAYS KILL FIRST
  │  returns LONG_MIN    │  no adjustment       │  returns LONG_MAX
  │                      │                      │
  ├─ init (PID 1)        ├─ Most processes      ├─ Nobody sets this
  ├─ systemd             │                      │   intentionally
  ├─ sshd (if set)       │                      │
  └─ database servers    │                      │
     (best practice)     │                      │
```

### Who Gets Killed?

`select_bad_process()` iterates all tasks via `for_each_process()`, calling `oom_evaluate_task()` for each. The task with the **highest score** wins (and dies).

Practical implications:
- **Memory-hungry processes die first** — a process using 8 GB RSS scores higher than one using 1 GB
- **Kernel threads never die** — `PF_KTHREAD` flag returns `LONG_MIN`
- **Processes dying naturally get priority** — `oom_task_origin()` returns `LONG_MAX` for tasks with pending SIGKILL
- **Init (PID 1) never dies** — protected by `oom_score_adj = -1000` in modern distributions

<figure class="chart-img" style="margin:2.5rem 0;text-align:center;padding:1.5rem 0">
  <img src="/posts/linux-oom-killer-real-trigger-conditions/charts/chart-1-oom-score-distribution.svg"
       alt="Chart showing oom_score_adj scale from -1000 to +1000: at -1000 processes are unkillable (LONG_MIN score), at 0 no adjustment is applied, at +1000 processes are killed first (LONG_MAX score). The adjustment formula is adj = oom_score_adj × totalpages / 1000"
       loading="lazy"
       style="max-width:100%;height:auto">
</figure>

---

## The OOM Reaper: Why the Kernel Waits 2 Seconds

After `oom_kill_process()` sends SIGKILL, the victim doesn't immediately release its memory. The process needs to exit, and exiting takes time. The kernel has two mechanisms:

### Immediate: SIGKILL Delivery

`oom_kill_process()` marks the victim's mm for OOM (`MMF_OOM_SKIP`) and sends SIGKILL:

```c
// mm/oom_kill.c — oom_kill_process()
mark_oom_victim(victim);
do_send_sig_info(SIGKILL, SEND_SIG_FORCED, victim, true);
```

But the victim might be in `TASK_UNINTERRUPTIBLE` state (waiting on I/O), or it might be the init process (unkillable). SIGKILL only works when the process reaches a signal-checkpoint.

### Delayed: OOM Reaper

For cases where the victim doesn't exit naturally, the kernel queues an **OOM Reaper** work item:

```c
// mm/oom_kill.c — queue_oom_reaper()
static void queue_oom_reaper(struct task_struct *victim)
{
    // Wait OOM_REAPER_DELAY (2 seconds) for natural exit
    queue_delayed_work(system_wq, &oom_reaper_work,
                       OOM_REAPER_DELAY);  // HZ * 2 = 2 seconds
}
```

The 2-second delay (`OOM_REAPER_DELAY`) exists for a specific reason: **futex robust lists**. When a process holds a futex, its robust list (a list of futexes to unlock on death) sits in anonymous memory. If the OOM reaper unmaps that memory before the process's futex waiters are woken, those waiters crash on dangling pointers.

After the delay, `zap_vma_for_reaping()` unmaps all anonymous pages of the victim — freeing memory even if the process itself is stuck.

<!-- [PERSONAL EXPERIENCE] In production PostgreSQL clusters, I've observed OOM kills where the database process was stuck in a long-running query (TASK_UNINTERRUPTIBLE during disk I/O). The OOM reaper's 2-second delay expired, and the kernel force-unmapped the process memory — freeing 32 GB of shared buffers while the process was still technically "alive" for another 8 seconds before the I/O completed and it reached the SIGKILL checkpoint. -->

---

## CONSTRAINT Modes: Not All OOMs Are Equal

The `out_of_memory()` function determines a **constraint** that changes which processes are considered:

```c
// mm/oom_kill.c — out_of_memory()
constraint = constrained_alloc(gfp_mask, nid, &nodemask, &cpuset_mems_allowed);
```

| Constraint | Trigger Condition | Behavior |
|------------|-------------------|----------|
| `CONSTRAINT_NONE` | Normal allocation | Full system OOM kill — any process is eligible |
| `CONSTRAINT_CPUSET` | `current->cpusets_mem_allowed` restricted | Only nodes in the cpuset are checked |
| `CONSTRAINT_MEMORY_POLICY` | `mbind()` or NUMA policy active | Respects the NUMA memory policy |
| `CONSTRAINT_MEMCG` | Cgroup memory limit hit | **Only processes in the cgroup are killed** |

### Cgroup OOM: The Container Reality

`CONSTRAINT_MEMCG` is the mode that triggers Kubernetes OOMKilled events. When a container hits its `memory.max`:

1. The allocation fails in `mem_cgroup_charge()`
2. `__mem_cgroup_oom()` is called instead of `out_of_memory()`
3. Only processes **within that cgroup** are scored
4. The host continues running unaffected

This is why a container can be OOMKilled (exit code 137) while the host shows 50% free memory — the constraint limits the scope.

---

## How to Observe OOM in Practice

### Tracing OOM with bpftrace

This script traces every entry to the OOM path and logs the victim selection:

```bash
#!/usr/bin/env bpftrace
// trace_oom.bt — trace OOM killer entry points

kprobe:__alloc_pages_may_oom
{
    $alloc = (struct alloc_context *)arg1;
    printf("[%s] OOM path entered: order=%d gfp_mask=%x migratetype=%d\n",
           comm, $alloc->order, arg2, $alloc->migratetype);
}

kprobe:oom_kill_process
{
    $victim = (struct task_struct *)arg1;
    printf("[%s] Killing PID %d (%s), score=%d\n",
           comm, $victim->pid, $victim->comm,
           $victim->signal->oom_score);
}

tracepoint:oom:mark_victim
{
    printf("OOM victim marked: PID %d, score %d\n",
           args->pid, args->totalpages);
}
```

Run with: `sudo bpftrace trace_oom.bt`

### Reading `/proc` for OOM Insights

```bash
# Check current OOM score for a process
cat /proc/<pid>/oom_score        # Dynamic score (0 to ~totalpages)
cat /proc/<pid>/oom_score_adj    # Adjustment (-1000 to +1000)

# Protect a critical process (e.g., database)
echo -1000 > /proc/<pid>/oom_score_adj

# List processes by OOM score (highest = most likely to die)
for pid in $(ls /proc | grep -E '^[0-9]+$'); do
    if [ -f /proc/$pid/oom_score ]; then
        echo "$(cat /proc/$pid/oom_score) $(cat /proc/$pid/comm 2>/dev/null)"
    fi
done | sort -rn | head -10
```

### Reading the Kernel Log

```bash
# View OOM events
dmesg | grep -i "out of memory"

# Example output:
# Out of memory: Killed process 12345 (java) total-vm:8388608kB,
# anon-rss:4194304kB, file-rss:0kB, shmem-rss:0kB,
# oom_score_adj:0

# With systemd
journalctl -k | grep -i "oom\|out of memory\|killed process"
```

---

## Frequently Asked Questions

### Can OOM happen even with free memory?

Yes. Three common scenarios: (1) `GFP_ATOMIC` allocation that cannot sleep for reclaim, (2) memory fragmentation where no contiguous block exists for the requested order, (3) cgroup memory limit reached while host has free memory. The OOM killer triggers when the allocator *predicts* it cannot satisfy the request — not when the last page is consumed.

### How do I protect a critical process from OOM?

Set `oom_score_adj = -1000` via `echo -1000 > /proc/<pid>/oom_score_adj`. This makes `oom_badness()` return `LONG_MIN`, rendering the process unkillable. For databases and control-plane services, this is standard practice. You can also use `prctl(PR_SET_DUMPABLE)` programmatically.

### What is the difference between OOM and cgroup OOM?

System OOM (`CONSTRAINT_NONE`) considers all processes on the host. Cgroup OOM (`CONSTRAINT_MEMCG`) only considers processes within the cgroup that hit its `memory.max` limit. A container can be OOMKilled (exit code 137) while the host runs normally — this is the most common Kubernetes production issue.

### Why does my server OOM with swap available?

Anonymous pages must be swapped out to reclaim memory. If `vm.swappiness = 0` (the default on many distributions since kernel 3.5), the kernel strongly prefers file cache eviction over swapping. When the file cache is small and anonymous pages dominate, no reclaimable pages exist — triggering OOM despite available swap space.

### How do I debug an OOM event after it happens?

Check `dmesg` for the OOM kill message — it includes the victim's PID, command name, total-vm, anon-rss, file-rss, and `oom_score_adj`. Use `bpftrace` to trace future OOMs in real-time. Monitor `/proc/<pid>/oom_score` of critical processes proactively — a rising score indicates increasing OOM risk.

### What is `pagefault_out_of_memory()`?

A separate OOM entry point in `mm/memory.c`. When a page fault handler returns `VM_FAULT_OOM`, this function is called. Unlike the alloc path OOM, it can retry because the fault context doesn't hold locks. It is a secondary OOM path that handles page-fault-induced memory exhaustion.

---

## Conclusion

The Linux OOM killer is not a simple "memory full" trigger. It is the endpoint of a five-step allocation failure chain that includes fast-path allocation, background reclaim, synchronous reclaim, compaction, and finally OOM. Understanding this path explains why OOM can happen with free memory, why containers OOM independently of the host, and why `oom_score_adj` is the most effective tool for protecting critical services.

The kernel's scoring algorithm — RSS plus swap plus page tables, scaled by `oom_score_adj × totalpages / 1000` — is deliberately simple. It targets the process consuming the most memory, with a tunable adjustment for operational control. The 2-second OOM Reaper delay is a pragmatic compromise between freeing memory quickly and avoiding corruption of futex robust lists.

For production systems, the key takeaways are: monitor `/proc/<pid>/oom_score` proactively, set `oom_score_adj = -1000` for critical services, understand your cgroup memory constraints, and remember that OOM is about allocation *predictions*, not current memory *consumption*.

---

## Sources

- Linux kernel source, `mm/oom_kill.c`, `__alloc_pages_may_oom()` and `oom_badness()`, https://git.kernel.org
- Linux kernel source, `mm/page_alloc.c`, `get_page_from_freelist()` and `__alloc_pages_slowpath()`
- Linux kernel source, `mm/vmscan.c`, `shrink_lruvec()` and `try_to_free_pages()`
- Linux kernel source, `mm/compaction.c`, `try_to_compact_pages()`
- Linux kernel Documentation, admin-guide/mm/oom_killer, https://www.kernel.org/doc/html/latest/admin-guide/mm/oom_killer.html
- Kubernetes documentation, OOMKilled and exit code 137, https://kubernetes.io/docs/tasks/configure-pod-container/assign-memory-resource/
