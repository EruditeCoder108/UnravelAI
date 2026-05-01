#!/usr/bin/env node
// 
// Unravel MCP Server  Sandwich Architecture
//
// Zero-hallucination AST evidence provider for AI coding agents.
// Exposes Unravel tools over STDIO (Model Context Protocol):
//
//   unravel.analyze     Run AST + routing, return deterministic evidence
//   unravel.verify      Cross-check agent's claims against real code
//   unravel.build_map   Build Knowledge Graph from files
//   unravel.query_graph  Ask KG which files are relevant to a symptom
//   unravel.query_visual Find relevant files from a UI screenshot
//   unravel.consult      Project oracle mode (currently intentionally paused)
//
// The "sandwich":
//   1. Agent calls unravel.analyze   -> gets structural facts (AST, mutations, etc.)
//   2. Agent's own LLM reasons      -> produces root cause, hypothesis tree, fix
//   3. Agent calls unravel.verify    -> every claim checked against real code
//   4. Agent presents verified fix   -> zero hallucination
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
import { readFileSync, existsSync } from 'fs';
import { resolve, join } from 'path';
import {
    embedGraphNodes,
    embedChangedNodes,
    buildSemanticScores,
    embedText,
    embedImage,
    fuseEmbeddings,
    cosineSimilarity,
    loadDiagnosisArchive,
    archiveDiagnosis,
    searchDiagnosisArchive,
    resolveEmbeddingApiKey,
    ensureGeminiVisualAvailable,
    describeEmbeddingProvider,
} from './server/embedding-provider.js';
import { runCircleIrAnalysis } from './circle-ir-adapter.js';
import { readFilesFromDirectory } from './server/file-reader.js';
import { createSession } from './server/session.js';
import { inspectGraphFreshness, stampGraphMeta } from './server/graph-freshness.js';
import {
    INCREMENTAL_THRESHOLD,
    countCallEdges,
    patchKnowledgeGraph,
    shouldPatchIncrementally,
} from './server/knowledge-graph.js';
import {
    deriveNodeMetadata,
    enrichProjectOverviewWithDiagnosis,
    extractJsDocSummary,
    generateProjectOverview,
    saveProjectOverview,
} from './server/project-overview.js';
import { autoSeedCodex, searchCodex } from './server/codex.js';
import { registerAnalyzeTool } from './server/tools/analyze.js';
import { registerBuildMapTool } from './server/tools/build-map.js';
import { registerVerifyTool } from './server/tools/verify.js';
import { registerQueryGraphTool } from './server/tools/query-graph.js';
import { registerQueryVisualTool } from './server/tools/query-visual.js';
import { registerConsultTool } from './server/tools/consult.js';

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
const session = createSession();

