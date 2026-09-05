---
title: "编译期元编程的巅峰：FOLD 引擎与半完美哈希规则查找"
description: "LuaJIT 的优化器只有 2653 行代码，却处理常量折叠、代数化简、CSE 等。学习 FOLD 引擎如何利用构建时生成的半完美哈希表实现 O(1) 规则匹配。"
coverImage: "/posts/luajit-fold-engine-metaprogramming/images/cover.jpg"
coverImageAlt: "FOLD 引擎概念：24 位键哈希到折叠函数表中，代表半完美哈希规则查找"
ogImage: "/posts/luajit-fold-engine-metaprogramming/images/cover.jpg"
date: "2026-09-05 22:00:00"
lastUpdated: "2026-09-05 22:00:00"
author: "FindNS94"
tags: ["LuaJIT", "FOLD", "Compiler"]
---

![FOLD 引擎概念：24 位键哈希到折叠函数表中，代表半完美哈希规则查找](/posts/luajit-fold-engine-metaprogramming/images/cover.jpg)

LuaJIT 的优化器只有 2653 行代码。但它处理常量折叠、代数化简、数组边界检查消除、公共子表达式消除、加载前递和死存储消除。怎么做到的？

答案是 **FOLD 引擎**：一个由构建时生成的半完美哈希表驱动的基于规则的优化器。每次追踪录制期间发射指令时，FOLD 引擎检查是否有优化规则适用——O(1) 时间，无需字符串匹配，无需 if-else 链，无需访问者模式。

这是编译期元编程的巅峰：一个 Lua 脚本扫描宏规范并生成最优 C 查找表。结果是快速、可扩展且极其紧凑的优化器。

在本文中，你将学习 FOLD 引擎架构、LJFOLD 宏系统、半完美哈希表、通配符迭代精炼、构建时代码生成，以及为什么这个设计如此优雅。

> **核心要点**
> - FOLD 引擎是基于规则的优化器，在追踪录制期间对每条发射的指令运行。
> - 规则通过 `LJFOLD()` 宏定义，并在构建时编译成半完美哈希表。
> - 24 位键 `(ins_opcode, left_opcode, right_opcode)` 实现 O(1) 规则查找。
> - 通配符迭代精炼允许规则匹配越来越一般的模式。
> - 这是编译期元编程：Lua 脚本从宏规范生成 C 查找表。

## FOLD 引擎架构

FOLD 引擎位于 LuaJIT 优化的核心。它在追踪录制期间对每条发射的指令运行——不是作为单独的阶段，而是与指令创建内联。

### FOLD 在流水线中的位置

```
 字节码 → [lj_record_ins()] → emitir(ot, a, b)
                                      │
                              ┌───────▼────────┐
                              │  lj_ir_set()   │  创建 IR 指令
                              └───────┬────────┘
                                      │
                              ┌───────▼────────┐
                              │ lj_opt_fold()  │  ← FOLD 引擎在此运行
                              └───────┬────────┘
                                      │
                              ┌───────▼────────┐
                              │  折叠后的 IR    │  优化后的指令
                              └────────────────┘
```

`emitir()` 宏把一切绑在一起：

```c
#define emitir(ot, a, b)  (lj_ir_set(J, (ot), (a), (b)), lj_opt_fold(J))
```

这创建 IR 指令，然后立即对它运行 FOLD 引擎。折叠可能：
- 用常量替换指令（常量折叠）
- 用操作数替换指令（代数化简）
- 标记为 CSE（公共子表达式消除）
- 保持不变（无规则匹配）

### 为什么在录制期间折叠？

多数编译器把指令选择和优化分开。前端发射 IR，然后优化阶段变换它。LuaJIT 在录制期间折叠是因为：

1. **类型信息新鲜**：守卫刚被发射，类型已知
2. **单次遍历**：简单折叠无需单独优化阶段
3. **更小 IR**：折叠后的指令不占用追踪空间
4. **更好 CSE**：常量立即可供后续指令使用

代价：录制期间更多工作。但录制只对热代码发生，成本被摊销。

## LJFOLD 宏系统

优化规则通过 `LJFOLD` 宏声明式定义。每条规则指定：指令操作码、左操作数类型、右操作数类型、要调用的折叠函数。

### 规则定义

