---
title: "Why Doesn't Your File Read Touch the Disk? — The Magic of Page Cache, Readahead, and Writeback"
description: "Most file reads never reach the disk. The page cache serves data from RAM, readahead prefetches sequential access, and writeback delays disk writes. Source analysis reveals the mechanism."
coverImage: "/posts/linux-page-cache-magic/images/cover.jpg"
coverImageAlt: "Digital storage media representing the Linux kernel's page cache mechanism that serves file I/O from RAM"
ogImage: "/posts/linux-page-cache-magic/images/cover.jpg"
date: "2026-09-06 07:00:00"
lastUpdated: "2026-09-06 07:00:00"
author: "FindNS94"
tags: ["Linux", "Kernel", "FileSystem"]
---

![Digital storage media representing the Linux kernel's page cache mechanism that serves file I/O from RAM](/posts/linux-page-cache-magic/images/cover.jpg)

# Why Doesn't Your File Read Touch the Disk? — The Magic of Page Cache, Readahead, and Writeback

Every developer who has profiled an I/O-bound application has seen the same surprising result: a `read()` syscall returns in microseconds, even though the disk would take milliseconds to fetch the data. The explanation is the **page cache** — Linux's in-memory cache of file content that makes most file reads entirely RAM operations.

But the page cache is more than a simple cache. It is a sophisticated system that predicts future access (readahead), delays writes to batch them efficiently (writeback), maintains coherency with the disk (dirty page tracking), and adapts to workload patterns (adaptive readahead). Understanding the page cache explains why `write()` returns instantly but `fsync()` can take milliseconds, why sequential reads are 100x faster than random reads, and why Linux uses almost all "free" RAM for caching.

This article walks through the page cache source in `mm/filemap.c` to explain how `filemap_read()` serves data from cache, how `page_cache_async_ra()` predicts sequential access, and how `writeback_single_inode()` eventually gets data to disk.

<!-- [UNIQUE INSIGHT] The most counterintuitive aspect of the page cache is that `write()` does NOT mean "data is on disk." It means "data is in RAM and will be written to disk later." The kernel delays writes for 5-30 seconds (configurable via `dirty_writeback_centisecs`) to batch them into large, sequential disk operations. This is why a power loss can lose data that your application already "wrote" — and why `fsync()` exists. -->

<!-- more -->

> **Key Takeaways**
> - Most file reads never touch the disk — the page cache serves data from RAM
> - `filemap_read()` uses xarray lookup to find cached pages in O(1)
> - Readahead predicts sequential access and prefetches pages before they're needed
> - Writeback delays disk writes 5-30 seconds to batch them efficiently
> - Dirty pages are tracked via `PAGECACHE_TAG_DIRTY` for efficient writeback scanning
> - `fsync()` forces data to disk — the only way to guarantee durability

---

## The Myth: "read() Reads from Disk"

The mental model: `read(fd, buf, 4096)` → kernel reads 4096 bytes from disk → copies to `buf`. This is wrong for the common case.

What actually happens:

```
  read(fd, buf, 4096)
       │
       ▼
  ┌─────────────────────────────────────────────────────────────────────┐
  │ Step 1: filemap_read()                                              │
  │ • Look up the page in page cache (xarray)                           │
  │ • Cache HIT: copy data from RAM → return immediately (~1 μs)       │
  │ • Cache MISS: allocate page → read from disk → copy (~5 ms)        │
  └─────────────────────────────────────────────────────────────────────┘
       │
       ▼
  ┌─────────────────────────────────────────────────────────────────────┐
  │ Step 2: pagecache_get_page()                                        │
  │ • Calculate page index: offset / PAGE_SIZE                          │
  │ • Look up in mapping->i_pages (xarray)                              │
  │ • If found: return the page (mark as accessed)                      │
  │ • If not found: allocate new page, add to xarray, mark for I/O     │
  └─────────────────────────────────────────────────────────────────────┘
```

For a warm cache (data already in RAM), the entire operation is a single xarray lookup + memory copy — no disk I/O, no syscall overhead beyond the entry/exit.

---

## The Page Cache Architecture

### xarray: The Index Structure

The page cache is indexed by an xarray (extended radix tree) stored in `address_space->i_pages`:

```c
// include/linux/fs.h
struct address_space {
    struct inode *host;              // Owning inode
    struct xarray i_pages;           // Page cache index
    struct rw_semaphore invalidate_lock;
    gfp_t gfp_mask;
    struct rb_root_cached i_mmap;    // Tree of memory mappings
    unsigned long nrpages;           // Number of cached pages
    pgoff_t writeback_index;         // Writeback starts here
    const struct address_space_operations *a_ops;
    unsigned long flags;             // AS_EIO, AS_ENOSPC, etc.
};
```

The xarray maps `(page_offset)` → `struct page`. Lookup is O(1) average case.

### `pagecache_get_page()`: The Lookup Function

```c
// mm/filemap.c — pagecache_get_page()
struct page *pagecache_get_page(struct address_space *mapping,
                                pgoff_t index, gfp_t gfp)
{
    struct page *page;

retry:
    // Fast path: lookup in xarray
    page = xa_find(&mapping->i_pages, &index, ULONG_MAX, XA_PRESENT);
    if (page) {
        // Cache hit!
        if (PageReclaim(page))
            // Page is being reclaimed — wait
            wait_on_page_locked(page);
        return page;
    }

    // Cache miss — allocate new page
    page = __page_cache_alloc(gfp);
    if (!page)
        return NULL;

    // Insert into xarray
    int err = xa_insert(&mapping->i_pages, index, page, gfp);
    if (err) {
        // Someone else inserted first — use theirs
        put_page(page);
        goto retry;
    }

    // Mark for I/O — actual read happens later
    return page;
}
```

---

## `filemap_read()`: The Read Path

```c
// mm/filemap.c — filemap_read()
static ssize_t filemap_read(struct kiocb *iocb, struct iov_iter *to,
                            ssize_t already_read)
{
    struct file *filp = iocb->ki_filp;
    struct address_space *mapping = filp->f_mapping;
    struct inode *inode = mapping->host;
    struct folio *folio;
    size_t copied = 0;

    // Read pages one at a time
    for (;;) {
        // Find or create the page
        folio = filemap_get_folio(mapping, iocb->ki_pos >> PAGE_SHIFT);

        if (!folio) {
            // Cache miss — need disk I/O
            folio = filemap_create_folio(mapping, iocb->ki_pos >> PAGE_SHIFT);
            if (IS_ERR(folio))
                break;

            // Read from disk
            filemap_read_folio(folio);
        }

        // Copy data from page to user buffer
        size_t bytes = copy_folio_to_iter(folio, offset, to);

        // Update position
        iocb->ki_pos += bytes;
        copied += bytes;

        // Check if we're done
        if (iov_iter_count(to) == 0)
            break;

        // Trigger readahead for sequential access
        page_cache_sync_ra(mapping, folio, iocb->ki_pos >> PAGE_SHIFT);
    }

    return copied;
}
```

### `filemap_get_folio()`: Cache Lookup

```c
// mm/filemap.c
struct folio *filemap_get_folio(struct address_space *mapping, pgoff_t index)
{
    struct folio *folio;

    // Fast path: lookup in xarray
    folio = xa_load(&mapping->i_pages, index);
    if (folio) {
        // Cache hit!
        folio_accessed(folio);  // Mark as accessed for LRU
        return folio;
    }

    // Cache miss
    return NULL;
}
```

---

## Readahead: Predicting the Future

### The Problem: Disk Latency

A single 4KB random read from an SSD takes ~100 μs. If each `read()` triggered a disk access, throughput would be limited to ~40 MB/s. Readahead solves this by detecting sequential access patterns and prefetching data before it's requested.

### `page_cache_sync_ra()`: Synchronous Readahead

```c
// mm/filemap.c — page_cache_sync_ra()
static void page_cache_sync_ra(struct address_space *mapping,
                               struct folio *folio, pgoff_t offset)
{
    // Check if this looks like sequential access
    if (offset != folio->index + 1)
        return;  // Not sequential — don't readahead

    // Calculate how many pages to prefetch
    unsigned long ra_pages = inode->i_ra_pages;  // Adaptive window

    // Prefetch pages into cache
    page_cache_sync_readahead(mapping, folio, offset, ra_pages);
}
```

### `page_cache_async_ra()`: Asynchronous Readahead

```c
// mm/filemap.c — page_cache_async_ra()
static void page_cache_async_ra(struct address_space *mapping,
                                struct folio *folio, pgoff_t offset)
{
    // Only readahead if we're at the start of a readahead window
    if (offset != readahead_offset(mapping, folio))
        return;

    // Double the readahead window (up to max)
    unsigned long new_ra = min(inode->i_ra_pages * 2, VM_MAX_READAHEAD);
    inode->i_ra_pages = new_ra;

    // Submit async I/O for the readahead window
    page_cache_async_readahead(mapping, folio, offset, new_ra);
}
```

### Adaptive Readahead Algorithm

The kernel dynamically adjusts the readahead window based on access patterns:

```
  Initial read:     ra_pages = 32 pages (128 KB)
  Sequential hit:   ra_pages = 64 pages (256 KB)
  Sequential hit:   ra_pages = 128 pages (512 KB)
  ...
  Maximum:          ra_pages = 2048 pages (8 MB)

  Random access:    ra_pages = 0 (no readahead)
```

This exponential growth means sequential reads quickly reach maximum throughput, while random reads don't waste I/O on useless prefetching.

---

## Writeback: Delayed Disk Writes

### The Problem: Write Amplification

Writing each 4KB page individually to disk is inefficient. A single 1MB write is 10x faster than 256 individual 4KB writes. Writeback delays writes to batch them:

```c
// mm/page-writeback.c — writeback_single_inode()
static int writeback_single_inode(struct inode *inode,
                                  struct writeback_control *wbc)
{
    struct address_space *mapping = inode->i_mapping;
    struct folio *folio;
    unsigned long start = wbc->range_start;
    unsigned long end = wbc->range_end;
    int written = 0;

    // Scan for dirty pages
    while ((folio = filemap_get_folia_tag(mapping, &start, PAGECACHE_TAG_DIRTY,
                                          end))) {
        // Write the dirty page to disk
        written += filemap_writepage(folio, wbc);

        // Update writeback position
        mapping->writeback_index = start + 1;
    }

    // Wait for I/O to complete
    if (wbc->sync_mode == WB_SYNC_ALL)
        filemap_fdatawait_range(mapping, wbc->range_start, wbc->range_end);

    return written;
}
```

### Dirty Page Tracking

Dirty pages are tagged in the xarray for efficient scanning:

```c
// mm/filemap.c — filemap_set_folio_dirty()
void filemap_set_folio_dirty(struct folio *folio)
{
    struct address_space *mapping = folio->mapping;

    // Mark page as dirty in xarray
    xa_lock_irq(&mapping->i_pages);
    __xa_set_mark(&mapping->i_pages, folio->index, PAGECACHE_TAG_DIRTY);
    xa_unlock_irq(&mapping->i_pages);

    // Mark inode as dirty
    __mark_inode_dirty(mapping->host, I_DIRTY_PAGES);
}
```

The `PAGECACHE_TAG_DIRTY` tag allows the kernel to efficiently scan only dirty pages (skipping clean cached pages) during writeback.

### Writeback Triggers

Writeback is triggered by three mechanisms:

1. **Time-based**: Every `dirty_writeback_centisecs` (default 500 = 5 seconds), the `wb_workfn()` kernel thread wakes up and flushes old dirty pages.

2. **Ratio-based**: When dirty pages exceed `dirty_ratio` (default 20%) of total memory, new writes block until writeback catches up.

3. **Explicit**: `fsync()`, `sync()`, or `msync()` force immediate writeback.

---

## Deep Detail: xarray Tagged Iteration

The xarray supports "tagged" iteration — efficiently scanning only pages with a specific tag:

```c
// mm/filemap.c — filemap_get_folia_tag()
struct folio *filemap_get_folia_tag(struct address_space *mapping,
                                    pgoff_t *index, int tag, pgoff_t max)
{
    XA_STATE(xas, &mapping->i_pages, *index);
    struct folio *folio;

    rcu_read_lock();
    folio = xa_find_next_marked(&xas, max, tag);
    rcu_read_unlock();

    if (folio)
        *index = folio->index;

    return folio;
}
```

This is how writeback efficiently finds dirty pages without scanning the entire page cache. The xarray's tagged iteration skips non-dirty pages in O(1) per skip.

---

## How to Observe Page Cache Behavior

### Using bpftrace

```bash
#!/usr/bin/env bpftrace
// trace_page_cache.bt

kprobe:pagecache_get_page
{
    @lookups[comm] = count();
}

kprobe:filemap_read
{
    @reads[comm] = count();
}

kprobe:page_cache_sync_ra
{
    @readahead[comm] = count();
}

kprobe:writeback_single_inode
{
    @writeback[comm] = count();
}

END
{
    printf("\nPage cache lookups:\n");
    print(@lookups);
    printf("\nReadahead triggers:\n");
    print(@readahead);
}
```

### Using /proc

```bash
// Page cache statistics
grep -E "Cached|Buffers|Dirty|Writeback" /proc/meminfo

// Per-file page cache
cat /proc/<pid>/smaps | grep -E "Rss|Shared|Private"

// Drop page cache (for testing)
echo 3 > /proc/sys/vm/drop_caches
```

### Using perf

```bash
// Profile page cache misses
perf stat -e dTLB-load-misses,iTLB-load-misses ./benchmark_io

// Trace block I/O
blktrace -d /dev/sda -o - | blkparse -i -
```

---

## Frequently Asked Questions

### How much RAM does the page cache use?
Linux uses almost all "free" RAM for page cache. This is normal and desirable — cached pages can be instantly reclaimed when applications need memory. Check `Cached` in `/proc/meminfo`.

### Why is `write()` instant but `fsync()` slow?
`write()` only copies data to the page cache (RAM). `fsync()` forces the data to disk, which requires actual I/O. The kernel delays disk writes for 5-30 seconds to batch them efficiently.

### What is readahead and how does it work?
Readahead detects sequential access patterns and prefetches data before it's requested. The kernel doubles the readahead window on each sequential hit, up to a maximum of ~8 MB.

### How does the kernel find dirty pages for writeback?
Dirty pages are tagged with `PAGECACHE_TAG_DIRTY` in the xarray. Writeback scans only tagged pages, skipping clean cached pages efficiently.

### What happens when the system runs out of memory?
The kernel reclaims clean cached pages first (no I/O needed). If more memory is needed, it writes dirty pages to disk (writeback) and then reclaims them.

---

## Conclusion

The page cache is Linux's secret to fast file I/O. Most reads never touch the disk — they're served from RAM in microseconds. Readahead predicts sequential access and prefetches data, achieving near-disk-maximum throughput. Writeback delays disk writes to batch them efficiently, at the risk of data loss on power failure.

For production systems, the practical takeaways are: "free" RAM is wasted RAM (Linux uses it for cache), `write()` doesn't mean data is on disk (use `fsync()` for durability), and understanding readahead helps optimize sequential I/O workloads.

---

## Sources

- Linux kernel source, `mm/filemap.c`, `filemap_read()`
- Linux kernel source, `mm/filemap.c`, `pagecache_get_page()`
- Linux kernel source, `mm/filemap.c`, `page_cache_sync_ra()`
- Linux kernel source, `mm/page-writeback.c`, `writeback_single_inode()`
- Linux kernel source, `include/linux/fs.h`, `struct address_space`
- Linux kernel source, `include/linux/xarray.h`
