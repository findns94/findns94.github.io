---
title: "DynASM 教程：用 LuaJIT 的方式构建你的第一个汇编解释器"
description: "LuaJIT 在 7 种 CPU 架构上运行手写汇编——却只写一份源码。学习 DynASM 如何桥接 C 与汇编，从零构建一个最小字节码解释器。"
coverImage: "/posts/dynasm-first-assembly-interpreter/images/cover.jpg"
coverImageAlt: "一枚风格化的 CPU 处理器芯片，引脚间流淌着汇编代码，象征着 DynASM 将 C 代码与机器汇编融为一体"
ogImage: "/posts/dynasm-first-assembly-interpreter/images/cover.jpg"
date: "2026-09-05 14:00:00"
lastUpdated: "2026-09-05 14:00:00"
author: "FindNS94"
tags: ["LuaJIT", "DynASM", "Interpreter"]
---

![一枚风格化的 CPU 处理器芯片，引脚间流淌着汇编代码，象征着 DynASM 将 C 代码与机器汇编融为一体](/posts/dynasm-first-assembly-interpreter/images/cover.jpg)

LuaJIT 在 7 种 CPU 架构上运行：x86、x64、ARM、ARM64、MIPS、MIPS64 和 PowerPC。它的解释器核心——执行每条字节码的调度循环——全部用手写汇编实现。然而维护者 Mike Pall 并没有写 7 份汇编文件，他只写了**一份**。

让这成为可能的是 **DynASM**（Dynamic Assembler，动态汇编器）：一个预处理器，能把 C 与汇编混合的 DSL 转化为任意支持架构的原生机器码字节。它是 LuaJIT 解释器的基石，也是单个 `.dasc` 源文件能为所有 LuaJIT 支持的 CPU 生成本地调度循环的原因。

在本教程中，你将完整学习 DynASM 的工作原理——语法、流水线、编码协议——然后用它构建一个最小字节码解释器。读完之后，你将拥有一个可用的解释器，它的调度循环通过 DynASM 以汇编编写，和 LuaJIT 本身一样。

<!-- more -->

> **核心要点**
> - DynASM 是**构建时**预处理器，而非 JIT 编译器：`.dasc` → `dynasm.lua` → 嵌入机器码字节的 C 代码 → 编译进二进制。
> - 虚拟机的解释器循环**不是**用 C 写的——它是 `.dasc` 文件中的手写汇编，在构建时预处理。
> - 固定寄存器分配（BASE、KBASE、PC、DISPATCH 绑定到特定 CPU 寄存器）是快速调度的关键。
> - `dasm_State` → 动作列表 → `dasm_encode()` 的流水线在单次遍历中解析标签并生成机器码。
> - DynASM 可以**独立于 LuaJIT** 使用——它是一个 MIT 许可证的独立的工具，适用于任何需要构建时代码生成的项目。

## DynASM 是什么？LuaJIT 为什么需要它？

### 多架构难题

脚本语言解释器需要一个快速的调度循环——取每条字节码指令并跳转到对应处理器的内层周期。最快的实现用汇编来写调度循环：把关键值（程序计数器、栈基址、常量表）绑定到 CPU 寄存器，这样每次迭代都不需要从内存重新加载。

问题是：每个 CPU 架构有不同的寄存器、不同的调用约定、不同的指令编码。x86-64 有 `rax`、`rbx`、`r14`；ARM64 有 `x0`–`x30`；MIPS 有 `$t0`–`$9`。传统方案迫使你二选一：

1. 为每个架构**分别编写和维护汇编文件**（LuaJIT 要维护 7 份），或者
2. 使用**预处理器地狱**——`#ifdef __x86_64__` / `#ifdef __aarch64__` 的意大利面条代码，既难读又容易出错。

LuaJIT 走了第三条路：在一种看起来像汇编的 DSL 中**只写一次**调度循环，用预处理器为每个目标生成真实的机器字节。

### DynASM 流水线

完整的端到端工作流：

```
 ┌─────────────┐     ┌──────────────┐     ┌─────────────────┐     ┌──────────┐
 │  source.dasc │────▶│  dynasm.lua  │────▶│  source.dasc.c   │────▶│  gcc/cc  │
 │  (C + 汇编)  │     │  (预处理器)   │     │  (C + 原始字节)  │     │  编译    │
 └─────────────┘     └──────────────┘     └─────────────────┘     └──────────┘
       │                     │                      │                     │
  你写这个              Lua 脚本               生成的 C 文件          最终二进制
  (每个项目一份)       (LuaJIT 自带)          (每个架构一份)         (每个架构一份)
```

