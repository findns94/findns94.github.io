---
title: "TCP 不是管道——拥塞控制、Nagle 与延迟 ACK 的三国演义"
description: "TCP 远不止 send/接收。发送端做出复杂决策：何时发送、发送多少、如何对拥塞做出反应。源码分析揭示复杂性。"
coverImage: "/posts/linux-tcp-not-pipe/images/cover.jpg"
coverImageAlt: "一个 USB 钥匙，代表 TCP 发送路径中复杂的决策过程，包括拥塞控制、Nagle 和延迟 ACK"
ogImage: "/posts/linux-tcp-not-pipe/images/cover.jpg"
date: "2026-09-06 11:00:00"
lastUpdated: "2026-09-06 11:00:00"
author: "FindNS94"
tags: ["Kernel", "Linux"]
---

![一个 USB 钥匙，代表 TCP 发送路径中复杂的决策过程，包括拥塞控制、Nagle 和延迟 ACK](/posts/linux-tcp-not-pipe/images/cover.jpg)

# TCP 不是管道——拥塞控制、Nagle 与延迟 ACK 的三国演义

每个网络程序员都把 TCP 当作可靠的字节流：`send()` 放入数据，`recv()` 取出数据。但这个心智模型隐藏了内核内部发生的令人难以置信的复杂性。TCP 发送端对每个段做出几十个决策：我现在应该发送还是等待更多数据？网络是否拥塞？我应该重传吗？接收方的窗口是否已满？

这些决策涉及三个相互作用的机制：**拥塞控制**（避免网络过载）、**Nagle 算法**（避免小数据包）和**延迟 ACK**（减少 ACK 流量）。理解这些机制解释了为什么你的 `send()` 调用不会立即导致网络流量，为什么小写入可能很慢，以及为什么 TCP 吞吐量不仅仅取决于带宽。

本文通过 `net/ipv4/tcp.c` 和 `net/ipv4/tcp_output.c` 中的 TCP 发送路径源码来解释内核如何决定何时发送、发送多少以及如何对网络条件做出反应。

<!-- [UNIQUE INSIGHT] 关于 TCP 最反直觉的事实是 `send()` 不意味着"数据已发送"。它意味着"数据已排入内核发送缓冲区。"实际网络传输可能被 Nagle 算法延迟（等待更多数据）、拥塞控制延迟（等待窗口空间）或接收方窗口延迟（等待 ACK）。这就是为什么 `send()` 立即返回但数据可能数毫秒后才到达 —— 以及为什么存在 `TCP_NODELAY`。 -->

<!-- more -->

> **核心要点**
> - `send()` 将数据排入内核缓冲区 — 实际传输被延迟
> - Nagle 算法：如果有未确认数据，不发送小数据包
> - 延迟 ACK：接收方在发送 ACK 前等待最多 40ms
> - 拥塞控制：内核跟踪 cwnd（拥塞窗口）和 ssthresh
> - CUBIC（默认）vs BBR：不同网络条件下的不同算法
> - Header prediction 启用 10 指令接收快速路径

---

## 误区："send() 发送数据"

心智模型：`send(fd, buf, len)` → 内核在网络上发送 `len` 字节 → 返回。这是错误的。

实际发生的是：

```
  send(fd, buf, len)
       │
       ▼
  ┌─────────────────────────────────────────────────────────────────────┐
  │ 第 1 步：拷贝到发送缓冲区                                            │
  │ • 数据从用户态拷贝到 sk_send_head                                    │
  │ • 如果缓冲区有空间则立即返回                                         │
  │ • 尚未进行网络传输！                                                 │
  └─────────────────────────────────────────────────────────────────────┘
       │
       ▼
  ┌─────────────────────────────────────────────────────────────────────┐
  │ 第 2 步：tcp_write_xmit() — 决策引擎                                │
  │ • Nagle 测试：我应该等待更多数据吗？                                 │
  │ • 窗口测试：是否有拥塞/接收方窗口空间？                              │
  │ • 我可以发送吗？如果是，构建 TCP 头部并传输                          │
  └─────────────────────────────────────────────────────────────────────┘
       │
       ▼
  ┌─────────────────────────────────────────────────────────────────────┐
  │ 第 3 步：tcp_transmit_skb() — 实际传输                             │
  │ • 构建 TCP 头部（seq, ack, window, options）                        │
  │ • 计算校验和（或卸载到 NIC）                                        │
  │ • 排入 qdisc（调度器）→ NIC → 网络                                  │
  └─────────────────────────────────────────────────────────────────────┘
```

