# B-17: Unstable Config — Grade Sheet

**Category:** `DATA_FLOW` / React Performance | **Difficulty:** Hard | **Files:** 4

**Ground truth:** `ReportDashboard.tsx L32` — `config={{ threshold: 0.5, mode: 'summary', maxRows: 100 }}` is an inline JSX object literal. Every render of `ReportDashboard` creates a new object reference. `useMemo` in `ReportPanel.tsx:11` compares deps by reference equality (`Object.is`). `config` always fails that check — even though the values are identical — so `runHeavyAggregation` runs on every filter click, every state update, every parent re-render.

**Proximate fixation trap:** `symptom.md` blames `aggregations.ts` — "`computedAt: Date.now()` makes the result referentially unstable" and "the `byCategory` new object reference defeats downstream memos." The developer removed `computedAt` — no improvement, because `useMemo` cares about its *input* deps, not its *output* reference.

---

## Unravel — Gemini 2.5 Flash + AST

| Axis | Score (0-2) | Notes |
|------|-------------|-------|
| RCA  | **2** | Correct file (`ReportDashboard.tsx`), correct line (L32), correct mechanism: inline object literal creates new reference every render → `useMemo` dep check fails. AST tracked `config` variableStateEdge: `written L32 (literal passed as prop)` and `ReportPanel.tsx L6 (prop definition)`. |
| PFR  | **2** | H1 (`filteredData` reference changes) correctly evaluated: "legitimately changes when actual filter subset changes — this is desired behavior, not the bug." H3 (`useMemo` itself buggy) eliminated: "fundamental React primitive with shallow dep comparison — the problem is unstable deps, not the hook." `aggregations.ts` trap never considered. |
| CFR  | **2** | Full chain: filter click → `setActiveFilter` → re-render → `ReportDashboard.tsx:L32` (new `config` object) → `useMemo` detects dep change → `runHeavyAggregation` re-runs → 60-80% frame budget consumed. |
| **Total** | **6/6** | Fix: `useMemo(() => ({ threshold: 0.5, mode: 'summary', maxRows: 100 }), [])` in `ReportDashboard`. |

---

## Claude Sonnet 4.6 (structured prompt)

| Axis | Score (0-2) | Notes |
|------|-------------|-------|
| RCA  | **2** | Correct file (`ReportDashboard.tsx:33`), correct mechanism. Precise explanation: "`useMemo` re-runs because of what it *receives* as inputs, not what the function *returns*. The output's reference stability is irrelevant to the cache invalidation decision." |
| PFR  | **2** | Explicitly demolished the `aggregations.ts` trap with insight: "Removing `computedAt` (as the developer tried) had no effect for exactly this reason." Directly explained why the developer's own experiment proved the trap wrong. |
| CFR  | **2** | Full 5-hop chain: `ReportDashboard.tsx:11` (filter click) → `ReportDashboard.tsx:33` (new config object) → `ReportPanel.tsx:11` (memo invalidated, config !== prev) → `aggregations.ts:28` (`aggregationCallCount++`) → symptom. |
| **Total** | **6/6** | Fix: module-level constant `REPORT_CONFIG` (simpler than `useMemo`) — valid alternative since config is truly static. |

---

## Summary

| | Unravel | Claude (structured) |
|-|---------|---------------------|
| RCA | ✅ 2/2 | ✅ 2/2 |
| PFR | ✅ 2/2 | ✅ 2/2 — used developer's own experiment ("removed computedAt, no improvement") as proof |
| CFR | ✅ 2/2 | ✅ 2/2 |
| **Total** | **6/6** | **6/6** |

**Tie. Both perfect.** Both correctly identified the inline object literal as the unstable dep. Claude's PFR reasoning was slightly sharper — it used the developer's own failed experiment to close the trap (removing `computedAt` had no effect because `useMemo` doesn't care about output reference). Unravel correctly identified the bug structurally. Claude also proposed a simpler fix (module-level constant vs `useMemo`) which is strictly better when config is truly static.

This is a classic React hook trap that benefits from training data (both engines have seen this pattern many times). No AST-specific advantage needed here.

---

## Running Totals (B-01 to B-17)

| Bug | Difficulty | Unravel | Claude | Delta |
|-----|-----------|---------|--------|-------|
| B-01 | Easy | 6/6 | 5/6* | +1 |
| B-02 | Hard | 6/6 | 5/6* | +1 |
| B-03 | Medium | 6/6 | 5/6* | +1 |
| B-04 | Hard | 6/6 | 5/6* | +1 |
| B-05 | Medium | 5/6 | 5/6* | 0 |
| B-06 | Easy | 6/6 | 5/6* | +1 |
| B-07 | Medium | 6/6 | 6/6* | 0 |
| B-08 | Medium | 6/6 | 6/6* | 0 |
| B-09 | Hard | 6/6 | 6/6* | 0 |
| B-10 | Hard | 6/6 | 4/6* | +2 |
| B-11 | Medium | 6/6 | 5/6* | +1 |
| B-12 | Medium | 6/6 | 6/6 | 0 |
| B-13 | Medium | 6/6 | 6/6 | 0 |
| B-14 | Medium | 6/6 | 6/6 | 0 |
| B-15 | Hard | 6/6 | 6/6 | 0 |
| B-16 | Hard | 6/6 | 6/6 | 0 |
| B-17 | Hard | 6/6 | 6/6 | 0 |
| **Total** | | **101/102** | **94/102** | **+7** |

\* B-01 to B-11 Claude scores used unstructured prompt.
