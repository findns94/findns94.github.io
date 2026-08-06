---
title: "如何使用 xfstests 修复 Linux 内核回归问题：2026 实战教程"
description: "xfstests 拥有覆盖 13 种文件系统的 4,369 个测试用例。本教程演示如何用 xfstests 作为判定内核文件系统回归的准则，完成复现、二分定位、验证与报告的全流程。"
coverImage: "/posts/kernel-regression-xfstests/cover.svg"
coverImageAlt: "终端展示 xfstests 回归排查：ext4 测试失败、git bisect 定位问题提交、修复验证通过——xfstests 内核回归教程"
ogImage: "/posts/kernel-regression-xfstests/cover.svg"
date: 2026-08-06 19:45:00
lastUpdated: 2026-08-06 19:45:00
author: "FindNS94"
tags: ["Linux", "Kernel", "Testing"]
categories: ["Engineering"]
math: false
---

![终端展示 xfstests 回归排查：ext4 测试失败、git bisect 定位问题提交、修复验证通过——xfstests 内核回归教程](/posts/kernel-regression-xfstests/cover.svg)

# 如何使用 xfstests 修复 Linux 内核回归问题：2026 实战教程

2026 年，Linux 内核 7.1 版本合并了来自 2,479 名开发者的 15,849 个非合并变更集——其中 530 人是首次贡献者（[LWN.net, "Who Wrote 7.1"](https://lwn.net/Articles/1077425), 2026）。每一个变更集都可能成为埋下隐患的种子。当一个文件系统在合入三个月后静默地返回错误数据或损坏元数据时，仅靠 `printk` 是不够的——你需要一个可复现的判定准则。这正是 xfstests 的用武之地。xfstests 最初是为测试 SGI Irix 上的 XFS 文件系统而开发的，如今已成长为 Linux 文件系统社区共享的回归测试套件，覆盖 13 个文件系统目录、共计 **4,369 个测试用例**（[kdave/xfstests](https://github.com/kdave/xfstests), 2026）。本教程将带你走完全流程：用一个失败的测试复现回归、用 `git bisect` 定位问题提交、验证修复、并提交报告，确保问题不再复发。

<!-- more -->

> **要点速览**
> - xfstests 拥有覆盖 13 种文件系统的 **4,369 个测试用例**——内核社区最大的共享文件系统回归判定准则（kdave/xfstests, 2026）。
> - 一个失败的测试就是你的回归复现器；`.full` 日志就是你的证据。
> - 将 `git bisect run` 与 xfstests 包装脚本配合使用，可在约 **log2(n)** 步内定位任意问题提交——整个内核发布版本只需约 14 次运行。
> - 修复后务必跑完整测试组，在提交报告前发现连带影响。
> - 通过 `get_maintainer.pl` 和 `git send-email` 向子系统维护者报告回归——切勿使用 Gmail 网页端发送。

## 开始前你需要什么

你应该能熟练编译内核、操作终端、阅读 C 代码。不需要是文件系统内部实现的专家——很多回归排查者都是从运行测试而非编写测试开始的。

**你需要准备：**
- 一台支持 KVM 加速的 Linux 机器或虚拟机（加速对二分排查速度至关重要）
- Git 2.30 以上版本及可用的内核编译工具链
- 两个 git 仓库：内核源码树和独立的 xfstests 检出目录
- `fsgqa` 测试用户/用户组（xfstests 安装时创建）
- 首次端到端回归排查预计需要 2–4 小时

**测试环境：** Ubuntu 24.04 / Fedora 40, kernel 7.1, xfstests v1.1.1

## 你将建立什么

以下是完成本教程后你将掌握的完整工作流：

![机房服务器机架，代表文件系统回归在生产环境中浮现的基础设施](/posts/kernel-regression-xfstests/images/cover-server-room.png)

**它能做什么：**
- 用一个确定性的 xfstests 测试复现文件系统回归
- 以 xfstests 为判定准则自动化 `git bisect`
- 修复后跑完整测试组验证，防止引入新的回归
- 生成整洁的提交并发送给正确的维护者

**核心思路：** xfstests 是判定准则，`git bisect` 是搜索算法。二者结合，能把一句模糊的"文件系统坏了"转化为一个具体提交哈希和一份经过验证的修复。

## 为什么 xfstests 能抓住其他测试套件漏掉的回归？

2026 年，xfstests 覆盖 **13 个文件系统目录**——xfs（1,624 个测试）、generic（1,600）、btrfs（701）、overlay（213）、ext4（146）等（[kdave/xfstests](https://github.com/kdave/xfstests), 2026）。这种广度正是关键所在：一个"generic" 测试可一次性对 ext4、xfs、btrfs 和 overlayfs 运行，因此一个破坏元数据的 VFS 层变更会被所有文件系统一并捕获。

该套件将测试分为三个层级。**通用测试**（`tests/generic/`）验证 POSIX 语义——`open`、`rename`、`mmap`、`fsync`——每个文件系统都必须遵守。**各文件系统专属测试**（`tests/xfs/`、`tests/ext4/`、`tests/btrfs/`）探测子系统特有行为，如 XFS 的实时扩展或 btrfs 的子卷。**共享测试**曾存放在 `tests/shared/`，后已并入 generic。每个测试带有分组标签——`auto`、`quick`、`soak`、`dangerous`——因此你可以在二分排查时跑快速子集，在报告前跑完整集合。

> **引用摘要：** xfstests 拥有覆盖 13 种文件系统的 4,369 个测试用例，通用测试可一次性对 ext4、xfs、btrfs 和 overlayfs 运行（kdave/xfstests, 2026）。一个 VFS 层的回归会被所有支持的文件系统同时捕获——这正是该套件成为内核社区共享文件系统判定准则的原因。

<figure>
  <img src="/posts/kernel-regression-xfstests/chart-tests-by-fs.svg" alt="xfstests 各文件系统测试数量横向柱状图：xfs 1624、generic 1600、btrfs 701、overlay 213、ext4 146、f2fs 51、其他 34" />
  <figcaption>数据来源：kdave/xfstests 仓库 tests/ 目录（2026 年 8 月）</figcaption>
</figure>

## 如何搭建 xfstests 回归排查环境？

将 xfstests 克隆到内核源码树**外部**——二分工作流会检出大量内核版本，你不想让 xfstests 被一起牵连。

### 第一步：克隆与编译

```bash
# 将 xfstests 克隆到内核目录旁边（而非内部）
git clone https://github.com/kdave/xfstests.git
cd xfstests
make
```

`make` 会编译测试二进制文件和 `check` 运行器。如果失败，先安装 `libtool`、`libaio-dev`、`libattr1-dev` 和 `acl` 等依赖包。

### 第二步：配置测试环境

复制示例配置文件并编辑：

```bash
cp local.config.example local.config
```

设置测试设备和擦除设备。运行器会在这些设备上创建和销毁文件系统，因此请使用 loop 设备或空闲分区——切勿使用根磁盘：

```bash
# local.config
export TEST_DEV=/dev/loop0
export TEST_DIR=/mnt/test
export SCRATCH_DEV=/dev/loop1
export SCRATCH_MNT=/mnt/scratch
```

### 第三步：创建 fsgqa 用户

测试以 `fsgqa` 用户身份运行，以执行权限相关路径。请创建该用户：

```bash
sudo useradd -m fsgqa
sudo useradd 123456-fsgqa
sudo useradd fsgqa2
sudo groupadd fsgqa
```

**验证安装：**

```bash
./check -T -g quick
```

预期结果：少量测试运行且大部分通过。如果 `generic/001` 通过，说明 loop 设备和用户配置正确。如果全部显示 `notrun`，请重新检查 `local.config` 路径。

**常见安装错误：**

| 错误 | 原因 | 修复方法 |
|------|------|----------|
| `TEST_DEV: No such file` | loop 设备未关联 | `sudo losetup -f /path/to/image` |
| `fsgqa: No such user` | 测试用户缺失 | 运行上面的 `useradd` 命令 |
| 全部测试 `notrun` | `local.config` 未生效 | 确认 `TEST_DIR` 存在并已挂载 |
| 挂载时 `Permission denied` | 用户未加入组 | `sudo usermod -aG fsgqa $USER`，重新登录 |

## 如何用单个失败测试复现回归？

回归报告通常以"ext4 在 kernel 7.1 上坏了"或"xfs/023 在 7.0 合入后失败"的形式出现。你的第一件事就是把它转化为一个确定性的单测试复现器——这比听起来容易。

按编号运行单个测试：

```bash
./check xfs/001
```

运行器会在 `results/check.xfs/001/` 中写入三个文件：

| 文件 | 内容 |
|------|------|
| `xfs/001.out` | 测试的标准输出/错误 |
| `xfs/001.full` | 包含内核消息的完整输出——这是你的证据 |
| `xfs/001.notrun` | 仅当测试跳过时存在 |

测试在退出码为 0 且输出匹配预期模式时**通过**，否则**失败**。当测试的前置条件（特定挂载选项、内核配置）缺失时显示 **notrun**。对回归排查而言，`notrun` 是噪声——过滤掉它们：

```bash
./check -g auto 2>&1 | grep -E "Not ok:|Ran:"
```

> **[实践经验]** `.full` 日志才是关键文件。当 xfs/023 失败时，`.out` 文件只显示"FAILED"，而 `.full` 日志会展示具体的 `xfs_buf` 断言和 `dmesg` 尾部。提交回归报告时务必贴入 `.full` 日志——维护者据此分类，而非你的总结。

要确认这是真正的回归而非偶发失败，请在已知良好的内核版本上运行该测试。启动或编译上一个工作版本，运行测试并验证其通过。现在你就有了 `good` 和 `bad` 两个边界——正是 `git bisect` 所需要的。

![深色背景屏幕上显示代码行，代表被调查的内核源码](/posts/kernel-regression-xfstests/images/computer-code.png)

## 如何用 git bisect 定位问题提交？

这是核心技巧。`git bisect` 需要两个要素：测试通过的 `good` 提交和测试失败的 `bad` 提交。你提供一段返回 0（好）或 125/1（坏）的脚本，它会在提交范围内二分搜索。

编写一个二分包装脚本，用于编译内核、重启（或使用 KVM）并运行单个 xfstests 测试：

```bash
#!/bin/bash
# bisect-xfs.sh — 在内核源码目录中运行
cd /path/to/xfstests
# 针对当前已编译内核重新构建 xfs 模块
make -C /path/to/linux M=fs/xfs modules_install
# 运行单个失败测试；退出码驱动 bisect
./check xfs/001 >/dev/null 2>&1
```

然后从内核源码树驱动二分：

```bash
cd /path/to/linux
git bisect start HEAD v6.14
git bisect run ../xfstests/bisect-xfs.sh
```

Git 会检出中点提交，你的脚本运行 xfstests，git 据此选择下一半范围。对于 10,000 个提交大约需要 **13 次迭代**；对于整个 7.1 版本（15,849 个变更集）大约需要 **14 次**。每次迭代就是一次 xfstests 运行，因此整个搜索可自动化并在一夜之间完成。

<figure>
  <img src="/posts/kernel-regression-xfstests/chart-bisect-steps.svg" alt="棒棒糖图展示 git bisect 所需步数：1000 个提交需 10 步、5000 需 12 步、10000 需 13 步、15849 需 14 步" />
  <figcaption>数据来源：git bisect 对数复杂度；kernel 7.1 变更集数量来自 LWN.net, 2026</figcaption>
</figure>

二分结束后，git 会输出问题提交：

```
abc1234 is the first bad commit
commit abc1234
Author: ...
Date:   ...
    xfs: refactor btree block setup in directory code
```

阅读该提交。阅读变更日志——作者通常会解释*为什么*要做这个修改。现在你既理解了回归本身，也理解了改动背后的意图，这是写出正确修复所必需的前提。这种上下文，正是区分优秀修复与简单回退的关键。

> **引用摘要：** 将 `git bisect run` 与 xfstests 包装脚本配合，可在约 log2(n) 步内定位任意问题提交——整个 15,849 变更集的 kernel 7.1 版本只需约 14 次 xfstests 运行（LWN.net, "Who Wrote 7.1", 2026）。该套件确定性的通过/失败判定，正是其可作为自动化判定准则的根本原因。

## 如何验证修复并避免引入新的回归？

写出修复只是工作的一半。另一半是证明你没有破坏其他东西。为受影响的文件系统运行完整测试组：

```bash
./check -g auto
```

`auto` 组排除了 `soak` 和 `dangerous` 测试，但覆盖了广泛的功能面。如果通过，再跑文件系统专属组：

```bash
./check -g xfs
```

对比修复前后的结果。一个干净的结果看起来像：

```
Ran: xfs/001..xfs/1624
Passed: 1624
```

如果之前通过的测试现在失败了，你的修复存在连带影响——在报告前停下来排查。

> **[独到见解]** 请跑 **generic** 组，而非仅跑各文件系统专属组。对 `fs/xfs/` 的修改可能波及 VFS 层，导致 ext4 上的 `generic/075` 失败。generic 测试是廉价的保险：它们对所有文件系统运行相同的 POSIX 工作负载，因此连带影响会在维护者发现之前就暴露出来。

KernelCI——内核的自动化 CI——会在每个 RC 版本上跨数百块板卡运行 xfstests（[linux.kernelci.org](https://linux.kernelci.org), 2026）。一旦你的修复进入子系统树，KernelCI 会大规模重跑套件，这正是在最终发布前捕获单个开发者机器上遗漏的回归的机制。

![代表 KernelCI 大规模自动化回归测试的云 computing 基础设施](/posts/kernel-regression-xfstests/images/cloud-computing.png)

## 如何报告回归并提交修复？

一份回归报告需要三样东西：失败的测试名称、`.full` 日志和二分结果。发送给正确的维护者：

```bash
# 在内核源码树中，指向你的修复提交
scripts/get_maintainer.pl -f fs/xfs/xfs_bmap.c
```

`get_maintainer.pl` 解析 MAINTAINERS 文件并输出精确的 `To:` 和 `CC:` 列表。切勿猜测收件人。然后用 `git send-email` 发送：

```bash
git format-patch -1 HEAD
git send-email --to=maintainer@kernel.org 0001-fix.patch
```

你的补丁会在几分钟内出现在 [lore.kernel.org](https://lore.kernel.org) 上。如果你自己修复了回归，请添加：

```
Fixes: abc1234 ("xfs: refactor btree block setup in directory code")
Cc: stable@vger.kernel.org
```

`Fixes:` 标签让社区的回归追踪机器人——由 Rik van Riel 维护的 regzbot——能将修复关联回问题提交（[gitlab.com/rmacklin/regzbot](https://gitlab.com/rmacklin/regzbot), 2026）。`Cc: stable` 行确保修复进入用户实际遇到该问题的长期支持内核。

## 常见问题排查

以下是五个最常见的问题及其修复方法。

| 问题 | 现象 | 解决方案 |
|------|------|----------|
| 测试偶发失败 | 同一测试多次运行结果不一致 | 用 `-i 3` 循环运行；检查 `dmesg` 竞态 |
| 二分停在合并提交 | Git 指向合并而非实际变更 | 使用 `git bisect run` 配合 `--first-parent` |
| 修复破坏了另一个文件系统 | xfs 修复导致 ext4 测试失败 | 跑 `generic` 组——VFS 回归会跨文件系统 |
| `notrun` 淹没输出 | 大部分测试被跳过 | 检查 `local.config` 挂载选项和内核配置 |
| 维护者未回复 | 两周后无回应 | 在内核文档要求的最短一周等待期后礼貌提醒一次 |

> **[实践经验]** 回归排查中最大的时间消耗源是"五次挂一次"的偶发失败测试。在二分之前，先在已知良好内核上运行候选测试十次。如果它在那儿也失败过，请换一个复现器——用一个不可靠的判定准则做二分，会以十足的信心给你一个错误的答案。

## 下一步

现在你已经掌握了可用的回归排查工作流，以下是深入方向。

**扩展此工作流：**
- 增加一次 `-g soak` 通宵运行，捕获快速组遗漏的竞态条件
- 将 xfstests 集成到类似本地 KernelCI 的循环中，在 QEMU 中启动每个二分步骤
- 为你刚修复的回归编写一个新的 xfstests 测试——预防胜于二分

**相关教程：**
- [如何提交你的第一个 Linux 内核补丁](/posts/submit-linux-kernel-patch/)
- [如何为 Linux 内核做贡献：2026 指南](/posts/kernel-contribution-guide-ai-era/)

**官方资源：**
- [xfstests 仓库](https://github.com/kdave/xfstests)
- [KernelCI 看板](https://linux.kernelci.org/)
- [regzbot 回归追踪器](https://gitlab.com/rmacklin/regzbot)

## 常见问题

### 什么是 xfstests？

xfstests 是 Linux 内核社区共享的文件系统回归测试套件。它拥有覆盖 13 种文件系统的 4,369 个测试用例，可一次性对 ext4、xfs、btrfs、overlayfs 等运行（kdave/xfstests, 2026）。最初为 SGI Irix 上的 XFS 开发，现已成为文件系统正确性的标准判定准则。

### 使用 xfstests 的 git bisect 需要多长时间？

搜索本身大约需要 log2(n) 步——整个内核发布版本约 14 次迭代。实际耗时取决于编译速度：配合 KVM 和 ccache，通常一晚即可完成。每次迭代的 xfstests 运行通常不到一分钟（单个测试）。

### 我可以在虚拟机而非物理机上运行 xfstests 吗？

可以，对二分排查而言虚拟机更优。KVM 加速保持每步速度，可快照的虚拟机让你瞬间回滚。将 `TEST_DEV` 和 `SCRATCH_DEV` 指向虚拟机内文件支持的 loop 设备——切勿使用共享宿主机文件系统。

### xfstests 和 kselftest 有什么区别？

xfstests 针对 VFS 层和可插拔文件系统层面的行为；kselftest 位于 `tools/testing/selftests/` 下，覆盖单个内核子系统（net、mm、seccomp）。二者互补——一个 VFS 变更应同时通过两者的测试。

### 如果我自己无法修复回归，该如何报告？

对受影响文件运行 `get_maintainer.pl`，然后用 `git send-email` 发送失败测试名称、`.full` 日志和二分结果。如果该 bug 已存在于已发布内核中，添加 `Cc: stable@vger.kernel.org`。维护者和 regzbot 追踪器会接手处理。

## 完整工作流参考

<details>
<summary>点击展开完整回归排查清单</summary>

```bash
# 1. 环境搭建
git clone https://github.com/kdave/xfstests.git && cd xfstests && make
cp local.config.example local.config   # 编辑 TEST_DEV、SCRATCH_DEV
sudo useradd -m fsgqa && sudo groupadd fsgqa
./check -T -g quick                    # 验证

# 2. 复现
./check xfs/001                        # 运行失败测试
cat results/check.xfs/001/xfs/001.full # 收集证据

# 3. 二分定位
cd /path/to/linux
git bisect start HEAD v6.14
git bisect run ../xfstests/bisect-xfs.sh
# -> 输出首个问题提交

# 4. 修复与验证
# ... 编写修复 ...
git commit -s -m "xfs: fix regression in ..."
./check -g auto                        # 完整组，所有文件系统
./check -g xfs                         # 文件系统专属组

# 5. 报告
scripts/get_maintainer.pl -f fs/xfs/xfs_bmap.c
git format-patch -1 HEAD
git send-email --to=maintainer@kernel.org 0001-fix.patch
```

</details>
