## Root Cause
**File:** `src/hooks/useSearchDebounce.ts` **Line:** 48  
`useCallback(() => { ... }, [])` — empty dependency array means the callback
is created once and never recreated. The `query` variable inside the callback
is captured from the first render's closure. All subsequent renders see a
new `query` prop but the `debouncedSearch` function still closes over the
original value and always searches for it.

## Causal Chain
1. `SearchBar` renders with `inputValue = ''`, calls `useSearchDebounce('')`
2. `useCallback` creates `debouncedSearch`, capturing `query = ''` in its closure
3. User types 'react' → `inputValue = 'react'` → `useSearchDebounce('react')` called
4. `useEffect` runs (dep `query` changed) → calls `debouncedSearch()`
5. `debouncedSearch` clears old timer, sets new `setTimeout` — but the callback
   inside `setTimeout` still closes over the captured `query = ''`
6. User types 'typescript' before 300ms → same process, timer reset
7. Timer fires: `searchDocuments('')` called — empty string, no results
Hops: 3 files (component passes query → hook captures it → service receives stale value)

## Key AST Signals
- Closure capture: `useSearchDebounce.ts` — `query` referenced inside `useCallback`
  callback at L48, defined in parent scope at L22
- `useCallback` dependency array at L57: `[]` — zero dependencies — AST confirms
  `query` is read inside the callback but not listed as a dependency
- `useEffect` at L60 correctly lists `[query, debouncedSearch]` — but `debouncedSearch`
  never changes (memoized with `[]`), so the effect's re-run on query change calls
  the same stale closure
- Contrast: if `useCallback` listed `[query, delayMs]`, a new closure would be created
  on each query change, capturing the current value

## The Fix
```diff
- const debouncedSearch = useCallback(() => {
-   if (timerRef.current) clearTimeout(timerRef.current);
-   if (!query.trim()) { setResults([]); setIsLoading(false); return; }
-   setIsLoading(true);
-   timerRef.current = setTimeout(async () => {
-     const found = await searchDocuments(query);
-     ...
-   }, delayMs);
- }, []); // ← stale closure
-
- useEffect(() => {
-   debouncedSearch();
-   return () => { if (timerRef.current) clearTimeout(timerRef.current); };
- }, [query, debouncedSearch]);
+ useEffect(() => {
+   if (!query.trim()) { setResults([]); setIsLoading(false); return; }
+   setIsLoading(true);
+   const timer = setTimeout(async () => {
+     try {
+       const found = await searchDocuments(query);
+       setResults(found);
+       setError(null);
+     } catch (err) {
+       setError(err instanceof Error ? err.message : 'Search failed');
+       setResults([]);
+     } finally { setIsLoading(false); }
+   }, delayMs);
+   return () => clearTimeout(timer);
+ }, [query, delayMs]);
```

## Why the Fix Works
Moving the debounce logic directly into `useEffect` removes the intermediate
`useCallback`. The effect body now captures `query` fresh on every execution
because the effect re-runs whenever `query` or `delayMs` changes. The cleanup
function cancels the previous timer, achieving the same debounce semantics
without any closure staleness.

## Proximate Fixation Trap
The reporter blames `SearchBar.tsx` because the symptom is visible at the
component level and `inputValue` is the prop being passed. The `isLoading`
guard in `SearchBar` looks like a plausible stale-render source. The actual
bug is in `useSearchDebounce.ts` — specifically the `[]` dependency array
on `useCallback`. The `useEffect` dependency array correctly lists `query`,
which makes the hook look correct at a glance — the subtle failure is that
`debouncedSearch` (which is also a dependency) never changes, so the hook
is calling the same stale function on every query change.

## Benchmark Metadata
- Category: `STALE_CLOSURE`
- Difficulty: Medium
- Files: 3
- File hops from symptom to root cause: 2 (component → hook, closure in hook)
- Tests: ① RCA Accuracy ② Proximate Fixation Resistance ③ Cross-file Reasoning
