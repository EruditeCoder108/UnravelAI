async function loadDashboard(userId) {
    const [profile, posts, notifications] = await Promise.all([
        fetchProfile(userId),
        fetchPosts(userId),
        fetchNotifications(userId)
    ]);
    renderDashboard({ profile, posts, notifications });
}

async function fetchProfile(id) { return { name: 'Alice' }; }
async function fetchPosts(id) { return []; }
async function fetchNotifications(id) {
    if (Math.random() > 0.5) throw new Error('404 Not Found');
    return [];
}
