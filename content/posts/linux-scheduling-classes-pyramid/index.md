---
title: "The Scheduling Class Pyramid — The Priority World of STOP/DL/RT/FAIR/IDLE"
description: "Not all processes use CFS. Linux has 5 scheduling classes in a priority hierarchy: STOP > DL > RT > FAIR > IDLE. Source analysis reveals how pick_next_task() iterates classes."
coverImage: "/posts/linux-scheduling-classes-pyramid/images/cover.jpg"
coverImageAlt: "A building representing the Linux scheduling class hierarchy from STOP (highest) to IDLE (lowest)"
ogImage: "/posts/linux-scheduling-classes-pyramid/images/cover.jpg"
date: "2026-09-06 04:00:00"
lastUpdated: "2026-09-06 04:00:00"
author: "FindNS94"
tags: ["Kernel", "Linux"]
---

![A building representing the Linux scheduling class hierarchy from STOP (highest) to IDLE (lowest)](/posts/linux-scheduling-classes-pyramid/images/cover.jpg)

# The Scheduling Class Pyramid — The Priority World of STOP/DL/RT/FAIR/IDLE

Most Linux developers believe all processes are scheduled by CFS (Completely Fair Scheduler). This is wrong. CFS is just one of **five** scheduling classes arranged in a strict priority hierarchy. When a real-time process needs to run, it doesn't wait for CFS tasks to finish — it preempts them immediately. When a deadline-sensitive task has a timing constraint, it doesn't compete with normal processes at all.

The scheduling class hierarchy is one of Linux's most important yet least understood mechanisms. It determines whether your audio playback glitches when the system is loaded, whether your real-time control loop meets its deadlines, and whether the system remains responsive under extreme load.

This article walks through the scheduling class source in `kernel/sched/core.c` to explain how the hierarchy works, what each class does, and how `__pick_next_task()` iterates through them to select the next task.

<!-- [UNIQUE INSIGHT] The scheduling class hierarchy is not just a priority ordering — it's a fail-safe mechanism. Even if the FAIR class (CFS/EEVDF) is overloaded with thousands of tasks, a single RT task will always preempt them all. And even if RT tasks are running, a DL task with an imminent deadline will preempt them. This strict hierarchy guarantees that critical tasks are never delayed by less important ones. -->

<!-- more -->

> **Key Takeaways**
> - Linux has 5 scheduling classes: STOP > DL > RT > FAIR > IDLE (highest to lowest priority)
> - `__pick_next_task()` iterates classes from highest to lowest — first class that returns a task wins
> - STOP class: CPU stopper tasks, highest priority, used for CPU hotplug
> - DL class: EDF + CBS for deadline-scheduled tasks with runtime/deadline/period constraints
> - RT class: Fixed-priority (0-99) FIFO or round-robin for real-time tasks
> - FAIR class: CFS/EEVDF for normal processes (SCHED_NORMAL/BATCH/IDLE)
> - IDLE class: Only runs when no other class has work

---

## The Myth: "All Processes Use CFS"

Run `ps -eo pid,class,prio,comm` on any Linux system and you'll see:

```
  PID CLS PRI COMMAND
    1 FF  119 systemd          (FF = SCHED_FIFO, RT class)
   10 TS  139 migration/0      (TS = SCHED_OTHER, FAIR class)
   20 FF  120 irq/16           (FF = SCHED_FIFO, RT class)
   30 FF   90 ksoftirqd/0      (FF = SCHED_FIFO, RT class)
   40 DL   99 my_rt_app        (DL = SCHED_DEADLINE, DL class)
   50 FF    1 my_control_loop   (FF = SCHED_FIFO, RT class)
```

The `CLS` column reveals the scheduling class: `TS` (FAIR), `FF` (RT FIFO), `RR` (RT RR), `DL` (Deadline), `B` (Batch), `IDLE` (Idle). Most processes use FAIR (TS), but kernel threads and real-time applications use RT or DL.

---

## The Scheduling Class Hierarchy

