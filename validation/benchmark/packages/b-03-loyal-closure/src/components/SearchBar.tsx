import React, { useState } from 'react';
import { useSearchDebounce } from '../hooks/useSearchDebounce';

/**
 * Full-text search bar with debounced API calls and result display.
 */
export function SearchBar() {
  const [inputValue, setInputValue] = useState('');
  const { results, isLoading, error } = useSearchDebounce(inputValue, 300);

  return (
    <div data-testid="search-bar">
      <input
        type="text"
        value={inputValue}
        onChange={(e) => setInputValue(e.target.value)}
        placeholder="Search documents..."
        data-testid="search-input"
        aria-label="Search"
      />

      {isLoading && (
        <div data-testid="loading-indicator" role="status">
          Searching...
        </div>
      )}

      {error && (
        <div data-testid="error-message" role="alert">
          {error}
        </div>
      )}

      {!isLoading && results.length > 0 && (
        <ul data-testid="results-list">
          {results.map((r) => (
            <li key={r.id} data-testid={`result-${r.id}`}>
              <strong>{r.title}</strong>
              <p>{r.excerpt}</p>
            </li>
          ))}
        </ul>
      )}

      {!isLoading && !error && inputValue.trim() && results.length === 0 && (
        <p data-testid="no-results">No results for &quot;{inputValue}&quot;</p>
      )}
    </div>
  );
}
