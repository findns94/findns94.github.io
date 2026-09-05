---
title: "SSA IR: The 'Lingua Franca' of LuaJIT's Compiler"
description: "Every LuaJIT compiler pass speaks the same language — SSA IR. Learn how the IRIns structure, 120 opcodes, and strict SSA form enable LuaJIT's powerful optimizations."
coverImage: "/posts/luajit-ssa-ir-lingua-franca/images/cover.jpg"
coverImageAlt: "SSA IR as a universal language — compiler passes (recorder, FOLD, FWD, assembler) connected through a central IR node"
ogImage: "/posts/luajit-ssa-ir-lingua-franca/images/cover.jpg"
date: "2026-09-05 20:00:00"
lastUpdated: "2026-09-05 20:00:00"
author: "FindNS94"
tags: ["LuaJIT", "SSA", "Compiler"]
---

![SSA IR as a universal language — compiler passes (recorder, FOLD, FWD, assembler) connected through a central IR node](/posts/luajit-ssa-ir-lingua-franca/images/cover.jpg)

A Lua function passes through five stages inside LuaJIT: bytecode → IR → optimized IR → machine code → execution. The **IR (Intermediate Representation)** is the hub that connects them all. The recorder writes IR. The optimizer transforms IR. The assembler reads IR. Every compiler pass speaks the same language.

This is why IR is LuaJIT's "lingua franca" — the common tongue that makes the compiler's modular design possible. Understanding IR means understanding how LuaJIT's compiler works at its core.

In this article, you'll learn the IRIns structure, the ~120 opcodes, the type system, the SSA properties, the reference system, and how each optimization pass transforms IR before the assembler turns it into machine code.

> **Key Takeaways**
> - LuaJIT's IR is in **strict SSA form**: each value is defined exactly once, enabling powerful optimizations.
> - The IRIns structure is a 64-bit union: operands, type, opcode, and (after allocation) register/spill info.
> - ~120 opcodes organized by category: guards, constants, arithmetic, memory, allocations, barriers, conversions, calls.
> - Constants are interned (de-duplicated) and grow downward from REF_BIAS; instructions grow upward.
> - Every optimization pass (FOLD, FWD, NARROW, DCE, LOOP, SPLIT, SINK) operates on IR — it's the universal language.

## What Is SSA and Why It Matters

**SSA (Static Single Assignment)** is a property of intermediate representations where each variable is assigned exactly once. In LuaJIT's IR, this means each value has a single definition point, and all uses refer back to that definition via IR references.

### SSA vs Non-SSA

```
 Non-SSA (normal variables):          SSA (LuaJIT IR):

 x = 1                                [1] KINT 1
 x = x + 2      ← x reassigned!       [2] ADD [1], KINT 2
 y = x * 3                            [3] MUL [2], KINT 3
 x = y - x      ← x reassigned!       [4] SUB [3], [2]   ← uses [2], not "x"
                                      [5] ADD [4], KINT 1
```

In non-SSA code, `x` is assigned twice. To optimize, the compiler must track which `x` is which. In SSA, each definition gets a unique reference (`[1]`, `[2]`, `[3]`...), and uses point directly to their definition. No ambiguity.

### Why SSA Matters

- **Simpler dataflow analysis**: Each value has one definition → use-def chains are trivial
- **Efficient CSE**: If two instructions have the same opcode and operands, they're identical
- **Dead code elimination**: If no one uses a definition, it's dead
- **Constant folding**: If all operands are constants, the result is a constant

### φ Functions in Loops

SSA has a problem with loops: if a variable is modified in a loop body, which definition do uses before the loop refer to? The solution is **φ (phi) functions** that merge values from different control-flow paths.

LuaJIT handles φ functions implicitly. The recorder tracks the current value of each stack slot in `J->slot[]`, and when a loop back-edge is encountered, it knows which IR reference corresponds to the current value. No explicit φ nodes in the IR — the recorder manages the mapping.

## The IRIns Structure — A 64-Bit Swiss Army Knife

The fundamental unit of LuaJIT's IR is `IRIns` — a 64-bit instruction that serves different purposes at different stages of compilation.

### The Definition

```c
typedef union IRIns {
  struct { IRRef1 op1, op2; IROpT ot; IRRef1 prev; };
  struct { IRRef2 op12; IRType1 t; IROp1 o; uint8_t r; uint8_t s; };
  int32_t i; GCRef gcr; MRef ptr; TValue tv;
} IRIns;
```

