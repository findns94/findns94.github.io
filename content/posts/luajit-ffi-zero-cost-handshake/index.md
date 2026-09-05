---
title: "Zero-Cost Handshake Between C and Lua: Anatomy of the FFI Subsystem"
description: "LuaJIT lets you call C functions, access C structs, and implement callbacks without writing C glue code. Learn how the FFI subsystem bridges two worlds with near-zero overhead."
coverImage: "/posts/luajit-ffi-zero-cost-handshake/images/cover.jpg"
coverImageAlt: "Two halves — C (blue) and Lua (green) — connected by a green FFI bridge in the center, representing the zero-cost handshake"
ogImage: "/posts/luajit-ffi-zero-cost-handshake/images/cover.jpg"
date: "2026-09-06 02:00:00"
lastUpdated: "2026-09-06 02:00:00"
author: "FindNS94"
tags: ["LuaJIT", "FFI", "C Interop"]
---

![Two halves — C (blue) and Lua (green) — connected by a green FFI bridge in the center, representing the zero-cost handshake](/posts/luajit-ffi-zero-cost-handshake/images/cover.jpg)

LuaJIT lets you call C functions, access C data structures, and implement callbacks — all without writing a single line of C glue code. The overhead? For simple calls, it's effectively zero. For complex types, the marshalling layer handles the complexity automatically.

This is the **FFI (Foreign Function Interface)** subsystem: a self-contained module that bridges Lua and C with remarkable efficiency. It's the finale of our deep-dive series into LuaJIT's internals, and it ties together everything we've learned — NaN-boxed values, the JIT compiler, DynASM, and the GC — into a cohesive whole.

In this article, you'll learn the FFI architecture, the C type system, the minimal parser, platform calling conventions, callback trampolines, type conversions, and the metamethod interface that makes it all accessible from Lua.

> **Key Takeaways**
> - The FFI is a self-contained subsystem: type system, parser, call handling, callbacks, conversions.
> - C types are interned in a central table (`CTState`), enabling fast type lookup and reuse.
> - Callbacks use dynamically generated machine code trampolines for near-zero overhead.
> - The parser is minimal — not a validating C parser, just enough for FFI declarations.
> - Type marshalling handles the complexity of C/Lua value conversion automatically.

## Architecture Overview — A Self-Contained Subsystem

The FFI is implemented across nine source files, each handling a distinct responsibility:

```
 ┌─────────────────────────────────────────────────────────────────┐
 │                     FFI Subsystem Architecture                   │
 │                                                                 │
 │  lib_ffi.c        │ Lua-facing API (ffi.cdef, ffi.new, etc.)   │
 │  lj_ctype.c       │ C type system (CTState, CType, interning)  │
 │  lj_cparse.c      │ C declaration parser (minimal, for FFI)    │
 │  lj_ccall.c       │ C function calling (platform conventions)  │
 │  lj_ccallback.c   │ Lua→C callbacks (dynamic trampolines)      │
 │  lj_cconv.c       │ Type conversions (Lua ↔ C marshalling)     │
 │  lj_cdata.c       │ C data objects (GCcdata, variable-size)    │
 │  lj_clib.c        │ C library loading (dlopen, namespaces)     │
 │  lj_carith.c      │ C data arithmetic (cdata metamethods)      │
 └─────────────────────────────────────────────────────────────────┘
```

The flow: Lua code calls `ffi.cdef("...")` → parser builds type descriptors → types interned in `CTState` → `ffi.C.func()` calls C via `lj_ccall.c` → results converted via `lj_cconv.c` → returned as Lua values.

## The C Type System — Interned Type Descriptors

At the core of the FFI is a type system that represents C types as interned descriptors.

### The CTState Structure

```c
typedef struct CTState {
  CType *tab;           /* C type table (dynamic array) */
  CTypeID top;          /* Current top */
  MSize sizetab;
  lua_State *L;
  global_State *g;
  GCtab *miscmap;       /* -CTypeID → metatable; cb slot → func */
  CCallback cb;         /* Temporary callback state */
  CTypeID1 hash[CTHASH_SIZE];  /* Hash anchors */
} CTState;
```

The type table is a dynamic array of `CType` descriptors. Types are interned — identical types share the same `CTypeID`, enabling fast equality comparison.

### The CType Structure

