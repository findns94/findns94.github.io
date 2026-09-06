---
title: "为什么你的文件读取不碰磁盘？——Page Cache、Readahead 与 Writeback 的魔术"
description: "大多数文件读取从不接触磁盘。Page Cache 从 RAM 提供数据，Readahead 预取顺序访问，Writeback 延迟磁盘写入。源码分析揭示机制。"
coverImage: "/posts/linux-page-cache-magic/images/cover.jpg"
coverImageAlt: "数字存储介质，代表 Linux 内核的页缓存机制，从 RAM 提供文件 I/O"
ogImage: "/posts/linux-page-cache-magic/images/cover.jpg"
date: "2026-09-06 07:00:00"
lastUpdated: "2026-09-06 07:00:00"
author: "FindNS94"
tags: ["Kernel", "Linux"]
---

![数字存储介质，代表 Linux 内核的页缓存机制，从 RAM 提供文件 I/O](/posts/linux-page-cache-magic/images/cover.jpg)

# 为什么你的文件读取不碰磁盘？——Page Cache、Readahead 与 Writeback 的魔术

每个分析过 I/O 密集型应用的开发者都见过同样的惊人结果：`read()` 系统调用在微秒内返回，即使磁盘需要毫秒级时间来获取数据。解释是 **page cache** —— Linux 的文件内容内存缓存，使大多数文件读取完全是 RAM 操作。

但 page cache 不仅仅是简单缓存。它是一个复杂的系统，预测未来访问（readahead）、延迟写入以批量处理（writeback）、维护与磁盘的一致性（dirty page 追踪）以及适应工作负载模式（adaptive readahead）。理解 page cache 能解释为什么 `write()` 立即返回但 `fsync()` 可能需要毫秒，为什么顺序读取比随机读取快 100 倍，以及为什么 Linux 使用几乎所有"空闲" RAM 进行缓存。

本文通过分析 `mm/filemap.c` 中的 page cache 源码来解释 `filemap_read()` 如何从缓存提供数据，`page_cache_async_ra()` 如何预测顺序访问，以及 `writeback_single_inode()` 如何最终将数据写入磁盘。

<!-- [UNIQUE INSIGHT] Page cache 最反直觉的方面是 `write()` 不意味着"数据在磁盘上"。它意味着"数据在 RAM 中，稍后会写入磁盘"。内核延迟写入 5-30 秒（可通过 `dirty_writeback_centisecs` 配置）以将它们批量化为大型顺序磁盘操作。这就是为什么断电可能丢失你的应用程序已经"写入"的数据 —— 以及为什么存在 `fsync()`。 -->

<!-- more -->

> **核心要点**
> - 大多数文件读取从不接触磁盘 —— page cache 从 RAM 提供数据
> - `filemap_read()` 使用 xarray 查找在 O(1) 时间内找到缓存页
> - Readahead 预测顺序访问并在需要前预取页面
> - Writeback 延迟磁盘写入 5-30 秒以高效批量处理
> - 脏页通过 `PAGECACHE_TAG_DIRTY` 标记以进行高效的回写扫描
> - `fsync()` 强制数据写入磁盘 —— 保证持久性的唯一方式

---

## 误区："read() 从磁盘读取"

心智模型：`read(fd, buf, 4096)` → 内核从磁盘读取 4096 字节 → 拷贝到 `buf`。这对常见情况是错误的。

实际发生的是：

```
  read(fd, buf, 4096)
       │
       ▼
  ┌─────────────────────────────────────────────────────────────────────┐
  │ 第 1 步：filemap_read()                                             │
  │ • 在 page cache 中查找页面（xarray）                                │
  │ • 缓存命中：从 RAM 拷贝数据 → 立即返回（~1 μs）                    │
  │ • 缓存未命中：分配页面 → 从磁盘读取 → 拷贝（~5 ms）                │
  └─────────────────────────────────────────────────────────────────────┘
       │
       ▼
  ┌─────────────────────────────────────────────────────────────────────┐
  │ 第 2 步：pagecache_get_page()                                       │
  │ • 计算页索引：offset / PAGE_SIZE                                    │
  │ • 在 mapping->i_pages（xarray）中查找                               │
  │ • 如果找到：返回页面（标记为已访问）                                │
  │ • 如果未找到：分配新页面，添加到 xarray，标记为需要 I/O            │
  └─────────────────────────────────────────────────────────────────────┘
```

对于温缓存（数据已在 RAM 中），整个操作是单次 xarray 查找 + 内存拷贝 —— 无磁盘 I/O，除进入/退出外无系统调用开销。

---

## Page Cache 架构

### xarray：索引结构

Page cache 由存储在 `address_space->i_pages` 中的 xarray（扩展基数树）索引：

```c
// include/linux/fs.h
struct address_space {
    struct inode *host;              // 所属 inode
    struct xarray i_pages;           // Page cache 索引
    struct rw_semaphore invalidate_lock;
    gfp_t gfp_mask;
    struct rb_root_cached i_mmap;    // 内存映射树
    unsigned long nrpages;           // 缓存页数量
    pgoff_t writeback_index;         // 回写起始位置
    const struct address_space_operations *a_ops;
    unsigned long flags;             // AS_EIO, AS_ENOSPC 等
};
```

