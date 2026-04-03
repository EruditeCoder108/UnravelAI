// ═══════════════════════════════════════════════════════════════
// indexer.js — Knowledge Graph Indexer (Top-Level Orchestrator)
//
// Entry points:
//   buildKnowledgeGraph(files, options)        — full initial index
//   updateKnowledgeGraph(files, graph, options) — incremental update
//   queryGraphForFiles(graph, symptom, maxFiles) — re-exported
//
// ESM (matches the rest of the core pipeline).
// ═══════════════════════════════════════════════════════════════

import { GraphBuilder, mergeGraphUpdate } from './graph-builder.js';
import { detectLayers, applyLLMLayers } from './layer-detector.js';
import {
    buildFileAnalysisPrompt,
    buildProjectSummaryPrompt,
    parseFileAnalysisResponse,
    parseProjectSummaryResponse,
} from './llm-analyzer.js';
import {
    computeContentHashSync,
    getChangedFiles,
    saveGraph,
    saveMeta,
} from './graph-storage.js';
import { queryGraphForFiles } from './search.js';

// Re-export so orchestrate.js only needs one import for routing
export { queryGraphForFiles };

// ── Helpers ──────────────────────────────────────────────────────────────────

import { createRequire } from 'module';
// CJS bundle compat: esbuild sets import.meta to {} so import.meta.url → undefined.
// __filename is always defined in CJS (esbuild output). In native ESM, fall back to import.meta.url.
/* global __filename */
const _require = typeof __filename !== 'undefined'
    ? createRequire(__filename)
    : createRequire(import.meta.url);

function _currentGitHash(projectRoot) {
    try {
        const { execFileSync } = _require('child_process');
        return execFileSync('git', ['rev-parse', 'HEAD'], {
            cwd: projectRoot, encoding: 'utf-8', timeout: 3000,
        }).trim();
    } catch {
        return '';
    }
}

function _projectName(projectRoot) {
    if (!projectRoot) return 'unknown';
    return projectRoot.replace(/\\/g, '/').split('/').pop() || 'unknown';
}

function _pickSampleFiles(files) {
    const PRIORITY = ['index', 'main', 'app', 'server', 'config'];
    const sorted = [...files].sort((a, b) => {
        const aBase = (a.name || '').replace(/\\/g, '/').split('/').pop().toLowerCase();
        const bBase = (b.name || '').replace(/\\/g, '/').split('/').pop().toLowerCase();
        const aP = PRIORITY.findIndex(p => aBase.startsWith(p));
        const bP = PRIORITY.findIndex(p => bBase.startsWith(p));
        return (aP === -1 ? 999 : aP) - (bP === -1 ? 999 : bP);
    });
    return sorted.slice(0, 5).map(f => ({ path: f.name, content: f.content }));
}

// ── Core per-file analyzer ────────────────────────────────────────────────────

/**
 * Analyze a single file via LLM.
 * Falls back to empty metadata if the call fails.
 *
 * Bug #1 fix: callProvider takes a FLAT options object, not (messages[], options).
 * The response is a raw string — not { content }.
 */
async function _analyzeFile(filePath, content, projectContext, options) {
    const { callProvider, provider, apiKey, model } = options;
    const EMPTY_META = { fileSummary: '', tags: [], complexity: 'moderate', functionSummaries: {}, classSummaries: {} };

    if (!callProvider || !apiKey) return EMPTY_META;
    try {
        const userPrompt = buildFileAnalysisPrompt(filePath, content, projectContext);
        // Correct callProvider signature: single flat options object
        const response = await callProvider({
            provider,
            apiKey,
            model,
            systemPrompt: 'You are a code analysis assistant. Return only JSON.',
            userPrompt,
        });
        // callProvider returns a raw string, not { content }
        const llmText = typeof response === 'string' ? response : '';
        return parseFileAnalysisResponse(llmText) || EMPTY_META;
    } catch {
        return EMPTY_META;
    }
}

