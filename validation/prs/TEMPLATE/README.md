# Case Study Template

Copy this file to `validation/prs/<repo>/<issue-number>/README.md` for each new PR.

---

## Case Study: `<repo>` — Issue #`<n>` — `<short title>`

### 1. Artifact References

| Field | Value |
|-------|-------|
| Issue URL | |
| PR URL | |
| Merged commit SHA | |
| Patch file | `patches/<sha>.patch` |
| Analysis snapshot | `snapshots/<sha>-context.tar.gz` |
| Unravel JSON output | `outputs/unravel-output.json` |

### 2. Problem Statement

**Observed behavior:**  
<!-- paste issue description here -->

**Expected behavior:**  
<!-- what should have happened -->

**Bug taxonomy category:** `<STATE_MUTATION | STALE_CLOSURE | RACE_CONDITION | ...>`

**Repository scale:** `<N files, language, framework>`

**Why selected:** `<single sentence — e.g., multi-file, required cross-function mutation trace>`

### 3. Unravel Output (exact JSON)

```json
<!-- paste full output from outputs/unravel-output.json here -->
```

Key fields:
- `rootCause`: 
- `codeLocation`: { "file": "", "line":  }
- `confidence`: 
- `bugType`: 
- `hypotheses`: N generated, N eliminated, N survived

### 4. Baseline Behavior

All baselines ran with identical code context, temperature = 0, no chain-of-thought instructions.

| Model | Root cause correct? | Exact lines cited? | Minimal fix? | Hallucination observed? | Notes |
|-------|:---:|:---:|:---:|:---:|-------|
| Claude 4.6 | | | | | |
| ChatGPT 5.3 | | | | | |
| Gemini 3.1 Pro | | | | | |
| Unravel (Flash) | | | | | |

Full baseline outputs: `baselines/<model>-output.txt`

### 5. Patch Summary

| Field | Value |
|-------|-------|
| Files changed | |
| Lines added | |
| Lines removed | |
| Tests added | |
| CI result | Pass / Fail / N/A |
| CI link / screenshot | |

### 6. Maintainer Evidence

**Maintainer comment (quoted directly):**

> <!-- paste exact quote from PR thread -->

**External feedback score:** `1` (explicit confirmation) / `0` (merged without comment)

### 7. Reproduction Steps

```bash
# 1. Clone at the snapshot commit
git clone <repo-url>
git checkout <pre-patch-commit-sha>

# 2. Reproduce the failure
<steps to trigger the bug>

# 3. Apply the patch
git apply patches/<sha>.patch

# 4. Verify the fix
<steps to confirm resolved>
```

**Environment:** Node `<version>` / TypeScript `<version>` / OS `<platform>`

### 8. Metrics

| Metric | Value |
|--------|-------|
| RCA (0/1) | |
| Adjudication basis | merged PR + maintainer comment / merged PR only |
| HR (structured hallucination rate) | |
| PR_acceptance | merged / closed / rejected |
| PR open date | |
| PR merge date | |
| Merge latency | `<N days>` |
| Iterations (revision cycles) | |
| diff_size (lines changed) | `+N / -N` |

### 9. Notes

<!-- strength/weakness of this evidence; anything unusual; caveats -->
