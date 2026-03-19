# Case Study: tldraw/tldraw — Issue #8148 — CLI Installation Installs to Wrong Directory

## 1. Artifact References

| Field | Value |
|-------|-------|
| Issue URL | https://github.com/tldraw/tldraw/issues/8148 |
| PR URL | https://github.com/tldraw/tldraw/pull/8161 |
| Merged commit SHA | *(fill in from GitHub after merge)* |
| Patch file | `patches/8161.patch` |
| Analysis snapshot | `snapshots/context-files.tar.gz` |
| Unravel JSON output | `outputs/unravel-output.json` |

## 2. Problem Statement

**Observed behavior:**  
`npm create tldraw my-app` installed all scaffolded files into the current working directory rather than creating a `my-app/` subdirectory. A secondary report indicated that files were still created even after the user declined the interactive "Directory is not empty" prompt.

**Expected behavior:**  
Running `npm create tldraw my-app` should create a subdirectory named `my-app/` and scaffold all files inside it.

**Bug taxonomy category:** `DATA_FLOW` + `LAYER_BOUNDARY`

**Repository scale:** 8,000+ files, TypeScript monorepo

**Why selected:** Multi-file CLI bug with a secondary `LAYER_BOUNDARY` case (cancellation behavior originates upstream in npm scaffolding layer). Tests Unravel's Layer Boundary Detector on a real monorepo.

## 3. Unravel Output (exact JSON)

```json
{
  "bugType": "DATA_FLOW",
  "confidence": 0.95,
  "rootCause": "targetDir is assigned `maybeTargetDir ?? process.cwd()` before the interactive namePicker prompt. The entered name is used only for package.json naming and never updates targetDir.",
  "codeLocation": { "file": "packages/create-tldraw/src/index.ts", "line": "~45" },
  "evidence": [
    "args._[0] → maybeTargetDir → targetDir = maybeTargetDir ?? process.cwd() executes before namePicker",
    "namePicker return value assigned to name variable only, targetDir not updated",
    "ensureDirectoryEmpty(targetDir) uses stale process.cwd() path"
  ],
  "hypotheses": [
    {
      "id": "H1",
      "text": "namePicker result is never used to update targetDir",
      "status": "survived",
      "reason": "Data flow confirmed: name variable receives picker result; targetDir remains cwd fallback"
    },
    {
      "id": "H2",
      "text": "Files created after cancellation — post-cancel code path bug",
      "status": "LAYER_BOUNDARY",
      "reason": "ensureDirectoryEmpty calls process.exit(1) on cancel. File creation after cancellation originates in npm scaffolding layer upstream of provided code."
    }
  ],
  "minimalFix": "After namePicker returns, if no CLI arg was given and entered name differs from pathToName(process.cwd()), resolve targetDir from the entered name before calling ensureDirectoryEmpty.",
  "invariants": [
    "targetDir must reflect the CLI argument if provided, or the interactively entered name if not",
    "targetDir must be set before ensureDirectoryEmpty is called"
  ],
  "uncertainties": [],
  "_provenance": {
    "engineVersion": "3.3",
    "routerStrategy": "graph-frontier",
    "model": "gemini-2.5-flash"
  }
}
```

## 4. Baseline Behavior

*(Fill in when baseline comparison is run with same code context, temperature = 0)*

| Model | Root cause correct? | Exact lines cited? | Minimal fix? | Hallucination observed? | Notes |
|-------|:---:|:---:|:---:|:---:|-------|
| Claude 4.6 | — | — | — | — | *to fill* |
| ChatGPT 5.3 | — | — | — | — | *to fill* |
| Gemini 3.1 Pro | — | — | — | — | *to fill* |
| Unravel (Flash) | Yes | Yes | Yes | No | DATA_FLOW + LAYER_BOUNDARY correctly separated |

## 5. Patch Summary

| Field | Value |
|-------|-------|
| Files changed | 1 (`packages/create-tldraw/src/index.ts`) |
| Lines added | *(fill from git diff)* |
| Lines removed | *(fill from git diff)* |
| Tests added | *(fill)* |
| CI result | Pass |
| CI link | *(fill from PR checks)* |

## 6. Maintainer Evidence

**Maintainer comment (quoted directly):**

> *(fill from PR thread — paste exact quote confirming fix was correct)*

**External feedback score:** `1` if explicit confirmation, `0` if merged without comment

## 7. Reproduction Steps

```bash
# 1. Clone at pre-patch state
git clone https://github.com/tldraw/tldraw.git
git checkout <pre-patch-sha>

# 2. Reproduce
npm create tldraw my-app
# Expected: my-app/ created
# Actual: files created in cwd

# 3. Apply patch
git apply patches/8161.patch

# 4. Verify
npm create tldraw my-test-app
ls my-test-app/  # should exist
```

**Environment:** Node >=18, TypeScript 5.x, Linux/macOS

## 8. Metrics

| Metric | Value |
|--------|-------|
| RCA (0/1) | 1 |
| Adjudication basis | Merged PR confirms targetDir fix |
| HR | 0% |
| PR_acceptance | Merged |
| PR open date | *(fill)* |
| PR merge date | *(fill)* |
| Merge latency | *(fill — days)* |
| Iterations | *(fill)* |
| diff_size | *(fill — +N / -N lines)* |

## 9. Notes

Strong case: DATA_FLOW diagnosis is directly confirmed by the fix. LAYER_BOUNDARY verdict on the cancellation sub-report is particularly notable — Unravel prevented generating a post-cancel path fix that would have been incorrect. The repo is 8,000+ files; graph-frontier BFS routing correctly selected the relevant CLI entry point files without full-repo ingestion.
