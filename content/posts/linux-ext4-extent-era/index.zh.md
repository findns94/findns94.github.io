---
title: "从间接块到 B 树——ext4 如何革新文件存储"
description: "ext4 用 extent 树替代了经典的 UNIX 间接块映射。单个 extent 可映射 32KB 连续块，大幅减少元数据开销。源码分析揭示演进历程。"
coverImage: "/posts/linux-ext4-extent-era/images/cover.jpg"
coverImageAlt: "一座建筑，代表 ext4 文件系统从间接块到 extent 树的演进"
ogImage: "/posts/linux-ext4-extent-era/images/cover.jpg"
date: "2026-09-06 09:00:00"
lastUpdated: "2026-09-06 09:00:00"
author: "FindNS94"
tags: ["Linux", "Kernel", "FileSystem"]
---

![一座建筑，代表 ext4 文件系统从间接块到 extent 树的演进](/posts/linux-ext4-extent-era/images/cover.jpg)

# 从间接块到 B 树——ext4 如何革新文件存储

每个计算机科学学生都学过 UNIX inode 结构：12 个直接块指针、1 个单间接、1 个双间接、1 个三间接。这种优雅方案已服务文件系统数十年。但它有一个根本问题：对于大文件，找到给定逻辑偏移的物理块需要最多 4 次磁盘读取（通过 3 级间接块）。

ext4 通过用 **extent 树**（B+ 树结构）替代间接块解决了这个问题。每个节点将逻辑块范围映射到物理块范围。单个 extent 最多可映射 32768 个连续块（4KB 块下 128 MB），将元数据开销降低了几个数量级。

本文通过分析 `fs/ext4/` 中的 ext4 源码来解释经典间接块方案、extent 树替代，以及 `ext4_map_blocks()` 如何为给定逻辑偏移找到物理块。

<!-- [UNIQUE INSIGHT] 关于 ext4 extent 最反直觉的事实是它们不存储在 inode 本身（除了前 4 个）。extent 树存储在单独的数据结构中（ext4_extent_header + ext4_extent_idx 节点），按需加载到内存。这意味着 1GB 文件和 1TB 文件的 inode 大小相同 —— extent 树在 inode 外部增长。 -->

<!-- more -->

> **核心要点**
> - 经典 UNIX：12 直接 + 1 间接 + 1 双间接 + 1 三间接 = 最大约 4GB 文件
> - ext4 extent：B+ 树映射逻辑 → 物理块范围
> - 单个 extent 最多可映射 32768 个连续块（128 MB）
> - 前 4 个 extent 内联存储在 inode 中；其余在单独的树节点中
> - 延迟分配将物理块分配推迟到回写时
> - Fast Commit (FC) 优化小元数据变化的日志记录

---

## 误区："文件系统在 inode 中存储块指针"

经典 UNIX inode 直接存储块指针：

```
  ┌─────────────────────────────────────────────────────────────────────┐
  │                         inode                                      │
  │                                                                     │
  │  ┌───────────────────────────────────────────────────────────────┐ │
  │  │  i_block[0-11]: 直接块指针（12 块 = 48 KB）                   │ │
  │  └───────────────────────────────────────────────────────────────┘ │
  │  ┌───────────────────────────────────────────────────────────────┐ │
  │  │  i_block[12]: 单间接指针 → 1024 块（4 MB）                    │ │
  │  └───────────────────────────────────────────────────────────────┘ │
  │  ┌───────────────────────────────────────────────────────────────┐ │
  │  │  i_block[13]: 双间接指针 → 1M 块（4 GB）                      │ │
  │  └───────────────────────────────────────────────────────────────┘ │
  │  ┌───────────────────────────────────────────────────────────────┐ │
  │  │  i_block[14]: 三间接指针 → 1B 块（4 TB）                      │ │
  │  └───────────────────────────────────────────────────────────────┘ │
  └─────────────────────────────────────────────────────────────────────┘
```

### 问题：深层间接

要读取大文件的第 1,000,000 个块：
1. 读取 inode（获取双间接指针）
2. 读取双间接块（获取单间接指针）
3. 读取单间接块（获取块指针）
4. 读取实际数据块

在你甚至获取数据之前就有 3 次磁盘读取！对于顺序读取，内核可以预取，但对于随机访问，这是毁灭性的。

---

## ext4 Extent：B+ 树解决方案

### 什么是 Extent？

Extent 是连续块的范围：

