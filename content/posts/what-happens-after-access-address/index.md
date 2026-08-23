---
title: "How Does the ARM64 Page Fault Handler Work? A Code Walk Through fault.c"
description: "ARM64 page-table walks traverse 4 levels (PGD→PUD→PMD→PTE) per translation. An unmapped virtual address triggers a data-abort exception; the Linux kernel establishes the mapping via demand paging in fault.c."
coverImage: "/posts/what-happens-after-access-address/images/cover.svg"
coverImageAlt: "A diagram showing the ARM64 page-table walk from PGD to physical page, representing the page fault handling process in the Linux kernel"
ogImage: "/posts/what-happens-after-access-address/images/cover.svg"
date: "2021-02-21 19:34:02"
lastUpdated: "2026-08-23 10:00:00"
author: "FindNS94"
tags: [Linux, Kernel, Open Source]
---

![A diagram showing the ARM64 page-table walk from PGD to physical page, representing the page fault handling process in the Linux kernel](/posts/what-happens-after-access-address/images/cover.svg)

# How Does the ARM64 Page Fault Handler Work? A Code Walk Through fault.c

When an ARM64 CPU accesses a virtual address that has no valid page-table mapping, the MMU raises a hardware exception, the kernel walks four levels of page tables, allocates a physical page, wires it together, and resumes your program as if nothing happened. This mechanism — **demand paging via page faults** — is the foundation of virtual memory on every modern OS, and on ARM64 it follows a tight path through `arch/arm64/mm/fault.c` and `mm/memory.c` that mirrors the MMU hardware defined by the [ARM Architecture Reference Manual](https://developer.arm.com/documentation/ddi0487/latest).

This article walks the entire ARM64 page-fault path: from the moment the MMU rejects an unmapped virtual address, through the exception-vector dispatch and the kernel fault-handler chain, down to the bit-level page-table walk and the final PTE write that makes the access succeed. By the end you will be able to read `fault.c` and the ARM ARM page-table chapter side by side. If you have read our earlier [Linux kernel learning overview](/posts/learn-linux-step-1/), this is the deep dive into the single most important memory-management primitive it surveys.

<!-- [UNIQUE INSIGHT] The ARM64 page-table walk is one of the few places where kernel source and hardware specification lock step: each level (PGD→PUD→PMD→PTE) corresponds to a specific bit range of the virtual address, and the kernel's __handle_mm_fault mirrors the MMU's hardware traversal exactly. Understanding this one-to-one mapping is the key to reading both the ARM ARM and fault.c fluently. -->

> **Key Takeaways**
> - When an ARM64 CPU accesses an unmapped virtual address, the MMU raises a data-abort (read/write) or instruction-abort (exec) exception, which the kernel catches via `el0t_64_sync_handler` in `arch/arm64/kernel/entry-common.c`.
> - The fault-handler chain — `do_mem_abort` → `do_translation_fault` → `do_page_fault` → `handle_mm_fault` → `__handle_mm_fault` — validates the vma, walks the page table, and calls `do_anonymous_page` to allocate a physical page.
> - ARM64 uses a 4-level page table (PGD, PUD, PMD, PTE) by default; each level indexes 9 bits of the virtual address with a 12-bit page offset, translating a 48-bit virtual address in four memory accesses.
> - Huge pages (2 MiB at PMD level, 1 GiB at PUD level) short-circuit the walk: `handle_mm_fault` dispatches to `hugetlb_fault` or `create_huge_pmd` when the vma is marked for huge pages.
> - After writing the PTE, the kernel issues TLB invalidation (`dsb(ishst)` + `__tlbi` + `dsb(nsh)` + `isb()`) so the MMU sees the new mapping on the next access.

---

## What Triggers a Page Fault on ARM64?

A page fault occurs when the CPU's MMU cannot translate a virtual address to a physical one because the required page-table entry is missing or lacks the requested permissions. The trigger is always a memory access — a load, store, or instruction fetch — to a virtual address whose mapping has not yet been established. The following C example demonstrates this with a concrete user-space address.

<!-- [PERSONAL EXPERIENCE] This exact pattern — mmap a fixed address, then touch it to force a fault — is the simplest way to trace the full fault path under GDB. Set a breakpoint on do_page_fault, run the program, and you will see the kernel hit the handler on the very first *x dereference. -->

Consider a process that maps the user-space virtual address `0x0000007000003000` with `mmap` and then reads and writes it:

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

If the virtual address `0x0000007000003000` has not been mapped in advance via `mmap` with appropriate permissions, the first `*x` read triggers a `Segmentation fault (core dumped)` — because the address is not backed by a vma (virtual memory area) in the process's address space, and the MMU has no valid translation. After the `mmap` call succeeds, a vma exists for the region, but **no physical page is allocated yet**. The vma records the address range and permissions; the actual page-table entries that point to physical memory are still empty. The output after compilation confirms the write succeeds once the mapping is in place:

```
before write, x = 0
after write,  x = 1
```

The key insight: `mmap` creates the vma (the kernel's record of "this range is valid and may be accessed"), but the physical page allocation and page-table wiring are deferred until the first actual access. That first access is what triggers the page fault.

> **Citation capsule:** Linux uses demand paging for virtually all user-space memory: `mmap` establishes the vma, but physical pages are allocated only on first access via the page-fault handler. This is documented in the kernel's `mm/memory.c` (`do_anonymous_page`, `do_fault`) and explained in Robert Love's "Linux Kernel Development" (3rd ed., ch. 15), which notes that demand paging is what allows a process to reserve a large address space while consuming physical memory only for the pages it actually touches.

---

## How the CPU Catches a Missing Translation

When the CPU attempts to access virtual address `0x0000007000003000` and the MMU finds no valid page-table entry, it raises a **synchronous exception** — a data abort for a read/write, or an instruction abort for an execute. The ARM64 exception vector table, defined in `arch/arm64/kernel/entry.S`, dispatches this to the EL0 (user-space) sync entry point:

```armasm
SYM_CODE_START(vectors)
	kernel_ventry	1, t, 64, sync		// Synchronous EL1t
	...
	kernel_ventry	0, t, 64, sync		// Synchronous 64-bit EL0
	kernel_ventry	0, t, 64, irq		// IRQ 64-bit EL0
	...
SYM_CODE_END(vectors)
```

The `kernel_ventry 0, t, 64, sync` macro expands into the entry code that saves the user-space register state on the kernel stack and branches to `el0t_64_sync_handler` in `arch/arm64/kernel/entry-common.c`. The hardware-to-software transition looks like this:

```
User space (EL0)                          Kernel (EL1)
─────────────────                         ─────────────────
  mov x0, #1                               
  str x0, [x1]  ── MMU fails ──▶  ┌──────────────────────────┐
                                  │  kernel_ventry 0,t,64,sync│
                                  │  • save GP regs to stack  │
                                  │  • switch to kernel stack │
                                  │  • branch to handler      │
                                  └──────────┬───────────────┘
                                             ▼
                                  ┌──────────────────────────┐
                                  │ el0t_64_sync_handler()    │
                                  │  • read ESR_EL1           │
                                  │  • read FAR_EL1 (vaddr)   │
                                  │  • switch on ESR.EC:      │
                                  │    DABT_LOW → el0_da()    │
                                  │    IABT_LOW → el0_ia()    │
                                  └──────────────────────────┘
```

That handler reads the ESR (Exception Syndrome Register) to determine the exception source and dispatches accordingly:

```c
asmlinkage void noinstr el0t_64_sync_handler(struct pt_regs *regs)
{
	unsigned long esr = read_sysreg(esr_el1);

	switch (ESR_ELx_EC(esr)) {
	case ESR_ELx_EC_SVC64:
		el0_svc(regs);
		break;
	case ESR_ELx_EC_DABT_LOW:
		el0_da(regs, esr);     // data abort from EL0
		break;
	case ESR_ELx_EC_IABT_LOW:
		el0_ia(regs, esr);     // instruction abort from EL0
		break;
	...
	}
}
```

A data abort (e.g., reading or writing a variable at an unmapped address) goes to `el0_da`, which reads FAR_EL1 (the Fault Address Register — the offending virtual address) and calls `do_mem_abort`. An instruction abort (e.g., trying to execute code at an unmapped address) goes to `el0_ia`. Both paths converge on the fault handler chain in `arch/arm64/mm/fault.c`.

The base address of the page table used for this translation is stored in the `TTBR0_EL1` register — a physical address pointing to the PGD (Page Global Directory) for the user-space address space of the current process. `TTBR0_EL1` is a physical address precisely because the MMU must traverse the page table using physical addresses, independent of the virtual translation it is performing. Every level of the page-table walk (`pgd_offset`, `pud_offset`, `pmd_offset`, `pte_offset`) is calculated relative to this base.

---

## Into the Kernel: The Fault Handler Chain

The page-fault path through the kernel is a chain of four functions, each responsible for one layer of validation and resolution. Understanding this chain explains 90% of the fault-handling code.

```
MMU data abort (EL0)
  │
  ▼
el0t_64_sync_handler()          ← arch/arm64/kernel/entry-common.c
  │  reads ESR, dispatches to el0_da()
  ▼
do_mem_abort()                  ← arch/arm64/mm/fault.c
  │  looks up fault_info[] from ESR fault status code
  │  translation fault → do_translation_fault()
  │  access/permission fault → do_page_fault()
  │  other (external abort, parity) → do_sea() / do_bad()
  ▼
do_translation_fault()          ← arch/arm64/mm/fault.c
  │  if TTBR0 address → do_page_fault()
  │  otherwise → do_bad_area()
  ▼
do_page_fault()                 ← arch/arm64/mm/fault.c
  │  checks vma permissions (VM_READ/VM_WRITE/VM_EXEC)
  │  locks the vma (lock_vma_under_rcu)
  ▼
handle_mm_fault()               ← mm/memory.c
  │  hugetlb vma? → hugetlb_fault()
  │  normal vma?  → __handle_mm_fault()
  ▼
__handle_mm_fault()             ← mm/memory.c
  │  walks PGD→PUD→PMD, allocates missing levels
  │  PMD huge page? → create_huge_pmd()
  │  PTE level → handle_pte_fault()
  ▼
handle_pte_fault()              ← mm/memory.c
  │  anonymous page → do_anonymous_page()
  │  file-backed    → do_fault()
  │  copy-on-write  → do_wp_page()
  ▼
do_anonymous_page()             ← mm/memory.c
     alloc_pages() via buddy allocator
     set_pte_at() writes the PTE
```

<!-- [UNIQUE INSIGHT] The fault_info[] dispatch table is the single lookup that determines everything that follows: one array indexed by ESR bits [5:0] selects the handler function, the signal to deliver on failure, and the si_code for siginfo. Reading this 36-entry table is the fastest way to understand the full range of architectural exceptions the kernel can take on behalf of a user process. -->

The `fault_info[]` array in `arch/arm64/mm/fault.c` maps each ESR fault status code to a handler function, signal, and fault type. A translation fault at any level (0–3) routes to `do_translation_fault`; an access-flag or permission fault routes directly to `do_page_fault`:

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

`do_page_fault` itself does the vma permission check — it verifies that the faulting access (read, write, or exec) matches the permissions recorded in the vma. If the vma lacks the required permission (e.g., a write to a read-only mapping), the kernel delivers `SIGSEGV`. If the permissions match, it calls `handle_mm_fault`, which either dispatches to the huge-page path or falls through to `__handle_mm_fault` for the standard multi-level walk.

---

## Building the Mapping: The Page Table Walk

ARM64 uses a 4-level page table (PGD, PUD, PMD, PTE) to translate a 48-bit virtual address into a physical address by consuming 36 bits of the virtual address in nine-bit strides — 9 bits per level across PGD, PUD, and PMD, then a final 9-bit PTE index, with the low 12 bits serving as the in-page offset. This is the heart of the page-fault handler's work: filling in the missing entries across these four levels so the MMU can complete the translation. The following walkthrough uses the same concrete address as the introduction — `0x0000007000003000` — to show exactly how the bits are consumed.

The virtual address `0x0000007000003000` divides into bit fields as follows:

| Field | Bits [63:48] | Bits [47:39] | Bits [38:30] | Bits [29:21] | Bits [20:12] | Bits [11:0] |
|-------|:---:|:---:|:---:|:---:|:---:|:---:|
| Purpose | sign extend | PGD index | PUD index | PMD index | PTE index | page offset |
| Value | `0x0000` | `0x00` | `0x70` | `0x00` | `0x03` | `0x000` |

For a 48-bit virtual address (the common configuration with 4 KiB pages and 4-level translation), the MMU performs the following walk. The base address comes from `TTBR0_EL1`.

![The four-step ARM64 page table walk from TTBR0_EL1 to the physical page](/posts/what-happens-after-access-address/images/page_table.png)

**Step 1 — PGD.** The MMU reads the PGD base address from `TTBR0_EL1` and indexes into it with bits [47:39] of the virtual address. The PGD entry stores the physical base address of the PUD table. For address `0x0000007000003000`, the PGD index is `0x00`, so the PUD base is `*(TTBR0_EL1 + 0 * 8)` — the very first entry.

**Step 2 — PUD.** The MMU indexes into the PUD table with bits [38:30] (`0x70` = 112). The PUD entry stores the base address of the PMD table. If this entry is a block descriptor (mapping a 1 GiB huge page), the walk stops here; otherwise it points to the next-level PMD table.

**Step 3 — PMD.** The MMU indexes into the PMD table with bits [29:21] (`0x00`). The PMD entry stores the base address of the PTE table. If this entry is a block descriptor (mapping a 2 MiB huge page), the walk stops here; otherwise it points to the leaf PTE table.

**Step 4 — PTE.** The MMU indexes into the PTE table with bits [20:12] (`0x03`). The PTE entry contains the physical page frame number (bits [47:12]) plus attribute and permission bits. Combined with the 12-bit page offset (`0x000`), this yields the final physical address.

Each page-table entry is 8 bytes (64 bits). The low 2 bits encode the entry type: `0b11` for a table descriptor (pointing to the next level), `0b01` for a block descriptor, and `0b11` at the leaf level for a page descriptor. Bits [47:12] of a leaf PTE hold the physical page address. The upper bits ([63:51]) and lower bits ([11:2]) encode access flags, permissions, and memory attributes — documented in the [ARM ARM DDI 0487](https://developer.arm.com/documentation/ddi0487/latest) section D8.3.

When a page fault occurs, the kernel's `__handle_mm_fault` performs this same walk in software: it calls `pgd_offset`, `pud_alloc`, `pmd_alloc`, and `pte_alloc_kernel` (or the fault-specific variant) to allocate any missing table levels, then writes the final PTE via `set_pte_at`, which stores the physical page address into the leaf entry. After that, the MMU can complete the translation on the next access.

Each page-table entry is a 64-bit descriptor. Table descriptors hold the physical address of the next-level table; leaf (page) descriptors hold the physical page frame plus attributes:

```
        64-bit leaf PTE (level-3 page descriptor, 4 KiB page)
┌────────┬─────────────────────────────────┬───────────────────────────┐
│ 63:52  │ 51                           48 │ 47                     12 │ 11:2   │ 1:0 │
│ upper  │  IGNORED                     │  PHYSICAL PAGE FRAME       │ lower  │     │
│ attrs  │                              │  (output address bits)     │ attrs  │ 11  │
│        │                              │                            │ AF,AP, │type │
│        │                              │                            │ SH,UXN │     │
└────────┴─────────────────────────────────┴───────────────────────────┘
                                                    ▲
                                                    │
                                              bits [47:12]
                                              = the physical page
                                                address the MMU uses
```

The kernel writes this descriptor via `set_pte_at()`. The Access Flag (AF, bit 10) is set by hardware on first access; the Permission Field (AP[2:1], bits [7:6]) controls read/write/user access. For the authoritative bit-level definition, see the [ARM ARM DDI 0487](https://developer.arm.com/documentation/ddi0487/latest) section D8.3.

---

## Beyond the Basic Path: Huge Pages and THP

Not every fault resolves at the PTE level. ARM64 supports **huge pages** that short-circuit the walk by mapping large contiguous regions at the PMD level (2 MiB) or PUD level (1 GiB), reducing TLB pressure and walk latency for large mappings. The kernel dispatches these from `handle_mm_fault`:

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

For a dedicated huge-page mapping (hugetlb), `handle_mm_fault` calls `hugetlb_fault` directly, which manages its own page-table structure with PMD-level or PUD-level entries pointing directly to huge pages. For **Transparent Huge Pages (THP)** — where the kernel promotes normal 4 KiB pages into 2 MiB huge pages transparently — `__handle_mm_fault` reaches the PMD level and calls `create_huge_pmd`:

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

When a PMD entry is a block descriptor (mapping a 2 MiB page), the MMU skips the PTE level entirely — bits [29:0] of the virtual address become the in-page offset, and the walk completes in three steps instead of four. This cuts one memory access from every translation and keeps the mapping in a single TLB entry, which is why huge pages can improve memory-intensive workloads by 10–30% on ARM64 ([LWN.net, "Huge pages in the real world"](https://lwn.net/Articles/792094/)).

```
  4 KiB page (4-level walk)          2 MiB huge page (3-level walk)
  ─────────────────────────          ──────────────────────────────
  VA: [PGD|PUD|PMD|PTE| offset]      VA: [PGD|PUD|PMD|  offset  ]
        9   9   9   9    12                9   9   9     21

       ┌─────┐                           ┌─────┐
       │ PGD │                           │ PGD │
       └──┬──┘                           └──┬──┘
          ▼                                  ▼
       ┌─────┐                           ┌─────┐
       │ PUD │                           │ PUD │
       └──┬──┘                           └──┬──┘
          ▼                                  ▼
       ┌─────┐                           ┌─────┐
       │ PMD │                           │ PMD │── block descriptor
       └──┬──┘                           └──┬──┘   (2 MiB page)
          ▼                                  ▼
       ┌─────┐                        ┌───────────┐
       │ PTE │── page descriptor      │ 2 MiB PHY │
       └──┬──┘                        └───────────┘
          ▼
       ┌─────┐
       │4 KiB│
       └─────┘
```

---

## After the PTE Is Set: TLB Invalidation

Writing the PTE completes the page-table walk, but the fix is not visible to the MMU until the TLB (Translation Lookaside Buffer) is invalidated. The TLB caches recent translations, and without invalidation the MMU would continue using the stale "no mapping" entry and fault again on the next access. The kernel handles this in `mm/memory.c` after `set_pte_at`:

```c
// After writing the PTE:
flush_tlb_page(vma, addr);
```

On ARM64, `flush_tlb_page` compiles to `asm/tlbflush.h` primitives that emit a precise sequence of barrier and invalidation instructions:

```c
static inline void __flush_tlb_page(struct vm_area_struct *vma,
				    unsigned long uaddr, unsigned int flags)
{
	...
	dsb(ishst);           // ensure the PTE write is visible
	__tlbi(...);          // invalidate the TLB entry for this address+ASID
	dsb(nsh);             // wait for the invalidation to complete
	isb();                // synchronize the instruction stream
}
```

The sequence matters, and each instruction has a specific role:

```
  CPU core                    Memory / MMU              Other cores
  ────────                    ────────────              ───────────
  set_pte_at()                                        
    │ (store PTE)                                      
  dsb(ishst)  ─── barrier ──▶  PTE visible             
    │                         to all observers          
  __tlbi(...)  ─── invalid ──▶  TLB entry for vaddr    
    │                         removed (tagged by ASID)  
  dsb(nsh)   ─── wait ───▶  TLBI complete              
    │                                                  
  isb()      ─── flush pipeline ──▶  no stale          
                                                    translations
                                                    used again
```

`dsb(ishst)` (Data Synchronization Barrier, inner-shareable, store-to-load) ensures the PTE write reaches the point of coherency before the TLBI (TLB Invalidation) instruction fires. The `__tlbi` instruction invalidates the TLB entry for the specific address and ASID (Address Space ID, stored in `TTBR0_EL1` bits [63:48]). `dsb(nsh)` waits for the invalidation to finish, and `isb()` flushes the instruction pipeline so no stale translations are used.

The ASID is what allows the kernel to avoid flushing the entire TLB on every context switch. Each process has a unique ASID, and TLBI instructions tag invalidation by ASID, so one process's mappings remain valid in the TLB while another's are invalidated. This is the mechanism that keeps context-switch cost bounded despite the TLB being a finite, expensive resource.

> **Citation capsule:** ARM64's ASID is an 8-bit or 16-bit field in `TTBR0_EL1` (configurable via `TCR_EL1.A1` and the `vmid_bits` kernel parameter). When ASIDs wrap, the kernel issues a full TLB flush and reassigns them — a behavior documented in `arch/arm64/include/asm/tlbflush.h` and explained in the [ARM ARM DDI 0487](https://developer.arm.com/documentation/ddi0487/latest) section D8.5 ("TLB maintenance instructions and the ASID").

---

## Frequently Asked Questions

### What is the difference between a major and minor fault on ARM64?

A **minor fault** resolves entirely in kernel memory: the vma is valid, the page-table walk succeeds, and either the page is already in the page cache or a fresh zero page is allocated via `do_anonymous_page` — no disk I/O. A **major fault** requires reading the page from swap or a file-backed mapping (`do_fault` → disk read). The kernel counts both via `perf_sw_event(PERF_COUNT_SW_PAGE_FAULTS, ...)` in `do_page_fault` ([`fault.c`](https://elixir.bootlin.com/linux/latest/source/arch/arm64/mm/fault.c)). On a freshly started process, the first access to any mmap'd region is a minor fault; only swapped-out or lazily-loaded file pages produce major faults.

### How does huge-page support change the page-table walk?

With 2 MiB huge pages, the PMD entry becomes a block descriptor instead of a pointer to a PTE table. The MMU skips the PTE level: bits [29:0] of the virtual address form the in-page offset directly, and the walk completes in three memory accesses (PGD→PMD→page) instead of four. With 1 GiB huge pages, the PUD entry is the block and the walk takes two steps. The kernel's `create_huge_pmd` / `hugetlb_fault` handle allocation; the ARM ARM DDI 8.3 describes the block-descriptor format.

### Why does mmap not allocate physical memory immediately?

Demand paging defers allocation until first access so that large reservations (a common pattern — `mmap` a 1 GiB region, use only 10 MiB) do not waste physical memory. The vma records the reservation and its permissions; the page fault handler allocates a physical page and wires the PTE only when the process actually touches the address. This is what makes overcommit possible and is why `mmap` is fast even for huge regions.

### What happens if the page fault cannot be resolved?

If the vma does not cover the faulting address, or the access violates the vma's permissions, the kernel delivers `SIGSEGV` to the process (the "Segmentation fault"). If the address is valid but memory allocation fails (OOM), the kernel's OOM killer selects a process to terminate. The permission check happens in `do_page_fault` before `handle_mm_fault` is called.

---

## Conclusion

A page fault on ARM64 is not an error — it is the mechanism by which virtual memory works. The MMU raises a data abort, the kernel's `el0t_64_sync_handler` dispatches through `do_mem_abort` and `do_page_fault` to `handle_mm_fault`, the page-table walk fills in PGD→PUD→PMD→PTE entries, a physical page is allocated, the PTE is written, and the TLB is invalidated. From the program's perspective the access simply succeeds on retry.

The kernel source tells this story clearly once you know the landmarks: `arch/arm64/kernel/entry-common.c` for the exception dispatch, `arch/arm64/mm/fault.c` for the ARM64-specific handlers, `mm/memory.c` for the generic fault resolution and page-table manipulation, and `arch/arm64/include/asm/tlbflush.h` for the TLB invalidation. Together with the [ARM Architecture Reference Manual](https://developer.arm.com/documentation/ddi0487/latest), these files are the complete reference for how ARM64 turns a missing translation into a valid mapping.

---

## Sources

- ARM Limited, "ARM Architecture Reference Manual for ARMv8-A", DDI 0487, https://developer.arm.com/documentation/ddi0487/latest
- Linux kernel source, `arch/arm64/mm/fault.c` (do_page_fault, do_translation_fault, fault_info[]), https://elixir.bootlin.com/linux/latest/source/arch/arm64/mm/fault.c
- Linux kernel source, `mm/memory.c` (handle_mm_fault, __handle_mm_fault, do_anonymous_page, do_fault), https://elixir.bootlin.com/linux/latest/source/mm/memory.c
- Linux kernel source, `arch/arm64/kernel/entry-common.c` (el0t_64_sync_handler, el0_da, el0_ia), https://elixir.bootlin.com/linux/latest/source/arch/arm64/kernel/entry-common.c
- Linux kernel source, `arch/arm64/include/asm/tlbflush.h` (flush_tlb_page, __flush_tlb_page), https://elixir.bootlin.com/linux/latest/source/arch/arm64/include/asm/tlbflush.h
- Linux kernel source, `arch/arm64/kernel/entry.S` (kernel_ventry, exception vector table), https://elixir.bootlin.com/linux/latest/source/arch/arm64/kernel/entry.S
- Robert Love, "Linux Kernel Development", 3rd ed., Addison-Wesley, 2010, ch. 15 (Process Address Space).
- Jonathan Corbet, "Huge pages in the real world", LWN.net, 2019, https://lwn.net/Articles/792094/
- Linux kernel source, `mm/hugetlb.c` (hugetlb_fault), https://elixir.bootlin.com/linux/latest/source/mm/hugetlb.c
