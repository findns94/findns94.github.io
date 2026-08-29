---
title: "FUSE 内核模块深度剖析：一个软件工程师的代码阅读指南"
description: "FUSE 内核模块是 VFS 与用户态文件系统之间的守门人。本文深入剖析 fs/fuse/ 源码——请求生命周期、核心数据结构、/dev/fuse 与 io_uring 传输层、透传机制，以及内核模块与 libfuse 之间日益扩大的开发差距。"
coverImage: "/posts/fuse-kernel-module-deep-dive/images/cover.jpg"
coverImageAlt: "黑暗数据中心中的服务器机架，代表支撑 FUSE 内核模块的 Linux 内核基础设施"
ogImage: "/posts/fuse-kernel-module-deep-dive/images/cover.jpg"
date: "2026-08-22 22:00:00"
lastUpdated: "2026-08-22 22:00:00"
author: "FindNS94"
tags: [Linux, Kernel, Open Source]
---

![黑暗数据中心中的服务器机架，代表支撑 FUSE 内核模块的 Linux 内核基础设施](/posts/fuse-kernel-module-deep-dive/images/cover.jpg)

# FUSE 内核模块深度剖析：一个软件工程师的代码阅读指南

每一个 FUSE 文件系统都有两半。用户态的一半——libfuse——实现文件系统逻辑。内核的一半——Linux 源码树中 `fs/fuse/` 下的 FUSE 内核模块——是守门人，负责拦截每一次 VFS 调用，决定是在本地处理还是转发到用户态。如果我们的 [libfuse  companion 文章](/posts/libfuse-deep-dive-software-engineoer/) 解释了用户态库，那么本文就来解释内核侧。

问题在于，内核模块相当密集：30+ 个文件、约 13,000 行 C 代码，包含复杂的请求生命周期管理、两套传输层（/dev/fuse 和 io_uring），以及一系列持续涌现的高性能特性——透传（passthrough）、写回缓存、请求超时——这些都在改变 FUSE 的工作方式。而且与 libfuse（处于有限维护模式）不同，内核模块正在**积极开发**中，这导致两半之间的能力差距日益扩大。

本文自上而下地走读内核模块源码：核心数据结构、请求生命周期、传输层，以及那些完全绕过用户态的最新特性。读完后，你将能够读懂 `dev.c`（2430 行的 /dev/fuse 传输层实现），并准确理解每个函数的作用。

<!-- [UNIQUE INSIGHT] FUSE 内核模块的请求生命周期是内核异步 I/O 设计的一套大师级示例：一次 VFS 调用分配一个请求，标记为 FR_PENDING，入队，然后在 req->waitq 上睡眠。用户态守护进程从 /dev/fuse 读取请求，处理它，写回响应，内核设置 FINISHED 并唤醒等待者。理解了这条管线，就理解了模块 80% 的内容。 -->

<!-- more -->

> **核心要点**
> - FUSE 内核模块位于 Linux 源码的 `fs/fuse/`——30+ 个文件、约 13,000 行 C 代码，2005 年合入 kernel 2.6.14，目前由 Miklos Szeredi 积极维护。
> - 所有 VFS 调用都经过一个 FUSE 操作（如 `fuse_read_iter()`），它分配一个 `fuse_conn`，在连接的被处理队列中入队，然后等待。用户态从 `/dev/fuse` 读取请求，处理后将响应写回，内核唤醒等待中的 VFS 调用。
> - 三个核心对象：`fuse_conn`（连接）、`fuse_inode`（每 inode）、`fuse_file`（每打开文件）。每个连接有一个输入队列（挂起请求）、一个处理队列（哈希表）和一个后台队列。
> - FUSE_PASSTHROUGH 让内核直接对后备文件进行读/写，绕过用户态的数据 I/O。FUSE_OVER_IO_URING 用 io_uring 环形缓冲区替代 `/dev/fuse` 上的 read/write，降低系统调用开销。
> - 内核模块积极开发中（透传、io_uring、超时、DAX、安全上下文），而 libfuse 处于有限维护模式——开发者应该了解这一日益扩大的差距。

---

## FUSE 内核模块是什么

FUSE 采用拆分设计。**内核模块**（`fs/fuse/`）注册一个 `file_system_type`，通过将所有 VFS 操作（超级块、inode、文件、目录）转发到用户态来实现。**用户态库**（libfuse）读取这些请求，分发到你的文件系统回调，然后写回响应。双方通过 `include/uapi/linux/fuse.h`（1311 行）中定义的 FUSE 协议进行通信。

本文涵盖内核侧。内核模块不实现文件系统逻辑——它实现的是**守门人**：拦截 VFS 调用，将其封送为 FUSE 协议消息，通过传输层发送给用户态，然后等待响应。

主要源文件：

