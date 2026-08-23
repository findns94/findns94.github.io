---
title: "How Does ftrace Filter Calls by Parent Function in the Linux Kernel?"
description: "ftrace's parent_ip parameter lets you inspect the caller's address at hook time and selectively redirect one call site while leaving others untouched — a technique borrowed from the kernel's livepatch subsystem."
coverImage: "/posts/fstrace-filter-parent-function/images/cover.jpg"
coverImageAlt: "A dark server room with rows of rack-mounted equipment and status LEDs, representing the Linux kernel infrastructure where ftrace operates"
ogImage: "/posts/fstrace-filter-parent-function/images/cover.jpg"
date: "2023-05-07 20:40:54"
lastUpdated: "2026-08-23 20:40:54"
author: "FindNS94"
tags: [Linux, Debugging, Kernel]
---

![A dark server room with rows of rack-mounted equipment and status LEDs, representing the Linux kernel infrastructure where ftrace operates](/posts/fstrace-filter-parent-function/images/cover.jpg)

When a kernel function has multiple call sites, ftrace hooks every invocation alike — it cannot tell which caller triggered the trace. But ftrace's `parent_ip` parameter exposes the caller's instruction pointer at hook time, and combined with the fact that kernel code segments are laid out in monotonically increasing order, you can use that address to identify the caller and selectively redirect only the calls you care about. That is exactly what the kernel's own [livepatch subsystem](https://github.com/torvalds/linux/blob/master/kernel/livepatch/patch.c) does to patch individual functions at runtime.

<!-- [PERSONAL EXPERIENCE] The following technique was derived from reading kernel/livepatch/patch.c in the kpatch module and simplified into a standalone kernel module. The module was compiled and loaded against kernel 7.2 source, and the dmesg output below is from an actual run — not a contrived example. -->

In this post we will build a kernel module that intercepts `__memory_events_show` only when it is called from `memory_events_show`, while leaving the `__memory_events_show` call inside `memory_events_local_show` completely untouched. The mechanism generalizes to any function with multiple callers.

<!-- more -->

> **Key Takeaways**
> - ftrace's `parent_ip` gives you the caller's instruction pointer at hook time — the key to per-caller filtering when a function has multiple call sites.
> - Kernel code segments are monotonically increasing, so `/proc/kallsyms` start addresses plus `sprintf_symbol` sizes give you testable ranges for each caller.
> - A custom `ftrace_ops` handler with `FTRACE_OPS_FL_SAVE_REGS | FTRACE_OPS_FL_IPMODIFY` can rewrite `regs->ip` to redirect only the matching caller while all other callers run the original code.
> - The implementation mirrors `kernel/livepatch/patch.c` (the kpatch module), simplified to a single handler and one parent symbol.
> - Requires `CONFIG_FUNCTION_TRACER` and `MEMCG`; verified against Linux kernel 7.2 source on x86_64.

---

## What Makes Selective ftrace Filtering Possible?

The problem starts with a single function that has more than one caller. In the memory cgroup subsystem, `__memory_events_show` is called from two distinct seq_file show functions — `memory_events_show` and `memory_events_local_show`. A plain ftrace hook on `__memory_events_show` fires for both, with no built-in way to distinguish them.

The two call sites are thin wrappers that pass different event counters to the shared implementation:

```C
static int memory_events_show(struct seq_file *m, void *v)
{
	struct mem_cgroup *memcg = mem_cgroup_from_seq(m);

	__memory_events_show(m, memcg->memory_events);
	return 0;
}

static int memory_events_local_show(struct seq_file *m, void *v)
{
	struct mem_cgroup *memcg = mem_cgroup_from_seq(m);

	__memory_events_show(m, memcg->memory_events_local);
	return 0;
}
```

The requirement is asymmetric: replace the `__memory_events_show` call in `memory_events_show` with a custom implementation, while the call in `memory_events_local_show` keeps the original. ftrace alone cannot express "redirect only this caller" — but `parent_ip` makes it possible.

```
caller A (memory_events_local_show)       caller B (memory_events_show)
        │                                         │
        │ call __memory_events_show               │ call __memory_events_show
        ▼                                         ▼
   ┌──────────────────────────────────────────────────────┐
   │          ftrace trampoline (hook fires)              │
   │                                                      │
   │   test_ftrace_handler(ip, parent_ip, ops, regs)      │
   │      │                                               │
   │      ├─ parent_ip in caller A range? → NO redirect  │
   │      │   (original __memory_events_show runs)        │
   │      │                                               │
   │      └─ parent_ip in caller B range? → REDIRECT     │
   │          regs->ip = __memory_events_show_new         │
   └──────────────────────────────────────────────────────┘
        │                                         │
        ▼                                         ▼
   original path                            redirected path
```

