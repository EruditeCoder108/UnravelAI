// Bug 08: DATA_FLOW — Props not updating downstream component
// Difficulty: Medium

export const metadata = {
    id: 'stale_prop_drilling',
    bugCategory: 'DATA_FLOW',
    userSymptom: 'Child component always shows the initial user name "Guest" even after parent updates the user state after login.',
    trueRootCause: 'Parent passes user.name as defaultName prop. Child stores it in local useState, which only initializes once on mount — subsequent prop changes are ignored.',
    trueVariable: 'displayName',
    trueFile: 'bug08_data_flow.js',
    trueLine: 25,
    difficulty: 'medium',
};

export const code = `
import React, { useState } from 'react';

function App() {
  const [user, setUser] = useState({ name: 'Guest', loggedIn: false });

  function handleLogin() {
    // Simulating login — user.name updates
    setUser({ name: 'Mukti', loggedIn: true });
  }

  return (
    <div>
      <button onClick={handleLogin}>Log In</button>
      <Greeting defaultName={user.name} />
    </div>
  );
}

function Greeting({ defaultName }) {
  // BUG: useState initializes ONCE on mount with defaultName = "Guest"
  // When parent updates user.name to "Mukti", this does NOT re-initialize
  const [displayName, setDisplayName] = useState(defaultName); // line 25

  return <h1>Hello, {displayName}!</h1>;
  // Always shows "Hello, Guest!" even after login
}

export default App;
`;
