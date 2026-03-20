import { useState, useEffect } from 'react';
import { DataRow } from '../utils/aggregations';

export function useReportData(projectId: string) {
  const [data, setData] = useState<DataRow[]>([]);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    setLoading(true);
    setTimeout(() => {
      const rows: DataRow[] = Array.from({ length: 50 }, (_, i) => ({
        id: `row-${i}`,
        value: Math.random() * 100,
        category: ['alpha', 'beta', 'gamma'][i % 3],
        timestamp: Date.now() - i * 1000,
      }));
      setData(rows);
      setLoading(false);
    }, 10);
  }, [projectId]);

  return { data, loading };
}
