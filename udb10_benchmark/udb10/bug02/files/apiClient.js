// apiClient.js — makes API requests using shared config
import { defaultConfig } from './defaultConfig.js';

export async function makeRequest(url, options = {}) {
    // Merge options into config — but this MUTATES the shared defaultConfig.headers
    const config = defaultConfig;
    config.headers = { ...config.headers, ...options.headers };
    config.timeout = options.timeout || config.timeout;

    const res = await fetch(url, {
        headers: config.headers,
        signal: AbortSignal.timeout(config.timeout),
    });
    return res.json();
}
