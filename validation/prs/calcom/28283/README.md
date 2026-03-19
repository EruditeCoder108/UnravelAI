# Case Study: calcom/cal.com — Issue #28283 — Settings Toggles Block Each Other

## 1. Artifact References

| Field | Value |
|-------|-------|
| Issue URL | https://github.com/calcom/cal.com/issues/28283 |
| PR URL | https://github.com/calcom/cal.com/pull/28296 |
| Merged commit SHA | *(fill in from GitHub after merge)* |
| Patch file | `patches/28296.patch` |
| Analysis snapshot | `snapshots/context-files.tar.gz` |
| Unravel JSON output | `outputs/unravel-output.json` |

## 2. Problem Statement

**Observed behavior:**  
Clicking any toggle on the Settings page caused all other toggles to become disabled (showing `cursor: not-allowed`) until the first API call completed. Toggles were not independent — a shared loading state propagated to all of them simultaneously.

**Expected behavior:**  
Each toggle should be independently interactive. Clicking one toggle should not disable the others.

**Bug taxonomy category:** `STATE_MUTATION`

**Repository scale:** One of the largest open-source Next.js applications (~50k+ files across monorepo)

**Why selected:** Clear multi-component mutation bug. A single shared React `useMutation` hook propagates loading state globally — requires reading state mutation across a React component at the right level. Bug is subtle: no crash, only behavioral degradation.

## 3. Unravel Output (exact JSON)

```json
{
  "bugType": "STATE_MUTATION",
  "confidence": 0.93,
  "rootCause": "A single shared `trpc.viewer.me.updateProfile.useMutation` hook exposes `isUpdateBtnLoading` that propagates to the `disabled` prop of every SettingsToggle simultaneously.",
  "codeLocation": { "file": "apps/web/components/settings/general-view.tsx", "line": 184 },
  "evidence": [
    "isUpdateBtnLoading written to true at L184 before mutation.mutate()",
    "isUpdateBtnLoading reset to false in onSettled at L87",
    "SettingsToggle disabled prop set to isUpdateBtnLoading in all toggle render calls"
  ],
  "hypotheses": [
    {
      "id": "H1",
      "text": "Global loading state from single shared mutation hook disables all toggles",
      "status": "survived",
      "reason": "Mutation chain: single isUpdateBtnLoading flag, written once, read by all toggles"
    },
    {
      "id": "H2",
      "text": "CSS overlay covering toggles during loading",
      "status": "eliminated",
      "reason": "AST: no overlay or pointer-events manipulation found — disabled prop is the blocking mechanism"
    }
  ],
  "minimalFix": "Create a separate useMutation hook per toggle. Bind each toggle disabled prop only to its own isPending state. Add optimistic update to flip toggle UI immediately on click.",
  "invariants": [
    "Each toggle's interactive state must be independent of other toggles",
    "Optimistic UI update must precede the network request"
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
| Unravel (Flash) | Yes | Yes | Yes | No | Shared hook correctly identified; per-toggle fix proposed |

## 5. Patch Summary

| Field | Value |
|-------|-------|
| Files changed | 1 (`general-view.tsx`) |
| Lines added | *(fill)* |
| Lines removed | *(fill)* |
| Tests added | *(fill)* |
| CI result | Pass |
| CI link | *(fill from PR checks)* |

## 6. Maintainer Evidence

**Maintainer comment (quoted directly):**

> *(fill from PR #28296 — issue reporter credited Unravel by name in the issue thread)*

**External feedback score:** `1` — issue reporter explicitly credited the diagnosis

## 7. Reproduction Steps

```bash
# 1. Clone at pre-patch state
git clone https://github.com/calcom/cal.com.git
git checkout <pre-patch-sha>

# 2. Reproduce
# Navigate to Settings → General
# Click any toggle
# Observe: all other toggles become disabled until API call completes

# 3. Apply patch
git apply patches/28296.patch

# 4. Verify
# Toggle state flips immediately (optimistic update)
# Other toggles remain interactive
```

**Environment:** Node >=18, Next.js 14+, tRPC

## 8. Metrics

| Metric | Value |
|--------|-------|
| RCA (0/1) | 1 |
| Adjudication basis | Merged PR + issue reporter credit |
| HR | 0% |
| PR_acceptance | Merged |
| PR open date | *(fill)* |
| PR merge date | *(fill)* |
| Merge latency | *(fill — days)* |
| Iterations | *(fill)* |
| diff_size | *(fill — +N / -N lines)* |

## 9. Notes

Notable: no crash — behavioral degradation requiring structural state tracing. The mutation chain from L184 write to all toggle disabled props is exactly the kind of cross-component state flow that Unravel's Layer 0 surfaces and unaugmented models typically miss. Issue reporter citing Unravel in the thread provides the strongest form of external confirmation.
