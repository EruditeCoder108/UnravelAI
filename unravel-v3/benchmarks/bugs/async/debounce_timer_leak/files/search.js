let timerId;

function handleInput(value) {
    timerId = setTimeout(() => {
        searchAPI(value);
    }, 300);
}

function searchAPI(query) {
    fetch(`/api/search?q=${query}`);
}

document.getElementById('search').addEventListener('input', e => handleInput(e.target.value));
