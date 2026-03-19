# B-05 — The Fickle Like — Grade Sheet

**Date:** 2026-03-19
**Grader:** Antigravity
**Engines tested:** Unravel (Gemini 2.5 Flash + AST + hypothesis tree), Claude Sonnet 4.6 (baseline, no AST)

---

## Ground Truth
- **Root cause file:** `src/services/likeService.ts` Lines 67–71
- **Mechanism:** `handleWebSocketLikeEvent()` calls `optimisticStore.applyServerUpdate()` with no version check — a stale WS broadcast (version=1) arrives at T+80ms and overwrites a newer optimistic state (version=2), rolling back the second click. The version field in `optimisticStore` exists precisely for this guard but is never consulted in the WS handler.
- **Correct fix:** Add a version guard in `handleWebSocketLikeEvent` in `likeService.ts` — read `current.version` first, discard if `event.version <= current.version`. NOT in `optimisticStore.ts`.
- **Proximate trap:** Reporter blames `likesRouter.ts` — the ordering of `await` and `reconcileFinalCount()`. Plausible but wrong: reordering would paper over the bug without fixing it. Root cause is the missing guard in the WS handler.

---

## Unravel — Gemini 2.5 Flash + AST (hypothesis tree) — Final Clean Run

| Axis | Score (0-2) | Notes |
|------|-------------|-------|
| RCA  | **1** | Correct mechanism (unconditional overwrite — missing version check), but still wrong file — `optimisticStore.ts` instead of `likeService.ts`. This run also caught a second bug: `likesRouter.ts L34` passes `optimistic.version` (client version) as `serverVersion` instead of `serverCount`, inconsistent with the unlike path. Score stays 1 because ground truth root cause file is `likeService.ts`. |
| PFR  | **2** | H2 ("WS sends incorrect data") eliminated with `wsHandler.ts L43` — raw message passed through unchanged. H3 ("reconcileFinalCount premature") eliminated with user's own T+80ms/T+100ms log timestamps. Both traps cleanly disposed with concrete evidence. |
| CFR  | **2** | Full double-click timeline: POST A click → optimistic v1 → POST B click → optimistic v2 → WS confirms A (stale v1, bug point) → overwrites {2,2,true} → {1,1,false} → HTTP A reconciles (no-op at v1) → HTTP B reconciles → {2,2,false} → UI corrects. 5-actor chain complete with exact state transitions at each step. |
| **Total** | **5/6** | Confidence: 0.90 ✅ — All claims passed, zero warnings |

**Verifier:** `✓ All claims passed` — completely clean  
**RCA file:** ❌ `optimisticStore.ts` — ground truth is `likeService.ts`  
**Mechanism:** ✅ missing version check, correct  
**Extra credit:** Spotted the `likesRouter.ts L34` inconsistency (optimistic.version vs serverCount) — not in ground truth but genuinely correct  
**Two-pronged fix:**
1. `applyServerUpdate` — version guard with `if (current.optimistic)` branch
2. `likesRouter.ts L34` — change `serverVersion = optimistic.version` → `serverVersion = serverCount`

---

## Baseline — Claude Sonnet 4.6 (raw, no AST)

| Axis | Score (0-2) | Notes |
|------|-------------|-------|
| RCA  | **2** | Correct file (`likesRouter.ts`→`likeService.ts` handler), correct mechanism, even identifies the unlike typo (serverCount passed as both count and version). Identifies the ground-truth fix location (the WS handler in likeService.ts). |
| PFR  | **2** | Explicitly: "ConfigLoader is fine" equivalent — "the bug is not in the await ordering in likesRouter.ts, it's that applyServerUpdate has no stale-write protection." Names both locations of the multi-part fix. |
| CFR  | **1** | Gets the T+0 → T+80ms → T+100ms chain right, but explains the causal mechanism at a high level without tracing the exact function call chain (wsHandler → handleWebSocketLikeEvent → applyServerUpdate → state overwrite → UI). Skips the wsHandler hop. |
| **Total** | **5/6** | |

**Correct root cause file:** ✅  
**Correct fix location:** ✅ — Claude's fix is actually more precise (guards the WS handler, not the store)  
**CFR gap:** wsHandler → likeService hop not explicitly traced  

---

## Delta Summary

| | Unravel | Claude |
|---|---|---|
| RCA | 1 | **2** |
| PFR | **2** | **2** |
| CFR | **2** | 1 |
| **Total** | **5/6** | **5/6** |

**Score delta: 0** — tied, but for opposite reasons.

**Key observation:** Unravel found the *mechanism* (unconditional overwrite — missing version check) correctly but diagnosed the wrong file. Claude found the exact right file and fix location. Both scored identically. This is the first bug where Claude's RCA was more precise.

**Why Unravel got the wrong file:** The AST showed `applyServerUpdate` in `optimisticStore.ts` as the mutation point. Without reading the design intent of the version field being a *caller-side guard*, the model reasonably concluded the fix belongs in the callee. The ground truth says guards belong in the caller (`handleWebSocketLikeEvent`) — a design decision the AST can't fully see.

---

## Verifier Errors (Fixed in orchestrate.js this session)

3 false-positive warnings occurred on this run:
1. `serverLikeCounts[]` — array subscript form wasn't in knownVars lookup → **fixed** (add `[]`-suffixed names to knownVars)
2. `Fix Completeness: optimisticStore` (×2) — backward-compatible internal fix (adding a guard) incorrectly flagged as requiring caller updates → **fixed** (Fix Completeness only fires on signature-breaking diffs)

These 3 warnings caused a `confidence penalty: 0.3` on this run, knocking confidence from 0.9 to 0.6. With the fix, future runs on this bug will not be penalized.

---

## Running Totals

| Bug | Tier | Unravel | Claude | Delta |
|-----|------|---------|--------|-------|
| B-01 | Easy | 6/6 | 5/6 | +1 |
| B-02 | Hard | 6/6 | 5/6 | +1 |
| B-03 | Medium | 6/6 | 5/6 | +1 |
| B-04 | Hard | 6/6 | 5/6 | +1 |
| B-05 | Medium | 5/6 | 5/6 | 0 |
| **Running** | | **29/30** | **25/30** | **+4** |
