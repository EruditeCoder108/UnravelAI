## 1. Hypothesis Tree

### Hypothesis A — `HotPathCache` holds a stale `Map` reference after `resetWindow()` replaces `_counters`

**Reasoning:** `counter-store.js` exports `_counters` as a live binding at module init time. `hot-path-cache.js` imports it and immediately passes it into `new HotPathCache(_counters)`, storing it as `this._map`. When `resetWindow()` runs, it does `_counters = new Map()` — this reassigns the **module-level variable** to a brand-new `Map`, but `_cache._map` still points to the **old** `Map` object. After rotation, `incrementCount()` writes into the new `_counters` Map, while `checkHotPath()` reads from `_cache._map` which is the old, now-orphaned Map. The old Map was cleared by `clearForRotation()` before rotation and is never written to again, so it stays permanently empty.

This explains **both** symptoms:
- `cache.size === 0`: `_cache._map` is the orphaned old Map, which was `.clear()`-ed and never written to again.
- `store.entryCount` grows: writes go to the new `_counters`, which the cache never sees.
- **Permanently broken**: not a timing window — the reference divergence is structural and irreversible until process restart.

**Verdict: Survives. Strong candidate.**

---

### Hypothesis B — `clearForRotation()` calls `_cache.clear()` which wipes counters during the async gap between `clearForRotation()` and `resetWindow()`

