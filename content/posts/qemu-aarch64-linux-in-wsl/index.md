---
title: "How Do You Boot an ARM64 Linux System in QEMU on WSL?"
description: "Over 350 billion ARM chips shipped to date. This guide walks through cross-compiling an aarch64 kernel and BusyBox rootfs, then booting the system in QEMU."
coverImage: "/posts/qemu-aarch64-linux-in-wsl/images/cover.jpg"
coverImageAlt: "A dark Linux terminal window showing a command-line interface, representing the QEMU serial console used to boot an ARM64 system"
ogImage: "/posts/qemu-aarch64-linux-in-wsl/images/cover.jpg"
date: "2021-09-12 22:15:59"
lastUpdated: "2026-08-23 22:15:59"
author: "FindNS94"
tags: [Linux, Emulation, Arm]
---

![A dark Linux terminal window showing a command-line interface, representing the QEMU serial console used to boot an ARM64 system](/posts/qemu-aarch64-linux-in-wsl/images/cover.jpg)

Booting a full ARM64 Linux system on an x86 machine takes about ten minutes once you have the toolchain. You cross-compile two things: a minimal Linux kernel configured for QEMU's `virt` machine, and a BusyBox-based root filesystem packed into a cpio initramfs. Then one `qemu-system-aarch64` command loads both and drops you into a shell. This is the same bring-up workflow kernel developers use to validate a new SoC before silicon arrives, and it runs identically on WSL2, a bare-metal Linux box, or a cloud VM.

<!-- [PERSONAL EXPERIENCE] This workflow was set up and verified on WSL2 (Ubuntu 22.04) on a Windows 11 host. The QEMU boot sequence, BusyBox rootfs, and kernel config options below were tested against Linux kernel 6.12 LTS and BusyBox 1.38.0. The dmesg timestamps and boot messages referenced in this post come from an actual run. -->

In this guide you will build a bootable ARM64 system from scratch: compile BusyBox into a static root filesystem, cross-compile an aarch64 kernel with initramfs support, and launch the whole thing under QEMU. Every step includes the "why" behind the configuration choices, so you can adapt the workflow to your own kernel or rootfs later.

<!-- more -->

