---
title: "C 与 Lua 的零成本握手：FFI 子系统架构解剖"
description: "LuaJIT 让你调用 C 函数、访问 C 结构体、实现回调，无需编写 C 胶水代码。学习 FFI 子系统如何以近乎零开销桥接两个世界。"
coverImage: "/posts/luajit-ffi-zero-cost-handshake/images/cover.jpg"
coverImageAlt: "两半——C（蓝）和 Lua（绿）——由中心的绿色 FFI 桥连接，代表零成本握手"
ogImage: "/posts/luajit-ffi-zero-cost-handshake/images/cover.jpg"
date: "2026-09-06 02:00:00"
lastUpdated: "2026-09-06 02:00:00"
author: "FindNS94"
tags: ["LuaJIT", "FFI", "C Interop"]
---

![两半——C（蓝）和 Lua（绿）——由中心的绿色 FFI 桥连接，代表零成本握手](/posts/luajit-ffi-zero-cost-handshake/images/cover.jpg)

LuaJIT 让你调用 C 函数、访问 C 数据结构、实现回调——所有这些都无需编写一行 C 胶水代码。开销？对于简单调用，实际上是零。对于复杂类型，编组层自动处理复杂性。

这就是 **FFI（外部函数接口）**子系统：一个以卓越效率桥接 Lua 和 C 的独立模块。这是我们 LuaJIT 内部深度探索系列的收官之作，将我们学到的所有知识——NaN-boxed 值、JIT 编译器、DynASM 和 GC——整合成一个连贯的整体。

在本文中，你将学习 FFI 架构、C 类型系统、最简解析器、平台调用约定、回调跳板、类型转换，以及让一切从 Lua 可达的元方法接口。

> **核心要点**
> - FFI 是一个独立子系统：类型系统、解析器、调用处理、回调、转换。
> - C 类型在中央表（`CTState`）中驻留，实现快速类型查找和重用。
> - 回调使用动态生成的机器码跳板，实现近乎零开销。
> - 解析器是最简的——不是验证型 C 解析器，只够 FFI 声明使用。
> - 类型编组自动处理 C/Lua 值转换的复杂性。

## 架构概览——独立子系统

FFI 在九个源文件中实现，每个处理不同的职责：

```
 ┌─────────────────────────────────────────────────────────────────┐
 │                     FFI 子系统架构                                │
 │                                                                 │
 │  lib_ffi.c        │ 面向 Lua 的 API（ffi.cdef、ffi.new 等）     │
 │  lj_ctype.c       │ C 类型系统（CTState、CType、驻留）          │
 │  lj_cparse.c      │ C 声明解析器（最简，为 FFI 设计）           │
 │  lj_ccall.c       │ C 函数调用（平台调用约定）                  │
 │  lj_ccallback.c   │ Lua→C 回调（动态跳板）                     │
 │  lj_cconv.c       │ 类型转换（Lua ↔ C 编组）                   │
 │  lj_cdata.c       │ C 数据对象（GCcdata、可变大小）             │
 │  lj_clib.c        │ C 库加载（dlopen、命名空间）               │
 │  lj_carith.c      │ C 数据算术（cdata 元方法）                  │
 └─────────────────────────────────────────────────────────────────┘
```

流程：Lua 代码调用 `ffi.cdef("...")` → 解析器构建类型描述符 → 类型驻留在 `CTState` 中 → `ffi.C.func()` 通过 `lj_ccall.c` 调用 C → 结果通过 `lj_cconv.c` 转换 → 作为 Lua 值返回。

## C 类型系统——驻留类型描述符

FFI 的核心是一个将 C 类型表示为驻留描述符的类型系统。

### CTState 结构

```c
typedef struct CTState {
  CType *tab;           /* C 类型表（动态数组） */
  CTypeID top;          /* 当前顶部 */
  MSize sizetab;
  lua_State *L;
  global_State *g;
  GCtab *miscmap;       /* -CTypeID → 元表；cb slot → func */
  CCallback cb;         /* 临时回调状态 */
  CTypeID1 hash[CTHASH_SIZE];  /* 哈希锚点 */
} CTState;
```

类型表是 `CType` 描述符的动态数组。类型被驻留——相同类型共享同一个 `CTypeID`，实现快速相等比较。

### CType 结构

