import React, { useState } from 'react';
import { AnalyticsService } from '../services/AnalyticsService';
import { useScrollAnalytics } from '../hooks/useScrollAnalytics';

interface PageViewProps {
  pageId: string;
  analyticsService: AnalyticsService;
}

/**
 * Renders a page and tracks scroll analytics.
 *
 * The `viewCount` state causes re-renders when the button is clicked.
 * Each re-render triggers the useScrollAnalytics effect to re-run
 * (because analyticsService reference is stable, but in real usage
 * pageId changes on navigation — same effect either way).
 *
 * The duplicate analytics calls appear to come from user interactions
 * on this page, so developers look here first.
 */
export function PageView({ pageId, analyticsService }: PageViewProps) {
  const [viewCount, setViewCount] = useState(0);

  // Passes analyticsService as a dep — if this were recreated each render
  // it would also cause accumulation, but here it's stable (passed as prop).
  // The bug is in the hook regardless.
  useScrollAnalytics(pageId, analyticsService);

  return (
    <div data-testid="page-view">
      <h1 data-testid="page-title">Page: {pageId}</h1>
      <p data-testid="view-count">Rendered {viewCount} times</p>
      {/* Clicking this forces a re-render without changing pageId */}
      <button
        data-testid="trigger-rerender"
        onClick={() => setViewCount((n) => n + 1)}
      >
        Trigger re-render
      </button>
      <div style={{ height: 2000 }}>Scrollable content</div>
    </div>
  );
}
