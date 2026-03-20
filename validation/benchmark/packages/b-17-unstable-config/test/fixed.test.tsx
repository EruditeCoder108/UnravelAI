/**
 * Fix: src/components/ReportDashboard.tsx
 *
 * BEFORE:
 *   <ReportPanel config={{ threshold: 0.5, mode: 'summary', maxRows: 100 }} />
 *
 * AFTER:
 *   const reportConfig = useMemo(
 *     () => ({ threshold: 0.5, mode: 'summary' as const, maxRows: 100 }),
 *     []
 *   );
 *   <ReportPanel config={reportConfig} />
 */

import { describe, it, expect, beforeEach } from 'vitest';
import { render, fireEvent } from '@testing-library/react';
import React, { useState, useMemo } from 'react';
import { ReportPanel } from '../src/components/ReportPanel';
import { aggregationCallCount, resetAggregationCallCount, DataRow } from '../src/utils/aggregations';

const SAMPLE_DATA: DataRow[] = Array.from({ length: 20 }, (_, i) => ({
  id: `r${i}`,
  value: i * 5,
  category: ['alpha', 'beta'][i % 2],
  timestamp: Date.now() - i * 1000,
}));

function FixedDashboard({ data }: { data: DataRow[] }) {
  const [activeFilter, setActiveFilter] = useState<string | null>(null);

  const reportConfig = useMemo(
    () => ({ threshold: 0.5, mode: 'summary' as const, maxRows: 100 }),
    []
  );

  const filteredData = activeFilter
    ? data.filter((r) => r.category === activeFilter)
    : data;

  const categories = [...new Set(data.map((r) => r.category))];

  return (
    <div>
      {categories.map((cat) => (
        <button key={cat} onClick={() => setActiveFilter(cat === activeFilter ? null : cat)} data-testid={`filter-${cat}`}>
          {cat}
        </button>
      ))}
      <ReportPanel data={filteredData} config={reportConfig} />
    </div>
  );
}

beforeEach(() => resetAggregationCallCount());

describe('B-17 ReportDashboard — stable config with useMemo (fixed)', () => {
  it('aggregation runs exactly once on mount', () => {
    render(<FixedDashboard data={SAMPLE_DATA} />);
    expect(aggregationCallCount).toBe(1);
  });

  it('filter click does not re-run aggregation when data subset is same', () => {
    const { getByTestId } = render(<FixedDashboard data={SAMPLE_DATA} />);
    resetAggregationCallCount();
    fireEvent.click(getByTestId('filter-alpha'));
    expect(aggregationCallCount).toBe(1);
  });

  it('re-render with same data produces zero extra aggregation calls', () => {
    const { rerender } = render(<FixedDashboard data={SAMPLE_DATA} />);
    resetAggregationCallCount();
    rerender(<FixedDashboard data={SAMPLE_DATA} />);
    expect(aggregationCallCount).toBe(0);
  });
});
