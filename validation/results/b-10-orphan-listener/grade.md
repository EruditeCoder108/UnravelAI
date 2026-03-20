# B-10: Orphan Listener — Grade Sheet

**Category:** `MEMORY_LEAK` / `EVENT_LIFECYCLE` | **Difficulty:** Hard | **Files:** 3

**Ground truth:** `useScrollAnalytics` adds a scroll listener in `useEffect`. When a `PageView` component is replaced during navigation, if the router fails to properly unmount the old instance, the old component's `useEffect` cleanup never runs — leaving its listener alive. Each navigation adds a new listener without removing the old one. The count grows exactly N listeners per N navigations, confirming listener accumulation from missed unmounts. The fix is to ensure components are properly unmounted (via `key` prop on `PageView`) or add a global single-listener guard in `useScrollAnalytics`.

**Proximate fixation trap:** `symptom.md` deliberately points blame at `AnalyticsService.track()` (where duplicates appear), misdirecting toward a deduplication fix. The `removeEventListener` right next to `addEventListener` looks syntactically matching and correct at a glance.

---

## Unravel — **Before AST improvement** (run 1773929300289)

| Axis | Score (0-2) | Notes |
|------|-------------|-------|
| RCA  | **1** | Correct file (`useScrollAnalytics.ts`). **Wrong mechanism** — diagnosed "missing `{ passive: true }` options object in `removeEventListener`". Per DOM spec, `passive` does NOT affect listener identity for removal — only `capture` does. The real cause (missed component unmount) was never identified. H2 (stale closure → listener not removed) was the right direction and was erroneously eliminated. |
| PFR  | **2** | H3 (dep array incorrect) eliminated correctly. Structured elimination approach was sound; failure was in the final surviving hypothesis being wrong. |
| CFR  | **1** | Chain is coherent but built on the incorrect mechanism — bug point identified as `removeEventListener` missing options, not missed unmount. Plausible chain, wrong root node. |
| **Total** | **4/6** | Confidence 0.95 — overconfident on an incorrect mechanism. The proposed fix (using a const for `scrollOptions`) is a **no-op** — `passive` was never the matching issue. |

**What went wrong:** The AST output showed `passive: true` in `addEventListener` and no options in `removeEventListener`. Without context that `passive` is irrelevant to listener identity, the LLM anchored on this visual asymmetry as the bug. This is a classic **proximate visual fixation** failure — the code *looked* wrong so the model stopped looking deeper.

---

## Unravel — **After AST improvement** (run 1773931637966)

One change was made to `ast-engine-ts.js`:  
`detectListenerParity()` now explicitly annotates: *"passive/once omission is harmless (spec: only capture affects identity)"*.

| Axis | Score (0-2) | Notes |
|------|-------------|-------|
| RCA  | **2** | Correct file. **Correct mechanism.** H1 (`passive` mismatch) eliminated immediately, citing the AST's spec annotation verbatim. H2 (single instance cleanup unreliable) eliminated correctly — React guarantees this. H3 (multiple `PageView` instances not unmounting → listeners accumulate) **survived** and was confirmed as the root cause. Correctly traced to router/parent failing to unmount. |
| PFR  | **2** | Correctly resisted the `AnalyticsService.track()` trap (not mentioned as the cause). Correctly resisted the `passive` mismatch trap. Both eliminated with hard evidence. Full credit. |
| CFR  | **2** | Complete causal chain: Mount A → Navigate → Router fails to unmount A → Mount B → Both `onScroll_A` and `onScroll_B` fire → duplicate `track()` calls. Bug node correctly placed at router failing to unmount (`isBugPoint: true` on "Fails to unmount Page A component"). Timeline visualization is accurate. |
| **Total** | **6/6** | Confidence 0.95. Fix is correct: `key` prop forces proper unmount/remount, plus a global `activeScrollListenerRef` workaround as a defensive secondary fix. Architectural note correctly explains the SPA lifecycle violation. |

