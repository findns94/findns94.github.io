---
title: "DynASM Tutorial: Build Your First Assembly-Powered Interpreter"
description: "LuaJIT runs on 7 CPU architectures with hand-written assembly — written once. Learn how DynASM bridges C and assembly by building a minimal bytecode interpreter from scratch."
coverImage: "/posts/dynasm-first-assembly-interpreter/images/cover.jpg"
coverImageAlt: "A stylized CPU processor chip with assembly code flowing from its pins, representing DynASM bridging C code and machine assembly"
ogImage: "/posts/dynasm-first-assembly-interpreter/images/cover.jpg"
date: "2026-09-05 14:00:00"
lastUpdated: "2026-09-05 14:00:00"
author: "FindNS94"
tags: ["LuaJIT", "DynASM", "Interpreter"]
---

![A stylized CPU processor chip with assembly code flowing from its pins, representing DynASM bridging C code and machine assembly](/posts/dynasm-first-assembly-interpreter/images/cover.jpg)

LuaJIT runs on 7 CPU architectures: x86, x64, ARM, ARM64, MIPS, MIPS64, and PowerPC. Its interpreter core — the dispatch loop that executes bytecode — is hand-written in assembly for each target. Yet maintainer Mike Pall doesn't write 7 separate assembly files. He writes **one**.

The tool that makes this possible is **DynASM** (Dynamic Assembler): a preprocessor that turns a C-with-assembly DSL into raw machine code bytes for any supported architecture. It's the foundation beneath LuaJIT's interpreter, and it's the reason a single `.dasc` source file generates native dispatch loops for every CPU LuaJIT supports.

In this tutorial, you'll learn exactly how DynASM works — the syntax, the pipeline, the encoding protocol — and then build a minimal bytecode interpreter using it. By the end, you'll have a working interpreter whose dispatch loop is written in assembly via DynASM, just like LuaJIT itself.

<!-- more -->

> **Key Takeaways**
> - DynASM is a **build-time** preprocessor, not a JIT compiler: `.dasc` → `dynasm.lua` → C with embedded machine code bytes → compiled into the binary.
> - The VM interpreter loop is NOT written in C — it's hand-written assembly in a `.dasc` file, preprocessed at build time.
> - Fixed register assignment (BASE, KBASE, PC, DISPATCH) pinned to specific CPU registers is the key to fast dispatch.
> - The `dasm_State` → action list → `dasm_encode()` pipeline resolves labels and emits machine code in a single pass.
> - DynASM can be used **independently** of LuaJIT — it's a standalone MIT-licensed tool for any project that needs build-time code generation.

## What Is DynASM and Why Does LuaJIT Need It?

### The Multi-Architecture Problem

A scripting language interpreter needs a fast dispatch loop — the inner cycle that fetches each bytecode instruction and jumps to its handler. The fastest implementations write this loop in assembly: you pin key values (the program counter, the stack base, the constants table) to CPU registers so they don't need to be reloaded from memory on every iteration.

The problem: every CPU architecture has different registers, different calling conventions, and different instruction encodings. x86-64 has `rax`, `rbx`, `r14`; ARM64 has `x0`–`x30`; MIPS has `$t0`–`t9`. Traditional approaches force you to either:

