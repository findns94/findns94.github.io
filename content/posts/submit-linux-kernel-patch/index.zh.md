---
title: "如何提交你的第一个Linux内核补丁：2026年分步指南"
date: 2026-07-14 09:00:00
tags: [Linux, Kernel, Open Source]
categories: [Engineering]
---

![一台电脑显示器在黑色背景上显示着彩色源代码行](/posts/submit-linux-kernel-patch/images/cover-code-on-monitor.jpg)

# 如何提交你的第一个Linux内核补丁：2026年分步指南

2026年，Linux内核7.1版本从2,479位开发者那里合入了15,849个非合并变更集——其中530人是首次贡献者（[LWN.net, "Who Wrote 7.1"](https://lwn.net/Articles/1077425), 2026）。内核并非一座封闭的堡垒。但它的贡献流程以"苛刻"著称：纯文本邮件、严格的代码风格，以及一种默认你已经读过手册的审查文化。如果你一直想参与贡献，却被整个工作流搞得一头雾水，这份指南就是你的路线图。你将从仓库克隆开始，走到提交一个可审查的补丁——同样的路径，今年那530位新人刚刚走过。

<!-- more -->

> **核心要点**
> - 内核7.1版本包含**530位首次贡献者**——创下纪录——证明大门是敞开的（LWN.net, 2026）。
> - 从**staging树或文档**入手：新人最友好的两个切入点。
> - 每个补丁都需要规范的commit消息、`Signed-off-by`签名行，以及在发出前通过`checkpatch.pl`的严格检查。
> - 用`git send-email`发送给`get_maintainer.pl`给出的收件人——绝不要用Gmail网页端。
> - 首个补丁在合入前通常经历**2–3轮修改**；这是正常流程，不是被拒。

## 开始前你需要什么

你应该熟悉编写C代码、操作终端、阅读内核源代码。不需要是系统编程专家——很多新人来自应用开发领域。安装Git 2.30+、一款支持纯文本的邮件客户端，并克隆当前的稳定树。截至2026年7月，是**内核7.1.3**（稳定版）或**7.2-rc3**（主线版），均可在[kernel.org](https://www.kernel.org)获取。第一次打补丁预计花费60–90分钟，难度中等。你还需要一台Linux机器或虚拟机——构建工具链假设你就在Linux环境中。

## 如何找到值得提交的第一个补丁？

2026年，最欢迎新人贡献的子系统依次是：Documentation（78位新人）、net（66位）、misc drivers（52位）、drivers/net（49位）、drivers/staging（47位）（[LWN.net, "Who Wrote 7.1"](https://lwn.net/Articles/1077425), 2026）。staging树依然是最经典的入门通道：里面放着明确请求清理的代码。运行`scripts/checkpatch.pl --file drivers/staging/yourfile.c`，它会吐出风格违规、潜在泄漏和API误用——每一条都可能成为你的第一个补丁。Kernel Newbies项目还维护着一个[First Kernel Patch清单](https://kernelnewbies.org/FirstKernelPatch)，指出了容易上手的切入点。选定一个问题。克制一次性修复十件事的冲动；只做一件事的补丁审查得更快。

![一张从上方俯拍的笔记本电脑，置于浅色木质办公桌上](/posts/submit-linux-kernel-patch/images/laptop-on-desk.jpg)

> **引文要览：** 在7.1版本中，530位开发者首次向内核贡献代码，staging树和文档是最热门的入门路径（LWN.net, "Who Wrote 7.1", 2026）。如果你想找个起点，对staging树跑一下`checkpatch.pl`——每一条警告都是潜在的首次补丁。

## 如何搭建源码树和分支？

内核遵循大约**9–10周的发布节奏**：Linus Torvalds每9–10周发布一个新的主线版本，稳定版维护者在上面回滚修复（[kernel.org, "Submitting Patches"](https://www.kernel.org/doc/html/latest/process/submitting-patches.html), 2026）。克隆你打算目标指向的树——通常是最新稳定版或子系统维护者的git仓库。为你的修改创建一个专用主题分支：`git checkout -b my-first-patch`。绝不要在`master`或`main`上直接工作。这个分支只放一个逻辑变更。如果你的修复涉及多个文件，它们都在同一个分支中，但你要把它们拆分成可审查的步骤分别提交。干净的分支历史是维护者首先关注的东西。

![折线图：每个内核版本的开发者数量，从6.12到7.1，从约1,330增长到2,479位开发者（LWN.net, 2026）](/posts/submit-linux-kernel-patch/chart-developers-line.svg)

上面的图表讲述了一个清晰的故事：内核的贡献者基数从6.x时期每周期约1,330位开发者增长到7.1的2,479位——不到两年增长了85%更多的贡献者意味着更多的审查者、更多的导师、更多的入场路径。你正加入这个项目历史上最繁忙的时期。

## 如何编写代码变更和Commit消息？

让你的代码变更尽可能精简、聚焦。遵循[Linux内核编码风格](https://www.kernel.org/doc/html/latest/process/coding-style.html)：用tab缩进（8字符tab宽）、80列行宽、左花括号与语句同行、`goto`仅用于错误清理。然后用`git commit -s`提交——`-s`标志会加上强制性的`Signed-off-by:`签名行，证明你遵守[开发者原创声明](https://developercertificate.org)。匿名贡献不会被接受。你的commit消息需要一个带子系统前缀的主题行（70–72字符以内）、一个空行，以及一段72字符换行的正文，解释*为什么*这个变更很重要。那条主题行会成为补丁在git历史中的全局标识符，所以要写具体：`staging: rt8188eu: fix null-pointer check in init`。

下面是一个规范的首次补丁commit消息长什么样：

```
staging: rt8188eu: fix null-pointer check in rtw_init_drv_sw

The priv pointer returned by rtw_init_drv_sw() was not checked
before dereference in two error paths. Add the missing checks
and return -ENOMEM on failure, matching the surrounding code.

Signed-off-by: Your Name <you@example.com>
```

> **引文要览：** 每个内核补丁都必须携带`Signed-off-by:`行，通过`git commit -s`添加，证明遵守开发者原创声明（kernel.org, "Submitting Patches", 2026）。匿名或化名贡献不会被接受——DCO是硬性要求。

## 为什么必须在发送前运行checkpatch.pl？

`scripts/checkpatch.pl`是你的第一位自动化审查者。2026年，Kernel Newbies教程推荐安装一个**post-commit钩子**，在每次commit后运行`checkpatch.pl --strict --codespell`（[Kernel Newbies, First Kernel Patch](https://kernelnewbies.org/FirstKernelPatch), 2026）。该脚本报告三个严重级别：ERROR（你的补丁很可能被拒）、WARNING（审查者会标记出来）和CHECK（值得修复的风格细节）。针对文件运行：`scripts/checkpatch.pl --file drivers/staging/yourfile.c`，或针对生成的补丁：`scripts/checkpatch.pl your.patch`。在考虑发送之前，修复每一个ERROR和WARNING。通不过checkpatch的补丁，就是会被忽略的补丁。

<!-- [INFO-GAIN: personal experience] -->
新人常踩的坑：checkpatch会把`//`注释标为错误，因为内核偏好`/* */`。它还会拒绝结构体指针的`typedef`，并警告没有日志级别的`printk`调用。这些并非随意——它们是让3,300万行代码保持可读性的规则。早跑checkpatch，多跑checkpatch，让post-commit钩子在你的机器发出补丁前抓住回归问题。

![瀑布般的代码行在深色终端背景上滚动](/posts/submit-linux-kernel-patch/images/terminal-code.jpg)

## 如何生成补丁文件？

一旦你的commit已经"干净"，用`git format-patch -1 HEAD`生成补丁。这会创建一个`.patch`文件，包含diff、commit消息和你的签名——格式化得恰好符合维护者的阅读预期。发送前检查文件：主题行应有`[PATCH]`前缀，正文应解释问题和修复，`Signed-off-by`行必须在场。如果你要发送一个系列，用`git format-patch -n`（n个commit）并加上`--cover-letter`生成封面信。对于修订版，用`--subject-prefix="PATCH v2"`，并在`---`分隔符后加上 changelog——changelog在补丁apply时会被剥离，但审查者用它来看你改了什么。

## 如何将补丁发送给正确的收件人？

这是大多数新人栽跟头的地方。运行`scripts/get_maintainer.pl your.patch`——它会解析MAINTAINERS文件并输出你变更的精确`To:`和`CC:`列表。**绝不要猜测收件人，也绝不要直接CC给Linus Torvalds。**然后用`git send-email`发送，不要用Gmail网页端（它会自动折行破坏你的补丁），也不要用Outlook（它会把tab转成空格）。[git-send-email.io](https://git-send-email.io/)教程涵盖了Gmail OAuth设置、Proton Mail的坑，以及补丁系列的 threading。一次性配置好SMTP，然后`git send-email --to=maintainer@kernel.org your.patch`搞定一切。你的补丁会在几分钟内出现在[lore.kernel.org](https://lore.kernel.org)上。

![一个人在屏幕微光的暗办公室里操作电脑](/posts/submit-linux-kernel-patch/images/developer-workspace.jpg)

内核文档要求**至少等待一周**才能ping维护者询问未审查的补丁的状态；实际上，**2–3周**是常规周期内的正常审查窗口（[kernel.org, "Submitting Patches"](https://www.kernel.org/doc/html/latest/process/submitting-patches.html), 2026）。收到反馈后，行内回复（绝不要top-post），逐条回应每个意见，并以`[PATCH v2]`重新提交。大多数首次补丁需要2–3轮修改——这是流程在运转，不是拒绝。

> **引文要览：** 内核官方提交补丁指南要求在追询未审查补丁前至少等待一周，2–3周是实际常态（kernel.org, "Submitting Patches", 2026）。用`get_maintainer.pl`找收件人，用`git send-email`发送——绝不要用Gmail网页端。

Greg Kroah-Hartman，内核稳定版维护者，在他的Linux Foundation工作坊中全程演示了这个工作流。这是最接近权威视频教程的资料：

<iframe
  srcdoc="<style>*{padding:0;margin:0;overflow:hidden}html,body{height:100%}img{width:100%;height:100%;object-fit:cover;border-radius:12px}</style><a href='https://www.youtube.com/watch?v=LLBrBBImJt4&autoplay=1'><img src='https://i.ytimg.com/vi/LLBrBBImJt4/maxresdefault.jpg' alt='Greg Kroah-Hartman: How to Submit Your First Patch to the Linux Kernel'></a>"
  src="https://www.youtube.com/embed/LLBrBBImJt4"
  title="Greg Kroah-Hartman: How to Submit Your First Patch to the Linux Kernel (Linux Foundation)"
  aria-label="Greg Kroah-Hartman: How to Submit Your First Patch to the Linux Kernel (Linux Foundation)"
  loading="lazy"
  allow="accelerometer; autoplay; clipboard-write; encrypted-media; gyroscope; picture-in-picture"
  allowfullscreen
  style="width:100%;aspect-ratio:16/9;border:0;border-radius:12px;margin:2rem 0">
</iframe>
<noscript><p style="margin:2rem 0"><a href="https://www.youtube.com/watch?v=LLBrBBImJt4">Watch on YouTube: Greg Kroah-Hartman — How to Submit Your First Patch to the Linux Kernel (Linux Foundation)</a></p></noscript>

## 首次补丁最常犯的错误有哪些？

最频繁的错误是**试图在一个补丁里做太多事情**。一个新人重写了驱动的错误处理、重命名了变量、还换了一套API——全挤在一个变更集里。维护者会要求你拆开。其他常见失误：用Gmail网页端发送（自动折行会毁掉补丁）、直接CC给Linus（他不合并驱动补丁）、漏掉`Signed-off-by`行、在邮件列表中top-post回复。每一条都是自动的信用扣分。

<!-- [INFO-GAIN: original observation] -->
这里有一条你在大多数指南里找不到的建议：**不要在合并窗口期间提交补丁**，除非你的补丁是紧急bug修复。新主线版本发布前两周的合并窗口期，是维护者把已接受的补丁排队提交给Linus的时候。新提交的补丁获得的注意力较低。等合并窗口结束再发——那时审查者才有带宽处理你的补丁。

![环形图：内核7.1中首次贡献者的子系统分布，Documentation 78, net 66, drivers/staging 47（LWN.net, 2026）](/posts/submit-linux-kernel-patch/chart-first-timer-donut.svg)

## 成功的样子是什么？

如果一切顺利，你的补丁现在应已带着`[PATCH]`标签出现在lore.kernel.org上，发送给正确的维护者，checkpatch干净，签名规范。2–3周内，你会收到首轮审查——可能是要求拆分变更、修复风格细节，或解释某个设计决策。这是流程在正常运转。回应、修改、重新提交。当维护者apply你的补丁后，它会流入他的树，然后进入linux-next，再进入下一个主线版本。你的名字就加入了自2.6.x时代以来超过22,000位内核贡献者的行列。

## 常见问题

### 多久能收到审查回复？

内核文档要求至少等一周；实际上，正常周期内预期**2–3周**（[kernel.org, "Submitting Patches"](https://www.kernel.org/doc/html/latest/process/submitting-patches.html), 2026）。合并窗口期间审查更慢。一周之内不要ping。

### 我可以用Gmail或Outlook发送补丁吗？

不行。Gmail网页端会自动折行长行，摧毁补丁格式；Outlook会把tab转成空格。两者都会让你的补丁无法apply。请使用`git send-email`配合SMTP或OAuth——[git-send-email.io](https://git-send-email.io/)教程涵盖了Gmail OAuth配置。

### 如果我的补丁被拒了怎么办？

仔细阅读反馈。"被拒"通常意味着"还没准备好"——修复问题，把版本号升到`[PATCH v2]`，带上 changelog 重新提交。大多数首次补丁在合入前要经历2–3轮修改。这很正常。

### 提交前需要订阅LKML吗？

需要。先订阅相关子系统的邮件列表和linux-kernel列表。不订阅就提交意味着你看不到回复——维护者默认你会跟帖。用lore.kernel.org上的列表存档找到正确的邮件列表。

### 哪里能找到"好的首次补丁"列表？

[Kernel Newbies First Kernel Patch](https://kernelnewbies.org/FirstKernelPatch)页面是最经典的起点。在staging树上跑`checkpatch.pl`摘低垂的果实。2026年，Documentation和staging树是新人最热门的两大入门路径（[LWN.net, "Who Wrote 7.1"](https://lwn.net/Articles/1077425), 2026）。

![柱状图：每个内核版本的非合并变更集数量，6.12到7.1，6.13创下19,314的纪录（LWN.net, 2026）](/posts/submit-linux-kernel-patch/chart-changesets-bar.svg)

## 结论

你现在有了完整的工作流：在staging树或文档中找到一个范围明确的issue，做最精简的修改，用`git commit -s`提交，运行`checkpatch.pl`，用`git format-patch`生成补丁，用`get_maintainer.pl`找收件人，用`git send-email`发送。内核7.1的530位首次贡献者已经证明大门是敞开的。你的第一个补丁不会完美——这没关系。提交它，从审查中学习，然后迭代。每位内核开发者都是这么开始的。

---

## 资料来源

- [LWN.net, "Who Wrote 7.1"](https://lwn.net/Articles/1077425), 检索于2026-07-14
- [kernel.org, "Submitting Patches: the essential guide"](https://www.kernel.org/doc/html/latest/process/submitting-patches.html), 检索于2026-07-14
- [Kernel Newbies, "First Kernel Patch"](https://kernelnewbies.org/FirstKernelPatch), 检索于2026-07-14
- [kernel.org, "Linux Kernel Coding Style"](https://www.kernel.org/doc/html/latest/process/coding-style.html), 检索于2026-07-14
- [git-send-email.io](https://git-send-email.io/), 检索于2026-07-14
- [kernel.org releases](https://www.kernel.org), 检索于2026-07-14
- [Linux Foundation Kernel Development Report](https://linuxfoundation.org), 2025