// ── buildKnowledgeGraph ───────────────────────────────────────────────────────

/**
 * Build a full knowledge graph from scratch.
 *
 * @param {Array<{name: string, content: string, structuralAnalysis?: object}>} files
 * @param {object} options
 * @param {string}   options.projectRoot
 * @param {Function} options.callProvider
 * @param {string}   options.provider
 * @param {string}   options.apiKey
 * @param {string}   options.model
 * @param {Function} [options.onProgress]
 * @param {boolean}  [options.save=true]
 * @param {boolean}  [options.useLLM=true]
 * @returns {object} KnowledgeGraph
 */
export async function buildKnowledgeGraph(files, options = {}) {
    const {
        projectRoot = '',
        callProvider,
        provider,
        apiKey,
        model,
        onProgress = () => {},
        save = true,
        useLLM = true,
    } = options;

    const total = files.length;
    const gitHash = projectRoot ? _currentGitHash(projectRoot) : '';
    const projectName = _projectName(projectRoot);

    // ── Step 1: Project-level summary (1 LLM call) ──
    let projectDescription = '';
    let frameworks = [];
    let llmLayersFromSummary = null;

    if (useLLM && callProvider && apiKey) {
        onProgress('Building project summary…', 0, total);
        try {
            const userPrompt = buildProjectSummaryPrompt(files.map(f => f.name), _pickSampleFiles(files));
            const response = await callProvider({
                provider, apiKey, model,
                systemPrompt: 'You are a code analysis assistant. Return only JSON.',
                userPrompt,
            });
            const llmText = typeof response === 'string' ? response : '';
            const summary = parseProjectSummaryResponse(llmText);
            if (summary) {
                projectDescription = summary.description;
                frameworks = summary.frameworks;
                llmLayersFromSummary = summary.layers && summary.layers.length > 0 ? summary.layers : null;
            }
        } catch { /* continue without project summary */ }
    }

    const projectContext = projectDescription || `Project: ${projectName}`;

    // ── Step 2: Per-file analysis ──
    const builder = new GraphBuilder(projectName, gitHash);

    for (let i = 0; i < files.length; i++) {
        const file = files[i];
        const filePath = file.name;
        const content = file.content || '';

        onProgress(`Indexing ${filePath.split('/').pop()} (${i + 1}/${total})…`, i + 1, total);

        const hash = computeContentHashSync(content);
        builder.setFileHash(filePath, hash);

        let llmMeta = null;
        if (useLLM && callProvider && apiKey) {
            llmMeta = await _analyzeFile(filePath, content, projectContext, { callProvider, provider, apiKey, model });
        }

        const structuralAnalysis = file.structuralAnalysis || null;

        if (structuralAnalysis) {
            builder.addFileWithAnalysis(filePath, structuralAnalysis, llmMeta || {});
            if (structuralAnalysis.imports) {
                for (const imp of structuralAnalysis.imports) {
                    if (imp.resolvedPath) builder.addImportEdge(filePath, imp.resolvedPath);
                }
            }
        } else {
            builder.addFile(
                filePath,
                (llmMeta && llmMeta.fileSummary) || '',
                (llmMeta && llmMeta.tags) || [],
                (llmMeta && llmMeta.complexity) || 'moderate'
            );
        }
    }

    // ── Step 3: Layer detection ──
    onProgress('Detecting layers…', total, total);
    const graphWithoutLayers = builder.build(projectDescription, frameworks);
    const layers = llmLayersFromSummary
        ? applyLLMLayers(graphWithoutLayers, llmLayersFromSummary)
        : detectLayers(graphWithoutLayers);

    const graph = builder.build(projectDescription, frameworks, layers);

    // ── Step 4: Persist ──
    if (save && projectRoot) {
        onProgress('Saving knowledge graph…', total, total);
        saveGraph(projectRoot, graph);
        saveMeta(projectRoot, {
            lastAnalyzedAt: new Date().toISOString(),
            gitCommitHash: gitHash,
            version: '1.0.0',
            schemaVersion: '1.0.0',
            analyzedFiles: files.length,
        });
    }

    onProgress('Knowledge graph ready.', total, total);
    return graph;
}

