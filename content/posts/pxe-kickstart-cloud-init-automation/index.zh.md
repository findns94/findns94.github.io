---
title: "告别手动装机：PXE+Kickstart+Cloud-init自动化完全指南"
description: "手动安装操作系统每台服务器需30-60分钟。PXE+Kickstart+Cloud-init将其缩短至5-15分钟无人值守。学习构建自动化裸金属配置。"
coverImage: "/posts/pxe-kickstart-cloud-init-automation/images/cover.jpg"
coverImageAlt: "带网络电缆的服务器机架，代表PXE网络引导自动化用于裸金属配置"
ogImage: "/posts/pxe-kickstart-cloud-init-automation/images/cover.jpg"
date: "2026-09-09 10:00:00"
lastUpdated: "2026-09-09 10:00:00"
author: "FindNS94"
tags: ["Infrastructure"]
---

![带网络电缆的服务器机架，代表PXE网络引导自动化用于裸金属配置](/posts/pxe-kickstart-cloud-init-automation/images/cover.jpg)

# 告别手动装机：PXE+Kickstart+Cloud-init自动化完全指南

在物理服务器上手动安装操作系统需要30-60分钟的人工操作：从U盘或虚拟介质启动、回答分区问题、选择软件包、配置网络、创建用户、等待。乘以跨多个数据中心的数百台服务器，运营成本变得惊人。更糟的是，手动安装不一致——每个技术人员做出的选择略有不同，产生看起来相同但行为不同的服务器。

本指南逐步展示如何使用三个历经数十年验证的协议构建完全自动化的操作系统安装流水线：**PXE**（预启动执行环境）用于网络引导，**Kickstart** 用于无人值守Linux安装，**Cloud-init** 用于安装后配置和集成。它们一起将操作系统安装从30-60分钟的人工注意力缩短至5-15分钟的无人值守、无需干预的配置。服务器加电、从网络引导、安装操作系统、自行配置并加入自动化栈——无需人工触碰键盘。

<!-- more -->

> **核心要点**
> - PXE实现无本地介质的网络引导：服务器的网卡固件广播DHCP请求，通过TFTP接收引导文件并执行——无需磁盘或已安装的操作系统。
> - Kickstart通过应答文件自动化Linux安装：分区、软件包选择、网络配置和安装后脚本都是预定义的。
> - Cloud-init处理安装后配置：用户创建、SSH密钥注入、软件包安装和与配置管理工具的集成。
> - 它们一起实现完全无人值守的裸金属配置：加电 → 网络引导 → 操作系统安装 → 自行配置 → 准备就绪。
> - 多站点PXE需要DHCP中继和镜像缓存：PXE设计上不能跨子网，因此每个站点需要本地基础设施。

## PXE引导如何工作？

PXE（预启动执行环境）使服务器能够从网络而非本地磁盘或U盘启动。该过程依赖三个协议协同工作：DHCP用于地址分配和引导服务器发现，TFTP用于下载初始引导程序，HTTP/NFS用于较大的操作系统内核和initrd。

序列从服务器的网卡固件在UDP端口67上广播带有PXE扩展的DHCPDISCOVER数据包开始。启用PXE的DHCP服务器以DHCPOFFER响应，包含客户端IP地址、TFTP服务器地址(next-server)和要下载的网络引导程序(NBP)名称。客户端配置其IP设置，然后通过TFTP将NBP下载到内存中，验证它（如果启用了UEFI安全启动），并执行它。

NBP通常只是第一阶段——它获取引导菜单（BIOS用PXELINUX，UEFI用GRUB）来呈现操作系统选项。用户选择选项（或默认超时）后，NBP通过HTTP、CIFS或NFS下载操作系统内核和initrd——这些协议比TFTP具有更高的吞吐量。内核引导，挂载initrd，操作系统安装开始。此时，Kickstart接管以自动化安装。

对于UEFI系统（代表绝大多数现代服务器），过程类似，但使用`.efi`可执行文件而非较旧的基于BIOS的PXE。UEFI PXE在UEFI 2.4A+规范中定义，支持安全启动，在执行前验证每个引导组件的加密签名。

