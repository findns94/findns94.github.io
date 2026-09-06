---
title: "From Indirect Blocks to B-Tree — How ext4 Revolutionized File Storage"
description: "ext4 replaced the classic UNIX indirect block mapping with extent trees. A single extent can map 32KB of contiguous blocks, reducing metadata overhead. Source analysis reveals the evolution."
coverImage: "/posts/linux-ext4-extent-era/images/cover.jpg"
coverImageAlt: "A building representing the evolution from indirect blocks to extent trees in ext4 filesystem"
ogImage: "/posts/linux-ext4-extent-era/images/cover.jpg"
date: "2026-09-06 09:00:00"
lastUpdated: "2026-09-06 09:00:00"
author: "FindNS94"
tags: ["Kernel", "Linux"]
---

![A building representing the evolution from indirect blocks to extent trees in ext4 filesystem](/posts/linux-ext4-extent-era/images/cover.jpg)

# From Indirect Blocks to B-Tree — How ext4 Revolutionized File Storage

Every computer science student learns the UNIX inode structure: 12 direct block pointers, 1 single indirect, 1 double indirect, 1 triple indirect. This elegant scheme has served filesystems for decades. But it has a fundamental problem: for large files, finding the physical block for a given logical offset requires up to 4 disk reads (through 3 levels of indirect blocks).

ext4 solved this by replacing indirect blocks with **extent trees** — a B+ tree structure where each node maps a range of logical blocks to a range of physical blocks. A single extent can map up to 32768 contiguous blocks (128 MB with 4KB blocks), reducing metadata overhead by orders of magnitude.

This article walks through the ext4 source in `fs/ext4/` to explain the classic indirect block scheme, the extent tree replacement, and how `ext4_map_blocks()` finds the physical block for a given logical offset.

<!-- [UNIQUE INSIGHT] The most counterintuitive fact about ext4 extents is that they are NOT stored in the inode itself (except for the first 4). The extent tree is stored in a separate data structure (ext4_extent_header + ext4_extent_idx nodes) that is loaded into memory on demand. This means a 1GB file and a 1TB file have the same inode size — the extent tree grows outside the inode. -->

<!-- more -->

> **Key Takeaways**
> - Classic UNIX: 12 direct + 1 indirect + 1 double + 1 triple = up to ~4GB files
> - ext4 extents: B+ tree mapping logical → physical block ranges
> - Single extent can map up to 32768 contiguous blocks (128 MB)
> - First 4 extents stored inline in inode; rest in separate tree nodes
> - Delayed allocation defers physical block assignment until writeback
> - Fast Commit (FC) optimizes journaling for small metadata changes

---

## The Myth: "Filesystems Store Block Pointers in the Inode"

The classic UNIX inode stores block pointers directly:

```
  ┌─────────────────────────────────────────────────────────────────────┐
  │                         inode                                      │
  │                                                                     │
  │  ┌───────────────────────────────────────────────────────────────┐ │
  │  │  i_block[0-11]: Direct block pointers (12 blocks = 48 KB)     │ │
  │  └───────────────────────────────────────────────────────────────┘ │
  │  ┌───────────────────────────────────────────────────────────────┐ │
  │  │  i_block[12]: Single indirect pointer → 1024 blocks (4 MB)    │ │
  │  └───────────────────────────────────────────────────────────────┘ │
  │  ┌───────────────────────────────────────────────────────────────┐ │
  │  │  i_block[13]: Double indirect pointer → 1M blocks (4 GB)      │ │
  │  └───────────────────────────────────────────────────────────────┘ │
  │  ┌───────────────────────────────────────────────────────────────┐ │
  │  │  i_block[14]: Triple indirect pointer → 1B blocks (4 TB)      │ │
  │  └───────────────────────────────────────────────────────────────┘ │
  └─────────────────────────────────────────────────────────────────────┘
```

### The Problem: Deep Indirection

