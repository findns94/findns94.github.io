---
title: "A Packet's Self-Drive Tour — Complete Journey from NIC to Userspace"
description: "A packet from NIC to userspace goes through NAPI poll, IP layer, TCP layer, socket buffer, and finally recvmsg(). Source analysis reveals each step of the journey."
coverImage: "/posts/linux-packet-journey-nic-to-userspace/images/cover.jpg"
coverImageAlt: "A ball representing the complete journey of a network packet from NIC to userspace through the Linux kernel"
ogImage: "/posts/linux-packet-journey-nic-to-userspace/images/cover.jpg"
date: "2026-09-06 10:00:00"
lastUpdated: "2026-09-06 10:00:00"
author: "FindNS94"
tags: ["Linux", "Kernel", "Network"]
---

![A ball representing the complete journey of a network packet from NIC to userspace through the Linux kernel](/posts/linux-packet-journey-nic-to-userspace/images/cover.jpg)

# A Packet's Self-Drive Tour — Complete Journey from NIC to Userspace

Every network programmer has called `recvmsg()` to receive data. But what happens between the moment a packet arrives at the NIC and when it appears in your application's buffer? The journey involves at least six distinct stages: NAPI polling, IP routing, TCP processing, socket buffer queuing, wakeup notification, and finally data copy to userspace.

This article traces a single packet's journey from the network interface card (NIC) through the kernel's network stack to the application's receive buffer. By the end, you will understand why network performance depends on more than just bandwidth, how the kernel avoids packet loss under load, and why `recvmsg()` can return immediately or block forever.

<!-- [UNIQUE INSIGHT] The most counterintuitive fact about packet processing is that the kernel does NOT use interrupts for high-speed packet reception. Instead, it uses NAPI (New API) polling: the first packet triggers an interrupt, which disables further interrupts and starts a poll loop. This avoids interrupt storm under heavy load and allows the kernel to process many packets per poll cycle, amortizing the cost of context switching. -->

<!-- more -->

> **Key Takeaways**
> - NAPI polling replaces interrupts for high-speed packet reception
> - Packet journey: NIC → driver → NAPI poll → IP layer → TCP layer → socket buffer → userspace
> - `sk_buff` is the universal packet container — headers added/removed by pointer arithmetic
> - Netfilter hooks at 5 points: PRE_ROUTING, LOCAL_IN, FORWARD, LOCAL_OUT, POST_ROUTING
> - Header prediction enables 10-instruction TCP fast path for established connections

---

## The Journey Overview

```
  Packet arrives at NIC
       │
       ▼
  ┌─────────────────────────────────────────────────────────────────────┐
  │ Stage 1: NIC + Driver                                              │
  │ • NIC writes packet to DMA buffer                                   │
  │ • Triggers MSI-X interrupt                                          │
  │ • IRQ handler calls napi_schedule()                                 │
  └─────────────────────────────────────────────────────────────────────┘
       │
       ▼
  ┌─────────────────────────────────────────────────────────────────────┐
  │ Stage 2: NAPI Poll                                                  │
  │ • Softirq NET_RX_SOFTIRQ raised                                     │
  │ • Driver poll() processes packets from RX ring                      │
  │ • Builds sk_buff for each packet                                    │
  │ • Calls netif_receive_skb()                                         │
  └─────────────────────────────────────────────────────────────────────┘
       │
       ▼
  ┌─────────────────────────────────────────────────────────────────────┐
  │ Stage 3: IP Layer                                                   │
  │ • ip_rcv(): validate header, check checksum                         │
  │ • Netfilter NF_INET_PRE_ROUTING hook                                │
  │ • ip_route_input(): routing decision                                │
  │ • ip_local_deliver(): deliver to local protocol                     │
  │ • Netfilter NF_INET_LOCAL_IN hook                                   │
  └─────────────────────────────────────────────────────────────────────┘
       │
       ▼
  ┌─────────────────────────────────────────────────────────────────────┐
  │ Stage 4: TCP Layer                                                  │
  │ • tcp_v4_rcv(): find socket (4-tuple hash lookup)                   │
  │ • tcp_rcv_established(): fast path for data                         │
  │ • Header prediction: 10-instruction fast path                       │
  │ • tcp_data_queue(): ordered/OOO reassembly                          │
  └─────────────────────────────────────────────────────────────────────┘
       │
       ▼
  ┌─────────────────────────────────────────────────────────────────────┐
  │ Stage 5: Socket Buffer                                              │
  │ • sk_data_ready(): wake up blocked processes                        │
  │ • Data sits in sk_receive_queue                                     │
  │ • recvmsg(): copy to userspace                                      │
  └─────────────────────────────────────────────────────────────────────┘
```

