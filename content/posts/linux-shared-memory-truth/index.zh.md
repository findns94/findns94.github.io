---
title: "共享内存的真相——System V SHM 就是 tmpfs 上的文件"
description: "共享内存不是直接物理内存访问。System V SHM 基于 tmpfs 实现 — shmget() 创建 tmpfs 文件，shmat() mmap() 它。源码分析揭示实现。"
coverImage: "/posts/linux-shared-memory-truth/images/cover.jpg"
coverImageAlt: "数字存储介质，代表 Linux 内核中 System V 共享内存基于 tmpfs 实现的真相"
ogImage: "/posts/linux-shared-memory-truth/images/cover.jpg"
date: "2026-09-06 14:00:00"
lastUpdated: "2026-09-06 14:00:00"
author: "FindNS94"
tags: ["Kernel", "Linux"]
---

![数字存储介质，代表 Linux 内核中 System V 共享内存基于 tmpfs 实现的真相](/posts/linux-shared-memory-truth/images/cover.jpg)

# 共享内存的真相——System V SHM 就是 tmpfs 上的文件

每个系统程序员都知道共享内存是最快的 IPC 机制 — 进程直接访问相同物理内存，避免内核拷贝。但如果共享内存根本不是"直接物理内存访问"呢？

System V 共享内存（`shmget()`/`shmat()`）基于 **tmpfs**（RAM 支持的文件系统）实现。当你调用 `shmget()` 时，内核在 tmpfs 中创建文件。当你调用 `shmat()` 时，内核将该文件 mmap() 到你的进程中。"共享内存"只是一个恰好在 RAM 中的文件，内核通过页缓存管理它。

本文通过 `ipc/shm.c` 中的 System V SHM 源码来解释 `shmget()` 如何创建 tmpfs 文件，`shmat()` 如何映射它，以及为什么这种实现既优雅又高性能。

<!-- [UNIQUE INSIGHT] 关于 System V 共享内存最反直觉的事实是它与"直接物理内存访问"毫无关系。内核创建 tmpfs 文件（通过 `shmem_file_setup()`），`shmat()` 只是对该文件调用 `mmap()`。这意味着共享内存受益于所有页缓存机制：按需分页、页回收、swap 备份和内存 cgroup 会计。这不是 hack — 这是重用整个 VM 子系统的刻意设计。 -->

<!-- more -->

> **核心要点**
> - System V SHM 基于 tmpfs 实现 — 不是直接物理内存访问
> - `shmget()` 通过 `shmem_file_setup()` 创建 tmpfs 文件
> - `shmat()` 只是对该 tmpfs 文件的 `mmap()`
> - 好处：按需分页、页回收、swap 备份、cgroup 会计
> - `shm_nattch` 跟踪附加计数；`SHM_DEST` 标记删除
> - POSIX 共享内存（`shm_open()`）使用相同的 tmpfs 机制

---

## 误区："共享内存是直接物理内存访问"

心智模型：`shmget()` 分配物理内存 → `shmat()` 映射到两个进程 → 两个进程访问相同物理页。这是错误的。

实际发生的是：

```
  shmget(key, size, IPC_CREAT)
       │
       ▼
  ┌─────────────────────────────────────────────────────────────────────┐
  │ newseg() — ipc/shm.c                                                │
  │ • 创建 shmid_kernel 结构                                            │
  │ • 调用 shmem_file_setup() 创建 tmpfs 文件                          │
  │ • "共享内存"就是 tmpfs 文件                                        │
  └─────────────────────────────────────────────────────────────────────┘
       │
       ▼
  shmat(shmid, NULL, 0)
       │
       ▼
  ┌─────────────────────────────────────────────────────────────────────┐
  │ do_shmat() — ipc/shm.c                                              │
  │ • 从 shmid_kernel->shm_file 获取 tmpfs 文件                         │
  │ • 调用 do_mmap() 将文件 mmap() 到进程中                             │
  │ • 返回映射地址                                                       │
  └─────────────────────────────────────────────────────────────────────┘
       │
       ▼
  ┌─────────────────────────────────────────────────────────────────────┐
  │ 结果：进程有指向 tmpfs 文件的 VMA                                   │
  │ • 首次访问触发页错误 → 分配物理页                                   │
  │ • 第二个进程的 shmat() → 相同文件 → 相同物理页                      │
  │ • "共享"因为两个进程映射相同文件                                    │
  └─────────────────────────────────────────────────────────────────────┘
```