| 文件 | 行数 | 用途 |
|------|------|------|
| `fuse_i.h` | 1333 | 核心数据结构：fuse_conn、fuse_inode、fuse_file、fuse_chan |
| `fuse_dev_i.h` | 422 | 请求、通道、队列结构 |
| `dev.c` | 2430 | /dev/fuse 字符设备传输层 |
| `file.c` | 3121 | 文件操作（读、写、mmap、ioctl、fsync） |
| `inode.c` | 2190 | inode 管理、超级块、FUSE_INIT 握手 |
| `dir.c` | 2498 | 目录操作（查找、mkdir、readdir、rename） |
| `dev_uring.c` | 1457 | FUSE-over-io_uring 传输层 |
| `passthrough.c` | 197 | FUSE_PASSTHROUGH 直接 I/O |
| `control.c` | 367 | /sys/fs/fuse/connections 控制文件系统 |
| `notify.c` | 447 | 内核侧通知处理 |
| `req.c` | 100 | 请求分配和凭证辅助函数 |
| `req_timeout.c` | ~150 | 请求超时处理 |
| `virtio_fs.c` | ~2000 | 虚拟机中基于 virtio 的 FUSE |
| `dax.c` | ~1500 | 直接访问（CXL 持久内存） |

```
┌─────────────────────────────────────────────────────────────────────┐
│                         Linux 内核                                   │
│  ┌─────────┐   ┌──────────────────────────────────────────────┐    │
│  │   VFS   │──►│         FUSE 内核模块 (fs/fuse/)             │    │
│  └─────────┘   │                                              │    │
│       │        │  fuse_read_iter() ──► fuse_send_read()       │    │
│       │        │  fuse_lookup()     ──► fuse_lookup_name()    │    │
│       │        │  fuse_mkdir()      ──► create_new_entry()    │    │
│       │        │  ...                  ...                    │    │
│       │        │                                              │    │
│       │        │  ┌─────────────┐    ┌──────────────────┐    │    │
│       │        │  │ /dev/fuse   │    │ io_uring 环形缓冲 │    │    │
│       │        │  │ (dev.c)     │    │ (dev_uring.c)    │    │    │
│       │        │  └──────┬──────┘    └────────┬─────────┘    │    │
│       │        └─────────┼────────────────────┼──────────────┘    │
│       │                  │                    │                    │
└───────┼──────────────────┼────────────────────┼────────────────────┘
        │                  │                    │
        │          read() / write()       SQEs / CQEs
        │                  │                    │
        │                  ▼                    ▼
        │         ┌─────────────────────────────────────┐
        │         │    用户态 FUSE 守护进程               │
        │         │    (libfuse 或自定义实现)             │
        │         └─────────────────────────────────────┘
        │
        ▼
   ┌─────────┐
   │ 应用程序 │
   │ read()  │
   └─────────┘
```

---

## 核心数据结构

FUSE 内核模块的架构围绕六个核心结构展开。理解它们是阅读源码的关键。

### struct fuse_conn — 每连接状态

`struct fuse_conn`（定义在 `fuse_i.h`，约 765 行字段）在挂载时创建，在最后一个挂载卸载且 `/dev/fuse` 关闭时销毁。它保存连接范围的状态：

- **同步原语：** `lock`（自旋锁，保护 polled_files、backing_files_map、curr_bucket）、`killsb`（读写信号量，保护超级块访问）、`count`（引用计数）、`epoch`（原子变量——用于目录项缓存一致性）
- **身份：** `user_id`、`group_id`、`pid_ns`、`user_ns`
- **I/O 限制：** `max_read`、`max_write`、`max_pages`、`congestion_threshold`
- **传输层：** `chan`（指向 `fuse_chan`）、`khctr`（单调递增的内核文件句柄计数器）
- **60+ 个能力位域**（FUSE_INIT 期间协商）：`writeback_cache`、`passthrough`、`async_read`、`atomic_o_trunc`、`export_support`、`big_writes`、`do_readdirplus`、`parallel_dirops`、`posix_acl`、`default_permissions`、`allow_other`、`handle_killpriv_v2`、`direct_io_allow_mmap`、`sync_init`、各种 `no_*` 标志等
- **状态：** `conn_error`、`conn_init`、`abort_err`、`destroy`
- **计数器：** `attr_version`（atomic64）、`evict_ctr`（atomic64）
- **挂载：** `mounts` 列表（支持子挂载共享一个连接）
- **写同步：** `curr_bucket`（RCU 指针指向 `fuse_sync_bucket`）
- **透传：** `backing_files_map`（后备文件 ID 的 IDR 映射）

### struct fuse_req — 一个内核请求

`struct fuse_req`（在 `fuse_dev_i.h` 中）代表一个发往用户态的单个请求：

