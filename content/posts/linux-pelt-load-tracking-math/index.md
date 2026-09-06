---
title: "The Math Behind PELT — How the Kernel Quantifies 'Load'"
description: "CPU load is not CPU usage. PELT uses exponential moving average with 32ms half-life to track per-task load. Source analysis of __accumulate_pelt_segments() reveals the math."
coverImage: "/posts/linux-pelt-load-tracking-math/images/cover.jpg"
coverImageAlt: "A ball representing the exponential moving average calculation used by PELT to track CPU load in the Linux kernel"
ogImage: "/posts/linux-pelt-load-tracking-math/images/cover.jpg"
date: "2026-09-06 05:00:00"
lastUpdated: "2026-09-06 05:00:00"
author: "FindNS94"
tags: ["Linux", "Kernel", "Scheduler"]
---

![A ball representing the exponential moving average calculation used by PELT to track CPU load in the Linux kernel](/posts/linux-pelt-load-tracking-math/images/cover.jpg)

# The Math Behind PELT — How the Kernel Quantifies "Load"

Every system administrator has seen CPU load averages: `load average: 1.23, 0.89, 0.67`. Most interpret this as "CPU usage percentage." This is wrong. Load is not usage — it's a measure of **demand**: how much work tasks *would do* if they had CPU time. A task blocked on I/O still contributes to load because it *wants* CPU when its I/O completes.

Linux's load tracking system, **PELT (Per-Entity Load Tracking)**, is the mathematical engine behind load balancing, frequency scaling, and capacity planning. It answers a subtle question: "How much CPU time does this task *deserve*?" The answer determines whether the scheduler migrates tasks between CPUs, whether the CPU frequency governor ramps up, and whether the system is "overloaded."

This article walks through the PELT source in `kernel/sched/pelt.c` to explain the exponential moving average math, the 32ms half-life, capacity/frequency scaling, and the approximations that make it all fast enough to run every scheduler tick.

<!-- [UNIQUE INSIGHT] The most elegant aspect of PELT is its approximation of exponential decay using only integer arithmetic and bit shifts. The kernel never computes `y^n` directly — it uses the identity `y^32 ≈ 0.5` to convert exponential decay into a simple shift-and-add operation. This makes PELT fast enough to run every 1ms scheduler tick on every CPU. -->

<!-- more -->

> **Key Takeaways**
> - Load ≠ CPU usage: load measures *demand* (what tasks would do), usage measures *consumption* (what they did)
> - PELT uses exponential moving average with 32ms half-life: recent activity matters more than old
> - The formula: `load = load * y + active * (1 - y)` where `y ≈ 0.978` per millisecond
> - `y^32 ≈ 0.5` enables integer-only approximation via bit shifts
> - Capacity scaling normalizes load across heterogeneous CPUs (big.LITTLE)
> - Frequency scaling accounts for DVFS: same work at different frequencies = different load

---

## The Myth: "Load = CPU Usage"

Run `top` and you see two different numbers:
- **CPU usage**: 45% (the CPU was busy 45% of the time)
- **Load average**: 2.34 (equivalent to 2.34 tasks wanting CPU simultaneously)

These measure fundamentally different things:

| Metric | What it measures | Blocked task included? |
|--------|-----------------|------------------------|
| CPU usage | Time CPU was active | No |
| Load average | Demand for CPU | Yes |

A task blocked on disk I/O contributes 0% to CPU usage but ~1.0 to load average (it wants CPU when I/O completes). This is why a system with many I/O-bound tasks can have high load but low CPU usage.

---

## Exponential Moving Average: The Math

PELT models load as an exponential moving average (EMA):

```
load(n) = load(n-1) * y + active * (1 - y)
```

Where:
- `y` = decay factor (≈ 0.978 per millisecond)
- `active` = 1 if task is running, 0 if sleeping
- `load(n)` = load at time step n

### The 32ms Half-Life

The decay factor `y` is chosen so that activity 32ms ago contributes half as much as current activity:

```
y^32 = 0.5
y = 0.5^(1/32) ≈ 0.9785
```

This means:
- Activity now: weight 1.0
- Activity 32ms ago: weight 0.5
- Activity 64ms ago: weight 0.25
- Activity 320ms ago: weight 0.001 (effectively forgotten)