<figure class="chart-img" style="margin:2.5rem 0;text-align:center;padding:1.5rem 0">
  <img src="/posts/pxe-kickstart-cloud-init-automation/charts/chart-1-pxe-boot-sequence.svg" alt="图表：PXE引导序列。步骤1：客户端广播带PXE扩展的DHCPDISCOVER。步骤2：DHCP服务器响应IP、TFTP服务器地址和引导文件名。步骤3：客户端通过TFTP下载NBP。步骤4：NBP通过HTTP/NFS下载内核和initrd。步骤5：操作系统安装开始，由Kickstart/Cloud-init自动化。" loading="lazy" style="max-width:100%;height:auto">
  <figcaption>来源：PXE规范（Intel/UEFI论坛）、Kickstart文档、Cloud-init文档。</figcaption>
</figure>

## 搭建PXE服务器

PXE服务器需要三个组件：DHCP服务器（分配地址和通告引导信息）、TFTP服务器（提供网络引导程序）和HTTP或NFS服务器（提供操作系统内核、initrd和安装文件）。

DHCP服务器配置是最关键的部分。它必须支持PXE感知：标准DHCP分配IP地址，但PXE DHCP还必须提供`next-server`选项（TFTP服务器IP）和`boot-file`选项（NBP文件名）。BIOS与UEFI客户端的配置不同。

以下是为BIOS和UEFI客户端服务的最小`dnsmasq`配置：

```ini
# /etc/dnsmasq.d/pxe.conf
# DHCP范围和选项
dhcp-range=192.168.1.100,192.168.1.200,255.255.255.0,1h
dhcp-option=option-router,192.168.1.1
dhcp-option=option-dns-server,192.168.1.1

# 启用TFTP
enable-tftp
tftp-root=/var/lib/tftpboot

# BIOS客户端：加载pxelinux.0
dhcp-boot=tag:pxe,pxelinux.0,pxeserver,192.168.1.10

# UEFI客户端：加载grubx64.efi
dhcp-boot:tag:uefi,grubx64.efi,pxeserver,192.168.1.10

# 通过架构标记客户端（PXE客户端类）
dhcp-match=set:pxe,option:client-arch,0
dhcp-match=set:uefi,option:client-arch,7
dhcp-match=set:uefi,option:client-arch,9
```

TFTP根目录需要引导文件：`pxelinux.0`（BIOS）或`grubx64.efi`（UEFI），以及引导菜单配置和任何所需模块。HTTP或NFS服务器托管操作系统安装树（操作系统ISO的完整内容，已解压）。

对于生产环境，考虑**iPXE**——一个开源PXE实现，扩展了基本协议，支持HTTP引导（比TFTP快）、可脚本化和从iSCSI、FCoE和AoE引导。iPXE可以从标准PXE链式加载：固件通过TFTP加载iPXE，然后iPXE以其增强功能接管。

## 使用Kickstart自动化Linux安装

Kickstart是Red Hat自动化Linux安装的机制。它被RHEL、CentOS、Fedora及其衍生版支持。Kickstart文件是一个应答文件，指定每个安装选择：磁盘分区、软件包选择、网络配置、用户创建和安装后脚本。

Kickstart文件是具有特定语法的纯文本文件。以下是RHEL 9的最小但完整的示例：

```kickstart
# /var/www/html/ks/rhel9-base.cfg
# 安装方法
url --url="http://192.168.1.10/os/rhel9/"
lang en_US.UTF-8
keyboard us
timezone UTC --utc

# 网络配置
network --bootproto=dhcp --device=link --activate
network --hostname=rhel9-base.local

# 安全
rootpw --iscrypted$6$rounds=10000$hashedpasswordhere
firewall --enabled --ssh
selinux --enforcing
authselect --enableshadow --passalgo=sha512

# 磁盘分区
clearpart --all --initlabel
autopart --type=lvm --fstype=xfs

# 软件包选择
%packages
@^minimal-environment
wget
curl
python3
-cloud-init
%end

# 安装后脚本
%post --log=/root/ks-post.log
# 安装cloud-init以进行进一步配置
dnf install -y cloud-init

# 启用并启动cloud-init
systemctl enable cloud-init

# 创建带SSH密钥的管理用户
useradd -m -G wheels admin
mkdir -p /home/admin/.ssh
echo "ssh-rsa AAAA...your-key... admin@ops" > /home/admin/.ssh/authorized_keys
chmod 700 /home/admin/.ssh
chmod 600 /home/admin/.ssh/authorized_keys
chown -R admin:admin /home/admin/.ssh

# 禁用root SSH登录
sed -i 's/#PermitRootLogin yes/PermitRootLogin no/' /etc/ssh/sshd_config
%end

# 安装后重启
reboot
```

