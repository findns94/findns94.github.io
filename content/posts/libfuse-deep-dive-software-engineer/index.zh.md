---
title: "libfuse 源码深度剖析：一个软件工程师的代码阅读指南"
description: "libfuse 驱动着 sshfs、s3fs、mergerfs 等数千个 FUSE 文件系统。本文从源码层面深入剖析请求分发管线、会话生命周期、io_uring 传输层以及高低两级 API，帮你像内部开发者一样阅读代码。"
coverImage: "/posts/libfuse-deep-dive-software-engineer/images/cover.png"
coverImageAlt: "显示 Linux 系统代码的终端屏幕，代表连接用户态文件系统与 Linux 内核的 libfuse 库"
ogImage: "/posts/libfuse-deep-dive-software-engineer/images/cover.png"
date: "2026-08-22 20:00:00"
lastUpdated: "2026-08-22 20:00:00"
author: "FindNS94"
tags: [Linux, Kernel, Open Source]
---

![显示 Linux 系统代码的终端屏幕，代表连接用户态文件系统与 Linux 内核的 libfuse 库](/posts/libfuse-deep-dive-software-engineer/images/cover.png)

# libfuse 源码深度剖析：一个软件工程师的代码阅读指南

每一个你用过的 FUSE 文件系统——用 sshfs 挂载远程服务器、用 s3fs 浏览 S3 存储桶、用 mergerfs 合并多块磁盘、GVfs 为 GNOME 提供挂载支持——本质上都是一个用户态程序，通过同一个库与 `/dev/fuse` 设备对话。这个库就是 **libfuse**，FUSE（Filesystem in Userspace，用户态文件系统）协议的参考实现。它已经随各大 Linux 发行版分发二十余年，在 GitHub 上积累了约 6,100 个 star 和 270 多名贡献者（[libfuse GitHub](https://github.com/libfuse/libfuse)），但其内部实现却鲜有人从代码层面系统性地解读过。

问题在于，libfuse 的代码库相当密集。整个仓库横跨 `lib/`、`include/`、`example/`、`util/`、`test/` 和 `doc/`，C 源码总计约 2.5 MB。它提供了两套截然不同的 API——高级同步 API 和底层异步 API——常常让初学者感到困惑。内核与用户态之间的协议在 `doc/kernel.txt` 中有文档，却从未和分发代码对应起来。而最新的重大特性 `fuse-over-io-uring` 于 3.18.0（2025 年 12 月）加入，至今仍几乎没有公开的深度解读。

本文将弥补这一空缺。我们从源码自上而下地走读：libfuse 是什么、两套 API 有何区别、请求分发管线如何运转、会话生命周期如何管理、io_uring 传输层如何工作、示例文件如何阅读，最后给出一份新手的代码阅读地图。读完后，你将能够读懂 `fuse_lowlevel.c`——这个 144 KB 的核心文件——并准确理解每个函数的作用。

<!-- [UNIQUE INSIGHT] 大多数教程从消费者视角（如何编写一个文件系统）解释 FUSE。本文从库的视角（libfuse 本身如何构建）来剖析。理解库的内部实现，能让你成为更好的 FUSE 开发者——你会清楚地看到高级 API 在底层究竟引入了多少开销，以及何时应该降级使用底层 API。 -->

<!-- more -->

> **核心要点**
> - libfuse 提供两套 API：**高级 API**（`fuse.c`，基于路径，同步回调）和**底层 API**（`fuse_lowlevel.c`，基于 inode，显式调用 `fuse_reply_*()`）。高级 API 本质上是底层 API 的一层薄封装。
> - 所有 FUSE 操作遵循同一条管线：内核 → `/dev/fuse` → `fuse_session_receive()` → 基于操作码索引的分发表 → 你的回调 → `fuse_reply_*()` → 内核。分发表 `fuse_ll_ops[]` 是整个库最重要的数据结构。
> - `fuse-over-io-uring`（3.18.0，2025 年 12 月）用 io_uring 替代了 `/dev/fuse` 上的 read/write 系统调用——每个 CPU 核心一个队列——降低了系统调用开销。启用方式：先 `echo 1 > /sys/module/fuse/parameters/enable_uring`，再以 `-o io_uring` 挂载（[libfuse README.fuse-io-uring](https://github.com/libfuse/libfuse/blob/master/doc/README.fuse-io-uring)）。
> - 项目处于有限维护状态：除当前维护者外没有活跃的常规贡献者，维护者负责合并 PR 和发布版本，但没有精力进行特性开发（[libfuse README.md](https://github.com/libfuse/libfuse)）。
> - `fusermount3` 以 setuid root 权限安装，强制执行挂载点所有权规则；一个未解决的内核权限缓存 bug（自 2006 年已知，issue #15）影响 `allow_other` 场景。

---

## libfuse 是什么（以及不是什么）

FUSE 采用拆分设计。**内核侧**——`fuse` 内核模块——位于主线 Linux 树中（2005 年合入 kernel 2.6.14）。它拦截 FUSE 挂载文件系统的 VFS 调用，通过 `/dev/fuse` 字符设备将其转发到用户态。**用户态侧**——libfuse，即本仓库——是参考库，负责处理挂载、从 `/dev/fuse` 读取请求、将其分发到你的回调函数，以及写回响应。

libfuse 本身不实现文件系统。它实现的是**协议**——封送处理、能力协商、会话生命周期、回复机制。你的文件系统（sshfs、mergerfs、你自己的实现）链接 libfuse 并填入回调函数。

库提供两套 API，服务于同一协议但抽象层级不同：

```
高级 API（fuse.c，约 122 KB）          底层 API（fuse_lowlevel.c，约 144 KB）
─────────────────────────────          ──────────────────────────────────────
  回调接收路径字符串                        回调接收 inode 编号（fuse_ino_t）
       │                                        │
       ▼                                        ▼
  libfuse 通过内部哈希表                      你自行控制 inode→对象映射
  （node_table）解析 inode                   （无隐式查找，无隐式缓存）
       │                                        │
       ▼                                        ▼
  回调是同步的：返回即自动                   回调是异步的：必须显式调用
  发送回复                                  fuse_reply_*() 才能发送回复
       │                                        │
       ▼                                        ▼
  libfuse 内部处理 inode 缓存、               你通过 fuse_reply_entry() 的
  属性缓存、目录项缓存 TTL                   缓存 TTL 和 fuse_lowlevel_notify_inval_*()
                                              自行控制缓存
       │                                        │
       ▼                                        ▼
  入口：fuse_main()                         入口：fuse_newsession_new()
  （约 50 行样板代码）                        → fuse_session_mount()
                                            → fuse_session_loop[_mt]()
                                            → fuse_session_unmount()
                                            → fuse_session_destroy()
       │                                        │
       ▼                                        ▼
  适用：简单文件系统、原型、                 适用：生产级文件系统、
  sshfs、archivemount                       mergerfs、s3fs、gvfs、高性能 FS
```

高级 API **本质上构建在底层 API 之上**。`fuse.c` 维护一个将 inode 编号映射到路径字符串的哈希表，将基于路径的回调转换为基于 inode 的回调，并在内部调用底层回复函数。当你调用 `fuse_main()` 时，它创建会话、挂载、运行循环、执行清理——所有底层步骤被封装在一个函数中。

> **引用摘要：** libfuse 是 FUSE 协议的参考实现，已被所有主要 Linux 分发版收录，在生产环境中运行超过二十年。它同时提供高级同步 API（基于路径，`fuse_main()`）和底层异步 API（基于 inode，`fuse_session_new()`），其中高级 API 由底层 API 封装实现（[libfuse README.md](https://github.com/libfuse/libfuse)，2025 年）。

---

## 两套公开 API 头文件

深入实现之前，先了解你要 include 的两个头文件：

- **`include/fuse.h`**（51 KB）——高级 API。定义了 `struct fuse_operations`（你的回调表，包含 `getattr`、`read`、`write`、`readdir`、`init`、`destroy` 等）、`fuse_main()`、`struct fuse_args`、`FUSE_ARGS_INIT()` 以及选项解析机制。
- **`include/fuse_lowlevel.h`**（84 KB）——底层 API。定义了 `struct fuse_lowlevel_ops`（基于 inode 的回调：`lookup`、`forget`、`getattr`、`read`、`write` 等）、所有 `fuse_reply_*()` 函数、通知 API（`fuse_lowlevel_notify_inval_inode`、`fuse_lowlevel_notify_inval_entry`、`fuse_lowlevel_notify_store`、`fuse_lowlevel_notify_retrieve`），以及 `struct fuse_session``

两者都引用了 `include/fuse_common.h`（39 KB）中的共享类型——`struct fuse_file_info`、`struct fuse_conn_info`、34+ 个能力标志（`FUSE_CAP_ASYNC_READ`、`FUSE_CAP_WRITEBACK_CACHE`、`FUSE_CAP_PASSTHROUGH`、`FUSE_CAP_OVER_IO_URING`），以及 `struct fuse_args`。而 `include/fuse_kernel.h`（32 KB）定义了有线协议结构体：`struct fuse_in_header`、`struct fuse_out_header`，以及从 `FUSE_LOOKUP`（1）到 `FUSE_STATX`（52）的全部 53 个操作码。

---

## 请求分发管线

这是库的核心。每一个文件系统操作——`read()`、`write()`、`stat()`、`ls`——都遵循相同的路径：经过内核、`/dev/fuse` 设备、libfuse，最终进入你的回调。下面以一次 `write()` 调用为例，沿实际源码追踪完整流程：

```
┌──────────────┐     ┌───────────────┐     ┌──────────────────────┐     ┌───────────────────┐     ┌─────────────────┐
│  应用程序     │     │  Linux 内核   │     │   libfuse 核心        │     │  fuse_lowlevel.c  │     │  你的回调函数     │
│  write()     │     │  FUSE 模块    │     │ （会话循环）          │     │ （分发层）         │     │  （文件系统）     │
└──────┬───────┘     └───────┬───────┘     └──────────┬───────────┘     └────────┬──────────┘     └────────┬────────┘
       │                     │                        │                          │                          │
       │  write(fd, buf, n)  │                        │                          │                          │
       ├────────────────────►│  VFS → fuse_request_send()                         │                          │
       │                     │  入队到 fc->pending     │                          │                          │
       │                     │  ──────────────────────►│  fuse_session_receive()  │                          │
       │                     │                        │  从 /dev/fuse             │                          │
       │                     │                        │  read()/splice()          │                          │
       │                     │                        ├─────────────────────────►│  fuse_session_process_buf()│
       │                     │                        │                          │  校验消息头                │
       │                     │                        │                          │  fuse_ll_alloc_req()      │
       │                     │                        │                          │  fuse_req_parse_extensions│
       │                     │                        │                          │  ── 按操作码分发 ──►       │
       │                     │                        │                          │  fuse_ll_ops[FUSE_WRITE]  │
       │                     │                        │                          │  .func(req, nodeid, inarg)├─► .write()
       │                     │                        │                          │                          │  （执行 I/O）
       │                     │                        │                          │  fuse_reply_write() ◄──────┤
       │                     │  ◄─────────────────────┼──────────────────────────┼──────────────────────────┤
       │                     │  响应通过 writev()     │  fuse_send_msg()         │  send_reply()             │
       │  返回字节数          │  写回 /dev/fuse        │                          │                          │
       ◄─────────────────────┤                        │                          │                          │
```

下面沿源码逐阶段解析。

### 第一阶段：事件循环

单线程循环位于 `lib/fuse_loop.c`——仅 49 行：

```c
// lib/fuse_loop.c（简化）
while (!fuse_session_exited(se)) {
    res = fuse_session_receive_buf_internal(se, &fbuf, NULL);
    if (res == -EINTR) continue;
    if (res <= 0) break;
    fuse_session_process_buf(se, &fbuf);
}
if (se->uring.pool) fuse_uring_stop(se);
```

这就是全部：读缓冲区、处理、重复。多线程版本（`lib/fuse_loop_mt.c`，14 KB）将其包装在动态线程池中——工作线程各自在 `PTHREAD_CANCEL_DISABLE` 下调用 `fuse_session_receive_buf_internal()`，池子在 `numavail == 0` 时扩容，超过 `max_idle` 时缩容空闲线程。

### 第二阶段：接收请求

`_fuse_session_receive_buf()`（`fuse_lowlevel.c`，约第 4332 行）**优先尝试 splice**——一种从 `/dev/fuse` 到管道零拷贝传输，避免将数据拷贝到用户态内存。这要求 `FUSE_CAP_SPLICE_READ` 已协商且协议次版本 ≥ 14。若 splice 不可用，则回退到 `/dev/fuse` 文件描述符上的普通 `read()`。缓冲区大小（`se->bufsize`）是原子变量——内核可在 `FUSE_INIT` 期间请求更大的缓冲区，接收路径会检测来自缓冲区过小的 `EINVAL`，重新分配并重试。

### 第三阶段：处理与分发

`fuse_session_process_buf_internal()`（约第 4000 行）执行核心逻辑：

1. 若缓冲区通过 splice 到来（`FUSE_BUF_IS_FD`），将消息头从管道拷贝到内存。
2. 触发 USDT 跟踪点（`trace_request_process`）供可观测性使用。
3. 分配请求对象：`fuse_ll_alloc_req(se)`。
4. 从消息头填充请求：`fuse_session_in2req(req, in)`。
5. 解析安全上下文扩展：`fuse_req_parse_extensions()`——将 SELinux/LSM 上下文提取到 `req->secctx`。
6. 合理性检查：`fuse_req_opcode_sanity_ok()` 和 `fuse_req_check_allow_root()`。
7. 中断处理：加入 `se->list`，检查挂起的 `FUSE_INTERRUPT` 请求。
8. **分发：** `fuse_ll_ops[in->opcode].func(req, in->nodeid, inarg)`。

### 第四阶段：分发表

分发表是 libfuse 最重要的数据结构。位于 `fuse_lowlevel.c` 第 3686 行：

```c
static struct {
    void (*func)(fuse_req_t, const fuse_ino_t, const void *);
    const char *name;
} fuse_ll_ops[] = {
    [FUSE_LOOKUP]     = { do_lookup,     "LOOKUP" },
    [FUSE_FORGET]     = { do_forget,     "FORGET" },
    [FUSE_GETATTR]    = { do_getattr,    "GETATTR" },
    [FUSE_SETATTR]    = { do_setattr,    "SETATTR" },
    [FUSE_READLINK]   = { do_readlink,   "READLINK" },
    [FUSE_SYMLINK]    = { do_symlink,    "SYMLINK" },
    [FUSE_MKNOD]      = { do_mknod,      "MKNOD" },
    [FUSE_MKDIR]      = { do_mkdir,      "MKDIR" },
    [FUSE_UNLINK]     = { do_unlink,     "UNLINK" },
    [FUSE_RMDIR]      = { do_rmdir,      "RMDIR" },
    [FUSE_RENAME]     = { do_rename,     "RENAME" },
    [FUSE_LINK]       = { do_link,       "LINK" },
    [FUSE_OPEN]       = { do_open,       "OPEN" },
    [FUSE_READ]       = { do_read,       "READ" },
    [FUSE_WRITE]      = { do_write,      "WRITE" },
    [FUSE_STATFS]     = { do_statfs,     "STATFS" },
    [FUSE_RELEASE]    = { do_release,    "RELEASE" },
    [FUSE_FSYNC]      = { do_fsync,      "FSYNC" },
    // ... 全部 38 个操作码，直至 FUSE_SYNCFS、FUSE_STATX、CUSE_INIT
};
#define FUSE_MAXOP (CUSE_INIT + 1)
```

每个 `do_*` 函数是一个内部处理器，从通用 `inarg` 指针中解包操作码专属参数，调用你的回调（存储在 `se->op` 中），然后发送对应的回复。例如 `do_write()` 提取偏移量、大小和文件句柄，调用 `se->op.write()`，然后调用 `fuse_reply_write(req, bytes_written)`。

还存在一张**并行表**——`fuse_ll_ops2[]`（第 3743 行）——其 `_do_*` 变体多接收一个 `op_payload` 指针。这是因为在 io_uring 传输中，负载与消息头是分开到达的（在环形缓冲区中），而非附加在消息头之后。两张表必须保持同步。

### 第五阶段：回复路径

当你的回调完成时，你调用一个 `fuse_reply_*()` 函数。通用路径：

```
fuse_reply_write(req, bytes)
  → send_reply(req, bytes, NULL, 0)
    → fuse_send_reply_iov_nofree()
      → fuse_send_msg()
        → 若 req->flags.is_uring: fuse_send_msg_uring()
          否则: fuse_write_msg_dev()  → writev() 到 /dev/fuse fd
  → fuse_free_req(req)   → 递减引用计数，归零时销毁
```

回复将一个 `struct fuse_out_header`（`error = 0`，`unique` 与请求匹配）连同负载写回 `/dev/fuse`。内核的 `fuse_dev_write()` 唤醒等待的 VFS 调用，应用程序的 `write()` 返回。

<!-- [UNIQUE INSIGHT] fuse_lowlevel.c 中的分发表是整个库最重要的数据结构。理解了它，就理解了完整的请求生命周期。并行的 fuse_ll_ops2[] 表之所以存在，纯粹是因为 io_uring 的负载与消息头是分开传递的——这是传输层变更如何在不改变用户可见 API 的前提下渗透到分发层的一个优雅范例。 -->

---

## 会话与通道生命周期

`struct fuse_session`（定义在 `lib/fuse_i.h`）是核心对象——它代表一个已挂载的文件系统、一个 `/dev/fuse` 文件描述符、一组回调函数。其生命周期如下：

```
fuse_session_new(args, ops, op_size, userdata)
  → 解析选项，分配会话，将回调表复制到 se->op
  → se->fd = -1（尚未挂载）

fuse_set_signal_handlers(se)
  → 安装 SIGINT/SIGTERM/SIGHUP 处理器 → fuse_session_exit()

fuse_session_mount(se, mountpoint)
  → fuse_session_mount_new_api()  [首选：fsopen/fsconfig/fsmount/move_mount]
     或 fuse_kern_mount()         [回退：mount(2) 系统调用]
  → 打开 /dev/fuse，设置 se->fd
  → 内核发送 FUSE_INIT 请求（操作码 1）
  → 会话协商协议版本 + 能力

fuse_session_loop[_mt](se)
  → [见上方分发管线]
  → 运行直到 fuse_session_exited(se) 为真

fuse_session_unmount(se)
  → close(se->fd)，内核发送 FUSE_DESTROY

fuse_remove_signal_handlers(se)
fuse_session_destroy(se)
  → 调用 se->op.destroy(userdata)
  → 释放所有挂起的请求，关闭 fd，释放会话
```

挂载步骤值得关注。libfuse 3.x 优先使用 **新 Linux 挂载 API**（Linux 5.2 引入的 `fsopen()`/`fsconfig()`/`fsmount()`/`move_mount()`），当新 API 不可用时（如旧内核或 libc 不包含封装——glibc 在 2.36 中加入）回退到传统的 `mount(2)` 系统调用。相关代码位于 `lib/mount_fsmount.c`（16 KB）和 `lib/mount.c`（22 KB）。

`FUSE_INIT` 握手至关重要。内核发送一个 `FUSE_INIT` 请求，携带其支持的协议版本和能力标志。libfuse 回复两者的交集——双方都支持的能力。`FUSE_CAP_OVER_IO_URING`、`FUSE_CAP_WRITEBACK_CACHE`、`FUSE_CAP_PASSTHROUGH` 等 30+ 个标志就是在此处协商的。如果内核主版本与 libfuse 的不匹配，会话拒绝启动（循环以 `-EPROTO` 退出）。

一个**同步 FUSE_INIT** 机制（第 4787 行）处理一个微妙问题：SELinux 可能在 `fuse_session_mount()` 返回*之前*发送 `getattr` 请求。一个工作线程（`session_sync_init_worker`）轮询 `se->fd` 加一个 eventfd，处理请求直到挂载握手完成。通过 `ioctl(fd, FUSE_DEV_IOC_SYNC_INIT)` 启用。

一个**超时看门狗**线程（`fuse_session_teardown_watchdog`，第 5376 行）轮询会话 fd 上的 `POLLERR`——如果内核侧连接断开（如文件系统被杀死），看门狗调用 `fuse_session_exit()`，并在可配置的超时后可选地强制硬退出。

![Ubuntu 终端显示命令行提示符，代表 FUSE 文件系统运行所在的用户态守护进程](/posts/libfuse-deep-dive-software-engineer/images/session-lifecycle.jpg)

---

## io_uring 集成（libfuse 3.18.0+）

libfuse 最新的重大特性是 `fuse-over-io_uring`，于 3.18.0 版本（2025 年 12 月 18 日）加入。它用 io_uring 替代了 `/dev/fuse` 上传统的 `read()`/`write()`——一个内核与用户态共享的环形缓冲区，可批量处理并减少系统调用。

### 为什么重要

经典 FUSE 路径在每次操作上都有系统调用开销：内核将请求写入 `/dev/fuse`，用户态守护进程 `read()` 它，处理它，`write()` 回复。即每次操作两个系统调用（一次读、一次写），外加上下文切换。对于 I/O 密集型负载，这一开销不可忽视。io_uring 让双方在一个共享环形缓冲区上操作——内核放入完成队列项（CQE），libfuse 批量处理，回复通过同一环形缓冲区返回。更少的系统调用、更少的上下文切换、更好的吞吐量。

### 代码中的实现

实现位于 `lib/fuse_uring.c`（26 KB，1043 行）。架构如下：

```
经典传输                               io_uring 传输
──────────                             ──────────────
  /dev/fuse 上的 read()/write()        io_uring 共享环形缓冲区
  一个 fd，一个线程读取                 每个 CPU 核心一个队列
  每个请求 = 1 次 read() 系统调用       批量：io_uring_submit_and_wait()
  每个回复 = 1 次 write() 系统调用     回复：FUSE_IO_URING_CMD_COMMIT_AND_FETCH
       │                                      │
       ▼                                      ▼
  fuse_session_receive_buf()               fuse_uring_thread() 每队列
  fuse_session_process_buf()               io_uring_wait_cqe() → 处理 CQE
  fuse_send_msg() → writev()               fuse_ll_ops2[] 分发（负载分离）
                                          send_reply_uring() → 提交 SQE
```

核心结构体：

```c
struct fuse_ring_pool {
    struct fuse_session *se;
    bool single_issuer;          // 优化：单线程提交
    size_t nr_queues;            // = get_nprocs_conf()（每核心一个）
    size_t queue_depth;          // 默认 8，可通过 -o io_uring_q_depth 配置
    struct fuse_ring_queue *queues;
};

struct fuse_ring_queue {
    int qid;
    pthread_t tid;
    struct io_uring ring;        // 实际的 io_uring 实例
    pthread_mutex_t ring_lock;
    struct fuse_ring_ent ent[];  // 柔性数组，大小 = queue_depth
};
```

生命周期：

1. **`fuse_uring_start(se)`** ——在 `FUSE_INIT` 协商成功且 `FUSE_CAP_OVER_IO_URING` 已设置后，由 `do_init` 调用。
2. **`fuse_create_ring(se)`** ——分配池，`nr_queues` = CPU 数量。
3. **`fuse_uring_start_ring_threads()`** ——为每个队列生成一个 `fuse_uring_thread()`。
4. 每个线程：设置 CPU 亲和性（`fuse_uring_set_thread_core`），初始化 io_uring（`IORING_SETUP_SQE128`，80 字节 cmd 数据用于 `fuse_uring_cmd_req`），注册文件，mmap 头/负载缓冲区，准备注册 SQE。
5. `FUSE_INIT` 回复后：`fuse_uring_wake_ring_threads()` 向 `init_sem` 发信号。
6. 主循环：`io_uring_submit_and_wait()`（单提交者模式）或 `io_uring_wait_cqe()`（多提交者模式）→ `fuse_uring_queue_handle_cqes()` → `fuse_uring_handle_cqe()` → `fuse_session_process_uring_cqe()`。

CQE 处理从环形缓冲区的 `req_header` 中提取 `fuse_in_header`，设置 `req->flags.is_uring = 1`，通过 `fuse_ll_ops2[]`（带分离负载指针的并行表）分发。回复通过 `send_reply_uring()` 发送——将负载拷贝到环形缓冲区并提交 `FUSE_IO_URING_CMD_COMMIT_AND_FETCH` SQE。

值得关注的工程设计决策：
- **`IORING_SETUP_SQE128`** 是必需的（非默认的 64 字节 SQE），因为 `fuse_uring_cmd_req` 需要 80 字节的 cmd 数据（qid、commit_id、flags）。
- **`IORING_SETUP_CQSIZE`** 设置 `cq_entries = depth * 2`，防止 CQ 溢出。
- **`IORING_SETUP_SUBMIT_ALL`** 确保一个 SQE 失败不会阻塞整个批次。
- **`cqe_processing`** 原子标志在 CQE 处理期间门控 `io_uring_submit()`，允许批量内联回复。
- **`alloc_local()`** 使用 `mmap` + `SYS_mbind(MPOL_LOCAL)` + `MADV_POPULATE_WRITE` 实现 NUMA 本地、预取内存。
- 通过 eventfd 轮询 SQE 发出拆除信号。

### 启用方式

```bash
# 1. 启用内核侧 FUSE io_uring（需要 Linux 6.x 且编译了 FUSE io_uring 支持）
echo 1 > /sys/module/fuse/parameters/enable_uring

# 2. 以 io_uring 选项挂载
./my_fuse_fs /source /mountpoint -o io_uring

# 3. 可选：调整队列深度（默认 8）
./my_fuse_fs /source /mountpoint -o io_uring -o io_uring_q_depth=16
```

编译 libfuse 时需开启 `-Denable-io-uring=true`（需要带 `IORING_SETUP_SQE128` 支持的 `liburing`）。内核侧协议能力 `FUSE_OVER_IO_URING` 在协议版本 7.42 中加入。

> **引用摘要：** `fuse-over-io-uring`（libfuse 3.18.0，2025 年 12 月）用 io_uring 队列替代了 `/dev/fuse` 上的 read/write——每个 CPU 核心一个，默认深度 8——降低了系统调用开销。需要内核支持（`echo 1 > /sys/module/fuse/parameters/enable_uring`）、`FUSE_CAP_OVER_IO_URING` 能力（协议 7.42）以及 `-o io_uring` 挂载选项（[libfuse README.fuse-io-uring](https://github.com/libfuse/libfuse/blob/master/doc/README.fuse-io-uring)）。

---

## 示例文件：你的入口

`example/` 目录包含 25+ 个程序。学习源码最关键的三个：

### `example/hello.c` —— 高级 API "Hello World"（4.5 KB）

经典的入门示例。定义一个只有一个文件（`/hello`）的文件系统，内容为 `"Hello World!\n"`。使用 `fuse_main()`——整个挂载循环只需一个函数调用：

```c
static const struct fuse_operations hello_oper = {
    .init     = hello_init,
    .getattr  = hello_getattr,
    .readdir  = hello_readdir,
    .open     = hello_open,
    .read     = hello_read,
};

int main(int argc, char *argv[]) {
    struct fuse_args args = FUSE_ARGS_INIT(argc, argv);
    fuse_opt_parse(&args, &options, option_spec, NULL);
    return fuse_main(args.argc, args.argv, &hello_oper, NULL);
}
```

编译：`gcc -Wall hello.c $(pkg-config fuse3 --cflags --libs) -o hello`

### `example/hello_ll.c` —— 底层 API "Hello World"（7 KB）

用底层 API 实现的同一文件系统。这是理解 inode 显式回调的最佳入口：

```c
#define FUSE_USE_VERSION FUSE_MAKE_VERSION(3, 12)
#include <fuse_lowlevel.h>

static const struct fuse_lowlevel_ops hello_ll_oper = {
    .init       = hello_ll_init,
    .lookup     = hello_ll_lookup,
    .getattr    = hello_ll_getattr,
    .readdir    = hello_ll_readdir,
    .open       = hello_ll_open,
    .read       = hello_ll_read,
    // ...
};

int main(int argc, char *argv[]) {
    struct fuse_session *se = fuse_session_new(&args, &hello_ll_oper, sizeof(hello_ll_oper), NULL);
    fuse_set_signal_handlers(se);
    fuse_session_mount(se, opts.mountpoint);
    fuse_session_loop_mt(se, &config);   // 单线程用 fuse_session_loop()
    fuse_session_unmount(se);
    fuse_remove_signal_handlers(se);
    fuse_session_destroy(se);
}
```

这是理解库的更好起点，因为每一步都是显式的。

### `example/passthrough_fh.c` —— 真实的透传实现（14 KB）

将现有目录树镜像到挂载点下。使用底层 API 加文件句柄（`FUSE_CAP_EXPORT_SUPPORT` + `fuse_file_info` 的 `fh` 字段）。这是大多数真实文件系统起步的模板。C++ 版本 `passthrough_hp.cc`（49 KB）增加了写回缓存和 io_uring 支持——仓库中最完整的示例。

---

## 如何阅读源码：新手地图

如果你想从代码层面理解 libfuse，按以下顺序阅读：

1. **`include/fuse_lowlevel.h`**（84 KB）——公开结构体和回调签名。先看 `struct fuse_lowlevel_ops`（你的回调表）、`struct fuse_file_info`、`struct fuse_conn_info` 和 `fuse_reply_*()` 函数声明。这是你和库之间的契约。

2. **`example/hello_ll.c`**（7 KB）——一个约 200 行的底层文件系统实现。对照头文件阅读，理解回调是如何接通的。

3. **`lib/fuse_lowlevel.c`**（144 KB）——核心。重点关注：
   - `fuse_session_new()` ——会话创建和选项解析
   - `fuse_session_mount()` ——挂载握手
   - `fuse_ll_ops[]`（第 3686 行）——分发表
   - `fuse_session_process_buf_internal()`（约第 4000 行）——请求处理
   - `do_write()`、`do_read()` ——代表性的操作码处理器
   - `send_reply()` → `fuse_send_msg()` ——回复路径
   - `fuse_session_loop()` ——事件循环入口

4. **`lib/fuse_session.c`** ——会话生命周期：挂载、卸载、信号处理、同步初始化工作线程、超时看门狗。

5. **`lib/fuse.c`**（122 KB）——高级 API 封装。重点看 `fuse_main()` 如何调用底层 API，以及 node_table 哈希如何将 inode 映射到路径。

6. **`lib/fuse_uring.c`**（26 KB）——io_uring 传输层。在理解经典路径之后阅读。

7. **`doc/kernel.txt`**（15 KB）——内核协议参考：`/dev/fuse` 接口、`/sys/fs/fuse/connections` 控制文件系统、中断语义、非特权挂载安全模型。

8. **`doc/fuse-operations.txt`**（13 KB）——FUSE 协议操作参考。

<!-- [PERSONAL EXPERIENCE] 我第一次读 libfuse 时，从底层 API 和分发表入手是突破口——一旦看清楚了高级 API 隐藏了什么（inode 到路径的哈希表、返回即自动回复、内部缓存），高级 API 的设计就完全说得通了。建议先读 hello_ll.c 再读 hello.c，先读 fuse_ll_ops[] 再读两者。 -->

---

## 测试套件

libfuse 自带一套定制的测试基础设施——不依赖外部框架。`test/run-tests.py`（71 KB）自动发现 `test/cases/**/*.sh`，每个测试在自己的 cgroup 和私有工作目录中运行，强制执行 `# TIMEOUT:` 指令，收集 core dump 和回溯，报告 PASS/SKIP/FAIL。

`test/cases/` 目录包含 80+ 个 shell 脚本，分为：
- **`examples/`**（38 个脚本）——测试每个示例文件系统（hello、passthrough、cuse、poll、notify_*）
- **`notify/`**（16 个脚本）——测试通知机制
- **`mount/`**（24 个脚本）——测试挂载选项和属性
- **`unit/`** ——C 语言单元测试（ABI 兼容性、循环配置、挂载标志）
- **`ctests/`** ——shell 测试（信号、teardown-watchdog、write-cache）

测试在两种传输层上运行：`meson test`（经典）和 `meson test --suite io-uring`。运行器扫描输出中的可疑模式（error/warning/fatal/crash/abort/exception），支持 Valgrind（`TEST_WITH_VALGRIND=1`）。

值得注意的是，测试需要 root 权限，但如果先给 `util/fusermount3` setuid root，大部分可以作为普通用户运行——其余的测试会优雅地跳过。

---

## fusermount3：setuid 辅助程序

`util/fusermount.c`（45 KB）实现了 `fusermount3`，以 **setuid root** 权限安装，让非特权用户可以挂载文件系统。它打开 `/dev/fuse`，执行特权挂载操作，然后通过 `_FUSE_COMMFD` 环境变量将文件描述符传回守护进程。

fusermount3 强制执行的安全限制：
- 用户只能在有写权限的挂载点上挂载
- 挂载点不能是非用户所有的粘滞目录（如 `/tmp`）
- 其他用户（包括 root）无法访问已挂载的文件系统，除非在 `/etc/fuse.conf` 中配置了 `allow_other`/`allow_root`

`auto_unmount` 选项保持 commfd 打开——当守护进程退出（甚至崩溃）时，内核自动卸载。`drop_privileges` 在 setuid 降级*之前*打开 `/dev/fuse`，使挂载 fd 归目标用户所有。

一个已知的未解决内核 bug（issue #15，自 2006 年记录）：当使用 `allow_other` 但未设置 `default_permissions` 时，目录项的首次权限检查结果会被缓存并在后续访问中复用——只要 inode 仍在内核缓存中，即使权限已改变、即使访问来自不同用户。解决方案是使用 `default_permissions`（不支持 ACL）或禁用目录项属性缓存。

---

## 项目状态与历史

libfuse 自 2001 年起用于生产环境。原作者 **Miklos Szeredi**（同时也是内核 FUSE 子系统的维护者）于 2015 年移交了维护权。**Nikolaus Rath** 维护至 2024 年 2 月。当前维护者——**Bernd Schubert**、**Ashley Pittman** 和 **Antonio SJ Musumeci**（mergerfs 的创建者）——负责合并 PR 和发布版本，但没有精力进行特性开发。

README 异常坦诚地写道：*"目前 libfuse 没有任何活跃的常规贡献者……除非你附带了 pull request 或报告的是关键问题，否则可能不会收到回复。"*

ChangeLog 中的关键里程碑：

| 版本 | 时间 | 里程碑 |
|------|------|--------|
| 3.0.0 | 2016 | **libfuse3** 分支——可与 libfuse2 共存、meson 构建、默认能力集 |
| 3.2.0 | 2017 | Meson 构建系统，弃用 autotools |
| 3.12.0 | 2022 | `fuse_loop_config` 私有化，`max_threads` 参数 |
| 3.15.0 | 2023 | Signify 签名（取代 PGP） |
| 3.17.0 | 2025 | ABI 恢复至 3.10，透传读/写，syslog 日志 |
| **3.18.0** | **2025 年 12 月** | **fuse-over-io-uring，statx，请求超时，FUSE_NOTIFY_INC_EPOCH** |
| 3.18.2 | 2025 年 3 月 | 最新稳定版本 |
| 3.19.0-rc0 | 2026 | 当前开发版本（本仓库） |

该库稳定、成熟、广泛部署。它没有停止——但也没有在增长。io_uring 是近年来最重大的架构变更。

---

## 常见问题

### libfuse 的高级 API 和底层 API 有什么区别？

高级 API（`fuse.h`）使用路径字符串和同步回调——从回调返回即自动发送回复。底层 API（`fuse_lowlevel.h`）使用 inode 编号，需要显式调用 `fuse_reply_*()`，让你完全控制缓存、并发和回复时机。高级 API 由底层 API 封装实现。大多数生产级文件系统（mergerfs、s3fs、gvfs）使用底层 API。

### libfuse 还在积极维护吗？

README 声明当前除维护者团队外没有活跃的常规贡献者，维护者负责合并 PR 和发布版本，但没有精力进行特性开发。它稳定且成熟——没有停止，但不要期望除高影响修复之外的新特性。最新版本是 3.18.2（2025 年 3 月）。

### 我能在 macOS 上使用 libfuse 吗？

不能。libfuse 面向 Linux（完整支持）和 BSD（尽力而为）。在 macOS 上使用 [macFUSE](https://macfuse.github.io)，它是一个独立项目，拥有自己的内核扩展。

### FUSE 的性能与内核模块相比如何？

FUSE 以峰值性能换取了安全性和开发速度。FUSE 文件系统的崩溃只会终止一个进程，而非整个内核。开发速度快几个数量级。性能差距正在缩小：`FUSE_WRITEBACK_CACHE`（协议 7.23）启用内核侧写缓冲，`FUSE_PASSTHROUGH`（协议 7.40）让内核直接读写后备文件，`fuse-over-io-uring`（3.18.0）降低了系统调用开销。

### FUSE 协议版本是多少？

当前协议版本为 **7.45**（内核/用户态接口）。能力在挂载时通过 `FUSE_INIT` 握手协商——双方通告各自支持的能力，取交集使用。新能力（如 7.42 中的 `FUSE_CAP_OVER_IO_URING`）在次版本更新中加入。

---

## 总结

libfuse 是协议库设计的一套大师级示例：高级与底层 API 的清晰分离、一张将每个内核操作码路由到处理器的分发表、管理周密的会话生命周期（含同步初始化和超时看门狗），以及一个在不改变用户可见 API 的前提下降低系统调用开销的 io_uring 传输层。

代码库适合自上而下阅读。从 `fuse_lowlevel.h` 和 `hello_ll.c` 开始，然后阅读 `fuse_lowlevel.c` 中的分发表，接着是 `fuse_session.c` 中的会话生命周期，最后是 `fuse_uring.c` 中的 io_uring 传输层。用 `meson setup build && ninja -C build` 构建示例，挂载 `hello_ll` 到测试目录，用 `strace -e read,write` 观察分发管线的实际运转。

仓库地址：[github.com/libfuse/libfuse](https://github.com/libfuse/libfuse)。克隆它，阅读它，下次当你 `sshfs` 到远程服务器或用 `s3fs` 挂载存储桶时，你会清楚地知道 VFS 调用和你的回调之间究竟发生了什么。

## 来源

- libfuse README.md, https://github.com/libfuse/libfuse
- libfuse README.fuse-io-uring, https://github.com/libfuse/libfuse/blob/master/doc/README.fuse-io-uring
- libfuse ChangeLog.rst, https://github.com/libfuse/libfuse/blob/master/ChangeLog.rst
- libfuse AUTHORS, https://github.com/libfuse/libfuse/blob/master/AUTHORS
- libfuse doc/kernel.txt（内核协议参考）, https://github.com/libfuse/libfuse/blob/master/doc/kernel.txt
- libfuse example/hello_ll.c, https://github.com/libfuse/libfuse/blob/master/example/hello_ll.c
- libfuse example/hello.c, https://github.com/libfuse/libfuse/blob/master/example/hello.c
- libfuse include/fuse_kernel.h（有线协议）, https://github.com/libfuse/libfuse/blob/fuse-3.18.0/include/fuse_kernel.h
- Kernel FUSE 文档, https://www.kernel.org/doc/html/next/filesystems/fuse.html
- Wikipedia — Filesystem in Userspace, https://en.wikipedia.org/wiki/Filesystem_in_Userspace
- LWN.net — "A FUSE implementation for famfs", https://lwn.net/Articles/1020170/
- LWN.net — "Famfs, FUSE, and BPF", https://lwn.net/Articles/1068686/
