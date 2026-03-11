async function fetchWithRetry(url, retries = 3) {
    const attempts = [];

    for (let i = 0; i < retries; i++) {
        attempts.push(fetch(url).then(r => r.json()));
    }

    const results = await Promise.all(attempts);
    return results[results.length - 1];
}