```c
typedef struct CType {
  CTInfo info;      /* 类型信息：type(4) + flags(20) + cid/attrib(16) */
  CTSize size;      /* 类型大小 */
  CTypeID1 sib;     /* 兄弟元素 */
  CTypeID1 next;    /* 哈希链下一个 */
  GCRef name;       /* 元素名称（GCstr） */
} CType;
```

`info` 字段是打包位域：
- 位 0-3：类型号（VOID、STRUCT、PTR、ARRAY 等）
- 位 4-23：标志（CONST、UNSIGNED、LONG 等）
- 位 23-31：cid 或属性

### 预定义类型

LuaJIT 在启动时预定义常用 C 类型：
- VOID、BOOL、INT8-UINT128、FLOAT、DOUBLE
- COMPLEX_FLOAT、COMPLEX_DOUBLE
- P_VOID、P_CCHAR（指针类型）

### 类型驻留

解析类型时，FFI 首先检查相同类型是否已存在。如果存在，重用现有 `CTypeID`。通过哈希表（`CTState.hash`）完成：

```c
CTypeID lj_ctype_intern(CTState *cts, CTInfo info, CTSize size) {
  /* 检查此类型是否已存在 */
  CTypeID id = find_type(cts, info, size);
  if (id) return id;  /* 重用已存在类型 */
  /* 创建新类型 */
  return add_type(cts, info, size);
}
```

## C 声明解析器——最简但足够

FFI 解析器**不是**验证型 C 编译器。它是专为 FILL 声明设计的最简解析器。

### 为什么不验证？

FFI 信任程序员。如果你声明 `int foo(char *s)` 但实际函数接受 `int`，那是你的 bug。解析器的任务是：
1. 为 JIT 构建类型描述符
2. 确定调用约定
3. 生成正确的编组代码

### CPState 结构

```c
typedef struct CPState {
  CPChar c; CPToken tok; CPValue val; GCstr *str; CType *ct;
  const char *p; SBuf sb; lua_State *L; CTState *cts;
  TValue *param; const char *srcname; BCLine linenumber;
  int depth; uint32_t tmask; uint32_t mode;
  uint8_t packstack[CPARSE_MAX_PACKSTACK]; uint8_t curpack;
} CPState;
```

解析器有自己的词法分析器（`cp_number`、`cp_ident`、`cp_param`），对 C 声明进行分词。它处理：
- 声明说明符（`int`、`const`、`unsigned`、`struct` 等）
- 声明符（指针/数组/函数声明符）
- 抽象类型（无名称）
- 位域、枚举、结构体/联合体
- 属性（`__attribute__`、`__declspec`）

### 模式标志

```c
#define CPARSE_MODE_ABSTRACT   /* 解析抽象类型（无名称） */
#define CPARSE_MODE_DIRECT     /* 解析直接声明 */
#define CPARSE_MODE_FIELD      /* 解析结构体字段 */
#define CPARSE_MODE_SKIP       /* 跳过声明（仅计数） */
```

## 调用 C 函数——平台调用约定

从 Lua 调用 C 需要理解平台的调用约定——哪些寄存器保存参数、结构体如何返回等。

### lj_ccall.c 结构

```c
/* 平台特定的限制 */
#if LJ_TARGET_X86
#define CCALL_MAX_GPR  2   /* eax, edx */
#define CCALL_MAX_FPR  0   /* 无 FP 寄存器传参 */
#elif LJ_TARGET_X64
#define CCALL_MAX_GPR  6   /* rdi, rsi, rdx, rcx, r8, r9 (SysV) */
#define CCALL_MAX_FPR  8   /* xmm0-7 */
/* Win64: 4 GPR, 4 FPR */
#elif LJ_TARGET_ARM64
#define CCALL_MAX_GPR  8   /* x0-x7 */
#define CCALL_MAX_FPR  8   /* d0-d7 */
#endif
```

### 调用路径

1. `ffi.C.func(args)` → `lib_ffi.c` 中的 `lj_ccall_func()`
2. 通过 `lj_cconv.c` 将 Lua 参数编组到 C 寄存器/栈
3. 调用 C 函数指针
4. 通过 `lj_cconv.c` 将 C 返回值编组为 Lua 值

### 结构体返回

不同平台对结构体返回的处理不同：
- **x86-64 SysV**：≤ 16 字节的结构体通过寄存器返回；更大的通过隐藏指针
- **x86-64 Win64**：≤ 8 字节的在寄存器；更大的通过隐藏指针
- **ARM64**：≤ 16 字节的在寄存器；更大的通过隐藏指针

FFI 自动处理所有这些情况。