// ── updateKnowledgeGraph ──────────────────────────────────────────────────────

/**
 * Incremental update: re-index only files whose content hash changed.
 *
 * Bug #4 fix: structuralAnalysis is preserved through getChangedFiles() by
 * pre-attaching it to each file object before calling getChangedFiles().
 * getChangedFiles now carries structuralAnalysis through in its return objects.
 */
export async function updateKnowledgeGraph(currentFiles, existingGraph, options = {}) {
    const {
        projectRoot = '',
        callProvider,
        provider,
        apiKey,
        model,
        onProgress = () => {},
        save = true,
        useLLM = true,
    } = options;

    if (!existingGraph) {
        const graph = await buildKnowledgeGraph(currentFiles, options);
        return { graph, changedCount: currentFiles.length };
    }

    // Bug #4 fix: structuralAnalysis is already on each file object if provided
    // by the caller (e.g., after running ast-engine-ts). getChangedFiles will
    // carry it through to the changed-file objects.
    const changed = getChangedFiles(currentFiles, existingGraph, computeContentHashSync);

    if (changed.length === 0) {
        return { graph: existingGraph, changedCount: 0 };
    }

    const gitHash = projectRoot ? _currentGitHash(projectRoot) : (existingGraph.project && existingGraph.project.gitCommitHash) || '';
    const projectName = (existingGraph.project && existingGraph.project.name) || _projectName(projectRoot);
    const projectContext = (existingGraph.project && existingGraph.project.description) || `Project: ${projectName}`;

    const newNodes = [];
    const newEdges = [];
    const newFileHashes = {};

    for (let i = 0; i < changed.length; i++) {
        const file = changed[i];
        onProgress(`Re-indexing ${file.name.split('/').pop()} (${i + 1}/${changed.length})…`, i + 1, changed.length);

        newFileHashes[file.name] = file.hash;

        let llmMeta = null;
        if (useLLM && callProvider && apiKey) {
            llmMeta = await _analyzeFile(file.name, file.content, projectContext, { callProvider, provider, apiKey, model });
        }

        // structuralAnalysis is now carried through by getChangedFiles (Bug #4 fix)
        const structuralAnalysis = file.structuralAnalysis || null;
        const tempBuilder = new GraphBuilder(projectName, gitHash);

        if (structuralAnalysis) {
            tempBuilder.addFileWithAnalysis(file.name, structuralAnalysis, llmMeta || {});
            if (structuralAnalysis.imports) {
                for (const imp of structuralAnalysis.imports) {
                    if (imp.resolvedPath) tempBuilder.addImportEdge(file.name, imp.resolvedPath);
                }
            }
        } else {
            tempBuilder.addFile(
                file.name,
                (llmMeta && llmMeta.fileSummary) || '',
                (llmMeta && llmMeta.tags) || [],
                (llmMeta && llmMeta.complexity) || 'moderate'
            );
        }

        const partialGraph = tempBuilder.build();
        newNodes.push(...partialGraph.nodes);
        newEdges.push(...partialGraph.edges);
    }

    const merged = mergeGraphUpdate(existingGraph, changed.map(f => f.name), newNodes, newEdges, newFileHashes, gitHash);
    merged.layers = detectLayers(merged);

    if (save && projectRoot) {
        saveGraph(projectRoot, merged);
        saveMeta(projectRoot, {
            lastAnalyzedAt: new Date().toISOString(),
            gitCommitHash: gitHash,
            version: '1.0.0',
            schemaVersion: '1.0.0',
            analyzedFiles: currentFiles.length,
        });
    }

    return { graph: merged, changedCount: changed.length };
}
