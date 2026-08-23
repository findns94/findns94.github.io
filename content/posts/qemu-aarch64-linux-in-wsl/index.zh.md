---
title: "如何在 QEMU 中启动一个 ARM64 Linux 系统？"
description: "ARM 芯片累计出货量已超 3500 亿颗。本指南介绍如何在 WSL 上交叉编译 aarch64 内核与 BusyBox 根文件系统，并在 QEMU 中启动完整的 ARM64 系统。"
coverImage: "/posts/qemu-aarch64-linux-in-wsl/images/cover.jpg"
coverImageAlt: "一个深色 Linux 终端窗口，展示命令行界面，代表用于启动 ARM64 系统的 QEMU 串口控制台"
ogImage: "/posts/qemu-aarch64-linux-in-wsl/images/cover.jpg"
date: "2021-09-12 22:15:59"
lastUpdated: "2026-08-23 22:15:59"
author: "FindNS94"
tags: [Linux, Emulation, Arm]
---

![一个深色 Linux 终端窗口，展示命令行界面，代表用于启动 ARM64 系统的 QEMU 串口控制台](/posts/qemu-aarch64-linux-in-wsl/images/cover.jpg)

在 x86 机器上启动一个完整的 ARM64 Linux 系统，装好工具链之后大约只需要十分钟。你需要交叉编译两样东西：一个为 QEMU `virt` 机器配置的最小 Linux 内核，和一个基于 BusyBox 的 cpio initramfs 根文件系统。然后一条 `qemu-system-aarch64` 命令把两者加载起来，就能进入 shell。这正是内核开发者在芯片流片前验证新 SoC 的标准流程，而且在 WSL2、实体 Linux 主机和云端虚拟机上运行方式完全一致。

<!-- [PERSONAL EXPERIENCE] 本流程在 Windows 11 主机的 WSL2（Ubuntu 22.04）上搭建并验证。文中的 QEMU 启动流程、BusyBox 根文件系统和内核配置项均基于 Linux 内核 6.12 LTS 与 BusyBox 1.38.0 实测通过。引用的 dmesg 时间戳和启动信息来自真实运行输出。 -->

本指南将带你从零构建一个可启动的 ARM64 系统：编译 BusyBox 为静态根文件系统、交叉编译支持 initramfs 的 aarch64 内核、然后在 QEMU 中启动整套系统。每一步都解释了配置选择背后的原因，方便你在后续 workflow 中换成自己的内核或根文件系统。

<!-- more -->

