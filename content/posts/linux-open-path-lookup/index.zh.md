---
title: "打开一个文件有多远——从 open() 到磁盘的漫长旅途"
description: "open() 不读取文件内容。路径是：do_sys_openat2() → path_openat() → link_path_walk() → lookup_fast/slow()。RCU walk 和 dcache 使其快速。源码分析揭示每一步。"
coverImage: "/posts/linux-open-path-lookup/images/cover.jpg"
coverImageAlt: "一个存储芯片，代表 Linux 内核通过 dcache 和 RCU walk 的路径查找机制"
ogImage: "/posts/linux-open-path-lookup/images/cover.jpg"
date: "2026-09-06 06:00:00"
lastUpdated: "2026-09-06 06:00:00"
author: "FindNS94"
tags: ["Kernel", "Linux"]
---

![一个存储芯片，代表 Linux 内核通过 dcache 和 RCU walk 的路径查找机制](/posts/linux-open-path-lookup/images/cover.jpg)

# 打开一个文件有多远——从 open() 到磁盘的漫长旅途

每个 C 程序员都调用过 `open("file.txt", O_RDONLY)`。心智模型很简单：打开文件，获得文件描述符，读取内容。但内核实际发生的事情远比"找到文件并返回句柄"复杂得多。

当你调用 `open()` 时，内核不读取任何文件内容。它甚至不接触磁盘（在大多数情况下）。它做的是更微妙的事情：逐组件遍历路径，在哈希表中查找每个目录，验证权限，如果需要创建"目录项缓存"（dentry），最后创建一个表示你对文件访问的 `file` 结构。实际文件内容仅在你调用 `read()` 时才被读取 —— 而且只能通过页错误。

本文通过 `do_sys_openat2()` 经过 `path_openat()`、`link_path_walk()` 到基于 RCU 的 `lookup_fast()` / `lookup_slow()` 函数的完整 `open()` 路径。读完后，你将理解为什么 `open()` 很快（在常见情况下无磁盘 I/O），路径查找如何扩展到数百万文件，以及为什么内核对像查找文件这样基本的事情使用 RCU。

<!-- [UNIQUE INSIGHT] 关于 open() 最反直觉的事实是路径查找本身几乎从不进入内核空间。dcache（目录项缓存）哈希表查找在 RCU 读锁下运行 —— 不获取锁，不进行原子操作，不发生缓存行反弹。这意味着路径查找随 CPU 数量线性扩展：100 颗 CPU 可以同时查找路径而没有任何争用。这就是为什么 Linux 可以处理数百万文件而不会使路径查找成为瓶颈。 -->

<!-- more -->

> **核心要点**
> - open() 不读取文件内容 —— 它只建立访问路径（dentry + file 结构）
> - 路径查找逐组件遍历：`/` → `home` → `user` → `file.txt`
> - RCU walk（`lookup_fast()`）是无锁的 —— 无原子操作，无缓存行反弹
> - dcache 哈希表为缓存路径提供 O(1) 查找
> - Negative dcache 缓存"文件未找到"结果以避免重复磁盘 I/O
> - `lookup_slow()` 仅在 dcache 未命中时回退到磁盘 I/O

---

## 误区："open() 读取文件"

心智模型：`open("file.txt")` → 内核从磁盘读取文件元数据 → 返回文件描述符。这是错误的。

实际发生的是：

```
  open("file.txt")
       │
       ▼
  ┌─────────────────────────────────────────────────────────────────────┐
  │ 第 1 阶段：路径解析                                                  │
  │ • 将路径解析为组件："file.txt"                                       │
  │ • 通过 dcache 哈希表遍历每个组件                                      │
  │ • 验证每层的权限                                                     │
  │ • 无磁盘 I/O（如果 dcache 命中）                                     │
  └─────────────────────────────────────────────────────────────────────┘
       │
       ▼
  ┌─────────────────────────────────────────────────────────────────────┐
  │ 第 2 阶段：文件结构创建                                              │
  │ • 分配 struct file                                                  │
  │ • 安装 file_operations（read, write, mmap 等）                       │
  │ • 设置文件标志（O_RDONLY, O_CREAT 等）                               │
  │ • 分配文件描述符                                                     │
  └─────────────────────────────────────────────────────────────────────┘
       │
       ▼
  ┌─────────────────────────────────────────────────────────────────────┐
  │ 第 3 阶段：返回用户态                                                │
  │ • fd_install() — 关联 fd 与 struct file                             │
  │ • 将 fd 返回给调用者                                                 │
  │ • 文件内容未读取 — 首次 read() 时才发生                              │
  └─────────────────────────────────────────────────────────────────────┘
```

