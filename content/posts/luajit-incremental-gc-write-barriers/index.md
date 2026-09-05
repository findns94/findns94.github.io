---
title: "Black Never Turns White: LuaJIT's Incremental GC & The Art of Write Barriers"
description: "LuaJIT's garbage collector runs concurrently with your code, never stopping the world for long. Learn how the tri-color invariant and write barriers make incremental GC possible."
coverImage: "/posts/luajit-incremental-gc-write-barriers/images/cover.jpg"
coverImageAlt: "Three color circles — white, gray, black — with arrows showing allowed transitions and a red X over the forbidden white-to-black direct transition"
ogImage: "/posts/luajit-incremental-gc-write-barriers/images/cover.jpg"
date: "2026-09-05 24:00:00"
lastUpdated: "2026-09-05 24:00:00"
author: "FindNS94"
tags: ["LuaJIT", "Garbage Collection", "GC"]
---

![Three color circles — white, gray, black — with arrows showing allowed transitions and a red X over the forbidden white-to-black direct transition](/posts/luajit-incremental-gc-write-barriers/images/cover.jpg)

LuaJIT's garbage collector runs concurrently with your code. It never stops the world for more than a few microseconds at a time. The secret is a simple invariant: **a black object never points to a white object**.

This invariant is the foundation of incremental garbage collection. If it holds, the GC can safely collect all white objects — they're truly unreachable. The challenge is maintaining this invariant while your code (the mutator) constantly modifies objects. That's the job of **write barriers**.

In this article, you'll learn the tri-color abstraction, the GC state machine, the three types of write barriers, why LuaJIT uses backward barriers for tables, how incremental stepping keeps pauses short, and the JIT-friendly design choice of keeping dead keys alive.

> **Key Takeaways**
> - The tri-color invariant (black never points to white) is the foundation of incremental GC correctness.
> - Write barriers detect and repair invariant violations when the mutator modifies objects.
> - Backward barriers for tables (re-gray) are cheaper than forward barriers (mark value).
> - The GC runs incrementally, paying down memory debt in small steps.
> - Weak tables and finalizers are handled in the atomic phase.

## Tri-Color Abstraction — The Foundation

LuaJIT's GC uses the **tri-color marking** scheme, a classic technique for incremental garbage collection. Every object is in one of three states:

```
 ┌─────────────────────────────────────────────────────────────┐
 │  WHITE  │  Not yet reached. Candidate for collection.      │
 │  GRAY   │  Reached, but children not yet scanned.          │
 │  BLACK  │  Reached and all children scanned.               │
 └─────────────────────────────────────────────────────────────┘
```

### Color Transitions

```
 ┌────────┐   mark root   ┌────────┐   scan children   ┌────────┐
 │ WHITE  │──────────────▶│ GRAY   │──────────────────▶│ BLACK  │
 └────────┘               └────────┘                   └────────┘
     ▲                                                    │
     │              collect (if still white)              │
              ◀──────────────────────────────────────────┘
```

- **White → Gray**: The GC reaches an object during marking
- **Gray → Black**: The GC scans the object's children, marking them gray
- **White → (collected)**: If an object is still white at the end of marking, it's unreachable

### Two White Flavors

LuaJIT uses **two white colors**: `WHITE0` (0x01) and `WHITE1` (0x02). Only one is the "current" white at any time. This allows the GC to distinguish objects that survived the previous cycle from objects that are newly allocated:

```c
#define LJ_GC_WHITE0  0x01
#define LJ_GC_WHITE1  0x02
```

After each GC cycle, the current white flips. Objects that were white in the previous cycle are now in the "other" white — they'll be collected in the next cycle if still unreachable.

### Color Encoding

Colors are encoded in the `marked` byte of the `GCHeader`:

```c
#define LJ_GC_WHITE0   0x01
#define LJ_GC_WHITE1   0x02
#define LJ_GC_BLACK    0x04
#define LJ_GC_FINALIZED 0x08
#define LJ_GC_WEAKKEY  0x08   /* shared bit */
#define LJ_GC_WEAKVAL  0x10
#define LJ_GC_FIXED    0x20
#define LJ_GC_SFIXED   0x40
```

