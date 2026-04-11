#!/usr/bin/env node
// 
// Unravel MCP Server  Sandwich Architecture
//
// Zero-hallucination AST evidence provider for AI coding agents.
// Exposes 4 tools over STDIO (Model Context Protocol):
//
//   unravel.analyze     Run AST + routing, return deterministic evidence
//   unravel.verify      Cross-check agent's claims against real code
//   unravel.build_map   Build Knowledge Graph from files
//   unravel.query_graph  Ask KG which files are relevant to a symptom
//
// The "sandwich":
//   1. Agent calls unravel.analyze   (tm) gets structural facts (AST, mutations, etc.)
//   2. Agent's own LLM reasons      (tm) produces root cause, hypothesis tree, fix
//   3. Agent calls unravel.verify    (tm) every claim checked against real code
//   4. Agent presents verified fix   (tm) zero hallucination
//
// Usage:
//   npx unravel-mcp                     (STDIO transport)
//   claude mcp add unravel -- node path/to/unravel-mcp/index.js
//
// 

// 
// CRITICAL: Redirect ALL console output to stderr BEFORE importing anything.
//
// MCP uses STDIO transport: stdout is the JSON-RPC channel.
// The core engine (orchestrate.js, ast-engine-ts.js, ast-bridge.js, etc.)
// uses console.log() for diagnostics. If ANY of those writes hit stdout,
// the JSON-RPC framing breaks with "invalid character" errors.
//
// This must be the FIRST executable code in the file.
// 
const _origLog = console.log;
const _origWarn = console.warn;
const _origError = console.error;
const _origInfo = console.info;
const _origDebug = console.debug;

console.log   = (...args) => process.stderr.write('[unravel:log] '   + args.map(a => typeof a === 'string' ? a : JSON.stringify(a)).join(' ') + '\n');
console.warn  = (...args) => process.stderr.write('[unravel:warn] '  + args.map(a => typeof a === 'string' ? a : JSON.stringify(a)).join(' ') + '\n');
console.info  = (...args) => process.stderr.write('[unravel:info] '  + args.map(a => typeof a === 'string' ? a : JSON.stringify(a)).join(' ') + '\n');
console.debug = (...args) => process.stderr.write('[unravel:debug] ' + args.map(a => typeof a === 'string' ? a : JSON.stringify(a)).join(' ') + '\n');
// console.error already goes to stderr, but prefix it for consistency
console.error = (...args) => process.stderr.write('[unravel:error] ' + args.map(a => typeof a === 'string' ? a : JSON.stringify(a)).join(' ') + '\n');

// Also intercept console.group/groupEnd which orchestrate.js uses
console.group    = (...args) => process.stderr.write('[unravel:group] ' + args.map(a => typeof a === 'string' ? a : JSON.stringify(a)).join(' ') + '\n');
console.groupEnd = () => {};

import { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js';
import { StdioServerTransport } from '@modelcontextprotocol/sdk/server/stdio.js';
import { z } from 'zod';
import { readFileSync, existsSync, mkdirSync, writeFileSync, appendFileSync } from 'fs';
import { resolve, join, extname } from 'path';
import { readdirSync, statSync } from 'fs';
import { embedGraphNodes, embedChangedNodes, buildSemanticScores, embedCodexEntries, scoreCodexSemantic, embedText, embedImage, fuseEmbeddings, loadDiagnosisArchive, archiveDiagnosis, searchDiagnosisArchive } from './embedding.js';
import { runCircleIrAnalysis } from './circle-ir-adapter.js';
import childProcess from 'child_process';

//  Core engine imports 
// These are the same core files used by the webapp and VS Code extension.
// They're imported from the v3 core directory via relative path.
import { pathToFileURL } from 'url';

const CORE_PATH = resolve(import.meta.dirname, 'core');

// Tell ast-engine-ts.js where to find native tree-sitter packages.
// ast-engine-ts.js lives in unravel-v3/src/core which has no tree-sitter dep.
// Setting this env var makes createRequire() resolve from unravel-mcp/node_modules instead.
process.env.UNRAVEL_NATIVE_BASE = pathToFileURL(resolve(import.meta.dirname, 'package.json')).href;

/** Convert a file path to a file:// URL for ESM dynamic import (Windows safe) */
function coreModule(filename) {
    return pathToFileURL(join(CORE_PATH, filename)).href;
}

let orchestrate, verifyClaims, checkSolvability, initParser, runMultiFileAnalysis;
let runCrossFileAnalysis, selectFilesByGraph;
let GraphBuilder, mergeGraphUpdate, queryGraphForFiles, expandWeighted;
let saveGraph, loadGraph, getChangedFiles, computeContentHashSync, saveMeta;
let attachStructuralAnalysis, attachStructuralAnalysisToChanged;
let learnFromDiagnosis, penalizePattern, loadPatterns, savePatterns, matchPatterns, getPatternCount, getNodeBoosts;

let _coreLoadPromise = null;   // Singleton guard: only one load ever runs

async function loadCoreModules() {
    // If already loaded or loading, return the same Promise  no partial-state window
    if (_coreLoadPromise) return _coreLoadPromise;

    _coreLoadPromise = (async () => {
  try {
        const orchestrateModule = await import(coreModule('orchestrate.js'));
        orchestrate   = orchestrateModule.orchestrate;
        verifyClaims  = orchestrateModule.verifyClaims;
        checkSolvability = orchestrateModule.checkSolvability;

        const astEngine = await import(coreModule('ast-engine-ts.js'));
        initParser = astEngine.initParser;
        runMultiFileAnalysis = astEngine.runMultiFileAnalysis;

        const astProject = await import(coreModule('ast-project.js'));
        runCrossFileAnalysis = astProject.runCrossFileAnalysis;
        selectFilesByGraph = astProject.selectFilesByGraph;

        const graphBuilder = await import(coreModule('graph-builder.js'));
        GraphBuilder = graphBuilder.GraphBuilder || graphBuilder.default;
        mergeGraphUpdate = graphBuilder.mergeGraphUpdate;

        const search = await import(coreModule('search.js'));
        queryGraphForFiles = search.queryGraphForFiles;
        expandWeighted = search.expandWeighted;

        const storage = await import(coreModule('graph-storage.js'));
        saveGraph = storage.saveGraph;
        loadGraph = storage.loadGraph;
        getChangedFiles = storage.getChangedFiles;
        computeContentHashSync = storage.computeContentHashSync;
        saveMeta = storage.saveMeta;

        // Use the regex bridge for build_map structural analysis (imports/calls/functions)
        const bridge = await import(coreModule('ast-bridge.js'));
        attachStructuralAnalysis = bridge.attachStructuralAnalysis;
        attachStructuralAnalysisToChanged = bridge.attachStructuralAnalysisToChanged;

        // Pattern Store  learn from verified diagnoses, persist to .unravel/patterns.json
        const patternStore = await import(coreModule('pattern-store.js'));
        learnFromDiagnosis = patternStore.learnFromDiagnosis;
        penalizePattern    = patternStore.penalizePattern;
        loadPatterns       = patternStore.loadPatterns;
        savePatterns       = patternStore.savePatterns;
        matchPatterns      = patternStore.matchPatterns;
        getPatternCount    = patternStore.getPatternCount;
        getNodeBoosts      = patternStore.getNodeBoosts;

        // Pre-initialize the unified AST engine (native path in Node.js  no WASM needed).
        // ast-engine-ts.js now detects Node.js automatically and uses native tree-sitter bindings.
        // This call is a no-op after first invocation (cached via _initPromise).
        try {
            await initParser();
            process.stderr.write('[unravel-mcp] AST engine ready (native tree-sitter via ast-engine-ts.js)\n');
        } catch (initErr) {
            process.stderr.write(`[unravel-mcp] AST engine init warning: ${initErr.message}\n`);
        }
    } catch (err) {
        _coreLoadPromise = null; // reset so retry works
        throw err;
    }
  })();

    return _coreLoadPromise;
}


//  Session state 
// Persisted across tool calls within a session so the agent doesn't have to
// re-send files for every call.
const session = {
    files: [],              // { name, content }[]
    astRaw: null,           // AST detector output from last analyze
    crossFileRaw: null,     // Cross-file resolution from last analyze
    graph: null,            // Knowledge Graph from last build_map
    projectRoot: null,      // Working directory (for KG + pattern persistence)
    patternsLoaded: false,  // True after .unravel/patterns.json loaded for this project
    mcpPatternFile: null,   // Absolute path to unravel-mcp/.unravel/patterns.json (set on first analyze)
    // Phase 3c: Analyze result cache
    lastAnalysisHash: null,   // symptom + sorted filenames hash
    lastAnalysisResult: null, // cached return value from last analyze call
    // Phase 7a/7b: Diagnosis Archive
    diagnosisArchive: [],     // Loaded from .unravel/diagnosis-archive.json (once per session)
    archiveLoaded: false,     // True after archive loaded for this project
    lastSymptom: '',          // Symptom from last analyze() call — passed to archiveDiagnosis in verify()
};

//  Helper: read files from disk 
const CODE_EXTENSIONS = new Set([
    '.js', '.jsx', '.ts', '.tsx', '.mjs', '.cjs',
    '.py', '.java', '.go', '.rs', '.rb', '.cs', '.cpp', '.c', '.h',
    '.vue', '.svelte', '.html', '.css', '.json',
]);

function readFilesFromDirectory(dirPath, maxDepth = 5, excludePaths = []) {
    const files = [];
    const seen = new Set();

    // Normalize exclude list: resolve absolute, or treat as substring match
    const normalizedExcludes = (excludePaths || []).map(p => {
        try {
            // Try resolving as path relative to dirPath
            const abs = resolve(dirPath, p).replace(/\\/g, '/');
            return abs;
        } catch {
            return p.replace(/\\/g, '/');
        }
    });

    // Test file exclusion: intentional invalid state in mocks/fixtures causes
    // false positive pattern matches (deliberate race conditions, stale closures, etc.)
    const TEST_PATTERNS = [
        /[/\\]__tests__[/\\]/i,
        /[/\\]spec[/\\]/i,
        /[/\\]test[/\\]/i,
        /[/\\]mocks?[/\\]/i,
        /[/\\]fixtures?[/\\]/i,
        /\.test\.[jt]sx?$/i,
        /\.spec\.[jt]sx?$/i,
        /\.test\.d\.ts$/i,
    ];

    function isTestFile(fullPath) {
        return TEST_PATTERNS.some(p => p.test(fullPath.replace(/\\/g, '/')));
    }

    function isExcluded(fullPath) {
        if (!normalizedExcludes.length) return false;
        const normalized = fullPath.replace(/\\/g, '/');
        return normalizedExcludes.some(ex => normalized.startsWith(ex) || normalized.includes(ex));
    }

    function walk(currentPath, depth) {
        if (depth > maxDepth) return;
        let entries;
        try { entries = readdirSync(currentPath, { withFileTypes: true }); }
        catch { return; }

        for (const entry of entries) {
            const fullPath = join(currentPath, entry.name);

            if (isExcluded(fullPath)) continue;  // user-specified exclude

            // Skip common non-source directories
            if (entry.isDirectory()) {
                if (['node_modules', '.git', 'dist', 'build', '.next', '__pycache__',
                     'coverage', '.unravel', '.vscode', '.idea'].includes(entry.name)) continue;
                walk(fullPath, depth + 1);
                continue;
            }

            if (!entry.isFile()) continue;
            const ext = extname(entry.name).toLowerCase();
            if (!CODE_EXTENSIONS.has(ext)) continue;
            if (isTestFile(fullPath)) continue; // exclude test/spec/mock files

            const relativePath = fullPath.replace(dirPath, '').replace(/\\/g, '/').replace(/^\//, '');
            if (seen.has(relativePath)) continue;
            seen.add(relativePath);

            try {
                const content = readFileSync(fullPath, 'utf-8');
                // Skip very large files (> 500KB) to avoid memory issues
                if (content.length > 500_000) continue;
                files.push({ name: relativePath, content });
            } catch { /* skip unreadable files */ }
        }
    }

    walk(dirPath, 0);
    return files;
}
//  Helper: derive rich KG node metadata from AST structural analysis 
// Replaces the dumb "Functions: X, Y, Z" name-dump with semantic tags,
// a real role description, and a computed complexity score.
// Cost: zero (pure heuristic  no LLM calls).
function deriveNodeMetadata(filePath, sa, edgeCount = 0, content = '') {
    const fns    = (sa && sa.functions)  || [];
    const imps   = (sa && sa.imports)    || [];
    const lines  = (sa && sa.lineCount)  || 0;
    const fnNames   = fns.map(f => f.name);
    const asyncFns  = fns.filter(f => f.isAsync).length;
    const fp        = filePath.replace(/\\/g, '/');
    const fileName  = fp.split('/').pop() || fp;
    const stem      = fp.replace(/\.[^.]+$/, '').replace(/\//g, '-');
    const impSrcs   = imps.map(i => (i.source || '').toLowerCase());

    //  Semantic tags 
    const tags = [];
    if (fnNames.some(n => /\bmain\b/i.test(n)) || /\/index\.|\/cli\./.test(fp)) tags.push('entry-point');
    if (fnNames.some(n => /handler|route|middleware|listen|serve/i.test(n)))      tags.push('request-handler');
    if (fnNames.some(n => /embed|semantic|vector|cosine|similarity/i.test(n)))    tags.push('embeddings');
    if (fnNames.some(n => /graph|node|edge|builder|kg|knowledg/i.test(n)))        tags.push('knowledge-graph');
    if (fnNames.some(n => /\bast[A-Z_]|\bast$|\btreeSitter\b|analyzeFile|analyzeCode|analyz[eEiI]|detectPattern|detectBug|runMultiFile/i.test(n)) || /ast.engine|ast.bridge|ast.project/i.test(fp)) tags.push('ast-analysis');
    if (fnNames.some(n => /orchestrat|pipeline|phase|verif/i.test(n)))            tags.push('orchestration');
    if (fnNames.some(n => /search|query|match|rank|score/i.test(n)))              tags.push('search');
    if (fnNames.some(n => /save|load|persist|store|read|write|cache/i.test(n)))   tags.push('storage');
    if (fnNames.some(n => /codex|archive|memory|recall/i.test(n)))                tags.push('memory');
    if (fnNames.some(n => /format|render|display|output|report/i.test(n)))        tags.push('formatting');
    if (impSrcs.some(s => /express|fastify|koa|hono|http/.test(s)))               tags.push('http-server');
    if (impSrcs.some(s => /react|preact|vue|svelte/.test(s)))                     tags.push('ui-framework');
    if (edgeCount >= 10) tags.push('hub');
    else if (edgeCount >= 5) tags.push('connector');
    tags.push(stem); // always include stem as identifier

    //  Complexity score 
    let complexity = 'low';
    if      (fns.length > 20 || lines > 500 || asyncFns > 6) complexity = 'high';
    else if (fns.length > 8  || lines > 200 || asyncFns > 2) complexity = 'moderate';

    //  Role description (functional, not a function-name dump) 
    let role = '';
    if (tags.includes('entry-point') && edgeCount >= 5) {
        role = `Entry point / orchestration hub. ${fns.length} handler functions, ${imps.length} dependencies.`;
    } else if (tags.includes('embeddings') && tags.includes('search')) {
        const keyFns = fnNames.filter(n => /embed|search|score|archive/i.test(n)).slice(0, 4);
        role = `Semantic layer: embeddings + search. Key: ${keyFns.join(', ')}.`;
    } else if (tags.includes('orchestration')) {
        role = `Diagnostic pipeline. Runs the multi-phase analysis protocol. ${fns.length} functions.`;
    } else if (tags.includes('ast-analysis') && fns.length > 8) {
        role = `AST analysis engine. ${fns.length} detector/parser functions.`;
    } else if (tags.includes('knowledge-graph') && fns.length > 3) {
        role = `Knowledge graph construction and management. ${fns.length} functions.`;
    } else if (tags.includes('storage')) {
        role = `Storage layer. Reads/writes graph and metadata to disk.`;
    } else if (tags.includes('request-handler')) {
        role = `HTTP/MCP request handler. ${fns.length} handler functions.`;
    } else if (fns.length > 0) {
        const top = fnNames.slice(0, 5).join(', ');
        role = `${fns.length} functions: ${top}${fnNames.length > 5 ? '...' : ''}.`;
    } else {
        role = `${fileName} — ${imps.length > 0 ? `imports: ${imps.map(i => i.source || '').slice(0,3).join(', ')}` : 'no functions detected'}.`;
    }

    // Enrich fileSummary with JSDoc/TSDoc if present in raw source (zero cost)
    const _jsDoc = extractJsDocSummary(content);
    const fileSummary = _jsDoc ? `${_jsDoc} — ${role}`.slice(0, 200) : role;
    return { fileSummary, tags, complexity };
}

//  Helper: Project Overview  the senior dev's mental model 
// Auto-generated from KG topology. Stored at .unravel/project-overview.md.
// Injected as @0 in every consult call, giving the LLM architecture context
// before it sees low-level AST facts.
function generateProjectOverview(graph, projectRoot) {
    const nodes     = graph.nodes || [];
    const edges     = graph.edges || [];
    const fileNodes = nodes.filter(n => n.type === 'file' || !n.type);

    const edgeCountMap = new Map();
    for (const edge of edges) {
        if (edge.source) edgeCountMap.set(edge.source, (edgeCountMap.get(edge.source) || 0) + 1);
        if (edge.target) edgeCountMap.set(edge.target, (edgeCountMap.get(edge.target) || 0) + 1);
    }

    const topFiles = [...fileNodes]
        .sort((a, b) => (edgeCountMap.get(b.id || b.filePath || '') || 0) - (edgeCountMap.get(a.id || a.filePath || '') || 0))
        .slice(0, 12);

    const EXT_LANG = { '.js': 'JavaScript', '.ts': 'TypeScript', '.jsx': 'React/JSX', '.tsx': 'React/TSX', '.py': 'Python', '.go': 'Go', '.rs': 'Rust', '.java': 'Java' };
    const langSet = new Set();
    for (const n of fileNodes) {
        const fp = n.filePath || n.name || '';
        const ext = fp.slice(fp.lastIndexOf('.'));
        const lang = EXT_LANG[ext];
        if (lang) langSet.add(lang);
    }

    const builtAt = new Date().toISOString().slice(0, 10);
    const outLines = [
        `# Project Overview`,
        `*Auto-generated by Unravel on ${builtAt}. Edit the "## Notes" section — it is never overwritten.*`,
        ``,
        `## Architecture`,
        `**Language(s):** ${[...langSet].join(', ') || 'Multiple'}`,
        `**Scale:** ${fileNodes.length} files indexed · ${edges.length} relationships mapped · ${nodes.length} total KG nodes`,
        ``,
        `## Key Files (by connectivity)`,
    ];

    for (const n of topFiles) {
        const nodeId = n.id || n.filePath || n.name || '';
        const ec     = edgeCountMap.get(nodeId) || 0;
        const fp     = n.filePath || n.id || '';
        const sem    = (n.tags || []).filter(t => fp && !fp.includes(t) && t !== 'hub' && t !== 'connector').slice(0, 3).join(', ');
        const sum    = n.summary || '';
        outLines.push(`- **${fp}** (${ec} connections)${sem ? '  [' + sem + ']' : ''}`);
        if (sum) outLines.push(`  ${sum}`);
    }

    outLines.push(``);
    outLines.push(`## Critical Paths (import graph)`);
    const importEdges = edges.filter(e => e.type === 'imports');
    let pathsWritten = 0;
    for (const hub of topFiles.slice(0, 5)) {
        const hubId = hub.id || hub.filePath || hub.name || '';
        const deps  = importEdges
            .filter(e => e.source === hubId || e.source === `file:${hubId}`)
            .map(e => { const t = e.target.replace('file:', ''); return fileNodes.find(n => (n.filePath || n.id || '') === t)?.name || t.split('/').pop() || t; })
            .slice(0, 6);
        if (deps.length > 0) {
            const hubName = hub.name || hubId.split('/').pop() || hubId;
            outLines.push(`- ${hubName} → ${deps.join(', ')}`);
            pathsWritten++;
        }
        if (pathsWritten >= 4) break;
    }
    if (pathsWritten === 0) outLines.push('*(Call graph will populate as more files are analyzed)*');

    outLines.push(``);
    outLines.push(`## Risk Areas (from AST analysis)`);
    outLines.push(`*Populated by analyze → verify(PASSED) sessions. Debug more to grow this section.*`);
    outLines.push(``);
    outLines.push(`## Notes`);
    outLines.push(`*Add your own architecture notes, project goals, invariants, and decisions here. Never overwritten.*`);
    outLines.push(``);
    return outLines.join('\n');
}

function loadProjectOverview(projectRoot) {
    try {
        const p = join(projectRoot, '.unravel', 'project-overview.md');
        if (existsSync(p)) return readFileSync(p, 'utf8');
    } catch (e) { /* non-fatal */ }
    return null;
}

function saveProjectOverview(projectRoot, newContent) {
    try {
        const p = join(projectRoot, '.unravel', 'project-overview.md');
        mkdirSync(join(projectRoot, '.unravel'), { recursive: true });
        // Preserve the user's "## Notes" section  never overwrite it
        if (existsSync(p)) {
            const existing = readFileSync(p, 'utf8');
            const notesMatch = existing.match(/## Notes\n([\s\S]*)$/);
            if (notesMatch && notesMatch[1].trim()) {
                newContent = newContent.replace(/## Notes\n[\s\S]*$/, `## Notes\n${notesMatch[1]}`);
            }
        }
        writeFileSync(p, newContent, 'utf8');
    } catch (e) {
        process.stderr.write(`[unravel] Could not save project overview: ${e.message}\n`);
    }
}

// Enrich project overview Risk Areas after a verified diagnosis (verify PASSED).
function enrichProjectOverviewWithDiagnosis(projectRoot, { rootCause, codeLocation, symptom }) {
    try {
        const p = join(projectRoot, '.unravel', 'project-overview.md');
        if (!existsSync(p)) return;
        const date  = new Date().toISOString().slice(0, 10);
        const entry = `- [${date}] **${codeLocation || 'unknown'}**: ${(rootCause || '').slice(0, 150)}${rootCause && rootCause.length > 150 ? '...' : ''}  <- from: "${(symptom || '').slice(0, 80)}"`;
        let content = readFileSync(p, 'utf8');
        content = content.replace(
            /(## Risk Areas \(from AST analysis\)\n)([\s\S]*?)(\n## Notes)/,
            function(_, header, body, notesHeader) {
                const cleaned = body.replace('*Populated by analyze -> verify(PASSED) sessions. Debug more to grow this section.*', '').trim();
                const newBody = cleaned ? cleaned + '\n' + entry : entry;
                return header + newBody + '\n' + notesHeader;
            }
        );
        writeFileSync(p, content, 'utf8');
    } catch (e) { /* non-fatal */ }
}

//  Helper: resolve file inputs 
// Accepts either explicit file objects OR a directory path
function resolveFiles(args) {
    if (args.files && Array.isArray(args.files) && args.files.length > 0) {
        return args.files.map(f => ({
            name: f.name || f.path || 'unknown',
            content: f.content || '',
        }));
    }

    if (args.directory) {
        const dirPath = resolve(args.directory);
        if (!existsSync(dirPath)) {
            throw new Error(`Directory not found: ${dirPath}`);
        }
        session.projectRoot = dirPath;
        return readFilesFromDirectory(dirPath);
    }

    // Use session files if available
    if (session.files.length > 0) {
        return session.files;
    }

    throw new Error('No files provided. Pass "files" (array of {name, content}) or "directory" (path to project root). \n\nSTRATEGY: If this is a large repo and you dont know which files to pick, call unravel.build_map(directory) first, then use unravel.query_graph(symptom) to find candidates.');
}

// 
// MCP Server Setup
// 

const server = new McpServer(
    {
        name: 'unravel',
        version: '1.0.0',
    },
    {
        instructions: [
            'Unravel is a deterministic bug-diagnosis engine. It uses static AST analysis to extract verified structural facts from code — mutation chains, closure captures, async boundaries, race conditions — and returns them as ground truth that cannot be hallucinated.',
            '',
            '## The Sandwich Protocol',
            'Unravel enforces a 3-layer deterministic workflow:',
            '1. BASE (Evidence):  Call `analyze` with bug files + symptom → get AST-verified facts.',
            '2. FILLING (Reasoning): YOU reason through the 11-phase structured pipeline. Key mandatory phases:',
            '   - Phase 3 (Hypothesis Generation): Generate exactly 3 mutually exclusive competing hypotheses — distinct root mechanisms, NOT variations of the same idea. State falsifiableIf[] for each. EXCEPTION: if you are absolutely certain the bug is trivially obvious (e.g. a missing semicolon, typo, or simple syntax error), you may submit just 1 hypothesis — but you MUST state your reasoning inline as "trivially obvious because: [one sentence]." Without that justification, the exception does not apply. If there is any ambiguity, generate 3.',
            '   - Phase 3.5 (Hypothesis Expansion): Runs AFTER Phase 4 reveals the full dependency map. Add at most 2 new hypotheses if cross-file mechanisms were invisible before. Hypothesis space CLOSES permanently after this — no additions past Phase 3.5.',
            '   - Phase 4 (Evidence Map): For each hypothesis, produce evidenceMap[] with supporting[], contradicting[], missing[] and a verdict: SUPPORTED / CONTESTED / UNVERIFIABLE / SPECULATIVE.',
            '   - Phase 5 (Hypothesis Elimination): Test each hypothesis against AST evidence. Every eliminated hypothesis MUST cite the exact code fragment (file + line) that kills it.',
            '   - Phase 5.5 (Adversarial Confirmation): Actively try to disprove each surviving hypothesis. PRE-CHECK FIRST: list all ✓ annotations — off-limits for adversarial disproof. If adversarial kills a hypothesis, re-enter Phase 3.5 to add a replacement (max 2 re-entry rounds). If 2+ hypotheses survive all attacks, set multipleHypothesesSurvived: true — do NOT force a single winner.',
            '   - Phases 8+8.5 (Invariants + Fix-Invariant Check): State what must always be true. Check the fix satisfies every invariant. Revise once if violated.',
            '3. TOP (Verification): Call `verify` with your rootCause, evidence[], codeLocation, and minimalFix → Unravel checks every claim against real code. Your diagnosis is NOT valid until verify returns PASSED.',
            '',
            '## When to Use Each Tool',
            '',
            '### `analyze` — Start here for any bug',
            'Input: files (array of {name, content}) or directory (path), plus symptom (bug description).',
            'Output: Deterministic AST evidence + the `_instructions` block containing the full 11-phase reasoning protocol and 16 hard rules you MUST follow.',
            'Use when: A user reports a bug, unexpected behavior, or asks you to debug code.',
            '',
            '### `verify` — End here for every diagnosis',
            'Input: rootCause (with file:line citation), evidence[], codeLocation, minimalFix, hypotheses[] — all from YOUR diagnosis.',
            'Output: PASSED / REJECTED / PROTOCOL_VIOLATION verdict.',
            'HARD GATES — verify rejects before checking any claim if:',
            '  (1) hypotheses[] is missing or empty → PROTOCOL_VIOLATION: HYPOTHESIS_GATE (Phase 3 was skipped)',
            '  (2) rootCause contains no file:line citation → PROTOCOL_VIOLATION: EVIDENCE_CITATION_GATE',
            'Use when: You have completed the 11-phase reasoning pipeline and produced a diagnosis. Call verify BEFORE presenting your fix to the user.',
            '',
            '### `build_map` — Use for large repos',
            'Input: directory (project root path).',
            'Output: Knowledge Graph with nodes (files, functions, classes) and edges (imports, calls, mutations).',
            'Use when: The project is large (50+ files) and you need to figure out WHICH files are relevant to the bug. Build the graph once, then query it.',
            '',
            '### `query_graph` — Use after build_map',
            'Input: symptom (bug description).',
            'Output: Ranked list of relevant files.',
            'Use when: You have a Knowledge Graph built and need to find which files to pass to `analyze`.',
            '',
            '## Decision Flowchart',
            '1. User reports a bug.',
            '2. Do you know which files are relevant?',
            '   - YES → Call `analyze(files, symptom)` directly.',
            '   - NO, and repo is small (<30 files) → Call `analyze(directory, symptom)` to analyze all files.',
            '   - NO, and repo is large → Call `build_map(directory)`, then `query_graph(symptom)`, then `analyze(files, symptom)` with the results.',
            '   - NO, and you have a screenshot of a broken UI → Call `build_map(directory)`, then `query_visual(image, symptom)`, then `analyze(files, symptom)`.',
            '3. Read the `_instructions` block in the analyze output — especially `_instructions.pipelineReminder`. Follow all 11 phases.',
            '4. Produce your diagnosis (rootCause, evidence[], codeLocation, minimalFix, hypotheses[]).',
            '5. Call `verify(rootCause, evidence, codeLocation, minimalFix, hypotheses)`. hypotheses[] is REQUIRED — omitting it triggers PROTOCOL_VIOLATION before any claim is checked.',
            '6. If PASSED → present the fix. If REJECTED → revise your diagnosis and re-verify.',
            '',
            '## Critical Rules',
            '',
            'MUST:',
            '- Call `verify` before presenting any diagnosis to the user',
            '- Cite file:line locations from the AST evidence — never guess line numbers',
            '- Trace state BACKWARDS through mutation chains — the crash site is never automatically the root cause',
            '- Generate 3 competing hypotheses with distinct mechanisms (not variations of the same idea)',
            '- List all ✓ annotations before Phase 5.5 — they are deterministic spec facts, off-limits for disproof',
            '- Cap confidence at 0.75 for hypotheses that survived only by elimination (no positive evidence)',
            '- Require ≥2 distinct AST-verified code citations for STRONG confidence',
            '',
            'DO NOT:',
            '- Contradict AST evidence — it is deterministic ground truth',
            '- Skip Phase 3 — verify rejects with PROTOCOL_VIOLATION if hypotheses[] is absent',
            '- Combine hypotheses — each must have a distinct falsifiable mechanism',
            '- Jump to solution before completing hypothesis elimination',
            '- Override ✓ annotations with speculation, edge-case reasoning, or absence of a test',
            '',
            'EXCEPTION (trivial bugs only):',
            '- If you are absolutely certain the bug is trivially obvious (missing semicolon, typo, simple syntax error), you may submit just 1 hypothesis instead of 3. Use this ONLY when confident beyond doubt.',
            '',
            '## Extended Capabilities — Use Your Environment Tools',
            'Unravel provides deterministic structural evidence. But you also have access to web search and script execution in your environment. Use them — they complement each other.',
            '',
            '### When to search the web',
            'You should proactively search when:',
            '- You need the LATEST version of a dependency (Node.js, tree-sitter, a library) — never assume the version in package.json is current.',
            '- An API, tool, or framework has changed recently and the code under analysis may be using a deprecated pattern.',
            '- You encounter a cryptic error message or an unfamiliar runtime behavior — search for known issues first before hypothesizing.',
            '- You need official documentation for a specific function signature, configuration format, or protocol spec.',
            '- You are stuck after evidence is ambiguous — search for prior art, known bugs, or CVEs related to the pattern.',
            'Example queries: "tree-sitter typescript grammar 0.23 breaking changes", "node.js 22 AsyncLocalStorage behavior", "MCP SDK notifications/progress API 2025".',
            '',
            '### When to run scripts',
            'You should run code in the environment when:',
            '- You want to verify a hypothesis with a minimal reproduction — write and run it rather than speculating.',
            '- The project has a test suite — run it after proposing a fix to confirm no regressions before presenting to the user.',
            '- You need to inspect actual runtime values (not static structure) — Unravel gives you the structure; running the code gives you the values.',
            '- You want to confirm that your fix compiles / parses correctly before claiming it is correct.',
            '',
            '### Judgment rule',
            'If Unravel\'s AST evidence is sufficient — DO NOT search or run. Use external tools only when they add information that static analysis cannot provide. The goal is a verified fix, not maximum tool calls.',
            '',
            '## Task Codex — Context That Survives Across Files and Sessions',
            '',
            '### The Problem It Solves',
            'When you read 4+ files in a single session, earlier files decay into vague impressions. By file 5, the specific line number and invariant you found in file 1 is gone. You are making edits using summaries of summaries. The Task Codex is the fix.',
            '',
            '### When to create a codex',
            'Create one when: the task touches 3+ files, OR the session will last longer than ~30 minutes, OR you are about to read a large file (1000+ lines) to find one specific thing.',
            'Do NOT create one for: single-file fixes, trivial typo corrections, or tasks where you already know the exact line.',
            '',
            '### How to start',
            '1. Check query_graph — if it returned a pre_briefing, READ IT FIRST before opening any source file. It already contains discoveries from a past session. Go directly to the specific lines it cites.',
            '2. If no pre_briefing: create `.unravel/codex/codex-{taskId}.md` where taskId is a short slug (e.g. `payment-fix-001`, `auth-race-002`). Write the ## Meta section immediately.',
            '',
            '### What to write — the 4 entry types (ONLY these 4)',
            'Codex is a detective\'s notebook, NOT a wiki. Every entry must answer: "What did I find vs what I was looking for?" — not "what does this file do in general."',
            '',
            '- BOUNDARY: A section does NOT have what you need. "L1—œL80 → BOUNDARY: NOT relevant to payment logic. Skip for any payment task."',
            '- DECISION: You found exactly what you were looking for. Pin the line. "L47 → DECISION: forEach(async (item) => charge(item)) — confirmed bug site. Promise discarded."',
            '- CONNECTION: A cross-file or cross-section dependency. "L47 → CONNECTION: called from CartRouter.ts:processPayment() L23 — that is the entry point."',
            '- CORRECTION: Earlier note was wrong. "→ CORRECTION: L214 is preprocessing only, NOT detection. Detection starts after L300."',
            '',
            'WRONG (do not write): "L1—œL300 handles parser setup and AST initialization." This is a description — it tells future sessions nothing actionable.',
            'RIGHT: "Looking for mutation detection entry → L1—œL300 does NOT have it. BOUNDARY. Detection starts after fnBodyMap at L248."',
            '',
            '### Two-phase writing model',
            'PHASE 1 — During the task: Append-only. Do not organize. Write immediately after reading each file while it is still hot. Use ? markers for uncertainty. Write EDIT LOG entry immediately after each edit — not at the end.',
            'PHASE 2 — At task end (~5 min, once): Restructure into: TLDR (3 lines max) → ## Discoveries → ## Edits → ## Meta. Write TLDR last.',
            '',
            '### Layer 4 is MANDATORY in the end restructure',
            'Add a "## Layer 4 — What to skip next time" section. List every file/section you read that turned out to be irrelevant to this class of task. Example: "ast-engine-ts.js L1—œL200: parser init only, zero relevance to MCP instruction tasks. Skip."',
            'This is the most underrated section. A confirmed irrelevance saves future sessions the same wasted reading time.',
            '',
            '### EDIT LOG format',
            'After every edit, append one entry: `**file:line** — what changed | Reason: why it was wrong before`',
            'The "Reason" is mandatory — future sessions need to know WHY it changed to avoid accidentally reverting it.',
            '',
            '### File format (must match exactly — searchCodex parses these headings)',
            '```',
            '## TLDR',
            '[3 lines max. What was wrong, what was fixed, where source of truth lives.]',
            '',
            '## Discoveries',
            '### filename.ts',
            'Discovery context: looking for [specific thing]',
            '- L47 → DECISION: ...',
            '- L1—œL80 → BOUNDARY: NOT relevant. Skip.',
            '',
            '## Edits',
            '1. **file.ts:47** — replaced forEach(async) with await Promise.all() | Reason: forEach discards promise returns',
            '',
            '## Meta',
            'Problem: [one sentence]',
            'Tags: async, promise, payment, cart',
            'Files touched: PaymentService.ts, CartRouter.ts',
            'Files read but NOT edited: OrderItem.ts (read to understand call chain, no changes needed)',
            '```',
            '',
            '### At end of task — update the index',
            'Append one row to `.unravel/codex/codex-index.md`:',
            '`| payment-fix-001 | Silent payment failure for duplicate cart items | async, promise, cart, payment | 2026-03-28 |`',
            'This makes the codex searchable by future query_graph calls — they will find it and inject it as pre_briefing automatically.',
            '',
            '### Staleness — SUPERSEDES rule',
            'If you find that a past codex discovery is now WRONG (code was refactored), add a ## Supersedes section to your new codex:',
            '"SUPERSEDES: codex-payment-fix-001, Discovery at PaymentService.ts L47. Was: forEach(async). Now: refactored to processQueue() at L89."',
            '',
            '### Verify-on-use, not trust-and-use',
            'Codex tells you WHERE to look, not WHAT is true. Before citing a discovery in a verify() call, always confirm the actual line still matches. Same principle as verify() itself — accelerate, do not substitute.',
            '',
            '### What NOT to do',
            '- Do NOT auto-generate discoveries from a file summary — discoveries must be earned by reading',
            '- Do NOT write a codex for every file you read — only what connects to the task goal',
            '- Do NOT write a full-codebase summary — task-scope is the entire point',
        ].join('\n'),
    }
);

//  Layered Analysis Formatter 
// Returns a structured JSON object with 5 separate keys instead of one giant
// string. Agents read `critical_signal` first and stop when sufficient.
// Nothing is hidden  all data is available, just organized so the agent can
// choose which sections to parse.
//
// Keys:
//   critical_signal   contextFormatted + pattern hints + STATIC_BLIND verdict
//   protocol          pipelineReminder + hardGates + requiredFields
//   cross_file_graph  compact callGraph + symbolOrigins
//   raw_ast_data      full JSON blob (all AST fields preserved)
//   metadata          provenance, file list, engine version
function formatAnalysisForAgent(payload, detail = 'standard') {
    //  @1 CRITICAL SIGNAL 
    const critLines = [];
    critLines.push('═══”');
    critLines.push('═˜  UNRAVEL ANALYSIS — read critical_signal first                 ═˜');
    critLines.push('╚═');
    critLines.push('');
    critLines.push('READING GUIDE:');
    critLines.push('  critical_signal  — START HERE. AST evidence, pattern hints. Usually sufficient.');
    critLines.push('  protocol         — Phase reminders + verify() field list. Read when composing verify call.');
    critLines.push('  cross_file_graph — Call graph + symbol origins. Read if cross-file chains are ambiguous.');
    critLines.push('  raw_ast_data     — Full structured JSON. Read only for deep investigation.');
    critLines.push('  metadata         — Engine version, timestamps. Skip unless debugging the engine.');
    critLines.push('');

    const cf = payload.evidence?.contextFormatted;
    if (cf) critLines.push(cf.trimEnd());

    const hints = payload._instructions?.patternHints;
    if (hints?.length) {
        critLines.push('\nPattern Hints (treat highest-confidence as H1):');
        for (const h of hints) {
            critLines.push(`  [${h.patternId}]  confidence=${h.confidence}  hitCount=${h.hitCount}`);
            critLines.push(`  → ${h.hint}`);
        }
    }

    // Phase 7b: Semantic Archive Hits  rendered after structural pattern hints
    const archiveHints = payload._instructions?.semanticArchiveHints;
    if (archiveHints?.length) {
        critLines.push('\nSemantic Archive Hits (past verified diagnoses — treat as H1):');
        for (const h of archiveHints) {
            critLines.push(`  ⚡ ${(h.similarity * 100).toFixed(0)}% match  [${h.diagnosisId}]  ${h.timestamp?.slice(0, 10) || ''}`);
            critLines.push(`  → ${h.hint}`);
        }
    }

    // @F " circle-ir Supplementary Findings (reliability + performance passes)
    // These come from circle-ir's 36-pass pipeline " categories: reliability/performance only.
    // Security/taint, architecture, and noisy rules are excluded. Additive only.
    const circleFindings = payload._circleIrFindings || [];
    if (circleFindings.length > 0) {
        critLines.push('\n§F â€” circle-ir Supplementary Findings (reliability/performance):');
        for (const f of circleFindings) {
            const cwe  = f.cwe ? ` [${f.cwe}]` : '';
            const loc  = (f.endLine && f.endLine !== f.line)
                ? `${f.file}:${f.line}-${f.endLine}`
                : `${f.file}:${f.line}`;
            critLines.push(`  [${f.ruleId}] ${f.severity.toUpperCase()}${cwe}  ${loc}`);
            critLines.push(`  → ${f.message}`);
            if (f.fix) critLines.push(`  ✦ Fix: ${f.fix}`);
        }
        critLines.push('  (Treat these as additional H2/H3 candidates — verify with AST evidence before citing)');
    }

    //  STATIC_BLIND verdict 
    // If zero detectors fired AND zero pattern matches AND zero circle-ir findings,
    // the engine found no structural bugs. Tell the agent explicitly.
    const astRaw = payload.evidence?.astRaw || {};
    const detectorsFired = [
        ...(astRaw.globalWriteRaces    || []).filter(r => !r.writeKind?.includes('UNRESOLVED')),
        ...(astRaw.constructorCaptures || []),
        ...(astRaw.staleModuleCaptures || []),
        ...(astRaw.floatingPromises    || []),
        ...(astRaw.forEachMutations    || []),
        ...(astRaw.specRisks           || []),
    ].length;
    const patternMatchCount = (payload.patternMatches || []).length;
    const hasCriticalSignal = cf && cf.trim().length > 50; // contextFormatted has real content

    if (detectorsFired === 0 && patternMatchCount === 0 && !hasCriticalSignal && circleFindings.length === 0) {
        critLines.push('');
        critLines.push('━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━');
        critLines.push('⚠ ️   VERDICT: STATIC_BLIND');
        critLines.push('━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━');
        critLines.push('No structural bugs found in the analyzed code. Zero detectors fired,');
        critLines.push('zero pattern matches. Possible causes outside static analysis scope:');
        critLines.push('  - Environment configuration (env vars, secrets, config files)');
        critLines.push('  - Runtime data (database state, API responses, user input)');
        critLines.push('  - Third-party service behavior (network, external APIs)');
        critLines.push('  - Timing/deployment issues (race conditions only visible under load)');
        critLines.push('');
        critLines.push('Unravel cannot diagnose these. Investigate environment and runtime next.');
        critLines.push('If you believe there IS a structural bug, try:');
        critLines.push('  1. A more specific symptom description');
        critLines.push('  2. Including additional files that may be involved');
        critLines.push('  3. Running analyze(detail:"full") for unfiltered output');
    }

    //  @2 PROTOCOL 
    const protoLines = [];

    const pr = payload._instructions?.pipelineReminder;
    if (pr) {
        protoLines.push(`NOTE: ${pr.note || ''}`);
        if (pr.phase3)     protoLines.push(`  Phase 3:   ${pr.phase3}`);
        if (pr.phase3_5)   protoLines.push(`  Phase 3.5: ${pr.phase3_5}`);
        if (pr.phase5_5)   protoLines.push(`  Phase 5.5: ${pr.phase5_5}`);
        if (pr.eliminationQuality) protoLines.push(`  Quality:   ${pr.eliminationQuality}`);
    }

    const vi = payload._instructions?.verifyCallInstructions;
    if (vi) {
        protoLines.push('\nHard Gates (verify rejects immediately if violated):');
        const gates = vi.hardGates || {};
        for (const [gate, rule] of Object.entries(gates)) {
            protoLines.push(`  [${gate}]  ${rule}`);
        }
        protoLines.push('\nrequiredFields for verify():');
        const rf = vi.requiredFields || {};
        for (const [field, desc] of Object.entries(rf)) {
            protoLines.push(`  ${field}: ${desc}`);
        }
    }

    //  @3 CROSS-FILE GRAPH 
    const crossLines = [];
    const cr = payload.evidence?.crossFileRaw;
    if (cr) {
        if (cr.callGraph?.length) {
            crossLines.push('Call Graph:');
            for (const e of cr.callGraph) {
                crossLines.push(`  ${e.caller} → ${e.callee}:${e.function}()  L${e.line}`);
            }
        }

        if (cr.symbolOrigins) {
            crossLines.push('\nSymbol Origins (who imports what from where):');
            for (const [sym, info] of Object.entries(cr.symbolOrigins)) {
                const importedBy = (info.importedBy || []).map(i => i.file).join(', ');
                crossLines.push(`  ${info.name} [${info.file}:${info.line}]  →   imported by: ${importedBy || 'none'}`);
            }
        }
    }

    //  @4 RAW DATA  gated behind detail:'full' 
    // In standard/priority mode, agents read critical_signal and stop.
    // Exposing the full JSON payload by default defeats the purpose of structured keys
    // (a greedy agent reads all keys and gets the same ~50KB context bloat).
    // detail:'full' is the explicit opt-in for deep investigation.
    const rawData = detail === 'full'
        ? JSON.stringify(payload, null, 2)
        : `Raw data omitted in standard mode — call analyze(detail:'full') to include. Size if included: ~${Math.round(JSON.stringify(payload).length / 1024)}KB.`;

    //  @5 METADATA 
    const metaLines = [];
    const prov = payload._provenance || {};
    metaLines.push(`  engineVersion:    ${prov.engineVersion || 'unknown'}`);
    metaLines.push(`  crossFileAnalysis: ${prov.crossFileAnalysis}`);
    metaLines.push(`  patternsChecked:  ${prov.patternsChecked}  patternMatchCount: ${prov.patternMatchCount}`);
    metaLines.push(`  mutationsKept:    ${prov.mutationsKept}   mutationsSuppressed: ${prov.mutationsSuppressed}`);
    metaLines.push(`  filesAnalyzed:    ${(payload.evidence?.filesAnalyzed || []).map(f => f.name).join(', ')}`);
    metaLines.push(`  timestamp:        ${prov.timestamp || ''}`);

    // Return structured JSON  agent reads keys selectively
    return JSON.stringify({
        critical_signal: critLines.join('\n'),
        protocol: protoLines.join('\n'),
        cross_file_graph: crossLines.length > 0 ? crossLines.join('\n') : 'No cross-file analysis available.',
        raw_ast_data: rawData,
        metadata: metaLines.join('\n'),
    }, null, 2);
}

//  astRaw Mutation Filter 
// The contextFormatted text is already filtered by formatAnalysis() in standard
// mode. But astRaw.mutations (the raw JSON) was never filtered  noise variables
// waste agent context tokens. This applies the same cross-function criterion:
//   KEEP if: writes in function A AND reads in function B (cross-function state)
//   KEEP if: confirmed by globalWriteRaces or constructorCaptures (force-include)
//   DROP if: noise variable name (i, j, err, etc.)
//   DROP if: single write, zero reads (declared but not shared)
//   DROP if: all writes and reads within the same function
const NOISE_VARS = new Set([
    // Single letters " always noise (loop indices, math vars, destructuring)
    'i', 'j', 'k', 'n', 'm', 'x', 'y', '_',
    'a', 'b', 'c', 'd', 'f', 'g', 'h', 'p', 'q', 'r', 's', 't', 'v', 'w', 'z',
    // Generic error/utility names " rarely meaningful as cross-function state
    'err', 'error', 'e',
    'res', 'result', 'temp', 'tmp',
    'key', 'val', 'value', 'item',
    'el', 'elem', 'node', 'cb', 'fn',
    'idx', 'len', 'count', 'index',
    'event', 'evt', 'ctx', 'resolve', 'reject',
    // NOTE: domain names removed " conn, worker, task, entry, aged, fresh, ready,
    // now, size, delay, connId, completionsBatch, failuresBatch are legitimate
    // state variables in server/queue/pool code. If a detector missed them, the
    // cross-function gate (L686-702) will still suppress pure locals correctly.
]);

function filterAstRawMutations(raw) {
    if (!raw?.mutations) return { filtered: raw, suppressed: 0 };

    // Build force-include set from ALL high-signal detectors
    const forceInclude = new Set([
        ...(raw.globalWriteRaces    || []).map(r => (r.variable || '').split(/[.[]/)[0]),
        ...(raw.constructorCaptures || []).map(c => c.sourceBinding || ''),
        ...(raw.staleModuleCaptures || []).map(c => (c.variable   || '').split(/[.[]/)[0]),
        ...(raw.floatingPromises    || []).map(f => f.api         || ''),
    ]);

    const filtered = {};
    let suppressed = 0;
    const total = Object.keys(raw.mutations).length;

    for (const [name, data] of Object.entries(raw.mutations)) {
        const baseName = name.split(/[.[]/)[0];

        // Force-include: confirmed by a high-signal detector (before any drop rule)
        if (forceInclude.has(baseName)) { filtered[name] = data; continue; }

        // Drop well-known noise names (single letters, common locals, domain aliases)
        if (NOISE_VARS.has(baseName)) { suppressed++; continue; }

        // Drop zero-write vars: read-only locals (params, destructures, loop vars)
        if (data.writes.length === 0) { suppressed++; continue; }

        // Drop zero-read vars: written but never consumed (dead assignments)
        if (data.reads.length === 0) { suppressed++; continue; }

        // Drop vars whose entire lifecycle is within one function (pure local scope)
        const allFns = new Set([
            ...data.writes.map(w => w.fn),
            ...data.reads.map(r => r.fn),
        ]);
        if (allFns.size === 1) { suppressed++; continue; }

        // Keep: cross-function state (written in fn A, read in fn B)
        const writeFns = new Set(data.writes.map(w => w.fn));
        const readFns  = new Set(data.reads.map(r => r.fn));
        const isCrossFunction = [...readFns].some(fn => !writeFns.has(fn));

        if (isCrossFunction) {
            filtered[name] = data;
        } else {
            suppressed++;
        }
    }

    return {
        filtered: { ...raw, mutations: filtered },
        suppressed,
        total,
    };
}

//  Tool 1: unravel.analyze 
// Run the deterministic engine (AST + routing + pattern matching).
// Returns structural evidence for the agent to reason about.
server.tool(
    'analyze',
    'Run Unravel\'s AST engine to extract verified structural facts: mutation chains, async boundaries, closure captures, and races. This is Phase 1 of the "Sandwich Protocol". It returns deterministic ground truth and the required Phase 2-8 instructions you must follow to diagnose the bug.',
    {
        files: z.array(z.object({
            name: z.string().describe('File path (e.g. "src/store/taskStore.ts")'),
            content: z.string().describe('Full file content'),
        })).optional().describe('Code files to analyze. If omitted, uses files from a previous build_map call or reads from "directory".'),
        directory: z.string().optional().describe('Path to project root. Reads all source files automatically.'),
        symptom: z.string().describe('Bug description or error message from the user.'),
        detail: z.enum(['priority', 'standard', 'full']).optional().describe(
            "Output verbosity. 'standard' (default): filtered high-signal findings (~200 lines). " +
            "'priority': confirmed critical findings only (~50 lines). " +
            "'full': complete unfiltered output — use only if standard output is missing a key mutation chain."
        ),
    },
    async (args) => {
        try {
            const files = resolveFiles(args);
            session.files = files; // Cache for subsequent calls

            //  Phase 3c: Analyze Result Cache 
            // If same symptom + same file set within a session, return cached
            // evidence instantly. Saves full orchestrate cost (~1-2s) when an
            // agent retries after a failed verify or re-calls with same inputs.
            const sortedNames = files.map(f => f.name).sort().join('|');
            const analysisHash = `${args.symptom}::${args.detail || 'standard'}::${sortedNames}`;
            if (session.lastAnalysisHash === analysisHash && session.lastAnalysisResult) {
                process.stderr.write('[unravel-mcp] Phase 3c: Cache hit — returning cached analysis.\n');
                return session.lastAnalysisResult;
            }

            // Run the engine in MCP mode  this short-circuits after Phase 1d
            const result = await orchestrate(files, args.symptom, {
                _mode: 'mcp',
                detail: args.detail || 'standard',
                provider: 'none',  // No LLM call in MCP mode
                apiKey: 'none',
                model: 'none',
                mode: 'debug',
                // ast-engine-ts.js now handles native vs WASM internally based on environment.
                // No _nativeAST injection needed  orchestrate.js calls initParser() which
                // detects Node.js and uses native tree-sitter bindings automatically.
                onProgress: (msg) => {
                    if (typeof msg === 'string') process.stderr.write(`[unravel] ${msg}\n`);
                },
            });


            // Cache the evidence for the verify tool
            const detail = args.detail || 'standard';
            let astRawForResponse = result.evidence?.astRaw || null;
            let _mutationsSuppressed = 0;
            let _mutationsTotal = 0;

            // Filter astRaw.mutations in standard/priority mode
            // (contextFormatted is already filtered by formatAnalysis  this makes astRaw consistent)
            if (astRawForResponse && detail !== 'full') {
                const { filtered, suppressed, total } = filterAstRawMutations(astRawForResponse);
                astRawForResponse = filtered;
                _mutationsSuppressed = suppressed;
                _mutationsTotal = total;
                process.stderr.write(`[unravel-mcp] astRaw.mutations filtered: ${total - suppressed}/${total} kept (${suppressed} noise vars suppressed)\n`);
            }

            // Cache the UNFILTERED version for verify (verify needs full AST to cross-check claims)
            session.astRaw = result.evidence?.astRaw || null;
            session.crossFileRaw = result.evidence?.crossFileRaw || null;

            //  Auto-restore KG from disk if session lost it (e.g. MCP restart) 
            if (!session.graph && session.projectRoot) {
                const restored = loadGraph(session.projectRoot);
                if (restored) {
                    session.graph = restored;
                    process.stderr.write(`[unravel-mcp] KG auto-restored from ${session.projectRoot}/.unravel/knowledge.json (${restored.nodes?.length || 0} nodes)\n`);
                }
            }

            //  Set projectRoot + load patterns + diagnosis archive from disk 
            // Always load MCP-level patterns.json on first analyze call so that
            // penalizePattern / learnFromDiagnosis operate on the persisted weights
            // from disk (not just the in-memory starter defaults).
            // v3.5.0: Pattern store is per-project when projectRoot is available,
            // falls back to MCP-global only for inline-file debugging.
            const globalPatternFile = join(resolve(import.meta.dirname), '.unravel', 'patterns.json');
            const projectPatternFile = session.projectRoot
                ? join(session.projectRoot, '.unravel', 'patterns.json')
                : null;
            session.mcpPatternFile = projectPatternFile || globalPatternFile;
            if (!session.patternsLoaded) {
                await loadPatterns(globalPatternFile);
                // Overlay project-level patterns if available
                if (projectPatternFile && existsSync(projectPatternFile)) {
                    await loadPatterns(projectPatternFile);
                    process.stderr.write(`[unravel-mcp] Project patterns overlaid from ${projectPatternFile}\n`);
                }
                session.patternsLoaded = true;
                process.stderr.write(`[unravel-mcp] Pattern store ready (${getPatternCount()} patterns)\n`);
            }
            if (args.directory) {
                const { resolve: pathResolve, join: pathJoin } = await import('path');
                const resolvedDir = pathResolve(args.directory);
                if (resolvedDir !== session.projectRoot) {
                    session.projectRoot    = resolvedDir;
                    session.archiveLoaded  = false;
                    session.diagnosisArchive = [];
                    const projPatternFile = pathJoin(resolvedDir, '.unravel', 'patterns.json');
                    if (existsSync(projPatternFile)) {
                        await loadPatterns(projPatternFile);
                        process.stderr.write(`[unravel-mcp] Project patterns overlaid\n`);
                    }
                }
            }


            // Phase 7a: Load diagnosis archive (once per session, sync)
            if (session.projectRoot && !session.archiveLoaded) {
                session.diagnosisArchive = loadDiagnosisArchive(session.projectRoot);
                session.archiveLoaded = true;
                process.stderr.write(`[unravel:archive] Diagnosis archive loaded (${session.diagnosisArchive.length} entries).\n`);
            }

            // Store symptom for use by verify() when archiving diagnoses
            if (args.symptom) session.lastSymptom = args.symptom;

            //  Pattern matching: surface structural hypotheses before agent reasoning 
            const patternMatches = session.astRaw ? matchPatterns(session.astRaw) : [];
            const topPatterns = patternMatches.slice(0, 5).map(m => ({
                patternId:     m.pattern.id,
                bugType:       m.pattern.bugType,
                description:   m.pattern.description,
                severity:      m.pattern.severity,
                confidence:    Math.round(m.confidence * 100) / 100,
                hitCount:      m.pattern.hitCount,
                matchedEvents: m.matchedEvents,
            }));

            // Enrich the response with pattern hints + provenance update
            const base = result.mcpEvidence || result;

            // Replace astRaw in evidence with the filtered version
            if (base.evidence && astRawForResponse) {
                base.evidence.astRaw = astRawForResponse;
            }

            // P4  Drop astRaw.mutations in standard/priority mode.
            // contextFormatted already contains all the same signal in human-readable form.
            // Agents should read contextFormatted for reasoning; astRaw.mutations is the same
            // data in a verbose structured format that wastes context tokens.
            // Use detail:'full' to get the raw mutations JSON for deep debugging.
            if (detail !== 'full' && base.evidence?.astRaw?.mutations) {
                const keptCount = Object.keys(base.evidence.astRaw.mutations).length;
                delete base.evidence.astRaw.mutations;
                base.evidence.astRaw._mutationsDropped = `${keptCount} entries suppressed in standard mode — use detail:'full' to see raw mutations JSON`;
                process.stderr.write(`[unravel-mcp] P4: astRaw.mutations dropped (${keptCount} entries) — contextFormatted carries the signal\n`);
            }

            //  Phase 4: Dynamic Pattern Hints in _instructions 
            // Inject top matched patterns into _instructions so the agent sees
            // structural hypotheses BEFORE it starts reasoning. The agent's own
            // LLM should treat a high-weight match as H1 without needing to
            // re-derive it from the evidence from scratch.
            if (base._instructions && topPatterns.length > 0) {
                const strongPatterns = topPatterns.filter(p => p.confidence >= 0.65);
                if (strongPatterns.length > 0) {
                    base._instructions.patternHints = strongPatterns.map(p => ({
                        patternId:   p.patternId,
                        bugType:     p.bugType,
                        confidence:  p.confidence,
                        hitCount:    p.hitCount,
                        hint: `This analysis matches a known ${p.bugType} pattern (confirmed ${p.hitCount} times, confidence ${Math.round(p.confidence * 100)}%). Treat this as H1 in your hypothesis tree unless AST evidence contradicts it.`,
                    }));
                    process.stderr.write(`[unravel-mcp] Phase 4: Injected ${strongPatterns.length} pattern hint(s) into _instructions.\n`);
                }
            }

            //  Phase 7b: Semantic Archive Search 
            // Search past verified diagnoses by embedding similarity.
            // If a past bug is semantically 0.75 similar to this symptom, inject
            // it as a high-confidence hint BEFORE the agent starts reasoning.
            // This runs after structural patterns so the agent gets both signals.
            const archiveApiKey = process.env.GEMINI_API_KEY;
            if (archiveApiKey && session.diagnosisArchive.length > 0 && args.symptom) {
                try {
                    const archiveHits = await searchDiagnosisArchive(
                        args.symptom,
                        session.diagnosisArchive,
                        archiveApiKey
                    );
                    if (archiveHits.length > 0 && base._instructions) {
                        base._instructions.semanticArchiveHints = archiveHits.map(h => ({
                            diagnosisId:  h.id,
                            similarity:   Math.round(h.score * 100) / 100,
                            symptom:      h.symptom,
                            rootCause:    h.rootCause,
                            codeLocation: h.codeLocation,
                            timestamp:    h.timestamp,
                            hint: `⚡ SEMANTIC ARCHIVE (${(h.score * 100).toFixed(0)}% match): Past verified diagnosis — "${h.rootCause}" at ${h.codeLocation}. Treat as strong H1 if consistent with AST evidence above.`,
                        }));
                        process.stderr.write(`[unravel:archive] Phase 7b: ${archiveHits.length} semantic match(es) injected.\n`);
                    }
                } catch (archiveErr) {
                    process.stderr.write(`[unravel:archive] Phase 7b search error (non-fatal): ${archiveErr.message}\n`);
                }
            }

            //  Phase 5c-1b: Codex Pre-Briefing in analyze 
            // Same data as query_graph pre_briefing, but injected into _instructions
            // so agents who call analyze() directly still get codex context.
            // v3.5.0: Previously codex was only available via query_graph. Agents
            // who called analyze(directory, symptom) on small repos got zero codex.
            if (session.projectRoot && args.symptom) {
                try {
                    const codexResult = await searchCodex(session.projectRoot, args.symptom);
                    if (codexResult.matches.length > 0 && base._instructions) {
                        base._instructions.codexPreBriefing = {
                            note: 'Prior debugging sessions matched this symptom. Read these discoveries — they may contain key insights.',
                            entries: codexResult.matches.map(m => ({
                                codex: `codex-${m.taskId}`,
                                problem: m.problem,
                                relevance_score: m.relevance_score ?? m.score,
                                discoveries: m.discoveries,
                            })),
                        };
                        process.stderr.write(`[unravel:codex] analyze: ${codexResult.matches.length} codex pre-briefing(s) injected.\n`);
                    }
                } catch (codexErr) {
                    process.stderr.write(`[unravel:codex] analyze pre-briefing error (non-fatal): ${codexErr.message}\n`);
                }
            }

            // @F " circle-ir Supplementary Analysis """"""""""""""""""""""""""""""""""""""""""""""
            // Run after main engine. Additive only " any failure returns [] without affecting
            // the core evidence. Filtered to reliability/performance categories only.
            let circleIrFindings = [];
            try {
                circleIrFindings = await runCircleIrAnalysis(files);
            } catch (cIrErr) {
                process.stderr.write(`[circle-ir] Unexpected adapter error (non-fatal): ${cIrErr.message}\n`);
            }

            const responsePayload = {
                ...base,
                patternMatches: topPatterns,
                _circleIrFindings: circleIrFindings,
                _provenance: {
                    ...(base._provenance || {}),
                    patternsChecked:        getPatternCount(),
                    patternMatchCount:      topPatterns.length,
                    mutationsKept:          _mutationsTotal - _mutationsSuppressed,
                    mutationsSuppressed:    _mutationsSuppressed,
                    circleIrFindingCount:   circleIrFindings.length,
                },
            };

            const returnValue = {
                content: [{
                    type: 'text',
                    text: formatAnalysisForAgent(responsePayload, detail),
                }],
            };

            // Phase 3c: Store in cache for identical future requests
            session.lastAnalysisHash = analysisHash;
            session.lastAnalysisResult = returnValue;

            return returnValue;
        } catch (err) {
            return {
                content: [{ type: 'text', text: `Error: ${err.message}` }],
                isError: true,
            };
        }
    }
);

//  Tool 2: unravel.verify 
// The second half of the sandwich: agent passes its diagnosis, Unravel
// cross-checks every claim against real code.
server.tool(
    'verify',
    'VERIFICATION (Sandwich Protocol Phase 8): After completing your diagnosis based on AST evidence, you MUST call this to cross-check your claims. Unravel verifies your rootCause, evidence citations, and fix against the actual AST. Returns a PASSED/REJECTED verdict. Fix is not valid until this passes.\n\nPROTOCOL REQUIREMENTS (enforced by hard gates — submission rejected if violated):\n1. HYPOTHESIS GATE: You must have generated ≥1 competing hypothesis in Phase 3 before submitting. Pass them in hypotheses[]. Submitting without hypotheses[] means you skipped Phase 3 (Hypothesis Generation) — the fix will not be accepted.\n2. EVIDENCE CITATION GATE: rootCause must contain at least one file:line citation (e.g. "scheduler.js:20") sourced from the analyze output. A rootCause with no code citation is hallucinated reasoning and will be rejected.',
    {
        rootCause: z.string().describe('Your root cause diagnosis. MUST contain at least one file:line citation (e.g. "scheduler.js:20") — rootCause without a code citation is rejected.'),
        hypotheses: z.array(z.string()).optional().describe('REQUIRED: The competing hypotheses you generated in Phase 3 (e.g. ["H1: stale closure...", "H2: race condition...", "H3: incorrect state..."]). At least 1 required. Omitting this field means Phase 3 was skipped and verify will return PROTOCOL_VIOLATION.'),
        evidence: z.array(z.string()).optional().describe('Evidence citations (e.g. ["taskStore.ts L29: tasks.push(newTask)", "useSessionData.ts L32: const tasks = useTasks()"])'),
        codeLocation: z.string().optional().describe('File and line where the bug is (e.g. "taskStore.ts:29")'),
        minimalFix: z.string().optional().describe('Your proposed fix'),
        diffBlock: z.string().optional().describe(
            'Optional: unified diff of your fix (lines prefixed with + and -). ' +
            'If provided, Unravel checks whether your fix removes any function signature parameters ' +
            'that have callers in other files â€” activating the Fix Completeness check (Check 6).'
        ),
        files: z.array(z.object({
            name: z.string(),
            content: z.string(),
        })).optional().describe('Code files to verify against. If omitted, uses files from a previous analyze or build_map call.'),
    },
    async (args) => {
        try {
            const files = args.files
                ? args.files.map(f => ({ name: f.name, content: f.content }))
                : session.files;

            if (!files || files.length === 0) {
                throw new Error('No files available for verification. Call analyze or build_map first, or pass files directly.');
            }

            //  Phase 3e Gate 1: Hypothesis Gate 
            // Require 1 hypothesis to prove Phase 3 (Hypothesis Generation)
            // was not skipped. Agents that jump straight from analyze  (tm) fix
            // are doing proximate fixation  the most common reasoning failure.
            // Mandating query_graph before analyze is wrong (small repos don't
            // need KG). But mandating hypotheses before verify is always right.
            const hypotheses = args.hypotheses;
            if (!hypotheses || hypotheses.length === 0) {
                process.stderr.write('[unravel-mcp] Phase 3e Gate 1 REJECTED: no hypotheses provided\n');
                return {
                    content: [{
                        type: 'text',
                        text: JSON.stringify({
                            verdict: 'PROTOCOL_VIOLATION',
                            gate: 'HYPOTHESIS_GATE',
                            allClaimsPassed: false,
                            failures: [{
                                claim: 'hypotheses[]',
                                reason: 'Phase 3 (Hypothesis Generation) was skipped. You must generate at least 1 competing hypothesis before submitting a fix. Re-read the evidence, generate 3 mutually exclusive hypotheses, eliminate all but one with AST evidence, then re-submit verify with hypotheses[] populated.',
                            }],
                            summary: 'PROTOCOL_VIOLATION: Phase 3 (Hypothesis Generation) skipped. Fix not accepted. Generate hypotheses first, then re-call verify with hypotheses[] filled.',
                            remediation: 'Add hypotheses: ["H1: ...", "H2: ...", "H3: ..."] to your verify call. These must be the competing mechanisms you considered and eliminated before arriving at your rootCause.',
                        }, null, 2),
                    }],
                };
            }

            //  Phase 3e Gate 2: Evidence Citation Gate 
            // rootCause must contain 1 file:line citation (e.g. "scheduler.js:20"
            // or "scheduler.js L20"). A rootCause with no code citation is
            // hallucinated reasoning  it describes a mechanism without pointing
            // to the actual code location, which verifyClaims() cannot confirm.
            const FILE_LINE_PATTERN = /[\w.\-/]+\.(js|jsx|ts|tsx|py|go|rs|java|cs)\s*[L:]\s*\d+/i;
            if (!FILE_LINE_PATTERN.test(args.rootCause)) {
                process.stderr.write('[unravel-mcp] Phase 3e Gate 2 REJECTED: rootCause has no file:line citation\n');
                return {
                    content: [{
                        type: 'text',
                        text: JSON.stringify({
                            verdict: 'PROTOCOL_VIOLATION',
                            gate: 'EVIDENCE_CITATION_GATE',
                            allClaimsPassed: false,
                            failures: [{
                                claim: args.rootCause,
                                reason: 'rootCause contains no file:line citation. Every rootCause must reference the specific code location where state was first corrupted (e.g. "scheduler.js:3 — _cachedEntries captures stale reference"). A rootCause without a code citation cannot be verified and may be hallucinated.',
                            }],
                            summary: 'PROTOCOL_VIOLATION: rootCause has no file:line citation. Fix not accepted. Add a specific code location (e.g. "filename.js:42") to your rootCause string.',
                            remediation: 'Rewrite rootCause to include the file and line where the bug originates. Example: "scheduler.js:3 — const _cachedEntries = getEntries() captures a reference that becomes stale after rebalance() reassigns _entries at priority-queue.js:36"',
                        }, null, 2),
                    }],
                };
            }

            // Build the result object in the shape verifyClaims expects
            const agentResult = {
                report: {
                    rootCause:    args.rootCause,
                    evidence:     args.evidence    || [],
                    codeLocation: args.codeLocation || '',
                    minimalFix:   args.minimalFix   || '',
                    diffBlock:    args.diffBlock    || '',  // activates Check 6 (Fix Completeness) when provided
                },
            };

            const verification = verifyClaims(
                agentResult,
                files,
                session.astRaw,      // AST from last analyze call
                session.crossFileRaw,
                'debug',
                session.lastSymptom  // symptom whitelist: files mentioned in the error are not hallucinations
            );

            const passed = !verification.rootCauseRejected && verification.failures.length === 0;

            // " Pattern Learning: update weights + persist on clean verify """""""""""""""""""
            // Only fires when ALL claims pass AND root cause is not rejected.
            // This is the learning moment: a human-verified correct diagnosis strengthens
            // the structural patterns that contributed to finding it.
            if (passed && session.astRaw) {
                learnFromDiagnosis(session.astRaw, verification);
                const patternFile = session.mcpPatternFile
                    || join(resolve(import.meta.dirname), '.unravel', 'patterns.json');
                await savePatterns(patternFile);
                process.stderr.write('[unravel-mcp] Pattern weights updated and persisted.\n');

                // Phase 7a: Embed and archive this verified diagnosis.
                // Awaited so session.diagnosisArchive stays in sync  Phase 7b
                // needs the new entry in memory for the very next analyze() call.
                // Falls back silently if GEMINI_API_KEY absent or embed fails.
                const archiveKey = process.env.GEMINI_API_KEY;
                if (archiveKey) {
                    try {
                        const archived = await archiveDiagnosis(
                            session.projectRoot,
                            {
                                symptom:      session.lastSymptom || args.rootCause,
                                rootCause:    args.rootCause,
                                codeLocation: args.codeLocation || '',
                                evidence:     args.evidence    || [],
                            },
                            archiveKey
                        );
                        // Push into session so next analyze() sees it without a disk reload
                        if (archived) session.diagnosisArchive.push(archived);
                    } catch (archErr) {
                        process.stderr.write(`[unravel:archive] Archive error (non-fatal): ${archErr.message}\n`);
                    }
                }

                // Phase 5c-4: Auto-seed the Codex so query_graph pre_briefing starts
                // working immediately " without needing agents to write codex files manually.
                // Synchronous + non-fatal: never delays the verify response.
                autoSeedCodex(session.projectRoot, {
                    symptom:      session.lastSymptom || args.rootCause,
                    rootCause:    args.rootCause,
                    codeLocation: args.codeLocation || '',
                    evidence:     args.evidence    || [],
                });
                // Enrich project overview Risk Areas with this verified diagnosis
                if (session.projectRoot) {
                    enrichProjectOverviewWithDiagnosis(session.projectRoot, {
                        rootCause:    args.rootCause,
                        codeLocation: args.codeLocation || '',
                        symptom:      session.lastSymptom || args.rootCause,
                    });
                    process.stderr.write('[unravel] Project overview enriched with verified diagnosis.\n');
                }
            }

            //  Pattern Penalty: decay weights on FAILED/REJECTED diagnosis 
            // Mirrors the learning path above. Falls back to the MCP directory
            // when session.projectRoot is absent (analyze called with inline files).
            if (!passed && session.astRaw) {
                const patternFile = session.mcpPatternFile
                    || join(session.projectRoot || resolve(import.meta.dirname), '.unravel', 'patterns.json');
                penalizePattern(session.astRaw);
                await savePatterns(patternFile);
                process.stderr.write('[unravel-mcp] Pattern weights decayed (FAILED verdict) and persisted.\n');
            }

            // -- @1.1 Solvability Check: if REJECTED/FAILED, probe whether the bug
            // is upstream of the provided files (OS, browser, external API).
            // When isLayerBoundary is true, the rejection message explains WHY and WHERE.
            let layerBoundaryHint = null;
            if (!passed && checkSolvability) {
                try {
                    const solvability = checkSolvability(
                        agentResult,
                        verification,
                        files,
                        session.lastSymptom || ''
                    );
                    if (solvability.isLayerBoundary) {
                        layerBoundaryHint = {
                            verdict:           'LAYER_BOUNDARY',
                            confidence:        solvability.confidence,
                            rootCauseLayer:    solvability.rootCauseLayer,
                            suggestedFixLayer: solvability.suggestedFixLayer,
                            reason:            solvability.reason,
                            message:           solvability.message,
                        };
                        process.stderr.write(`[unravel:solvability] LAYER_BOUNDARY â€” ${solvability.rootCauseLayer} (confidence: ${solvability.confidence})\n`);
                    }
                } catch (solvErr) {
                    process.stderr.write(`[unravel:solvability] Non-fatal error: ${solvErr.message}\n`);
                }
            }

            const verdictStr = verification.rootCauseRejected
                ? 'REJECTED'
                : verification.failures.length > 0 ? 'FAILED' : 'PASSED';

            const responseObj = {
                verdict:           verdictStr,
                allClaimsPassed:   verification.failures.length === 0,
                failures:          verification.failures.map(f => ({ claim: f.claim, reason: f.reason })),
                confidencePenalty: verification.confidencePenalty,
                rootCauseRejected: verification.rootCauseRejected,
                summary: verification.failures.length === 0
                    ? 'All claims verified against actual code. Your diagnosis is consistent with the codebase.'
                    : `${verification.failures.length} claim(s) failed verification. ${verification.rootCauseRejected ? 'Root cause references code that does not exist.' : 'Some evidence citations could not be confirmed.'}`,
            };

            // Inject layer boundary hint only when present
            if (layerBoundaryHint) responseObj.layer_boundary = layerBoundaryHint;

            return {
                content: [{
                    type: 'text',
                    text: JSON.stringify(responseObj, null, 2),
                }],
            };
        } catch (err) {
            return {
                content: [{ type: 'text', text: `Error: ${err.message}` }],
                isError: true,
            };
        }
    }
);

//  Tool 3: unravel.build_map 
// Build the Knowledge Graph from project files.
// If a previous graph exists on disk, does a SHA-256 diff and incrementally
// patches only changed files. Full rebuild only if no existing graph or
// delta exceeds the INCREMENTAL_THRESHOLD (30%).
const INCREMENTAL_THRESHOLD = 0.3; // If > 30% of files changed, full rebuild is cheaper

server.tool(
    'build_map',
    'Build Unravel\'s Knowledge Graph from project files. Maps imports, function calls, and mutations. Once built, use query_graph to find relevant files for a bug. Mandatory for large repos where the full context cannot fit in memory.',
    {
        directory: z.string().describe('Path to the project root directory.'),
        embeddings: z.union([z.boolean(), z.enum(['all'])]).optional().describe(
            'Controls node embedding for semantic routing. Default (true): embeds top-50 hub nodes by edge count — fast (~5-8s), good coverage. "all": embeds every connected node — slower but provides complete semantic coverage (recommended for orgs with API budget). false: skip all embedding (keyword-only routing, no API calls).'
        ),
        include: z.array(z.string()).optional().describe(
            'Paths or folders to index (e.g. ["src/core", "packages/api/src"]). If provided, only files within these paths are indexed. Useful for monorepos where you want one KG at the root but only care about specific subsystems. Combine with exclude for fine-grained control.'
        ),

        exclude: z.array(z.string()).optional().describe(
            'Paths or substrings to exclude from indexing. Can be relative to the project root (e.g. "src/generated", "vendor") or absolute paths. Files whose paths contain any of these strings are skipped entirely — not indexed, not embedded.'
        ),
    },
    async (args) => {
        try {
            const dirPath = resolve(args.directory);
            if (!existsSync(dirPath)) {
                throw new Error(`Directory not found: ${dirPath}`);
            }
            session.projectRoot = dirPath;
            const buildStart = Date.now();

            process.stderr.write(`[unravel] Reading files from ${dirPath}...\n`);
            let files = readFilesFromDirectory(dirPath, 5, args.exclude || []);
            if (args.exclude?.length) {
                process.stderr.write(`[unravel] Exclude list: ${args.exclude.join(', ')}\n`);
            }
            // "" include filter: if specified, only keep files within those paths ""
            if (args.include?.length) {
                const includes = args.include.map(p => p.replace(/\\/g, '/'));
                const before = files.length;
                files = files.filter(f => {
                    const norm = f.name.replace(/\\/g, '/');
                    return includes.some(inc => norm.includes(inc));
                });
                process.stderr.write(`[unravel] Include filter: ${files.length}/${before} files match [${args.include.join(', ')}]\n`);
            }
            session.files = files;
            process.stderr.write(`[unravel] Found ${files.length} source files.\n`);

            //  Incremental Rebuild Path 
            // Check for existing graph on disk. If found, compute content-hash
            // delta and patch only changed files instead of full rebuild.
            const existingGraph = loadGraph(dirPath);
            if (existingGraph && existingGraph.nodes?.length > 0) {
                const changed = getChangedFiles(files, existingGraph, computeContentHashSync);
                process.stderr.write(`[unravel] Existing KG found (${existingGraph.nodes.length} nodes). ${changed.length}/${files.length} files changed.\n`);

                if (changed.length === 0) {
                    // Nothing changed  return existing graph instantly
                    session.graph = existingGraph;
                    process.stderr.write('[unravel] No changes detected — using cached graph.\n');
                    return {
                        content: [{
                            type: 'text',
                            text: JSON.stringify({
                                status: 'ok',
                                incremental: true,
                                filesChanged: 0,
                                durationMs: Date.now() - buildStart,
                                stats: {
                                    filesIndexed: files.length,
                                    nodes: existingGraph.nodes.length,
                                    edges: existingGraph.edges?.length || 0,
                                },
                                summary: `Knowledge Graph unchanged — ${files.length} files, ${existingGraph.nodes.length} nodes. Loaded from cache in <0.1s.`,
                            }, null, 2),
                        }],
                    };
                }

                if (changed.length < files.length * INCREMENTAL_THRESHOLD) {
                    // < 30% changed  incremental patch
                    process.stderr.write(`[unravel] Incremental rebuild: patching ${changed.length} changed files...\n`);
                    await attachStructuralAnalysisToChanged(changed, files);

                    // Build new nodes/edges for just the changed files
                    const deltaBuilder = new GraphBuilder();
                    const newHashes = {};
                    let patchedCount = 0;
                    for (const file of changed) {
                        patchedCount++;
                        // Phase 3b: report progress every 25 files during incremental patch
                        if (patchedCount % 25 === 0 || patchedCount === changed.length) {
                            process.stderr.write(`[unravel] Patching... ${patchedCount}/${changed.length} files\n`);
                        }
                        const tags = [file.name.replace(/\.[^.]+$/, '').replace(/[/\\]/g, '-')];
                        const sa = file.structuralAnalysis || {};
                        const fnNames = (sa.functions || []).map(f => f.name).join(', ');
                        const _jdoc   = extractJsDocSummary(file.content || '');
                        const summary = _jdoc || (fnNames ? `Functions: ${fnNames}` : '');
                        deltaBuilder.addFileWithAnalysis(file.name, sa, { fileSummary: summary, tags });
                        newHashes[file.name] = file.hash;

                        // Wire import edges for changed files
                        for (const imp of (sa.imports || [])) {
                            if (imp.resolvedPath && imp.resolvedPath !== file.name) {
                                deltaBuilder.addImportEdge(file.name, imp.resolvedPath);
                            }
                        }
                    }
                    const deltaGraph = deltaBuilder.build();
                    const changedPaths = changed.map(f => f.name);
                    const merged = mergeGraphUpdate(
                        existingGraph, changedPaths,
                        deltaGraph.nodes, deltaGraph.edges,
                        newHashes, ''
                    );

                    session.graph = merged;

                    //  Phase 5a: Re-embed changed nodes only 
                    const incrementalApiKey = process.env.GEMINI_API_KEY;
                    if (incrementalApiKey) {
                        const changedPaths2 = changed.map(f => f.name);
                        await embedChangedNodes(merged, incrementalApiKey, { embedAll: args.embeddings === 'all' }).catch(e =>
                            process.stderr.write(`[unravel:embed] Incremental embed error: ${e.message}\n`)
                        );
                    } else {
                        process.stderr.write('[unravel:embed] No GEMINI_API_KEY — skipping incremental embedding.\n');
                    }

                    // Persist the updated graph (with embeddings if they were added)
                    try {
                        saveGraph(dirPath, merged);
                        process.stderr.write(`[unravel] Incremental graph saved (${merged.nodes.length} nodes).\n`);
                        saveMeta(dirPath, {
                            builtAt:      new Date().toISOString(),
                            nodeCount:    merged.nodes?.length  || 0,
                            edgeCount:    merged.edges?.length  || 0,
                            filesIndexed: files.length,
                            filesChanged: changed.length,
                            mode:         incrementalApiKey ? 'semantic' : 'structural',
                            incremental:  true,
                        });
                    } catch (saveErr) {
                        process.stderr.write(`[unravel] Could not persist graph: ${saveErr.message}\n`);
                    }

                    return {
                        content: [{
                            type: 'text',
                            text: JSON.stringify({
                                status: 'ok',
                                incremental: true,
                                filesChanged: changed.length,
                                filesTotal: files.length,
                                durationMs: Date.now() - buildStart,
                                stats: {
                                    filesIndexed: files.length,
                                    nodes: merged.nodes.length,
                                    edges: merged.edges?.length || 0,
                                },
                                summary: `Incremental rebuild: ${changed.length} files patched out of ${files.length}. ${merged.nodes.length} nodes, ${merged.edges?.length || 0} edges. Use query_graph to find relevant files for a bug.`,
                            }, null, 2),
                        }],
                    };
                }
                // > 30% changed  fall through to full rebuild
                process.stderr.write(`[unravel] ${changed.length} files changed (>${Math.round(INCREMENTAL_THRESHOLD * 100)}%) — doing full rebuild.\n`);
            }

            //  Full Rebuild Path (original logic) 
            // Attach structural analysis (imports, functions, classes, calls)
            process.stderr.write('[unravel] Running structural analysis...\n');
            const enriched = await attachStructuralAnalysis(files);

            // Build the graph with proper node structure
            process.stderr.write('[unravel] Building knowledge graph...\n');
            const builder = new GraphBuilder();
            let indexedCount = 0;
            for (const file of enriched) {
                indexedCount++;
                // Phase 3b: emit progress every 25 files so agent knows we're alive
                if (indexedCount % 25 === 0 || indexedCount === enriched.length) {
                    process.stderr.write(`[unravel] Indexing... ${indexedCount}/${enriched.length} files\n`);
                }
                const sa = file.structuralAnalysis || {};
                const nodeMeta = deriveNodeMetadata(file.name, sa, 0, file.content || '');
                builder.addFileWithAnalysis(file.name, sa, nodeMeta);
            }

            // Wire call edges (using A+1 import-guided resolution)
            const fnToFiles = new Map();
            for (const file of enriched) {
                for (const fn of (file.structuralAnalysis?.functions || [])) {
                    if (!fnToFiles.has(fn.name)) fnToFiles.set(fn.name, new Set());
                    fnToFiles.get(fn.name).add(file.name);
                }
            }

            const fileImportIndex = new Map();
            for (const file of enriched) {
                const importMap = new Map();
                for (const imp of (file.structuralAnalysis?.imports || [])) {
                    if (!imp.resolvedPath) continue;
                    const stem = imp.resolvedPath.split('/').pop().replace(/\.[^.]+$/, '');
                    importMap.set(stem, imp.resolvedPath);
                    const srcStem = imp.source.split('/').pop().replace(/\.[^.]+$/, '');
                    if (!importMap.has(srcStem)) importMap.set(srcStem, imp.resolvedPath);
                }
                fileImportIndex.set(file.name, importMap);
            }

            let callEdges = 0;

            // Wire import edges (enables cross-file hop traversal in query_graph)
            for (const file of enriched) {
                for (const imp of (file.structuralAnalysis?.imports || [])) {
                    if (!imp.resolvedPath || imp.resolvedPath === file.name) continue;
                    builder.addImportEdge(file.name, imp.resolvedPath);
                }
            }

            // Wire call edges (A+1 import-guided resolution)
            for (const file of enriched) {
                const importMap = fileImportIndex.get(file.name) || new Map();
                for (const call of (file.structuralAnalysis?.calls || [])) {
                    let calleeFile = null;
                    const importResolved = importMap.get(call.callee);
                    if (importResolved && importResolved !== file.name) {
                        calleeFile = importResolved;
                    } else {
                        const candidates = fnToFiles.get(call.callee);
                        if (!candidates || candidates.size !== 1) continue;
                        const [single] = candidates;
                        if (single !== file.name) calleeFile = single;
                    }
                    if (calleeFile) {
                        builder.addCallEdge(file.name, call.caller, calleeFile, call.callee);
                        callEdges++;
                    }
                }
            }

            // Stamp content hashes into the graph for future incremental diffs
            const fileHashes = {};
            for (const file of files) {
                fileHashes[file.name] = computeContentHashSync(file.content);
            }

            const graph = builder.build(args.directory, []);
            graph.files = fileHashes; // Store hashes for getChangedFiles
            session.graph = graph;

            //  Phase 5a: Embed-on-Ingest (full rebuild) 
            const embedOpt = args.embeddings;
            const fullBuildApiKey = (embedOpt !== false) ? process.env.GEMINI_API_KEY : null;
            const embedAll = embedOpt === 'all';
            if (fullBuildApiKey) {
                await embedGraphNodes(graph, fullBuildApiKey, { embedAll }).catch(e =>
                    process.stderr.write(`[unravel:embed] Embed-on-ingest error: ${e.message}\n`)
                );
            } else if (embedOpt === false) {
                process.stderr.write('[unravel:embed] Embeddings disabled by caller — structural KG only.\n');
            } else {
                process.stderr.write('[unravel:embed] No GEMINI_API_KEY — skipping node embedding. Keyword-only routing active.\n');
            }

            //  Phase 5c-2: Codex Node Attachment 
            // For each KG node (file), check if any codex entry's Discoveries
            // section mentions that filename. If so, attach the discovery excerpt
            // as node.codexHint so query_graph results carry institutional memory.
            // This is a file-name match (fast, no API key needed).
            try {
                const codexIndexPath = join(dirPath, '.unravel', 'codex', 'codex-index.md');
                if (existsSync(codexIndexPath)) {
                    const indexContent = readFileSync(codexIndexPath, 'utf-8');
                    const codexRows = indexContent.split('\n')
                        .filter(line => line.startsWith('|') && !line.includes('---') && !line.toLowerCase().includes('task id'))
                        .map(line => {
                            const cells = line.split('|').map(c => c.trim()).filter(Boolean);
                            return cells.length >= 3 ? { taskId: cells[0], problem: cells[1] } : null;
                        })
                        .filter(Boolean);

                    let hintsAttached = 0;
                    for (const row of codexRows) {
                        const codexPath = join(dirPath, '.unravel', 'codex', `codex-${row.taskId}.md`);
                        if (!existsSync(codexPath)) continue;
                        let codexContent;
                        try { codexContent = readFileSync(codexPath, 'utf-8'); } catch { continue; }

                        // Extract Discoveries section
                        const discMatch = codexContent.match(/## Discoveries\s*\n([\s\S]*?)(?=\n## |$)/);
                        if (!discMatch) continue;
                        const discoveries = discMatch[1];

                        // Match against KG nodes by filename
                        for (const node of (graph.nodes || [])) {
                            const nodeFile = node.filePath || node.name || '';
                            const baseName = nodeFile.split(/[/\\]/).pop() || '';
                            if (!baseName) continue;

                            // Check if discoveries section mentions this file
                            if (discoveries.includes(baseName)) {
                                // Extract the relevant line(s) for this file
                                const lines = discoveries.split('\n');
                                const fileLines = [];
                                let inFileSection = false;
                                for (const line of lines) {
                                    if (line.startsWith('###') && line.includes(baseName)) { inFileSection = true; continue; }
                                    if (line.startsWith('###') && inFileSection) break;
                                    if (inFileSection && line.trim()) fileLines.push(line.trim());
                                }
                                const excerpt = fileLines.slice(0, 3).join(' ').slice(0, 200);

                                if (!node.codexHints) node.codexHints = [];
                                node.codexHints.push({
                                    taskId: row.taskId,
                                    problem: row.problem,
                                    excerpt: excerpt || `Mentioned in codex-${row.taskId}`,
                                });
                                hintsAttached++;
                            }
                        }
                    }

                    if (hintsAttached > 0) {
                        process.stderr.write(`[unravel:codex] Phase 5c-2: ${hintsAttached} codex hint(s) attached to KG nodes.\n`);
                    }
                }
            } catch (codexErr) {
                process.stderr.write(`[unravel:codex] Phase 5c-2: hint attachment failed (${codexErr.message}) — continuing.\n`);
            }

            // Persist the graph to .unravel/knowledge.json (with embeddings if added)
            try {
                saveGraph(dirPath, graph);
                process.stderr.write(`[unravel] Graph saved to ${dirPath}/.unravel/knowledge.json\n`);
                saveMeta(dirPath, {
                    builtAt:      new Date().toISOString(),
                    nodeCount:    graph.nodes?.length  || 0,
                    edgeCount:    graph.edges?.length  || 0,
                    callEdges,
                    filesIndexed: files.length,
                    mode:         fullBuildApiKey ? 'semantic' : 'structural',
                    incremental:  false,
                });
                // Generate/update the project overview " the senior dev's mental model
                const overview = generateProjectOverview(graph, dirPath);
                saveProjectOverview(dirPath, overview);
                process.stderr.write(`[unravel] Project overview saved to ${dirPath}/.unravel/project-overview.md\n`);
            } catch (saveErr) {
                process.stderr.write(`[unravel] Could not persist graph: ${saveErr.message}\n`);
            }

            return {
                content: [{
                    type: 'text',
                    text: JSON.stringify({
                        status: 'ok',
                        incremental: false,
                        durationMs: Date.now() - buildStart,
                        stats: {
                            filesIndexed: files.length,
                            nodes: graph.nodes?.length || 0,
                            edges: graph.edges?.length || 0,
                            callEdges,
                        },
                        summary: `Knowledge Graph built: ${files.length} files, ${graph.nodes?.length || 0} nodes, ${graph.edges?.length || 0} edges (${callEdges} call edges). Use query_graph to find relevant files for a bug.`,
                    }, null, 2),
                }],
            };
        } catch (err) {
            return {
                content: [{ type: 'text', text: `Error: ${err.message}` }],
                isError: true,
            };
        }
    }
);

//  Phase 5c-1: Codex Pre-Briefing 
// Scans .unravel/codex/codex-index.md for tag matches against the symptom.
// If a match is found, reads the codex file and extracts the Discoveries section.
// Returns a pre_briefing object that query_graph injects into its response.
// This gives the agent automatic institutional memory from past debugging sessions.

/**
 * Search codex index for entries whose tags match the symptom.
 * Returns matching codex discoveries (the most valuable part for pre-briefing).
 *
 * @param {string} projectRoot - Path to project root (must contain .unravel/codex/)
 * @param {string} symptom - Bug description to match against codex tags
 * @returns {{ matches: Array<{ taskId: string, problem: string, discoveries: string }> }}
 */
async function searchCodex(projectRoot, symptom) {
    const result = { matches: [] };
    if (!projectRoot || !symptom) return result;

    const indexPath = join(projectRoot, '.unravel', 'codex', 'codex-index.md');
    if (!existsSync(indexPath)) return result;

    let indexContent;
    try { indexContent = readFileSync(indexPath, 'utf-8'); }
    catch { return result; }

    // Parse the markdown table rows
    // Format: | Task ID | Problem | Tags | Date |
    const rows = indexContent.split('\n')
        .filter(line => line.startsWith('|') && !line.includes('---') && !line.toLowerCase().includes('task id'))
        .map(line => {
            const cells = line.split('|').map(c => c.trim()).filter(Boolean);
            if (cells.length < 3) return null;
            return {
                taskId: cells[0],
                problem: cells[1],
                tags: cells[2].split(',').map(t => t.trim().toLowerCase()),
                date: cells[3] || null,   // Column 4: YYYY-MM-DD (already in codex-index.md format)
            };
        })
        .filter(Boolean);

    // Temporal recency helper
    // Scores [0..1]. Decays to 0.5 at ~30 days, 0.33 at ~60 days, neutral (0.5) if no date.
    // More recent codex entries better reflect current codebase state (inspired by Anamnesis temporal scoring).
    const recencyScore = (dateStr) => {
        if (!dateStr) return 0.5;
        const d = new Date(dateStr);
        if (isNaN(d.getTime())) return 0.5;
        const daysSince = (Date.now() - d.getTime()) / 86_400_000;
        return 1 / (1 + daysSince / 30);
    };

    if (rows.length === 0) return result;

    // Tokenize symptom into keywords (lowercase, remove common words)
    const STOP_WORDS = new Set(['the', 'a', 'an', 'is', 'are', 'was', 'were', 'in', 'on', 'at', 'to', 'for',
        'of', 'and', 'or', 'not', 'but', 'with', 'from', 'by', 'that', 'this', 'it', 'as', 'be',
        'has', 'have', 'had', 'do', 'does', 'did', 'will', 'would', 'could', 'should', 'can',
        'may', 'might', 'i', 'we', 'you', 'they', 'my', 'our', 'your', 'its', 'when', 'how',
        'what', 'which', 'who', 'whom', 'where', 'why', 'if', 'then', 'so', 'no', 'yes',
        'up', 'out', 'about', 'into', 'after', 'before', 'between', 'under', 'over',
        'also', 'just', 'more', 'some', 'any', 'each', 'every', 'all', 'both', 'few', 'most',
        'bug', 'error', 'issue', 'problem', 'broken', 'fix', 'fails', 'failing', 'wrong']);

    const symptomTokens = symptom.toLowerCase()
        .replace(/[^a-z0-9\s\-_]/g, ' ')
        .split(/\s+/)
        .filter(w => w.length > 2 && !STOP_WORDS.has(w));

    if (symptomTokens.length === 0) return result;

    // Score each codex row: count how many symptom tokens appear in tags or problem
    const scored = rows.map(row => {
        const tagText = row.tags.join(' ');
        const problemText = row.problem.toLowerCase();
        let score = 0;

        for (const token of symptomTokens) {
            // Exact tag match (high value)
            if (row.tags.some(tag => tag.includes(token))) score += 2;
            // Problem text match (lower value)
            else if (problemText.includes(token)) score += 1;
        }

        return { ...row, score };
    }).sort((a, b) => b.score - a.score)
      .slice(0, 3); // Max 3 codex matches — refined below with semantic scoring

    //  Phase 5c-3: Semantic Scoring 
    // If GEMINI_API_KEY is available, embed the codex entries and the symptom,
    // then compute cosine similarity to re-rank and catch entries that keyword
    // matching missed (different vocabulary, same concept).
    const apiKey = process.env.GEMINI_API_KEY;
    if (apiKey && rows.length > 0) {
        try {
            // Embed any un-embedded codex entries (incremental)
            const codexEmbeddings = await embedCodexEntries(projectRoot, rows, apiKey);

            if (codexEmbeddings) {
                // Compute semantic similarity for ALL rows (not just keyword-scored ones)
                const semanticScores = await scoreCodexSemantic(symptom, codexEmbeddings, apiKey);

                if (semanticScores) {
                    // Re-score: blend keyword (35%) + semantic (45%) + temporal recency (20%)
                    // Recency: more recent codex entries better reflect current codebase state.
                    // Neutral (0.5) when date absent " no penalty for undated entries.
                    const maxKeywordScore = Math.max(1, symptomTokens.length * 2);

                    const allScored = rows.map(row => {
                        const kwScore = (() => {
                            let s = 0;
                            const problemText = row.problem.toLowerCase();
                            for (const token of symptomTokens) {
                                if (row.tags.some(tag => tag.includes(token))) s += 2;
                                else if (problemText.includes(token)) s += 1;
                            }
                            return s;
                        })();
                        const semScore = semanticScores[row.taskId] || 0;
                        const recency  = recencyScore(row.date);
                        // Weights: kw=0.35, sem=0.45, recency=0.20 (sum=1.0)
                        const blended  = (kwScore / maxKeywordScore) * 0.35 + semScore * 0.45 + recency * 0.20;
                        return { ...row, score: kwScore, semanticScore: semScore, recency, blendedScore: blended };
                    })
                    .filter(r => r.blendedScore >= 0.3 || r.score >= 2) // Keep semantic hits or strong keyword hits
                    .sort((a, b) => b.blendedScore - a.blendedScore)
                    .slice(0, 3);

                    process.stderr.write(`[unravel:codex] Semantic re-rank: ${allScored.length} entries (keyword+semantic+recency blend)\n`);

                    // Read discoveries for the blended top entries
                    for (const match of allScored) {
                        const codexPath = join(projectRoot, '.unravel', 'codex', `codex-${match.taskId}.md`);
                        if (!existsSync(codexPath)) continue;
                        let codexContent;
                        try { codexContent = readFileSync(codexPath, 'utf-8'); } catch { continue; }
                        const discoveriesMatch = codexContent.match(/## Discoveries\s*\n([\s\S]*?)(?=\n## |$)/);
                        const discoveries = discoveriesMatch ? discoveriesMatch[1].trim() : null;
                        if (discoveries) {
                            result.matches.push({
                                taskId: match.taskId,
                                problem: match.problem,
                                relevance_score: Math.round(match.blendedScore * 10) / 10,
                                semantic_score: Math.round(match.semanticScore * 100) / 100,
                                keyword_score: match.score,
                                recency_score: Math.round((match.recency || 0.5) * 100) / 100,
                                discoveries,
                            });
                        }
                    }

                    if (result.matches.length > 0) {
                        process.stderr.write(`[unravel:codex] Pre-briefing: ${result.matches.length} codex entries (semantic+keyword blend).\n`);
                    }
                    return result;
                }
            }
        } catch (err) {
            process.stderr.write(`[unravel:codex] Semantic scoring failed (${err.message}), falling back to keyword.\n`);
        }
    }

    // "" Keyword-only fallback (no API key or semantic failed) """""""""""""
    // Still applies temporal recency (20%) as a tiebreaker between equal-keyword matches.
    const maxKwFallback = Math.max(1, symptomTokens.length * 2);
    const keywordScored = rows.map(row => {
        const problemText = row.problem.toLowerCase();
        let kwScore = 0;
        for (const token of symptomTokens) {
            if (row.tags.some(tag => tag.includes(token))) kwScore += 2;
            else if (problemText.includes(token)) kwScore += 1;
        }
        const recency = recencyScore(row.date);
        // Keyword-only blend: kw=0.80, recency=0.20 (no semantic dim available)
        const blended = (kwScore / maxKwFallback) * 0.80 + recency * 0.20;
        return { ...row, score: kwScore, recency, blendedScore: blended };
    }).filter(r => r.score >= 2)
      .sort((a, b) => b.blendedScore - a.blendedScore)
      .slice(0, 3);

    // Keyword-only: read discoveries for top matches
    for (const match of keywordScored) {
        const codexPath = join(projectRoot, '.unravel', 'codex', `codex-${match.taskId}.md`);
        if (!existsSync(codexPath)) continue;

        let codexContent;
        try { codexContent = readFileSync(codexPath, 'utf-8'); }
        catch { continue; }

        // Extract text between "## Discoveries" and the next "## " heading
        const discoveriesMatch = codexContent.match(/## Discoveries\s*\n([\s\S]*?)(?=\n## |$)/);
        const discoveries = discoveriesMatch
            ? discoveriesMatch[1].trim()
            : null;

        if (discoveries) {
            result.matches.push({
                taskId: match.taskId,
                problem: match.problem,
                score: match.score,
                recency_score: Math.round((match.recency || 0.5) * 100) / 100,
                discoveries,
            });
        }
    }

    if (result.matches.length > 0) {
        process.stderr.write(`[unravel:codex] Pre-briefing: ${result.matches.length} matching codex entries found.\n`);
    }

    return result;
}

// "" Phase 5c-4: Auto-Seed Codex from verify(PASSED) """"""""""""""""""""""""""
// Generates a minimal, verified codex entry automatically after every clean verify.
//
// WHY: The Codex retrieval system (searchCodex ' pre_briefing in query_graph) is
// fully built but the write-side depends on agents voluntarily creating codex files.
// In practice agents skip this. autoSeedCodex bridges the gap: it writes a minimal
// entry from data we already have at verify(PASSED) " data that is 100% verified.
//
// WHAT IT WRITES:
//   codex-auto-{timestamp}.md  ' TLDR + Discoveries (DECISION entries only, per spec)
//   .unravel/codex/codex-index.md  ' one index row (appended, or bootstrapped)
//
// WHAT IT DOES NOT DO (per context_plan.md "What NOT to Build"):
//   - Does NOT auto-generate DISCOVERIES via LLM " entries are sourced from
//     verified rootCause + evidence[] only ("earned" by the verify gate).
//   - Does NOT overwrite existing agent-written codex files.
//
// FALLBACK: If projectRoot is absent (inline-files analyze path), writes nothing.
// """""""""""""""""""""""""""""""""""""""""""""""""""""""""""""""""""""""""""""

function autoSeedCodex(projectRoot, { symptom, rootCause, codeLocation, evidence }) {
    if (!projectRoot) return;

    try {
        const today = new Date().toISOString().slice(0, 10); // YYYY-MM-DD
        const taskId = `auto-${Date.now()}`;
        const codexDir = join(projectRoot, '.unravel', 'codex');
        mkdirSync(codexDir, { recursive: true });

        // "" Parse evidence[] for file:line citations ' DECISION entries """"""
        // Evidence strings look like: "PaymentService.ts L47: forEach(async ...)"
        // or: "scheduler.js:20 " doThing() mutates shared state"
        const FILE_LINE_RE = /([\w.\-/\\]+\.(js|jsx|ts|tsx|py|go|rs|java|cs|cpp|c|rb|php))[:\s]L?(\d+)/i;

        const byFile = new Map(); // basename → [{lineN, snippet}]
        for (const ev of (evidence || [])) {
            const m = ev.match(FILE_LINE_RE);
            if (!m) continue;
            const fname = m[1].split(/[/\\]/).pop();
            const lineN = m[3];
            const snippet = ev.slice(0, 120).replace(/\n/g, ' ');
            if (!byFile.has(fname)) byFile.set(fname, []);
            byFile.get(fname).push({ lineN, snippet });
        }

        // Also try rootCause itself in case evidence[] is sparse
        const rcMatch = rootCause.match(FILE_LINE_RE);
        if (rcMatch) {
            const fname = rcMatch[1].split(/[/\\]/).pop();
            const lineN = rcMatch[3];
            if (!byFile.has(fname)) byFile.set(fname, []);
            const already = byFile.get(fname).some(e => e.lineN === lineN);
            if (!already) byFile.get(fname).push({ lineN, snippet: rootCause.slice(0, 120) });
        }

        // "" Build ## Discoveries block """"""""""""""""""""""""""""""""""""""""
        let discoveriesBlock = '';
        if (byFile.size > 0) {
            for (const [fname, entries] of byFile) {
                discoveriesBlock += `\n### ${fname}\n`;
                discoveriesBlock += `Discovery context: ${symptom ? symptom.slice(0, 100) : 'bug diagnosis'}\n\n`;
                for (const { lineN, snippet } of entries) {
                    discoveriesBlock += `- L${lineN} → DECISION: ${snippet} â€” confirmed bug site. _(auto-seeded from verify)_\n`;
                }
            }
        } else {
            discoveriesBlock = `\n### (root cause)\nDiscovery context: ${(symptom || '').slice(0, 100)}\n\n`;
            discoveriesBlock += `- → DECISION: ${rootCause.slice(0, 200)}\n`;
        }

        // "" Extract tags (stopword-filtered, max 6) """""""""""""""""""""""""""
        const STOPWORDS = new Set(['the','a','an','in','on','at','to','for','of','and','or','is','are','was','were','be','been','that','this','with','it','not','from','by','as']);
        const rawTokens = ((symptom || '') + ' ' + rootCause)
            .toLowerCase()
            .replace(/[^a-z0-9\s_-]/g, ' ')
            .split(/\s+/)
            .filter(t => t.length > 3 && !STOPWORDS.has(t));
        const tags = [...new Set(rawTokens)].slice(0, 6).join(', ');

        // "" Write codex-{taskId}.md """""""""""""""""""""""""""""""""""""""""""
        const tldrLines = [
            symptom ? symptom.slice(0, 100) : 'Bug diagnosed and verified.',
            `Root cause: ${rootCause.slice(0, 120)}`,
            codeLocation ? `Fixed at: ${codeLocation}` : '',
        ].filter(Boolean).join('\n');

        const codexContent = `## TLDR\n${tldrLines}\n\n## Discoveries\n${discoveriesBlock.trim()}\n\n## Edits\n_(auto-seeded â€” no edits recorded. Agent should append edits manually.)_\n\n## Meta\nProblem: ${(symptom || rootCause).slice(0, 200)}\nTags: ${tags}\nFiles touched: ${[...byFile.keys()].join(', ') || codeLocation || 'unknown'}\n\n## Layer 4 â€” What to skip next time\n_(auto-seeded â€” agent should fill in skip zones during the next session.)_\n`;

        const codexPath = join(codexDir, `codex-${taskId}.md`);
        writeFileSync(codexPath, codexContent, 'utf-8');

        // "" Append row to codex-index.md (bootstrap if missing) """"""""""""""
        const indexPath = join(codexDir, 'codex-index.md');
        const problemShort = ((symptom || rootCause).slice(0, 60)).replace(/\|/g, '-');
        const indexRow = `| ${taskId} | ${problemShort} | ${tags} | ${today} |\n`;

        if (!existsSync(indexPath)) {
            writeFileSync(indexPath,
                `| Task ID | Problem | Tags | Date |\n|---------|---------|------|------|\n${indexRow}`,
                'utf-8'
            );
        } else {
            appendFileSync(indexPath, indexRow, 'utf-8');
        }

        process.stderr.write(`[unravel:codex] Auto-seeded: codex-${taskId}.md (${byFile.size} file(s), tags: ${tags})\n`);
    } catch (err) {
        // Non-fatal " never block the verify response
        process.stderr.write(`[unravel:codex] Auto-seed failed (non-fatal): ${err.message}\n`);
    }
}

//  Tool 4: unravel.query_graph 
// Ask the KG which files are relevant to a symptom.
server.tool(
    'query_graph',
    'Query the Knowledge Graph to find files most relevant to a symptom. Returns a ranked list. Use this to focus your investigation. STRATEGY: Take these files and pass them to unravel.analyze along with the symptom to begin the Sandwich Protocol. NOTE: This returns FILE NAMES only, not analysis or answers. For architectural questions, understanding code, data flow analysis, or getting evidence-backed answers about your project, use consult instead.',
    {
        symptom: z.string().describe('Bug description, error message, or feature area to investigate.'),
        directory: z.string().optional().describe('Project root. If omitted, uses the directory from the last build_map call.'),
        maxResults: z.number().optional().describe('Maximum number of files to return (default: 12).'),
    },
    async (args) => {
        try {
            let graph = session.graph;
            const projectRoot = args.directory ? resolve(args.directory) : session.projectRoot;

            // Try loading from disk if not in session
            if (!graph && projectRoot) {
                graph = loadGraph(projectRoot);
                if (graph) {
                    session.graph = graph;
                    process.stderr.write(`[unravel] Loaded existing graph from ${projectRoot}/.unravel/knowledge.json\n`);
                }
            }

            if (!graph || !graph.nodes || graph.nodes.length === 0) {
                throw new Error('No Knowledge Graph available. Call build_map first to index your project.');
            }

            const maxResults = args.maxResults || 12;

            //  Phase 5b hook: Semantic routing via gemini-embedding-2-preview 
            // If GEMINI_API_KEY is set AND nodes have embeddings, compute cosine
            // similarity between the symptom and all node embeddings.
            // The resulting Map<nodeId, score> is passed into expandWeighted() which
            // adds a semantic bonus (+0.4 * similarity) to both seed and hop scores.
            // Falls back to keyword-only (empty Map) if key absent or embed fails.
            let _semanticScores = new Map();
            const queryApiKey = process.env.GEMINI_API_KEY;
            const hasEmbeddings = graph.nodes?.some(n => n.embedding);
            if (queryApiKey && hasEmbeddings) {
                _semanticScores = await buildSemanticScores(args.symptom, graph, queryApiKey).catch(e => {
                    process.stderr.write(`[unravel:embed] Semantic scoring failed: ${e.message} — using keyword-only.\n`);
                    return new Map();
                });
            } else if (!queryApiKey) {
                process.stderr.write('[unravel:embed] No GEMINI_API_KEY — using keyword-only routing.\n');
            } else {
                process.stderr.write('[unravel:embed] No node embeddings found — run build_map with GEMINI_API_KEY to enable semantic routing.\n');
            }

            // -- Pattern boosts: if a prior analyze() ran, pattern-matched node boosts
            // are merged into _semanticScores. Files whose names match a detected bug-type
            // keyword (e.g. 'race', 'listener', 'closure') get a traversal bonus alongside
            // semantic embedding scores. No-op when session.astRaw is null (first call before analyze).
            if (session.astRaw && getNodeBoosts) {
                const _patternMatches = matchPatterns(session.astRaw);
                if (_patternMatches.length > 0) {
                    const _boosts = getNodeBoosts(graph.nodes, _patternMatches);
                    for (const [nodeId, boost] of _boosts) {
                        const existing = _semanticScores.get(nodeId) ?? 0;
                        _semanticScores.set(nodeId, Math.max(existing, boost));
                    }
                    if (_boosts.size > 0) {
                        process.stderr.write(`[unravel:pattern] query_graph: ${_boosts.size} node boost(s) from pattern matches merged into routing.\n`);
                    }
                }
            }

            const rankedFiles = queryGraphForFiles(graph, args.symptom, maxResults, _semanticScores);

            // "" Phase 5c-1: Codex Pre-Briefing """""""""""""""""""""""""""""""""""
            // Search .unravel/codex/ for past debugging sessions relevant to
            // this symptom. If found, inject discoveries as pre_briefing so
            // the agent reads 10 lines of prior knowledge instead of opening
            // raw source files.
            const codexResult = await searchCodex(projectRoot, args.symptom);

            const response = {
                symptom: args.symptom,
                relevantFiles: rankedFiles,
                fileCount: rankedFiles.length,
                suggestion: rankedFiles.length > 0
                    ? `Read these ${rankedFiles.length} files and pass them to 'analyze' along with the symptom.`
                    : 'No relevant files found. The symptom may not match any indexed code. Try a different description or build_map with more files.',
            };

            // Inject pre_briefing ONLY if matching codex entries exist
            if (codexResult.matches.length > 0) {
                response.pre_briefing = {
                    note: 'Prior debugging sessions matched this symptom. Read these discoveries BEFORE opening any files — they may contain key insights that save investigation time.',
                    entries: codexResult.matches.map(m => ({
                        codex: `codex-${m.taskId}`,
                        problem: m.problem,
                        relevance_score: m.relevance_score ?? m.score,
                        discoveries: m.discoveries,
                    })),
                };
                response.suggestion = `⚡ PRE-BRIEFING: ${codexResult.matches.length} past session(s) matched this symptom — read the pre_briefing first. Then read the ${rankedFiles.length} files and pass them to 'analyze'.`;
            }

            return {
                content: [{
                    type: 'text',
                    text: JSON.stringify(response, null, 2),
                }],
            };
        } catch (err) {
            return {
                content: [{ type: 'text', text: `Error: ${err.message}` }],
                isError: true,
            };
        }
    }
);

//  Phase 6: query_visual 
server.tool(
    'query_visual',
    `Find source files relevant to a visual bug report (screenshot, diagram, or UI artifact).

Embeds the image using Gemini Embedding 2 Preview's cross-modal vector space — where images and
code summaries share the same 768-dimensional geometry. Cosine similarity finds the code files
closest to what the image shows.

If \`symptom\` text is also provided, fuses the image embedding (60%) with the text embedding (40%)
for higher precision. Always degrades gracefully: if no embeddings exist in the KG, returns an
error with a clear instruction to run build_map first.

**When to use:**
- User pastes a screenshot of a broken UI
- User uploads a diagram showing unexpected behavior
- Visual bug that's hard to describe in text alone

**Prerequisites:** build_map must have run with GEMINI_API_KEY set so KG nodes have embeddings.`,
    {
        image: z.string().describe(
            'The visual input. Accepts: (1) base64-encoded image string, (2) data-URL ("data:image/png;base64,..."), or (3) absolute file path to PNG/JPEG/WebP/GIF.'
        ),
        symptom: z.string().optional().describe(
            'Optional text description of the bug. Combined with the image embedding for higher precision routing.'
        ),
        directory: z.string().optional().describe(
            'Project root. If omitted, uses the directory from the last build_map call.'
        ),
        maxResults: z.number().optional().describe(
            'Maximum number of files to return (default: 10).'
        ),
    },
    async (args) => {
        try {
            const apiKey = process.env.GEMINI_API_KEY;
            if (!apiKey) {
                return {
                    content: [{ type: 'text', text: JSON.stringify({
                        error: 'GEMINI_API_KEY not set. query_visual requires the Gemini Embedding API for cross-modal search.',
                        hint: 'Set GEMINI_API_KEY in your environment and run build_map to index the project with embeddings.',
                    }, null, 2) }],
                    isError: true,
                };
            }

            // Load graph
            let graph = session.graph;
            const projectRoot = args.directory ? resolve(args.directory) : session.projectRoot;
            if (!graph && projectRoot) {
                graph = loadGraph(projectRoot);
                if (graph) session.graph = graph;
            }

            if (!graph?.nodes?.length) {
                return {
                    content: [{ type: 'text', text: JSON.stringify({
                        error: 'No Knowledge Graph found. Run build_map first.',
                        hint: 'build_map with GEMINI_API_KEY set will embed KG nodes so query_visual can search them.',
                    }, null, 2) }],
                    isError: true,
                };
            }

            // Check how many nodes actually have embeddings
            const embeddedNodes = graph.nodes.filter(n => n.embedding?.length > 0);
            if (embeddedNodes.length === 0) {
                return {
                    content: [{ type: 'text', text: JSON.stringify({
                        error: 'KG has no embedded nodes. Run build_map with GEMINI_API_KEY set to enable semantic search.',
                        hint: `Found ${graph.nodes.length} structural nodes but 0 embeddings. Delete .unravel/knowledge.json and rebuild.`,
                    }, null, 2) }],
                    isError: true,
                };
            }

            const maxResults = args.maxResults || 10;
            const startMs = Date.now();

            // Embed the image
            process.stderr.write('[unravel:visual] Embedding image...\n');
            const imageVec = await embedImage(args.image, apiKey);
            if (!imageVec) {
                return {
                    content: [{ type: 'text', text: JSON.stringify({
                        error: 'Failed to embed image. Check that the image is a valid PNG/JPEG/WebP/GIF and the API key is valid.',
                    }, null, 2) }],
                    isError: true,
                };
            }

            // Optionally embed symptom text and fuse
            let queryVec = imageVec;
            if (args.symptom?.trim()) {
                process.stderr.write('[unravel:visual] Fusing with symptom text embedding...\n');
                const textVec = await embedText(args.symptom, apiKey, 'RETRIEVAL_QUERY');
                queryVec = fuseEmbeddings(imageVec, textVec, 0.6); // 60% image, 40% text
            }

            // Score all embedded nodes by cosine similarity
            const scored = [];
            for (const node of embeddedNodes) {
                const sim = cosineSimilarity(queryVec, node.embedding);
                if (sim > 0) {
                    scored.push({
                        file: node.filePath || node.name,
                        similarity: Math.round(sim * 1000) / 1000,
                        nodeId: node.id,
                    });
                }
            }

            scored.sort((a, b) => b.similarity - a.similarity);
            const topFiles = scored.slice(0, maxResults);
            const uniqueFiles = [...new Map(topFiles.map(r => [r.file, r])).values()];

            process.stderr.write(`[unravel:visual] Ranked ${embeddedNodes.length} nodes → top ${uniqueFiles.length} files in ${Date.now() - startMs}ms.\n`);

            return {
                content: [{
                    type: 'text',
                    text: JSON.stringify({
                        mode: args.symptom ? 'image+text (fused)' : 'image-only',
                        embeddedNodesSearched: embeddedNodes.length,
                        durationMs: Date.now() - startMs,
                        relevantFiles: uniqueFiles.map(r => r.file),
                        scores: uniqueFiles,
                        suggestion: uniqueFiles.length > 0
                            ? `Pass these ${uniqueFiles.length} files to 'analyze' with a symptom description to get AST-verified root cause.`
                            : 'No similar files found. The KG may not have embedded nodes matching this image. Try adding a symptom description.',
                    }, null, 2),
                }],
            };
        } catch (err) {
            return {
                content: [{ type: 'text', text: `Error: ${err.message}` }],
                isError: true,
            };
        }
    }
);

// 
// Start
// 

// =============================================================================
// Tool 5: unravel.consult " Project Intelligence Mode
// =============================================================================

const SETUP_REQUIRED_RESPONSE = {
    status: 'SETUP_REQUIRED',
    message: 'Consult needs a free Gemini API key to build your project\'s semantic knowledge graph. This is a one-time setup â€” takes about 2 minutes.',
    why: 'Consult uses the Gemini Embedding API (free tier) to convert your source files into 768-dimensional vectors. This enables semantic routing â€” finding the right files by meaning, not just keywords. It also powers cross-session memory: past debugging sessions are recalled automatically when relevant.',
    setup_steps: [
        '1. Go to https://aistudio.google.com/apikey',
        '2. Sign in with your Google account (free)',
        '3. Click "Create API Key" → select or create a Cloud project → copy the key',
        '4. Add it to the "env" block in your MCP server config (same file where you added Unravel):',
        '   {"env": {"GEMINI_API_KEY": "your-key-here"}}',
        '   Config file locations:',
        '     Claude Desktop (Mac): ~/Library/Application Support/Claude/claude_desktop_config.json',
        '     Claude Desktop (Win): %APPDATA%\\Claude\\claude_desktop_config.json',
        '     Cursor:               .cursor/mcp.json (project root)',
        '     VS Code:              .vscode/mcp.json',
        '     Claude Code:          ~/.claude.json or .mcp.json',
        '     Windsurf:             ~/.codeium/windsurf/mcp_config.json',
        '5. Restart the MCP server (most clients auto-restart on config save)',
        '6. Call consult again â€” it will auto-build your KG on the first call (~15-30s, one-time)',
    ],
    free_tier: 'Gemini Embedding free tier: 1,500 req/min â€” enough for most repos. See: https://ai.google.dev/pricing',
    after_setup: 'Just call consult again. First call auto-builds the KG (one-time). Every subsequent call is instant.',
};

// -- Helper: extract JSDoc/TSDoc summary from raw file content -----------------
// Zero-cost regex pass. No AST, no API calls, runs synchronously.
// Extracts the first meaningful /** ... */ block preceding a top-level declaration,
// OR the first substantive single-line // comment above a function/class/const.
// Returns a trimmed string ≤150 chars, or null if nothing useful is found.
function extractJsDocSummary(content) {
    if (!content || typeof content !== 'string') return null;

    // Pattern A: /** ... */ block immediately before a top-level declaration
    // Handles @param/@returns lines by filtering them out, keeping the description text.
    const jsdocRe = /\/\*\*\s*([\s\S]*?)\s*\*\/\s*(?:export\s+)?(?:async\s+)?(?:function|class|const|let|var)\s+\w/g;
    let match;
    while ((match = jsdocRe.exec(content)) !== null) {
        const text = match[1]
            .split('\n')
            .map(l => l.replace(/^\s*\*\s?/, '').trim())   // strip leading " * "
            .filter(l => l && !l.startsWith('@'))           // drop @param, @returns etc
            .join(' ')
            .replace(/\s+/g, ' ')
            .trim();
        if (text.length > 10) return text.slice(0, 150);
    }

    // Pattern B: A single // comment line directly above a top-level fn/class/const
    const singleRe = /\/\/\s*(.{10,})\n\s*(?:export\s+)?(?:async\s+)?(?:function|class|const\s+\w+\s*=\s*(?:async\s+)?\()/g;
    while ((match = singleRe.exec(content)) !== null) {
        const text = match[1].trim();
        // Skip comment lines that look like section dividers (all dashes, equals, etc.)
        if (/^[-=*]+$/.test(text)) continue;
        if (text.length > 10) return text.slice(0, 150);
    }

    return null;
}

// -- Helper: load human-written context files (README, CHANGELOG, docs, etc.) --
// These files contain intent, goals, and domain knowledge that AST cannot derive.
// Each file is tagged with a trust level so the LLM weighs it appropriately.
// Cost: zero (pure file reads). No LLM calls.
function loadContextFiles(projectRoot) {
    const PATTERNS = [
        'README.md', 'readme.md', 'README.txt',
        'ARCHITECTURE.md', 'DESIGN.md', 'OVERVIEW.md',
        'CHANGELOG.md', 'HISTORY.md', 'CHANGES.md',
        'CONTRIBUTING.md', 'DEVELOPMENT.md',
    ];
    const TRUST = (name) => {
        const n = name.toLowerCase();
        if (n.includes('changelog') || n.includes('history') || n.includes('changes')) return 'high';
        return 'medium';
    };

    let explicitPaths = [], explicitTrust = {}, maxCharsPerFile = 6000;
    try {
        const cfgPath = join(projectRoot, '.unravel', 'context.json');
        if (existsSync(cfgPath)) {
            const cfg = JSON.parse(readFileSync(cfgPath, 'utf8'));
            explicitPaths = (cfg.include || []).map(p => join(projectRoot, p));
            explicitTrust = cfg.trust || {};
            if (cfg.maxCharsPerFile) maxCharsPerFile = cfg.maxCharsPerFile;
        }
    } catch (_) { /* non-fatal */ }

    const results = [], seen = new Set();
    const tryLoad = (filePath, overrideTrust) => {
        const norm = filePath.replace(/\\/g, '/');
        if (seen.has(norm)) return;
        seen.add(norm);
        try {
            if (!existsSync(filePath)) return;
            if (statSync(filePath).size > maxCharsPerFile * 4) return;
            const content = readFileSync(filePath, 'utf8').slice(0, maxCharsPerFile);
            const name = filePath.split(/[/\\]/).pop() || filePath;
            results.push({ name, trust: overrideTrust || explicitTrust[name] || TRUST(name), content: content.trimEnd() });
        } catch (_) { /* non-fatal */ }
    };

    for (const p of explicitPaths) tryLoad(p, null);
    for (const p of PATTERNS)      tryLoad(join(projectRoot, p), null);

    // Auto-scan root and docs/ for how-*.md, arch*.md, design*.md
    for (const base of [projectRoot, join(projectRoot, 'docs'), join(projectRoot, '.unravel', 'context')]) {
        try {
            if (!existsSync(base)) continue;
            for (const f of readdirSync(base)) {
                const fl = f.toLowerCase();
                if ((fl.startsWith('how_') || fl.startsWith('how-') || fl.startsWith('arch') || fl.startsWith('design') || fl.startsWith('guide_') || fl.startsWith('guide-')) && fl.endsWith('.md'))
                    tryLoad(join(base, f), null);
            }
        } catch (_) { /* non-fatal */ }
    }

    return results; // [{ name, trust, content }]
}

// -- Helper: git context layer ------------------------------------------------
// Recent file activity, commit messages, hotspot files, unstaged changes.
// Cached per HEAD commit -- re-runs only when HEAD changes. Zero API calls.
// Returns null silently if git is not installed or projectRoot is not a repo.
function getGitContext(projectRoot) {
    const gitExec = (cmd) => {
        try {
            return childProcess.execSync(
                `git -C "${projectRoot}" ${cmd}`,
                { encoding: 'utf8', timeout: 5000, stdio: ['pipe', 'pipe', 'pipe'] }
            ).trim();
        } catch (_) { return null; }
    };

    const headHash = gitExec('rev-parse HEAD');
    if (!headHash) return null; // not a git repo or git not installed

    const cacheFile = join(projectRoot, '.unravel', 'git-context.json');
    try {
        if (existsSync(cacheFile)) {
            const cached = JSON.parse(readFileSync(cacheFile, 'utf8'));
            if (cached.headHash === headHash) return cached.data;
        }
    } catch (_) { /* cache miss — rebuild */ }

    const recentFilesRaw = gitExec('log --since="14 days ago" --name-only --pretty=format:""') || '';
    const churnRaw       = gitExec('log --since="30 days ago" --name-only --pretty=format:""') || '';
    const recentCommits  = gitExec('log --oneline -8') || '';
    const unstagedFiles  = gitExec('diff --name-only') || '';
    const stagedFiles    = gitExec('diff --cached --name-only') || '';

    const churnMap = {};
    for (const l of churnRaw.split('\n').filter(Boolean)) churnMap[l.trim()] = (churnMap[l.trim()] || 0) + 1;
    const hotFiles    = Object.entries(churnMap).sort((a, b) => b[1] - a[1]).slice(0, 8).map(([f, c]) => `${f} (${c} commits)`);
    const recentFiles = [...new Set(recentFilesRaw.split('\n').filter(Boolean))].slice(0, 10);

    const data = {
        recentFiles,
        hotFiles,
        recentCommits: recentCommits.split('\n').filter(Boolean).slice(0, 8),
        unstagedFiles: unstagedFiles.split('\n').filter(Boolean),
        stagedFiles:   stagedFiles.split('\n').filter(Boolean),
    };

    try {
        mkdirSync(join(projectRoot, '.unravel'), { recursive: true });
        writeFileSync(cacheFile, JSON.stringify({ headHash, data }, null, 2), 'utf8');
    } catch (_) { /* non-fatal */ }

    return data;
}

// -- Helper: dependency manifest ---------------------------------------------
// Reads package.json / requirements.txt / go.mod. Zero cost. Zero API calls.
function loadDependencyManifest(projectRoot) {
    try {
        const pkgPath = join(projectRoot, 'package.json');
        if (existsSync(pkgPath)) {
            const pkg = JSON.parse(readFileSync(pkgPath, 'utf8'));
            return {
                runtime: Object.keys(pkg.dependencies || {}).slice(0, 20),
                dev:     Object.keys(pkg.devDependencies || {}).slice(0, 10),
                engines: pkg.engines ? JSON.stringify(pkg.engines) : null,
                packageManager: pkg.packageManager || null,
            };
        }
    } catch (_) { /* try next */ }
    try {
        const reqPath = join(projectRoot, 'requirements.txt');
        if (existsSync(reqPath)) {
            return { runtime: readFileSync(reqPath, 'utf8').split('\n').filter(l => l.trim() && !l.startsWith('#')).map(l => l.trim().split(/[>=<!=]/)[0]).slice(0, 20), dev: [], engines: null, packageManager: null };
        }
    } catch (_) { /* try next */ }
    try {
        const goPath = join(projectRoot, 'go.mod');
        if (existsSync(goPath)) {
            return { runtime: readFileSync(goPath, 'utf8').split('\n').filter(l => l.match(/^\t\S/)).map(l => l.trim().split(/\s+/)[0]).slice(0, 20), dev: [], engines: null, packageManager: null };
        }
    } catch (_) { /* non-fatal */ }
    return null;
}

// -- Helper: inline readiness score for @0 -----------------------------------
// Replaces the buried JSON blob at the bottom with a human-readable summary
// the LLM sees upfront before reading any evidence.
function formatReadinessInline({ graph, codexMatches, archiveHits, filesAnalyzed }) {
    const embeddedCount = (graph?.nodes || []).filter(n => n.embedding?.length > 0).length;
    const totalNodes    = (graph?.nodes || []).length;
    const kg  = totalNodes > 0, emb = embeddedCount > 0, ast = filesAnalyzed > 0;
    const cod = codexMatches > 0, arc = archiveHits > 0;
    const core = [kg, emb, ast].filter(Boolean).length;
    const mem  = [cod, arc].filter(Boolean).length;
    const score = mem > 0 ? `${core}/3 core + ${mem}/2 memory` : `${core}/3 core`;
    const rows = [
        `  KG: ${kg  ? '✓' : '✗'} ${totalNodes} nodes · ${graph?.edges?.length || 0} edges${emb ? ` · ${embeddedCount} embedded` : ' (no embeddings — GEMINI_API_KEY needed)'}`,
        `  AST: ${ast ? '✓' : '✗'} ${filesAnalyzed} file(s) fully analyzed`,
        `  Codex: ${cod ? '✓' : '✗'} ${codexMatches} past debug session(s) matched`,
        `  Archive: ${arc ? '✓' : '✗'} ${archiveHits} past verified fix(es) found`,
    ];
    const tip = core < 3 ? 'Set GEMINI_API_KEY to enable semantic routing.'
              : mem === 0 ? 'Run analyze → verify on a real bug to activate memory layers.'
              : 'All layers active — maximum oracle intelligence.';
    return { score, rows, tip };
}

// -- Helper: out-of-scope file list enriched with KG metadata ----------------
// Shows semantic tags + role for files that are NOT in AST scope but ARE in the KG.
// Lets the LLM reason about files it can't inspect and surface include:[X] hints.
function buildOutOfScopeWithMeta(outOfScopePaths, graph) {
    if (!graph?.nodes?.length) return outOfScopePaths.map(p => ({ path: p, tags: [], summary: '' }));
    const nodeMap = new Map();
    for (const n of graph.nodes) {
        if (n.filePath) nodeMap.set(n.filePath.replace(/\\/g, '/'), n);
        if (n.id)       nodeMap.set(String(n.id).replace(/\\/g, '/'), n);
    }
    return outOfScopePaths.map(p => {
        const norm = p.replace(/\\/g, '/');
        const node = nodeMap.get(norm) || null;
        const tags = (node?.tags || []).filter(t => !norm.includes(t) && t.length > 2 && !t.includes('/'));
        const summary = (node?.fileSummary || node?.summary || '').slice(0, 80);
        return { path: p, tags: tags.slice(0, 4), summary };
    });
}

function buildReadiness({ graph, codexMatches, archiveHits, patternMatches, filesAnalyzed }) {
    const embeddedCount = (graph?.nodes || []).filter(n => n.embedding?.length > 0).length;
    const totalNodes    = (graph?.nodes || []).length;
    const layers = {
        knowledge_graph:      { active: totalNodes > 0, detail: totalNodes > 0 ? `${totalNodes} nodes, ${graph?.edges?.length || 0} edges` : 'Not built. Auto-builds on next call if GEMINI_API_KEY is set.' },
        semantic_embeddings:  { active: embeddedCount > 0, detail: embeddedCount > 0 ? `${embeddedCount}/${totalNodes} nodes embedded â€” semantic routing active` : 'No embeddings. Set GEMINI_API_KEY and rebuild KG.' },
        ast_analysis:         { active: filesAnalyzed > 0, detail: filesAnalyzed > 0 ? `${filesAnalyzed} file(s) analyzed â€” native tree-sitter` : 'No files analyzed.' },
        codex:                { active: codexMatches > 0, detail: codexMatches > 0 ? `${codexMatches} past session(s) matched` : 'No codex entries matched. analyze → verify sessions populate this automatically.' },
        diagnosis_archive:    { active: archiveHits > 0, detail: archiveHits > 0 ? `${archiveHits} past fix(es) found in this area` : 'No archive matches. Each verify(PASSED) adds an entry automatically.' },
    };
    // Score: core layers (KG, embeddings, AST) are the foundation.
    // Memory layers (codex, archive) are growth bonuses " they only populate
    // after multiple debug sessions, so a fresh project shouldn't look broken.
    const coreActive = [layers.knowledge_graph, layers.semantic_embeddings, layers.ast_analysis].filter(l => l.active).length;
    const memoryActive = [layers.codex, layers.diagnosis_archive].filter(l => l.active).length;
    const scoreLabel = memoryActive > 0
        ? `${coreActive}/3 core + ${memoryActive}/2 memory`
        : `${coreActive}/3 core`;
    const tips = [];
    if (coreActive === 3 && memoryActive === 0) tips.push('Core analysis fully active. Debug with analyze → verify to grow codex and archive for even richer answers.');
    else if (coreActive < 3) tips.push('Some core layers are inactive. Ensure GEMINI_API_KEY is set and files are in scope.');
    else if (!layers.codex.active) tips.push('Run analyze → verify to grow project memory.');
    else if (!layers.diagnosis_archive.active) tips.push('Each verify(PASSED) call adds an archive entry. Debug more to grow it.');
    return {
        score: scoreLabel,
        layers,
        tip: tips.length > 0 ? tips[0] : 'All layers active â€” maximum project intelligence.',
    };
}

// ── Scholar-Mode Section Extraction ─────────────────────────────────────────
// Instead of dumping full context docs into the output, extract only the
// sections whose headings are relevant to the query. Returns: heading index
// (for navigation) + top matching sections (for content). Full document
// accessible via view_file for anything not included.
const _CONSULT_STOP_WORDS = new Set([
    'the','a','an','is','are','was','were','be','been','being','have','has','had',
    'do','does','did','will','would','could','should','may','might','can','shall',
    'to','of','in','for','on','with','at','by','from','as','into','through',
    'during','before','after','and','but','or','nor','not','so','yet','both',
    'either','neither','each','every','all','any','few','more','most','other',
    'some','such','no','only','own','same','than','too','very','just','how',
    'what','where','when','why','which','who','whom','this','that','these',
    'those','about','work','use','using','get','set','make','like',
]);

function extractRelevantSections(content, query, maxTotalChars = 2500) {
    const queryWords = (query || '').toLowerCase().split(/\W+/).filter(w => w.length > 2 && !_CONSULT_STOP_WORDS.has(w));
    if (queryWords.length === 0 || !content) {
        const truncated = (content || '').slice(0, maxTotalChars);
        return truncated + (content && content.length > maxTotalChars ? '\n[... truncated — use view_file for full content]' : '');
    }
    // Split by markdown headings
    const sections = [];
    const headingRegex = /^(#{1,4})\s+(.+)$/gm;
    const allHeadings = [];
    let match;
    while ((match = headingRegex.exec(content)) !== null) {
        if (sections.length > 0) {
            sections[sections.length - 1].body = content.slice(sections[sections.length - 1].bodyStart, match.index).trim();
        }
        sections.push({ heading: match[2].trim(), level: match[1].length, bodyStart: match.index + match[0].length, score: 0 });
        allHeadings.push(match[2].trim());
    }
    if (sections.length > 0) {
        sections[sections.length - 1].body = content.slice(sections[sections.length - 1].bodyStart).trim();
    }
    if (sections.length === 0) {
        const truncated = content.slice(0, maxTotalChars);
        return truncated + (content.length > maxTotalChars ? '\n[... truncated]' : '');
    }
    // Score each section by query keyword overlap
    for (const sec of sections) {
        const text = (sec.heading + ' ' + (sec.body || '')).toLowerCase();
        sec.score = queryWords.reduce((sum, w) => sum + (text.includes(w) ? 1 : 0), 0);
    }
    const ranked = [...sections].sort((a, b) => b.score - a.score);
    const output = [];
    let totalChars = 0;
    // Always include heading index for navigation
    const headingIdx = 'Document sections: ' + allHeadings.join(' | ');
    output.push(headingIdx);
    totalChars += headingIdx.length;
    // Include top-scoring sections
    for (const sec of ranked) {
        if (sec.score === 0) continue;
        const body = (sec.body || '').slice(0, 800);
        const block = `${'#'.repeat(sec.level)} ${sec.heading}\n${body}${(sec.body || '').length > 800 ? '\n[... section truncated]' : ''}`;
        if (totalChars + block.length > maxTotalChars && output.length > 1) break;
        output.push(block);
        totalChars += block.length;
    }
    if (output.length <= 1) {
        output.push(content.slice(0, 500) + (content.length > 500 ? '\n[... use view_file for full content]' : ''));
    }
    output.push(`[Full document: ${content.length} chars — use view_file for deeper context]`);
    return output.join('\n\n');
}

function formatConsultForAgent({ query, consultResult, codexResult, archiveHits, patternMatches, rankedFiles, graph, allFilePaths, analysisScope, fileContents, projectRoot }) {
    const evidence  = consultResult.evidence || {};
    const cf        = evidence.contextFormatted || '';
    const crossFile = evidence.crossFileRaw;
    const queryWords = (query || '').toLowerCase().split(/\W+/).filter(w => w.length > 2 && !_CONSULT_STOP_WORDS.has(w));

    // ══════════════════════════════════════════════════════════════════════
    // KEY 1: intelligence_brief — Agent reads this FIRST.
    //   Reasoning mandate + project overview + intelligence score + scope.
    //   Usually sufficient for factual queries.
    // ══════════════════════════════════════════════════════════════════════
    const briefLines = [];
    briefLines.push('=== UNRAVEL CONSULT — Project Intelligence Report ===');
    briefLines.push('');
    briefLines.push('READING ORDER (structured keys — read selectively, not linearly):');
    briefLines.push('  1. intelligence_brief    — START HERE. Mandate + overview + scope');
    briefLines.push('  2. structural_evidence   — AST facts + source snippets + call graph');
    briefLines.push('  3. memory                — Past discoveries + pattern signals');
    briefLines.push('  4. project_context       — Deps, git, doc excerpts (verbose — read only if needed)');
    briefLines.push('');

    // ── §5 REASONING MANDATE (first — instructions before data) ─────────
    const qLower = (query || '').toLowerCase();
    const isFeasibility = /\bcan i\b|\bcould i\b|\bwhat would break\b|\bif i\b|\bwould it\b|\bshould i\b|\bsafe to\b|\brefactor\b/.test(qLower);
    const isFactual     = /\bwhere (is|are|does)\b|\bwhat is\b|\bwhat does\b|\bshow me\b|\bfind\b|\bwhich file\b|\bdefined\b/.test(qLower);
    const queryType     = isFeasibility ? 'feasibility' : isFactual ? 'factual' : 'analytical';

    const _TIERED = {
        factual: [
            'FACTUAL QUERY — answer directly. Cite exact file:line from structural_evidence. Be brief.',
            'If the answer is not in the evidence, say so. Do not guess.',
        ],
        analytical: [
            'ANALYTICAL QUERY — think step by step through the evidence.',
            'Trace the full chain through the cross-file graph in structural_evidence.',
            'Identify what the evidence DOES and DOES NOT cover. State assumptions explicitly.',
            'If the query touches files NOT in scope, say so and suggest include:[X].',
            'Do NOT speculate beyond what AST evidence and call graph confirm.',
        ],
        feasibility: [
            'FEASIBILITY QUERY — assess from structural evidence, not opinion.',
            'Map every file that would need to change (use call graph + scope list).',
            'Identify invariants from AST facts that must not break.',
            'Report: CAN DO / CANNOT DO / CAN DO WITH CAVEATS + specific file:line constraints.',
            'If evidence is insufficient, state which files are missing from scope.',
        ],
    };

    briefLines.push('Query classified as: ' + queryType.toUpperCase());
    for (const _r of _TIERED[queryType]) briefLines.push('  - ' + _r);
    briefLines.push('');

    const inst = consultResult._instructions || {};
    if (inst.role) briefLines.push('ROLE: ' + inst.role);
    if (inst.honesty_rules?.length) {
        briefLines.push('HONESTY RULES:');
        for (const _hr of inst.honesty_rules) briefLines.push('  - ' + _hr);
    }
    if (inst.scope?.not_a_debug_session) briefLines.push('SCOPE: ' + inst.scope.not_a_debug_session);
    briefLines.push('CODE_FETCH: structural_evidence has inline source for critical AST sites. For other lines, use view_file.');
    briefLines.push('');

    // ── §0 PROJECT OVERVIEW ─────────────────────────────────────────────
    briefLines.push('-- PROJECT OVERVIEW (senior dev mental model) --------------------------');
    const overview = projectRoot ? loadProjectOverview(projectRoot) : null;
    if (overview) {
        briefLines.push(overview.trimEnd());
    } else {
        briefLines.push('No project overview yet. Run build_map to auto-generate one.');
    }
    briefLines.push('');

    // ── Intelligence Score ───────────────────────────────────────────────
    const _rInline = formatReadinessInline({ graph, codexMatches: codexResult?.matches?.length || 0, archiveHits: archiveHits.length, filesAnalyzed: evidence.fileCount || 0 });
    briefLines.push(`Intelligence Score: ${_rInline.score}`);
    for (const _row of _rInline.rows) briefLines.push(_row);
    briefLines.push(`Tip: ${_rInline.tip}`);
    briefLines.push('');

    // ── §1 STRUCTURAL SCOPE ─────────────────────────────────────────────
    briefLines.push('-- STRUCTURAL SCOPE -------------------------------------------------------');
    const totalNodes = (graph?.nodes || []).length;
    const totalEdges = (graph?.edges || []).length;
    const embeddedCount = (graph?.nodes || []).filter(n => n.embedding?.length > 0).length;
    briefLines.push(`KG: ${totalNodes} nodes · ${totalEdges} edges · ${embeddedCount} embedded · ${allFilePaths?.length || 0} files indexed`);
    briefLines.push('');

    const inScopeSet = new Set((analysisScope || rankedFiles || []).map(p => p.replace(/\\/g, '/')));
    briefLines.push(`Files in AST analysis scope (${inScopeSet.size}):`);
    for (const p of [...inScopeSet].slice(0, 20)) briefLines.push(`  ✓ ${p}`);
    if (inScopeSet.size > 20) briefLines.push(`  ... ${inScopeSet.size - 20} more`);
    briefLines.push('');

    const outOfScope = (allFilePaths || []).filter(p => !inScopeSet.has(p.replace(/\\/g, '/'))).slice(0, 15);
    if (outOfScope.length > 0) {
        briefLines.push('Files in KG but NOT analyzed (use include:[...] for full analysis):');
        const _outMeta = buildOutOfScopeWithMeta(outOfScope, graph);
        for (const _m of _outMeta) {
            const _tagStr = _m.tags.length ? ` [${_m.tags.join(', ')}]` : '';
            const _sumStr = _m.summary     ? ` "${_m.summary}"` : '';
            briefLines.push(`  ✗ ${_m.path}${_tagStr}${_sumStr}`);
        }
        const remaining = (allFilePaths?.length || 0) - inScopeSet.size - outOfScope.length;
        if (remaining > 0) briefLines.push(`  ... and ${remaining} more files in KG`);
    }
    briefLines.push('');

    // ══════════════════════════════════════════════════════════════════════
    // KEY 2: structural_evidence — AST facts + snippets + call graph.
    //   The deterministic core. Read for analytical/feasibility queries.
    // ══════════════════════════════════════════════════════════════════════
    const evidenceLines = [];

    // ── §2 AST FACTS ────────────────────────────────────────────────────
    evidenceLines.push('-- AST FACTS (verified structural analysis) -------------------------');
    evidenceLines.push(cf ? cf.trimEnd() : 'No AST analysis available.');
    evidenceLines.push('');

    // ── §2.5 CRITICAL SOURCE SNIPPETS ───────────────────────────────────
    const astRaw = consultResult?.evidence?.astRaw;
    if (astRaw && fileContents && fileContents.size > 0) {
        const snippets = [];
        const CONTEXT_LINES = 3;
        const MAX_SNIPPETS = 8;

        const extractSnippet = (fileName, targetLine, label) => {
            if (!fileName || !targetLine || snippets.length >= MAX_SNIPPETS) return;
            let content = fileContents.get(fileName);
            if (!content) {
                const baseName = fileName.split(/[\\/]/).pop();
                for (const [k, v] of fileContents) {
                    if (k.endsWith(baseName) || k.endsWith('/' + baseName)) { content = v; fileName = k; break; }
                }
            }
            if (!content) return;
            const srcLines = content.split('\n');
            const start = Math.max(1, targetLine - CONTEXT_LINES);
            const end = Math.min(srcLines.length, targetLine + CONTEXT_LINES);
            const overlaps = snippets.some(s => s.file === fileName && Math.abs(s.targetLine - targetLine) <= CONTEXT_LINES * 2);
            if (overlaps) return;
            const sl = [];
            for (let i = start; i <= end; i++) {
                const marker = i === targetLine ? '>' : ' ';
                sl.push(`  ${marker} ${i}: ${srcLines[i - 1]}`);
            }
            snippets.push({ file: fileName, targetLine, label, text: sl.join('\n') });
        };

        for (const r of (astRaw.globalWriteRaces || []).slice(0, 3)) {
            extractSnippet(r.file || '', r.writeLine, `${r.variable} written before await (race risk)`);
        }
        for (const p of (astRaw.floatingPromises || []).slice(0, 2)) {
            extractSnippet(p.file || '', p.line, `${p.api}() unawaited`);
        }
        const cfrSnippet = consultResult?.evidence?.crossFileRaw;
        if (cfrSnippet?.callGraph) {
            const seenCallees = new Set();
            for (const edge of cfrSnippet.callGraph) {
                if (seenCallees.has(edge.callee) || snippets.length >= MAX_SNIPPETS) break;
                seenCallees.add(edge.callee);
                extractSnippet(edge.caller, edge.line, `call to ${edge.callee}:${edge.function}()`);
            }
        }

        if (snippets.length > 0) {
            evidenceLines.push('-- CRITICAL SOURCE SNIPPETS (auto-extracted, no view_file needed) ----');
            for (const s of snippets) {
                evidenceLines.push(`  ${s.file}:${s.targetLine} -- ${s.label}`);
                evidenceLines.push(s.text);
                evidenceLines.push('');
            }
        }
    }

    // ── §3 CROSS-FILE GRAPH (query-sorted) ──────────────────────────────
    evidenceLines.push('-- CROSS-FILE GRAPH (call graph, symbol origins) --------------------');
    if (crossFile) {
        const calls = crossFile.callGraph || [];
        if (calls.length > 0) {
            // Sort by query relevance: edges mentioning query keywords first
            const sortedCalls = [...calls].sort((a, b) => {
                const aText = `${a.caller} ${a.callee} ${a.function}`.toLowerCase();
                const bText = `${b.caller} ${b.callee} ${b.function}`.toLowerCase();
                const aScore = queryWords.reduce((s, w) => s + (aText.includes(w) ? 1 : 0), 0);
                const bScore = queryWords.reduce((s, w) => s + (bText.includes(w) ? 1 : 0), 0);
                return bScore - aScore;
            });
            evidenceLines.push('Call graph (sorted by query relevance):');
            for (const edge of sortedCalls.slice(0, 25)) {
                const fn = edge.function ? `:${edge.function}()` : '';
                const ln = edge.line ? ` L${edge.line}` : '';
                evidenceLines.push(`  ${edge.caller} → ${edge.callee}${fn}${ln}`);
            }
            if (calls.length > 25) evidenceLines.push(`  ... ${calls.length - 25} more edges`);
        }
        const symKeys = Object.keys(crossFile.symbolOrigins || {});
        if (symKeys.length > 0) {
            evidenceLines.push('Symbol origins:');
            for (const k of symKeys.slice(0, 15)) {
                const info = crossFile.symbolOrigins[k];
                if (info && typeof info === 'object') {
                    const importedBy = (info.importedBy || []).map(i => i.file || i).join(', ');
                    const loc = info.file ? `${info.file}${info.line ? ':L' + info.line : ''}` : '?';
                    evidenceLines.push(`  ${info.name || k}@${loc} → imported by: ${importedBy || 'none'}`);
                } else {
                    evidenceLines.push(`  ${k} → ${info}`);
                }
            }
        }
    } else {
        evidenceLines.push('No cross-file graph available (requires 2+ JS/TS files).');
    }
    evidenceLines.push('');

    // ══════════════════════════════════════════════════════════════════════
    // KEY 3: memory — Past discoveries, verified fixes, pattern signals.
    // ══════════════════════════════════════════════════════════════════════
    const memoryLines = [];
    if (patternMatches.length > 0) {
        memoryLines.push('STRUCTURAL PATTERN SIGNALS:');
        for (const m of patternMatches.slice(0, 3)) {
            memoryLines.push(`  [${m.pattern?.id || m.pattern?.bugType}] ${(m.confidence * 100).toFixed(0)}% — ${m.pattern?.description}`);
        }
        memoryLines.push('');
    }
    if (codexResult?.matches?.length > 0) {
        memoryLines.push('CODEX PRE-BRIEFING — Past debugging discoveries:');
        for (const m of codexResult.matches) {
            memoryLines.push(`  [${m.taskId}] "${m.problem}"`);
            if (m.discoveries) {
                for (const dl of m.discoveries.slice(0, 300).trim().split('\n').slice(0, 6)) memoryLines.push(`    ${dl}`);
            }
            memoryLines.push('');
        }
    }
    if (archiveHits.length > 0) {
        memoryLines.push('DIAGNOSIS ARCHIVE — Past verified fixes:');
        for (const h of archiveHits) {
            memoryLines.push(`  ${(h.score * 100).toFixed(0)}% match — ${h.rootCause?.slice(0, 120)}`);
            memoryLines.push(`    @ ${h.codeLocation} | "${h.symptom?.slice(0, 80)}"`);
        }
        memoryLines.push('');
    }
    if (!patternMatches.length && !codexResult?.matches?.length && !archiveHits.length) {
        memoryLines.push('No memory layer matches yet. Run analyze → verify sessions to grow the archive and codex.');
    }

    // ══════════════════════════════════════════════════════════════════════
    // KEY 4: project_context — Dependencies, git activity, doc excerpts.
    //   Verbose context. Read ONLY when intelligence_brief is insufficient.
    // ══════════════════════════════════════════════════════════════════════
    const contextLines = [];

    // ── Dependencies ────────────────────────────────────────────────────
    if (projectRoot) {
        const _deps = loadDependencyManifest(projectRoot);
        if (_deps && (_deps.runtime.length > 0 || _deps.dev.length > 0)) {
            contextLines.push('## Dependencies');
            if (_deps.engines)        contextLines.push(`Engine: ${_deps.engines}`);
            if (_deps.runtime.length) contextLines.push(`Runtime: ${_deps.runtime.join(', ')}`);
            if (_deps.dev.length)     contextLines.push(`Dev tools: ${_deps.dev.join(', ')}`);
            if (_deps.packageManager) contextLines.push(`Package manager: ${_deps.packageManager}`);
            contextLines.push('');
        }
    }

    // ── Git Context (scope-filtered) ────────────────────────────────────
    if (projectRoot) {
        const _git = getGitContext(projectRoot);
        if (_git) {
            contextLines.push('## Recent Activity (git)');
            const _filterGitFiles = (files) => {
                if (!files || files.length === 0) return [];
                return files.filter(f => {
                    const fNorm = f.replace(/\\/g, '/');
                    if (inScopeSet.has(fNorm)) return true;
                    const fLower = fNorm.toLowerCase();
                    return queryWords.some(w => fLower.includes(w));
                });
            };
            const relevantUnstaged = _filterGitFiles(_git.unstagedFiles);
            const relevantStaged   = _filterGitFiles(_git.stagedFiles);
            const relevantRecent   = _filterGitFiles(_git.recentFiles);
            if (relevantUnstaged.length) contextLines.push(`Unstaged (in scope): ${relevantUnstaged.join(', ')}`);
            if (relevantStaged.length)   contextLines.push(`Staged (in scope): ${relevantStaged.join(', ')}`);
            if (relevantRecent.length)   contextLines.push(`Modified last 14 days (in scope): ${relevantRecent.join(', ')}`);
            if (_git.hotFiles.length)    contextLines.push(`Hotspots (30d churn): ${_git.hotFiles.slice(0, 10).join(' | ')}`);
            if (_git.recentCommits.length) {
                contextLines.push('Recent commits:');
                for (const _c of _git.recentCommits.slice(0, 5)) contextLines.push(`  ${_c}`);
            }
            contextLines.push('');
        }
    }

    // ── Context Files (Scholar-mode: section extraction, not full dump) ──
    if (projectRoot) {
        const _ctxFiles = loadContextFiles(projectRoot);
        if (_ctxFiles.length > 0) {
            contextLines.push('## Context Files (section-extracted — use view_file for full docs)');
            for (const _cf of _ctxFiles) {
                contextLines.push(`### ${_cf.name} [TRUST: ${_cf.trust.toUpperCase()}]`);
                contextLines.push(extractRelevantSections(_cf.content, query, 2500));
                contextLines.push('');
            }
        }
    }

    // ── Build readiness + return structured keys ────────────────────────
    const readiness = buildReadiness({
        graph, codexMatches: codexResult?.matches?.length || 0,
        archiveHits: archiveHits.length, patternMatches: patternMatches.length,
        filesAnalyzed: evidence.fileCount || 0,
    });
    return JSON.stringify({
        query,
        relevant_files: rankedFiles,
        intelligence_brief: briefLines.join('\n'),
        structural_evidence: evidenceLines.join('\n'),
        memory: memoryLines.join('\n'),
        project_context: contextLines.join('\n'),
        _readiness: readiness,
        _provenance: consultResult._provenance || {},
    }, null, 2);
}

server.tool(
    'consult',
    'Ask anything about your project â€” architecture, data flow, feature feasibility, impact analysis, or understanding any part of the codebase. Consult fires every memory layer simultaneously: Knowledge Graph (semantic routing), AST analysis (mutation chains, closures, async), cross-file call graph, Task Codex (past discoveries), Diagnosis Archive (past verified fixes), Pattern Store. Returns a structured evidence packet with synthesis instructions. FIRST-TIME USE: Requires GEMINI_API_KEY (free) in MCP env config. If no KG exists, auto-builds one on first call (~15-30s, one-time). If key is absent, returns SETUP_REQUIRED with guided instructions.',
    {
        query:     z.string().describe('Your question about the project â€” architecture, data flow, feasibility, impact, or any module.'),
        directory: z.string().optional().describe('Project root. Required on first call if no prior build_map. Omit to use directory from last build_map.'),
        maxFiles:  z.number().optional().describe('Max files to analyze after KG routing (default: 12). Increase for broad architectural questions. Ignored if include is provided.'),
        include:   z.array(z.string()).optional().describe('Paths or folders to analyze (e.g. ["src/core", "src/App.jsx"]). If provided, bypasses KG semantic routing and analyzes these files directly. Combine with exclude to refine further. Takes precedence over maxFiles.'),
        detail:    z.enum(['standard', 'full']).optional().describe("'standard' (default): high-signal AST. 'full': complete unfiltered AST."),
        exclude:   z.array(z.string()).optional().describe('Paths or folder names to exclude when auto-building the KG (e.g. ["validation", "cognium"]). Ignored if a KG already exists on disk.'),
    },
    async (args) => {
        try {
            await loadCoreModules();

            // ── TEMPORARILY PAUSED (v3.4.3) ────────────────────────────────────
            // consult mode is being reworked for output quality improvements.
            // The core engine, KG, and AST analysis are fully operational via
            // analyze, verify, build_map, and query_graph.
            return {
                content: [{
                    type: 'text',
                    text: JSON.stringify({
                        status: 'TEMPORARILY_PAUSED',
                        tool: 'consult',
                        message: 'consult is temporarily paused while we improve output quality and reduce noise in the Scholar Model response format. The tool works — we\'re just making it better.',
                        what_consult_does: 'consult is Unravel\'s project oracle — it answers any architecture, data-flow, or feasibility question about your codebase by firing every memory layer simultaneously: Knowledge Graph (semantic routing), AST analysis (mutation chains, closures, async), cross-file call graph, Task Codex (past discoveries), and the Diagnosis Archive. It auto-builds a KG on first call and then runs instant incremental staleness checks on every query.',
                        alternatives: [
                            'Use build_map to index your project, then query_graph to find relevant files for a symptom.',
                            'Use analyze to get full deterministic AST evidence for a specific bug.',
                            'Use verify to cross-check your diagnosis against real code.',
                        ],
                        open_source: 'Unravel is open source. If you\'re a nerd and want to check out the implementation or help improve consult mode, the full codebase is at: https://github.com/EruditeCoder108/unravelai',
                        eta: 'coming back soon in v3.5.0',
                    }, null, 2),
                }],
            };
            // ───────────────────────────────────────────────────────────────────

            const apiKey = process.env.GEMINI_API_KEY;
            if (!apiKey) {
                process.stderr.write('[consult] No GEMINI_API_KEY â€” returning SETUP_REQUIRED\n');
                return { content: [{ type: 'text', text: JSON.stringify(SETUP_REQUIRED_RESPONSE, null, 2) }] };
            }

            const projectRoot = args.directory ? resolve(args.directory) : session.projectRoot;
            if (!projectRoot) throw new Error('No project directory. Pass "directory" on the first call.');
            if (!existsSync(projectRoot)) throw new Error(`Directory not found: ${projectRoot}`);

            // "" Cross-directory session state safety """"""""""""""""""""""""""
            // If the projectRoot has changed (user switched directories), invalidate
            // the cached graph and file list. Without this, the old KG and file set
            // from a prior directory are silently reused " giving wrong answers.
            if (session._graphRoot && session._graphRoot !== projectRoot) {
                process.stderr.write(`[consult] Directory changed (${session._graphRoot} → ${projectRoot}) â€” invalidating KG cache.\n`);
                session.graph  = null;
                session.files = [];
                session.astRaw = null;
                session.crossFileRaw       = null;
                session.archiveLoaded      = false;
                session.diagnosisArchive   = [];
            }
            session.projectRoot  = projectRoot;
            session._graphRoot   = projectRoot;

            const mcpPatternFile = join(resolve(import.meta.dirname), '.unravel', 'patterns.json');
            if (!session.patternsLoaded) { await loadPatterns(mcpPatternFile); session.patternsLoaded = true; }

            // "" Load or auto-build KG """""""""""""""""""""""""""""""""""""""""
            let graph = session.graph;
            if (!graph) {
                graph = loadGraph(projectRoot);
                if (graph) { session.graph = graph; process.stderr.write(`[consult] KG loaded (${graph.nodes?.length || 0} nodes)\n`); }
            }
            const hasEmbeddings = graph?.nodes?.some(n => n.embedding?.length > 0);

            if (!graph || !graph.nodes?.length || !hasEmbeddings) {
                // "" Cold build: no KG or no embeddings """""""""""""""""""""""
                process.stderr.write('[consult] No embedded KG â€” auto-building (one-time ~15-30s)...\n');
                const excludes = args.exclude || [];
                let allFiles = readFilesFromDirectory(projectRoot, 5, excludes);

                // Apply include filter during cold build so only scoped files are indexed.
                // Without this, the full project gets embedded on first call even if the
                // user only wanted a subsystem " which can take many minutes.
                if (args.include?.length) {
                    const includes = args.include.map(p => p.replace(/\\/g, '/'));
                    const before = allFiles.length;
                    allFiles = allFiles.filter(f => {
                        const norm = f.name.replace(/\\/g, '/');
                        return includes.some(inc => norm.includes(inc));
                    });
                    process.stderr.write(`[consult] Cold build â€” include filter: ${allFiles.length}/${before} files [${args.include.join(', ')}]\n`);
                }

                session.files = allFiles;
                process.stderr.write(`[consult] Indexing ${allFiles.length} files...\n`);
                const enriched = await attachStructuralAnalysis(allFiles);
                const builder  = new GraphBuilder();
                let idx = 0;
                for (const file of enriched) {
                    idx++;
                    if (idx % 50 === 0 || idx === enriched.length) process.stderr.write(`[consult] Indexed ${idx}/${enriched.length}\n`);
                    const sa = file.structuralAnalysis || {};
                    const nodeMeta = deriveNodeMetadata(file.name, sa, 0, file.content || '');
                    builder.addFileWithAnalysis(file.name, sa, nodeMeta);
                }
                for (const file of enriched) {
                    for (const imp of (file.structuralAnalysis?.imports || [])) {
                        if (imp.resolvedPath && imp.resolvedPath !== file.name) builder.addImportEdge(file.name, imp.resolvedPath);
                    }
                }
                const fileHashes = {};
                for (const f of allFiles) fileHashes[f.name] = computeContentHashSync(f.content);
                graph = builder.build(projectRoot, []);
                graph.files = fileHashes;
                // Persist the include/exclude scope so the staleness check reuses the
                // same filter on subsequent calls " preventing KG scope widening.
                graph.meta = graph.meta || {};
                graph.meta.include = args.include?.length ? args.include : null;
                graph.meta.exclude = args.exclude?.length ? args.exclude : null;

                // Embed FIRST, then save " so a cancelled embed doesn't leave a
                // zero-embedded KG on disk that the hasEmbeddings check wrongly accepts.
                process.stderr.write(`[consult] Embedding ${graph.nodes?.length || 0} nodes...\n`);
                await embedGraphNodes(graph, apiKey, { embedAll: true }).catch(e => process.stderr.write(`[consult] Embed error (non-fatal): ${e.message}\n`));

                const embeddedCount = (graph.nodes || []).filter(n => n.embedding?.length > 0).length;
                process.stderr.write(`[consult] Embedded ${embeddedCount}/${graph.nodes?.length || 0} nodes.\n`);
                try {
                    saveGraph(projectRoot, graph);
                    saveMeta(projectRoot, { builtAt: new Date().toISOString(), nodeCount: graph.nodes?.length || 0, edgeCount: graph.edges?.length || 0, filesIndexed: allFiles.length, mode: embeddedCount > 0 ? 'semantic' : 'structural', builtBy: 'consult-auto', include: graph.meta.include, exclude: graph.meta.exclude });
                    process.stderr.write(`[consult] KG saved: ${graph.nodes?.length || 0} nodes, ${embeddedCount} embedded.\n`);
                    // Generate/update project overview
                    const overview = generateProjectOverview(graph, projectRoot);
                    saveProjectOverview(projectRoot, overview);
                    process.stderr.write(`[consult] Project overview saved.\n`);
                } catch (saveErr) { process.stderr.write(`[consult] Save error (non-fatal): ${saveErr.message}\n`); }
                session.graph = graph;
            } else {
                // "" KG exists " run silent incremental staleness check """"""""
                // Same mechanism as VS Code extension: hash-diff on every call,
                // patch only what changed. 0 changes = <100ms. Small changes = ~2s.
                //
                // SCOPE STABILITY: Reuse the include/exclude filters from the original
                // cold build (persisted in graph.meta). Without this, readFilesFromDirectory
                // would read ALL files in projectRoot, silently widening the KG scope.
                if (!session.files?.length) {
                    const savedExcludes = graph.meta?.exclude || [];
                    let scopedFiles = readFilesFromDirectory(projectRoot, 5, savedExcludes);
                    const savedIncludes = graph.meta?.include;
                    if (savedIncludes?.length) {
                        const incs = savedIncludes.map(p => p.replace(/\\/g, '/'));
                        scopedFiles = scopedFiles.filter(f => {
                            const norm = f.name.replace(/\\/g, '/');
                            return incs.some(inc => norm.includes(inc));
                        });
                        process.stderr.write(`[consult] Staleness check scoped to: [${savedIncludes.join(', ')}] (${scopedFiles.length} files)\n`);
                    }
                    session.files = scopedFiles;
                }
                const changed = getChangedFiles(session.files, graph, computeContentHashSync);
                if (changed.length > 0) {
                    process.stderr.write(`[consult] Staleness check: ${changed.length}/${session.files.length} files changed â€” patching KG...\n`);
                    try {
                        const changedEnriched = await attachStructuralAnalysis(changed);
                        // Patch changed nodes into the existing graph
                        for (const file of changedEnriched) {
                            const sa = file.structuralAnalysis || {};
                            const fnNames = (sa.functions || []).map(f => f.name).join(', ');
                            // Remove stale node if exists
                            if (graph.nodes) graph.nodes = graph.nodes.filter(n => n.id !== file.name && n.filePath !== file.name);
                            // Re-add freshly analyzed node (GraphBuilder not available here " add minimal node)
                            graph.nodes = graph.nodes || [];
                            const _jsDocPatch = extractJsDocSummary(file.content || '');
                            graph.nodes.push({ id: file.name, filePath: file.name, type: 'file',
                                fileSummary: _jsDocPatch || (fnNames ? `Functions: ${fnNames}` : ''),
                                tags: [file.name.replace(/\.[^.]+$/, '').replace(/[/\\]/g, '-')],
                                embedding: null }); // embedding: null flags it for re-embed
                            // Update hash in graph.files
                            if (!graph.files) graph.files = {};
                            graph.files[file.name] = computeContentHashSync(file.content);
                        }
                        // Re-embed only changed (unembedded) nodes
                        await embedChangedNodes(graph, apiKey, { embedAll: false }).catch(e =>
                            process.stderr.write(`[consult] Incremental embed error (non-fatal): ${e.message}\n`)
                        );
                        saveGraph(projectRoot, graph);
                        // Preserve include/exclude in meta so future staleness checks stay scoped
                        saveMeta(projectRoot, { builtAt: new Date().toISOString(), nodeCount: graph.nodes.length, edgeCount: graph.edges?.length || 0, filesIndexed: session.files.length, mode: 'semantic', builtBy: 'consult-incremental', include: graph.meta?.include, exclude: graph.meta?.exclude });
                        session.graph = graph;
                        process.stderr.write(`[consult] KG patched and saved (${changed.length} files updated).\n`);
                    } catch (patchErr) {
                        process.stderr.write(`[consult] Incremental patch error (non-fatal, using stale KG): ${patchErr.message}\n`);
                    }
                } else {
                    process.stderr.write(`[consult] KG up to date (0 changes detected).\n`);
                }

                // Self-heal: if any nodes have null embeddings (from prior partial embed failure),
                // re-embed them now. embedChangedNodes with embedAll:false only embeds nodes
                // where embedding is null, so this is safe and idempotent.
                const unembeddedCount = (graph.nodes || []).filter(n => !n.embedding || n.embedding.length === 0).length;
                if (unembeddedCount > 0) {
                    process.stderr.write(`[consult] ${unembeddedCount} node(s) missing embeddings â€” re-embedding...\n`);
                    try {
                        await embedChangedNodes(graph, apiKey, { embedAll: false });
                        saveGraph(projectRoot, graph);
                        session.graph = graph;
                        process.stderr.write(`[consult] Self-heal embed complete.\n`);
                    } catch (healErr) {
                        process.stderr.write(`[consult] Self-heal embed error (non-fatal): ${healErr.message}\n`);
                    }
                }
            }

            // "" Semantic routing """"""""""""""""""""""""""""""""""""""""""""""
            let semanticScores = new Map();
            try {
                semanticScores = await buildSemanticScores(args.query, graph, apiKey);
                process.stderr.write(`[consult] Semantic: ${semanticScores.size} nodes scored\n`);
            } catch (e) { process.stderr.write(`[consult] Semantic error (keyword fallback): ${e.message}\n`); }

            if (session.astRaw && typeof getNodeBoosts === 'function') {
                const boosts = getNodeBoosts(graph.nodes, matchPatterns(session.astRaw));
                for (const [nodeId, boost] of boosts) semanticScores.set(nodeId, Math.max(semanticScores.get(nodeId) || 0, boost));
            }

            // "" File selection: include param takes precedence over KG routing "
            const allFilePaths = (session.files || []).map(f => f.name.replace(/\\/g, '/'));
            let filesToAnalyze;
            let analysisScope;

            if (args.include?.length) {
                // User explicitly specified which files/folders to analyze " bypass KG routing
                const includes = args.include.map(p => p.replace(/\\/g, '/'));
                filesToAnalyze = (session.files || []).filter(f => {
                    const norm = f.name.replace(/\\/g, '/');
                    return includes.some(inc => norm.includes(inc));
                });
                // Apply exclude within include set if both provided
                if (args.exclude?.length) {
                    const excludes = args.exclude.map(p => p.replace(/\\/g, '/'));
                    filesToAnalyze = filesToAnalyze.filter(f => {
                        const norm = f.name.replace(/\\/g, '/');
                        return !excludes.some(exc => norm.includes(exc));
                    });
                }
                analysisScope = filesToAnalyze.map(f => f.name.replace(/\\/g, '/'));
                process.stderr.write(`[consult] include filter: ${filesToAnalyze.length} files matched [${args.include.join(', ')}]\n`);
            } else {
                // KG semantic routing (default)
                const maxFiles    = args.maxFiles || 12;
                const rankedPaths = queryGraphForFiles(graph, args.query, maxFiles, semanticScores);
                const rankedSet   = new Set(rankedPaths.map(p => p.replace(/\\/g, '/')));
                filesToAnalyze = (session.files || []).filter(f => {
                    const norm = f.name.replace(/\\/g, '/');
                    const base = norm.split('/').pop();
                    return rankedSet.has(norm) || rankedSet.has(base) || [...rankedSet].some(k => norm.endsWith(k) || k.endsWith(base));
                });
                analysisScope = rankedPaths;
            }
            process.stderr.write(`[consult] Analyzing ${filesToAnalyze.length} files\n`);

            // "" Memory recall """""""""""""""""""""""""""""""""""""""""""""""""
            const codexResult = await searchCodex(projectRoot, args.query);
            if (codexResult.matches.length) process.stderr.write(`[consult] Codex: ${codexResult.matches.length} match(es)\n`);

            if (!session.archiveLoaded) { session.diagnosisArchive = loadDiagnosisArchive(projectRoot); session.archiveLoaded = true; process.stderr.write(`[consult] Archive: ${session.diagnosisArchive.length} entries\n`); }
            let archiveHits = [];
            if (session.diagnosisArchive.length > 0) {
                try { archiveHits = await searchDiagnosisArchive(args.query, session.diagnosisArchive, apiKey); if (archiveHits.length) process.stderr.write(`[consult] Archive: ${archiveHits.length} hit(s)\n`); }
                catch (e) { process.stderr.write(`[consult] Archive error (non-fatal): ${e.message}\n`); }
            }

            // "" AST Analysis (consult mode) """""""""""""""""""""""""""""""""""
            const detail = args.detail || 'standard';
            let consultResult;
            try {
                consultResult = await orchestrate(
                    filesToAnalyze.length > 0 ? filesToAnalyze : (session.files || []).slice(0, args.maxFiles || 12),
                    args.query,
                    { _mode: 'consult', detail, provider: 'none', apiKey: 'none', model: 'none', projectRoot, knowledgeGraph: graph }
                );
            } catch (orchErr) {
                process.stderr.write(`[consult] orchestrate error (non-fatal): ${orchErr.message}\n`);
                consultResult = { verdict: 'CONSULT_EVIDENCE', _mode: 'consult', evidence: { contextFormatted: '', filesAnalyzed: [], fileCount: 0 }, _instructions: {}, _provenance: { engineVersion: '3.3', timestamp: new Date().toISOString() } };
            }

            // Cache unfiltered AST for verify(), then apply noise reduction for output
            if (consultResult.evidence?.astRaw) {
                session.astRaw = consultResult.evidence.astRaw;
                session.crossFileRaw = consultResult.evidence.crossFileRaw || null;
                // Layer 2 noise reduction (same as analyze mode)
                if (detail !== 'full') {
                    const { filtered, suppressed } = filterAstRawMutations(consultResult.evidence.astRaw);
                    if (suppressed > 0) {
                        consultResult.evidence.astRaw = filtered;
                        process.stderr.write(`[consult] Mutations filtered: ${suppressed} noise vars suppressed\n`);
                    }
                }
            }

            const patternMatches = session.astRaw ? matchPatterns(session.astRaw).slice(0, 5) : [];
            if (patternMatches.length) process.stderr.write(`[consult] Patterns: ${patternMatches.length} signal(s)\n`);

            // Build fileContents map for @1.5 source snippet extraction
            const fileContents = new Map();
            for (const f of (filesToAnalyze.length > 0 ? filesToAnalyze : session.files || [])) {
                if (f.name && f.content) fileContents.set(f.name.replace(/\\/g, '/'), f.content);
            }

            return {
                content: [{ type: 'text', text: formatConsultForAgent({ query: args.query, consultResult, codexResult, archiveHits, patternMatches, rankedFiles: analysisScope, graph, allFilePaths, analysisScope, fileContents, projectRoot }) }],
            };

        } catch (err) {
            return { content: [{ type: 'text', text: `Error: ${err.message}` }], isError: true };
        }
    }
);

async function main() {
    process.stderr.write('[unravel-mcp] Loading core modules...\n');
    await loadCoreModules();
    process.stderr.write('[unravel-mcp] Core modules loaded.\n');

    const transport = new StdioServerTransport();
    process.stderr.write('[unravel-mcp] Starting STDIO transport...\n');
    await server.connect(transport);
    process.stderr.write('[unravel-mcp] Unravel MCP Server running. Waiting for tool calls.\n');
}

main().catch(err => {
    process.stderr.write(`[unravel-mcp] Fatal error: ${err.message}\n${err.stack}\n`);
    process.exit(1);
});