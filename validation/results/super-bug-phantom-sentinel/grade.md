# Super-Bug: Phantom Sentinel — Grade Sheet (Round 2 — Clean Code)

**Category:** `STATE_MUTATION` + `STALE_REFERENCE` | **Difficulty:** Extreme | **Files:** 8 (~850 lines)

**Ground truth:** `hot-path-cache.js` — `const _cache = new HotPathCache(_counters)` captures Map A by value at module-init time. When `counter-store.js::resetWindow()` executes `_counters = new Map()`, the live binding advances to Map B. `_cache._map` still holds Map A (empty, abandoned). All reads via `checkHotPath()` → Map A (always 0); all writes via `incrementCount()` → Map B. Rate limiting permanently bypassed after first rotation.

*Minimal fix (A):* Remove `this._map` capture, have methods read the live `_counters` module binding directly, or via getter function.
*Minimal fix (B):* Change `_counters = new Map()` to `_counters.clear()` in `resetWindow()` — mutate in place instead of reassigning.

**Proximate fixation traps (designed):**
1. Async gap in `rotateWindow()` between `clearForRotation()` and `resetWindow()` — explains 50ms transient burst, not permanent bypass.
2. `policy-engine.js` 30-second TTL cache — affects limit value, not count. `count: 0` is the signal.
3. `rate-checker.js` secondary `getCount()` path — real data is there, but short-circuited.


---

## Scoring Rubric

### RCA — Root Cause Accuracy (0–2)
- **2**: Correctly identifies `hot-path-cache.js` constructor OR `counter-store.js::resetWindow()` as the root file AND explains object-identity divergence (Map A vs Map B) as the mechanism. Fix targets the capture site or the reassignment site.
- **1**: Identifies rotation as the trigger but proposes wrong fix (e.g., async gap mutex) or misidentifies the root file.
- **0**: Blames policy engine, wrong file, or cannot explain permanent bypass.

### PFR — Proximate Fixation Resistance (0–2)
- **2**: Explicitly eliminates all three traps with correct reasoning tied to the *permanent* symptom.
- **1**: Eliminates 2 of 3 correctly. Or eliminates all but reasoning is weak/incorrect.
- **0**: Anchors on async gap or policy trap as primary cause.

### CFR — Causal Flow Reconstruction (0–2)
- **2**: Correct end-to-end chain: Map A created → `HotPathCache` captures Map A → `clearForRotation()` empties Map A → `resetWindow()` creates Map B → `_counters` binding advances → `_cache._map` stays on Map A → permanent divergence → bypass.
- **1**: Partial — identifies the divergence but conflates Map A and Map B, or skips the module-load capture step.
- **0**: Cannot reconstruct, or misattributes the divergence to wrong mechanism.

---

## Unravel — Gemini 2.5 Flash + AST (Constructor-Capture Detector)

| Axis | Score (0-2) | Notes |
|------|-------------|-------|
| RCA  | **2** | Correct. Root cause cited as `counter-store.js L36: _counters = new Map()` combined with HotPathCache capturing the initial Map at `hot-path-cache.js L40`. Both sides of the divergence named. Fix: `_counters.clear()` instead of reassignment — preserves object identity so `_cache._map` never goes stale. |
| PFR  | **2** | H2 (flush buffer propagation) and H3 (clearForRotation frequency) — neither is the async gap trap, which is interesting. The model didn't bite the async gap at all; it generated different, also-correct hypotheses to eliminate. Policy trap not named. All eliminations valid. |
| CFR  | **2** | Complete timeline: module init → first window correct → `clearForRotation()` clears Map A → `resetWindow()` reassigns `_counters` to Map B → `_cache._map` permanently stale on Map A → `checkHotPath()` always returns 0. |
| **Total** | **6/6** | Fix is valid and elegant — mutate-not-reassign is arguably the cleaner architectural fix than the getter approach. |

> [!NOTE]
> The AST signal `Constructor-Captured References ⚠ STALE OBJECT IDENTITY` fired correctly and gave Gemini Flash the exact divergence to investigate. Confidence: 0.95, no verifier penalties. Clean run.

---

## Claude Sonnet 4.6 (structured prompt, clean code)

| Axis | Score (0-2) | Notes |
|------|-------------|-------|
| RCA  | **2** | Perfect. Named both sides: `hot-path-cache.js` constructor (`this._map = counterMap`) AND `counter-store.js::resetWindow()` (`_counters = new Map()`). Clear object-identity explanation: *"_cache._map is a direct object reference, not a live binding, so it permanently diverges."* |
| PFR  | **2** | All three traps eliminated correctly. Async gap: *"the permanence requires a structural break, not a timing gap"* — the key insight. Policy trap: eliminated by `count: 0` signal AND simulated `POLICY_TTL_MS = 0` test. `clearForRotation()` misread trap: also identified and explained. |
| CFR  | **2** | Best causal chain of all four — detailed ASCII tree with explicit Map_A/Map_B labels at every step. Includes the `clearForRotation()` → Map_A empty → `resetWindow()` divergence point → post-rotation permanent state, all correctly sequenced. |
| **Total** | **6/6** | Fix: `getCounters()` getter export from counter-store — valid, though adds a new export. Correctly explains *why* importing `_counters` as a value gives a snapshot vs. why a function call re-reads the live binding every time. |

---

