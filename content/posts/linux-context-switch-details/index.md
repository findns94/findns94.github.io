---
title: "What Really Happens During a Context Switch? — From __schedule() to switch_to()"
description: "Context switch is more than saving/restoring registers. The full path involves runqueue locks, lazy TLB, memory barriers, PELT updates, and cache-aware data structures. Source analysis reveals each step."
coverImage: "/posts/linux-context-switch-details/images/cover.jpg"
coverImageAlt: "A ball in motion, representing the complex state transitions during a Linux context switch"
ogImage: "/posts/linux-context-switch-details/images/cover.jpg"
date: "2026-09-06 02:00:00"
lastUpdated: "2026-09-06 02:00:00"
author: "FindNS94"
tags: ["Linux", "Kernel", "Scheduler"]
---

![A ball in motion, representing the complex state transitions during a Linux context switch](/posts/linux-context-switch-details/images/cover.jpg)

# What Really Happens During a Context Switch? — From __schedule() to switch_to()

Every operating systems textbook describes context switching as "saving the state of the current process and restoring the state of the next process." This definition is technically correct but practically useless — it tells you nothing about why context switches cost 1-20 microseconds, what subsystems are involved, or how the kernel minimizes the overhead.

A single context switch on Linux touches at least six distinct subsystems: the scheduler (runqueue management), the memory subsystem (page table switching), the TLB (cache management), the CPU architecture layer (register save/restore), the load tracking system (PELTS), and the cache hierarchy (data locality). All of these must coordinate through careful memory barriers, lock ordering, and cache-aware data structure layout.

This article traces the complete context switch path from the moment `__schedule()` is called through `context_switch()`, into `switch_to()`, and finally `finish_task_switch()`. By the end, you will understand why context switches are expensive, how the kernel minimizes the cost, and why the most counterintuitive aspect of context switching is that `switch_to()` never returns to the same task.

<!-- [UNIQUE INSIGHT] The most counterintuitive fact about context switches is that when `switch_to()` returns, you're executing in a *different task's* context. A task that gets scheduled again resumes execution at the `switch_to()` call from its *previous* switch — not at the point where it was preempted. This is why `finish_task_switch()` handles cleanup for the *previous* task (the one that was running when this task was scheduled), not the task that's currently running. -->

<!-- more -->

> **Key Takeaways**
> - Context switch involves 4 distinct phases: schedule decision, memory switch, register switch, and cleanup
> - `smp_mb__after_spinlock()` is critical — it ensures visibility of scheduler state across CPUs
> - Lazy TLB optimization: kernel threads borrow the previous task's `active_mm` to avoid costly TLB flush
> - `switch_to()` returns to a *different* task's execution context — the return point is when THIS task is next scheduled
> - `struct rq` cache line layout minimizes false sharing between frequently-read and frequently-written fields
> - `DELAY_DEQUEUE` keeps briefly-sleeping tasks on the runqueue to avoid enqueue/dequeue overhead

---

## The Four Phases of Context Switch

Context switching is not a single operation — it is a carefully choreographed sequence of four phases, each involving different kernel subsystems:

