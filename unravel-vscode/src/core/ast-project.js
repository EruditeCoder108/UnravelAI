// ═══════════════════════════════════════════════════
// UNRAVEL v3 — Cross-File AST Project Analysis
// Post-processing pass that runs AFTER per-file AST analysis.
//
// Connects mutation chains across files by resolving imports/exports.
// Emits deterministic risk signals for common bug patterns.
//
// Does NOT modify ast-engine.js — purely additive layer.
// ═══════════════════════════════════════════════════

import { parseCode } from './ast-engine.js';
import _traverse from '@babel/traverse';
const traverse = _traverse.default || _traverse;

// ═══════════════════════════════════════════════════
// STEP 1: Build Module Map
// Scans import/export declarations across all files.
// ═══════════════════════════════════════════════════

/**
 * @param {Array<{name: string, content: string}>} files
 * @returns {{ moduleMap: Object, asts: Map }}
 */
export function buildModuleMap(files) {
    const moduleMap = {};
    const asts = new Map(); // filename -> AST (reuse later)

    for (const file of files) {
        const shortName = file.name.split(/[\\/]/).pop();
        const ast = parseCode(file.content);
        if (!ast) continue;
        asts.set(shortName, ast);

        const entry = { imports: {}, exports: {} };

        traverse(ast, {
            // import { foo, bar } from './module'
            ImportDeclaration(path) {
                const source = path.node.source?.value;
                if (!source || !source.startsWith('.')) return; // skip node_modules
                const resolvedSource = resolveModuleName(source, files);

                for (const spec of path.node.specifiers) {
                    if (spec.type === 'ImportSpecifier') {
                        const localName = spec.local.name;
                        const importedName = spec.imported?.name || localName;
                        entry.imports[localName] = {
                            from: resolvedSource,
                            originalName: importedName,
                            line: spec.loc?.start?.line || 0,
                        };
                    } else if (spec.type === 'ImportDefaultSpecifier') {
                        entry.imports[spec.local.name] = {
                            from: resolvedSource,
                            originalName: 'default',
                            line: spec.loc?.start?.line || 0,
                        };
                    } else if (spec.type === 'ImportNamespaceSpecifier') {
                        entry.imports[spec.local.name] = {
                            from: resolvedSource,
                            originalName: '*',
                            line: spec.loc?.start?.line || 0,
                        };
                    }
                }
            },

            // export let foo = ..., export function bar() {}, export { x, y }
            ExportNamedDeclaration(path) {
                const decl = path.node.declaration;
                if (decl) {
                    if (decl.type === 'VariableDeclaration') {
                        for (const d of decl.declarations) {
                            if (d.id?.name) {
                                entry.exports[d.id.name] = { line: d.loc?.start?.line || 0 };
                            }
                        }
                    } else if (decl.id?.name) {
                        // function or class declaration
                        entry.exports[decl.id.name] = { line: decl.loc?.start?.line || 0 };
                    }
                }
                // export { x, y } — specifiers without declaration
                for (const spec of path.node.specifiers || []) {
                    const exportedName = spec.exported?.name || spec.local?.name;
                    if (exportedName) {
                        entry.exports[exportedName] = { line: spec.loc?.start?.line || 0 };
                    }
                }
            },

            // export default ...
            ExportDefaultDeclaration(path) {
                const decl = path.node.declaration;
                const name = decl?.id?.name || 'default';
                entry.exports[name] = { line: path.node.loc?.start?.line || 0, isDefault: true };
            },
        });

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
    const symbolOrigins = {};

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
    const crossFileChains = {};

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
        const ast = asts.get(fileName);
        if (!ast) continue;

        // Build a set of imported function names for this file
        const importedFunctions = new Map(); // localName → { from, originalName }
        for (const [localName, info] of Object.entries(mod.imports)) {
            importedFunctions.set(localName, info);
        }

        if (importedFunctions.size === 0) continue;

        // Walk the AST looking for calls to imported functions
        traverse(ast, {
            CallExpression(path) {
                const callee = path.node.callee;
                let fnName = null;

                // Direct call: importedFn()
                if (callee.type === 'Identifier') {
                    fnName = callee.name;
                }
                // Method call on imported obj: importedObj.method()
                // We track the object, not the method
                if (callee.type === 'MemberExpression' && callee.object?.type === 'Identifier') {
                    fnName = callee.object.name;
                }

                if (fnName && importedFunctions.has(fnName)) {
                    const importInfo = importedFunctions.get(fnName);
                    callGraph.push({
                        caller: fileName,
                        callee: importInfo.from,
                        function: importInfo.originalName,
                        line: path.node.loc?.start?.line || 0,
                    });
                }
            },
        });
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
export function selectFilesByGraph(allFiles, symptom, crossFileData) {
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
        const result = buildModuleMap(jsFiles);
        moduleMap = result.moduleMap;
        callGraph = buildCallGraph(moduleMap, result.asts);
        crossFileChains = {};
    }

    // ── Step 1: Find entry point ──
    // Score each file by: symptom keyword match + import count (most-imported = most central)
    const fileNames = Object.keys(moduleMap);
    const scores = {};
    for (const name of fileNames) scores[name] = 0;

    // Symptom keyword matching
    const symptomLower = (symptom || '').toLowerCase();
    const symptomWords = symptomLower.split(/\W+/).filter(w => w.length > 2);

    for (const file of jsFiles) {
        const shortName = file.name.split(/[\\/]/).pop();
        if (!scores.hasOwnProperty(shortName)) continue;

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
            if (scores.hasOwnProperty(importInfo.from)) {
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

    // ── Fallback: if graph walk found too few files, return all ──
    if (selected.size < 3) {
        return {
            selectedFiles: jsFiles.map(f => f.name),
            strategy: 'llm-heuristic-fallback',
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
export function runCrossFileAnalysis(files, perFileAnalysis) {
    // Only analyze JS/TS files
    const jsFiles = files.filter(f => /\.(js|jsx|ts|tsx)$/i.test(f.name));
    if (jsFiles.length < 2) {
        return { formatted: '', raw: null }; // No cross-file analysis for single files
    }

    const { moduleMap, asts } = buildModuleMap(jsFiles);
    const symbolOrigins = resolveSymbolOrigins(moduleMap);
    const crossFileChains = expandMutationChains(
        perFileAnalysis?.mutations || {},
        symbolOrigins,
        moduleMap
    );
    const callGraph = buildCallGraph(moduleMap, asts);
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

function resolveModuleName(importPath, files) {
    // Strip leading ./ or ../
    const cleaned = importPath.replace(/^\.\//, '').replace(/^\.\.\//, '');

    // Try exact match first
    for (const f of files) {
        const shortName = f.name.split(/[\\/]/).pop();
        if (shortName === cleaned) return shortName;
    }

    // Try with common extensions
    const extensions = ['.js', '.jsx', '.ts', '.tsx'];
    for (const ext of extensions) {
        for (const f of files) {
            const shortName = f.name.split(/[\\/]/).pop();
            if (shortName === cleaned + ext) return shortName;
        }
    }

    // Try index files
    for (const ext of extensions) {
        for (const f of files) {
            const shortName = f.name.split(/[\\/]/).pop();
            if (shortName === cleaned + '/index' + ext) return shortName;
        }
    }

    // Fallback: return the cleaned path
    return cleaned;
}
