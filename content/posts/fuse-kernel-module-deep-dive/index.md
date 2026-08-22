---
title: "How Does the FUSE Kernel Module Work? A Software Engineer's Code Walkthrough"
description: "The FUSE kernel module is the gatekeeper between VFS and userspace filesystems. This deep dive walks through fs/fuse/ — the request lifecycle, core data structures, /dev/fuse and io_uring transports, passthrough, and the growing gap between kernel and libfuse development."
coverImage: "/posts/fuse-kernel-module-deep-dive/images/cover.jpg"
coverImageAlt: "A server rack in a dark data center, representing the Linux kernel infrastructure that powers the FUSE kernel module"
ogImage: "/posts/fuse-kernel-module-deep-dive/images/cover.jpg"
date: "2026-08-22 22:00:00"
lastUpdated: "2026-08-22 22:00:00"
author: "FindNS94"
tags: [Linux, Kernel, Open Source]
---

![A server rack in a dark data center, representing the Linux kernel infrastructure that powers the FUSE kernel module](/posts/fuse-kernel-module-deep-dive/images/cover.jpg)

# How Does the FUSE Kernel Module Work? A Software Engineer's Code Walkthrough

Every FUSE filesystem has two halves. The userspace half — libfuse — implements the filesystem logic. The kernel half — the FUSE kernel module at `fs/fuse/` in the Linux source — is the gatekeeper that intercepts every VFS call and decides whether to handle it locally or forward it to userspace. If our [companion post on libfuse](/posts/libfuse-deep-dive-software-engineer/) explained the userspace library, this one explains the kernel side.

The problem is that the kernel module is dense: roughly 13,000+ lines of C across 30+ files, with complex request lifecycle management, two transport layers (/dev/fuse and io_uring), and a steady stream of recent high-performance features — passthrough, writeback cache, request timeouts — that change how FUSE works. And unlike libfuse (which is in limited-maintenance mode), the kernel module is **actively developed**, creating a growing capability gap between the two halves.

This article walks through the kernel module source top-down: the core data structures, the request lifecycle, the transport layers, and the recent features that bypass userspace entirely. By the end you will understand the kernel side of FUSE well enough to read `dev.c` (the 2430-line /dev/fuse transport) and know exactly what each function does.

<!-- [UNIQUE INSIGHT] The FUSE kernel module's request lifecycle is a masterclass in kernel async I/O design: a VFS call allocates a request, marks it FR_PENDING, enqueues it, then sleeps on req->waitq. The userspace daemon reads it from /dev/fuse, processes it, writes the response, and the kernel sets FR_FINISHED and wakes up the sleeper. Understanding this single pipeline explains 80% of the module. -->

> **Key Takeaways**
> - The FUSE kernel module lives at `fs/fuse/` in the Linux source — ~13,000+ lines across 30+ files, merged in kernel 2.6.14 (2005), actively maintained by Miklos Szeredi.
> - Every VFS call goes through a FUSE operation (e.g., `fuse_read_iter()`) that allocates a `fuse_req`, enqueues it on the connection's pending queue, and waits. Userspace reads the request from `/dev/fuse`, processes it, writes the response back, and the kernel wakes up the waiting VFS call.
> - Three core objects: `fuse_conn` (connection), `fuse_inode` (per-inode), `fuse_file` (per-open-file). Each connection has an input queue (pending requests), a processing queue (hash table), and a background queue.
> - FUSE_PASSTHROUGH lets the kernel read/write directly to a backing file, bypassing userspace for data I/O. FUSE_OVER_IO_URING replaces the `/dev/fuse` read/write with io_uring rings for reduced syscall overhead.
> - The kernel module is actively developed (passthrough, io_uring, timeouts, DAX, security context) while libfuse is in limited-maintenance mode — a growing gap developers should understand.

---

## What the FUSE Kernel Module Is

FUSE is a split design. The **kernel module** (`fs/fuse/`) registers a `file_system_type` and implements all VFS operations — superblock, inode, file, directory — by forwarding them to userspace. The **userspace library** (libfuse) reads those requests, dispatches to your filesystem callbacks, and writes responses back. They communicate via the FUSE protocol defined in `include/uapi/linux/fuse.h` (1311 lines).

This post covers the kernel side. The kernel module does not implement filesystem logic — it implements the **gatekeeper**: intercepting VFS calls, marshalling them into FUSE protocol messages, sending them to userspace via a transport, and waiting for the response.

Key source files:

| File | Lines | Purpose |
|------|-------|---------|
| `fuse_i.h` | 1333 | Core data structures: fuse_conn, fuse_inode, fuse_file, fuse_chan |
| `fuse_dev_i.h` | 422 | Request, channel, queue structures |
| `dev.c` | 2430 | /dev/fuse character device transport |
| `file.c` | 3121 | File operations (read, write, mmap, ioctl, fsync) |
| `inode.c` | 2190 | Inode management, superblock, FUSE_INIT handshake |
| `dir.c` | 2498 | Directory operations (lookup, mkdir, readdir, rename) |
| `dev_uring.c` | 1457 | FUSE-over-io_uring transport |
| `passthrough.c` | 197 | FUSE_PASSTHROUGH direct I/O |
| `control.c` | 367 | /sys/fs/fuse/connections control filesystem |
| `notify.c` | 447 | Kernel-side notification processing |
| `req.c` | 100 | Request allocation and credential helpers |
| `req_timeout.c` | ~150 | Request timeout handling |
| `virtio_fs.c` | ~2000 | FUSE over virtio for VMs |
| `dax.c` | ~1500 | Direct Access (CXL memory) |

```
┌─────────────────────────────────────────────────────────────────────┐
│                         Linux Kernel                                 │
│  ┌─────────┐   ┌──────────────────────────────────────────────┐    │
│  │   VFS   │──►│         FUSE Kernel Module (fs/fuse/)        │    │
│  └─────────┘   │                                              │    │
│       │        │  fuse_read_iter() ──► fuse_send_read()       │    │
│       │        │  fuse_lookup()     ──► fuse_lookup_name()    │    │
│       │        │  fuse_mkdir()      ──► create_new_entry()    │    │
│       │        │  ...                  ...                    │    │
│       │        │                                              │    │
│       │        │  ┌─────────────┐    ┌──────────────────┐    │    │
│       │        │  │ /dev/fuse   │    │ io_uring rings   │    │    │
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
        │         │     Userspace FUSE Daemon            │
        │         │     (libfuse or custom)              │
        │         └─────────────────────────────────────┘
        │                  │
        │                  ▼
   ┌────┴────┐      ┌────────────┐
   │ App     │      │ Filesystem │
   │ read()  │      │ Logic      │
   └─────────┘      └────────────┘
```

---

## Core Data Structures

The FUSE kernel module's architecture revolves around six core structures. Understanding them is the key to reading the source.

### struct fuse_conn — Per-Connection State

`struct fuse_conn` (defined in `fuse_i.h`, ~765 lines of fields) is created at mount time and destroyed when the last mount is gone and `/dev/fuse` is closed. It holds the connection-wide state:

- **Synchronization:** `lock` (spinlock protecting polled_files, backing_files_map, curr_bucket), `killsb` (rw_semaphore for superblock access), `count` (refcount), `epoch` (atomic — for dentry cache coherency)
- **Identity:** `user_id`, `group_id`, `pid_ns`, `user_ns`
- **I/O limits:** `max_read`, `max_write`, `max_pages`, `congestion_threshold`
- **Transport:** `chan` (pointer to `fuse_chan`), `khctr` (monotonic kernel file-handle counter)
- **60+ capability bitfields** negotiated during FUSE_INIT: `writeback_cache`, `passthrough`, `async_read`, `atomic_o_trunc`, `export_support`, `big_writes`, `do_readdirplus`, `parallel_dirops`, `posix_acl`, `default_permissions`, `allow_other`, `handle_killpriv_v2`, `direct_io_allow_mmap`, `sync_init`, `no_*` feature flags, and many more
- **State:** `conn_error`, `conn_init`, `abort_err`, `destroy`
- **Counters:** `attr_version` (atomic64), `evict_ctr` (atomic64)
- **Mounts:** `mounts` list (supports submounts sharing one connection)
- **Write sync:** `curr_bucket` (RCU pointer to `fuse_sync_bucket`)
- **Passthrough:** `backing_files_map` (IDR map of backing file IDs)

### struct fuse_req — A Kernel Request

`struct fuse_req` (in `fuse_dev_i.h`) represents a single request to userspace:

- `list` — queue linkage (pending, processing, or io lists)
- `intr_entry` — entry on the interrupts list
- `args` — input/output arguments (`fuse_args`)
- `count` — refcount
- `flags` — bitfield of `fuse_req_flag`: `FR_PENDING`, `FR_SENT`, `FR_FINISHED`, `FR_INTERRUPTED`, `FR_ABORTED`, `FR_LOCKED`, `FR_WAITING`, `FR_BACKGROUND`, `FR_FORCE`, `FR_ISREPLY`, `FR_PRIVATE`, `FR_ASYNC`, `FR_URING`
- `in.h` — `fuse_in_header` (opcode, unique ID, nodeid, uid, gid, pid)
- `out.h` — `fuse_out_header` (error, unique ID)
- `waitq` — wait queue for the requesting thread
- `chan` — owning `fuse_chan`
- `create_time` — jiffies at creation (for timeout detection)
- `ring_entry`, `ring_queue` — io_uring pointers

### struct fuse_file — Per-Open-File State

`struct fuse_file` tracks each open file:

- `fh` — userspace file handle (returned by FUSE_OPEN)
- `kh` — unique kernel handle (from `khctr`)
- `nodeid` — inode this file belongs to
- `open_flags` — FOPEN_* flags from the server
- `iomode` — `IOM_NONE`, `IOM_CACHED`, or `IOM_UNCACHED`
- `write_entry` — entry on the inode's `write_files` list
- `readdir.{pos, cache_off, version}` — readdir state
- `polled_node`, `poll_wait` — poll support
- `passthrough` — pointer to backing file (when FUSE_PASSTHROUGH is active)

### struct fuse_inode — Per-Inode State

`struct fuse_inode` embeds `struct inode` as its first member and adds FUSE-specific state:

- `nodeid` — unique userspace inode ID
- `nlookup` — lookup count (for FORGET)
- `i_time` — attribute cache expiry (jiffies)
- `inval_mask` — which attributes are stale
- **Write cache** (regular files): `write_files` list, `queued_writes`, `writectr`, `iocachectr`, `page_waitq`
- **Readdir cache** (directories): `rdc.{cached, size, pos, version, mtime, epoch, iversion}`
- `state` — bitfield: `FUSE_I_ADVISE_RDPLUS`, `FUSE_I_INIT_RDPLUS`, `FUSE_I_SIZE_UNSTABLE`, `FUSE_I_BAD`, `FUSE_I_BTIME`, `FUSE_I_CACHE_IO_MODE`, `FUSE_I_EXCLUSIVE`
- `mutex` — serializes lookups/readdir (unless `parallel_dirops`)
- `lock` — spinlock for write-related fields
- `fb` — `fuse_backing` pointer (passthrough)

### struct fuse_chan — Transport Channel

`struct fuse_chan` is the transport abstraction:

- `iq` — input queue (`fuse_iqueue`: pending list, interrupts, forget list, reqctr)
- `devices` — list of `fuse_dev` instances
- `max_background`, `num_background`, `active_background` — background request flow control
- `bg_queue` — background requests awaiting dispatch
- `initialized` — set after FUSE_INIT reply received
- `blocked` — set when too many background requests are pending
- `connected` — cleared on umount/abort
- `num_waiting` — atomic count of waiting requests
- `io_uring` — flag: use io_uring transport
- `ring` — `fuse_ring` pointer (io_uring state)
- `timeout.{work, req_timeout}` — delayed work + timeout value

### struct fuse_iqueue and struct fuse_pqueue

- `fuse_iqueue` — the input queue: `reqctr` (unique ID counter), `pending` list, `interrupts` list, `forget_list_head/tail`, `forget_batch`, `ops` (send_forget, send_interrupt, send_req, release callbacks)
- `fuse_pqueue` — the processing queue: hash table of requests being processed (`FUSE_PQ_HASH_BITS = 8`, so 256 buckets), `io` list

![Server room with blinking lights, representing the kernel infrastructure that manages FUSE request queues and connections](/posts/fuse-kernel-module-deep-dive/images/request-lifecycle.jpg)

---

## The Request Lifecycle: From VFS Call to Userspace and Back

This is the heart of the module. Every filesystem operation — `read()`, `write()`, `stat()`, `ls` — follows the same path. Here is a `read()` traced end-to-end through the actual source:

```
┌──────────────┐     ┌───────────────────┐     ┌──────────────────┐     ┌────────────────┐
│  Application │     │  FUSE Kernel      │     │  /dev/fuse       │     │  Userspace     │
│  read()      │     │  (file.c)         │     │  (dev.c)         │     │  Daemon        │
└──────┬───────┘     └────────┬──────────┘     └────────┬─────────┘     └───────┬────────┘
       │                      │                          │                        │
       │  read(fd, buf, n)    │                          │                        │
       ├─────────────────────►│  fuse_file_read_iter()   │                        │
       │                      │  → fuse_cache_read_iter()│                        │
       │                      │  → fuse_read_folio()     │                        │
       │                      │  → fuse_send_read()      │                        │
       │                      │                          │                        │
       │                      │  fuse_request_alloc()    │                        │
       │                      │  set FR_PENDING          │                        │
       │                      │  fill FUSE_READ args     │                        │
       │                      │                          │                        │
       │                      │  fuse_chan_send()        │                        │
       │                      │  → fuse_dev_queue_req()  │                        │
       │                      │  → enqueue on fiq->pending│                       │
       │                      │  → fuse_dev_wake_and_unlock()                     │
       │                      │  ─── wake up reader ───►│  fuse_dev_read()       │
       │                      │                          │  → fuse_dev_do_read()  │
       │                      │                          │  → copy request to     │
       │                      │                          │    userspace buffer     │
       │                      │                          ├───────────────────────►│
       │                      │                          │                        │  (process read)
       │                      │                          │  fuse_dev_write()      │
       │                      │                          │  ←── response ─────────┤
       │                      │                          │  → fuse_request_find() │
       │                      │                          │    (hash by unique ID) │
       │                      │                          │  → fuse_request_end()  │
       │                      │                          │    set FR_FINISHED     │
       │                      │  ◄── wake_up(req->waitq) │                        │
       │  return bytes        │                          │                        │
       ◄──────────────────────┤                          │                        │
```

### Step-by-step through the source

**1. VFS dispatches to FUSE.** `fuse_file_read_iter()` (file.c:1823) checks the open mode: DAX → `fuse_dax_read_iter`, `FOPEN_DIRECT_IO` → `fuse_direct_read_iter`, passthrough → `fuse_passthrough_read_iter`, otherwise → `fuse_cache_read_iter()`.

**2. Build the request.** `fuse_cache_read_iter()` calls `fuse_read_folio()` which batches folios and calls `fuse_send_read()` (file.c:794). This fills `fuse_read_in` args and calls `fuse_simple_request()`.

**3. Allocate and send.** `fuse_simple_request()` (req.c:60) calls `fuse_req_prep()` (fills credentials) then `fuse_chan_send()` (dev.c:809). This allocates a `fuse_req` from the slab cache (`fuse_request_alloc()`), sets `FR_PENDING`, records `create_time`, and calls `__fuse_request_send()`.

**4. Queue and wake userspace.** `fuse_dev_queue_req()` (dev.c:282) assigns a unique ID (from `fiq->reqctr`), appends the request to `fiq->pending`, and calls `fuse_dev_wake_and_unlock()` which wakes the `fiq->waitq` (where the userspace daemon is blocked in `fuse_dev_read()`) and sends `SIGIO` via `kill_fasync()`.

**5. Wait for response.** `request_wait_answer()` (dev.c:697) does a three-phase wait: (1) `wait_event_interruptible` — interruptible by any signal; if interrupted, sets `FR_INTERRUPTED` and sends an interrupt if the request was already `FR_SENT`. (2) `wait_event_killable` — only fatal signals. (3) Unconditional `wait_event` until `FR_FINISHED`.

**6. Userspace reads.** `fuse_dev_read()` (dev.c:1680) → `fuse_dev_do_read()` (dev.c:1516) loops on `fiq->waitq` (exclusive wait) until a request is available. Priority: interrupts → forgets → normal requests. For a normal request: removes from `fiq->pending`, clears `FR_PENDING`, copies to `fpq->io`, copies header + args to userspace via `fuse_copy_args()`, moves to `fpq->processing[hash]`, sets `FR_SENT`.

**7. Userspace writes response.** `fuse_dev_write()` (dev.c:1968) → `fuse_dev_do_write()` (dev.c:1860) copies the `fuse_out_header`. If `oh.unique == 0`, it's a notification → `fuse_notify()`. Otherwise: looks up the request by unique ID via `fuse_request_find()` (hash table lookup), copies the payload with `fuse_copy_out_args()`, then calls `fuse_request_end()`.

**8. Complete the request.** `fuse_request_end()` (dev.c:628) sets `FR_FINISHED`, handles interrupt cleanup, wakes `req->waitq`, and drops the reference. The waiting VFS call returns.

### Background requests

Not all requests block the caller. Background requests (FORGET, BATCH_FORGET, interrupts) go through `fuse_chan_send_bg()` → `fuse_request_queue_background()`. The `bg_queue` + `num_background` + `congestion_threshold` provide flow control: when `num_background >= congestion_threshold`, new foreground requests block until background requests complete.

---

## The FUSE_INIT Handshake