- `list`——队列链接（pending、processing 或 io 列表）
- `intr_entry`——中断列表中的条目
- `args`——输入/输出参数（`fuse_args`）
- `count`——引用计数
- `flags`——`fuse_req_flag` 位域：`FR_PENDING`、`FR_SENT`、`FR_FINISHED`、`FR_INTERRUPTED`、`FR_ABORTED`、`FR_LOCKED`、`FR_WAITING`、`FR_BACKGROUND`、`FR_FORCE`、`FR_ISREPLY`、`FR_PRIVATE`、`FR_ASYNC`、`FR_URING`
- `in.h`——`fuse_in_header`（操作码、唯一 ID、nodeid、uid、gid、pid）
- `out.h`——`fuse_out_header`（错误码、唯一 ID）
- `waitq`——请求线程的等待队列
- `chan`——所属的 `fuse_chan`
- `create_time`——创建时的时间（jiffies，用于超时检测）
- `ring_entry`、`ring_queue`——io_uring 指针

### struct fuse_file — 每打开文件状态

`struct fuse_file` 跟踪每个打开的文件：

- `fh`——用户态文件句柄（FUSE_OPEN 返回）
- `kh`——唯一内核句柄（来自 `khctr`）
- `nodeid`——该文件所属的 inode
- `open_flags`——服务器返回的 FOPEN_* 标志
- `iomode`——`IOM_NONE`、`IOM_CACHED` 或 `IOM_UNCACHED`
- `write_entry`——inode 的 `write_files` 列表中的条目
- `readdir.{pos, cache_off, version}`——readdir 状态
- `polled_node`、`poll_wait`——poll 支持
- `passthrough`——后备文件指针（FUSE_PASSTHROUGH 激活时）

### struct fuse_inode — 每 inode 状态

`struct fuse_inode` 将 `struct inode` 嵌入为第一个成员，并添加 FUSE 专属状态：

- `nodeid`——唯一用户态 inode ID
- `nlookup`——查找计数（用于 FORGET）
- `i_time`——属性缓存过期时间（jiffies）
- `inval_mask`——哪些属性已失效
- **写缓存**（常规文件）：`write_files` 列表、`queued_writes`、`writectr`、`iocachectr`、`page_waitq`
- **readdir 缓存**（目录）：`rdc.{cached, size, pos, version, mtime, epoch, iversion}`
- `state`——位域：`FUSE_I_ADVISE_RDPLUS`、`FUSE_I_INIT_RDPLUS`、`FUSE_I_SIZE_UNSTABLE`、`FUSE_I_BAD`、`FUSE_I_BTIME`、`FUSE_I_CACHE_IO_MODE`、`FUSE_I_EXCLUSIVE`
- `mutex`——序列化查找/readdir（除非启用 `parallel_dirops`）
- `lock`——保护写相关字段的自旋锁
- `fb`——`fuse_backing` 指针（透传）

### struct fuse_chan — 传输通道

`struct fuse_chan` 是传输层抽象：

- `iq`——输入队列（`fuse_iqueue`：pending 列表、中断、forget 列表、reqctr）
- `devices`——`fuse_dev` 实例列表
- `max_background`、`num_background`、`active_background`——后台请求流控
- `bg_queue`——等待分派的后台请求
- `initialized`——FUSE_INIT 回复接收后置位
- `blocked`——后台请求过多时置位
- `connected`——卸载/中止时清零
- `num_waiting`——等待请求的原子计数
- `io_uring`——标志：使用 io_uring 传输
- `ring`——`fuse_ring` 指针（io_uring 状态）
- `timeout.{work, req_timeout}`——延迟工作 + 超时值

### struct fuse_iqueue 和 struct fuse_pqueue

- `fuse_iqueue`——输入队列：`reqctr`（唯一 ID 计数器）、`pending` 列表、`interrupts` 列表、`forget_list_head/tail`、`forget_batch`、`ops`（send_forget、send_interrupt、send_req、release 回调）
- `fuse_pqueue`——处理队列：正在处理的请求的哈希表（`FUSE_PQ_HASH_BITS = 8`，即 256 个桶）、`io` 列表

![闪烁灯光的服务器机房，代表管理 FUSE 请求队列和连接的内核基础设施](/posts/fuse-kernel-module-deep-dive/images/request-lifecycle.jpg)

---

## 请求生命周期：从 VFS 调用到用户态再返回

这是模块的核心。每个文件系统操作——`read()`、`write()`、`stat()`、`ls`——都遵循相同的路径。下面以 `read()` 为例，沿实际源码追踪完整流程：

