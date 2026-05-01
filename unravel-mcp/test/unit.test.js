import test from 'node:test';
import assert from 'node:assert/strict';
import { queryGraphForFiles } from '../core/search.js';
import { computeContentHashSync, getChangedFiles } from '../core/graph-storage.js';
import { stampGraphMeta, inspectGraphFreshness } from '../server/graph-freshness.js';
import { describeEmbeddingProvider } from '../server/embedding-provider.js';

test('content hashes drive incremental freshness decisions', () => {
    const files = [{ name: 'src/a.ts', content: 'export const a = 1;' }];
    const graph = { files: { 'src/a.ts': computeContentHashSync(files[0].content) } };
    assert.equal(getChangedFiles(files, graph, computeContentHashSync).length, 0);

    const changed = [{ name: 'src/a.ts', content: 'export const a = 2;' }];
    assert.equal(getChangedFiles(changed, graph, computeContentHashSync).length, 1);
});

test('exact identifier routing beats vague graph expansion', () => {
    const graph = {
        nodes: [
            { id: 'file:a', type: 'file', name: 'src/a.ts', filePath: 'src/a.ts', summary: 'exports autoSeedCodex' },
            { id: 'file:b', type: 'file', name: 'src/b.ts', filePath: 'src/b.ts', summary: 'unrelated cache helper' },
        ],
        edges: [],
    };
    const ranked = queryGraphForFiles(graph, 'autoSeedCodex behavior', 3);
    assert.equal(ranked[0], 'src/a.ts');
});

test('graph metadata and provider diagnostics are stable contracts', () => {
    const graph = stampGraphMeta({ nodes: [], edges: [] }, { builtAt: 'test' });
    assert.equal(graph.meta.schemaVersion, 1);
    assert.ok(graph.meta.engineVersion);
    assert.equal(graph.meta.builtAt, 'test');

    const provider = describeEmbeddingProvider();
    assert.ok(['gemini', 'none', 'local'].includes(provider.provider));
    assert.equal(typeof provider.visualSearch, 'boolean');
});

test('freshness inspection marks stale embeddings when source files changed', () => {
    const graph = {
        nodes: [{ id: 'file:a', type: 'file', name: 'src/a.ts', filePath: 'src/a.ts', embedding: [1, 2, 3] }],
        edges: [],
        files: { 'src/a.ts': computeContentHashSync('old') },
    };
    const freshness = inspectGraphFreshness('project', graph, {
        readFilesFromDirectory: () => [{ name: 'src/a.ts', content: 'new' }],
        getChangedFiles,
        computeContentHashSync,
    });
    assert.equal(freshness.stale, true);
    assert.equal(freshness.markedStaleEmbeddings, 1);
    assert.equal(graph.nodes[0].embeddingStatus, 'stale_file_changed');
});

