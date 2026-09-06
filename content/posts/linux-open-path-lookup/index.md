---
title: "How Far Does open() Really Go — The Long Journey From Syscall to Disk"
description: "open() does not read file content. The path goes: do_sys_openat2() → path_openat() → link_path_walk() → lookup_fast/slow(). RCU walk and dcache make it fast. Source analysis reveals each step."
coverImage: "/posts/linux-open-path-lookup/images/cover.jpg"
coverImageAlt: "A memory chip representing the Linux kernel's path lookup mechanism through the dcache and RCU walk"
ogImage: "/posts/linux-open-path-lookup/images/cover.jpg"
date: "2026-09-06 06:00:00"
lastUpdated: "2026-09-06 06:00:00"
author: "FindNS94"
tags: ["Kernel", "Linux"]
---

![A memory chip representing the Linux kernel's path lookup mechanism through the dcache and RCU walk](/posts/linux-open-path-lookup/images/cover.jpg)

# How Far Does open() Really Go — The Long Journey From Syscall to Disk

Every C programmer has called `open("file.txt", O_RDONLY)`. The mental model is simple: open the file, get a file descriptor, read the content. But what actually happens inside the kernel is far more intricate than "find the file and return a handle."

When you call `open()`, the kernel does NOT read any file content. It does NOT even touch the disk (in most cases). What it does is far more subtle: it traverses the path component by component, looking up each directory in a hash table, verifying permissions, creating a "directory entry cache" (dentry) if needed, and finally creating a `file` structure that represents your access to the file. The actual file content is only read when you call `read()` — and even then, only via page fault.

This article walks through the complete `open()` path from `do_sys_openat2()` through `path_openat()`, `link_path_walk()`, and into the RCU-based `lookup_fast()` / `lookup_slow()` functions. By the end, you will understand why `open()` is fast (no disk I/O in the common case), why path lookup scales to millions of files, and why the kernel uses RCU for something as fundamental as finding a file.

<!-- [UNIQUE INSIGHT] The most counterintuitive fact about open() is that it almost never enters kernel space for the path lookup itself. The dcache (directory entry cache) hash table lookup runs under RCU read lock — no locks taken, no atomic operations, no cache line bouncing. This means path lookup scales linearly with the number of CPUs: 100 CPUs can look up paths simultaneously without any contention. This is why Linux can handle millions of files without the path lookup becoming a bottleneck. -->

<!-- more -->

> **Key Takeaways**
> - open() does NOT read file content — it only establishes the access path (dentry + file struct)
> - Path lookup traverses each component: `/` → `home` → `user` → `file.txt`
> - RCU walk (`lookup_fast()`) is lockless — no atomic operations, no cache line bouncing
> - dcache hash table provides O(1) lookup for cached paths
> - Negative dentry caches "file not found" results to avoid repeated disk I/O
> - `lookup_slow()` falls back to disk I/O only when dcache misses

---

## The Myth: "open() Reads the File"

The mental model: `open("file.txt")` → kernel reads file metadata from disk → returns file descriptor. This is wrong.

What actually happens:

```
  open("file.txt")
       │
       ▼
  ┌─────────────────────────────────────────────────────────────────────┐
 │ Phase 1: Path Resolution                                            │
  │ • Parse path into components: "file.txt"                            │
  │ • Walk each component through dcache hash table                     │
  │ • Verify permissions at each level                                  │
  │ • NO disk I/O (if dcache hits)                                      │
  └─────────────────────────────────────────────────────────────────────┘
       │
       ▼
  ┌─────────────────────────────────────────────────────────────────────┐
  │ Phase 2: File Struct Creation                                       │
  │ • Allocate struct file                                              │
  │ • Install file_operations (read, write, mmap, etc.)                 │
  │ • Set file flags (O_RDONLY, O_CREAT, etc.)                          │
  │ • Allocate file descriptor                                          │
  └─────────────────────────────────────────────────────────────────────┘
       │
       ▼
  ┌─────────────────────────────────────────────────────────────────────┐
  │ Phase 3: Return to Userspace                                        │
  │ • fd_install() — associate fd with struct file                      │
  │ • Return fd to caller                                               │
  │ • File content NOT read — that happens on first read()              │
  └─────────────────────────────────────────────────────────────────────┘
```

The file content is only read when you call `read()` — and even then, only the pages you actually access (via page fault).

---

## Phase 1: Path Resolution — The Long Walk

### `do_sys_openat2()`: The Entry Point

```c
// fs/open.c — do_sys_openat2()
long do_sys_openat2(int dfd, const char __user *filename,
                    struct open_how *how)
{
    struct open_flags op;
    int fd = build_open_flags(how, &op);

    // Allocate a file descriptor
    fd = get_unused_fd_flags(how->flags);
    if (fd < 0)
        return fd;

    // Resolve the path and create struct file
    struct file *f = do_filp_open(dfd, tmp, &op);

    // Install fd → file mapping
    fd_install(fd, f);
    return fd;
}
```

### `do_filp_open()`: Dispatching to the Path Walker

```c
// fs/namei.c — do_filp_open()
struct file *do_filp_open(int dfd, struct filename *pathname,
                         const struct open_flags *op)
{
    struct nameidata nd;
    int flags = op->lookup_flags;
    struct file *filp;

    // Set up the nameidata (walk context)
    set_nameidata(&nd, dfd, pathname);

    // Perform the actual path walk
    filp = path_openat(&nd, flags | LOOKUP_RCU, NULL);

    restore_nameidata();
    return filp;
}
```

### `path_openat()`: The Core Walker

```c
// fs/namei.c — path_openat()
static struct file *path_openat(struct nameidata *nd, unsigned flags, struct file *filp)
{
    struct path path;
    int error;

    // Walk the path
    error = link_path_walk(nd->name, nd);
    if (error)
        return ERR_PTR(error);

    // Handle the final component (create if O_CREAT)
    error = do_last(nd, &path, filp);
    if (error)
        return ERR_PTR(error);

    return filp;
}
```

---

## `link_path_walk()`: Component-by-Component

This is where the actual path traversal happens. For a path like `/home/user/file.txt`, it walks:

```
  "/" (root)
   │
   ▼
  "home" → lookup in dcache → found → verify permissions
   │
   ▼
  "user" → lookup in dcache → found → verify permissions
   │
   ▼
  "file.txt" → lookup in dcache → found → verify permissions
   │
   ▼
  All components resolved → proceed to do_last()
```

```c
// fs/namei.c — link_path_walk()
static int link_path_walk(const char *name, struct nameidata *nd)
{
    struct path next;
    int err;

    // Skip leading slashes
    while (*name == '/')
        name++;

    // Walk each component
    for (;;) {
        struct qstr this;
        unsigned int c;
        int type;

        // Hash the component name for dcache lookup
        err = may_lookup(nd);  // Permission check
        if (err)
            return err;

        // Get next component
        name = hash_name(name, &c, &this.len);

        // Look up in dcache
        type = LAST_NORM;
        if (this.name[0] == '.') {
            if (this.len == 1)
                type = LAST_DOT;      // "."
            else if (this.len == 2 && this.name[1] == '.')
                type = LAST_DOTDOT;   // ".."
        }

        // Walk the component
        err = walk_component(nd, &next, type, &this);
        if (err)
            return err;

        // Handle symlinks (if this component is a symlink)
        if (type == LAST_NORM && nd->flags & LOOKUP_FOLLOW) {
            err = traverse_link(nd, &next, &this);
            if (err)
                return err;
        }

        // More components?
        if (!c)
            return 0;  // Done
    }
}
```

---

## `lookup_fast()`: The RCU Lockless Path

This is the most performance-critical function in path lookup. It runs under RCU read lock — no locks, no atomics, no cache line bouncing:

```c
// fs/namei.c — lookup_fast()
static int lookup_fast(struct nameidata *nd, struct qstr *name,
                       struct path *path)
{
    struct vfsmount *mnt = nd->mnt;
    struct dentry *parent = nd->path.dentry;
    struct dentry *dentry;
    unsigned int seq;

    // RCU read lock — no actual lock acquisition!
    rcu_read_lock();

    // Walk the dcache hash table
    dentry = __d_lookup_rcu(parent, name);
    if (!dentry)
        goto out;  // Cache miss — fall back to slow path

    // Validate the dentry using seqcount
    seq = read_seqcount_retry(&dentry->d_seq, nd->seq);
    if (seq)
        goto out;  // Concurrent modification — retry

    // Found! Set up the path
    path->mnt = mnt;
    path->dentry = dentry;

    rcu_read_unlock();
    return 0;  // Success — no locks taken!

out:
    rcu_read_unlock();
    return 1;  // Need slow path
}
```

### Why RCU Walk is Revolutionary

Traditional locking for path lookup would require:
- Per-dentry spinlock: contention on hot directories
- Global dcache lock: serializes all lookups
- RW lock: readers still bounce cache lines

RCU walk eliminates all of this:
- **No lock acquisition**: `rcu_read_lock()` is a single per-CPU variable read
- **No atomic operations**: No compare-and-swap, no test-and-set
- **No cache line bouncing**: Multiple CPUs can read the same hash table entries simultaneously
- **Linear scaling**: 100 CPUs look up paths with zero contention

The tradeoff: if another CPU is concurrently modifying the dentry (e.g., renaming a file), the seqcount validation fails and we fall back to the slow path.

---

## `lookup_slow()`: The Fallback

When RCU walk fails (cache miss or concurrent modification), the kernel falls back to `lookup_slow()`:

```c
// fs/namei.c — lookup_slow()
static int lookup_slow(struct nameidata *nd, struct qstr *name,
                       struct path *path)
{
    struct dentry *parent = nd->path.dentry;
    struct dentry *dentry;
    unsigned int seq;

    // Take inode lock (shared) — this is the slow part
    inode_lock_shared(parent->d_inode);

    // Look up in dcache under lock
    dentry = __d_lookup(parent, name);
    if (dentry) {
        inode_unlock_shared(parent->d_inode);
        return 0;  // Found in cache
    }

    // Cache miss — allocate new dentry
    dentry = d_alloc_parallel(parent, name, &nd->done);
    if (IS_ERR(dentry)) {
        inode_unlock_shared(parent->d_inode);
        return PTR_ERR(dentry);
    }

    // Still not in cache — need disk I/O
    if (!dentry->d_inode) {
        struct inode *inode = dir_inode->i_op->lookup(dir_inode, dentry, 0);
        // ^^^ This triggers disk I/O to read the directory entry
        d_instantiate(dentry, inode);
    }

    inode_unlock_shared(parent->d_inode);
    return 0;
}
```

### `d_alloc_parallel()`: Handling Concurrent Lookups

Multiple CPUs might simultaneously look up the same missing path. `d_alloc_parallel()` handles this:

```c
// fs/dcache.c — d_alloc_parallel()
struct dentry *d_alloc_parallel(struct dentry *parent, const struct qstr *name,
                                wait_queue_head_t *wq)
{
    struct dentry *dentry;
    unsigned int hash = name->hash;

    // Check if another CPU already allocated this dentry
    dentry = d_lookup(parent, name);
    if (dentry)
        return dentry;  // Someone else created it — use theirs

    // Allocate new dentry
    dentry = d_alloc(parent, name);
    if (!dentry)
        return ERR_PTR(-ENOMEM);

    // Insert into hash table (may race with other CPUs)
    return __d_add_to_parallel(parent, dentry, hash, wq);
}
```

---

## The dcache: Directory Entry Cache

### Hash Table Structure

```c
// fs/dcache.c
static struct hlist_bl_head *dentry_hashtable;
#define HASHBITS    16
#define HASHTAB_SIZE (1 << HASHBITS)

// Each hash bucket is a bit-locked list head
struct hlist_bl_head {
    struct hlist_bl_node *first;
};
```

The dcache hash table maps `(parent_dentry, name_hash)` → `dentry`. Lookup is O(1) average case.

### Negative Dentries

When a file doesn't exist, the kernel caches this fact as a "negative dentry":

```c
// A negative dentry has d_inode == NULL
if (!dentry->d_inode) {
    // File doesn't exist — this is a negative dentry
    // Future lookups for the same path will hit this cache
}
```

Negative dentries prevent repeated disk I/O for non-existent files. This is why `stat()` on a non-existent file is fast after the first call.

---

## Deep Detail: `struct nameidata` and seqcount

The `nameidata` structure carries the walk state:

```c
// fs/namei.c
struct nameidata {
    struct path path;           // Current position
    struct qstr last;           // Last component name
    struct path root;           // Root of walk
    struct inode *inode;        // path.dentry.d_inode
    unsigned int flags, state;
    unsigned seq, next_seq, m_seq, r_seq;  // Sequence counts for RCU
    enum last_type last_type;   // LAST_NORM, LAST_ROOT, LAST_DOT, LAST_DOTDOT
    unsigned depth;             // Symlink nesting depth
    int total_link_count;       // Total symlinks followed
    struct saved *stack;        // Symlink stack (EMBEDDED_LEVELS inline)
    struct filename *name;
};
```

The seqcount fields (`seq`, `next_seq`, `m_seq`, `r_seq`) validate RCU reads:
- `seq`: dentry seqcount snapshot
- `next_seq`: parent dentry seqcount
- `m_seq`: mount seqcount
- `r_seq`: root seqcount

If any seqcount changed during the RCU read, the walk retries via the slow path.

---

## How to Observe Path Lookup

### Using bpftrace

```bash
#!/usr/bin/env bpftrace
// trace_path_lookup.bt

kprobe:link_path_walk
{
    printf("[%s] walking path: %s\n", comm, str(arg1));
}

kprobe:lookup_fast
{
    @fast[comm] = count();
}

kprobe:lookup_slow
{
    @slow[comm] = count();
}

kprobe:__d_lookup_rcu
{
    @dcache_lookup[comm] = count();
}

END
{
    printf("\nFast path (RCU walk) hits:\n");
    print(@fast);
    printf("\nSlow path (locked walk) hits:\n");
    print(@slow);
}
```

### Using perf

```bash
// Profile path lookup overhead
perf record -e cycles:k -g -- ./benchmark_open
perf report | head -30

// Count dcache hits/misses
perf stat -e dcache_hits,dcache_misses ./benchmark_stat
```

### Using /proc

```bash
// Dcache statistics
cat /proc/sys/fs/dentry-state
// Output: nr_dentry nr_unused age_limit want_pages

// Inode cache statistics
cat /proc/sys/fs/inode-nr
```

---

## Frequently Asked Questions

### How much does open() cost?
Typical cost: 1-10 microseconds for cached paths. The breakdown:
- Path lookup (dcache hit): ~0.5-2 μs
- Permission check: ~0.5 μs
- File struct allocation: ~0.5 μs
- fd allocation: ~0.2 μs

### Why is RCU used for path lookup?
RCU allows lockless reads of the dcache hash table. Multiple CPUs can look up paths simultaneously without any contention. This is critical for scalability on large systems.

### What happens when dcache misses?
The kernel falls back to `lookup_slow()`, which takes the inode lock and may trigger disk I/O to read the directory entry from the filesystem.

### What are negative dentries?
Cached "file not found" results. They prevent repeated disk I/O for non-existent files. Negative dentries are evicted from the cache under memory pressure.

### How does symlink following work?
When a path component is a symlink, `traverse_link()` resolves it and continues the walk. The kernel limits symlink nesting to 40 levels to prevent infinite loops.

---

## Conclusion

`open()` is far more than "find the file and return a handle." It involves path resolution through the dcache hash table (RCU lockless in the common case), permission verification at each level, dentry allocation on cache misses, and file struct creation. The actual file content is never read during `open()` — that happens on the first `read()` call via page fault.

The key to performance is the dcache + RCU combination: the hash table provides O(1) lookup, and RCU allows lockless concurrent access. This is why Linux can handle millions of files without path lookup becoming a bottleneck.

---

## Sources

- Linux kernel source, `fs/namei.c`, `link_path_walk()`
- Linux kernel source, `fs/namei.c`, `lookup_fast()`
- Linux kernel source, `fs/namei.c`, `lookup_slow()`
- Linux kernel source, `fs/dcache.c`, `__d_lookup_rcu()`
- Linux kernel source, `fs/dcache.c`, `d_alloc_parallel()`
- Linux kernel source, `fs/namei.c`, `do_filp_open()`