```
  __schedule() — Entry point
       │
       ▼
  ┌─────────────────────────────────────────────────────────────────────┐
  │ Phase 1: SCHEDULE DECISION                                         │
  │ Location: kernel/sched/core.c                                      │
  │                                                                     │
  │ • Lock runqueue: raw_spin_lock_irq(&rq->lock)                      │
  │ • Memory barrier: smp_mb__after_spinlock()                         │
  │ • Update clock: update_rq_clock(rq)                                 │
  │ • Handle prev state: try_to_block_task() if sleeping               │
  │ • Pick next task: pick_next_task(rq) → iterates sched classes      │
  │ • Check resched: does prev != next?                                 │
  └─────────────────────────────────────────────────────────────────────┘
       │ (if different task selected)
       ▼
  ┌─────────────────────────────────────────────────────────────────────┐
  │ Phase 2: MEMORY SWITCH                                             │
  │ Location: kernel/sched/core.c → switch_mm()                        │
  │                                                                     │
  │ • If same mm (same process or kernel thread): skip                  │
  │ • If different mm: switch_mm_irqs_off() → load_cr3()               │
  │ • Kernel thread: enter_lazy_tlb() → borrow active_mm               │
  │ • TLB flush: implicit on CR3 write (or avoided with lazy TLB)      │
  └─────────────────────────────────────────────────────────────────────┘
       │
       ▼
  ┌─────────────────────────────────────────────────────────────────────┐
  │ Phase 3: REGISTER SWITCH                                           │
  │ Location: arch/x86/kernel/process_64.c → __switch_to_asm()        │
  │                                                                     │
  │ • Save: stack pointer → prev->thread.sp                            │
  │ • Save: callee-saved registers (rbp, rbx, r12-r15) to stack        │
  │ • Load: next->thread.sp → rsp                                      │
  │ • Restore: callee-saved registers from next's stack                │
  │ • Jump: __switch_to() → returns when THIS task is next scheduled   │
  └─────────────────────────────────────────────────────────────────────┘
       │
       ▼
  ┌─────────────────────────────────────────────────────────────────────┐
  │ Phase 4: CLEANUP                                                   │
  │ Location: kernel/sched/core.c → finish_task_switch()               │
  │                                                                     │
  │ • Release: prev->pi_lock (priority inheritance lock)               │
  │ • TLB cleanup: mmdrop_lazy_tlb() for deferred TLB shootdowns      │
  │ • PELT update: prev task's load contribution ends here             │
  │ • Delayed dequeue: handle tasks that slept briefly                 │
  └─────────────────────────────────────────────────────────────────────┘
```

---

## Phase 1: `__schedule()` — The Decision

The entry point for all context switches is `__schedule()`. This function is called when the kernel determines that a different task should run — either because the current task has yielded the CPU (blocking on I/O, sleeping) or because the scheduler tick has set `TIF_NEED_RESCHED`.

```c
// kernel/sched/core.c — __schedule()
static void __sched notrace __schedule(int sched_mode)
{
    int cpu = smp_processor_id();
    struct rq *rq = cpu_rq(cpu);
    struct task_struct *prev, *next;
    struct rq_flags rf;

    prev = rq->curr;

    // 1. Disable preemption and lock the runqueue
    rq_lock(rq, &rf);
    smp_mb__after_spinlock();  // ← Critical memory barrier

    // 2. Update the runqueue clock
    update_rq_clock(rq);

    // 3. Handle the previous task's state
    if (!preempt && prev_state) {
        // Task is blocking (not preempted)
        try_to_block_task(rq, prev, &prev_state, ...);
    }

    // 4. Pick the next task to run
    next = pick_next_task(rq, &rf);

    // 5. Clear the need_resched flag
    clear_tsk_need_resched(prev);

    // 6. Context switch if different task
    if (prev != next) {
        rq = context_switch(rq, prev, next, &rf);
    }

    // 7. Finish cleanup (runs in new task's context)
    barrier();
    return finish_task_switch(prev);
}
```

### The Critical Memory Barrier: `smp_mb__after_spinlock()`

This single line is one of the most important in the entire scheduler. It ensures:

1. **Visibility of remote writes**: Any writes that occurred before the lock on another CPU are now visible
2. **Consistent runqueue state**: The scheduler sees up-to-date `nr_running`, `curr`, and load values
3. **No stale decisions**: Without this barrier, a CPU might see an outdated runqueue state and make a wrong scheduling decision

The barrier works in concert with the release-side barrier in `rq_unlock()` — together they form a happens-before relationship that serializes scheduler state across CPUs.

### `pick_next_task()`: Iterating Scheduling Classes

```c
// kernel/sched/core.c — __pick_next_task()
static inline struct task_struct *__pick_next_task(struct rq *rq, struct rq_flags *rf)
{
    for_each_active_class(class) {
        p = class->pick_task(rq, rf);
        if (p)
            return p;
    }
    return idle_task;  // Always returns the idle thread
}
```

The iteration order is: STOP → DL → RT → FAIR → IDLE. The first class that returns a task wins. This is why real-time tasks always preempt normal tasks — their `pick_task()` is called first.

---

## Phase 2: `context_switch()` — Memory and Registers