```
┌──────────────┐     ┌───────────────────┐     ┌──────────────────┐     ┌────────────────┐
│  应用程序     │     │  FUSE 内核        │     │  /dev/fuse       │     │  用户态        │
│  read()      │     │  (file.c)         │     │  (dev.c)         │     │  守护进程      │
└──────┬───────┘     └────────┬──────────┘     └────────┬─────────┘     └───────┬────────┘
       │                      │                          │                        │
       │  read(fd, buf, n)    │                          │                        │
       ├─────────────────────►│  fuse_file_read_iter()   │                        │
       │                      │  → fuse_cache_read_iter()│                        │
       │                      │  → fuse_read_folio()     │                        │
       │                      │  → fuse_send_read()      │                        │
       │                      │                          │                        │
       │                      │  fuse_request_alloc()    │                        │
       │                      │  设置 FR_PENDING         │                        │
       │                      │  填充 FUSE_READ 参数     │                        │
       │                      │                          │                        │
       │                      │  fuse_chan_send()        │                        │
       │                      │  → fuse_dev_queue_req()  │                        │
       │                      │  → 入队到 fiq->pending   │                        │
       │                      │  → fuse_dev_wake_and_unlock()                    │
       │                      │  ─── 唤醒读取者 ───────►│  fuse_dev_read()       │
       │                      │                          │  → fuse_dev_do_read()  │
       │                      │                          │  → 将请求拷贝到        │
       │                      │                          │    用户态缓冲区         │
       │                      │                          ├───────────────────────►│
       │                      │                          │                        │  (处理读取)
       │                      │                          │  fuse_dev_write()      │
       │                      │                          │  ←── 响应 ────────────┤
       │                      │                          │  → fuse_request_find() │
       │                      │                          │    (按 unique ID 哈希) │
       │                      │                          │  → fuse_request_end()  │
       │                      │                          │    设置 FR_FINISHED    │
       │                      │  ◄── wake_up(req->waitq) │                        │
       │  返回字节数           │                          │                        │
       ◄──────────────────────┤                          │                        │
```

### 沿源码逐步解析

**1. VFS 分发到 FUSE。** `fuse_file_read_iter()`（file.c:1823）检查打开模式：DAX → `fuse_dax_read_iter`，`FOPEN_DIRECT_IO` → `fuse_direct_read_iter`，透传 → `fuse_passthrough_read_iter`，否则 → `fuse_cache_read_iter()`。

**2. 构建请求。** `fuse_cache_read_iter()` 调用 `fuse_read_folio()`，它批量处理 folio 并调用 `fuse_send_read()`（file.c:794）。这会填充 `fuse_read_in` 参数并调用 `fuse_simple_request()`。

**3. 分配并发送。** `fuse_simple_request()`（req.c:60）调用 `fuse_req_prep()`（填充凭证）然后调用 `fuse_chan_send()`（dev.c:809）。这从 slab 缓存分配一个 `fuse_req`（`fuse_request_alloc()`），设置 `FR_PENDING`，记录 `create_time`，然后调用 `__fuse_request_send()`。

**4. 入队并唤醒用户态。** `fuse_dev_queue_req()`（dev.c:282）从 `fiq->reqctr` 分配唯一 ID，将请求追加到 `fiq->pending`，然后调用 `fuse_dev_wake_and_unlock()` 唤醒 `fiq->waitq`（用户态守护进程阻塞在 `fuse_dev_read()` 中）并通过 `kill_fasync()` 发送 `SIGIO`。

**5. 等待响应。** `request_wait_answer()`（dev.c:697）执行三阶段等待：(1) `wait_event_interruptible`——可被任意信号中断；如果已设置中断，且请求已是 `FR_SENT`，则发送中断。(2) `wait_event_killable`——仅致命信号。(3) 无条件 `wait_event` 直到 `FR_FINISHED`。

**6. 用户态读取。** `fuse_dev_read()`（dev.c:1680）→ `fuse_dev_do_read()`（dev.c:1516）在 `fiq->waitq` 上循环（排他等待）直到有请求可用。优先级：中断 → forget → 普通请求。对普通请求：从 `fiq->pending` 移除，清除 `FR_PENDING`，拷贝到 `fpq->io`，通过 `fuse_copy_args()` 将消息头 + 参数拷贝到用户态，移入 `fpq->processing[hash]`，设置 `FR_SENT`。

**7. 用户态写回响应。** `fuse_dev_write()`（dev.c:1968）→ `fuse_dev_do_write()`（dev.c:1860）拷贝 `fuse_out_header`。如果 `oh.unique == 0`，则为通知 → `fuse_notify()`。否则：通过 `fuse_request_find()`（哈希表查找）按 unique ID 查找请求，通过 `fuse_copy_out_args()` 拷贝负载，然后调用 `fuse_request_end()`。

**8. 完成请求。** `fuse_request_end()`（dev.c:628）设置 `FR_FINISHED`，处理中断清理，唤醒 `req->waitq`，然后丢弃引用。等待中的 VFS 调用返回。

