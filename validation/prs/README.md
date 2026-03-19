# Unravel — PR Validation Log

This directory contains reproducible documentation for every real-world pull request used as validation evidence in the arXiv paper.

## Purpose

Synthetic benchmarks cannot capture the full diagnostic advantage of structural pre-analysis on production-scale bugs. This directory provides the primary empirical evidence for Unravel's claims — each entry is a real, merged pull request in an open-source repository, with full artifacts to enable independent verification.

## Aggregate Metrics Table

*(Update this table each time a new PR is added)*

| # | Repository | Issue | Bug Type | RCA | HR | PR Acceptance | Merge Latency | Iterations | diff_size | Maintainer Confirmation |
|---|-----------|-------|----------|:---:|:---:|:---:|:---:|:---:|:---:|:---:|
| 1 | tldraw/tldraw | #8148 CLI install path | DATA_FLOW + LAYER_BOUNDARY | 1 | 0% | Merged | — | — | — | *(fill)* |
| 2 | calcom/cal.com | #28283 Toggle contention | STATE_MUTATION | 1 | 0% | Merged | — | — | — | Yes (reporter credit) |
| 3 | *(next PR)* | | | | | | | | | |

**Aggregate (2 PRs):**
- PR acceptance rate: 2/2 (100%)
- Median HR: 0%
- Median RCA: 1.0

## Directory Structure

```
validation/prs/
├── TEMPLATE/
│   └── README.md          ← Copy this for every new PR
├── tldraw/
│   └── 8148/
│       ├── README.md      ← Case study (pre-filled)
│       ├── outputs/       ← Unravel JSON output
│       ├── baselines/     ← Baseline model outputs
│       ├── patches/       ← git format-patch file
│       └── snapshots/     ← repo context tarball
├── calcom/
│   └── 28283/
│       ├── README.md      ← Case study (pre-filled)
│       ├── outputs/
│       ├── baselines/
│       ├── patches/
│       └── snapshots/
└── README.md              ← This file
```

## How to Add a New PR

1. Copy `TEMPLATE/README.md` → `<repo>/<issue-number>/README.md`
2. Run Unravel on the bug. Save full JSON to `outputs/unravel-output.json`
3. Run Claude 4.6, GPT, and Gemini on the same context at temperature = 0. Save to `baselines/<model>-output.txt`
4. Open the PR. Save `git format-patch` to `patches/<sha>.patch`
5. Record merge date, latency, iteration count, diff_size, maintainer quote
6. Fill in all template fields — mark any `*(fill)*` items
7. Add a row to the aggregate table above

## Checklist (per PR)

- [ ] Issue URL + text saved
- [ ] PR URL + description + merged commit SHA
- [ ] Unravel JSON output saved to `outputs/`
- [ ] Baseline model outputs saved (same context, temperature 0)
- [ ] Patch file saved (`git format-patch`)
- [ ] CI result / screenshot captured
- [ ] Reproduction script written
- [ ] Merge date + latency recorded
- [ ] Iteration count recorded
- [ ] Maintainer comment quoted (or noted absent)
- [ ] Aggregate table row updated

## Selection Criteria

To avoid cherry-picking bias, PRs are selected following these criteria:

1. **Non-triviality:** prefer multi-file bugs where structural analysis provides clear advantage over surface-level diagnosis
2. **Bug-type diversity:** aim to cover at least 5 different taxonomy categories across the full set
3. **Repository variety:** mix of large monorepos, medium-scale apps, different frameworks
4. **Honesty:** at least one PR with revisions requested, or one diagnostic failure/ambiguity, is included
5. **Completeness:** every PR included has the full artifact set; PRs with missing artifacts are listed in a separate "incomplete" section rather than dropped silently

## Note on Evidence Strength

Maintainer acceptance is treated as external validation that the proposed patch is consistent with the repository's intended behavior. It confirms the fix is sound; it does not establish that it is the unique correct fix, nor that Unravel was the only tool capable of reaching it. The strongest evidence rows are those with explicit maintainer confirmation quotes, short merge latency (suggesting minimal revision), and small diff sizes (suggesting precise root cause identification).
