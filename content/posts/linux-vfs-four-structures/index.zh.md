---
title: "inode、dentry、file、super_block 究竟是什么？——VFS 的四大金刚"
description: "VFS 有四个核心结构协同工作：inode（身份）、dentry（名称缓存）、file（打开上下文）、super_block（文件系统实例）。源码分析揭示它们的隐秘关系。"
coverImage: "/posts/linux-vfs-four-structures/images/cover.jpg"
coverImageAlt: "一个存储芯片，代表构成 Linux 虚拟文件系统层的四个核心 VFS 结构：inode、dentry、file 和 super_block"
ogImage: "/posts/linux-vfs-four-structures/images/cover.jpg"
date: "2026-09-06 08:00:00"
lastUpdated: "2026-09-06 08:00:00"
author: "FindNS94"
tags: ["Linux", "Kernel", "FileSystem"]
---

![一个存储芯片，代表构成 Linux 虚拟文件系统层的四个核心 VFS 结构：inode、dentry、file 和 super_block](/posts/linux-vfs-four-structures/images/cover.jpg)

# inode、dentry、file、super_block 究竟是什么？——VFS 的四大金刚

每个 Linux 开发者都知道"一切皆文件"。但在内核中，文件究竟是什么？答案涉及四个协同工作的不同数据结构：`struct inode`（文件身份）、`struct dentry`（目录中的名称）、`struct file`（打开的文件上下文）和 `struct super_block`（文件系统实例）。这四个结构形成了虚拟文件系统（VFS）层的核心，理解它们的关系是理解 Linux 文件系统如何工作的关键。

本文通过分析 `include/linux/fs.h` 中的源码来解释每个结构、它们如何相互引用，以及为什么内核需要四个独立结构而不是一个。

<!-- [UNIQUE INSIGHT] 关于 VFS 最反直觉的事实是单个文件可以有多个名称（硬链接）、多个打开上下文（重复 open()）甚至同时存在于多个文件系统上（绑定挂载）。这四个 VFS 结构正是为了处理这些多对多关系而设计的：一个 inode → 多个 dentry，一个 dentry → 多个 file，一个 super_block → 多个 inode。 -->

<!-- more -->

> **核心要点**
> - inode = 文件身份（元数据、权限、大小）— 磁盘上每个文件一个
> - dentry = 目录项（名称 → inode 映射）— 缓存在 dcache 哈希表中
> - file = 打开的文件上下文（位置、标志、操作）— 每次 open() 调用一个
> - super_block = 文件系统实例 — 每个挂载的文件系统一个
> - 一个 inode 可以有多个 dentry（硬链接），一个 dentry 可以有多個 file（重复 open）
> - `container_of` 宏实现 C 语言中的 OOP 风格继承

---

## 误区："文件就是 inode"

许多开发者将"文件"等同于"inode"。虽然 inode 包含文件的元数据，但它只是拼图的一部分。考虑当你：

1. 创建硬链接：`ln file.txt link.txt` — 两个名称，一个 inode
2. 打开文件两次：`fd1 = open("file.txt"); fd2 = open("file.txt")` — 两个文件上下文，一个 inode
3. 绑定挂载：`mount --bind /a /b` — 同个 inode 可从两个路径访问

单个结构无法表示所有这些关系。这就是为什么 VFS 有四个。

---

## inode：文件身份

inode 代表文件的持久身份 — 在所有文件描述符关闭后仍然存在的一切：

```c
// include/linux/fs.h
struct inode {
    umode_t          i_mode;       // 文件类型与权限（rwxrwxrwx）
    kuid_t           i_uid;        // 所有者 UID
    kgid_t           i_gid;        // 所有者 GID
    const struct inode_operations *i_op;   // inode 操作（create, mkdir, lookup）
    struct super_block *i_sb;      // 所属超级块
    struct address_space *i_mapping; // 页缓存映射
    u64              i_ino;        // inode 编号（文件系统中唯一）
    loff_t           i_size;       // 文件大小（字节）
    struct timespec64 i_atime;     // 访问时间
    struct timespec64 i_mtime;     // 修改时间
    struct timespec64 i_ctime;     // 更改时间
    struct hlist_node i_hash;      // inode 哈希表节点
    struct list_head i_lru;        // inode LRU 链表
    struct address_space i_data;   // 内嵌页缓存
    union {
        struct pipe_inode_info *i_pipe;  // 管道特定数据
        struct cdev *i_cdev;             // 字符设备
        char *i_link;                    // 符号链接目标
    };
    void *i_private;               // 文件系统特定数据（如 ext4_inode_info）
};
```

