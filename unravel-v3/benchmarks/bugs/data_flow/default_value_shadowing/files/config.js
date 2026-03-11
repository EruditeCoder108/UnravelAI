function buildRequestConfig(options = {}) {
    const timeout = options.timeout || 5000;
    const retries = options.retries || 3;
    const headers = options.headers || { 'Content-Type': 'application/json' };

    return { timeout, retries, headers };
}

const config = buildRequestConfig({ timeout: 0, retries: 0 });
console.log(config);
