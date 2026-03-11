import { setCache, clearCache } from './cache.js';

export async function updateUser(id, data) {
    await fetch(`/api/users/${id}`, { method: 'PUT', body: JSON.stringify(data) });
    clearCache();
}
