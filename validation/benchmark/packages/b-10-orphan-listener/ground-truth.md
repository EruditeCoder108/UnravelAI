## Root Cause
**File:** `src/hooks/useScrollAnalytics.ts` **Lines:** 28–34  
The `useEffect` cleanup returns `() => window.removeEventListener('scroll', onScroll)`,
but `onScroll` is defined as an inline arrow function inside the effect body.
Every render creates a new `onScroll` function instance. The cleanup from
render N removes the `onScroll` from render N — but by then render N+1 has
already added a new one. The net effect is: every render adds a permanent
listener that is never removed. After 50 renders, 50 listeners fire on every
scroll event, sending 50 analytics events per scroll tick.

## Causal Chain
1. Component mounts → `onScroll_v1` created → `addEventListener('scroll', onScroll_v1)`
2. Parent re-renders (e.g. route param change) → effect cleanup fires:
   `removeEventListener('scroll', onScroll_v1)` ← correct so far
3. Effect re-runs → `onScroll_v2` created (new instance) → `addEventListener('scroll', onScroll_v2)`
4. Another re-render → cleanup removes `onScroll_v2`, adds `onScroll_v3`
   — this looks correct but...
5. React StrictMode (dev) double-invokes effects: mount → cleanup → remount
   With StrictMode the sequence in step 2-3 runs twice per mount, leaving
   two listeners after initial mount. In production (no StrictMode) the
   accumulation is slower but still happens on any prop change.
6. `AnalyticsService.track()` receives N calls per scroll instead of 1
7. API rate limits trigger — analytics dashboard shows impossible event counts
Hops: 4 files (PageView → useScrollAnalytics bug → AnalyticsService → API rate limit observed)

## Key AST Signals
- Closure capture: `onScroll` is defined inside `useEffect` callback body at L28
  and referenced in cleanup at L34 — same render scope, looks correct
- The subtle issue: `onScroll` is NOT in the dependency array (it's defined
  inside the effect, not outside it) but it IS a new function every render
  because the effect body re-executes on every render that has deps changes
- `useScrollAnalytics` dep array is `[pageId, analyticsService]` — both
  change on route navigation, triggering the cycle on every page change
- `addEventListener` at L30 paired with `removeEventListener` at L34 —
  AST shows both referencing `onScroll` from the same scope, which looks
  like a correct pattern. The bug is that the function is not stable across
  renders — it needs `useCallback` or to be defined outside the effect.

## The Fix
```diff
+ const onScroll = useCallback(() => {
+   const depth = Math.round((window.scrollY / document.body.scrollHeight) * 100);
+   analyticsService.track('scroll_depth', { pageId, depth });
+ }, [pageId, analyticsService]);
+
  useEffect(() => {
-   const onScroll = () => {
-     const depth = Math.round((window.scrollY / document.body.scrollHeight) * 100);
-     analyticsService.track('scroll_depth', { pageId, depth });
-   };
    window.addEventListener('scroll', onScroll, { passive: true });
    return () => window.removeEventListener('scroll', onScroll);
  }, [pageId, analyticsService, onScroll]);
```

## Why the Fix Works
`useCallback` with `[pageId, analyticsService]` produces a stable function
reference across renders until those deps change. The effect then registers
the stable reference, and cleanup removes the exact same reference.
Each dep change produces one cleanup + one new subscription — never more.

## Proximate Fixation Trap
The reporter blames `AnalyticsService.ts` because it is sending duplicate
events — the service's `track()` method is called multiple times per scroll.
Adding deduplication or rate-limiting inside `AnalyticsService` looks like
the fix. It would reduce symptoms but leave the accumulating listeners in
place, and they would still fire non-analytics scroll handlers (e.g. lazy
image loading) multiple times unnecessarily.

## Benchmark Metadata
- Category: `MEMORY_LEAK`
- Difficulty: Hard
- Files: 4
- File hops from symptom to root cause: 2 (PageView → useScrollAnalytics)
- Tests: ① RCA Accuracy ② Proximate Fixation Resistance ③ Cross-file Reasoning
