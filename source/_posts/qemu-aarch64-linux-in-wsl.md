---
title: 在WSL中编译aarch64平台内核使用qemu启动
date: 2021-09-12 22:15:59
tags: 
---

## 编译busybox生成_install

### 安装编译依赖bison/flex

```shell
sudo apt-get install bison -y
sudo apt-get install flex -y
```

<!-- more -->

### 编译busybox

```shell
tar jxvf busybox-1.32.0.tar.bz2
cd busybox-1.32.0
mkdir build
make O=build ARCH=arm64 defconfig
make O=build ARCH=arm64 menuconfig
# 修改以下配置
# [*] Don't use /usr
# [*] Build static binary (no shared libs)
# (aarch64-linux-gnu-) Cross compiler prefix
make O=build
make O=build install
cd build/_install
# 创建空目录
mkdir -pv {etc,proc,sys,usr/{bin,sbin}}
vim init
# 修改init文件如下
# #!/bin/sh

# mount -t proc none /proc
# mount -t sysfs none /sys

# echo -e "\nBoot took $(cut -d' ' -f1 /proc/uptime) seconds\n"

# exec /bin/sh
chmod +x init
# 打包cpio文件系统生成busybox ramdisk filesystem
find . -print0 | cpio --null -ov --format=newc | gzip > ../initramfs.cpio.gz
```

## 编译linux内核

```shell
cd /xxx/linux-4.19.157
mkdir build
make O=build ARCH=arm64 CROSS_COMPILE=aarch64-linux-gnu- allnoconfig
make O=build ARCH=arm64 CROSS_COMPILE=aarch64-linux-gnu- menuconfig
# 修改以下配置
# -> General setup
# [*] Initial RAM filesystem and RAM disk (initramfs/initrd) support

# -> General setup
#   -> Configure standard kernel features
# [*] Enable support for printk

# -> Executable file formats / Emulations
# [*] Kernel support for ELF binaries
# [*] Kernel support for scripts starting with #!

# -> Device Drivers
#   -> Generic Driver Options
# [*] Maintain a devtmpfs filesystem to mount at /dev
# [*]   Automount devtmpfs at /dev, after the kernel mounted the rootfs

# -> Device Drivers
#   -> Character devices
# [*] Enable TTY

# -> Device Drivers
#   -> Character devices
#     -> Serial drivers
# [*] ARM AMBA PL010 serial port support
# [*]   Support for console on AMBA serial port
# [*] ARM AMBA PL011 serial port support
# [*]   Support for console on AMBA serial port

# -> File systems
#   -> Pseudo filesystems
# [*] /proc file system support
# [*] sysfs file system support
make O=build ARCH=arm64 CROSS_COMPILE=aarch64-linux-gnu- -j8
```

## 使用qemu启动linux

```
qemu-system-aarch64 \
    -machine virt -cpu cortex-a53 -smp 1 -m 2G \
    -kernel /xxx/linux-4.19.157/build/arch/arm64/boot/Image \
    -append "console=ttyAMA0" \
    -initrd /yyy/busybox-1.32.0/build/initramfs.cpio.gz \
    -nographic
```
