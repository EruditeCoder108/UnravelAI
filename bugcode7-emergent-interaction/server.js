// FAKE SERVER API
const serverDB = ["Alice", "Bob", "Charlie"];

export const api = {
    getUsers: async () => {
        return new Promise(resolve => setTimeout(() => resolve([...serverDB]), 100));
    },
    addUser: async (name) => {
        return new Promise(resolve => setTimeout(() => {
            serverDB.push(name);
            resolve();
        }, 100));
    }
};
