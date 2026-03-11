async function saveUser(user) {
    return database.insert(user);
}

async function createUser(data) {
    try {
        saveUser(data);
        return { success: true };
    } catch (err) {
        console.error('Failed:', err);
        return { success: false };
    }
}