---

## `tcp_sendmsg_locked()`：入口点

```c
// net/ipv4/tcp.c — tcp_sendmsg_locked()
int tcp_sendmsg_locked(struct sock *sk, struct msghdr *msg, size_t size)
{
    struct tcp_sock *tp = tcp_sk(sk);
    struct sk_buff *skb;
    int copied = 0;

    // 将用户数据拷贝到 sk_buff 分片
    while (size > 0) {
        // 分配或重用 sk_buff
        skb = tcp_send_head(sk);
        if (!skb) {
            skb = sk_stream_alloc_skb(sk, 0, sk->sk_allocation);
            tcp_init_skb(skb, tp->write_seq);
        }

        // 将数据拷贝到 sk_buff
        copy = min_t(size_t, size, skb_availroom(skb));
        if (skb_add_data(skb, msg, copy))
            return copied ? copied : -EFAULT;

        tp->write_seq += copy;
        copied += copy;
        size -= copy;

        // 如果有足够数据则发送
        if (size == 0 || !tcp_stream_is_thin(sk))
            tcp_push(sk, skb);
    }

    return copied;
}
```

---

## Nagle 算法：避免小数据包

### 问题：微小数据包

1 字节的 TCP 数据包有 40 字节头部（以太网 + IP + TCP）。效率只有 2.5%。Nagle 算法通过延迟小发送来防止这种情况：

```c
// net/ipv4/tcp_output.c — tcp_nagle_test()
static inline bool tcp_nagle_test(const struct tcp_sock *tp, const struct sk_buff *skb,
                                  unsigned int cur_mss, int nonagle)
{
    // 如果设置了 TCP_NODELAY，总是发送
    if (nonagle & TCP_NAGLE_ON)
        return false;

    // 如果有未确认数据且这是小包，等待
    if (tp->packets_out && (skb->len < cur_mss))
        return true;  // 不发送 — 等待更多数据

    return false;  // 可以发送
}
```

### Nagle 何时延迟

```
  时间 →
  send("H")     → 排队（等待更多数据）
  send("e")     → 排队
  send("l")     → 排队
  send("l")     → 排队
  send("o")     → 排队
  [MSS 达到]    → 将 "Hello" 作为一个数据包发送

  或

  [延迟 ACK 超时 ~40ms] → 即使小也发送 "Hello"
```

### 禁用 Nagle：`TCP_NODELAY`

```c
int flag = 1;
setsockopt(fd, IPPROTO_TCP, TCP_NODELAY, &flag, sizeof(flag));
```

使用 `TCP_NODELAY`，每次 `send()` 都会导致立即传输。这对延迟比效率更重要的交互式应用（游戏、shell）至关重要。

---

## 拥塞控制：避免网络过载

### 问题：网络崩溃

没有拥塞控制，发送方会淹没网络，导致数据包丢失和重传风暴。TCP 使用**拥塞窗口**（`cwnd`）来限制在途数据：

```c
// include/net/tcp.h
struct tcp_sock {
    u32 snd_cwnd;          // 拥塞窗口（以段为单位）
    u32 snd_ssthresh;      // 慢启动阈值
    u32 snd_cwnd_cnt;      // 线性增加计数器
    u32 prior_cwnd;        // 丢失前的 cwnd
    // ...
};
```

### CUBIC：默认算法