```c
// kernel/sched/core.c — context_switch()
static __always_inline struct rq *
context_switch(struct rq *rq, struct task_struct *prev,
               struct task_struct *next, struct rq_flags *rf)
{
    // Notify scheduler of impending switch
    prepare_task_switch(rq, prev, next);
    arch_start_context_switch(prev);

    // === MEMORY SPACE SWITCH ===
    if (!next->mm) {
        // Kernel thread: no own memory mapping
        // Borrow previous task's mm (lazy TLB optimization)
        enter_lazy_tlb(prev->active_mm, next);
        next->active_mm = prev->active_mm;
        prev->active_mm->mm_users++;
    } else {
        // Real user process: switch page tables
        switch_mm_irqs_off(prev->active_mm, next->mm, next);
    }

    // === REGISTER STATE SWITCH ===
    switch_to(prev, next, prev);
    barrier();

    // === CLEANUP (runs in new task's context) ===
    return finish_task_switch(prev);
}
```

### Lazy TLB: The Kernel Thread Optimization

Kernel threads (`kworker`, `ksoftirqd`, etc.) don't have their own memory mapping — `next->mm` is NULL. Instead of flushing the TLB (which would cost hundreds of cycles), the kernel borrows the previous task's `active_mm`:

```c
// kernel/sched/core.c — enter_lazy_tlb()
static void enter_lazy_tlb(struct mm_struct *mm, struct task_struct *tsk)
{
    // Kernel thread shares the kernel portion of the address space
    // No TLB flush needed — kernel mappings are identical across all processes
}
```

This works because the kernel address space (the upper portion of virtual memory) is identical across all processes. Only the user-space portion differs, and kernel threads never access user space.

### Real Memory Switch: `switch_mm_irqs_off()`

For user processes, the kernel must switch page tables:

```c
// arch/x86/mm/tlb.c — switch_mm_irqs_off()
void switch_mm_irqs_off(struct mm_struct *prev, struct mm_struct *next,
                        struct task_struct *tsk)
{
    // Load new page table base register
    load_cr3(next->pgd);

    // TLB is implicitly flushed on CR3 write
    // (unless PCID is enabled — see below)
}
```

On modern x86 processors with PCID (Process-Context Identifiers), the TLB is NOT fully flushed — entries are tagged with a PCID and only flushed when the PCID is reused. This dramatically reduces the cost of context switches between processes.

---

## Phase 3: `switch_to()` — The Register Dance

This is where the actual CPU state transition happens. On x86-64, the switch is implemented in assembly:

```asm
// arch/x86/kernel/process_64.c — __switch_to_asm()
__visible __notrace_funcgraph struct task_struct *
__switch_to_asm(struct task_struct *prev, struct task_struct *next)
{
    ; Save callee-saved registers to prev's stack
    pushq %rbp
    pushq %rbx
    pushq %r12
    pushq %r13
    pushq %r14
    pushq %r15

    ; Save stack pointer to prev->thread.sp
    movq %rsp, TASK_threadsp(%rdi)

    ; Load stack pointer from next->thread.sp
    movq TASK_threadsp(%rsi), %rsp

    ; Restore callee-saved registers from next's stack
    popq %r15
    popq %r14
    popq %r13
    popq %r12
    popq %rbx
    popq %rbp

    ; Jump to where next task was last executing
    jmp __switch_to
}
```

### The Key Insight: Stack Crossing

After `movq TASK_threadsp(%rsi), %rsp`, the CPU is now executing on the **new task's stack**. When we `popq` the registers, we're restoring the **new task's** register state. The `jmp __switch_to` continues execution where the new task last called `switch_to()`.

This means: **when a task is scheduled again, it resumes at the `switch_to()` call from its previous switch** — not at the point where it was preempted. The entire call stack below `switch_to()` belongs to the *previous* execution context.

### `__switch_to()`: The C portion

```c
// arch/x86/kernel/process_64.c — __switch_to()
__notrace_funcgraph struct task_struct *
__switch_to(struct task_struct *prev, struct task_struct *next)
{
    // Save/restore FPU state
    fpu__save(prev);
    fpu__restore(next);

    // Save/restore debug registers
    update_debugctlmsr();

    // Update GS segment (per-CPU data)
    loadsegment(fs, next->thread.fsindex);
    load_gs_index(next->thread.gsindex);

    // Update TLS (thread-local storage)
    loadsegment(es, next->thread.es);
    loadsegment(ds, next->thread.ds);

    // Update MSRs (model-specific registers)
    wrmsrl(MSR_FS_BASE, next->thread.fsbase);
    wrmsrl(MSR_KERNEL_GS_BASE, next->thread.gsbase);

    return prev;
}
```

