// ═══════════════════════════════════════════════════
// UNRAVEL v3 — API Provider Caller
// Extracted from App.jsx for reuse across web + VSCode
// ═══════════════════════════════════════════════════

import { PROVIDERS, ENGINE_SCHEMA, ENGINE_SCHEMA_INSTRUCTION } from './config.js';

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
 * @param {string} opts.provider      - 'anthropic' | 'google' | 'openai'
 * @param {string} opts.apiKey        - The user's API key
 * @param {string} opts.model         - Model ID string
 * @param {string} opts.systemPrompt  - System/instruction prompt
 * @param {string} opts.userPrompt    - User prompt with code + symptom
 * @param {boolean} opts.useSchema    - Whether to attach the ENGINE_SCHEMA
 * @returns {Promise<string>}         - Raw text response from the model
 */
export async function callProvider({ provider, apiKey, model, systemPrompt, userPrompt, useSchema = false }) {
    const prov = PROVIDERS[provider];
    if (!prov) throw new Error(`Invalid provider: ${provider}`);

    let url, headers, body;

    if (provider === 'google') {
        url = prov.endpoint(apiKey, model);
        headers = prov.headers();
        body = prov.buildBody(model, systemPrompt, userPrompt);
        if (useSchema) {
            body.generationConfig.responseSchema = ENGINE_SCHEMA;
        }
    } else if (provider === 'anthropic') {
        url = prov.endpoint;
        headers = prov.headers(apiKey);
        const schemaInstruction = useSchema ? ENGINE_SCHEMA_INSTRUCTION : '';
        body = prov.buildBody(model, systemPrompt, userPrompt + schemaInstruction);
    } else if (provider === 'openai') {
        url = prov.endpoint;
        headers = prov.headers(apiKey);
        const schemaInstruction = useSchema ? ENGINE_SCHEMA_INSTRUCTION : '';
        body = prov.buildBody(model, systemPrompt, userPrompt + schemaInstruction);
    }

    const data = await fetchWithRetry(url, {
        method: 'POST',
        headers,
        body: JSON.stringify(body),
    });

    return prov.parseResponse(data);
}
