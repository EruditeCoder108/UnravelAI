import React, { useEffect, useState } from 'react';

function UserProfile({ userId }) {
  const [user, setUser] = useState(null);

  useEffect(() => {
    async function loadUser() {
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