```
  ┌─────────────────────────────────────────────────────────────────────┐
  │                    __pick_next_task()                               │
  │                    kernel/sched/core.c                              │
  │                                                                     │
  │  for_each_active_class(class) {                                     │
  │      p = class->pick_task(rq, rf);                                  │
  │      if (p) return p;  ← First class that returns a task WINS       │
  │  }                                                                  │
  │  return idle_task;  ← Fallback                                     │
  └─────────────────────────────────────────────────────────────────────┘
       │
       │ Iteration order (highest to lowest priority):
       ▼
  ┌─────────────────────────────────────────────────────────────────────┐
  │  1. stop_sched_class    — CPU stopper (highest)                    │
  │     • Single per-CPU task                                           │
  │     • Used for CPU hotplug, migration                               │
  │     • Cannot be preempted by anything                               │
  └─────────────────────────────────────────────────────────────────────┘
       │ (if no STOP task)
       ▼
  ┌─────────────────────────────────────────────────────────────────────┐
  │  2. dl_sched_class      — Deadline scheduling (EDF + CBS)           │
  │     • SCHED_DEADLINE policy                                         │
  │     • Tasks have runtime, deadline, period                          │
  │     • Earliest deadline first                                       │
  └─────────────────────────────────────────────────────────────────────┘
       │ (if no DL task)
       ▼
  ┌─────────────────────────────────────────────────────────────────────┐
  │  3. rt_sched_class      — Real-time scheduling (FIFO/RR)            │
  │     • SCHED_FIFO / SCHED_RR policies                                │
  │     • Fixed priority 0-99                                           │
  │     • FIFO: run to completion; RR: timeslice rotation               │
  └─────────────────────────────────────────────────────────────────────┘
       │ (if no RT task)
       ▼
  ┌─────────────────────────────────────────────────────────────────────┐
  │  4. fair_sched_class    — Completely Fair (CFS/EEVDF)               │
  │     • SCHED_NORMAL / SCHED_BATCH / SCHED_IDLE policies              │
  │     • The "default" class for most processes                        │
  │     • Uses vruntime/deadline for fairness                           │
  └─────────────────────────────────────────────────────────────────────┘
       │ (if no FAIR task)
       ▼
  ┌─────────────────────────────────────────────────────────────────────┐
  │  5. idle_sched_class    — Idle scheduling (lowest)                  │
  │     • Single per-CPU idle thread                                    │
  │     • Only runs when nothing else can                               │
  │     • Ensures the CPU is never "without a task"                     │
  └─────────────────────────────────────────────────────────────────────┘
```

### The Iteration Code

```c
// kernel/sched/core.c — __pick_next_task()
static inline struct task_struct *__pick_next_task(struct rq *rq, struct rq_flags *rf)
{
    for_each_active_class(class) {
        p = class->pick_task(rq, rf);
        if (p)
            return p;
    }
    return idle_task;
}
```

The `for_each_active_class()` macro walks the linked list of scheduling classes in priority order. The first class that returns a non-NULL task pointer wins. This means:
- A single STOP task preempts everything
- A single DL task preempts RT, FAIR, and IDLE
- A single RT task preempts FAIR and IDLE
- FAIR tasks only run when no STOP, DL, or RT tasks are runnable
- IDLE runs only as a last resort

---

## STOP Class: The Unstoppable

The STOP class has the highest priority in the system. Each CPU has exactly one STOP task:

```c
// kernel/sched/stop_task.c
static struct task_struct *stop_task;

static void set_next_stop_task(struct rq *rq, struct task_struct *stop)
{
    rq->stop = stop;
}

static struct task_struct *pick_task_stop(struct rq *rq, struct rq_flags *rf)
{
    return rq->stop;  // Always returns the stop task if it exists
}
```

STOP tasks are used for:
- **CPU hotplug**: Migrating tasks off a CPU being taken offline
- **CPU migration**: Moving tasks between CPUs
- **Stop machine**: Operations that require all CPUs to synchronize

A STOP task cannot be preempted by anything — not even another STOP task. It runs to completion (or until it voluntarily yields).

---

## DL Class: Deadline Scheduling

The DL class implements **EDF (Earliest Deadline First)** with **CBS (Constant Bandwidth Server)** for bandwidth isolation.

### Task Parameters

Each DL task has three parameters:
- **Runtime (Q)**: How much CPU time it needs per period
- **Deadline (D)**: When the CPU time must be available by
- **Period (P)**: How often the task repeats

```c
// kernel/sched/sched.h — sched_dl_entity
struct sched_dl_entity {
    u64 runtime;        // Remaining runtime in this period
    u64 deadline;       // Absolute deadline
    u64 period;         // Period length
    u64 flags;

    // ...
};
```

