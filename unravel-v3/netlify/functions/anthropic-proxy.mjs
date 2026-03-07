// ═══════════════════════════════════════════════════
// Netlify Function — Anthropic API Proxy
// Solves CORS: browser → Netlify Function → Anthropic API
// ═══════════════════════════════════════════════════

export default async (request) => {
    // Only allow POST
    if (request.method !== 'POST') {
        return new Response(JSON.stringify({ error: 'Method not allowed' }), {
            status: 405,
            headers: { 'Content-Type': 'application/json' },
        });
    }

    try {
        const body = await request.json();

        // The API key comes from the client (user's own key)
        const apiKey = body._apiKey;
        if (!apiKey) {
            return new Response(JSON.stringify({ error: 'Missing API key' }), {
                status: 400,
                headers: { 'Content-Type': 'application/json' },
            });
        }

        // Strip our internal field before forwarding
        delete body._apiKey;

        const response = await fetch('https://api.anthropic.com/v1/messages', {
            method: 'POST',
            headers: {
                'Content-Type': 'application/json',
                'x-api-key': apiKey,
                'anthropic-version': '2023-06-01',
            },
            body: JSON.stringify(body),
        });

        const data = await response.text();

        return new Response(data, {
            status: response.status,
            headers: {
                'Content-Type': 'application/json',
            },
        });
    } catch (err) {
        return new Response(JSON.stringify({ error: err.message }), {
            status: 500,
            headers: { 'Content-Type': 'application/json' },
        });
    }
};

export const config = {
    path: '/api/anthropic',
};
