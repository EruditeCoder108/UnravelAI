## Environment
- Node 20.11, pnpm 8.15, macOS 14.3
- React 18.2, Vite 5.1, TypeScript 5.4
- Performance regression noticed after PR #519 ("add configurable report thresholds")

## Symptom
The report dashboard is noticeably sluggish. Clicking any filter button
causes a visible delay before the UI updates. On machines with slower CPUs
the interface becomes unresponsive for ~200ms after each interaction. CPU
profiling shows `runHeavyAggregation` is executing on every single user
interaction, consuming 60-80% of the frame budget.

The `ReportPanel` component uses `useMemo` to cache the aggregation result.
The memo dependency array includes `data` and `config`. The memo should
prevent the aggregation from re-running unless those values change. Yet
profiling confirms it re-runs on every render.

I believe the issue is in `aggregations.ts`. The `runHeavyAggregation`
function itself must be causing unnecessary re-computation — perhaps the
`computedAt: Date.now()` at the end is making each result unique and
invalidating downstream memos. Alternatively the `byCategory` object
construction creates a new reference every call, which might be confusing
React's reconciliation.

## Stack trace
No crash. Performance degradation visible in profiler.
`runHeavyAggregation` appears in flame graph on every interaction.
Call count measured at 47 in a 3-second interaction session
(expected: 2-3 based on actual data changes).

## What I tried
- Removed `computedAt: Date.now()` from the return value — no improvement
- Memoized the `byCategory` reduction with a `useRef` cache — no improvement
- Wrapped `runHeavyAggregation` in a debounce — reduced call frequency
  but introduced a visible lag before results update
- Profiled to confirm `useMemo` in `ReportPanel` is invalidating on every
  render — it is

The bug must be in `aggregations.ts` — `runHeavyAggregation` is doing
something that causes React to see each result as a new value, defeating
the memo. The function needs to be made more referentially stable in its
output.