1. Write and maintain **separate assembly files** for each architecture (7 files for LuaJIT's targets), or
2. Use **preprocessor hell** — `#ifdef __x86_64__` / `#ifdef __aarch64__` spaghetti that's unreadable and error-prone.

LuaJIT takes a third path: write the dispatch loop **once** in a DSL that looks like assembly, and use a preprocessor to generate the actual machine bytes for each target.

### The DynASM Pipeline

Here's the complete workflow, end to end:

```
 ┌─────────────┐     ┌──────────────┐     ┌─────────────────┐     ┌──────────┐
 │  source.dasc │────▶│  dynasm.lua  │────▶│  source.dasc.c   │────▶│  gcc/cc  │
 │  (C + asm)   │     │  (preprocessor)│    │  (C + raw bytes) │     │  compile │
 └─────────────┘     └──────────────┘     └─────────────────┘     └──────────┘
       │                     │                      │                     │
  You write this       Lua script            Generated C file      Final binary
  (once per project)   (part of LuaJIT)      (per architecture)    (per architecture)
```

1. **You write** a `.dasc` file — a normal C file interspersed with assembly directives. Lines starting with `|` are DynASM directives; lines without `|` are copied through as C.

2. **`dynasm.lua`** (a Lua script, run by the minimal `minilua` interpreter) preprocesses the `.dasc` file. It parses the assembly mnemonics, resolves labels, applies architecture-specific encoding rules, and outputs a C file.

3. **The generated C file** contains your original C code plus raw machine code bytes (as a `static const unsigned char[]` array) and `dasm_put()` calls that feed those bytes into the DynASM runtime state.

4. **Your C code** calls `dasm_link()` to compute the size, allocates executable memory (via `mmap` + `mprotect`), calls `dasm_encode()` to finalize the machine code, and then **casts the buffer to a function pointer** and calls it.

The key insight: DynASM is **not** a JIT compiler. It runs at **build time**, not runtime. The machine code is generated when you compile your project, not when it runs. This means zero runtime overhead for code generation.

### Why Not Just Use a JIT?

If DynASM runs at build time, how does LuaJIT's tracing JIT work? The answer is that LuaJIT has **two separate code generation paths:

- **DynASM** (build time): generates the **interpreter loop** — the static dispatch logic that runs every bytecode instruction.
- **Hand-written emitters** (`lj_asm.c` + `lj_asm_x86.h`): generate **trace code** at runtime — the dynamically compiled hot paths.

DynASM handles the static, architecture-portable part. The JIT assembler handles the dynamic, architecture-specific part. They share the same register allocation concepts but are completely separate code paths.

## The DynASM Workflow — A Minimal Example

Let's start with the simplest possible DynASM program: generating a function that adds two numbers.

### The `.dasc` File

Create a file called `add.dasc`:

```c
#include "dasm_proto.h"
#include "dasm_x86.h"

|.arch x64
|.section code

void build_add(dasm_State **D) {
  |->add_func:
  |  mov rax, rdi    ; first argument
  |  add rax, rsi    ; add second argument
  |  ret
}
```

The `|` prefix marks DynASM lines. Everything else is plain C. The `->add_func` is a global label — after encoding, you can look up its address in the globals array.

### The C Driver

```c
#include <stdio.h>
#include <stdlib.h>
#include <string.h>
#include <sys/mman.h>
#include "dasm_proto.h"
#include "dasm_x86.h"

// Generated by DynASM preprocessor
|.actionlist add_actions

int main() {
  dasm_State *d;

  // Step 1: Initialize
  dasm_init(&d, 1);  // 1 section

  // Step 2: Set up global labels
  void *labels[lbl__MAX];
  dasm_setupglobal(&d, labels, lbl__MAX);

  // Step 3: Set up action list
  dasm_setup(&d, add_actions);

  // Step 4: Emit code (generated dasm_put calls go here)
  // This is where the assembly from the .dasc file gets emitted
  dasm_put(&d, ...);  // auto-generated

  // Step 5: Link — compute size
  size_t sz;
  dasm_link(&d, &sz);

  // Step 6: Allocate executable memory
  void *buf = mmap(0, sz, PROT_READ | PROT_WRITE,
                   MAP_PRIVATE | MAP_ANONYMOUS, -1, 0);

  // Step 7: Encode — generate machine code
  dasm_encode(&d, buf);

  // Step 8: Make memory executable
  mprotect(buf, sz, PROT_READ | PROT_EXEC);

  // Step 9: Call the generated function
  typedef long (*add_fn)(long, long);
  add_fn f = (add_fn)labels[lbl_add_func];
  printf("3 + 4 = %ld\n", f(3, 4));  // prints: 3 + 4 = 7

  // Step 10: Clean up
  dasm_free(&d);
  munmap(buf, sz);
  return 0;
}
```

### Building It

```bash
# 1. Build minilua (the minimal Lua interpreter that runs DynASM)
gcc -o minilua src/host/minilua.c

# 2. Run DynASM preprocessor to generate the C file
./minilua dynasm/dasm.lua -o add_dasc.c add.dasc

# 3. Compile everything together
gcc -o add_test add_dasc.c main.c
```

After preprocessing, `add_dasc.c` contains the original C plus the action list (`static const unsigned char add_actions[]`) and the `dasm_put(&d, ...)` calls with the encoded instruction bytes.

### The 10 API Functions

DynASM's API has exactly 10 functions, called in a specific order during initialization and use:

| Order | Function | Purpose |
|-------|----------|---------|
| 1 | `dasm_init(&d, maxsection)` | Allocate the `dasm_State` structure |
| 2 | `dasm_setupglobal(&d, gl, maxgl)` | Set up the global label (→name) lookup array |
| 3 | `dasm_setup(&d, actionlist)` | Finalize init with the action list from `.actionlist` |
| 4 | `dasm_growpc(&d, maxpc)` | Allocate space for dynamic (=>N) labels |
| 5 | `dasm_put(&d, ...)` | Emit instructions (generated by preprocessor) |
| 6 | `dasm_link(&d, &szp)` | Compute total size needed for machine code |
| 7 | `dasm_encode(&st, buffer)` | Generate machine code into the buffer |
| 8 | `dasm_getpclabel(&st, pc)` | Get the offset of a =>pc label |
| 9 | `dasm_free(&d)` | Free the DynASM state |
| 10 | `dasm_checkstep(&d, secmatch)` | Optional sanity check (debug builds) |

The critical sequence is: **init → setupglobal → setup → [put...] → link → encode → call → free**. The `link` call must happen after all `put` calls (so the size is known), and `encode` must happen after memory is allocated.

<!-- [PERSONAL EXPERIENCE] The first time you see a hand-written DynASM dispatch loop actually running bytecode — fetching opcodes, jumping to handlers, updating the PC — it clicks: this is the same pattern every fast interpreter uses, from CPython (computed-goto) to V8 (ignition) to LuaJIT. DynASM just makes it portable. -->

## Anatomy of LuaJIT's `vm_x64.dasc`

Now let's look at the real thing. LuaJIT's x86-64 interpreter lives in `src/vm_x64.dasc` — roughly 2,000 lines of mixed C and assembly that generate the entire interpreter loop.

### The Register Contract

The most important design decision in any DynASM-based interpreter is **register assignment**. You pin the hottest variables to CPU registers so they never touch memory during the dispatch loop. LuaJIT's x64 contract:

```
 ┌─────────────────────────────────────────────────────────────┐
 │  x64 Register    │  LuaJIT Variable  │  Role                │
 ├─────────────────────────────────────────────────────────────┤
 │  r14d (low 32)   │  DISPATCH          │  Dispatch table pos  │
 │  ebx (low 32)    │  PC                │  Bytecode position   │
 │  r15             │  KBASE             │  Constants table     │
 │  r12 / edx       │  BASE              │  Stack frame base    │
 │  rbp             │  (frame pointer)   │  Call frame chain    │
 │  rsp             │  (stack pointer)   │  C stack             │
 └─────────────────────────────────────────────────────────────┘
```

This is **not** the compiler's register allocation — it's a **fixed convention** hardcoded in the `.dasc` source. Every opcode handler knows that `PC` is in `ebx`, `BASE` is in `r12`, and so on. The handlers read and write these registers directly.

On ARM64, the same variables map to different registers (`x19` for BASE, `x20` for PC, etc.), but the `.dasc` source stays the same — only the architecture module (`dasm_arm64.lua`) changes.

### The Dispatch Loop

The core of the interpreter — the cycle that runs every bytecode instruction:

```
 ┌──────────┐    ┌──────────────┐    ┌─────────────┐    ┌──────────┐
 │  PC += 4  │───▶│  Read opcode │───▶│  Jump via  │───▶│  Handler │
 │           │    │  from bytecode│   │  dispatch  │    │  (asm)   │
 └──────────┘    └──────────────┘    │  table     │    └──────────┘
                                      └─────────────┘          │
                                                                │
                    ┌───────────────────────────────────────────┘
                    │  (handler updates PC, BASE, stack, etc.)
                    ▼
              Back to top (next instruction)
```

In actual x64 assembly (from `vm_x64.dasc`):

```asm
|  mov eax, [PC]          ; load next bytecode instruction
|  add PC, 4              ; advance program counter
|  jmp [dispatch + eax*8] ; jump to handler via dispatch table
```

The dispatch table (`GG_State.dispatch[]`) is an array of code pointers, one per opcode. Each entry points to the assembly handler for that opcode. The computed-goto pattern (`jmp [table + index*size]`) is the fastest way to dispatch in assembly — a single indirect jump, no comparison chain, no switch statement.

### Hot Counters and JIT Trigger

Some opcodes have **hot counters** — they decrement a counter on each execution, and when it hits zero, they call `lj_trace_hot()` to start tracing (JIT compilation). These are the opcodes that begin loops or function entries:

```asm
|->forl:                    ; FOR loop (numeric)
|  sub [hotcount], 1        ; decrement hot counter
|  jg >1                   ; if still hot, skip JIT check
|  call lj_trace_hot       ; trigger JIT recording
|  jmp >2                  ; continue to handler
|1:                        ; not yet hot — just run
|  ...                     ; actual FOR loop logic
|2:                        ; fall-through after JIT check
```

LuaJIT uses **I-prefixed** opcodes (`IFORL`, `IITERL`, `ILOOP`, `IFUNCF`, `IFUNCV`) that are patched in by the JIT once a trace is compiled. The `I` variants coordinate with the recorder — they're the bridge between the interpreter and the JIT.

### The Full Opcode Set

LuaJIT's interpreter handles ~90 opcodes. Each has a suffix encoding its operand types:

| Suffix | Meaning | Example |
|--------|---------|---------|
| `V` | Variable slot | `ADDVV` — add two register values |
| `S` | String constant | `TSETS` — table set by string key |
| `N` | Number constant | `ADDNV` — add register + number |
| `P` | Primitive type | `ISEQP` — compare with primitive |
| `B` | Byte literal | `TGETB` — table get by byte index |
| `M` | Multiple args | `CALLM` — call with variable args |

This systematic naming means the opcode itself tells you its operand types — the recorder and assembler use this to specialize code generation.

## DynASM Directives and Syntax Reference

DynASM's syntax is defined by its directives — lines starting with `|` that control code generation. Here's the complete reference, organized by category.

### Architecture and Section Directives

```
|.arch x64              # Target architecture (x86, x64, arm, arm64, mips, ppc)
|.section code          # Declare a code section (defines DASM_MAXSECTION)
|.align 16              # Align next instruction (power of 2, or: word/dword/aword/qword/oword)
```

The `.arch` directive must be the first DynASM directive and is used exactly once. It loads the corresponding `dasm_ARCH.lua` module that knows the instruction encodings for that target.

### Label Directives

```
|->main                 # Global label — addressable via globals array after encoding
|=>loop_start           # Dynamic PC-relative label (numbered: =>0, =>1, ...)
|1:                     # Local label (scoped to current section, digits 1-9)
```

Global labels (`->name`) become entries in the globals array after `dasm_encode()`. Dynamic labels (`=>N`) are allocated at runtime via `dasm_growpc()` and resolved during encoding. Local labels (`1:` through `9:`) are scoped and used for short jumps within a handler.

### Data Directives

```
|.byte 0x90, 0x90      # Emit raw 8-bit values
|.sbyte -1, 0, 1        # Emit signed 8-bit values
|.word 0x1234           # Emit 16-bit values
|.dword 0x12345678      # Emit 32-bit values
|.space 64, 0x00        # Emit N copies of a filler byte
```

These emit data bytes directly into the output — useful for embedding constant tables or padding in code sections.

### Reflection Directives

```
|.actionlist my_actions  # Generate the action list array (required, used once)
|.globals lbl_           # Generate enum for global labels + set up lookup
|.globalnames my_names   # Generate array of global label names
|.externnames my_externs # Generate array of extern symbol names
```

The `.actionlist` directive is **required** — it generates the `static const unsigned char[]` array that drives the encoding. The `.globals` directive generates an enum mapping each `->label` to an integer constant (e.g., `lbl_main`, `lbl_loop`), ending with `lbl__MAX`.

### Type and Macro Directives

```
|.type state, lua_State, aState   # Syntactic sugar: state->field → [aState + offsetof]
|.macro prologue                  # Define a macro (invokable as instruction)
|  push rbp
|  mov rbp, rsp
|.endmacro
|.define BASE, r12                # Simple substitution: BASE → r12
```

The `.type` directive is particularly powerful — it lets you write `state->top` and have DynASM expand it to `[r12 + offsetof(lua_State, top)]`, combining the register pinning with C struct field access.

### Prepreprocessor Directives

```
|.define X64, 1          # Define a substitution (for ||#if conditionals)
|.if X64                 # Conditional compilation (Lua-evaluated, sandboxed)
|.else
|.endif
|.include "other.dasc"   # Inline include
|.error "message"        # Print message, fail at end
|.fatal "message"         # Print message, fail immediately
```

The `||` prefix (double bar) marks lines that undergo `.define` substitution but are otherwise unchanged by DynASM — used for standard C preprocessor conditionals.

## Building Your Own Mini VM with DynASM

Now let's put it all together. We'll build a minimal bytecode interpreter with 5 opcodes, using DynASM for the dispatch loop. This is a simplified version of what LuaJIT does — the same patterns, scaled down.

<!-- [UNIQUE INSIGHT] The pattern you're about to see — fixed register pinning, computed-goto dispatch, hot counter — is the same architecture used by CPython 3.12's specializing interpreter, V8's Ignition, and LuaJIT. DynASM is LuaJIT's twist: it makes the assembly portable. -->

### Step 1: Define the Bytecode

Our mini VM has a stack-based architecture with 5 opcodes:

```
 ┌──────────┬──────────┬──────────────────────────────┐
 │  Opcode  │  Hex     │  Operation                   │
 ├──────────┼──────────┼──────────────────────────────┤
 │  OP_NOP  │  0x00    │  Do nothing                  │
 │  OP_LOAD │  0x01    │  Push immediate value        │
 │  OP_ADD  │  0x02    │  Pop two, push sum           │
 │  OP_PRINT│  0x03    │  Pop and print top of stack  │
 │  OP_HALT │  0x04    │  Stop execution              │
 └──────────┴──────────┴──────────────────────────────┘
```

A program that computes `1 + 2` and prints the result:

```
  byte code[] = {
    OP_LOAD, 1,    // push 1
    OP_LOAD, 2,    // push 2
    OP_ADD,        // pop 1 and 2, push 3
    OP_PRINT,      // pop and print 3
    OP_HALT        // stop
  };
```

Each opcode is 1 byte. `OP_LOAD` is followed by a 1-byte immediate value; the others have no operands.

### Step 2: Write the DynASM Interpreter

Create `mini_vm.dasc`:

```c
#include <stdio.h>
#include <stdint.h>
#include "dasm_proto.h"
#include "dasm_x86.h"

// Opcodes
#define OP_NOP   0x00
#define OP_LOAD  0x01
#define OP_ADD   0x02
#define OP_PRINT 0x03
#define OP_HALT  0x04

typedef struct {
  uint8_t *pc;       // program counter → pinned to register
  int32_t *sp;       // stack pointer → pinned to register
  int32_t stack[256];// operand stack
} VM;

// The generated function signature:
//   void vm_run(VM *vm, uint8_t *bytecode)

|.arch x64
|.section code

void build_vm(dasm_State **D) {
  |->vm_run:

  // Register contract:
  //   rdi = VM* (first arg)  — we'll call it 'vm'
  //   rsi = uint8_t* bytecode — the bytecode buffer
  //   r12 = vm->pc
  //   r13 = vm->sp
  //   r14 = dispatch table position

  | mov r12, [rdi]        // r12 = vm->pc (load from struct)
  | mov r13, [rdi + 8]    // r13 = vm->sp (load from struct, offset 8)

  // Main dispatch loop
  |->dispatch:
  | movzx eax, byte [r12] // load opcode byte
  | inc r12               // advance PC
  | jmp [rsi + rax*8]    // jump to handler via dispatch table

  // Handler: OP_NOP (0x00)
  |->op_nop:
  | jmp ->dispatch

  // Handler: OP_LOAD (0x01) — next byte is the value to push
  |->op_load:
  | movzx eax, byte [r12] // load immediate value
  | inc r12               // advance past operand
  | mov [r13], eax        // push onto stack
  | add r13, 4            // sp += 4 (int32)
  | jmp ->dispatch

  // Handler: OP_ADD (0x02)
  |->op_add:
  | sub r13, 4            // sp -= 4 (pop top)
  | mov eax, [r13]        // eax = top
  | sub r13, 4            // sp -= 4 (pop second)
  | add eax, [r13]        // eax = second + top
  | mov [r13], eax        // push result
  | add r13, 4            // sp += 4
  | jmp ->dispatch

  // Handler: OP_PRINT (0x03)
  |->op_print:
  | sub r13, 4            // pop top
  | mov eax, [r13]        // eax = value to print
  | // (in real code, call printf here — omitted for clarity)
  | jmp ->dispatch

  // Handler: OP_HALT (0x04)
  |->op_halt:
  | mov [rdi], r12        // save vm->pc back
  | mov [rdi + 8], r13    // save vm->sp back
  | ret                   // return to caller
}

|.actionlist vm_actions
```

### Step 3: The C Driver

```c
#include <stdio.h>
#include <stdlib.h>
#include <string.h>
#include <sys/mman.h>
#include "dasm_proto.h"
#include "dasm_x86.h"

// Generated by DynASM
extern void build_vm(dasm_State **D);

int main() {
  // The bytecode program: LOAD 1, LOAD 2, ADD, PRINT, HALT
  uint8_t program[] = {
    0x01, 0x01,   // OP_LOAD 1
    0x01, 0x02,   // OP_LOAD 2
    0x02,         // OP_ADD
    0x03,         // OP_PRINT
    0x04          // OP_HALT
  };

  // Set up the VM state
  VM vm;
  vm.pc = program;
  vm.sp = vm.stack;

  // Build the DynASM state
  dasm_State *d;
  dasm_init(&d, DASM_MAXSECTION);

  // Global labels for each handler
  enum { lbl_vm_run, lbl_op_nop, lbl_op_load, lbl_op_add,
         lbl_op_print, lbl_op_halt, lbl__MAX };
  void *labels[lbl__MAX];
  dasm_setupglobal(&d, labels, lbl__MAX);

  // Set up action list and build the code
  dasm_setup(&d, vm_actions);
  build_vm(&d);

  // Link and allocate
  size_t sz;
  dasm_link(&d, &sz);
  void *buf = mmap(0, sz, PROT_READ | PROT_WRITE,
                   MAP_PRIVATE | MAP_ANONYMOUS, -1, 0);
  dasm_encode(&d, buf);
  mprotect(buf, sz, PROT_READ | PROT_EXEC);

  // Build dispatch table (maps opcode → handler address)
  void *dispatch[256];
  dispatch[OP_NOP]   = labels[lbl_op_nop];
  dispatch[OP_LOAD]  = labels[lbl_op_load];
  dispatch[OP_ADD]   = labels[lbl_op_add];
  dispatch[OP_PRINT] = labels[lbl_op_print];
  dispatch[OP_HALT]  = labels[lbl_op_halt];

  // Call the generated interpreter
  typedef void (*vm_fn)(VM*, void*);
  vm_fn run = (vm_fn)labels[lbl_vm_run];
  run(&vm, dispatch);

  printf("Result: %d\n", vm.stack[0]);  // prints: Result: 3

  // Cleanup
  dasm_free(&d);
  munmap(buf, sz);
  return 0;
}
```

### Step 4: Build and Run

```bash
# Build minilua
gcc -o minilua src/host/minilua.c

# Preprocess the DynASM file
./minilua dynasm/dasm.lua -o mini_vm_dasc.c mini_vm.dasc

# Compile everything
gcc -o mini_vm mini_vm_dasc.c vm_driver.c

# Run it
./mini_vm
# Output: Result: 3
```

### What Just Happened?

You wrote an interpreter loop in assembly, preprocessed it into machine code at build time, and then called it at runtime. The dispatch loop:

1. Reads the next opcode byte from the bytecode stream
2. Advances the program counter
3. Jumps to the handler via the dispatch table (computed goto)
4. Each handler executes its logic and jumps back to dispatch
5. OP_HALT saves state and returns

This is the same pattern LuaJIT uses — scaled down to 5 opcodes instead of 90, but identical in structure.

## How DynASM Bridges C and Assembly

### The Action List Protocol

When `dynasm.lua` preprocesses a `.dasc` file, it doesn't output assembly text — it outputs an **action list**: a sequence of integer opcodes (the `DASM_*` constants) that encode "emit this byte", "resolve this label", "jump to this relocation type".

The key action types:

```
 ┌─────────────────────┬──────────┬──────────────────────────────────┐
 │  Action Type        │  Value   │  Meaning                         │
 ├─────────────────────┼──────────┼──────────────────────────────────┤
 │  DASM_DISP          │  233     │  Displacement follows            │
 │  DASM_IMM_S         │  234     │  Signed 8-bit immediate          │
 │  DASM_IMM_B         │  235     │  Unsigned 8-bit immediate        │
 │  DASM_IMM_W         │  236     │  16-bit immediate                │
 │  DASM_IMM_D         │  237     │  32-bit immediate                │
 │  DASM_VREG          │  238     │  Virtual register reference      │
 │  DASM_SPACE         │  239     │  Reserve N bytes                 │
 │  DASM_SETLABEL      │  240     │  Set label at current position   │
 │  DASM_REL_A         │  241     │  Absolute relocation             │
 │  DASM_REL_LG        │  242     │  Global-relative relocation      │
 │  DASM_REL_PC        │  243     │  PC-relative relocation          │
 │  DASM_IMM_LG        │  244     │  Global + 32-bit immediate       │
 │  DASM_IMM_PC        │  245     │  PC-relative + 32-bit immediate  │
 │  DASM_LABEL_LG      │  246     │  Global label at current pos     │
 │  DASM_LABEL_PC      │  247     │  PC-relative label at current pos│
 │  DASM_ALIGN         │  248     │  Align to N bytes                │
 │  DASM_EXTERN        │  249     │  External symbol reference       │
 │  DASM_ESC           │  250     │  Escape (next byte is raw)       │
 │  DASM_MARK          │  251     │  Mark position                   │
 │  DASM_SECTION       │  252     │  Switch section                  │
 │  DASM_STOP          │  253     │  End of action list              │
 └─────────────────────┴──────────┴──────────────────────────────────┘
```

The action list is the bridge between the preprocessor and the runtime encoder. The preprocessor emits actions; the encoder (`dasm_encode()`) walks the action list and writes actual machine bytes.

### The Encoding Pipeline

```
 ┌──────────────┐     ┌──────────────┐     ┌──────────────┐     ┌──────────┐
 │  Action List  │────▶│  dasm_link   │────▶│ Allocate mem │────▶│dasm_encode│
 │  (DASM_*)     │     │  (compute sz)│     │ (mmap)       │     │(emit bytes)│
 └──────────────┘     └──────────────┘     └──────────────┘     └──────────┤
                                                                         │
       ┌─────────────────────────────────────────────────────────────────┘
       ▼
 ┌──────────────┐     ┌──────────────┐
 │ mprotect     │────▶│ Call as      │
 │ (RW → RX)    │     │ function ptr │
 └──────────────┘     └──────────────┘
```

1. **`dasm_link()`** walks the action list, resolves all labels (computing their final offsets), and returns the total size needed. This is a dry run — no bytes are written.

2. **Memory allocation** via `mmap()` with `PROT_READ | PROT_WRITE` (not yet executable — W^X security discipline).

3. **`dasm_encode()`** walks the action list again, this time writing actual machine bytes into the buffer. Labels are resolved to their final addresses. Relocations are patched.

4. **`mprotect()`** flips the memory from RW to RX (read-execute). The buffer is now executable machine code.

5. **Cast and call** — the buffer (or a specific label's address) is cast to a function pointer and called.

### Why This Is Elegant

Traditional assembly toolchains have a **three-stage pipeline**: assembler (text → object), linker (object → executable), loader (executable → running code). DynASM collapses this into **one pass**:

- No text assembly (the "assembly" is the action list, already parsed)
- No object files (machine bytes go straight to memory)
- No linker (labels are resolved during encoding)
- No separate file format (the output is raw bytes in a C array)

The result: you write assembly-like code in a `.dasc` file, run a preprocessor, and get a function you can call. No assembler, no linker, no `.o` files. Just C and DynASM.

## From Mini VM to LuaJIT — What's Next

Our mini VM has 5 opcodes and a simple dispatch loop. LuaJIT's interpreter has ~90 opcodes, but the architecture is the same. Here's what the full interpreter adds on top of this foundation:

- **90+ bytecode opcodes** with the V/S/N/P/B/M suffix system for operand types
- **Hot counters** on loop and function-entry opcodes that trigger JIT compilation
- **Continuations** (`lj_cont_*`) for resumable operations like string concatenation and trace stitching
- **Exit handlers** (`lj_vm_exit_handler`) that deoptimize from JIT traces back to the interpreter
- **Snapshot-based deoptimization** — the JIT records interpreter state at guard points so it can fall back safely
- **Trace stitching** — side traces that chain together to form longer optimized paths

The next article in this series covers the **hot counter mechanism** and **trace recorder** — how LuaJIT detects hot paths, starts recording them, and compiles them into optimized machine code. That's where the tracing JIT comes in, and it builds directly on the interpreter foundation you've just learned.

## Frequently Asked Questions

### Is DynASM a JIT compiler?

No. DynASM is a **build-time** preprocessor. It runs when you compile your project, not when it runs. The machine code it generates is static — it doesn't change at runtime. LuaJIT's *tracing JIT* is a separate system (hand-written emitters in `lj_asm.c`) that generates code at runtime. DynASM generates the interpreter; the JIT generates trace code.

### Can I use DynASM independently of LuaJIT?

Yes. DynASM is MIT-licensed and self-contained. You need three files: `dynasm/dynasm.lua` (the preprocessor), `dynasm/dasm_proto.h` (API headers), and `dynasm/dasm_x86.h` (or the appropriate architecture module). The build-time dependency is `minilua` (a 15K-line minimal Lua interpreter included in LuaJIT's `src/host/`). Several projects use DynASM standalone: RaptorJIT (a LuaJIT fork), various educational JIT compilers, and high-performance numeric kernels.

### What architectures does DynASM support?

x86 (32-bit), x64 (64-bit), ARM (32-bit), ARM64 (64-bit), MIPS (32 and 64-bit), and PowerPC. The architecture modules (`dasm_x86.lua`, `dasm_arm64.lua`, etc.) encode the instruction set specifics. LuaJIT ships all 7 targets; a typical project only needs one or two.

### How does computed-goto dispatch compare to a switch statement?

A `switch` dispatch requires the compiler to generate a branch table or comparison chain — typically 3-5 instructions per dispatch. Computed-goto (`jmp [table + index*8]`) is a **single indirect jump** — 1 instruction, 1 cache access. The tradeoff: computed-goto is harder to debug (you're jumping to raw addresses) and not portable to all compilers (though DynASM solves the portability problem). For interpreters that dispatch millions of times per second, the single-instruction dispatch is worth it.

### What's the difference between `->label` and `=>N`?

`->name` is a **global label** — it gets an entry in the globals array and can be looked up by name after encoding (e.g., `labels[lbl_main]`). `=>N` is a **dynamic label** — it's numbered, allocated at runtime via `dasm_growpc()`, and used for forward/backward jumps within generated code (like loop branches). Global labels are for function entry points; dynamic labels are for control flow within a function.

## Sources

- Mike Pall, LuaJIT source code (`src/vm_x64.dasc`, `dynasm/dasm_proto.h`, `dynasm/dasm_x86.h`), [LuaJIT GitHub](https://github.com/LuaJIT/LuaJIT)
- Mike Pall, "DynASM — Dynamic Assembler for code generation engines", [luajit.org/dynasm.html](https://luajit.org/dynasm.html)
- Peter Cawley, "Unofficial DynASM Documentation", [corsix.github.io/dynasm-doc](https://corsix.github.io/dynasm-doc/), CC BY 3.0
- LuaJIT project, approximately 5,000 GitHub stars, `v2.1` rolling release branch, [github.com/LuaJIT/LuaJIT](https://github.com/LuaJIT/LuaJIT)
