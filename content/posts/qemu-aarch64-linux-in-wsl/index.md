---
title: Booting a QEMU Linux System Using a Cross-Compiled aarch64 Kernel and BusyBox
date: 2021-09-12 22:15:59
tags: 
---


## Compile BusyBox to Generate _install

### Install Build Dependencies bison/flex

```shell
sudo apt-get install bison -y
sudo apt-get install flex -y
```

<!-- more -->

### Compile BusyBox

```shell
tar jxvf busybox-1.32.0.tar.bz2
cd busybox-1.32.0
mkdir build
make O=build ARCH=arm64 defconfig
make O=build ARCH=arm64 menuconfig
# Modify the following configurations
# [*] Don't use /usr
# [*] Build static binary (no shared libs)
# (aarch64-linux-gnu-) Cross compiler prefix
make O=build
make O=build install
cd build/_install
# Create empty directories
mkdir -pv {etc,proc,sys,usr/{bin,sbin}}
vim init
# Set the init file as follows
# #!/bin/sh

# mount -t proc none /proc
# mount -t sysfs none /sys

# echo -e "\nBoot took $(cut -d' ' -f1 /proc/uptime) seconds\n"

# exec /bin/sh
chmod +x init
# Package the cpio filesystem to generate busybox ramdisk filesystem
find . -print0 | cpio --null -ov --format=newc | gzip > ../initramfs.cpio.gz
```

## Compile the Linux Kernel

```shell
cd /xxx/linux-4.19.157
mkdir build
make O=build ARCH=arm64 CROSS_COMPILE=aarch64-linux-gnu- allnoconfig
make O=build ARCH=arm64 CROSS_COMPILE=aarch64-linux-gnu- menuconfig
# Modify the following configurations
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

## Boot Linux Using QEMU

```
qemu-system-aarch64 \
    -machine virt -cpu cortex-a53 -smp 1 -m 2G \
    -kernel /xxx/linux-4.19.157/build/arch/arm64/boot/Image \
    -append "console=ttyAMA0" \
    -initrd /yyy/busybox-1.32.0/build/initramfs.cpio.gz \
    -nographic
```