An object is **gray** when it has neither white nor black bits set. This is a clever encoding: gray is the absence of both white and black.

## The Invariant — Black Never Turns White

The fundamental invariant of incremental GC:

> **A black object never points to a white object.**

### Why This Matters

If the invariant holds, then:
- All black objects are reachable (they were marked from roots)
- No black object points to a white object
- Therefore, white objects are unreachable from any root
- The GC can safely collect all white objects

If the invariant is violated:
- A black object points to a white object
- The white object is reachable (through the black object)
- But the GC thinks it's unreachable (it's still white)
- **The GC collects a reachable object → crash**

### How the Invariant Can Break

During the propagate phase, the GC is turning gray objects black. Meanwhile, your Lua code is modifying objects:

```lua
local A = {}      -- A is black (already scanned)
local B = {}      -- B is white (not yet reached)

A.field = B       -- BLACK object A now points to WHITE object B!
                  -- INVARIANT VIOLATED!
```

If the GC finishes marking without noticing this new reference, B will be collected while still reachable through A.

### The Repair: Write Barriers

Write barriers detect and repair invariant violations. When a black object gets a new reference to a white object, the barrier fires and restores the invariant.

## The GC State Machine — Six Phases

LuaJIT's GC runs as a state machine with six phases:

```
 ┌───────────┐    mark roots    ┌─────────────┐    scan all gray    ┌───────────┐
 │ GCSpause  │────────────────▶│ GCSpropagate│────────────────────▶│ GCSatomic │
 │           │                 │             │                     │           │
 └───────────┘                 └─────────────┘                     └─────┬─────┘
      ▲                                                                │
      │                                                                │ atomic
      │                                                                ▼
      │                                                           ┌───────────┐
      │                                                           │GCSsweep-  │
      │                                                           │string     │
      │                                                           └─────┬─────┘
      │                                                                 │
      │                                                                 ▼
      │                                                           ┌───────────┐
      │                                                           │ GCSsweep  │
      │                                                           └─────┬─────┘
      │                                                                 │
      │                                                                 ▼
      │                                                           ┌───────────┐
      │                                                           │GCSfinalize│
      │                                                           └─────┬─────┘
      │                                                                 │
      └─────────────────────────────────────────────────────────────────┘
                                                                    done
```

### Phase 1: GCSpause

The cycle starts. `gc_mark_start()` marks all GC roots:
- Main thread
- Environment table
- VM thread
- Registry
- `gcroot[]` array (metamethod names, basemt, I/O, FFI)

Then transitions to GCSpropagate.

### Phase 2: GCSpropagate

The incremental marking phase. `propagatemark()` pops one gray object from the gray list, traverses its children (marking them gray), and turns the object black.

Different traversal for each object type:
- **Tables**: Check `__mode` for weak keys/values, mark array + hash parts
- **Functions**: Mark env, prototype, upvalues
- **Prototypes**: Mark collectable constants, chunkname
- **Threads**: Mark stack slots, added to grayagain (never black)
- **Traces**: Mark IR constants, linked traces, start prototype
- **Userdata**: Immediately marked black (never gray), marks metatable/env
- **Closed upvalues**: Marked black immediately

This phase runs incrementally — a few objects per `lj_gc_step()` call.

### Phase 3: GCSatomic

The atomic phase — **cannot be interrupted**. When the gray list is empty:

1. Re-mark open upvalues (thread may be dead)
2. Propagate leftovers
3. Process `grayagain` list (threads, weak tables)
4. Mark running thread, current trace, GC roots again
5. `lj_gc_separateudata()` — move userdata with `__gc` to `mmudata` list
6. `gc_clearweak()` — clear collected entries from weak tables
7. **Flip current white color** — prepare for next cycle

The atomic phase is short (bounded number of objects) but must not be interrupted.

### Phase 4: GCSsweepstring

Sweep the string interning table chain by chain. Dead strings are freed; alive strings are flipped to the current white color.

### Phase 5: GCSsweep

