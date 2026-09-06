---
title: "How Often Does Your Process Actually Run? — The Time Philosophy Behind EEVDF Scheduler"
description: "Linux 6.6+ replaced CFS with EEVDF scheduler. Virtual lag and deadline ensure fairness beyond simple vruntime. Source analysis of pick_eevdf() reveals the real mechanism."
coverImage: "/posts/linux-eevdf-scheduler-time-philosophy/images/cover.jpg"
coverImageAlt: "A digital representation of CPU time and scheduling, representing the EEVDF scheduler's virtual runtime and deadline mechanism"
ogImage: "/posts/linux-eevdf-scheduler-time-philosophy/images/cover.jpg"
date: "2026-09-06 01:00:00"
lastUpdated: "2026-09-06 01:00:00"
author: "FindNS94"
tags: ["Kernel", "Linux"]
---

![A digital representation of CPU time and scheduling, representing the EEVDF scheduler's virtual runtime and deadline mechanism](/posts/linux-eevdf-scheduler-time-philosophy/images/cover.jpg)

# How Often Does Your Process Actually Run? — The Time Philosophy Behind EEVDF Scheduler

Every Linux developer has heard of CFS (Completely Fair Scheduler) and its vruntime mechanism. The mental model is intuitive: each process accumulates virtual runtime proportionally to its CPU consumption, and the process with the smallest vruntime runs next. "Completely fair" means every runnable task gets an equal share of CPU time. For over a decade, this model served Linux well.

But since Linux 6.6 (released October 2023), this model is officially outdated. The kernel replaced the CFS selection algorithm with **EEVDF (Earliest Eligible Virtual Deadline First)**, a fundamentally different approach that introduces two concepts CFS never had: **virtual lag** and **deadline**. Understanding EEVDF explains why your interactive process sometimes feels sluggish under heavy load, how the kernel ensures fairness when tasks have different priorities, and why simply comparing vruntime values was never sufficient for true fairness.

This article walks through the EEVDF source in `kernel/sched/fair.c` to answer one deceptively simple question: **when, exactly, does the kernel decide a particular process should run?**

<!-- [UNIQUE INSIGHT] The key insight of EEVDF is that fairness isn't about who has run least (vruntime) — it's about who is "owed" CPU time (virtual lag). A process with positive lag deserves more CPU than it has received, even if its vruntime is already high. This is why EEVDF solves the "interactive process feels sluggish" problem that CFS couldn't fully address: a waking interactive task doesn't need to wait for all CPU-bound tasks to catch up in vruntime — its positive lag ensures it gets scheduled promptly. -->

<!-- more -->

> **Key Takeaways**
> - Linux 6.6+ uses EEVDF instead of pure CFS vruntime scheduling — the RB-tree is still sorted by vruntime, but selection is based on deadline eligibility
> - Virtual lag (`lag_i = w_i × (V - v_i)`) measures how much a process is "owed" CPU time relative to the weighted average
> - Deadline (`deadline_i = vruntime_i + slice_i / weight_i`) determines the actual scheduling order
> - A process is only eligible if `vruntime_i <= min_vruntime` — preventing tasks that have had their share from running again
> - `place_entity()` gives waking processes a vruntime compensation to prevent starvation
> - The `zero_vruntime` trick avoids 64-bit overflow while maintaining correctness

---

## The Myth: "CFS Picks the Process with Smallest vruntime"

The classic CFS algorithm maintains a red-black tree sorted by vruntime. The leftmost node (smallest vruntime) is always selected:

```c
// kernel/sched/fair.c — CFS pick_next_entity()
static struct sched_entity *pick_next_entity(struct cfs_rq *cfs_rq)
{
    struct sched_entity *se = __pick_first_entity(cfs_rq);
    return se;
}
```

Each entity's vruntime advances at a rate inversely proportional to its weight:

```c
// vruntime advances slower for high-priority (high-weight) tasks
curr->vruntime += calc_delta_fair(delta_exec, curr);
// calc_delta_fair: delta * NICE_0_LOAD / se->load.weight
```

For example, a task with nice=0 (weight=1024) running for 10ms accumulates 10ms of vruntime. A task with nice=-5 (weight=335) running for the same 10ms accumulates only ~3.3ms of vruntime — it "ages" slower, so it gets more CPU time.

### Why Pure vruntime Fails

Consider this scenario: a CPU-bound compilation job (make -j64) has been running for an hour, accumulating billions of nanoseconds of vruntime. Now you open a terminal. The shell process wakes up with vruntime=0 (it's been sleeping). Under pure CFS:

```
Compilation job:  vruntime = 3,600,000,000 ns
Shell process:     vruntime = 0 ns
```

The shell immediately preempts the compilation job — good! But now consider a slightly different scenario: the shell has been running intermittently and has vruntime = 3,599,000,000 ns. It goes to sleep (waiting for your input), then wakes up 100ms later with the same vruntime. The compilation job is now at vruntime = 3,600,100,000 ns.

```
Compilation job:  vruntime = 3,600,100,000 ns
Shell process:     vruntime = 3,599,000,000 ns
```

The shell still has lower vruntime, so it runs. But what if there are 64 compilation jobs, all at vruntime ≈ 3,600,000,000 ns? The shell at vruntime = 3,599,000,000 ns must wait for all 64 jobs to catch up before it can run again. Result: your terminal feels sluggish even though it's interactive.

This is the fundamental problem CFS couldn't solve: **vruntime alone cannot distinguish between "this process has had its fair share" and "this process is owed CPU time."**

---

## CFS Legacy: The Red-Black Tree

Before diving into EEVDF, let's fully understand the data structure it operates on. Each CPU's CFS runqueue (`struct cfs_rq`) maintains a red-black tree of schedulable entities:

```c
// kernel/sched/sched.h
struct cfs_rq {
    struct load_weight load;           // Total weight of queued tasks
    unsigned int nr_queued;            // Number of queued entities
    unsigned int h_nr_queued;          // Including group sched entities

    s64 sum_w_vruntime;                // Weighted vruntime sum (for avg_vruntime)
    u64 sum_weight;                    // Total weight
    u64 zero_vruntime;                 // Reference point for relative vruntime

    struct rb_root_cached tasks_timeline;  // EEVDF red-black tree
    struct sched_entity *curr;         // Currently running entity
    struct sched_entity *next;         // Next to run (cache prediction)
    struct sched_entity *last;         // Last executed (for cache prediction)

    struct sched_avg avg;              // PELT load average
};
```

Each schedulable entity (`struct sched_entity`) contains:

```c
// kernel/sched/sched.h
struct sched_entity {
    struct load_weight load;           // Weight (inverse of nice value)
    struct rb_node run_node;           // RB-tree node
    u64 vruntime;                      // Virtual runtime
    s64 vlag;                          // Virtual lag (V - v_i) * w_i
    u64 deadline;                      // EEVDF deadline
    u64 vprot;                         // Protected virtual time
    u64 slice;                         // Time slice
    u64 exec_start;                    // Start of current execution
    u64 sum_exec_runtime;              // Total execution time
    unsigned char on_rq;               // Is it on a runqueue?

    struct sched_avg avg;              // PELT load tracking
};
```

The tree is sorted by `vruntime`. The leftmost node has the smallest vruntime. Under CFS, this was always the selected task. Under EEVDF, the tree is still sorted by vruntime, but the selection criterion is completely different.

---

## EEVDF: Virtual Lag and Deadline

EEVDF introduces two new concepts that fundamentally change scheduling decisions.

### Virtual Lag: Measuring "Who is Owed CPU Time"

Virtual lag quantifies the gap between a process's vruntime and the weighted average vruntime:

```
lag_i = w_i × (V - v_i)
```

Where:
- `V = Σ(v_i × w_i) / Σw_i` — the weighted average vruntime
- `v_i` — process i's vruntime
- `w_i` — process i's weight (based on nice value, range 820-136 for nice -20 to +19)

**Interpretation:**
- **Positive lag**: Process i has run *less* than its fair share — it deserves more CPU
- **Negative lag**: Process i has run *more* than its fair share — it should yield
- **Zero lag**: Process i has exactly its fair share

The key insight: lag is a **signed** measure. CFS's vruntime is unsigned — it only grows. EEVDF's lag can be positive or negative, capturing the direction of unfairness.

### Deadline: Converting Lag into Scheduling Order

EEVDF converts each task's state into a deadline:

```
deadline_i = vruntime_i + slice_i / weight_i
```

Where `slice_i` is approximately `sched_latency / nr_runnable` (the target scheduling latency divided by the number of runnable tasks). The process with the **earliest eligible deadline** runs next.

Intuitively: a task with low vruntime (hasn't run much) and high weight (high priority) gets an early deadline. A task with high vruntime (has run a lot) and low weight gets a late deadline.

### Eligibility: The Gatekeeper

Not all processes are eligible to run at any given moment. A process is eligible only if:

```
vruntime_i <= min_vruntime(cfs_rq)
```

Where `min_vruntime` is the smallest vruntime among all queued entities. This prevents a process that has already received its fair share from running again immediately after yielding the CPU.

The eligibility check is what makes EEVDF fair: even if a task has the earliest deadline, if its vruntime has caught up to the minimum, it must wait.

---

## The EEVDF Algorithm: `pick_eevdf()`

Here is the core selection algorithm:

```c
// kernel/sched/fair.c — pick_eevdf()
static struct sched_entity *pick_eevdf(struct cfs_rq *cfs_rq, bool protect)
{
    struct rb_node *node = cfs_rq->tasks_timeline.rb_root.rb_node;
    struct sched_entity *se = __pick_first_entity(cfs_rq);

    // Fast path: single task on the runqueue
    if (cfs_rq->h_nr_queued == 1)
        return curr && curr->on_rq ? curr : se;

    // Pick buddy if eligible (cache locality optimization)
    if (sched_feat(PICK_BUDDY) && cfs_rq->next && entity_eligible(cfs_rq, cfs_rq->next))
        return cfs_rq->next;

    // Check leftmost (earliest deadline) — fast path
    if (se && entity_eligible(cfs_rq, se))
        return se;

    // Heap search: eligible entities in left subtree are always better
    while (node) {
        struct sched_entity *left_se = NULL;
        if (node->rb_left) {
            left_se = __node_2_se(node->rb_left);
            // If left subtree has eligible entities, go left
            if (entity_eligible(cfs_rq, left_se)) {
                node = node->rb_left;
                continue;
            }
        }

        // Check current node
        se = __node_2_se(node);
        if (entity_eligible(cfs_rq, se))
            return se;

        // No eligible entity in left subtree or current node — go right
        node = node->rb_right;
    }

    // Should never reach here if there are runnable tasks
    return NULL;
}
```

### Why the Heap Search Works

The red-black tree is sorted by vruntime. Because deadline is derived from vruntime (`deadline = vruntime + slice/weight`), entities with smaller vruntime tend to have earlier deadlines. The heap search exploits this:

1. If the leftmost entity is eligible, it's the winner (O(1) fast path)
2. If not, search for the leftmost eligible entity
3. Because the tree is sorted, an eligible entity in the left subtree always has an earlier deadline than entities in the right subtree

### `entity_eligible()`: The Gatekeeper Function

```c
// kernel/sched/fair.c
static inline bool entity_eligible(struct cfs_rq *cfs_rq, struct sched_entity *se)
{
    return !se->vlag || se->vruntime <= avg_vruntime(cfs_rq);
}
```

A task is eligible if either:
- Its lag is zero (it has exactly its fair share), OR
- Its vruntime is at or below the average (it has run less than average)

---

## `update_curr()`: Advancing vruntime and Lag

Each scheduler tick (or when the task is preempted), `update_curr()` recalculates the current task's state:

```c
// kernel/sched/fair.c — update_curr()
static void update_curr(struct cfs_rq *cfs_rq)
{
    struct sched_entity *curr = cfs_rq->curr;
    u64 now = rq_clock_task(rq_of(cfs_rq));
    s64 delta_exec;

    // Calculate time since last update
    delta_exec = now - curr->exec_start;
    if (!delta_exec)
        return;

    curr->exec_start = now;

    // Advance vruntime proportionally to actual time, inversely to weight
    curr->vruntime += calc_delta_fair(delta_exec, curr);

    // Update virtual lag
    curr->vlag = curr->vlag + (s64)(delta_exec * curr->load.weight) / cfs_rq->sum_weight;

    // Check if deadline expired
    if (update_deadline(cfs_rq, curr))
        resched_curr_lazy(rq_of(cfs_rq));

    // Protect short-slice tasks from preemption
    if (!protect_slice(curr))
        resched_curr_lazy(rq_of(cfs_rq));

    clear_buddies(cfs_rq, curr);
}
```

### `update_deadline()`: When to Reschedule

```c
// kernel/sched/fair.c
static bool update_deadline(struct cfs_rq *cfs_rq, struct sched_entity *curr)
{
    u64 deadline = curr->deadline;

    // If vruntime exceeded deadline, reschedule
    if (curr->vruntime > deadline) {
        curr->deadline = curr->vruntime + curr->slice / curr->load.weight;
        return true;  // Need reschedule
    }

    return false;
}
```

When a task's vruntime exceeds its deadline, the kernel sets `TIF_NEED_RESCHED` to trigger preemption at the next safe point.

---

## `place_entity()`: Wake-up Compensation

When a process wakes up after sleeping, its vruntime may be much higher than the average. Without compensation, it would have to wait for all other tasks to catch up:

```c
// kernel/sched/fair.c — place_entity()
static void place_entity(struct cfs_rq *cfs_rq, struct sched_entity *se, int flags)
{
    u64 vruntime = avg_vruntime(cfs_rq);
    s64 lag = 0;

    // For waking tasks, give a slight advantage
    if (flags & ENQUEUE_WAKEUP) {
        // wakeup_granularity: ~1ms worth of vruntime
        vruntime -= wakeup_granularity(vruntime, se);
    }

    // Clamp to min_vruntime to prevent excessive compensation
    se->vruntime = max_vruntime(se->min_vruntime, vruntime);

    // Initialize deadline
    se->deadline = se->vruntime + se->slice / se->load.weight;
    se->vlag = 0;
}
```

The `wakeup_granularity` (approximately 1ms of vruntime) gives waking tasks a small head start. This is enough to prevent starvation without causing unfairness.

---

## Deep Detail: The `zero_vruntime` Trick

Absolute vruntime values would overflow a 64-bit integer over time. On a 1 GHz equivalent CPU, vruntime advances ~10^9 ns per second, overflowing after ~584 years. But with multiple tasks and weighted calculations, intermediate values can overflow much sooner.

EEVDF uses a relative reference point to avoid this:

```c
// Instead of tracking absolute vruntime (which overflows),
// track relative to cfs_rq->zero_vruntime
//
// V = Σ(v_i - v0)*w_i / Σw_i + v0
//
// Where v0 = cfs_rq->zero_vruntime (the reference point)
```

The kernel maintains:
- `cfs_rq->zero_vruntime`: Reference point (set to the minimum vruntime when the runqueue becomes idle)
- `cfs_rq->sum_w_vruntime`: Weighted sum of `(v_i - v0)` values
- `cfs_rq->sum_weight`: Total weight of queued tasks

The average vruntime is computed as:

```c
static inline u64 avg_vruntime(struct cfs_rq *cfs_rq)
{
    return cfs_rq->zero_vruntime + cfs_rq->sum_w_vruntime / cfs_rq->sum_weight;
}
```

This ensures all arithmetic stays within bounds while preserving the relative ordering that scheduling depends on.

---

## How to Observe EEVDF Behavior

### bpftrace Script

```bash
#!/usr/bin/env bpftrace
// trace_eevdf.bt — trace EEVDF scheduler decisions

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

### Reading sched_debug

```bash
// Per-task scheduling statistics
cat /proc/<pid>/sched

// CFS runqueue debug info
cat /sys/kernel/debug/sched/debug | grep -A10 "cfs_rq"

// Watch vruntime evolve in real-time
watch -n 0.1 'cat /proc/<pid>/sched | grep vruntime'
```

### Measuring Scheduling Latency

```bash
// Use cyclictest to measure scheduling latency
cyclictest -t64 -m -n -p95 -l10000

// Compare CFS vs EEVDF latency distribution
// EEVDF should show better tail latency for interactive tasks
```

---

## Frequently Asked Questions

### How does EEVDF differ from CFS in practice?
EEVDF provides better latency for interactive processes. Under CFS, a waking interactive task with high vruntime had to wait for CPU-bound tasks to catch up. Under EEVDF, virtual lag ensures the interactive task gets scheduled promptly regardless of its absolute vruntime.

### What is the relationship between nice values and EEVDF?
Nice values determine weight (range 820-136 for nice -20 to +19). Higher weight means: (1) slower vruntime advancement, (2) earlier deadline for the same vruntime, (3) more CPU time overall. The weight directly scales virtual lag, so high-priority tasks accumulate positive lag faster when they're not running.

### Why does EEVDF use a deadline instead of just vruntime?
Deadline encodes two dimensions: "how much you've run" (vruntime) and "how much you should run" (slice/weight). CFS's single vruntime dimension couldn't distinguish between a task that has had its fair share and one that is owed time. EEVDF's deadline captures both.

### What is DELAY_DEQUEUE?
A task that briefly sleeps stays on the runqueue (delayed) rather than being immediately removed. If it wakes up and is selected before being dequeued, it can burn off negative lag without being picked — reducing unnecessary context switches and improving cache locality.

### How does EEVDF handle CPU-bound vs interactive tasks?
CPU-bound tasks accumulate vruntime quickly and develop negative lag. Interactive tasks sleep frequently and maintain positive lag. EEVDF naturally prioritizes interactive tasks because their positive lag ensures earlier effective deadlines.

### Is EEVDF backward compatible with CFS?
EEVDF replaces only the task selection algorithm within CFS. All other CFS mechanisms (load balancing, group scheduling, bandwidth control) remain unchanged. The `sched_entity` structure gained new fields (`vlag`, `deadline`, `vprot`) but existing fields are unchanged.

---

## Conclusion

EEVDF represents a fundamental shift in Linux scheduling philosophy. Instead of "pick who has run least" (CFS vruntime), it asks "pick who is owed CPU time" (virtual lag + deadline). The red-black tree is still sorted by vruntime, but the selection criterion is deadline eligibility — a task is eligible only if its vruntime hasn't caught up to the minimum.

For production systems, the practical takeaways are: interactive processes get better response times under EEVDF, the scheduler is more resilient to vruntime starvation scenarios that plagued CFS, and the algorithm scales better to high core counts because eligibility checking prevents excessive task migrations.

The transition from CFS to EEVDF is one of the most significant scheduler changes in Linux history — and understanding it is essential for anyone tuning system performance or debugging latency issues.

---

## Sources

- Linux kernel source, `kernel/sched/fair.c`, `pick_eevdf()` and `update_curr()`
- Linux kernel source, `kernel/sched/fair.c`, `place_entity()` and `update_deadline()`
- Linux kernel source, `kernel/sched/sched.h`, `sched_entity` and `cfs_rq`
- Linux kernel Documentation, scheduler/sched-design-CFS.rst
- Linux kernel commit 5f68c0a0 ("sched/fair: Introduce EEVDF")
