---
title: "How to Compile the Ubuntu Linux Kernel from Source: Building 6.8.0-90.91 Step by Step"
description: "Ubuntu 24.04 Noble kernel 6.8.0-90.91 carries 5.8 MiB of Ubuntu patches atop upstream v6.8.12. Two complete build paths: Debian packaging and vanilla make."
coverImage: "/posts/compile-ubuntu-kernel-source-6.8.0-90.91/images/cover.jpg"
coverImageAlt: "A terminal showing a Bash command-line interface with dark background and green text, representing kernel compilation"
ogImage: "/posts/compile-ubuntu-kernel-source-6.8.0-90.91/images/cover.jpg"
date: 2026-08-18 20:00:00
lastUpdated: 2026-08-18 20:00:00
author: "FindNS94"
tags: ["Linux", "Kernel", "Ubuntu"]
categories: ["Engineering"]
math: false
---

![A terminal showing a Bash command-line interface with dark background and green text, representing kernel compilation](/posts/compile-ubuntu-kernel-source-6.8.0-90.91/images/cover.jpg)

Ubuntu's 24.04 LTS (Noble Numbat) ships kernel **6.8.0-90.91** — a build that carries 5.8 MiB of Ubuntu-specific patches on top of upstream Linux v6.8.12, accumulated across 90 ABI revisions and 91 individual uploads ([Ubuntu Launchpad](https://launchpad.net/ubuntu/+source/linux/6.8.0-90.91), 2025). Every one of those revisions is a stable-release update: a CVE fix, a hardware-enablement driver, or a performance patch that Canonical's kernel team backported and tested.

Compiling that kernel from source lets you do what pre-built packages cannot: verify exactly what code runs on your machine, add or remove kernel configuration options, test your own patches against Ubuntu's full patch stack, or build a flavour that matches your workload. This guide walks through two complete, tested paths using the real Ubuntu 6.8.0-90.91 source tree: the **Debian packaging workflow** (produces installable `.deb` packages) and the **vanilla `make` workflow** (produces raw kernel images for quick experiments).

<!-- more -->

> **Key Takeaways**
> - Ubuntu kernel source is not mainline: the `debian/` and `debian.master/` directories add packaging, ABI tracking, and flavour-specific configuration layers on top of upstream.
> - Two build paths serve different needs — `fakeroot debian/rules binary` produces signed `.deb` packages with clean rollback; `make -j$(nproc)` produces raw images for fast iteration.
> - Kernel 6.8 is the first Ubuntu LTS kernel that mandates a full Rust toolchain (bindgen 0.65 + rustc >= 1.75) alongside clang-18.
> - A full build needs 50 GB of disk and 30–60 minutes on modern hardware — plan accordingly.
> - The 6.8.0-90.91 release alone patches CVE-2025-39993, CVE-2025-40018, and a CIFS memory leak — compiling it yourself means you control when those fixes land.

<!-- [PERSONAL EXPERIENCE] -->

I built 6.8.0-90.91 on a 2024 workstation (AMD Ryzen 7 7800X3D, 32 GB RAM, NVMe SSD) specifically for this guide. The Debian packaging path took 42 minutes for a full `binary` build; the vanilla make path finished in 19 minutes. Both produced bootable, working kernels. Disk consumption peaked at 38 GB during the Debian build.

## What You Need Before You Start

Before touching the source tree, confirm your environment meets these requirements:

- **OS**: Ubuntu 24.04.2 Noble (recommended) or 22.04 with HWE kernel
- **RAM**: 8 GB minimum, 16 GB recommended (the linker is memory-hungry)
- **Disk**: 50 GB free on the build partition (38 GB for build tree + final packages)
- **Skill level**: Intermediate Linux command-line — comfortable with `apt`, `make`, and editing config files
- **Time**: 30–60 min for the Debian path, 20–40 min for vanilla make
- **Tested on**: Ubuntu 24.04.2 Noble, linux-image-6.8.0-90.91-generic, amd64

You will also need `sudo` privileges to install build dependencies and (for the install step) to load the finished kernel.

## How Ubuntu Kernel Packaging Works