1. **你写**一个 `.dasc` 文件——正常的 C 文件中穿插着汇编指令。以 `|` 开头的行是 DynASM 指令；不以 `|` 开头的行作为 C 代码原样复制。

2. **`dynasm.lua`**（一个 Lua 脚本，由精简的 `minilua` 解释器运行）预处理 `.dasc` 文件。它解析汇编助记符、解析标签、应用架构特定的编码规则，输出一个 C 文件。

3. **生成的 C 文件**包含你的原始 C 代码加上原始机器码字节（作为 `static const unsigned char[]` 数组）和 `dasm_put()` 调用——这些调用把字节喂入 DynASM 运行时状态。

4. **你的 C 代码**调用 `dasm_link()` 计算大小，分配可执行内存（通过 `mmap` + `mprotect`），调用 `dasm_encode()` 生成最终机器码，然后**把缓冲区转换为函数指针**并调用它。

关键洞察：DynASM **不是** JIT 编译器。它在**构建时**运行，而非运行时。机器码在编译项目时生成，不是运行时。这意味着代码生成没有任何运行时开销。

### 为什么不用 JIT？

如果 DynASM 在构建时运行，那 LuaJIT 的追踪式 JIT 怎么工作？答案是 LuaJIT 有**两条独立的代码生成路径**：

- **DynASM**（构建时）：生成**解释器循环**——运行每条字节码指令的静态调度逻辑。
- **手写发射器**（`lj_asm.c` + `lj_asm_x86.h`）：在运行时生成**追踪代码**——动态编译的热路径。

DynASM 处理静态的、架构可移植的部分。JIT 发射器处理动态的、架构特定的部分。它们共享相同的寄存器分配概念，但代码路径完全独立。

## DynASM 工作流——最小示例

让我们从最简单的 DynASM 程序开始：生成一个两数相加的函数。

### `.dasc` 文件

创建 `add.dasc`：

```c
#include "dasm_proto.h"
#include "dasm_x86.h"

|.arch x64
|.section code

void build_add(dasm_State **D) {
  |->add_func:
  |  mov rax, rdi    ; 第一个参数
  |  add rax, rsi    ; 加上第二个参数
  |  ret
}
```

`|` 前缀标记 DynASM 行。其余都是普通 C。`->add_func` 是全局标签——编码完成后，可以在全局数组中查找它的地址。

### C 驱动程序

```c
#include <stdio.h>
#include <stdlib.h>
#include <string.h>
#include <sys/mman.h>
#include "dasm_proto.h"
#include "dasm_x86.h"

// 由 DynASM 预处理器生成
|.actionlist add_actions

int main() {
  dasm_State *d;

  // 第 1 步：初始化
  dasm_init(&d, 1);  // 1 个代码段

  // 第 2 步：设置全局标签
  void *labels[lbl__MAX];
  dasm_setupglobal(&d, labels, lbl__MAX);

  // 第 3 步：设置动作列表
  dasm_setup(&d, add_actions);

  // 第 4 步：发射代码（此处插入生成的 dasm_put 调用）
  dasm_put(&d, ...);  // 自动生成

  // 第 5 步：链接——计算大小
  size_t sz;
  dasm_link(&d, &sz);

  // 第 6 步：分配可执行内存
  void *buf = mmap(0, sz, PROT_READ | PROT_WRITE,
                   MAP_PRIVATE | MAP_ANONYMOUS, -1, 0);

  // 第 7 步：编码——生成机器码
  dasm_encode(&d, buf);

  // 第 8 步：使内存可执行
  mprotect(buf, sz, PROT_READ | PROT_EXEC);

  // 第 9 步：调用生成的函数
  typedef long (*add_fn)(long, long);
  add_fn f = (add_fn)labels[lbl_add_func];
  printf("3 + 4 = %ld\n", f(3, 4));  // 输出: 3 + 4 = 7

  // 第 10 步：清理
  dasm_free(&d);
  munmap(buf, sz);
  return 0;
}
```

### 构建

```bash
# 1. 构建 minilua（运行 DynASM 的精简 Lua 解释器）
gcc -o minilua src/host/minilua.c

# 2. 运行 DynASM 预处理器生成 C 文件
./minilua dynasm/dasm.lua -o add_dasc.c add.dasc

# 3. 一起编译
gcc -o add_test add_dasc.c main.c
```

