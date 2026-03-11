import { appConfig } from './config.js';

export async function fetchData(endpoint) {
    const response = await fetch(`${appConfig.apiUrl}/${endpoint}`, {
        signal: AbortSignal.timeout(appConfig.timeout)
    });
    return response.json();
}
