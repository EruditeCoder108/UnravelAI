// ═══════════════════════════════════════════════════
// UNRAVEL v3 — API Provider Caller
// Extracted from App.jsx for reuse across web + VSCode
// ═══════════════════════════════════════════════════

import { PROVIDERS } from './config.js';

/**
 * Fetch with exponential backoff retry.
 * Retries on 429 (rate limit) and 5xx (server errors).
 */
async function fetchWithRetry(url, options, retries = 4) {
    let delay = 1500;
    for (let i = 0; i < retries; i++) {
        try {
            const response = await fetch(url, options);
            if (!response.ok) {
                if (response.status === 429 || response.status >= 500) {
                    throw new Error(`HTTP ${response.status}`);
                }
                const errData = await response.json().catch(() => ({}));
                throw new Error(errData.error?.message || `API Error: ${response.status}`);
            }
            return await response.json();
        } catch (error) {
            if (i === retries - 1) throw error;
            await new Promise(r => setTimeout(r, delay));
            delay *= 2;
        }
    }
}

/**
 * Call any supported AI provider's API.
 *
 * @param {Object} opts
 * @param {string} opts.provider       - 'anthropic' | 'google' | 'openai'
 * @param {string} opts.apiKey         - The user's API key
 * @param {string} opts.model          - Model ID string
 * @param {string} opts.systemPrompt   - System/instruction prompt
 * @param {string} opts.userPrompt     - User prompt (schema instruction already appended by orchestrate.js)
 * @param {boolean} opts.useSchema     - Whether to attach structured output schema (Google only)
 * @param {Object} [opts.responseSchema] - Dynamic schema object for Gemini structured output
 * @returns {Promise<string>}          - Raw text response from the model
 */
export async function callProvider({ provider, apiKey, model, systemPrompt, userPrompt, useSchema = false, responseSchema = null }) {
    const prov = PROVIDERS[provider];
    if (!prov) throw new Error(`Invalid provider: ${provider}`);

    let url, headers, body;

    if (provider === 'google') {
        url = prov.endpoint(apiKey, model);
        headers = prov.headers();
        body = prov.buildBody(model, systemPrompt, userPrompt);
        if (useSchema && responseSchema) {
            body.generationConfig.responseSchema = responseSchema;
        }
    } else if (provider === 'anthropic') {
        // In browser: route through Netlify Function proxy to avoid CORS
        // In Node.js (VS Code): call Anthropic directly
        const isBrowser = typeof window !== 'undefined';
        if (isBrowser) {
            url = '/api/anthropic';
            headers = { 'Content-Type': 'application/json' };
            body = prov.buildBody(model, systemPrompt, userPrompt);
            body._apiKey = apiKey; // Proxy extracts this and forwards as x-api-key header
        } else {
            url = prov.endpoint;
            headers = prov.headers(apiKey);
            body = prov.buildBody(model, systemPrompt, userPrompt);
        }
    } else if (provider === 'openai') {
        url = prov.endpoint;
        headers = prov.headers(apiKey);
        // Schema instruction is already in userPrompt (appended by orchestrate.js)
        body = prov.buildBody(model, systemPrompt, userPrompt);
    }

    const data = await fetchWithRetry(url, {
        method: 'POST',
        headers,
        body: JSON.stringify(body),
    });

    return prov.parseResponse(data);
}