### CBS: Bandwidth Enforcement

Without CBS, a DL task could monopolize the CPU by setting runtime = period. CBS enforces bandwidth limits:

```c
// kernel/sched/deadline.c — task_tick_dl()
static void task_tick_dl(struct rq *rq, struct task_struct *p, int queued)
{
    struct sched_dl_entity *dl_se = &p->dl;

    // Decrement remaining runtime
    dl_se->runtime -= rq->clock_task - p->se.exec_start;

    // If runtime exhausted, throttle the task until next period
    if (dl_se->runtime <= 0) {
        // Task has used its bandwidth — reschedule
        resched_curr(rq);
    }
}
```

### EDF Selection

```c
// kernel/sched/deadline.c — pick_task_dl()
static struct task_struct *pick_task_dl(struct rq *rq, struct rq_flags *rf)
{
    struct sched_dl_entity *dl_se;
    struct task_struct *p;

    // Find the task with earliest deadline
    dl_se = pick_earliest_dl_entity(rq);
    if (!dl_se)
        return NULL;

    p = dl_task_of(dl_se);
    return p;
}
```

The DL class maintains a red-black tree sorted by deadline. The leftmost node (earliest deadline) is always selected.

---

## RT Class: Real-Time Scheduling

The RT class handles `SCHED_FIFO` and `SCHED_RR` policies with fixed priorities 0-99 (where 99 is highest).

### FIFO vs RR

| Policy | Behavior | Preemption |
|--------|----------|------------|
| SCHED_FIFO | Runs until blocking or yielding | Only by higher-priority RT tasks |
| SCHED_RR | Runs for a timeslice, then rotates | Higher-priority RT tasks or timeslice expiry |

### Priority Selection: `rt_prio_array`

```c
// kernel/sched/rt.c
struct rt_prio_array {
    DECLARE_BITMAP(bitmap, MAX_RT_PRIO+1);  // One bit per priority level
    struct list_head queue[MAX_RT_PRIO];     // One queue per priority level
};

static struct task_struct *pick_next_rt_entity(struct rq *rq, struct rt_rq *rt_rq)
{
    struct rt_prio_array *array = &rt_rq->active;
    struct sched_rt_entity *next = NULL;
    struct list_head *queue;
    int idx;

    // Find highest priority with runnable tasks
    idx = sched_find_first_bit(array->bitmap, MAX_RT_PRIO);

    queue = array->queue + idx;
    next = list_first_entry(queue, struct sched_rt_entity, run_list);

    return rt_task_of(next);
}
```

The `bitmap` provides O(1) lookup of the highest-priority non-empty queue. `sched_find_first_bit()` is a single hardware instruction (BSF/BSR on x86).

---

## FAIR Class: The Default

The FAIR class is what most developers think of as "the scheduler." It handles:
- `SCHED_NORMAL`: Normal processes (the default)
- `SCHED_BATCH`: CPU-intensive batch jobs (lower priority, longer timeslices)
- `SCHED_IDLE`: Extremely low priority (only runs when nothing else wants CPU)

The FAIR class uses either CFS (older kernels) or EEVDF (Linux 6.6+) for task selection. See Article 6 for the full EEVDF analysis.

```c
// kernel/sched/fair.c — pick_task_fair()
static struct task_struct *pick_task_fair(struct rq *rq, struct rq_flags *rf)
{
    struct cfs_rq *cfs_rq = &rq->cfs;
    struct sched_entity *se;

    if (!cfs_rq->nr_queued)
        return NULL;  // No FAIR tasks — let lower classes try

    // EEVDF selection (Linux 6.6+)
    se = pick_eevdf(cfs_rq, true);

    return task_of(se);
}
```

---

## IDLE Class: The Last Resort

The IDLE class is the simplest — it always returns the per-CPU idle thread:

```c
// kernel/sched/idle.c
static struct task_struct *pick_task_idle(struct rq *rq, struct rq_flags *rf)
{
    return idle_task;  // Always returns the idle thread
}
```

The idle thread runs a loop of `mwait` or `halt` instructions, putting the CPU in a low-power state until an interrupt wakes it.

---

## Deep Detail: SCX (Sched Class Ext)

Linux 6.13+ introduces **SCX (Sched Class Ext)**, a BPF-based extensible scheduling class:

