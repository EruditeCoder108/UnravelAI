# UDB-11 Grading Artifacts

This directory archives the grading evidence for the UDB-11 internal benchmark, as referenced in the paper's §6.1.

## Grading Procedure

1. **Claude Opus judge:** Each Unravel diagnosis was submitted to Claude Opus with the following prompt structure:
   - System: "You are a code debugging evaluator. Assess whether the provided diagnosis correctly identifies the root cause of the bug. Grade binary: 1 if function, variable, and causal mechanism all match ground truth; 0 otherwise."
   - User: (a) source files, (b) Unravel diagnosis JSON, (c) expected root cause description

2. **Author review:** All 11 diagnoses were independently reviewed by the author immediately after grading. The author verified agreement with the Claude Opus verdict.

## Agreement Record

| Bug ID | Bug Category | Ground Truth | Claude Opus Grade | Author Grade | Agreement |
|--------|-------------|-------------|:-----------------:|:------------:|:---------:|
| UDB-01 | STALE_CLOSURE | *(fill)* | *(fill)* | *(fill)* | *(fill)* |
| UDB-02 | STALE_CLOSURE | *(fill)* | *(fill)* | *(fill)* | *(fill)* |
| UDB-03 | STATE_MUTATION | *(fill)* | *(fill)* | *(fill)* | *(fill)* |
| UDB-04 | RACE_CONDITION | *(fill)* | *(fill)* | *(fill)* | *(fill)* |
| UDB-05 | EVENT_LIFECYCLE | *(fill)* | *(fill)* | *(fill)* | *(fill)* |
| UDB-06 | ASYNC_ORDERING | *(fill)* | *(fill)* | *(fill)* | *(fill)* |
| UDB-07 | TYPE_COERCION | *(fill)* | *(fill)* | *(fill)* | *(fill)* |
| UDB-08 | TEMPORAL_LOGIC | *(fill)* | *(fill)* | *(fill)* | *(fill)* |
| UDB-09 | DATA_FLOW | *(fill)* | *(fill)* | *(fill)* | *(fill)* |
| UDB-10 | UI_LOGIC | *(fill)* | *(fill)* | *(fill)* | *(fill)* |
| UDB-11 | STATE_MUTATION (cross-file) | *(fill)* | *(fill)* | *(fill)* | *(fill)* |
| **Total** | | | | | **11/11** |

## HR Record (Entity Claim Assessment)

Each diagnosis was checked against 6 verifiable entity fields by the Claim Verifier:

| Field | Description |
|-------|-------------|
| Root cause file | File must exist in provided inputs |
| Cited line number | Line must be within file bounds |
| Evidence filenames | All filenames in evidence[] must exist in inputs |
| Variable names | Variables cited in evidence must appear in AST mutation map |
| codeLocation pair | file-line pair validated via paired extraction |
| Security file (if applicable) | Referenced file must exist |

**Baseline HR:** 1 failed check out of 66 total = 1.5% (UDB-04: cited line 78, file had 71 lines)  
**Unravel pipeline HR:** 0 failed checks out of 66 total = 0.0%

## Files in this Directory

```
udb11/
├── README.md               ← this file
├── judge-prompt.txt        ← exact Claude Opus system + user prompt template
├── judge-outputs/          ← Claude Opus raw output per bug (udb01.txt … udb11.txt)
├── author-notes/           ← author annotation per bug (udb01.md … udb11.md)
└── bug-sources/            ← minimal source files used for each bug (anonymized)
```

> Fill `judge-outputs/` and `author-notes/` directories with the actual grading artifacts before submission.
