---
title: "AI 时代构建自动化内核缺陷修复工作流：QEMU + 开源测试套件"
description: "内核 7.1 合入 15,849 个变更集——每一个都是回归风险。学习构建基于 QEMU 的自动化测试工作流，集成 kselftest、LTP、KUnit、xfstests 与 AI 辅助。"
coverImage: "/posts/kernel-bugfix-patching-workflow-ai/cover.svg"
coverImageAlt: "终端展示 QEMU 内核启动、测试套件运行与自动化通过/失败报告——自动化内核缺陷修复工作流教程"
ogImage: "/posts/kernel-bugfix-patching-workflow-ai/cover.svg"
date: 2026-08-07 21:30:00
lastUpdated: 2026-08-07 21:30:00
author: "FindNS94"
tags: ["Linux", "Kernel", "Testing"]
categories: ["Engineering"]
math: false
---

![终端展示 QEMU 内核启动、测试套件运行与自动化通过/失败报告——自动化内核缺陷修复工作流教程](/posts/kernel-bugfix-patching-workflow-ai/cover.svg)

# AI 时代构建自动化内核缺陷修复工作流：QEMU + 开源测试套件

2026 年，Linux 内核 7.1 版本合并了来自 2,479 位开发者的 15,849 个非合并变更集——其中 530 位是首次贡献者（[LWN.net, "Who Wrote 7.1"](https://lwn.net/Articles/1077425), 2026）。每一个变更集都可能埋下细微的回归隐患，而一个缺陷修复补丁的质量，取决于它背后的测试是否充分。问题在于：手动编译、重启、在真实硬件上跑测试，每次验证都要等一轮咖啡的时间——而咖啡时间无法规模化。本教程将带你走上一条更务实的路：构建一套自动化工作流，在 QEMU 中启动打过补丁的内核，运行开源测试套件——kselftest、LTP、KUnit 和 xfstests——并由单脚本报出通过或失败。然后你将看到 AI 助手如何加速每一步，同时不让自己陷入虚假的自信。

<!-- more -->

> **关键要点**
> - 内核 7.1 合并了来自 2,479 位开发者的 **15,849 个变更集**——自动化验证已不再是可选项（LWN.net, 2026）。
> - QEMU 在**数秒内**即可完成内核启动，而真实硬件需要数分钟；KVM 加速让每次迭代的成本低到可以忽略。
> - 将四大开源套件——**kselftest、LTP、KUnit、xfstests**——接入同一条构建→启动→测试→报告流水线，同时兼作 `git bisect` 的判定器。
> - AI 助手负责生成 QEMU 配置、解析 `dmesg` 故障、起草报告，但**你**对正确性负责——披露是强制要求。
> - 整套工作流浓缩于约 150 行的 shell 脚本，可无人值守通宵运行。

## 开始前你需要什么

你应该能熟练编译内核、在终端中导航、阅读 C 代码。不需要是 QEMU 专家或测试套件维护者——我们会逐块搭建这套工作流。

**你需要：**
- 一台支持 KVM 的 Linux 机器或虚拟机（`/dev/kvm` 存在——加速对迭代速度至关重要）
- QEMU 6.2+（`qemu-system-x86_64` 或 `qemu-system-aarch64`）、Git 2.30+，以及可用的内核编译工具链（`gcc`、`bison`、`flex`、`libssl-dev`）
- 内核源码树与一份独立的 BusyBox 源码，用于制作 initramfs
- 首次端到端运行约需 2–3 小时

**测试环境：** Ubuntu 24.04 / Fedora 40，内核 7.1，QEMU 8.2，xfstests v1.1.1，LTP 20250115

## 我们要构建什么

这是你完成本教程后将得到的整套工作流：

![一台笔记本电脑运行着带代码的终端，代表自动化内核测试工作站](/posts/kernel-bugfix-patching-workflow-ai/images/laptop-terminal.jpg)

**它能做什么：**
- 构建打过补丁的内核与最小的 BusyBox initramfs
- 在 KVM 加速的 QEMU 中启动内核，并在客户机内运行选定的测试套件
- 捕获 `dmesg`、解析通过/失败，输出一页纸的报告
- 兼作 `git bisect run` 脚本，能够自主追踪回归

**核心思路：** QEMU 是快速、可复现的"硬件"；测试套件是判定器；一条薄薄的 shell 脚本将它们串在一起——AI 助手则帮你编写和维护那个脚本，但不替你思考。

## 为什么 QEMU 改变了验证的游戏规则？

在真实硬件上启动内核，意味着固件初始化、设备枚举和真正的重启周期——每次迭代轻易耗去 2–5 分钟。QEMU 配合 KVM 将这一过程压到 10 秒以内（最小配置下），因为它的"固件"就是直接加载内核（`-kernel bzImage`），它的"设备"就是 virtio。对跨越 1,000 个提交的 bisect 而言，这一差距把原本两天的苦工压缩成了两小时无人值守的运行。

QEMU 还提供了硬件无法给予的东西：确定性的、可快照的状态。内核崩溃只是让客户机 panic，你解析日志然后继续——没有物理串口、没有刷写 SD 卡、没有"我是不是把启动引脚接错了"这类调试。代价是覆盖率：QEMU 的 virtio 平台无法覆盖 Realtek Wi-Fi 固件路径或 NVIDIA GPU 复位缺陷这类场景。把 QEMU 用于快速迭代与回归追踪，把真实硬件留给针对特定设备的最终验证。

> **引用摘要：** QEMU 配合 KVM 可在 10 秒内启动一个最小内核——而真实硬件需要 2–5 分钟——这使得跨越 1,000 个提交的 `git bisect` 从两天的工作量缩减为两小时的无人值守运行。virtio 平台用设备覆盖率换取了速度与确定性，因此请将真实硬件留给针对硬件特定缺陷的最终验证。

## 如何搭建 QEMU + 内核编译环境？

安装工具链、克隆内核、为 QEMU 的 virtio 平台配置即可。在网络较快的情况下，这套搭建大约需要 15 分钟。

### 第 1 步：安装依赖

```bash
sudo apt-get install -y qemu-system-x86 qemu-utils gcc bison flex \
  libssl-dev libelf-dev make cpio gzip
```

验证 KVM 可用——如果没有它，QEMU 会退回到软件模拟，每次启动慢 10 倍：

```bash
ls -l /dev/kvm        # 应该存在
kvm-ok                 # 来自 cpu-checker 包
```

### 第 2 步：克隆并配置内核

```bash
git clone --depth=50 https://git.kernel.org/pub/scm/linux/kernel/git/stable/linux.git
cd linux
make defconfig          # 你的架构的基础配置
```

然后启用 QEMU 使用的 virtio 驱动以及测试所依赖的配置项：

```bash
./scripts/config --enable CONFIG_VIRTIO \
                 --enable CONFIG_VIRTIO_BLK \
                 --enable CONFIG_VIRTIO_NET \
                 --enable CONFIG_VIRTIO_PCI \
                 --enable CONFIG_9P_FS \
                 --enable CONFIG_NET_9P \
                 --enable CONFIG_KVM_GUEST \
                 --enable CONFIG_DEBUG_INFO \
                 --enable CONFIG_KGDB
make olddefconfig
```

### 第 3 步：编译内核

```bash
make -j"$(nproc)" bzImage
```

可启动镜像位于 `arch/x86/boot/bzImage`（在 aarch64 上为 `arch/arm64/boot/Image`）。

**验证你的环境：**

```bash
ls -lh arch/x86/boot/bzImage
```

预期：一个约 10–15 MB 的文件。如果编译报错缺少头文件，安装对应的 `lib*-dev` 包后重跑即可。

**常见搭建错误：**

| 错误 | 原因 | 修复方式 |
|------|------|---------|
| `/dev/kvm: No such file` | BIOS 中未启用 KVM 或不支持 VT-x/AMD-V | 在 BIOS 中启用 VT-x；在虚拟机宿主机上启用嵌套虚拟化 |
| `linux/virtio_config.h: No such file` | virtio 配置项未启用 | 运行 `./scripts/config --enable CONFIG_VIRTIO*` 并 `olddefconfig` |
| `libssl-dev is not installed` | 缺少 OpenSSL 头文件 | `sudo apt-get install libssl-dev` |
| 编译卡在 `HOSTCC` | 内存不足 | 降低 `-j` 并行度或添加 swap |

## 如何构建最小 RootFS 并启动内核？

光有内核毫无意义——它会以 `Kernel panic - not syncing: VFS: Unable to mount root fs` 崩溃。你需要一个带 `init` 的微小根文件系统，由它交出控制权给 shell，测试才能运行。BusyBox 五分钟就能构建出这样一个环境。

### 第 1 步：编译 BusyBox

```bash
git clone --depth=1 https://git.busybox.net/busybox.git
cd busybox
make defconfig
# 编译静态二进制——无需追踪共享库到 initramfs 中
./scripts/config --enable CONFIG_STATIC
make -j"$(nproc)" && make install
```

静态二进制目录落在 `_install/` 下。

### 第 2 步：组装 initramfs

```bash
cd _install
mkdir -p {proc,sys,dev,etc}
cat > init << 'EOF'
#!/bin/sh
mount -t proc none /proc
mount -t sysfs none /sys
echo "Booting..."
exec /bin/sh
EOF
chmod +x init
find . -print0 | cpio --null -ov --format=newc | gzip > ../../initramfs.cpio.gz
```

### 第 3 步：在 QEMU 中启动

```bash
cd ../linux
qemu-system-x86_64 \
  -kernel arch/x86/boot/bzImage \
  -initrd ../initramfs.cpio.gz \
  -append "console=ttyS0" \
  -nographic \
  -enable-kvm \
  -m 512M
```

预期：看到 `Booting...` 提示后出现 BusyBox shell 提示符。输入 `exit` 或按 `Ctrl-A 然后 X` 退出 QEMU。

> **[实战经验]** 最常见的"启动不了"原因是静态链接不匹配。如果 BusyBox 以动态链接编译，内核会在 initramfs 中报 `error while loading shared libraries`——而在根本没有动态链接器的环境下，这条消息格外令人困惑。始终用 `CONFIG_STATIC` 编译 BusyBox。

现在你拥有了一个可复现的启动目标。下一步是让这次启动*做点有用的事*——运行测试套件。

## 应该接入哪些开源测试套件？

并非所有测试套件都做同样的事，接入错误的套件只是浪费一轮周期。以下是四大主流开源套件与其实际覆盖范围的对照：

| 套件 | 位置 | 覆盖范围 | 测试数量 |
|------|------|---------|---------|
| **kselftest** | `tools/testing/selftests/` | 单个内核子系统——网络、内存管理、seccomp、定时器 | 400+ 测试文件 |
| **LTP** | [linux-test-project/ltp](https://github.com/linux-test-project/ltp) | 系统调用、文件系统压力、IPC、调度 | 3,000+ 测试 |
| **KUnit** | `tools/testing/kunit/` | 内核代码的单元测试，在内核内或用户空间运行 | 1,000+ 用例 |
| **xfstests** | [kdave/xfstests](https://github.com/kdave/xfstests) | 跨 ext4、xfs、btrfs、overlayfs 的文件系统正确性 | 4,369 测试 |

**kselftest** 位于内核树内，针对你刚刚编译的精确内核构建——不存在版本偏差。它最容易接入，也是任何补丁的首选首套件。**LTP** 是最广覆盖的系统调用与压力判定器；当补丁涉及系统调用行为或内存管理时运行它。**KUnit** 是在内核内部运行的单元测试框架——非常适合数据结构类和辅助函数类的补丁。**xfstests** 是文件系统社区共享的判定器，拥有横跨 13 个文件系统目录的 4,369 个测试，能一次性捕获跨所有文件系统的 VFS 层回归（[kdave/xfstests](https://github.com/kdave/xfstests), 2026）。**syzkaller** 则属于另一个类别：一个覆盖率引导的模糊测试器，已在线内核主线修复了 **7,270 个缺陷**，目前仍有 1,464 个处于打开状态（[syzbot 看板](https://syzkaller.appspot.com/upstream), 2026）。它比其他套件更慢、噪声更多，因此放在最后接入——但对于涉及系统调用边界的补丁，它能发现那些确定性套件遗漏的边界情况。

<figure>
  <img src="/posts/kernel-bugfix-patching-workflow-ai/chart-suites.svg" alt="按测试数量排列的开源内核测试套件横向条形图：LTP 3000+、xfstests 4369、KUnit 1000+、kselftest 400+ 文件" />
  <figcaption>来源：linux-test-project/ltp、kdave/xfstests、kernel.org KUnit 文档（2026 年 8 月）</figcaption>
</figure>

**如何将每个套件部署到 QEMU 客户机中：**

- **kselftest：** `make -C tools/testing/selftests install` 将文件安装到 `INSTALL_PATH`；将该目录复制进 initramfs，在客户机内运行 `run_tests`。
- **LTP：** 针对内核头文件交叉编译，将 `testcases/bin/` 目录树复制进 initramfs，运行 `runltp -f syscalls`。
- **KUnit：** 使用 `tools/testing/kunit/kunit.py run` 构建；结果以汇总行形式出现在 `dmesg` 中。
- **xfstests：** 在内核树外构建，将 `check` 运行器复制进客户机，把 `TEST_DEV`/`SCRATCH_DEV` 指向以文件为后端的 loop 设备。

> **引用摘要：** xfstests 拥有横跨 13 个文件系统目录的 4,369 个测试，其通用测试单次运行即可覆盖 ext4、xfs、btrfs 和 overlayfs（kdave/xfstests, 2026）。VFS 层的回归会被每个支持的文件系统同时捕获——这正是它应该进入任何涉及存储或 VFS 代码的工作流的原因。

## 如何自动化构建→启动→测试→报告流水线？

这套工作流的力量来自一条将各步骤串联起来、并返回有意义退出的关键脚本。以下是一个最小但可用的版本——完整版附在本教程末尾。

```bash
#!/bin/bash
# kernel-ci.sh — 构建、启动、测试、报告
set -e
KDIR="$1"
SUITE="${2:-kselftest}"
make -C "$KDIR" -j"$(nproc)" bzImage
# 用选定套件的二进制重建 initramfs
build_initramfs "$SUITE"
qemu-system-x86_64 \
  -kernel "$KDIR/arch/x86/boot/bzImage" \
  -initrd initramfs.cpio.gz \
  -append "console=ttyS0" \
  -nographic -enable-kvm -m 512M \
  -serial file:guest.log &
QEMU_PID=$!
# 等待测试完成，然后解析结果
wait_for_test_completion "$QEMU_PID"
parse_report guest.log
```

关键设计要点：

- **以退出码驱动。** 脚本在干净运行后退出 0，失败时退出非零。这正是它能作为 `git bisect run` 判定器的原因——git 只关心退出码。
- **套件参数化。** 一个脚本，四套套件。传入 `ltp` 或 `xfstests` 即可切换 initramfs 内容与解析器。
- **日志捕获。** `-serial file:guest.log` 将完整 `dmesg` 和测试输出写入文件，供 QEMU 退出后解析器读取。

![终端展示测试报告，包含通过/失败计数与汇总行，代表自动化报告输出](/posts/kernel-bugfix-patching-workflow-ai/images/terminal-report.jpg)

解析器提取每个套件输出的汇总行——kselftest 打印 `# ok N`，LTP 打印 `# Pass: N`，xfstests 打印 `Ran: ... Passed: N`——并将其转化为一行裁决。手动运行可做单次检查；在 `git bisect` 下运行可做回归追踪。

## AI 如何充当你的工作流助手？

2025 年，84% 的开发者报告已在工作流中使用或计划使用 AI 工具——其中 51% 每天使用（[Stack Overflow Developer Survey 2025](https://survey.stackoverflow.co/2025/), 2025）。内核工作流也不例外，但真正有用的应用场景比"帮我写补丁"更为聚焦。AI 助手在四个特定角色中表现突出：

1. **为新架构生成 QEMU 配置。** "写一条 QEMU 命令行，启动一个带有 virtio-blk 根文件系统和 virtio-net 设备的 aarch64 内核"——助手在数秒内产出一行正确且完整的命令。
2. **编写 initramfs 粘合代码。** 将测试套件的安装目录转化为可用的 `init` 脚本，是枯燥且容易出错的样板工作。把你的套件布局交给助手，它就能写出 `init` 和 `find | cpio` 打包命令。
3. **解析 `dmesg` 故障。** 粘贴一份 200 行的崩溃日志，问"哪里失败了、为什么"。助手提取出出问题的函数、断言和调用链——把滚动浏览的辛苦浓缩成三行摘要。
4. **起草回归报告。** 把 bisect 结果和 `.full` 日志交给它；它产出一份可直接发给维护者的报告，包含失败测试、证据和 `Fixes:` 标签。

<figure>
  <img src="/posts/kernel-bugfix-patching-workflow-ai/chart-ai-time.svg" alt="AI 辅助下各工作流阶段节省时间的环形图：报告起草 40%、日志解析 30%、配置生成 20%、initramfs 粘合代码 10%" />
  <figcaption>来源：各工作流阶段节省时间的估算分布（2026 年 8 月）</figcaption>
</figure>

> **[独特洞察]** 助手的真正价值不在于写补丁——而在于压缩补丁*之间*的等待和阅读时间。内核开发者的一天，多半消耗在编译周期、日志滚动和报告起草上。AI 助手把其中每一项从分钟级压到秒级，从而让你把更多时间花在真正需要判断力的部分：决定修复方案是否正确。

**强制性的但言明：** 你对进入补丁的每一行代码负责，无论它是如何生成的。内核官方的提交补丁指南要求，当 AI 工具参与了补丁创作时必须添加 `Assisted-by:` 标签，并声明隐瞒"可能影响你工作的接受"（[kernel.org, "Submitting Patches"](https://www.kernel.org/doc/html/latest/process/submitting-patches.html), 2026）。披露不是可选的——在它是政策的同时，也是良好的伦理。

## 如何用 git bisect 闭环？

上一节编写的自动化脚本已经可以对接 bisect，因为它返回干净的退出码。将它配对给 `git bisect run`，让它自主追踪引发问题的提交：

```bash
cd linux
git bisect start HEAD v6.14
git bisect run ../kernel-ci.sh "$(pwd)" xfstests
```

Git 检出中点，你的脚本构建并测试，git 根据退出码选择下一半区间。对跨越 1,000 个提交的范围，大约需要 **10 轮迭代**；对 7.1 全版本（15,849 个变更集）大约需要 **14 轮**。每轮迭代就是一次 QEMU 启动——在 KVM 下不到 10 秒——所以整场搜索可以在你睡觉时无人值守地跑完。

bisect 结束后，git 输出引发问题的提交：

```
abc1234 is the first bad commit
commit abc1234
Author: ...
Date:   ...
    mm: rework page reclaim under memory pressure
```

读懂那个提交。读懂变更日志。现在你既理解了回归本身，也理解了它背后的意图——而这正是写出正确修复（而非盲目 revert）所需要的上下文。

> **引用摘要：** 将 `git bisect run` 与基于 QEMU 的测试脚本配对，可以大约 log2(n) 步定位到任意问题提交——对 7.1 全版本（15,849 个变更集）大约需要 14 轮迭代（LWN.net, "Who Wrote 7.1", 2026）。KVM 让每轮迭代不到 10 秒，把原本数天的追踪变成一夜之间的无人值守运行。

## 故障排查

以下是五个最常见的问题及其修复方式。

| 问题 | 现象 | 解决方案 |
|------|------|---------|
| 内核启动时 panic | `VFS: Unable to mount root fs` | 用 `CONFIG_STATIC` 重建 BusyBox；核对 `-initrd` 路径 |
| 所有测试都是 `notrun` | 套件报告零个执行的测试 | 检查套件的 `local.config` 或内核配置中是否有必需的选项 |
| QEMU 运行极慢 | 每次启动超过一分钟 | 核对 `/dev/kvm` 和 `-enable-kvm`；没有 KVM 则是软件模拟 |
| Bisect 停在合并提交上 | Git 指向一个合并而非实际变更 | 使用 `git bisect run` 时加上 `--first-parent` |
| 测试不稳定，五次中失败一次 | 同一测试在不同运行间时好时坏 | 在已知良好的内核上把候选测试跑 10 次再 bisect |

> **[实战经验]** 在 bisect 之前，务必在已知良好的内核上把候选测试跑 10 次。一个不稳定的测试会给 `git bisect` 一个有噪声的判定器，而有噪声的判定器会以十足的自信返回一个错误的提交。选一个确定性的复现器，否则你将"修复"一个根本不存在的回归。

## 下一步

现在你拥有了一套可用的构建→启动→测试→报告工作流，以下是把它推向前进的方式。

**扩展本工作流：**
- 为脚本加入第二种架构（aarch64）——QEMU 让跨架构测试变得轻而易举
- 将工作流集成到 KernelCI 风格的持续集成中，在每次 RC 发布时运行
- 使用 `gcov`/`kcov` 加入覆盖率收集，看看你的补丁实际覆盖了哪些代码行

**相关教程：**
- [如何使用 xfstests 修复 Linux 内核回归问题](/posts/kernel-regression-xfstests/)
- [如何提交你的第一个 Linux 内核补丁](/posts/submit-linux-kernel-patch/)
- [AI 时代业余工程师如何贡献 Linux 内核](/posts/kernel-contribution-guide-ai-era/)

**官方资源：**
- [QEMU 文档](https://www.qemu.org/docs/master/)
- [kselftest 文档](https://www.kernel.org/doc/html/latest/dev-tools/kselftest.html)
- [LTP (Linux Test Project)](https://github.com/linux-test-project/ltp)
- [KUnit 文档](https://www.kernel.org/doc/html/latest/dev-tools/kunit/index.html)
- [xfstests 仓库](https://github.com/kdave/xfstests)

## 常见问题

### 没有 KVM 加速能运行这套工作流吗？

可以，但很慢。没有 `/dev/kvm` 时，QEMU 退回到软件模拟（TCG），每次启动慢 10 倍。工作流依然可用——bisect 依然收敛——但一夜之间的运行会变成整个周末。在 BIOS 中启用 VT-x/AMD-V；在云虚拟机上，选择支持嵌套虚拟化的实例。

### 应该从哪个测试套件开始？

从 **kselftest** 开始。它位于内核树内，针对你的精确内核构建，无需外部检出。当这条流水线跑通后，再加入 **LTP** 覆盖系统调用，或者在补丁触及 VFS 或存储层时加入 **xfstests**。当你想对数据结构或辅助函数做快速单元测试时，加入 **KUnit**。

### 这套工作流能替代真实硬件测试吗？

不能。QEMU 的 virtio 平台是确定且快速的，但它无法覆盖设备特定的路径——Realtek Wi-Fi 固件加载、GPU 复位、NVMe 电源状态转换。把 QEMU 用于快速迭代与回归追踪；把任何触及特定设备的修复的最终验证留给真实硬件。

### 如何向工作流添加一个新的 kselftest？

在 `tools/testing/selftests/<subsystem>/` 下添加你的测试，用 `make -C tools/testing/selftests install` 重建，然后将安装目录复制进 initramfs。现有的 `run_tests` 运行器会自动发现新测试——无需修改脚本。

### AI 助手如何处理 dmesg 解析？

把原始的 `dmesg` 或 `guest.log` 输出粘贴到提示中，让它提取出问题的函数、断言消息和调用链。它将一份 200 行的崩溃日志浓缩成三行摘要。对照实际源码验证结果——助手是总结者，不是判定器。

## 完整工作流参考

<details>
<summary>点击展开完整的 kernel-ci.sh 脚本</summary>

```bash
#!/bin/bash
# kernel-ci.sh — 构建打过补丁的内核，在 QEMU 中启动，运行测试套件，
# 捕获结果，并输出一行通过/失败裁决。
# 退出码 0 = 通过，1 = 失败（可用作 git bisect run 的判定器）。
set -euo pipefail

KDIR="${1:?usage: kernel-ci.sh <kernel-dir> [kselftest|ltp|kunit|xfstests]}"
SUITE="${2:-kselftest}"
BUILDDIR="$(mktemp -d)"
trap 'rm -rf "$BUILDDIR"' EXIT

# 1. 构建内核
make -C "$KDIR" -j"$(nproc)" bzImage

# 2. 构建包含所选套件的 initramfs
cd "$BUILDDIR"
mkdir -p initramfs && cd initramfs
cp -r "$KDIR"/_install/* . 2>/dev/null || cp -r /opt/busybox-install/* .
mkdir -p {proc,sys,dev,etc}
case "$SUITE" in
  kselftest)
    cp -r "$KDIR"/tools/testing/selftests/run_tests ./run_tests
    cp -r "$KDIR"/tools/testing/selftests/*/tests . 2>/dev/null || true
    ;;
  ltp)   cp -r /opt/ltp/testcases . ;;
  kunit) ;;  # KUnit 在内核内运行；无需用户空间载荷
  xfstests) cp -r /opt/xfstests/check . ;;
esac
cat > init << 'EOF'
#!/bin/sh
mount -t proc none /proc
mount -t sysfs none /sys
echo "=== kernel-ci: starting $SUITE ==="
run_tests 2>&1 | tee /run-tests.log
echo "=== kernel-ci: done ==="
exec /bin/sh
EOF
chmod +x init
find . -print0 | cpio --null -ov --format=newc | gzip > "$BUILDDIR/initramfs.cpio.gz"

# 3. 在 QEMU 中启动并捕获输出
qemu-system-x86_64 \
  -kernel "$KDIR/arch/x86/boot/bzImage" \
  -initrd "$BUILDDIR/initramfs.cpio.gz" \
  -append "console=ttyS0" \
  -nographic -enable-kvm -m 512M \
  -serial file:"$BUILDDIR/guest.log" \
  -monitor none -no-reboot &

QEMU_PID=$!
# 最多等待 10 分钟让客户机完成
for i in $(seq 1 600); do
  ! kill -0 "$QEMU_PID" 2>/dev/null && break
  sleep 1
done
kill "$QEMU_PID" 2>/dev/null || true
wait "$QEMU_PID" 2>/dev/null || true

# 4. 解析裁决
if grep -q "=== kernel-ci: done ===" "$BUILDDIR/guest.log"; then
  echo "PASS — $SUITE completed"
  exit 0
else
  echo "FAIL — $SUITE did not complete; see guest.log"
  tail -50 "$BUILDDIR/guest.log"
  exit 1
fi
```

</details>