Kickstart文件从PXE引导菜单引用。客户端引导时，内核命令行指定Kickstart URL：

```
linux vmlinuz ip=dhcp inst.ks=http://192.168.1.10/ks/rhel9-base.cfg
initrd initrd.img
```

对于Ubuntu/Debian系统，等效机制是**Preseed**——具有不同语法的类似机制。Ubuntu Autoinstall（在20.04中引入）使用基于YAML的配置，比传统Preseed文件更现代且更易于维护。

## 集成Cloud-init进行安装后配置

Cloud-init是云实例初始化的事实标准，但它同样适用于裸金属。虽然Kickstart处理操作系统安装本身，Cloud-init处理之后的事情：用户创建、SSH密钥注入、软件包安装、文件写入和与配置管理工具的集成。

分工很明确：Kickstart安装操作系统并安装/启用Cloud-init。安装后首次引导时，Cloud-init运行并应用用户数据配置。这种两阶段方法将"安装操作系统"与"为角色配置机器"分开。

Cloud-init通过`user-data`文件（YAML格式）和可选的`meta-data`（实例特定变量）接受配置。对于裸金属，用户数据可以从安装服务器、CMDB API或配置引擎提供。

以下是一个Cloud-init用户数据示例，用于配置服务器以适应其角色：

```yaml
# /var/www/html/cloud-config/web-server.yml
#cloud-config
hostname: ${hostname}
fqdn: ${hostname}.example.com
manage_etc_hosts: true

users:
  - name: admin
    groups: [wheel, sudo]
    shell: /bin/bash
    sudo: ALL=(ALL) NOPASSWD:ALL
    ssh_authorized_keys:
      - ssh-rsa AAAA...your-key... admin@ops

package_update: true
package_upgrade: true

packages:
  - nginx
  - python3
  - htop

write_files:
  - path: /etc/motd
    content: |
      Server: ${hostname}
      Role: web-server
      Provisioned: $(date)
    owner: root:root
    permissions: '0644'

runcmd:
  - systemctl enable --now nginx
  - systemctl enable --now cloud-init-local
  - echo "Provisioning complete" > /tmp/provisioned

final_message: "Server ${hostname} is ready after $UPTIME seconds"
```

Cloud-init分阶段运行：`init`（网络和数据源检测）、`config`（模块执行）和`final`（引导后脚本）。对于裸金属，`NoCloud`数据源最相关——它从本地磁盘（由配置引擎种子化的小ISO或FAT分区）或内核命令行指定的URL读取配置。

与更广泛自动化栈的集成发生在`runcmd`或`bootcmd`部分：注册到CMDB、加入Puppet/Salt、加入Kubernetes集群或触发监控代理安装。

## 多站点PXE：DHCP中继和镜像缓存

PXE设计上不能跨子网——DHCP发现阶段依赖路由器不转发的广播流量。对于拥有多个可用区或远程站点的组织，这意味着每个站点需要本地PXE基础设施。

标准解决方案是**DHCP中继**（也称为IP助手）。每个子网上的中继代理监听DHCP广播，并将它们作为单播转发到中央DHCP服务器。DHCP服务器响应，中继代理将响应交付给客户端。这允许中央DHCP服务器为多个子网服务而无需修改。

以下是Linux路由器上的典型DHCP中继配置：

```bash
# 安装DHCP中继
apt install isc-dhcp-relay

# /etc/default/isc-dhcp-relay
SERVERS="192.168.1.10"
INTERFACES="eth0 eth1"
OPTIONS=""

# 或使用dhrelay命令
dhrelay -d 192.168.1.10 -i eth1
```