```c
typedef struct CType {
  CTInfo info;      /* Type info: type(4) + flags(20) + cid/attrib(16) */
  CTSize size;      /* Type size */
  CTypeID1 sib;     /* Sibling element */
  CTypeID1 next;    /* Hash chain next */
  GCRef name;       /* Element name (GCstr) */
} CType;
```

The `info` field is a packed bitfield:
- Bits 0-3: type number (VOID, STRUCT, PTR, ARRAY, etc.)
- Bits 4-23: flags (CONST, UNSIGNED, LONG, etc.)
- Bits 23-31: cid or attribute

### Predefined Types

LuaJIT predefines common C types at startup:
- VOID, BOOL, INT8-UINT128, FLOAT, DOUBLE
- COMPLEX_FLOAT, COMPLEX_DOUBLE
- P_VOID, P_CCHAR (pointer types)

### Type Interning

When a type is parsed, the FFI first checks if an identical type already exists. If so, it reuses the existing `CTypeID`. This is done via a hash table (`CTState.hash`):

```c
CTypeID lj_ctype_intern(CTState *cts, CTInfo info, CTSize size) {
  /* Check if this type already exists */
  CTypeID id = find_type(cts, info, size);
  if (id) return id;  /* Reuse existing type */
  /* Create new type */
  return add_type(cts, info, size);
}
```

## The C Declaration Parser — Minimal but Sufficient

The FFI parser is **not** a validating C compiler. It's a minimal parser designed specifically for FFI declarations.

### Why Not Validate?

The FFI trusts the programmer. If you declare `int foo(char *s)` but the actual function takes `int`, that's your bug. The parser's job is to extract enough information to:
1. Build type descriptors for the JIT
2. Determine calling conventions
3. Generate correct marshalling code

### The CPState Structure

```c
typedef struct CPState {
  CPChar c; CPToken tok; CPValue val; GCstr *str; CType *ct;
  const char *p; SBuf sb; lua_State *L; CTState *cts;
  TValue *param; const char *srcname; BCLine linenumber;
  int depth; uint32_t tmask; uint32_t mode;
  uint8_t packstack[CPARSE_MAX_PACKSTACK]; uint8_t curpack;
} CPState;
```

The parser has its own lexer (`cp_number`, `cp_ident`, `cp_param`) that tokenizes C declarations. It handles:
- Declaration specifiers (`int`, `const`, `unsigned`, `struct`, etc.)
- Declarators (pointer/array/function declarators)
- Abstract types (without names)
- Bitfields, enums, structs/unions
- Attributes (`__attribute__`, `__declspec`)

### Mode Flags

```c
#define CPARSE_MODE_ABSTRACT   /* Parse abstract type (no name) */
#define CPARSE_MODE_DIRECT     /* Parse direct declaration */
#define CPARSE_MODE_FIELD      /* Parse struct field */
#define CPARSE_MODE_SKIP       /* Skip declaration (just count) */
```

## Calling C Functions — Platform Conventions

Calling C from Lua requires understanding the platform's calling convention — which registers hold arguments, how structs are returned, etc.

### The lj_ccall.c Structure

```c
/* Platform-specific limits */
#if LJ_TARGET_X86
#define CCALL_MAX_GPR  2   /* eax, edx */
#define CCALL_MAX_FPR  0   /* no FP registers for args */
#elif LJ_TARGET_X64
#define CCALL_MAX_GPR  6   /* rdi, rsi, rdx, rcx, r8, r9 (SysV) */
#define CCALL_MAX_FPR  8   /* xmm0-7 */
/* Win64: 4 GPR, 4 FPR */
#elif LJ_TARGET_ARM64
#define CCALL_MAX_GPR  8   /* x0-x7 */
#define CCALL_MAX_FPR  8   /* d0-d7 */
#endif
```

### The Call Path

1. `ffi.C.func(args)` → `lj_ccall_func()` in `lib_ffi.c`
2. Marshal Lua args to C registers/stack via `lj_cconv.c`
3. Call the C function pointer
4. Marshal C return value to Lua value via `lj_cconv.c`

### Struct Returns

Different platforms handle struct returns differently:
- **x86-64 SysV**: Structs ≤ 16 bytes returned in registers; larger structs via hidden pointer
- **x86-64 Win64**: Structs ≤ 8 bytes in register; larger via hidden pointer
- **ARM64**: Structs ≤ 16 bytes in registers; larger via hidden pointer

