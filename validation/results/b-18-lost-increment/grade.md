# B-18: Lost Increment — Grade Sheet

**Category:** `RACE_CONDITION` | **Difficulty:** Hard | **Files:** 3

**Ground truth:** `VoteService.ts L14-L16` — non-atomic read-modify-write across two `await` boundaries. The 5ms `setTimeout` in both `get` and `set` creates a huge window for concurrent calls to read the same stale value. With 500 concurrent requests: all 500 `await get()` → all see `count=0` → all compute `next=1` → all `await set(pollId, 1)` → final count = 1, not 500. `VoteStore.increment()` already exists as the atomic alternative — the fix is a one-line change in `VoteService`. The write log containing 500 entries all with `value=1` is the definitive proof.

**Proximate fixation trap:** `symptom.md` says "The bug must be in `VoteStore.set()` — it appears to have a deduplication or caching mechanism." The 500 duplicate entries in the write log are pointed to as evidence *of* dedup. This is backward: 500 identical `value=1` entries prove the *caller* sent 500 identical values, not that `set()` filtered them.

**Verifier warnings:** `variableStateEdge: this.counts` and `this.writeLog` not found in AST mutation chains. Both are class instance properties — the AST chain tracker covers module-scope and local variables, not `this.*` fields. Soft penalty only (0), diagnosis unaffected.

---

## Unravel — Gemini 2.5 Flash + AST

| Axis | Score (0-2) | Notes |
|------|-------------|-------|
| RCA  | **2** | Correct file (`VoteService.ts`), correct lines (L14-L16), correct mechanism: `await` gap between `get` and `set` allows concurrent reads of stale value. AST explicitly surfaced both `setTimeout → r [L12]` (in `get`) and `setTimeout → r [L17]` (in `set`) as timing nodes — deterministically identified the async windows. |
| PFR  | **2** | H2 (`VoteStore.set` deduplicates) eliminated: "`Map.set` simply overwrites the value for a key; it doesn't deduplicate on value." H3 (`VoteStore.get` caches stale data) eliminated: "returns current state of `this.counts` — the issue isn't caching, it's returning state not yet updated by concurrent operations." Proximate trap cleanly reversed. |
| CFR  | **2** | Full multi-actor chain: Client A+B both `await store.get()` → both receive `0` (stale) → both compute `next=1` → A writes `1` → B overwrites with `1` (🐛 lost update) → final count = 1. File+line at every hop including the specific `setTimeout` delays. |
| **Total** | **6/6** | Fix: replace 3-line get/compute/set with `const next = await this.store.increment(pollId)`. |

**AST value on this bug:** The `setTimeout → r [L12/L17]` timing nodes were surfaced deterministically. The LLM used these as direct evidence that the async window is real and measurable (~5ms), not theoretical. This is exactly what the AST engine is for.

---

## Claude Sonnet 4.6 (structured prompt)

| Axis | Score (0-2) | Notes |
|------|-------------|-------|
| RCA  | **2** | Correct file (`VoteService.ts:16-18`), correct mechanism. Precise description: "Between the `get` and `set` awaits, 499 other concurrent calls can also `get` the same stale value, compute the same `next`, and write the same result." |
| PFR  | **2** | Demolished the trap with precision: "The 500 duplicate entries in the write log are proof the *caller* passed 500 identical `next` values — not that `set()` discarded them. There is no dedup logic anywhere in `set()`." Used the write log as evidence *against* the trap hypothesis. |
| CFR  | **2** | Full chain: `VoteService.ts:16` (500 concurrent `await store.get`) → `VoteStore.ts:12` (`get()` yields for 5ms) → all 500 resume with `current=0` → all compute `next=1` → `VoteStore.ts:17-20` (`set()` called 500 times, all `value=1`) → `counts.set('poll1', 1)` → final count=1. |
| **Total** | **6/6** | Also identified H2 as "pointing to the fix, not the root cause" — correctly noted `increment()` already exists as the safe path that was never wired up. |

---

## Summary

| | Unravel | Claude (structured) |
|-|---------|---------------------|
| RCA | ✅ 2/2 — AST surfaced setTimeout windows | ✅ 2/2 |
| PFR | ✅ 2/2 | ✅ 2/2 — write log used as anti-evidence against trap |
| CFR | ✅ 2/2 | ✅ 2/2 |
| **Total** | **6/6** | **6/6** |

Tie. Unravel's AST timing node detection (`setTimeout → r`) gave it a structural advantage: the 5ms async windows are surfaced as deterministic facts, not inferred. Claude reasoned to the same conclusion from reading the code. Both fixes are identical.

---

## Running Totals (B-01 to B-18)

| Bug | Difficulty | Unravel | Claude | Delta |
|-----|-----------|---------|--------|-------|
| B-01–B-11 | Mix | 65/66 | 58/66* | +7 |
| B-12 | Medium | 6/6 | 6/6 | 0 |
| B-13 | Medium | 6/6 | 6/6 | 0 |
| B-14 | Medium | 6/6 | 6/6 | 0 |
| B-15 | Hard | 6/6 | 6/6 | 0 |
| B-16 | Hard | 6/6 | 6/6 | 0 |
| B-17 | Hard | 6/6 | 6/6 | 0 |
| B-18 | Hard | 6/6 | 6/6 | 0 |
| **Total** | | **107/108** | **100/108** | **+7** |

\* B-01 to B-11 used unstructured prompt for Claude.