```c
LJFOLD(ADD KNUM KNUM)
  LJFOLD_FUNC(kfold_numarith)
LJFOLD_END

LJFOLD(ADD KINT KINT)
  LJFOLD_FUNC(kfold_intarith)
LJFOLD_END

LJFOLD(FLOAD KGC IRFL_FUNC_FFID)
  LJFOLD_FUNC(fload_func_ffid_kgc)
LJFOLD_END

LJFOLD(XLOAD any any)
  LJFOLD_FUNC(lj_opt_fwd_xload)
LJFOLD_END

LJFOLD(ASTORE any any)
  LJFOLD_FUNC(lj_opt_dse_ahstore)
LJFOLD_END
```

语法：`LJFOLD(INSTRUCTION LEFT RIGHT)` 后跟折叠函数名。`any` 关键字表示「匹配任意操作数类型」。

### 规则类别

| 类别 | 示例规则 | 作用 |
|------|---------|------|
| 常量折叠 | `ADD KNUM KNUM` → 录制时计算 | `3 + 4` → `7` |
| 代数化简 | `ADD(x, 0)` → `x` | 强度削减 |
| ABC 消除 | `ABC(any, ABC)` → 嵌套检查 | 数组边界优化 |
| CSE | `HREF any any` → 检查链 | 公共子表达式 |
| 加载前递 | `XLOAD any any` → 前递存储 | 用存储值替换加载 |
| 死存储消除 | `ASTORE any any` → 检查活跃性 | 删除无用存储 |
| 守卫优化 | `FAILFOLD`/`DROPFOLD` | 移除恒假/恒真守卫 |

### 折叠函数

每个折叠函数接收 JIT 结构和指令，返回一个终止动作：

```c
enum {
  NEXTFOLD,     // 继续搜索下一条规则
  RETRYFOLD,    // 重新折叠（修改后的）指令
  INTFOLD(k),   // 用整型常量 k 替换
  LEFTFOLD,     // 用左操作数替换
  RIGHTFOLD,    // 用右操作数替换
  CSEFOLD,      // 执行 CSE
  EMITFOLD,     // 原样发射指令
  FAILFOLD,     // 守卫恒假（退出追踪）
  DROPFOLD,     // 守卫恒真（删除它）
};
```

## 半完美哈希表

FOLD 引擎的性能来自其查找结构：构建时生成的**半完美哈希表**。

### 24 位键

```
 ┌──────────────┬──────────────┬──────────────┐
 │  ins_opcode  │ left_opcode  │ right_opcode │
 │   (8 位)     │  (8 位)      │  (8 位)      │
 └──────────────┴──────────────┴──────────────┘
       23-16          15-8           7-0
```

- **ins_opcode**：被折叠指令的操作码（8 位 = 256 种可能操作码）
- **left_opcode**：左操作数的操作码（8 位；若左操作数为常量/字面量则为 0）
- **right_opcode**：右操作数的操作码（8 位；若右操作数为常量/字面量则为 0）

字面量（常量）用其最低 8 位作为哈希的「操作码」。未使用的操作数用 0。

### 为什么是半完美？

**完美哈希**保证 O(1) 查找，域中任何键零冲突。**半完美哈希**保证**已定义**键（有规则的键）零冲突，但未定义键可能有冲突。

这正是 FOLD 引擎需要的：每次规则查找恰好命中一个已定义规则（或无规则）。未定义键可能哈希到被占用的槽，但折叠函数返回 `NEXTFOLD` 继续搜索。

### 生成的表

构建时，`buildvm_fold.c` 生成两个数组：

```c
// 由 buildvm_fold.c 生成
static const uint16_t fold_hash[DASM_FOLD_HASH_SIZE] = {
  0x0000, 0x0001, 0x0000, 0x0002, ...
};

static const FoldFunc fold_functions[] = {
  kfold_numarith,       // 索引 0
  kfold_intarith,       // 索引 1
  fload_func_ffid_kgc,  // 索引 2
  ...
};
```

查找：

```c
uint32_t key = (ins << 16) | (left << 8) | right;
uint16_t hash = fold_hash[key % DASM_FOLD_HASH_SIZE];
FoldFunc func = fold_functions[hash];
```

## 迭代精炼——通配符匹配

让 FOLD 引擎强大的关键洞察：当特定规则不匹配时，引擎不会放弃。它用通配符掩码键并重试，从最具体到最一般。

### 四个层级

