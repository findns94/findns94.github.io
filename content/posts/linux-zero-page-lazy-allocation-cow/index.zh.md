---
title: "mmap 匿名内存时发生了什么？——零页魔法、延迟分配与写时复制"
description: "mmap 匿名内存并不立即分配物理页。内核对读使用全局零页，首次写时触发页错误分配真实页，fork 后通过写时复制共享页。深入分析 mm/memory.c 源码揭示延迟分配与 COW 机制。"
coverImage: "/posts/linux-zero-page-lazy-allocation-cow/images/cover.jpg"
coverImageAlt: "屏幕上显示错误消息，代表 Linux 内核的零页机制——在匿名映射中延迟物理分配直到首次写入"
ogImage: "/posts/linux-zero-page-lazy-allocation-cow/images/cover.jpg"
date: "2026-09-06 00:30:00"
lastUpdated: "2026-09-06 00:30:00"
author: "FindNS94"
tags: ["Linux", "Kernel", "Memory Management"]
---

![屏幕上显示错误消息，代表 Linux 内核的零页机制——在匿名映射中延迟物理分配直到首次写入](/posts/linux-zero-page-lazy-allocation-cow/images/cover.jpg)

# mmap 匿名内存时发生了什么？——零页魔法、延迟分配与写时复制

每个 C 开发者都调用过 `mmap(NULL, size, PROT_READ|PROT_WRITE, MAP_PRIVATE|MAP_ANONYMOUS, -1, 0)`。心智模型很简单：请求内存，获得内存，使用内存。但内核实际发生的事情要微妙得多。

当你 mmap 匿名内存时，内核不分配物理页。它记录一个 VMA (Virtual Memory Area) 并返回。当你首次读取那块内存时，你得到的是全局零页 — 一个所有零填充映射共享的单物理页 (page 0)。当你首次写入时，内核才终于分配一个真正的物理页。而当你 fork 时，父进程和子进程共享相同的页直到任一方写入 —— 触发复制。

本文通过分析 `mm/memory.c` 中的页错误处理程序来解释使匿名内存高效的三种机制：零页技巧、延迟分配和写时复制。

<!-- [UNIQUE INSIGHT] 零页是 Linux 最优雅的优化之一。一个单物理页 (page 0，物理内存的前 4 KB) 被只读映射到每个零填充的匿名映射中。这意味着一个 mmap 了 1 GB 匿名内存但只读取它的进程只消耗 exactly 4 KB 物理 RAM (一个页表页)。"1 GB 分配"是虚拟的 —— 在进程实际写入之前不花费任何成本。这就是为什么 Linux 可以过度分配内存：大多数分配的内存从未被触及。 -->

<!-- more -->

> **核心要点**
> - mmap 匿名内存不分配物理页 — 它只创建 VMA (Virtual Memory Area) 条目
> - 首次读返回全局零页 (物理页 0)，所有零填充映射共享 — 无需分配
> - 首次写触发页错误 → `do_anonymous_page()` → `alloc_anon_folio()` 分配真实物理页
> - fork 后，父进程和子进程通过写时复制 (COW) 共享页 — `do_wp_page()` 在首次写时复制
> - 过度分配模式控制内核是否允许超过物理 RAM + swap 的分配

---

## 误区："mmap 分配内存"

心智模型：`mmap(NULL, 1GB, ...)` → 内核分配 1 GB 物理 RAM → 返回指针。这是错的。

实际发生的是：

```
  mmap(NULL, 1GB, PROT_READ|PROT_WRITE, MAP_PRIVATE|MAP_ANONYMOUS, -1, 0)
       │
       ▼
  ┌─────────────────────────────────────────────────────────────────────┐
  │  内核：do_mmap()                                                    │
  │  • 在 VMA 树中找到 1GB 空隙                                         │
  │  • 创建新 VMA：vm_start=..., vm_end=..., vm_flags=READ|WRITE        │
  │  • 不分配任何物理页                                                  │
  │  • 返回虚拟地址                                                      │
  └─────────────────────────────────────────────────────────────────────┘
       │
       ▼
  进程拥有一个 1 GB 虚拟地址范围，但没有任何物理页支持
```

内核承诺了 1 GB 的地址空间，但用零物理页支持它。这是**延迟分配** — 物理页仅在实际访问时才分配。

---

## 零页：免费读取

当进程首次从 mmap 区域读取时：

