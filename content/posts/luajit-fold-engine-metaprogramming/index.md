---
title: "The Pinnacle of Compile-Time Metaprogramming: The FOLD Engine & Semi-Perfect Hash Rule Lookup"
description: "LuaJIT's optimizer fits in 2653 lines yet handles constant folding, algebraic simplification, CSE, and more. Learn how the FOLD engine uses a semi-perfect hash table generated at build time."
coverImage: "/posts/luajit-fold-engine-metaprogramming/images/cover.jpg"
coverImageAlt: "FOLD engine concept: a 24-bit key hashing into a table of fold functions, representing the semi-perfect hash rule lookup"
ogImage: "/posts/luajit-fold-engine-metaprogramming/images/cover.jpg"
date: "2026-09-05 22:00:00"
lastUpdated: "2026-09-05 22:00:00"
author: "FindNS94"
tags: ["LuaJIT", "FOLD", "Compiler"]
---

![FOLD engine concept: a 24-bit key hashing into a table of fold functions, representing the semi-perfect hash rule lookup](/posts/luajit-fold-engine-metaprogramming/images/cover.jpg)

LuaJIT's optimizer fits in 2,653 lines of code. Yet it handles constant folding, algebraic simplification, array-bounds-check elimination, common-subexpression elimination, load forwarding, and dead-store elimination. How?

The answer is the **FOLD engine**: a rule-based optimizer driven by a semi-perfect hash table generated at build time. Every time an instruction is emitted during trace recording, the FOLD engine checks if any optimization rule applies — in O(1) time, with no string matching, no if-else chains, no visitor patterns.

This is the pinnacle of compile-time metaprogramming: a Lua script scans macro specifications and generates an optimal C lookup table. The result is an optimizer that's fast, extensible, and remarkably compact.

In this article, you'll learn the FOLD engine architecture, the LJFOLD macro system, the semi-perfect hash table, iterative refinement with wildcards, the build-time code generation, and why this design is so elegant.

> **Key Takeaways**
> - The FOLD engine is a rule-based optimizer that runs on every emitted instruction during trace recording.
> - Rules are defined via `LJFOLD()` macros and compiled into a semi-perfect hash table at build time.
> - The 24-bit key `(ins_opcode, left_opcode, right_opcode)` enables O(1) rule lookup.
> - Iterative refinement with wildcards allows rules to match progressively more general patterns.
> - This is compile-time metaprogramming: a Lua script generates the C lookup table from macro specifications.

## The FOLD Engine Architecture

The FOLD engine sits at the heart of LuaJIT's optimizer. It runs on every instruction emitted during trace recording — not as a separate pass, but inline with instruction creation.

### Where FOLD Fits

```
 Bytecode → [lj_record_ins()] → emitir(ot, a, b)
                                      │
                              ┌───────▼────────┐
                              │  lj_ir_set()   │  Create IR instruction
                              └───────┬────────┘
                                      │
                              ┌───────▼────────┐
                              │ lj_opt_fold()  │  ← FOLD engine runs here
                              └───────┬────────┘
                                      │
                              ┌───────▼────────┐
                              │  Folded IR     │  Optimized instruction
                              └────────────────┘
```

The `emitir()` macro ties it all together:

```c
#define emitir(ot, a, b)  (lj_ir_set(J, (ot), (a), (b)), lj_opt_fold(J))
```

This creates the IR instruction, then immediately runs the FOLD engine on it. The fold may:
- Replace the instruction with a constant (constant folding)
- Replace it with an operand (algebraic simplification)
- Mark it for CSE (common-subexpression elimination)
- Leave it unchanged (no rule matched)

### Why Fold During Recording?

Most compilers separate instruction selection from optimization. The front end emits IR, then optimization passes transform it. LuaJIT folds during recording because:

1. **Type information is fresh**: Guards have just been emitted, so types are known
2. **Single pass**: No separate optimization pass needed for simple folds
3. **Smaller IR**: Folded instructions don't consume space in the trace
4. **Better CSE**: Constants are available immediately for subsequent instructions

The tradeoff: more work during recording. But recording only happens for hot code, so the cost is amortized.

## The LJFOLD Macro System

Optimization rules are defined declaratively via the `LJFOLD` macro. Each rule specifies: the instruction opcode, the left operand type, the right operand type, and the fold function to call.

