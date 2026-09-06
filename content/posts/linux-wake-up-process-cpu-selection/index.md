---
title: "How Hard Is It to Wake Up a Process? — CPU Selection Logic Behind try_to_wake_up()"
description: "Waking a process is more than setting it runnable. The kernel must choose which CPU to run on, considering cache affinity, NUMA topology, power, and load. Source analysis reveals the decision tree."
coverImage: "/posts/linux-wake-up-process-cpu-selection/images/cover.jpg"
coverImageAlt: "A ball representing the complex CPU selection decision when waking up a sleeping process in the Linux kernel"
ogImage: "/posts/linux-wake-up-process-cpu-selection/images/cover.jpg"
date: "2026-09-06 03:00:00"
lastUpdated: "2026-09-06 03:00:00"
author: "FindNS94"
tags: ["Kernel", "Linux"]
---

![A ball representing the complex CPU selection decision when waking up a sleeping process in the Linux kernel](/posts/linux-wake-up-process-cpu-selection/images/cover.jpg)

# How Hard Is It to Wake Up a Process? — CPU Selection Logic Behind try_to_wake_up()

Every developer knows that waking a sleeping process involves setting it to `TASK_RUNNING` and adding it to a runqueue. But the real complexity lies in a question most never consider: **which CPU should this process run on?**

On a 64-core server, the choice of CPU can mean the difference between a process resuming with warm L1 cache (0.5 ns access) or cold cache requiring NUMA remote memory access (100+ ns). The kernel's wake-up path must balance four competing objectives: cache affinity (run where it last ran), load balancing (run where it's least loaded), power efficiency (consolidate onto fewer cores), and NUMA locality (run near its memory).

This article walks through the wake-up source in `kernel/sched/core.c` to explain how the kernel makes this decision, why the "obvious" choice is often wrong, and how `select_task_rq_fair()` navigates the trade-offs.