对于TFTP和HTTP组件，每个站点需要本地服务器或缓存代理。引导文件（NBP、引导菜单、内核、initrd）很小（通常总共50-200MB），可以从中央仓库同步的本地TFTP服务器提供。操作系统安装树（几GB）受益于缓存HTTP代理（如Squid），它按需获取软件包并在本地缓存以供后续安装。

**iPXE链式加载** 为多环境提供优雅解决方案：固件通过一次TFTP请求加载最小的iPXE二进制文件，然后iPXE从HTTP服务器加载完整配置。这将TFTP服务器减少到仅提供初始iPXE二进制文件，而较重的HTTP流量可以在本地缓存。

对于带宽受限的WAN链路，考虑**分阶段方法**：在非高峰时段在本地服务器上预置操作系统安装树，然后在工作时间从本地存储提供服务。这消除了实际配置事件期间的WAN传输。

![网络电缆，代表实现自动化操作系统安装的PXE引导基础设施](/posts/pxe-kickstart-cloud-init-automation/images/network-boot.jpg)

## 常见PXE故障排查

PXE引导故障是最令人沮丧的基础设施问题之一，因为它们发生在操作系统加载之前——没有日志、没有shell，通常也没有明确的错误消息。以下模式占实践中PXE故障的大多数。

**DHCP问题(最常见症状：客户端获取不到IP地址)。** 客户端广播DHCPDISCOVER但未收到响应。原因：DHCP服务器未运行、DHCP中继未配置、客户端在错误VLAN上或DHCP作用域耗尽。诊断：在DHCP服务器上运行`tcpdump`验证DISCOVER数据包是否到达。修复：验证DHCP中继配置、检查VLAN成员身份、扩展DHCP作用域。

**TFTP超时(症状：客户端获取IP但无法下载NBP)。** 客户端接收带有next-server和filename的DHCPOFFER，但TFTP传输超时。原因：TFTP服务器未运行、防火墙阻止UDP端口69、DHCP配置中文件名不正确或TFTP根目录权限问题。诊断：用客户端手动测试TFTP（`tftp 192.168.1.10 -c get pxelinux.0`）。修复：验证TFTP服务状态、检查防火墙规则、确认文件存在于TFTP根目录。

**内核恐慌后引导(症状：内核加载然后崩溃)。** NBP成功下载并引导内核，但内核恐慌——通常显示"VFS: Unable to mount root fs"错误。原因：initrd缺少所需驱动（网卡、存储控制器）、内核命令行参数不正确或initrd损坏。诊断：检查内核命令行中的`initrd=`和`inst.ks=`路径是否正确。修复：用所需驱动重新生成initrd、验证文件完整性。

