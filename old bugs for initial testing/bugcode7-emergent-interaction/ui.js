import { dataStore } from './store.js';

const listEl = document.getElementById('rosterList');
const inputEl = document.getElementById('newName');
const addBtn = document.getElementById('addBtn');
const refreshBtn = document.getElementById('refreshBtn');

async function render() {
    listEl.innerHTML = "Loading...";
    // Asks Module A for the users.
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
    render();
});

refreshBtn.addEventListener('click', () => {
    // Even an explicit UI refresh won't fix it
    render();
});

// Initial load
render();