---

## `shmget()`：创建段

```c
// ipc/shm.c — newseg()
static int newseg(struct ipc_namespace *ns, struct ipc_params *params)
{
    struct shmid_kernel *shp;
    int error;

    shp = ipc_rcu_alloc(sizeof(*shp));
    if (!shp)
        return -ENOMEM;

    // 创建 tmpfs 文件 — 这就是共享内存
    shp->shm_file = shmem_file_setup(name, size, acctflag);
    if (IS_ERR(shp->shm_file)) {
        ipc_rcu_putref(shp, shm_rcu_free);
        return PTR_ERR(shp->shm_file);
    }

    shp->shm_nattch = 0;
    shp->shm_perm.key = key;
    shp->shm_perm.mode = shmflg & 0777;

    return shp->shm_perm.id;
}
```

---

## `shmat()`：映射段

```c
// ipc/shm.c — do_shmat()
static long do_shmat(struct shmid_kernel *shp, unsigned long shmaddr,
                     int shmflg, unsigned long *raddr)
{
    struct file *file = shp->shm_file;
    unsigned long addr;
    int err;

    vm_flags_t vm_flags = VM_SHARED | VM_SHARED | calc_vm_prot_bits(shmflg);

    // 将 tmpfs 文件映射到进程中
    addr = do_mmap(file, shmaddr, shp->shm_segsz, prot, vm_flags,
                   0, &populate);

    *raddr = addr;
    return 0;
}
```

---

## 为什么这种实现很优雅

### 使用 tmpfs 的好处

1. **按需分页**：物理页在首次访问时分配，不在 `shmget()` 时
2. **页回收**：内存在压力下可以 swap 出
3. **内存 cgroup 会计**：共享内存计入首次触摸它的 cgroup
4. **统一接口**：与普通文件相同的页缓存机制
5. **无特殊 VM 代码**：重用整个 mmap 基础设施

---

## 深度细节：`shm_file_data` 与 `vm_ops`

```c
// ipc/shm.c
struct shm_file_data {
    int                     id;
    struct ipc_namespace    *ns;
    struct file             *file;
    const struct vm_operations_struct *vm_ops;
};

static const struct vm_operations_struct shm_vm_ops = {
    .open = shm_open,
    .close = shm_close,
    .fault = shm_fault,
};
```

---

## 如何观测共享内存

### 使用 ipcs

```bash
// System V 共享内存段
ipcs -m

// 每段详情
cat /proc/sysvipc/shm

// 共享内存限制
cat /proc/sys/kernel/shmmax
cat /proc/sys/kernel/shmall
```

---

## 常见问题

### System V SHM 和 POSIX SHM 有什么区别？
System V SHM 使用 `shmget()`/`shmat()`。POSIX SHM 使用 `shm_open()`/`mmunmap()`。两者在底层都使用 tmpfs — POSIX SHM 只提供文件系统路径接口。

### 共享内存真的是最快的 IPC 吗？
是的，因为数据直接在进程地址空间之间拷贝（通过页表映射）。不需要内核缓冲区拷贝。但仍需要同步（信号量）。

### 所有进程分离后共享内存会怎样？
段持续存在直到调用 `shmctl(IPC_RMID)` 或系统重启。使用 `SHM_DEST` 在最后一个进程分离时标记删除。

### 共享内存可以被 swap 吗？
可以。因为它由 tmpfs 支持，页可以在内存压力下被 swap 出。使用 `SHM_LOCK` 防止 swap。

---

## 总结

System V 共享内存不是直接物理内存访问 — 它是映射到多个进程的 tmpfs 文件。这种优雅的设计重用了整个页缓存机制：按需分页、页回收、swap 备份和 cgroup 会计。"共享"来自两个进程映射相同文件，而非任何特殊内存分配。

对于生产系统，实际要点是：共享内存很快（无内核拷贝），它由 tmpfs 支持（受益于页缓存），理解实现有助于调试 IPC 性能问题。

---

## 来源

- Linux 内核源码, `ipc/shm.c`, `newseg()` 和 `do_shmat()`
- Linux 内核源码, `mm/shmem.c`, `shmem_file_setup()`
- Linux 内核源码, `ipc/shm.c`, `shm_file_operations`
- Linux 内核源码, `include/linux/shm.h`