---

## Phase 4: `finish_task_switch()` — Cleanup

```c
// kernel/sched/core.c — finish_task_switch()
static struct rq *finish_task_switch(struct task_struct *prev)
{
    struct rq *rq = this_rq();
    long prev_state;

    // 1. Release the pi_lock we held during schedule
    if (prev->pi_lock_owner)
        raw_spin_unlock_irq(&prev->pi_blocked_on->pi_lock);

    // 2. Handle pending TLB shootdowns
    mmdrop_lazy_tlb(rq, prev->active_mm);

    // 3. Update PELT: prev task's load contribution ends here
    if (prev->sched_class->task_tick)
        prev->sched_class->task_tick(rq, prev, 0);

    // 4. Handle delayed dequeue
    if (prev->on_rq)
        prev->sched_class->dequeue_task(rq, prev, DEQUEUE_SLEEP);

    return rq;
}
```

This function runs in the **new task's** context but cleans up after the **previous** task. This is possible because the new task resumes at the `switch_to()` call — the `prev` pointer is still valid (it's stored in a register or on the stack).

---

## Deep Detail: `struct rq` Cache Line Layout

The runqueue structure (`struct rq`) is carefully laid out to minimize false sharing — a performance problem where two CPUs frequently access different fields that happen to be on the same cache line, causing constant cache invalidation.

```c
// kernel/sched/sched.h — struct rq (simplified)
struct rq {
    /* === Cache line 0: Hot read-mostly ===
     * Accessed by every CPU for load balancing.
     * Must NOT be on the same line as write-heavy fields.
     */
    unsigned int nr_running;        // Read by all CPUs
    unsigned int cpu_capacity;      // Read by scheduler
    unsigned int nr_switches;       // Read for stats

    ____cacheline_aligned

    /* === Cache line 1: Write-heavy (scheduler hot path) ===
     * Written on every context switch and tick.
     * Isolated from read-mostly fields.
     */
    struct task_struct *curr;       // Written on every switch
    u64 clock_task;                 // Written every tick
    u64 nr_load_balance;            // Written during balance

    ____cacheline_aligned

    /* === Cache line 2: CFS-specific ===
     * Accessed primarily by CFS scheduler.
     */
    struct cfs_rq cfs;
    struct rt_rq rt;
    struct dl_rq dl;
    struct rq *idle_rq;             // Pointer to idle runqueue

    ____cacheline_aligned

    /* === Cache line 3: Per-CPU data ===
     * Written once at init, read frequently.
     */
    int cpu;                        // CPU number
    u64 clock;                      // Runqueue clock
    u64 clock_pelt;                 // PELT clock
};
```

### Why This Matters

Without cache line isolation:
- CPU A reads `nr_running` (cache line 0)
- CPU B writes `curr` (cache line 1)
- If they shared a line, CPU A's read would invalidate CPU B's write, and vice versa

With isolation:
- CPU A reads cache line 0 (never invalidated by scheduler writes)
- CPU B writes cache line 1 (never invalidated by load balancing reads)
- Result: dramatically reduced cache coherency traffic

---

## Deep Detail: `DELAY_DEQUEUE` Optimization

When a task briefly sleeps (e.g., waiting for a spinlock), removing it from the runqueue and re-adding it when it wakes is expensive. The `DELAY_DEQUEUE` feature keeps the task on the runqueue:

```c
// kernel/sched/fair.c — dequeue_task_fair()
static void dequeue_task_fair(struct rq *rq, struct task_struct *p, int flags)
{
    struct cfs_rq *cfs_rq = task_cfs_rq(p);

    if (p->on_rq) {
        // Don't immediately remove from runqueue
        // Mark as delayed instead
        p->sched_delayed = 1;
        p->on_rq = TASK_ON_RQ_MIGRATING;
        return;
    }

    // Full dequeue
    __dequeue_entity(cfs_rq, se);
}
```

If the task wakes up before being fully dequeued, it can burn off negative lag without being selected — avoiding unnecessary context switches.