<!-- [UNIQUE INSIGHT] The most counterintuitive aspect of wake-up CPU selection is that the "idle CPU" is often the WRONG choice. Waking a process to an idle core means cold cache — the process's working set is still on the previous core's L1/L2. The kernel prefers to wake to the previous CPU (even if it's busy) because cache warmth outweighs the scheduling latency. This is why `wake_affine()` biases toward the waker's CPU, and why `sched_idle_cpu()` is only used as a last resort. -->

<!-- more -->

> **Key Takeaways**
> - Wake-up involves 4 stages: state check, CPU selection, queue insertion, preemption check
> - `pi_lock` serializes wakeup with schedule to prevent races
> - `select_task_rq_fair()` balances cache affinity, load, power, and NUMA
> - `wake_affine()` biases toward the previous CPU for cache warmth
> - sched_domain hierarchy: DMC → MC → DIE → NUMA (smallest to largest)
> - Proxy execution lets a high-priority task "donate" its CPU to a lower-priority task

---

## The Four Stages of Wake-up

```
  wake_up_process() / try_to_wake_up()
       │
       ▼
  ┌─────────────────────────────────────────────────────────────────────┐
  │ Stage 1: STATE CHECK                                               │
  │ • Acquire pi_lock (serializes with schedule)                       │
  │ • Check ttwu_state_match() — is the task in the expected state?    │
  │ • If already runnable, bail out (prevent double-enqueue)            │
  └─────────────────────────────────────────────────────────────────────┘
       │
       ▼
  ┌─────────────────────────────────────────────────────────────────────┐
  │ Stage 2: CPU SELECTION                                             │
  │ • prev_cpu = task_cpu(p) — where it last ran                       │
  │ • select_task_rq_fair() — the decision engine                      │
  │ • Fast path: if prev_cpu is idle, use it                            │
  │ • Slow path: find best CPU considering affinity, load, power        │
  └─────────────────────────────────────────────────────────────────────┘
       │
       ▼
  ┌─────────────────────────────────────────────────────────────────────┐
  │ Stage 3: QUEUE INSERTION                                           │
  │ • ttwu_queue() — enqueue on selected CPU's runqueue                │
  │ • activate_task() → enqueue_task_fair()                            │
  │ • update_load_avg() — update PELT for the target CPU               │
  └─────────────────────────────────────────────────────────────────────┘
       │
       ▼
  ┌─────────────────────────────────────────────────────────────────────┐
  │ Stage 4: PREEMPTION CHECK                                          │
  │ • ttwu_do_wakeup() — check if new task should preempt current      │
  │ • check_preempt_curr() → resched_curr_lazy() if needed             │
  └─────────────────────────────────────────────────────────────────────┘
```

---

## Stage 1: `try_to_wake_up()` — State Check

```c
// kernel/sched/core.c — try_to_wake_up()
int try_to_wake_up(struct task_struct *p, unsigned int state, int wake_flags)
{
    int cpu, success = 0;

    // Prevent concurrent schedule() from interfering
    scoped_guard(raw_spinlock_irqsave, &p->pi_lock) {
        // Check if task is in the expected state
        if (!ttwu_state_match(p, state, &success))
            break;

        // Task is in expected state — proceed with wakeup
        cpu = select_task_rq(p, p->wake_cpu, wake_flags);
    }

    // Queue the task on the selected CPU
    ttwu_queue(p, cpu, wake_flags);

    return success;
}
```

### The Role of `pi_lock`

`pi_lock` (priority inheritance lock) serves double duty:
1. It protects the task's scheduling state during wakeup
2. It serializes with `schedule()` — preventing a race where a task is both being woken up and being scheduled away

Without `pi_lock`, this race could occur:
```
CPU 0: try_to_wake_up()          CPU 1: schedule()
  reads p->state = TASK_RUNNING     sets p->state = TASK_SLEEPING
  selects CPU for wakeup            picks next task
  enqueue on runqueue               (task is now on runqueue AND sleeping)
```

### `ttwu_state_match()`: Preventing Double-Wakeup

```c
// kernel/sched/core.c
static inline bool ttwu_state_match(struct task_struct *p, unsigned int state, int *success)
{
    if (!(p->state & state))
        return false;

    *success = 1;
    return true;
}
```

If the task is already runnable (e.g., another CPU woke it up first), `ttwu_state_match()` returns false and the wakeup is aborted.

---

## Stage 2: `select_task_rq_fair()` — The Decision Engine

This is where the kernel decides **which CPU** the woken task should run on:

```c
// kernel/sched/fair.c — select_task_rq_fair()
static int select_task_rq_fair(struct task_struct *p, int prev_cpu, int wake_flags)
{
    // Fast path: prev_cpu is idle — use it
    if (available_idle_cpu(prev_cpu))
        return prev_cpu;

    // Find the best CPU in the scheduling domain
    int new_cpu = find_idlest_cpu(p, prev_cpu, wake_flags);

    // Apply wake_affine bias (prefer prev_cpu for cache warmth)
    if (wake_flags & WF_SYNC && prev_cpu == smp_processor_id())
        return prev_cpu;  // Sync wakeup: prefer waker's CPU

    return new_cpu;
}
```

### `wake_affine()`: Cache Warmth vs Load

```c
// kernel/sched/fair.c — wake_affine()
static int wake_affine(struct sched_domain *sd, struct task_struct *p,
                       int this_cpu, int prev_cpu, int sync)
{
    int want_affine = 0;

    // If the waker and wakee share cache, prefer affine
    if (cpu_share_cache(this_cpu, prev_cpu))
        want_affine = 1;

    // If prev_cpu has spare capacity, prefer it
    if (want_affine && cfs_rq_idle_capacity(prev_cpu) > 0)
        return prev_cpu;

    // Otherwise, let find_idlest_cpu decide
    return this_cpu;
}
```

The key insight: **cache warmth often outweighs load**. A process waking on its previous CPU benefits from:
- Warm L1/L2 cache (the process's working set is still there)
- Warm TLB entries (address translations cached)
- No cache-line migration overhead

### `find_idlest_cpu()`: The Hierarchical Search

```c
// kernel/sched/fair.c — find_idlest_cpu()
static int find_idlest_cpu(struct task_struct *p, int prev_cpu, int wake_flags)
{
    struct sched_domain *sd;
    int best_cpu = prev_cpu;
    int cpu = smp_processor_id();

    // Walk sched_domain hierarchy from smallest to largest
    for_each_domain(prev_cpu, sd) {
        if (sd->flags & SD_WAKE_AFFINE) {
            // Try to find an idle CPU in this domain
            cpu = find_idlest_group(sd, p, prev_cpu);
            if (cpu != -1) {
                best_cpu = cpu;
                break;
            }
        }
    }

    return best_cpu;
}
```

### The sched_domain Hierarchy

```
  ┌─────────────────────────────────────────────────────────────────────┐
  │                    NUMA Domain (largest)                            │
  │  ┌───────────────────────────────────────────────────────────────┐ │
  │  │                  DIE Domain (package)                         │ │
  │  │  ┌─────────────────────────────────────────────────────────┐ │ │
  │  │  │              MC Domain (multi-core)                     │ │ │
  │  │  │  ┌───────────────────────────────────────────────────┐ │ │ │
  │  │  │  │           DMC Domain (multi-core, shared L2)      │ │ │ │
  │  │  │  │  ┌─────────────────────────────────────────────┐ │ │ │ │
  │  │  │  │  │        SMT Domain (hyper-threading)         │ │ │ │ │
  │  │  │  │  │  CPU0  CPU1  CPU2  CPU3  CPU4  CPU5  ...   │ │ │ │ │
  │  │  │  │  └─────────────────────────────────────────────┘ │ │ │ │
  │  │  │  └───────────────────────────────────────────────────┘ │ │ │
  │  │  └─────────────────────────────────────────────────────────┘ │ │
  │  └───────────────────────────────────────────────────────────────┘ │
  └─────────────────────────────────────────────────────────────────────┘
```

The kernel searches from smallest domain (SMT) to largest (NUMA):
1. **SMT domain**: Try sibling hyper-threads (shared L1/L2)
2. **DMC domain**: Try cores sharing L2 cache
3. **MC domain**: Try cores in the same multi-core package
4. **DIE domain**: Try dies in the same package
5. **NUMA domain**: Try nodes in the same NUMA zone

The first domain with an idle CPU wins. This ensures maximum cache reuse.

---

## Stage 3: `ttwu_queue()` — Queue Insertion

```c
// kernel/sched/core.c — ttwu_queue()
static void ttwu_queue(struct task_struct *p, int cpu, int wake_flags)
{
    struct rq *rq = cpu_rq(cpu);

    // Lock the target runqueue
    rq_lock(rq, &rf);

    // Update runqueue clock
    update_rq_clock(rq);

    // Activate task on target CPU
    activate_task(rq, p, ENQUEUE_WAKEUP);

    // Check for preemption
    ttwu_do_wakeup(rq, p, wake_flags);

    rq_unlock(rq, &rf);
}
```

### `activate_task()`: The Actual Enqueue

```c
// kernel/sched/core.c
void activate_task(struct rq *rq, struct task_struct *p, int flags)
{
    enqueue_task(rq, p, flags);
    WRITE_ONCE(p->on_rq, TASK_ON_RQ_QUEUED);
}

void enqueue_task(struct rq *rq, struct task_struct *p, int flags)
{
    update_rq_clock(rq);
    uclamp_rq_inc(rq, p, flags);        // Utilization clamping
    p->sched_class->enqueue_task(rq, p, flags);  // Class-specific enqueue
    psi_enqueue(p, flags);              // Pressure Stall Information
}
```

---

## Stage 4: Preemption Check

```c
// kernel/sched/core.c — ttwu_do_wakeup()
static void ttwu_do_wakeup(struct rq *rq, struct task_struct *p, int wake_flags)
{
    // Update task state to TASK_RUNNING
    p->state = TASK_RUNNING;

    // Check if the woken task should preempt the current task
    check_preempt_curr(rq, p, wake_flags);

    // Update PELT load tracking
    update_load_avg(cfs_rq_of(&p->se), &p->se, 0);
}
```

If the woken task has higher priority (earlier deadline) than the current task, `check_preempt_curr()` sets `TIF_NEED_RESCHED` on the current CPU.

---

## Deep Detail: Proxy Execution

Proxy execution is a clever optimization where a high-priority task "donates" its CPU time to a lower-priority task:

```c
// kernel/sched/core.c — check_preempt_curr()
void check_preempt_curr(struct rq *rq, struct task_struct *p, int flags)
{
    // If the woken task has higher priority, preempt
    if (p->prio < rq->curr->prio) {
        resched_curr_lazy(rq);
        return;
    }

    // Proxy execution: if current task is blocked but holds a resource
    // that the woken task needs, let the woken task run on this CPU
    if (task_on_rq_queued(rq->curr) && rq->curr->on_rq == TASK_ONQ_QUEUED) {
        // Check if proxy execution applies
        if (task_is_proxy(rq->curr, p)) {
            resched_curr_lazy(rq);
        }
    }
}
```

This prevents priority inversion: a high-priority task waiting for a lock held by a low-priority task can "donate" its CPU to the lock holder.

---

## How to Observe Wake-up Behavior

### bpftrace Script

```bash
#!/usr/bin/env bpftrace
// trace_wakeup.bt

kprobe:try_to_wake_up
{
    @wake[comm] = count();
    @start = nsecs;
}

kprobe:select_task_rq_fair
{
    $prev = arg1;
    printf("[%s] wakeup: prev_cpu=%d\n", comm, $prev);
}

kretprobe:select_task_rq_fair
{
    printf("[%s] selected cpu=%d (prev=%d)\n", comm, $retval, ((struct task_struct *)arg0)->wake_cpu);
}

tracepoint:sched:sched_wakeup
{
    @target_cpu[args->pid] = args->target_cpu;
}

tracepoint:sched:sched_wakeup_new
{
    @new_wake[comm] = count();
}
```

### Reading sched_debug

```bash
// Per-CPU runqueue info
cat /sys/kernel/debug/sched/debug | grep -A5 "cpu#"

// Sched domain topology
cat /sys/kernel/debug/sched/domains/cpu0/domain*/name

// Wake-affine statistics
cat /proc/sys/kernel/sched_domain/cpu0/domain*/wake_affine
```

---

## Frequently Asked Questions

### Why doesn't the kernel always wake to an idle CPU?
Because an idle CPU means cold cache. The woken process's working set is still on the previous CPU's L1/L2 cache. Waking to the previous CPU (even if busy) is often faster due to cache warmth. The kernel only uses idle CPUs when the previous CPU is heavily loaded.

### What is `WF_SYNC`?
`WF_SYNC` is a wakeup flag indicating the waker expects the wakee to run soon (e.g., `wake_up_process()` from an interrupt handler). It biases selection toward the waker's CPU for cache warmth.

### How does NUMA topology affect wake-up?
On NUMA systems, the kernel prefers to wake a process on the same NUMA node as its memory. Remote NUMA access is 2-3x slower than local access. The NUMA domain in the sched_domain hierarchy enforces this.

### What is `sched_idle_cpu()`?
A CPU that is currently running the idle task. The kernel tracks idle CPUs per sched_domain for fast wake-up placement.

### How does load balancing interact with wake-up?
Wake-up placement is a "pull" decision (where should this task run?). Load balancing is a "push" decision (should tasks move between CPUs?). They work together: wake-up places tasks optimally, load balancing corrects imbalances over time.

---

## Conclusion

Waking a process is far more complex than setting it runnable. The kernel must choose which CPU to run on, balancing four competing objectives: cache affinity, load distribution, power efficiency, and NUMA locality. The `select_task_rq_fair()` function navigates these trade-offs through the sched_domain hierarchy, from SMT siblings to NUMA nodes.

For production systems, the practical takeaways are: wake-up placement significantly affects performance (cold vs warm cache), `wake_affine()` biases toward the previous CPU for good reason, and understanding the sched_domain hierarchy helps diagnose scheduling performance issues.

---

## Sources

- Linux kernel source, `kernel/sched/core.c`, `try_to_wake_up()`
- Linux kernel source, `kernel/sched/fair.c`, `select_task_rq_fair()`
- Linux kernel source, `kernel/sched/fair.c`, `wake_affine()`
- Linux kernel source, `kernel/sched/fair.c`, `find_idlest_cpu()`
- Linux kernel source, `kernel/sched/sched.h`, `sched_domain`
