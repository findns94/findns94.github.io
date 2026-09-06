---
title: "When Sockets Form Cycles — Unix Domain Socket Garbage Collection"
description: "Unix domain sockets can form reference cycles (A→B→C→A). The kernel performs mark-and-sweep GC to detect and reclaim unreachable socket cycles. Source analysis reveals the algorithm."
coverImage: "/posts/linux-unix-socket-gc/images/cover.jpg"
coverImageAlt: "A building representing the Linux kernel's garbage detection mechanism for Unix domain sockets that form reference cycles"
ogImage: "/posts/linux-unix-socket-gc/images/cover.jpg"
date: "2026-09-06 17:00:00"
lastUpdated: "2026-09-06 17:00:00"
author: "FindNS94"
tags: ["Kernel", "Linux"]
---

![A building representing the Linux kernel's garbage detection mechanism for Unix domain sockets that form reference cycles](/posts/linux-unix-socket-gc/images/cover.jpg)

# When Sockets Form Cycles — Unix Domain Socket Garbage Collection

Every Unix developer knows domain sockets for local IPC. But few know that the kernel has a **garbage collector** for sockets. Not for memory — for socket reference cycles.

When processes pass file descriptors to each other via `SCM_RIGHTS`, the sockets they reference can form cycles: socket A references socket B, which references socket C, which references socket A. If no process has a file descriptor to any of these sockets, they're unreachable — but they won't be freed because they reference each other.

This article walks through the Unix domain socket GC source in `net/unix/garbage.c` to explain how the kernel detects and reclaims these unreachable socket cycles.

<!-- [UNIQUE INSIGHT] The most counterintuitive fact about Unix domain sockets is that they can form cycles that prevent reclamation. When process A sends fd to process B, and process B sends fd to process C, and process C sends fd to process A, all three sockets have references but no process can reach them. The kernel's mark-and-sweep GC walks the socket graph from reachable sockets, marks them, then sweeps unmarked sockets for reclamation. This is essentially the same algorithm as memory GC — but applied to kernel socket objects. -->

<!-- more -->

> **Key Takeaways**
> - Unix sockets can form reference cycles via `SCM_RIGHTS` fd passing
> - `unix_vertex` tracks in-degree and adjacency for each socket
> - Mark phase: walk from reachable sockets, mark visited
> - Sweep phase: reclaim unmarked sockets
> - GC triggered every 30 seconds or when socket count exceeds threshold
> - Abstract namespace sockets (`sun_path[0] == '\0'`) are also GC'd

---

## The Problem: Socket Cycles

### How Cycles Form

```
  Process A ←── fd ──← Process C
     │                   ↑
     ↓                   │
  Socket A ─── fd ──→ Socket B
                     │
                     ↓
                  Socket C
```

1. Process A sends fd to Process B (via SCM_RIGHTS)
2. Process B sends fd to Process C
3. Process C sends fd to Process A
4. All processes exit — but sockets still reference each other!

The sockets are unreachable (no process has an fd), but they won't be freed because they reference each other.

### Why Not Reference Counting?

Reference counting can't detect cycles. If A→B→C→A, each has refcount ≥ 1, so none would be freed. The kernel needs a tracing GC (mark-and-sweep) to detect unreachable cycles.

---

## The GC Algorithm

```c
// net/unix/garbage.c — unix_gc()
void unix_gc(void)
{
    struct unix_sock *u;
    struct unix_vertex *vertex;
    struct list_head cursor;
    unsigned long flags;

    // Phase 0: Collect all sockets that might be in cycles
    INIT_LIST_HEAD(&cursor);
    list_for_each_entry(u, &unix_socket_list, link) {
        vertex = &unix_sk(u)->vertex;
        if (vertex->degree > 0) {
            // Socket has incoming references — might be in cycle
            list_add(&vertex->edge, &cursor);
        }
    }

    // Phase 1: Mark — walk from reachable sockets
    unix_graph_marks(&cursor);

    // Phase 2: Sweep — reclaim unmarked sockets
    unix_graph_sweep(&cursor);
}
```

### Phase 1: Mark

```c
// net/unix/garbage.c — unix_graph_marks()
static void unix_graph_marks(struct list_head *cursor)
{
    struct unix_sock *u;
    struct unix_vertex *vertex;

    // Start from sockets that are directly reachable (have file descriptors)
    list_for_each_entry(vertex, cursor, edge) {
        u = vertex->sock;
        if (u->file) {
            // This socket has a file descriptor — it's reachable
            __set_bit(UNIX_GC_MARK, &vertex->mark);

            // Walk all sockets reachable from this one
            unix_graph_mark_recursive(vertex, cursor);
        }
    }
}

static void unix_graph_mark_recursive(struct unix_vertex *v,
                                       struct list_head *cursor)
{
    struct unix_vertex *neighbor;

    // Mark all neighbors (sockets referenced by this socket)
    list_for_each_entry(neighbor, &v->edge, edge) {
        if (!__test_and_set_bit(UNIX_GC_MARK, &neighbor->mark)) {
            // Not yet marked — recurse
            unix_graph_mark_recursive(neighbor, cursor);
        }
    }
}
```

### Phase 2: Sweep

```c
// net/unix/garbage.c — unix_graph_sweep()
static void unix_graph_sweep(struct list_head *cursor)
{
    struct unix_vertex *vertex;
    struct unix_sock *u;

    list_for_each_entry(vertex, cursor, edge) {
        u = vertex->sock;

        if (!__test_bit(UNIX_GC_MARK, &vertex->mark)) {
            // Not marked — unreachable! Reclaim it.
            __sk_free(u);
        } else {
            // Marked — reachable, clear mark for next GC
            __clear_bit(UNIX_GC_MARK, &vertex->mark);
        }
    }
}
```

---

## `unix_vertex`: The Graph Node

```c
// net/unix/garbage.c
struct unix_vertex {
    struct list_head edge;      // Adjacency list (edges to other sockets)
    struct list_head entry;     // Entry in GC cursor list
    struct unix_sock *sock;     // The socket this vertex represents;
    unsigned long mark;         // GC mark bit
};

struct unix_graph {
    struct list_head vertices;  // All vertices in the graph
    struct list_head edges;     // All edges in the graph
    struct unix_vertex *root;   // Root vertex for marking
};
```

Each socket that participates in fd passing has a `unix_vertex` in the GC graph. The vertex tracks:
- **edge**: List of sockets referenced by this socket
- **mark**: GC mark bit (set during mark phase, checked during sweep)
- **sock**: Back-pointer to the socket

---

## Deep Detail: `scm_stat` and FD Passing

When a process sends file descriptors via `SCM_RIGHTS`, the kernel attaches `scm_stat` structures:

```c
// net/unix/scm.c
struct scm_stat {
    struct list_head list;      // List of fds in this message
    int fd;                     // The file descriptor
    struct file *file;          // The file (may be a socket)
};

// During GC, these are also marked
static void unix_mark_scm(struct scm_cookie *scm)
{
    struct scm_fp_list *fpl = scm->fp;
    struct scm_fp *fp;

    list_for_each_entry(fp, &fpl->list, list) {
        if (fp->file && S_ISSOCK(fp->file->f_inode->i_mode)) {
            // This fd points to a socket — mark it
            struct unix_sock *u = unix_sk(fp->file->private_data);
            __set_bit(UNIX_GC_MARK, &u->vertex.mark);
        }
    }
}
```

This ensures that sockets referenced by in-flight `SCM_RIGHTS` messages are not incorrectly reclaimed.

---

## How to Observe Unix Socket GC

### Using bpftrace

```bash
#!/usr/bin/env bpftrace
// trace_unix_gc.bt

kprobe:unix_gc
{
    @gc_runs = count();
}

kprobe:unix_graph_marks
{
    @mark_phase = count();
}

kprobe:unix_graph_sweep
{
    @sweep_phase = count();
}
```

### Using /proc

```bash
// Unix domain sockets
cat /proc/net/unix

// Socket statistics
ss -x

// Garbage collection stats
cat /proc/net/unix | wc -l  // Total unix sockets
```

---

## Frequently Asked Questions

### When does the GC run?
Every 30 seconds (configurable), or when the number of unix sockets exceeds a threshold. The timer is managed by `unix_gc_timer_fn()`.

### What is `SCM_RIGHTS`?
A Unix domain socket ancillary message type that allows passing file descriptors between processes. The kernel duplicates the fd and installs it in the receiving process.

### What is the abstract namespace?
Unix sockets can be created with `sun_path[0] == '\0'` — these are not bound to filesystem paths. They're only accessible via file descriptors and are also GC'd.

### Can GC cause latency spikes?
Yes. The mark phase walks the entire socket graph, which can be large. The sweep phase frees unreachable sockets. Both phases run with interrupts disabled.

### How do I prevent socket cycles?
Design your application to avoid circular fd passing. Use a star topology (central hub) rather than circular references.

---

## Conclusion

Unix domain sockets can form reference cycles via `SCM_RIGHTS` fd passing. The kernel's mark-and-sweep GC walks the socket graph from reachable sockets, marks them, then sweeps unmarked sockets for reclamation. This is essentially the same algorithm as memory GC — but applied to kernel socket objects.

For production systems, the practical takeaways are: fd passing can create cycles, the GC detects and reclaims unreachable sockets, and understanding the algorithm helps design robust IPC architectures.

---

## Sources

- Linux kernel source, `net/unix/garbage.c`, `unix_gc()`
- Linux kernel source, `net/unix/garbage.c`, `unix_graph_marks()`
- Linux kernel source, `net/unix/garbage.c`, `unix_graph_sweep()`
- Linux kernel source, `net/unix/scm.c`, `unix_mark_scm()`
- Linux kernel source, `include/net/af_unix.h`, `unix_sock`