The FFI handles all these cases automatically.

## C Data Objects — cdata

C data lives in `GCcdata` objects — Lua values that hold C data inline.

### The GCcdata Structure

```c
typedef struct GCcdata {
  GCHeader;
  CTypeID1 ctypeid;   /* Reference to the C type */
  /* Data follows here (variable size) */
} GCcdata;

/* Variable-size cdata (VLA, aligned) */
typedef struct GCcdataVar {
  CTypeID1 ctypeid;
  CTSize len;         /* Extra length */
  CTSize extra;       /* Prefix extra */
  /* Data follows */
} GCcdataVar;
```

The `ctypeid` links to the type descriptor in `CTState`, which tells the FFI how to interpret, convert, and garbage-collect the data.

### Creating cdata

```lua
-- Create a C integer
local x = ffi.new("int", 42)        -- cdata holding int 42

-- Create a C struct
local s = ffi.new("struct { int x; double y; }", 1, 2.0)

-- Create a C pointer
local p = ffi.new("int[10]")        -- array of 10 ints
```

## Callbacks — Dynamically Generated Trampololines

The most ingenious part of the FFI: callbacks that let C code call back into Lua functions, with near-zero overhead.

### The Callback Page Pool

```c
#define CALLBACK_MCODE_SIZE  (LJ_PAGESIZE * LJ_NUM_CBPAGE)
/* Default: 4096 * 256 = 1MB of executable memory */
```

A dedicated pool of executable memory pages holds dynamically-generated machine code. Each slot is a small trampoline:

### Trampoline Generation (x86)

```asm
; Each callback slot:
mov al, slot_number    ; 2 bytes: B0 xx
jmp lj_vm_ffi_callback ; 5 bytes: E9 xx xx xx xx
; Total: 7 bytes per slot
```

The slot number is encoded directly in the instruction, then jumps to the common handler. The handler looks up the slot, retrieves the Lua function from `cts->miscmap`, converts C arguments to Lua values, calls the function, and converts the result back.

### Trampoline Generation (ARM64)

```asm
; ARM64 trampoline:
mov x16, slot_number   ; Load slot number
b lj_vm_ffi_callback   ; Branch to handler
```

### The CCallback Structure

```c
typedef struct CCallback {
  FPRCBArg fpr[CCALL_MAX_FPR];  /* FPR args/results */
  intptr_t gpr[CCALL_MAX_GPR];  /* GPR args/results */
  intptr_t *stack;              /* Stack args */
  void *mcode;                  /* Machine code base */
  CTypeID1 *cbid;               /* Callback type table */
  MSize sizeid, topid, slot;
} CCallback;
```

### Creating a Callback

```lua
-- Create a callback: C function pointer that calls a Lua function
local cb = ffi.callback("int(*)(int)", function(x)
  return x * 2
end)

-- Pass it to a C function
ffi.C.qsort(array, n, ffi.sizeof("int"), cb)
```

The `ffi.callback()` function:
1. Allocates a slot in the callback page pool
2. Returns a function pointer to the trampoline for that slot
3. Stores the Lua function in `cts->miscmap[slot]`

When C calls the callback, the trampoline dispatches to `lj_vm_ffi_callback`, which does the full Lua/C transition.

```
 C code calls callback          Trampoline              Common handler
 ──────────────────────▶  mov al, slot ───────▶  lj_vm_ffi_callback
                                                        │
                                                        ▼
                                              ┌──────────────────┐
                                              │ Look up Lua func  │
                                              │ Convert C args    │
                                              │ Call Lua function │
                                              │ Convert result    │
                                              └──────────────────┘
```

## Type Conversions — The Marshalling Layer

The `lj_cconv.c` file handles all Lua ↔ C value conversions.

### Conversion Categories

| Direction | Source | Target | Complexity |
|-----------|--------|--------|------------|
| Lua → C | number | int/float | Direct |
| Lua → C | cdata | Same type | Direct |
| Lua → C | string | char* | Copy |
| C → Lua | int/float | number | Direct |
| C → Lua | struct | cdata | Copy |
| C → Lua | pointer | cdata | Wrap |

### Integer Promotion

