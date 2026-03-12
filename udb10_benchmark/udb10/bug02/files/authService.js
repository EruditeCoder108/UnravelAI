// authService.js — adds auth header for authenticated requests
import { makeRequest } from './apiClient.js';

export async function fetchWithAuth(url, token) {
    // Passes Authorization header — this triggers mutation of defaultConfig.headers
    return makeRequest(url, {
        headers: { 'Authorization': `Bearer ${token}` },
    });
}

export async function fetchPublic(url) {
    // Intended to make a request with NO auth header.
    // But after fetchWithAuth runs once, defaultConfig.headers permanently
    // contains Authorization — so this call also sends the token.
    return makeRequest(url, {});
}