Sweep all GC objects. Dead objects are freed via `gc_freefunc[]` dispatch table. Alive objects are flipped to the current white color.

### Phase 6: GCSfinalize

Call `__gc` finalizers for userdata/cdata from the `mmudata` list. Finalizers run via `lj_vm_pcall` (protected call). CData finalizers use a separate `GCROOT_FFI_FIN` table.

## Write Barriers — Detecting Violations

Write barriers are the mechanism that maintains the black-never-points-to-white invariant. LuaJIT has three types:

### Forward Barrier (`lj_gc_barrierf`)

For non-table objects. When a black object gets a new reference to a white object:

```c
void lj_gc_barrierf(global_State *g, GCobj *o, GCobj *v) {
  if (isblack(o) && iswhite(v)) {
    /* Invariant violated! Repair: */
    if (o->gch.gct == ~LJ_TTAB) {
      /* Tables use backward barrier */
      lj_gc_barrierback(g, gco2tab(o));
    } else {
      /* Other objects: mark the white value */
      reallymarkobject(g, v);
    }
  }
}
```

The forward barrier marks the white value (moving the frontier forward). This is correct but can be expensive if done frequently.

### Backward Barrier (`lj_gc_barrierback`)

For tables. Instead of marking the value, it moves the table back to gray:

```c
void lj_gc_barrierback(global_State *g, GCtab *t) {
  /* Turn black back to gray */
  t->gch.marked &= ~(uint8_t)LJ_GC_BLACK;
  /* Add to grayagain list for re-scanning */
  linkgray(g, &t->gch);
}
```

The table will be re-scanned during the next propagate phase. This is cheaper because:
- Re-graying is O(1) per write
- Re-scanning happens once per GC cycle
- Amortized cost is lower than marking on every write

### Upvalue Barrier (`lj_gc_barrieruv`)

Specialized for closed upvalues. When an upvalue is closed (its variable goes out of scope), the barrier ensures the closed value doesn't point to a collected object.

## Why Backward Barriers for Tables?

Tables are the most frequently mutated objects in Lua. Using forward barriers would require marking the value on every table assignment — expensive when you're doing millions of table writes.

```
 Forward barrier (expensive):          Backward barrier (cheap):
 ┌──────────┐                         ┌──────────┐
 │  A       │                         │  A       │
 │ (black)  │───field──────▶│  B   │  │ (gray)   │───field──────▶│  B   │
 └──────────┘   mark B      │(white)│  └──────────┘   no mark    │(white)│
                every write  └──────┘  re-scan A     └──────┘
                                           later
```

