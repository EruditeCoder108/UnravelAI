/**
 * B-03: The Loyal Closure — bug.test.tsx
 *
 * Proves that useSearchDebounce fires searchDocuments with the query
 * value captured at the time useCallback was first created, NOT the
 * current query value when the debounce timer fires.
 *
 * These tests FAIL on the buggy code.
 */

import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import { renderHook, act } from '@testing-library/react';
import { useSearchDebounce } from '../src/hooks/useSearchDebounce';
import { searchCallLog, clearSearchLog } from '../src/services/searchService';

beforeEach(() => {
  clearSearchLog();
  vi.useFakeTimers();
});

afterEach(() => {
  vi.useRealTimers();
});

describe('B-03 useSearchDebounce — stale closure on query', () => {
  it('should fire searchDocuments with the LATEST query, not the initial one', async () => {
    // Start with 'react'
    const { rerender } = renderHook(
      ({ q }) => useSearchDebounce(q, 300),
      { initialProps: { q: 'react' } }
    );

    // Before the debounce fires, update the query to 'typescript'
    rerender({ q: 'typescript' });

    // Allow the debounce timer to fire
    await act(async () => {
      vi.advanceTimersByTime(400);
    });

    // The search should have been called with 'typescript' — the latest value.
    // BUG: it was called with 'react' — the value from the initial render.
    expect(searchCallLog).toHaveLength(1);
    expect(searchCallLog[0]).toBe('typescript');
  });

  it('should fire with the final query after multiple rapid changes', async () => {
    const { rerender } = renderHook(
      ({ q }) => useSearchDebounce(q, 300),
      { initialProps: { q: '' } }
    );

    // Simulate rapid typing
    rerender({ q: 'p' });
    rerender({ q: 'py' });
    rerender({ q: 'pyt' });
    rerender({ q: 'pyth' });
    rerender({ q: 'python' });

    await act(async () => {
      vi.advanceTimersByTime(400);
    });

    // Should fire once with the final value 'python'
    // BUG: fires with '' (the initial empty string from first render)
    expect(searchCallLog).toHaveLength(1);
    expect(searchCallLog[0]).toBe('python');
  });

  it('should NOT fire a search when query is empty', async () => {
    const { rerender } = renderHook(
      ({ q }) => useSearchDebounce(q, 300),
      { initialProps: { q: 'hello' } }
    );

    // Clear the query
    rerender({ q: '' });

    await act(async () => {
      vi.advanceTimersByTime(400);
    });

    // BUG: fires with 'hello' (initial value) even though current query is empty
    expect(searchCallLog).toHaveLength(0);
  });
});