```
 第 1 层（精确）：     ins=left=ADD, right=KNUM, left_op=KGC, right_op=KNUM
                       → 查找：(ADD, KGC, KNUM)

 第 2 层（通配 L）：   ins=left=ADD, right=KNUM, left_op=any, right_op=KNUM
                       → 查找：(ADD, any, KNUM)

 第 3 层（通配 R）：   ins=left=ADD, right=KNUM, left_op=KGC, right_op=any
                       → 查找：(ADD, KGC, any)

 第 4 层（通配 LR）：  ins=left=ADD, right=KNUM, left_op=any, right_op=any
                       → 查找：(ADD, any, any)
```

`any` 掩码按规则定义，允许部分通配符。规则可以指定「匹配任意左操作数但特定右操作数」。

### 为什么这很重要

没有通配符，你需要为操作数的每种可能组合写一条规则。有了通配符，一条通用规则可以处理许多特定情况：

```c
// 特定规则：两个已知数字相加
LJFOLD(ADD KNUM KNUM) → kfold_numarith

// 通用规则：任意操作数的加法（强度削减）
LJFOLD(ADD any any) → lj_opt_fold_add  // 处理 x+0, 0+x 等
```

特定规则先触发。如果不匹配，通用规则捕获该情况。

## 终止动作——规则匹配时发生什么

折叠函数执行时，返回一个终止动作，决定指令的命运。

### 动作

```
 ┌─────────────────────────────────────────────────────────────┐
 │  动作           │  效果                                      │
 ├────────────────┼────────────────────────────────────────────┤
 │  NEXTFOLD      │  继续搜索下一条规则                         │
 │  RETRYFOLD     │  重新折叠（修改后的）指令                   │
 │  INTFOLD(k)    │  用整型常量 k 替换                          │
 │  LEFTFOLD      │  用左操作数替换                             │
 │  RIGHTFOLD     │  用右操作数替换                             │
 │  CSEFOLD       │  执行公共子表达式消除                       │
 │  EMITFOLD      │  原样发射指令                               │
 │  FAILFOLD      │  守卫恒假（退出追踪）                       │
 │  DROPFOLD      │  守卫恒真（删除它）                         │
 └────────────────┴────────────────────────────────────────────┘
```

### 实际示例

```c
// 常量折叠：ADD(KNUM 3, KNUM 4) → INTFOLD(7)
LJFOLD(ADD KNUM KNUM)
  if (op1->n + op2->n == (int32_t)(op1->n + op2->n))
    return INTFOLD((int32_t)(op1->n + op2->n));
  return NEXTFOLD;
LJFOLD_END

// 强度削减：ADD(x, KNUM 0) → LEFTFOLD
LJFOLD(ADD any KNUM)
  if (op2->n == 0) return LEFTFOLD;  // x + 0 = x
  return NEXTFOLD;
LJFOLD_END

// 死存储：对未读槽的 ASTORE → DROPFOLD
LJFOLD(ASTORE any any)
  if (slot_is_dead(op1)) return DROPFOLD;
  return NEXTFOLD;
LJFOLD_END
```

## 构建时代码生成——元技巧

FOLD 引擎最非凡的方面：哈希表不是手写的。它由构建时的 Lua 脚本扫描源码中的 `LJFOLD` 宏**生成**。

### 流水线

```
 ┌──────────────────┐     ┌──────────────────┐     ┌──────────────────┐
 │  lj_opt_fold.c   │────▶│  buildvm_fold.c  │────▶│  lj_folddef.h    │
 │  (LJFOLD 宏)     │     │  (Lua 脚本)      │     │  (生成的         │
 │                  │     │  扫描并生成       │     │   哈希表)        │
 └──────────────────┘     └──────────────────┘     └──────────────────┘
        │                                                    │
        │                                                    ▼
        │                                            ┌──────────────────┐
        └───────────────────────────────────────────▶│  编译进           │
                                                     │  luajit 二进制    │
                                                     └──────────────────┘
```

### 工作原理

1. `buildvm_fold.c`（构建时运行的 C 程序）扫描 `lj_opt_fold.c` 中的 `LJFOLD(...)` 宏调用
2. 从每个宏提取指令、左、右和函数名
3. 构建从 24 位键到函数索引的哈希表
4. 生成 `lj_folddef.h`——包含 `fold_hash[]` 数组和 `fold_functions[]` 表的 C 头文件

### 为什么这是「编译期元编程」

这种技术——使用脚本从声明式规范生成优化查找表——是编译期元编程的精髓：

- **声明式规则**：你说*优化什么*，而非*如何匹配*
- **最优代码生成**：生成器产生最快的可能查找结构
- **零运行时成本**：哈希表预计算；运行时无解析或匹配
- **可扩展性**：添加规则 → 加一个宏 → 重建

### 对比：传统方案