The 32ms half-life is a compromise: short enough to react to load changes quickly, long enough to smooth out brief spikes.

### Visualizing the Decay

```
  Load
  1.0 ┤ ████
      │ ████
  0.5 ┤ ████ ████
      │ ████ ████
  0.25┤ ████ ████ ████
      │ ████ ████ ████
  0.0 ┤ ████ ████ ████ ████ ████ ████ ████ ████
      └──┬───┬───┬───┬───┬───┬───┬───┬───┬──→
        0  32  64  96  128 160 192 224 256  ms
      └──┘   └──┘   └──┘   └──┘   └──┘   └──┘
     half   half   half   half   half   half
```

---

## `__accumulate_pelt_segments()`: The Implementation

The kernel doesn't compute `y^n` directly — that would require floating-point arithmetic. Instead, it uses an integer approximation:

```c
// kernel/sched/pelt.c — __accumulate_pelt_segments()
static u32 __accumulate_pelt_segments(u64 periods, u32 d1, u32 d3)
{
    u64 p_half = periods >> 1;      // periods / 2
    u64 p_quarter = periods >> 2;    // periods / 4

    /*
     * Approximate y^periods using the identity:
     * y^32 ≈ 0.5
     * y^n ≈ (1 - n/32) for small n
     *
     * d1: time with activity (contributes fully)
     * d3: time without activity (decays)
     */
    return d1 + p_half * d2 / 32 + p_quarter * d3 / 64;
}
```

### Why This Approximation Works

The exact formula for decay over `periods` ticks is:

```
y^periods = (0.5)^(periods/32)
```

For small `periods`, this is approximately linear:

```
y^periods ≈ 1 - periods/32
```

The kernel uses piecewise linear approximation:
- `d1` (active period): contributes at full weight
- `d2` (half-weight period): contributes at ~0.5 weight
- `d3` (quarter-weight period): contributes at ~0.25 weight

This avoids floating-point entirely — all arithmetic is integer add/shift/multiply.

---

## `update_load_avg()`: Per-Tick Update

```c
// kernel/sched/fair.c — update_load_avg()
void update_load_avg(struct cfs_rq *cfs_rq, struct sched_entity *se, int flags)
{
    u64 now = cfs_rq->clock_pelt;
    u64 delta;

    // Calculate time since last update
    delta = now - se->avg.last_update_time;
    if (!delta)
        return;

    // Accumulate into 3 segments (active, half, quarter)
    __accumulate_pelt_segments(delta >> 24,   // periods (each = 2^24 ns ≈ 16ms)
                              d1, d2, d3);

    // Update the load average
    se->avg.util_avg = decay_load(se->avg.util_avg, periods)
                     + active * CONTRIBUTION;

    // Propagate to cfs_rq and rq levels
    cfs_rq_load_avg(cfs_rq);
    rq_load_avg(rq_of(cfs_rq));
}
```

PELT tracks load at three levels:
1. **Per-task** (`sched_entity->avg`): Individual task load
2. **Per-cfs_rq** (`cfs_rq->avg`): Sum of all tasks in a runqueue
3. **Per-rq** (`rq->avg`): Total load on a CPU

---

## Capacity and Frequency Scaling

### The Problem: Heterogeneous CPUs

On a big.LITTLE system, a "small" core at 1.0 GHz and a "big" core at 2.5 GHz have very different capacities. A task using 50% of a small core's capacity would use only 20% of a big core's capacity. PELT must normalize load across these different capacities.

### Capacity Scaling

```c
// kernel/sched/pelt.c — scale_load()
static inline u64 scale_load_down(unsigned long load, unsigned int capacity)
{
    return (load * capacity) >> SCHED_CAPACITY_SHIFT;
}
```

`capacity` ranges from 0-1024 (where 1024 = maximum capacity). A task running on a small core (capacity=384) has its load scaled down to 37.5% of its raw value.

### Frequency Scaling

```c
// kernel/sched/pelt.c — cap_scale()
static inline u64 cap_scale(u64 delta, unsigned int capacity)
{
    return (delta * capacity) >> SCHED_CAPACITY_SHIFT;
}
```

When the CPU frequency changes (DVFS), the same amount of work contributes differently to load:
- At 2.5 GHz: 1ms of work = load 1.0
- At 1.0 GHz: 1ms of work = load 0.4 (same work, lower frequency)