### 后台请求

并非所有请求都阻塞调用者。后台请求（FORGET、BATCH_FORGET、中断）通过 `fuse_chan_send_bg()` → `fuse_request_queue_background()` 发送。`bg_queue` + `num_background` + `congestion_threshold` 提供流控：当 `num_background >= congestion_threshold` 时，新的前台请求会阻塞直到后台请求完成。

---

## FUSE_INIT 握手

挂载 FUSE 文件系统时，内核和用户态守护进程必须就协议版本和能力达成一致。这通过 `FUSE_INIT` 握手完成：

1. **内核发送 INIT。** `fuse_send_init()`（inode.c:1504）通过 `fuse_new_init()`（inode.c:1440）构建请求，设置：
   - `FUSE_KERNEL_VERSION = 7`，`minor`（最新）
   - `max_readahead`、`max_write`、`max_pages`
   - 支持标志的大型 OR 掩码：`FUSE_ASYNC_READ`、`FUSE_POSIX_LOCKS`、`FUSE_ATOMIC_O_TRUNC`、`FUSE_EXPORT_SUPPORT`、`FUSE_BIG_WRITES`、`FUSE_AUTO_INVAL_DATA`、`FUSE_DO_READDIRPLUS`、`FUSE_WRITEBACK_CACHE`、`FUSE_PARALLEL_DIROPS`、`FUSE_POSIX_ACL`、`FUSE_MAX_PAGES`、`FUSE_PASSTHROUGH`、`FUSE_OVER_IO_URING`、`FUSE_REQUEST_TIMEOUT` 等

2. **用户态回复。** 守护进程回复双方都支持的能力交集。

3. **内核处理回复。** `process_init_reply()`（inode.c:1269）验证 `arg->major == FUSE_KERNEL_VERSION`，将回复标志解码为 `fc` 特性位，调用 `process_init_limits()`（为非特权用户限制 `max_background`/`congestion_threshold`），设置 `conn_init`/`conn_error`，然后调用 `fuse_chan_set_initialized()` 唤醒 `blocked_waitq`（允许请求分配继续进行）。

> **引用摘要：** FUSE_INIT 握手在内核与用户态之间协商协议能力。内核通告支持标志的超集（FUSE_ASYNC_READ、FUSE_WRITEBACK_CACHE、FUSE_PASSTHROUGH、FUSE_OVER_IO_URING 等）；用户态回复交集。在 INIT 回复接收之前连接被阻塞——`fch->initialized` 门控所有请求分配（fuse_conn_init / process_init_reply，fs/fuse/inode.c）。

### 同步 FUSE_INIT

`sync_init` 挂载选项（以及 `FUSE_DEV_IOC_SYNC_INIT` ioctl）启用同步初始化。SELinux 需要此功能——它可能在 `fuse_send_init()` 完成*之前*发送 `getattr` 请求。启用同步初始化后，一个工作线程在挂载握手期间处理请求。

---

## 传输层：/dev/fuse

经典传输层是一个杂项字符设备 `/dev/fuse`。实现位于 `dev.c`（2430 行）。

### 设备生命周期

- `fuse_dev_init()`——创建 `fuse_req_cachep` slab 缓存并注册 `fuse_miscdevice`
- `fuse_dev_open()`——分配一个 `fuse_dev`，存入 `file->private_data`
- `fuse_dev_release()`——原子分离通道（`xchg(&fud->chan, FUSE_DEV_CHAN_DISCONNECTED)`），结束所有处理中的请求，如果这是最后一个设备，调用 `fuse_chan_abort()`

### 拷贝引擎

数据通过 `fuse_copy_state` 及其函数在内核和用户态之间移动：
- `fuse_copy_one()`——拷贝单个值
- `fuse_copy_args()`——将请求消息头 + 参数拷贝到用户态
- `fuse_copy_folio()`——拷贝 folio 数据（通过 `fuse_try_move_folio()` 实现页面窃取优化）
- `fuse_copy_out_args()`——从用户态拷贝响应负载
- `fuse_copy_fill()` / `fuse_copy_do()`——实际拷贝循环

### 中断

`FUSE_INTERRUPT`（奇数 unique ID）取消进行中的请求。`queue_interrupt()`（dev.c:666）调用 `fiq->ops->send_interrupt()` → `fuse_dev_queue_interrupt()`（dev.c:240），将请求添加到 `fiq->interrupts` 并唤醒读取者。被中断请求的等待者以 `-EINTR` 唤醒。

### 连接中止

写入 `/sys/fs/fuse/connections/<n>/abort` 触发 `fuse_chan_abort()`（dev.c:2129）：设置 `fch->connected = 0`，遍历所有设备的处理队列，标记请求 `FR_ABORTED`，完成未锁定的请求，刷新 bg 队列，唤醒所有等待者。

