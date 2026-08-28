---
title: "How Does libfuse Work Under the Hood? A Software Engineer's Code Walkthrough"
description: "libfuse powers sshfs, s3fs, mergerfs and thousands of FUSE filesystems. This deep dive walks through the source — the dispatch pipeline, session lifecycle, io_uring transport, and the two APIs — so you can read the code like an insider."
coverImage: "/posts/libfuse-deep-dive-software-engineer/images/cover.png"
coverImageAlt: "A terminal screen displaying Linux system code, representing the libfuse library that bridges userspace filesystems and the Linux kernel"
ogImage: "/posts/libfuse-deep-dive-software-engineer/images/cover.png"
date: "2026-08-22 20:00:00"
lastUpdated: "2026-08-22 20:00:00"
author: "FindNS94"
tags: [Linux, Kernel, Open Source]
---

![A terminal screen displaying Linux system code, representing the libfuse library that bridges userspace filesystems and the Linux kernel](/posts/libfuse-deep-dive-software-engineer/images/cover.png)

# How Does libfuse Work Under the Hood? A Software Engineer's Code Walkthrough

Every FUSE filesystem you have ever used — sshfs mounting a remote server, s3fs browsing an S3 bucket, mergerfs pooling disks, GVfs exposing GNOME mounts — is just a userspace program talking to `/dev/fuse` through one library. That library is **libfuse**, the reference implementation of the FUSE (Filesystem in Userspace) protocol. It has shipped in every major Linux distribution for over two decades, accumulated roughly 6.1 thousand GitHub stars and 270+ contributors ([libfuse GitHub](https://github.com/libfuse/libfuse)), and yet its internals are rarely explained from the code.

The problem is that libfuse is dense. The repository spans roughly 2.5 MB of C across `lib/`, `include/`, `example/`, `util/`, `test/`, and `doc/`. It offers two distinct APIs — a high-level synchronous API and a low-level asynchronous API — that confuse newcomers. The kernel↔userspace protocol is documented in `doc/kernel.txt` but never tied back to the dispatch code. And the newest major feature, `fuse-over-io-uring`, landed in 3.18.0 (December 2025) with almost no public walkthrough.

This article fixes that. We will walk through the source top-down: what libfuse is, how the two APIs differ, the request dispatch pipeline, the session lifecycle, the io_uring transport, the example files, and a reading map for newcomers. By the end you will understand the library well enough to read `fuse_lowlevel.c` — the 144 KB core — and know exactly what each function does.

<!-- [UNIQUE INSIGHT] Most tutorials explain FUSE from the consumer's side (how to write a filesystem). This post explains it from the library's side (how libfuse itself is built). Understanding the library's internals makes you a better FUSE developer because you see exactly what overhead the high-level API adds and when to drop down to the low-level API. -->

> **Key Takeaways**
> - libfuse provides two APIs: the **high-level** API (`fuse.c`, path-based, synchronous callbacks) and the **low-level** API (`fuse_lowlevel.c`, inode-based, explicit `fuse_reply_*()` calls). The high-level API is a thin wrapper over the low-level one.
> - Every FUSE operation follows one pipeline: kernel → `/dev/fuse` → `fuse_session_receive()` → opcode-indexed dispatch table → your callback → `fuse_reply_*()` → kernel. The dispatch table `fuse_ll_ops[]` is the single most important data structure in the library.
> - `fuse-over-io-uring` (3.18.0, December 2025) replaces read/write on `/dev/fuse` with io_uring queues — one per CPU core — reducing syscall overhead. Enable it with `-o io_uring` after setting `echo 1 > /sys/module/fuse/parameters/enable_uring` ([libfuse README.fuse-io-uring](https://github.com/libfuse/libfuse/blob/master/doc/README.fuse-io-uring)).
> - The project is in limited-maintenance mode: no active regular contributors beyond the maintainer, who applies PRs and ships releases but has no capacity for feature development ([libfuse README.md](https://github.com/libfuse/libfuse)).
> - `fusermount3` is installed setuid root and enforces mountpoint ownership rules; an unresolved kernel permission-caching bug (known since 2006, issue #15) affects `allow_other` setups.

---

## What libfuse Is (and Isn't)

FUSE is a split design. The **kernel side** — the `fuse` kernel module — lives in the mainline Linux tree (merged in kernel 2.6.14, 2005). It intercepts VFS calls for FUSE-mounted filesystems and forwards them to userspace via the `/dev/fuse` character device. The **userspace side** — libfuse, this repository — is the reference library that handles mounting, reading requests from `/dev/fuse`, dispatching them to your callbacks, and writing responses back.

libfuse does not implement a filesystem. It implements the **protocol** — the marshalling, the capability negotiation, the session lifecycle, the reply mechanics. Your filesystem (sshfs, mergerfs, your own) links against libfuse and fills in the callbacks.

The library offers two APIs that serve the same protocol but at different abstraction levels:

```
HIGH-LEVEL API (fuse.c, ~122 KB)        LOW-LEVEL API (fuse_lowlevel.c, ~144 KB)
──────────────────────────────────       ──────────────────────────────────────────
  Callbacks receive path strings           Callbacks receive inode numbers (fuse_ino_t)
       │                                        │
       ▼                                        ▼
  libfuse resolves inode via                You control the inode→object mapping
  internal hash table (node_table)         (no hidden lookups, no hidden cache)
       │                                        │
       ▼                                        ▼
  Callback is SYNCHRONOUS:                  Callback is ASYNCHRONOUS:
  returning from the callback               you MUST call fuse_reply_*()
  automatically sends the reply             explicitly to send the reply
       │                                        │
       ▼                                        ▼
  libfuse handles inode caching,            You control caching via
  attribute caching, directory entry        fuse_reply_entry() with cache TTL,
  cache TTLs internally                     fuse_lowlevel_notify_inval_*()
       │                                        │
       ▼                                        ▼
  Entry point: fuse_main()                  Entry point: fuse_session_new()
  (~50 lines of boilerplate)                → fuse_session_mount()
                                            → fuse_session_loop[_mt]()
                                            → fuse_session_unmount()
                                            → fuse_session_destroy()
       │                                        │
       ▼                                        ▼
  Best for: simple filesystems,             Best for: production filesystems,
  prototypes, sshfs, archivemount           mergerfs, s3fs, gvfs, high-performance FS
```

The high-level API is literally implemented **on top of** the low-level API. `fuse.c` maintains a hash table mapping inode numbers to path strings, translates path-based callbacks into inode-based ones, and calls the low-level reply functions internally. When you call `fuse_main()`, it creates a session, mounts, runs the loop, and tears down — all the low-level steps, wrapped in one function.

> **Citation capsule:** libfuse is the reference implementation of the FUSE protocol, shipped by all major Linux distributions and in production use for over two decades. It provides both a high-level synchronous API (path-based, `fuse_main()`) and a low-level asynchronous API (inode-based, `fuse_session_new()`), with the high-level API implemented as a wrapper over the low-level one ([libfuse README.md](https://github.com/libfuse/libfuse), 2025).

---

## The Two Public API Headers

Before diving into the implementation, know the two headers you will include:

- **`include/fuse.h`** (51 KB) — the high-level API. Defines `struct fuse_operations` (your callback table with `getattr`, `read`, `write`, `readdir`, `open`, `init`, `destroy`, etc.), `fuse_main()`, `struct fuse_args`, `FUSE_ARGS_INIT()`, and the option-parsing machinery.
- **`include/fuse_lowlevel.h`** (84 KB) — the low-level API. Defines `struct fuse_lowlevel_ops` (inode-based callbacks: `lookup`, `forget`, `getattr`, `read`, `write`, etc.), all `fuse_reply_*()` functions, the notification API (`fuse_lowlevel_notify_inval_inode`, `fuse_lowlevel_notify_inval_entry`, `fuse_lowlevel_notify_store`, `fuse_lowlevel_notify_retrieve`), and `struct fuse_session`.

Both pull in `include/fuse_common.h` (39 KB) for shared types — `struct fuse_file_info`, `struct fuse_conn_info`, the 34+ capability flags (`FUSE_CAP_ASYNC_READ`, `FUSE_CAP_WRITEBACK_CACHE`, `FUSE_CAP_PASSTHROUGH`, `FUSE_CAP_OVER_IO_URING`), and `struct fuse_args`. And `include/fuse_kernel.h` (32 KB) defines the wire protocol structures: `struct fuse_in_header`, `struct fuse_out_header`, and all 53 opcodes from `FUSE_LOOKUP` (1) to `FUSE_STATX` (52).

---

## The Request Dispatch Pipeline

This is the heart of the library. Every filesystem operation — a `read()`, a `write()`, a `stat()`, an `ls` — follows the same path through the kernel, the `/dev/fuse` device, and libfuse into your callback. Here is the flow for a single `write()` call, traced through the actual source:

```
┌──────────────┐     ┌───────────────┐     ┌──────────────────────┐     ┌───────────────────┐     ┌─────────────────┐
│  Application │     │  Linux Kernel │     │   libfuse core       │     │  fuse_lowlevel.c  │     │  Your Callback   │
│  write()     │     │  FUSE module  │     │  (session loop)      │     │  (dispatch)       │     │  (filesystem)    │
└──────┬───────┘     └───────┬───────┘     └──────────┬───────────┘     └────────┬──────────┘     └────────┬────────┘
       │                     │                        │                          │                          │
       │  write(fd, buf, n)  │                        │                          │                          │
       ├────────────────────►│  VFS → fuse_request_send()                         │                          │
       │                     │  enqueue on fc->pending │                          │                          │
       │                     │  ──────────────────────►│  fuse_session_receive()  │                          │
       │                     │                        │  read()/splice() from     │                          │
       │                     │                        │  /dev/fuse                │                          │
       │                     │                        ├─────────────────────────►│  fuse_session_process_buf()│
       │                     │                        │                          │  validate header           │
       │                     │                        │                          │  fuse_ll_alloc_req()       │
       │                     │                        │                          │  fuse_req_parse_extensions │
       │                     │                        │                          │  ── dispatch by opcode ──►│
       │                     │                        │                          │  fuse_ll_ops[FUSE_WRITE]   │
       │                     │                        │                          │  .func(req, nodeid, inarg) ├─► .write()
       │                     │                        │                          │                          │  (do your I/O)
       │                     │                        │                          │  fuse_reply_write() ◄──────┤
       │                     │  ◄─────────────────────┼──────────────────────────┼──────────────────────────┤
       │                     │  response via writev() │  fuse_send_msg()         │  send_reply()             │
       │  return bytes       │  to /dev/fuse          │                          │                          │
       ◄─────────────────────┤                        │                          │                          │
```

Let me walk through each stage in the source.

### Stage 1: The Event Loop

The single-threaded loop lives in `lib/fuse_loop.c` — just 49 lines:

```c
// lib/fuse_loop.c (simplified)
while (!fuse_session_exited(se)) {
    res = fuse_session_receive_buf_internal(se, &fbuf, NULL);
    if (res == -EINTR) continue;
    if (res <= 0) break;
    fuse_session_process_buf(se, &fbuf);
}
if (se->uring.pool) fuse_uring_stop(se);
```

That is the entire loop: read a buffer, process it, repeat. The multi-threaded variant (`lib/fuse_loop_mt.c`, 14 KB) wraps this in a dynamic thread pool — worker threads each call `fuse_session_receive_buf_internal()` under `PTHREAD_CANCEL_DISABLE`, and the pool grows when `numavail == 0` and shrinks idle threads past `max_idle`.

### Stage 2: Receiving the Request

`_fuse_session_receive_buf()` (in `fuse_lowlevel.c`, line ~4332) tries **splice first** — a zero-copy move from `/dev/fuse` into a pipe, avoiding a copy into userspace memory. This works when `FUSE_CAP_SPLICE_READ` is negotiated and the protocol minor version is ≥ 14. If splice is unavailable, it falls back to a plain `read()` on the `/dev/fuse` file descriptor. The buffer size (`se->bufsize`) is atomic — the kernel can request a larger buffer during `FUSE_INIT`, and the receive path detects `EINVAL` from an undersized buffer, reallocates, and retries.

### Stage 3: Processing and Dispatch

`fuse_session_process_buf_internal()` (line ~4000) does the real work:

1. If the buffer came via splice (`FUSE_BUF_IS_FD`), copy the header from the pipe into memory.
2. Fire a USDT tracepoint (`trace_request_process`) for observability.
3. Allocate a request object: `fuse_ll_alloc_req(se)`.
4. Populate the request from the header: `fuse_session_in2req(req, in)`.
5. Parse security-context extensions: `fuse_req_parse_extensions()` — extracts SELinux/LSM context into `req->secctx`.
6. Sanity-check the opcode: `fuse_req_opcode_sanity_ok()` and `fuse_req_check_allow_root()`.
7. Handle interrupts: add to `se->list`, check for pending `FUSE_INTERRUPT` requests.
8. **Dispatch:** `fuse_ll_ops[in->opcode].func(req, in->nodeid, inarg)`.

### Stage 4: The Dispatch Table

The dispatch table is the single most important data structure in libfuse. It lives at line 3686 of `fuse_lowlevel.c`:

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
    // ... all 38 opcodes through FUSE_SYNCFS, FUSE_STATX, CUSE_INIT
};
#define FUSE_MAXOP (CUSE_INIT + 1)
```

Each `do_*` function is an internal handler that unpacks the opcode-specific arguments from the generic `inarg` pointer, calls your callback (stored in `se->op`), and sends the appropriate reply. For example, `do_write()` extracts the offset, size, and file handle, calls `se->op.write()`, then calls `fuse_reply_write(req, bytes_written)`.

There is a **parallel table** — `fuse_ll_ops2[]` (line 3743) — with `_do_*` variants that take an extra `op_payload` pointer. This exists because in the io_uring transport, the payload arrives separately from the header (in the ring buffer), not appended to it. Both tables must be kept in sync.

### Stage 5: The Reply Path

When your callback finishes, you call a `fuse_reply_*()` function. The generic path:

```
fuse_reply_write(req, bytes)
  → send_reply(req, bytes, NULL, 0)
    → fuse_send_reply_iov_novree()
      → fuse_send_msg()
        → if req->flags.is_uring: fuse_send_msg_uring()
          else: fuse_write_msg_dev()  → writev() to /dev/fuse fd
  → fuse_free_req(req)   → decrement ref count, destroy when zero
```

The reply writes a `struct fuse_out_header` (with `error = 0` and `unique` matching the request) followed by the payload, back to `/dev/fuse`. The kernel's `fuse_dev_write()` wakes up the waiting VFS call, and the application's `write()` returns.

<!-- [UNIQUE INSIGHT] The dispatch table in fuse_lowlevel.c is the single most important data structure in the library. Understand it and you understand the entire request lifecycle. The parallel fuse_ll_ops2[] table exists solely because io_uring delivers the payload separately from the header — a clean example of how a transport change ripples into the dispatch layer without changing the user-facing API. -->

---

## Session and Channel Lifecycle

A `struct fuse_session` (defined in `lib/fuse_i.h`) is the central object — it represents one mounted filesystem, one `/dev/fuse` file descriptor, one set of callbacks. Here is the lifecycle:

```
fuse_session_new(args, ops, op_size, userdata)
  → parse options, allocate session, copy callback table into se->op
  → se->fd = -1 (not yet mounted)

fuse_set_signal_handlers(se)
  → install handlers for SIGINT/SIGTERM/SIGHUP → fuse_session_exit()

fuse_session_mount(se, mountpoint)
  → fuse_session_mount_new_api()  [preferred: fsopen/fsconfig/fsmount/move_mount]
     OR fuse_kern_mount()         [fallback: mount(2) syscall]
  → opens /dev/fuse, sets se->fd
  → kernel sends FUSE_INIT request (opcode 1)
  → session negotiates protocol version + capabilities

fuse_session_loop[_mt](se)
  → [see dispatch pipeline above]
  → runs until fuse_session_exited(se) is true

fuse_session_unmount(se)
  → close(se->fd), kernel sends FUSE_DESTROY

fuse_remove_signal_handlers(se)
fuse_session_destroy(se)
  → calls se->op.destroy(userdata)
  → frees all pending requests, closes fds, frees session
```

The mount step deserves attention. libfuse 3.x prefers the **new Linux mount API** (`fsopen()`/`fsconfig()`/`fsmount()`/`move_mount()`) introduced in Linux 5.2, falling back to the legacy `mount(2)` syscall when the new API is unavailable (e.g., older kernels or libc without the wrappers — glibc added them in 2.36). The code lives in `lib/mount_fsmount.c` (16 KB) and `lib/mount.c` (22 KB).

The `FUSE_INIT` handshake is critical. The kernel sends an `FUSE_INIT` request with its supported protocol version and capability flags. libfuse responds with the intersection — the capabilities both sides support. This is where `FUSE_CAP_OVER_IO_URING`, `FUSE_CAP_WRITEBACK_CACHE`, `FUSE_CAP_PASSTHROUGH`, and the other 30+ flags get negotiated. If the kernel's major version does not match libfuse's, the session refuses to start (the loop exits with `-EPROTO`).

A **synchronous FUSE_INIT** mechanism (line 4787) handles a subtle problem: SELinux may send `getattr` requests *before* `fuse_session_mount()` returns. A worker thread (`session_sync_init_worker`) polls `se->fd` plus an eventfd, processing requests until the mount handshake completes. Enabled via `ioctl(fd, FUSE_DEV_IOC_SYNC_INIT)`.

A **timeout watchdog** thread (`fuse_session_teardown_watchdog`, line 5376) polls the session fd for `POLLERR` — if the kernel-side connection drops (e.g., the filesystem is killed), the watchdog calls `fuse_session_exit()` and optionally forces a hard-exit after a configurable timeout.

![Ubuntu terminal showing a command-line prompt, representing the userspace daemon process that a FUSE filesystem runs as](/posts/libfuse-deep-dive-software-engineer/images/session-lifecycle.jpg)

---

## The io_uring Integration (libfuse 3.18.0+)

The newest major feature in libfuse is `fuse-over-io_uring`, added in version 3.18.0 (December 18, 2025). It replaces the traditional `read()`/`write()` on `/dev/fuse` with io_uring — a shared ring buffer between kernel and userspace that batches and reduces system calls.

### Why It Matters

The classic FUSE path has syscall overhead on every operation: the kernel writes a request to `/dev/fuse`, the userspace daemon `read()`s it, processes it, `write()`s the response. That is two syscalls per operation (one read, one write), plus the context switches. For I/O-heavy workloads, this overhead is significant. io_uring lets both sides operate on a shared ring buffer — the kernel places completion queue entries (CQEs), libfuse processes them in batches, and replies go back through the same ring. Fewer syscalls, less context switching, better throughput.

### How It Works in the Code

The implementation lives in `lib/fuse_uring.c` (26 KB, 1043 lines). The architecture:

```
CLASSIC TRANSPORT                    IO_URING TRANSPORT
─────────────────                    ──────────────────
  read() / write() on /dev/fuse      io_uring shared ring buffer
  one fd, one thread reads it        one queue per CPU core
  each request = 1 read() syscalls   batch: io_uring_submit_and_wait()
  each reply = 1 write() syscall     reply: FUSE_IO_URING_CMD_COMMIT_AND_FETCH
       │                                  │
       ▼                                  ▼
  fuse_session_receive_buf()         fuse_uring_thread() per queue
  fuse_session_process_buf()         io_uring_wait_cqe() → handle CQE
  fuse_send_msg() → writev()         fuse_ll_ops2[] dispatch (separate payload)
                                     send_reply_uring() → commit SQE
```

Key structures:

```c
struct fuse_ring_pool {
    struct fuse_session *se;
    bool single_issuer;          // optimization: one thread submits
    size_t nr_queues;            // = get_nprocs_conf() (one per core)
    size_t queue_depth;          // default 8, configurable via -o io_uring_q_depth
    struct fuse_ring_queue *queues;
};

struct fuse_ring_queue {
    int qid;
    pthread_t tid;
    struct io_uring ring;        // the actual io_uring instance
    pthread_mutex_t ring_lock;
    struct fuse_ring_ent ent[];  // flexible array, size = queue_depth
};
```

The lifecycle:

1. **`fuse_uring_start(se)`** — called from `do_init` after `FUSE_INIT` negotiation succeeds and `FUSE_CAP_OVER_IO_URING` is set.
2. **`fuse_create_ring(se)`** — allocates the pool with `nr_queues` = CPU count.
3. **`fuse_uring_start_ring_threads()`** — spawns one `fuse_uring_thread()` per queue.
4. Each thread: sets CPU affinity (`fuse_uring_set_thread_core`), initializes the io_uring with `IORING_SETUP_SQE128` (80-byte cmd data for `fuse_uring_cmd_req`), registers files, mmaps header/payload buffers, prepares registration SQEs.
5. After `FUSE_INIT` reply: `fuse_uring_wake_ring_threads()` posts to `init_sem`.
6. Main loop: `io_uring_submit_and_wait()` (single-issuer mode) or `io_uring_wait_cqe()` (multi-issuer) → `fuse_uring_queue_handle_cqes()` → `fuse_uring_handle_cqe()` → `fuse_session_process_uring_cqe()`.

CQE handling extracts the `fuse_in_header` from the ring's `req_header`, sets `req->flags.is_uring = 1`, and dispatches through `fuse_ll_ops2[]` (the parallel table with separate payload pointers). Replies go through `send_reply_uring()` which copies the payload into the ring buffer and submits a `FUSE_IO_URING_CMD_COMMIT_AND_FETCH` SQE.

Notable engineering decisions:
- **`IORING_SETUP_SQE128`** is required (not the default 64-byte SQE) because `fuse_uring_cmd_req` needs 80 bytes of cmd data (qid, commit_id, flags).
- **`IORING_SETUP_CQSIZE`** with `cq_entries = depth * 2` prevents CQ overflow.
- **`IORING_SETUP_SUBMIT_ALL`** ensures one failing SQE does not stall the batch.
- **`cqe_processing`** atomic flag gates `io_uring_submit()` during CQE handling, allowing batched inline replies.
- **`alloc_local()`** uses `mmap` + `SYS_mbind(MPOL_LOCAL)` + `MADV_POPULATE_WRITE` for NUMA-local, prefaulted memory.
- Teardown is signaled via an `eventfd` poll SQE.

### Enabling It

```bash
# 1. Enable kernel-side FUSE io_uring (requires Linux 6.x with FUSE io_uring support)
echo 1 > /sys/module/fuse/parameters/enable_uring

# 2. Mount with the io_uring option
./my_fuse_fs /source /mountpoint -o io_uring

# 3. Optionally adjust queue depth (default 8)
./my_fuse_fs /source /mountpoint -o io_uring -o io_uring_q_depth=16
```

Build libfuse with `-Denable-io-uring=true` (requires `liburing` with `IORING_SETUP_SQE128` support). The kernel-side protocol capability `FUSE_OVER_IO_URING` was added in protocol version 7.42.

> **Citation capsule:** `fuse-over-io-uring` (libfuse 3.18.0, December 2025) replaces read/write on `/dev/fuse` with io_uring queues — one per CPU core, default depth 8 — reducing syscall overhead. It requires kernel support (`echo 1 > /sys/module/fuse/parameters/enable_uring`), the `FUSE_CAP_OVER_IO_URING` capability (protocol 7.42), and the `-o io_uring` mount option ([libfuse README.fuse-io-uring](https://github.com/libfuse/libfuse/blob/master/doc/README.fuse-io-uring)).

---

## The Example Files: Your Entry Point

The `example/` directory contains 25+ programs. Three matter most for learning:

### `example/hello.c` — High-Level "Hello World" (4.5 KB)

The canonical starting point. Defines a filesystem with one file (`/hello`) containing `"Hello World!\n"`. Uses `fuse_main()` — the entire mount loop is one function call:

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

Compile: `gcc -Wall hello.c $(pkg-config fuse3 --cflags --libs) -o hello`

### `example/hello_ll.c` — Low-Level "Hello World" (7 KB)

The same filesystem using the low-level API. This is where you see the inode-based callbacks explicitly:

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
    fuse_session_loop_mt(se, &config);   // or fuse_session_loop() for single-thread
    fuse_session_unmount(se);
    fuse_remove_signal_handlers(se);
    fuse_session_destroy(se);
}
```

This is the better starting point for understanding the library, because every step is explicit.

### `example/passthrough_fh.c` — Realistic Passthrough (14 KB)

Mirrors an existing directory tree under the mountpoint. Uses the low-level API with file handles (`FUSE_CAP_EXPORT_SUPPORT` + `fh` field in `fuse_file_info`). This is the template most real filesystems start from. The C++ variant `passthrough_hp.cc` (49 KB) adds writeback caching and io_uring support — the most complete example in the repository.

---

## How to Read the Source: A Map for Newcomers

If you want to understand libfuse from the code, read in this order:

1. **`include/fuse_lowlevel.h`** (84 KB) — the public structs and callback signatures. Start with `struct fuse_lowlevel_ops` (your callback table), `struct fuse_file_info`, `struct fuse_conn_info`, and the `fuse_reply_*()` function declarations. This is the contract between you and the library.

2. **`example/hello_ll.c`** (7 KB) — a working low-level filesystem in ~200 lines. Read it alongside the header to see how the callbacks are wired up.

3. **`lib/fuse_lowlevel.c`** (144 KB) — the core. Focus on:
   - `fuse_session_new()` — session creation and option parsing
   - `fuse_session_mount()` — the mount handshake
   - `fuse_ll_ops[]` (line 3686) — the dispatch table
   - `fuse_session_process_buf_internal()` (line ~4000) — request processing
   - `do_write()`, `do_read()` — representative opcode handlers
   - `send_reply()` → `fuse_send_msg()` — the reply path
   - `fuse_session_loop()` — the event loop entry

4. **`lib/fuse_session.c`** — session lifecycle: mount, unmount, signal handling, the sync-init worker, the timeout watchdog.

5. **`lib/fuse.c`** (122 KB) — the high-level wrapper. Focus on how `fuse_main()` calls into the low-level API, and how the node_table hash maps inodes to paths.

6. **`lib/fuse_uring.c`** (26 KB) — the io_uring transport. Read after you understand the classic path.

7. **`doc/kernel.txt`** (15 KB) — the kernel protocol reference: the `/dev/fuse` interface, the `/sys/fs/fuse/connections` control filesystem, interrupt semantics, non-privileged mount security model.

8. **`doc/fuse-operations.txt`** (13 KB) — the FUSE protocol operations reference.

<!-- [PERSONAL EXPERIENCE] When I first read libfuse, starting with the low-level API and the dispatch table was the breakthrough. The high-level API makes far more sense once you have seen what it is hiding — the inode-to-path hash table, the automatic reply-on-return, the internal caching. Read hello_ll.c before hello.c, and read fuse_ll_ops[] before either. -->

---

## The Test Suite

libfuse ships a custom-built test infrastructure — no external framework. `test/run-tests.py` (71 KB) discovers `test/cases/**/*.sh`, runs each in its own cgroup with a private work directory, enforces `# TIMEOUT:` directives, collects core dumps and backtraces, and reports PASS/SKIP/FAIL.

The `test/cases/` directory holds 80+ shell scripts across:
- **`examples/`** (38 scripts) — test each example filesystem (hello, passthrough, cuse, poll, notify_*)
- **`notify/`** (16 scripts) — test notification mechanisms
- **`mount/`** (24 scripts) — test mount options and attributes
- **`unit/`** — C unit tests (ABI compatibility, loop config, mount flags)
- **`ctests/`** — shell tests for signals, teardown-watchdog, write-cache

Tests run over both transports: `meson test` (classic) and `meson test --suite io-uring`. The runner scans output for suspicious patterns (error/warning/fatal/crash/abort/exception) and supports Valgrind (`TEST_WITH_VALGRIND=1`).

Notable: tests can require root, but most run as a regular user if `util/fusermount3` is made setuid root first — the rest skip themselves gracefully.

---

## fusermount3: The setuid Helper

`util/fusermount.c` (45 KB) implements `fusermount3`, installed **setuid root** so unprivileged users can mount filesystems. It opens `/dev/fuse`, performs the privileged mount operation, then passes the file descriptor back to the daemon via the `_FUSE_COMMFD` environment variable.

Security restrictions enforced by fusermount3:
- The user can only mount on a mountpoint where they have write permission
- The mountpoint must not be a sticky directory not owned by the user (like `/tmp`)
- No other user (including root) can access the mounted filesystem unless `allow_other`/`allow_root` is configured in `/etc/fuse.conf`

The `auto_unmount` option holds the commfd open — when the daemon exits (even crashes), the kernel automatically unmounts. `drop_privileges` opens `/dev/fuse` *before* setuiding down, so the mount fd is owned by the target user.

A known unresolved kernel bug (issue #15, documented since 2006): when `allow_other` is used without `default_permissions`, the first permission check result for a directory entry is cached and reused for subsequent accesses as long as the inode stays in the kernel cache — even if permissions change, even for different users. The workaround is `default_permissions` (which does not support ACLs) or disabling directory entry attribute caching.

---

## Project Status and History

libfuse has been in production since 2001. The original author, **Miklos Szeredi** (who also maintains the kernel FUSE subsystem), handed off maintenance in 2015. **Nikolaus Rath** maintained it until February 2024. The current maintainers — **Bernd Schubert**, **Ashley Pittman**, and **Antonio SJ Musumeci** (creator of mergerfs) — apply PRs and ship releases but have no capacity for feature development.

The README is unusually honest: *"at present libfuse does not have any active, regular contributors... unless you are including a pull request or are reporting a critical issue, you will probably not get a response."*

Key milestones from the ChangeLog:

| Version | Date | Milestone |
|---------|------|-----------|
| 3.0.0 | 2016 | **libfuse3** fork — co-installable with libfuse2, meson build, default capabilities |
| 3.2.0 | 2017 | Meson build system, autotools dropped |
| 3.12.0 | 2022 | `fuse_loop_config` private, `max_threads` parameter |
| 3.15.0 | 2023 | Signify signing (replacing PGP) |
| 3.17.0 | 2025 | ABI restored to 3.10, passthrough read/write, syslog logging |
| **3.18.0** | **Dec 2025** | **fuse-over-io-uring, statx, request timeout, FUSE_NOTIFY_INC_EPOCH** |
| 3.18.2 | Mar 2025 | Latest stable release |
| 3.19.0-rc0 | 2026 | Current development (this repository) |

The library is stable, mature, and widely deployed. It is not dead — but it is not growing either. The io_uring work is the most significant architectural change in years.

---

## Frequently Asked Questions

### What is the difference between the high-level and low-level libfuse APIs?

The high-level API (`fuse.h`) uses path strings and synchronous callbacks — returning from the callback automatically sends the reply. The low-level API (`fuse_lowlevel.h`) uses inode numbers and requires explicit `fuse_reply_*()` calls, giving you full control over caching, concurrency, and reply timing. The high-level API is implemented as a wrapper over the low-level one. Most production filesystems (mergerfs, s3fs, gvfs) use the low-level API.

### Is libfuse still actively maintained?

The README states there are no active regular contributors beyond the current maintainer team, who apply PRs and ship releases but have no capacity for feature development. It is stable and mature — not dead, but do not expect new features beyond high-impact fixes. The latest release is 3.18.2 (March 2025).

### Can I use libfuse on macOS?

No. libfuse targets Linux (fully) and BSD (best-effort). On macOS, use [macFUSE](https://macfuse.github.io), which is a separate project with its own kernel extension.

### How does FUSE performance compare to a kernel module?

FUSE trades peak performance for safety and development speed. A crash in a FUSE filesystem takes down one process, not the whole kernel. Development is orders of magnitude faster. The performance gap is narrowing: `FUSE_WRITEBACK_CACHE` (protocol 7.23) enables kernel-side write buffering, `FUSE_PASSTHROUGH` (protocol 7.40) lets the kernel read/write directly to a backing file, and `fuse-over-io-uring` (3.18.0) reduces syscall overhead.

### What is the FUSE protocol version?

The current protocol is **7.45** (kernel/userspace interface). Capabilities are negotiated at mount time via the `FUSE_INIT` handshake — both sides advertise supported features and the intersection is used. New capabilities (like `FUSE_CAP_OVER_IO_URING` at 7.42) are added in minor version bumps.

---

## Conclusion

libfuse is a masterclass in protocol-library design: a clean split between high-level and low-level APIs, a single dispatch table that routes every kernel opcode to a handler, a carefully managed session lifecycle with sync-init and timeout watchdog, and a new io_uring transport that reduces syscall overhead without changing the user-facing API.

The codebase rewards top-down reading. Start with `fuse_lowlevel.h` and `hello_ll.c`, then read the dispatch table in `fuse_lowlevel.c`, then the session lifecycle in `fuse_session.c`, then the io_uring transport in `fuse_uring.c`. Build the examples with `meson setup build && ninja -C build`, mount `hello_ll` on a test directory, and watch the dispatch pipeline in action with `strace -e read,write`.

The repository is at [github.com/libfuse/libfuse](https://github.com/libfuse/libfuse). Clone it, read it, and the next time you `sshfs` into a remote server or `s3fs` mount a bucket, you will know exactly what happens between the VFS call and your callback.

## Sources

- libfuse README.md, https://github.com/libfuse/libfuse
- libfuse README.fuse-io-uring, https://github.com/libfuse/libfuse/blob/master/doc/README.fuse-io-uring
- libfuse ChangeLog.rst, https://github.com/libfuse/libfuse/blob/master/ChangeLog.rst
- libfuse AUTHORS, https://github.com/libfuse/libfuse/blob/master/AUTHORS
- libfuse doc/kernel.txt (kernel protocol reference), https://github.com/libfuse/libfuse/blob/master/doc/kernel.txt
- libfuse example/hello_ll.c, https://github.com/libfuse/libfuse/blob/master/example/hello_ll.c
- libfuse example/hello.c, https://github.com/libfuse/libfuse/blob/master/example/hello.c
- libfuse include/fuse_kernel.h (wire protocol), https://github.com/libfuse/libfuse/blob/fuse-3.18.0/include/fuse_kernel.h
- Kernel FUSE documentation, https://www.kernel.org/doc/html/next/filesystems/fuse.html
- Wikipedia — Filesystem in Userspace, https://en.wikipedia.org/wiki/Filesystem_in_Userspace
- LWN.net — "A FUSE implementation for famfs", https://lwn.net/Articles/1020170/
- LWN.net — "Famfs, FUSE, and BPF", https://lwn.net/Articles/1068686/