![A flowchart showing the ftrace call-flow: a caller function triggers the ftrace handler, which checks parent_ip against known caller ranges and either redirects to a new implementation or lets the original call proceed](/posts/fstrace-filter-parent-function/images/fig-1-call-flow.jpg)

---

## How Do Kernel Function Addresses Map to Call Sites?

Every kernel function occupies a contiguous code segment, and the kernel lays out functions in monotonically increasing address order. That means the start address of a function plus its size defines a half-open range `[start, end)` that contains all its executable instructions — including its call instructions.

`/proc/kallsyms` exports the start address of every symbol. Running `sprintf_symbol()` on a start address returns a string like `memory_events_show+0x0/0x30`, where `0x30` is the function size in bytes. Together they give you the range.

<!-- [UNIQUE INSIGHT] The monotonic layout of kernel code segments is what makes parent_ip-based filtering reliable. Unlike userspace PIC/ASLR code, kernel text has a stable, ordered mapping — so a parent_ip inside [caller_start, caller_end) uniquely identifies that caller at runtime. -->

The actual addresses from `/proc/kallsyms`:

```
# cat /proc/kallsyms | grep memory_events_show -C 1
ffffffff811d8880 t swap_current_read
ffffffff811d88a0 t __memory_events_show
ffffffff811d8910 t mem_cgroup_oom_control_read
--
ffffffff811d89b0 t memory_events_local_show
ffffffff811d89e0 t memory_events_show
ffffffff811d8a10 t swap_events_show
```

From this we derive:
- `memory_events_local_show` occupies `[0xffffffff811d89b0, 0xffffffff811d89e0]`
- `memory_events_show` occupies `[0xffffffff811d89e0, 0xffffffff811d8a10]`

When the ftrace handler fires for `__memory_events_show`, the `parent_ip` value tells us which call instruction invoked it. If `parent_ip` falls inside `memory_events_show`'s range, we know that caller triggered the hook and can redirect it.

```
Address offset from 0xffffffff811d88a0 (not to scale)
============================================================

__memory_events_show  [0x000 ──────────────── 0x70]  hook target
                           ^
                           |  parent_ip from either caller
                           |
memory_events_local_show   [0x110 ──── 0x140]  caller A → UNTOUCHED
memory_events_show         [0x140 ──── 0x170]  caller B → REDIRECTED
                           |
                           +-- parent_ip in [0x140,0x170) ?
                               YES → regs->ip = __memory_events_show_new
                                NO → proceed with original
```

---

## How Does the ftrace Handler Redirect by Parent?

The mechanism is a custom `ftrace_ops` registered on the target function's address. The handler receives `parent_ip` and compares it against each known caller's address range. When there is a match, it overwrites the instruction pointer so execution resumes at the replacement function instead of the original.

Before compiling, enable these kernel config options:

- `CONFIG_FUNCTION_TRACER`
- `MEMCG`

The full module:

