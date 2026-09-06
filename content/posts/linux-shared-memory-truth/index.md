---
title: "The Truth About Shared Memory — System V SHM Is Just a File on tmpfs"
description: "Shared memory is not direct physical memory access. System V SHM is implemented on top of tmpfs — shmget() creates a tmpfs file, shmat() mmap()s it. Source analysis reveals the implementation."
coverImage: "/posts/linux-shared-memory-truth/images/cover.jpg"
coverImageAlt: "Digital storage media representing the truth that System V shared memory is implemented on top of tmpfs in the Linux kernel"
ogImage: "/posts/linux-shared-memory-truth/images/cover.jpg"
date: "2026-09-06 14:00:00"
lastUpdated: "2026-09-06 14:00:00"
author: "FindNS94"
tags: ["Kernel", "Linux"]
---

![Digital storage media representing the truth that System V shared memory is implemented on top of tmpfs in the Linux kernel](/posts/linux-shared-memory-truth/images/cover.jpg)

# The Truth About Shared Memory — System V SHM Is Just a File on tmpfs

Every systems programmer knows that shared memory is the fastest IPC mechanism — processes directly access the same physical memory, avoiding kernel copies. But what if shared memory isn't actually "direct physical memory access" at all?

System V shared memory (`shmget()`/`shmat()`) is implemented on top of **tmpfs** — a RAM-backed filesystem. When you call `shmget()`, the kernel creates a file in tmpfs. When you call `shmat()`, the kernel `mmap()`s that file into your process. The "shared memory" is just a file that happens to live in RAM, and the kernel manages it through the page cache.

This article walks through the System V SHM source in `ipc/shm.c` to explain how `shmget()` creates a tmpfs file, how `shmat()` maps it, and why this implementation is both elegant and performant.

<!-- [UNIQUE INSIGHT] The most counterintuitive fact about System V shared memory is that it has NOTHING to do with "direct physical memory access." The kernel creates a tmpfs file (via `shmem_file_setup()`), and `shmat()` simply calls `mmap()` on that file. This means shared memory benefits from all the page cache machinery: demand paging, page reclaim, swap backing, and memory cgroup accounting. It's not a hack — it's a deliberate design that reuses the entire VM subsystem. -->

<!-- more -->

> **Key Takeaways**
> - System V SHM is implemented on top of tmpfs — not direct physical memory access
> - `shmget()` creates a tmpfs file via `shmem_file_setup()`
> - `shhat()` is just `mmap()` on that tmpfs file
> - Benefits: demand paging, page reclaim, swap backing, cgroup accounting
> - `shm_nattch` tracks attach count; `SHM_DEST` marks for deletion
> - POSIX shared memory (`shm_open()`) uses the same tmpfs mechanism

---

## The Myth: "Shared Memory is Direct Physical Memory Access"

The mental model: `shmget()` allocates physical memory → `shmat()` maps it into both processes → both processes access the same physical pages. This is wrong.

What actually happens:

```
  shmget(key, size, IPC_CREAT)
       │
       ▼
  ┌─────────────────────────────────────────────────────────────────────┐
  │ newseg() — ipc/shm.c                                                │
  │ • Creates shmid_kernel structure                                    │
  │ • Calls shmem_file_setup() to create a tmpfs file                  │
  │ • The "shared memory" IS the tmpfs file                            │
  └─────────────────────────────────────────────────────────────────────┘
       │
       ▼
  shmat(shmid, NULL, 0)
       │
       ▼
  ┌─────────────────────────────────────────────────────────────────────┐
  │ do_shmat() — ipc/shm.c                                              │
  │ • Gets the tmpfs file from shmid_kernel->shm_file                   │
  │ • Calls do_mmap() to mmap() the file into the process              │
  │ • Returns the mapped address                                        │
  └─────────────────────────────────────────────────────────────────────┘
       │
       ▼
  ┌─────────────────────────────────────────────────────────────────────┐
  │ Result: process has a VMA pointing to the tmpfs file               │
  │ • First access triggers page fault → allocates physical page        │
  │ • Second process's shmat() → same file → same physical pages       │
  │ • "Shared" because both processes map the same file                │
  └─────────────────────────────────────────────────────────────────────┘
```