预处理后，`add_dasc.c` 包含原始 C 代码加上动作列表（`static const unsigned char add_actions[]`）和带有编码指令字节的 `dasm_put(&d, ...)` 调用。

### 10 个 API 函数

DynASM 的 API 恰好有 10 个函数，在初始化和使用期间按特定顺序调用：

| 顺序 | 函数 | 用途 |
|------|------|------|
| 1 | `dasm_init(&d, maxsection)` | 分配 `dasm_State` 结构 |
| 2 | `dasm_setupglobal(&d, gl, maxgl)` | 设置全局标签（→name）查找数组 |
| 3 | `dasm_setup(&d, actionlist)` | 用 `.actionlist` 完成初始化 |
| 4 | `dasm_growpc(&d, maxpc)` | 为动态（=>N）标签分配空间 |
| 5 | `dasm_put(&d, ...)` | 发射指令（预处理器生成） |
| 6 | `dasm_link(&d, &szp)` | 计算机器码所需的总大小 |
| 7 | `dasm_encode(&st, buffer)` | 向缓冲区生成机器码 |
| 8 | `dasm_getpclabel(&st, pc)` | 获取 =>pc 标签的偏移量 |
| 9 | `dasm_free(&d)` | 释放 DynASM 状态 |
| 10 | `dasm_checkstep(&d, secmatch)` | 可选的健全性检查（调试构建） |

关键顺序是：**init → setupglobal → setup → [put...] → link → encode → call → free**。`link` 必须在所有 `put` 调用之后（才能知道大小），`encode` 必须在内存分配之后。

<!-- [PERSONAL EXPERIENCE] 第一次看到手写 DynASM 调度循环真正运行字节码——取操作码、跳处理器、更新 PC——你会恍然大悟：这就是每个快速解释器用的同一种模式，从 CPython（computed-goto）到 V8（Ignition）到 LuaJIT。DynASM 只是让它可移植了。 -->

## 剖析 LuaJIT 的 `vm_x64.dasc`

现在来看真实的东西。LuaJIT 的 x86-64 解释器位于 `src/vm_x64.dasc`——大约 2000 行 C 与汇编的混合代码，生成整个解释器循环。

### 寄存器契约

任何基于 DynASM 的解释器最重要的设计决策是**寄存器分配**。你把最热的变量绑定到 CPU 寄存器，让它们在调度循环中永远不触及内存。LuaJIT 的 x64 契约：

```
 ┌─────────────────────────────────────────────────────────────┐
 │  x64 寄存器       │  LuaJIT 变量   │  角色                 │
 ├─────────────────────────────────────────────────────────────┤
 │  r14d（低 32 位） │  DISPATCH       │  调度表位置           │
 │  ebx（低 32 位）  │  PC             │  字节码位置           │
 │  r15              │  KBASE          │  常量表               │
 │  r12 / edx        │  BASE           │  栈帧基址             │
 │  rbp              │  (帧指针)       │  调用帧链             │
 │  rsp              │  (栈指针)       │  C 栈                 │
 └─────────────────────────────────────────────────────────────┘
```

这**不是**编译器的寄存器分配——它是硬编码在 `.dasc` 源文件中的**固定约定**。每个操作码处理器都知道 `PC` 在 `ebx` 中，`BASE` 在 `r12` 中，以此类推。处理器直接读写这些寄存器。

在 ARM64 上，同样的变量映射到不同的寄存器（BASE → `x19`，PC → `x20` 等），但 `.dasc` 源文件不变——只有架构模块（`dasm_arm64.lua`）改变。

### 调度循环

解释器的核心——运行每条字节码指令的周期：

```
 ┌──────────┐    ┌──────────────┐    ┌─────────────┐    ┌──────────┐
 │  PC += 4  │───▶│  从字节码读取 │───▶│  通过调度表  │───▶│  处理器  │
 │           │    │  操作码       │    │  跳转       │    │  (汇编)  │
 └──────────┘    └──────────────┘    └─────────────┘    └──────────┘
                                              │                │
                    ┌─────────────────────────┘                │
                    │  （处理器更新 PC、BASE、栈等）            │
                    ▼                                          │
              回到顶部（下一条指令）◀──────────────────────────┘
```

实际的 x64 汇编（来自 `vm_x64.dasc`）：

