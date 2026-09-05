---
title: "How a Double Holds the Entire Lua World: LuaJIT's NaN-Boxing Object Model"
description: "Every Lua value fits in 8 bytes. Learn how NaN-boxing exploits IEEE 754's unused NaN bit patterns to encode an entire type system in a single double."
coverImage: "/posts/luajit-nanboxing-object-model/images/cover.jpg"
coverImageAlt: "A glowing 8-byte double exploding into all Lua types — nil, boolean, number, string, table, function — representing NaN-boxing"
ogImage: "/posts/luajit-nanboxing-object-model/images/cover.jpg"
date: "2026-09-05 18:00:00"
lastUpdated: "2026-09-05 18:00:00"
author: "FindNS94"
tags: ["LuaJIT", "Object Model", "NaN-Boxing"]
---

![A glowing 8-byte double exploding into all Lua types — nil, boolean, number, string, table, function — representing NaN-boxing](/posts/luajit-nanboxing-object-model/images/cover.jpg)

Every Lua value — `nil`, `true`, `3.14`, `"hello"`, `{}`, `function() end` — fits in exactly 8 bytes. Not 16. Not 24. Eight. The same size as a single `double`.

The trick is called **NaN-boxing**: a bit-packing technique that exploits the unused bit patterns in IEEE 754 floating-point NaN values to encode type information directly in the value representation. It's the foundation of LuaJIT's object model, and it's why LuaJIT can represent any value in a single machine word with zero overhead for type dispatch.

In this article, you'll learn exactly how NaN-boxing works — from the IEEE 754 bit layout through the TValue union, both GC64 and non-GC64 modes, the GC object hierarchy, dual-number mode, and the write barrier that keeps the garbage collector correct.

> **Key Takeaways**
> - NaN-boxing exploits the 2^52 unused NaN bit patterns in IEEE 754 to encode type tags in the top bits of a double.
> - A single `TValue` union (8 bytes) holds any Lua value: number, boolean, nil, string pointer, table pointer, etc.
> - Non-GC64 mode: 32-bit type tag + 32-bit value/pointer. GC64 mode: 13-bit NaN marker + 4-bit tag + 47-bit pointer.
> - Dual-number mode stores integers inline, falling back to heap-allocated doubles only when necessary.
> - The write barrier invariant (black never points to white) enables incremental GC without stopping the world.

## The IEEE 754 NaN Space — A Hidden Playground

To understand NaN-boxing, you first need to understand the IEEE 754 double-precision floating-point format.

### The Bit Layout

A 64-bit double is divided into three fields:

```
 ┌──────────┬───────────────────┬────────────────────────────────────────┐
 │  Sign(1) │   Exponent(11)    │           Mantissa(52)                 │
 │    63    │     62-52         │            51-0                        │
 └──────────┴───────────────────┴────────────────────────────────────────┘
```

- **Sign bit** (bit 63): 0 = positive, 1 = negative
- **Exponent** (bits 62-52): biased by 1023; range 0-2047
- **Mantissa** (bits 51-0): the fractional part (52 bits of precision)

The value is: `(-1)^sign × 2^(exponent-1023) × 1.mantissa`

### What Makes a NaN

A value is **NaN (Not a Number)** when:
- The exponent field is all 1s (0x7FF = 2047)
- The mantissa is non-zero

There are two types of NaN:
- **Quiet NaN (qNaN)**: bit 51 (MSB of mantissa) is set → propagates through operations
- **Signaling NaN (sNaN)**: bit 51 is clear → raises an exception on use

### The Key Insight

The exponent field has 2048 possible values (0-2047). Two are special:
- 0x000 (all zeros) → zero/denormalized numbers
- 0x7FF (all ones) → infinity/NaN

When the exponent is 0x7FF and the mantissa is non-zero, you have a NaN. With 52 mantissa bits, that's **2^52 - 1 possible NaN values** (minus the case where mantissa = 0, which is infinity).

The FPU only generates **one specific NaN pattern**: `0xFFF8000000000000` (the "canonical quiet NaN"). All other 2^52 - 2 NaN bit patterns are **never produced by floating-point operations**.

LuaJIT's insight: these unused NaN patterns are a perfect place to hide type tags. The FPU will never generate them, so any value with a NaN bit pattern is guaranteed to be a LuaJIT type tag, not a real number.

## The TValue Union — 8 Bytes to Rule Them All

At the heart of LuaJIT's object model is the `TValue` — a union that can represent any Lua value in exactly 8 bytes.

### The Definition

