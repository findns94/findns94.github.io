---
title: "消息队列的隐藏优化——MSG_BARRIER 的无锁快速路径"
description: "System V 消息队列不是慢速旧技术。内核使用 READ_ONCE(r_msg) 进行无锁接收，MSG_BARRIER 避免获取队列锁。源码分析揭示优化。"
coverImage: "/posts/linux-message-queue-optimization/images/cover.jpg"
coverImageAlt: "一个存储芯片，代表 System V 消息队列中使用 MSG_BARRIER 和 READ_ONCE 的无锁快速路径优化"
ogImage: "/posts/linux-message-queue-optimization/images/cover.jpg"
date: "2026-09-06 16:00:00"
lastUpdated: "2026-09-06 16:00:00"
author: "FindNS94"
tags: ["Kernel", "Linux"]
---

![一个存储芯片，代表 System V 消息队列中使用 MSG_BARRIER 和 READ_ONCE 的无锁快速路径优化](/posts/linux-message-queue-optimization/images/cover.jpg)

# 消息队列的隐藏优化——MSG_BARRIER 的无锁快速路径

System V 消息队列常被视为"旧技术" — 慢速、过时，被 POSIX 消息队列或 Unix domain socket 替代。但这种名声是现代 Linux 内核优化了消息队列，具有无锁接收路径、原子操作和巧妙的内存排序，使它们出奇地快。

关键优化：`pipelined_send()` 使用 `smp_store_release()` 发布消息，接收方使用 `READ_ONCE()` 检查消息是否到达 — 完全不获取队列锁。仅当消息尚未到达时，内核才回退到慢路径（在等待队列上睡眠）。

本文通过 `ipc/msg.c` 中的消息队列源码来解释无锁快速路径、`MSG_BARRIER` 标志和信号量 undo 机制。

<!-- [UNIQUE INSIGHT] 关于 System V 消息队列最反直觉的事实是常见情况（消息已到达）完全不需要锁。接收方用 `READ_ONCE()` 检查 `msg_receiver->r_msg` — 单条原子加载指令。如果消息在那里，就是无锁快速路径。仅当消息尚未到达时，内核才获取队列锁并睡眠。这就是为什么消息队列在现代硬件上可以达到数百万消息/秒。 -->

<!-- more -->

> **核心要点**
> - 消息队列接收有无锁快速路径，使用 `READ_ONCE(r_msg)`
> - `smp_store_release()` 发布消息，`READ_ONCE()` 读取
> - `MSG_BARRIER`：接收方检查消息是否到达而不获取锁
> - 信号量 undo（`sem_undo`）在进程退出时自动回滚
> - `use_global_lock`：在高竞争时退化为全局锁以防止活锁
> - IPC ID 编码：index + sequence number 在单 int 中防止重用竞争

---

## 误区："消息队列是慢速旧技术"

心智模型：`msgrcv()` 获取队列锁 → 扫描消息列表 → 拷贝数据 → 释放锁。这对常见情况是错误的。

实际发生的是：

```
  msgrcv(qid, &msg, sizeof(msg), type, IPC_NOWAIT)
       │
       ▼
  ┌─────────────────────────────────────────────────────────────────────┐
  │ 快速路径（无锁！）                                                   │
  │ • 用 READ_ONCE() 检查 msg_receiver->r_msg                          │
  │ • 如果 r_msg != NULL：消息已经在那里！                              │
  │ • 拷贝数据，立即返回 — 不获取锁                                      │
  └─────────────────────────────────────────────────────────────────────┘
       │ (如果 r_msg == NULL，消息尚未到达)
       ▼
  ┌─────────────────────────────────────────────────────────────────────┐
  │ 慢路径（加锁）                                                       │
  │ • 获取队列锁（ipc_lock_object()）                                   │
  │ • 扫描消息列表寻找匹配类型                                           │
  │ • 如果找到：拷贝并返回                                               │
  │ • 如果没有：添加到等待者列表，睡眠                                    │
  └─────────────────────────────────────────────────────────────────────┘
```

---

## 无锁快速路径：`pipelined_send()`

### 发布消息

```c
// ipc/msg.c — pipelined_send()
static inline int pipelined_send(struct msqid_ds *msq, struct msg_msg *msg)
{
    struct msg_receiver *r;

    // 找到第一个等待的接收方
    list_for_each_entry(r, &msq->q_receivers, r_list) {
        if (testmsg(r, msg->m_type, mode)) {
            // 用 release 语义发布消息
            // 这是关键：smp_store_release() 确保消息的所有写入
            // 在 r_msg 设置之前都可见
            smp_store_release(&r->r_msg, msg);

            // 唤醒接收方
            wake_up_interruptible(&r->r_wait);
            return 1;
        }
    }
    return 0;  // 无匹配接收方
}
```

### 接收消息

