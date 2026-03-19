# UDB-20 — Grading System

**Unravel Debug Benchmark — 20 bugs, 3 axes, 6 points per bug.**

---

## Overview

Each bug in UDB-20 is graded on 3 independent axes. Every engine under test receives a score on all 3 axes for each bug. The grader is a human (the author) cross-checked against the ground truth in `benchmark/packages/b-XX/ground-truth.md`.

---

## The 3-Axis Rubric

### Axis 1 — RCA: Root Cause Accuracy (0–2)

Did the engine find the REAL bug, not the proximate symptom?

| Score | Criteria |
|-------|----------|
| **2** | Correct file **and** correct mechanism **and** correct line(s). All three must match ground truth. |
| **1** | Correct file but wrong mechanism, OR correct mechanism but cited wrong file. Partial credit for getting half the story right. |
| **0** | Wrong file, wrong mechanism, or refused to diagnose ("cannot determine without runtime logs"). |

**Key:** Line number does not need to be exact — within ±3 lines of the root cause line(s) is accepted. Mechanism must describe what is structurally wrong, not just what the symptom is.

---

### Axis 2 — PFR: Proximate Fixation Resistance (0–2)

Did the engine avoid the red herring / proximate trap that was deliberately planted?

Every bug in UDB-20 has a planted proximate trap — a plausible-but-wrong location that a naive engine would fixate on (usually the crash site or the file mentioned in the symptom report).

| Score | Criteria |
|-------|----------|
| **2** | Explicitly names the trap and eliminates it with code evidence. E.g. "The bug is NOT in `useTasks.ts` — AST confirms the store actions are stable at L17, L23, L28." |
| **1** | Does not fixate on the trap, finds the correct file, but never explicitly rebuts it. Passively correct. |
| **0** | Fixates on the trap. Diagnoses the wrong file as root cause, or spends >50% of the diagnosis on the wrong location without correcting. |

---

### Axis 3 — CFR: Causal Flow Reconstruction (0–2)

Did the engine explain HOW the bug produces the observed symptom, end to end?

| Score | Criteria |
|-------|----------|
| **2** | Full causal chain traced from root cause → intermediate state change → symptom. Named actors, file+line evidence at each hop, no gaps. |
| **1** | Partial chain. Gets the start and end right but skips one or more intermediate steps, OR explains the mechanism correctly but without file/line evidence for each hop. |
| **0** | No causal chain. States the fix without explaining why it works, or gives a vague one-sentence description that could apply to any bug of that category. |

---

## Total Score

```
Total = RCA + PFR + CFR     (max 6 per bug, max 120 across all 20 bugs)
```

---

## How Each Bug Is Graded

### Step 1 — Run the engine

Upload the bug's `src/` files to the engine under test. Report the symptom from `benchmark/packages/b-XX/symptom.md`. Collect the raw output.

Save the raw output to:
```
results/b-XX-<name>/unravel-output.json     ← Unravel JSON output
results/b-XX-<name>/baseline-<model>.md     ← baseline engine plain-text output
```

### Step 2 — Grade against ground truth

Open `benchmark/packages/b-XX/ground-truth.md`. It specifies:
- **Root cause file** — the exact file containing the bug
- **Root cause lines** — the line(s) that are wrong
- **Mechanism** — the precise causal description
- **Proximate trap** — what a naive engine is expected to fixate on
- **Correct fix** — the minimal correct change

Score each axis independently using the rubric above.

### Step 3 — Write grade.md

Every graded run gets a `grade.md` in its results folder. Format:

```markdown
# B-XX — <Bug Name> — Grade Sheet

**Date:** YYYY-MM-DD
**Engines tested:** Unravel (mode + model), Baseline (model)

## Ground Truth
- Root cause file: `src/...`
- Mechanism: ...
- Proximate trap: ...

## <Engine Name>

| Axis | Score | Notes |
|------|-------|-------|
| RCA  | X/2   | ... |
| PFR  | X/2   | ... |
| CFR  | X/2   | ... |
| **Total** | **X/6** | |

## Delta Summary

| | Unravel | Baseline |
|---|---|---|
| RCA | | |
| PFR | | |
| CFR | | |
| Total | | |

Score delta: ...
Running total (B-01 … B-XX): Unravel X/Y, Baseline X/Y
```

---

## Scoring Policies

**Hallucination penalty:** If the engine cites a line number that does not exist in the provided files, or claims a variable is used in a location where it does not appear, the entire axis it used that hallucinated evidence for is capped at 0. This is the HR (Hallucination Rate) rule.

**Hint contamination:** If the bug's `src/` files contain any comment that directly names the root cause, the bug is flagged as contaminated and excluded from the score until fixed. Results from a contaminated run are not counted.

**Mode parity:** All modes (Quick Fix, Developer, Full Report) must produce equal RCA quality. Mode differences in score are noted separately and flagged as a defect, not a valid score difference. The graded score uses the mode that was actually run.

**Re-run policy:** If the benchmark source files are modified (hints removed, bugs adjusted), prior results must be re-run before being included in aggregate counts.

---

## Results Directory Structure

```
results/
├── README.md                           ← per-bug result index (auto-generated)
└── b-XX-<name>/
    ├── grade.md                        ← 3-axis human grade sheet
    ├── unravel-output.json             ← raw Unravel JSON (or .md for older runs)
    └── baseline-<model>.md             ← baseline engine output
```

---

## Aggregate Leaderboard

After all 20 bugs are graded, scores are rolled up:

| Engine | RCA /40 | PFR /40 | CFR /40 | Total /120 | HR% |
|--------|---------|---------|---------|------------|-----|
| Unravel (full) | | | | | |
| Unravel (developer) | | | | | |
| Unravel (quick fix) | | | | | |
| Claude Sonnet 4.6 | | | | | |
| Gemini 2.5 Flash | | | | | |

HR% = percentage of diagnoses containing at least one hallucinated file/line citation.

---

## Bug Difficulty Tiers

| Tier | Bugs | Description |
|------|------|-------------|
| Easy | B-01 to B-07 | Single-file root cause. Proximate trap is in the same feature area. |
| Medium | B-08 to B-14 | Cross-file root cause. Trap is a different file in the same module. |
| Hard | B-15 to B-20 | Multi-hop causal chain. Trap looks structurally similar to the root cause. |
