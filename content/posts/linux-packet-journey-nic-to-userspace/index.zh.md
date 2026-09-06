---
title: "一个数据包的自驾游——从网卡到用户态的完整旅程"
description: "数据包从网卡到用户态经过 NAPI poll、IP 层、TCP 层、socket 缓冲区，最终 recvmsg()。源码分析揭示旅程的每一步。"
coverImage: "/posts/linux-packet-journey-nic-to-userspace/images/cover.jpg"
coverImageAlt: "一个球，代表网络数据包从网卡通过 Linux 内核到用户态的完整旅程"
ogImage: "/posts/linux-packet-journey-nic-to-userspace/images/cover.jpg"
date: "2026-09-06 10:00:00"
lastUpdated: "2026-09-06 10:00:00"
author: "FindNS94"
tags: ["Kernel", "Linux"]
---

![一个球，代表网络数据包从网卡通过 Linux 内核到用户态的完整旅程](/posts/linux-packet-journey-nic-to-userspace/images/cover.jpg)

# 一个数据包的自驾游——从网卡到用户态的完整旅程

每个网络程序员都调用过 `recvmsg()` 来接收数据。但从数据包到达 NIC 到它出现在应用缓冲区之间发生了什么？旅程涉及至少六个不同阶段：NAPI 轮询、IP 路由、TCP 处理、socket 缓冲区排队、唤醒通知，最终数据拷贝到用户态。

本文追踪单个数据包从网络接口卡（NIC）通过网络栈到应用接收缓冲区的旅程。读完后，你将理解为什么网络性能不仅仅取决于带宽，内核如何避免负载下的丢包，以及为什么 `recvmsg()` 可以立即返回或永远阻塞。

<!-- [UNIQUE INSIGHT] 关于数据包处理最反直觉的事实是内核不使用中断进行高速数据包接收。相反，它使用 NAPI（New API）轮询：第一个数据包触发中断，中断禁用进一步中断并启动轮询循环。这避免了重负载下的中断风暴并允许内核在每个轮询周期处理多个数据包，分摊上下文切换成本。 -->

<!-- more -->

> **核心要点**
> - NAPI 轮询替代中断进行高速数据包接收
> - 数据包旅程：NIC → 驱动 → NAPI poll → IP 层 → TCP 层 → socket 缓冲区 → 用户态
> - `sk_buff` 是通用数据包容器 — 头部通过指针算术添加/移除
> - Netfilter 在 5 个点挂钩：PRE_ROUTING, LOCAL_IN, FORWARD, LOCAL_OUT, POST_ROUTING
> - Header prediction 为已建立连接启用 10 指令 TCP 快速路径

---

## 旅程概览

```
  数据包到达 NIC
       │
       ▼
  ┌─────────────────────────────────────────────────────────────────────┐
  │ 第 1 阶段：NIC + 驱动                                               │
  │ • NIC 将数据包写入 DMA 缓冲区                                        │
  │ • 触发 MSI-X 中断                                                   │
  │ • IRQ 处理程序调用 napi_schedule()                                  │
  └─────────────────────────────────────────────────────────────────────┘
       │
       ▼
  ┌─────────────────────────────────────────────────────────────────────┐
  │ 第 2 阶段：NAPI Poll                                                │
  │ • 触发 Softirq NET_RX_SOFTIRQ                                       │
  │ • 驱动 poll() 处理 RX 环中的数据包                                  │
  │ • 为每个数据包构建 sk_buff                                          │
  │ • 调用 netif_receive_skb()                                          │
  └─────────────────────────────────────────────────────────────────────┘
       │
       ▼
  ┌─────────────────────────────────────────────────────────────────────┐
  │ 第 3 阶段：IP 层                                                    │
  │ • ip_rcv()：验证头部，检查校验和                                    │
  │ • Netfilter NF_INET_PRE_ROUTING hook                                │
  │ • ip_route_input()：路由决策                                        │
  │ • ip_local_deliver()：交付给本地协议                                │
  │ • Netfilter NF_INET_LOCAL_IN hook                                   │
  └─────────────────────────────────────────────────────────────────────┘
       │
       ▼
  ┌─────────────────────────────────────────────────────────────────────┐
  │ 第 4 阶段：TCP 层                                                   │
  │ • tcp_v4_rcv()：查找 socket（4 元组哈希查找）                       │
  │ • tcp_rcv_established()：数据快速路径                               │
  │ • Header prediction：10 指令快速路径                                 │
  │ • tcp_data_queue()：有序/乱序重组                                   │
  └─────────────────────────────────────────────────────────────────────┘
       │
       ▼
  ┌─────────────────────────────────────────────────────────────────────┐
  │ 第 5 阶段：Socket 缓冲区                                            │
  │ • sk_data_ready()：唤醒阻塞进程                                     │
  │ • 数据存放在 sk_receive_queue                                       │
  │ • recvmsg()：拷贝到用户态                                           │
  └─────────────────────────────────────────────────────────────────────┘
```

