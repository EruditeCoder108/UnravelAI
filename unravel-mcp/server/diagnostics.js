import { existsSync, readFileSync, readdirSync } from 'fs';
import { join, resolve } from 'path';
import { describeEmbeddingProvider } from './embedding-provider.js';
import { doctorCodex } from './codex.js';

function readJson(filePath) {
    try {
        if (!existsSync(filePath)) return null;
        return JSON.parse(readFileSync(filePath, 'utf-8'));
    } catch {
        return null;
    }
}

function countJsonArray(filePath) {
    const data = readJson(filePath);
    return Array.isArray(data) ? data.length : 0;
}

function countPatternEntries(filePath) {
    const data = readJson(filePath);
    if (!data) return 0;
    if (Array.isArray(data)) return data.length;
    if (Array.isArray(data.patterns)) return data.patterns.length;
    if (typeof data === 'object') return Object.keys(data).length;
    return 0;
}

function countCodexEntries(codexDir) {
    try {
        if (!existsSync(codexDir)) return 0;
        return readdirSync(codexDir).filter(n => /^codex-.+\.md$/i.test(n) && n !== 'codex-index.md').length;
    } catch {
        return 0;
    }
}

export function getProjectDiagnostics(projectRoot, freshness = null) {
    const root = resolve(projectRoot);
    const unravelDir = join(root, '.unravel');
    const graph = readJson(join(unravelDir, 'knowledge.json'));
    const meta = readJson(join(unravelDir, 'meta.json'));
    const nodes = graph?.nodes || [];
    const edges = graph?.edges || [];
    const codex = doctorCodex(root);

    return {
        projectRoot: root,
        kg: {
            present: !!graph,
            filesIndexed: meta?.filesIndexed || Object.keys(graph?.files || {}).length || 0,
            nodes: nodes.length,
            edges: edges.length,
            callEdges: edges.filter(e => e.type === 'calls' || e.type === 'call').length,
            importEdges: edges.filter(e => e.type === 'imports' || e.type === 'import').length,
            embeddedNodes: nodes.filter(n => n.embedding?.length > 0).length,
            schemaVersion: graph?.meta?.schemaVersion || null,
            engineVersion: graph?.meta?.engineVersion || null,
            builtAt: meta?.builtAt || graph?.meta?.builtAt || null,
        },
        memory: {
            patternStoreEntries: countPatternEntries(join(unravelDir, 'patterns.json')),
            diagnosisArchiveEntries: countJsonArray(join(unravelDir, 'diagnosis-archive.json')),
            taskCodexEntries: countCodexEntries(join(unravelDir, 'codex')),
            taskCodexStale: codex.stale.length,
            taskCodexUnreliable: codex.unreliable.length,
        },
        freshness: freshness || {
            checked: false,
            stale: null,
            changedFiles: [],
            reason: 'not checked',
        },
        embeddings: describeEmbeddingProvider(),
    };
}

export function formatDiagnostics(diag) {
    const lines = [];
    lines.push('Unravel Doctor');
    lines.push(`Project: ${diag.projectRoot}`);
    lines.push('');
    lines.push('Knowledge Graph');
    lines.push(`  present:       ${diag.kg.present}`);
    lines.push(`  files indexed: ${diag.kg.filesIndexed}`);
    lines.push(`  nodes:         ${diag.kg.nodes}`);
    lines.push(`  edges:         ${diag.kg.edges}`);
    lines.push(`  call edges:    ${diag.kg.callEdges}`);
    lines.push(`  import edges:  ${diag.kg.importEdges}`);
    lines.push(`  embedded:      ${diag.kg.embeddedNodes}`);
    lines.push(`  schema:        ${diag.kg.schemaVersion || 'unknown'}`);
    lines.push(`  engine:        ${diag.kg.engineVersion || 'unknown'}`);
    lines.push('');
    lines.push('Memory Layers');
    lines.push(`  patterns:      ${diag.memory.patternStoreEntries}`);
    lines.push(`  archive:       ${diag.memory.diagnosisArchiveEntries}`);
    lines.push(`  task codex:    ${diag.memory.taskCodexEntries}`);
    lines.push(`  codex stale:   ${diag.memory.taskCodexStale}`);
    lines.push(`  codex suspect: ${diag.memory.taskCodexUnreliable}`);
    lines.push('');
    lines.push('Freshness');
    lines.push(`  checked:       ${diag.freshness.checked}`);
    lines.push(`  stale:         ${diag.freshness.stale}`);
    lines.push(`  changed files: ${diag.freshness.changedFiles?.length || 0}`);
    lines.push(`  reason:        ${diag.freshness.reason || ''}`);
    lines.push('');
    lines.push('Embeddings');
    lines.push(`  provider:      ${diag.embeddings.provider}`);
    lines.push(`  model:         ${diag.embeddings.model}`);
    lines.push(`  semantic:      ${diag.embeddings.semanticSearch}`);
    lines.push(`  visual:        ${diag.embeddings.visualSearch}`);
    if (diag.embeddings.provider === 'gemini' && !process.env.GEMINI_API_KEY) {
        lines.push('  api key:       missing (only needed for semantic/visual embedding features)');
    }
    return lines.join('\n');
}
