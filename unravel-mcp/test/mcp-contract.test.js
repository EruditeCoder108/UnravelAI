import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, rmSync, writeFileSync } from 'fs';
import { tmpdir } from 'os';
import { join, resolve } from 'path';
import { withUnravelMcp, jsonOf } from './helpers/mcp-client.js';

const repoRoot = resolve(import.meta.dirname, '..', '..');
const ghostTenantDir = resolve(repoRoot, 'validation', 'benchmark', 'packages', 'super-bug-ghost-tenant');
const symptom = 'Concurrent tenant requests sometimes return documents from the wrong tenant. Cache keys and audit entries show the other tenant id.';

test('MCP startup exposes the stable reliability tool surface', async () => {
    await withUnravelMcp(async client => {
        const tools = await client.listTools();
        const names = tools.tools.map(t => t.name).sort();
        assert.deepEqual(names, ['analyze', 'build_map', 'consult', 'query_graph', 'query_visual', 'verify']);
    });
});

test('consult stays intentionally paused until reliability gates are complete', async () => {
    await withUnravelMcp(async client => {
        const result = await client.callTool({
            name: 'consult',
            arguments: { query: 'What does this project do?', directory: ghostTenantDir },
        });
        const payload = jsonOf(result);
        assert.equal(payload.status, 'TEMPORARILY_PAUSED');
        assert.match(payload.message, /intentionally frozen|temporarily paused/i);
    });
});

test('build_map, query_graph, analyze, verify, and query_visual keep their contracts', async () => {
    await withUnravelMcp(async client => {
        const build = jsonOf(await client.callTool({
            name: 'build_map',
            arguments: {
                directory: ghostTenantDir,
                embeddings: false,
                force: true,
                exclude: ['node_modules', '.unravel'],
            },
        }));
        assert.equal(build.status, 'ok');
        assert.equal(build.incremental, false);
        assert.ok(build.stats.filesIndexed > 0);
        assert.ok(build.stats.nodes > 0);
        assert.ok(build.stats.edges > 0);
        assert.ok(Number.isInteger(build.stats.callEdges));
        assert.ok(build.stats.callEdges > 0);

        const routed = jsonOf(await client.callTool({
            name: 'query_graph',
            arguments: { directory: ghostTenantDir, symptom: 'setTenant verifyTenantExists _activeTenant race', maxResults: 8 },
        }));
        assert.ok(Array.isArray(routed.relevantFiles));
        assert.ok(routed.relevantFiles.some(f => /TenantMiddleware\.ts$/.test(f)));
        assert.ok(routed.graphFreshness);
        assert.ok(routed.embeddingProvider);

        const analysis = jsonOf(await client.callTool({
            name: 'analyze',
            arguments: { directory: ghostTenantDir, symptom, detail: 'standard' },
        }));
        assert.ok(analysis.critical_signal);
        assert.ok(analysis.protocol);
        assert.ok(analysis.cross_file_graph);
        assert.ok(analysis.raw_ast_data);
        assert.ok(analysis.metadata);

        const missingHypotheses = jsonOf(await client.callTool({
            name: 'verify',
            arguments: {
                rootCause: 'TenantMiddleware.ts:64 writes tenant context before await.',
                evidence: ['TenantMiddleware.ts L64: setTenant(req.tenantId);'],
                codeLocation: 'TenantMiddleware.ts:64',
                minimalFix: 'Move setTenant after verifyTenantExists.',
            },
        }));
        assert.equal(missingHypotheses.verdict, 'PROTOCOL_VIOLATION');
        assert.equal(missingHypotheses.gate, 'HYPOTHESIS_GATE');

        const missingCitation = jsonOf(await client.callTool({
            name: 'verify',
            arguments: {
                rootCause: 'The tenant context is written before an await.',
                hypotheses: ['H1: global tenant context race'],
                evidence: ['TenantMiddleware.ts L64: setTenant(req.tenantId);'],
                codeLocation: 'TenantMiddleware.ts:64',
                minimalFix: 'Move setTenant after verifyTenantExists.',
            },
        }));
        assert.equal(missingCitation.verdict, 'PROTOCOL_VIOLATION');
        assert.equal(missingCitation.gate, 'EVIDENCE_CITATION_GATE');

        const fakeEvidence = jsonOf(await client.callTool({
            name: 'verify',
            arguments: {
                rootCause: 'TenantMiddleware.ts:64 writes tenant context before an await.',
                hypotheses: ['H1: global tenant context race', 'H2: cache key bug', 'H3: auth claim bug'],
                evidence: ['TenantMiddleware.ts L64: this text does not exist in the source file'],
                codeLocation: 'TenantMiddleware.ts:64',
                minimalFix: 'Move setTenant after verifyTenantExists.',
            },
        }));
        assert.notEqual(fakeEvidence.verdict, 'PASSED');
        assert.ok(fakeEvidence.failures.length > 0);

        const visual = await client.callTool({
            name: 'query_visual',
            arguments: { directory: ghostTenantDir, image: 'not-real-image-data', symptom: 'broken tenant UI' },
        });
        const visualPayload = jsonOf(visual);
        assert.match(visualPayload.error, /query_visual requires|GEMINI_API_KEY/i);
        assert.ok(visualPayload.embeddingProvider);
    });
});

test('query_graph self-heals small stale KGs before routing', async () => {
    const tempRoot = mkdtempSync(join(tmpdir(), 'unravel-self-heal-'));
    try {
        writeFileSync(join(tempRoot, 'a.ts'), 'export function alpha() { return beta(); }\nimport { beta } from "./b";\n', 'utf-8');
        writeFileSync(join(tempRoot, 'b.ts'), 'export function beta() { return "old"; }\n', 'utf-8');
        writeFileSync(join(tempRoot, 'c.ts'), 'export function gamma() { return "gamma"; }\n', 'utf-8');
        writeFileSync(join(tempRoot, 'd.ts'), 'export function delta() { return "delta"; }\n', 'utf-8');

        await withUnravelMcp(async client => {
            const build = jsonOf(await client.callTool({
                name: 'build_map',
                arguments: { directory: tempRoot, embeddings: false, force: true },
            }));
            assert.equal(build.status, 'ok');
            assert.equal(build.incremental, false);

            writeFileSync(join(tempRoot, 'b.ts'), [
                'export function beta() { return uniqueSelfHealMarker(); }',
                'export function uniqueSelfHealMarker() { return "fresh"; }',
                '',
            ].join('\n'), 'utf-8');

            const routed = jsonOf(await client.callTool({
                name: 'query_graph',
                arguments: { directory: tempRoot, symptom: 'uniqueSelfHealMarker fresh beta', maxResults: 4 },
            }));

            assert.equal(routed.graphFreshness.selfHealed, true);
            assert.equal(routed.graphFreshness.filesPatched, 1);
            assert.ok(routed.relevantFiles.some(f => /b\.ts$/.test(f)));
        });
    } finally {
        rmSync(tempRoot, { recursive: true, force: true });
    }
});