When a FUSE filesystem is mounted, the kernel and userspace daemon must agree on protocol version and capabilities. This happens via the `FUSE_INIT` handshake:

1. **Kernel sends INIT.** `fuse_send_init()` (inode.c:1504) builds the request via `fuse_new_init()` (inode.c:1440), which sets:
   - `FUSE_KERNEL_VERSION = 7`, `minor` (latest)
   - `max_readahead`, `max_write`, `max_pages`
   - A large OR-mask of supported flags: `FUSE_ASYNC_READ`, `FUSE_POSIX_LOCKS`, `FUSE_ATOMIC_O_TRUNC`, `FUSE_EXPORT_SUPPORT`, `FUSE_BIG_WRITES`, `FUSE_AUTO_INVAL_DATA`, `FUSE_DO_READDIRPLUS`, `FUSE_WRITEBACK_CACHE`, `FUSE_PARALLEL_DIROPS`, `FUSE_POSIX_ACL`, `FUSE_MAX_PAGES`, `FUSE_PASSTHROUGH`, `FUSE_OVER_IO_URING`, `FUSE_REQUEST_TIMEOUT`, and more

2. **Userspace replies.** The daemon responds with the intersection of supported capabilities.

3. **Kernel processes reply.** `process_init_reply()` (inode.c:1269) validates `arg->major == FUSE_KERNEL_VERSION`, decodes the reply flags into `fc` feature bits, calls `process_init_limits()` (caps `max_background`/`congestion_threshold` for unprivileged users), sets `conn_init`/`conn_error`, and calls `fuse_chan_set_initialized()` which wakes `blocked_waitq` (allowing request allocation to proceed).

> **Citation capsule:** The FUSE_INIT handshake negotiates protocol capabilities between kernel and userspace. The kernel advertises a superset of supported flags (FUSE_ASYNC_READ, FUSE_WRITEBACK_CACHE, FUSE_PASSTHROUGH, FUSE_OVER_IO_URING, etc.); userspace replies with the intersection. The connection is blocked until the INIT reply is received — `fch->initialized` gates all request allocation (fuse_conn_init / process_init_reply, fs/fuse/inode.c).

### Synchronous FUSE_INIT

The `sync_init` mount option (and the `FUSE_DEV_IOC_SYNC_INIT` ioctl) enables synchronous initialization. This is needed for SELinux, which may send `getattr` requests *before* `fuse_send_init()` completes. With sync init, a worker thread processes requests during the mount handshake.

<!-- [PERSONAL EXPERIENCE] Reading the FUSE kernel module after studying libfuse was revelatory — both sides use the same protocol header (fuse_in_header/fuse_out_header) but from completely different perspectives. The kernel marshals requests into the wire format; libfuse unmarshals them. Understanding both sides makes the entire FUSE architecture click, and the kernel side is the one that's still actively evolving. -->

---

## The Transport Layer: /dev/fuse

The classic transport is a misc character device `/dev/fuse`. The implementation lives in `dev.c` (2430 lines).

### Device lifecycle

- `fuse_dev_init()` — creates the `fuse_req_cachep` slab cache and registers `fuse_miscdevice`
- `fuse_dev_open()` — allocates a `fuse_dev`, stores in `file->private_data`
- `fuse_dev_release()` — atomically detaches the channel (`xchg(&fud->chan, FUSE_DEV_CHAN_DISCONNECTED)`), ends all processing requests, and if this is the last device, calls `fuse_chan_abort()`

### The copy engine

Data moves between kernel and userspace via `fuse_copy_state` and its functions:
- `fuse_copy_one()` — copy a single value
- `fuse_copy_args()` — copy request header + arguments to userspace
- `fuse_copy_folio()` — copy folio data (with page-stealing optimization via `fuse_try_move_folio()`)
- `fuse_copy_out_args()` — copy response payload from userspace
- `fuse_copy_fill()` / `fuse_copy_do()` — the actual copy loop

### Interrupts

`FUSE_INTERRUPT` (odd unique ID) cancels an in-flight request. `queue_interrupt()` (dev.c:666) calls `fiq->ops->send_interrupt()` → `fuse_dev_queue_interrupt()` (dev.c:240), which adds the request to `fiq->interrupts` and wakes readers. The interrupted request's waiter is woken with `-EINTR`.

### Connection abort

Writing to `/sys/fs/fuse/connections/<n>/abort` triggers `fuse_chan_abort()` (dev.c:2129): sets `fch->connected = 0`, iterates all devices' processing queues, marks requests `FR_ABORTED`, finishes unlocked requests, flushes the bg queue, and wakes everyone.

