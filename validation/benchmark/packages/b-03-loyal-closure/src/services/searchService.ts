export interface SearchResult {
  id: string;
  title: string;
  excerpt: string;
  score: number;
}

// Records every query string this service was called with.
// Used by tests to confirm which query actually reached the service.
export const searchCallLog: string[] = [];

/**
 * Performs a full-text search against the document index.
 * Returns ranked results for the given query string.
 */
export async function searchDocuments(query: string): Promise<SearchResult[]> {
  searchCallLog.push(query);

  // Simulate network latency
  await new Promise((r) => setTimeout(r, 10));

  if (!query.trim()) return [];

  // Stub results — in production this hits a search API
  return [
    {
      id: `result-${query}-1`,
      title: `Result for "${query}"`,
      excerpt: `This document matches the query "${query}"`,
      score: 0.95,
    },
    {
      id: `result-${query}-2`,
      title: `Another match for "${query}"`,
      excerpt: `Secondary result for "${query}"`,
      score: 0.82,
    },
  ];
}

export function clearSearchLog(): void {
  searchCallLog.length = 0;
}