The same 64 bits are interpreted differently depending on context:

### Before Register Allocation

```
 ┌──────────┬──────────┬──────────┬──────────┐
 │  op1     │  op2     │   ot     │  prev    │
 │ (16-bit) │ (16-bit) │ (16-bit) │ (16-bit) │
 └──────────┴──────────┴──────────┴──────────┘
  operand 1  operand 2  type+opcode  CSE chain
```

- `op1`, `op2`: references to operand instructions (16-bit each)
- `ot`: type (8 bits) + opcode (8 bits)
- `prev`: links the CSE skip-list chain for this opcode

### After Register Allocation

```
 ┌──────────┬──────────┬──────────┬──────────┐
 │  op1     │  op2     │   ot    │  r  │  s  │
 │ (16-bit) │ (16-bit) │ (16-bit) │ reg │spill│
 └──────────┴──────────┴──────────┴──────────┘
  operand 1  operand 2  type+opcode  register/spill
```

- `r`: the physical register assigned to this instruction's result
- `s`: the spill slot (if the value was spilled to the stack)

The `prev` field is **repurposed** after allocation. Before allocation, it links the CSE chain. After allocation, it holds register/spill information. This is a space-saving trick — the CSE chain is no longer needed once optimization is complete.

### The Packed Form

```c
struct { IRRef2 op12; IRType1 t; IROp1 o; uint8_t r; uint8_t s; };
```

For fast access, op1 and op2 can be read as a single 32-bit value (`op12`). This is used by the CSE search: two instructions are identical if their `op12` and `o` match.

## The Opcode Set — 120 Operations

LuaJIT's IR has approximately 120 opcodes, organized into categories. Each opcode is defined via the `IRDEF()` macro in `src/lj_ir.h`.

### Guards — The Backbone of Speculation

```
 LT    GE    LE    GT    EQ    NE    ABC    RETF
```

Guards are speculative assertions. They check a condition and either continue or exit the trace. They're specially aligned so opposites can be computed via XOR: `LT ^ 1 == GE`, `LT ^ 3 == GT`, `LT ^ 4 == ULT`.

```
 ┌─────────────────────────────────────────────────────────────┐
 │  Guard    │  Checks              │  Exit on                 │
 ├───────────┼──────────────────────┼──────────────────────────┤
 │  LT       │  left < right        │  left >= right           │
 │  GE       │  left >= right       │  left < right            │
 │  EQ       │  left == right       │  left != right           │
 │  ABC      │  array bounds check  │  index out of bounds     │
 │  RETF     │  return from frame   │  frame mismatch          │
 └─────────────────────────────────────────────────────────────┘
```

### Constants — Interned Values

```
 KPRI   KINT   KGC   KPTR   KKPTR   KNULL   KNUM   KINT64   KSLOT
```

Constants are **interned** — identical constants share the same IR reference. This enables constant CSE: if two instructions load the same constant, they share the same reference.

### Arithmetic

```
 ADD   SUB   MUL   DIV   MOD   POW   NEG   ABS   MIN   MAX   FPMATH
 ADDOV SUBOV MULOV   (overflow-checking variants)
```

The overflow-checking variants (`ADDOV`, `SUBOV`, `MULOV`) set the overflow flag on integer overflow. The optimizer can strip these checks when it proves overflow is impossible (narrowing).

### Memory Operations

```
 References:  AREF   HREF   NEWREF   UREFO   UREFC   FREF   STRREF   LREF
 Loads:       ALOAD  HLOAD  ULOAD    FLOAD   XLOAD   SLOAD  VLOAD
 Stores:      ASTORE HSTORE USTORE   FSTORE  XSTORE
```

The `IRDELTA_L2S` constant maps each load opcode to its corresponding store opcode. This is used by the FWD pass to match loads with their preceding stores.

### Allocations

```
 SNEW   XSNEW   TNEW   TDUP   CNEW   CNEWI
```

These allocate new objects. They flow into the SINK pass, which defers allocations to exit paths when possible.

### Barriers

```
 TBAR   OBAR   XBAR
```

GC write barriers. `TBAR` for table stores, `OBAR` for object stores, `XBAR` for cross-page stores. These ensure the tri-color GC invariant is maintained.

### Conversions

```
 CONV   TOBIT   TOSTR   STRTO
```