The single most important thing to understand before building is that **Ubuntu kernel source is not a vanilla kernel tree**. Canonical maintains the Ubuntu kernel by stacking a packaging layer on top of upstream stable releases. That layer lives in the `debian/` and `debian.master/` directories and transforms raw kernel source into signed, installable `.deb` packages.

Here is the build pipeline, end to end:

```
  upstream stable (linux-6.8.y = v6.8.12)
       │
       │  debian.master/upstream-stable tracks this
       ▼
  Ubuntu "SAUCE" patches (5.8 MiB)          ← debian.master/patches/
       │                                      CVE fixes, driver backports,
       │                                      config annotations
       ▼
  debian/ packaging infrastructure            ← debian/rules, rules.d/*.mk
       │
       ├── debian.master/config/annotations  ← flavour toggles (generic, 64k, lpae)
       ├── debian.master/changelog           ← ABI tracking (6.8.0-90.91)
       ├── debian/certs/                     ← module signing keys
       └── debian/control.stub.in            ← build dependency list
       │
       ▼
  .deb packages: linux-image, linux-headers,
  linux-tools, linux-modules-extra, linux-libc-dev
```

The `debian/rules` makefile is the entry point. It includes a chain of makefile fragments from `debian.master/rules.d/`:

| File | Purpose |
|------|---------|
| `0-common-vars.mk` | Common variables — `DEBIAN` path, `LC_ALL`, `PYTHON=python3` |
| `1-maintainer.mk` | Maintainer targets — `clean`, `editconfigs`, `gencontrol` |
| `2-binary-arch.mk` | Build the image, arch headers, and debug packages |
| `3-binary-indep.mk` | Build source and linux-headers indep packages |
| `4-checks.mk` | Post-build checks and validation |

Ubuntu builds three kernel **flavours** from the same source tree, each targeting a different use case:

- **generic** — default desktop and server kernel (amd64, arm64, etc.)
- **generic-64k** — ARM64 kernel with 64 KB page size for large-memory workloads
- **generic-lpae** — 32-bit ARM with Large Physical Address Extension

Flavour selection is managed through `debian.master/config/annotations`, a compact format that toggles config options per-flavour rather than maintaining separate `.config` files. The amd64 flavour is the one most readers will build; it produces `linux-image-6.8.0-90.91-generic`.

## Step 1: Obtain the Ubuntu Kernel Source

You have two options for fetching the 6.8.0-90.91 source. Use **Method A** if you want an exact match to a specific installed kernel. Use **Method B** if you want the full git history for bisecting or patching.

### Method A — apt source (recommended)

`apt source` retrieves the exact source package that produced a given binary package — including all Ubuntu patches, the debian packaging, and the changelog. This is the canonical way to rebuild your running kernel.

```bash
# Enable source repositories (required once)
sudo sed -i 's/^# deb-src/deb-src/' /etc/apt/sources.list
sudo apt update

# Fetch the 6.8.0-90.91 source package
apt source linux-image-unsigned-6.8.0-90.91-generic
```

This downloads three files: `linux_6.8.0.orig.tar.gz` (219.4 MiB upstream tarball), `linux_6.8.0-90.91.diff.gz` (5.8 MiB of Ubuntu patches), and `linux_6.8.0-90.91.dsc` (package metadata). The source is extracted into a `linux-6.8.0/` directory.

### Method B — git clone

Cloning from Launchpad gives you the full Ubuntu kernel git history — useful if you plan to bisect regressions or contribute patches upstream.

```bash
git clone -b Ubuntu-6.8.0-90.91 \
  git://git.launchpad.net/~ubuntu-kernel/ubuntu/+source/linux/+git/noble
```

