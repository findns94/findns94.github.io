---
title: The Page Fault Process After Address Access in Arm-Linux
date: 2021-02-21 19:34:02
tags: [OS, Memory, Linux]
categories: [Engineering]
---


# Address Access Example

Taking the access to the user-space **virtual address** 0x0000007000003000 as an example, consider the following code.

```C
#include <sys/mman.h>
#include <stdio.h>

int main()
{
    unsigned long long *x = (unsigned long long)0x0000007000003000;
    int *p = (int*)mmap(0x0000007000003000, sizeof(unsigned long long) * 10, PROT_READ | PROT_WRITE, MAP_SHARED | MAP_ANONYMOUS, -1, 0);
    printf("before write, x = %llu\n", *x);
    *x = 1;
    printf("after write,  x = %llu\n", *x);
}
```

If the user-space virtual address `0x0000007000003000` is not mapped in advance via mmap with read and write permissions, a `Segmentation fault (core dumped)` will occur, because `0x0000007000003000` is not managed as a vma (virtual memory area) allocated through mmap or brk in the process's virtual address space, and thus the virtual address is not accessible at this point. The output after compilation is as follows.

```
before write, x = 0
after write,  x = 1
```

As can be seen, a new value was successfully written to the user-space virtual address `0x0000007000003000`.

<!-- more -->

# What Happens After Accessing an Address

After performing mmap on the virtual address `0x0000007000003000`, from the process's perspective, a vma has been established to manage the address, but at this point no actual physical address has been associated with this virtual address yet. This association is achieved through a **page fault**.

Let me introduce the MMU (Memory Management Unit) hardware that is now commonly integrated inside the CPU. Its role is to translate from VA (virtual address) to PA (physical address). The translation process can be simply understood as `PA=MMU(VA)` or `PA=page_table(VA)`. Currently, MMUs basically complete the address translation process through multi-level page tables. After mmap maps a virtual address, the page table establishment process has not yet occurred, so when the CPU attempts to access the virtual address `0x0000007000003000`, its MMU cannot find the corresponding physical address through the page table.

In short, the essence of the page fault process is to tell the MMU how to access the corresponding physical address through the page table after receiving a virtual address as input.

# The Page Fault Process

The current process is at EL0 exception level, and the base address of the page table is stored in the `TTBR0_EL1` register. Note that `TTBR0_EL1` holds a physical address, which is precisely the base address of the PGD page table for the user-space address space of this process. The relative offsets of other PGD page tables within this address space (i.e., `pgd_offset(mm,addr)`) are all calculated based on the physical address stored in `TTBR0_EL1`.

During the execution of the `printf("before write, x = %llu\n", *x)` code, an access to the content at virtual address `0x0000007000003000` triggers a page fault exception (such as a data abort or instruction abort), which is caught by the exception vector table. The process then enters the page table establishment flow through the pre-registered page fault exception handler functions. The assembly code for exception handling can be found in `arch\arm64\kernel\entry.S`, and a code snippet is shown below.

```armasm
el0_da:
	/*
	 * Data abort handling
	 */
	mrs	x26, far_el1
	enable_daif
	ct_user_exit
	clear_address_tag x0, x26
	mov	x1, x25
	mov	x2, sp
	bl	do_mem_abort
	b	ret_to_user
el0_ia:
	/*
	 * Instruction abort handling
	 */
	mrs	x26, far_el1
	enable_da_f
#ifdef CONFIG_TRACE_IRQFLAGS
	bl	trace_hardirqs_off
#endif
	ct_user_exit
	mov	x0, x26
	mov	x1, x25
	mov	x2, sp
	bl	do_el0_ia_bp_hardening
	b	ret_to_user
```

As can be seen, for a data abort (e.g., accessing a variable), the `do_mem_abort` function handles it, and for an instruction abort (e.g., executing code at a certain address in the code segment), the `do_el0_ia_bp_hardening` function handles it. Subsequently, the registered handler within `fault_info` performs page fault handling for the specific virtual address, with corresponding functions `do_translation_fault` and `do_page_fault`. The relevant code is located at `arch\arm64\mm\fault.c`.

