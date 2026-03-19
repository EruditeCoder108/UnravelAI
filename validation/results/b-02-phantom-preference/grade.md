# B-02 — The Phantom Preference — Grade Sheet

**Date:** 2026-03-19
**Grader:** Antigravity
**Engines tested:** Unravel full-mode (Gemini 2.5 Flash + AST + hypothesis tree), Claude Sonnet 4.6 (baseline, no AST)

---

## Ground Truth
- **Root cause file:** `src/store/preferenceStore.ts` Lines 47–51 and 64–67
- **Mechanism:** Shallow spread + `Object.assign` on nested `notifications` and `privacy` objects → shared mutable reference → retroactive mutation of all captured references
- **Full scope:** Both `updateNotifications` AND `updatePrivacy` are buggy
- **Proximate trap:** Reporter blames `usePreferences.ts` — the `JSON.stringify` comparison looks like a cross-instance coupling suspect

---

## Unravel — Gemini 2.5 Flash + AST (full mode)

| Axis | Score (0-2) | Notes |
|------|-------------|-------|
| RCA  | **2** | Correct file, both bug locations (L49 and L65), mechanism precise: "Object.assign mutates the notifications/privacy object reference in place — Zustand notifies with a new root preferences object but the nested reference is still X" |
| PFR  | **2** | Hypothesis H3 explicitly eliminates `usePreferences.ts` with evidence: "The hook simply subscribes to Zustand's state... the issue stems from the internal mutation within Zustand's update action (H1), not from the hook" |
| CFR  | **2** | Full timeline graph traces: Panel A calls `updateNotifications` → store mutates ref X → Zustand emits new root prefs → Panel B re-renders using same ref X → `useEffect` dependency `[preferences.notifications]` unchanged (X === X) → no re-sync. Variable state graph traces all read/write edges across 5 files |
| **Total** | **6/6** | |

**Correct root cause file:** ✅
**Both bug locations caught:** ✅ L49 and L65
**Proximate trap:** ✅ explicitly eliminated via hypothesis tree
**Hallucinations:** None — all citations real and verifiable
**Fix completeness:** ✅ Both `updateNotifications` and `updatePrivacy` fixed

---

## Baseline — Claude Sonnet 4.6 (raw, no AST)

| Axis | Score (0-2) | Notes |
|------|-------------|-------|
| RCA  | **2** | Correct file, correct mechanism described accurately |
| PFR  | **2** | Explicitly: "No changes needed in usePreferences.ts, PreferencesPanel.tsx, or anywhere else" |
| CFR  | **1** | Store correctly identified. Doesn't trace why `localDraft` is contaminated or why `useEffect` dependency can't detect the mutation |
| **Total** | **5/6** | |

**Correct root cause file:** ✅
**Both bug locations caught:** ✅ Fixed both `updateNotifications` and `updatePrivacy`
**Proximate trap:** ✅ explicitly dismissed

---

## Delta Summary

| | Unravel (full) | Claude |
|---|---|---|
| RCA | 2 | 2 |
| PFR | 2 | 2 |
| CFR | **2** | 1 |
| **Total** | **6/6** | **5/6** |

**Score delta: Unravel +1**

**Key finding:** Full-mode Unravel produces a perfect score on B-02 (Hard, STATE_MUTATION). The hypothesis tree eliminated the proximate fixation trap with AST-grounded evidence — not just an assertion. The timeline and variable state graphs documented the exact cross-instance propagation chain that Claude's output missed.

**Paper note:** This is the first score gap between Unravel and baseline. On a Hard-tier bug with a 3-file causal chain, AST pre-analysis + hypothesis elimination gave Unravel the CFR point that raw language reasoning couldn't reach. Running total: Unravel 11/12, Claude 10/12.
