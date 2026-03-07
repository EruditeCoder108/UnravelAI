# Unravel Benchmarks

The benchmark suite measures the effectiveness of the Unravel engine across 10 curated bugs (Async ordering, Stale Closures, Race Conditions, UI State bugs, etc).

It performs A/B testing by comparing:
- **Baseline**: Unravel running **without** AST pre-analysis context.
- **Enhanced**: Unravel running **with** AST pre-analysis context.

## Latest Results: Internal Dev Proxy (Gemini 2.5 Flash)

| Bug | Baseline RCA | Enhanced RCA | Category |
|-----|-------------|-------------|----------|
| stale_closure_interval | 1.0 | 1.0 | STALE_CLOSURE |
| timer_state_mutation | 1.0 | 1.0 | STATE_MUTATION |
| parallel_fetch_race | 1.0 | 1.0 | RACE_CONDITION |
| missing_cleanup_leak | 1.0 | 1.0 | EVENT_LIFECYCLE |
| missing_await | 1.0 | 1.0 | ASYNC_ORDERING |
| type_coercion_calc | 1.0 | 1.0 | TYPE_COERCION |
| timer_drift | 1.0 | 1.0 | TEMPORAL_LOGIC |
| stale_prop_drilling | 1.0 | 1.0 | DATA_FLOW |
| reference_equality_render | 1.0 | 1.0 | UI_LOGIC |
| stale_closure_effect_deps | 1.0 | 1.0 | STALE_CLOSURE |
| **TOTAL** | **100%** | **100%** | |

- Baseline Hallucination Rate: **1.3%**
- Enhanced Hallucination Rate: **2.5%**

**What this means:** Modern models achieve 100% RCA on isolated, single-file bugs with or without AST. This 10-bug suite serves as our internal "green light" that the pipeline is stable. The actual AST improvement delta will be measured on an upcoming 50-bug suite featuring complex, cross-file state mutations.

## How to Run

By default, the runner will perform both Baseline and Enhanced runs.

```bash
# Run with Anthropic (default)
node benchmarks/runner.js --provider anthropic --model claude-3-5-sonnet-20241022 --key YOUR_API_KEY

# Run with Google (Gemini)
node benchmarks/runner.js --provider google --model gemini-2.5-flash --key YOUR_API_KEY
```

### Selective Bug Testing

Run only specific bugs (saves API calls):

```bash
node benchmarks/runner.js --bugs timer_state_mutation,parallel_fetch_race --key YOUR_API_KEY
```

### A/B Testing Flags

Skip either the baseline or the enhanced run:

```bash
# Skip the Baseline run (speeds up testing when tuning AST features)
node benchmarks/runner.js --no-baseline --key YOUR_API_KEY

# Skip the AST run (only run baseline)
node benchmarks/runner.js --no-ast --key YOUR_API_KEY
```

## Metrics Output

The results will be printed to the console as a summary table, and a detailed `results.json` file will be generated in this directory.

For each bug, 5 core metrics are captured:
1. `rootCauseCorrect`: (Requires manual grading after the run)
2. `fixCorrect`: (Requires manual grading after the run)
3. `confidence`: The model's self-reported confidence score (normalized to 0-1).
4. `timeToFirstToken`: API response latency (ms).
5. `timeToFinalAnswer`: Total time for the analysis (ms).

Open `results.json` after a run to manually grade the `rootCauseCorrect` and `fixCorrect` fields.