---

## io_uring 传输层（FUSE_OVER_IO_URING）

`dev_uring.c`（1457 行）实现 FUSE-over-io_uring——一种用 io_uring 共享环形缓冲区替代 `/dev/fuse` 上 read/write 的高性能传输层。

### 与经典传输层的区别

```
经典 (/dev/fuse)                         IO_URING
────────────────────                     ─────────
  read() = 获取请求                       FUSE_IO_URING_CMD_REGISTER = 设置环形缓冲区
  write() = 提交回复                      FUSE_IO_URING_CMD_COMMIT_AND_FETCH =
                                         提交前一个回复并获取下一个请求
  copy_to_user / copy_from_user           预注册的用户态环形缓冲区
  每个 read/write 一个请求                commit+fetch 合并在一个 SQE 中
  每个请求一次系统调用                    批量：submit_and_wait
```

### 初始化

1. `fuse_uring_create()`——分配 `fuse_ring`，`nr_queues = num_possible_cpus()`，计算 `max_payload_sz`
2. `fuse_uring_create_queue()`——每 CPU 一个队列，含 7 个列表：`ent_avail_queue`、`ent_w_req_queue`、`ent_commit_queue`、`ent_in_userspace`、`fuse_req_queue`、`fuse_req_bg_queue`、`ent_released`
3. `fuse_uring_cmd()`（`.uring_cmd` 入口点）分发：
   - `FUSE_IO_URING_CMD_REGISTER` → `fuse_uring_register()`：将 SQE 中的 2 个 iovec（消息头 + 负载）映射到用户态内存，加入 `ent_avail_queue`。当所有队列就绪时，切换 `fiq->ops` 为 `fuse_io_uring_ops` 并标记 `ring->ready`
   - `FUSE_IO_URING_CMD_COMMIT_AND_FETCH` → `fuse_uring_commit_fetch()`：从 128 字节 SQE 读取 `commit_id`/`qid`，查找请求，提交回复（从环形缓冲区拷贝消息头+负载），然后获取下一个请求

### 请求状态机

环形条目在状态间移动：`FRRS_INVALID → FRRS_COMMIT → FRRS_AVAILABLE → FRRS_FUSE_REQ → FRRS_USERSPACE → (回到 AVAILABLE)`。

### 后台请求

`fuse_uring_queue_bq_req()` 允许每个队列 1 个后台请求，独立于全局限制，提升元数据密集型负载的吞吐量。

### 拆除

`fuse_uring_stop_queues()` → 通过 `io_uring_cmd_done` 逐队列拆除，异步拆除（`FUSE_URING_TEARDOWN_TIMEOUT` = 5s）+ `fuse_uring_destruct()`。

> **引用摘要：** FUSE-over-io_uring（dev_uring.c，1457 行）用 io_uring 共享环形缓冲区替代了 `/dev/fuse` 上的 read/write——每个 CPU 一个队列。`FUSE_IO_URING_CMD_COMMIT_AND_FETCH` 操作在单个 SQE 中合并提交前一个回复和获取下一个请求，减少系统调用开销。通过 `echo 1 > /sys/module/fuse/parameters/enable_uring` + `FUSE_CAP_OVER_IO_URING`（协议 7.42）启用（fs/fuse/dev_uring.c）。

---

## FUSE_PASSTHROUGH：绕过用户态进行数据 I/O

`passthrough.c`（197 行）+ `backing.c`（~150 行）实现 FUSE_PASSTHROUGH——近年来最重要的性能特性。

### 核心思想

对于在真实文件系统上有后备存储的文件，内核可以直接对后备文件执行读/写 I/O，完全绕过用户态守护进程。用户态仍处理元数据（查找、getattr、权限检查），但数据 I/O 跳过了往返。

### 工作原理

1. **注册后备文件。** 用户态通过 `/dev/fuse` 上的 `FUSE_DEV_IOC_BACKING_OPEN` ioctl 打开后备文件（由 dev.c 中的 `fuse_dev_ioctl_backing_open()` → backing.c 中的 `fuse_backing_open()` 处理）。这将文件注册到 `fc->backing_files_map`（IDR）中并返回一个整数 `backing_id`。

2. **在 OPEN 回复中传递 ID。** 用户态在 `FUSE_OPEN` 回复中包含 `backing_id`。

3. **在打开时解析。** `fuse_passthrough_open()`（passthrough.c:152）通过 `fuse_backing_lookup()` 查找 `fuse_backing` 对象，调用 `backing_file_open()` 创建每打开的后备文件包装器，存入 `ff->passthrough`。

4. **委托 I/O。** `fuse_passthrough_read_iter()` → `backing_file_read_iter()`，`fuse_passthrough_write_iter()` → `backing_file_write_iter()`，`fuse_passthrough_mmap()` → `backing_file_mmap()`。全部委托给内核的 `backing_file` API。