```c
// fs/ext4/ext4.h
struct ext4_extent {
    __le32  ee_block;       // 第一个逻辑块号
    __le16  ee_len;         // 块数（最大 32768）
    __le16  ee_start_hi;    // 物理块高 16 位
    __le32  ee_start_lo;    // 物理块低 32 位
};
```

单个 extent 将 `ee_len` 个连续逻辑块（从 `ee_block` 开始）映射到 `ee_len` 个连续物理块（从 `ee_start` 开始）。

### Extent 树

```c
// fs/ext4/ext4.h
struct ext4_extent_header {
    __le16  eh_magic;       // EXT4_EXT_MAGIC (0xF30A)
    __le16  eh_entries;     // 有效条目数
    __le16  eh_max;         // 每节点最大条目数
    __le16  eh_depth;       // 树深度（0 = 叶节点）
    __le32  eh_generation;  // 代（用于 NFS）
};

struct ext4_extent_idx {
    __le32  ei_block;       // 此节点覆盖的第一个逻辑块
    __le32  ei_leaf_lo;     // 子节点物理块低 32 位
    __le16  ei_leaf_hi;     // 子节点物理块高 16 位
    __le16  ei_unused;
};
```

### 树结构

```
  ┌─────────────────────────────────────────────────────────────────────┐
  │                    ext4_inode_info                                  │
  │                                                                     │
  │  ┌───────────────────────────────────────────────────────────────┐ │
  │  │  i_data[15]: 内联 extent（前 4 个存在这里）                   │ │
  │  │  ┌─────────┐ ┌─────────┐ ┌─────────┐ ┌─────────┐            │ │
  │  │  │extent 0 │ │extent 1 │ │extent 2 │ │extent 3 │            │ │
  │  │  └─────────┘ └─────────┘ └─────────┘ └─────────┘            │ │
  │  └───────────────────────────────────────────────────────────────┘ │
  │  ┌───────────────────────────────────────────────────────────────┐ │
  │  │  eh_root: extent 树根指针（如果 > 4 个 extent）               │ │
  │  │                                                               │ │
  │  │  ┌─────────────────────────────────────────────────────────┐ │ │
  │  │  │              根节点（ext4_extent_header）               │ │ │
  │  │  │  ┌───────────┐ ┌───────────┐ ┌───────────┐            │ │ │
  │  │  │  │extent_idx │ │extent_idx │ │extent_idx │            │ │ │
  │  │  │  │ ei_block=0 │ │ei_block=50 │ │ei_block=100│           │ │ │
  │  │  │  │→ child 0  │ │→ child 1  │ │→ child 2  │            │ │ │
  │  │  │  └───────────┘ └───────────┘ └───────────┘            │ │ │
  │  │  └─────────────────────────────────────────────────────────┘ │ │
  │  │         │                │                │                  │ │
  │  │         ▼                ▼                ▼                  │ │
  │  │  ┌─────────────┐  ┌─────────────┐  ┌─────────────┐          │ │
  │  │  │  叶节点     │  │  叶节点     │  │  叶节点     │          │ │
  │  │  │  extents    │  │  extents    │  │  extents    │          │ │
  │  │  │  0-49       │  │  50-99      │  │  100+       │          │ │
  │  │  └─────────────┘  └─────────────┘  └─────────────┘          │ │
  │  └───────────────────────────────────────────────────────────────┘ │
  └─────────────────────────────────────────────────────────────────────┘
```

### 内联 Extent

前 4 个 extent 内联存储在 inode 的 `i_data[15]` 数组中。这意味着 ≤ 4 个 extent 的文件（≤ 512 MB 连续数据）没有单独的 extent 树 — 所有元数据都在 inode 本身中。

---