| 方案 | 优点 | 缺点 |
|------|------|------|
| if-else 链 | 简单易理解 | O(n) 查找，难维护 |
| 访问者模式 | 可扩展，OO | 虚函数分派开销，样板代码 |
| 字符串匹配 | 灵活 | 慢，易出错 |
| **半完美哈希** | **O(1)，紧凑，快** | 需要构建时生成 |

## CSE——公共子表达式消除

FOLD 引擎与 LuaJIT 的 CSE 机制紧密集成。当折叠返回 `CSEFOLD` 时，引擎搜索已发射的相同指令。

### 跳表链

每个操作码有一个跳表链（`J->chain[op]`），链接该操作码的所有指令。对于 CSE，引擎遍历链寻找 `(op1, op2)` 匹配的指令：

```c
// 简化的 CSE 搜索
IRRef lj_opt_cse(jit_State *J, IROp op, IRRef op1, IRRef op2) {
  IRRef ref = J->chain[op];
  IRRef lim = op1 > op2 ? op1 : op2;  // 只搜索前驱
  while (ref > lim) {
    IRIns *ir = IR(ref);
    if (ir->op1 == op1 && ir->op2 == op2) return ref;  // 找到匹配！
    ref = ir->prev;
  }
  return 0;  // 无匹配
}
```

`lim` 边界是关键：由于引用按 SSA 顺序（指令向上增长），任何匹配必须是前驱。这分摊搜索为 O(1) 时间。

### 与 FOLD 的集成

当折叠返回 `CSEFOLD` 时，引擎运行 CSE 搜索。如果找到匹配，当前指令被替换为已有引用——无重复计算。

## 为什么这个设计优雅

FOLD 引擎代表了编译器构造技术的最高水平。原因如下：

### 关注点分离

规则声明式定义。引擎处理匹配。你不写匹配逻辑；你写*优化什么*。这使规则易于阅读、验证和扩展。

### 可扩展性

添加新优化只需一条 `LJFOLD` 宏和一个折叠函数。无需改引擎，无需改哈希表生成器（自动发现新规则）。

### 性能

- **O(1) 查找**：每条指令单次哈希表访问
- **无字符串匹配**：键是整数，非字符串
- **无 if-else 链**：哈希表替代了数百条条件判断
- **紧凑**：整个优化器 2653 行

### 「编译期元编程的巅峰」

这种技术——使用构建时脚本从声明式宏规范生成最优查找表——是编译期元编程的巅峰，因为：

1. **生成器简单**：Lua 脚本扫描宏并构建哈希表
2. **输出最优**：半完美哈希保证 O(1) 且已定义键无冲突
3. **接口干净**：规则声明式，非过程式
4. **成本为零**：所有计算在构建时完成；运行时只是表查找

这种模式——声明式规则 + 构建时代码生成——远不止适用于 LuaJIT。任何需要对结构化数据做快速模式匹配的系统都能从中受益。

## 常见问题解答

### 为什么在录制期间而非之后折叠？

录制期间类型信息新鲜——守卫刚被发射，类型已知。录制期间折叠避免单独优化阶段并保持 IR 小。代价是录制期间更多工作，但录制只对热代码发生。

### 如果两条规则匹配会怎样？

最具体的匹配胜出。迭代精炼先尝试精确匹配，然后逐步通配操作数。第一个返回非 `NEXTFOLD` 终止动作的规则胜出。

### 我能添加自定义折叠规则？

可以。添加 `LJFOLD(INSTRUCTION LEFT RIGHT)` 宏和你的折叠函数，然后重建。构建时生成器会发现你的新规则并包含进哈希表。

### 有多少条折叠规则？

约 200+ 条规则，覆盖常量折叠、代数化简、ABC 消除、CSE、加载前递、死存储消除和守卫优化。它们定义在 `lj_opt_fold.c` 各处。

### 哈希表是完美还是半完美？

半完美。已定义键（有规则的键）零冲突。未定义键可能哈希到被占用的槽，但折叠函数返回 `NEXTFOLD` 继续搜索，所以无害。

## 来源

- Mike Pall, LuaJIT 源码（`src/lj_opt_fold.c`, `src/host/buildvm_fold.c`, `src/lj_folddef.h`）, [LuaJIT GitHub](https://github.com/LuaJIT/LuaJIT)
- Mike Pall, "LuaJIT 2.1 FOLD 引擎文档", [luajit.org](https://luajit.org)
- 编译文献：半完美哈希表、哈希函数的格雷码生成