Type conversions. `CONV` is the general conversion with rich mode encoding in `op2` (source type, target type, truncation mode).

### Calls

```
 CALLN   CALLA   CALLL   CALLS   CALLXS   CARG
```

- `CALLN`: normal C function call
- `CALLA`: call with argument adjustment
- `CALLL`: tail call
- `CALLS`: slow call (with hook checking)
- `CALLXS`: cross-state call
- `CARG`: call argument

## The Type System — From Bits to Semantics

Each IR instruction carries an 8-bit type field that drives optimization and code generation.

### Type Categories

```
 ┌─────────────────────────────────────────────────────────────┐
 │  Type         │  Meaning                                    │
 ├───────────────┼─────────────────────────────────────────────┤
 │  IRT_NIL      │  Nil value                                  │
 │  IRT_TRUE/FALSE │  Boolean values                           │
 │  IRT_LIGHTUD  │  Light userdata (32-bit pointer)            │
 │  IRT_STR      │  String pointer                             │
 │  IRT_P32      │  32-bit pointer                             │
 │  IRT_P64      │  64-bit pointer                             │
 │  IRT_INT      │  Integer value                              │
 │  IRT_NUM      │  Double value                               │
 │  IRT_I8/U8    │  8-bit integer                              │
 │  IRT_I16/U16  │  16-bit integer                             │
 │  IRT_U32      │  32-bit unsigned integer                    │
 │  IRT_I64/U64  │  64-bit integer                             │
 │  IRT_FLOAT    │  32-bit float                               │
 │  IRT_SOFTFP   │  Software float (split into 2x int32)       │
 └───────────────────────2─────────────────────────────────────┘
```

### Type Flags

- `IRT_GUARD`: This instruction is a guard. Its result type is the type being checked.
- `IRT_ISPHI`: This instruction represents a φ merge point.
- `IRT_MARK`: Temporary mark during optimization.

### The Mode Table

The `lj_ir_mode[]` array encodes per-operand constraints:

```c
enum {
 IRMnone,   // No operand
 IRMref,    // IR reference
 IRMlit,    // Literal value
 IRMcst,    // Constant reference
  // Flags:
 IRM_Comm   // Commutative
 IRM_A      // Allocation
 IRM_L      // Load
 IRM_S      // Store
 IRM_W      // Non-weak guard
};
```

This table drives the FOLD engine: it knows which operands can be constants, which operations are commutative, and which have side effects.

## The Reference System — Constants and Instructions

LuaJIT's IR uses a clever reference numbering scheme that allows constants and instructions to share the same reference space.

### REF_BIAS — The Pivot Point

```
 ┌─────────────────────────────────────────────────────────────┐
 │                    Reference Space                          │
 │                                                             │
 │  0x0000  ← Constants grow this way (downward)               │
 │    ...                                                      │
 │  REF_BIAS - 2   ← Last constant                             │
 │  REF_BIAS - 1   ← First constant                            │
 │  REF_BIAS       ← Pivot point (the "zero" of IR refs)       │
 │  REF_BIAS + 1   ← First instruction                         │
 │  REF_BIAS + 2   ← Second instruction                        │
 │    ...                                                      │
 │  0xFFFF   ← Instructions grow this way (upward)             │
 └─────────────────────────────────────────────────────────────┘
```

- Constants: `REF_BIAS - idx` (growing downward from REF_BIAS)
- Instructions: `REF_BIAS + idx` (growing upward from REF_BIAS)

This means constants and instructions never collide — they grow toward each other from the pivot point.

### Constant Interning

When the recorder creates a constant, it first checks if an identical constant already exists. If so, it reuses the reference. This is implemented via a hash table (`J->khash`):

```c
// Simplified constant interning
IRRef lj_ir_kint(jit_State *J, int32_t k) {
  // Check if this integer constant already exists
  IRRef ref = find_khash(J, IRT_INT, k);
  if (ref) return ref;  // Reuse existing constant
  // Create new constant
  return new_kint(J, k);
}
```

Interning enables constant CSE: if two instructions load the same integer, they share the same reference, and the FOLD engine recognizes them as identical.

## How the Recorder Emits IR

The trace recorder (`lj_record_ins()`) translates bytecode into IR. For each bytecode instruction, it:

1. Reads the current stack slots from `J->slot[]`
2. Emits IR via the `emitir()` macro
3. Updates the slot map with the result reference

### The emitir Macro

