// settingsService.js — handles user settings with optimistic updates
export async function saveSettings(userId, settings) {
    const res = await fetch(`/api/users/${userId}/settings`, {
        method: 'PUT',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(settings),
    });
    return res.json();
}