### 性能影响

透传消除了数据 I/O 的用户态往返。对于以数据读写为主的负载（媒体服务、包管理、容器镜像），这可以在仍让用户态实施权限和自定义元数据逻辑的同时，显著提升吞吐量。

---

## 写回缓存（FUSE_WRITEBACK_CACHE）

没有写回缓存时，每次 `write()` 立即发往用户态（直写）。启用 `FUSE_CAP_WRITEBACK_CACHE` 后，内核在页缓存中缓冲写入，稍后刷新。

### 实现

- `fuse_inode` 写字段：`write_files` 列表、`queued_writes`、`writectr`、`iocachectr`、`page_waitq`
- `fuse_cache_write_iter()`（file.c:1481）：如果启用 `writeback_cache`，使用 `iomap_file_buffered_write()`（回写模式）；否则使用 `fuse_perform_write()`（累积 folio，通过 `fuse_send_write_pages()` 发送）
- `fuse_writepages()`（file.c:2289）：使用带 `fuse_writeback_ops` 的 `iomap_writepages()`
- `fuse_sync_bucket`：每连接桶，用于同步写完成。`fuse_sync_bucket_dec()` 在桶计数归零时唤醒等待者
- `FUSE_NOWRITE` 偏置：在 truncate/fsync 期间阻塞新写入

---

## 控制文件系统（/sys/fs/fuse/connections）

`control.c`（367 行）实现 `fusectl` 伪文件系统，在 `/sys/fs/fuse/connections/<dev>/` 暴露每连接运行时控制：

| 文件 | 模式 | 用途 |
|------|------|------|
| `waiting` | 0400 (只读) | 等待请求数（`fuse_chan_num_waiting`） |
| `abort` | 0200 (只写) | 写入以中止所有请求（`fuse_chan_abort`） |
| `max_background` | 0600 (读写) | 读取/写入最大后台请求数（受 `max_user_bgreq` 限制） |
| `congestion_threshold` | 0600 (读写) | 读取/写入拥塞阈值（受 `max_user_congthresh` 限制） |

`fuse_ctl_add_conn()` 在 `fuse_mutex` 下创建目录 + 文件。非管理员用户受全局 `max_user_*` 模块参数限制。

---

## 通知（内核侧处理）

`notify.c`（447 行）处理来自用户态的异步消息（以 `oh.unique == 0` 写入，从 `fuse_dev_do_write()` 分发）。`fuse_notify()` 按 `fuse_notify_code` 分发：

| 通知 | 处理器 | 动作 |
|------|--------|------|
| `FUSE_NOTIFY_POLL` | `fuse_notify_poll()` | 唤醒 poll 等待者 |
| `FUSE_NOTIFY_INVAL_INODE` | `fuse_notify_inval_inode()` | 失效 inode 范围的页缓存 |
| `FUSE_NOTIFY_INVAL_ENTRY` | `fuse_notify_inval_entry()` | 失效目录项缓存 |
| `FUSE_NOTIFY_DELETE` | `fuse_notify_delete()` | 失效/解除子项链接 |
| `FUSE_NOTIFY_STORE` | `fuse_notify_store()` | 将内核页缓存数据推送到用户态 |
| `FUSE_NOTIFY_RETRIEVE` | `fuse_retrieve()` | 从用户态检索数据到页缓存 |
| `FUSE_NOTIFY_RESEND` | `fuse_notify_resend()` | 重新队列化飞行中的请求（守护进程故障转移） |
| `FUSE_NOTIFY_INC_EPOCH` | `fuse_notify_inc_epoch()` | 增加 epoch + 调度目录项失效 |
| `FUSE_NOTIFY_PRUNE` | `fuse_notify_prune()` | 尝试修剪 inode（每批 512 个） |

所有处理器在查找 inode 时持有 `fc->killsb`（读），防止处理期间超级块被释放。

---

## 近期特性与未来方向

FUSE 内核模块正在积极开发中。近期新增：

- **FUSE_PASSTHROUGH**——直接内核到后备文件的 I/O，绕过用户态进行数据操作（协议 7.40）。近年来最重要的性能特性。
- **FUSE-over-io_uring**——用于降低系统调用开销的 io_uring 传输层（协议 7.42）
- **请求超时**（`req_timeout.c`）——`fuse_check_timeout()` 每 15 秒运行一次，扫描所有队列，如果任何请求超过 `req_timeout` 则中止连接
- **同步 FUSE_INIT**——SELinux 兼容性（在挂载握手期间处理请求）
- **FUSE_SECURITY_CTX**——SELinux/LSM 安全上下文透传
- **FUSE_HANDLE_KILLPRIV_V2**——改进的写/chown/trunc 权限处理
- **DAX**（`dax.c`，~1500 行）——直接访问 CXL 持久内存
- **Virtio-fs**（`virtio_fs.c`，~2000 行）——虚拟机中基于 virtio 的 FUSE
- **famfs**——CXL 附加内存文件系统（2024-2025 年开发，RFC 补丁）

