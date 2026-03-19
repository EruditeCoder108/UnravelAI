
Root Cause
The bug is in useSearchDebounce.ts. The useCallback for debouncedSearch has an empty dependency array, so it closes over the initial value of query forever:
tsconst debouncedSearch = useCallback(() => {
  // ...
  timerRef.current = setTimeout(async () => {
    const found = await searchDocuments(query); // ← always the first query
  }, delayMs);
}, []); // ← never recreated, query is stale
Every time the user types, the useEffect fires (correctly, since query is in its deps), but it calls the same frozen debouncedSearch that captured the original query string from the first render.
The useCallback is also doing nothing useful here — debouncedSearch doesn't need a stable reference since it's only ever called inside the useEffect. The fix is to remove useCallback entirely and inline the logic directly in the effect, where query and delayMs are always in scope and always current:
tsuseEffect(() => {
  if (!query.trim()) {
    setResults([]);
    setIsLoading(false);
    return;
  }

  setIsLoading(true);
  const timer = setTimeout(async () => {
    try {
      const found = await searchDocuments(query);
      setResults(found);
      setError(null);
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Search failed');
      setResults([]);
    } finally {
      setIsLoading(false);
    }
  }, delayMs);

  return () => clearTimeout(timer);
}, [query, delayMs]);
The timerRef can go too — the cleanup function returned from useEffect handles cancellation correctly on its own. SearchBar.tsx and searchService.ts are both fine.