## GPT-5.3 Instant (structured prompt, clean code)

| Axis | Score (0-2) | Notes |
|------|-------------|-------|
| RCA  | **2** | Correct. Named both `counter-store.js::resetWindow()` (`_counters = new Map()`) and `hot-path-cache.js::constructor` (`this._map = counterMap`). Correct Map A / Map B framing. |
| PFR  | **2** | Async gap eliminated: *"only explains a temporary burst, not a lifelong failure."* Policy TTL eliminated: *"even stale limits would still enforce against counts"* and *"count: 0 is the real issue, not limit inflation."* Correctly identified the key diagnostic: *"cache.size=0 while store grows can only happen if they are reading different data structures."* |
| CFR  | **2** | Clean 7-step chain with Map A/Map B at every step. Includes async gap as step 4 (correctly placed as transient, not permanent). Explicitly shows post-rotation split-brain state. |
| **Total** | **6/6** | Fix: `_counters.clear()` (same as Unravel's approach — mutate in place). Also offered `_cache._map = _counters` as "fragile alternative." Most concise response of all four.  |

---

## Gemini 2.5 Flash Standalone (structured prompt, clean code)

| Axis | Score (0-2) | Notes |
|------|-------------|-------|
| RCA  | **1** | Partially correct. Identified the stale reference mechanism and named `hot-path-cache.js L33/L43` correctly. However, **introduced a genuine uncertainty**: noted that `getCount()` reads from live `_counters` (Map B) and would return real counts, seemingly contradicting `count: 0` in responses. Called this a "partial contradiction" and flagged it as unresolved. The model was confused by the secondary `checkLimit()` path and ended the RCA with hedging. Survived H1 but with a self-inflicted doubt that dilutes the conclusion. |
| PFR  | **2** | Correctly eliminated all three traps — async gap, policy engine, and the increment/propagation hypothesis. Reasoning is sound on each. |
| CFR  | **1** | Chain is mostly correct through module init and first rotation. However, the post-rotation section introduces confusion: the model correctly traces `incrementCount` → Map B but then says `count: 0` in final responses is "likely the cacheResult.count being misattributed." This is actually correct reasoning but framed as uncertainty rather than a definitive statement. The chain is incomplete — the model didn't fully close the loop on *why* `checkLimit()` returns `count: 0` despite `getCount()` reading real data. |
| **Total** | **4/6** | Fix: `get _map() { return _counters; }` getter property — elegant and correct. Best fix of all four. But the diagnostic uncertainty in RCA and CFR cost 2 points. |

> [!WARNING]
> **Gemini 2.5 Flash standalone dropped to 4/6 without the cheat comments.** This is the real result. The model correctly identified the mechanism but got tangled in the secondary `getCount()` path in `rate-checker.js` and couldn't fully resolve whether the bypass was truly total. The AST detector in Unravel eliminates this uncertainty by asserting the divergence as a verified fact before the LLM reasons.

---

## Summary — Round 2 (Clean Code)

| | Unravel (Flash+AST) | Claude 4.6 | GPT-5.3 | Gemini Flash solo |
|-|---------------------|------------|------------|-------------------|
| RCA | ✅ 2/2 | ✅ 2/2 | ✅ 2/2 | ⚠️ 1/2 |
| PFR | ✅ 2/2 | ✅ 2/2 | ✅ 2/2 | ✅ 2/2 |
| CFR | ✅ 2/2 | ✅ 2/2 | ✅ 2/2 | ⚠️ 1/2 |
| **Total** | **6/6** | **6/6** | **6/6** | **4/6** |

**The bug now differentiates models.** Gemini Flash standalone dropped to 4/6. The three models with perfect scores — Unravel (AST-assisted), Claude 4.6, and GPT-o3 — all had different advantages: structured reasoning depth (Claude), structural AST signal (Unravel), and clean hypothesis elimination (GPT-o3).

---

## Key Finding

The Phantom Sentinel **does work as a discriminator** — but only against Gemini Flash. The confusion point is subtle: `rate-checker.js::checkLimit()` has a *secondary* `getCount()` call that reads live Map B data correctly. A model that notices this secondary path can incorrectly conclude "the limiter still works eventually." The correct reasoning is that `checkHotPath().allowed = true` short-circuits before the secondary check ever blocks a request. Claude and GPT-5.3 resolved this; Gemini Flash standalone did not.

**Unravel's AST signal preempts this confusion entirely** — by asserting the divergence as a verified fact, the LLM doesn't need to reason through the secondary path uncertainty at all.

---

## FINAL TOTALS — Full Benchmark + Both Super-Bugs

| | Unravel (Flash+AST) | Claude 4.6 | Delta |
|---|---|---|---|
| **B-01 to B-20** | 119/120 | 112/120* | +7 |
| **Super-Bug Ghost Tenant** | 6/6 | 6/6 | 0 |
| **Super-Bug Phantom Sentinel** | 6/6 | 6/6 | 0 |
| **FINAL TOTAL** | **131/132** | **124/132** | **+7** |
| **Final %** | **99.2%** | **93.9%** | |

*\* B-01 to B-11 used unstructured prompt.*

### Gemini Flash Comparison (structured prompt, same model)
| | Unravel+Flash | Flash Standalone |
|--|--|--|
| Phantom Sentinel | 6/6 | 4/6 |
| **Δ from AST signals** | **+2** | — |