## C 数据对象——cdata

C 数据存储在 `GCcdata` 对象中——内联保存 C 数据的 Lua 值。

### GCcdata 结构

```c
typedef struct GCcdata {
  GCHeader;
  CTypeID1 ctypeid;   /* 对 C 类型的引用 */
  /* 数据跟随此处（可变大小） */
} GCcdata;

/* 可变大小 cdata（VLA、对齐） */
typedef struct GCcdataVar {
  CTypeID1 ctypeid;
  CTSize len;         /* 额外长度 */
  CTSize extra;       /* 前缀额外 */
  /* 数据跟随 */
} GCcdataVar;
```

`ctypeid` 链接到 `CTState` 中的类型描述符，告诉 FFI 如何解释、转换和垃圾回收数据。

### 创建 cdata

```lua
-- 创建 C 整数
local x = ffi.new("int", 42)        -- 保存 int 42 的 cdata

-- 创建 C 结构体
local s = ffi.new("struct { int x; double y; }", 1, 2.0)

-- 创建 C 指针
local p = ffi.new("int[10]")        -- 10 个整数的数组
```

## 回调——动态生成的跳板

FFI 最精巧的部分：让 C 代码回调 Lua 函数的回调机制，开销近乎零。

### 回调页池

```c
#define CALLBACK_MCODE_SIZE  (LJ_PAGESIZE * LJ_NUM_CBPAGE)
/* 默认：4096 * 256 = 1MB 可执行内存 */
```

专用可执行内存页池保存动态生成的机器码。每个槽是一个小型跳板：

### 跳板生成（x86）

```asm
; 每个回调槽：
mov al, slot_number    ; 2 字节：B0 xx
jmp lj_vm_ffi_callback ; 5 字节：E9 xx xx xx xx
; 每个槽共 7 字节
```

槽编号直接编码在指令中，然后跳转到公共处理程序。处理程序查找槽，从 `cts->miscmap` 检索 Lua 函数，将 C 参数转换为 Lua 值，调用函数，并转换结果。

### 跳板生成（ARM64）

```asm
; ARM64 跳板：
mov x16, slot_number   ; 加载槽编号
b lj_vm_ffi_callback   ; 跳转到处理程序
```

### CCallback 结构

```c
typedef struct CCallback {
  FPRCBArg fpr[CCALL_MAX_FPR];  /* FPR 参数/结果 */
  intptr_t gpr[CCALL_MAX_GPR];  /* GPR 参数/结果 */
  intptr_t *stack;              /* 栈参数 */
  void *mcode;                  /* 机器码基址 */
  CTypeID1 *cbid;               /* 回调类型表 */
  MSize sizeid, topid, slot;
} CCallback;
```

### 创建回调

```lua
-- 创建回调：调用 Lua 函数的 C 函数指针
local cb = ffi.callback("int(*)(int)", function(x)
  return x * 2
end)

-- 传递给 C 函数
ffi.C.qsort(array, n, ffi.sizeof("int"), cb)
```

`ffi.callback()` 函数：
1. 在回调页池中分配一个槽
2. 返回该槽跳板的函数指针
3. 将 Lua 函数存储在 `cts->miscmap[slot]` 中

当 C 调用回调时，跳板分派给 `lj_vm_ffi_callback`，后者执行完整的 Lua/C 转换。

```
 C 代码调用回调          跳板               公共处理程序
 ──────────────────────▶  mov al, slot ───▶  lj_vm_ffi_callback
                                                        │
                                                        ▼
                                              ┌──────────────────┐
                                              │ 查找 Lua 函数     │
                                              │ 转换 C 参数       │
                                              │ 调用 Lua 函数     │
                                              │ 转换结果          │
                                              └──────────────────┘
```

## 类型转换——编组层

`lj_cconv.c` 文件处理所有 Lua ↔ C 值转换。

### 转换类别

| 方向 | 源 | 目标 | 复杂度 |
|------|-----|------|--------|
| Lua → C | 数字 | int/浮点 | 直接 |
| Lua → C | cdata | 相同类型 | 直接 |
| Lua → C | 字符串 | char* | 复制 |
| C → Lua | int/浮点 | 数字 | 直接 |
| C → Lua | 结构体 | cdata | 复制 |
| C → Lua | 指针 | cdata | 包装 |

### 整数提升

实现了 C 的整数提升规则：
- `char`/`short` 在传给 varargs 时 → `int`
- `float` 在传给 varargs 时 → `double`
- 无符号类型保持其范围