```c
// kernel/sched/ext.c
DEFINE_SCHED_CLASS(ext) = {
    .name = "ext",
    .pick_task = scx_pick_task,
    .enqueue_task = scx_enqueue_task,
    .dequeue_task = scx_dequeue_task,
    .task_tick = scx_task_tick,
    // ...
};
```

SCX inserts between RT and FAIR in the hierarchy:

```
STOP → DL → RT → SCX → FAIR → IDLE
```

A BPF program can implement custom scheduling policies:
- Take over all FAIR tasks (`scx_switched_all()`)
- Implement work-stealing schedulers
- Use BPF maps for scheduling state
- Achieve better tail latency than the built-in classes

This is the future of Linux scheduling — operators can replace the entire FAIR class with a custom BPF scheduler without kernel recompilation.

---

## How to Observe Scheduling Classes

### Using chrt

```bash
// View a process's scheduling policy
chrt -p <pid>

// Set a process to SCHED_FIFO with priority 50
chrt -f -p 50 <pid>

// Set a process to SCHED_DEADLINE
chrt -d --sched-runtime 10000000 --sched-deadline 20000000 --sched-period 20000000 0 ./my_app
```

### Using bpftrace

```bash
#!/usr/bin/env bpftrace
// trace_sched_class.bt

tracepoint:sched:sched_switch
{
    $cls = args->prev_policy;
    printf("Switch: %s (policy=%d) -> %s (policy=%d)\n",
           args->prev_comm, $cls, args->next_comm, args->next_policy);
}

kprobe:pick_next_task
{
    printf("[%s] pick_next_task called\n", comm);
}
```

### Using /proc

```bash
// Per-process scheduling info
cat /proc/<pid>/sched | grep -E "policy|prio|nr_migrations"

// RT task info
cat /proc/sys/kernel/sched_rt_period_us
cat /proc/sys/kernel/sched_rt_runtime_us
```

---

## Frequently Asked Questions

### How do I set a process to real-time?
Use `chrt -f -p <priority> <pid>` for SCHED_FIFO or `chrt -r -p <priority> <pid>` for SCHED_RR. Priority range is 1-99 (99 is highest).

### Can RT tasks starve normal tasks?
Yes, if an RT task runs in an infinite loop, normal (FAIR) tasks will never run. Use `sched_rt_runtime_us` to limit RT bandwidth: `echo 950000 > /proc/sys/kernel/sched_rt_runtime_us` limits RT to 95% of CPU time.

### What is the difference between SCHED_FIFO and SCHED_RR?
SCHED_FIFO runs until the task blocks or yields. SCHED_RR runs for a timeslice, then rotates with other same-priority tasks. Use FIFO for simple real-time tasks, RR for tasks that should share CPU with same-priority peers.

### When should I use SCHED_DEADLINE?
Use SCHED_DEADLINE when your task has explicit timing constraints (e.g., "must complete 5ms of computation every 20ms"). The kernel guarantees the deadline is met if the task is schedulable (utilization < 100%).

### What is SCX and when should I use it?
SCX (Sched Class Ext) allows BPF-based custom schedulers. Use it when the built-in classes don't meet your needs — for example, you want a custom work-stealing algorithm or specialized latency guarantees.

---

## Conclusion

Linux's scheduling class hierarchy is a strict priority pyramid: STOP > DL > RT > FAIR > IDLE. The `__pick_next_task()` function iterates from highest to lowest, and the first class that returns a task wins. This ensures that critical tasks (STOP, DL, RT) always preempt less important ones (FAIR, IDLE).

Understanding this hierarchy is essential for real-time systems, latency-sensitive applications, and system debugging. The practical takeaways are: use RT for hard real-time requirements, DL for deadline-constrained tasks, and FAIR for everything else. And with SCX, the future of Linux scheduling is programmable.

---

## Sources

- Linux kernel source, `kernel/sched/core.c`, `__pick_next_task()`
- Linux kernel source, `kernel/sched/stop_task.c`, `pick_task_stop()`
- Linux kernel source, `kernel/sched/deadline.c`, `pick_task_dl()`
- Linux kernel source, `kernel/sched/rt.c`, `pick_next_rt_entity()`
- Linux kernel source, `kernel/sched/fair.c`, `pick_task_fair()`
- Linux kernel source, `kernel/sched/ext.c`, `scx_sched_class`