**Reasoning (the lead engineer's theory):** In `window-manager.js::rotateWindow()`, `clearForRotation()` is called, then there's a 20–50ms async gap (`fetchWindowSync`), then `resetWindow()`. Requests arriving in that gap get `count: 0` and pass. But this only explains a **transient** burst of passing requests — once `resetWindow()` completes and new requests increment into the new `_counters`, `checkHotPath` should start seeing the accumulating counts again.

This does **not** explain the permanent bypass. After the gap closes, if `_cache._map` and `_counters` were the same object, counts would accumulate and enforcement would resume. The permanence requires a structural break, not a timing gap.

**Verdict: Eliminated. Explains the burst; cannot explain permanence.**

---

### Hypothesis C — `policy-engine.js` TTL cache returns a stale, artificially high `effectiveLimit` post-rotation

**Reasoning (the junior dev's theory):** `evaluatePolicy` caches results for 30 seconds. If a stale policy somehow returned `limit: Infinity` or a very large number, `checkHotPath` would always compute `count < limit` as `true`. But the team already tested `POLICY_TTL_MS = 0` with no change. Furthermore, `count` in responses shows `0` — not a high limit. If this were the cause, `count` would still be non-zero and growing; the limit would just be too large to trigger a block.

The `count: 0` in all responses definitively rules this out — the problem is that counts are invisible to the checker, not that limits are too permissive.

**Verdict: Eliminated. Disproved by `count: 0` in responses and the team's own `POLICY_TTL_MS = 0` test.**

---

## 2. Root Cause

**File:** `hot-path-cache.js`, the constructor call `new HotPathCache(_counters)` combined with `counter-store.js` line `_counters = new Map()` inside `resetWindow()`.

At module load, `_cache` captures the initial `_counters` Map object as `this._map`. When `resetWindow()` executes `_counters = new Map()`, it rebinds the module variable to a fresh Map — but `_cache._map` is a direct object reference, not a live binding, so it permanently diverges. All subsequent reads (`checkHotPath`) query the orphaned old Map; all subsequent writes (`incrementCount`) target the new Map. The two will never converge again.

---

## 3. Causal Chain

```
MODULE LOAD
│
├─ counter-store.js exports:   _counters  →  Map_A  (object in memory)
│
├─ hot-path-cache.js imports _counters (value: Map_A)
│   └─ new HotPathCache(Map_A)
│       └─ this._map = Map_A          ← _cache._map now points to Map_A
│
│  First window (window 1): everything works
│  ─────────────────────────────────────────
│  incrementCount()  writes to  _counters  → Map_A  ✓
│  _cache.lookup()   reads from _cache._map → Map_A  ✓  (same object)
│
FIRST rotateWindow() CALL
│
├─ 1. clearForRotation()
│       └─ _cache.clear() → Map_A.clear()   ← Map_A emptied (both refs see empty)
│
├─ 2. await fetchWindowSync()  [20–50ms async gap]
│       └─ any requests here: count=0 in Map_A, pass through (transient burst)
│
├─ 3. resetWindow(newWindowId)  ← THE DIVERGENCE POINT
│       └─ _counters = new Map()   → _counters now points to Map_B (new object)
│           counter-store module variable:  _counters → Map_B
│           _cache._map:                   still → Map_A  ← ORPHANED
│
POST-ROTATION: permanent bypass
│
├─ incrementCount(clientId)
│       └─ writes key into  _counters → Map_B   (store.entryCount grows ✓)
│
├─ checkHotPath(clientId, limit)
│       └─ _cache.lookup(key)
│           └─ reads from _cache._map → Map_A   (empty, cleared, never written)
│               └─ returns count = 0
│                   └─ 0 < limit → allowed: true, always  ✗
│
└─ cache.size === Map_A.size === 0  (confirmed by getDiagnostics().cache.size = 0)
   store.entryCount === Map_B.size > 0  (confirmed by getDiagnostics().store.entryCount growing)
```

---

## 4. Proximate Trap

A less careful engineer will blame the **20–50ms async gap** in `rotateWindow()` between `clearForRotation()` and `resetWindow()` — exactly what the lead engineer suspects. The evidence fits superficially: requests do slip through during that window, `count` is 0 right after `clearForRotation()`, and the rotation logs show a non-trivial duration (34ms).

This is wrong for one decisive reason: **the async gap is bounded**. Once `resetWindow()` completes, if `_cache._map` and `_counters` were the same object, the gap would close and enforcement would resume. A timing race produces a *transient* burst of allowed requests, not a *permanent* bypass. The permanence is the smoking gun that rules out all race-condition theories and points exclusively to a structural reference divergence.

The engineer may also be misled by `clearForRotation()` calling `_cache.clear()` — this looks like it "resets the cache for the new window," when in fact it's the action that leaves `Map_A` permanently empty before the divergence that makes it unreachable.

---

## 5. Minimal Fix

**File:** `hot-path-cache.js`

The fix is to make `_cache._map` a **live indirection** back to `_counters` rather than a frozen reference to the initial Map object. The cleanest approach: instead of passing `_counters` into `HotPathCache` at construction time, have `lookup()` call back into the store for the current Map on every access.

```js
// hot-path-cache.js  — replace the module-level cache construction and lookup

// BEFORE (stale reference captured at import time):
import {
    _counters,          // ← captures Map_A at load time, never updates
    getActiveWindowId,
    incrementCount,
} from './counter-store.js';

const _cache = new HotPathCache(_counters);   // _cache._map === Map_A forever

// ─────────────────────────────────────────────────────────────────────────────

// AFTER (import a getter that always returns the current Map):
import {
    getCounters,        // new export: () => _counters  (returns current binding)
    getActiveWindowId,
    incrementCount,
} from './counter-store.js';

// HotPathCache no longer owns _map; it delegates to the live getter:
lookup(key) {
    const val = getCounters().get(key);   // always reads from the current Map
    if (val !== undefined) { this._hits++;  return val; }
    else                   { this._misses++; return undefined; }
}
```

And in `counter-store.js`, add the one-line export:

```js
// counter-store.js — add alongside the other exports
export function getCounters() { return _counters; }  // always returns current binding
```

**Why this breaks the stale-reference chain:** `_counters` is a module-scoped variable. Importing it as a value (`import { _counters }`) gives you a snapshot of the object reference at load time — a copy of the pointer. Calling a function `getCounters()` re-reads the variable each time, so after `resetWindow()` does `_counters = new Map()`, every subsequent `getCounters()` call returns `Map_B`. The cache and the store now always operate on the same Map regardless of how many rotations have occurred.

______________________________________