文件内容仅在你调用 `read()` 时才被读取 —— 而且只有你实际访问的页（通过页错误）。

---

## 第 1 阶段：路径解析 — 漫长的行走

### `do_sys_openat2()`：入口点

```c
// fs/open.c — do_sys_openat2()
long do_sys_openat2(int dfd, const char __user *filename,
                    struct open_how *how)
{
    struct open_flags op;
    int fd = build_open_flags(how, &op);

    // 分配文件描述符
    fd = get_unused_fd_flags(how->flags);
    if (fd < 0)
        return fd;

    // 解析路径并创建 struct file
    struct file *f = do_filp_open(dfd, tmp, &op);

    // 安装 fd → file 映射
    fd_install(fd, f);
    return fd;
}
```

### `do_filp_open()`：分发到路径行走器

```c
// fs/namei.c — do_filp_open()
struct file *do_filp_open(int dfd, struct filename *pathname,
                         const struct open_flags *op)
{
    struct nameidata nd;
    int flags = op->lookup_flags;
    struct file *filp;

    // 设置 nameidata（行走上下文）
    set_nameidata(&nd, dfd, pathname);

    // 执行实际路径行走
    filp = path_openat(&nd, flags | LOOKUP_RCU, NULL);

    restore_nameidata();
    return filp;
}
```

### `path_openat()`：核心行走器

```c
// fs/namei.c — path_openat()
static struct file *path_openat(struct nameidata *nd, unsigned flags, struct file *filp)
{
    struct path path;
    int error;

    // 行走路径
    error = link_path_walk(nd->name, nd);
    if (error)
        return ERR_PTR(error);

    // 处理最终组件（如果 O_CREAT 则创建）
    error = do_last(nd, &path, filp);
    if (error)
        return ERR_PTR(error);

    return filp;
}
```

---

## `link_path_walk()`：逐组件

这是实际路径遍历发生的地方。对于 `/home/user/file.txt` 这样的路径，它行走：

```
  "/" (根目录)
   │
   ▼
  "home" → 在 dcache 中查找 → 找到 → 验证权限
   │
   ▼
  "user" → 在 dcache 中查找 → 找到 → 验证权限
   │
   ▼
  "file.txt" → 在 dcache 中查找 → 找到 → 验证权限
   │
   ▼
  所有组件已解析 → 继续到 do_last()
```

```c
// fs/namei.c — link_path_walk()
static int link_path_walk(const char *name, struct nameidata *nd)
{
    struct path next;
    int err;

    // 跳过前导斜杠
    while (*name == '/')
        name++;

    // 遍历每个组件
    for (;;) {
        struct qstr this;
        unsigned int c;
        int type;

        // 为 dcache 查找哈希组件名
        err = may_lookup(nd);  // 权限检查
        if (err)
            return err;

        // 获取下一个组件
        name = hash_name(name, &c, &this.len);

        // 在 dcache 中查找
        type = LAST_NORM;
        if (this.name[0] == '.') {
            if (this.len == 1)
                type = LAST_DOT;      // "."
            else if (this.len == 2 && this.name[1] == '.')
                type = LAST_DOTDOT;   // ".."
        }

        // 行走组件
        err = walk_component(nd, &next, type, &this);
        if (err)
            return err;

        // 处理符号链接（如果此组件是符号链接）
        if (type == LAST_NORM && nd->flags & LOOKUP_FOLLOW) {
            err = traverse_link(nd, &next, &this);
            if (err)
                return err;
        }

        // 还有更多组件？
        if (!c)
            return 0;  // 完成
    }
}
```

---

## `lookup_fast()`：RCU 无锁路径

这是路径查找中最关键的函数。它在 RCU 读锁下运行 — 无锁，无原子操作，无缓存行反弹：