---

## How to Measure Context Switches

### Using perf

```bash
// Count context switches for a process
perf stat -e context-switches,cpu-migrations -p <pid> sleep 5

// Measure scheduling latency distribution
perf sched record -- sleep 1
perf sched latency

// Visualize scheduling behavior
perf sched record -- sleep 1
perf sched map
```

### Using bpftrace

```bash
#!/usr/bin/env bpftrace
// trace_cs.bt — trace context switch latency

kprobe:__schedule
{
    @start[tid] = nsecs;
    @prev_comm[tid] = comm;
}

kretprobe:__schedule
/@start[tid]/
{
    $latency = nsecs - @start[tid];
    @us = hist($latency / 1000);
    @switches[@prev_comm[tid]->comm] = count();
    delete(@start[tid]);
    delete(@prev_comm[tid]);
}

END
{
    printf("\nContext switch latency (us):\n");
    print(@us);
    printf("\nSwitches per task pair:\n");
    print(@switches);
}
```

### Using ftrace

```bash
// Enable sched_switch tracer
echo sched_switch > /sys/kernel/debug/tracing/current_tracer
echo 1 > /sys/kernel/debug/tracing/tracing_on
cat /sys/kernel/debug/tracing/trace_pipe

// Per-task context switch count
cat /proc/<pid>/status | grep voluntary_ctxt_switches
cat /proc/<pid>/status | grep nonvoluntary_ctxt_switches
```

---

## Frequently Asked Questions

### How much does a context switch cost?
Typical cost: 1-10 microseconds for a "hot" switch (same process, warm cache). A "cold" switch (different process, cold cache, TLB flush) can cost 10-20 microseconds. The breakdown:
- Register save/restore: ~0.5 μs
- TLB flush (if needed): ~1-5 μs
- Cache warming: ~1-10 μs (depends on working set)
- Scheduler overhead: ~0.5-1 μs

### Why don't kernel threads need a full mm switch?
Kernel address space is identical across all processes (the upper portion of virtual memory on x86). Kernel threads borrow the previous task's `active_mm` and share the kernel page tables — no TLB flush needed. This saves hundreds of cycles per switch.

### What is PCID and how does it help?
PCID (Process-Context Identifier) tags TLB entries with a per-process identifier. When switching processes, the TLB is NOT flushed — entries from the previous process remain but are ignored because they have a different PCID. This dramatically reduces the cost of context switches.

### Why does `finish_task_switch()` run in the new task's context?
Because `switch_to()` never returns to the same call site. When a task is scheduled again, it resumes at the `switch_to()` from its *previous* switch. The `prev` pointer (the task that was running before this one) is still accessible, so cleanup can proceed.

### What is the difference between voluntary and non-voluntary context switches?
- **Voluntary**: Task yields CPU voluntarily (blocking on I/O, sleeping, lock contention)
- **Non-voluntary**: Task is preempted (time slice expired, higher-priority task woke)
High non-voluntary switch rates indicate CPU oversubscription.

---

## Conclusion

Context switches are far more than register save/restore. They involve scheduler decisions with memory barriers, lazy TLB optimization for kernel threads, careful register switching that crosses task boundaries, and cleanup in the new task's context. The kernel minimizes cost through multiple optimizations: lazy TLB avoids TLB flushes for kernel threads, PCID avoids flushes between processes, cache-aware data structure layout reduces false sharing, and DELAY_DEQUEUE avoids unnecessary enqueue/dequeue cycles.

Understanding this path explains why context switches are expensive (1-20 μs), how the kernel minimizes the cost, and why the most counterintuitive aspect — `switch_to()` returning in a different task's context — is actually the key to efficient scheduling.

---

## Sources

- Linux kernel source, `kernel/sched/core.c`, `__schedule()`
- Linux kernel source, `kernel/sched/core.c`, `context_switch()`
- Linux kernel source, `kernel/sched/core.c`, `finish_task_switch()`
- Linux kernel source, `arch/x86/kernel/process_64.c`, `__switch_to_asm()`
- Linux kernel source, `arch/x86/mm/tlb.c`, `switch_mm_irqs_off()`
- Linux kernel source, `kernel/sched/sched.h`, `struct rq`