**Forward barrier cost**: O(1) per write, but the constant factor is high (must traverse and mark the value's children).

**Backward barrier cost**: O(1) per write (just flip a bit and link to grayagain), plus O(children) once per GC cycle when re-scanning.

For tables with many writes, backward barriers are significantly cheaper. Standard Lua uses forward barriers; LuaJIT's choice is one of its performance secrets.

## Incremental Stepping — Keeping Pauses Short

LuaJIT's GC doesn't run all at once. It runs incrementally, interleaved with your code.

### The Stepping Mechanism

```c
void lj_gc_step(jit_State *J) {
  MSize steps = (GCSTEPSIZE * J->gc.stepmul) >> 8;
  gc->debt -= steps;
  while (gc->debt > 0 && lj_gc_step(J->g)) {
    /* Keep stepping until debt is paid or phase changes */
  }
}
```

`lj_gc_step()` is called from `lj_gc_check()` whenever `gc.total >= gc.threshold`. It drives the collector forward by a small amount.

### Debt and Threshold

- **Debt**: `gc.total - gc.threshold` — how much memory is "over budget"
- **Threshold**: recalculated after each cycle as `(estimate / 100) * pause`
- **Step size**: `GCSTEPSIZE * stepmul / 256` units per call

```
 Memory
  ▲
  │    ┌───┐     ┌───┐
  │    │   │     │   │
  │────┤   ├─────┤   ├──── threshold
  │    │   │     │   │
  │    └───┘     └───┘
  │    debt      debt paid
  │    accumulates  incrementally
  └──────────────────────────────────▶ Time
```

### Tuning

```lua
-- Set pause time (default 100 = 100% of estimate)
collectgarbage("setpause", 200)  -- wait longer between cycles

-- Set step multiplier (default 100 = 100% of GCSTEPSIZE)
collectgarbage("setstepmul", 200) -- collect faster per step
```

Higher `pause` = longer between cycles, more memory used. Higher `stepmul` = faster collection, more CPU time spent in GC.

## Weak Tables and Finalizers

### Weak Tables

Tables with a `__mode` metamethod containing 'k' (weak keys) and/or 'v' (weak values):

```lua
local t = {}
setmetatable(t, {__mode = "kv"})  -- weak keys and values
```

Weak tables are handled in the atomic phase:
1. During propagation, weak tables are added to the `weak` list
2. In `gc_clearweak()`, slots where keys/values are about to be collected are cleared
3. Strings are never weak references — they're marked instead (cheaper than clearing)

### Finalizers

Userdata with a `__gc` metamethod are moved to the `mmudata` list during the atomic phase. In GCSfinalize, their finalizers are called via `lj_vm_pcall` (protected call).

Finalizers can resurrect objects — if a finalizer stores the object somewhere, it becomes reachable again. LuaJIT handles this correctly.

## Dead Keys — A JIT-Friendly Design Choice

Unlike standard Lua 5.1, LuaJIT **does not destroy dead keys** in tables. When a value in a table is set to nil, the key remains in the hash table.

### Why?

The JIT compiler specializes table access based on key patterns. The `HREFK` instruction (hash reference with known key) assumes that if a key exists, its hash slot is stable. Destroying dead keys would invalidate this assumption.

```lua
-- LuaJIT can specialize this:
t.foo = 1
print(t.foo)  -- HREFK: knows "foo" is at a specific slot

t.foo = nil   -- Standard Lua: removes "foo" from hash
              -- LuaJIT: keeps "foo" in hash (dead key)
```

### The Tradeoff

- **Standard Lua**: Destroys dead keys → less memory, but hash slots unstable
- **LuaJIT**: Keeps dead keys → slightly more memory, but hash slots stable → faster JIT code

For most applications, the memory overhead is negligible compared to the performance gain from stable hash slots.

## Frequently Asked Questions

### Why two white colors?

To distinguish objects that survived the previous cycle from newly allocated objects. After each GC cycle, the current white flips. Objects that were white in the previous cycle are now in the "other" white — they'll be collected in the next cycle if still unreachable. This avoids needing to clear marks on all surviving objects.

### What happens if a write barrier is omitted?

The GC may collect a reachable object. If a black object points to a white object that the GC doesn't know about, the white object will be freed. Any subsequent access to it is a use-after-free → crash or corruption.

### Can the GC run out of memory during incremental collection?

Yes. If the allocation rate exceeds the collection rate, memory usage grows without bound. The GC will eventually enter a "panic" mode where it runs more aggressively. Tuning `setpause` and `setstepmul` can help.

### How do I tune the GC?

```lua
collectgarbage("setpause", 200)   -- 200% of estimate (wait longer)
collectgarbage("setstepmul", 400) -- 400% of GCSTEPSIZE (collect faster)
```

Higher pause = less frequent cycles, more memory. Higher stepmul = faster collection, more CPU.

### Why are strings never weak?

Strings are interned — identical strings share the same object. If a string key in a weak table were collected, all references to that string would become invalid. Instead, LuaJIT marks strings during GC (never collects them as weak references), which is cheaper than clearing slots.

## Sources

- Mike Pall, LuaJIT source code (`src/lj_gc.c`, `src/lj_gc.h`, `src/lj_obj.h`), [LuaJIT GitHub](https://github.com/LuaJIT/LuaJIT)
- Mike Pall, "LuaJIT 2.1 GC documentation", [luajit.org](https://luajit.org)
- Dijkstra, E.W., "On-the-fly garbage collection: an exercise in cooperation" (1978) — tri-color marking
- Boehm, H., "Garbage Collection in an Uncooperative Environment" (1988) — incremental GC
