# B-07: Ghost Ref — Grade Sheet

**Category:** `ASYNC_ORDERING` | **Difficulty:** Medium | **Files:** 4

**Ground truth:** `PluginManager.buildRegistry()` uses `forEach(async callback)` — `forEach` discards the returned Promise, so `buildRegistry` resolves while the registry is still empty. Root cause file: `PluginManager.ts` L13.

**Proximate fixation trap:** Reporter blames `EventDispatcher` because that's where events are silently dropped — the `No handler registered` warning is the first visible signal. The dispatcher looks suspicious.

---

## Unravel — Gemini 2.5 Flash + AST (hypothesis tree)

| Axis | Score (0-2) | Notes |
|------|-------------|-------|
| RCA  | **2** | Correct file (`PluginManager.ts`), correct line (L13), correct mechanism — `forEach` with async callback silently discards Promises. AST even surfaced `forEach(async) — Promises silently discarded` as a direct signal. |
| PFR  | **2** | H2 ("Stale reference to PluginManager") eliminated with `AppBootstrapper.ts L19` — same object instance, no reassignment. H3 ("Event name mismatch") eliminated with `AuditPlugin.ts L15` showing matching string literals. Both proximate traps disposed cleanly. |
| CFR  | **2** | Full chain: `AppBootstrapper` → `buildRegistry` (bug point: forEach fires promises, resolves prematurely) → returns to `AppBootstrapper` with empty registry → `EventDispatcher.dispatch` → `getHandler` → undefined → "No handler" warning. 5-node chain including the premature-resolve as the explicit bug point. |
| **Total** | **6/6** | Confidence: 0.95 ✅ |

**Fix:** `Promise.all(plugins.map(async ...))` — correct and identical to Claude's fix.

**Verifier fix this run:** `this.registry` and `this.registrationLog` false positives were caused by `astRaw.mutations` being **empty** for this codebase (no top-level variable mutations detected), making `knownVars = {}`. Every claim failed by definition. Fixed `orchestrate.js` to skip Check 4 entirely when `mutations` is empty.

---

## Claude Sonnet 4.6

| Axis | Score (0-2) | Notes |
|------|-------------|-------|
| RCA  | **2** | Correct: `PluginManager.ts L17`, `forEach(async)` mechanism, same root cause. |
| PFR  | **2** | Explicitly states "EventDispatcher is entirely innocent" and explains why — same object reference (not stale), synchronous lookup is correct. The registry is empty because of the upstream async gap, not because of the dispatcher. |
| CFR  | **2** | Full chain traced with timing detail: `forEach` fires callbacks → returns `undefined` → `buildRegistry` Promise resolves → 5ms later promises settle and populate registry → but `AppBootstrapper` already moved on. |
| **Total** | **6/6** | Claude's fix uses `Promise.all(plugins.map(async...))` — same as Unravel |

**Notable:** Both arrived at `Promise.all(map)` over `for...of`. Claude explicitly noted that `for...of` with `await` is also valid (sequential) — a more complete explanation.

---

## Summary

| | Unravel | Claude |
|-|---------|--------|
| RCA | ✅ 2/2 | ✅ 2/2 |
| PFR | ✅ 2/2 | ✅ 2/2 |
| CFR | ✅ 2/2 | ✅ 2/2 |
| **Total** | **6/6** | **6/6** |

---

## Running Totals (B-01 to B-07)

| Bug | Difficulty | Unravel | Claude | Delta |
|-----|-----------|---------|--------|-------|
| B-01 | Easy | 6/6 | 5/6 | +1 |
| B-02 | Hard | 6/6 | 5/6 | +1 |
| B-03 | Medium | 6/6 | 5/6 | +1 |
| B-04 | Hard | 6/6 | 5/6 | +1 |
| B-05 | Medium | 5/6 | 5/6 | 0 |
| B-06 | Easy | 6/6 | 5/6 | +1 |
| B-07 | Medium | 6/6 | 6/6 | 0 |
| **Total** | | **41/42** | **36/42** | **+5** |
