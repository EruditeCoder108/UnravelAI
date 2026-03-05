import { dataStore } from './store.js';

const listEl = document.getElementById('rosterList');
const inputEl = document.getElementById('newName');
const addBtn = document.getElementById('addBtn');
const refreshBtn = document.getElementById('refreshBtn');

async function render() {
    listEl.innerHTML = "Loading...";
    // Asks Module A for the users. 
    // Always gets the stale cache after the first load!
    const users = await dataStore.fetchUsers();

    listEl.innerHTML = '';
    users.forEach(name => {
        const li = document.createElement('li');
        li.textContent = name;
        listEl.appendChild(li);
    });
}

addBtn.addEventListener('click', async () => {
    const name = inputEl.value;
    if (!name) return;

    // Uses Module B to push to server
    await dataStore.addNewUser(name);
    inputEl.value = '';

    // Developer expects render() to show the new user
    // Emergent bug: UI calls store.fetchUsers(), store returns stale cache.
    // The new user is in the database, but never appears on screen.
    render();
});

refreshBtn.addEventListener('click', () => {
    // Even an explicit UI refresh won't fix it, because the cache is locked!
    render();
});

// Initial load
render();