### Rule Definition

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

The syntax: `LJFOLD(INSTRUCTION LEFT RIGHT)` followed by the fold function name. The `any` keyword means "match any operand type."

### Rule Categories

| Category | Example Rule | What It Does |
|----------|-------------|--------------|
| Constant folding | `ADD KNUM KNUM` → compute at record time | `3 + 4` → `7` |
| Algebraic simplification | `ADD(x, 0)` → `x` | Strength reduction |
| ABC elimination | `ABC(any, ABC)` → nested check | Array bounds optimization |
| CSE | `HREF any any` → check chain | Common subexpression |
| Load forwarding | `XLOAD any any` → forward store | Replace load with stored value |
| Dead-store elimination | `ASTORE any any` → check liveness | Remove unused stores |
| Guard optimization | `FAILFOLD`/`DROPFOLD` | Remove always-false/true guards |

### The Fold Function

Each fold function receives the JIT state and the instruction, and returns a terminal action:

```c
enum {
  NEXTFOLD,     // Continue to next rule
  RETRYFOLD,    // Re-fold the modified instruction
  INTFOLD(k),   // Replace with integer constant k
  LEFTFOLD,     // Replace with left operand
  RIGHTFOLD,    // Replace with right operand
  CSEFOLD,      // Perform CSE
  EMITFOLD,     // Emit the instruction as-is
  FAILFOLD,     // Guard always fails (exit trace)
  DROPFOLD,     // Guard always true (remove it)
};
```

## The Semi-Perfect Hash Table

The FOLD engine's performance comes from its lookup structure: a **semi-perfect hash table** generated at build time.

### The 24-Bit Key

```
 ┌──────────────┬──────────────┬──────────────┐
 │  ins_opcode  │ left_opcode  │ right_opcode │
 │   (8 bits)   │  (8 bits)    │  (8 bits)    │
 └──────────────┴──────────────┴──────────────┘
       23-16          15-8           7-0
```

- **ins_opcode**: The opcode of the instruction being folded (8 bits = 256 possible opcodes)
- **left_opcode**: The opcode of the left operand (8 bits; 0 if left is a literal/constant)
- **right_opcode**: The opcode of the right operand (8 bits; 0 if right is a literal/constant)

Literals (constants) use their lowest 8 bits as their "opcode" for hashing purposes. Unused operands use 0.

### Why Semi-Perfect?

A **perfect hash** guarantees O(1) lookup with zero collisions for any key in the domain. A **semi-perfect hash** guarantees zero collisions for **defined** keys (keys that have rules) but may have collisions for undefined keys.

This is exactly what the FOLD engine needs: every rule lookup hits exactly one defined rule (or no rule). Undefined keys may hash to occupied slots, but the fold function returns `NEXTFOLD` to continue searching.

### The Generated Table

At build time, `buildvm_fold.c` generates two arrays:

```c
// Generated by buildvm_fold.c
static const uint16_t fold_hash[DASM_FOLD_HASH_SIZE] = {
  0x0000, 0x0001, 0x0000, 0x0002, ...
};

static const FoldFunc fold_functions[] = {
  kfold_numarith,       // Index 0
  kfold_intarith,       // Index 1
  fload_func_ffid_kgc,  // Index 2
  ...
};
```

The lookup:

```c
uint32_t key = (ins << 16) | (left << 8) | right;
uint16_t hash = fold_hash[key % DASM_FOLD_HASH_SIZE];
FoldFunc func = fold_functions[hash];
```

## Iterative Refinement — Wildcard Matching

The key insight that makes the FOLD engine powerful: when a specific rule doesn't match, the engine doesn't give up. It masks the key with wildcards and retries, from most-specific to least-specific.

### The Four Levels

```
 Level 1 (exact):     ins=left=ADD, right=KNUM, left_op=KGC, right_op=KNUM
                       → Look up: (ADD, KGC, KNUM)

 Level 2 (wildcard L): ins=left=ADD, right=KNUM, left_op=any, right_op=KNUM
                       → Look up: (ADD, any, KNUM)

 Level 3 (wildcard R): ins=left=ADD, right=KNUM, left_op=KGC, right_op=any
                       → Look up: (ADD, KGC, any)

 Level 4 (wildcard LR): ins=left=ADD, right=KNUM, left_op=any, right_op=any
                       → Look up: (ADD, any, any)
```