```c
// ipc/msg.c — do_msgrcv()
static long do_msgrcv(int msqid, struct msg_msg *msg, size_t msgsz,
                      long msgtyp, int msgflg, int mode)
{
    struct msg_receiver *r;
    struct msqid_ds *msq;

    // 快速路径：检查消息是否已到达
    r = current->r_msg;
    if (r) {
        // 无锁检查！
        struct msg_msg *msg_ptr = READ_ONCE(r->r_msg);
        if (msg_ptr) {
            // 消息在这里 — 拷贝并返回（无锁！）
            return do_msg_copy(msg_ptr, msg, msgsz, mode);
        }
    }

    // 慢路径：获取锁并扫描
    msq = ipc_lock_check(msqid);
    if (!msq)
        return -EIDRM;

    // 扫描消息列表
    msg = find_msg(msq, msgtyp, mode);
    if (msg) {
        ipc_unlock(msq);
        return do_msg_copy(msg, msg, msgsz, mode);
    }

    // 无消息 — 睡眠
    list_add_tail(&r->r_list, &msq->q_receivers);
    ipc_unlock(msq);

    // 等待消息
    schedule();

    return ret;
}
```

---

## `MSG_BARRIER` 标志

`MSG_BARRIER` 标志允许接收方检查消息是否到达而不获取队列锁：

```c
// ipc/msg.c — testmsg()
static int testmsg(struct msg_receiver *r, long type, int mode)
{
    struct msg_msg *msg = READ_ONCE(r->r_msg);

    if (msg && (msg->m_type == type || type == 0))
        return 1;  // 消息匹配！

    return 0;
}
```

这是单条原子加载指令 — 无锁，无缓存行反弹。

---

## 信号量 Undo 机制

System V 信号量（消息队列内部使用）有崩溃安全 undo 机制：

```c
// ipc/sem.c
struct sem_undo {
    struct list_head list_proc;     // 每进程链表
    struct list_head list_id;       // 每信号量数组链表
    int semid;                      // 信号量数组 ID
    short *semadj;                  // 每信号量调整值
};

// 进程退出时，自动撤销所有信号量操作
void exit_sem(struct task_struct *tsk)
{
    struct sem_undo *undo;

    // 处理所有 undo 条目
    list_for_each_entry(undo, &tsk->sysvsem.undo_list, list_proc) {
        struct sem_array *sma = sem_obtain_object(undo->semid);
        for (int i = 0; i < sma->sem_nsems; i++) {
            // 撤销调整
            sma->sem_base[i].semval += undo->semadj[i];
        }
    }
}
```

这确保如果进程在持有信号量时崩溃，信号量会自动恢复到之前的值。

---

## 深度细节：IPC ID 编码

IPC ID 在单 `int` 中编码 index 和 sequence number：

```c
// ipc/util.h
#define IPC_SEQ_SHIFT 14
#define IPC_SEQ_MASK  ((1 << IPC_SEQ_SHIFT) - 1)

// ID 格式：[sequence (18 bit)][index (14 bit)]
static inline int ipc_buildid(int id, int seq)
{
    return (seq << IPC_SEQ_SHIFT) | (id & IPC_SEQ_MASK);
}
```

这防止 ID 重用竞争：当 IPC 对象被销毁且新对象获得相同 index 时，sequence number 不同，因此通过 `ipc_checkid()` 检测到陈旧引用。

---

## 如何观测消息队列行为

### 使用 ipcs

```bash
// System V 消息队列
ipcs -q

// 每队列详情
cat /proc/sysvipc/msg

// 消息队列限制
cat /proc/sys/kernel/msgmax
cat /proc/sys/kernel/msgmnb
cat /proc/sys/kernel/msgmni
```

---

## 常见问题

### System V 和 POSIX 消息队列有什么区别？
System V 使用 `msgget()`/`msgsnd()`/`msgrcv()`。POSIX 使用 `mq_open()`/`mq_send()`/`mq_receive()`。System V 有无锁快速路径；POSIX 有更简单的 API。

### 什么时候应该使用消息队列 vs 其他 IPC？
当需要类型化消息（同一队列中的不同消息类型）或基于优先级的传递时使用消息队列。对面向流的通信使用 Unix domain socket。

### 什么是 `MSG_NOERROR`？
当接收的消息大于缓冲区时，`MSG_NOERROR` 截断消息而不是返回错误。

### 什么是 `use_global_lock`？
在高竞争时，内核退化为全局锁以防止活锁。这是重负载系统的性能优化。

### 如何移除消息队列？
使用 `msgctl(qid, IPC_RMID, NULL)` 立即移除队列，或在最后一个进程分离时标记为删除。

---

## 总结

System V 消息队列不是慢速旧技术 — 它们有使用 `READ_ONCE()` 和 `smp_store_release()` 的无锁快速路径。常见情况（消息已到达）完全不需要锁。仅当消息尚未到达时，内核才获取队列锁并睡眠。

对于生产系统，实际要点是：消息队列有无锁快速路径，`MSG_BARRIER` 启用无锁检查，信号量 undo 机制确保崩溃安全。

---

## 来源

- Linux 内核源码, `ipc/msg.c`, `pipelined_send()`
- Linux 内核源码, `ipc/msg.c`, `do_msgrcv()`
- Linux 内核源码, `ipc/sem.c`, `exit_sem()`
- Linux 内核源码, `ipc/util.c`, `ipc_buildid()`
- Linux 内核源码, `include/linux/msg.h`
