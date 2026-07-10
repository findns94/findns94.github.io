---
title: Using ftrace to Selectively Trace Parent Functions
date: 2023-05-07 20:40:54
tags: 
---


# Using ftrace to Selectively Trace Parent Functions

## Background

Taking the code in the memory cgroup subsystem as an example, the `__memory_events_show` function has two call sites, namely `memory_events_show` and `memory_events_local_show`.

The code is as follows:

<!-- more -->

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

If you want to use `ftrace` to achieve the following requirements:

- Replace the `__memory_events_show` call in `memory_events_show` with your own implementation, while
- Keeping the `__memory_events_show` call in `memory_events_local_show` as the original call
- This can be accomplished by leveraging the property that kernel code segments are monotonically increasing

## Approach Overview

Using `/proc/kallsyms`, you can see the starting addresses of kernel functions and roughly determine their ranges, as shown below:

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

As can be seen, the code segment range of `memory_events_local_show` is `[0xffffffff811d89b0, 0xffffffff811d89e0]`,
while the code segment range of `memory_events_show` is `[0xffffffff811d89e0, 0xffffffff811d8a10]`.

Therefore, by examining the call site address of the `ftrace`-traced function `__memory_events_show` — that is, the range of the IP register on the x86_64 architecture —
you can determine whether the current call site of `__memory_events_show` falls within the code segment range of `memory_events_local_show` or `memory_events_show`.

Coincidentally, the `ftrace_func_t` callback function pointer type registered on the ftrace handler provides the `parent_ip` parameter, which makes it convenient to check the IP range.

## Implementation

This implementation references the kernel's `kernel/livepatch/patch.c` source code from the kpatch module, with some simplifications applied.

Before compiling and loading the kernel module, ensure the following kernel Kconfig options are enabled:

- CONFIG_FUNCTION_TRACER
- MEMCG

The code is as follows:

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

## Execution Results

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
[   34.112483] parent_symbol = memory_events_show, start_addr = 0xffffffff811d89e0, end_addr = 0xffffffff811d8a10, buffer = memory_events_show+0x0/0x30
[   34.125955] test hook init
```