### 关键字段

- **`i_mode`**：文件类型（普通、目录、符号链接、设备）和权限
- **`i_size`**：文件大小 — 写入时更新，lseek(SEEK_END) 时读取
- **`i_ino`**：inode 编号 — 在文件系统内唯一（但跨文件系统不唯一）
- **`i_mapping`**：指向该文件的页缓存（address_space）
- **`i_op`**：inode 操作函数表（create, mkdir, unlink, lookup）
- **`i_fop`**：文件操作函数表（read, write, mmap, fsync）

### Union 技巧

`struct inode` 末尾的 `union` 在互斥用途之间共享内存：
- 管道 inode 使用 `i_pipe`
- 字符设备使用 `i_cdev`
- 符号链接使用 `i_link`

这节省了内存，因为文件一次只能是一种类型。

---

## dentry：名称缓存

dentry（目录项）代表目录中的一个名称。它是内核的"名称 → inode"映射缓存：

```c
// include/linux/dcache.h
struct dentry {
    unsigned int d_flags;
    seqcount_spinlock_t d_seq;     // 用于 RCU 遍历的每 dentry seqcount
    struct hlist_bl_node d_hash;   // 查找哈希链表
    struct dentry *d_parent;       // 父目录
    const struct qstr d_name;      // 组件名称
    struct inode *d_inode;         // 关联的 inode（NULL = negative）
    const struct dentry_operations *d_op;
    struct super_block *d_sb;      // 文件系统根 dentry
    struct lockref d_lockref;      // 每 dentry 锁 + 引用计数
    struct list_head d_lru;        // LRU 链表
    struct hlist_node d_sib;       // 父目录子链表
    struct hlist_head d_children;  // 我们的子目录
    union {
        struct hlist_node d_alias;     // inode 别名链表
        struct hlist_bl_node d_in_lookup_hash;  // 查找中的 negative
        struct rcu_head d_rcu;
    };
};
```

### 关键字段

- **`d_name`**：组件名称（如 "/home/user/file.txt" 中的 "file.txt"）
- **`d_inode`**：关联的 inode（negative dentry 为 NULL — "文件未找到"）
- **`d_parent`**：父目录 dentry
- **`d_children`**：子 dentry（用于目录）
- **`d_alias`**：链接指向同一 inode 的所有 dentry（硬链接）
- **`d_lockref`**：锁 + 引用计数的原子组合，用于快速 try_get 路径

### Negative Dentry

当文件不存在时，内核将这个事实缓存为"negative dentry"（`d_inode == NULL`）。这防止对不存在文件的重复磁盘 I/O。

---

## file：打开上下文

`struct file` 代表打开的文件上下文 — 特定于某次 `open()` 调用的一切：

```c
// include/linux/fs.h
struct file {
    spinlock_t f_lock;
    fmode_t f_mode;                // FMODE_READ/WRITE/EXEC/CAN_READ/CAN_WRITE/...
    const struct file_operations *f_op;  // 文件操作（read, write, mmap）
    struct address_space *f_mapping;     // 页缓存映射
    void *private_data;            // 文件系统特定数据
    struct inode *f_inode;         // 关联的 inode
    unsigned int f_flags;          // O_NONBLOCK, O_APPEND, O_DIRECT 等
    loff_t f_pos;                  // 文件偏移（当前读/写位置）
    struct path f_path;            // (dentry, vfsmount) 对
    file_ref_t f_ref;              // 引用计数
    struct file_ra_state f_ra;     // readahead 状态
};
```

### 关键字段

- **`f_pos`**：当前文件偏移 — 由读/写操作推进
- **`f_flags`**：打开标志（O_NONBLOCK, O_APPEND, O_DIRECT, O_SYNC）
- **`f_mode`**：访问模式（读、写、执行）— 在打开时检查
- **`f_op`**：文件操作函数表（read, write, mmap, fsync, poll）
- **`f_ref`**：引用计数 — 文件保持打开直到所有 fd 关闭
- **`f_ra`**：readahead 状态 — 追踪顺序访问模式

