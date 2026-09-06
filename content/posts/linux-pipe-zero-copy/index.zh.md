---
title: "调用 pipe() 时究竟发生了什么？——环形缓冲区与零拷贝魔法"
description: "pipe() 不是简单的内核缓冲区。它使用页大小缓冲区的环形数组，head/tail 索引。页窃取实现零拷贝 splice()。源码分析揭示机制。"
coverImage: "/posts/linux-pipe-zero-copy/images/cover.jpg"
coverImageAlt: "一个球，代表 Linux 内核的 pipe 实现 — 页大小缓冲区的环形数组，具有零拷贝页窃取"
ogImage: "/posts/linux-pipe-zero-copy/images/cover.jpg"
date: "2026-09-06 15:00:00"
lastUpdated: "2026-09-06 15:00:00"
author: "FindNS94"
tags: ["Kernel", "Linux"]
---

![一个球，代表 Linux 内核的 pipe 实现 — 页大小缓冲区的环形数组，具有零拷贝页窃取](/posts/linux-pipe-zero-copy/images/cover.jpg)

# 调用 pipe() 时究竟发生了什么？——环形缓冲区与零拷贝魔法

每个 Unix 开发者都使用过 `pipe()` — 它是最古老的 IPC 机制之一。大多数人想象它是简单的内核缓冲区：从一端写入数据，从另一端读出。但实际实现要有趣得多。

pipe 是**页大小缓冲区的环形数组**（默认 16 页 = 64 KB）。内核跟踪自然回绕的 `head` 和 `tail` 索引（2 的幂次环形大小）。最聪明的技巧：**页窃取** — 当数据通过 `splice()` 从文件移动到管道时，内核不拷贝数据。它"窃取"页指针，将相同的物理页映射到文件的页缓存和管道的缓冲区中。

本文通过 `fs/pipe.c` 中的 pipe 源码来解释环形缓冲区、`pipe_buffer` 操作表，以及 `splice()` 如何实现零拷贝。

<!-- [UNIQUE INSIGHT] 关于 pipe 最反直觉的事实是 `splice()` 可以将数据从文件移动到 socket 而无需拷贝到用户态。内核从文件的页缓存中"窃取"页面并映射到管道的环形缓冲区中。数据不移动 — 只转移页指针。这就是 `sendfile()` 实现零拷贝的方式：文件 → 管道 → socket，全在内核空间。 -->

<!-- more -->

> **核心要点**
> - pipe() 创建 16 个页大小缓冲区的环形数组（默认 64 KB）
> - head/tail 索引自然回绕（2 的幂次环形大小）
> - `pipe_buffer` 有 `ops` 函数表：confirm, release, try_steal, get
> - 页窃取：`splice()` 无需拷贝即可移动数据（转移页指针）
> - `F_SETPIPE_SZ` 可将管道增长到 1 MB（可配置）
> - `PIPE_MIN_DEF_BUFFERS`：至少 2 个缓冲区（GNU make jobserver 需要）

---

## 误区："pipe() 是简单的内核缓冲区"

心智模型：`pipe()` 创建内核缓冲区 → `write()` 放入数据 → `read()` 取出数据。这是错误的。

实际发生的是：

```
  pipe(fildes)
       │
       ▼
  ┌─────────────────────────────────────────────────────────────────────┐
  │ do_pipe2() — fs/pipe.c                                              │
  │ • 分配 pipe_inode_info                                              │
  │ • 分配 16 个 pipe_buffer 结构（每个 = 1 页 = 4 KB）                 │
  │ • 创建两个 struct file：读端 + 写端                                  │
  │ • 用 fd_install() 安装两者                                          │
  └─────────────────────────────────────────────────────────────────────┘
       │
       ▼
  ┌─────────────────────────────────────────────────────────────────────┐
  │ 环形缓冲区结构                                                       │
  │                                                                     │
  │  ┌─────┐ ┌─────┐ ┌─────┐ ┌─────┐ ┌─────┐ ┌─────┐ ┌─────┐ ┌─────┐ │
  │  │ buf │ │ buf │ │ buf │ │ buf │ │ buf │ │ buf │ │ buf │ │ buf │ │
  │  │  0  │ │  1  │ │  2  │ │  3  │ │  4  │ │  5  │ │  6  │ │  7  │ │
  │  └─────┘ └─────┘ └─────┘ └─────┘ └─────┘ └─────┘ └─────┘ └─────┘ │
  │     ↑                                       ↑                       │
  │   tail                                    head                      │
  │   （读）                                 （写）                      │
  └─────────────────────────────────────────────────────────────────────┘
```

---

## 环形缓冲区

