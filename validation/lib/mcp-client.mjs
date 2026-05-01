import { Client } from '../../unravel-mcp/node_modules/@modelcontextprotocol/sdk/dist/esm/client/index.js';
import { StdioClientTransport } from '../../unravel-mcp/node_modules/@modelcontextprotocol/sdk/dist/esm/client/stdio.js';
import { resolve } from 'path';

export async function withUnravelMcp(fn, options = {}) {
    const repoRoot = resolve(import.meta.dirname, '..', '..');
    const cwd = options.cwd || resolve(repoRoot, 'unravel-mcp');
    const command = options.command || process.execPath;
    const args = options.args || [resolve(cwd, 'index.js')];
    const env = {
        ...process.env,
        GEMINI_API_KEY: options.geminiApiKey ?? '',
        UNRAVEL_EMBED_PROVIDER: options.embeddingProvider || 'none',
        ...(options.env || {}),
    };

    const transport = new StdioClientTransport({ command, args, cwd, env, stderr: 'pipe' });
    if (transport.stderr) transport.stderr.on('data', () => {});

    const client = new Client({ name: 'unravel-benchmark-client', version: '1.0.0' });
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
    return JSON.parse(textOf(result));
}