```asm
|  mov eax, [PC]          ; 加载下一条字节码指令
|  add PC, 4              ; 推进程序计数器
|  jmp [dispatch + eax*8] ; 通过调度表跳转到处理器
```

调度表（`GG_State.dispatch[]`）是一个代码指针数组，每个操作码一个条目。每个条目指向该操作码的汇编处理器。computed-goto 模式（`jmp [table + index*size]`）是在汇编中调度最快的方式——单次间接跳转，没有比较链，没有 switch 语句。

### 热计数器与 JIT 触发

某些操作码有**热计数器**——每次执行时递减计数器，当减到零时调用 `lj_trace_hot()` 开始追踪（JIT 编译）。这些是开启循环或函数入口的操作码：

```asm
|->forl:                    ; FOR 循环（数值）
|  sub [hotcount], 1        ; 递减热计数器
|  jg >1                   ; 如果还热，跳过 JIT 检查
|  call lj_trace_hot       ; 触发 JIT 录制
|  jmp >2                  ; 继续到处理器
|1:                        ; 还不够热——直接运行
|  ...                     ; 实际的 FOR 循环逻辑
|2:                        ; JIT 检查后的落入点
```

LuaJIT 使用 **I-前缀**操作码（`IFORL`、`IITERL`、`ILOOP`、`IFUNCF`、`IFUNCF`），一旦追踪编译完成，JIT 就会修补这些变体。`I` 变体与录制器协调——它们是解释器和 JIT 之间的桥梁。

### 完整操作码集

LuaJIT 的解释器处理约 90 个操作码。每个都有后缀编码其操作数类型：

| 后缀 | 含义 | 示例 |
|------|------|------|
| `V` | 变量槽 | `ADDVV` — 两个寄存器值相加 |
| `S` | 字符串常量 | `TSETS` — 字符串键表设置 |
| `N` | 数字常量 | `ADDNV` — 寄存器 + 数字相加 |
| `P` | 原始类型 | `ISEQP` — 与原始类型比较 |
| `B` | 字节字面量 | `TGETB` — 字节索引表获取 |
| `M` | 多参数 | `CALLM` — 可变参数调用 |

这种系统命名意味着操作码本身就告诉你它的操作数类型——录制器和发射器利用这一点来特化代码生成。

## DynASM 指令与语法参考

DynASM 的语法由其指令定义——以 `|` 开头的行，控制代码生成。以下是按类别整理的完整参考。

### 架构与段指令

```
|.arch x64              # 目标架构（x86, x64, arm, arm64, mips, ppc）
|.section code          # 声明代码段（定义 DASM_MAXSECTION）
|.align 16              # 对齐下一条指令（2 的幂，或：word/dword/aword/qword/oword）
```

`.arch` 指令必须是第一条 DynASM 指令，且只使用一次。它加载对应的 `dasm_ARCH.lua` 模块，该模块了解该目标的指令编码。

### 标签指令

```
|->main                 # 全局标签——编码后可通过全局数组寻址
|=>loop_start           # 动态 PC 相对标签（编号：=>0, =>1, ...）
|1:                     # 局部标签（作用于当前段，数字 1-9）
```

