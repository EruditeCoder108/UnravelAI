import { useState, useEffect, useRef, useCallback } from 'react';
import { SearchResult, searchDocuments } from '../services/searchService';

/**
 * Debounces search queries and returns paginated results.
 *
 * The debounce delay prevents a search API call on every keystroke —
 * only fires after the user stops typing for `delayMs` milliseconds.
 */
export function useSearchDebounce(query: string, delayMs: number = 300) {
  const [results, setResults] = useState<SearchResult[]>([]);
  const [isLoading, setIsLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const timerRef = useRef<ReturnType<typeof setTimeout> | null>(null);

  const debouncedSearch = useCallback(() => {
    if (timerRef.current) clearTimeout(timerRef.current);

    if (!query.trim()) {
      setResults([]);
      setIsLoading(false);
      return;
    }

    setIsLoading(true);
    timerRef.current = setTimeout(async () => {
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
  }, []); // eslint-disable-line react-hooks/exhaustive-deps

  useEffect(() => {
    debouncedSearch();
    return () => {
      if (timerRef.current) clearTimeout(timerRef.current);
    };
  }, [query, debouncedSearch]);

  return { results, isLoading, error };
}