```c
// fs/namei.c — lookup_fast()
static int lookup_fast(struct nameidata *nd, struct qstr *name,
                       struct path *path)
{
    struct vfsmount *mnt = nd->mnt;
    struct dentry *parent = nd->path.dentry;
    struct dentry *dentry;
    unsigned int seq;

    // RCU 读锁 — 不获取实际锁！
    rcu_read_lock();

    // 遍历 dcache 哈希表
    dentry = __d_lookup_rcu(parent, name);
    if (!dentry)
        goto out;  // 缓存未命中 — 回退到慢路径

    // 使用 seqcount 验证 dentry
    seq = read_seqcount_retry(&dentry->d_seq, nd->seq);
    if (seq)
        goto out;  // 并发修改 — 重试

    // 找到！设置路径
    path->mnt = mnt;
    path->dentry = dentry;

    rcu_read_unlock();
    return 0;  // 成功 — 未获取任何锁！

out:
    rcu_read_unlock();
    return 1;  // 需要慢路径
}
```

### 为什么 RCU Walk 是革命性的

路径查找的传统锁定需要：
- 每 dentry 自旋锁：热目录上的争用
- 全局 dcache 锁：序列化所有查找
- RW 锁：读者仍然反弹缓存行

RCU walk 消除了所有这些：
- **无锁获取**：`rcu_read_lock()` 是单条每 CPU 变量读取
- **无原子操作**：无 compare-and-swap，无 test-and-set
- **无缓存行反弹**：多颗 CPU 可以同时读取相同的哈希表条目
- **线性扩展**：100 颗 CPU 查找路径零争用

权衡：如果另一颗 CPU 正在并发修改 dentry（例如重命名文件），seqcount 验证失败，我们回退到慢路径。

---

## `lookup_slow()`：回退

当 RCU walk 失败（缓存未命中或并发修改）时，内核回退到 `lookup_slow()`：

```c
// fs/namei.c — lookup_slow()
static int lookup_slow(struct nameidata *nd, struct qstr *name,
                       struct path *path)
{
    struct dentry *parent = nd->path.dentry;
    struct dentry *dentry;
    unsigned int seq;

    // 获取 inode 锁（共享）— 这是慢的部分
    inode_lock_shared(parent->d_inode);

    // 在锁下查找 dcache
    dentry = __d_lookup(parent, name);
    if (dentry) {
        inode_unlock_shared(parent->d_inode);
        return 0;  // 在缓存中找到
    }

    // 缓存未命中 — 分配新 dentry
    dentry = d_alloc_parallel(parent, name, &nd->done);
    if (IS_ERR(dentry)) {
        inode_unlock_shared(parent->d_inode);
        return PTR_ERR(dentry);
    }

    // 仍不在缓存中 — 需要磁盘 I/O
    if (!dentry->d_inode) {
        struct inode *inode = dir_inode->i_op->lookup(dir_inode, dentry, 0);
        // ^^^ 这触发磁盘 I/O 读取目录项
        d_instantiate(dentry, inode);
    }

    inode_unlock_shared(parent->d_inode);
    return 0;
}
```

### `d_alloc_parallel()`：处理并发查找

多颗 CPU 可能同时查找相同的缺失路径。`d_alloc_parallel()` 处理这个：

```c
// fs/dcache.c — d_alloc_parallel()
struct dentry *d_alloc_parallel(struct dentry *parent, const struct qstr *name,
                                wait_queue_head_t *wq)
{
    struct dentry *dentry;
    unsigned int hash = name->hash;

    // 检查另一颗 CPU 是否已分配此 dentry
    dentry = d_lookup(parent, name);
    if (dentry)
        return dentry;  // 其他人创建了它 — 使用它的

    // 分配新 dentry
    dentry = d_alloc(parent, name);
    if (!dentry)
        return ERR_PTR(-ENOMEM);

    // 插入哈希表（可能与其他 CPU 竞争）
    return __d_add_to_parallel(parent, dentry, hash, wq);
}
```

---

## dcache：目录项缓存

### 哈希表结构

```c
// fs/dcache.c
static struct hlist_bl_head *dentry_hashtable;
#define HASHBITS    16
#define HASHTAB_SIZE (1 << HASHBITS)

// 每个哈希桶是一个位锁定的链表头
struct hlist_bl_head {
    struct hlist_bl_node *first;
};
```

dcache 哈希表映射 `(parent_dentry, name_hash)` → `dentry`。查找平均 O(1)。

