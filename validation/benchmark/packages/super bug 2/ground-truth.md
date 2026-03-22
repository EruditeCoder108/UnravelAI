# Ground Truth — "The Phantom Sentinel"

## Category
RACE_CONDITION + STATE_MUTATION (cross-module object reference divergence)

## Proximate trap (planted)
`sync-coordinator.js::fetchWindowSync()` — the async gap in the rotation sequence.
Correct engineers eliminate this after establishing it causes only a TRANSIENT pass-through
during the gap, not the PERMANENT bypass observed.

## Secondary trap (planted)
`policy-engine.js` 30-second TTL cache — a stale policy cache would affect the LIMIT value,
not the COUNT value. Even with a stale (lower) limit, the count is always 0 after rotation,
so all checks pass. Eliminating this doesn't change the symptom.

## Root cause file
`hot-path-cache.js` — lines 68–80 (constructor + module-level instantiation)
`window-manager.js` — lines 81–83 (clearForRotation → await → resetWindow sequence)

## Root cause mechanism (exact)

**Step 1: Module initialisation**
```
// hot-path-cache.js:L78
const _cache = new HotPathCache(_counters);
```
`_counters` evaluates to Map A (the current Map object in counter-store).
`new HotPathCache(_counters)` passes Map A as an argument.
`this._map = counterMap` stores the Map A reference inside the class instance.

**Step 2: Window rotation (window-manager.js)**
```
L81: clearForRotation()            → _cache._map.clear()  Map A = {}
L82: await fetchWindowSync(prevId) → async gap ~20-50 ms
L83: resetWindow(newId)            → _counters = new Map()  Map B created
```
After L83:
- `counter-store::_counters` → Map B (live binding updated)
- `hot-path-cache::_cache._map` → Map A (constructor-captured reference, NOT updated)

**Step 3: Post-rotation (permanent)**
- `incrementCount()` writes to `_counters` → Map B ✓
- `checkHotPath()` reads via `_cache.lookup()` → `_cache._map` → Map A (always empty) ✗
- Every rate check returns `count = 0, allowed = true`
- Rate limiting permanently disabled

## Minimal fix
In `hot-path-cache.js`, the `HotPathCache` class must not store a fixed Map reference.
Instead, it should read through a getter that always accesses the live binding:

```js
// OPTION A: Remove the class wrapper, read _counters directly
export function checkHotPath(clientId, limit) {
    const key   = `${clientId}:${getActiveWindowId()}`;
    const entry = _counters.get(key);   // reads live binding
    ...
}

// OPTION B: Store a reference to the module, not the Map
class HotPathCache {
    constructor(getCounterMap) {
        this._getMap = getCounterMap;   // store a function, not a value
    }
    lookup(key) { return this._getMap().get(key); }
    clear()     { this._getMap().clear(); }
}
const _cache = new HotPathCache(() => _counters);
```

## New detector required: `detectConstructorCapturedReference()`

This bug class requires a detector that Unravel does not yet have.

The pattern: `new SomeClass(importedBinding)` at module scope,
where the constructor stores the argument as `this.field = arg`,
AND the imported binding is a `let` (reassignable) in the exporting module.

Detection algorithm (3-pass):
1. Find all `new Expression(args)` calls at module scope.
2. For each argument, trace via `resolveSymbolOrigins()` to find if it is:
   a. A live binding import of a `let` variable from another module.
3. Inspect the constructor body: does it assign `this.X = arg` (stores the value)?
4. Check the exporting module's mutation chains: is that `let` variable reassigned
   (not just mutated in place)?

If all four hold: emit structured annotation:
```
CONSTRUCTOR CAPTURE — LIVE BINDING REFERENCE COPY:
  hot-path-cache.js:L78: new HotPathCache(_counters)
  Argument _counters: live binding → counter-store.js::_counters (let, reassignable)
  Constructor stores: this._map = counterMap  (value capture, not live ref)
  counter-store.js::resetWindow() reassigns _counters = new Map() [L?]
  
  After resetWindow():
    counter-store::_counters → NEW Map (Map B)
    hot-path-cache::_cache._map → OLD Map (Map A, cleared by clearForRotation)
    
  All reads via _cache.lookup() → Map A (empty, abandoned)
  All writes via incrementCount() → Map B (never read by rate checks)
  
  RATE LIMIT BYPASS: checkHotPath() always returns count=0 post-rotation
```

## Why Claude Sonnet 4.6 fails

Structured prompt gives Claude the 3-hypothesis instruction + exact loc requirement.
Claude generates:
- H1: async gap in rotateWindow() lets requests slip during the ~30ms yield ← PARTIALLY RIGHT
- H2: policy cache returning stale limits ← ELIMINATED (limit doesn't matter if count=0)
- H3: sync-coordinator desync causing missed counter updates ← ELIMINATED (peers not configured)

For H1, Claude reasons: "clearForRotation() clears the cache, then resetWindow() advances the
window. During the await, cleared cache + no reset means requests pass." Claude proposes fix:
"Move clearForRotation() to AFTER resetWindow(), or perform them atomically."

This is the WRONG fix. The bug is not timing — it's permanent object reference divergence.
Even if clearForRotation() and resetWindow() were atomic, _cache._map would STILL reference
the old Map after resetWindow(), because the constructor captured the reference at module init.

The mechanism Claude misses: `new HotPathCache(_counters)` at module load time passes
the CURRENT MAP OBJECT to the constructor, which stores it as `this._map`. When _counters
is later reassigned to a new Map, `_cache._map` does not update. Claude needs to
simultaneously:
1. Know that `new HotPathCache(_counters)` captures Map A (not a live binding)
2. Know that `resetWindow()` does REASSIGNMENT (creates Map B), not in-place mutation
3. Cross-reference that _cache reads through `this._map` (Map A) in checkHotPath
4. Trace that incrementCount() writes to _counters (Map B after rotation)
5. Conclude that the TWO write/read paths diverge permanently after the first rotation

Even with structured prompting, Claude typically:
- Reads HotPathCache correctly (stores `this._map = counterMap`)
- Reads resetWindow() correctly (_counters = new Map())
- FAILS to cross-reference: "_cache._map is Map A, which is no longer _counters after L83"
  The implicit assumption: "Map A and _counters are the same thing" persists even after
  reading resetWindow(). The reassignment breaks that equality silently.

The decisive signal Unravel provides is the `detectConstructorCapturedReference()` output:
a formally stated structural fact that "_cache._map is not _counters after resetWindow()".
Without this explicit ground-truth injection, the LLM's probabilistic inference over
8 files misses the divergence with ~70% probability (Run 1 estimate).

## UDB classification
- **Tier**: Hard (multi-file, structural, requires new detector)
- **Category**: RACE_CONDITION + STATE_MUTATION
- **New AST capability required**: `detectConstructorCapturedReference()`
- **Existing detectors that contribute**: `expandMutationChains()`, `resolveSymbolOrigins()`,
  `detectGlobalMutationBeforeAwait()` (catches the async gap separately)