xarray 映射 `(page_offset)` → `struct page`。查找平均 O(1)。

### `pagecache_get_page()`：查找函数

```c
// mm/filemap.c — pagecache_get_page()
struct page *pagecache_get_page(struct address_space *mapping,
                                pgoff_t index, gfp_t gfp)
{
    struct page *page;

retry:
    // 快速路径：在 xarray 中查找
    page = xa_find(&mapping->i_pages, &index, ULONG_MAX, XA_PRESENT);
    if (page) {
        // 缓存命中！
        if (PageReclaim(page))
            // 页面正在被回收 — 等待
            wait_on_page_locked(page);
        return page;
    }

    // 缓存未命中 — 分配新页面
    page = __page_cache_alloc(gfp);
    if (!page)
        return NULL;

    // 插入 xarray
    int err = xa_insert(&mapping->i_pages, index, page, gfp);
    if (err) {
        // 其他人先插入 — 使用他们的
        put_page(page);
        goto retry;
    }

    // 标记为需要 I/O — 实际读取稍后发生
    return page;
}
```

---

## `filemap_read()`：读取路径

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

    // 逐页读取
    for (;;) {
        // 查找或创建页面
        folio = filemap_get_folio(mapping, iocb->ki_pos >> PAGE_SHIFT);

        if (!folio) {
            // 缓存未命中 — 需要磁盘 I/O
            folio = filemap_create_folio(mapping, iocb->ki_pos >> PAGE_SHIFT);
            if (IS_ERR(folio))
                break;

            // 从磁盘读取
            filemap_read_folio(folio);
        }

        // 从页面拷贝数据到用户缓冲区
        size_t bytes = copy_folio_to_iter(folio, offset, to);

        // 更新位置
        iocb->ki_pos += bytes;
        copied += bytes;

        // 检查是否完成
        if (iov_iter_count(to) == 0)
            break;

        // 触发顺序访问的 readahead
        page_cache_sync_ra(mapping, folio, iocb->ki_pos >> PAGE_SHIFT);
    }

    return copied;
}
```

### `filemap_get_folio()`：缓存查找

```c
// mm/filemap.c
struct folio *filemap_get_folio(struct address_space *mapping, pgoff_t index)
{
    struct folio *folio;

    // 快速路径：在 xarray 中查找
    folio = xa_load(&mapping->i_pages, index);
    if (folio) {
        // 缓存命中！
        folio_accessed(folio);  // 标记为已访问用于 LRU
        return folio;
    }

    // 缓存未命中
    return NULL;
}
```

---

## Readahead：预测未来

### 问题：磁盘延迟

来自 SSD 的单次 4KB 随机读取需要 ~100 μs。如果每个 `read()` 触发一次磁盘访问，吞吐量将限制在 ~40 MB/s。Readahead 通过检测顺序访问模式并在请求前预取数据来解决这个问题。

### `page_cache_sync_ra()`：同步 Readahead

```c
// mm/filemap.c — page_cache_sync_ra()
static void page_cache_sync_ra(struct address_space *mapping,
                               struct folio *folio, pgoff_t offset)
{
    // 检查这是否看起来像顺序访问
    if (offset != folio->index + 1)
        return;  // 非顺序 — 不 readahead

    // 计算要预取多少页
    unsigned long ra_pages = inode->i_ra_pages;  // 自适应窗口

    // 将页面预取到缓存中
    page_cache_sync_readahead(mapping, folio, offset, ra_pages);
}
```

### `page_cache_async_ra()`：异步 Readahead

```c
// mm/filemap.c — page_cache_async_ra()
static void page_cache_async_ra(struct address_space *mapping,
                                struct folio *folio, pgoff_t offset)
{
    // 如果我们处于 readahead 窗口的开头才 readahead
    if (offset != readahead_offset(mapping, folio))
        return;

    // 将 readahead 窗口翻倍（最大到 max）
    unsigned long new_ra = min(inode->i_ra_pages * 2, VM_MAX_READAHEAD);
    inode->i_ra_pages = new_ra;

    // 为 readahead 窗口提交异步 I/O
    page_cache_async_readahead(mapping, folio, offset, new_ra);
}
```

### 自适应 Readahead 算法

内核根据访问模式动态调整 readahead 窗口：

```
  初始读取：         ra_pages = 32 页 (128 KB)
  顺序命中：         ra_pages = 64 页 (256 KB)
  顺序命中：         ra_pages = 128 页 (512 KB)
  ...
  最大：             ra_pages = 2048 页 (8 MB)

  随机访问：         ra_pages = 0 (无 readahead)