```c
// net/ipv4/tcp_cubic.c — bictcp_cong_avoid()
static void bictcp_cong_avoid(struct sock *sk, u32 ack, u32 acked)
{
    struct tcp_sock *tp = tcp_sk(sk);

    // 丢失后：cwnd 降至 1 MSS
    // 恢复期间：立方增长函数
    if (tp->snd_cwnd < tp->snd_ssthresh) {
        // 慢启动：指数增长
        tp->snd_cwnd += 1;
    } else {
        // 拥塞避免：立方增长
        tp->snd_cwnd_cnt += cubic_increment(tp);
        if (tp->snd_cwnd_cnt > tp->snd_cwnd) {
            tp->snd_cwnd += 1;
            tp->snd_cwnd_cnt = 0;
        }
    }
}
```

### BBR：Google 的替代方案

BBR（瓶颈带宽和 RTT）采用不同方法：

```c
// net/ipv4/tcp_bbr.c — bbr_set_cwnd()
static void bbr_set_cwnd(struct sock *sk)
{
    struct tcp_sock *tp = tcp_sk(sk);
    u32 cwnd = bbr_bw(sk) * bbr_min_rtt(sk);  // BDP

    // 限制在接收方窗口内
    cwnd = min(cwnd, tp->rcv_wnd);

    // 应用 pacing
    tp->snd_cwnd = cwnd;
}
```

BBR 对网络建模（带宽 × RTT = BDP）而不是对丢包做出反应。这在有损网络上实现更高吞吐量。

---

## `tcp_write_xmit()`：发送循环

```c
// net/ipv4/tcp_output.c — tcp_write_xmit()
static bool tcp_write_xmit(struct sock *sk, unsigned int mss_now, int nonagle,
                           gfp_t gfp)
{
    struct tcp_sock *tp = tcp_sk(sk);
    struct sk_buff *skb;
    unsigned int sent_pkts = 0;

    while ((skb = tcp_send_head(sk))) {
        // 1. Nagle 测试
        if (tcp_nagle_test(tp, skb, mss_now, nonagle) &&
            !tcp_skb_is_last(sk, skb))
            break;  // 等待更多数据

        // 2. 窗口测试
        if (tcp_cwnd_test(tp, skb) > 0)
            break;  // 拥塞窗口满

        if (tcp_snd_wnd_test(tp, skb, mss_now))
            break;  // 接收方窗口满

        // 3. 传输
        if (tcp_transmit_skb(sk, skb, 1, gfp))
            break;

        sent_pkts++;
    }

    return !sent_pkts;
}
```

---

## 延迟 ACK：减少 ACK 流量

### 问题：ACK 风暴

如果接收方对每个数据包都发送 ACK，那是 50% 的开销（40 字节 ACK 对应 40 字节数据）。延迟 ACK 减少这个：

```c
// net/ipv4/tcp_input.c — tcp_delack_kick()
static void tcp_delack_kick(struct sock *sk)
{
    struct tcp_sock *tp = tcp_sk(sk);

    // 如果以下情况发送 ACK：
    // 1. 延迟 ACK 计时器到期（~40ms）
    // 2. 收到乱序数据包
    // 3. 收到第二个数据包（捎带 ACK）
    if (tp->delack_timer.expires < jiffies)
        tcp_send_ack(sk);
}
```

### 与 Nagle 的交互

Nagle + 延迟 ACK 会导致显著延迟：

```
  发送方                     接收方
  │                         │
  ├──send("H")──→  (被 Nagle 排队)
  │                         │
  │                    (等待更多数据以捎带 ACK)
  │                         │
  │                    [40ms 超时]
  │                         │
  │←──────ACK───────────────│
  │                         │
  ├──send("ello")──→  （现在发送因为 ACK 到达）
```

这就是为什么交互式应用应该使用 `TCP_NODELAY`。

---

## 深度细节：Header Prediction

