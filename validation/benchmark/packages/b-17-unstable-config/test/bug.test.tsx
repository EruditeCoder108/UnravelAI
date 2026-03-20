import { describe, it, expect, beforeEach } from 'vitest';
import { render, fireEvent } from '@testing-library/react';
import React from 'react';
import { ReportDashboard } from '../src/components/ReportDashboard';
import { aggregationCallCount, resetAggregationCallCount, DataRow } from '../src/utils/aggregations';

const SAMPLE_DATA: DataRow[] = Array.from({ length: 20 }, (_, i) => ({
  id: `r${i}`,
  value: i * 5,
  category: ['alpha', 'beta'][i % 2],
  timestamp: Date.now() - i * 1000,
}));

beforeEach(() => resetAggregationCallCount());

describe('B-17 ReportDashboard — unstable config prop', () => {
  it('aggregation should run exactly once on initial mount', () => {
    render(<ReportDashboard data={SAMPLE_DATA} />);
    expect(aggregationCallCount).toBe(1);
  });

  it('aggregation should NOT re-run when a filter is clicked (data and config unchanged)', () => {
    const { getByTestId } = render(<ReportDashboard data={SAMPLE_DATA} />);
    resetAggregationCallCount();

    fireEvent.click(getByTestId('filter-alpha'));

    expect(aggregationCallCount).toBe(1);
  });

  it('aggregation runs at most once per distinct data change', () => {
    const { rerender } = render(<ReportDashboard data={SAMPLE_DATA} />);
    resetAggregationCallCount();

    rerender(<ReportDashboard data={SAMPLE_DATA} />);

    expect(aggregationCallCount).toBe(0);
  });
});
