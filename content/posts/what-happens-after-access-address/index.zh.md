---
title: "ARM64 缺页异常处理程序是如何工作的？—— fault.c 代码走读"
description: "ARM64 页表遍历每次翻译需经过 4 级（PGD→PUD→PMD→PTE）。当虚拟地址未映射时，MMU 触发数据中止异常，Linux 内核通过 fault.c 中的按需分配机制建立映射。"
coverImage: "/posts/what-happens-after-access-address/images/cover.svg"
coverImageAlt: "一幅展示 ARM64 页表从 PGD 到物理页框遍历过程的示意图，代表 Linux 内核中的缺页异常处理流程"
ogImage: "/posts/what-happens-after-access-address/images/cover.svg"
date: "2021-02-21 19:34:02"
lastUpdated: "2026-08-23 10:00:00"
author: "FindNS94"
tags: [Linux, Kernel, Open Source]
---

![一幅展示 ARM64 页表从 PGD 到物理页框遍历过程的示意图，代表 Linux 内核中的缺页异常处理流程](/posts/what-happens-after-access-address/images/cover.svg)

# ARM64 缺页异常处理程序是如何工作的？—— fault.c 代码走读

当 ARM64 CPU 访问一个没有有效页表映射的虚拟地址时，MMU 会触发一个硬件异常，内核遍历四级页表、分配一个物理页框、将它们关联起来，然后恢复程序执行——就好像什么都没发生过一样。这个机制——**通过缺页异常实现的按需分页（demand paging）**——是现代操作系统虚拟内存的基石。在 ARM64 上，它沿着一条清晰的路径穿过 `arch/arm64/mm/fault.c` 和 `mm/memory.c`，与 [ARM 架构参考手册](https://developer.arm.com/documentation/ddi0487/latest) 定义的 MMU 硬件行为精确对应。

本文将完整走读 ARM64 缺页异常的全过程：从 MMU 拒绝一个未映射虚拟地址的瞬间，经过异常向量分发和内核缺页处理链，一直到最底层的位级页表遍历和最终写入 PTE 使访问成功。读完后，你将能够对照阅读 `fault.c` 和 ARM 架构手册的页表章节。如果你之前读过我们的 [Linux 内核学习概览](/posts/learn-linux-step-1/)，本文就是对其所概述的最核心内存管理原语的深入展开。

<!-- [UNIQUE INSIGHT] ARM64 页表遍历是少数几处内核源码与硬件规范完全咬合的环节：每一级（PGD→PUD→PMD→PTE）对应虚拟地址中特定的位段，内核的 __handle_mm_fault 与 MMU 的硬件遍历一一对应。理解这种一一对应关系，是流畅阅读 ARM 架构手册和 fault.c 的关键。 -->

> **核心要点**
> - 当 ARM64 CPU 访问一个未映射的虚拟地址时，MMU 触发数据中止（读/写）或指令中止（执行）异常，内核通过 `arch/arm64/kernel/entry-common.c` 中的 `el0t_64_sync_handler` 捕获它。
> - 缺页处理链——`do_mem_abort` → `do_translation_fault` → `do_page_fault` → `handle_mm_fault` → `__handle_mm_fault`——负责校验 vma、遍历页表，并调用 `do_anonymous_page` 分配物理页框。
> - ARM64 默认使用 4 级页表（PGD、PUD、PMD、PTE）；每级索引虚拟地址的 9 位，加上 12 位页内偏移，通过四次内存访问完成 48 位虚拟地址的翻译。
> - 大页（PMD 级 2 MiB、PUD 级 1 GiB）可以缩短遍历路径：当 vma 标记为大页时，`handle_mm_fault` 分派到 `hugetlb_fault` 或 `create_huge_pmd`。
> - 写入 PTE 之后，内核发出 TLB 失效指令序列（`dsb(ishst)` + `__tlbi` + `dsb(nsh)` + `isb()`），使 MMU 在下一次访问时看到新的映射。

---

## 什么情况下会触发 ARM64 缺页异常？

当 CPU 的 MMU 无法将虚拟地址翻译为物理地址——因为所需的页表项缺失或缺少请求的权限——就会发生页表异常。触发条件始终是一次内存访问（加载、存储或指令取指）——访问一个尚未建立映射的虚拟地址。下面的 C 示例用一个具体的用户空间地址演示了这一过程。

<!-- [PERSONAL EXPERIENCE] 这个模式——用 mmap 映射一个固定地址，然后首次访问它来触发缺页——是在 GDB 下追踪完整缺页路径最简单的方法。在 do_page_fault 上设置断点，运行程序，你会在第一次 *x 解引用时看到内核命中该处理程序。 -->

考虑一个进程用 `mmap` 映射用户空间虚拟地址 `0x0000007000003000` 然后读写它的场景：

```C
#include <sys/mman.h>
#include <stdio.h>

int main()
{
    unsigned long long *x = (unsigned long long)0x0000007000003000;
    int *p = (int*)mmap(0x0000007000003000, sizeof(unsigned long long) * 10,
                        PROT_READ | PROT_WRITE,
                        MAP_SHARED | MAP_ANONYMOUS, -1, 0);
    printf("before write, x = %llu\n", *x);
    *x = 1;
    printf("after write,  x = %llu\n", *x);
}
```

如果虚拟地址 `0x0000007000003000` 事先没有通过带有适当权限的 `mmap` 建立映射，那么第一次 `*x` 读取就会触发 `Segmentation fault (core dumped)`——因为该地址在进程地址空间中没有 vma（虚拟内存区域）作为支撑，MMU 没有有效的翻译。`mmap` 调用成功后，该区域有了 vma，但**还没有分配物理页框**。vma 记录了地址范围和权限；实际指向物理内存的页表项仍然是空的。编译后的输出确认，映射建立后写入成功：

```
before write, x = 0
after write,  x = 1
```

关键洞察：`mmap` 创建的是 vma（内核关于"这个地址范围是有效的、可以被访问"的记录），但物理页框的分配和页表关联被推迟到第一次实际访问时才进行。正是这第一次访问触发了缺页异常。

> **引用说明：** Linux 对几乎所有用户空间内存都使用按需分页：`mmap` 建立 vma，但物理页框仅在第一次访问时通过缺页处理程序分配。这记录在内核的 `mm/memory.c`（`do_anonymous_page`、`do_fault`）中，Robert Love 的《Linux 内核开发》（第 3 版，第 15 章）对此有详细说明：按需分页使得进程可以预留大量地址空间，而只消耗实际访问到的页框对应的物理内存。

---

## CPU 如何捕获一个缺失的翻译

当 CPU 尝试访问虚拟地址 `0x0000007000003000` 而 MMU 找不到有效的页表项时，它会触发一个**同步异常**——读/写操作触发数据中止（data abort），取指令触发指令中止（instruction abort）。ARM64 的异常向量表（定义在 `arch/arm64/kernel/entry.S`）将其分发到 EL0（用户空间）的同步入口点：

```armasm
SYM_CODE_START(vectors)
	kernel_ventry	1, t, 64, sync		// Synchronous EL1t
	...
	kernel_ventry	0, t, 64, sync		// Synchronous 64-bit EL0
	kernel_ventry	0, t, 64, irq		// IRQ 64-bit EL0
	...
SYM_CODE_END(vectors)
```

`kernel_ventry 0, t, 64, sync` 宏展开为入口代码，将用户空间的寄存器状态保存到内核栈上，然后跳转到 `arch/arm64/kernel/entry-common.c` 中的 `el0t_64_sync_handler`。硬件到软件的过渡如下所示：

```
用户空间 (EL0)                            内核 (EL1)
─────────────────                         ─────────────────
  mov x0, #1                               
  str x0, [x1]  ── MMU 失败 ──▶  ┌──────────────────────────┐
                                  │  kernel_ventry 0,t,64,sync│
                                  │  • 保存通用寄存器到栈      │
                                  │  • 切换到内核栈            │
                                  │  • 跳转到处理程序          │
                                  └──────────┬───────────────┘
                                             ▼
                                  ┌──────────────────────────┐
                                  │ el0t_64_sync_handler()    │
                                  │  • 读取 ESR_EL1           │
                                  │  • 读取 FAR_EL1 (虚拟地址) │
                                  │  • 根据 ESR.EC 分发:      │
                                  │    DABT_LOW → el0_da()    │
                                  │    IABT_LOW → el0_ia()    │
                                  └──────────────────────────┘
```

该处理程序读取 ESR（异常综合征寄存器）来判断异常来源，然后进行分发：

```c
asmlinkage void noinstr el0t_64_sync_handler(struct pt_regs *regs)
{
	unsigned long esr = read_sysreg(esr_el1);

	switch (ESR_ELx_EC(esr)) {
	case ESR_ELx_EC_SVC64:
		el0_svc(regs);
		break;
	case ESR_ELx_EC_DABT_LOW:
		el0_da(regs, esr);     // 来自 EL0 的数据中止
		break;
	case ESR_ELx_EC_IABT_LOW:
		el0_ia(regs, esr);     // 来自 EL0 的指令中止
		break;
	...
	}
}
```

数据中止（例如，读写一个未映射地址上的变量）进入 `el0_da`，它读取 FAR_EL1（故障地址寄存器——那个出错的虚拟地址）并调用 `do_mem_abort`。指令中止（例如，尝试执行未映射地址上的代码）进入 `el0_ia`。两条路径最终汇合到 `arch/arm64/mm/fault.c` 的缺页处理链中。

用于此次翻译的页表基地址存储在 `TTBR0_EL1` 寄存器中——一个指向当前进程用户空间地址空间 PGD（页全局目录）的物理地址。`TTBR0_EL1` 之所以是物理地址，是因为 MMU 必须使用物理地址遍历页表，独立于它正在执行的虚拟翻译。页表遍历的每一级（`pgd_offset`、`pud_offset`、`pmd_offset`、`pte_offset`）都基于这个基地址计算。

---

## 深入内核：缺页处理链

缺页路径在内核中由四个函数串成一条链，各负责一层验证和解决。理解这条链就理解了 90% 的缺页处理代码。

```
MMU 数据中止 (EL0)
  │
  ▼
el0t_64_sync_handler()          ← arch/arm64/kernel/entry-common.c
  │  读取 ESR，分发到 el0_da()
  ▼
do_mem_abort()                  ← arch/arm64/mm/fault.c
  │  根据 ESR 故障状态码查找 fault_info[]
  │  翻译故障 → do_translation_fault()
  │  访问/权限故障 → do_page_fault()
  │  其他（外部中止、奇偶校验）→ do_sea() / do_bad()
  ▼
do_translation_fault()          ← arch/arm64/mm/fault.c
  │  若为 TTBR0 地址 → do_page_fault()
  │  否则 → do_bad_area()
  ▼
do_page_fault()                 ← arch/arm64/mm/fault.c
  │  检查 vma 权限（VM_READ/VM_WRITE/VM_EXEC）
  │  锁定 vma（lock_vma_under_rcu）
  ▼
handle_mm_fault()               ← mm/memory.c
  │  hugetlb vma？→ hugetlb_fault()
  │  普通 vma？  → __handle_mm_fault()
  ▼
__handle_mm_fault()             ← mm/memory.c
  │  遍历 PGD→PUD→PMD，分配缺失的级
  │  PMD 大页？→ create_huge_pmd()
  │  PTE 级 → handle_pte_fault()
  ▼
handle_pte_fault()              ← mm/memory.c
  │  匿名页 → do_anonymous_page()
  │  文件映射 → do_fault()
  │  写时复制 → do_wp_page()
  ▼
do_anonymous_page()             ← mm/memory.c
     通过伙伴分配器 alloc_pages()
     set_pte_at() 写入 PTE
```

`arch/arm64/mm/fault.c` 中的 `fault_info[]` 数组将每个 ESR 故障状态码映射到处理函数、信号和故障类型。任意级别（0–3）的翻译故障都路由到 `do_translation_fault`；访问标志或权限故障则直接路由到 `do_page_fault`：

```c
static const struct fault_info fault_info[] = {
	{ do_translation_fault,	SIGSEGV, SEGV_MAPERR,	"level 0 translation fault"	},
	{ do_translation_fault,	SIGSEGV, SEGV_MAPERR,	"level 1 translation fault"	},
	{ do_translation_fault,	SIGSEGV, SEGV_MAPERR,	"level 2 translation fault"	},
	{ do_translation_fault,	SIGSEGV, SEGV_MAPERR,	"level 3 translation fault"	},
	{ do_page_fault,	SIGSEGV, SEGV_ACCERR,	"level 0 access flag fault"	},
	{ do_page_fault,	SIGSEGV, SEGV_ACCERR,	"level 1 access flag fault"	},
	...
```

<!-- [UNIQUE INSIGHT] fault_info[] 分发表是决定后续一切的唯一查找：一个以 ESR 位 [5:0] 为索引的数组，选择处理函数、失败时传递的信号以及 siginfo 的 si_code。阅读这个 36 项的表，是理解内核能为用户进程承担的完整架构异常范围的最快方式。 -->

`do_page_fault` 本身执行 vma 权限检查——它验证出错的访问（读、写或执行）是否与 vma 中记录的权限匹配。如果 vma 缺少所需权限（例如对只读映射的写入），内核传递 `SIGSEGV`。如果权限匹配，则调用 `handle_mm_fault`，它会分派到大页路径或进入 `__handle_mm_fault` 进行标准的多级遍历。

---

## 建立映射：页表遍历

ARM64 使用 4 级页表（PGD、PUD、PMD、PTE），通过消耗虚拟地址的 36 位来将 48 位虚拟地址翻译成物理地址——PGD、PUD、PMD 每级各 9 位，加上最后 PTE 索引的 9 位，低 12 位作为页内偏移。这是缺页处理程序工作的核心：在这四级中填入缺失的项，使 MMU 能完成翻译。下面的走读使用与引言相同的具体地址——`0x0000007000003000`——来展示这些位是如何被消费的。

虚拟地址 `0x0000007000003000` 划分为以下位段：

| 字段 | 位 [63:48] | 位 [47:39] | 位 [38:30] | 位 [29:21] | 位 [20:12] | 位 [11:0] |
|-------|:---:|:---:|:---:|:---:|:---:|:---:|
| 用途 | 符号扩展 | PGD 索引 | PUD 索引 | PMD 索引 | PTE 索引 | 页内偏移 |
| 值 | `0x0000` | `0x00` | `0x70` | `0x00` | `0x03` | `0x000` |

对于 48 位虚拟地址（4 KiB 页、4 级翻译的常见配置），MMU 执行以下遍历。基地址来自 `TTBR0_EL1`。

![ARM64 页表四步遍历过程：从 TTBR0_EL1 到物理页框](/posts/what-happens-after-access-address/images/page_table.png)

**第 1 步 — PGD。** MMU 从 `TTBR0_EL1` 读取 PGD 基地址，用虚拟地址的位 [47:39] 作为索引。PGD 项存储 PUD 表的物理基地址。对于地址 `0x0000007000003000`，PGD 索引是 `0x00`，因此 PUD 基址为 `*(TTBR0_EL1 + 0 * 8)`——即第一个条目。

**第 2 步 — PUD。** MMU 用位 [38:30]（`0x70` = 112）索引 PUD 表。PUD 项存储 PMD 表的基地址。如果该项是一个块描述符（映射一个 1 GiB 大页），遍历在此终止；否则它指向下一级 PMD 表。

**第 3 步 — PMD。** MMU 用位 [29:21]（`0x00`）索引 PMD 表。PMD 项存储 PTE 表的基地址。如果该项是一个块描述符（映射一个 2 MiB 大页），遍历在此终止；否则它指向叶子级的 PTE 表。

**第 4 步 — PTE。** MMU 用位 [20:12]（`0x03`）索引 PTE 表。PTE 项包含物理页框号（位 [47:12]）以及属性和权限位。结合 12 位页内偏移（`0x000`），得到最终的物理地址。

每个页表项为 8 字节（64 位）。低 2 位编码条目类型：`0b11` 表示表描述符（指向下一级），`0b01` 表示块描述符，叶子级的 `0b11` 表示页描述符。叶子 PTE 的位 [47:12] 保存物理页地址。高位（[63:51]）和低位（[11:2]）编码访问标志、权限和内存属性——详见 [ARM 架构手册 DDI 0487](https://developer.arm.com/documentation/ddi0487/latest) 第 D8.3 节。

当缺页异常发生时，内核的 `__handle_mm_fault` 在软件中执行同样的遍历：它调用 `pgd_offset`、`pud_alloc`、`pmd_alloc` 和 `pte_alloc_kernel`（或故障特定变体）来分配任何缺失的级，然后通过 `set_pte_at` 写入最终的 PTE，将物理页地址存入叶子项。之后，MMU 就能在下一次访问时完成翻译。

每个页表项是一个 64 位描述符。表描述符保存下一级表的物理地址；叶子（页）描述符保存物理页框加上属性：

```
        64 位叶子 PTE（第 3 级页描述符，4 KiB 页）
┌────────┬─────────────────────────────────┬───────────────────────────┐
│ 63:52  │ 51                           48 │ 47                     12 │ 11:2   │ 1:0 │
│ 高位   │  忽略                          │  物理页框号                 │ 低位   │     │
│ 属性   │                               │  （输出地址位）              │ 属性   │ 11  │
│        │                               │                            │ AF,AP, │类型 │
│        │                               │                            │ SH,UXN │     │
└────────┴─────────────────────────────────┴───────────────────────────┘
                                                    ▲
                                                    │
                                              位 [47:12]
                                              = MMU 使用的
                                                物理页地址
```

内核通过 `set_pte_at()` 写入该描述符。访问标志（AF，位 10）由硬件在首次访问时设置；权限字段（AP[2:1]，位 [7:6]）控制读/写/用户访问。位级定义的权威来源，见 [ARM 架构手册 DDI 0487](https://developer.arm.com/documentation/ddi0487/latest) 第 D8.3 节。

---

## 超越基本路径：大页与 THP

并非每个缺页都在 PTE 级解决。ARM64 支持**大页**，通过在 PMD 级（2 MiB）或 PUD 级（1 GiB）映射大段连续区域来缩短遍历路径，减少 TLB 压力和遍历延迟。内核从 `handle_mm_fault` 分派这些情况：

```c
vm_fault_t handle_mm_fault(struct vm_area_struct *vma, unsigned long address,
			   unsigned int flags, struct pt_regs *regs)
{
	...
	if (unlikely(is_vm_hugetlb_page(vma)))
		ret = hugetlb_fault(vma->vm_mm, vma, address, flags);
	else
		ret = __handle_mm_fault(vma, address, flags);
	...
}
```

对于专用大页映射（hugetlb），`handle_mm_fault` 直接调用 `hugetlb_fault`，它用自己的页表结构管理 PMD 级或 PUD 级直接指向大页的条目。对于**透明大页（THP）**——内核将普通 4 KiB 页透明地提升为 2 MiB 大页——`__handle_mm_fault` 到达 PMD 级时调用 `create_huge_pmd`：

```c
static inline vm_fault_t create_huge_pmd(struct vm_fault *vmf)
{
	struct vm_area_struct *vma = vmf->vma;
	if (vma_is_anonymous(vma))
		return do_huge_pmd_anonymous_page(vmf);
	if (vma->vm_ops->huge_fault)
		return vma->vm_ops->huge_fault(vmf, PMD_ORDER);
	return VM_FAULT_FALLBACK;
}
```

当 PMD 项是一个块描述符（映射一个 2 MiB 页）时，MMU 完全跳过 PTE 级——虚拟地址的位 [29:0] 直接构成页内偏移，遍历在三次访问而非四次内完成。这从每次翻译中省去了一次内存访问，并使映射保留在单个 TLB 条目中，这就是为什么大页能在 ARM64 上将内存密集型工作负载提升 10–30%（[LWN.net, "Huge pages in the real world"](https://lwn.net/Articles/792094/)）。

```
  4 KiB 页（4 级遍历）               2 MiB 大页（3 级遍历）
  ─────────────────────────          ──────────────────────────────
  VA: [PGD|PUD|PMD|PTE| 偏移 ]       VA: [PGD|PUD|PMD|  偏移   ]
        9   9   9   9    12               9   9   9      21

       ┌─────┐                           ┌─────┐
       │ PGD │                           │ PGD │
       └──┬──┘                           └──┬──┘
          ▼                                  ▼
       ┌─────┐                           ┌─────┐
       │ PUD │                           │ PUD │
       └──┬──┘                           └──┬──┘
          ▼                                  ▼
       ┌─────┐                           ┌─────┐
       │ PMD │                           │ PMD │── 块描述符
       └──┬──┘                           └──┬──┘   (2 MiB 页)
          ▼                                  ▼
       ┌─────┐                        ┌───────────┐
       │ PTE │── 页描述符              │ 2 MiB 物理 │
       └──┬──┘                        └───────────┘
          ▼
       ┌─────┐
       │4 KiB│
       └─────┘
```

---

## PTE 写入之后：TLB 失效

写入 PTE 完成了页表遍历，但在 TLB（转译后备缓冲器）被失效之前，MMU 还看不到这个修复。TLB 缓存最近的翻译，如果不及失效，MMU 会继续使用陈旧的"无映射"条目，在下一次访问时再次缺页。内核在 `set_pte_at` 之后处理这个问题：

```c
// 写入 PTE 之后：
flush_tlb_page(vma, addr);
```

在 ARM64 上，`flush_tlb_page` 编译为 `asm/tlbflush.h` 中的原语，发出一组精确的屏障和失效指令：

```c
static inline void __flush_tlb_page(struct vm_area_struct *vma,
				    unsigned long uaddr, unsigned int flags)
{
	...
	dsb(ishst);           // 确保 PTE 写入可见
	__tlbi(...);          // 失效该地址+ASID 的 TLB 条目
	dsb(nsh);             // 等待失效完成
	isb();                // 同步指令流
}
```

这个顺序至关重要，每条指令都有特定的作用：

```
  CPU 核心                   内存 / MMU              其他核心
  ────────                   ────────────             ───────────
  set_pte_at()                                        
    │ (存储 PTE)                                      
  dsb(ishst)  ─── 屏障 ──▶  PTE 对所有观察者可见      
    │                                                  
  __tlbi(...)  ─── 失效 ──▶  该虚拟地址的 TLB 条目     
    │                         被移除（按 ASID 标记）    
  dsb(nsh)   ─── 等待 ───▶  TLBI 完成                 
    │                                                  
  isb()      ─── 刷新流水线 ──▶  不再使用陈旧的        
                                                    翻译条目
```

`dsb(ishst)`（数据同步屏障，内部可共享，存储到加载）确保 PTE 写入在 TLBI（TLB 失效）指令触发之前到达一致性点。`__tlbi` 指令失效特定地址和 ASID（地址空间 ID，存储在 `TTBR0_EL1` 位 [63:48]）的 TLB 条目。`dsb(nsh)` 等待失效完成，`isb()` 刷新指令流水线，确保不再使用陈旧的翻译。

ASID 是内核避免在每次上下文切换时刷新整个 TLB 的机制。每个进程有唯一的 ASID，TLBI 指令按 ASID 标记失效，因此一个进程的映射在 TLB 中保持有效，而另一个的被失效。这是上下文切换成本有界的机制基础，尽管 TLB 是有限且昂贵的资源。

> **引用说明：** ARM64 的 ASID 是 `TTBR0_EL1` 中的一个 8 位或 16 位字段（可通过 `TCR_EL1.A1` 和内核参数 `vmid_bits` 配置）。当 ASID 回绕时，内核发出一次完整的 TLB 失效并重新分配它们——这一行为记录在 `arch/arm64/include/asm/tlbflush.h` 中，并在 [ARM 架构手册 DDI 0487](https://developer.arm.com/documentation/ddi0487/latest) 第 D8.5 节（"TLB maintenance instructions and the ASID"）中有详细说明。

---

## 常见问题

### ARM64 上的 major fault 和 minor fault 有什么区别？

**minor fault** 完全在内核内存中解决：vma 有效，页表遍历成功，页要么已在页缓存中，要么通过 `do_anonymous_page` 分配一个新鲜的全零页——无需磁盘 I/O。**major fault** 需要从交换区或文件映射读取页（`do_fault` → 磁盘读取）。内核通过 `do_page_fault` 中的 `perf_sw_event(PERF_COUNT_SW_PAGE_FAULTS, ...)` 统计两者（[`fault.c`](https://elixir.bootlin.com/linux/latest/source/arch/arm64/mm/fault.c)）。对于一个刚启动的进程，首次访问任何 mmap 区域都是 minor fault；只有被换出或延迟加载的文件页才会产生 major fault。

### 大页支持如何改变页表遍历？

使用 2 MiB 大页时，PMD 项成为块描述符而非指向 PTE 表的指针。MMU 跳过 PTE 级：虚拟地址的位 [29:0] 直接构成页内偏移，遍历在三次内存访问（PGD→PMD→页）而非四次内完成。使用 1 GiB 大页时，PUD 项是块，遍历只需两步。内核的 `create_huge_pmd` / `hugetlb_fault` 处理分配；ARM 架构手册 DDI 0.3 描述块描述符格式。

### 为什么 mmap 不立即分配物理内存？

按需分页将分配推迟到首次访问，因此大的预留（一种常见模式——`mmap` 预留 1 GiB 区域，只使用 10 MiB）不会浪费物理内存。vma 记录预留及其权限；缺页处理程序仅在进程实际访问该地址时才分配物理页框并关联 PTE。这使得过度提交（overcommit）成为可能，也是 `mmap` 即使在巨大区域上也很快的原因。

### 如果缺页异常无法解决会怎样？

如果 vma 不覆盖故障地址，或访问违反 vma 权限，内核向进程传递 `SIGSEGV`（"Segmentation fault"）。如果地址有效但内存分配失败（OOM），内核的 OOM killer 选择一个进程终止。权限检查在调用 `handle_mm_fault` 之前的 `do_page_fault` 中发生。

---

## 总结

ARM64 上的缺页异常不是错误——它是虚拟内存工作的机制。MMU 触发数据中止，内核的 `el0t_64_sync_handler` 通过 `do_mem_abort` 和 `do_page_fault` 分发到 `handle_mm_fault`，页表遍历填入 PGD→PUD→PMD→PTE 条目，分配物理页框，写入 PTE，然后失效 TLB。从程序的视角看，访问在下一次重试时直接成功。

内核源码在你知道了关键地标后会清晰地讲述这个故事：`arch/arm64/kernel/entry-common.c` 负责异常分发，`arch/arm64/mm/fault.c` 负责 ARM64 特定的处理程序，`mm/memory.c` 负责通用的缺页解决和页表操作，`arch/arm64/include/asm/tlbflush.h` 负责 TLB 失效。配合 [ARM 架构参考手册](https://developer.arm.com/documentation/ddi0487/latest)，这些文件就是 ARM64 如何将一个缺失的翻译转变为有效映射的完整参考。

---

## 参考资料

- ARM Limited, "ARM Architecture Reference Manual for ARMv8-A", DDI 0487, https://developer.arm.com/documentation/ddi0487/latest
- Linux 内核源码, `arch/arm64/mm/fault.c`（do_page_fault, do_translation_fault, fault_info[]）, https://elixir.bootlin.com/linux/latest/source/arch/arm64/mm/fault.c
- Linux 内核源码, `mm/memory.c`（handle_mm_fault, __handle_mm_fault, do_anonymous_page, do_fault）, https://elixir.bootlin.com/linux/latest/source/mm/memory.c
- Linux 内核源码, `arch/arm64/kernel/entry-common.c`（el0t_64_sync_handler, el0_da, el0_ia）, https://elixir.bootlin.com/linux/latest/source/arch/arm64/kernel/entry-common.c
- Linux 内核源码, `arch/arm64/include/asm/tlbflush.h`（flush_tlb_page, __flush_tlb_page）, https://elixir.bootlin.com/linux/latest/source/arch/arm64/include/asm/tlbflush.h
- Linux 内核源码, `arch/arm64/kernel/entry.S`（kernel_ventry, 异常向量表）, https://elixir.bootlin.com/linux/latest/source/arch/arm64/kernel/entry.S
- Robert Love,《Linux 内核开发》, 第 3 版, Addison-Wesley, 2010, 第 15 章（进程地址空间）
- Jonathan Corbet, "Huge pages in the real world", LWN.net, 2019, https://lwn.net/Articles/792094/
- Linux 内核源码, `mm/hugetlb.c`（hugetlb_fault）, https://elixir.bootlin.com/linux/latest/source/mm/hugetlb.c
