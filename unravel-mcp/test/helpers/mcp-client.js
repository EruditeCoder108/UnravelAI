import { Client } from '@modelcontextprotocol/sdk/client/index.js';
import { StdioClientTransport } from '@modelcontextprotocol/sdk/client/stdio.js';
import { resolve } from 'path';

export async function withUnravelMcp(fn, options = {}) {
    const cwd = options.cwd || resolve(import.meta.dirname, '..', '..');
    const command = options.command || process.execPath;
    const args = options.args || [resolve(cwd, 'index.js')];
    const env = {
        ...process.env,
        GEMINI_API_KEY: options.geminiApiKey ?? '',
        UNRAVEL_EMBED_PROVIDER: options.embeddingProvider || 'none',
        ...(options.env || {}),
    };

    const transport = new StdioClientTransport({ command, args, cwd, env, stderr: 'pipe' });
    if (transport.stderr) {
        transport.stderr.on('data', () => {});
    }
    const client = new Client({ name: 'unravel-test-client', version: '1.0.0' });
    await client.connect(transport);
    try {
        return await fn(client);
    } finally {
        await client.close();
    }
}

export function textOf(result) {
    return (result?.content || [])
        .filter(part => part.type === 'text')
        .map(part => part.text)
        .join('\n');
}

export function jsonOf(result) {
    const text = textOf(result);
    return JSON.parse(text);
}