```c
typedef LJ_ALIGN(8) union TValue {
  uint64_t u64;       /* 64-bit pattern overlaps number */
  lua_Number n;       /* Number object overlaps split tag/value object */
#if LJ_GC64
  GCRef gcr;          /* GCobj reference with tag */
  int64_t it64;
  struct { int32_t i; uint32_t it; };  /* Integer value + internal tag */
#else
  struct { union { GCRef gcr; int32_t i; }; uint32_t it; };
#endif
  struct { uint32_t lo; uint32_t hi; } u32;
} TValue;
```

The same 8 bytes can be interpreted as:
- A full 64-bit double (`n` or `u64`)
- A 32-bit type tag + 32-bit value/pointer (non-GC64)
- A 47-bit pointer + 4-bit tag + 13-bit NaN marker (GC64)
- Two 32-bit halves (`u32.lo`, `u32.hi`)

### Type Checking

To check a value's type, LuaJIT extracts the tag bits:

```c
// Non-GC64: tag is the top 32 bits
#define itype(o)	((o)->it)
// GC64: tag is bits 47-51
#if LJ_GC64
#define itype(o)	((uint32_t)(o)->it64 >> 47)
#endif
```

### Value Extraction

```c
// Extract a GC pointer
#define gcval(o)	((o)->gcr)
// Extract an integer
#define intval(o)	((int32_t)(o)->i)
// Extract a double
#define numV(o)		((o)->n)
```

The beauty: type checking is a single bit shift and mask. No indirection, no vtable lookup, no separate type field. Just arithmetic on the value itself.

## Non-GC64 Mode — 32-bit Tags, 32-bit Pointers

In the original (non-GC64) mode, the TValue layout is straightforward:

```
 ┌──────────────────────┬──────────────────────┐
 │   Type Tag (32-bit)  │   Value (32-bit)     │
 │      bits 63-32      │      bits 31-0       │
 └──────────────────────┴──────────────────────┘
```

### Internal Type Tags

The type tags are defined as negative numbers (so they overlap the NaN region):

```c
#define LJ_TNIL      (~0u)   /* 0xFFFFFFFF = -1 */
#define LJ_TFALSE    (~1u)   /* 0xFFFFFFFE = -2 */
#define LJ_TTRUE     (~2u)   /* 0xFFFFFFFD = -3 */
#define LJ_TLIGHTUD  (~3u)   /* 0xFFFFFFFC = -4 */
#define LJ_TSTR      (~4u)   /* 0xFFFFFFFB = -5 */
#define LJ_TUPVAL    (~5u)   /* 0xFFFFFFFA = -6 */
#define LJ_TTHREAD   (~6u)   /* 0xFFFFFFF9 = -7 */
#define LJ_TPROTO    (~7u)   /* 0xFFFFFFF8 = -8 */
#define LJ_TFUNC     (~8u)   /* 0xFFFFFFF7 = -9 */
#define LJ_TTRACE    (~9u)   /* 0xFFFFFFF6 = -10 */
#define LJ_TCDATA    (~10u)  /* 0xFFFFFFF5 = -11 */
#define LJ_TTAB      (~11u)  /* 0xFFFFFFF4 = -12 */
#define LJ_TUDATA    (~12u)  /* 0xFFFFFFF3 = -13 */
#define LJ_TNUMX     (~13u)  /* 0xFFFFFFF2 = -14 */
```

Each tag is one less than the previous, starting from -1 (0xFFFFFFFF). When interpreted as a double, these all fall in the NaN region (exponent = 0x7FF, mantissa non-zero).

### How Each Type Fits

```
 NIL/TRUE/FALSE:          Integer:                 GC Pointer:
 ┌──────────┬──────────┐  ┌──────────┬──────────┐  ┌──────────┬──────────┐
 │ LJ_TNIL  │  (zero)  │  │ LJ_TNUMX │   42     │  │ LJ_TSTR  │  ptr     │
 │ 0xFFFF.. │  0x0000  │  │ 0xFFFE.. │  0x002A  │  │ 0xFFFB.. │  0x1A2B  │
 └──────────┴──────────┘  └──────────┴──────────┘  └──────────┴──────────┘
  Tag only, no payload     Tag + 32-bit integer     Tag + 32-bit pointer

 Double (heap allocated):
 ┌──────────────────────────────────────────────────┐
 │  Full 64-bit double value (tag = LJ_TNUMX)       │
 │  The "pointer" points to a heap-allocated double │
 └──────────────────────────────────────────────────┘
```

