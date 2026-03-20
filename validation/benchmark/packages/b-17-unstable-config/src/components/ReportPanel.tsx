import React, { useMemo } from 'react';
import { ReportConfig, DataRow, runHeavyAggregation } from '../utils/aggregations';

interface ReportPanelProps {
  data: DataRow[];
  config: ReportConfig;
}

export function ReportPanel({ data, config }: ReportPanelProps) {
  const result = useMemo(
    () => runHeavyAggregation(data, config),
    [data, config]
  );

  return (
    <div data-testid="report-panel">
      <div data-testid="total">{result.total.toFixed(2)}</div>
      <div data-testid="average">{result.average.toFixed(2)}</div>
      <div data-testid="category-count">{Object.keys(result.byCategory).length}</div>
      <div data-testid="computed-at">{result.computedAt}</div>
    </div>
  );
}