---

## Stage 1: NIC + Driver

When a packet arrives at the NIC:

1. **DMA transfer**: The NIC writes the packet data to a pre-allocated DMA buffer (via PCIe)
2. **Descriptor update**: The NIC updates the RX ring descriptor to mark the buffer as filled
3. **Interrupt**: The NIC raises an MSI-X interrupt (Message Signaled Interrupt)

```c
// Driver IRQ handler (e.g., igb_msix_ring())
static irqreturn_t igb_msix_ring(int irq, void *data)
{
    struct_q_vector *q_vector = data;

    // Disable further interrupts from this RX queue
    writel(0, q_vector->itr_register);

    // Schedule NAPI poll
    napi_schedule(&q_vector->napi);

    return IRQ_HANDLED;
}
```

### Why Disable Interrupts?

Under heavy load (1M packets/sec), per-packet interrupts would consume 30%+ of CPU. NAPI disables interrupts and polls instead — the driver processes many packets per interrupt.

---

## Stage 2: NAPI Poll

The NAPI poll loop runs as a softirq (`NET_RX_SOFTIRQ`):

```c
// net/core/dev.c — net_rx_action()
static void net_rx_action(struct softirq_action *h)
{
    struct list_head *list = &__get_cpu_var(softnet_data).poll_list;
    unsigned long time_limit = jiffies + 2;
    int budget = netdev_budget;  // Default: 32 packets per poll

    // Process all NAPI devices
    while (!list_empty(list)) {
        struct napi_struct *n;
        int work, weight;

        n = list_first_entry(list, struct napi_struct, poll_list);

        weight = n->weight;  // Default: 64
        work = n->poll(n, budget);  // Driver poll function

        budget -= work;
        if (work >= weight || budget <= 0)
            break;  // Exceeded weight or budget
    }
}
```

### Driver Poll Function

```c
// Driver poll function (e.g., igb_poll())
static int igb_poll(struct napi_struct *napi, int budget)
{
    struct igb_q_vector *q_vector = container_of(napi, struct igb_q_vector, napi);
    int work_done = 0;

    // Process TX completions
    igb_clean_tx_irq(q_vector);

    // Process RX packets
    igb_clean_rx_irq(q_vector, budget);

    // If done, re-enable interrupts
    if (work_done < budget) {
        napi_complete_done(napi, work_done);
        igb_ring_irq_enable(q_vector);  // Re-enable interrupts
    }

    return work_done;
}
```

### Building `sk_buff`

```c
// net/core/dev.c — netif_receive_skb()
int netif_receive_skb(struct sk_buff *skb)
{
    // Deliver to protocol handlers
    return __netif_receive_skb(skb);
}
```

The `sk_buff` (socket buffer) is the universal packet container:

```c
// include/linux/skbuff.h (simplified)
struct sk_buff {
    struct sk_buff *next, *prev;    // Linked list
    struct net_device *dev;         // Incoming/outgoing device
    struct sock *sk;                // Owning socket
    ktime_t tstamp;                 // Arrival timestamp
    char cb[48];                    // Control buffer (TCP/IP private)
    unsigned int len, data_len;     // Total vs payload length

    // Protocol headers (set by each layer)
    union {
        struct tcphdr *th;
        struct udphdr *uh;
        struct icmphdr *ich;
        struct igmphdr *iph;
        struct iphdr *ipiph;
        struct ipv6hdr *ipv6h;
        unsigned char *raw;
    } h;

    union {
        struct iphdr *iph;
        struct ipv6hdr *ipv6h;
        unsigned char *raw;
    } nh;

    unsigned char *head, *data, *tail, *end;
    // ↑ Pointers to buffer boundaries
};
```

