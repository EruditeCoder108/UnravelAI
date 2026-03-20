import React, { useState } from 'react';
import { ReportPanel } from './ReportPanel';
import { DataRow } from '../utils/aggregations';

interface ReportDashboardProps {
  data: DataRow[];
}

export function ReportDashboard({ data }: ReportDashboardProps) {
  const [activeFilter, setActiveFilter] = useState<string | null>(null);

  const filteredData = activeFilter
    ? data.filter((r) => r.category === activeFilter)
    : data;

  const categories = [...new Set(data.map((r) => r.category))];

  return (
    <div data-testid="report-dashboard">
      <div data-testid="filter-bar">
        {categories.map((cat) => (
          <button
            key={cat}
            onClick={() => setActiveFilter(cat === activeFilter ? null : cat)}
            data-testid={`filter-${cat}`}
          >
            {cat}
          </button>
        ))}
      </div>

      <ReportPanel
        data={filteredData}
        config={{ threshold: 0.5, mode: 'summary', maxRows: 100 }}
      />
    </div>
  );
}
