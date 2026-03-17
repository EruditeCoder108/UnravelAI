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
            if (error.name === 'AbortError') throw error; // never retry a user abort
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
export async function callProvider({ provider, apiKey, model, systemPrompt, userPrompt, useSchema = false, responseSchema = null, signal = null }) {
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
        const isBrowser = typeof window !== 'undefined';
        if (isBrowser) {
            url = '/api/anthropic';
            headers = { 'Content-Type': 'application/json' };
            body = prov.buildBody(model, systemPrompt, userPrompt);
            body._apiKey = apiKey;
        } else {
            url = prov.endpoint;
            headers = prov.headers(apiKey);
            body = prov.buildBody(model, systemPrompt, userPrompt);
        }
    } else if (provider === 'openai') {
        url = prov.endpoint;
        headers = prov.headers(apiKey);
        body = prov.buildBody(model, systemPrompt, userPrompt);
    }

    const data = await fetchWithRetry(url, {
        method: 'POST',
        headers,
        body: JSON.stringify(body),
        ...(signal ? { signal } : {}),
    });

    return prov.parseResponse(data);
}

/**
 * Call any supported AI provider's streaming API.
 * Reads SSE chunks and invokes onChunk(textDelta) for each text fragment.
 * Returns the full accumulated text when the stream ends.
 * Falls back to callProvider() if streaming fails.
 *
 * @param {Object} opts - Same as callProvider plus onChunk
 * @param {function} opts.onChunk - Called with each text delta string
 * @returns {Promise<string>} - Full accumulated text response
 */
export async function callProviderStreaming({ provider, apiKey, model, systemPrompt, userPrompt, useSchema = false, responseSchema = null, onChunk, signal = null }) {
    const prov = PROVIDERS[provider];
    if (!prov) throw new Error(`Invalid provider: ${provider}`);

    try {
        let url, headers, body;

        if (provider === 'google') {
            url = `https://generativelanguage.googleapis.com/v1beta/models/${model}:streamGenerateContent?alt=sse&key=${apiKey}`;
            headers = prov.headers();
            body = prov.buildBody(model, systemPrompt, userPrompt);
            if (useSchema && responseSchema) {
                body.generationConfig.responseSchema = responseSchema;
            }
        } else if (provider === 'anthropic') {
            const isBrowser = typeof window !== 'undefined';
            if (isBrowser) {
                url = '/api/anthropic';
                headers = { 'Content-Type': 'application/json' };
                body = prov.buildBody(model, systemPrompt, userPrompt);
                body._apiKey = apiKey;
            } else {
                url = prov.endpoint;
                headers = prov.headers(apiKey);
                body = prov.buildBody(model, systemPrompt, userPrompt);
            }
            body.stream = true;
        } else if (provider === 'openai') {
            url = prov.endpoint;
            headers = prov.headers(apiKey);
            body = prov.buildBody(model, systemPrompt, userPrompt);
            body.stream = true;
        } else {
            return callProvider({ provider, apiKey, model, systemPrompt, userPrompt, useSchema, responseSchema, signal });
        }

        const response = await fetch(url, {
            method: 'POST',
            headers,
            body: JSON.stringify(body),
            ...(signal ? { signal } : {}),
        });

        if (!response.ok) {
            throw new Error(`Stream HTTP ${response.status}`);
        }

        // Read the SSE stream
        const reader = response.body.getReader();
        const decoder = new TextDecoder();
        let accumulated = '';
        let sseBuffer = '';

        while (true) {
            const { done, value } = await reader.read();
            if (done) break;

            sseBuffer += decoder.decode(value, { stream: true });

            // Process complete SSE lines
            const lines = sseBuffer.split('\n');
            // Keep the last incomplete line in the buffer
            sseBuffer = lines.pop() || '';

            for (const line of lines) {
                if (!line.startsWith('data: ')) continue;
                const payload = line.slice(6).trim();
                if (payload === '[DONE]') continue;

                try {
                    const parsed = JSON.parse(payload);
                    let textDelta = '';

                    if (provider === 'google') {
                        // Google SSE: {candidates: [{content: {parts: [{text: "..."}]}}]}
                        textDelta = parsed.candidates?.[0]?.content?.parts
                            ?.filter(p => p.text)
                            ?.map(p => p.text)
                            .join('') || '';
                    } else if (provider === 'anthropic') {
                        // Anthropic SSE: {type: "content_block_delta", delta: {type: "text_delta"|"thinking_delta", ...}}
                        // During extended thinking, delta.type === "thinking_delta" — no text content.
                        // We fire onChunk('') as a heartbeat so the progress bar stays alive
                        // instead of appearing frozen for the entire (potentially long) thinking phase.
                        if (parsed.type === 'content_block_delta') {
                            if (parsed.delta?.type === 'thinking_delta') {
                                onChunk?.(''); // heartbeat — nothing to accumulate
                            } else if (parsed.delta?.text) {
                                textDelta = parsed.delta.text;
                            }
                        }
                    } else if (provider === 'openai') {
                        // OpenAI SSE: {choices: [{delta: {content: "..."}}]}
                        textDelta = parsed.choices?.[0]?.delta?.content || '';
                    }

                    if (textDelta) {
                        accumulated += textDelta;
                        onChunk?.(textDelta);
                    }
                } catch {
                    // Skip unparseable SSE lines (e.g. event types, comments)
                }
            }
        }

        return accumulated;
    } catch (streamError) {
        // Re-throw AbortError — user clicked Terminate, never fall back silently
        if (streamError.name === 'AbortError') throw streamError;
        // Fallback: if streaming fails for any other reason, use non-streaming call
        console.warn('[Provider] Streaming failed, falling back to non-streaming:', streamError.message);
        return callProvider({ provider, apiKey, model, systemPrompt, userPrompt, useSchema, responseSchema, signal });
    }
}