---

## The io_uring Transport (FUSE_OVER_IO_URING)

`dev_uring.c` (1457 lines) implements FUSE-over-io_uring — a high-performance transport that replaces read/write on `/dev/fuse` with io_uring shared ring buffers.

### How it differs from classic transport

```
CLASSIC (/dev/fuse)                    IO_URING
────────────────────                    ─────────
  read() = fetch request                FUSE_IO_URING_CMD_REGISTER = setup ring buffers
  write() = commit reply                FUSE_IO_URING_CMD_COMMIT_AND_FETCH =
                                        commit previous reply AND fetch next request
  copy_to_user / copy_from_user          Pre-registered userspace ring buffers
  one request per read/write            Combined commit+fetch in one SQE
  syscall per request                   Batch: submit_and_wait
```

### Setup

1. `fuse_uring_create()` — allocates `fuse_ring` with `nr_queues = num_possible_cpus()`, computes `max_payload_sz`
2. `fuse_uring_create_queue()` — per-CPU queue with 7 lists: `ent_avail_queue`, `ent_w_req_queue`, `ent_commit_queue`, `ent_in_userspace`, `fuse_req_queue`, `fuse_req_bg_queue`, `ent_released`
3. `fuse_uring_cmd()` (the `.uring_cmd` entry point) dispatches:
   - `FUSE_IO_URING_CMD_REGISTER` → `fuse_uring_register()`: maps the 2 iovecs from the SQE (headers + payload) into userspace memory, adds to `ent_avail_queue`. When all queues are ready, switches `fiq->ops` to `fuse_io_uring_ops` and marks `ring->ready`
   - `FUSE_IO_URING_CMD_COMMIT_AND_FETCH` → `fuse_uring_commit_fetch()`: reads `commit_id`/`qid` from the 128-byte SQE, finds the request, commits the reply (copies header+payload from ring), then fetches the next request

### Request state machine

Ring entries move through states: `FRRS_INVALID → FRRS_COMMIT → FRRS_AVAILABLE → FRRS_FUSE_REQ → FRRS_USERSPACE → (back to AVAILABLE)`.

### Background requests

`fuse_uring_queue_bq_req()` allows 1 background request per queue independent of global limits, improving throughput for metadata-heavy workloads.

### Teardown

`fuse_uring_stop_queues()` → per-queue teardown via `io_uring_cmd_done`, with async teardown (`FUSE_URING_TEARDOWN_TIMEOUT` = 5s) and `fuse_uring_destruct()`.

> **Citation capsule:** FUSE-over-io_uring (dev_uring.c, 1457 lines) replaces /dev/fuse read/write with io_uring shared rings — one queue per CPU. The `FUSE_IO_URING_CMD_COMMIT_AND_FETCH` operation combines committing the previous reply and fetching the next request in a single SQE, reducing syscall overhead. Enabled via `echo 1 > /sys/module/fuse/parameters/enable_uring` + `FUSE_CAP_OVER_IO_URING` (protocol 7.42) (fs/fuse/dev_uring.c).

---

## FUSE_PASSTHROUGH: Bypassing Userspace for Data I/O

`passthrough.c` (197 lines) + `backing.c` (~150 lines) implement FUSE_PASSTHROUGH — the biggest performance feature in years.

### The big idea

For files with a backing store on a real filesystem, the kernel can perform read/write I/O **directly on the backing file**, bypassing the userspace daemon entirely. Userspace still handles metadata (lookup, getattr, permission checks), but data I/O skips the round-trip.

### How it works

1. **Register backing file.** Userspace opens a backing file via the `FUSE_DEV_IOC_BACKING_OPEN` ioctl on `/dev/fuse` (handled by `fuse_dev_ioctl_backing_open()` in dev.c → `fuse_backing_open()` in backing.c). This registers the file in `fc->backing_files_map` (an IDR) and returns an integer `backing_id`.

2. **Pass ID in OPEN reply.** Userspace includes the `backing_id` in the `FUSE_OPEN` reply.

3. **Resolve at open time.** `fuse_passthrough_open()` (passthrough.c:152) looks up the `fuse_backing` object via `fuse_backing_lookup()`, calls `backing_file_open()` to create a per-open backing file wrapper, and stores it in `ff->passthrough`.

4. **Delegate I/O.** `fuse_passthrough_read_iter()` → `backing_file_read_iter()`, `fuse_passthrough_write_iter()` → `backing_file_write_iter()`, `fuse_passthrough_mmap()` → `backing_file_mmap()`. All delegate to the kernel's `backing_file` API.