The `any` mask is defined per-rule, allowing partial wildcards. A rule can specify "match any left operand but a specific right operand."

### Why This Matters

Without wildcarding, you'd need a separate rule for every possible combination of operands. With wildcarding, one general rule can handle many specific cases:

```c
// Specific rule: ADD of two known numbers
LJFOLD(ADD KNUM KNUM) → kfold_numarith

// General rule: ADD with any operands (strength reduction)
LJFOLD(ADD any any) → lj_opt_fold_add  // handles x+0, 0+x, etc.
```

The specific rule fires first. If it doesn't match, the general rule catches the case.

## Terminal Actions — What Happens When a Rule Matches

When a fold function executes, it returns a terminal action that determines what happens to the instruction.

### The Actions

```
 ┌─────────────────────────────────────────────────────────────┐
 │  Action        │  Effect                                    │
 ├────────────────┼────────────────────────────────────────────┤
 │  NEXTFOLD      │  Continue searching for another rule       │
 │  RETRYFOLD     │  Re-fold the (modified) instruction        │
 │  INTFOLD(k)    │  Replace with integer constant k           │
 │  LEFTFOLD      │  Replace with left operand                 │
 │  RIGHTFOLD     │  Replace with right operand                │
 │  CSEFOLD       │  Perform common-subexpression elimination  │
 │  EMITFOLD      │  Emit the instruction unchanged            │
 │  FAILFOLD      │  Guard always fails (exit trace)           │
 │  DROPFOLD      │  Guard always true (remove it)             │
 └────────────────┴────────────────────────────────────────────┘
```

### Examples in Action

```c
// Constant folding: ADD(KNUM 3, KNUM 4) → INTFOLD(7)
LJFOLD(ADD KNUM KNUM)
  if (op1->n + op2->n == (int32_t)(op1->n + op2->n))
    return INTFOLD((int32_t)(op1->n + op2->n));
  return NEXTFOLD;
LJFOLD_END

// Strength reduction: ADD(x, KNUM 0) → LEFTFOLD
LJFOLD(ADD any KNUM)
  if (op2->n == 0) return LEFTFOLD;  // x + 0 = x
  return NEXTFOLD;
LJFOLD_END

// Dead store: ASTORE to unread slot → DROPFOLD
LJFOLD(ASTORE any any)
  if (slot_is_dead(op1)) return DROPFOLD;
  return NEXTFOLD;
LJFOLD_END
```

## Build-Time Code Generation — The Meta Trick

The most remarkable aspect of the FOLD engine: the hash table isn't written by hand. It's **generated at build time** by a Lua script that scans the source code for `LJFOLD` macros.

### The Pipeline

```
 ┌──────────────────┐     ┌──────────────────┐     ┌──────────────────┐
 │  lj_opt_fold.c   │────▶│  buildvm_fold.c  │────▶│  lj_folddef.h    │
 │  (LJFOLD macros) │     │  (Lua script)    │     │  (generated      │
 │                  │     │  scans & generates│    │   hash table)    │
 └──────────────────┘     └──────────────────┘     └──────────────────┘
        │                                                    │
        │                                                    ▼
        │                                            ┌──────────────────┐
        └───────────────────────────────────────────▶│  Compiled into   │
                                                     │  luajit binary   │
                                                     └──────────────────┘
```

### How It Works

1. `buildvm_fold.c` (a C program that runs at build time) scans `lj_opt_fold.c` for `LJFOLD(...)` macro invocations
2. It extracts the instruction, left, right, and function name from each macro
3. It builds a hash table mapping 24-bit keys to function indices
4. It generates `lj_folddef.h` — a C header with the `fold_hash[]` array and `fold_functions[]` table

### Why This Is "Compile-Time Metaprogramming"

This technique — using a script to generate optimized lookup tables from declarative specifications — is the essence of compile-time metaprogramming:

- **Declarative rules**: You say *what* to optimize, not *how* to match
- **Optimal code generation**: The generator produces the fastest possible lookup structure
- **Zero runtime cost**: The hash table is precomputed; no parsing or matching at runtime
- **Extensibility**: Add a rule → add one macro → rebuild

### Comparison: Traditional Approaches

