/**
 * B-10: Orphan Listener — bug.test.tsx
 *
 * Proves that useScrollAnalytics leaves orphaned scroll listeners on the
 * window after re-renders, causing multiple analytics events per scroll.
 *
 * Strategy: intercept window.addEventListener and window.removeEventListener
 * to count active 'scroll' listeners at any point in time.
 *
 * These tests FAIL on the buggy code.
 */

import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import { render, act, fireEvent } from '@testing-library/react';
import React from 'react';
import { PageView } from '../src/components/PageView';
import { AnalyticsService } from '../src/services/AnalyticsService';

// Track active scroll listeners by patching window event methods
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

describe('B-10 useScrollAnalytics — orphan listener accumulation', () => {
  it('should have exactly 1 scroll listener after mount', () => {
    const analytics = new AnalyticsService();
    render(<PageView pageId="home" analyticsService={analytics} />);

    // BUG: React StrictMode double-invokes effects → 2 listeners after mount
    expect(activeScrollListeners).toHaveLength(1);
  });

  it('should still have exactly 1 scroll listener after a re-render', async () => {
    const analytics = new AnalyticsService();
    const { getByTestId } = render(
      <PageView pageId="home" analyticsService={analytics} />
    );

    // Trigger a re-render without changing pageId
    await act(async () => {
      fireEvent.click(getByTestId('trigger-rerender'));
    });

    // BUG: a new listener is added each render, old ones not removed
    expect(activeScrollListeners).toHaveLength(1);
  });

  it('should fire exactly 1 analytics event per simulated scroll', async () => {
    const analytics = new AnalyticsService();
    const { getByTestId } = render(
      <PageView pageId="home" analyticsService={analytics} />
    );

    // Re-render twice to accumulate listeners
    await act(async () => { fireEvent.click(getByTestId('trigger-rerender')); });
    await act(async () => { fireEvent.click(getByTestId('trigger-rerender')); });

    analytics.clear();

    // Simulate a scroll event
    act(() => { fireEvent.scroll(window); });

    // BUG: multiple listeners each call track() → more than 1 event
    expect(analytics.getEventCount('scroll_depth')).toBe(1);
  });

  it('should have 0 scroll listeners after unmount', () => {
    const analytics = new AnalyticsService();
    const { unmount } = render(
      <PageView pageId="home" analyticsService={analytics} />
    );
    unmount();

    // BUG: orphan listeners remain after unmount
    expect(activeScrollListeners).toHaveLength(0);
  });
});
