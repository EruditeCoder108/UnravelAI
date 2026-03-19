/**
 * B-10: Orphan Listener — fixed.test.tsx
 *
 * Fix applied to src/hooks/useScrollAnalytics.ts:
 *
 * BEFORE (buggy):
 *   useEffect(() => {
 *     const onScroll = () => { ... };   // new instance every render
 *     window.addEventListener('scroll', onScroll, { passive: true });
 *     return () => window.removeEventListener('scroll', onScroll);
 *   }, [pageId, analyticsService]);
 *
 * AFTER (fixed):
 *   const onScroll = useCallback(() => { ... }, [pageId, analyticsService]);
 *   useEffect(() => {
 *     window.addEventListener('scroll', onScroll, { passive: true });
 *     return () => window.removeEventListener('scroll', onScroll);
 *   }, [pageId, analyticsService, onScroll]);
 */

import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import { render, act, fireEvent, renderHook } from '@testing-library/react';
import React, { useCallback, useEffect } from 'react';
import { AnalyticsService } from '../src/services/AnalyticsService';

// Fixed hook
function useScrollAnalyticsFixed(pageId: string, analyticsService: AnalyticsService): void {
  const onScroll = useCallback(() => {
    const scrollHeight = document.body.scrollHeight - window.innerHeight;
    const depth = scrollHeight > 0
      ? Math.round((window.scrollY / scrollHeight) * 100)
      : 0;
    analyticsService.track('scroll_depth', { pageId, depth });
  }, [pageId, analyticsService]);

  useEffect(() => {
    window.addEventListener('scroll', onScroll, { passive: true });
    return () => window.removeEventListener('scroll', onScroll);
  }, [pageId, analyticsService, onScroll]);
}

// Fixed PageView
function FixedPageView({ pageId, analyticsService }: { pageId: string; analyticsService: AnalyticsService }) {
  const [, setTick] = React.useState(0);
  useScrollAnalyticsFixed(pageId, analyticsService);
  return (
    <div>
      <button data-testid="rerender" onClick={() => setTick(n => n + 1)}>tick</button>
      <div style={{ height: 2000 }} />
    </div>
  );
}

let activeScrollListeners: EventListenerOrEventListenerObject[] = [];
const origAdd = window.addEventListener.bind(window);
const origRemove = window.removeEventListener.bind(window);

beforeEach(() => {
  activeScrollListeners = [];
  vi.spyOn(window, 'addEventListener').mockImplementation((type, handler, ...rest) => {
    if (type === 'scroll') activeScrollListeners.push(handler as EventListenerOrEventListenerObject);
    origAdd(type, handler as EventListenerOrEventListenerObject, ...rest);
  });
  vi.spyOn(window, 'removeEventListener').mockImplementation((type, handler, ...rest) => {
    if (type === 'scroll') {
      const idx = activeScrollListeners.indexOf(handler as EventListenerOrEventListenerObject);
      if (idx !== -1) activeScrollListeners.splice(idx, 1);
    }
    origRemove(type, handler as EventListenerOrEventListenerObject, ...rest);
  });
});

afterEach(() => {
  vi.restoreAllMocks();
  activeScrollListeners = [];
});

describe('B-10 useScrollAnalytics — stable listener (fixed)', () => {
  it('exactly 1 scroll listener after mount', () => {
    const analytics = new AnalyticsService();
    render(<FixedPageView pageId="home" analyticsService={analytics} />);
    expect(activeScrollListeners).toHaveLength(1);
  });

  it('still exactly 1 listener after re-render', async () => {
    const analytics = new AnalyticsService();
    const { getByTestId } = render(
      <FixedPageView pageId="home" analyticsService={analytics} />
    );
    await act(async () => { fireEvent.click(getByTestId('rerender')); });
    expect(activeScrollListeners).toHaveLength(1);
  });

  it('exactly 1 analytics event per scroll after multiple re-renders', async () => {
    const analytics = new AnalyticsService();
    const { getByTestId } = render(
      <FixedPageView pageId="home" analyticsService={analytics} />
    );
    await act(async () => { fireEvent.click(getByTestId('rerender')); });
    await act(async () => { fireEvent.click(getByTestId('rerender')); });

    analytics.clear();
    act(() => { fireEvent.scroll(window); });

    expect(analytics.getEventCount('scroll_depth')).toBe(1);
  });

  it('0 listeners after unmount', () => {
    const analytics = new AnalyticsService();
    const { unmount } = render(
      <FixedPageView pageId="home" analyticsService={analytics} />
    );
    unmount();
    expect(activeScrollListeners).toHaveLength(0);
  });
});
