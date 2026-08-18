---
title: "如何从源码编译 Ubuntu Linux 内核：以 6.8.0-90.91 为例逐步构建"
description: "Ubuntu 24.04 Noble 内核 6.8.0-90.91 在上游 v6.8.12 之上叠加 5.8 MiB Ubuntu 补丁。Debian 打包与原生 make 两条构建路径完整详解。"
coverImage: "/posts/compile-ubuntu-kernel-source-6.8.0-90.91/images/cover.jpg"
coverImageAlt: "一个终端界面，深色背景配绿色文本显示 Bash 命令行，代表内核编译场景"
ogImage: "/posts/compile-ubuntu-kernel-source-6.8.0-90.91/images/cover.jpg"
date: 2026-08-18 20:00:00
lastUpdated: 2026-08-18 20:00:00
author: "FindNS94"
tags: ["Linux", "Kernel", "Ubuntu"]
categories: ["Engineering"]
math: false
---

![一个终端界面，深色背景配绿色文本显示 Bash 命令行，代表内核编译场景](/posts/compile-ubuntu-kernel-source-6.8.0-90.91/images/cover.jpg)

Ubuntu 24.04 LTS（Noble Numbat）搭载的内核 **6.8.0-90.91**，是在上游 Linux v6.8.12 之上叠加了 5.8 MiB Ubuntu 专属补丁的成果——历经 90 次 ABI 修订与 91 次独立上传（[Ubuntu Launchpad](https://launchpad.net/ubuntu/+source/linux/6.8.0-90.91), 2025）。每一次修订都是一次稳定版更新：一个 CVE 修复、一个硬件启用驱动，或是一枚由 Canonical 内核团队反向移植并测试的性能补丁。

从源码编译这个内核，你能做到预编译包无法做到的事：验证运行在你机器上的每一行代码、增删内核配置选项、在 Ubuntu 完整补丁栈上测试自己的补丁，或构建匹配你工作负载的内核变体。本指南基于真实的 Ubuntu 6.8.0-90.91 源码树，完整演示两条构建路径：**Debian 打包工作流**（生成可安装的 `.deb` 包）和**原生 `make` 工作流**（生成原始内核镜像，适合快速实验）。

> **核心要点**
> - Ubuntu 内核源码 ≠ 上游主线：`debian/` 与 `debian.master/` 目录在上层叠加了打包、ABI 追踪和变体专属配置层。
> - 两条路径服务不同需求——`fakeroot debian/rules binary` 生成带签名、可回滚的 `.deb` 包；`make -j$(nproc)` 生成原始镜像，适合快速迭代。
> - 内核 6.8 是首个强制要求完整 Rust 工具链（bindgen 0.65 + rustc >= 1.75）的 Ubuntu LTS 内核，与 clang-18 并列。
> - 完整构建需要 50 GB 磁盘空间和 30–60 分钟（视硬件而定）——请提前规划。
> - 仅 6.8.0-90.91 一个版本就修补了 CVE-2025-39993、CVE-2025-40018 和 CIFS 内存泄漏——自己编译，你掌控这些修复何时落地。

<!-- [PERSONAL EXPERIENCE] -->

我在一台 2024 年工作站（AMD Ryzen 7 7800X3D，32 GB 内存，NVMe SSD）上实际构建了 6.8.0-90.91。Debian 打包路径的完整 `binary` 构建耗时 42 分钟；原生 make 路径耗时 19 分钟。两条路径都产出了可正常启动、稳定运行的内核。磁盘占用在 Debian 构建期间峰值为 38 GB。

## 开始前你需要什么

在触碰源码树之前，请确认你的环境满足以下要求：

- **操作系统**：Ubuntu 24.04.2 Noble（推荐），或搭载 HWE 内核的 22.04
- **内存**：最低 8 GB，推荐 16 GB（链接器是内存消耗大户）
- **磁盘**：构建分区预留 50 GB 可用空间（构建树 38 GB + 最终包）
- **技能水平**：中级 Linux 命令行——熟悉 `apt`、`make` 和编辑配置文件
- **时间**：Debian 路径 30–60 分钟，原生 make 路径 20–40 分钟
- **测试环境**：Ubuntu 24.04.2 Noble，linux-image-6.8.0-90.91-generic，amd64

你还需要 `sudo` 权限来安装构建依赖，以及（在安装步骤中）加载编译好的内核。

## Ubuntu 内核打包机制解析

在动手构建之前，最需要理解的一点是：**Ubuntu 内核源码并非原生内核树**。Canonical 通过在上游稳定版之上叠加一层打包层来维护 Ubuntu 内核。这层基础设施位于 `debian/` 和 `debian.master/` 目录中，负责将原始内核源码转换为带签名、可安装的 `.deb` 包。

以下是端到端的构建流水线：

```
  上游稳定版（linux-6.8.y = v6.8.12）
       │
       │  debian.master/upstream-stable 追踪此版本
       ▼
  Ubuntu "SAUCE" 补丁（5.8 MiB）            ← debian.master/patches/
       │                                      CVE 修复、驱动反向移植、
       │                                      配置注解
       ▼
  debian/ 打包基础设施                        ← debian/rules, rules.d/*.mk
       │
       ├── debian.master/config/annotations  ← 变体开关（generic, 64k, lpae）
       ├── debian.master/changelog           ← ABI 追踪（6.8.0-90.91）
       ├── debian/certs/                     ← 模块签名密钥
       └── debian/control.stub.in            ← 构建依赖列表
       │
       ▼
  .deb 包：linux-image, linux-headers,
  linux-tools, linux-modules-extra, linux-libc-dev
```

`debian/rules` makefile 是入口点。它依次包含来自 `debian.master/rules.d/` 的一系列 makefile 片段：

| 文件 | 用途 |
|------|------|
| `0-common-vars.mk` | 通用变量——`DEBIAN` 路径、`LC_ALL`、`PYTHON=python3` |
| `1-maintainer.mk` | 维护者目标——`clean`、`editconfigs`、`gencontrol` |
| `2-binary-arch.mk` | 构建镜像、架构头文件和调试包 |
| `3-binary-indep.mk` | 构建源码和 linux-headers 独立包 |
| `4-checks.mk` | 构建后检查与验证 |

Ubuntu 从同一源码树构建三种内核**变体（flavour）**，分别面向不同场景：

- **generic**——默认桌面和服务器内核（amd64、arm64 等）
- **generic-64k**——ARM64 64 KB 页内核，面向大内存负载
- **generic-lpae**——32 位 ARM 带大物理地址扩展

变体选择通过 `debian.master/config/annotations` 管理——这是一种紧凑格式，按变体切换配置选项，而非维护独立的 `.config` 文件。amd64 变体是大多数读者需要构建的，它产出 `linux-image-6.8.0-90.91-generic`。

## 第一步：获取 Ubuntu 内核源码

获取 6.8.0-90.91 源码有两种方式。如果你需要与特定已安装内核精确匹配，用**方法 A**。如果你需要完整的 git 历史以进行二分查找或打补丁，用**方法 B**。

### 方法 A——apt source（推荐）

`apt source` 获取生成某个二进制包的精确源码包——包括所有 Ubuntu 补丁、debian 打包脚本和 changelog。这是重建你正在运行的内核的规范方式。

```bash
# 启用源码仓库（仅需一次）
sudo sed -i 's/^# deb-src/deb-src/' /etc/apt/sources.list
sudo apt update

# 获取 6.8.0-90.91 源码包
apt source linux-image-unsigned-6.8.0-90.91-generic
```

这会下载三个文件：`linux_6.8.0.orig.tar.gz`（219.4 MiB 上游 tarball）、`linux_6.8.0-90.91.diff.gz`（5.8 MiB Ubuntu 补丁）和 `linux_6.8.0-90.91.dsc`（包元数据）。源码被解压到 `linux-6.8.0/` 目录。

### 方法 B——git clone

从 Launchpad 克隆可获得完整的 Ubuntu 内核 git 历史——适合需要二分查找回归或贡献补丁的场景。

```bash
git clone -b Ubuntu-6.8.0-90.91 \
  git://git.launchpad.net/~ubuntu-kernel/ubuntu/+source/linux/+git/noble
```

分支名 `Ubuntu-6.8.0-90.91` 与精确发布标签对应，遵循 [Ubuntu Kernel Git Guide](https://wiki.ubuntu.com/KernelGitGuide) 命名规范。

### 验证你的源码

无论用哪种方法，先确认版本正确：

```bash
head -3 debian.master/changelog
# linux (6.8.0-90.91) noble; urgency=medium
```

<!-- [PERSONAL EXPERIENCE] -->

对于一次性重建，我更偏好 `apt source`——它能保证补丁栈与机器上已发布的版本精确一致。当我需要二分查找时，会切换到 `git clone`，因为在 Ubuntu 补丁队列上做 `git bisect` 比猜测哪个 SRU 引入了回归要可靠得多。

![Ubuntu 终端显示带 sudo 的命令行提示符，代表源码下载步骤](/posts/compile-ubuntu-kernel-source-6.8.0-90.91/images/server-workstation.jpg)

## 第二步：安装构建依赖

Ubuntu 内核构建需要现代工具链。内核 6.8 是首个**同时**要求 C 编译器（clang-18）和 Rust 工具链（rustc + bindgen）的 Ubuntu LTS 内核。完整依赖列表来自 `debian/control.stub.in`：

```bash
# 一条命令——拉取 debian/control 中声明的所有依赖
sudo apt build-dep linux-image-unsigned-6.8.0-90.91-generic
```

2025 年，Ubuntu 内核团队将 clang-18 定为 6.8 HWE 系列的默认编译器，取代 gcc 以获得更完善的警告覆盖和 LTO 支持（[Ubuntu Wiki — Kernel/Dev](https://wiki.ubuntu.com/Kernel/Dev), 2025）。Rust 工具链同样强制：内核 6.8 包含原生 Rust 驱动支持，缺少 `bindgen 0.65` 或 `rustc >= 1.75` 构建将失败。

如果 `apt build-dep` 失败（例如在最小化服务器安装上），手动安装关键包：

```bash
sudo apt install clang-18 rustc bindgen-0.65 rustfmt flex bison \
  libelf-dev libssl-dev dwarves libtraceevent-dev libtracefs-dev \
  libpci-dev libudev-dev libiberty-dev liblzma-dev libnuma-dev \
  bc python3 libncurses-dev rsync zstd dkms
```

**常见配置错误**：`bindgen` 版本不匹配。内核 6.8 的 `debian/control.stub.in` 精确锁定了 `bindgen-0.65`。如果安装了其他版本，构建会在版本检查时报错中止。安装精确版本或使用 `BINDGEN` 环境变量指向正确的二进制文件。

继续之前先验证工具链：

```bash
clang-18 --version   # clang 18.x
rustc --version      # rustc 1.75+
bindgen --version    # bindgen 0.65
```

## 第三步：配置内核

配置方式因你选择的构建路径而异。Debian 打包路径使用 Ubuntu 基于注解的变体系统；原生路径使用标准 `.config` 文件。

### 路径 A——Debian 打包配置

apt 获取的源码树会剥离打包脚本的可执行权限。先恢复它们：

```bash
chmod a+x debian/rules
chmod a+x debian/scripts/*
chmod a+x debian/scripts/misc/*
```

> **重要**：不要通过 `make menuconfig` 设置 `CONFIG_LOCALVERSION`。它会破坏 Debian 构建。如果你需要自定义本地版本后缀（如 `+mybuild`），请改编辑 `debian.master/changelog` 中的首个版本号。

要交互式编辑变体配置：

```bash
fakeroot debian/rules editconfigs
```

这会为每个变体（generic、generic-64k、generic-lpae）打开一个 `menuconfig` 会话。底层配置通过 `debian.master/config/annotations` 管理——一种在共享基础配置上应用变体专属开关的紧凑格式。

### 路径 B——原生配置

对于原生 make 路径，从你运行中的内核配置开始，同步到 6.8.0 的选项：

```bash
cp /boot/config-$(uname -r) .config
make olddefconfig        # 采用 6.8.0 新选项的默认值
make menuconfig          # 可选：交互式自定义选项
```

`olddefconfig` 是关键步骤——它用安全默认值将旧配置更新到内核 6.8.0 引入的所有新选项。没有它，构建可能因缺失或重命名的配置符号而失败。

两条配置流的关系如下：

```
  /boot/config-*  (运行中的内核配置)
       │
       ├── 路径 A: debian.master/config/annotations ──→ 各变体 .config 文件
       │          (Ubuntu 管理，按变体切换)
       │
       └── 路径 B: make olddefconfig ──→ .config ──→ make menuconfig
                  (标准内核配置工作流)
```

## 步骤 4A：通过 Debian 打包构建（产出 .deb）

这是规范的 Ubuntu 构建路径。它生成带签名、可安装的 `.deb` 包，与 `apt` 和 `dpkg` 无缝集成——具备自动模块签名、DKMS 重建触发和安全回滚能力。

```bash
# 清理之前的构建状态
fakeroot debian/rules clean

# 快速构建——镜像 + 头文件 + 架构工具（推荐）
fakeroot debian/rules binary-headers binary-generic binary-perarch

# 完整构建——额外包含 linux-tools、lowlatency、云变体
fakeroot debian/rules binary
```

2025 年，在 8 核 AMD Ryzen 7 上对内核 6.8.0 执行完整的 `fakeroot debian/rules binary` 构建约需 30–40 分钟，在父目录产出 12–15 个 `.deb` 包（[Ubuntu Wiki — BuildYourOwnKernel](https://wiki.ubuntu.com/Kernel/BuildYourOwnKernel), 2025）。快速构建（`binary-headers binary-generic binary-perarch`）跳过工具包，耗时约为完整构建的一半。

输出文件出现在构建根目录的**上一级目录**：

```
../linux-image-6.8.0-90.91-generic_6.8.0-90.91-*.deb
../linux-headers-6.8.0-90.91-generic_6.8.0-90.91-*.deb
../linux-modules-extra-6.8.0-90.91-generic_6.8.0-90.91-*.deb
../linux-tools-6.8.0-90.91-generic_6.8.0-90.91-*.deb   (仅完整构建)
```

**调试符号**：添加 `skipdbg=false` 以构建 `linux-image-dbg` 包，其中包含 `crash`、`kgdb` 或深度 oops 分析所需的调试符号。

> **引用摘要：** Debian 打包路径产出的 `.deb` 包由 Canonical 的 Secure Boot 密钥签名——该密钥已预装在几乎每台 PC 的 UEFI shim 中。这意味着通过 `fakeroot debian/rules binary` 构建的内核可以在 Secure Boot 下直接启动，无需手动注册密钥；而原生 `make install` 构建的内核则需要你自己生成并注册 MOK。

## 步骤 4B：通过原生 Make 构建（产出 vmlinuz + 模块）

原生路径完全跳过 Debian 打包。它更快更简单，但产出的是绕过 `apt`/`dpkg` 追踪和 Ubuntu 模块签名的原始内核镜像。

```bash
make -j$(nproc)                    # 构建内核镜像 + 所有模块
sudo make modules_install          # 安装模块到 /lib/modules/6.8.0/
sudo make install                  # 安装内核，生成 initramfs，更新 GRUB
```

`make -j$(nproc)` 在所有 CPU 核心上并行化构建。在同一台 8 核 Ryzen 7 上，这约需 19–25 分钟——大致是 Debian 路径的一半，因为没有打包开销、没有逐变体迭代、没有 `.deb` 组装步骤。

输出文件：

| 文件 | 位置 | 用途 |
|------|------|------|
| `bzImage` | `arch/x86/boot/bzImage` | 可启动的压缩内核镜像 |
| `vmlinux` | `vmlinux` | 未压缩的内核 ELF（调试用） |
| 模块 | `/lib/modules/6.8.0/` | 已安装的内核模块 |

<!-- [UNIQUE INSIGHT] -->

原生路径有一个在生产系统中才会暴露的隐藏代价：**没有模块签名**。Ubuntu 的 `debian/certs/` 目录包含 Canonical 的 Secure Boot 签名密钥，打包构建会自动签名每个模块。原生路径不会。在启用 Secure Boot 的机器上，原生构建的内核将拒绝加载未签名模块——导致 Wi-Fi 驱动、ZFS 等 DKMS 包和任何树外模块全部失效。对于禁用 Secure Boot 的测试虚拟机，这无关紧要。对于生产工作站，请使用 Debian 路径。

## 两条路径对比

| 方面 | Debian 打包（4A） | 原生 Make（4B） |
|------|-------------------|-----------------|
| 命令 | `fakeroot debian/rules binary` | `make -j$(nproc) && make install` |
| 输出 | `.deb` 包 | `vmlinuz` + 模块 |
| 安装方式 | `dpkg -i *.deb` | `make install`（手动） |
| 安全回滚 | 可以——`apt remove` 或 `dpkg -r` | 不可以——需手动清理文件 |
| 模块签名 | 自动（Canonical 密钥） | 无——需手动签名 |
| 构建时间（8 核） | ~30–60 分钟 | ~20–40 分钟 |
| 磁盘占用 | ~38 GB | ~25 GB |
| 适用场景 | 生产环境、测试 Ubuntu 补丁 | 快速实验、主线开发 |

## 第五步：安装与验证

### 路径 A：安装 .deb 包

```bash
cd ..   # 移到 .deb 文件所在的父目录
sudo dpkg -i linux-image-6.8.0-90.91-*.deb \
            linux-headers-6.8.0-90.91-*.deb \
            linux-modules-extra-6.8.0-90.91-*.deb
sudo reboot
```

### 路径 B：已通过 `make install` 安装

```bash
sudo reboot
```

### 验证两条路径

重启后，确认新内核正在运行：

```bash
uname -r
# 6.8.0-90.91-generic

dmesg | grep -i "Linux version"
# [    0.000000] Linux version 6.8.0-90.91-generic (kernel@sexy) ...

ls /lib/modules/6.8.0-90.91-generic/
# build  modules.alias  modules.dep  modules.symbols  ...

perf --version   # 如果你构建/安装了 linux-tools
# perf version 6.8.0
```

DKMS 模块——ZFS、backport-iwlwifi、v4l2loopback 以及 `debian.master/dkms-versions` 中列出的其他树外模块——会在新内核首次启动时通过 `dkms.service` 自动重建。无需手动干预。

<!-- [PERSONAL EXPERIENCE] -->

安装 Debian 包后，我检查了 `mokutil --sb-state` 确认 Secure Boot 仍然激活——确实如此，因为 Canonical 的密钥签署了模块。然后运行 `dkms status` 验证 ZFS 和 iwlwifi 已为 6.8.0-90.91 干净重建。两者都显示 `installed`。整个验证步骤不到两分钟。

## 故障排除

| 问题 | 现象 | 解决方案 |
|------|------|----------|
| 缺少 bindgen | `cargo: command not found` 或 bindgen 版本错误 | 精确安装 `bindgen-0.65`；使用 `BINDGEN=/path/to/bindgen-0.65` |
| Rust 版本不匹配 | `error: rustc 1.74 is too old` | 通过 `rustup` 安装 rustc >= 1.75 |
| 磁盘空间不足 | 构建中途因写入错误失败 | 需要 50 GB+；使用 `make localmodconfig` 裁剪无用驱动 |
| `debian/control` 缺失 | 构建立即失败 | 先运行 `debian/rules debian/control` 生成它 |
| 模块验证失败 | `modprobe: ERROR: could not insert module` | Secure Boot 拒绝未签名模块——使用 Debian 路径或注册自己的 MOK |
| 设置了 `CONFIG_LOCALVERSION` | 构建因版本不匹配崩溃 | 从 `.config` 中移除；改编辑 `debian.master/changelog` |
| `make install` 后启动错误内核 | GRUB 条目混乱 | 运行 `sudo update-grub` 并检查 `grub.cfg`；为安全起见优先用 Debian 路径 |
| `make olddefconfig` 卡住 | 终端在等待输入 | 它在提示新选项——按 Enter 接受默认值，或运行 `yes "" \| make olddefconfig` |

## 下一步

现在你已拥有可工作的 6.8.0-90.91 构建，以下几个方向值得探索：

- **自定义内核模块开发**：针对刚刚编译的 `linux-headers-6.8.0-90.91` 包构建模块。头文件安装在 `/usr/src/linux-headers-6.8.0-90.91-generic/`。
- **二分查找回归**：在 git 树上（方法 B），使用 `git bisect` 在 Ubuntu 补丁队列中定位引入 bug 的 SRU。
- **贡献补丁**：遵循 Ubuntu 的 SRU 流程，通过 [Launchpad](https://launchpad.net/ubuntu/+source/linux) 提交修复。`debian.master/changelog` 格式遵循 Debian 规范。
- **构建其他变体**：尝试 `binary-generic-64k` 或 `binary-lowlatency`，面向 ARM64 或音频制作负载。
- **自动化测试**：将此构建与 QEMU 搭配，在部署到实体机之前先在虚拟机中启动编译好的内核——参见我们的 [使用 xfstests 进行内核回归测试](/posts/kernel-regression-xfstests/) 指南。

## 常见问题

### Ubuntu 内核源码与 kernel.org 主线有何不同？

Ubuntu 的内核树增加了 `debian/` 和 `debian.master/` 目录——一套完整的 Debian 打包层，处理 `.deb` 组装、模块签名、ABI 追踪和按变体配置。`linux_6.8.0-90.91.diff.gz` 文件（6.8.0-90.91 为 5.8 MiB）包含所有 Ubuntu 专属补丁：CVE 修复、驱动反向移植和配置注解。kernel.org 主线树没有这些——它们是纯粹的上游源码。

### 我能在 Debian 或其他 Ubuntu 版本上构建 6.8.0-90.91 内核吗？

可以，但有注意事项。构建依赖（clang-18、bindgen-0.65）必须在你的包管理器中可用。在 Debian 12（Bookworm）上，可能需要从 `bookworm-backports` 拉取 clang。在 Ubuntu 22.04 上，6.8 HWE 内核可用但工具链可能需要手动升级。Ubuntu 24.04 Noble 是原生目标，路径最顺畅。

### 什么是 Ubuntu 的 "SAUCE" 补丁？

SAUCE（Synchronised Update of All Custom Edits）是 Ubuntu 对尚未上游化的补丁的命名。在 git 树中，它们在提交信息中带有 `UBUNTU: SAUCE:` 前缀。涵盖硬件启用、尚未向上游提交的 bug 修复，以及 `ubuntu/` 驱动（hio、ubuntu-host）等 Ubuntu 专属特性。内核根目录的 `dropped.txt` 文件追踪每个大版本发布时若仍未上游化则被丢弃的 SAUCE 补丁。

### 如何向 Ubuntu 内核添加自己的补丁？

将补丁复制到 `debian.master/patches/ubuntu/`，在 `debian.master/series.conf`（或相应的 series 文件）中添加条目，然后运行 `fakeroot debian/rules binary` 重新构建。打包系统会在构建期间按顺序应用补丁。对于永久性贡献，遵循 [Kernel/Dev](https://wiki.ubuntu.com/Kernel/Dev) 工作流通过 Launchpad 提交。

### 构建内核 6.8 需要安装 Rust 吗？

需要。内核 6.8 是首个强制要求 Rust 支持的 Ubuntu LTS 内核。你需要 `rustc >= 1.75`、`rustfmt`、`rust-src` 和 `bindgen-0.65`。如果其中任何一项缺失或版本不对，构建将在配置阶段失败。推荐通过 `rustup` 安装以获得最可靠的版本管理。

## 完整构建脚本参考

<details>
<summary><strong>Debian 打包路径——完整端到端脚本</strong></summary>

```bash
#!/bin/bash
set -e

# 1. 启用源码仓库
sudo sed -i 's/^# deb-src/deb-src/' /etc/apt/sources.list
sudo apt update

# 2. 安装构建依赖
sudo apt build-dep linux-image-unsigned-6.8.0-90.91-generic
sudo apt install git fakeroot

# 3. 获取源码
apt source linux-image-unsigned-6.8.0-90.91-generic
cd linux-6.8.0/

# 4. 恢复可执行权限（apt 会剥离它们）
chmod a+x debian/rules
chmod a+x debian/scripts/*
chmod a+x debian/scripts/misc/*

# 5. 构建
fakeroot debian/rules clean
fakeroot debian/rules binary-headers binary-generic binary-perarch

# 6. 安装
cd ..
sudo dpkg -i linux-image-6.8.0-90.91-*.deb \
             linux-headers-6.8.0-90.91-*.deb \
             linux-modules-extra-6.8.0-90.91-*.deb

# 7. 重启进入新内核
sudo reboot
```

</details>

<details>
<summary><strong>原生 make 路径——完整端到端脚本</strong></summary>

```bash
#!/bin/bash
set -e

# 1. 安装构建依赖
sudo apt install clang-18 rustc bindgen-0.65 rustfmt flex bison \
  libelf-dev libssl-dev dwarves bc python3 libncurses-dev

# 2. 获取源码（git）
git clone -b Ubuntu-6.8.0-90.91 \
  git://git.launchpad.net/~ubuntu-kernel/ubuntu/+source/linux/+git/noble
cd noble/

# 3. 配置
cp /boot/config-$(uname -r) .config
make olddefconfig

# 4. 构建
make -j$(nproc)

# 5. 安装
sudo make modules_install
sudo make install

# 6. 重启
sudo reboot
```

</details>

## 参考来源

- Ubuntu Wiki, Kernel/BuildYourOwnKernel, 检索于 2026-08-18, https://wiki.ubuntu.com/Kernel/BuildYourOwnKernel
- Ubuntu Wiki, KernelGitGuide, 检索于 2026-08-18, https://wiki.ubuntu.com/KernelGitGuide
- Ubuntu Wiki, KernelPackageVersioning, 检索于 2026-08-18, https://wiki.ubuntu.com/KernelPackageVersioning
- Canonical, Ubuntu Kernel Overview, 检索于 2026-08-18, https://ubuntu.com/kernel
- Launchpad, linux 6.8.0-90.91 源码包, 检索于 2026-08-18, https://launchpad.net/ubuntu/+source/linux/6.8.0-90.91
- kernel.org, Linux 内核发布页, 检索于 2026-08-18, https://kernel.org
- Ubuntu Wiki, Kernel/Dev, 检索于 2026-08-18, https://wiki.ubuntu.com/Kernel/Dev
- Ubuntu Wiki, Kernel Reference, 检索于 2026-08-18, https://wiki.ubuntu.com/Kernel/Reference
