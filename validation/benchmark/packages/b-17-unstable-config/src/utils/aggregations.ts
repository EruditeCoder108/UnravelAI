export interface ReportConfig {
  threshold: number;
  mode: 'summary' | 'detailed';
  maxRows: number;
}

export interface DataRow {
  id: string;
  value: number;
  category: string;
  timestamp: number;
}

export interface AggregationResult {
  total: number;
  average: number;
  aboveThreshold: DataRow[];
  byCategory: Record<string, number>;
  computedAt: number;
}

export let aggregationCallCount = 0;

export function resetAggregationCallCount(): void {
  aggregationCallCount = 0;
}

export function runHeavyAggregation(
  data: DataRow[],
  config: ReportConfig
): AggregationResult {
  aggregationCallCount++;

  const relevant = data.slice(0, config.maxRows);
  const total = relevant.reduce((sum, r) => sum + r.value, 0);
  const average = relevant.length > 0 ? total / relevant.length : 0;

  const aboveThreshold = relevant.filter(
    (r) => r.value > config.threshold * average
  );

  const byCategory = relevant.reduce<Record<string, number>>((acc, r) => {
    acc[r.category] = (acc[r.category] ?? 0) + r.value;
    return acc;
  }, {});

  return {
    total,
    average,
    aboveThreshold: config.mode === 'summary' ? [] : aboveThreshold,
    byCategory,
    computedAt: Date.now(),
  };
}