### Header Pointer Magic

Headers are added by moving pointers backward:

```
  After driver:     [eth][    payload    ]
                    ↑data

  After IP:         [eth][ip][  payload  ]
                         ↑data

  After TCP:        [eth][ip][tcp][payload]
                              ↑data
```

No data is copied — only pointers are adjusted.

---

## Stage 3: IP Layer

```c
// net/ipv4/ip_input.c — ip_rcv()
int ip_rcv(struct sk_buff *skb, struct net_device *dev,
           struct packet_type *pt, struct net_device *orig_dev)
{
    struct iphdr *iph;
    u32 len;

    // Validate header
    if (skb->len < sizeof(struct iphdr) || iph->version != 4)
        goto drop;

    // Check header checksum
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

### Routing Decision

```c
// net/ipv4/ip_input.c — ip_rcv_finish()
static int ip_rcv_finish(struct sk_buff *skb)
{
    // Route the packet
    int err = ip_route_input(skb);

    if (err)
        goto drop;

    // If local, deliver to protocol handler
    if (skb_rtable(skb)->rt_flags & RTCF_LOCAL)
        return ip_local_deliver(skb);

    // Otherwise, forward
    return ip_forward(skb);
}
```

---

## Stage 4: TCP Layer

### Socket Lookup

```c
// net/ipv4/tcp_ipv4.c — tcp_v4_rcv()
int tcp_v4_rcv(struct sk_buff *skb)
{
    struct sock *sk;

    // Find socket by 4-tuple (src_ip, src_port, dst_ip, dst_port)
    sk = __inet_lookup_skb(&tcp_hashinfo, skb,
                           th->source, th->dest);
    if (!sk)
        goto no_tcp_socket;

    // Process based on connection state
    switch (sk->sk_state) {
    case TCP_TIME_WAIT:
        goto do_time_wait;
    case TCP_NEW_SYN_RECV:
        goto process;
    case TCP_LISTEN:
        // Handle SYN, ACK, etc.
        break;
    default:
        // Established connection — fast path
        tcp_v4_do_rcv(sk, skb);
    }
}
```

### Header Prediction: The Fast Path

```c
// net/ipv4/tcp_input.c — tcp_rcv_established()
static inline void tcp_rcv_established(struct sock *sk, struct sk_buff *skb)
{
    struct tcp_sock *tp = tcp_sk(sk);

    // Header prediction: compare expected flags + window
    if ((tcp_flag_word(th) & htonl(0x00FF0000)) == tp->pred_flags &&
        TCP_SKB_CB(skb)->seq == tp->rcv_nxt) {
        // Fast path: ~10 instructions!
        tp->rcv_nxt += TCP_SKB_CB(skb)->end_seq - TCP_SKB_CB(skb)->seq;
        tcp_ack(sk, skb, FLAG_DATA);
        __kfree_skb(skb);
        tcp_data_ready(sk);  // Wake up userspace
        return;
    }

    // Slow path: out-of-order, window changes, etc.
    tcp_data_queue(sk, skb);
}
```

The `pred_flags` field packs the expected TCP flags + window into a single 32-bit comparison. If the incoming packet matches, the entire receive processing is ~10 instructions.

---

## Stage 5: Socket Buffer

```c
// net/ipv4/tcp_input.c — tcp_data_ready()
static void tcp_data_ready(struct sock *sk)
{
    // Wake up processes blocked in recvmsg()/select()/epoll
    sk->sk_data_ready(sk);
}
```

When `recvmsg()` is called:

```c
// net/ipv4/tcp.c — tcp_recvmsg()
int tcp_recvmsg(struct sock *sk, struct msghdr *msg, size_t len, int flags,
                int *addr_len)
{
    struct tcp_sock *tp = tcp_sk(sk);
    struct sk_buff *skb;
    u32 offset;
    int copied;

    // Wait for data (if blocking)
    skb_queue_walk(&sk->sk_receive_queue, skb) {
        // Copy data from sk_buff to userspace
        copied = skb_copy_datagram_msg(skb, offset, msg, len);

        // Update position
        offset += copied;
        len -= copied;

        if (len == 0)
            break;
    }

    return copied;
}
```

---

## Deep Detail: `skb_shared_info`

```c
// include/linux/skbuff.h
struct skb_shared_info {
    __u8        nr_frags;           // Number of fragments
    __u8        tx_flags;           // TX flags
    unsigned short gso_size;        // GSO segment size
    unsigned short gso_segs;        // GSO segments
    unsigned short gso_type;        // GSO type
    struct sk_buff *frag_list;      // Fragment list
    struct skb_shared_info *next;   // Next shared info
    unsigned int hdr_len;           // Header length
    unsigned int frags[MAX_SKB_FRAGS];  // Page fragments
};
```

For large packets, the data is stored in page fragments rather than the linear buffer. `skb_shared_info` tracks these fragments.

---

## How to Observe Packet Processing

### Using bpftrace

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

tracepoint:net:net_dev_queue
{
    @tx[comm] = count();
}

END
{
    printf("\nRX packets:\n");
    print(@rx);
    printf("\nTCP established path:\n");
    print(@tcp_established);
}
```