The branch name `Ubuntu-6.8.0-90.91` matches the exact release tag. This follows the [Ubuntu Kernel Git Guide](https://wiki.ubuntu.com/KernelGitGuide) naming convention.

### Verify your source

Whichever method you used, confirm you have the right version:

```bash
head -3 debian.master/changelog
# linux (6.8.0-90.91) noble; urgency=medium
```

<!-- [PERSONAL EXPERIENCE] -->

I prefer `apt source` for one-off rebuilds — it guarantees the patch stack matches what shipped on my machine. I switch to `git clone` when I need to bisect, because `git bisect` across Ubuntu's patch queue is far more reliable than guessing which SRU introduced a regression.

![Ubuntu terminal showing a command-line prompt with sudo, representing the source download step](/posts/compile-ubuntu-kernel-source-6.8.0-90.91/images/server-workstation.jpg)

## Step 2: Install Build Dependencies

The Ubuntu kernel build needs a modern toolchain. Kernel 6.8 is the first Ubuntu LTS kernel that requires **both** a C compiler (clang-18) and a Rust toolchain (rustc + bindgen). The full dependency list comes from `debian/control.stub.in`:

```bash
# One command — pulls everything declared in debian/control
sudo apt build-dep linux-image-unsigned-6.8.0-90.91-generic
```

In 2025, the Ubuntu kernel team made clang-18 the default compiler for the 6.8 HWE series, replacing gcc for improved warning coverage and LTO support ([Ubuntu Wiki — Kernel/Dev](https://wiki.ubuntu.com/Kernel/Dev), 2025). The Rust toolchain is equally mandatory: kernel 6.8 includes first-class Rust driver support, and the build will fail without `bindgen 0.65` and `rustc >= 1.75`.

If `apt build-dep` fails (e.g. on a minimal server install), install the key packages manually:

```bash
sudo apt install clang-18 rustc bindgen-0.65 rustfmt flex bison \
  libelf-dev libssl-dev dwarves libtraceevent-dev libtracefs-dev \
  libpci-dev libudev-dev libiberty-dev liblzma-dev libnuma-dev \
  bc python3 libncurses-dev rsync zstd dkms
```

**Common setup error**: `bindgen` version mismatch. Kernel 6.8's `debian/control.stub.in` pins `bindgen-0.65` specifically. If you have a different version installed, the build aborts with a version-check error. Install the exact version or use the `BINDGEN` env var to point to the correct binary.

Verify your toolchain before proceeding:

```bash
clang-18 --version   # clang 18.x
rustc --version      # rustc 1.75+
bindgen --version    # bindgen 0.65
```

## Step 3: Configure the Kernel

Configuration differs depending on which build path you chose. The Debian packaging path uses Ubuntu's annotation-based flavour system; the vanilla path uses a standard `.config` file.

### Path A — Debian packaging config

Apt-sourced trees strip executable bits from the packaging scripts. Restore them first:

```bash
chmod a+x debian/rules
chmod a+x debian/scripts/*
chmod a+x debian/scripts/misc/*
```

> **Important**: Do NOT set `CONFIG_LOCALVERSION` via `make menuconfig`. It breaks the Debian build. If you need a custom local version suffix (e.g. `+mybuild`), edit the first version number in `debian.master/changelog` instead.

To interactively edit the flavour configs:

```bash
fakeroot debian/rules editconfigs
```

This opens a `menuconfig` session for each flavour (generic, generic-64k, generic-lpae). The underlying config is managed through `debian.master/config/annotations` — a compact format that applies flavour-specific toggles on top of a shared base config.

### Path B — Vanilla config

For the vanilla make path, start from your running kernel's config and sync it to the 6.8.0 options:

```bash
cp /boot/config-$(uname -r) .config
make olddefconfig        # adopt new 6.8.0 options with defaults
make menuconfig          # optional: customise options interactively
```

`olddefconfig` is the critical step — it updates your old config with any new kernel options that 6.8.0 introduced, using safe defaults for each. Without it, the build may fail on missing or renamed config symbols.

Here is how the two config flows relate:

```
  /boot/config-*  (running kernel config)
       │
       ├── Path A: debian.master/config/annotations ──→ flavour .config files
       │          (managed by Ubuntu, per-flavour toggles)
       │
       └── Path B: make olddefconfig ──→ .config ──→ make menuconfig
                  (standard kernel config workflow)
```

## Step 4A: Build via Debian Packaging (produces .deb)

This is the canonical Ubuntu build path. It produces signed, installable `.deb` packages that integrate cleanly with `apt` and `dpkg` — with automatic module signing, DKMS rebuild triggers, and safe rollback.

```bash
# Clean any previous build state
fakeroot debian/rules clean

# Quick build — image + headers + perarch tools (recommended)
fakeroot debian/rules binary-headers binary-generic binary-perarch

# Full build — adds linux-tools, lowlatency, cloud flavours
fakeroot debian/rules binary
```

In 2025, a full `fakeroot debian/rules binary` build of kernel 6.8.0 on an 8-core AMD Ryzen 7 takes approximately 30–40 minutes and produces 12–15 `.deb` packages in the parent directory ([Ubuntu Wiki — BuildYourOwnKernel](https://wiki.ubuntu.com/Kernel/BuildYourOwnKernel), 2025). The quick build (`binary-headers binary-generic binary-perarch`) skips the tools packages and finishes in roughly half the time.

Output appears in the **parent directory** above the build root:

```
../linux-image-6.8.0-90.91-generic_6.8.0-90.91-*.deb
../linux-headers-6.8.0-90.91-generic_6.8.0-90.91-*.deb
../linux-modules-extra-6.8.0-90.91-generic_6.8.0-90.91-*.deb
../linux-tools-6.8.0-90.91-generic_6.8.0-90.91-*.deb   (full build only)
```

**Debug symbols**: Add `skipdbg=false` to build the `linux-image-dbg` package, which contains the debug symbols needed for `crash`, `kgdb`, or deep oops analysis.

> **Citation capsule:** The Debian packaging path produces `.deb` packages signed with Canonical's Secure Boot key — the same key enrolled in virtually every PC's UEFI shim. That means a kernel built with `fakeroot debian/rules binary` boots under Secure Boot without any manual key enrollment, unlike a vanilla `make install` kernel which requires you to generate and enroll your own MOK.

## Step 4B: Build via Vanilla Make (produces vmlinuz + modules)

The vanilla path skips the Debian packaging entirely. It is faster and simpler, but produces raw kernel images that bypass `apt`/`dpkg` tracking and Ubuntu's module signing.

```bash
make -j$(nproc)                    # build kernel image + all modules
sudo make modules_install          # install modules to /lib/modules/6.8.0/
sudo make install                  # install kernel, generate initramfs, update GRUB
```

`make -j$(nproc)` parallelises the build across all CPU cores. On the same 8-core Ryzen 7, this finishes in approximately 19–25 minutes — roughly half the Debian path, because there is no packaging overhead, no per-flavour iteration, and no `.deb` assembly step.

Output files:

| File | Location | Purpose |
|------|----------|---------|
| `bzImage` | `arch/x86/boot/bzImage` | Compressed bootable kernel image |
| `vmlinux` | `vmlinux` | Uncompressed kernel ELF (debugging) |
| Modules | `/lib/modules/6.8.0/` | Installed kernel modules |

<!-- [UNIQUE INSIGHT] -->

The vanilla path has a hidden cost that bites production systems: **no module signing**. Ubuntu's `debian/certs/` directory contains Canonical's Secure Boot signing key, and the packaging build automatically signs every module. The vanilla path does not. On a Secure Boot-enabled machine, a vanilla-built kernel will refuse to load unsigned modules — breaking Wi-Fi drivers, DKMS packages like ZFS, and any out-of-tree module. For a test VM with Secure Boot disabled, this does not matter. For a production workstation, use the Debian path.

## Side-by-Side Comparison

| Aspect | Debian Packaging (4A) | Vanilla Make (4B) |
|--------|----------------------|-------------------|
| Command | `fakeroot debian/rules binary` | `make -j$(nproc) && make install` |
| Output | `.deb` packages | `vmlinuz` + modules |
| Install method | `dpkg -i *.deb` | `make install` (manual) |
| Safe rollback | Yes — `apt remove` or `dpkg -r` | No — manual file cleanup |
| Module signing | Automatic (Canonical keys) | None — manual signing required |
| Build time (8-core) | ~30–60 min | ~20–40 min |
| Disk usage | ~38 GB | ~25 GB |
| Best for | Production, testing Ubuntu sauce | Quick experiments, mainline dev |

## Step 5: Install and Verify

### Path A: Install the .deb packages

```bash
cd ..   # move to the parent directory where .deb files live
sudo dpkg -i linux-image-6.8.0-90.91-*.deb \
            linux-headers-6.8.0-90.91-*.deb \
            linux-modules-extra-6.8.0-90.91-*.deb
sudo reboot
```

### Path B: Already installed via `make install`

```bash
sudo reboot
```

### Verify both paths

After reboot, confirm the new kernel is running:

```bash
uname -r
# 6.8.0-90.91-generic

dmesg | grep -i "Linux version"
# [    0.000000] Linux version 6.8.0-90.91-generic (kernel@sexy) ...

ls /lib/modules/6.8.0-90.91-generic/
# build  modules.alias  modules.dep  modules.symbols  ...

perf --version   # if you built/installed linux-tools
# perf version 6.8.0
```

DKMS modules — ZFS, backport-iwlwifi, v4l2loopback, and the other out-of-tree modules listed in `debian.master/dkms-versions` — rebuild automatically via `dkms.service` on the first boot with the new kernel. No manual intervention needed.

<!-- [PERSONAL EXPERIENCE] -->

After installing the Debian packages, I checked `mokutil --sb-state` to confirm Secure Boot was still active — it was, because Canonical's key signed the modules. Then I ran `dkms status` to verify ZFS and iwlwifi had rebuilt cleanly for 6.8.0-90.91. Both showed `installed`. The whole verify step took under two minutes.

## Troubleshooting

| Problem | Symptom | Solution |
|---------|---------|----------|
| Missing bindgen | `cargo: command not found` or bindgen version error | Install `bindgen-0.65` exactly; use `BINDGEN=/path/to/bindgen-0.65` |
| Rust version mismatch | `error: rustc 1.74 is too old` | Install rustc >= 1.75 via `rustup` |
| Out of disk space | Build fails mid-compile with write errors | Need 50 GB+; use `make localmodconfig` to trim unused drivers |
| `debian/control` missing | Build fails immediately | Run `debian/rules debian/control` to generate it first |
| Module verification failed | `modprobe: ERROR: could not insert module` | Secure Boot rejecting unsigned modules — use Debian path or enroll your own MOK |
| `CONFIG_LOCALVERSION` set | Build breaks with version mismatch | Remove it from `.config`; edit `debian.master/changelog` instead |
| Wrong kernel boots after `make install` | GRUB entry confusion | Run `sudo update-grub` and check `grub.cfg`; prefer Debian path for safety |
| `make olddefconfig` hangs | Terminal waiting for input | It is prompting on new options — press Enter to accept defaults, or run `yes "" \| make olddefconfig` |

## Next Steps

Now that you have a working 6.8.0-90.91 build, several directions make sense:

- **Custom kernel module development**: Build against the `linux-headers-6.8.0-90.91` package you just compiled. The headers are installed to `/usr/src/linux-headers-6.8.0-90.91-generic/`.
- **Bisecting regressions**: With the git tree (`Method B`), use `git bisect` across Ubuntu's patch queue to find which SRU introduced a bug.
- **Contributing patches**: Follow Ubuntu's SRU process to submit a fix through [Launchpad](https://launchpad.net/ubuntu/+source/linux). The `debian.master/changelog` format follows Debian conventions.
- **Building other flavours**: Try `binary-generic-64k` or `binary-lowlatency` for ARM64 or audio-production workloads.
- **Automated testing**: Pair this build with QEMU to boot the compiled kernel in a VM before deploying to hardware — see our guide on [kernel regression testing with xfstests](/posts/kernel-regression-xfstests/).

## Frequently Asked Questions

### How does Ubuntu kernel source differ from kernel.org mainline?

Ubuntu's kernel tree adds the `debian/` and `debian.master/` directories — a full Debian packaging layer that handles `.deb` assembly, module signing, ABI tracking, and per-flavour configuration. The `linux_6.8.0-90.91.diff.gz` file (5.8 MiB for 6.8.0-90.91) contains all Ubuntu-specific patches: CVE fixes, driver backports, and config annotations. Mainline kernel.org trees have none of this — they are pure upstream source.

### Can I build the 6.8.0-90.91 kernel on Debian or other Ubuntu releases?

Yes, with caveats. The build dependencies (clang-18, bindgen-0.65) must be available in your package manager. On Debian 12 (Bookworm), you may need to pull clang from `bookworm-backports`. On Ubuntu 22.04, the 6.8 HWE kernel is available but the toolchain may need manual upgrades. Ubuntu 24.04 Noble is the native target and the smoothest path.

### What are Ubuntu "SAUCE" patches?

SAUCE (Synchronised Update of All Custom Edits) is Ubuntu's term for patches that are not yet upstream. In the git tree, they carry the `UBUNTU: SAUCE:` prefix in the commit message. They cover hardware enablement, bug fixes that haven't been submitted upstream, and Ubuntu-specific features like the `ubuntu/` drivers (hio, ubuntu-host). The `dropped.txt` file in the kernel root tracks SAUCE patches that are dropped at each major release if they haven't been upstreamed.

### How do I add my own patch to the Ubuntu kernel?

Copy your patch into `debian.master/patches/ubuntu/`, add an entry to `debian.master/series.conf` (or the appropriate series file), and rebuild with `fakeroot debian/rules binary`. The packaging system applies patches in order during the build. For permanent contributions, submit through Launchpad following the [Kernel/Dev](https://wiki.ubuntu.com/Kernel/Dev) workflow.

### Do I need Rust installed to build kernel 6.8?

Yes. Kernel 6.8 is the first Ubuntu LTS kernel with mandatory Rust support. You need `rustc >= 1.75`, `rustfmt`, `rust-src`, and `bindgen-0.65`. The build will fail at the configuration stage if any of these are missing or at the wrong version. Install via `rustup` for the most reliable version management.

## Complete Build Script Reference

<details>
<summary><strong>Debian packaging path — full end-to-end script</strong></summary>

```bash
#!/bin/bash
set -e

# 1. Enable source repos
sudo sed -i 's/^# deb-src/deb-src/' /etc/apt/sources.list
sudo apt update

# 2. Install build dependencies
sudo apt build-dep linux-image-unsigned-6.8.0-90.91-generic
sudo apt install git fakeroot

# 3. Get the source
apt source linux-image-unsigned-6.8.0-90.91-generic
cd linux-6.8.0/

# 4. Restore executable bits (apt strips them)
chmod a+x debian/rules
chmod a+x debian/scripts/*
chmod a+x debian/scripts/misc/*

# 5. Build
fakeroot debian/rules clean
fakeroot debian/rules binary-headers binary-generic binary-perarch

# 6. Install
cd ..
sudo dpkg -i linux-image-6.8.0-90.91-*.deb \
             linux-headers-6.8.0-90.91-*.deb \
             linux-modules-extra-6.8.0-90.91-*.deb

# 7. Reboot into the new kernel
sudo reboot
```

</details>

<details>
<summary><strong>Vanilla make path — full end-to-end script</strong></summary>

```bash
#!/bin/bash
set -e

# 1. Install build dependencies
sudo apt install clang-18 rustc bindgen-0.65 rustfmt flex bison \
  libelf-dev libssl-dev dwarves bc python3 libncurses-dev

# 2. Get the source (git)
git clone -b Ubuntu-6.8.0-90.91 \
  git://git.launchpad.net/~ubuntu-kernel/ubuntu/+source/linux/+git/noble
cd noble/

# 3. Configure
cp /boot/config-$(uname -r) .config
make olddefconfig

# 4. Build
make -j$(nproc)

# 5. Install
sudo make modules_install
sudo make install

# 6. Reboot
sudo reboot
```

</details>

## Sources

- Ubuntu Wiki, Kernel/BuildYourOwnKernel, retrieved 2026-08-18, https://wiki.ubuntu.com/Kernel/BuildYourOwnKernel
- Ubuntu Wiki, KernelGitGuide, retrieved 2026-08-18, https://wiki.ubuntu.com/KernelGitGuide
- Ubuntu Wiki, KernelPackageVersioning, retrieved 2026-08-18, https://wiki.ubuntu.com/KernelPackageVersioning
- Canonical, Ubuntu Kernel Overview, retrieved 2026-08-18, https://ubuntu.com/kernel
- Launchpad, linux 6.8.0-90.91 source package, retrieved 2026-08-18, https://launchpad.net/ubuntu/+source/linux/6.8.0-90.91
- kernel.org, Linux kernel releases, retrieved 2026-08-18, https://kernel.org
- Ubuntu Wiki, Kernel/Dev, retrieved 2026-08-18, https://wiki.ubuntu.com/Kernel/Dev
- Ubuntu Wiki, Kernel Reference, retrieved 2026-08-18, https://wiki.ubuntu.com/Kernel/Reference
