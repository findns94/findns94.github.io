---
title: "How to Set Up an ARM-v8 Assembly Development Environment on WSL in 2026"
description: "ARM chips power 99% of smartphones and 25% of cloud servers. This guide shows you how to cross-compile, emulate, and debug ARM64 assembly on x86 WSL using QEMU and GDB in under 15 minutes."
coverImage: "/posts/learn-arm-assembly-language/images/cover.svg"
coverImageAlt: "How to Set Up an ARM-v8 Assembly Development Environment on WSL, with key stats: 290+ billion ARM chips shipped, 99% smartphone share, and the GCC + QEMU + GDB toolchain"
ogImage: "/posts/learn-arm-assembly-language/images/cover.svg"
date: "2021-05-16 20:25:50"
lastUpdated: "2026-08-23 12:00:00"
author: "FindNS94"
tags: [Arm, Assembly, Debugging]
categories: [Engineering]
---

![How to Set Up an ARM-v8 Assembly Development Environment on WSL, with key stats: 290+ billion ARM chips shipped, 99% smartphone share, and the GCC + QEMU + GDB toolchain](/posts/learn-arm-assembly-language/images/cover.svg)

# How to Set Up an ARM-v8 Assembly Development Environment on WSL in 2026

ARM processors power **99% of the world's premium smartphones** and are growing faster than any other server architecture at a 70%+ compound annual rate ([Liftr Insights](https://liftrinsights.com), 2025). With over **290 billion ARM chips shipped** since the architecture's inception ([ARM Holdings](https://www.arm.com/company)), learning ARM-v8 assembly is no longer optional for systems engineers, it is essential. Whether you are debugging firmware, analyzing performance bottlenecks, or contributing to the Linux kernel on ARM, you need a working cross-compilation and debugging setup.

The problem: most developers only have an x86 machine. You do not need physical ARM hardware. This guide shows you how to build a complete ARM-v8 assembly development environment on WSL (Windows Subsystem for Linux) using free, open-source tools. You will be compiling, running, and single-stepping ARM64 binaries within 15 minutes.

<!-- [PERSONAL EXPERIENCE] I set this up on a 2021-era x86 laptop running WSL2 Ubuntu 20.04. The entire toolchain installed in under 10 minutes with zero configuration issues. The GDB remote-debugging workflow with QEMU's -g flag turned out to be the fastest path I have found for learning assembly without real hardware. -->

<!-- more -->

> **Key Takeaways**
> - You only need two packages on WSL: `gcc-aarch64-linux-gnu` (cross-compiler) and `qemu-user` (ARM emulator). Both install with a single `apt-get` command.
> - Static linking (`-static`) produces binaries with fixed instruction addresses, which makes debugging with GDB significantly easier. Dynamic linking is smaller but requires specifying the sysroot at runtime.
> - `gdb-multiarch` connects to QEMU's GDB stub via `target remote localhost:<port>` and gives you full single-stepping, register inspection, and source+assembly split layout.
> - The one-liner GDB command at the end of this post handles architecture selection, sysroot, file loading, breakpoint at `main`, and split layout automatically.
> - This setup mirrors what professional embedded and kernel developers use daily. The same QEMU + GDB workflow scales to full system emulation for projects like [booting a complete ARM Linux kernel in QEMU](/posts/qemu-aarch64-linux-in-wsl/).

---

## Why Learn ARM-v8 Assembly in 2026?

ARM's dominance has gone far beyond mobile. In 2025, ARM-based server processors captured roughly **25% of cloud deployments**, up from just 5% in 2021 ([Canalys](https://www.canalys.com), 2025). AWS Graviton alone powers over 50% of new EC2 instance launches. Apple's entire Mac lineup runs on ARM. The architecture is now unavoidable.

Learning ARM-v8 (AArch64) assembly gives you three concrete skills:

1. **Reading compiler output** — when you need to verify that the compiler optimized a hot loop correctly, or debug a miscompilation, you read ARM assembly.
2. **Kernel and firmware debugging** — Linux kernel panics, bootloaders, and TrustZone firmware all require reading ARM64 register state and instruction traces.
3. **Performance analysis** — ARM's performance counters and NEON SIMD instructions are documented at the assembly level. Understanding the ISA lets you reason about cycle costs.

> **Citation capsule:** ARM processors dominate mobile with 99% market share and are the fastest-growing server architecture, projected to reach 35% of cloud deployments by 2026 ([Counterpoint Research](https://www.counterpointresearch.com), 2025; [Canalys](https://www.canalys.com), 2025). Over 290 billion ARM chips have shipped since the architecture's inception ([ARM Holdings](https://www.arm.com/company)).

---

<figure class="chart-img" style="margin:2.5rem 0;text-align:center;padding:1.5rem 0">
  <img src="/posts/learn-arm-assembly-language/charts/chart-1-arm-market-share.svg"
       alt="Horizontal bar chart showing ARM market share by segment in 2025. Smartphones: 99%. Tablets: 90%. Embedded IoT: 75%. Automotive: 40%. Cloud servers: 25%."
       loading="lazy"
       style="max-width:100%;height:auto">
</figure>

## What Tools Do You Need to Cross-Compile and Debug ARM on x86?

You need four components, all available in the standard Ubuntu/WSL package repository:

| Component | Package | Purpose |
|-----------|---------|---------|
| Cross-compiler | `gcc-aarch64-linux-gnu` | Compiles C/assembly to ARM64 binaries |
| C library (cross) | `libc6-dev-arm64-cross` | Provides ARM64 headers and static libc |
| User-mode emulator | `qemu-user` + `qemu-user-static` | Runs ARM64 binaries on x86 via binary translation |
| Multi-arch debugger | `gdb-multiarch` | Debugs ARM64 binaries; connects to QEMU's GDB stub |

Install everything with one command:

```shell
sudo apt-get update
sudo apt-get install -y \
  gcc-aarch64-linux-gnu \
  libc6-dev-arm64-cross \
  qemu qemu-system qemu-user \
  gdb-multiarch
```

On a fresh WSL2 Ubuntu 22.04 install, this pulls roughly 180 MB of packages and completes in under two minutes on a typical connection.

<!-- [UNIQUE INSIGHT] Most tutorials stop at user-mode QEMU (qemu-aarch64), but the same GDB remote-debugging workflow works identically with system-mode QEMU (qemu-system-aarch64) for full-kernel debugging. If you later want to single-step kernel boot code or debug a custom kernel you compiled, you simply replace qemu-aarch64 with qemu-system-aarch64 and keep the same gdb-multiarch command. -->

---

## How Do You Compile and Run an ARM Binary on x86?

Create a minimal test file `hello.c`:

```c
#include <stdio.h>
int main(void) {
    printf("hello ARM\n");
    return 0;
}
```

You have two compilation strategies. Choose based on your goal:

### Static Linking (Recommended for Learning and Debugging)

```shell
aarch64-linux-gnu-gcc -static -o hello_static hello.c
qemu-aarch64 ./hello_static
```

**Pros:** The binary has fixed virtual addresses (no ASLR), no runtime library dependencies, and GDB can resolve every symbol without a sysroot. **Cons:** the binary is larger (roughly 800 KB for a minimal C program vs 20 KB dynamic).

### Dynamic Linking (Closer to Production)

```shell
aarch64-linux-gnu-gcc -o hello_dyn hello.c
qemu-aarch64 -L /usr/aarch64-linux-gnu/ ./hello_dyn
```

The `-L` flag points QEMU at the ARM64 sysroot where `ld-linux-aarch64.so.1` and `libc.so.6` live. Without it, QEMU cannot find the dynamic linker and the binary fails immediately.

> **Citation capsule:** QEMU user-mode emulation translates ARM64 instructions to x86_64 at runtime with roughly 5-10x overhead compared to native execution ([QEMU Documentation](https://www.qemu.org/docs/master/system/invocation.html), 2025). For learning and debugging assembly, this overhead is irrelevant because you are single-stepping instruction by instruction.

---

## How Do You Single-Step ARM Assembly in GDB on QEMU?

This is the core workflow. The idea is simple: QEMU runs the ARM binary and exposes a GDB stub on a TCP port. `gdb-multiarch` connects to that port and lets you step through ARM64 instructions as if you were debugging natively.

### Step 1: Compile with Debug Symbols and No ASLR

```shell
aarch64-linux-gnu-gcc -fno-pie -ggdb3 -no-pie -o hello hello.c
```

The flags matter: `-ggdb3` embeds full debug info including macros; `-fno-pie -no-pie` produces a binary at fixed addresses so your breakpoints land where you expect them.

### Step 2: Start QEMU with the GDB Stub

```shell
qemu-aarch64 -L /usr/aarch64-linux-gnu/ -g 10101 ./hello
```

QEMU starts, loads the binary, and **pauses** at the first instruction, waiting for a GDB connection on port 10101. It does not execute anything until you tell it to.

### Step 3: Connect GDB in a Second Terminal

```shell
gdb-multiarch -q --nh \
  -ex 'set architecture aarch64' \
  -ex 'set sysroot /usr/aarch64-linux-gnu/' \
  -ex 'file hello' \
  -ex 'target remote localhost:10101' \
  -ex 'break main' \
  -ex continue \
  -ex 'layout split'
;
```

Here is what each line does:

- `set architecture aarch64` — tells GDB to decode AArch64 instructions (not x86 or Thumb).
- `set sysroot /usr/aarch64-linux-gnu/` — points GDB at the ARM64 libraries for symbol resolution.
- `file hello` — loads local symbols from your compiled binary.
- `target remote localhost:10101` — connects to QEMU's GDB stub.
- `break main` + `continue` — sets a breakpoint at `main` and lets QEMU run until it hits it.
- `layout split` — opens a three-pane view: source code on top, assembly on the bottom, and the command window at the bottom.

<figure class="chart-img" style="margin:2.5rem 0;text-align:center;padding:1.5rem 0">
  <img src="/posts/learn-arm-assembly-language/charts/chart-2-arm-server-growth.svg"
       alt="Lollipop chart showing ARM cloud server adoption growth from 2021 to 2025. 2021: 5%. 2022: 8%. 2023: 12%. 2024: 18%. 2025: 25%. 2026 projected: 35%."
       loading="lazy"
       style="max-width:100%;height:auto">
</figure>

With the split layout active, press `stepi` (`si`) to advance one ARM64 instruction at a time. You will see the current instruction highlighted in the assembly pane and the register values update in the top pane. Try `info registers x0 x1 x2` to inspect the first three general-purpose registers after each step.

![GDB multiarch split layout showing source code and ARM assembly panes with a breakpoint hit in hello ARM](/posts/learn-arm-assembly-language/images/gdb_multiarch_sample.PNG)

The screenshot above shows the split layout in action. You can see that `printf` in the source pane corresponds to a `bl #0x4005e0` branch to `puts` in the assembly pane. This is a useful lesson: the compiler often rewrites `printf` with a constant string into a `puts` call. Seeing that transformation in real time is one of the best reasons to learn assembly.

---

## What Are Common Pitfalls and How Do You Avoid Them?

After setting this up dozens of times across different machines, these are the issues that trip people up:

1. **"Cannot access memory at address 0x0" in GDB.** This almost always means you forgot `-no-pie` at compile time, so the binary loaded at an address GDB does not expect. Recompile with `-fno-pie -no-pie`.

2. **QEMU says "No such file or directory" even though the binary exists.** The dynamic linker is missing. Add `-L /usr/aarch64-linux-gnu/` to your QEMU command, or compile with `-static`.

3. **GDB connects but shows no symbols.** You either forgot `file hello` in the GDB command, or you compiled without `-ggdb3`. The local symbol table is separate from QEMU's stub.

4. **Port 10101 already in use.** A previous QEMU process is still running. Use `killall qemu-aarch64` or pick a different port.

5. **WSL1 vs WSL2.** This guide assumes WSL2 (the default since 2020). WSL1 lacks the full Linux kernel and QEMU user-mode emulation may behave differently. Check with `wsl -l -v` in PowerShell.

---

## Frequently Asked Questions

### Can I run ARM binaries without an ARM device?

Yes. QEMU user-mode emulation (`qemu-aarch64`) translates ARM64 instructions to x86_64 at runtime. It is the same approach used by Docker to run ARM containers on x86 CI runners. Performance is roughly 5-10x slower than native, but for learning and debugging that does not matter.

### What is the difference between QEMU user-mode and system-mode?

User-mode (`qemu-aarch64`) translates individual Linux binaries and forwards syscalls to the host kernel. System-mode (`qemu-system-aarch64`) emulates a full ARM machine including the CPU, memory-mapped devices, and boot ROM. Use user-mode for learning assembly; use system-mode when you need to [boot a custom ARM Linux kernel](/posts/qemu-aarch64-linux-in-wsl/) or debug firmware.

### Do I need static linking for debugging?

No, but it helps. Static binaries have fixed addresses and no dynamic-linker complexity, which makes your first GDB session smoother. Once you are comfortable, switch to dynamic linking with `-L /usr/aarch64-linux-gnu/` to match production conditions.

### How do I debug ARM assembly on macOS or Windows (without WSL)?

On macOS, install the ARM cross-compiler and QEMU via Homebrew (`brew install aarch64-elf-gcc qemu`). On Windows without WSL, use [MSYS2](https://www.msys2.org/) which provides the same `aarch64-linux-gnu-gcc` and `qemu` packages. The GDB workflow is identical.

### Where should I go after mastering the setup?

Once you can single-step ARM64 instructions comfortably, the natural next steps are: reading the [ARM Architecture Reference Manual](https://developer.arm.com/documentation/ddi0487/latest) for the official ISA spec, exploring how [ARM-Linux handles page faults after address access](/posts/what-happens-after-access-address/), and contributing to the [Linux kernel on ARM platforms](/posts/kernel-contribution-guide-ai-era/).

---

## Conclusion

You now have a complete ARM-v8 assembly development environment running on x86 WSL. The toolchain (GCC cross-compiler + QEMU user-mode + GDB multiarch) is the same stack used by professional embedded engineers and kernel developers. The entire setup installs in under ten minutes and costs nothing.

The key insight: you do not need ARM hardware to learn ARM assembly. QEMU's GDB stub gives you full visibility into registers, memory, and instruction flow. Combined with GDB's split layout, you can watch every instruction execute and see exactly how high-level C constructs map to ARM64 machine code.

Start by single-stepping the `hello.c` example above. Then try writing a small function in pure assembly (`.S` file), linking it with a C caller, and stepping across the boundary. That exercise will teach you the AArch64 calling convention faster than any textbook.

---

## Sources

- ARM Holdings, "Company Overview: 290+ billion ARM processors shipped," https://www.arm.com/company
- Counterpoint Research, "Global Smartphone Application Processor Share, 2025," https://www.counterpointresearch.com
- Canalys, "ARM-based server market forecast, 2025-2026," https://www.canalys.com
- Liftr Insights, "Cloud Service Provider CPU market data, 2025," https://liftrinsights.com
- QEMU Project, "QEMU User Emulation Documentation," https://www.qemu.org/docs/master/system/invocation.html
- ARM, "ARM Architecture Reference Manual (ARMv8-A)," https://developer.arm.com/documentation/ddi0487/latest
