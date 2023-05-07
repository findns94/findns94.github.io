---
title: 使用ftrace过滤选择性跟踪父函数
date: 2023-05-07 20:40:54
tags:
---

# 使用ftrace过滤选择性跟踪父函数

## 背景

以memory cgroup子系统里的代码为例, `__memory_events_show`函数有2处调用, 分别是`memory_events_show`和`memory_events_local_show`.

代码如下:

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

如果要利用`ftrace`实现以下需求:

- 将`memory_events_show`中的`__memory_events_show`替换成自己实现的同时
- 让`memory_events_local_show`中的`__memory_events_show`保持原始的调用
- 可以借助内核代码段自增的特点加以实现

## 思路简介

使用`/proc/kallsyms`可以看到内核函数的开始地址并初步判断其区间, 如下:

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

可以看到`memory_events_local_show`的代码段范围是`[0xffffffff811d89b0,0xfffffff811d89e0]`,
而`memory_events_show`的代码段范围是`[0xffffffff811d89e0,0xffffffff811d8a10]`,

因此可以通过判断`ftrace`跟踪函数`__memory_events_show`的调用点地址, 即在x86_64体系结构里的IP寄存器的范围,
确定当前`__memory_events_show`的调用点是处于`memory_events_local_show`还是`memory_events_show`的代码段范围内

恰好`ftrace_func_t`这个`ftrace`注册在handler上的回调函数指针类型提供了`parent_ip`这个参数可以方便的判断IP的范围

## 实现

该实现参考了内核`kernel/livepatch/patch.c`这个kpatch模块的源码, 进行了一定的简化.

编译和加载内核模块前确保内核Kconfig开启以下特性

- CONFIG_FUNCTION_TRACER
- MEMCG

代码如下:

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

## 运行结果

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