### 结构体复制

结构体逐字段复制，遵守对齐和填充。FFI 使用类型描述符确定字段布局。

## 元方法接口——面向 Lua 的 API

FFI 通过 cdata 对象上的元方法和全局 `ffi` 表暴露其功能。

### CData 元方法

| 元方法 | 作用 |
|--------|------|
| `__index` | 字段访问（结构体）、数组索引、函数调用 |
| `__newindex` | 字段赋值、数组元素赋值 |
| `__eq` | 按值比较 |
| `__len` | 数组长度、字符串长度 |
| `__lt`/`__le` | 比较运算符 |
| `__concat` | 字符串连接 |
| `__call` | 把 cdata 当函数调用 |
| `__add`/`__sub` 等 | 数值 cdata 的算术 |
| `__tostring` | 转换为字符串 |
| `__pairs`/`__ipairs` | 迭代 |

### ffi 表

```lua
ffi.cdef(声明)           -- 解析 C 声明
ffi.new(type [, value])  -- 分配 C 数据
ffi.cast(type, value)    -- 将值转换为类型
ffi.typeof(type)         -- 创建类型对象
ffi.sizeof(type)         -- 获取类型大小
ffi.alignof(type)        -- 获取类型对齐
ffi.offsetof(type, field) -- 获取字段偏移
ffi.istype(type, value)  -- 类型检查
ffi.string(ptr [, len])  -- C 字符串转 Lua
ffi.copy(dst, src, len)  -- 内存复制
ffi.fill(ptr, len, val)  -- 内存填充
ffi.load(name)           -- 加载共享库
ffi.metatype(type, mt)   -- 为类型设置元表
ffi.gc(ptr, finalizer)   -- 设置终结器
ffi.callback(type, func) -- 创建回调
ffi.abi(name)            -- 检查平台 ABI
ffi.errno([newerr])      -- 获取/设置 errno
ffi.C                    -- 默认 C 库命名空间
ffi.os                   -- 操作系统名称
ffi.arch                 -- 架构名称
```

### 完整工作流示例

```lua
local ffi = require("ffi")

-- 1. 声明 C 类型和函数
ffi.cdef[[
typedef struct { int x; double y; } Point;
double distance(Point a, Point b);
]]

-- 2. 加载 C 库
local lib = ffi.load("mylib")

-- 3. 创建 C 数据
local p1 = ffi.new("Point", {1.0, 2.0})
local p2 = ffi.new("Point", {3.0, 4.0})

-- 4. 调用 C 函数
local d = lib.distance(p1, p2)

-- 5. 创建回调
local cb = ffi.callback("int(*)(int)", function(x) return x * 2 end)

-- 6. 访问结构体字段
print(p1.x)  -- 元方法 __index
p1.x = 42    -- 元方法 __newindex
```

## 常见问题解答

### C 解析器是完整的 C 编译器吗？

不是。它是专为 FILL 声明设计的最简解析器。它不验证类型、检查语义或生成代码。如果你声明了错误的类型，FFI 信任你——崩溃是你的问题。

### FFI 调用的开销是多少？

对于简单调用（整数/指针参数，无结构体编组），开销近乎零——只需调用约定设置。对于复杂类型（结构体、数组、字符串），编组层增加成比例的成本。

### 我能在所有平台使用 FFI 吗？

能。FFI 支持 LuaJIT 运行的全部 7 种架构：x86、x64、ARM、ARM64、MIPS、MIPS64 和 PowerPC。调用约定按平台抽象。

### 回调如何工作？

回调使用动态生成的机器码跳板。每个回调在可执行页池中获取一个槽。跳板加载槽编号并跳转到公共处理程序，后者以适当的参数转换分派给 Lua 函数。

### FFI 安全吗？

不。FFI 绕过 Lua 的安全保障。错误的类型、坏的指针和缓冲区溢出可能让进程崩溃。FFI 信任程序员——它是锋利的工具。

## 来源

- Mike Pall, LuaJIT 源码（`src/lib_ffi.c`, `src/lj_ctype.c`, `src/lj_cparse.c`, `src/lj_ccall.c`, `src/lj_ccallback.c`, `src/lj_cconv.c`, `src/lj_cdata.c`, `src/lj_clib.c`）, [LuaJIT GitHub](https://github.com/LuaJIT/LuaJIT)
- Mike Pall, "LuaJIT 2.1 FFI 文档", [luajit.org](https://luajit.org)
