import React, { useState } from 'react';

function SearchPage() {
  const [query, setQuery] = useState('');
  const [results, setResults] = useState([]);
  const [loading, setLoading] = useState(false);

  async function handleSearch(searchTerm) {
    setQuery(searchTerm);
    setLoading(true);

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