---

## `shmget()`: Creating the Segment

```c
// ipc/shm.c — ksys_shmget()
long ksys_shmget(key_t key, size_t size, int shmflg)
{
    struct ipc_namespace *ns = current->nsproxy->ipc_ns;
    struct ipc_ops shm_ops = {
        .getnew = newque,
        .associate = security_shm_associate,
    };

    return ipcget(ns, &ipc_ids(ns), &shm_ops, &shm_params);
}

// ipc/shm.c — newseg()
static int newseg(struct ipc_namespace *ns, struct ipc_params *params)
{
    struct shmid_kernel *shp;
    int error;

    shp = ipc_rcu_alloc(sizeof(*shp));
    if (!shp)
        return -ENOMEM;

    // Create the tmpfs file — THIS IS THE SHARED MEMORY
    shp->shm_file = shmem_file_setup(name, size, acctflag);
    if (IS_ERR(shp->shm_file)) {
        ipc_rcu_putref(shp, shm_rcu_free);
        return PTR_ERR(shp->shm_file);
    }

    shp->shm_nattch = 0;
    shp->shm_perm.key = key;
    shp->shm_perm.mode = shmflg & 0777;

    // Return the IPC ID
    return shp->shm_perm.id;
}
```

### `shmem_file_setup()`: The Key Function

```c
// mm/shmem.c — shmem_file_setup()
struct file *shmem_file_setup(const char *name, loff_t size, unsigned long flags)
{
    struct inode *inode;
    struct file *res;

    // Create a new inode in the tmpfs filesystem
    inode = shmem_get_inode(sb, NULL, S_IFREG | S_IRWXUGO, 0,
                           VM_NOEXEC | VM_SHARED);
    if (!inode)
        return ERR_PTR(-ENOSPC);

    // Set the file size
    inode->i_size = size;

    // Create the file structure
    res = alloc_file_pseudo(mnt, dentry, name, O_RDWR, &shmem_file_operations);
    if (IS_ERR(res))
        iput(inode);

    return res;
}
```

---

## `shmat()`: Mapping the Segment

```c
// ipc/shm.c — ksys_shmat()
long ksys_shmat(int shmaddr, char __user *shmaddr, int shmflg)
{
    unsigned long addr = (unsigned long)shmaddr;
    struct shmid_kernel *shp;
    struct file *file;
    int err;

    // Find the segment by ID
    shp = shm_obtain_object_check(ns, shmid);
    if (IS_ERR(shp))
        return PTR_ERR(shp);

    // Get the tmpfs file
    file = shp->shm_file;

    // Map it into the process
    addr = do_shmat(shp, addr, shmflg, &ret);
    if (IS_ERR_VALUE(addr))
        return addr;

    // Increment attach count
    shp->shm_nattch++;

    return ret;
}

// ipc/shm.c — do_shmat()
static long do_shmat(struct shmid_kernel *shp, unsigned long shmaddr,
                     int shmflg, unsigned long *raddr)
{
    struct file *file = shp->shm_file;
    unsigned long addr;
    int err;

    // Set up VMA flags
    vm_flags_t vm_flags = VM_SHARED | VM_SHARED | calc_vm_prot_bits(shmflg);

    // Map the tmpfs file into the process
    addr = do_mmap(file, shmaddr, shp->shm_segsz, prot, vm_flags,
                   0, &populate);

    *raddr = addr;
    return 0;
}
```

---

## Why This Implementation is Elegant

### Benefits of Using tmpfs

1. **Demand paging**: Physical pages are allocated on first access, not at `shmget()` time
2. **Page reclaim**: Unused pages can be swapped out under memory pressure
3. **Memory cgroup accounting**: Shared memory is charged to the cgroup that first touches it
4. **Uniform interface**: Same page cache machinery as regular files
5. **No special VM code**: Reuses the entire mmap infrastructure