```c
#define emitir(ot, a, b)  (lj_ir_set(J, (ot), (a), (b)), lj_opt_fold(J))
```

This does two things:
1. `lj_ir_set()`: creates a new IR instruction with the given type and operands
2. `lj_opt_fold()`: immediately runs the FOLD engine on the new instruction

The immediate folding is key — it means constants are folded as soon as they're created, and algebraic simplifications happen during recording, not after.

### Type Specialization in Action

```lua
-- Lua source
local x = 0
for i = 1, 100 do
  x = x + i
end
```

Recorded IR (simplified):

```
 [1] KINT 0           ; x = 0 (initial value)
 [2] KINT 1           ; i = 1 (loop start)
 [3] KINT 100         ; loop limit
 [4] ISNUM [2]        ; guard: i is a number
 [5] ISNUM [1]        ; guard: x is a number
 [6] ADD [1], [2]     ; x + i (both known to be numbers)
 [7] ADD [2], KINT 1  ; i + 1
 [8] LE [7], [3]      ; i <= 100?
 [9] PHI [6], [5]     ; x = (x+i) or 0 (loop merge)
 [10] PHI [7], [2]    ; i = (i+1) or 1 (loop merge)
```

The guards at [4] and [5] specialize the types. After them, the ADD at [6] knows both operands are numbers and can use a single `addsd` instruction.

## The Optimization Pipeline — Transforming IR

After recording, the IR passes through a series of optimization passes. Each pass transforms the IR in place.

### The Pipeline

```
                    ┌──────────────────────────────────────────┐
                    │           Recorded IR                     │
                    └──────────────────┬───────────────────────┘
                                       │
                    ┌──────────────────▼───────────────────────┐
                    │  FOLD (during recording)                  │
                    │  Constant folding, algebraic simplification│
                    │  ABC elimination, CSE                      │
                    └──────────────────┬───────────────────────┘
                                       │
                    ┌──────────────────▼───────────────────────┐
                    │  DCE (pre-LOOP)                          │
                    │  Dead code elimination                    │
                    └──────────────────┬───────────────────────┘
                                       │
                    ┌──────────────────▼───────────────────────┐
                    │  LOOP                                     │
                    │  Loop-invariant code motion               │
                    │  Copy-substitution unrolling              │
                    └──────────────────┬───────────────────────┘
                                       │
                    ┌──────────────────▼───────────────────────┐
                    │  NARROW                                   │
                    │  Double → int32 narrowing                 │
                    │  Overflow check stripping                  │
                    └──────────────────┬───────────────────────┘
                                       │
                    ┌──────────────────▼───────────────────────┐
                    │  FWD + DSE                                │
                    │  Load forwarding (L2L, S2L)               │
                    │  Dead store elimination                    │
                    └──────────────────┬───────────────────────┘
                                       │
                    ┌──────────────────▼───────────────────────┐
                    │  SPLIT (soft-float only)                  │
                    │  64-bit → 32-bit splitting               │
                    └──────────────────┬───────────────────────┘
                                       │
                    ┌──────────────────▼───────────────────────┐
                    │  SINK                                     │
                    │  Allocation sinking                       │
                    │  Defer stores to exit paths               │
                    └──────────────────┬───────────────────────┘
                                       │
                    ┌──────────────────▼───────────────────────┐
                    │         Optimized IR                      │
                    └──────────────────────────────────────────┘
```

### FOLD — The Heart of Optimization

The FOLD engine runs on every emitted instruction. It uses a **semi-perfect hash table** for pattern matching:

1. Build a 24-bit key from `(ins_opcode, left_opcode, right_opcode)`
2. Look up the key in the generated `fold_hash[]` table
3. If no match, mask with wildcards and retry: `ins left right` → `ins any right` → `ins left any` → `ins any any`
4. Execute the fold function (constant fold, simplify, CSE, etc.)

This is a **compile-time metaprogramming** technique: the `LJFOLD` macros in the source are parsed by a Lua script to generate the optimal lookup table.

### NARROW — Predictive Narrowing

The NARROW pass keeps numbers as doubles, narrowing to int32 only when beneficial:
- **Induction variables**: loop counters that are provably integers
- **Index expressions**: array indices that fit in int32
- **Overflow stripping**: `ADDOV → ADD` when inputs are already integers

It uses a **backpropagation cache** (`BPropEntry bpropcache[BPROP_SLOTS]`) to propagate narrowing demands backward through the IR.

