---
title: "TCP Is Not a Pipe — The Three-Way Dance of Congestion Control, Nagle, and Delayed ACK"
description: "TCP is more than send/receive. The sender makes complex decisions: when to send, how much, and how to react to congestion. Source analysis reveals the complexity."
coverImage: "/posts/linux-tcp-not-pipe/images/cover.jpg"
coverImageAlt: "A USB key representing the complex decision-making process in TCP's send path, including congestion control, Nagle, and delayed ACK"
ogImage: "/posts/linux-tcp-not-pipe/images/cover.jpg"
date: "2026-09-06 11:00:00"
lastUpdated: "2026-09-06 11:00:00"
author: "FindNS94"
tags: ["Kernel", "Linux"]
---

![A USB key representing the complex decision-making process in TCP's send path, including congestion control, Nagle, and delayed ACK](/posts/linux-tcp-not-pipe/images/cover.jpg)

# TCP Is Not a Pipe — The Three-Way Dance of Congestion Control, Nagle, and Delayed ACK

Every network programmer has treated TCP as a reliable byte stream: `send()` puts data in, `recv()` gets data out. But this mental model hides the incredible complexity happening inside the kernel. The TCP sender makes dozens of decisions for every segment: Should I send now or wait for more data? Is the network congested? Should I retransmit? Is the receiver's window full?

These decisions involve three interacting mechanisms: **congestion control** (avoiding network overload), **Nagle's algorithm** (avoiding small packets), and **delayed ACK** (reducing ACK traffic). Understanding these mechanisms explains why your `send()` call doesn't immediately result in network traffic, why small writes can be slow, and why TCP throughput depends on more than just bandwidth.

This article walks through the TCP send path in `net/ipv4/tcp.c` and `net/ipv4/tcp_output.c` to explain how the kernel decides when to send, how much to send, and how to react to network conditions.

<!-- [UNIQUE INSIGHT] The most counterintuitive fact about TCP is that `send()` does NOT mean "data is sent." It means "data is queued in the kernel send buffer." The actual network transmission may be delayed by Nagle's algorithm (waiting for more data), congestion control (waiting for window space), or the receiver's window (waiting for ACKs). This is why `send()` returns instantly but the data may not arrive for milliseconds — and why `TCP_NODELAY` exists. -->

<!-- more -->

> **Key Takeaways**
> - `send()` queues data in kernel buffer — actual transmission is delayed
> - Nagle's algorithm: don't send small packets if there's unacknowledged data
> - Delayed ACK: receiver waits up to 40ms before sending ACK
> - Congestion control: kernel tracks cwnd (congestion window) and ssthresh
> - CUBIC (default) vs BBR: different algorithms for different network conditions
> - Header prediction enables 10-instruction receive fast path

---

## The Myth: "send() Sends Data"

The mental model: `send(fd, buf, len)` → kernel sends `len` bytes over the network → returns. This is wrong.

What actually happens:

```
  send(fd, buf, len)
       │
       ▼
  ┌─────────────────────────────────────────────────────────────────────┐
  │ Step 1: Copy to Send Buffer                                         │
  │ • Data copied from userspace to sk_send_head                       │
  │ • Returns immediately (if buffer has space)                         │
  │ • NO network transmission yet!                                      │
  └─────────────────────────────────────────────────────────────────────┘
       │
       ▼
  ┌─────────────────────────────────────────────────────────────────────┐
  │ Step 2: tcp_write_xmit() — The Decision Engine                     │
  │ • Nagle test: should I wait for more data?                          │
  │ • Window test: is there congestion/receiver window space?          │
  │ • Can I send? If yes, build TCP header and transmit                 │
  └─────────────────────────────────────────────────────────────────────┘
       │
       ▼
  ┌─────────────────────────────────────────────────────────────────────┐
  │ Step 3: tcp_transmit_skb() — Actual Transmission                   │
  │ • Build TCP header (seq, ack, window, options)                     │
  │ • Compute checksum (or offload to NIC)                              │
  │ • Queue to qdisc (scheduler) → NIC → network                       │
  └─────────────────────────────────────────────────────────────────────┘
```

---

## `tcp_sendmsg_locked()`: The Entry Point

```c
// net/ipv4/tcp.c — tcp_sendmsg_locked()
int tcp_sendmsg_locked(struct sock *sk, struct msghdr *msg, size_t size)
{
    struct tcp_sock *tp = tcp_sk(sk);
    struct sk_buff *skb;
    int copied = 0;

    // Copy user data into sk_buff fragments
    while (size > 0) {
        // Allocate or reuse sk_buff
        skb = tcp_send_head(sk);
        if (!skb) {
            skb = sk_stream_alloc_skb(sk, 0, sk->sk_allocation);
            tcp_init_skb(skb, tp->write_seq);
        }

        // Copy data into the sk_buff
        copy = min_t(size_t, size, skb_availroom(skb));
        if (skb_add_data(skb, msg, copy))
            return copied ? copied : -EFAULT;

        tp->write_seq += copy;
        copied += copy;
        size -= copy;

        // Send if we have enough data
        if (size == 0 || !tcp_stream_is_thin(sk))
            tcp_push(sk, skb);
    }

    return copied;
}
```

---

## Nagle's Algorithm: Avoiding Small Packets

### The Problem: Tiny Packets

A 1-byte TCP packet has 40 bytes of headers (Ethernet + IP + TCP). That's 2.5% efficiency. Nagle's algorithm prevents this by delaying small sends:

```c
// net/ipv4/tcp_output.c — tcp_nagle_test()
static inline bool tcp_nagle_test(const struct tcp_sock *tp, const struct sk_buff *skb,
                                  unsigned int cur_mss, int nonagle)
{
    // If TCP_NODELAY is set, always send
    if (nonagle & TCP_NAGLE_ON)
        return false;

    // If there's unacknowledged data and this is a small packet, wait
    if (tp->packets_out && (skb->len < cur_mss))
        return true;  // Don't send — wait for more data

    return false;  // OK to send
}
```

### When Nagle Delays

```
  Time →
  send("H")     → queued (waiting for more data)
  send("e")     → queued
  send("l")     → queued
  send("l")     → queued
  send("o")     → queued
  [MSS reached] → SEND "Hello" as one packet

  OR

  [Delayed ACK timeout ~40ms] → SEND "Hello" even though small
```

### Disabling Nagle: `TCP_NODELAY`

```c
int flag = 1;
setsockopt(fd, IPPROTO_TCP, TCP_NODELAY, &flag, sizeof(flag));
```

With `TCP_NODELAY`, every `send()` results in immediate transmission. This is essential for interactive applications (games, shells) where latency matters more than efficiency.

---

## Congestion Control: Avoiding Network Overload

### The Problem: Network Collapse

Without congestion control, senders would flood the network, causing packet loss and retransmission storms. TCP uses a **congestion window** (`cwnd`) to limit in-flight data:

```c
// include/net/tcp.h
struct tcp_sock {
    u32 snd_cwnd;          // Congestion window (in segments)
    u32 snd_ssthresh;      // Slow start threshold
    u32 snd_cwnd_cnt;      // Linear increase counter
    u32 prior_cwnd;        // cwnd before loss
    // ...
};
```

### CUBIC: The Default Algorithm

```c
// net/ipv4/tcp_cubic.c — bictcp_cong_avoid()
static void bictcp_cong_avoid(struct sock *sk, u32 ack, u32 acked)
{
    struct tcp_sock *tp = tcp_sk(sk);

    // After loss: cwnd reduced to 1 MSS
    // During recovery: cubic growth function
    if (tp->snd_cwnd < tp->snd_ssthresh) {
        // Slow start: exponential growth
        tp->snd_cwnd += 1;
    } else {
        // Congestion avoidance: cubic growth
        tp->snd_cwnd_cnt += cubic_increment(tp);
        if (tp->snd_cwnd_cnt > tp->snd_cwnd) {
            tp->snd_cwnd += 1;
            tp->snd_cwnd_cnt = 0;
        }
    }
}
```

### CUBIC Growth Function

```
  cwnd
  │
  │          ┌─── Plateau (probing for more bandwidth)
  │         /
  │        /
  │       /
  │      /
  │     /
  │    /
  │   /
  │  /
  │ /
  │/
  └────────────────────────────────────────→ Time
  │←  Loss  →│←  Fast Recovery  →│←  Cubic Growth →
  │  cwnd=1  │   cwnd halved      │   cubic function
```

### BBR: Google's Alternative

BBR (Bottleneck Bandwidth and RTT) takes a different approach:

```c
// net/ipv4/tcp_bbr.c — bbr_set_cwnd()
static void bbr_set_cwnd(struct sock *sk)
{
    struct tcp_sock *tp = tcp_sk(sk);
    u32 cwnd = bbr_bw(sk) * bbr_min_rtt(sk);  // BDP

    // Cap at receiver window
    cwnd = min(cwnd, tp->rcv_wnd);

    // Apply pacing
    tp->snd_cwnd = cwnd;
}
```

BBR models the network (bandwidth × RTT = BDP) rather than reacting to loss. This achieves higher throughput on lossy networks.

---

## `tcp_write_xmit()`: The Send Loop

```c
// net/ipv4/tcp_output.c — tcp_write_xmit()
static bool tcp_write_xmit(struct sock *sk, unsigned int mss_now, int nonagle,
                           gfp_t gfp)
{
    struct tcp_sock *tp = tcp_sk(sk);
    struct sk_buff *skb;
    unsigned int sent_pkts = 0;

    while ((skb = tcp_send_head(sk))) {
        // 1. Nagle test
        if (tcp_nagle_test(tp, skb, mss_now, nonagle) &&
            !tcp_skb_is_last(sk, skb))
            break;  // Wait for more data

        // 2. Window test
        if (tcp_cwnd_test(tp, skb) > 0)
            break;  // Congestion window full

        if (tcp_snd_wnd_test(tp, skb, mss_now))
            break;  // Receiver window full

        // 3. Transmit
        if (tcp_transmit_skb(sk, skb, 1, gfp))
            break;

        sent_pkts++;
    }

    return !sent_pkts;
}
```

---

## Delayed ACK: Reducing ACK Traffic

### The Problem: ACK Storm

If the receiver sends an ACK for every packet, that's 50% overhead (40-byte ACK for 40-byte data). Delayed ACK reduces this:

```c
// net/ipv4/tcp_input.c — tcp_delack_kick()
static void tcp_delack_kick(struct sock *sk)
{
    struct tcp_sock *tp = tcp_sk(sk);

    // Send ACK if:
    // 1. Delayed ACK timer expired (~40ms)
    // 2. Out-of-order packet received
    // 3. Second packet received (piggyback ACK)
    if (tp->delack_timer.expires < jiffies)
        tcp_send_ack(sk);
}
```

### Interaction with Nagle

Nagle + Delayed ACK can cause significant latency:

```
  Sender                    Receiver
  │                         │
  ├──send("H")──→  (queued by Nagle)
  │                         │
  │                    (waiting for more data to piggyback ACK)
  │                         │
  │                    [40ms timeout]
  │                         │
  │←──────ACK───────────────│
  │                         │
  ├──send("ello")──→  (now sent because ACK arrived)
```

This is why interactive applications should use `TCP_NODELAY`.

---

## Deep Detail: Header Prediction

```c
// net/ipv4/tcp_input.c — tcp_rcv_established()
static inline void tcp_rcv_established(struct sock *sk, struct sk_buff *skb)
{
    struct tcp_sock *tp = tcp_sk(sk);

    // Header prediction: single 32-bit comparison
    if ((tcp_flag_word(th) & htonl(0x00FF0000)) == tp->pred_flags &&
        TCP_SKB_CB(skb)->seq == tp->rcv_nxt) {
        // Fast path: ~10 instructions
        tp->rcv_nxt += TCP_SKB_CB(skb)->end_seq - TCP_SKB_CB(skb)->seq;
        tcp_ack(sk, skb, FLAG_DATA);
        __kfree_skb(skb);
        tcp_data_ready(sk);
        return;
    }

    // Slow path
    tcp_data_queue(sk, skb);
}
```

The `pred_flags` field packs expected TCP flags + window into a single 32-bit value. If the incoming packet matches, the entire receive processing is ~10 instructions.

---

## How to Observe TCP Behavior

### Using bpftrace

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

### Using /proc

```bash
// TCP connection info
cat /proc/net/tcp

// TCP statistics
cat /proc/net/snmp | grep Tcp

// Per-socket TCP info
ss -ti

// Congestion control algorithm
cat /proc/sys/net/ipv4/tcp_congestion_control
```

### Using perf

```bash
// Profile TCP send path
perf record -e cycles:k -g -- ./benchmark_tcp
perf report
```

---

## Frequently Asked Questions

### Why doesn't `send()` send data immediately?
`send()` only queues data in the kernel send buffer. Actual transmission may be delayed by Nagle's algorithm, congestion control, or the receiver's window.

### When should I use `TCP_NODELAY`?
Use `TCP_NODELAY` for interactive applications (games, shells, real-time systems) where latency matters more than bandwidth efficiency. Disable it for bulk transfers.

### What is the difference between CUBIC and BBR?
CUBIC reacts to packet loss (traditional approach). BBR models the network (bandwidth × RTT) and achieves higher throughput on lossy networks.

### Why is my small write slow?
Nagle's algorithm delays small writes until either MSS is reached or the delayed ACK timer expires (~40ms). Use `TCP_NODELAY` to disable this.

### What is the relationship between cwnd and rwnd?
`cwnd` (congestion window) limits based on network conditions. `rwnd` (receiver window) limits based on receiver buffer space. The effective window is `min(cwnd, rwnd)`.

---

## Conclusion

TCP is far more than a reliable byte stream. The sender makes complex decisions involving Nagle's algorithm (avoiding small packets), congestion control (avoiding network overload), and delayed ACK (reducing ACK traffic). These mechanisms interact in subtle ways that affect latency and throughput.

For production systems, the practical takeaways are: `send()` doesn't mean data is sent, Nagle + delayed ACK can cause latency spikes, and understanding these mechanisms helps tune network performance.

---

## Sources

- Linux kernel source, `net/ipv4/tcp.c`, `tcp_sendmsg_locked()`
- Linux kernel source, `net/ipv4/tcp_output.c`, `tcp_write_xmit()`
- Linux kernel source, `net/ipv4/tcp_output.c`, `tcp_nagle_test()`
- Linux kernel source, `net/ipv4/tcp_cubic.c`, `bictcp_cong_avoid()`
- Linux kernel source, `net/ipv4/tcp_bbr.c`, `bbr_set_cwnd()`
- Linux kernel source, `include/net/tcp.h`, `tcp_congestion_ops`