**Kickstart获取失败(症状：内核引导但安装不开始。** 内核引导但无法获取Kickstart文件。原因：HTTP服务器未运行、内核命令行中Kickstart URL不正确或安装程序环境中的网络配置失败。诊断：验证客户端子网对HTTP服务器的可访问性、检查PXE引导菜单中的URL。修复：验证HTTP服务、用`curl`测试URL、确保内核命令行上有`ip=dhcp`。

<!-- [个人经验] 我遇到的最棘手的PXE故障是DHCP租约时机的竞态条件。当服务器引导时，其网卡固件请求DHCP租约进行PXE，接收短租约（通常60秒），并开始TFTP下载。如果TFTP传输时间长于租约期限（慢链路或大initrd文件常见），DHCP租约在传输中途过期。网卡固件可能随后尝试续租，中断TFTP下载并导致超时。修复是为PXE作用域配置更长的DHCP租约（至少3600秒）或使用iPXE，它在从固件PXE接管后维持租约。 -->

## 常见问题

### UEFI和BIOS PXE有什么区别？

UEFI PXE使用`.efi`可执行文件（如`grubx64.efi`或`bootx64.efi`）而非较旧的基于BIOS的网络引导程序。UEFI支持安全启动，在执行前加密验证每个引导组件。UEFI PXE还使用DHCP选项93来识别客户端架构，允许服务器提供正确的引导文件。对于现代服务器（2015年以后），UEFI是标准——BIOS/CSM模式已弃用。配置PXE服务器同时提供BIOS和UEFI引导文件以在过渡期间支持旧硬件。

### 我可以将PXE用于Windows吗？

可以。Windows部署服务(WDS)是微软基于PXE的部署解决方案。WDS对初始引导使用相同的PXE协议，然后提供Windows映像格式(WIM)文件进行安装。微软部署工具包(MDT)添加类似Kickstart的自动化能力：任务序列定义安装步骤，CustomSettings.ini提供应答文件。对于Windows裸金属，WDS + MDT是标准方法。PXE服务器配置类似：DHCP提供引导服务器地址，TFTP提供Windows引导管理器，安装文件通过SMB或HTTP提供。

### 如何处理不同的硬件配置文件？

为不同的硬件配置文件创建多个Kickstart文件（或Cloud-init用户数据文件）：Web服务器、数据库服务器、计算节点、存储节点。PXE引导菜单呈现这些选项，配置引擎可以在签到workflow期间根据发现的硬件属性自动选择（参见[CMDB驱动发现文章](/posts/cmdb-driven-bare-metal-management-auto-discovery/)）。对于异构环境，使用"基础+角色"模式：通用Kickstart文件安装操作系统和Cloud-init，然后Cloud-init根据服务器在CMDB中分配的角色应用特定于角色的配置。

### 无盘引导怎么样？

PXE支持无盘引导：服务器完全从网络引导内核和根文件系统，无需本地磁盘。根文件系统通过NFS（完整根fs）或带ramdisk的NBD/NFS提供。无盘引导在HPC集群（数千个计算节点共享单个根fs镜像）和VDI环境中很常见。PXE配置相同；区别在内核命令行，指定`root=/dev/nfs nfsserver=192.168.1.10:/nfs/root`而非本地磁盘。权衡是网络依赖：如果NFS服务器故障，所有无盘节点都会故障。

### 如何保护PXE引导安全？

PXE没有内置认证——网络上任何设备都可以请求引导文件。安全措施：网络分段（隔离管理/PXE网络）、802.1X端口认证（只有认证设备可以访问PXE VLAN）、UEFI安全启动（仅执行签名的引导组件）和带HTTPS的iPXE（加密引导文件传输）。对于机密环境，考虑完全禁用PXE并使用签名USB介质进行初始配置，然后在操作系统安装后切换到基于网络的管理。

## 结语

PXE、Kickstart和Cloud-init构成了自动化裸金属操作系统安装的经过验证、稳定的基础。PXE处理网络引导，Kickstart自动化操作系统安装，Cloud-init管理安装后配置。它们一起将30-60分钟的手动过程转变为5-15分钟的无人值守过程。

架构很直接：每个站点的PXE服务器（DHCP + TFTP + HTTP）、用于操作系统安装自动化的Kickstart文件、用于基于角色配置的Cloud-init，以及用于多站点的DHCP中继。这是MAAS、Tinkerbell和Ironic构建的相同基础——理解它使你具备评估、部署和排查任何裸金属配置引擎的知识。

关于这如何适应完整自动化栈的更多背景——从CMDB作为唯一真相源到配置引擎到开发者自助服务——请参见[系列总览文章](/posts/bare-metal-cloud-automation-lifecycle-management/)和[编排引擎对比](/posts/maas-vs-tinkerbell-vs-ironic-bare-metal-orchestration/)。

## 参考来源

- Intel/UEFI论坛，PXE规范，https://uefi.org
- Red Hat，Kickstart文档，https://access.redhat.com/documentation/en-us/red_hat_enterprise_linux/9/html/performing_an_advanced_rhel_9_installation/index.html
- Canonical，Ubuntu Autoinstall文档，https://ubuntu.com/server/docs/install/autoinstall
- Cloud-init文档，https://cloudinit.readthedocs.io
- iPXE项目，https://ipxe.org
- 微软，Windows部署服务文档，https://learn.microsoft.com/en-us/windows-server/deployment/wds-deployment-server
- 微软，微软部署工具包，https://learn.microsoft.com/en-us/windows/deployment/deploy-windows-mdt/