```c
// include/linux/pipe_fs_i.h
struct pipe_inode_info {
    struct mutex mutex;
    wait_queue_head_t rd_wait, wr_wait;
    unsigned int head, tail;         // 环形缓冲区索引
    unsigned int max_usage;
    unsigned int ring_size;          // 2 的幂次，默认 16
    unsigned int nr_accounted;
    unsigned int readers, writers, files;
    unsigned int r_counter, w_counter;
    bool pseudo_edgetrigger;
    struct anon_pipe_prealloc prealloc;
    struct fasync_struct *fasync_readers, *fasync_writers;
    struct pipe_buffer *bufs;        // pipe 缓冲区数组（环形）
    struct user_struct *user;
};
```

### `pipe_buffer`：缓冲区结构

```c
// include/linux/pipe_fs_i.h
struct pipe_buffer {
    struct page *page;      // 物理页
    unsigned int offset, len;
    const struct pipe_buf_operations *ops;
    unsigned int flags;
};
```

### `pipe_buf_operations`：函数表

```c
// include/linux/pipe_fs_i.h
struct pipe_buf_operations {
    int (*confirm)(struct pipe_inode_info *, struct pipe_buffer *);
    void (*release)(struct pipe_inode_info *, struct pipe_buffer *);
    bool (*try_steal)(struct pipe_inode_info *, struct pipe_buffer *);
    bool (*get)(struct pipe_inode_info *, struct pipe_buffer *);
};
```

---

## 深度细节：页窃取

### 问题：拷贝昂贵

将数据从文件移动到 socket 传统上需要：
1. 读文件 → 内核缓冲区
2. 拷贝内核缓冲区 → 用户态
3. 拷贝用户态 → 内核缓冲区
4. 写内核缓冲区 → socket

那是 4 次拷贝。页窃取消除了所有这些。

### `splice()`：零拷贝

```c
// fs/splice.c — do_splice()
ssize_t do_splice(struct file *in, loff_t *ppos, struct file *out,
                  loff_t *opos, size_t len, unsigned int flags)
{
    struct pipe_inode_info *pipe = get_pipe_info(out, true);

    // 从文件拼接到管道
    if (pipe) {
        // 尝试从文件的页缓存窃取页面
        if (in->f_op->splice_read)
            return in->f_op->splice_read(in, ppos, pipe, len, flags);
    }
    // ...
}
```

### 窃取成功后的结果：

```
  splice 之前：
  文件页缓存：[page A] [page B] [page C]
  管道：       [empty] [empty] [empty]

  splice 之后（页窃取）：
  文件页缓存：[page A] [page B] [page C]
                   ↓         ↓         ↓
  管道：       [page A] [page B] [page C]
              (共享)    (共享)    (共享)

  数据未被拷贝 — 只转移了页指针！
```

---

## 如何观测 Pipe 行为

### 使用 /proc

```bash
// 每进程 pipe 使用
ls -la /proc/<pid>/fd/ | grep pipe

// pipe 容量
cat /proc/sys/fs/pipe-max-size

// F_SETPIPE_SZ 示例
fcntl(fd, F_SETPIPE_SZ, 1048576);  // 增长到 1 MB
```

---

## 常见问题

### 默认 pipe 大小是多少？
64 KB（16 页 × 4 KB）。可通过 `F_SETPIPE_SZ` 配置，最大到 `pipe-max-size`（默认 1 MB）。

### 什么是页窃取？
当 `splice()` 将数据从文件移动到管道时，它"窃取"页指针而不是拷贝数据。相同的物理页在文件的页缓存和管道的缓冲区之间共享。

### 什么时候页窃取失败？
如果页被固定（例如由 DMA 操作）或有特殊标志，窃取失败，内核回退到拷贝。

### `PIPE_MIN_DEF_BUFFERS` 是什么？
至少需要 2 个缓冲区用于 GNU make jobserver 模式，其中多个写入者可能同时阻塞。

### `sendfile()` 如何工作？
`sendfile()` 在内部使用 `splice()`：文件 → 管道 → socket，全在内核空间通过零拷贝页窃取。

---

## 总结

pipe 不是简单的内核缓冲区 — 它是页大小缓冲区的环形数组，带有 head/tail 索引。最聪明的技巧是页窃取：`splice()` 无需拷贝即可移动数据，通过转移页指针。这实现了从文件到 socket 的零拷贝数据传输。

对于生产系统，实际要点是：pipe 使用环形缓冲区（2 的幂次大小），页窃取启用零拷贝，`splice()`/`sendfile()` 利用这点实现高性能 I/O。

---

## 来源

- Linux 内核源码, `fs/pipe.c`, `pipe_write()` 和 `pipe_read()`
- Linux 内核源码, `fs/splice.c`, `do_splice()`
- Linux 内核源码, `include/linux/pipe_fs_i.h`, `pipe_inode_info`
- Linux 内核源码, `include/linux/pipe_fs_i.h`, `pipe_buf_operations`
