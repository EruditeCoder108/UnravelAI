# UDB-20 Grading Rubric

Every bug is scored on three axes. Each axis is scored 0/1/2. Maximum per bug: **6 points**.

---

## Axis 1 — Root Cause Accuracy (RCA)

*Did the engine identify the correct file, line, and mechanism?*

| Score | Criterion |
|-------|-----------|
| **2** | Correct file + correct line (±2 lines) + correct mechanism (e.g. "push() mutates in place — Zustand sees no reference change") |
| **1** | Correct file + correct mechanism, but wrong line OR mechanism described imprecisely (e.g. "state not updating" without naming the mutation pattern) |
| **0** | Wrong file, OR wrong mechanism, OR "no bug found" when bug exists |

Ground truth for each bug is in `benchmark/packages/b-NN-name/ground-truth.md`.

---

## Axis 2 — Proximate Fixation Resistance (PFR)

*Did the engine avoid the obvious-but-wrong answer planted in the symptom?*

| Score | Criterion |
|-------|-----------|
| **2** | Explicitly names the proximate trap and explains why it is wrong (e.g. "The reporter suspects `TaskList.tsx` — the component is innocent; it subscribed correctly. The mutation is upstream in the store.") |
| **1** | Correctly identifies root cause without mentioning the trap — didn't fall for it, but didn't call it out |
| **0** | Attributes the bug to the proximate component named in the symptom |

The proximate trap for each bug is documented in `ground-truth.md` under **"Proximate Fixation Trap"**.

---

## Axis 3 — Cross-File Reasoning (CFR)

*Did the engine trace state correctly across file boundaries?*

| Score | Criterion |
|-------|-----------|
| **2** | Traces the exact causal chain across files with correct hop order (e.g. "`AddTaskForm.tsx` calls `addTask()` in `taskStore.ts` which mutates in place — subscribers in `useTasks.ts` never fire") |
| **1** | Identifies that the bug spans multiple files but misses one hop or describes the chain loosely |
| **0** | Analysis confined to a single file, OR cross-file chain is wrong |

Bugs with 1 file hop (B-01, B-07, B-13) are scored on CFR at reduced weight — noted in each grade sheet.

---

## Score Sheet Template

Copy this into each `grade.md`:

```markdown
## B-NN — [Bug Name] — Grade Sheet

### Unravel
| Axis | Score (0-2) | Notes |
|------|-------------|-------|
| RCA  |             |       |
| PFR  |             |       |
| CFR  |             |       |
| **Total** | **/6** |       |

**Correct root cause file:** yes / no
**Correct line:** yes / no (actual: L___, diagnosed: L___)
**Proximate trap avoided:** yes / no / called out explicitly

### Baseline — Gemini 2.5 Flash (no AST)
| Axis | Score (0-2) | Notes |
|------|-------------|-------|
| RCA  |             |       |
| PFR  |             |       |
| CFR  |             |       |
| **Total** | **/6** |       |

### Baseline — Claude Sonnet (no AST)
| Axis | Score (0-2) | Notes |
|------|-------------|-------|
| RCA  |             |       |
| PFR  |             |       |
| CFR  |             |       |
| **Total** | **/6** |       |

### Delta
Unravel vs Gemini baseline: +N / -N
Unravel vs Claude baseline: +N / -N
```

---

## Paper-Standard Claims This Enables

After all 20 bugs are graded:

- **RCA Accuracy**: `(sum of RCA scores where score=2) / 20 × 100%` → target ≥85%
- **PFR Rate**: `(sum of PFR scores where score=2) / 20 × 100%` → how often Unravel explicitly identifies the proximate trap
- **Delta vs baseline**: average score difference across all 20 bugs
- **Hard-tier delta**: same calculation restricted to B-02, B-04, B-06, B-08, B-10, B-12, B-16, B-18 — this is the number that goes in the paper abstract

---

## Grading Notes

- Grade **Unravel first**, before reading the baselines, to avoid anchoring
- Score axis by axis — do not give a holistic score then justify it
- If the output is partially correct, always pick the lower score and note why
- B-19 (No Bug Found): RCA=2 if output correctly says "no defect", 0 if it invents one. PFR and CFR not applicable — mark N/A
- B-20 (Layer Boundary): RCA=2 if verdict is LAYER_BOUNDARY with correct layer identified. PFR and CFR not applicable — mark N/A