To read block 1,000,000 of a large file:
1. Read inode (get double indirect pointer)
2. Read double indirect block (get single indirect pointer)
3. Read single indirect block (get block pointer)
4. Read actual data block

That's 3 disk reads before you even get to the data! For sequential reads, the kernel can prefetch, but for random access, this is devastating.

---

## ext4 Extents: The B+ Tree Solution

### What is an Extent?

An extent is a contiguous range of blocks:

```c
// fs/ext4/ext4.h
struct ext4_extent {
    __le32  ee_block;       // First logical block number
    __le16  ee_len;         // Number of blocks (max 32768)
    __le16  ee_start_hi;    // High 16 bits of physical block
    __le32  ee_start_lo;    // Low 32 bits of physical block
};
```

A single extent maps `ee_len` contiguous logical blocks starting at `ee_block` to `ee_len` contiguous physical blocks starting at `ee_start`.

### The Extent Tree

```c
// fs/ext4/ext4.h
struct ext4_extent_header {
    __le16  eh_magic;       // EXT4_EXT_MAGIC (0xF30A)
    __le16  eh_entries;     // Number of valid entries
    __le16  eh_max;         // Maximum entries per node
    __le16  eh_depth;       // Depth of tree (0 = leaf)
    __le32  eh_generation;  // Generation (for NFS)
};

struct ext4_extent_idx {
    __le32  ei_block;       // First logical block covered by this node
    __le32  ei_leaf_lo;     // Low 32 bits of physical block of child node
    __le16  ei_leaf_hi;     // High 16 bits of physical block of child node
    __le16  ei_unused;
};
```

### Tree Structure

```
  ┌─────────────────────────────────────────────────────────────────────┐
  │                    ext4_inode_info                                  │
  │                                                                     │
  │  ┌───────────────────────────────────────────────────────────────┐ │
  │  │  i_data[15]: Inline extents (first 4 extents stored here)     │ │
  │  │  ┌─────────┐ ┌─────────┐ ┌─────────┐ ┌─────────┐            │ │
  │  │  │extent 0 │ │extent 1 │ │extent 2 │ │extent 3 │            │ │
  │  │  └─────────┘ └─────────┘ └─────────┘ └─────────┘            │ │
  │  └───────────────────────────────────────────────────────────────┘ │
  │  ┌───────────────────────────────────────────────────────────────┐ │
  │  │  eh_root: Pointer to extent tree root (if > 4 extents)       │ │
  │  │                                                               │ │
  │  │  ┌─────────────────────────────────────────────────────────┐ │ │
  │  │  │              Root Node (ext4_extent_header)             │ │ │
  │  │  │  ┌───────────┐ ┌───────────┐ ┌───────────┐            │ │ │
  │  │  │  │extent_idx │ │extent_idx │ │extent_idx │            │ │ │
  │  │  │  │ ei_block=0 │ │ei_block=50 │ │ei_block=100│           │ │ │
  │  │  │  │→ child 0  │ │→ child 1  │ │→ child 2  │            │ │ │
  │  │  │  └───────────┘ └───────────┘ └───────────┘            │ │ │
  │  │  └─────────────────────────────────────────────────────────┘ │ │
  │  │         │                │                │                  │ │
  │  │         ▼                ▼                ▼                  │ │
  │  │  ┌─────────────┐  ┌─────────────┐  ┌─────────────┐          │ │
  │  │  │  Leaf Node  │  │  Leaf Node  │  │  Leaf Node  │          │ │
  │  │  │  extents    │  │  extents    │  │  extents    │          │ │
  │  │  │  0-49       │  │  50-99      │  │  100+       │          │ │
  │  │  └─────────────┘  └─────────────┘  └─────────────┘          │ │
  │  └───────────────────────────────────────────────────────────────┘ │
  └─────────────────────────────────────────────────────────────────────┘
```

### Inline Extents