```c
// net/ipv4/tcp_input.c — tcp_rcv_established()
static inline void tcp_rcv_established(struct sock *sk, struct sk_buff *skb)
{
    struct tcp_sock *tp = tcp_sk(sk);

    // Header prediction：单次 32 位比较
    if ((tcp_flag_word(th) & htonl(0x00FF0000)) == tp->pred_flags &&
        TCP_SKB_CB(skb)->seq == tp->rcv_nxt) {
        // 快速路径：~10 指令
        tp->rcv_nxt += TCP_SKB_CB(skb)->end_seq - TCP_SKB_CB(skb)->seq;
        tcp_ack(sk, skb, FLAG_DATA);
        __kfree_skb(skb);
        tcp_data_ready(sk);
        return;
    }

    // 慢路径
    tcp_data_queue(sk, skb);
}
```

`pred_flags` 字段将预期 TCP 标志 + 窗口打包到单个 32 位值中。如果传入数据包匹配，整个接收处理约 10 指令。

---

## 如何观测 TCP 行为

### 使用 bpftrace

```bash
#!/usr/bin/env bpftrace
// trace_tcp.bt

kprobe:tcp_sendmsg_locked
{
    @send[comm] = count();
}

kprobe:tcp_write_xmit
{
    @xmit[comm] = count();
}

kprobe:tcp_rcv_established
{
    @rcv[comm] = count();
}

kprobe:tcp_nagle_test
/@retval == 1/
{
    @nagle_delay[comm] = count();
}

END
{
    printf("\nTCP sends:\n");
    print(@send);
    printf("\nNagle delays:\n");
    print(@nagle_delay);
}
```

### 使用 /proc

```bash
// TCP 连接信息
cat /proc/net/tcp

// TCP 统计
cat /proc/net/snmp | grep Tcp

// 每 socket TCP 信息
ss -ti

// 拥塞控制算法
cat /proc/sys/net/ipv4/tcp_congestion_control
```

---

## 常见问题

### 为什么 `send()` 不立即发送数据？
`send()` 只将数据排入内核发送缓冲区。实际传输可能被 Nagle 算法、拥塞控制或接收方窗口延迟。

### 什么时候应该使用 `TCP_NODELAY`？
对交互式应用（游戏、shell、实时系统）使用 `TCP_NODELAY`，其中延迟比带宽效率更重要。对批量传输禁用它。

### CUBIC 和 BBR 有什么区别？
CUBIC 对丢包做出反应（传统方法）。BBR 对网络建模（带宽 × RTT）并在有损网络上实现更高吞吐量。

### 为什么我的小写入很慢？
Nagle 算法延迟小写入直到达到 MSS 或延迟 ACK 计时器到期（~40ms）。使用 `TCP_NODELAY` 禁用此功能。

### cwnd 和 rwnd 之间的关系是什么？
`cwnd`（拥塞窗口）基于网络条件限制。`rwnd`（接收方窗口）基于接收方缓冲区空间限制。有效窗口是 `min(cwnd, rwnd)`。

---

## 总结

TCP 远不止是可靠的字节流。发送端做出涉及 Nagle 算法（避免小数据包）、拥塞控制（避免网络过载）和延迟 ACK（减少 ACK 流量）的复杂决策。这些机制以微妙的方式相互作用，影响延迟和吞吐量。

对于生产系统，实际要点是：`send()` 不意味着数据已发送，Nagle + 延迟 ACK 会导致延迟尖峰，理解这些机制有助于调优网络性能。

---

## 来源

- Linux 内核源码, `net/ipv4/tcp.c`, `tcp_sendmsg_locked()`
- Linux 内核源码, `net/ipv4/tcp_output.c`, `tcp_write_xmit()`
- Linux 内核源码, `net/ipv4/tcp_output.c`, `tcp_nagle_test()`
- Linux 内核源码, `net/ipv4/tcp_cubic.c`, `bictcp_cong_avoid()`
- Linux 内核源码, `net/ipv4/tcp_bbr.c`, `bbr_set_cwnd()`
- Linux 内核源码, `include/net/tcp.h`, `tcp_congestion_ops`
