let currentUser = null;

async function fetchUserById(id) {
    const response = await fetch(`/api/users/${id}`);
    const data = await response.json();
    currentUser = data;
    renderUser(currentUser);
}

function renderUser(user) {
    document.getElementById('name').textContent = user.name;
}

document.getElementById('prev').addEventListener('click', () => fetchUserById(1));
document.getElementById('next').addEventListener('click', () => fetchUserById(2));