The first 4 extents are stored inline in the inode's `i_data[15]` array. This means files with ≤ 4 extents (≤ 512 MB of contiguous data) have no separate extent tree — all metadata is in the inode itself.

---

## `ext4_map_blocks()`: Finding Physical Blocks

```c
// fs/ext4/inode.c — ext4_map_blocks()
int ext4_map_blocks(struct handle *handle, struct inode *inode,
                    struct ext4_map_blocks *map, int flags)
{
    struct ext4_inode_info *ei = EXT4_I(inode);
    struct ext4_extent_header *eh;
    struct ext4_extent *ex;
    ext4_fsblk_t newblk;
    int depth, ret;

    // Check inline extents first (first 4 extents in inode)
    if (ei->i_depth == 0) {
        ex = ei->i_extents;
        for (int i = 0; i < ei->i_extents_count; i++) {
            if (map->m_lblk >= ex[i].ee_block &&
                map->m_lblk < ex[i].ee_block + ex[i].ee_len) {
                // Found in inline extents!
                map->m_pblk = ext4_ext_pblock(&ex[i]) +
                              (map->m_lblk - ex[i].ee_block);
                return ex[i].ee_len;
            }
        }
    }

    // Search the extent tree
    eh = ext4_ext_get_header(inode);
    depth = ext4_ext_get_depth(eh);

    // Walk the tree from root to leaf
    ex = ext4_ext_find_extent(inode, map->m_lblk, &path);
    if (IS_ERR(ex))
        return PTR_ERR(ex);

    // Calculate physical block
    map->m_pblk = ext4_ext_pblock(ex) + (map->m_lblk - ex->ee_block);
    map->m_len = ex->ee_len - (map->m_lblk - ex->ee_block);

    return map->m_len;
}
```

### `ext4_ext_find_extent()`: Tree Walk

```c
// fs/ext4/extents.c — ext4_ext_find_extent()
static struct ext4_extent *ext4_ext_find_extent(struct inode *inode,
                                                 ext4_lblk_t block,
                                                 struct ext4_ext_path *path)
{
    struct ext4_extent_header *eh;
    struct ext4_extent_idx *ix;
    struct ext4_extent *ex;
    int depth, ppos;

    eh = ext4_ext_get_header(inode);
    depth = ext4_ext_get_depth(eh);

    // Walk from root to leaf
    for (ppos = depth; ppos >= 0; ppos--) {
        // Read the index node at this level
        ix = ext4_ext_get_idx(path[ppos].p_idx);

        // Binary search for the child that covers our block
        int i = ext4_ext_binsearch_idx(eh, block);
        path[ppos].p_block = ext4_idx_pblock(&ix[i]);

        // Read the child node
        path[ppos - 1].p_bh = sb_bread(inode->i_sb, path[ppos].p_block);
        eh = ext4_ext_get_header(path[ppos - 1].p_bh);
    }

    // At leaf level — binary search for the extent
    ex = ext4_ext_get_ext(path[0].p_ext);
    int i = ext4_ext_binsearch_ext(eh, block);

    return &ex[i];
}
```

---

## Delayed Allocation

ext4 defers physical block assignment until writeback time:

```c
// fs/ext4/inode.c — ext4_da_write_begin()
static int ext4_da_write_begin(struct file *file, struct address_space *mapping,
                               loff_t pos, unsigned len, struct page **pagep,
                               void **fsdata)
{
    struct inode *inode = mapping->host;
    struct ext4_map_blocks map;

    // Don't allocate physical blocks yet!
    // Just reserve space in the journal
    map.m_lblk = pos >> inode->i_blkbits;
    map.m_len = len >> inode->i_blkbits;

    // Reserve (but don't allocate) blocks
    ret = ext4_da_reserve_space(inode, map.m_len);

    // Actual allocation happens in writeback
    return ret;
}
```

### Why Delay?