全局标签（`->name`）在 `dasm_encode()` 后成为全局数组的条目。动态标签（=>N）通过 `dasm_growpc()` 在运行时分配，在编码期间解析。局部标签（`1:` 到 `9:``）有作用域，用于处理器内部的短跳转。

### 数据指令

```
|.byte 0x90, 0x90      # 发射原始 8 位值
|.sbyte -1, 0, 1        # 发射有符号 8 位值
|.word 0x1234           # 发射 16 位值
|.dword 0x12345678      # 发射 32 位值
|.space 64, 0x00        # 发射 N 个填充字节
```

这些直接向输出发射数据字节——用于在代码段中嵌入常量表或填充。

### 反射指令

```
|.actionlist my_actions  # 生成动作列表数组（必需，只用一次）
|.globals lbl_           # 为全局标签生成枚举 + 设置查找
|.globalnames my_names   # 生成全局标签名称数组
|.externnames my_externs # 生成外部符号名称数组
```

`.actionlist` 指令是**必需**的——它生成驱动编码的 `static const unsigned char[]` 数组。`.globals` 指令生成一个枚举，把每个 `->label` 映射到整型常量（如 `lbl_main`、`lbl_loop`），以 `lbl__MAX` 结尾。

### 类型与宏指令

```
|.type state, lua_State, aState   # 语法糖：state->field → [aState + offsetof]
|.macro prologue                  # 定义宏（可作为指令调用）
|  push rbp
|  mov rbp, rsp
|.endmacro
|.define BASE, r12                # 简单替换：BASE → r12
```

`.type` 指令特别强大——你可以写 `state->top`，DynASM 会把它展开为 `[r12 + offsetof(lua_State, top)]`，把寄存器绑定和 C 结构体字段访问结合起来。

### 预预处理器指令

```
|.define X64, 1          # 定义替换（用于 ||#if 条件）
|.if X64                 # 条件编译（Lua 求值，沙箱化）
|.else
|.endif
|.include "other.dasc"   # 内联包含
|.error "message"        # 打印消息，最后失败
|.fatal "message"         # 打印消息，立即失败
```

`||` 前缀（双竖线）标记经过 `.define` 替换但 DynASM 不改变的行——用于标准 C 预处理器条件。

## 用 DynASM 构建你自己的迷你虚拟机

现在让我们把所有东西组合起来。我们将构建一个有 5 个操作码的最小字节码解释器，用 DynASM 写调度循环。这是 LuaJIT 做法的简化版——相同的模式，缩小了规模。

<!-- [UNIQUE INSIGHT] 你即将看到的模式——固定寄存器绑定、computed-goto 调度、热计数器——与 CPython 3.12 的特化解释器、V8 的 Ignition 和 LuaJIT 用的是同一种架构。DynASM 是 LuaJIT 的独特之处：它让汇编可移植。 -->

### 第 1 步：定义字节码

我们的迷你虚拟机是基于栈的架构，有 5 个操作码：

```
 ┌──────────┬──────────┬──────────────────────────────┐
 │  操作码   │  十六进制 │  操作                         │
 ├──────────┼──────────┼──────────────────────────────┤
 │  OP_NOP  │  0x00    │  什么都不做                    │
 │  OP_LOAD │  0x01    │  压入立即数                    │
 │  OP_ADD  │  0x02    │  弹出两个，压入和               │
 │  OP_PRINT│  0x03    │  弹出并打印栈顶                 │
 │  OP_HALT │  0x04    │  停止执行                      │
 └──────────┴──────────┴──────────────────────────────┘
```

一个计算 `1 + 2` 并打印结果的程序：

```
  byte code[] = {
    OP_LOAD, 1,    // 压入 1
    OP_LOAD, 2,    // 压入 2
    OP_ADD,        // 弹出 1 和 2，压入 3
    OP_PRINT,      // 弹出并打印 3
    OP_HALT        // 停止
  };
```

每个操作码 1 字节。`OP_LOAD` 后面跟 1 字节立即数；其余无操作数。

### 第 2 步：编写 DynASM 解释器

创建 `mini_vm.dasc`：

```c
#include <stdio.h>
#include <stdint.h>
#include "dasm_proto.h"
#include "dasm_x86.h"

// 操作码
#define OP_NOP   0x00
#define OP_LOAD  0x01
#define OP_ADD   0x02
#define OP_PRINT 0x03
#define OP_HALT  0x04

typedef struct {
  uint8_t *pc;       // 程序计数器 → 绑定到寄存器
  int32_t *sp;       // 栈指针 → 绑定到寄存器
  int32_t stack[256];// 操作数栈
} VM;

// 生成的函数签名：
//   void vm_run(VM *vm, uint8_t *bytecode)

|.arch x64
|.section code

