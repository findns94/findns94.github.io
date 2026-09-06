---
title: "当 socket 形成环——Unix domain socket 的垃圾回收"
description: "Unix domain socket 可以通过 SCM_RIGHTS 传递形成引用环（A→B→C→A）。内核执行 mark-and-sweep GC 检测并回收不可达的 socket 环。源码分析揭示算法。"
coverImage: "/posts/linux-unix-socket-gc/images/cover.jpg"
coverImageAlt: "一座建筑，代表 Linux 内核对形成引用环的 Unix domain socket 的垃圾检测机制"
ogImage: "/posts/linux-unix-socket-gc/images/cover.jpg"
date: "2026-09-06 17:00:00"
lastUpdated: "2026-09-06 17:00:00"
author: "FindNS94"
tags: ["Kernel", "Linux"]
---

![一座建筑，代表 Linux 内核对形成引用环的 Unix domain socket 的垃圾检测机制](/posts/linux-unix-socket-gc/images/cover.jpg)

# 当 socket 形成环——Unix domain socket 的垃圾回收

每个 Unix 开发者都知道 domain socket 用于本地 IPC。但很少有人知道内核有 socket 的**垃圾回收器**。不是内存回收 — 是 socket 引用环回收。

当进程通过 `SCM_RIGHTS` 相互传递文件描述符时，它们引用的 socket 可以形成环：socket A 引用 socket B，B 引用 C，C 引用 A。如果没有进程拥有这些 socket 中任何一个的文件描述符，它们就不可达 — 但它们不会被释放，因为它们相互引用。

本文通过 `net/unix/garbage.c` 中的 Unix domain socket GC 源码来解释内核如何检测和回收这些不可达的 socket 环。

<!-- [UNIQUE INSIGHT] 关于 Unix domain socket 最反直觉的事实是它们可以形成阻止回收的环。当进程 A 发送 fd 给进程 B，进程 B 发送 fd 给进程 C，进程 C 发送 fd 给进程 A，所有三个 socket 都有引用但没有进程可以到达它们。内核的 mark-and-sweep GC 从可达 socket 出发遍历 socket 图，标记它们，然后清扫未标记的 socket 进行回收。这本质上与内存 GC 相同的算法 — 但应用于内核 socket 对象。 -->

<!-- more -->

> **核心要点**
> - Unix socket 可以通过 `SCM_RIGHTS` fd 传递形成引用环
> - `unix_vertex` 跟踪每个 socket 的 in-degree 和 adjacency
> - Mark 阶段：从可达 socket 遍历，标记访问过的
> - Sweep 阶段：回收未标记的 socket
> - GC 每 30 秒触发一次或当 socket 数量超过阈值
> - 抽象命名空间 socket（`sun_path[0] == '\0'`）也被 GC

---

## 问题：Socket 环

### 环如何形成

```
  进程 A ←── fd ──← 进程 C
     │                   ↑
     ↓                   │
  Socket A ─── fd ──→ Socket B
                     │
                     ↓
                  Socket C
```

1. 进程 A 发送 fd 给进程 B（通过 SCM_RIGHTS）
2. 进程 B 发送 fd 给进程 C
3. 进程 C 发送 fd 给进程 A
4. 所有进程退出 — 但 socket 仍然相互引用！

socket 不可达（没有进程有 fd），但它们不会被释放，因为它们相互引用。

### 为什么不用引用计数？

引用计数无法检测环。如果 A→B→C→A，每个的 refcount ≥ 1，所以都不会被释放。内核需要 tracing GC（mark-and-sweep）来检测不可达环。

---

## GC 算法

```c
// net/unix/garbage.c — unix_gc()
void unix_gc(void)
{
    struct unix_sock *u;
    struct unix_vertex *vertex;
    struct list_head cursor;

    // 第 0 阶段：收集所有可能在环中的 socket
    INIT_LIST_HEAD(&cursor);
    list_for_each_entry(u, &unix_socket_list, link) {
        vertex = &unix_sk(u)->vertex;
        if (vertex->degree > 0) {
            list_add(&vertex->edge, &cursor);
        }
    }

    // 第 1 阶段：Mark — 从可达 socket 遍历
    unix_graph_marks(&cursor);

    // 第 2 阶段：Sweep — 回收未标记的 socket
    unix_graph_sweep(&cursor);
}
```

### 第 1 阶段：Mark