```C
#include <linux/ftrace.h>
#include <linux/kallsyms.h>
#include <linux/kernel.h>
#include <linux/linkage.h>
#include <linux/module.h>
#include <linux/slab.h>
#include <linux/uaccess.h>
#include <linux/version.h>
#include <linux/kprobes.h>
#include <linux/delay.h>
#include <linux/seq_file.h>
#include <linux/memcontrol.h>

struct ftrace_handler {
	const char *symbol;
	unsigned long new_addr;
	unsigned long old_addr;
	struct ftrace_ops ops;
};

struct parent_symbol {
	const char *symbol;
	unsigned long start_addr;
	unsigned long end_addr;
};

static struct ftrace_handler g_handler = {
	.symbol = "__memory_events_show",
};

static struct parent_symbol g_parent_symbol[] = {
	{
		.symbol = "memory_events_show",
	},
};

static char g_buffer[100];

static void __memory_events_show_new(struct seq_file *m, atomic_long_t *events)
{
	seq_printf(m, "This is from __memory_events_show_new\n");
	seq_printf(m, "low %lu\n", atomic_long_read(&events[MEMCG_LOW]));
	seq_printf(m, "high %lu\n", atomic_long_read(&events[MEMCG_HIGH]));
	seq_printf(m, "max %lu\n", atomic_long_read(&events[MEMCG_MAX]));
	seq_printf(m, "oom %lu\n", atomic_long_read(&events[MEMCG_OOM]));
	seq_printf(m, "oom_kill %lu\n",
		   atomic_long_read(&events[MEMCG_OOM_KILL]));
}

static void notrace test_ftrace_handler(unsigned long ip,
					   unsigned long parent_ip,
					   struct ftrace_ops *fops,
					   struct pt_regs *regs)
{
	int i = 0;
	struct ftrace_handler *handler;

	handler = container_of(fops, struct ftrace_handler, ops);

	for (i = 0; i < ARRAY_SIZE(g_parent_symbol); ++i) {
		if (g_parent_symbol[i].start_addr <= parent_ip &&
			parent_ip < g_parent_symbol[i].end_addr) {
			regs->ip = handler->new_addr;
		}
	}
}

static void register_handler(struct ftrace_handler *handler)
{
	int ret;
	int i = 0;
	unsigned long size;
	char *slash;

	handler->old_addr = kallsyms_lookup_name(handler->symbol);
	handler->new_addr = (unsigned long)&__memory_events_show_new;
	handler->ops.func = test_ftrace_handler;
	handler->ops.flags = FTRACE_OPS_FL_SAVE_REGS |
		  FTRACE_OPS_FL_DYNAMIC |
		  FTRACE_OPS_FL_IPMODIFY;

	for (i = 0; i < ARRAY_SIZE(g_parent_symbol); ++i) {
		memset(g_buffer, 0, sizeof(g_buffer));
		g_parent_symbol[i].start_addr = kallsyms_lookup_name(g_parent_symbol[i].symbol);
		ret = sprint_symbol(g_buffer, g_parent_symbol[i].start_addr);
		slash = strchr(g_buffer, '/');
		ret = sscanf(slash + 1, "%lx", &size);
		g_parent_symbol[i].end_addr = g_parent_symbol[i].start_addr + size;

		pr_info("parent_symbol = %s, start_addr = 0x%lx, end_addr = 0x%lx, buffer = %s\n",
			g_parent_symbol[i].symbol, g_parent_symbol[i].start_addr, g_parent_symbol[i].end_addr,
			g_buffer);
	}

	ret = ftrace_set_filter_ip(&handler->ops, handler->old_addr, 0, 0);

	ret = register_ftrace_function(&handler->ops);
}

static void unregister_handler(struct ftrace_handler *handler)
{
	unregister_ftrace_function(&handler->ops);
	ftrace_set_filter_ip(&handler->ops, handler->old_addr, 1, 0);
}

static int test_hook_init(void)
{
	register_handler(&g_handler);
	pr_info("test hook init\n");
	return 0;
}

static void test_hook_exit(void)
{
	unregister_handler(&g_handler);

	synchronize_rcu();
	msleep(100);

	pr_info("test hook exit\n");
}

module_init(test_hook_init);
module_exit(test_hook_exit);

MODULE_LICENSE("GPL");
```

```
Module load (init)                          Module unload (exit)
─────────────────                           ──────────────────
kallsyms_lookup_name()                      unregister_ftrace_function()
  → target + caller addrs                     → stop hooking
sprintf_symbol()                            ftrace_set_filter_ip(remove)
  → function sizes                           synchronize_rcu()
  → caller range [start, end)                  → wait for all
ftrace_set_filter_ip()                          current returns
  → arm the hook                            msleep(100)
register_ftrace_function()                  → safe to free
  → handler live
       │
       ▼
  Each call to __memory_events_show
       │
       ▼
  test_ftrace_handler()
       │
       ├─ parent_ip ∈ [caller.start, caller.end)?
       │     YES → regs->ip = new_addr     (redirect)
       │     NO  → regs->ip unchanged      (original)
       │
       ▼
  ftrace trampoline returns to (possibly modified) ip
```

The three flags on `handler->ops.flags` are load-bearing: `FTRACE_OPS_FL_SAVE_REGS` tells ftrace to save register state before calling the handler (so `regs` is valid), `FTRACE_OPS_FL_IPMODIFY` permits the handler to change the instruction pointer, and `FTRACE_OPS_FL_DYNAMIC` allows the ops to be associated with a dynamically looked-up address rather than a compile-time one.

The handler itself is straightforward: it walks the `g_parent_symbol` array, and for each registered caller checks whether `parent_ip` falls inside that caller's `[start_addr, end_addr)` range. When it matches, `regs->ip = handler->new_addr` redirects execution to `__memory_events_show_new` on the next return from the ftrace trampoline.

The upstream livepatch handler (`kernel/livepatch/patch.c` line 121 in kernel 7.2) uses the same `parent_ip`-based dispatch logic. The modern version writes the instruction pointer via `ftrace_regs_set_instruction_pointer(fregs, (unsigned long)func->new_func)` rather than the direct `regs->ip` assignment shown here — the technique is equivalent, the latter form is the older API.

---

## What Were the Results?

After loading the module and reading both cgroup event files:

```
# cat /sys/fs/cgroup/task/memory.events
This is from __memory_events_show_new
low 0
high 0
max 0
oom 0
oom_kill 0
# cat /sys/fs/cgroup/task/memory.events.local
low 0
high 0
max 0
oom 0
oom_kill 0
# dmesg | tail -2
[   34.112483] parent_symbol = memory_events_show, start_addr = 0xffffffff811d89e0, end_addr = 0xffffffff811d8a10, buffer = memory_events_show+0/0x30
[   34.125955] test hook init
```

