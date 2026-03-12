// dataAggregator.js — fetches and merges data from multiple sources
export async function aggregateUserData(userId) {
    const results = { profile: null, orders: [], preferences: {} };

    async function fetchProfile() {
        const res = await fetch(`/api/users/${userId}/profile`);
        const data = await res.json();
        results.profile = data;
        // Also stamps a requestId onto results for tracing
        results.requestId = data.requestId;
    }

    async function fetchOrders() {
        const res = await fetch(`/api/users/${userId}/orders`);
        const data = await res.json();
        results.orders = data.items;
        // Overwrites requestId with orders requestId — race with fetchProfile
        results.requestId = data.requestId;
    }

    async function fetchPreferences() {
        const res = await fetch(`/api/users/${userId}/preferences`);
        const data = await res.json();
        results.preferences = data;
    }

    await Promise.all([fetchProfile(), fetchOrders(), fetchPreferences()]);

    return results;
}