### Performance impact

Passthrough eliminates the userspace round-trip for data I/O. For workloads that are primarily data reads/writes (media serving, package management, container images), this can dramatically improve throughput while still letting userspace enforce permissions and implement custom metadata logic.

---

## Writeback Cache (FUSE_WRITEBACK_CACHE)

Without writeback cache, every `write()` goes to userspace immediately (write-through). With `FUSE_CAP_WRITEBACK_CACHE` enabled, the kernel buffers writes in the page cache and flushes them later.

### Implementation

- `fuse_inode` write cache fields: `write_files` list, `queued_writes`, `writectr`, `iocachectr`, `page_waitq`
- `fuse_cache_write_iter()` (file.c:1481): if `writeback_cache` enabled, uses `iomap_file_buffered_write()` (write-back mode); otherwise `fuse_perform_write()` (accumulates folios, sends via `fuse_send_write_pages`)
- `fuse_writepages()` (file.c:2289): uses `iomap_writepages()` with `fuse_writeback_ops`
- `fuse_sync_bucket`: per-connection bucket for synchronizing write completion. `fuse_sync_bucket_dec()` wakes waiters when the bucket count reaches zero
- `FUSE_NOWRITE` bias: blocks new writes during truncate/fsync

---

## The Control Filesystem (/sys/fs/fuse/connections)

`control.c` (367 lines) implements the `fusectl` pseudo-filesystem that exposes per-connection runtime controls at `/sys/fs/fuse/connections/<dev>/`:

| File | Mode | Purpose |
|------|------|---------|
| `waiting` | 0400 (ro) | Number of requests waiting (`fuse_chan_num_waiting`) |
| `abort` | 0200 (wo) | Write to abort all requests (`fuse_chan_abort`) |
| `max_background` | 0600 (rw) | Read/write max background requests (capped by `max_user_bgreq`) |
| `congestion_threshold` | 0600 (rw) | Read/write congestion threshold (capped by `max_user_congthresh`) |

`fuse_ctl_add_conn()` creates the directory + files under `fuse_mutex`. Non-admin users are capped by the global `max_user_*` module parameters.

---

## Notifications (Kernel-Side Processing)

`notify.c` (447 lines) processes unsolicited messages from userspace (written with `oh.unique == 0`, dispatched from `fuse_dev_do_write()`). `fuse_notify()` switches on `fuse_notify_code`:

| Notification | Handler | Action |
|---|---|---|
| `FUSE_NOTIFY_POLL` | `fuse_notify_poll()` | Wake up poll waiters |
| `FUSE_NOTIFY_INVAL_INODE` | `fuse_notify_inval_inode()` | Invalidate page cache for inode range |
| `FUSE_NOTIFY_INVAL_ENTRY` | `fuse_notify_inval_entry()` | Invalidate dentry cache |
| `FUSE_NOTIFY_DELETE` | `fuse_notify_delete()` | Invalidate/unlink child entry |
| `FUSE_NOTIFY_STORE` | `fuse_notify_store()` | Push kernel page-cache data to userspace |
| `FUSE_NOTIFY_RETRIEVE` | `fuse_retrieve()` | Retrieve data from userspace into page cache |
| `FUSE_NOTIFY_RESEND` | `fuse_notify_resend()` | Re-queue inflight requests (daemon failover) |
| `FUSE_NOTIFY_INC_EPOCH` | `fuse_notify_inc_epoch()` | Bump epoch + schedule dentry invalidation |
| `FUSE_NOTIFY_PRUNE` | `fuse_notify_prune()` | Try-prune inodes (batches of 512) |

All handlers hold `fc->killsb` (read) while looking up inodes, preventing superblock freeing during processing.

---

## Recent Features and Future Directions

The FUSE kernel module is actively developed. Recent additions:

- **FUSE_PASSTHROUGH** — direct kernel-to-backing-file I/O bypassing userspace for data operations (protocol 7.40). The biggest performance feature in years.
- **FUSE-over-io_uring** — io_uring transport for reduced syscall overhead (protocol 7.42)
- **Request timeouts** (`req_timeout.c`) — `fuse_check_timeout()` runs every 15s, scans all queues, aborts the connection if any request exceeds `req_timeout`
- **Sync FUSE_INIT** — SELinux compatibility (process requests during mount handshake)
- **FUSE_SECURITY_CTX** — SELinux/LSM security context passthrough
- **FUSE_HANDLE_KILLPRIV_V2** — improved privilege handling on write/chown/trunc
- **DAX** (`dax.c`, ~1500 lines) — direct access to CXL persistent memory
- **Virtio-fs** (`virtio_fs.c`, ~2000 lines) — FUSE over virtio for virtual machines
- **famfs** — CXL-attached memory filesystem (2024-2025 development, RFC patches)