1. **Better contiguity**: The kernel can see all pending writes and allocate contiguous blocks
2. **Reduced fragmentation**: Batch allocation produces larger extents
3. **Fewer journal transactions**: Metadata changes are batched

---

## Deep Detail: `address_space_operations` Selection

ext4 selects different `address_space_operations` based on mount options:

```c
// fs/ext4/inode.c — ext4_set_aops()
static void ext4_set_aops(struct inode *inode)
{
    struct ext4_sb_info *sbi = EXT4_SB(inode->i_sb);

    // Default: ordered/writeback data mode
    inode->i_mapping->a_ops = &ext4_aops;

    // Full data journaling (data=journal mount option)
    if (test_opt(inode->i_sb, JOURNAL_DATA))
        inode->i_mapping->a_ops = &ext4_journalled_aops;

    // Delayed allocation (default for writeback/ordered)
    if (test_opt(inode->i_sb, DELALLOC))
        inode->i_mapping->a_ops = &ext4_da_aops;

    // Direct Access (DAX, for persistent memory)
    if (IS_DAX(inode))
        inode->i_mapping->a_ops = &ext4_dax_aops;
}
```

Each `a_ops` variant implements different `read_folio()`, `writepage()`, and `write_begin()` functions optimized for the specific data mode.

---

## How to Observe ext4 Behavior

### Using bpftrace

```bash
#!/usr/bin/env bpftrace
// trace_ext4.bt

kprobe:ext4_map_blocks
{
    @map[comm] = count();
}

kprobe:ext4_da_write_begin
{
    @da_write[comm] = count();
}

kprobe:ext4_ext_find_extent
{
    @extent_search[comm] = count();
}
```

### Using /proc and /sys

```bash
// Ext4 filesystem info
dumpe2fs /dev/sda1 | head -30

// Per-inode extent info
debugfs -R "stat <inode>" /dev/sda1

// Ext4 mount options
mount | grep ext4

// Ext4 statistics
cat /proc/fs/ext4/*/es_stats
```

### Using perf

```bash
// Profile ext4 operations
perf record -e ext4:ext4_map_blocks -g -- ./benchmark_io
perf report
```

---

## Frequently Asked Questions

### What is the maximum file size in ext4?
With 4KB blocks and 48-bit block addressing: 1 EB (exabyte). With 1KB blocks: 16 TB.

### What is the difference between ext4 and ext3?
ext4 adds extents (replacing indirect blocks), delayed allocation, larger file/volume sizes, and journal checksums. ext3 uses the classic indirect block scheme.

### What is delayed allocation?
ext4 defers physical block assignment until writeback time. This improves contiguity and reduces fragmentation, but increases data loss risk on power failure.

### What is DAX?
Direct Access (DAX) bypasses the page cache for persistent memory (NVM). Data is accessed directly from the storage device without copying to RAM.

### How do I check the number of extents in a file?
Use `filefrag -v /path/to/file` or `debugfs -R "stat <inode>" /dev/sda1`.

---

## Conclusion

ext4's extent tree is a fundamental improvement over the classic UNIX indirect block scheme. By mapping contiguous ranges of blocks instead of individual blocks, ext4 reduces metadata overhead by orders of magnitude and enables efficient handling of multi-terabyte files.

The practical takeaways are: extents store ranges (not individual blocks), the first 4 extents are inline in the inode, delayed allocation improves contiguity, and the extent tree grows outside the inode for large files.

---

## Sources

- Linux kernel source, `fs/ext4/ext4.h`, `ext4_extent` and `ext4_extent_idx`
- Linux kernel source, `fs/ext4/inode.c`, `ext4_map_blocks()`
- Linux kernel source, `fs/ext4/extents.c`, `ext4_ext_find_extent()`
- Linux kernel source, `fs/ext4/inode.c`, `ext4_da_write_begin()`
- Linux kernel source, `fs/ext4/ext4.h`, `ext4_inode_info`
