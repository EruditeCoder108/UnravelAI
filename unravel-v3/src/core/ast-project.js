// ═══════════════════════════════════════════════════
// UNRAVEL v3 — Cross-File AST Project Analysis
// Post-processing pass that runs AFTER per-file AST analysis.
//
// Connects mutation chains across files by resolving imports/exports.
// Emits deterministic risk signals for common bug patterns.
//
// Does NOT modify ast-engine.js — purely additive layer.
// ═══════════════════════════════════════════════════

import { parseCode, initParser } from './ast-engine-ts.js';

// ═══════════════════════════════════════════════════
// STEP 1: Build Module Map
// Scans import/export declarations across all files.
// ═══════════════════════════════════════════════════

/**
 * @param {Array<{name: string, content: string}>} files
 * @returns {Promise<{ moduleMap: Object, asts: Map }>}
 */
export async function buildModuleMap(files) {
    await initParser(); // tree-sitter WASM: lazy init, no-op after first call
    const moduleMap = Object.create(null); // null prototype — file/symbol names as keys
    const asts = new Map(); // filename → tree-sitter tree (reuse later)

    for (const file of files) {
        const shortName = file.name.split(/[\\/]/).pop();
        const tree = parseCode(file.content, shortName);
        if (!tree) continue;
        asts.set(shortName, tree);

        const entry = { imports: {}, exports: {} };
        const root = tree.rootNode;

        // ── Import statements ──
        const importNodes = root.descendantsOfType('import_statement');
        for (const importNode of importNodes) {
            const sourceNode = importNode.childForFieldName('source');
            const source = sourceNode?.text?.replace(/['"`]/g, '');
            if (!source) continue;
            if (isLikelyNodeModule(source, files)) continue;
            const resolvedSource = resolveModuleName(source, files);
            const line = importNode.startPosition.row + 1;

            // import clause: import_clause contains default/namespace/named imports
            const clause = importNode.namedChildren.find(c => c.type === 'import_clause');
            if (!clause) continue;

            for (const child of clause.namedChildren) {
                // import X from '...'
                if (child.type === 'identifier') {
                    entry.imports[child.text] = { from: resolvedSource, originalName: 'default', line };
                }
                // import * as X from '...'
                if (child.type === 'namespace_import') {
                    const id = child.namedChildren.find(c => c.type === 'identifier');
                    if (id) entry.imports[id.text] = { from: resolvedSource, originalName: '*', line };
                }
                // import { foo, bar as baz } from '...'
                if (child.type === 'named_imports') {
                    for (const spec of child.namedChildren) {
                        if (spec.type !== 'import_specifier') continue;
                        const nameNode = spec.childForFieldName('name');
                        const aliasNode = spec.childForFieldName('alias');
                        const localName = aliasNode?.text || nameNode?.text;
                        const importedName = nameNode?.text;
                        if (localName && importedName) {
                            entry.imports[localName] = { from: resolvedSource, originalName: importedName, line };
                        }
                    }
                }
            }
        }

        // ── Export statements ──
        // export { x, y } or export { x as foo }
        const exportNamedNodes = root.descendantsOfType('export_statement');
        for (const exp of exportNamedNodes) {
            const line = exp.startPosition.row + 1;

            // export { x, y }
            const exportClause = exp.namedChildren.find(c => c.type === 'export_clause');
            if (exportClause) {
                for (const spec of exportClause.namedChildren) {
                    if (spec.type !== 'export_specifier') continue;
                    const nameNode = spec.childForFieldName('name');
                    const aliasNode = spec.childForFieldName('alias');
                    const exportedName = aliasNode?.text || nameNode?.text;
                    if (exportedName) entry.exports[exportedName] = { line };
                }
            }

            // export let/const/var x = ...
            const declNode = exp.namedChildren.find(c =>
                c.type === 'lexical_declaration' || c.type === 'variable_declaration'
            );
            if (declNode) {
                for (const decl of declNode.namedChildren) {
                    if (decl.type !== 'variable_declarator') continue;
                    const id = decl.childForFieldName('name');
                    if (id?.type === 'identifier') entry.exports[id.text] = { line };
                }
            }

            // export function foo() {} / export class Foo {}
            const fnNode = exp.namedChildren.find(c =>
                c.type === 'function_declaration' || c.type === 'class_declaration' ||
                c.type === 'generator_function_declaration'
            );
            if (fnNode) {
                const id = fnNode.childForFieldName('name');
                if (id) entry.exports[id.text] = { line };
            }

            // export default ...
            const isDefault = exp.children.some(c => c.type === 'default');
            if (isDefault) {
                const decl = exp.namedChildren[0];
                const name = decl?.childForFieldName?.('name')?.text || 'default';
                entry.exports[name] = { line, isDefault: true };
            }
        }

        moduleMap[shortName] = entry;
    }

    return { moduleMap, asts };
}

// ═══════════════════════════════════════════════════
// STEP 2: Resolve Symbol Origins
// For every imported symbol, trace it to its source file.
// ═══════════════════════════════════════════════════

/**
 * @param {Object} moduleMap
 * @returns {Object} symbolOrigins - { "varName": { file, line, importedBy: [{file, localName, line}] } }
 */
export function resolveSymbolOrigins(moduleMap) {
    const symbolOrigins = Object.create(null);

    for (const [fileName, mod] of Object.entries(moduleMap)) {
        for (const [localName, importInfo] of Object.entries(mod.imports)) {
            const sourceFile = importInfo.from;
            const originalName = importInfo.originalName;
            const sourceMod = moduleMap[sourceFile];

            // Find the export in the source module
            const exportInfo = sourceMod?.exports?.[originalName];
            if (!exportInfo) continue; // re-export or external — skip

            const originKey = `${originalName}@${sourceFile}`;
            if (!symbolOrigins[originKey]) {
                symbolOrigins[originKey] = {
                    name: originalName,
                    file: sourceFile,
                    line: exportInfo.line,
                    importedBy: [],
                };
            }

            symbolOrigins[originKey].importedBy.push({
                file: fileName,
                localName,
                line: importInfo.line,
            });
        }
    }

    return symbolOrigins;
}

// ═══════════════════════════════════════════════════
// STEP 3: Expand Mutation Chains Across Files
// Merges per-file mutation data using symbol origins.
// ═══════════════════════════════════════════════════

/**
 * @param {Object} perFileMutations - { "varName [fileName]": { writes: [], reads: [] } }
 * @param {Object} symbolOrigins - from resolveSymbolOrigins()
 * @param {Object} moduleMap - from buildModuleMap()
 * @returns {Object} crossFileChains - { "varName [originFile]": { writes: [{fn, line, file}], reads: [{fn, line, file}] } }
 */
export function expandMutationChains(perFileMutations, symbolOrigins, moduleMap) {
    const crossFileChains = Object.create(null);

    for (const [key, data] of Object.entries(perFileMutations)) {
        // Key format: "varName [fileName]"
        const match = key.match(/^(.+?) \[(.+?)\]$/);
        if (!match) continue;

        const [, varName, fileName] = match;

        // Check if this variable is an imported symbol
        const importInfo = moduleMap[fileName]?.imports?.[varName];

        if (importInfo) {
            // This is an imported variable — merge into origin's chain
            const originKey = `${importInfo.originalName}@${importInfo.from}`;
            const origin = symbolOrigins[originKey];
            if (!origin) continue;

            const chainKey = `${origin.name} [${origin.file}]`;
            if (!crossFileChains[chainKey]) {
                crossFileChains[chainKey] = {
                    originFile: origin.file,
                    originLine: origin.line,
                    writes: [],
                    reads: [],
                };
            }

            // Add writes/reads with the file annotation
            for (const w of data.writes) {
                crossFileChains[chainKey].writes.push({ ...w, file: fileName });
            }
            for (const r of data.reads) {
                crossFileChains[chainKey].reads.push({ ...r, file: fileName });
            }
        } else {
            // Check if this variable is exported (it's the origin itself)
            const exportInfo = moduleMap[fileName]?.exports?.[varName];
            if (!exportInfo) continue; // local-only variable, skip

            const chainKey = `${varName} [${fileName}]`;
            if (!crossFileChains[chainKey]) {
                crossFileChains[chainKey] = {
                    originFile: fileName,
                    originLine: exportInfo.line,
                    writes: [],
                    reads: [],
                };
            }

            for (const w of data.writes) {
                crossFileChains[chainKey].writes.push({ ...w, file: fileName });
            }
            for (const r of data.reads) {
                crossFileChains[chainKey].reads.push({ ...r, file: fileName });
            }
        }
    }

    return crossFileChains;
}

// ═══════════════════════════════════════════════════
// STEP 4: Emit Risk Signals
// Deterministic pattern detection — facts, not diagnoses.
// ═══════════════════════════════════════════════════

/**
 * @param {Object} crossFileChains - from expandMutationChains()
 * @param {Object} perFileMutations - raw per-file mutations
 * @param {Object} symbolOrigins - from resolveSymbolOrigins()
 * @param {Array} timingNodes - from ast-engine merged timing
 * @returns {Array} riskSignals
 */
export function emitRiskSignals(crossFileChains, perFileMutations, symbolOrigins, timingNodes) {
    const riskSignals = [];

    // ── Pattern 1: Exported variable mutated outside its origin file ──
    for (const [chainKey, chain] of Object.entries(crossFileChains)) {
        for (const write of chain.writes) {
            if (write.file && write.file !== chain.originFile) {
                riskSignals.push({
                    type: 'cross_file_mutation',
                    variable: chainKey.replace(/ \[.*\]$/, ''),
                    origin: chain.originFile,
                    mutatedIn: write.file,
                    line: write.line,
                    fn: write.fn,
                });
            }
        }
    }

    // ── Pattern 2: Variable written within async boundary ──
    // If a timing node (setTimeout/setInterval/fetch) exists in the same function
    // that writes a variable, flag as potential race condition
    const timingFunctions = new Set();
    for (const t of timingNodes || []) {
        if (t.enclosingFn) timingFunctions.add(`${t.enclosingFn}@${t.file || ''}`);
        if (t.callback) timingFunctions.add(`${t.callback}@${t.file || ''}`);
    }

    for (const [key, data] of Object.entries(perFileMutations)) {
        const match = key.match(/^(.+?) \[(.+?)\]$/);
        if (!match) continue;
        const [, varName, fileName] = match;

        for (const write of data.writes) {
            const fnKey = `${write.fn}@${fileName}`;
            if (timingFunctions.has(fnKey)) {
                riskSignals.push({
                    type: 'async_state_race',
                    variable: varName,
                    file: fileName,
                    line: write.line,
                    fn: write.fn,
                });
            }
        }
    }

    // ── Pattern 3: Unawaited async call ──
    // DEFERRED: findTimingNodes() does not currently track whether a call
    // is awaited (no isAwaited field). Firing on every fetch()/Promise would
    // generate false positives on valid `await fetch()` calls.
    // TODO: Add AwaitExpression detection to findTimingNodes, then re-enable.
    // See: https://github.com/EruditeCoder108/UnravelAI/issues (unawaited_promise)

    // Deduplicate signals (same type + variable + file + line)
    const seen = new Set();
    return riskSignals.filter(sig => {
        const key = `${sig.type}|${sig.variable || sig.function}|${sig.file || sig.mutatedIn}|${sig.line}`;
        if (seen.has(key)) return false;
        seen.add(key);
        return true;
    });
}

// ═══════════════════════════════════════════════════
// STEP 5: Build Call Graph
// Tracks cross-file function calls: A imports fn from B,
// then calls fn() → directed edge A → B.
// ═══════════════════════════════════════════════════

/**
 * @param {Object} moduleMap - from buildModuleMap()
 * @param {Map} asts - from buildModuleMap()
 * @returns {Array<{caller: string, callee: string, function: string, line: number}>}
 */
export function buildCallGraph(moduleMap, asts) {
    const callGraph = [];

    for (const [fileName, mod] of Object.entries(moduleMap)) {
        const tree = asts.get(fileName);
        if (!tree) continue;

        // Build a set of imported function names for this file
        const importedFunctions = new Map(); // localName → { from, originalName }
        for (const [localName, info] of Object.entries(mod.imports)) {
            importedFunctions.set(localName, info);
        }

        if (importedFunctions.size === 0) continue;

        // Walk the tree looking for calls to imported functions (tree-sitter)
        const callNodes = tree.rootNode.descendantsOfType('call_expression');
        for (const call of callNodes) {
            const callee = call.childForFieldName('function');
            if (!callee) continue;

            let fnName = null;

            // Direct call: importedFn()
            if (callee.type === 'identifier') {
                fnName = callee.text;
            }
            // Method call on imported obj: importedObj.method()
            if (callee.type === 'member_expression') {
                const obj = callee.childForFieldName('object');
                if (obj?.type === 'identifier') fnName = obj.text;
            }

            if (fnName && importedFunctions.has(fnName)) {
                const importInfo = importedFunctions.get(fnName);
                callGraph.push({
                    caller: fileName,
                    callee: importInfo.from,
                    function: importInfo.originalName,
                    line: call.startPosition.row + 1,
                });
            }
        }
    }

    // Deduplicate (same caller+callee+function, keep first occurrence)
    const seen = new Set();
    return callGraph.filter(edge => {
        const key = `${edge.caller}→${edge.callee}:${edge.function}`;
        if (seen.has(key)) return false;
        seen.add(key);
        return true;
    });
}

// ═══════════════════════════════════════════════════
// GRAPH-FRONTIER ROUTER
// Deterministic file selection using import graph,
// mutation chains, and call graph — replaces LLM heuristic.
// ═══════════════════════════════════════════════════

const GRAPH_MAX_DEPTH = 3;
const GRAPH_MAX_FILES = 15;

/**
 * Select the most relevant files for analysis using graph traversal.
 *
 * @param {Array<{name: string, content: string}>} allFiles - all available project files
 * @param {string} symptom - the user's bug description
 * @param {Object} [crossFileData] - raw output from runCrossFileAnalysis (optional, computed if missing)
 * @returns {{ selectedFiles: string[], strategy: string }}
 */
export async function selectFilesByGraph(allFiles, symptom, crossFileData) {
    const jsFiles = allFiles.filter(f => /\.(js|jsx|ts|tsx)$/i.test(f.name));

    // Not enough files to need routing
    if (jsFiles.length <= GRAPH_MAX_FILES) {
        return {
            selectedFiles: jsFiles.map(f => f.name),
            strategy: 'all-files',
        };
    }

    // Build graph data if not provided
    let moduleMap, callGraph, crossFileChains;
    if (crossFileData?.moduleMap) {
        moduleMap = crossFileData.moduleMap;
        callGraph = crossFileData.callGraph || [];
        crossFileChains = crossFileData.crossFileChains || {};
    } else {
        const result = await buildModuleMap(jsFiles);
        moduleMap = result.moduleMap;
        callGraph = buildCallGraph(moduleMap, result.asts);
        crossFileChains = Object.create(null);
    }

    // ── Step 1: Find entry point ──
    // Score each file by: symptom keyword match + import count (most-imported = most central)
    const fileNames = Object.keys(moduleMap);
    const scores = Object.create(null);
    for (const name of fileNames) scores[name] = 0;

    // Symptom keyword matching
    const symptomLower = (symptom || '').toLowerCase();
    const symptomWords = symptomLower.split(/\W+/).filter(w => w.length > 2);

    for (const file of jsFiles) {
        const shortName = file.name.split(/[\\/]/).pop();
        if (!Object.prototype.hasOwnProperty.call(scores, shortName)) continue;

        // Filename matches symptom
        const nameLower = shortName.toLowerCase().replace(/\.\w+$/, '');
        for (const word of symptomWords) {
            if (nameLower.includes(word)) scores[shortName] += 5;
        }

        // Content matches symptom keywords
        const contentLower = file.content.toLowerCase();
        for (const word of symptomWords) {
            if (contentLower.includes(word)) scores[shortName] += 1;
        }
    }

    // Import centrality: files imported by many others are more central
    for (const [, mod] of Object.entries(moduleMap)) {
        for (const [, importInfo] of Object.entries(mod.imports)) {
            if (Object.prototype.hasOwnProperty.call(scores, importInfo.from)) {
                scores[importInfo.from] += 2;
            }
        }
    }

    // Sort by score descending
    const rankedFiles = fileNames.sort((a, b) => scores[b] - scores[a]);
    const entryPoint = rankedFiles[0];

    // ── Step 2: BFS walk from entry point ──
    const selected = new Set();
    const queue = [{ file: entryPoint, depth: 0 }];
    selected.add(entryPoint);

    while (queue.length > 0 && selected.size < GRAPH_MAX_FILES) {
        const { file, depth } = queue.shift();
        if (depth >= GRAPH_MAX_DEPTH) continue;

        const mod = moduleMap[file];
        if (!mod) continue;

        // Walk imports (file imports from these files)
        for (const [, importInfo] of Object.entries(mod.imports)) {
            if (!selected.has(importInfo.from) && moduleMap[importInfo.from]) {
                selected.add(importInfo.from);
                queue.push({ file: importInfo.from, depth: depth + 1 });
            }
        }

        // Walk reverse imports (files that import from this file)
        for (const [otherFile, otherMod] of Object.entries(moduleMap)) {
            if (selected.has(otherFile)) continue;
            for (const [, impInfo] of Object.entries(otherMod.imports)) {
                if (impInfo.from === file) {
                    selected.add(otherFile);
                    queue.push({ file: otherFile, depth: depth + 1 });
                    break;
                }
            }
        }

        // Walk call graph edges
        for (const edge of callGraph) {
            if (edge.caller === file && !selected.has(edge.callee) && moduleMap[edge.callee]) {
                selected.add(edge.callee);
                queue.push({ file: edge.callee, depth: depth + 1 });
            }
            if (edge.callee === file && !selected.has(edge.caller) && moduleMap[edge.caller]) {
                selected.add(edge.caller);
                queue.push({ file: edge.caller, depth: depth + 1 });
            }
        }
    }

    // ── Step 3: Add files from cross-file mutation chains related to symptom ──
    for (const [chainKey, chain] of Object.entries(crossFileChains)) {
        const varName = chainKey.replace(/ \[.*\]$/, '').toLowerCase();
        if (symptomWords.some(w => varName.includes(w))) {
            if (chain.originFile && !selected.has(chain.originFile)) {
                selected.add(chain.originFile);
            }
            for (const w of chain.writes) {
                if (w.file && !selected.has(w.file)) selected.add(w.file);
            }
            for (const r of chain.reads) {
                if (r.file && !selected.has(r.file)) selected.add(r.file);
            }
        }
    }

    // ── Fallback: graph walk found too few connected files ──
    // Instead of dumping all files (which triggers the 25-file alphabetical cap),
    // return the top GRAPH_MAX_FILES files by symptom score — best guess is better than none.
    if (selected.size < 3) {
        const topScored = rankedFiles.slice(0, GRAPH_MAX_FILES);
        console.warn(`[GRAPH] BFS found only ${selected.size} files — falling back to top-${topScored.length} by symptom score`);
        return {
            selectedFiles: topScored,
            strategy: 'symptom-score-fallback',
        };
    }

    return {
        selectedFiles: Array.from(selected),
        strategy: 'graph-frontier',
    };
}

// ═══════════════════════════════════════════════════
// INTEGRATION: Run the full cross-file analysis pipeline
// ═══════════════════════════════════════════════════

/**
 * Run cross-file analysis on an array of file objects.
 * Returns formatted context string and raw data.
 *
 * @param {Array<{name: string, content: string}>} files
 * @param {Object} perFileAnalysis - The raw output from runMultiFileAnalysis()
 * @returns {{ formatted: string, raw: Object }}
 */
export async function runCrossFileAnalysis(files, perFileAnalysis) {
    // Only analyze JS/TS files
    const jsFiles = files.filter(f => /\.(js|jsx|ts|tsx)$/i.test(f.name));
    if (jsFiles.length < 2) {
        return { formatted: '', raw: null }; // No cross-file analysis for single files
    }

    const { moduleMap, asts } = await buildModuleMap(jsFiles);
    const symbolOrigins = resolveSymbolOrigins(moduleMap);
    const crossFileChains = expandMutationChains(
        perFileAnalysis?.mutations || {},
        symbolOrigins,
        moduleMap
    );
    const callGraph = buildCallGraph(moduleMap, asts);

    // Free WASM memory — trees were only needed for buildCallGraph
    for (const tree of asts.values()) { try { tree.delete(); } catch (_) {} }
    const riskSignals = emitRiskSignals(
        crossFileChains,
        perFileAnalysis?.mutations || {},
        symbolOrigins,
        perFileAnalysis?.timingNodes || []
    );

    // Format for prompt injection
    const formatted = formatCrossFileContext(crossFileChains, riskSignals, callGraph);

    return {
        formatted,
        raw: {
            moduleMap,
            symbolOrigins,
            crossFileChains,
            callGraph,
            riskSignals,
        },
    };
}

// ═══════════════════════════════════════════════════
// FORMAT: Turns cross-file data into prompt context
// ═══════════════════════════════════════════════════

function formatCrossFileContext(crossFileChains, riskSignals, callGraph) {
    const lines = [];

    // Cross-file mutation chains
    const chainEntries = Object.entries(crossFileChains)
        .filter(([, c]) => c.writes.some(w => w.file !== c.originFile) || c.reads.some(r => r.file !== c.originFile));

    if (chainEntries.length > 0) {
        lines.push('Cross-File Mutation Chains:');
        for (const [chainKey, chain] of chainEntries) {
            lines.push(`  ${chainKey} [origin: ${chain.originFile} L${chain.originLine}]`);
            if (chain.writes.length > 0) {
                const writeStrs = chain.writes.map(w => `${w.file || '?'}:${w.fn || '?'}() L${w.line}`);
                lines.push(`    written: ${writeStrs.join(', ')}`);
            }
            if (chain.reads.length > 0) {
                const readStrs = chain.reads.map(r => `${r.file || '?'}:${r.fn || '?'}() L${r.line}`);
                lines.push(`    read:    ${readStrs.join(', ')}`);
            }
        }
        lines.push('');
    }

    // Call graph edges
    if (callGraph && callGraph.length > 0) {
        lines.push('Call Graph (cross-file function calls):');
        for (const edge of callGraph) {
            lines.push(`  ${edge.caller} → ${edge.callee}:${edge.function}() L${edge.line}`);
        }
        lines.push('');
    }

    // Risk signals
    if (riskSignals.length > 0) {
        lines.push('Risk Signals Detected:');
        for (const sig of riskSignals) {
            if (sig.type === 'cross_file_mutation') {
                lines.push(`  • cross_file_mutation — ${sig.variable} (${sig.origin} → ${sig.mutatedIn} L${sig.line})`);
            } else if (sig.type === 'async_state_race') {
                lines.push(`  • async_state_race — ${sig.variable} written in ${sig.fn}() [${sig.file} L${sig.line}]`);
            } else if (sig.type === 'unawaited_promise') {
                lines.push(`  • unawaited_promise — ${sig.function}() [${sig.file} L${sig.line}]`);
            } else if (sig.type === 'stale_closure') {
                lines.push(`  • stale_closure — ${sig.variable} captured in ${sig.capturedIn}() [${sig.file}]`);
            }
        }
        lines.push('');
    }

    return lines.join('\n');
}

// ═══════════════════════════════════════════════════
// HELPER: Resolve module name from import path
// ═══════════════════════════════════════════════════

// ═══════════════════════════════════════════════════
// HELPER: isLikelyNodeModule
// Decides whether an import string should be skipped
// as an external dependency vs. attempted as a path alias.
//
// Skip (true):
//   'react', 'lodash', 'fs', 'path'   → bare single-word, no slash
//   '@scope/package'                   → scoped npm: starts with @ AND has exactly one slash
//
// Attempt resolution (false):
//   './utils', '../store'              → relative (already handled upstream)
//   'vs/base/common/event'             → multi-segment, no @, likely tsconfig alias
//   '@/components/Button'              → @ prefix but multiple slashes = tsconfig @ alias
//   '~/utils', 'src/components/Button' → tilde or root-relative alias
// ═══════════════════════════════════════════════════

function isLikelyNodeModule(source, files) {
    // Relative imports are never node_modules
    if (source.startsWith('.') || source.startsWith('/')) return false;

    // Tilde aliases (~/) are always intra-project
    if (source.startsWith('~')) return false;

    // Scoped package: @scope/pkg — exactly one slash after the @
    // But @scope/pkg/deep or @/anything are path aliases
    if (source.startsWith('@')) {
        const slashCount = (source.match(/\//g) || []).length;
        // @scope/pkg → 1 slash → real npm package
        // @/components/Button → starts with @/ → tsconfig alias
        // @scope/pkg/subpath → 2+ slashes → treat as alias (rare for npm, common for aliases)
        if (source.startsWith('@/')) return false; // tsconfig @ alias
        if (slashCount === 1) return true;          // scoped npm package
        return false;                               // deeper path, likely alias
    }

    // No slash at all → bare module name like 'react', 'fs', 'lodash'
    if (!source.includes('/')) return true;

    // Has slashes but no @ → could be a path alias like 'vs/base/common/event'
    // or 'src/utils/store'. Try to resolve it — if we find a matching file, keep it.
    // If no file matches, skip it (genuine node_module with subpath like 'lodash/fp').
    const lastSeg = source.split('/').pop() || source;
    const extensions = ['.js', '.jsx', '.ts', '.tsx'];
    for (const f of files) {
        const shortName = f.name.split(/[\\/]/).pop();
        const shortNoExt = shortName.replace(/\.[^.]+$/, '');
        if (shortNoExt === lastSeg || shortName === lastSeg) return false;
        for (const ext of extensions) {
            if (shortName === lastSeg + ext) return false;
        }
    }

    // No file matched → likely a node_module subpath (e.g. 'lodash/fp', 'date-fns/format')
    return true;
}

function resolveModuleName(importPath, files) {
    // Strip all leading ./ and ../ path segments
    // e.g. '../../utils/store' → 'utils/store', './api' → 'api'
    const segments = importPath.split('/');
    const cleaned = segments.filter(s => s !== '.' && s !== '..').join('/') || importPath;

    // The last segment of the cleaned path is the actual filename (without extension)
    // e.g. 'utils/store' → 'store', 'vs/base/common/event' → 'event'
    const lastSegment = cleaned.split('/').pop() || cleaned;

    const extensions = ['.js', '.jsx', '.ts', '.tsx'];

    // Pass 1: exact full-path match (handles cases where f.name includes directory)
    for (const f of files) {
        const fNorm = f.name.replace(/\\/g, '/');
        // Check if file path ends with cleaned (with or without extension)
        if (fNorm.endsWith('/' + cleaned) || fNorm === cleaned) return f.name.split(/[\\/]/).pop();
        for (const ext of extensions) {
            if (fNorm.endsWith('/' + cleaned + ext) || fNorm === cleaned + ext) return f.name.split(/[\\/]/).pop();
        }
    }

    // Pass 2: match by basename only — handles flat-uploaded files where f.name has no directory
    for (const f of files) {
        const shortName = f.name.split(/[\\/]/).pop(); // e.g. "store.ts"
        const shortNoExt = shortName.replace(/\.[^.]+$/, ''); // e.g. "store"
        if (shortNoExt === lastSegment || shortName === lastSegment) return shortName;
        for (const ext of extensions) {
            if (shortName === lastSegment + ext) return shortName;
        }
    }

    // Pass 3: index files — e.g. import './store' could resolve to store/index.ts
    for (const f of files) {
        const shortName = f.name.split(/[\\/]/).pop();
        for (const ext of extensions) {
            if (shortName === lastSegment + '/index' + ext) return shortName;
        }
    }

    // Fallback: return the last segment (best guess for the model)
    return lastSegment;
}
