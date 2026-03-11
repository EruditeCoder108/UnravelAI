import { useState, useEffect } from 'react';

function UserProfile({ userId }) {
    const [user, setUser] = useState(null);

    useEffect(() => {
        fetch(`/api/users/${userId}`)
            .then(r => r.json())
            .then(setUser);
    }, []);

    if (!user) return <div>Loading...</div>;
    return <div>{user.name}</div>;
}

export default UserProfile;
