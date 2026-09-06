---
title: "socket 究竟是什么？——文件描述符、协议栈与 VFS 的三位一体"
description: "socket 不是特殊对象 — 它是由 VFS 支持的文件描述符。内核将 struct socket 嵌入 VFS inode 中，使 socket 能使用标准文件描述符表。源码分析揭示技巧。"
coverImage: "/posts/linux-socket-essence/images/cover.jpg"
coverImageAlt: "一个 USB 钥匙，代表 Linux 内核的 socket 实现 — 由 VFS 支持的文件描述符，桥接用户态和协议栈"
ogImage: "/posts/linux-socket-essence/images/cover.jpg"
date: "2026-09-06 12:00:00"
lastUpdated: "2026-09-06 12:00:00"
author: "FindNS94"
tags: ["Kernel", "Linux"]
---

![一个 USB 钥匙，代表 Linux 内核的 socket 实现 — 由 VFS 支持的文件描述符，桥接用户态和协议栈](/posts/linux-socket-essence/images/cover.jpg)

# socket 究竟是什么？——文件描述符、协议栈与 VFS 的三位一体

每个网络程序员都调用过 `socket(AF_INET, SOCK_STREAM, 0)` 并获得文件描述符。但 socket 在内核中究竟是什么？它是特殊的网络对象？文件？协议端点？

答案优雅而令人惊讶：**socket 是由 VFS inode 支持的文件描述符**。内核将 `struct socket` 嵌入 VFS inode 中，使 socket 能使用标准文件描述符表、标准 `file_operations` 调度，甚至出现在 `/proc/<pid>/fd/` 中。这就是 Unix"一切皆文件"哲学的本质 — 甚至网络连接也是文件。

本文通过 `net/socket.c` 中的 socket 源码来解释 `socket()` 如何创建 VFS inode，`sock_map_fd()` 如何将其安装为文件描述符，以及 `socket_file_operations` 调度表如何将 `read()` 和 `write()` 等标准调用连接到网络栈。

<!-- [UNIQUE INSIGHT] 关于 socket 最反直觉的事实是 `struct socket` 不是单独分配的 — 它通过 `container_of()` 嵌入在 VFS inode 中。当你调用 `socket()` 时，内核分配一个特殊 inode（来自 `socket_mnt` 伪文件系统），将 socket 结构嵌入其中，并返回指向该 inode 的文件描述符。这意味着 `dup()`、`fork()` 甚至 `sendfile()` 在 socket 上工作无需任何特殊处理 — 它们只是文件。 -->

<!-- more -->

> **核心要点**
> - socket 是由 VFS inode 支持的文件描述符 — 不是特殊的网络对象
> - `struct socket` 通过 `container_of()` 嵌入在 VFS inode 中
> - `socket_file_operations` 将 read/write/poll 调度到网络栈
> - `struct socket`（用户接口）vs `struct sock`（协议状态）— 同一对象的两个视图
> - Unix domain socket 使用垃圾回收检测不可达的 socket 环

---

## 误区："socket 是特殊的网络对象"

心智模型：`socket()` 创建特殊网络端点 → 返回句柄 → `send()`/`recv()` 使用该句柄。这是错误的。

实际发生的是：

```
  socket(AF_INET, SOCK_STREAM, 0)
       │
       ▼
  ┌─────────────────────────────────────────────────────────────────────┐
  │ 第 1 步：sock_create()                                              │
  │ • 从 socket_mnt（伪文件系统）分配 VFS inode                         │
  │ • 将 struct socket 嵌入 inode                                       │
  │ • 从 inet_stream_ops 初始化 socket->ops                             │
  └─────────────────────────────────────────────────────────────────────┘
       │
       ▼
  ┌─────────────────────────────────────────────────────────────────────┐
  │ 第 2 步：sock_map_fd()                                              │
  │ • 分配文件描述符                                                     │
  │ • 创建带有 socket_file_operations 的 struct file                    │
  │ • 安装 fd → file 映射                                               │
  └─────────────────────────────────────────────────────────────────────┘
       │
       ▼
  ┌─────────────────────────────────────────────────────────────────────┐
  │ 结果：fd 是常规文件描述符                                            │
  │ • read() → socket_file_operations.read → sock_read()                │
  │ • write() → socket_file_operations.write → sock_write()             │
  │ • poll() → socket_file_operations.poll → sock_poll()                │
  │ • close() → socket_file_operations.release → sock_close()           │
  └─────────────────────────────────────────────────────────────────────┘
```

---

## `socket()` 系统调用

```c
// net/socket.c — __sys_socket()
int __sys_socket(int family, int type, int protocol)
{
    int retval;

    // 创建 socket（分配 VFS inode + struct socket）
    retval = sock_create(family, type, protocol, &sock);
    if (retval < 0)
        return retval;

    // 安装为文件描述符
    return sock_map_fd(sock, flags);
}
```

### `sock_alloc()`：VFS Inode 技巧

```c
// net/socket.c — sock_alloc()
struct socket *sock_alloc(void)
{
    struct inode *inode;
    struct socket *sock;

    // 从 socket socket_mnt 伪文件系统分配 VFS inode
    inode = new_inode_pseudo(socket_mnt->mnt_sb);
    if (!inode)
        return NULL;

    // 将 socket 嵌入 inode
    sock = SOCKET_I(inode);  // container_of(inode, struct socket, vfs_inode)

    // 初始化 socket 字段
    sock->wq = alloc_workqueue("sock_wq", 0, 0);
    inode->i_ino = get_next_ino();
    inode->i_mode = S_IFSOCK | S_IRWXUGO;
    inode->i_uid = current_fsuid();
    inode->i_gid = current_fsgid();
    inode->i_op = &sockfs_inode_ops;
    inode->i_fop = &socket_file_operations;

    return sock;
}
```