void build_vm(dasm_State **D) {
  |->vm_run:

  // 寄存器契约：
  //   rdi = VM*（第一个参数）—— 我们称它为 'vm'
  //   rsi = uint8_t* bytecode —— 字节码缓冲区
  //   r12 = vm->pc
  //   r13 = vm->sp
  //   r14 = 调度表位置

  | mov r12, [rdi]        // r12 = vm->pc（从结构体加载）
  | mov r13, [rdi + 8]    // r13 = vm->sp（从结构体加载，偏移 8）

  // 主调度循环
  |->dispatch:
  | movzx eax, byte [r12] // 加载操作码字节
  | inc r12               // 推进 PC
  | jmp [rsi + rax*8]    // 通过调度表跳转到处理器

  // 处理器：OP_NOP (0x00)
  |->op_nop:
  | jmp ->dispatch

  // 处理器：OP_LOAD (0x01) — 下一字节是要压入的值
  |->op_load:
  | movzx eax, byte [r12] // 加载立即数
  | inc r12               // 推进操作数
  | mov [r13], eax        // 压入栈
  | add r13, 4            // sp += 4（int32）
  | jmp ->dispatch

  // 处理器：OP_ADD (0x02)
  |->op_add:
  | sub r13, 4            // sp -= 4（弹出栈顶）
  | mov eax, [r13]        // eax = 栈顶
  | sub r13, 4            // sp -= 4（弹出第二个）
  | add eax, [r13]        // eax = 第二个 + 栈顶
  | mov [r13], eax        // 压入结果
  | add r13, 4            // sp += 4
  | jmp ->dispatch

  // 处理器：OP_PRINT (0x03)
  |->op_print:
  | sub r13, 4            // 弹出栈顶
  | mov eax, [r13]        // eax = 要打印的值
  | //（实际代码中此处调用 printf —— 为清晰起见省略）
  | jmp ->dispatch

  // 处理器：OP_HALT (0x04)
  |->op_halt:
  | mov [rdi], r12        // 保存 vm->pc
  | mov [rdi + 8], r13    // 保存 vm->sp
  | ret                   // 返回调用者
}

|.actionlist vm_actions
```

### 第 3 步：C 驱动程序

```c
#include <stdio.h>
#include <stdlib.h>
#include <string.h>
#include <sys/mman.h>
#include "dasm_proto.h"
#include "dasm_x86.h"

// 由 DynASM 生成
extern void build_vm(dasm_State **D);

int main() {
  // 字节码程序：LOAD 1, LOAD 2, ADD, PRINT, HALT
  uint8_t program[] = {
    0x01, 0x01,   // OP_LOAD 1
    0x01, 0x02,   // OP_LOAD 2
    0x02,         // OP_ADD
    0x03,         // OP_PRINT
    0x04          // OP_HALT
  };

  // 设置虚拟机状态
  VM vm;
  vm.pc = program;
  vm.sp = vm.stack;

  // 构建 DynASM 状态
  dasm_State *d;
  dasm_init(&d, DASM_MAXSECTION);

  // 每个处理器的全局标签
  enum { lbl_vm_run, lbl_op_nop, lbl_op_load, lbl_op_add,
         lbl_op_print, lbl_op_halt, lbl__MAX };
  void *labels[lbl__MAX];
  dasm_setupglobal(&d, labels, lbl__MAX);

  // 设置动作列表并构建代码
  dasm_setup(&d, vm_actions);
  build_vm(&d);

  // 链接并分配
  size_t sz;
  dasm_link(&d, &sz);
  void *buf = mmap(0, sz, PROT_READ | PROT_WRITE,
                   MAP_PRIVATE | MAP_ANONYMOUS, -1, 0);
  dasm_encode(&d, buf);
  mprotect(buf, sz, PROT_READ | PROT_EXEC);

  // 构建调度表（操作码 → 处理器地址）
  void *dispatch[256];
  dispatch[OP_NOP]   = labels[lbl_op_nop];
  dispatch[OP_LOAD]  = labels[lbl_op_load];
  dispatch[OP_ADD]   = labels[lbl_op_add];
  dispatch[OP_PRINT] = labels[lbl_op_print];
  dispatch[OP_HALT]  = labels[lbl_op_halt];

  // 调用生成的解释器
  typedef void (*vm_fn)(VM*, void*);
  vm_fn run = (vm_fn)labels[lbl_vm_run];
  run(&vm, dispatch);

  printf("Result: %d\n", vm.stack[0]);  // 输出: Result: 3

  // 清理
  dasm_free(&d);
  munmap(buf, sz);
  return 0;
}
```

### 第 4 步：构建并运行

```bash
# 构建 minilua
gcc -o minilua src/host/minilua.c

# 预处理 DynASM 文件
./minilua dynasm/dasm.lua -o mini_vm_dasc.c mini_vm.dasc

# 编译
gcc -o mini_vm mini_vm_dasc.c vm_driver.c