// Helper: resolve file inputs.
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
            'Unravel is a deterministic bug-diagnosis engine. It uses static AST analysis to extract verified structural facts from code -> mutation chains, closure captures, async boundaries, race conditions -> and returns them as ground truth that cannot be hallucinated.',
            '',
            '## The Sandwich Protocol',
            'Unravel enforces a 3-layer deterministic workflow:',
            '1. BASE (Evidence):  Call `analyze` with bug files + symptom -> get AST-verified facts.',
            '2. FILLING (Reasoning): YOU reason through the 11-phase structured pipeline. Key mandatory phases:',
            '   - Phase 3 (Hypothesis Generation): Generate exactly 3 mutually exclusive competing hypotheses -> distinct root mechanisms, NOT variations of the same idea. State falsifiableIf[] for each. EXCEPTION: if you are absolutely certain the bug is trivially obvious (e.g. a missing semicolon, typo, or simple syntax error), you may submit just 1 hypothesis -> but you MUST state your reasoning inline as "trivially obvious because: [one sentence]." Without that justification, the exception does not apply. If there is any ambiguity, generate 3.',
            '   - Phase 3.5 (Hypothesis Expansion): Runs AFTER Phase 4 reveals the full dependency map. Add at most 2 new hypotheses if cross-file mechanisms were invisible before. Hypothesis space CLOSES permanently after this -> no additions past Phase 3.5.',
            '   - Phase 4 (Evidence Map): For each hypothesis, produce evidenceMap[] with supporting[], contradicting[], missing[] and a verdict: SUPPORTED / CONTESTED / UNVERIFIABLE / SPECULATIVE.',
            '   - Phase 5 (Hypothesis Elimination): Test each hypothesis against AST evidence. Every eliminated hypothesis MUST cite the exact code fragment (file + line) that kills it.',
            '   - Phase 5.5 (Adversarial Confirmation): Actively try to disprove each surviving hypothesis. PRE-CHECK FIRST: list all OK annotations -> off-limits for adversarial disproof. If adversarial kills a hypothesis, re-enter Phase 3.5 to add a replacement (max 2 re-entry rounds). If 2+ hypotheses survive all attacks, set multipleHypothesesSurvived: true -> do NOT force a single winner.',
            '   - Phases 8+8.5 (Invariants + Fix-Invariant Check): State what must always be true. Check the fix satisfies every invariant. Revise once if violated.',
            '3. TOP (Verification): Call `verify` with your rootCause, evidence[], codeLocation, and minimalFix -> Unravel checks every claim against real code. Your diagnosis is NOT valid until verify returns PASSED.',
            '',
            '## When to Use Each Tool',
            '',
            '### `analyze` - Start here for any bug',
            'Input: files (array of {name, content}) or directory (path), plus symptom (bug description).',
            'Output: Deterministic AST evidence + the `_instructions` block containing the full 11-phase reasoning protocol and 16 hard rules you MUST follow.',
            'Use when: A user reports a bug, unexpected behavior, or asks you to debug code.',
            '',
            '### `verify` - End here for every diagnosis',
            'Input: rootCause (with file:line citation), evidence[], codeLocation, minimalFix, hypotheses[] - all from YOUR diagnosis.',
            'Output: PASSED / REJECTED / PROTOCOL_VIOLATION verdict.',
            'HARD GATES - verify rejects before checking any claim if:',
            '  (1) hypotheses[] is missing or empty -> PROTOCOL_VIOLATION: HYPOTHESIS_GATE (Phase 3 was skipped)',
            '  (2) rootCause contains no file:line citation -> PROTOCOL_VIOLATION: EVIDENCE_CITATION_GATE',
            'Use when: You have completed the 11-phase reasoning pipeline and produced a diagnosis. Call verify BEFORE presenting your fix to the user.',
            '',
            '### `build_map` - Use for large repos',
            'Input: directory (project root path).',
            'Output: Knowledge Graph with nodes (files, functions, classes) and edges (imports, calls, mutations).',
            'Use when: The project is large (50+ files) and you need to figure out WHICH files are relevant to the bug. Build the graph once, then query it.',
            '',
            '### `query_graph` - Use after build_map',
            'Input: symptom (bug description).',
            'Output: Ranked list of relevant files.',
            'Use when: You have a Knowledge Graph built and need to find which files to pass to `analyze`.',
            '',
            '## Decision Flowchart',
            '1. User reports a bug.',
            '2. Do you know which files are relevant?',
            '   - YES -> Call `analyze(files, symptom)` directly.',
            '   - NO, and repo is small (<30 files) -> Call `analyze(directory, symptom)` to analyze all files.',
            '   - NO, and repo is large -> Call `build_map(directory)`, then `query_graph(symptom)`, then `analyze(files, symptom)` with the results.',
            '   - NO, and you have a screenshot of a broken UI -> Call `build_map(directory)`, then `query_visual(image, symptom)`, then `analyze(files, symptom)`.',
            '3. Read the `_instructions` block in the analyze output -> especially `_instructions.pipelineReminder`. Follow all 11 phases.',
            '4. Produce your diagnosis (rootCause, evidence[], codeLocation, minimalFix, hypotheses[]).',
            '5. Call `verify(rootCause, evidence, codeLocation, minimalFix, hypotheses)`. hypotheses[] is REQUIRED -> omitting it triggers PROTOCOL_VIOLATION before any claim is checked.',
            '6. If PASSED -> present the fix. If REJECTED -> revise your diagnosis and re-verify.',
            '',
            '## Critical Rules',
            '',
            'MUST:',
            '- Call `verify` before presenting any diagnosis to the user',
            '- Cite file:line locations from the AST evidence -> never guess line numbers',
            '- Trace state BACKWARDS through mutation chains -> the crash site is never automatically the root cause',
            '- Generate 3 competing hypotheses with distinct mechanisms (not variations of the same idea)',
            '- List all OK annotations before Phase 5.5 - they are deterministic spec facts, off-limits for disproof',
            '- Cap confidence at 0.75 for hypotheses that survived only by elimination (no positive evidence)',
            '- Require >=2 distinct AST-verified code citations for STRONG confidence',
            '',
            'DO NOT:',
            '- Contradict AST evidence - it is deterministic ground truth',
            '- Skip Phase 3 - verify rejects with PROTOCOL_VIOLATION if hypotheses[] is absent',
            '- Combine hypotheses - each must have a distinct falsifiable mechanism',
            '- Jump to solution before completing hypothesis elimination',
            '- Override OK annotations with speculation, edge-case reasoning, or absence of a test',
            '',
            'EXCEPTION (trivial bugs only):',
            '- If you are absolutely certain the bug is trivially obvious (missing semicolon, typo, simple syntax error), you may submit just 1 hypothesis instead of 3. Use this ONLY when confident beyond doubt.',
            '',
            '## Extended Capabilities - Use Your Environment Tools',
            'Unravel provides deterministic structural evidence. But you also have access to web search and script execution in your environment. Use them -> they complement each other.',
            '',
            '### When to search the web',
            'You should proactively search when:',
            '- You need the LATEST version of a dependency (Node.js, tree-sitter, a library) -> never assume the version in package.json is current.',
            '- An API, tool, or framework has changed recently and the code under analysis may be using a deprecated pattern.',
            '- You encounter a cryptic error message or an unfamiliar runtime behavior -> search for known issues first before hypothesizing.',
            '- You need official documentation for a specific function signature, configuration format, or protocol spec.',
            '- You are stuck after evidence is ambiguous - search for prior art, known bugs, or CVEs related to the pattern.',
            'Example queries: "tree-sitter typescript grammar 0.23 breaking changes", "node.js 22 AsyncLocalStorage behavior", "MCP SDK notifications/progress API 2025".',
            '',
            '### When to run scripts',
            'You should run code in the environment when:',
            '- You want to verify a hypothesis with a minimal reproduction -> write and run it rather than speculating.',
            '- The project has a test suite -> run it after proposing a fix to confirm no regressions before presenting to the user.',
            '- You need to inspect actual runtime values (not static structure) -> Unravel gives you the structure; running the code gives you the values.',
            '- You want to confirm that your fix compiles / parses correctly before claiming it is correct.',
            '',
            '### Judgment rule',
            'If Unravel\'s AST evidence is sufficient -> DO NOT search or run. Use external tools only when they add information that static analysis cannot provide. The goal is a verified fix, not maximum tool calls.',
            '',
            '## Task Codex -> Context That Survives Across Files and Sessions',
            '',
            '### The Problem It Solves',
            'When you read 4+ files in a single session, earlier files decay into vague impressions. By file 5, the specific line number and invariant you found in file 1 is gone. You are making edits using summaries of summaries. The Task Codex is the fix.',
            '',
            '### When to create a codex',
            'Create one when: the task touches 3+ files, OR the session will last longer than ~30 minutes, OR you are about to read a large file (1000+ lines) to find one specific thing.',
            'Do NOT create one for: single-file fixes, trivial typo corrections, or tasks where you already know the exact line.',
            '',
            '### How to start',
            '1. Check query_graph -> if it returned a pre_briefing, READ IT FIRST before opening any source file. It already contains discoveries from a past session. Go directly to the specific lines it cites.',
            '2. If no pre_briefing: create `.unravel/codex/codex-{taskId}.md` where taskId is a short slug (e.g. `payment-fix-001`, `auth-race-002`). Write the ## Meta section immediately.',
            '',
            '### What to write -> the 4 entry types (ONLY these 4)',
            'Codex is a detective\'s notebook, NOT a wiki. Every entry must answer: "What did I find vs what I was looking for?" -> not "what does this file do in general."',
            '',
            '- BOUNDARY: A section does NOT have what you need. "L1-L80 -> BOUNDARY: NOT relevant to payment logic. Skip for any payment task."',
            '- DECISION: You found exactly what you were looking for. Pin the line. "L47 -> DECISION: forEach(async (item) => charge(item)) -> confirmed bug site. Promise discarded."',
            '- CONNECTION: A cross-file or cross-section dependency. "L47 -> CONNECTION: called from CartRouter.ts:processPayment() L23 -> that is the entry point."',
            '- CORRECTION: Earlier note was wrong. "-> CORRECTION: L214 is preprocessing only, NOT detection. Detection starts after L300."',
            '',
            'WRONG (do not write): "L1-L300 handles parser setup and AST initialization." This is a description -> it tells future sessions nothing actionable.',
            'RIGHT: "Looking for mutation detection entry -> L1-L300 does NOT have it. BOUNDARY. Detection starts after fnBodyMap at L248."',
            '',
            '### Two-phase writing model',
            'PHASE 1 -> During the task: Append-only. Do not organize. Write immediately after reading each file while it is still hot. Use ? markers for uncertainty. Write EDIT LOG entry immediately after each edit -> not at the end.',
            'PHASE 2 -> At task end (~5 min, once): Restructure into: TLDR (3 lines max) -> ## Discoveries -> ## Edits -> ## Meta. Write TLDR last.',
            '',
            '### Layer 4 is MANDATORY in the end restructure',
            'Add a "## Layer 4 -> What to skip next time" section. List every file/section you read that turned out to be irrelevant to this class of task. Example: "ast-engine-ts.js L1-L200: parser init only, zero relevance to MCP instruction tasks. Skip."',
            'This is the most underrated section. A confirmed irrelevance saves future sessions the same wasted reading time.',
            '',
            '### EDIT LOG format',
            'After every edit, append one entry: `**file:line** -> what changed | Reason: why it was wrong before`',
            'The "Reason" is mandatory -> future sessions need to know WHY it changed to avoid accidentally reverting it.',
            '',
            '### File format (must match exactly -> searchCodex parses these headings)',
            '```',
            '## TLDR',
            '[3 lines max. What was wrong, what was fixed, where source of truth lives.]',
            '',
            '## Discoveries',
            '### filename.ts',
            'Discovery context: looking for [specific thing]',
            '- L47 -> DECISION: ...',
            '- L1-L80 -> BOUNDARY: NOT relevant. Skip.',
            '',
            '## Edits',
            '1. **file.ts:47** -> replaced forEach(async) with await Promise.all() | Reason: forEach discards promise returns',
            '',
            '## Meta',
            'Problem: [one sentence]',
            'Tags: async, promise, payment, cart',
            'Files touched: PaymentService.ts, CartRouter.ts',
            'Files read but NOT edited: OrderItem.ts (read to understand call chain, no changes needed)',
            '```',
            '',
            '### At end of task -> update the index',
            'Append one row to `.unravel/codex/codex-index.md`:',
            '`| payment-fix-001 | Silent payment failure for duplicate cart items | async, promise, cart, payment | 2026-03-28 |`',
            'This makes the codex searchable by future query_graph calls -> they will find it and inject it as pre_briefing automatically.',
            '',
            '### Staleness -> SUPERSEDES rule',
            'If you find that a past codex discovery is now WRONG (code was refactored), add a ## Supersedes section to your new codex:',
            '"SUPERSEDES: codex-payment-fix-001, Discovery at PaymentService.ts L47. Was: forEach(async). Now: refactored to processQueue() at L89."',
            '',
            '### Verify-on-use, not trust-and-use',
            'Codex tells you WHERE to look, not WHAT is true. Before citing a discovery in a verify() call, always confirm the actual line still matches. Same principle as verify() itself -> accelerate, do not substitute.',
            '',
            '### What NOT to do',
            '- Do NOT auto-generate discoveries from a file summary -> discoveries must be earned by reading',
            '- Do NOT write a codex for every file you read -> only what connects to the task goal',
            '- Do NOT write a full-codebase summary -> task-scope is the entire point',
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
    critLines.push('-----------------------------------------------------------------');
    critLines.push('UNRAVEL ANALYSIS -> read critical_signal first');
    critLines.push('-----------------------------------------------------------------');
    critLines.push('');
    critLines.push('READING GUIDE:');
    critLines.push('  critical_signal  -> START HERE. AST evidence, pattern hints. Usually sufficient.');
    critLines.push('  protocol         -> Phase reminders + verify() field list. Read when composing verify call.');
    critLines.push('  cross_file_graph -> Call graph + symbol origins. Read if cross-file chains are ambiguous.');
    critLines.push('  raw_ast_data     -> Full structured JSON. Read only for deep investigation.');
    critLines.push('  metadata         -> Engine version, timestamps. Skip unless debugging the engine.');
    critLines.push('');

    const cf = payload.evidence?.contextFormatted;
    if (cf) critLines.push(cf.trimEnd());

    const hints = payload._instructions?.patternHints;
    if (hints?.length) {
        critLines.push('\nPattern Hints (treat highest-confidence as H1):');
        for (const h of hints) {
            critLines.push(`  [${h.patternId}]  confidence=${h.confidence}  hitCount=${h.hitCount}`);
            critLines.push(`  -> ${h.hint}`);
        }
    }

    // Phase 7b: Semantic Archive Hits  rendered after structural pattern hints
    const archiveHints = payload._instructions?.semanticArchiveHints;
    if (archiveHints?.length) {
        critLines.push('\nSemantic Archive Hits (past verified diagnoses -> treat as H1):');
        for (const h of archiveHints) {
            critLines.push(`  FAST ${(h.similarity * 100).toFixed(0)}% match  [${h.diagnosisId}]  ${h.timestamp?.slice(0, 10) || ''}`);
            critLines.push(`  -> ${h.hint}`);
        }
    }

    // @F - circle-ir Supplementary Findings (reliability + performance passes)
    // These come from circle-ir's 36-pass pipeline; categories: reliability/performance only.
    // Security/taint, architecture, and noisy rules are excluded. Additive only.
    const circleFindings = payload._circleIrFindings || [];
    if (circleFindings.length > 0) {
        critLines.push('\nSection F - circle-ir Supplementary Findings (reliability/performance):');
        for (const f of circleFindings) {
            const cwe  = f.cwe ? ` [${f.cwe}]` : '';
            const loc  = (f.endLine && f.endLine !== f.line)
                ? `${f.file}:${f.line}-${f.endLine}`
                : `${f.file}:${f.line}`;
            critLines.push(`  [${f.ruleId}] ${f.severity.toUpperCase()}${cwe}  ${loc}`);
            critLines.push(`  -> ${f.message}`);
            if (f.fix) critLines.push(`   Fix: ${f.fix}`);
        }
        critLines.push('  (Treat these as additional H2/H3 candidates -> verify with AST evidence before citing)');
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
        critLines.push('-----------------------------------------------------------------');
        critLines.push('WARNING    VERDICT: STATIC_BLIND');
        critLines.push('-----------------------------------------------------------------');
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
                crossLines.push(`  ${e.caller} -> ${e.callee}:${e.function}()  L${e.line}`);
            }
        }

        if (cr.symbolOrigins) {
            crossLines.push('\nSymbol Origins (who imports what from where):');
            for (const [sym, info] of Object.entries(cr.symbolOrigins)) {
                const importedBy = (info.importedBy || []).map(i => i.file).join(', ');
                crossLines.push(`  ${info.name} [${info.file}:${info.line}]  ->   imported by: ${importedBy || 'none'}`);
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
        : `Raw data omitted in standard mode -> call analyze(detail:'full') to include. Size if included: ~${Math.round(JSON.stringify(payload).length / 1024)}KB.`;

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
    // Single letters are always noise (loop indices, math vars, destructuring)
    'i', 'j', 'k', 'n', 'm', 'x', 'y', '_',
    'a', 'b', 'c', 'd', 'f', 'g', 'h', 'p', 'q', 'r', 's', 't', 'v', 'w', 'z',
    // Generic error/utility names are rarely meaningful as cross-function state
    'err', 'error', 'e',
    'res', 'result', 'temp', 'tmp',
    'key', 'val', 'value', 'item',
    'el', 'elem', 'node', 'cb', 'fn',
    'idx', 'len', 'count', 'index',
    'event', 'evt', 'ctx', 'resolve', 'reject',
    // NOTE: domain names removed: conn, worker, task, entry, aged, fresh, ready,
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

registerAnalyzeTool(server, {
    session,
    mcpRoot: resolve(import.meta.dirname),
    resolveFiles,
    filterAstRawMutations,
    formatAnalysisForAgent,
    loadGraph: (...args) => loadGraph(...args),
    loadDiagnosisArchive,
    searchDiagnosisArchive,
    resolveEmbeddingApiKey,
    searchCodex,
    runCircleIrAnalysis,
    getCore: () => ({
        orchestrate,
        loadPatterns,
        getPatternCount,
        matchPatterns,
    }),
});

registerVerifyTool(server, {
    session,
    mcpRoot: resolve(import.meta.dirname),
    resolveEmbeddingApiKey,
    archiveDiagnosis,
    autoSeedCodex,
    enrichProjectOverviewWithDiagnosis,
    getCore: () => ({
        verifyClaims,
        checkSolvability,
        learnFromDiagnosis,
        penalizePattern,
        savePatterns,
    }),
});

registerBuildMapTool(server, {
    session,
    readFilesFromDirectory,
    loadGraph: (...args) => loadGraph(...args),
    saveGraph: (...args) => saveGraph(...args),
    saveMeta: (...args) => saveMeta(...args),
    getChangedFiles: (...args) => getChangedFiles(...args),
    computeContentHashSync: (...args) => computeContentHashSync(...args),
    shouldPatchIncrementally,
    INCREMENTAL_THRESHOLD,
    patchKnowledgeGraph,
    countCallEdges,
    extractJsDocSummary,
    deriveNodeMetadata,
    embedGraphNodes,
    embedChangedNodes,
    resolveEmbeddingApiKey,
    describeEmbeddingProvider,
    stampGraphMeta,
    generateProjectOverview,
    saveProjectOverview,
    getCore: () => ({
        GraphBuilder,
        mergeGraphUpdate,
        attachStructuralAnalysis,
        attachStructuralAnalysisToChanged,
    }),
});

registerQueryGraphTool(server, {
    session,
    loadGraph: (...args) => loadGraph(...args),
    saveGraph: (...args) => saveGraph(...args),
    saveMeta: (...args) => saveMeta(...args),
    getChangedFiles: (...args) => getChangedFiles(...args),
    computeContentHashSync: (...args) => computeContentHashSync(...args),
    readFilesFromDirectory,
    inspectGraphFreshness,
    stampGraphMeta,
    INCREMENTAL_THRESHOLD,
    countCallEdges,
    patchKnowledgeGraph,
    shouldPatchIncrementally,
    extractJsDocSummary,
    describeEmbeddingProvider,
    resolveEmbeddingApiKey,
    embedChangedNodes,
    buildSemanticScores,
    searchCodex,
    getCore: () => ({
        GraphBuilder,
        mergeGraphUpdate,
        attachStructuralAnalysisToChanged,
        matchPatterns,
        getNodeBoosts,
        queryGraphForFiles,
    }),
});
registerQueryVisualTool(server, {
    session,
    loadGraph: (...args) => loadGraph(...args),
    ensureGeminiVisualAvailable,
    describeEmbeddingProvider,
    embedImage,
    embedText,
    fuseEmbeddings,
    cosineSimilarity,
});

// 
// Start
// 

// =============================================================================
// Tool 5: unravel.consult - Project Intelligence Mode
// =============================================================================

registerConsultTool(server, { loadCoreModules });

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