---

## 第 1 阶段：NIC + 驱动

当数据包到达 NIC 时：

1. **DMA 传输**：NIC 将数据包数据写入预分配的 DMA 缓冲区（通过 PCIe）
2. **描述符更新**：NIC 更新 RX 环描述符以标记缓冲区为已填充
3. **中断**：NIC 触发 MSI-X 中断

```c
// 驱动 IRQ 处理程序（如 igb_msix_ring()）
static irqreturn_t igb_msix_ring(int irq, void *data)
{
    struct_q_vector *q_vector = data;

    // 禁用此 RX 队列的进一步中断
    writel(0, q_vector->itr_register);

    // 调度 NAPI poll
    napi_schedule(&q_vector->napi);

    return IRQ_HANDLED;
}
```

### 为什么禁用中断？

在重负载下（100 万数据包/秒），每包中断将消耗 30% 以上的 CPU。NAPI 禁用中断并改为轮询 — 驱动每个中断处理多个数据包。

---

## 第 2 阶段：NAPI Poll

NAPI 轮询循环作为 softirq（`NET_RX_SOFTIRQ`）运行：

```c
// net/core/dev.c — net_rx_action()
static void net_rx_action(struct softirq_action *h)
{
    struct list_head *list = &__get_cpu_var(softnet_data).poll_list;
    unsigned long time_limit = jiffies + 2;
    int budget = netdev_budget;  // 默认：每轮询 32 个数据包

    // 处理所有 NAPI 设备
    while (!list_empty(list)) {
        struct napi_struct *n;
        int work, weight;

        n = list_first_entry(list, struct napi_struct, poll_list);

        weight = n->weight;  // 默认：64
        work = n->poll(n, budget);  // 驱动 poll 函数

        budget -= work;
        if (work >= weight || budget <= 0)
            break;  // 超过权重或预算
    }
}
```

### 构建 `sk_buff`

```c
// net/core/dev.c — netif_receive_skb()
int netif_receive_skb(struct sk_buff *skb)
{
    // 交付给协议处理程序
    return __netif_receive_skb(skb);
}
```

`sk_buff`（socket buffer）是通用数据包容器：

```c
// include/linux/skbuff.h（简化）
struct sk_buff {
    struct sk_buff *next, *prev;    // 链表
    struct net_device *dev;         // 入/出设备
    struct sock *sk;                // 所属 socket
    ktime_t tstamp;                 // 到达时间戳
    char cb[48];                    // 控制缓冲区（TCP/IP 私有）
    unsigned int len, data_len;     // 总长度 vs 有效载荷长度

    // 协议头部（每层设置）
    union {
        struct tcphdr *th;
        struct udphdr *uh;
        struct icmphdr *ich;
        struct igmphdr *iph;
        struct iphdr *ipiph;
        struct ipv6hdr *ipv6h;
        unsigned char *raw;
    } h;

    unsigned char *head, *data, *tail, *end;
    // ↑ 缓冲区边界指针
};
```

