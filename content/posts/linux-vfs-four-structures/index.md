---
title: "What Are inode, dentry, file, and super_block? — The Four Guardians of VFS"
description: "VFS has four core structures that work together: inode (identity), dentry (name cache), file (open context), super_block (filesystem instance). Source analysis reveals their hidden relationships."
coverImage: "/posts/linux-vfs-four-structures/images/cover.jpg"
coverImageAlt: "A memory chip representing the four core VFS structures: inode, dentry, file, and super_block that form the Linux virtual filesystem layer"
ogImage: "/posts/linux-vfs-four-structures/images/cover.jpg"
date: "2026-09-06 08:00:00"
lastUpdated: "2026-09-06 08:00:00"
author: "FindNS94"
tags: ["Linux", "Kernel", "FileSystem"]
---

![A memory chip representing the four core VFS structures: inode, dentry, file, and super_block that form the Linux virtual filesystem layer](/posts/linux-vfs-four-structures/images/cover.jpg)

# What Are inode, dentry, file, and super_block? — The Four Guardians of VFS

Every Linux developer knows that "everything is a file." But what exactly IS a file in the kernel? The answer involves four distinct data structures that work together: `struct inode` (the file's identity), `struct dentry` (its name in a directory), `struct file` (an open file context), and `struct super_block` (the filesystem instance). These four structures form the core of the Virtual File System (VFS) layer, and understanding their relationships is essential for understanding how Linux filesystems work.

This article walks through the source in `include/linux/fs.h` to explain each structure, how they reference each other, and why the kernel needs four separate structures instead of one.

<!-- [UNIQUE INSIGHT] The most counterintuitive fact about VFS is that a single file can have multiple names (hard links), multiple open contexts (multiple fd from repeated open()), and even exist in multiple filesystems simultaneously (bind mounts). The four VFS structures are designed precisely to handle these many-to-many relationships: one inode → multiple dentries, one dentry → multiple files, one super_block → multiple inodes. -->

<!-- more -->

> **Key Takeaways**
> - inode = file identity (metadata, permissions, size) — one per file on disk
> - dentry = directory entry (name → inode mapping) — cached in dcache hash table
> - file = open file context (position, flags, operations) — one per open() call
> - super_block = filesystem instance — one per mounted filesystem
> - One inode can have multiple dentries (hard links), one dentry can have multiple files (repeated open)
> - `container_of` macro enables OOP-style inheritance in C

---

## The Myth: "A File is Just an inode"

Many developers equate "file" with "inode." While the inode contains the file's metadata, it's only one piece of the puzzle. Consider what happens when you:

1. Create a hard link: `ln file.txt link.txt` — two names, one inode
2. Open a file twice: `fd1 = open("file.txt"); fd2 = open("file.txt")` — two file contexts, one inode
3. Bind mount: `mount --bind /a /b` — same inode accessible from two paths

A single structure cannot represent all these relationships. That's why VFS has four.

---

## inode: The File's Identity

The inode represents a file's persistent identity — everything that survives after all file descriptors are closed:

```c
// include/linux/fs.h
struct inode {
    umode_t          i_mode;       // File type & permissions (rwxrwxrwx)
    kuid_t           i_uid;        // Owner UID
    kgid_t           i_gid;        // Owner GID
    const struct inode_operations *i_op;   // Inode operations (create, mkdir, lookup)
    struct super_block *i_sb;      // Owning superblock
    struct address_space *i_mapping; // Page cache mapping
    u64              i_ino;        // Inode number (unique within filesystem)
    loff_t           i_size;       // File size in bytes
    struct timespec64 i_atime;     // Access time
    struct timespec64 i_mtime;     // Modification time
    struct timespec64 i_ctime;     // Change time
    struct hlist_node i_hash;      // Inode hash table node
    struct list_head i_lru;        // Inode LRU list
    struct address_space i_data;   // Embedded page cache
    union {
        struct pipe_inode_info *i_pipe;  // Pipe-specific data
        struct cdev *i_cdev;             // Character device
        char *i_link;                    // Symlink target
    };
    void *i_private;               // Filesystem-specific data (e.g., ext4_inode_info)
};
```

### Key Fields

- **`i_mode`**: File type (regular, directory, symlink, device) and permissions
- **`i_size`**: File size — updated on write, read on lseek(SEEK_END)
- **`i_ino`**: Inode number — unique within a filesystem (but not across filesystems)
- **`i_mapping`**: Points to the page cache (address_space) for this file
- **`i_op`**: Function table for inode operations (create, mkdir, unlink, lookup)
- **`i_fop`**: Function table for file operations (read, write, mmap, fsync)

### The Union Trick

The `union` at the end of `struct inode` shares memory between mutually exclusive uses:
- A pipe inode uses `i_pipe`
- A character device uses `i_cdev`
- A symlink uses `i_link`

This saves memory because a file can only be one type at a time.

---

## dentry: The Name Cache

A dentry (directory entry) represents a name in a directory. It's the kernel's cache of "name → inode" mappings:

```c
// include/linux/dcache.h
struct dentry {
    unsigned int d_flags;
    seqcount_spinlock_t d_seq;     // Per-dentry seqcount for RCU walking
    struct hlist_bl_node d_hash;   // Lookup hash list
    struct dentry *d_parent;       // Parent directory
    const struct qstr d_name;      // Component name
    struct inode *d_inode;         // Associated inode (NULL = negative)
    const struct dentry_operations *d_op;
    struct super_block *d_sb;      // Root dentry of filesystem
    struct lockref d_lockref;      // Per-dentry lock + refcount
    struct list_head d_lru;        // LRU list
    struct hlist_node d_sib;       // Child of parent list
    struct hlist_head d_children;  // Our children
    union {
        struct hlist_node d_alias;     // Inode alias list
        struct hlist_bl_node d_in_lookup_hash;  // In-lookup negatives
        struct rcu_head d_rcu;
    };
};
```

### Key Fields

- **`d_name`**: The component name (e.g., "file.txt" in "/home/user/file.txt")
- **`d_inode`**: The associated inode (NULL for negative dentries — "file not found")
- **`d_parent`**: Parent directory dentry
- **`d_children`**: Child dentries (for directories)
- **`d_alias`**: Links all dentries pointing to the same inode (hard links)
- **`d_lockref`**: Combined lock + refcount for fast `try_get` paths

### Negative Dentries

When a file doesn't exist, the kernel caches this fact as a "negative dentry" (`d_inode == NULL`). This prevents repeated disk I/O for non-existent files.

---

## file: The Open Context

A `struct file` represents an open file context — everything that's specific to a particular `open()` call:

```c
// include/linux/fs.h
struct file {
    spinlock_t f_lock;
    fmode_t f_mode;                // FMODE_READ/WRITE/EXEC/CAN_READ/CAN_WRITE/...
    const struct file_operations *f_op;  // File operations (read, write, mmap)
    struct address_space *f_mapping;     // Page cache mapping
    void *private_data;            // Filesystem-specific (e.g., file->private_data for pipes)
    struct inode *f_inode;         // Associated inode
    unsigned int f_flags;          // O_NONBLOCK, O_APPEND, O_DIRECT, etc.
    loff_t f_pos;                  // File offset (current read/write position)
    struct path f_path;            // (dentry, vfsmount) pair
    file_ref_t f_ref;              // Reference count
    struct file_ra_state f_ra;     // Readahead state
};
```

### Key Fields

- **`f_pos`**: Current file offset — advanced by read/write operations
- **`f_flags`**: Open flags (O_NONBLOCK, O_APPEND, O_DIRECT, O_SYNC)
- **`f_mode`**: Access mode (read, write, exec) — checked at open time
- **`f_op`**: Function table for file operations (read, write, mmap, fsync, poll)
- **`f_ref`**: Reference count — file stays open until all fds are closed
- **`f_ra`**: Readahead state — tracks sequential access patterns

### Why Separate from inode?

Multiple `open()` calls create multiple `struct file` instances, each with its own `f_pos` and `f_flags`. This is why two processes can read the same file at different positions simultaneously.

---

## super_block: The Filesystem Instance

A super_block represents a mounted filesystem instance:

```c
// include/linux/fs.h
struct super_block {
    struct list_head s_list;       // All superblocks list
    dev_t s_dev;                   // Device identifier
    unsigned char s_blocksize_bits;// Block size as power of 2
    loff_t s_maxbytes;             // Maximum file size
    struct file_system_type *s_type; // Filesystem type (ext4, xfs, etc.)
    const struct super_operations *s_op;  // Superblock operations (write_inode, put_super)
    unsigned long s_flags;         // SB_RDONLY, SB_SYNCHRONOUS, etc.
    unsigned long s_magic;         // Magic number (EXT4_SUPER_MAGIC = 0xEF53)
    struct dentry *s_root;         // Root dentry of filesystem
    struct rw_semaphore s_umount;  // Unmount semaphore
    atomic_t s_active;             // Active reference count
    void *s_fs_info;               // Filesystem-specific data (ext4_sb_info, etc.)
    struct list_lru s_dentry_lru;  // Dentry LRU for this sb
    struct list_lru s_inode_lru;   // Inode LRU for this sb
    struct list_head s_inodes;     // All inodes
    struct shrinker *s_shrink;     // Per-sb shrinker
};
```

### Key Fields

- **`s_type`**: Filesystem type (ext4, xfs, btrfs, etc.)
- **`s_root`**: Root dentry of the mounted filesystem
- **`s_op`**: Superblock operations (write_inode, put_super, sync_fs)
- **`s_fs_info`**: Filesystem-specific data (e.g., ext4_sb_info for ext4)
- **`s_dentry_lru`** / **`s_inode_lru`**: LRU lists for shrinking cached dentries/inodes

---

## The Relationship Network

```
  ┌─────────────────────────────────────────────────────────────────────┐
  │                         super_block                                 │
  │                         (filesystem)                                │
  │                                                                     │
  │  ┌───────────────────────────────────────────────────────────────┐ │
  │  │                        inode (file identity)                   │ │
  │  │                        (one per file on disk)                 │ │
  │  │                                                               │ │
  │  │  ┌─────────────────────────────────────────────────────────┐ │ │
  │  │  │              dentry (name → inode mapping)              │ │ │
  │  │  │              (one per name, cached in dcache)           │ │ │
  │  │  │                                                         │ │ │
  │  │  │  ┌───────────────────────────────────────────────────┐ │ │ │
  │  │  │  │          file (open file context)                 │ │ │ │
  │  │  │  │          (one per open() call)                   │ │ │ │
  │  │  │  └───────────────────────────────────────────────────┘ │ │ │
  │  │  │  ┌───────────────────────────────────────────────────┐ │ │ │
  │  │  │  │          file (another open context)              │ │ │ │
  │  │  │  │          (different fd, different f_pos)         │ │ │ │
  │  │  │  └───────────────────────────────────────────────────┘ │ │ │
  │  │  └─────────────────────────────────────────────────────────┘ │ │
  │  │  ┌─────────────────────────────────────────────────────────┐ │ │
  │  │  │              dentry (hard link name)                    │ │ │
  │  │  │              (different name, same inode)               │ │ │
  │  │  └─────────────────────────────────────────────────────────┘ │ │
  │  └───────────────────────────────────────────────────────────────┘ │
  │  ┌───────────────────────────────────────────────────────────────┐ │
  │  │                        inode (another file)                   │ │
  │  └───────────────────────────────────────────────────────────────┘ │
  └─────────────────────────────────────────────────────────────────────┘
```

### Many-to-Many Relationships

- **One inode → multiple dentries**: Hard links (`ln file.txt link.txt`)
- **One dentry → multiple files**: Repeated `open()` calls
- **One super_block → multiple inodes**: All files in a filesystem
- **One inode → one super_block**: An inode belongs to exactly one filesystem

---

## Deep Detail: `container_of` Inheritance

Linux uses the `container_of` macro to implement OOP-style inheritance in C:

```c
// include/linux/container_of.h
#define container_of(ptr, type, member) \
    ((type *)((char *)(ptr) - offsetof(type, member)))
```

### Examples

```c
// From struct sock to struct tcp_sock
static inline struct tcp_sock *tcp_sk(const struct sock *sk)
{
    return container_of(sk, struct tcp_sock, inet_conn);
}

// From struct sock to struct unix_sock
static inline struct unix_sock *unix_sk(const struct sock *sk)
{
    return container_of(sk, struct unix_sock, sk);
}

// From struct inode to struct mqueue_inode_info
static inline struct mqueue_inode_info *MQUEUE_I(struct inode *inode)
{
    return container_of(inode, struct mqueue_inode_info, vfs_inode);
}
```

This pattern allows the kernel to embed a generic structure (like `struct sock`) inside a specific structure (like `tcp_sock`), and recover the specific structure from a pointer to the generic one.

---

## How to Observe VFS Structures

### Using bpftrace

```bash
#!/usr/bin/env bpftrace
// trace_vfs.bt

kprobe:d_alloc
{
    @dentry_alloc[comm] = count();
}

kprobe:d_lookup
{
    @dentry_lookup[comm] = count();
}

kprobe:alloc_inode
{
    @inode_alloc[comm] = count();
}

kprobe:open_exec
{
    @exec[comm] = count();
}
```

### Using /proc and /sys

```bash
// Dcache statistics
cat /proc/sys/fs/dentry-state

// Inode cache statistics
cat /proc/sys/fs/inode-nr

// Filesystem information
cat /proc/mounts
cat /proc/self/mountinfo

// Per-process open files
ls -la /proc/<pid>/fd/
```

### Using debugfs

```bash
// Ext4 inode info (if debugfs mounted)
cat /sys/kernel/debug/ext4/<partition>/inode_cache
```

---

## Frequently Asked Questions

### What is the difference between a hard link and a symlink?
A hard link is a second dentry pointing to the same inode. A symlink is a special file containing a path string. Hard links share the same inode (same permissions, size, data); symlinks have their own inode.

### Why does `rm` not free disk space immediately?
`rm` only removes the dentry (name → inode mapping). The inode and its data are freed only when the link count reaches zero AND no file descriptors reference it.

### What happens when a file is deleted while open?
The dentry is removed (the name disappears), but the inode persists until all file descriptors are closed. The process can still read/write via its open fd.

### How does `dup()` work?
`dup()` creates a new file descriptor that points to the same `struct file`. Both fds share the same file offset and flags.

### What is the difference between `O_RDONLY` and `FMODE_READ`?
`O_RDONLY` is a user-space flag passed to `open()`. `FMODE_READ` is the kernel-internal representation stored in `file->f_mode`.

---

## Conclusion

The four VFS structures — inode, dentry, file, and super_block — work together to represent files in Linux. The inode is the file's identity, the dentry is its name in a directory, the file is an open context, and the super_block is the filesystem instance. Their many-to-many relationships (hard links, repeated opens, bind mounts) are what make Linux's filesystem layer flexible and powerful.

Understanding these structures is essential for filesystem development, performance tuning, and debugging. The practical takeaways are: hard links share inodes, repeated opens create separate file contexts, and the `container_of` macro enables the OOP-style inheritance that makes the VFS layer possible.

---

## Sources

- Linux kernel source, `include/linux/fs.h`, `struct inode`
- Linux kernel source, `include/linux/dcache.h`, `struct dentry`
- Linux kernel source, `include/linux/fs.h`, `struct file`
- Linux kernel source, `include/linux/fs.h`, `struct super_block`
- Linux kernel source, `include/linux/container_of.h`
