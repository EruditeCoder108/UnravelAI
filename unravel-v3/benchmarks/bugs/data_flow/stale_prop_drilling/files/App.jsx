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
  // When parent updates user.name to "Mukti", this does NOT re-initialize
  const [displayName, setDisplayName] = useState(defaultName); // line 25

  return <h1>Hello, {displayName}!</h1>;
  // Always shows "Hello, Guest!" even after login
}

export default App;