C's integer promotion rules are implemented:
- `char`/`short` → `int` when passed to varargs
- `float` → `double` when passed to varargs
- Unsigned types preserve their range

### Struct Copy

Structs are copied field-by-field, respecting alignment and padding. The FFI uses the type descriptor to determine field layout.

## The Metamethod Interface — Lua-Facing API

The FFI exposes its functionality through metamethods on cdata objects and the global `ffi` table.

### CData Metamethods

| Metamethod | Purpose |
|------------|---------|
| `__index` | Field access (struct), array indexing, function call |
| `__newindex` | Field assignment, array element assignment |
| `__eq` | Comparison by value |
| `__len` | Array length, string length |
| `__lt`/`__le` | Comparison operators |
| `__concat` | String concatenation |
| `__call` | Call cdata as function |
| `__add`/`__sub`/etc. | Arithmetic on numeric cdata |
| `__tostring` | Convert to string |
| `__pairs`/`__ipairs` | Iteration |

### The ffi Table

```lua
ffi.cdef(declarations)    -- Parse C declarations
ffi.new(type [, value])   -- Allocate C data
ffi.cast(type, value)     -- Cast value to type
ffi.typeof(type)          -- Create type object
ffi.sizeof(type)          -- Get type size
ffi.alignof(type)         -- Get type alignment
ffi.offsetof(type, field) -- Get field offset
ffi.istype(type, value)   -- Type check
ffi.string(ptr [, len])   -- Convert C string to Lua
ffi.copy(dst, src, len)   -- Memory copy
ffi.fill(ptr, len, val)   -- Memory fill
ffi.load(name)            -- Load shared library
ffi.metatable(type, mt)   -- Set metatype for type
ffi.gc(ptr, finalizer)    -- Set finalizer
ffi.callback(type, func)  -- Create callback
ffi.abi(name)             -- Check platform ABI
ffi.errno([newerr])       -- Get/set errno
ffi.C                     -- Default C library namespace
ffi.os                    -- OS name
ffi.arch                  -- Architecture name
```

### Complete Workflow Example

```lua
local ffi = require("ffi")

-- 1. Declare C types and functions
ffi.cdef[[
typedef struct { int x; double y; } Point;
double distance(Point a, Point b);
]]

-- 2. Load the C library
local lib = ffi.load("mylib")

-- 3. Create C data
local p1 = ffi.new("Point", {1.0, 2.0})
local p2 = ffi.new("Point", {3.0, 4.0})

-- 4. Call C function
local d = lib.distance(p1, p2)

-- 5. Create a callback
local cb = ffi.callback("int(*)(int)", function(x) return x * 2 end)

-- 6. Access struct fields
print(p1.x)  -- metamethod __index
p1.x = 42    -- metamethod __newindex
```

## Frequently Asked Questions

### Is the C parser a full C compiler?

No. It's a minimal parser designed specifically for FFI declarations. It doesn't validate types, check semantics, or generate code. If you declare a wrong type, the FFI trusts you — crashes are your problem.

### What's the overhead of an FFI call?

For simple calls (integer/pointer args, no struct marshalling), the overhead is near-zero — just the calling convention setup. For complex types (structs, arrays, strings), the marshalling layer adds proportional cost.

### Can I use FFI on all platforms?

Yes. The FFI supports all 7 architectures LuaJIT runs on: x86, x64, ARM, ARM64, MIPS, MIPS64, and PowerPC. Calling conventions are abstracted per-platform.

### How do callbacks work?

Callbacks use dynamically generated machine code trampolines. Each callback gets a slot in an executable page pool. The trampoline loads the slot number and jumps to a common handler, which dispatches to the Lua function with proper argument conversion.

### Is FFI safe?

No. The FFI bypasses Lua's safety guarantees. Wrong types, bad pointers, and buffer overflows can crash the process. The FFI trusts the programmer — it's a sharp tool.

## Sources

- Mike Pall, LuaJIT source code (`src/lib_ffi.c`, `src/lj_ctype.c`, `src/lj_cparse.c`, `src/lj_ccall.c`, `src/lj_ccallback.c`, `src/lj_cconv.c`, `src/lj_cdata.c`, `src/lj_clib.c`), [LuaJIT GitHub](https://github.com/LuaJIT/LuaJIT)
- Mike Pall, "LuaJIT 2.1 FFI documentation", [luajit.org](https://luajit.org)