- **nil, false, true**: The tag IS the value. No payload needed. `nil` = tag LJ_TNIL with zero payload.
- **Integers** (dual-number mode): Tag = LJ_TNUMX, lower 32 bits = signed integer value.
- **GC pointers** (strings, tables, functions): Tag = type-specific, lower 32 bits = pointer to GC object.
- **Doubles** (when they don't fit inline): Tag = LJ_TNUMX, lower 32 bits = pointer to heap-allocated `lua_Number`.

### The Limitation

Non-GC64 mode uses 32-bit pointers, limiting the address space to 4GB. For most Lua applications this is fine, but for servers or games with large memory footprints, it's a constraint. This is why GC64 mode exists.

## GC64 Mode — 64-bit Pointers in 8 Bytes

Modern 64-bit systems can address far more than 4GB. GC64 mode extends LuaJIT to use full 64-bit pointers — still in 8 bytes.

### The Layout

```
 ┌────────────┬──────────┬────────────────────────────────────────────┐
 │ NaN(13-bit)│Tag(4-bit)│         Pointer (47-bit)                   │
 │ bits 63-52 │ bits 51-48│            bits 47-0                       │
 └────────────┴──────────┴────────────────────────────────────────────┘
```

- **Top 13 bits**: all 1s (0x1FFF) — the NaN marker
- **Next 4 bits**: type tag (supports up to 16 types)
- **Bottom 47 bits**: the actual pointer (128TB addressable)

### Why 47 Bits?

x86-64 processors use 48-bit virtual addresses (with sign extension to 64 bits). User-space addresses are limited to 48 bits, and LuaJIT uses 47 of them — giving 128TB of addressable space. More than enough for any Lua program.

### Type Checking in GC64

```c
#if LJ_GC64
#define itype(o)  ((uint32_t)(o)->it64 >> 47)
#endif
```

The tag is extracted by shifting right 47 bits. The top 13 bits being all 1s confirms this is a NaN-boxed value (not a real double).

### The Tradeoff

GC64 mode requires more complex type checking (shift + mask vs simple extract) and slightly more complex pointer handling. But it enables LuaJIT to use the full 64-bit address space — essential for modern applications.

## The GC Object Hierarchy — Everything is a GCobj

Every garbage-collected object in LuaJIT shares a common header:

```c
#define GCHeader  GCRef nextgc; uint8_t marked; uint8_t gct
```

- `nextgc`: pointer to the next GC object in the chain
- `marked`: color bits for tri-color GC (white/gray/black + flags)
- `gct`: the GC type (distinguishes strings from tables from functions)

### The GCobj Union

```c
typedef union GCobj {
  GChead gch;     /* Common header */
  GCstr str;      /* String */
  GCupval uv;     /* Upvalue */
  lua_State th;   /* Thread */
  GCproto pt;     /* Prototype */
  GCfunc fn;      /* Function (closure) */
  GCcdata cd;     /* C data (FFI) */
  GCtab tab;      /* Table */
  GCudata ud;     /* Userdata */
} GCobj;
```

```
                        ┌─────────┐
                        │GCHeader │
                        │nextgc   │
                        │marked   │
                        │gct      │
                        └────┬────┘
              ┌──────────────┼──────────────┐
              │              │              │
        ┌─────┴─────┐  ┌────┴────┐  ┌─────┴─────┐
        │  GCstr    │  │  GCtab  │  │  GCfunc   │
        │           │  │         │  │           │
        │ hash      │  │ array   │  │ ffid      │
        │ len       │  │ hash    │  │ pc        │
        │ data[]    │  │ metatable│  │ upvalues  │
        └───────────┘  └─────────┘  └───────────┘
```

### Key GC Object Types

**GCstr (String)**: Header + hash algorithm + string ID + hash + length + data. Strings are interned — identical strings share the same object.

**GCtab (Table)**: Header + array part (fast integer keys) + hash part (other keys) + metatable. Tables are the only data structure in Lua — they're used for arrays, objects, dictionaries, and modules.

**GCfunc (Function)**: Header + function ID (ffid) + upvalue pointers. Distinguishes C functions (ffid > 0) from Lua functions (ffid = 0).

**GCproto (Prototype)**: Header + bytecode + constants + upvalue info + debug info. The compiled representation of a Lua function.

**GCcdata (C Data)**: Header + C type ID + data. Used by the FFI to represent C types.

**GCudata (Userdata)**: Header + userdata type + environment + length + data. Raw memory blocks with optional metatable.

**GCupval (Upvalue)**: Header + closed flag + value pointer. Represents variables from enclosing scopes.

### The `gct` Field

The `gct` field in the header distinguishes object types during GC traversal:

```c
#define LJ_TSTR    (~4u)
#define LJ_TUPVAL  (~5u)
#define LJ_TTHREAD (~6u)
#define LJ_TPROTO  (~7u)
#define LJ_TFUNC   (~8u)
#define LJ_TTRACE  (~9u)
#define LJ_TCDATA  (~10u)
#define LJ_TTAB    (~11u)
#define LJ_TUDATA  (~12u)
```

When the GC traverses an object, it switches on `gct` to call the appropriate traversal function (marking the object's children).

## Dual-Number Mode — Integers Without Allocation

Lua 5.1 specifies that all numbers are doubles. But allocating a heap object for every integer is wasteful. LuaJIT's **dual-number mode** (LJ_DUALNUM) solves this.

### The Problem

```lua
local x = 0
for i = 1, 1000000 do
  x = x + 1    -- If every integer is heap-allocated, this creates 1M objects!
end
```

Without dual-number mode, every integer operation would allocate a heap object, trigger GC pressure, and be slow.

### The Solution

Dual-number mode stores integers **inline** in the TValue when possible:

```
 Integer (inline):        Double (heap-allocated):
 ┌──────────┬──────────┐  ┌──────────┬──────────┐
 │ LJ_TNUMX │   42     │  │ LJ_TNUMX │  ptr     │
 │ 0xFFFE.. │  0x002A  │  │ 0xFFFE.. │  0x1A2B  │
 └──────────┴──────────┘  └──────────┴──────────┘
  Tag + 32-bit integer     Tag + pointer to heap double
```

- **Inline integer**: Tag = LJ_TNUMX, lower 32 bits = signed integer value. No heap allocation.
- **Heap double**: Tag = LJ_TNUMX, lower 32 bits = pointer to heap-allocated `lua_Number`.

### Type Checking

```c
// Is this value an inline integer?
#define tvisint(o)	(itype(o) == LJ_TNUMX && (int32_t)(o)->i != 0)
// Is this value a heap double?
#define tvisnum(o)	(itype(o) == LJ_TNUMX && !tvisint(o))
```

Wait — both have tag LJ_TNUMX. How do you distinguish them? The trick: integers are stored with the tag in the upper bits and the integer in the lower bits. A heap double's pointer, when interpreted as two 32-bit halves, has a different pattern. The actual check is more subtle — it relies on the fact that pointer values (being large) have different bit patterns than small integers.

### Performance Impact

With dual-number mode:
- Integer arithmetic: no heap allocation, no GC pressure, single instruction
- Mixed integer/float: automatic promotion to double when needed
- Overflow: when an integer exceeds 32-bit range, it's promoted to a heap double

This is critical for performance: most loops use integers, and avoiding allocation for them is a massive win.

## The Write Barrier — Keeping the GC Correct

LuaJIT uses an **incremental tri-color mark-sweep GC**. The tri-color abstraction:

- **White**: Not yet reached (candidate for collection)
- **Gray**: Reached but not yet scanned (children not marked)
- **Black**: Reached and scanned (children marked)

### The Invariant

**A black object never points to a white object.**

This is the fundamental invariant of incremental GC. If it holds, the GC can safely collect white objects — they're unreachable.

### Why the Invariant Can Break

During the propagate phase, the GC is turning gray objects black. Meanwhile, the mutator (running Lua code) is modifying objects. Consider:

1. Object A is black (already scanned)
2. Lua code executes: `A.field = B` where B is white
3. Now A (black) points to B (white) — invariant violated!
4. The GC might finish marking without ever reaching B → B is incorrectly collected

### The Write Barrier

The **write barrier** detects and repairs invariant violations. When a black object gets a new reference to a white object:

**Forward barrier** (`lj_gc_barrierf`): For non-table objects — either mark the white object (move the frontier forward) or re-gray the black object.

**Backward barrier** (`lj_gc_barrierback`): For tables — move the table back to the gray (grayagain) list. Cheaper because tables are mutated frequently.

```
 Mutator writes: A.field = B     (A is black, B is white)

 ┌──────────┐                ┌──────────┐
 │  A       │                │  B       │
 │ (black)  │───field──────▶│ (white)  │
 └──────────┘                └──────────┘
       │
       │ Write barrier fires:
       │ Option 1: Mark B (make it gray)
       │ Option 2: Re-gray A (move back to grayagain)
       ▼
 ┌──────────┐                ┌──────────┐
 │  A       │                │  B       │
 │ (black)  │───field──────▶│ (gray)   │  ← invariant restored
 └──────────┘                └──────────┘
```

### Why Backward Barriers for Tables?

Tables are the most frequently mutated objects in Lua. Using forward barriers would require marking the value being stored on every table assignment — expensive when you're doing millions of table writes. Backward barriers are cheaper: just re-gray the table itself, and the GC will re-scan it later.

### The Upvalue Barrier

When an upvalue is closed (its variable goes out of scope), the GC must ensure the closed value doesn't point to a collected object. The upvalue barrier (`lj_gc_barrieruv`) handles this case specially.

## Why NaN-Boxing Matters — Performance Implications

NaN-boxing isn't just clever — it has real performance consequences.

### Zero Space Overhead

Every Lua value is exactly 8 bytes. One x86-64 cache line (64 bytes) holds **8 values**. Compare:

```
 LuaJIT (NaN-boxing):     V8 (tagged pointers):     CPython (PyObject):
 ┌──────────────────┐     ┌──────────────────┐     ┌──────────────────┐
 │ 8 bytes/value    │     │ 8 bytes/value    │     │ 16 bytes header  │
 │ No extra header  │     │ + hidden class   │     │ + 8 byte pointer │
 │ Type in bits     │     │ Type in pointer  │     │ Type in header   │
 └──────────────────┘     └──────────────────┘     └──────────────────┘
 ~8 bytes effective       ~8-16 bytes effective    ~24+ bytes effective
```

### Fast Type Checking

Type checking is a bit mask and comparison — single instruction. No vtable lookup, no indirection:

```c
// LuaJIT: type check is one instruction
if (itype(o) == LJ_TTAB) { ... }

// CPython: type check is a pointer dereference
if (Py_TYPE(o) == &PyList_Type) { ... }
```

### Integer Arithmetic Without Allocation

Dual-number mode means integer loops don't allocate. Compare:

```lua
-- LuaJIT: no allocation for integers
local x = 0
for i = 1, 1000000 do x = x + 1 end  -- zero allocations

-- Without dual-number mode: 1,000,000 heap allocations
```

### Cache Efficiency

Compact values mean more values fit in cache. A table with 1000 array elements takes ~8KB in LuaJIT (fits in L2 cache) vs ~16-24KB in CPython (may not fit).

### The Tradeoff

NaN-boxing requires more complex type checking (bit manipulation) and limits the pointer space (47 bits in GC64, 32 bits in non-GC64). But for a scripting language where values are small and numerous, the space savings dominate.

## Frequently Asked Questions

### Why NaN specifically?

NaN bit patterns are guaranteed never to be generated by the FPU. Any value with a NaN bit pattern is guaranteed to be a LuaJIT type tag, not a real number. This makes type checking safe — you'll never confuse a real double with a type tag.

### What happens if a NaN is actually computed?

LuaJIT's canonical NaN is `0xFFF8000000000000`. If the FPU computes a NaN (e.g., `0/0`), it produces this specific pattern, which LuaJIT recognizes as "not a number" (the LJ_TNUMX tag with a NaN payload). All other NaN bit patterns are type tags.

### Is NaN-boxing unique to LuaJIT?

No. JavaScriptCore (WebKit's JavaScript engine) uses NaN-boxing too. LuaJIT popularized it for dynamic languages, but the technique predates it. The key insight — using unused IEEE 754 bit patterns for type tags — is applicable to any language implementation.

### How does GC64 affect performance?

GC64 mode requires slightly more complex type checking (shift right 47 bits vs extract top 32 bits) and pointer masking. The overhead is minimal (1-2 extra instructions per type check) but measurable in tight loops. The benefit — 128TB address space vs 4GB — is essential for modern applications.

### Can I disable dual-number mode?

Yes. Compile LuaJIT without `LJ_DUALNUM` — all numbers become heap-allocated doubles. This simplifies the implementation (no integer/double distinction) but significantly impacts performance for integer-heavy code.

## Sources

- Mike Pall, LuaJIT source code (`src/lj_obj.h`, `src/lj_gc.h`, `src/lj_gc.c`, `src/lj_obj.c`), [LuaJIT GitHub](https://github.com/LuaJIT/LuaJIT)
- IEEE 754-2008 floating-point standard
- Mike Pall, "LuaJIT 2.1 documentation", [luajit.org](https://luajit.org)
- JavaScriptCore (WebKit) — also uses NaN-boxing for JavaScript values
