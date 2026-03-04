// Bug 03: RACE_CONDITION — Two parallel fetches writing to same state
// Difficulty: Hard

export const metadata = {
    id: 'parallel_fetch_race',
    bugCategory: 'RACE_CONDITION',
    userSymptom: 'Search results sometimes show stale results from a previous query. Typing fast causes wrong data to appear.',
    trueRootCause: 'Two concurrent fetch calls race — the slower first request resolves after the faster second request, overwriting results with stale data. No abort controller or request ID check.',
    trueVariable: 'results',
    trueFile: 'bug03_race_condition.js',
    trueLine: 15,
    difficulty: 'hard',
};

export const code = `
import React, { useState } from 'react';

function SearchPage() {
  const [query, setQuery] = useState('');
  const [results, setResults] = useState([]);
  const [loading, setLoading] = useState(false);

  async function handleSearch(searchTerm) {
    setQuery(searchTerm);
    setLoading(true);

    // BUG: no abort controller — if user types fast,
    // two fetches race and the slower one wins
    const response = await fetch('/api/search?q=' + searchTerm);
    const data = await response.json(); // line 15

    setResults(data.items);  // stale fetch overwrites fresh results
    setLoading(false);
  }

  return (
    <div>
      <input
        type="text"
        value={query}
        onChange={e => handleSearch(e.target.value)}
        placeholder="Search..."
      />
      {loading && <p>Loading...</p>}
      <ul>
        {results.map(item => (
          <li key={item.id}>{item.title}</li>
        ))}
      </ul>
    </div>
  );
}

export default SearchPage;
`;
