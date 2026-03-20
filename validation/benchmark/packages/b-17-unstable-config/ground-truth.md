## Root Cause
**File:** `src/components/ReportDashboard.tsx` **Line:** 48
`<ReportPanel config={{ threshold: 0.5, mode: 'summary', maxRows: 100 }} />`
creates a new object literal on every render of `ReportDashboard`. The
`config` prop received by `ReportPanel` has a different reference on every
render even though the values are identical. `useMemo` inside `ReportPanel`
lists `config` as a dependency and re-runs the expensive aggregation on
every parent render — effectively making the memo a no-op.

## Causal Chain
1. `ReportDashboard` renders — creates fresh `config` object literal at L48
2. `ReportPanel` receives `config` prop — new reference each time
3. `useMemo(() => runHeavyAggregation(data, config), [data, config])` runs
4. `config` reference has changed (new object) → memo invalidated
5. `runHeavyAggregation()` executes on every parent render regardless of
   whether threshold, mode, or maxRows actually changed
6. Parent re-renders on every user interaction (filter changes, row selection)
7. `runHeavyAggregation` runs ~30 times per second during active use
8. UI thread is saturated — interface becomes sluggish or unresponsive
Hops: 2 files (ReportDashboard → ReportPanel useMemo)

## Key AST Signals
- `ReportDashboard.tsx L48`: object literal `{ threshold: 0.5, mode: 'summary', maxRows: 100 }`
  passed directly as a JSX prop — a new object on every call
- No `useMemo` or `useCallback` wrapping the config object at the call site
- `ReportPanel.tsx`: `useMemo(() => ..., [data, config])` — `config` in dep array
- The dep array is correct in isolation; the problem is the reference instability upstream
- `runHeavyAggregation` appears in the mutation chain as a read of `config`
  fields — it is called every render, not occasionally

## The Fix
```diff
  function ReportDashboard() {
+   const reportConfig = useMemo(
+     () => ({ threshold: 0.5, mode: 'summary' as const, maxRows: 100 }),
+     []
+   );
+
-   return <ReportPanel config={{ threshold: 0.5, mode: 'summary', maxRows: 100 }} />;
+   return <ReportPanel config={reportConfig} />;
  }
```

## Why the Fix Works
`useMemo` with an empty dependency array creates the config object exactly
once and returns the same reference on every render. `ReportPanel`'s `useMemo`
now sees a stable `config` reference and only re-runs when `data` actually
changes — which is the intended behavior.

## Proximate Fixation Trap
The reporter blames `runHeavyAggregation` in `aggregations.ts` for being
too slow and begins optimizing the algorithm itself — memoizing sub-computations,
adding early exits, using more efficient data structures. These optimizations
reduce the per-call cost but the function still runs 30 times per second
rather than the intended 1-2 times. The algorithm is not the problem.

## Benchmark Metadata
- Category: `REACT_HOOKS`
- Difficulty: Hard
- Files: 5
- File hops from symptom to root cause: 2 (ReportPanel useMemo → ReportDashboard prop)
- Tests: ① RCA Accuracy ② Proximate Fixation Resistance ③ Cross-file Reasoning