```

这种指数增长意味着顺序读取快速达到最大吞吐量，而随机读取不会在无用预取上浪费 I/O。

---

## Writeback：延迟磁盘写入

### 问题：写入放大

单独将每个 4KB 页写入磁盘是低效的。单次 1MB 写入比 256 次单独 4KB 写入快 10 倍。Writeback 延迟写入以批量处理它们：

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

    // 扫描脏页
    while ((folio = filemap_get_folia_tag(mapping, &start, PAGECACHE_TAG_DIRTY,
                                          end))) {
        // 将脏页写入磁盘
        written += filemap_writepage(folio, wbc);

        // 更新回写位置
        mapping->writeback_index = start + 1;
    }

    // 等待 I/O 完成
    if (wbc->sync_mode == WB_SYNC_ALL)
        filemap_fdatawait_range(mapping, wbc->range_start, wbc->range_end);

    return written;
}
```

### 脏页追踪

脏页在 xarray 中标记以进行高效扫描：

```c
// mm/filemap.c — filemap_set_folio_dirty()
void filemap_set_folio_dirty(struct folio *folio)
{
    struct address_space *mapping = folio->mapping;

    // 在 xarray 中标记页面为脏
    xa_lock_irq(&mapping->i_pages);
    __xa_set_mark(&mapping->i_pages, folio->index, PAGECACHE_TAG_DIRTY);
    xa_unlock_irq(&mapping->i_pages);

    // 标记 inode 为脏
    __mark_inode_dirty(mapping->host, I_DIRTY_PAGES);
}
```

`PAGECACHE_TAG_DIRTY` 标记允许内核在回写期间高效扫描仅脏页（跳过干净缓存页）。

### Writeback 触发

Writeback 由三种机制触发：

1. **基于时间**：每 `dirty_writeback_centisecs`（默认 500 = 5 秒），`wb_workfn()` 内核线程唤醒并刷新旧脏页。

2. **基于比率**：当脏页超过总内存的 `dirty_ratio`（默认 20%）时，新写入会阻塞直到回写赶上。

3. **显式**：`fsync()`、`sync()` 或 `msync()` 强制立即回写。

---

## 深度细节：xarray 标记迭代

xarray 支持"标记"迭代 — 高效扫描仅具有特定标记的页面：

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

这就是回写如何高效找到脏页而不扫描整个 page cache 的方法。xarray 的标记迭代每次跳过 O(1) 跳过非脏页。

---

## 如何观测 Page Cache 行为

### 使用 bpftrace

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

### 使用 /proc

```bash
// Page cache 统计
grep -E "Cached|Buffers|Dirty|Writeback" /proc/meminfo

// 每文件 page cache
cat /proc/<pid>/smaps | grep -E "Rss|Shared|Private"

// 清除 page cache（用于测试）
echo 3 > /proc/sys/vm/drop_caches
```

### 使用 perf

```bash
// 分析 page cache 未命中
perf stat -e dTLB-load-misses,iTLB-load-misses ./benchmark_io

// 追踪块 I/O
blktrace -d /dev/sda -o - | blkparse -i -
```

---

## 常见问题

### Page Cache 占用多少 RAM？
Linux 使用几乎所有"空闲" RAM 作为 page cache。这是正常且理想的 — 缓存在应用需要内存时可以立即被回收。查看 `/proc/meminfo` 中的 `Cached`。

### 为什么 `write()` 即时但 `fsync()` 慢？
`write()` 只将数据拷贝到 page cache（RAM）。`fsync()` 强制数据写入磁盘，这需要实际 I/O。内核延迟磁盘写入 5-30 秒以高效批量处理它们。

### 什么是 readahead？它如何工作？
Readahead 检测顺序访问模式并在请求前预取数据。内核在每个顺序命中时将 readahead 窗口翻倍，最大到 ~8 MB。

### 内核如何找到脏页进行回写？
脏页在 xarray 中用 `PAGECACHE_TAG_DIRTY` 标记。回写仅扫描标记的页面，高效跳过干净缓存页。

### 系统内存不足时会发生什么？
内核首先回收干净缓存页（无需 I/O）。如果需要更多内存，它将脏页写入磁盘（回写）然后回收它们。

---

## 总结

Page cache 是 Linux 快速文件 I/O 的秘密。大多数读取从不接触磁盘 — 它们从 RAM 在微秒内提供。Readahead 预测顺序访问并预取数据，实现接近磁盘最大吞吐量。Writeback 延迟磁盘写入以高效批量处理，代价是断电时可能丢失数据。

对于生产系统，实际要点是："空闲" RAM 是浪费的 RAM（Linux 将其用于缓存），`write()` 不意味着数据在磁盘上（持久性用 `fsync()`），理解 readahead 有助于优化顺序 I/O 工作负载。

---

## 来源

- Linux 内核源码, `mm/filemap.c`, `filemap_read()`
- Linux 内核源码, `mm/filemap.c`, `pagecache_get_page()`
- Linux 内核源码, `mm/filemap.c`, `page_cache_sync_ra()`
- Linux 内核源码, `mm/page-writeback.c`, `writeback_single_inode()`
- Linux 内核源码, `include/linux/fs.h`, `struct address_space`
- Linux 内核源码, `include/linux/xarray.h`