The logic after entering `__do_page_fault` is basically similar to the traditional cascading page table establishment process. The main operations during this process include setting the appropriate permissions based on the vma where the address resides, and sequentially establishing pgd\pud\pmd\pte page tables. Finally, the process reaches the anonymous page fault logic `do_anonymous_page` and the file page fault logic `do_fault`, where appropriate pages for storing data are allocated through kernel memory allocation interfaces such as `alloc_pages` from the physical memory managed by the buddy allocator or slab allocator. Finally, `set_pte_at` sets the address of the allocated page into the content of the corresponding pte entry, completing the entire page fault process. In addition to the page address stored in the pte entry, there are also upper attributes and lower attributes used to indicate some permission and flag bits. For details, please refer to the chapter on the virtual address hierarchy in the [Arm official manual](https://developer.arm.com/documentation/ddi0487/latest). Finally, the saved context is restored, and execution returns to the location where the page fault occurred.

# The Page Table Access Process

Taking a three-level page table access as an example, the virtual address 0x0000007000003000 is divided by bits in the following table:

|0x0000|0x0070|0x0000|0x3000|
|:---:|:---:|:---:|:---:|
|<p style="text-align:left;">63<span style="float:right;">48</span></p>|<p style="text-align:left;">47<span style="float:right;">32</span></p>|<p style="text-align:left;">31<span style="float:right;">16</span></p>|<p style="text-align:left;">15<span style="float:right;">0</span></p>|
|0000 0000 0000 0000|0000 0000 0111 0000|0000 0000 0000 0000|0011 0000 0000 0000|

The result of the address division by page table for address calculation is shown in the following table:

|ttbr-sensitive|pgd|pmd|pte|offset|
|:---:|:---:|:---:|:---:|:---:|
|<p style="text-align:left;">63<span style="float:right;">39</span></p>|<p style="text-align:left;">38<span style="float:right;">30</span></p>|<p style="text-align:left;">29<span style="float:right;">21</span></p>|<p style="text-align:left;">20<span style="float:right;">12</span></p>|<p style="text-align:left;">11<span style="float:right;">0</span></p>|
|0000 0000 0000 0000 0000 0|000 0111 00|00 0000 000|0 0000 0011|0000 0000 0000|
|The row shows the result after appending three trailing 0s|0xE0|0x0|0x18|0x0|

Based on the address calculation process at each level shown in the diagram below, the address calculation process will be briefly explained.

![four steps](/posts/what-happens-after-access-address/images/page_table.png)

First, based on the TTBR0-EL1 register, the base address $addr_0$ of the process's pgd page table is obtained, and a bitwise OR is performed with the offset corresponding to the pgd page table, i.e.

$$addr_{pgd} = addr_0\ |\ 0x18$$

Here, the $addr_{pgd}$ address is the pgd entry for this address, which stores the base address $addr_1=*addr_{pgd}$ of the pmd entry pointed to by the pgd entry.

Accessing the content at the physical address $addr_1$ yields $addr_2$ (corresponding to the level 1 table descriptor), i.e. $addr_2 = *addr_1$. The trailing 0b11 of $addr_2$ indicates that the page table size is 4K. Different trailing bits represent different page table sizes, and the corresponding offset is 0, so the position of the pmd page table is

$$addr_{pmd} = addr_{2}\ \&\ 0b00\ |\ 0x0$$

Accessing the $addr_{pmd}$ address yields $addr_3$ (corresponding to the level 2 table descriptor), i.e. $addr_3 = *addr_2$. It can be seen that the offset corresponding to the pte is 0x18, so after removing the trailing 0b11 and performing a bitwise OR with the offset, the position of the pte page table can be calculated as

$$addr_{pte} = addr_{3}\ \&\ 0b00\ |\ 0x18$$

The corresponding pte content is $addr_4 = *addr_{pte}$. Since the last 12 bits of the virtual address are all 0, the content in $addr_4$ at the corresponding [47:12] bits is the address of the physical page. Therefore, the final physical address of the page is

$$addr_{page} = addr_4[47:0]\ \&\ 0x000$$

At this point, through the content stored at the physical address $addr_{page}$, i.e. $*addr_{page}$, the content stored at virtual address 0x0000007000003000 can be found.

# References

[1] https://www.cnblogs.com/LoyenWang/p/11406693.html

[2] https://armv8-ref.codingbelief.com/zh/