### Using /proc

```bash
// Network statistics
cat /proc/net/snmp
cat /proc/net/netstat

// Per-socket queue
cat /proc/net/tcp

// Softnet statistics
cat /proc/net/softnet_stat
```

### Using perf

```bash
// Profile network stack
perf record -e cycles:k -g -- ./benchmark_network
perf report

// Trace specific functions
perf probe --add tcp_v4_rcv
perf probe --add ip_rcv
perf record -e probe:tcp_v4_rcv -g -- ./benchmark
```

---

## Frequently Asked Questions

### Why does the kernel use NAPI instead of interrupts?
Under heavy load, per-packet interrupts consume 30%+ of CPU. NAPI disables interrupts and polls, processing many packets per cycle. This amortizes context switching cost.

### What is `sk_buff`?
The universal packet container. It holds the packet data and protocol headers. Headers are added/removed by adjusting pointers, not by copying data.

### What is header prediction?
A fast path for TCP established connections. The kernel compares expected flags + window in a single 32-bit comparison. If matched, the entire receive processing is ~10 instructions.

### What happens when the socket buffer is full?
The kernel drops incoming packets (if the buffer is full). TCP flow control prevents this by reducing the advertised window when the application is slow.

### How does zero-copy work?
`splice()` and `sendfile()` avoid copying data between kernel and userspace. Data moves directly from file page cache to socket buffer (or vice versa) without CPU copies.

---

## Conclusion

A packet's journey from NIC to userspace involves NAMI polling, IP routing, TCP processing, socket buffering, and data copy. The kernel optimizes each stage: NAPI avoids interrupt storms, header prediction enables a 10-instruction TCP fast path, and `sk_buff` pointer arithmetic avoids data copies.

For production systems, the practical takeaways are: NAPI scales to 1M+ packets/sec, header prediction makes TCP fast for established connections, and understanding the journey helps diagnose network performance issues.

---

## Sources

- Linux kernel source, `net/core/dev.c`, `net_rx_action()`
- Linux kernel source, `net/ipv4/ip_input.c`, `ip_rcv()`
- Linux kernel source, `net/ipv4/tcp_input.c`, `tcp_rcv_established()`
- Linux kernel source, `net/ipv4/tcp_ipv4.c`, `tcp_v4_rcv()`
- Linux kernel source, `include/linux/skbuff.h`, `struct sk_buff`