```
  进程读取 *ptr (首次访问此页)
       │
       ▼
  ┌─────────────────────────────────────────┐
  │  CPU：检查页表 — PTE 不存在             │
  │  → 页错误 (x86 上异常 14)               │
  └─────────────────────────────────────────┘
       │
       ▼
  ┌─────────────────────────────────────────┐
  │  handle_mm_fault()                      │
  │  → __handle_mm_fault()                  │
  │  → handle_pte_fault()                   │
  │  → do_anonymous_page()                  │
  └─────────────────────────────────────────┘
       │
       ▼
  ┌─────────────────────────────────────────┐
  │  这是读错误吗？                          │
  │  → 是：使用零页                          │
  │  → 将 PTE 映射到全局零页 (page 0)       │
  │  → 设置 PTE 标志：只读，存在             │
  │  → 返回 (不分配！)                       │
  └─────────────────────────────────────────┘
```

### 全局零页

零页是一个特殊的物理页 (物理内存的第一页，页帧 0)，始终填充为零。内核将其只读映射到每个零填充的匿名映射中：

```c
// mm/memory.c — do_anonymous_page()
static vm_fault_t do_anonymous_page(struct vm_fault *vmf)
{
    // ...

    /* 匿名内存的只读映射？使用零页。 */
    if (!(vmf->flags & FAULT_FLAG_WRITE) && !mm_forbids_zeropage(vma->vm_mm)) {
        /*
         * 这是匿名映射上的读错误。
         * 映射零页 — 无需分配。
         */
        vmf->pte = pte_offset_map_lock(vma->vm_mm, vmf->pmd, vmf->address, &vmf->ptl);
        if (!pte_none(vmf->pte))
            goto unlock;
        entry = pte_mkspecial(pfn_pte(my_zero_pfn, vma->vm_page_prot));
        vmf->pte = pte_offset_map_lock(vma->vm_mm, vmf->pmd, vmf->address, &vmf->ptl);
        set_pte_at(vma->vm_mm, vmf->address, vmf->pte, entry);
        ...
        goto unlock;
    }

    /* 写错误 — 继续分配真实页 */
    // ...
}
```

### 为什么这很重要

零页技巧意味着一个进程可以 mmap TB 级的匿名内存并读取它，而不消耗任何物理 RAM (除了页表)。这是 Linux 过度分配策略的基础。

---

## 延迟分配：首次写时分配

当进程首次写入 mmap 区域时：

```
  进程写入 *ptr = 42 (首次写入此页)
       │
       ▼
  ┌─────────────────────────────────────────┐
  │  CPU：检查页表 — PTE 不存在             │
  │  (或 PTE 存在但只读)                    │
  │  → 页错误                               │
  └─────────────────────────────────────────┘
       │
       ▼
  ┌─────────────────────────────────────────┐
  │  handle_mm_fault()                      │
  │  → do_anonymous_page()                  │
  │  │  → 这是写错误                         │
  └─────────────────────────────────────────┘
       │
       ▼
  ┌─────────────────────────────────────────┐
  │  分配真实物理页：                        │
  │  → alloc_anon_folio(vmf)                │
  │  → alloc_pages(GFP_HIGHUSER_MOVABLE)    │
  │  │  → Buddy 系统返回一页                 │
  └─────────────────────────────────────────┘
       │
       ▼
  ┌─────────────────────────────────────────┐
  │  将页映射到 PTE：                        │
  │  → map_anon_folio_pte_pf()              │
  │  │  → 设置 PTE：读|写，存在               │
  │  │  → 零填充页 (安全)                    │
  └─────────────────────────────────────────┘
```

### 分配路径

```c
// mm/memory.c — do_anonymous_page() (写错误路径)
static vm_fault_t do_anonymous_page(struct vm_fault *vmf)
{
    struct folio *folio;

    /* 分配匿名 folio */
    folio = alloc_anon_folio(vmf);
    if (!folio) {
        /* 无可用内存 → OOM */
        return VM_FAULT_OOM;
    }

    /* 将 folio 映射到 PTE */
    vmf->pte = pte_offset_map_lock(vma->vm_mm, vmf->pmd, vmf->address, &vmf->ptl);
    map_anon_folio_pte_pf(folio, vmf->pte, vma, vmf->address, ...);

    /* 记账 */
    vm_stat_account(vma->vm_mm, mm_counter_file(vma->vm_mm), folio_nr_pages(folio));
    ...
}
```

### 安全零填充

内核总是零填充新分配的匿名页。这防止了进程间的信息泄漏 — 没有零填充，进程可能读取先前由另一个进程使用过的页中残留的数据。

---

## 写时复制：Fork 后的共享

当进程 fork 时，子进程继承父进程的地址空间。但不是复制所有页 (昂贵)，内核通过写时复制 (COW) 共享它们。

### Fork：将页共享为只读