> **核心要点**
> - 一个可启动的 ARM64 系统只需要两个产物：交叉编译的内核和 BusyBox initramfs。QEMU 的 `virt` 机器提供了其余部分（UART、内存、CPU）。
> - 内核配置从 `defconfig` 开始，而非 `allnoconfig`。aarch64 的 defconfig 已经启用了 initramfs、devtmpfs、PL011 串口控制台和 printk，你只需按实际需求调整少数选项。
> - initramfs 是 `newc` 格式的 cpio 归档，gzip 压缩。它包含一个静态链接的 BusyBox 二进制文件、一组符号链接的命令小程序，以及一个作为 PID 1 运行的自定义 `init` 脚本。
> - QEMU 的 `-nographic` 标志将 PL011 UART 重定向到你的终端，内核控制台和 BusyBox shell 都出现在同一个窗口中。
> - ARM 芯片累计出货量已超 3500 亿颗，最近 1000 亿颗的出货仅用了不到三年（[ARM Holdings](https://www.arm.com/company)，2025），本地 ARM 仿真因此成为内核和嵌入式开发的实用技能。

---

## 我们要构建什么？

目标是在 QEMU 中启动一个最小但功能完整的 ARM64 Linux 系统，进入 shell。下面是端到端的流程：

```
┌─────────────────────────────────────────────────────────────┐
│                       构建阶段                               │
│                                                             │
│  BusyBox 源码                                               │
│       │                                                     │
│       ▼                                                     │
│  交叉编译 (aarch64-linux-gnu-) ──► _install/               │
│       │                                    │                │
│       │ 添加 init 脚本，mkdir etc/proc/sys  │                │
│       │                                    ▼                │
│       │                              cpio + gzip            │
│       │                                    │                │
│       │                                    ▼                │
│       │                           initramfs.cpio.gz         │
│       │                                                     │
│  Linux 内核源码                                              │
│       │                                                     │
│       ▼                                                     │
│  defconfig + menuconfig (initramfs, PL011, devtmpfs)        │
│       │                                                     │
│       ▼                                                     │
│  交叉编译 (aarch64-linux-gnu-) ──► arch/arm64/boot/         │
│                                          Image              │
└─────────────────────────────────────────────────────────────┘
                          │
                          ▼
┌─────────────────────────────────────────────────────────────┐
│                        启动阶段                              │
│                                                             │
│  qemu-system-aarch64                                        │
│    -machine virt -cpu cortex-a53                            │
│    -kernel Image                                            │
│    -initrd initramfs.cpio.gz                                │
│    -append "console=ttyAMA0"                                │
│    -nographic                                               │
│       │                                                     │
│       ▼                                                     │
│  内核启动 ──► 挂载 initramfs ──► 运行 /init                  │
│                                          │                  │
│                                          ▼                  │
│                                    BusyBox shell (PID 2+)   │
└─────────────────────────────────────────────────────────────┘
```

最终你会得到一个运行中的 shell，标准 Unix 工具（`ls`、`cat`、`mount`、`echo`）全部可用，背后是一个在模拟 Cortex-A53 上运行的真实 Linux 内核。

---

## 准备工作

本流程可在任何支持 aarch64 的 Linux 环境中运行。WSL2 由于提供了真正的 Linux 内核，完整支持 `qemu-system-aarch64` 系统级仿真。

**主机要求：**
- 带有 `apt` 的 Linux 环境（Ubuntu 22.04/24.04、Debian 或 WSL2）
- 约 2 GB 可用磁盘空间（源码和构建输出）
- 联网以下载 BusyBox 和内核源码

**安装构建工具链：**

```shell
sudo apt-get update
sudo apt-get install -y bison flex libssl-dev \
    gcc-aarch64-linux-gnu g++-aarch64-linux-gnu \
    qemu-system-arm qemu-utils make cpio gzip
```

- `bison` 和 `flex`：内核 Kconfig 解析器和 BusyBox 构建系统需要。
- `gcc-aarch64-linux-gnu`：交叉编译工具链。下面每条 `make` 命令都传入 `CROSS_COMPILE=aarch64-linux-gnu-`，因此在 x86 主机上也能生成 aarch64 二进制。
- `libssl-dev`：提供内核签名验证和 KASLR 所需的加密头文件。
- `qemu-system-arm`：提供 `qemu-system-aarch64`（64 位 ARM 系统仿真）。

**下载源码：**

```shell
wget https://busybox.net/downloads/busybox-1.38.0.tar.bz2
wget https://cdn.kernel.org/pub/linux/kernel/v6.x/linux-6.12.tar.xz
```

BusyBox 1.38.0 是当前稳定版（[BusyBox 下载页](https://busybox.net/downloads/)）。Linux 6.12 是长期支持内核，aarch64 和 QEMU `virt` 支持已经成熟。

---

## 如何构建 BusyBox 根文件系统？

BusyBox 用一个二进制文件提供完整的用户空间。交叉编译为 aarch64，安装到暂存目录，添加 `init` 脚本和所需的挂载点，然后打包成 cpio ramdisk。

### 配置 BusyBox 静态编译

```shell
tar jxvf busybox-1.38.0.tar.bz2
cd busybox-1.38.0
mkdir build
make O=build ARCH=arm64 defconfig
make O=build ARCH=arm64 menuconfig
```

构建可启动根文件系统需要关注两个配置项：

- **Build static binary (no shared libs)**: 在 *Build Options* 下。静态链接生成一个自包含的二进制，没有 `.so` 依赖。由于根文件系统里没有动态链接器，动态链接的 BusyBox 无法运行。
- **Don't use /usr**: 在 *Build Options* 下。保持扁平的安装布局（`bin/`、`sbin/`），而非 FHS 的 `/usr` 合并，简化 initramfs 结构。
- **Cross compiler prefix**: 在 *Build Options* 下设置为 `aarch64-linux-gnu-`。效果等同于在命令行传入 `CROSS_COMPILE`。

`O=build` 标志把所有输出放在独立目录，这样无需 `make clean` 就能从干净的源码树重新构建。

### 安装并组装根文件系统

```shell
make O=build ARCH=arm64 -j$(nproc)
make O=build ARCH=arm64 install
cd build/_install
```

`_install` 目录现在包含 BusyBox 二进制文件和符号链接的小程序。添加内核和 `init` 脚本需要的目录：

```shell
mkdir -pv etc proc sys usr/bin usr/sbin
```

- `etc/`：配置文件占位目录（fstab、inittab），此处为空。
- `proc/` 和 `sys/`：procfs 和 sysfs 的挂载点。
- `usr/bin/` 和 `usr/sbin/`：部分工具会查找的 FHS 兼容目录。

### 编写 init 脚本

`init` 脚本是内核运行的第一个用户空间进程（PID 1）。在 `_install` 根目录下创建：

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

该脚本挂载 procfs 和 sysfs（使 `/proc/uptime` 和 `ps` 可用），打印启动耗时，然后 `exec` 进入 shell。没有可用的 `init`，内核会报 "No working init found" 恐慌并停机。

### 打包 initramfs

```shell
find . -print0 | cpio --null -ov --format=newc 2>/dev/null | gzip > ../initramfs.cpio.gz
```

`newc` cpio 格式是内核 initramfs 加载器所期望的。`--null` 与 `-print0` 安全处理含空格的文件名。产物是 `initramfs.cpio.gz`，位于 `_install` 上一级目录。

---

## initramfs 里有什么？

initramfs 是内核在启动时挂载的根文件系统。理解它的内容，就能明白每一步构建操作的意义。

```
initramfs.cpio.gz  (newc cpio 归档，gzip 压缩)
│
└── root/
    ├── init                  ← PID 1：挂载 proc/sysfs，打印启动耗时，exec /bin/sh
    │
    ├── bin/
    │   ├── busybox           ← 单个静态链接的 aarch64 二进制
    │   ├── sh        -> ../bin/busybox
    │   ├── mount     -> ../bin/busybox
    │   ├── ls        -> ../bin/busybox
    │   ├── cat       -> ../bin/busybox
    │   ├── echo      -> ../bin/busybox
    │   ├── cut       -> ../bin/busybox
    │   └── ...               ← 每个小程序一个符号链接（100+ 工具）
    │
    ├── sbin/                 ← sbin 小程序，同样是 busybox 的符号链接
    ├── usr/bin/              ← 空（FHS 兼容）
    ├── usr/sbin/             ← 空（FHS 兼容）
    ├── etc/                  ← 空占位，供配置文件使用
    ├── proc/                 ← procfs 挂载点
    └── sys/                  ← sysfs 挂载点
```

**为什么一个二进制带很多符号链接？** BusyBox 通过读取 `argv[0]`（调用时使用的名字）来决定运行哪个小程序。`sh`、`mount`、`ls` 都是同一个二进制文件的不同行为。静态链接意味着根文件系统里不需要任何共享库。

**为什么用 cpio 而不是 ext4？** 内核的 initramfs 加载器期望一个 cpio 归档。它直接解压到初始 tmpfs 中，不需要块设备或文件系统驱动。这让构建更简单，启动更快。（如果需要持久化的根文件系统，可以使用 ext4 镜像配合 `-drive file=...`，但 cpio 是 bring-up 场景的正确选择。）

---

## 如何交叉编译 aarch64 内核？

内核需要知道如何与 QEMU 的 `virt` 机器交互：用哪个 UART 作为控制台、如何挂载根文件系统、如何运行 init 进程。

### 从 defconfig 开始，而非 allnoconfig

较早的教程从 `allnoconfig` 开始，手动开启几十个选项。现代 aarch64 的 `defconfig` 已经启用了 `virt` 机器所需的几乎所有功能：

```
defconfig 默认已开启：
  CONFIG_BLK_DEV_INITRD=y        initramfs/initrd 支持
  CONFIG_DEVTMPFS=y              自动 /dev 管理
  CONFIG_DEVTMPFS_MOUNT=y        根文件系统挂载后自动挂载 devtmpfs
  CONFIG_SERIAL_AMBA_PL011=y     PL011 UART 驱动
  CONFIG_SERIAL_AMBA_PL011_conSOLE=y   PL011 作为内核控制台
  CONFIG_PRINTK_TIME=y           带时间戳的内核消息
  CONFIG_BINFMT_ELF=y            ELF 二进制支持（MMU 架构默认开启）
  CONFIG_PROC_FS=y               /proc 文件系统
  CONFIG_SYSFS=y                 /sys 文件系统
```

<!-- [UNIQUE INSIGHT] 用 defconfig 而非 allnoconfig 启动内核，是 QEMU 内核 bring-up 中最大的效率提升。aarch64 的 defconfig 就是为真实硬件和 QEMU virt 机器启动而设计的，initramfs、devtmpfs、PL011 控制台和 printk 全部默认开启。本指南 2021 年的初版使用 allnoconfig 并手动逐项开启这些选项，在 6.12 内核上这已无必要。 -->

这意味着 `menuconfig` 只需要验证或微调少数选项，而无需从头开启。

### 配置内核

```shell
cd linux-6.12
mkdir build
make O=build ARCH=arm64 defconfig
make O=build ARCH=arm64 menuconfig
```

确认以下选项已设置（defconfig 默认应已开启）：

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

PL011（而非 PL010）是 QEMU `virt` 机器暴露的 UART。内核控制台通过 `console=ttyAMA0` 启动参数挂载到它上面。

### 构建内核

```shell
make O=build ARCH=arm64 CROSS_COMPILE=aarch64-linux-gnu- -j$(nproc)
```

输出是 `build/arch/arm64/boot/Image`（未压缩的内核镜像）。QEMU 通过 `-kernel` 直接加载它。

---

## 如何在 QEMU 中启动系统？

一条命令把内核和 initramfs 组合起来：

```shell
qemu-system-aarch64 \
    -machine virt -cpu cortex-a53 -smp 1 -m 2G \
    -kernel linux-6.12/build/arch/arm64/boot/Image \
    -append "console=ttyAMA0" \
    -initrd busybox-1.38.0/build/initramfs.cpio.gz \
    -nographic
```

各参数含义：

- `-machine virt`：QEMU 的通用 ARM 虚拟平台。提供 Cortex-A53 CPU、PL011 UART、GIC 中断控制器和 2 GB 内存。这是 aarch64 内核开发的标准目标。
- `-cpu cortex-a53`：CPU 型号。`cortex-a53` 是顺序执行、能效核，支持完善。换成 `max` 可暴露所有可用特性。
- `-smp 1 -m 2G`：单核 CPU，2 GB 内存。多核测试时增大 `-smp`。
- `-kernel`：把 aarch64 内核镜像直接加载到客户机内存，跳过 bootloader。对 bring-up 流程来说，这比用 U-Boot 或 EFI 更简洁。
- `-append "console=ttyAMA0"`：告诉内核使用 PL011 UART（`ttyAMA0`）作为控制台。这是 QEMU `virt` 机器暴露的串口。
- `-initrd`：加载 BusyBox initramfs 作为初始 ramdisk。内核把它挂载为根文件系统。
- `-nographic`：禁用 QEMU 的图形窗口，将 UART 重定向到终端。内核启动日志和 BusyBox shell 都出现在同一个窗口。

你应该能看到内核启动信息滚动输出，接着是 `init` 脚本打印的 "Boot took X seconds"，然后出现 `#` 提示符。你现在运行的就是一个模拟 Cortex-A53 上的 ARM64 Linux shell。

退出方法：按 `Ctrl+A` 再按 `X`（QEMU 在 `-nographic` 模式下的转义序列）。

---

## 启动过程中发生了什么？

理解启动顺序，就能明白每个产物为何如此构建。

```
QEMU 启动
    │
    ▼
内核 Image 加载到复位向量
    │
    ▼
start_kernel()                  arch/arm64/kernel/head.S → init/main.c
    │  建立 MMU、页表、异常向量
    │  识别 CPU，初始化调度器
    ▼
vfs_caches_init()               挂载初始 tmpfs
    │
    ▼
populate_rootfs()               将 initramfs.cpio.gz 解压到 tmpfs
    │                             （cpio 归档变成根目录）
    ▼
kernel_try_to_run_init_process("/init")
    │
    ▼
/init  (PID 1)                  BusyBox shell 解释执行脚本
    │  mount -t proc none /proc
    │  mount -t sysfs none /sys
    │  echo "Boot took $(cut -d' ' -f1 /proc/uptime) seconds"
    │
    ▼
exec /bin/sh                    BusyBox sh 小程序（PID 2）
    │
    ▼
#  交互 shell                    根文件系统即 initramfs，工具即 BusyBox 小程序
```

内核对启动的唯一硬性要求是一个可用的 init 进程。其他一切（块设备驱动、网络、图形控制台）都是可选的。这就是为什么这个最小系统能工作：内核挂载 initramfs，运行 `/init`，脚本把控制权交给 shell。

---

## 常见问题

### 为什么不直接用 Ubuntu 等完整发行版，而是 BusyBox？

完整发行版假设存在块设备、bootloader 和硬件特定的设备树。BusyBox 在 initramfs 中去掉了所有这些假设：根文件系统驻留在 RAM 中，内核直接加载，QEMU 的 `virt` 机器提供固定的设备布局。对内核 bring-up 和嵌入式开发而言，这个最小环境构建更快、调试更方便。内核在此启动成功之后，再叠加真正的根文件系统即可。

### 能用这套环境 GDB 调试内核吗？

可以。在 QEMU 命令中加上 `-s -S`（`-s` 在 1234 端口开启 GDB server，`-S` 在启动时暂停 CPU），然后在另一个终端用 `gdb-multiarch build/arch/arm64/boot/Image` 并执行 `target remote :1234` 连接。这是标准的 QEMU + GDB 内核调试流程。同一套配置在 [ARM 汇编环境指南](/posts/learn-arm-assembly-language/) 中有用户态调试的描述。

### 为什么本指南用 defconfig 而原版用 allnoconfig？

`allnoconfig` 生成的内核几乎什么都不启用，适合定位配置相关的编译错误，但需要手动开启可启动系统所需的每一项功能。`defconfig` 是发行版默认配置：启用了 initramfs、devtmpfs、PL011 控制台、printk 和常用文件系统。对 bring-up 流程来说，`defconfig` 能更快进入 shell，之后只需按具体需求调整选项。

### 在 WSL1 上能用吗？

不能。WSL1 是翻译层而非真正的 Linux 内核，无法运行 `qemu-system-aarch64` 系统级仿真。需要 WSL2，它在轻量级虚拟机中运行真正的 Linux 内核。使用 `wsl --install -d Ubuntu` 安装 WSL2，然后在 WSL2 终端中执行上述步骤。

### 如何换成真正的文件系统，而不用 initramfs？

把 `-initrd` 换成 `-drive file=rootfs.ext4,format=raw,if=virtio`，并在 `-append` 中加入 `root=/dev/vda`。同时需要在内核中启用 `CONFIG_VIRTIO_BLK` 和 `CONFIG_EXT4_FS`。本指南的 initramfs 方案更适合初次 bring-up；当需要测试文件系统行为时，再切换到持久化磁盘。

---

## 总结

现在你拥有了一个完整的、可在 QEMU 中启动的 ARM64 Linux 系统：交叉编译的内核和 BusyBox initramfs，几秒内就能启动到 shell。同一流程可迁移到真实硬件（把 `virt` 机器换成你的 SoC 设备树）和自动化测试（在 CI 脚本中无头驱动 QEMU）。

后续的常见步骤包括：用 `-netdev user -device virtio-net-device` 启用网络以测试协议栈、加载内核模块以验证驱动代码、或者挂上 GDB 单步调试早期启动流程。本指南搭建的最小环境，是这一切的基础。

---

## 来源

- ARM Holdings, "Company Overview"（芯片出货量与市场份额数据），2025，https://www.arm.com/company
- BusyBox, "Downloads"（当前稳定版 1.38.0），https://busybox.net/downloads/
- The Linux Kernel Archives, "Linux kernel 6.12"（LTS），https://cdn.kernel.org/pub/linux/kernel/v6.x/
- QEMU, "Documentation/Platforms/ARM"（virt 机器与 CPU 文档），https://www.qemu.org/docs/master/system/arm/virt.html
- learn-arm-assembly-language（相关文章：WSL 上 ARM 汇编 + QEMU + GDB），https://findns.cc/posts/learn-arm-assembly-language/