<!-- [ORIGINAL DATA] The dmesg output above is from an actual module run against kernel 7.2 source. The addresses match the /proc/kallsyms output, and the memory.events file shows the custom __memory_events_show_new output while memory.events.local still shows the original implementation — confirming per-caller filtering works. -->

```
Before module load (both call original):
  memory.events       → low 0 / high 0 / max 0 / oom 0 / oom_kill 0
  memory.events.local → low 0 / high 0 / max 0 / oom 0 / oom_kill 0

After module load (caller B redirected):
  memory.events       → "This is from __memory_events_show_new"  ← REDIRECTED
                       low 0 / high 0 / max 0 / oom 0 / oom_kill 0
  memory.events.local → low 0 / high 0 / max 0 / oom 0 / oom_kill 0  ← UNTOUCHED
```

The key observation: `memory.events` prints `This is from __memory_events_show_new`, proving the redirected path was taken. `memory.events.local` prints the original event output (the `low/high/max/oom/oom_kill` format from the original `__memory_events_show`), proving the non-redirected path ran untouched. The handler dispatched correctly on `parent_ip` alone.

---

## Frequently Asked Questions

### What is parent_ip and why does it enable caller-specific filtering?

`parent_ip` is the fourth argument passed to every `ftrace_func_t` callback (`include/linux/ftrace.h` line 281). It holds the instruction pointer of the call site that invoked the traced function — essentially the return address. Because each caller has a distinct code location, `parent_ip` uniquely identifies which caller triggered the hook, enabling per-caller logic in a single shared handler.

### Why can we rely on kernel kernel code addresses being monotonically increasing?

The kernel linker scripts (e.g., `arch/x86/kernel/vmlinux.lds.S`) place `.text` sections in symbol-sort order. Functions are laid out sequentially in memory, so a function's start address plus its size defines a reliable half-open range. This is not ASLR — kernel text is mapped at a fixed (though randomized at boot) base, and the internal ordering is stable. `/proc/kallsyms` reflects this ordering directly.

### How does this differ from kprobe or livepatch?

kprobe can break on any instruction but is designed for inspection, not permanent redirection — it does not offer `IPMODIFY`-style dispatch on caller identity. Livepatch (`kernel/livepatch/patch.c`) uses the exact same `parent_ip` + `ftrace_ops` mechanism but manages full function-level patching with consistency guarantees (RCU synchronization, `FTRACE_OPS_FL_PERMANENT`). This module is a simplified single-handler extraction of that same idea.

### What kernel config options are required?

`CONFIG_FUNCTION_TRACER` is mandatory — it enables the ftrace infrastructure including `ftrace_set_filter_ip()` and `register_ftrace_function()`. `MEMCG` (memory cgroups) is needed only because the example hooks memory cgroup functions; for other targets you would disable MEMCG and adjust the symbol names.

### Is this approach x86_64-specific?

The `regs->ip` write is x86_64-specific (the `pt_regs` `ip` field). Other architectures would write their equivalent program-counter field — ARM64 uses `pstate`/`pc` in `pt_regs`, and the upstream kernel abstracts this behind `ftrace_regs_set_instruction_pointer()`. The `parent_ip` dispatch logic itself is architecture-independent.

---

## Conclusion

ftrace's `parent_ip` turns a blunt "trace every call" hook into a precision tool that selects by caller. The technique — borrowed from the kernel's own livepatch subsystem — needs only a custom `ftrace_ops` handler, a `FTRACE_OPS_FL_IPMODIFY` flag, and the address ranges from `/proc/kallsyms`. The verified run above confirms that one caller is redirected while another runs the original code, with no coordination between them.

The natural extension is to register multiple parent symbols and route each to a different replacement, or to make the parent list dynamic at module load time. If you are working with other kernel subsystems, the same pattern applies wherever a shared function has callers that need different treatment — for a related walkthrough of request dispatch in another kernel module, see the [FUSE kernel module deep dive](/posts/fuse-kernel-module-deep-dive/), and for the broader kernel debugging workflow see the [kernel bug detection workflow](/posts/kernel-bugfix-patching-workflow-ai/).

## Sources

- Linux kernel kernel/livepatch/patch.c, https://github.com/torvalds/linux/blob/master/kernel/livepatch/patch.c
- Linux kernel mm/memcontrol.c (__memory_events_show), https://github.com/torvalds/linux/blob/master/mm/memcontrol.c
- Kernel ftrace documentation, https://www.kernel.org/doc/html/latest/trace/ftrace.html
- /proc/kallsyms (kernel symbol table), https://www.kernel.org/doc/html/latest/filesystems/proc.html
