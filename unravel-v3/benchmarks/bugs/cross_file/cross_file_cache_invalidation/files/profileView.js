import { getCache, setCache } from './cache.js';

export async function loadProfile(userId) {
    const cached = getCache(`user_${userId}`);
    if (cached) return cached;

    const data = await fetch(`/api/users/${userId}`).then(r => r.json());
    setCache(`user_${userId}`, data);
    return data;
}
