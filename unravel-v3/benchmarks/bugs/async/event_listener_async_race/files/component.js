let isMounted = false;
let userData = null;

async function handleButtonClick() {
    const data = await fetch('/api/user').then(r => r.json());
    userData = data;
    document.getElementById('user-name').textContent = data.name;
}

function mount() {
    isMounted = true;
    document.getElementById('btn').addEventListener('click', handleButtonClick);
}

function unmount() {
    isMounted = false;
    document.getElementById('user-name').remove();
}
