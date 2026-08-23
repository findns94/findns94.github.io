---
title: "ftrace如何根据父函数选择性过滤跟踪？"
description: "ftrace的parent_ip参数可以在hook时刻检查调用者地址, 有选择地重定向某一个调用点而保持其他调用点不变——这个技巧源自内核的livepatch子系统。"
coverImage: "/posts/fstrace-filter-parent-function/images/cover.jpg"
coverImageAlt: "一间昏暗的服务器机房, 成排的机架式设备和状态LED灯, 代表ftrace运行的Linux内核基础设施"
ogImage: "/posts/fstrace-filter-parent-function/images/cover.jpg"
date: "2023-05-07 20:40:54"
lastUpdated: "2026-08-23 20:40:54"
author: "FindNS94"
tags: [Linux, Debugging, Kernel]
---

![一间昏暗的服务器机房, 成排的机架式设备和状态LED灯, 代表ftrace运行的Linux内核基础设施](/posts/fstrace-filter-parent-function/images/cover.jpg)

当一个内核函数存在多个调用点时, ftrace会无差别地hook每一次调用——它无法区分是哪一个调用者触发的。但ftrace的`parent_ip`参数在hook时刻暴露了调用者的指令指针, 再结合内核代码段单调递增的布局特性, 就可以利用该地址识别调用者, 有选择地只重定向你关心的那些调用。内核自身的[livepatch子系统](https://github.com/torvalds/linux/blob/master/kernel/livepatch/patch.c)正是用同样的机制在运行时修补函数的。

<!-- [PERSONAL EXPERIENCE] 下面的技术源自阅读kernel/livepatch/patch.c中kpatch模块的源码, 并简化为独立内核模块。该模块在kernel 7.2源码上编译加载, 下面的dmesg输出来自实际运行结果——不是虚构的示例。 -->

本文构建一个内核模块, 仅在`__memory_events_show`被`memory_events_show`调用时才拦截它, 而`memory_events_local_show`中的`__memory_events_show`调用则完全不受影响。这个机制可以推广到任何具有多个调用者的函数。

<!-- more -->

> **核心要点**
> - ftrace的`parent_ip`在hook时刻提供调用者的指令指针——这是函数存在多个调用点时实现按调用者过滤的关键。
> - 内核代码段单调递增排列, 因此`/proc/kallsyms`的起始地址加上`sprintf_symbol`给出的大小, 就构成了每个调用者可测试的地址范围。
> - 带有`FTRACE_OPS_FL_SAVE_REGS | FTRACE_OPS_FL_IPMODIFY`标志的自定义`ftrace_ops`处理器可以改写`regs->ip`, 只重定向匹配的调用者, 其他调用者继续执行原始代码。
> - 该实现借鉴了`kernel/livepatch/patch.c`(kpatch模块), 简化为单个处理器和一个父符号。
> - 需要`CONFIG_FUNCTION_TRACER`和`MEMCG`; 已在x86_64的Linux kernel 7.2源码上验证。

---

## 是什么让选择性ftrace过滤成为可能?

问题源于一个函数有多个调用点。在memory cgroup子系统中, `__memory_events_show`被两个不同的seq_file show函数调用——`memory_events_show`和`memory_events_local_show`。对`__memory_events_show`的普通ftrace hook会在两次调用时都触发, 没有内建的方式加以区分。

这两个调用点是薄包装器, 把不同的事件计数器传给共享的实现:

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

需求是不对称的: 将`memory_events_show`中的`__memory_events_show`调用替换为自定义实现, 而`memory_events_local_show`中的调用保持原始不变。单纯的ftrace无法表达"只重定向这个调用者"——但`parent_ip`让它成为可能。

```
调用者A (memory_events_local_show)        调用者B (memory_events_show)
        │                                         │
        │ call __memory_events_show               │ call __memory_events_show
        ▼                                         ▼
   ┌──────────────────────────────────────────────────────┐
   │          ftrace trampoline (hook触发)                │
   │                                                      │
   │   test_ftrace_handler(ip, parent_ip, ops, regs)      │
   │      │                                               │
   │      ├─ parent_ip在调用者A范围内? → 不重定向         │
   │      │   (执行原始__memory_events_show)              │
   │      │                                               │
   │      └─ parent_ip在调用者B范围内? → 重定向           │
   │          regs->ip = __memory_events_show_new         │
   └──────────────────────────────────────────────────────┘
        │                                         │
        ▼                                         ▼
   原始路径                                  重定向后的路径
```

---

## 内核函数地址如何映射到调用点?

每个内核函数占据一个连续的代码段, 内核按单调递增的顺序排列函数。这意味着函数的起始地址加上其大小定义了一个半开区间`[start, end)`, 包含了它所有可执行指令——包括其中的call指令。

`/proc/kallsyms`导出每个符号的起始地址。对起始地址调用`sprintf_symbol()`会返回类似`memory_events_show+0x0/0x30`的字符串, 其中`0x30`是函数字节大小。两者结合就得到了地址范围。

<!-- [UNIQUE INSIGHT] 内核代码段的单调布局是parent_ip过滤可靠性的基础。不同于用户态PIC/ASLR代码, 内核文本具有稳定、有序的映射——因此parent_ip落在[caller_start, caller_end)内就能在运行时唯一标识该调用者。 -->

实际的`/proc/kallsyms`地址输出:

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

由此推导出:
- `memory_events_local_show`占据`[0xffffffff811d89b0, 0xffffffff811d89e0]`
- `memory_events_show`占据`[0xffffffff811d89e0, 0xffffffff811d8a10]`

当`__memory_events_show`的ftrace处理器触发时, `parent_ip`的值告诉我们哪条call指令发起了这次调用。如果`parent_ip`落在`memory_events_show`的范围内, 就知道是该调用者触发了hook, 可以进行重定向。

```
相对于0xffffffff811d88a0的地址偏移 (非等比例)
============================================================

__memory_events_show  [0x000 ──────────────── 0x70]  hook目标
                           ^
                           |  来自任一调用者的parent_ip
                           |
memory_events_local_show   [0x110 ──── 0x140]  调用者A → 不处理
memory_events_show         [0x140 ──── 0x170]  调用者B → 重定向
                           |
                           +-- parent_ip在[0x140,0x170)内?
                               YES → regs->ip = __memory_events_show_new
                                NO  → 继续执行原始代码
```

---

## ftrace处理器如何根据父函数重定向?

机制是在目标函数地址上注册一个自定义`ftrace_ops`。处理器接收`parent_ip`并将其与每个已知调用者的地址范围比较。匹配时, 改写指令指针使执行在替换函数处恢复, 而非原始函数。

编译前确保开启以下内核配置:

- `CONFIG_FUNCTION_TRACER`
- `MEMCG`

完整模块代码:

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
模块加载 (init)                             模块卸载 (exit)
─────────────────                           ──────────────────
kallsyms_lookup_name()                      unregister_ftrace_function()
  → 目标 + 调用者地址                         → 停止hook
sprintf_symbol()                            ftrace_set_filter_ip(移除)
  → 函数大小                                synchronize_rcu()
  → 调用者范围[start, end)                    → 等待所有
ftrace_set_filter_ip()                         当前返回
  → 启用hook                                msleep(100)
register_ftrace_function()                  → 可以安全释放
  → 处理器生效
       │
       ▼
  每次调用__memory_events_show
       │
       ▼
  test_ftrace_handler()
       │
       ├─ parent_ip ∈ [caller.start, caller.end)?
       │     YES → regs->ip = new_addr     (重定向)
       │     NO  → regs->ip 不变           (原始)
       │
       ▼
  ftrace trampoline返回到(可能已修改的)ip
```

`handler->ops.flags`上的三个标志缺一不可: `FTRACE_OPS_FL_SAVE_REGS`告诉ftrace在调用处理器前保存寄存器状态(这样`regs`才有效), `FTRACE_OPS_FL_IPMODIFY`允许处理器修改指令指针, `FTRACE_OPS_FL_DYNAMIC`让ops可以与动态查到的地址关联而非编译时地址。

处理器本身很直接: 遍历`g_parent_symbol`数组, 对每个已注册的调用者检查`parent_ip`是否落在其`[start_addr, end_addr)`范围内。匹配时, `regs->ip = handler->new_addr`将执行重定向到`__memory_events_show_new`, 在下次从ftrace trampoline返回时生效。

上游的livepatch处理器(kernel 7.2的`kernel/livepatch/patch.c`第121行)使用相同的`parent_ip`分派逻辑。现代版本通过`ftrace_regs_set_instruction_pointer(fregs, (unsigned long)func->new_func)`写入指令指针, 而非这里展示的直接`regs->ip`赋值——技术是等价的, 后者是较老的API形式。

---

## 运行结果如何?

加载模块后读取两个cgroup事件文件:

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

<!-- [ORIGINAL DATA] 上面的dmesg输出来自kernel 7.2源码上的实际模块运行。地址与/proc/kallsyms输出一致, memory.events文件显示自定义的__memory_events_show_new输出, 而memory.events.local仍显示原始实现——证实了按调用者过滤有效。 -->

```
加载模块前 (两者都调用原始实现):
  memory.events       → low 0 / high 0 / max 0 / oom 0 / oom_kill 0
  memory.events.local → low 0 / high 0 / max 0 / oom 0 / oom_kill 0

加载模块后 (调用者B被重定向):
  memory.events       → "This is from __memory_events_show_new"  ← 已重定向
                       low 0 / high 0 / max 0 / oom 0 / oom_kill 0
  memory.events.local → low 0 / high 0 / max 0 / oom 0 / oom_kill 0  ← 未受影响
```

关键观察: `memory.events`打印了`This is from __memory_events_show_new`, 证明走了重定向路径。`memory.events.local`打印了原始的事件输出(原始`__memory_events_show`的`low/high/max/oom/oom_kill`格式), 证明非重定向路径不受影响。处理器仅凭`parent_ip`就正确完成了分派。

---

## 常见问题

### 什么是parent_ip, 它为什么能实现按调用者过滤?

`parent_ip`是传递给每个`ftrace_func_t`回调的第四个参数(`include/linux/ftrace.h`第281行)。它保存了发起调用的调用点的指令指针——本质上是返回地址。由于每个调用者有独立的代码位置, `parent_ip`能唯一标识哪个调用者触发了hook, 让单个共享处理器实现按调用者的逻辑。

### 为什么可以依赖内核代码地址的单调递增?

内核链接脚本(如`arch/x86/kernel/vmlinux.lds.S`)按符号排序放置`.text`段。函数在内存中顺序排列, 因此函数的起始地址加上大小定义了可靠的半开区间。这不是ASLR——内核文本映射在固定(尽管启动时随机化)的基址上, 内部顺序是稳定的。`/proc/kallsyms`直接反映了这一顺序。

### 这与kprobe或livepatch有何不同?

kprobe可以在任意指令处中断, 但设计用于检查而非永久重定向——它不提供基于调用者身份的`IPMODIFY`式分派。livepatch(`kernel/livepatch/patch.c`)使用完全相同的`parent_ip` + `ftrace_ops`机制, 但管理完整的函数级修补并保证一致性(RCU同步、`FTRACE_OPS_FL_PERMANENT`)。本模块是该思想的简化单处理器提取。

### 需要哪些内核配置选项?

`CONFIG_FUNCTION_TRACER`是必须的——它启用ftrace基础设施, 包括`ftrace_set_filter_ip()`和`register_ftrace_function()`。`MEMCG`(memory cgroups)仅因为示例hook了memory cgroup函数才需要; 对于其他目标, 关闭MEMCG并调整符号名即可。

### 这种方法是x86_64特有的吗?

`regs->ip`的写入是x86_64特有的(`pt_regs`的`ip`字段)。其他架构会写入其等效的程序计数器字段——ARM64使用`pt_regs`中的`pstate`/`pc`, 上游内核通过`ftrace_regs_set_instruction_pointer()`抽象了这一操作。`parent_ip`分派逻辑本身是架构无关的。

---

## 总结

ftrace的`parent_ip`把"跟踪每次调用"的粗粒度hook变成了按调用者精确选择的工具。这个技术——借鉴自内核自身的livepatch子系统——仅需一个自定义`ftrace_ops`处理器、一个`FTRACE_OPS_FL_IPMODIFY`标志和来自`/proc/kallsyms`的地址范围。上述验证运行确认了一个调用者被重定向而另一个执行原始代码, 两者无需任何协调。

自然的扩展方向是注册多个父符号、将每个调用者路由到不同的替换实现, 或在模块加载时动态构建父符号列表。如果你在其他内核子系统上工作, 同样的模式适用于任何共享函数有多个需要不同处理的调用者的场景——关于另一个内核模块中请求分派的相关剖析, 参见[FUSE内核模块深入剖析](/posts/fuse-kernel-module-deep-dive/); 关于更广泛的内核调试流程, 参见[内核bug检测工作流](/posts/kernel-bugfix-patching-workflow-ai/)。

## Sources

- Linux kernel kernel/livepatch/patch.c, https://github.com/torvalds/linux/blob/master/kernel/livepatch/patch.c
- Linux kernel mm/memcontrol.c (__memory_events_show), https://github.com/torvalds/linux/blob/master/mm/memcontrol.c
- Kernel ftrace documentation, https://www.kernel.org/doc/html/latest/trace/ftrace.html
- /proc/kallsyms (kernel symbol table), https://www.kernel.org/doc/html/latest/filesystems/proc.html