### 头部指针魔法

头部通过向后移动指针添加：

```
  驱动之后：     [eth][    payload    ]
                 ↑data

  IP 之后：      [eth][ip][  payload  ]
                      ↑data

  TCP 之后：     [eth][ip][tcp][payload]
                           ↑data
```

没有数据被拷贝 — 只调整指针。

---

## 第 3 阶段：IP 层

```c
// net/ipv4/ip_input.c — ip_rcv()
int ip_rcv(struct sk_buff *skb, struct net_device *dev,
           struct packet_type *pt, struct net_device *orig_dev)
{
    struct iphdr *iph;
    u32 len;

    // 验证头部
    if (skb->len < sizeof(struct iphdr) || iph->version != 4)
        goto drop;

    // 检查头部校验和
    if (ip_fast_csum((u8 *)iph, iph->ihl))
        goto drop;

    // Netfilter PRE_ROUTING hook
    NF_HOOK(NF_INET_PRE_ROUTING, skb, dev, NULL, ip_rcv_finish);

    return 0;

drop:
    kfree_skb(skb);
    return NET_RX_DROP;
}
```

---

## 第 4 阶段：TCP 层

### Socket 查找

```c
// net/ipv4/tcp_ipv4.c — tcp_v4_rcv()
int tcp_v4_rcv(struct sk_buff *skb)
{
    struct sock *sk;

    // 通过 4 元组（src_ip, src_port, dst_ip, dst_port）查找 socket
    sk = __inet_lookup_skb(&tcp_hashinfo, skb,
                           th->source, th->dest);
    if (!sk)
        goto no_tcp_socket;

    // 基于连接状态处理
    switch (sk->sk_state) {
    case TCP_TIME_WAIT:
        goto do_time_wait;
    case TCP_NEW_SYN_RECV:
        goto process;
    case TCP_LISTEN:
        // 处理 SYN, ACK 等
        break;
    default:
        // 已建立连接 — 快速路径
        tcp_v4_do_rcv(sk, skb);
    }
}
```

### Header Prediction：快速路径

```c
// net/ipv4/tcp_input.c — tcp_rcv_established()
static inline void tcp_rcv_established(struct sock *sk, struct sk_buff *skb)
{
    struct tcp_sock *tp = tcp_sk(sk);

    // Header prediction：比较预期标志 + 窗口
    if ((tcp_flag_word(th) & htonl(0x00FF0000)) == tp->pred_flags &&
        TCP_SKB_CB(skb)->seq == tp->rcv_nxt) {
        // 快速路径：~10 指令！
        tp->rcv_nxt += TCP_SKB_CB(skb)->end_seq - TCP_SKB_CB(skb)->seq;
        tcp_ack(sk, skb, FLAG_DATA);
        __kfree_skb(skb);
        tcp_data_ready(sk);  // 唤醒用户态
        return;
    }

    // 慢路径：乱序、窗口变化等
    tcp_data_queue(sk, skb);
}
```

`pred_flags` 字段将预期 TCP 标志 + 窗口打包到单次 32 位比较中。如果传入数据包匹配，整个接收处理约 10 指令。

---

## 第 5 阶段：Socket 缓冲区

```c
// net/ipv4/tcp_input.c — tcp_data_ready()
static void tcp_data_ready(struct sock *sk)
{
    // 唤醒阻塞在 recvmsg()/select()/epoll 中的进程
    sk->sk_data_ready(sk);
}
```

当调用 `recvmsg()` 时：