```
  fork()
       │
       ▼
  ┌─────────────────────────────────────────────────────────────────────┐
  │  内核：copy_mm() → dup_mm() → dup_mmap()                          │
  │  • 复制 VMA 树 (虚拟地址布局)                                      │
  │  • 复制页表条目 (PTE)                                              │
  │  • 将共享页标记为只读 (父和子双方)                                  │
  │  • 增加页引用计数 (页现在有 2 个用户)                               │
  │  • 不复制物理页                                                    │
  └─────────────────────────────────────────────────────────────────────┘
       │
       ▼
  父和子共享相同物理页，都映射为只读
```

### Fork 后写：COW 打破

```
  父或子写入共享页
       │
       ▼
  ┌─────────────────────────────────────────┐
  │  CPU：写入只读 PTE                      │
  │  → 页错误 (写保护错误)                  │
  └─────────────────────────────────────────┘
       │
       ▼
  ┌─────────────────────────────────────────┐
  │  handle_mm_fault()                      │
  │  → do_wp_page() (Write-Protect Page)    │
  └─────────────────────────────────────────┘
       │
       ▼
  ┌─────────────────────────────────────────┐
  │  页是共享的 (refcount > 1)？             │
  │  → 是：写时复制                          │
  │  │  → 分配新页                           │
  │  │  → 从旧页复制内容                     │
  │  │  → 将新页映射为读|写                  │
  │  │  → 减少旧页的引用计数                 │
  └─────────────────────────────────────────┘
       │
       ▼
  ┌─────────────────────────────────────────┐
  │  页是独占拥有的？                        │
  │  → 是：直接使其可写                     │
  │  │  → 设置 PTE：读|写 (不复制！)         │
  └─────────────────────────────────────────┘
```

### do_wp_page() 实现

```c
// mm/memory.c — do_wp_page()
static vm_fault_t do_wp_page(struct vm_fault *vmf)
{
    struct folio *folio = vmf->folio;

    if (folio_maybe_dma_pinned(folio)) {
        /* 固定的页 — 无法 COW，返回错误 */
        return VM_FAULT_NOPAGE;
    }

    if (folio_ref_count(folio) == 1) {
        /* 独占拥有者 — 直接使其可写 */
        struct vm_area_struct *vma = vmf->vma;
        folio_lock(folio);
        if (pte_write(pte)) {
            /* 已经可写 — 虚假错误 */
            folio_unlock(folio);
            return VM_FAULT_NOPAGE;
        }
        /* 升级 PTE 为可写 */
        entry = pte_mkwrite(pte_mkdirty(entry));
        set_pte_at(vma->vm_mm, vmf->address, vmf->pte, entry);
        folio_unlock(folio);
        return VM_FAULT_WRITE;
    }

    /* 共享页 — 必须复制 */
    new_folio = alloc_anon_folio(vmf);
    if (!new_folio)
        return VM_FAULT_OOM;

    /* 复制内容 */
    copy_user_highpage(new_folio, folio, vmf->address, vma);

    /* 映射新页 */
    __folio_mark_uptodate(new_folio);
    map_anon_folio_pte_pf(new_folio, vmf->pte, vma, vmf->address, ...);

    /* 减少旧页的引用计数 */
    folio_put(folio);

    return VM_FAULT_WRITE;
}
```

### 为什么 COW 重要

没有 COW，fork 一个有 1 GB 驻留内存的进程需要复制 1 GB 物理页 — 巨大的开销。有了 COW，fork 几乎免费 (只复制页表)。页仅在实际上被修改时才复制。

---

## 过度分配：承诺超过存在的内存

Linux 的延迟分配使**过度分配**成为可能 — 允许"分配"比物理存在的更多内存。这之所以有效，是因为大多数分配的内存从未被实际使用。

### 三种过度分配模式

```bash
# 检查当前模式
cat /proc/sys/vm/overcommit_memory

# 设置模式
echo 2 > /proc/sys/vm/overcommit_memory
```

| 模式 | 值 | 行为 |
|------|-----|------|
| 启发式 | 0 | 内核猜测分配是否合理 (默认) |
| 总是 | 1 | 从不拒绝分配 (过度分配一切) |
| 严格 | 2 | 拒绝超过 CommitLimit 的分配 |

### 严格模式计算

在模式 2 (严格) 下，内核强制执行：

```
CommitLimit = (total_ram - total_huge_pages) * overcommit_ratio / 100 + total_swap
```

默认 `overcommit_ratio` 是 50，所以在 8 GB RAM + 8 GB swap 系统上：

```
CommitLimit = 8GB * 50/100 + 8GB = 12 GB
```

任何会将 `Committed_As` 推到 `CommitLimit` 之上的分配都会被拒绝。

### /proc/meminfo 过度分配字段

```
CommitLimit:     12582912 kB    ← 最大允许已提交内存
Committed_AS:     4194304 kB    ← 当前已提交内存
```