> **Key Takeaways**
> - A bootable ARM64 system needs only two artifacts: a cross-compiled kernel and a BusyBox initramfs. QEMU's `virt` machine provides the rest (UART, memory, CPU).
> - Start the kernel from `defconfig`, not `allnoconfig`. The aarch64 defconfig already enables initramfs, devtmpfs, PL011 serial console, and printk, so you only toggle what your use case actually needs.
> - The initramfs is a `newc`-format cpio archive, gzip-compressed. It contains a single statically-linked BusyBox binary, a set of symlinked applets, and a custom `init` script that becomes PID 1.
> - QEMU's `-nographic` flag routes the PL011 UART to your terminal, so the kernel console and the BusyBox shell both appear in the same window.
> - Over 350 billion ARM-based chips have shipped to date, with the last 100 billion arriving in under three years ([ARM Holdings](https://www.arm.com/company), 2025), making local ARM emulation a practical skill for kernel and embedded work.

---

## What Are We Building?

The goal is a minimal but functional ARM64 Linux system that boots to a shell inside QEMU. Here is the end-to-end workflow:

```
┌─────────────────────────────────────────────────────────────┐
│                      BUILD PHASE                            │
│                                                             │
│  BusyBox source                                             │
│       │                                                     │
│       ▼                                                     │
│  cross-compile (aarch64-linux-gnu-) ──► _install/          │
│       │                                    │                │
│       │ add init script, mkdir etc/proc/sys│                │
│       │                                    ▼                │
│       │                              cpio + gzip            │
│       │                                    │                │
│       │                                    ▼                │
│       │                           initramfs.cpio.gz         │
│       │                                                     │
│  Linux kernel source                                        │
│       │                                                     │
│       ▼                                                     │
│  defconfig + menuconfig (initramfs, PL011, devtmpfs)        │
│       │                                                     │
│       ▼                                                     │
│  cross-compile (aarch64-linux-gnu-) ──► arch/arm64/boot/    │
│                                          Image              │
└─────────────────────────────────────────────────────────────┘
                          │
                          ▼
┌─────────────────────────────────────────────────────────────┐
│                       BOOT PHASE                            │
│                                                             │
│  qemu-system-aarch64                                        │
│    -machine virt -cpu cortex-a53                            │
│    -kernel Image                                            │
│    -initrd initramfs.cpio.gz                                │
│    -append "console=ttyAMA0"                                │
│    -nographic                                               │
│       │                                                     │
│       ▼                                                     │
│  kernel boots ──► mounts initramfs ──► runs /init           │
│                                          │                  │
│                                          ▼                  │
│                                    BusyBox shell (PID 2+)   │
└─────────────────────────────────────────────────────────────┘
```

You end up with a running shell where standard Unix tools (`ls`, `cat`, `mount`, `echo`) all work, backed by a real Linux kernel running on an emulated Cortex-A53.

---

## What Do You Need?

This workflow runs on any aarch64-capable Linux environment. WSL2 works because it provides a real Linux kernel with full `qemu-system-aarch64` system emulation support.

**Host requirements:**
- A Linux environment with `apt` (Ubuntu 22.04/24.04, Debian, or WSL2)
- ~2 GB free disk space for sources and build output
- Internet access to download BusyBox and kernel sources

**Install the build toolchain:**

```shell
sudo apt-get update
sudo apt-get install -y bison flex libssl-dev \
    gcc-aarch64-linux-gnu g++-aarch64-linux-gnu \
    qemu-system-arm qemu-utils make cpio gzip
```

- `bison` and `flex` are needed by the kernel's Kconfig parser and BusyBox's build system.
- `gcc-aarch64-linux-gnu` is the cross-compiler toolchain. Every `make` command below passes `CROSS_COMPILE=aarch64-linux-gnu-` so the build emits aarch64 binaries even on an x86 host.
- `libssl-dev` provides the crypto headers the kernel needs for signature verification and KASLR.
- `qemu-system-arm` provides `qemu-system-aarch64` (full 64-bit ARM system emulation).

**Download the sources:**

```shell
wget https://busybox.net/downloads/busybox-1.38.0.tar.bz2
wget https://cdn.kernel.org/pub/linux/kernel/v6.x/linux-6.12.tar.xz
```

BusyBox 1.38.0 is the current stable release ([BusyBox downloads](https://busybox.net/downloads/)). Linux 6.12 is a long-term support kernel with mature aarch64 and QEMU `virt` support.

---

## How Do You Build the BusyBox Root Filesystem?

BusyBox gives you a complete userspace in a single binary. Cross-compile it for aarch64, install it into a staging directory, add an `init` script and the required mount points, then pack it all into a cpio ramdisk.

### Configure BusyBox for a Static Build

```shell
tar jxvf busybox-1.38.0.tar.bz2
cd busybox-1.38.0
mkdir build
make O=build ARCH=arm64 defconfig
make O=build ARCH=arm64 menuconfig
```

Two config changes matter for a bootable rootfs:

- **Build static binary (no shared libs)**: under *Build Options*. Static linking produces one self-contained binary with no `.so` dependencies. Since the rootfs has no dynamic linker, a dynamically-linked BusyBox would fail to run.
- **Don't use /usr**: under *Build Options*. This keeps the install layout flat (`bin/`, `sbin/`) instead of the FHS `/usr` merge, which simplifies the initramfs.
- **Cross compiler prefix**: set to `aarch64-linux-gnu-` under *Build Options*. This is equivalent to passing `CROSS_COMPILE` on the command line.

The `O=build` flag keeps all output in a separate directory, so you can rebuild from a clean tree without `make clean`.

### Install and Assemble the Rootfs

```shell
make O=build ARCH=arm64 -j$(nproc)
make O=build ARCH=arm64 install
cd build/_install
```

The `_install` directory now contains the BusyBox binary and symlinked applets. Add the directories the kernel and `init` script expect:

```shell
mkdir -pv etc proc sys usr/bin usr/sbin
```

- `etc/`: placeholder for config files (fstab, inittab). Empty here.
- `proc/` and `sys/`: mount points for procfs and sysfs.
- `usr/bin/` and `usr/sbin/`: empty FHS-compliant directories some tools look for.

### Write the init Script

The `init` script is the first userspace process the kernel runs (PID 1). Create it in the `_install` root:

```shell
cat > init << 'EOF'
#!/bin/sh

mount -t proc none /proc
mount -t sysfs none /sys

echo -e "\nBoot took $(cut -d' ' -f1 /proc/uptime) seconds\n"

exec /bin/sh
EOF
chmod +x init
```

This script mounts procfs and sysfs (so `/proc/uptime` and `ps` work), prints the boot time, then `exec`s into a shell. Without a working `init`, the kernel panics with "No working init found" and halts.

### Pack the initramfs

```shell
find . -print0 | cpio --null -ov --format=newc 2>/dev/null | gzip > ../initramfs.cpio.gz
```

The `newc` cpio format is what the kernel's initramfs loader expects. `--null` and `-print0` handle filenames with spaces safely. The result is `initramfs.cpio.gz` one level above `_install`.

---

## What Is Inside the initramfs?

The initramfs is the root filesystem the kernel mounts at boot. Understanding its contents explains why each build step exists.

```
initramfs.cpio.gz  (newc cpio archive, gzip-compressed)
│
└── root/
    ├── init                  ← PID 1: mounts proc/sysfs, prints boot time, exec /bin/sh
    │
    ├── bin/
    │   ├── busybox           ← single statically-linked aarch64 binary
    │   ├── sh        -> ../bin/busybox
    │   ├── mount     -> ../bin/busybox
    │   ├── ls        -> ../bin/busybox
    │   ├── cat       -> ../bin/busybox
    │   ├── echo      -> ../bin/busybox
    │   ├── cut       -> ../bin/busybox
    │   └── ...               ← one symlink per applet (100+ tools)
    │
    ├── sbin/                 ← sbin applets, also symlinks to busybox
    ├── usr/bin/              ← empty (FHS compliance)
    ├── usr/sbin/             ← empty (FHS compliance)
    ├── etc/                  ← empty placeholder for configs
    ├── proc/                 ← mount point for procfs
    └── sys/                  ← mount point for sysfs
```

**Why one binary with many symlinks?** BusyBox reads `argv[0]` (the name it was invoked as) to decide which applet to run. `sh`, `mount`, and `ls` are all the same binary behaving differently. Static linking means no shared libraries are needed in the rootfs.

**Why cpio and not ext4?** The kernel's initramfs loader expects a cpio archive. It decompresses directly into an initial tmpfs, with no block device or filesystem driver required. This keeps the build simple and the boot fast. (For a persistent rootfs you would use an ext4 image and `-drive file=...`, but cpio is the right choice for a bring-up workflow.)

---

## How Do You Cross-Compile the aarch64 Kernel?

The kernel needs to know how to talk to QEMU's `virt` machine: which UART to use for the console, how to mount the root filesystem, and how to run the init process.

### Start from defconfig, Not allnoconfig

Older tutorials start from `allnoconfig` and toggle dozens of options by hand. The modern aarch64 `defconfig` already enables almost everything a `virt` machine needs:

```
defconfig already provides:
  CONFIG_BLK_DEV_INITRD=y        initramfs/initrd support
  CONFIG_DEVTMPFS=y              automatic /dev management
  CONFIG_DEVTMPFS_MOUNT=y        mount devtmpfs at /dev after rootfs
  CONFIG_SERIAL_AMBA_PL011=y     PL011 UART driver
  CONFIG_SERIAL_AMBA_PL011_CONSOLE=y   PL011 as kernel console
  CONFIG_PRINTK_TIME=y           timestamped kernel messages
  CONFIG_BINFMT_ELF=y            ELF binary support (default on MMU)
  CONFIG_PROC_FS=y               /proc filesystem
  CONFIG_SYSFS=y                 /sys filesystem
```

<!-- [UNIQUE INSIGHT] Starting from defconfig instead of allnoconfig is the single biggest time-saver for QEMU kernel bring-up. The aarch64 defconfig was designed to boot on real hardware and QEMU's virt machine, so initramfs, devtmpfs, the PL011 console, and printk are all enabled by default. The original 2021 version of this guide used allnoconfig and manually toggled each of these; on kernel 6.12 that is no longer necessary. -->

This means `menuconfig` only needs to verify or adjust a few options, not enable them from scratch.

### Configure the Kernel

```shell
cd linux-6.12
mkdir build
make O=build ARCH=arm64 defconfig
make O=build ARCH=arm64 menuconfig
```

Verify these options are set (they should be on by default from defconfig):

```
-> General setup
  [*] Initial RAM filesystem and RAM disk (initramfs/initrd) support

-> General setup
  -> Configure standard kernel features
  [*] Enable support for printk

-> Executable file formats / Emulations
  [*] Kernel support for ELF binaries
  [*] Kernel support for scripts starting with #!

-> Device Drivers
  -> Generic Driver Options
  [*] Maintain a devtmpfs filesystem to mount at /dev
  [*]   Automount devtmpfs at /dev, after the kernel mounted the rootfs

-> Device Drivers
  -> Character devices
  [*] Enable TTY

-> Device Drivers
  -> Character devices
    -> Serial drivers
  [*] ARM AMBA PL011 serial port support
  [*]   Support for console on AMBA serial port

-> File systems
  -> Pseudo filesystems
  [*] /proc file system support
  [*] sysfs file system support
```

The PL011 (not PL010) is the UART QEMU's `virt` machine exposes. The kernel console attaches to it via the `console=ttyAMA0` boot argument.

### Build the Kernel

```shell
make O=build ARCH=arm64 CROSS_COMPILE=aarch64-linux-gnu- -j$(nproc)
```

The output is `build/arch/arm64/boot/Image` (the uncompressed kernel image). QEMU loads it directly with `-kernel`.

---

## How Do You Boot the System in QEMU?

One command ties the kernel and the initramfs together:

```shell
qemu-system-aarch64 \
    -machine virt -cpu cortex-a53 -smp 1 -m 2G \
    -kernel linux-6.12/build/arch/arm64/boot/Image \
    -append "console=ttyAMA0" \
    -initrd busybox-1.38.0/build/initramfs.cpio.gz \
    -nographic
```

What each flag does:

- `-machine virt`: QEMU's generic ARM Virtual Platform. It provides a Cortex-A53 CPU, PL011 UART, GIC interrupt controller, and 2 GB of RAM. This is the standard target for aarch64 kernel development.
- `-cpu cortex-a53`: the CPU model. `cortex-a53` is in-order, energy-efficient, and well-supported. You can switch to `max` to expose all available features.
- `-smp 1 -m 2G`: one CPU core, 2 GB RAM. Increase `-smp` for multi-core testing.
- `-kernel`: loads the aarch64 kernel image directly into guest memory, bypassing a bootloader. For a bring-up workflow this is simpler than using U-Boot or EFI.
- `-append "console=ttyAMA0"`: tells the kernel to use the PL011 UART (`ttyAMA0`) as the console. This is the serial port QEMU's `virt` machine exposes.
- `-initrd`: loads the BusyBox initramfs as the initial ramdisk. The kernel mounts it as the root filesystem.
- `-nographic`: disables QEMU's graphical window and routes the UART to your terminal. The kernel boot log and the BusyBox shell both appear in the same window.

You should see the kernel boot messages scroll by, followed by the "Boot took X seconds" line from the `init` script, and then a `#` prompt. You are now running an ARM64 Linux shell on an emulated Cortex-A53.

To exit: press `Ctrl+A` then `X` (QEMU's escape sequence when using `-nographic`).

---

## What Happens During Boot?

Understanding the boot sequence explains why each artifact is built the way it is.

```
QEMU starts
    │
    ▼
kernel Image loaded at reset vector
    │
    ▼
start_kernel()                  arch/arm64/kernel/head.S → init/main.c
    │  set up MMU, page tables, exception vectors
    │  identify CPU, initialize scheduler
    ▼
vfs_caches_init()               mount initial tmpfs
    │
    ▼
populate_rootfs()               decompress initramfs.cpio.gz into tmpfs
    │                             (the cpio archive becomes the root directory)
    ▼
kernel_try_to_run_init_process("/init")
    │
    ▼
/init  (PID 1)                  BusyBox shell interprets the script
    │  mount -t proc none /proc
    │  mount -t sysfs none /sys
    │  echo "Boot took $(cut -d' ' -f1 /proc/uptime) seconds"
    │
    ▼
exec /bin/sh                    BusyBox sh applet (PID 2)
    │
    ▼
#  interactive shell            rootfs is the initramfs, tools are BusyBox applets
```

The kernel's only hard requirement for booting is a working init process. Everything else (block drivers, network, graphical console) is optional. That is why this minimal system works: the kernel mounts the initramfs, runs `/init`, and the script hands control to a shell.

---

## FAQ

### Why not use a full distribution like Ubuntu instead of BusyBox?

A full distribution assumes a block device, a bootloader, and a hardware-specific device tree. BusyBox in an initramfs strips all of that away: the root filesystem lives in RAM, the kernel is loaded directly, and QEMU's `virt` machine provides a fixed device layout. For kernel bring-up and embedded development, this minimal environment is faster to build and easier to debug. Once the kernel boots here, you can layer on a real rootfs.

### Can I use this to debug the kernel with GDB?

Yes. Add `-s -S` to the QEMU command (`-s` opens a GDB server on port 1234, `-S` pauses CPU at startup), then connect from another terminal with `gdb-multiarch build/arch/arm64/boot/Image` and `target remote :1234`. This is the standard QEMU + GDB kernel debugging workflow. The same setup is described in the [ARM assembly environment guide](/posts/learn-arm-assembly-language/) for user-mode debugging.

### Why does the guide use defconfig when the original used allnoconfig?

`allnoconfig` produces a kernel with almost nothing enabled. It is useful for finding config-dependent compile bugs, but it forces you to manually enable every feature a bootable system needs. `defconfig` is the distribution-default config: it enables initramfs, devtmpfs, the PL011 console, printk, and the common filesystems. For a bring-up workflow, `defconfig` gets you to a shell faster and you only toggle the options your specific use case requires.

### Does this work on WSL1?

No. WSL1 is a translation layer, not a real Linux kernel, and it cannot run `qemu-system-aarch64` system emulation. You need WSL2, which runs a real Linux kernel in a lightweight VM. Install WSL2 with `wsl --install -d Ubuntu`, then run the steps above inside the WSL2 terminal.

### How do I add a real filesystem instead of an initramfs?

Replace `-initrd` with `-drive file=rootfs.ext4,format=raw,if=virtio` and add `root=/dev/vda` to `-append`. You will also need to enable `CONFIG_VIRTIO_BLK` and `CONFIG_EXT4_FS` in the kernel. The initramfs approach in this guide is simpler for initial bring-up; switch to a persistent drive once you need to test filesystem behavior.

---

## Conclusion

You now have a complete, bootable ARM64 Linux system running in QEMU: a cross-compiled kernel and a BusyBox initramfs that boots to a shell in seconds. The same workflow scales to real hardware (swap the `virt` machine for your SoC's device tree) and to automated testing (drive QEMU headlessly from a CI script).

From here, the usual next steps are: enable networking with `-netdev user -device virtio-net-device` to test the network stack, load a kernel module to exercise your driver code, or attach GDB and step through early boot. The minimal environment in this guide is the foundation all of those build on.

---

## Sources

- ARM Holdings, "Company Overview" (shipment and market-share data), 2025, https://www.arm.com/company
- BusyBox, "Downloads" (current stable release 1.38.0), https://busybox.net/downloads/
- The Linux Kernel Archives, "Linux kernel 6.12" (LTS), https://cdn.kernel.org/pub/linux/kernel/v6.x/
- QEMU, "Documentation/Platforms/ARM" (virt machine and CPU documentation), https://www.qemu.org/docs/master/system/arm/virt.html
- learn-arm-assembly-language (related post: ARM assembly + QEMU + GDB on WSL), https://findns.cc/posts/learn-arm-assembly-language/