---

## 如何阅读源码：新手地图

1. `fuse_i.h`——所有核心数据结构（fuse_conn、fuse_inode、fuse_file、fuse_chan）
2. `fuse_dev_i.h`——请求、通道、队列结构
3. `dev.c`——/dev/fuse 传输层和请求生命周期
4. `inode.c`——inode 操作、FUSE_INIT、超级块设置
5. `file.c`——文件操作（读、写、mmap、ioctl）
6. `dir.c`——目录操作
7. `dev_uring.c`——io_uring 传输层
8. `passthrough.c`——直接 I/O 绕过
9. `control.c`——sysfs 控制接口
10. `notify.c`——内核侧通知处理

---

## 常见问题

### FUSE 内核模块和 libfuse 之间是什么关系？

内核模块（`fs/fuse/`）拦截 VFS 调用并通过 `/dev/fuse` 转发到用户态。libfuse 是用户态库，负责读取这些请求、分发到你的文件系统回调并写回响应。双方通过 `include/uapi/linux/fuse.h` 中定义的 FUSE 协议进行通信。用户态侧的深入解读请参见我们的 [libfuse 内部实现 companion 文章](/posts/libfuse-deep-dive-software-engineer/)。

### FUSE 内核模块有多少行代码？

`fs/fuse/` 目录包含 30+ 个 `.c` 和 `.h` 文件，约 13,000+ 行。最大的文件是 `file.c`（3121 行）、`dir.c`（2498）、`dev.c`（2430）、`inode.c`（2190）、`dev_uring.c`（1457）和 `virtio_fs.c`（约 2000 行）。

### 什么是 FUSE 透传？

FUSE_PASSTHROUGH 让内核直接对后备文件执行读/写 I/O，绕过用户态守护进程进行数据操作。用户态仍处理元数据（查找、getattr）。这消除了数据 I/O 的用户态往返——对数据密集型负载来说是显著的性能提升。

### FUSE-over-io-uring 如何工作？

内核和用户态使用 io_uring 共享环形缓冲区替代 `/dev/fuse` 上的 read()/write()。`FUSE_IO_URING_CMD_COMMIT_AND_FETCH` 操作在单个 SQE 中合并提交前一个回复和获取下一个请求。这降低了系统调用开销，提升了 I/O 密集型负载的吞吐量。

### FUSE 内核模块还在积极维护吗？

是的——这也是 FUSE 故事中耐人寻味的地方。**内核模块由原作者 Miklos Szeredi 积极维护**，定期新增特性：io_uring 支持、透传、请求超时、DAX 和安全上下文透传。**但用户态 libfuse 库处于有限维护模式**（除维护者外没有活跃的常规贡献者，维护者负责合并 PR 和发布版本）。这造成了日益扩大的差距：内核模块持续获得新特性（FUSE_PASSTHROUGH、FUSE_OVER_IO_URING、请求超时、sync_init、FUSE_HANDLE_KILLPRIV_V2），而 libfuse 尚未完全支持。需要最新内核 FUSE 特性的开发者可能需要直接与内核协议交互或使用替代的用户态实现。

---

## 总结

FUSE 内核模块是 Linux VFS 与用户态文件系统之间的守门人。它的设计——具有 pending/processing/后台队列的请求生命周期、支持 /dev/fuse 和 io_uring 的传输层抽象，以及不断增长的绕过用户态的特性集——使其成为内核中最有趣的子系统之一。

源码适合自上而下阅读：从 `fuse_i.h` 的数据结构开始，`dev.c` 的请求生命周期，然后是 `file.c`/`dir.c`/`inode.c` 的 VFS 操作，最后是 `dev_uring.c` 和 `passthrough.c` 的性能特性。克隆内核树，启用 FUSE 编译，然后追踪一次从 VFS 到用户态再返回的 read() 调用。

## 来源

- Linux 内核 fs/fuse/ 源码, https://github.com/torvalds/linux/tree/master/fs/fuse
- 内核 FUSE 文档, https://www.kernel.org/doc/html/next/filesystems/fuse.html
- 内核 fuse-io-uring 文档, https://www.kernel.org/doc/html/next/filesystems/fuse-io-uring.html
- libfuse 深度剖析（companion 文章）, /posts/libfuse-deep-dive-software-engineer/
- include/uapi/linux/fuse.h（FUSE 协议头文件）, https://github.com/torvalds/linux/blob/master/include/uapi/linux/fuse.h
