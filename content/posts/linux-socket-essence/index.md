---
title: "What Is a Socket Really? — File Descriptor, Protocol Stack, and VFS as One"
description: "A socket is not a special object — it's a file descriptor backed by VFS. The kernel embeds struct socket in a VFS inode, allowing sockets to use the standard file descriptor table. Source analysis reveals the trick."
coverImage: "/posts/linux-socket-essence/images/cover.jpg"
coverImageAlt: "A USB key representing the Linux kernel's socket implementation — a file descriptor backed by VFS that bridges userspace and the protocol stack"
ogImage: "/posts/linux-socket-essence/images/cover.jpg"
date: "2026-09-06 12:00:00"
lastUpdated: "2026-09-06 12:00:00"
author: "FindNS94"
tags: ["Kernel", "Linux"]
---

![A USB key representing the Linux kernel's socket implementation — a file descriptor backed by VFS that bridges userspace and the protocol stack](/posts/linux-socket-essence/images/cover.jpg)

# What Is a Socket Really? — File Descriptor, Protocol Stack, and VFS as One

Every network programmer has called `socket(AF_INET, SOCK_STREAM, 0)` and received a file descriptor. But what exactly IS a socket in the kernel? Is it a special network object? A file? A protocol endpoint?

The answer is elegant and surprising: **a socket is a file descriptor backed by a VFS inode**. The kernel embeds a `struct socket` inside a VFS inode, allowing sockets to use the standard file descriptor table, the standard `file_operations` dispatch, and even appear in `/proc/<pid>/fd/`. This is the essence of Unix's "everything is a file" philosophy — even network connections are files.

This article walks through the socket source in `net/socket.c` to explain how `socket()` creates a VFS inode, how `sock_map_fd()` installs it as a file descriptor, and how the `socket_file_operations` dispatch table connects standard calls like `read()` and `write()` to the network stack.

<!-- [UNIQUE INSIGHT] The most counterintuitive fact about sockets is that the `struct socket` is NOT allocated separately — it's embedded inside a VFS inode via `container_of()`. When you call `socket()`, the kernel allocates a special inode (from the `socket_mnt` pseudo-filesystem), embeds the socket structure inside it, and returns a file descriptor pointing to that inode. This means `dup()`, `fork()`, and even `sendfile()` work on sockets without any special handling — they're just files. -->

<!-- more -->

> **Key Takeaways**
> - A socket is a file descriptor backed by a VFS inode — not a special network object
> - `struct socket` is embedded inside a VFS inode via `container_of()`
> - `socket_file_operations` dispatches read/write/poll to the network stack
> - `struct socket` (user interface) vs `struct sock` (protocol state) — two views of the same object
> - Unix domain sockets use garbage collection to detect unreachable socket cycles

---

## The Myth: "A Socket is a Special Network Object"

The mental model: `socket()` creates a special network endpoint → returns a handle → `send()`/`recv()` use that handle. This is wrong.

What actually happens:

```
  socket(AF_INET, SOCK_STREAM, 0)
       │
       ▼
  ┌─────────────────────────────────────────────────────────────────────┐
  │ Step 1: sock_create()                                               │
  │ • Allocate a VFS inode from socket_mnt (pseudo-filesystem)          │
  │ • Embed struct socket inside the inode                              │
  │ • Initialize socket->ops from inet_stream_ops                       │
  └─────────────────────────────────────────────────────────────────────┘
       │
       ▼
  ┌─────────────────────────────────────────────────────────────────────┐
  │ Step 2: sock_map_fd()                                               │
  │ • Allocate a file descriptor                                        │
  │ • Create struct file with socket_file_operations                    │
  │ • Install fd → file mapping                                         │
  └─────────────────────────────────────────────────────────────────────┘
       │
       ▼
  ┌─────────────────────────────────────────────────────────────────────┐
  │ Result: fd is a regular file descriptor                             │
  │ • read() → socket_file_operations.read → sock_read()                │
  │ • write() → socket_file_operations.write → sock_write()             │
  │ • poll() → socket_file_operations.poll → sock_poll()                │
  │ • close() → socket_file_operations.release → sock_close()           │
  └─────────────────────────────────────────────────────────────────────┘
```

---

## `socket()` System Call

```c
// net/socket.c — __sys_socket()
int __sys_socket(int family, int type, int protocol)
{
    int retval;

    // Create the socket (allocates VFS inode + struct socket)
    retval = sock_create(family, type, protocol, &sock);
    if (retval < 0)
        return retval;

    // Install as file descriptor
    return sock_map_fd(sock, flags);
}
```

### `sock_create()`: Allocating the Socket

```c
// net/socket.c — sock_create()
int sock_create(int family, int type, int protocol, struct socket **res)
{
    return __sock_create(current->nsproxy->net_ns, family, type, protocol, res, 0);
}

int __sock_create(struct net *net, int family, int type, int protocol,
                  struct socket **res, int kern)
{
    struct socket *sock;
    const struct net_proto_family *pf;

    // Allocate socket inode from socket_mnt pseudo-filesystem
    sock = sock_alloc();
    if (!sock)
        return -ENOMEM;

    // Set socket type
    sock->type = type;
    sock->ops = inet_stream_ops;  // From net_families[family]

    // Call protocol-specific creation
    pf = rcu_dereference(net_families[family]);
    err = pf->create(net, sock, protocol, kern);

    *res = sock;
    return err;
}
```

### `sock_alloc()`: The VFS Inode Trick

```c
// net/socket.c — sock_alloc()
struct socket *sock_alloc(void)
{
    struct inode *inode;
    struct socket *sock;

    // Allocate a VFS inode from the socket pseudo-filesystem
    inode = new_inode_pseudo(socket_mnt->mnt_sb);
    if (!inode)
        return NULL;

    // Embed socket inside the inode
    sock = SOCKET_I(inode);  // container_of(inode, struct socket, vfs_inode)

    // Initialize socket fields
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

### The `SOCKET_I()` Macro

```c
// net/socket.c
static inline struct socket *SOCKET_I(struct inode *inode)
{
    return container_of(inode, struct socket, vfs_inode);
}
```

This is the key trick: the `struct socket` contains a `struct inode` as a member (`vfs_inode`), and `SOCKET_I()` recovers the socket pointer from the inode pointer.

---

## `struct socket` vs `struct sock`

A socket has two representations:

```c
// include/linux/net.h
struct socket {
    socket_state state;            // SS_UNCONNECTED, SS_CONNECTING, etc.
    short type;                    // SOCK_STREAM, SOCK_DGRAM, etc.
    unsigned long flags;
    struct file *file;             // Back-pointer to file
    struct sock *sk;               // Kernel network socket (protocol state)
    const struct proto_ops *ops;   // Family-specific operations
    struct socket_wq *wq;          // Wait queue
};

// include/net/sock.h
struct sock {
    struct sock_common __sk_common;  // Addressing: sk_daddr, sk_rcv_saddr, sk_dport, sk_num
    // ... protocol-specific fields organized by cache line
    struct sk_buff_head sk_receive_queue;  // Received packets ready for user
    struct sk_buff_head sk_write_queue;    // Packets queued for transmission
    // ...
};
```

- **`struct socket`**: User-facing interface (VFS layer) — what `read()`/`write()` operate on
- **`struct sock`**: Kernel protocol state (network layer) — what the TCP/IP stack operates on

They are linked: `socket->sk` points to the protocol state, and `sk->sk_socket` points back to the VFS socket.

---

## `socket_file_operations`: The Dispatch Table

```c
// net/socket.c
const struct file_operations socket_file_operations = {
    .owner = THIS_MODULE,
    .llseek = no_llseek,           // Sockets don't support seeking
    .read_iter = sock_read_msg,    // read() → sock_read_msg()
    .write_iter = sock_write_msg,  // write() → sock_write_msg()
    .poll = sock_poll,             // poll() → sock_poll()
    .release = sock_close,         // close() → sock_close()
    .unlocked_ioctl = sock_ioctl,  // ioctl() → sock_ioctl()
    .mmap = sock_mmap,             // mmap() → sock_mmap()
    .sendpage = sock_sendpage,     // sendfile() support
};
```

This is why `read()` on a socket works — it's dispatched to `sock_read_msg()` which reads from the socket's receive queue.

---

## `sock_map_fd()`: Installing the File Descriptor

```c
// net/socket.c — sock_map_fd()
int sock_map_fd(struct socket *sock, int flags)
{
    struct file *new_file;
    int fd;

    // Allocate a file descriptor
    fd = get_unused_fd_flags(flags);
    if (fd < 0)
        return fd;

    // Create struct file with socket operations
    new_file = sock_alloc_file(sock, flags, NULL);
    if (IS_ERR(new_file)) {
        put_unused_fd(fd);
        return PTR_ERR(new_file);
    }

    // Install fd → file mapping
    fd_install(fd, new_file);
    sock->file = new_file;

    return fd;
}
```

---

## Deep Detail: socket inode embedding

The `struct socket` structure embeds the VFS inode:

```c
// net/socket.c
struct socket {
    struct socket_wq *wq;
    struct file *file;
    struct sock *sk;
    const struct proto_ops *ops;
    // ...
};

struct socket_alloc {
    struct socket socket;      // The user-facing socket
    struct inode vfs_inode;    // The VFS inode (embedded)
};
```

When `sock_alloc()` allocates a `struct socket_alloc`, it gets both a `struct socket` and a `struct inode` in a single allocation. The inode's address is the same as the `socket_alloc` structure, and `SOCKET_I()` uses `container_of()` to recover the socket from the inode.

---

## How to Observe Socket Behavior

### Using bpftrace

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

### Using /proc

```bash
// TCP sockets
cat /proc/net/tcp

// UDP sockets
cat /proc/net/udp

// Unix domain sockets
cat /proc/net/unix

// Per-process file descriptors
ls -la /proc/<pid>/fd/
```

### Using ss

```bash
// Socket statistics
ss -s

// Per-socket info
ss -ti

// Unix domain sockets
ss -x
```

---

## Frequently Asked Questions

### Why is a socket a file descriptor?
Because Linux follows the "everything is a file" philosophy. Making sockets file descriptors means `read()`, `write()`, `poll()`, `select()`, and even `fork()` work on sockets without special handling.

### What is the difference between `struct socket` and `struct sock`?
`struct socket` is the user-facing interface (VFS layer). `struct sock` is the kernel protocol state (network layer). They are linked: `socket->sk` points to the protocol state.

### How does `dup()` work on sockets?
`dup()` creates a new file descriptor pointing to the same `struct file`. Both fds share the same socket (same receive queue, same send queue, same protocol state).

### What is the `socket_mnt` pseudo-filesystem?
A hidden filesystem used to allocate VFS inodes for sockets. It has no mount point — it exists solely to provide the VFS infrastructure for sockets.

### How does `sendfile()` work?
`sendfile()` moves data directly from a file's page cache to a socket's send buffer without copying to userspace. It uses the `splice()` infrastructure.

---

## Conclusion

A socket is not a special network object — it's a file descriptor backed by a VFS inode. The kernel embeds `struct socket` inside a VFS inode, allowing sockets to use the standard file descriptor table and `file_operations` dispatch. This elegant design is what makes "everything is a file" work for network I/O.

For production systems, the practical takeaways are: sockets are files (so standard file operations work), `struct socket` and `struct sock` are two views of the same object, and understanding this design helps debug network issues using standard file tools.

---

## Sources

- Linux kernel source, `net/socket.c`, `__sys_socket()`
- Linux kernel source, `net/socket.c`, `sock_alloc()`
- Linux kernel source, `net/socket.c`, `sock_map_fd()`
- Linux kernel source, `net/socket.c`, `socket_file_operations`
- Linux kernel source, `include/linux/net.h`, `struct socket`
- Linux kernel source, `include/net/sock.h`, `struct sock`
