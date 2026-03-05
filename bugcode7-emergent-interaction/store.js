import { api } from './server.js';

let cachedUsers = null;

export const dataStore = {
    // Module A: fetching logic with aggressive caching
    fetchUsers: async () => {
        if (!cachedUsers) {
            console.log("Cache miss. Fetching from API...");
            cachedUsers = await api.getUsers();
        } else {
            console.log("Cache hit! Returning fast.");
        }
        return cachedUsers;
    },

    // Module B: writing logic (written by a different dev)
    // BUG: This updates the SERVER, but forgets to invalidate `cachedUsers` in Module A!
    addNewUser: async (name) => {
        console.log("Sending new user to API...");
        await api.addUser(name);
    }
};