### Negative Dentries

当文件不存在时，内核将这个事实缓存为"negative dentry"：

```c
// negative dentry 有 d_inode == NULL
if (!dentry->d_inode) {
    // 文件不存在 — 这是一个 negative dentry
    // 未来对相同路径的查找将命中此缓存
}
```

negative dentry 防止对不存在文件的重复磁盘 I/O。这就是为什么 `stat()` 对不存在文件在第一次调用后很快。

---

## 深度细节：`struct nameidata` 与 seqcount

`nameidata` 结构携带行走状态：

```c
// fs/namei.c
struct nameidata {
    struct path path;           // 当前位置
    struct qstr last;           // 最后组件名
    struct path root;           // 行走根目录
    struct inode *inode;        // path.dentry.d_inode
    unsigned int flags, state;
    unsigned seq, next_seq, m_seq, r_seq;  // RCU 的序列计数
    enum last_type last_type;   // LAST_NORM, LAST_ROOT, LAST_DOT, LAST_DOTDOT
    unsigned depth;             // 符号链接嵌套深度
    int total_link_count;       // 跟踪的符号链接总数
    struct saved *stack;        // 符号链接栈（EMBEDDED_LEVELS 内联）
    struct filename *name;
};
```

seqcount 字段（`seq`、`next_seq`、`m_seq`、`r_seq`）验证 RCU 读取：
- `seq`：dentry seqcount 快照
- `next_seq`：父 dentry seqcount
- `m_seq`：挂载 seqcount
- `r_seq`：根 seqcount

如果任何 seqcount 在 RCU 读取期间改变，行走通过慢路径重试。

---

## 如何观测路径查找

### 使用 bpftrace

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

### 使用 perf

```bash
// 分析路径查找开销
perf record -e cycles:k -g -- ./benchmark_open
perf report | head -30

// 计算 dcache 命中/未命中
perf stat -e dcache_hits,dcache_misses ./benchmark_stat
```

### 使用 /proc

```bash
// Dcache 统计
cat /proc/sys/fs/dentry-state
// 输出：nr_dentry nr_unused age_limit want_pages

// Inode 缓存统计
cat /proc/sys/fs/inode-nr
```

---

## 常见问题

### open() 的成本是多少？
典型成本：缓存路径 1-10 微秒。细分：
- 路径查找（dcache 命中）：~0.5-2 μs
- 权限检查：~0.5 μs
- 文件结构分配：~0.5 μs
- fd 分配：~0.2 μs

### 为什么路径查找使用 RCU？
RCU 允许 dcache 哈希表的无锁读取。多颗 CPU 可以同时查找路径而没有任何争用。这对大型系统的可扩展性至关重要。

### dcache 未命中时会发生什么？
内核回退到 `lookup_slow()`，它获取 inode 锁并可能触发磁盘 I/O 从文件系统读取目录项。

### 什么是 negative dentry？
缓存的"文件未找到"结果。它们防止对不存在文件的重复磁盘 I/O。Negative dentry 在内存压力下从缓存中驱逐。

### 符号链接跟踪如何工作？
当路径组件是符号链接时，`traverse_link()` 解析它并继续行走。内核将符号链接嵌套限制为 40 层以防止无限循环。

---

## 总结

`open()` 远不止"找到文件并返回句柄"。它涉及通过 dcache 哈希表的路径解析（在常见情况下 RCU 无锁）、每层权限验证、缓存未命中时的 dentry 分配，以及文件结构创建。实际文件内容在 `open()` 期间从不读取 — 那发生在第一次 `read()` 调用时通过页错误。

性能的关键是 dcache + RCU 组合：哈希表提供 O(1) 查找，RCU 允许无锁并发访问。这就是为什么 Linux 可以处理数百万文件而不会使路径查找成为瓶颈。

---

## 来源

- Linux 内核源码, `fs/namei.c`, `link_path_walk()`
- Linux 内核源码, `fs/namei.c`, `lookup_fast()`
- Linux 内核源码, `fs/namei.c`, `lookup_slow()`
- Linux 内核源码, `fs/dcache.c`, `__d_lookup_rcu()`
- Linux 内核源码, `fs/dcache.c`, `d_alloc_parallel()`
- Linux 内核源码, `fs/namei.c`, `do_filp_open()`