### The "Shared" Mechanism

```
  Process A                    Process B
  │                            │
  ├──shmat()──→               ├──shmat()──→
  │   ↓                        │   ↓
  │  VMA ──→ tmpfs file ←── VMA  │
  │   ↓           ↓          ↓   │
  │   └──→ page cache ←──────┘   │
  │               ↓              │
  │         Physical pages       │
  │         (shared!)            │
```

Both processes have VMAs pointing to the same tmpfs file. When either process accesses the page, the page fault handler allocates a physical page and inserts it into the page cache. The second process's access finds the same page in the cache — no allocation needed.

---

## Deep Detail: `shm_file_data` and `vm_ops`

```c
// ipc/shm.c
struct shm_file_data {
    int                     id;
    struct ipc_namespace    *ns;
    struct file             *file;
    const struct vm_operations_struct *vm_ops;
};

// Per-open file operations for shared memory
static const struct file_operations shm_file_operations = {
    .mmap = shm_mmap,
    .release = shm_release,
    .get_unmapped_area = shm_get_unmapped_area,
    .llseek = noop_llseek,
};

static const struct vm_operations_struct shm_vm_ops = {
    .open = shm_open,
    .close = shm_close,
    .fault = shm_fault,
};
```

The `shm_vm_ops` provides VMA-level operations:
- `shm_open()`: Called when a new VMA is created (e.g., fork)
- `shm_close()`: Called when a VMA is destroyed
- `shm_fault()`: Called on page fault (allocates physical page)

---

## How to Observe Shared Memory

### Using bpftrace

```bash
#!/usr/bin/env bpftrace
// trace_shm.bt

kprobe:ksys_shmget
{
    @shmget[comm] = count();
}

kprobe:ksys_shmat
{
    @shmat[comm] = count();
}

kprobe:do_shmat
{
    @do_shmat[comm] = count();
}
```

### Using /proc and ipcs

```bash
// System V shared memory segments
ipcs -m

// Per-segment details
cat /proc/sysvipc/shm

// Shared memory limits
cat /proc/sys/kernel/shmmax
cat /proc/sys/kernel/shmall
```

---

## Frequently Asked Questions

### What is the difference between System V SHM and POSIX SHM?
System V SHM uses `shmget()`/`shmat()`. POSIX SHM uses `shm_open()`/`mmunmap()`. Both use tmpfs underneath — POSIX SHM just provides a filesystem path interface.

### Is shared memory really the fastest IPC?
Yes, because data is copied directly between processes' address spaces (via page table mapping). No kernel buffer copies are needed. But synchronization (semaphores) is still required.

### What happens to shared memory when all processes detach?
The segment persists until `shmctl(IPC_RMID)` is called or the system reboots. Use `SHM_DEST` to mark for deletion when last process detaches.

### Can shared memory be swapped?
Yes. Since it's backed by tmpfs, pages can be swapped out under memory pressure. Use `SHM_LOCK` to prevent swapping.

### How is shared memory accounted to cgroups?
Pages are charged to the cgroup that first touches them (on page fault). This is called "lazy accounting."

---

## Conclusion

System V shared memory is not direct physical memory access — it's a tmpfs file mapped into multiple processes. This elegant design reuses the entire page cache machinery: demand paging, page reclaim, swap backing, and cgroup accounting. The "shared" comes from both processes mapping the same file, not from any special memory allocation.

For production systems, the practical takeaways are: shared memory is fast (no kernel copies), it's backed by tmpfs (benefits from page cache), and understanding the implementation helps debug IPC performance issues.

---

## Sources

- Linux kernel source, `ipc/shm.c`, `newseg()` and `do_shmat()`
- Linux kernel source, `mm/shmem.c`, `shmem_file_setup()`
- Linux kernel source, `ipc/shm.c`, `shm_file_operations`
- Linux kernel source, `include/linux/shm.h`