# 运行
./mini_vm
# 输出: Result: 3
```

### 发生了什么？

你用汇编写了一个解释器循环，在构建时预处理成机器码，然后在运行时调用它。调度循环：

1. 从字节码流读取下一个操作码字节
2. 推进程序计数器
3. 通过调度表跳转到处理器（computed goto）
4. 每个处理器执行其逻辑并跳回调度
5. OP_HALT 保存状态并返回

这就是 LuaJIT 用的模式——缩小到 5 个操作码而不是 90 个，但结构完全相同。

## DynASM 如何桥接 C 与汇编

### 动作列表协议

当 `dynasm.lua` 预处理 `.dasc` 文件时，它不输出汇编文本——它输出一个**动作列表**：一系列整型操作码（`DASM_*` 常量），编码了"发射这个字节"、"解析这个标签"、"跳转到这个重定位类型"。

关键动作类型：

```
 ┌─────────────────────┬──────────┬──────────────────────────────────┐
 │  动作类型            │  值      │  含义                            │
 ├─────────────────────┼──────────┼──────────────────────────────────┤
 │  DASM_DISP          │  233     │  后跟位移量                       │
 │  DASM_IMM_S         │  234     │  有符号 8 位立即数                │
 │  DASM_IMM_B         │  235     │  无符号 8 位立即数                │
 │  DASM_IMM_W         │  236     │  16 位立即数                      │
 │  DASM_IMM_D         │  237     │  32 位立即数                      │
 │  DASM_VREG          │  238     │  虚拟寄存器引用                   │
 │  DASM_SPACE         │  239     │  保留 N 字节                      │
 │  DASM_SETLABEL      │  240     │  在当前位置设置标签               │
 │  DASM_REL_A         │  241     │  绝对重定位                       │
 │  DASM_REL_LG        │  242     │  全局相对重定位                   │
 │  DASM_REL_PC        │  243     │  PC 相对重定位                    │
 │  DASM_IMM_LG        │  244     │  全局 + 32 位立即数               │
 │  DASM_IMM_PC        │  245     │  PC 相对 + 32 位立即数            │
 │  DASM_LABEL_LG      │  246     │  当前位置的全局标签               │
 │  DASM_LABEL_PC      │  247     │  当前位置的 PC 相对标签           │
 │  DASM_ALIGN         │  248     │  对齐到 N 字节                    │
 │  DASM_EXTERN        │  249     │  外部符号引用                     │
 │  DASM_ESC           │  250     │  转义（下一字节为原始值）          │
 │  DASM_MARK          │  251     │  标记位置                         │
 │  DASM_SECTION       │  252     │  切换段                           │
 │  DASM_STOP          │  253     │  动作列表结束                     │
 └─────────────────────┴──────────┴──────────────────────────────────┘
```

动作列表是预处理器和运行时编码器之间的桥梁。预处理器发射动作；编码器（`dasm_encode()`）遍历动作列表并写入真实的机器字节。

### 编码流水线

```
 ┌──────────────┐     ┌──────────────┐     ┌──────────────┐     ┌──────────┐
 │  动作列表     ────▶│  dasm_link   │────▶│  分配内存     ────▶│dasm_encode│
 │  (DASM_*)     │     │  （计算大小） │     │（mmap）       │     │（发射字节）│
 └──────────────┘     └──────────────┘     └──────────────┘     └──────────┤
                                                                         │
       ┌─────────────────────────────────────────────────────────────────┘
       ▼
 ┌──────────────┐     ┌──────────────┐
 │ mprotect     │────▶│  作为函数    │
 │（RW → RX）   │     │  指针调用    │
 └──────────────┘     └──────────────┘