`Committed_AS` 是所有"承诺"内存的总数 (所有非 `MAP_NORESERVE` 的 VMA)。

---

## 如何观测零页和 COW 行为

### 观测页错误

```bash
# 统计进程的页错误
/usr/bin/time -v ./your_program 2>&1 | grep -E "page faults"

# 次要错误 = 零页 / COW (无磁盘 I/O)
# 主要错误 = swap / 文件读取 (磁盘 I/O)
```

### 观测 COW 实际效果

```bash
# 创建一个测试程序：
# 1. mmap 100MB 匿名内存
# 2. 写入每一页 (强制分配)
# 3. Fork
# 4. 父和子都写入每一页 (COW 打破)

# Fork 前：RSS = 100MB
# Fork 后：RSS = 100MB (共享，COW)
# 双方都写后：RSS = 200MB (COW 被打破，页被复制)

# 监控：
watch -n 0.5 'cat /proc/<pid>/status | grep -E "VmRSS|VmSwap"'
```

### 观测过度分配

```bash
# 检查过度分配设置
cat /proc/sys/vm/overcommit_memory
cat /proc/sys/vm/overcommit_ratio

# 检查已提交内存
grep -E "CommitLimit|Committed_AS" /proc/meminfo
```

### 使用 bpftrace 追踪页错误

```bash
#!/usr/bin/env bpftrace
// trace_faults.bt

kprobe:do_anonymous_page
{
    printf("[%s] 匿名页错误在 %lx (写=%d)\n",
           comm, arg1, (arg2 & FAULT_FLAG_WRITE) ? 1 : 0);
}

kprobe:do_wp_page
{
    printf("[%s] COW 打破在 %lx\n", comm, arg1);
}
```

---

## 常见问题

### mmap 是否立即分配物理页？

不是。带 `MAP_ANONYMOUS` 的 `mmap` 只创建 VMA (Virtual Memory Area) 条目。物理页在首次写入时分配 (通过页错误 → `do_anonymous_page()`)。首次读取使用全局零页而不分配。

### 什么是零页？

零页是物理页 0 — 物理内存的前 4 KB，始终填充为零。内核将其只读映射到每个零填充的匿名映射中。这允许从未映射的匿名内存读取成功而无需分配物理页。

### 为什么 Linux 对 fork() 使用写时复制？

COW 避免了在 fork() 期间复制所有物理页的昂贵操作。相反，父和子将页共享为只读。页仅在任一进程写入时 (COW 打破) 被复制。这使得 fork() 即使对于大内存进程也很快。

### 如果系统在 COW 打破期间内存耗尽会怎样？

如果 `do_wp_page()` 中的 `alloc_anon_folio()` 失败 (无可用内存)，错误处理程序返回 `VM_FAULT_OOM`。这可能触发 OOM killer 杀死一个进程并释放内存。

### 过度分配和 swap 有什么区别？

过度分配允许内核承诺超过物理存在的内存，依赖大多数分配从未被使用的事实。swap 为实际使用的匿名页提供后备存储。没有 swap 的过度分配是危险的 — 如果所有"承诺"的内存都被实际使用，OOM killer 必须启动。

### 为什么进程的 RSS 在 malloc 后增长缓慢？

因为物理页是延迟分配的 — 仅在首次写入时。一个 malloc 1 GB 但只触及 10 MB 的进程将显示 RSS 约 10 MB，不是 1 GB。这是正常且预期的。

---

## 总结

Linux 中的匿名内存建立在三个优雅的技巧之上：零页提供免费读取，延迟分配将物理页分配推迟到首次写入，写时复制在 fork() 期间共享页直到修改。这些机制共同使 Linux 的过度分配策略成为可能 — 允许"分配"比物理存在的更多内存，因为大多数分配从未被实际使用。

理解这些机制解释了为什么 `mmap` 很快 (无物理分配)，为什么 fork 便宜 (无页复制)，以及为什么监控工具根据测量内容显示不同的"内存使用量" (虚拟大小来自 mmap，驻留大小来自页错误)。

---

## 来源

- Linux 内核源码, `mm/memory.c`, `do_anonymous_page()` 和零页映射
- Linux 内核源码, `mm/memory.c`, `do_wp_page()` 和写时复制
- Linux 内核源码, `mm/mmap.c`, `do_mmap()` 和 VMA 创建
- Linux 内核源码, `mm/oom_kill.c`, OOM 处理
- Linux 内核文档, admin-guide/sysctl/vm.rst (过度分配), https://www.kernel.org/doc/html/latest/admin-guide/sysctl/vm.html
- Linux 内核文档, admin-guide/mm/page_cache, https://www.kernel.org/doc/html/latest/admin-guide/mm/page_cache.html