---

## How to Read the Source: A Map for Newcomers

1. `fuse_i.h` — all core data structures (fuse_conn, fuse_inode, fuse_file, fuse_chan)
2. `fuse_dev_i.h` — request, channel, queue structures
3. `dev.c` — /dev/fuse transport and request lifecycle
4. `inode.c` — inode operations, FUSE_INIT, superblock setup
5. `file.c` — file operations (read, write, mmap, ioctl)
6. `dir.c` — directory operations
7. `dev_uring.c` — io_uring transport
8. `passthrough.c` — direct I/O bypass
9. `control.c` — sysfs control interface
10. `notify.c` — kernel-side notification processing

---

## Frequently Asked Questions

### What is the relationship between the FUSE kernel module and libfuse?

The kernel module (`fs/fuse/`) intercepts VFS calls and forwards them to userspace via `/dev/fuse`. libfuse is the userspace library that reads those requests, dispatches to your filesystem callbacks, and writes responses back. They communicate via the FUSE protocol defined in `include/uapi/linux/fuse.h`. See our [companion post on libfuse internals](/posts/libfuse-deep-dive-software-engineer/) for the userside perspective.

### How many lines of code is the FUSE kernel module?

The `fs/fuse/` directory contains ~13,000+ lines across 30+ `.c` and `.h` files. The largest files are `file.c` (3121 lines), `dir.c` (2498), `dev.c` (2430), `inode.c` (2190), `dev_uring.c` (1457), and `virtio_fs.c` (~2000 lines).

### What is FUSE passthrough?

FUSE_PASSTHROUGH lets the kernel perform read/write I/O directly on a backing file, bypassing the userspace daemon for data operations. Userspace still handles metadata (lookup, getattr). This eliminates the userspace round-trip for data I/O — a significant performance win for data-heavy workloads.

### How does FUSE-over-io-uring work?

Instead of read()/write() on /dev/fuse, both kernel and userspace use io_uring shared ring buffers. The `FUSE_IO_URING_CMD_COMMIT_AND_FETCH` operation combines committing the previous reply and fetching the next request in a single SQE. This reduces syscall overhead and improves throughput for I/O-heavy workloads.

### Is the FUSE kernel module actively maintained?

Yes — and this is where the FUSE story gets interesting. **The kernel module is actively maintained** by Miklos Szeredi (original author) with regular additions: io_uring support, passthrough, request timeouts, DAX, and security context passthrough. **But the userspace libfuse library is in limited-maintenance mode** (no active regular contributors beyond the maintainer who applies PRs and ships releases). This creates a growing gap: the kernel module keeps gaining features (FUSE_PASSTHROUGH, FUSE_OVER_IO_URING, request timeouts, sync_init, FUSE_HANDLE_KILLPRIV_V2) that libfuse doesn't fully support yet. Developers who need the latest kernel FUSE features may need to interface with the kernel protocol directly or use alternative userspace implementations.

---

## Conclusion

The FUSE kernel module is the gatekeeper between the Linux VFS and userspace filesystems. Its design — a request lifecycle with pending/processing/background queues, a transport abstraction supporting both /dev/fuse and io_uring, and a growing set of features that bypass userspace — makes it one of the most interesting subsystems in the kernel.

The source rewards top-down reading: start with `fuse_i.h` for the data structures, `dev.c` for the request lifecycle, then `file.c`/`dir.c`/`inode.c` for the VFS operations, and finally `dev_uring.c` and `passthrough.c` for the performance features. Clone the kernel tree, build with FUSE enabled, and trace a read() from VFS through to userspace and back.

## Sources

- Linux kernel fs/fuse/ source, https://github.com/torvalds/linux/tree/master/fs/fuse
- Kernel FUSE documentation, https://www.kernel.org/doc/html/latest/filesystems/fuse.html
- Kernel fuse-io-uring documentation, https://www.kernel.org/doc/html/latest/filesystems/fuse-io-uring.html
- libfuse deep dive (companion post), /posts/libfuse-deep-dive-software-engineer/
- include/uapi/linux/fuse.h (FUSE protocol header), https://github.com/torvalds/linux/blob/master/include/uapi/linux/fuse.h