```

1. **`dasm_link()`** 遍历动作列表，解析所有标签（计算它们的最终偏移量），返回所需的总大小。这是试运行——不写入任何字节。

2. **内存分配** 通过 `mmap()` 以 `PROT_READ | PROT_WRITE`（尚不可执行——W^X 安全规范）。

3. **`dasm_encode()`** 再次遍历动作列表，这次向缓冲区写入真实的机器字节。标签解析为最终地址。重定位被修补。

4. **`mprotect()`** 把内存从 RW 翻转为 RX（读-执行）。缓冲区现在是可执行的机器码。

5. **转换并调用**——缓冲区（或特定标签的地址）被转换为函数指针并调用。

### 为什么这很优雅

传统的汇编工具链有**三阶段流水线**：汇编器（文本 → 目标文件）、链接器（目标文件 → 可执行文件）、加载器（可执行文件 → 运行中代码）。DynASM 把它压缩为**单次遍历**：

- 没有文本汇编（"汇编"是动作列表，已经解析）
- 没有目标文件（机器字节直接进入内存）
- 没有链接器（标签在编码期间解析）
- 没有单独的文件格式（输出是 C 数组中的原始字节）

结果：你在 `.dasc` 文件中写类汇编代码，运行预处理器，得到一个可以调用的函数。没有汇编器、没有链接器、没有 `.o` 文件。只有 C 和 DynASM。

## 从迷你虚拟机到 LuaJIT——接下来学什么

我们的迷你虚拟机有 5 个操作码和一个简单的调度循环。LuaJIT 的解释器有约 90 个操作码，但架构相同。完整解释器在这个基础上增加了：

- **90+ 个字节码操作码**，使用 V/S/N/P/B/M 后缀系统编码操作数类型
- **热计数器**——在循环和函数入口操作码上触发 JIT 编译
- **延续**（`lj_cont_*`）——用于字符串拼接和追踪拼接等可恢复操作
- **退出处理器**（`lj_vm_exit_handler`）——从 JIT 追踪去优化回解释器
- **基于快照的去优化**——JIT 在守卫点记录解释器状态，以便安全回退
- **追踪拼接**——链接在一起形成更长优化路径的侧追踪

本系列的下一篇文章将介绍**热计数器机制**和**追踪录制器**——LuaJIT 如何检测热路径、开始录制它们、并将它们编译成优化的机器码。这就是追踪式 JIT 的切入点，它直接建立在刚刚学到的解释器基础之上。

## 常见问题解答

### DynASM 是 JIT 编译器吗？

不是。DynASM 是**构建时**预处理器。它在编译项目时运行，而不是运行时。它生成的机器码是静态的——运行时不会改变。LuaJIT 的*追踪式 JIT* 是一个独立的系统（`lj_asm.c` 中的手写发射器），在运行时生成代码。DynASM 生成解释器；JIT 生成追踪代码。

### 我可以独立于 LuaJIT 使用 DynASM 吗？

可以。Dyn ASM 是 MIT 许可证的，且自包含。你只需要三个文件：`dynasm/dynasm.lua`（预处理器）、`dynasm/dasm_proto.h`（API 头文件）和 `dynasm/dasm_x86.h`（或对应的架构模块）。构建时依赖是 `minilua`（一个 15K 行的精简 Lua 解释器，包含在 LuaJIT 的 `src/host/` 中）。有多个项目独立使用 DynASM：RaptorJIT（LuaJIT 的分支）、各种教育用 JIT 编译器，以及高性能数值内核。

### DynASM 支持哪些架构？

x86（32 位）、x64（64 位）、ARM（32 位）、ARM64（64 位）、MIPS（32 和 64 位）和 PowerPC。架构模块（`dasm_x86.lua`、`dasm_arm64.lua` 等）编码指令集的具体细节。LuaJIT 提供全部 7 个目标；一个典型项目只需要一到两个。

### computed-goto 调度与 switch 语句相比如何？

`switch` 调度需要编译器生成分支表或比较链——通常每次调度 3-5 条指令。computed-goto（`jmp [table + index*8]`）是**单次间接跳转**——1 条指令，1 次缓存访问。代价：computed-goto 更难调试（你在跳转到原始地址）且不可移植到所有编译器（不过 DynASM 解决了可移植性问题）。对于每秒调度数百万次的解释器，单指令调度是值得的。

### `->label` 和 `=>N` 有什么区别？

`->name` 是**全局标签**——它在全局数组中有一个条目，编码后可以通过名称查找（如 `labels[lbl_main]`）。`=>N` 是**动态标签**——它编号，通过 `dasm_growpc()` 在运行时分配，用于生成代码中的前向/后向跳转（如循环分支）。全局标签用于函数入口点；动态标签用于函数内部的控制流。

## 来源

- Mike Pall, LuaJIT 源码（`src/vm_x64.dasc`, `dynasm/dasm_proto.h`, `dynasm/dasm_x86.h`）, [LuaJIT GitHub](https://github.com/LuaJIT/LuaJIT)
- Mike Pall, "DynASM — Dynamic Assembler for code generation engines", [luajit.org/dynasm.html](https://luajit.org/dynasm.html)
- Peter Cawley, "Unofficial DynASM Documentation", [corsix.github.io/dynasm-doc](https://corsix.github.io/dynasm-doc/), CC BY 3.0
- LuaJIT 项目，约 5,000 GitHub stars，`v2.1` 滚动发布分支, [github.com/LuaJIT/LuaJIT](https://github.com/LuaJIT/LuaJIT)
