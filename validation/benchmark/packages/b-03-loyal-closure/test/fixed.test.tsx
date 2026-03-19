/**
 * B-03: The Loyal Closure — fixed.test.tsx
 *
 * Fix applied to src/hooks/useSearchDebounce.ts:
 *
 * BEFORE (buggy):
 *   const debouncedSearch = useCallback(() => {
 *     ...uses `query` and `delayMs` from stale closure...
 *   }, []); // ← empty deps
 *
 * AFTER (fixed — option 1, simplest):
 *   Remove useCallback entirely. Move the debounce logic directly into
 *   the useEffect. The effect already re-runs when `query` changes.
 *
 *   useEffect(() => {
 *     if (!query.trim()) { setResults([]); setIsLoading(false); return; }
 *     setIsLoading(true);
 *     const timer = setTimeout(async () => {
 *       try {
 *         const found = await searchDocuments(query);
 *         setResults(found);
 *         setError(null);
 *       } catch (err) {
 *         setError(err instanceof Error ? err.message : 'Search failed');
 *         setResults([]);
 *       } finally {
 *         setIsLoading(false);
 *       }
 *     }, delayMs);
 *     return () => clearTimeout(timer);
 *   }, [query, delayMs]);
 */

import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import { renderHook, act } from '@testing-library/react';
import { searchCallLog, clearSearchLog, searchDocuments } from '../src/services/searchService';
import { useState, useEffect } from 'react';
import { SearchResult } from '../src/services/searchService';

// Fixed version of the hook — debounce logic lives directly in useEffect
function useSearchDebounceFixed(query: string, delayMs: number = 300) {
  const [results, setResults] = useState<SearchResult[]>([]);
  const [isLoading, setIsLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
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

  return { results, isLoading, error };
}

beforeEach(() => {
  clearSearchLog();
  vi.useFakeTimers();
});

afterEach(() => {
  vi.useRealTimers();
});

describe('B-03 useSearchDebounce — correct closure (fixed)', () => {
  it('fires with the latest query after an update', async () => {
    const { rerender } = renderHook(
      ({ q }) => useSearchDebounceFixed(q, 300),
      { initialProps: { q: 'react' } }
    );

    rerender({ q: 'typescript' });

    await act(async () => {
      vi.advanceTimersByTime(400);
    });

    expect(searchCallLog).toHaveLength(1);
    expect(searchCallLog[0]).toBe('typescript');
  });

  it('fires once with the final query after rapid changes', async () => {
    const { rerender } = renderHook(
      ({ q }) => useSearchDebounceFixed(q, 300),
      { initialProps: { q: '' } }
    );

    rerender({ q: 'p' });
    rerender({ q: 'py' });
    rerender({ q: 'python' });

    await act(async () => {
      vi.advanceTimersByTime(400);
    });

    expect(searchCallLog).toHaveLength(1);
    expect(searchCallLog[0]).toBe('python');
  });

  it('fires no search when query is cleared', async () => {
    const { rerender } = renderHook(
      ({ q }) => useSearchDebounceFixed(q, 300),
      { initialProps: { q: 'hello' } }
    );

    rerender({ q: '' });

    await act(async () => {
      vi.advanceTimersByTime(400);
    });

    expect(searchCallLog).toHaveLength(0);
  });
});