### 为什么与 inode 分离？

多次 `open()` 调用创建多个 `struct file` 实例，每个都有自己的 `f_pos` 和 `f_flags`。这就是为什么两个进程可以同时以不同位置读取同一文件。

---

## super_block：文件系统实例

super_block 代表挂载的文件系统实例：

```c
// include/linux/fs.h
struct super_block {
    struct list_head s_list;       // 所有超级块链表
    dev_t s_dev;                   // 设备标识符
    unsigned char s_blocksize_bits;// 块大小（2 的幂）
    loff_t s_maxbytes;             // 最大文件大小
    struct file_system_type *s_type; // 文件系统类型（ext4, xfs 等）
    const struct super_operations *s_op;  // 超级块操作（write_inode, put_super）
    unsigned long s_flags;         // SB_RDONLY, SB_SYNCHRONOUS 等
    unsigned long s_magic;         // 魔数（EXT4_SUPER_MAGIC = 0xEF53）
    struct dentry *s_root;         // 文件系统根 dentry
    struct rw_semaphore s_umount;  // 卸载信号量
    atomic_t s_active;             // 活跃引用计数
    void *s_fs_info;               // 文件系统特定数据（ext4_sb_info 等）
    struct list_lru s_dentry_lru;  // 此 sb 的 dentry LRU
    struct list_lru s_inode_lru;   // 此 sb 的 inode LRU
    struct list_head s_inodes;     // 所有 inode
    struct shrinker *s_shrink;     // 每 sb shrinker
};
```

### 关键字段

- **`s_type`**：文件系统类型（ext4, xfs, btrfs 等）
- **`s_root`**：挂载文件系统的根 dentry
- **`s_op`**：超级块操作（write_inode, put_super, sync_fs）
- **`s_fs_info`**：文件系统特定数据（如 ext4 的 ext4_sb_info）
- **`s_dentry_lru`** / **`s_inode_lru`**：用于收缩缓存 dentry/inode 的 LRU 链表

---

## 关系网络

```
  ┌─────────────────────────────────────────────────────────────────────┐
  │                         super_block                                 │
  │                         （文件系统）                                 │
  │                                                                     │
  │  ┌───────────────────────────────────────────────────────────────┐ │
  │  │                        inode（文件身份）                        │ │
  │  │                        （磁盘上每个文件一个）                   │ │
  │  │                                                               │ │
  │  │  ┌─────────────────────────────────────────────────────────┐ │ │
  │  │  │              dentry（名称 → inode 映射）                │ │ │
  │  │  │              （每个名称一个，缓存在 dcache）             │ │ │
  │  │  │                                                         │ │ │
  │  │  │  ┌───────────────────────────────────────────────────┐ │ │ │
  │  │  │  │          file（打开文件上下文）                   │ │ │ │
  │  │  │  │          （每次 open() 调用一个）                 │ │ │ │
  │  │  │  └───────────────────────────────────────────────────┘ │ │ │
  │  │  │  ┌───────────────────────────────────────────────────┐ │ │ │
  │  │  │  │          file（另一个打开上下文）                 │ │ │ │
  │  │  │  │          （不同 fd，不同 f_pos）                  │ │ │ │
  │  │  │  └───────────────────────────────────────────────────┘ │ │ │
  │  │  └─────────────────────────────────────────────────────────┘ │ │
  │  │  ┌─────────────────────────────────────────────────────────┐ │ │
  │  │  │              dentry（硬链接名称）                       │ │ │
  │  │  │              （不同名称，相同 inode）                   │ │ │
  │  │  └─────────────────────────────────────────────────────────┘ │ │
  │  └───────────────────────────────────────────────────────────────┘ │
  │  ┌───────────────────────────────────────────────────────────────┐ │
  │  │                        inode（另一个文件）                    │ │
  │  └───────────────────────────────────────────────────────────────┘ │
  └─────────────────────────────────────────────────────────────────────┘
```

### 多对多关系

