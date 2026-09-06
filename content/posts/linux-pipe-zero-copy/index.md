---
title: "What Really Happens When You Call pipe()? — Circular Buffer and Zero-Copy Magic"
description: "pipe() is not just a kernel buffer. It uses a circular ring of page-sized buffers with head/tail indices. Page stealing enables zero-copy splice(). Source analysis reveals the mechanism."
coverImage: "/posts/linux-pipe-zero-copy/images/cover.jpg"
coverImageAlt: "A ball representing the Linux kernel's pipe implementation — a circular buffer of page-sized buffers with zero-copy page stealing"
ogImage: "/posts/linux-pipe-zero-copy/images/cover.jpg"
date: "date: 2026-09-06 15:00:00"
lastUpdated: "2026-09-06 15:00:00"
author: "FindNS94"
tags: ["Linux", "Kernel", "IPC"]
---

![A ball representing the Linux kernel's pipe implementation — a circular buffer of page-sized buffers with zero-copy page stealing](/posts/linux-pipe-zero-copy/images/cover.jpg)

# What Really Happens When You Call pipe()? — Circular Buffer and Zero-Copy Magic

Every Unix developer has used `pipe()` — it's one of the oldest IPC mechanisms. Most imagine it as a simple kernel buffer: write data in one end, read it out the other. But the actual implementation is far more interesting.

A pipe is a **circular ring of page-sized buffers** (default 16 pages = 64 KB on x86). The kernel tracks `head` and `tail` indices that wrap around naturally (power-of-2 ring size). And the most clever trick: **page stealing** — when data moves from a file to a pipe via `splice()`, the kernel doesn't copy the data. It "steals" the page pointer, mapping the same physical page into both the file's page cache and the pipe's buffer.

This article walks through the pipe source in `fs/pipe.c` to explain the circular buffer, the `pipe_buffer` operations table, and how `splice()` achieves zero-copy.

<!-- [UNIQUE INSIGHT] The most counterintuitive fact about pipes is that `splice()` can move data from a file to a socket WITHOUT copying it to userspace. The kernel "steals" the page from the file's page cache and maps it into the pipe's circular buffer. The data never moves — only the page pointer is transferred. This is how `sendfile()` achieves zero-copy: file → pipe → socket, all in kernel space. -->

<!-- more -->

> **Key Takeaways**
> - pipe() creates a circular ring of 16 page-sized buffers (64 KB default)
> - head/tail indices wrap naturally (power-of-2 ring size)
> - `pipe_buffer` has an `ops` function table: confirm, release, try_steal, get
> - Page stealing: `splice()` moves data without copying (transfers page pointer)
> - `F_SETPIPE_SZ` can grow the pipe up to 1 MB (configurable)
> - `PIPE_MIN_DEF_BUFFERS`: at least 2 buffers (needed for GNU make jobserver)

---

## The Myth: "pipe() is a Simple Kernel Buffer"

The mental model: `pipe()` creates a kernel buffer → `write()` puts data in → `read()` takes data out. This is wrong.

What actually happens:

```
  pipe(fildes)
       │
       ▼
  ┌─────────────────────────────────────────────────────────────────────┐
  │ do_pipe2() — fs/pipe.c                                              │
  │ • Allocates pipe_inode_info                                         │
  │ • Allocates 16 pipe_buffer structures (each = 1 page = 4 KB)        │
  │ • Creates two struct file: read end + write end                    │
  │ • Installs both with fd_install()                                   │
  └─────────────────────────────────────────────────────────────────────┘
       │
       ▼
  ┌─────────────────────────────────────────────────────────────────────┐
  │ Circular Buffer Structure                                           │
  │                                                                     │
  │  ┌─────┐ ┌─────┐ ┌─────┐ ┌─────┐ ┌─────┐ ┌─────┐ ┌─────┐ ┌─────┐ │
  │  │ buf │ │ buf │ │ buf │ │ buf │ │ buf │ │ buf │ │ buf │ │ buf │ │
  │  │  0  │ │  1  │ │  2  │ │  3  │ │  4  │ │  5  │ │  6  │ │  7  │ │
  │  └─────┘ └─────┘ └─────┘ └─────┘ └─────┘ └─────┘ └─────┘ └─────┘ │
  │     ↑                                       ↑                       │
  │   tail                                    head                      │
  │   (read)                                 (write)                    │
  └─────────────────────────────────────────────────────────────────────┘
```

---

## The Circular Buffer

```c
// include/linux/pipe_fs_i.h
struct pipe_inode_info {
    struct mutex mutex;
    wait_queue_head_t rd_wait, wr_wait;
    unsigned int head, tail;         // Circular buffer indices
    unsigned int max_usage;
    unsigned int ring_size;          // Power of 2, default 16
    unsigned int nr_accounted;
    unsigned int readers, writers, files;
    unsigned int r_counter, w_counter;
    bool pseudo_edgetrigger;
    struct anon_pipe_prealloc prealloc;
    struct fasync_struct *fasync_readers, *fasync_writers;
    struct pipe_buffer *bufs;        // Array of pipe buffers (the ring)
    struct user_struct *user;
};
```

### `pipe_buffer`: The Buffer Structure

```c
// include/linux/pipe_fs_i.h
struct pipe_buffer {
    struct page *page;      // The physical page
    unsigned int offset, len;
    const struct pipe_buf_operations *ops;
    unsigned int flags;
};
```

### `pipe_buf_operations`: The Function Table

```c
// include/linux/pipe_fs_i.h
struct pipe_buf_operations {
    int (*confirm)(struct pipe_inode_info *, struct pipe_buffer *);
    void (*release)(struct pipe_inode_info *, struct pipe_buffer *);
    bool (*try_steal)(struct pipe_inode_info *, struct pipe_buffer *);
    bool (*get)(struct pipe_inode_info *, struct pipe_buffer *);
};
```

These functions enable the zero-copy magic:
- **`confirm()`**: Verify the buffer is ready for use
- **`release()`**: Free the buffer (may free the page)
- **`try_steal()`**: Attempt to "steal" the page (zero-copy!)
- **`get()`**: Take a reference to the buffer

---

## Read/Write Path

### `pipe_write()`

```c
// fs/pipe.c — pipe_write()
static ssize_t pipe_write(struct pipe_inode_info *pipe, struct iov_iter *from)
{
    int head = pipe->head;
    int tail = pipe->tail;
    int offset, count;

    // Get a buffer at head position
    struct pipe_buffer *buf = &pipe->bufs[head & (pipe->ring_size - 1)];

    // If buffer is empty, allocate a new page
    if (!buf->page) {
        buf->page = alloc_page(GFP_KERNEL);
        if (!buf->page)
            return -ENOMEM;
        buf->ops = &anon_pipe_buf_ops;
    }

    // Copy user data into the page
    offset = buf->offset + buf->len;
    count = min_t(size_t, PAGE_SIZE - offset, from->count);
    copy_page_from_iter(buf->page, offset, count, from);

    // Update buffer length
    buf->len += count;

    // Advance head
    pipe->head = head + 1;

    // Wake up readers
    wake_up_interruptible_sync_poll(&pipe->rd_wait, EPOLLIN);

    return count;
}
```

### `pipe_read()`

```c
// fs/pipe.c — pipe_read()
static ssize_t pipe_read(struct pipe_inode_info *pipe, struct iov_iter *to)
{
    int head = pipe->head;
    int tail = pipe->tail;

    // Get a buffer at tail position
    struct pipe_buffer *buf = &pipe->bufs[tail & (pipe->ring_size - 1)];

    // Copy data from page to user
    copy_page_to_iter(buf->page, buf->offset, buf->len, to);

    // Release the buffer
    buf->ops->release(pipe, buf);

    // Advance tail
    pipe->tail = tail + 1;

    // Wake up writers
    wake_up_interruptible_sync_poll(&pipe->wr_wait, EPOLLOUT);

    return buf->len;
}
```

---

## Deep Detail: Page Stealing

### The Problem: Copying is Expensive

Moving data from a file to a socket traditionally requires:
1. Read file → kernel buffer
2. Copy kernel buffer → userspace
3. Copy userspace → kernel buffer
4. Write kernel buffer → socket

That's 4 copies. Page stealing eliminates all of them.

### `splice()`: Zero-Copy

```c
// fs/splice.c — do_splice()
ssize_t do_splice(struct file *in, loff_t *ppos, struct file *out,
                  loff_t *opos, size_t len, unsigned int flags)
{
    struct pipe_inode_info *pipe = get_pipe_info(out, true);

    // Splice from file to pipe
    if (pipe) {
        // Try to steal pages from the file's page cache
        if (in->f_op->splice_read)
            return in->f_op->splice_read(in, ppos, pipe, len, flags);
    }
    // ...
}
```

### `page_file_pipe()`: The Steal Function

```c
// fs/splice.c — page_file_pipe()
static int page_file_pipe(struct page *page, struct pipe_inode_info *pipe,
                          size_t offset, size_t len)
{
    struct pipe_buffer *buf;
    int ret;

    // Get a buffer at head position
    buf = &pipe->bufs[pipe->head & (pipe->ring_size - 1)];

    // Try to steal the page
    ret = buf->ops->try_steal(pipe, buf);
    if (ret) {
        // Steal failed — copy the page
        buf->page = page;
        buf->offset = offset;
        buf->len = len;
    } else {
        // Steal succeeded — page is now shared!
        get_page(page);  // Increment refcount
    }

    pipe->head++;
    return 0;
}
```

### The Result

```
  Before splice:
  File page cache: [page A] [page B] [page C]
  Pipe:            [empty] [empty] [empty]

  After splice (with page stealing):
  File page cache: [page A] [page B] [page C]
                        ↓         ↓         ↓
  Pipe:            [page A] [page B] [page C]
                   (shared)  (shared)  (shared)

  Data was NOT copied — only page pointers were transferred!
```

---

## How to Observe Pipe Behavior

### Using bpftrace

```bash
#!/usr/bin/env bpftrace
// trace_pipe.bt

kprobe:do_pipe2
{
    @pipe_create[comm] = count();
}

kprobe:pipe_write
{
    @pipe_write[comm] = count();
}

kprobe:pipe_read
{
    @pipe_read[comm] = count();
}

kprobe:do_splice
{
    @splice[comm] = count();
}
```

### Using /proc

```bash
// Per-process pipe usage
ls -la /proc/<pid>/fd/ | grep pipe

// Pipe capacity
cat /proc/sys/fs/pipe-max-size

// F_SETPIPE_SZ example
fcntl(fd, F_SETPIPE_SZ, 1048576);  // Grow to 1 MB
```

---

## Frequently Asked Questions

### What is the default pipe size?
64 KB (16 pages × 4 KB). Configurable via `F_SETPIPE_SZ` up to `pipe-max-size` (default 1 MB).

### What is page stealing?
When `splice()` moves data from a file to a pipe, it "steals" the page pointer instead of copying data. The same physical page is shared between the file's page cache and the pipe's buffer.

### When does page stealing fail?
If the page is pinned (e.g., by a DMA operation) or has special flags, the steal fails and the kernel falls back to copying.

### What is `PIPE_MIN_DEF_BUFFERS`?
At least 2 buffers are needed for the GNU make jobserver pattern, where multiple writers may block simultaneously.

### How does `sendfile()` work?
`sendfile()` uses `splice()` internally: file → pipe → socket, all in kernel space with zero-copy page stealing.

---

## Conclusion

A pipe is not a simple kernel buffer — it's a circular ring of page-sized buffers with head/tail indices. The most clever trick is page stealing: `splice()` moves data without copying by transferring page pointers. This enables zero-copy data movement from file to socket.

For production systems, the practical takeaways are: pipes use circular buffers (power-of-2 size), page stealing enables zero-copy, and `splice()`/`sendfile()` leverage this for high-performance I/O.

---

## Sources

- Linux kernel source, `fs/pipe.c`, `pipe_write()` and `pipe_read()`
- Linux kernel source, `fs/splice.c`, `do_splice()`
- Linux kernel source, `include/linux/pipe_fs_i.h`, `pipe_inode_info`
- Linux kernel source, `include/linux/pipe_fs_i.h`, `pipe_buf_operations`