```c
// net/ipv4/tcp.c — tcp_recvmsg()
int tcp_recvmsg(struct sock *sk, struct msghdr *msg, size_t len, int flags,
                int *addr_len)
{
    struct tcp_sock *tp = tcp_sk(sk);
    struct sk_buff *skb;
    u32 offset;
    int copied;

    // 等待数据（如果阻塞）
    skb_queue_walk(&sk->sk_receive_queue, skb) {
        // 从 sk_buff 拷贝数据到用户态
        copied = skb_copy_datagram_msg(skb, offset, msg, len);

        // 更新位置
        offset += copied;
        len -= copied;

        if (len == 0)
            break;
    }

    return copied;
}
```

---

## 深度细节：`skb_shared_info`

```c
// include/linux/skbuff.h
struct skb_shared_info {
    __u8        nr_frags;           // 分片数量
    __u8        tx_flags;           // TX 标志
    unsigned short gso_size;        // GSO 段大小
    unsigned short gso_segs;        // GSO 段数
    unsigned short gso_type;        // GSO 类型
    struct sk_buff *frag_list;      // 分片链表
    struct skb_shared_info *next;   // 下一个共享信息
    unsigned int hdr_len;           // 头部长度
    unsigned int frags[MAX_SKB_FRAGS];  // 页分片
};
```

对于大数据包，数据存储在页分片而非线性缓冲区中。`skb_shared_info` 跟踪这些分片。

---

## 如何观测数据包处理

### 使用 bpftrace

```bash
#!/usr/bin/env bpftrace
// trace_packet.bt

kprobe:netif_receive_skb
{
    @rx[comm] = count();
}

kprobe:tcp_v4_rcv
{
    @tcp_rx[comm] = count();
}

kprobe:tcp_rcv_established
{
    @tcp_established[comm] = count();
}

END
{
    printf("\nRX packets:\n");
    print(@rx);
    printf("\nTCP established path:\n");
    print(@tcp_established);
}
```

### 使用 /proc

```bash
// 网络统计
cat /proc/net/snmp
cat /proc/net/netstat

// 每 socket 队列
cat /proc/net/tcp

// Softnet 统计
cat /proc/net/softnet_stat
```

---

## 常见问题

### 为什么内核使用 NAPI 而不是中断？
在重负载下，每包中断消耗 30% 以上 CPU。NAPI 禁用中断并轮询，每个周期处理多个数据包。这分摊了上下文切换成本。

### 什么是 `sk_buff`？
通用数据包容器。它保存数据包数据和协议头部。头部通过调整指针添加/移除，不通过拷贝数据。

### 什么是 header prediction？
TCP 已建立连接的快速路径。内核在单次 32 位比较中比较预期标志 + 窗口。如果匹配，整个接收处理约 10 指令。

### Socket 缓冲区满时会发生什么？
内核丢弃传入数据包（如果缓冲区已满）。TCP 流量控制通过在应用缓慢时减少通告窗口来防止这种情况。

### 零拷贝如何工作？
`splice()` 和 `sendfile()` 避免内核和用户态之间的数据拷贝。数据直接从文件页缓存移动到 socket 缓冲区（或反之）而无需 CPU 拷贝。

---

## 总结

数据包从 NIC 到用户态的旅程涉及 NAPI 轮询、IP 路由、TCP 处理、socket 缓冲和数据拷贝。内核优化每个阶段：NAPI 避免中断风暴，header prediction 启用 10 指令 TCP 快速路径，`sk_buff` 指针算术避免数据拷贝。

对于生产系统，实际要点是：NAPI 扩展到 100 万+ 数据包/秒，header prediction 使 TCP 对已建立连接快速，理解旅程有助于诊断网络性能问题。

---

## 来源

- Linux 内核源码, `net/core/dev.c`, `net_rx_action()`
- Linux 内核源码, `net/ipv4/ip_input.c`, `ip_rcv()`
- Linux 内核源码, `net/ipv4/tcp_input.c`, `tcp_rcv_established()`
- Linux 内核源码, `net/ipv4/tcp_ipv4.c`, `tcp_v4_rcv()`
- Linux 内核源码, `include/linux/skbuff.h`, `struct sk_buff`