- **一个 inode → 多个 dentry**：硬链接（`ln file.txt link.txt`）
- **一个 dentry → 多个 file**：重复 `open()` 调用
- **一个 super_block → 多个 inode**：文件系统中的所有文件
- **一个 inode → 一个 super_block**：一个 inode 恰好属于一个文件系统

---

## 深度细节：`container_of` 继承

Linux 使用 `container_of` 宏在 C 语言中实现 OOP 风格继承：

```c
// include/linux/container_of.h
#define container_of(ptr, type, member) \
    ((type *)((char *)(ptr) - offsetof(type, member)))
```

### 示例

```c
// 从 struct sock 到 struct tcp_sock
static inline struct tcp_sock *tcp_sk(const struct sock *sk)
{
    return container_of(sk, struct tcp_sock, inet_conn);
}

// 从 struct sock 到 struct unix_sock
static inline struct unix_sock *unix_sk(const struct sock *sk)
{
    return container_of(sk, struct unix_sock, sk);
}

// 从 struct inode 到 struct mqueue_inode_info
static inline struct mqueue_inode_info *MQUEUE_I(struct inode *inode)
{
    return container_of(inode, struct mqueue_inode_info, vfs_inode);
}
```

这种模式允许内核将通用结构（如 `struct sock`）嵌入特定结构（如 `tcp_sock`）中，并从通用结构的指针恢复特定结构。

---

## 如何观测 VFS 结构

### 使用 bpftrace

```bash
#!/usr/bin/env bpftrace
// trace_vfs.bt

kprobe:d_alloc
{
    @dentry_alloc[comm] = count();
}

kprobe:d_lookup
{
    @dentry_lookup[comm] = count();
}

kprobe:alloc_inode
{
    @inode_alloc[comm] = count();
}

kprobe:open_exec
{
    @exec[comm] = count();
}
```

### 使用 /proc 和 /sys

```bash
// Dcache 统计
cat /proc/sys/fs/dentry-state

// Inode 缓存统计
cat /proc/sys/fs/inode-nr

// 文件系统信息
cat /proc/mounts
cat /proc/self/mountinfo

// 每进程打开文件
ls -la /proc/<pid>/fd/
```

---

## 常见问题

### 硬链接和符号链接有什么区别？
硬链接是指向同一 inode 的第二个 dentry。符号链接是包含路径字符串的特殊文件。硬链接共享相同的 inode（相同权限、大小、数据）；符号链接有自己的 inode。

### 为什么 `rm` 不立即释放磁盘空间？
`rm` 只移除 dentry（名称 → inode 映射）。仅当链接计数达到零且没有文件描述符引用时，inode 及其数据才会被释放。

### 文件在打开时删除会发生什么？
dentry 被移除（名称消失），但 inode 持续存在直到所有文件描述符关闭。进程仍可通过其打开的 fd 读写。

### `dup()` 如何工作？
`dup()` 创建指向同一 `struct file` 的新文件描述符。两个 fd 共享相同的文件偏移和标志。

### `O_RDONLY` 和 `FMODE_READ` 有什么区别？
`O_RDONLY` 是传递给 `open()` 的用户空间标志。`FMODE_READ` 是存储在 `file->f_mode` 中的内核内部表示。

---

## 总结

四个 VFS 结构 — inode、dentry、file 和 super_block — 协同工作来表示 Linux 中的文件。inode 是文件的身份，dentry 是其在目录中的名称，file 是打开上下文，super_block 是文件系统实例。它们的多对多关系（硬链接、重复打开、绑定挂载）是 Linux 文件系统层灵活而强大的原因。

理解这些结构对于文件系统开发、性能调优和调试至关重要。实际要点是：硬链接共享 inode，重复打开创建独立的文件上下文，`container_of` 宏使得构成 VFS 层的 OOP 风格继承成为可能。

---

## 来源

- Linux 内核源码, `include/linux/fs.h`, `struct inode`
- Linux 内核源码, `include/linux/dcache.h`, `struct dentry`
- Linux 内核源码, `include/linux/fs.h`, `struct file`
- Linux 内核源码, `include/linux/fs.h`, `struct super_block`
- Linux 内核源码, `include/linux/container_of.h`