### LOOP — Loop Optimization via Copy-Substitution

Instead of traditional LICM (which fails for dynamic languages due to guard control-dependencies), LuaJIT uses **copy-substitution unrolling**:

1. Emit a `LOOP` instruction separating pre-roll from loop body
2. Re-emit all recorded instructions with substituted operands
3. The pre-roll honors control dependencies for BOTH itself and the loop body
4. PHI elimination: collect potential PHIs during substitution, eliminate redundant ones

If loop optimization fails (type instability, guard failure), it undoes changes and **continues recording** — a unique "loop unrolling via recording" recovery.

## From IR to Machine Code — The Assembler

The final stage turns optimized IR into machine code.

### The Assembly Process

```c
void lj_asm_trace(jit_State *J, GCtrace *T) {
  // Reserve MCode area (RW)
  MCode *mcarea = lj_mcode_reserve(J, &lim);

  // Process instructions in REVERSE order (last to first)
  for (as->curins--; as->curins > as->stopins; as->curins--) {
    IRIns *ir = IR(as->curins);
    if (!ra_used(ir) && !ir_sideeff(ir)) continue;  // DCE
    if (irt_isguard(ir->t)) asm_snap_prep(as);      // Prepare snapshot
    asm_ir(as, ir);                                  // Emit the instruction
  }

  // Emit head (trace entry) and tail (exit stubs)
  // Commit MCode (RW → RX)
  lj_mcode_commit(J, mctop);
}
```

### Key Points

- **Backward assembly**: Instructions are processed last-to-first. This enables the register allocator to know which registers are live at each point.
- **Linear scan allocation**: Registers are allocated with hints (e.g., `CALL*` results → `RID_RET`, x86 shift counts → `RID_ECX`).
- **Exit stubs**: Each guard gets an exit stub that saves state and jumps to `lj_vm_exit_handler`.
- **Snapshot preparation**: Before emitting a guard, the assembler records which IR refs map to which stack slots (for deoptimization).

### IR → x86-64 Mapping Example

```
 IR:                              x86-64:
 [1] KINT 42                      mov eax, 42
 [2] ADD [1], KINT 1              add eax, 1
 [3] ISNUM [2]                    test eax, 0x7ff00000
                                  jnz .exit_guard_1
 [4] MUL [2], KINT 2              lea eax, [rax+rax]  ; strength reduction
 [5] RET                          ret
```

The assembler applies its own optimizations: strength reduction (`MUL(x,2)` → `LEA(x+x)`), register coalescing, and memory operand fusion.

## Frequently Asked Questions

### Why SSA?

SSA simplifies compiler analysis. With single definition points, use-def chains are trivial to compute, CSE is a simple hash lookup, and dead code elimination is straightforward. The cost — φ functions for control-flow merges — is handled implicitly by LuaJIT's recorder.

### How does LuaJIT handle φ functions?

Implicitly. The recorder tracks the current IR reference for each stack slot in `J->slot[]`. When a loop back-edge is encountered, it knows which reference corresponds to the current value. No explicit φ nodes in the IR — the mapping is managed by the recorder.

### Can IR be inspected at runtime?

Yes. Run LuaJIT with the `-jdump` flag: `luajit -jdump=bitmsx your_script.lua`. This dumps the IR for each compiled trace, showing the opcodes, types, and snapshots. It's an invaluable tool for understanding what the JIT is doing.

### Why are constants interned?

Deduplication. If two instructions load the same constant, they share the same IR reference. This enables constant CSE (identical instructions are merged) and reduces trace size. The hash table lookup is O(1) per constant creation.

### What's the difference between ADD and ADDOV?

`ADD` is a plain integer add (wraps on overflow). `ADDOV` checks for integer overflow and exits the trace on overflow. The NARROW pass can strip the overflow check (`ADDOV → ADD`) when it proves the inputs are small enough that overflow is impossible.

## Sources

- Mike Pall, LuaJIT source code (`src/lj_ir.h`, `src/lj_ir.c`, `src/lj_record.c`, `src/lj_opt_*.c`, `src/lj_asm.c`), [LuaJIT GitHub](https://github.com/LuaJIT/LuaJIT)
- Mike Pall, "LuaJIT 2.1 IR documentation", [luajit.org](https://luajit.org)
- Compiler literature: SSA form (Cytron et al.), semi-perfect hash tables