### Combined Scaling

```c
// kernel/sched/pelt.c — update_load_avg() with scaling
delta = cap_scale(delta, arch_scale_cpu_capacity(cpu));
delta = cap_scale(delta, arch_scale_freq_capacity(cpu));
```

The final load value accounts for both the CPU's inherent capacity (big vs small) and its current frequency (DVFS).

---

## Deep Detail: Long Idle Decay

When a task is idle for a long time, its load should decay to zero. But the exponential decay never reaches exactly zero — it only approaches it. PELT uses a practical cutoff:

```c
// kernel/sched/pelt.c
#define LOAD_AVG_PERIOD 32
#define LOAD_AVG_MAX 47742  // Maximum load average value

static inline unsigned long decay_load(unsigned long val, unsigned long n)
{
    unsigned int local_n;

    if (val < 0)
        return 0;

    if (n > LOAD_AVG_MAX_FACTOR)
        return 0;  // After ~345ms, load is effectively zero

    return val >> n;  // Fast decay for long idle periods
}
```

After approximately 345ms of inactivity (11 half-lives), the load is treated as zero. This prevents stale load values from affecting scheduling decisions.

---

## How to Observe PELT Behavior

### Reading /proc

```bash
// Per-task load average
cat /proc/<pid>/sched | grep -E "load_avg|util_avg"

// CPU load averages
cat /proc/loadavg

// Per-CPU load
cat /sys/devices/system/cpu/cpu0/sched_load_avg
```

### Using bpftrace

```bash
#!/usr/bin/env bpftrace
// trace_pelt.bt

kprobe:update_load_avg
{
    $se = (struct sched_entity *)arg1;
    printf("[%s] util=%lu load=%lu\n",
           comm, $se->avg.util_avg, $se->avg.load_avg);
}

tracepoint:sched:sched_load_avg_cpu
{
    @util[args->cpu] = args->util_avg;
    @load[args->cpu] = args->load_avg;
}
```

### Using ftrace

```bash
// Enable PELT tracing
echo 1 > /sys/kernel/debug/tracing/events/sched/sched_pelt_se/enable
echo 1 > /sys/kernel/debug/tracing/events/sched/sched_pelt_cfs/enable
cat /sys/kernel/debug/tracing/trace_pipe
```

---

## Frequently Asked Questions

### What is the difference between load and usage?
Usage measures time the CPU was active. Load measures demand — what tasks *would do* if they had CPU time. A blocked task contributes to load but not usage.

### Why is the half-life 32ms?
32ms is a compromise between responsiveness and stability. Shorter half-life (e.g., 8ms) would react faster to load changes but be more sensitive to brief spikes. Longer half-life (e.g., 128ms) would be smoother but slower to react.

### How does PELT handle CPU frequency changes?
When frequency changes, `arch_scale_freq_capacity()` returns a different scaling factor. The same amount of work at a lower frequency contributes less to load, reflecting that the CPU has less capacity at that frequency.

### What is the maximum load value?
`LOAD_AVG_MAX = 47742` (approximately 47.7 when normalized to 1024). This represents a task running continuously at maximum capacity on the fastest core.

### How does PELT interact with load balancing?
The scheduler compares `rq->avg.load_avg` across CPUs. If one CPU has significantly higher load, the scheduler migrates tasks to balance the load. PELT provides the load values that drive these decisions.

---

## Conclusion

PELT is the mathematical foundation of Linux's load tracking. It uses exponential moving average with a 32ms half-life to quantify how much CPU time each task *deserves*. The implementation avoids floating-point arithmetic through clever integer approximations, making it fast enough to run every scheduler tick.

For production systems, the practical takeaways are: load is not usage (blocked tasks contribute to load), the 32ms half-life balances responsiveness and stability, and capacity/frequency scaling ensures fair comparisons across heterogeneous CPUs. Understanding PELT helps diagnose load balancing issues, frequency scaling behavior, and capacity planning decisions.

---

## Sources

- Linux kernel source, `kernel/sched/pelt.c`, `__accumulate_pelt_segments()`
- Linux kernel source, `kernel/sched/pelt.h`, `update_load_avg()`
- Linux kernel source, `kernel/sched/fair.c`, `update_load_avg()`
- Linux kernel Documentation, scheduler/sched-stats.rst