---

## `struct socket` vs `struct sock`

Socket 有两个表示：

```c
// include/linux/net.h
struct socket {
    socket_state state;            // SS_UNCONNECTED, SS_CONNECTING 等
    short type;                    // SOCK_STREAM, SOCK_DGRAM 等
    unsigned long flags;
    struct file *file;             // 指向 file 的回指针
    struct sock *sk;               // 内核网络 socket（协议状态）
    const struct proto_ops *ops;   // 协议族特定操作
    struct socket_wq *wq;          // 等待队列
};

// include/net/sock.h
struct sock {
    struct sock_common __sk_common;  // 寻址：sk_daddr, sk_rcv_saddr, sk_dport, sk_num
    // ... 按缓存行组织的协议特定字段
    struct sk_buff_head sk_receive_queue;  // 已接收数据包等待用户读取
    struct sk_buff_head sk_write_queue;    // 排队等待传输的数据包
    // ...
};
```

- **`struct socket`**：用户-facing 接口（VFS 层）— `read()`/`write()` 操作的对象
- **`struct sock`**：内核协议状态（网络层）— TCP/IP 栈操作的对象

它们链接：`socket->sk` 指向协议状态，`sk->sk_socket` 指回 VFS socket。

---

## `socket_file_operations`：调度表

```c
// net/socket.c
const struct file_operations socket_file_operations = {
    .owner = THIS_MODULE,
    .llseek = no_llseek,           // socket 不支持 seek
    .read_iter = sock_read_msg,    // read() → sock_read_msg()
    .write_iter = sock_write_msg,  // write() → sock_write_msg()
    .poll = sock_poll,             // poll() → sock_poll()
    .release = sock_close,         // close() → sock_close()
    .unlocked_ioctl = sock_ioctl,  // ioctl() → sock_ioctl()
    .mmap = sock_mmap,             // mmap() → sock_mmap()
    .sendpage = sock_sendpage,     // sendfile() 支持
};
```

这就是为什么 socket 上的 `read()` 有效 — 它被调度到 `sock_read_msg()`，后者从 socket 的接收队列读取。

---

## 深度细节：socket inode 嵌入

`struct socket` 结构嵌入 VFS inode：

```c
// net/socket.c
struct socket_alloc {
    struct socket socket;      // 用户-facing socket
    struct inode vfs_inode;    // VFS inode（嵌入）
};
```

当 `sock_alloc()` 分配 `struct socket_alloc` 时，它在单次分配中获得 `struct socket` 和 `struct inode`。inode 的地址与 `socket_alloc` 结构相同，`SOCKET_I()` 使用 `container_of()` 从 inode 恢复 socket。

---

## 如何观测 Socket 行为

### 使用 bpftrace

```bash
#!/usr/bin/env bpftrace
// trace_socket.bt

kprobe:sock_create
{
    @socket_create[comm] = count();
}

kprobe:sock_read_msg
{
    @sock_read[comm] = count();
}

kprobe:sock_write_msg
{
    @sock_write[comm] = count();
}

kprobe:sock_close
{
    @sock_close[comm] = count();
}
```

### 使用 /proc

```bash
// TCP socket
cat /proc/net/tcp

// UDP socket
cat /proc/net/udp

// Unix domain socket
cat /proc/net/unix

// 每进程文件描述符
ls -la /proc/<pid>/fd/
```

---

## 常见问题

### 为什么 socket 是文件描述符？
因为 Linux 遵循"一切皆文件"哲学。使 socket 成为文件描述符意味着 `read()`、`write()`、`poll()`、`select()` 甚至 `fork()` 在 socket 上工作无需特殊处理。

### `struct socket` 和 `struct sock` 有什么区别？
`struct socket` 是用户-facing 接口（VFS 层）。`struct sock` 是内核协议状态（网络层）。它们链接：`socket->sk` 指向协议状态。

### `dup()` 如何在 socket 上工作？
`dup()` 创建指向同一 `struct file` 的新文件描述符。两个 fd 共享相同的 socket（相同的接收队列、相同的发送队列、相同的协议状态）。

### 什么是 `socket_mnt` 伪文件系统？
用于为 socket 分配 VFS inode 的隐藏文件系统。它没有挂载点 — 它存在仅为 socket 提供 VFS 基础设施。

### `sendfile()` 如何工作？
`sendfile()` 将数据直接从文件的页缓存移动到 socket 的发送缓冲区而无需拷贝到用户态。它使用 `splice()` 基础设施。

---

## 总结

socket 不是特殊的网络对象 — 它是由 VFS inode 支持的文件描述符。内核将 `struct socket` 嵌入 VFS inode 中，使 socket 能使用标准文件描述符表和 `file_operations` 调度。这种优雅的设计使"一切皆文件"对网络 I/O 成为可能。

对于生产系统，实际要点是：socket 是文件（所以标准文件操作有效），`struct socket` 和 `struct sock` 是同一对象的两个视图，理解这种设计有助于使用标准文件工具调试网络问题。

---

## 来源

- Linux 内核源码, `net/socket.c`, `__sys_socket()`
- Linux 内核源码, `net/socket.c`, `sock_alloc()`
- Linux 内核源码, `net/socket.c`, `sock_map_fd()`
- Linux 内核源码, `net/socket.c`, `socket_file_operations`
- Linux 内核源码, `include/linux/net.h`, `struct socket`
- Linux 内核源码, `include/net/sock.h`, `struct sock`