| Approach | Pros | Cons |
|----------|------|------|
| If-else chains | Simple to understand | O(n) lookup, hard to maintain |
| Visitor pattern | Extensible, OO | Virtual dispatch overhead, boilerplate |
| String matching | Flexible | Slow, error-prone |
| **Semi-perfect hash** | **O(1), compact, fast** | Requires build-time generation |

## CSE — Common Subexpression Elimination

The FOLD engine integrates tightly with LuaJIT's CSE mechanism. When a fold returns `CSEFOLD`, the engine searches for an identical instruction that was already emitted.

### The Skip-List Chains

Each opcode has a skip-list chain (`J->chain[op]`) linking all instructions with that opcode. For CSE, the engine walks the chain looking for an instruction with matching `(op1, op2)`:

```c
// Simplified CSE search
IRRef lj_opt_cse(jit_State *J, IROp op, IRRef op1, IRRef op2) {
  IRRef ref = J->chain[op];
  IRRef lim = op1 > op2 ? op1 : op2;  // Only search predecessors
  while (ref > lim) {
    IRIns *ir = IR(ref);
    if (ir->op1 == op1 && ir->op2 == op2) return ref;  // Found match!
    ref = ir->prev;
  }
  return 0;  // No match
}
```

The `lim` bound is key: since references are in SSA order (instructions grow upward), any match must be a predecessor. This bounds the search to O(1) amortized time.

### Integration with FOLD

When a fold returns `CSEFOLD`, the engine runs the CSE search. If a match is found, the current instruction is replaced with the existing reference — no duplicate computation.

## Why This Design Is Elegant

The FOLD engine represents a compiler construction technique at its finest. Here's why:

### Separation of Concerns

Rules are defined declaratively. The engine handles matching. You don't write matching logic; you write *what* to optimize. This makes the rules easy to read, verify, and extend.

### Extensibility

Adding a new optimization requires one `LJFOLD` macro and one fold function. No changes to the engine, no changes to the hash table generator (it auto-discovers new rules).

### Performance

- **O(1) lookup**: Single hash table access per instruction
- **No string matching**: Keys are integers, not strings
- **No if-else chains**: The hash table replaces what would be hundreds of conditionals
- **Compact**: 2,653 lines for the entire optimizer

### The "Pinnacle of Compile-Time Metaprogramming"

This technique — using a build-time script to generate optimal lookup tables from declarative macro specifications — is the pinnacle of compile-time metaprogramming because:

1. **The generator is simple**: A Lua script scans macros and builds a hash table
2. **The output is optimal**: Semi-perfect hash guarantees O(1) with no collisions for defined keys
3. **The interface is clean**: Rules are declarative, not procedural
4. **The cost is zero**: All computation happens at build time; runtime is just table lookups

This pattern — declarative rules + build-time code generation — is applicable far beyond LuaJIT. Any system that needs fast pattern matching on structured data can benefit from it.

## Frequently Asked Questions

### Why fold during recording instead of after?

Type information is fresh during recording — guards have just been emitted, so types are known. Folding during recording avoids a separate optimization pass and keeps the IR small. The tradeoff is more work during recording, but recording only happens for hot code.

### What happens if two rules match?

The most specific match wins. Iterative refinement tries exact matches first, then progressively wildcards operands. The first rule that returns a terminal action other than `NEXTFOLD` wins.

### Can I add custom fold rules?

Yes. Add a `LJFOLD(INSTRUCTION LEFT RIGHT)` macro with your fold function, then rebuild. The build-time generator will discover your new rule and include it in the hash table.

### How many fold rules are there?

Approximately 200+ rules covering constant folding, algebraic simplification, ABC elimination, CSE, load forwarding, dead-store elimination, and guard optimization. They're defined throughout `lj_opt_fold.c`.

### Is the hash table perfect or semi-perfect?

Semi-perfect. Defined keys (those with rules) have zero collisions. Undefined keys may hash to occupied slots, but the fold function returns `NEXTFOLD` to continue searching, so this is harmless.

## Sources

- Mike Pall, LuaJIT source code (`src/lj_opt_fold.c`, `src/host/buildvm_fold.c`, `src/lj_folddef.h`), [LuaJIT GitHub](https://github.com/LuaJIT/LuaJIT)
- Mike Pall, "LuaJIT 2.1 FOLD engine documentation", [luajit.org](https://luajit.org)
- Compiler literature: semi-perfect hash tables, Gray code generation for hash functions