## `ext4_map_blocks()`：查找物理块

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

    // 首先检查内联 extent（inode 中前 4 个）
    if (ei->i_depth == 0) {
        ex = ei->i_extents;
        for (int i = 0; i < ei->i_extents_count; i++) {
            if (map->m_lblk >= ex[i].ee_block &&
                map->m_lblk < ex[i].ee_block + ex[i].ee_len) {
                // 在内联 extent 中找到！
                map->m_pblk = ext4_ext_pblock(&ex[i]) +
                              (map->m_lblk - ex[i].ee_block);
                return ex[i].ee_len;
            }
        }
    }

    // 搜索 extent 树
    eh = ext4_ext_get_header(inode);
    depth = ext4_ext_get_depth(eh);

    // 从根到叶遍历树
    ex = ext4_ext_find_extent(inode, map->m_lblk, &path);
    if (IS_ERR(ex))
        return PTR_ERR(ex);

    // 计算物理块
    map->m_pblk = ext4_ext_pblock(ex) + (map->m_lblk - ex->ee_block);
    map->m_len = ex->ee_len - (map->m_lblk - ex->ee_block);

    return map->m_len;
}
```

---

## 延迟分配

ext4 将物理块分配推迟到回写时间：

```c
// fs/ext4/inode.c — ext4_da_write_begin()
static int ext4_da_write_begin(struct file *file, struct address_space *mapping,
                               loff_t pos, unsigned len, struct page **pagep,
                               void **fsdata)
{
    struct inode *inode = mapping->host;
    struct ext4_map_blocks map;

    // 尚不分配物理块！
    // 只在日志中预留空间
    map.m_lblk = pos >> inode->i_blkbits;
    map.m_len = len >> inode->i_blkbits;

    // 预留（但不分配）块
    ret = ext4_da_reserve_space(inode, map.m_len);

    // 实际分配在回写时发生
    return ret;
}
```

### 为什么延迟？

1. **更好的连续性**：内核可以看到所有待处理写入并分配连续块
2. **减少碎片**：批量分配产生更大的 extent
3. **更少的日志事务**：元数据变化被批量处理

---

## 深度细节：`address_space_operations` 选择

ext4 根据挂载选项选择不同的 `address_space_operations`：

```c
// fs/ext4/inode.c — ext4_set_aops()
static void ext4_set_aops(struct inode *inode)
{
    struct ext4_sb_info *sbi = EXT4_SB(inode->i_sb);

    // 默认：ordered/writeback 数据模式
    inode->i_mapping->a_ops = &ext4_aops;

    // 完整数据日志（data=journal 挂载选项）
    if (test_opt(inode->i_sb, JOURNAL_DATA))
        inode->i_mapping->a_ops = &ext4_journalled_aops;

    // 延迟分配（writeback/ordered 默认）
    if (test_opt(inode->i_sb, DELALLOC))
        inode->i_mapping->a_ops = &ext4_da_aops;

    // 直接访问（DAX，用于持久内存）
    if (IS_DAX(inode))
        inode->i_mapping->a_ops = &ext4_dax_aops;
}
```

每个 `a_ops` 变体实现针对特定数据模式优化的不同 `read_folio()`、`writepage()` 和 `write_begin()` 函数。

---

## 如何观测 ext4 行为

### 使用 bpftrace

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

### 使用 /proc 和 /sys

```bash
// ext4 文件系统信息
dumpe2fs /dev/sda1 | head -30

// 每 inode extent 信息
debugfs -R "stat <inode>" /dev/sda1

// ext4 挂载选项
mount | grep ext4

// ext4 统计
cat /proc/fs/ext4/*/es_stats
```

---

## 常见问题

### ext4 的最大文件大小是多少？
4KB 块和 48 位块寻址下：1 EB（艾字节）。1KB 块下：16 TB。

### ext4 和 ext3 有什么区别？
ext4 增加了 extent（替代间接块）、延迟分配、更大文件/卷大小和日志校验和。ext3 使用经典间接块方案。

### 什么是延迟分配？
ext4 将物理块分配推迟到回写时间。这改善了连续性并减少了碎片，但增加了断电时数据丢失的风险。

### 什么是 DAX？
直接访问（DAX）绕过页缓存用于持久内存（NVM）。数据直接从存储设备访问而不拷贝到 RAM。

### 如何检查文件中的 extent 数量？
使用 `filefrag -v /path/to/file` 或 `debugfs -R "stat <inode>" /dev/sda1`。

---

## 总结

ext4 的 extent 树是对经典 UNIX 间接块方案的根本改进。通过映射连续块范围而非单个块，ext4 将元数据开销降低了几个数量级，并能高效处理 TB 级文件。

实际要点是：extent 存储范围（非单个块），前 4 个 extent 内联在 inode 中，延迟分配改善连续性，extent 树在 inode 外部增长用于大文件。

---

## 来源

- Linux 内核源码, `fs/ext4/ext4.h`, `ext4_extent` 和 `ext4_extent_idx`
- Linux 内核源码, `fs/ext4/inode.c`, `ext4_map_blocks()`
- Linux 内核源码, `fs/ext4/extents.c`, `ext4_ext_find_extent()`
- Linux 内核源码, `fs/ext4/inode.c`, `ext4_da_write_begin()`
- Linux 内核源码, `fs/ext4/ext4.h`, `ext4_inode_info`
