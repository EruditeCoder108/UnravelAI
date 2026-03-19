# UDB-20 Results

Raw outputs from each engine per bug, for paper-standard grading.

## Structure

```
results/
├── grading-rubric.md          ← scoring criteria (read before grading)
├── b-01-invisible-update/
│   ├── unravel-output.md      ← paste Unravel full JSON output here
│   ├── baseline-gemini.md     ← paste raw Gemini (no AST) output here
│   ├── baseline-claude.md     ← paste raw Claude (no AST) output here
│   └── grade.md               ← filled in by grader after comparison
├── b-02-phantom-preference/
│   └── ...
...
```

## How to run each bug

1. Open `validation/benchmark/packages/b-NN-name/symptom.md`
2. Copy the **Symptom** section verbatim into Unravel's symptom field
3. Upload **all files from `src/`** to Unravel
4. Run in **Debug mode, Full Report, Gemini 2.5 Flash**
5. Copy the full JSON/output into `results/b-NN/unravel-output.md`
6. Repeat with raw Gemini (same prompt, no Unravel, no AST) → `baseline-gemini.md`
7. Call me to grade it

## Baseline prompt (for raw model comparison)

```
You are a senior software engineer debugging a production bug.

[PASTE symptom.md content here]

[PASTE all src/ file contents here, one after another]

Identify the root cause. Give:
- Exact file and line number
- Why this is the root cause, not a symptom
- The minimal fix
```
