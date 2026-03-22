# Solution — "The Phantom Sentinel"

## Bug classification
`RACE_CONDITION + STATE_MUTATION` — cross-module object reference divergence

---

## Root cause

Two facts, three files, one compound signal.

**Fact 1 — `hot-path-cache.js` (module initialisation)**

```js
const _cache = new HotPathCache(_counters);
```

`_counters` is a live ES module binding imported from `counter-store.js`.
Reading it here evaluates to the current Map object — call it Map A.
`new HotPathCache(Map A)` passes Map A as `counterMap`.
The constructor stores `this._map = counterMap`.
`_cache._map` now holds a direct reference to Map A.

**Fact 2 — `counter-store.js::resetWindow()`**

```js
export function resetWindow(newWindowId) {
    _rotationCount++;
    _activeWindowId = newWindowId;
    _counters = new Map();    // binding reassignment — creates Map B
}
```

This is a **binding reassignment**, not an in-place mutation.
`_counters` (the live binding) now points to Map B.
`_cache._map` still points to Map A.

**After the first `rotateWindow()` call:**

```
counter-store::_counters   →  Map B  (all future writes via incrementCount)
hot-path-cache::_cache._map →  Map A  (empty — cleared by clearForRotation, never refilled)
```

The two references have permanently diverged.

**Runtime consequence:**

- `incrementCount(clientId)` → writes to `_counters` → Map B ✓
- `checkHotPath(clientId, limit)` → reads via `_cache.lookup()` → `_cache._map` → Map A → always `undefined` → count = 0 → `allowed = true`
- Every rate check returns `{ allowed: true, count: 0 }` for the rest of the process lifetime.
- Rate limiting is permanently disabled after the first rotation.

---

## Why the secondary check in `rate-checker.js` doesn't save it

`checkLimit()` contains a secondary path:

```js
const currentCount = getCount(clientId);   // reads live _counters (Map B) — correct
if (currentCount >= effectiveLimit) { ... }
```

This reads Map B and would correctly catch overages — but only when the hot-path check
returned `allowed: true`. Since the hot-path always returns `allowed: true` post-rotation
(count = 0), the secondary check does run on every request. It will block a request
when `currentCount >= effectiveLimit`.

The subtlety: the hot-path's `cacheResult.count = 0` is also what populates the
`remaining` field in successful responses. API consumers see artificially inflated
headroom. And callers that short-circuit on `cacheResult.allowed` (valid since
`fromCache: true`) never reach the secondary check at all for the common case.

---

## Proximate trap — `sync-coordinator.js::fetchWindowSync()`

The rotation sequence in `window-manager.js::rotateWindow()`:

```js
clearForRotation();                          // clears Map A in place
const { newWindowId } = await fetchWindowSync(previousId);  // 20–50 ms async gap
resetWindow(newWindowId);                    // creates Map B
```

The async gap is real and causes a transient issue: requests arriving during the gap
see a cleared cache and pass through. But this is **transient** (only during the ~30ms gap).

The Map divergence introduced by `resetWindow()` is **permanent**.

A fix that makes `clearForRotation()` and `resetWindow()` atomic — or moves `clearForRotation()`
to after `resetWindow()` — closes the transient gap but does not fix the rate bypass.
`_cache._map` still references Map A after `resetWindow()` regardless of ordering,
because the divergence was introduced at module initialisation time, not at rotation time.

---

## Secondary trap — `policy-engine.js` 30-second TTL cache

A stale policy cache could return incorrect `effectiveLimit` values. But a wrong limit
doesn't explain the bypass: with `count = 0` from the hot-path, any non-zero limit
produces `allowed = true`. Disabling the cache entirely (setting `POLICY_TTL_MS = 0`)
changes nothing observable.

---

## Minimal fix

**Option A — remove the class wrapper, read the live binding directly:**

```js
// hot-path-cache.js
export function checkHotPath(clientId, limit) {
    const key   = `${clientId}:${getActiveWindowId()}`;
    const entry = _counters.get(key);   // reads live binding, not a captured reference
    const count = entry?.count ?? 0;
    return { allowed: count < limit, count, remaining: Math.max(0, limit - count) };
}
```

**Option B — store a getter, not a value:**

```js
class HotPathCache {
    constructor(getCounterMap) {
        this._getMap = getCounterMap;   // function reference, not object reference
    }
    lookup(key) { return this._getMap().get(key); }
    clear()     { this._getMap().clear(); }
}

const _cache = new HotPathCache(() => _counters);
```

After `resetWindow()`, `() => _counters` re-evaluates the live binding on every call,
returning Map B. No divergence.

---

## New detector required — `detectConstructorCapturedReference()`

**Pattern:** `new SomeClass(importedLiveBinding)` at module scope, where:
1. The argument is a live import of a `let` variable in another module
2. The constructor stores `this.field = arg` (value copy, not a getter)
3. The exporting module reassigns the binding (not just mutates the object)

**Detection algorithm (3-pass):**

1. Find all `new Expression(args)` at module scope
2. For each argument, trace via `resolveSymbolOrigins()` → is it a live `let` import?
3. Inspect the constructor body → does it assign `this.X = arg`?
4. In the exporting module's mutation chains → is the binding reassigned (`let x = new ...`), not just mutated (`x.set(...)`)?

**Emitted annotation:**

```
CONSTRUCTOR CAPTURE — STALE OBJECT IDENTITY:
  hot-path-cache.js: const _cache = new HotPathCache(_counters)
  _counters: live binding → counter-store.js::_counters (let, reassignable)
  Constructor stores: this._map = counterMap  [VALUE COPY at module init]
  counter-store.js::resetWindow() reassigns _counters = new Map()

  After resetWindow():
    counter-store.js::_counters  → NEW Map (Map B)
    hot-path-cache.js::_cache._map  → OLD Map (Map A — cleared, abandoned)

  Reads via _cache._map see Map A (always empty post-rotation).
  Writes via _counters go to Map B (never read through _cache).
  RATE LIMIT BYPASS: checkHotPath() returns count=0 for all clients post-rotation.
```

---

## UDB classification

| Field             | Value                                           |
|-------------------|-------------------------------------------------|
| Tier              | Hard                                            |
| Category          | `RACE_CONDITION + STATE_MUTATION`               |
| Files involved    | `hot-path-cache.js`, `counter-store.js`, `window-manager.js`, `rate-checker.js` |
| New detector      | `detectConstructorCapturedReference()`          |
| Existing detector | `detectGlobalMutationBeforeAwait()` (fires on the async gap — necessary but not sufficient) |
| Proximate trap    | `sync-coordinator.js::fetchWindowSync()` async gap |
| Secondary trap    | `policy-engine.js` TTL cache                    |
