# B-01 — The Invisible Update — Grade Sheet

**Date:** 2026-03-19
**Grader:** Antigravity
**Engines tested:** Unravel full-mode (Gemini 2.5 Flash + AST + hypothesis tree), Claude Sonnet 4.6 (baseline, no AST)

---

## Ground Truth
- **Root cause file:** `src/store/taskStore.ts`
- **Mechanism:** `push()` / direct object mutation / `splice()` → same array reference → Zustand `Object.is()` returns true → no subscriber notification → UI frozen
- **Proximate trap:** Reporter blames `useTasks.ts` and `isLoading` guard in `TaskDashboard.tsx`

---

## Unravel — Gemini 2.5 Flash + AST (full mode)

| Axis | Score (0-2) | Notes |
|------|-------------|-------|
| RCA  | **2** | Correct file, all 3 mutations caught (L29 `push`, L39 `task.completed = true`, L45 `splice`), mechanism precise: "Zustand shallow compare sees reference A === reference A → no subscriber notification" |
| PFR  | **2** | H2 explicitly eliminates `useTasks.ts` useCallback: "Store actions from Zustand are stable by default — AST confirms correct deps at L17, L23, L28". H3 eliminates `isLoading` guard: "User report explicitly states: Removed isLoading guard — no change" |
| CFR  | **2** | Full 5-hop timeline traced: `addTask` → `push()` mutates ref A → `set({tasks: ref A})` → Zustand shallow compare → no notification → hook returns stale ref → component frozen. Variable state graph with `mutate` edge types distinguishing reads from in-place mutations |
| **Total** | **6/6** | |

**Correct root cause file:** ✅
**All 3 mutations caught:** ✅ `push`, object assign, `splice`
**Proximate trap:** ✅ both `useTasks.ts` (H2) and `isLoading` (H3) eliminated with evidence
**Hallucinations:** None — console.log evidence cited from symptom.md line 22 (real)

---

## Baseline — Claude Sonnet 4.6 (raw, no AST)

| Axis | Score (0-2) | Notes |
|------|-------------|-------|
| RCA  | **2** | Correct file, correct mechanism |
| PFR  | **2** | Explicitly states "the bug is in taskStore.ts, not useTasks.ts" |
| CFR  | **1** | Traces mutation in store correctly, does not continue through hook → component propagation |
| **Total** | **5/6** | |

**Correct root cause file:** ✅
**Proximate trap avoided:** ✅ explicitly named

---

## Delta Summary

| | Unravel (full) | Claude |
|---|---|---|
| RCA | 2 | 2 |
| PFR | **2** | 2 |
| CFR | **2** | 1 |
| **Total** | **6/6** | **5/6** |

**Score delta: Unravel +1**

**Running total (B-01 + B-02): Unravel 12/12, Claude 10/12**
