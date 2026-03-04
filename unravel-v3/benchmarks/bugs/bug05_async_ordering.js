// Bug 05: ASYNC_ORDERING — Value read before await resolves
// Difficulty: Easy

export const metadata = {
    id: 'missing_await',
    bugCategory: 'ASYNC_ORDERING',
    userSymptom: 'User profile page shows "Loading..." forever or displays undefined values. The data is fetched but never displayed.',
    trueRootCause: 'The await keyword is missing before the fetch call. userData is assigned the Promise object instead of the resolved value.',
    trueVariable: 'userData',
    trueFile: 'bug05_async_ordering.js',
    trueLine: 10,
    difficulty: 'easy',
};

export const code = `
import React, { useEffect, useState } from 'react';

function UserProfile({ userId }) {
  const [user, setUser] = useState(null);

  useEffect(() => {
    async function loadUser() {
      // BUG: missing 'await' — userData is a Promise, not the resolved data
      const userData = fetch('/api/users/' + userId)  // line 10
        .then(res => res.json());

      // This sets state to a Promise object, not the data
      setUser(userData);
    }

    loadUser();
  }, [userId]);

  if (!user) return <p>Loading...</p>;

  return (
    <div>
      <h1>{user.name}</h1>
      <p>{user.email}</p>
    </div>
  );
}

export default UserProfile;
`;