```c
// net/unix/garbage.c — unix_graph_marks()
static void unix_graph_marks(struct list_head *cursor)
{
    struct unix_sock *u;
    struct unix_vertex *vertex;

    // 从直接可达的 socket 开始（有文件描述符的）
    list_for_each_entry(vertex, cursor, edge) {
        u = vertex->sock;
        if (u->file) {
            // 这个 socket 有文件描述符 — 可达
            __set_bit(UNIX_GC_MARK, &vertex->mark);

            // 遍历从该 socket 可达的所有 socket
            unix_graph_mark_recursive(vertex, cursor);
        }
    }
}
```

### 第 2 阶段：Sweep

```c
// net/unix/garbage.c — unix_graph_sweep()
static void unix_graph_sweep(struct list_head *cursor)
{
    struct unix_vertex *vertex;
    struct unix_sock *u;

    list_for_each_entry(vertex, cursor, edge) {
        u = vertex->sock;

        if (!__test_bit(UNIX_GC_MARK, &vertex->mark)) {
            // 未标记 — 不可达！回收它
            __sk_free(u);
        } else {
            // 已标记 — 可达，清除标记供下次 GC 使用
            __clear_bit(UNIX_GC_MARK, &vertex->mark);
        }
    }
}
```

---

## `unix_vertex`：图节点

```c
// net/unix/garbage.c
struct unix_vertex {
    struct list_head edge;      // 邻接表（指向其他 socket 的边）
    struct list_head entry;     // GC 游标列表中的条目
    struct unix_sock *sock;     // 此 vertex 代表的 socket;
    unsigned long mark;         // GC 标记位
};
```

每个参与 fd 传递的 socket 在 GC 图中有一个 `unix_vertex`。vertex 跟踪：
- **edge**: 此 socket 引用的 socket 列表
- **mark**: GC 标记位（mark 阶段设置，sweep 阶段检查）
- **sock**: 指向 socket 的回指针

---

## 深度细节：`scm_stat` 与 FD 传递

当进程通过 `SCM_RIGHTS` 发送文件描述符时，内核附加 `scm_stat` 结构：

```c
// net/unix/scm.c
struct scm_stat {
    struct list_head list;      // 此消息中的 fd 列表
    int fd;                     // 文件描述符
    struct file *file;          // 文件（可能是 socket）
};

// GC 期间，这些也被标记
static void unix_mark_scm(struct scm_cookie *scm)
{
    struct scm_fp_list *fpl = scm->fp;
    struct scm_fp *fp;

    list_for_each_entry(fp, &fpl->list, list) {
        if (fp->file && S_ISSOCK(fp->file->f_inode->i_mode)) {
            // 此 fd 指向 socket — 标记它
            struct unix_sock *u = unix_sk(fp->file->private_data);
            __set_bit(UNIX_GC_MARK, &u->vertex.mark);
        }
    }
}
```

这确保被在途 `SCM_RIGHTS` 消息引用的 socket 不会被错误回收。

---

## 如何观测 Unix Socket GC

### 使用 /proc

```bash
// Unix domain socket
cat /proc/net/unix

// Socket 统计
ss -x
```

---

## 常见问题

### GC 何时运行？
每 30 秒（可配置），或当 unix socket 数量超过阈值时。计时器由 `unix_gc_timer_fn()` 管理。

### 什么是 `SCM_RIGHTS`？
Unix domain socket 辅助消息类型，允许在进程间传递文件描述符。内核复制 fd 并将其安装到接收进程中。

### 什么是抽象命名空间？
Unix socket 可以用 `sun_path[0] == '\0'` 创建 — 这些不绑定到文件系统路径。它们只能通过文件描述符访问，也被 GC。

### GC 会导致延迟尖刺？
是的。mark 阶段遍历整个 socket 图，可能很大。sweep 阶段释放不可达 socket。两个阶段都在禁用中断的情况下运行。

### 如何防止 socket 环？
设计应用避免循环 fd 传递。使用星型拓扑（中心枢纽）而非循环引用。

---

## 总结

Unix domain socket 可以通过 `SCM_RIGHTS` fd 传递形成引用环。内核的 mark-and-sweep GC 从可达 socket 出发遍历 socket 图，标记它们，然后清扫未标记的 socket 进行回收。这本质上与内存 GC 相同的算法 — 但应用于内核 socket 对象。

对于生产系统，实际要点是：fd 传递可以创建环，GC 检测和回收不可达 socket，理解算法有助于设计健壮的 IPC 架构。

---

## 来源

- Linux 内核源码, `net/unix/garbage.c`, `unix_gc()`
- Linux 内核源码, `net/unix/garbage.c`, `unix_graph_marks()`
- Linux 内核源码, `net/unix/garbage.c`, `unix_graph_sweep()`
- Linux 内核源码, `net/unix/scm.c`, `unix_mark_scm()`
- Linux 内核源码, `include/net/af_unix.h`, `unix_sock`
