# B-03 — The Loyal Closure — Grade Sheet

**Date:** 2026-03-19
**Grader:** Antigravity
**Engines tested:** Unravel (Gemini 2.5 Flash + AST + hypothesis tree), Claude Sonnet 4.6 (baseline, no AST)

---

## Ground Truth
- **Root cause file:** `src/hooks/useSearchDebounce.ts` Line 48 (the `useCallback` `[]` dep array)
- **Mechanism:** `useCallback` with empty dep array → `debouncedSearch` created once → closes over `query = ''` from first render → `useEffect` re-runs on query change but calls the same stale function → `setTimeout` fires with the initial captured query, not the current one
- **Correct fix:** Remove `useCallback` entirely — inline the debounce logic directly inside `useEffect`. Effect body captures fresh `query` on every run.
- **Proximate trap:** Reporter blames `SearchBar.tsx` (`inputValue` prop is the visible symptom). `useEffect` dep array (which correctly lists `query`) also looks fine at a glance — the subtle failure is that `debouncedSearch` never changes, so adding it as a dep only calls the same stale closure.

---

## Unravel — Gemini 2.5 Flash + AST (with hypothesis tree)

| Axis | Score (0-2) | Notes |
|------|-------------|-------|
| RCA  | **2** | Correct file and line (L29 `useCallback` empty dep array), mechanism exact: "useCallback with [] creates debouncedSearch once, capturing initial query — useEffect re-runs but calls the stale closure instance" |
| PFR  | **2** | H3 is the `SearchBar.tsx` trap — explicitly eliminated: "user's console.log shows inputValue updating correctly, ruling out SearchBar". H2 eliminates `useEffect` dep array with `useSearchDebounce.ts L39`. Both innocent files cleared with evidence. |
| CFR  | **2** | Full timeline: `SearchBar` → `inputValue` → `useSearchDebounce('typescript')` → `useEffect` re-runs → stale `debouncedSearch` called → `setTimeout` fires → `searchDocuments('react')` (stale) → `searchCallLog` confirms. 3-file chain complete |
| **Total** | **6/6** | Re-graded after config fix — hypothesisTree now fires in all modes |

**Correct file + line:** ✅
**Proximate trap (SearchBar.tsx):** ✅ implicitly avoided, not named explicitly
**Fix quality:** ⚠️ Adds deps to `useCallback` (valid but suboptimal — state setters are stable, `useCallback` is ultimately unnecessary here). Ground truth prefers inlining into `useEffect`.
**Hallucinations:** None

---

## Baseline — Claude Sonnet 4.6 (raw, no AST)

| Axis | Score (0-2) | Notes |
|------|-------------|-------|
| RCA  | **2** | Correct file, pinpoints the empty dep array, explains the two-step failure: `useEffect` correctly includes `query` in deps BUT `debouncedSearch` never changes so it's always the stale version |
| PFR  | **2** | Explicitly: "SearchBar.tsx and searchService.ts are both fine" — names both innocent files directly |
| CFR  | **1** | Chain: user types → `useEffect` fires → stale `debouncedSearch` → wrong query sent. Doesn't follow into `searchCallLog` or trace why `searchDocuments` receives the stale value |
| **Total** | **5/6** | |

**Correct file + line:** ✅
**Proximate trap:** ✅ explicitly named and cleared
**Fix quality:** ✅ Perfect — exactly matches ground truth. Removes `useCallback` entirely, inlines into `useEffect`, correctly notes `timerRef` is no longer needed. This is the canonical fix.

---

## Delta Summary

| | Unravel | Claude |
|---|---|---|
| RCA | 2 | 2 |
| PFR | **2** | 2 |
| CFR | **2** | 1 |
| **Total** | **6/6** | **5/6** |

**Score delta: Unravel +1** (re-graded — hypothesisTree fix applied)

**Running total (B-01 + B-02 + B-03): Unravel 18/18, Claude 15/18**