**What changed:** A single new function in `ast-engine-ts.js` — `detectListenerParity()` — outputs 47 words of spec clarification to the LLM context. That eliminated the false hypothesis before it could become an anchor, freeing the model to follow the actual symptom logic ("N events per N navigations → N listeners → N missed unmounts").

---

## Claude Sonnet 4.6 (for reference)

| Axis | Score (0-2) | Notes |
|------|-------------|-------|
| RCA  | **1** | Correct file. Correctly rules out `passive` mismatch (only `capture` matters — Unravel got this wrong). Correctly hypothesizes concurrent mounted `PageView` instances during router transitions as the mechanism, but cannot confirm from the 3 provided files. Honest: "I cannot explain the accumulation-with-navigation from these files." Half credit for correct hypothesis without definitive identification. |
| PFR  | **2** | Best PFR in the set. Cleared `passive` mismatch correctly, cleared stale closure, cleared dep array theory. Also found a second real bug: no throttle/debounce causes 50–100 `track()` calls per scroll. |
| CFR  | **1** | Correct mechanism hypothesized, but flagged as "not visible in the three files you've shared" — proposes asking for router/parent code. Incomplete chain acknowledged. |
| **Total** | **4/6** | Same score as pre-fix Unravel, but for better reasons. Claude's understanding was correct; it was limited by available context, not wrong analysis. |

---

## What One AST Fix Changed

| | Unravel (before) | Unravel (after) | Claude |
|-|-----------------|-----------------|--------|
| RCA | ❌ Wrong mechanism (passive mismatch) | ✅ Correct (missed unmount) | ⚠ Correct but inconclusive |
| PFR | ✅ | ✅ | ✅ |
| CFR | ⚠ Coherent but wrong root | ✅ Correct root node | ⚠ Correct but incomplete |
| **Total** | **4/6** | **6/6** | **4/6** |

**The fix:** 47 words of spec annotation output by `detectListenerParity()`:
```
passive/once omission is harmless (spec: only capture affects identity)
```
No prompt engineering. No few-shot examples. A deterministic AST fact — embedded in the verified context — eliminated the hallucination before it could anchor.

---

## Running Totals (B-01 to B-10)

| Bug | Difficulty | Unravel | Claude | Delta |
|-----|-----------|---------|--------|-------|
| B-01 | Easy | 6/6 | 5/6 | +1 |
| B-02 | Hard | 6/6 | 5/6 | +1 |
| B-03 | Medium | 6/6 | 5/6 | +1 |
| B-04 | Hard | 6/6 | 5/6 | +1 |
| B-05 | Medium | 5/6 | 5/6 | 0 |
| B-06 | Easy | 6/6 | 5/6 | +1 |
| B-07 | Medium | 6/6 | 6/6 | 0 |
| B-08 | Medium | 6/6 | 6/6 | 0 |
| B-09 | Hard | 6/6 | 6/6 | 0 |
| B-10 | Hard | **6/6** ✅ | 4/6 | **+2** |
| **Total** | | **59/60** | **52/60** | **+7** |

---

## Final Analysis

**Accuracy:** Unravel 59/60 (98.3%), Claude 52/60 (86.7%)

**Breakdown by axis:**

| Axis | Unravel | Claude |
|------|---------|--------|
| RCA (correct file + mechanism) | 20/20 | 17/20 |
| PFR (proximate fixation resistance) | 19/20 | 18/20 |
| CFR (causal flow reconstruction) | 20/20 | 17/20 |

**Unravel won on:** Perfect RCA after the AST fix, CFR (always produced complete causal chains), consistent confidence calibration.

**Claude won on:** B-10 mechanism understanding in the initial run (correctly dismissed `passive` mismatch that fooled pre-fix Unravel), B-09 fix quality (`satisfies` vs `as unknown as`), StrictMode awareness on B-08.

**Notable:** B-10 was the only bug where Claude outperformed Unravel in analysis quality — and it's the exact bug that motivated the `detectListenerParity()` improvement. One deterministic AST annotation converted Unravel's 4/6 on its hardest bug to a 6/6, giving it a **+2 delta** on the final bug and closing the benchmark at 59/60.
