import { existsSync, readFileSync } from 'fs';
import { join, resolve } from 'path';
import { z } from 'zod';

export function registerBuildMapTool(server, deps) {
    server.tool(
        'build_map',
        'Build Unravel\'s Knowledge Graph from project files. Maps imports, function calls, and mutations. Once built, use query_graph to find relevant files for a bug. Mandatory for large repos where the full context cannot fit in memory.',
        {
            directory: z.string().describe('Path to the project root directory.'),
            embeddings: z.union([z.boolean(), z.enum(['all'])]).optional().describe(
                'Controls node embedding for semantic routing. Default (true): embeds top-50 hub nodes by edge count -> fast (~5-8s), good coverage. "all": embeds every connected node -> slower but provides complete semantic coverage (recommended for orgs with API budget). false: skip all embedding (keyword-only routing, no API calls).'
            ),
            include: z.array(z.string()).optional().describe(
                'Paths or folders to index (e.g. ["src/core", "packages/api/src"]). If provided, only files within these paths are indexed. Useful for monorepos where you want one KG at the root but only care about specific subsystems. Combine with exclude for fine-grained control.'
            ),
            exclude: z.array(z.string()).optional().describe(
                'Paths or substrings to exclude from indexing. Can be relative to the project root (e.g. "src/generated", "vendor") or absolute paths. Files whose paths contain any of these strings are skipped entirely -> not indexed, not embedded.'
            ),
            force: z.boolean().optional().describe(
                'Force a full rebuild even if an existing Knowledge Graph cache is present. Useful after analyzer upgrades.'
            ),
        },
        async (args) => {
            try {
                const core = deps.getCore();
                const dirPath = resolve(args.directory);
                if (!existsSync(dirPath)) {
                    throw new Error(`Directory not found: ${dirPath}`);
                }
                deps.session.projectRoot = dirPath;
                const buildStart = Date.now();

                process.stderr.write(`[unravel] Reading files from ${dirPath}...\n`);
                let files = deps.readFilesFromDirectory(dirPath, 5, args.exclude || []);
                if (args.exclude?.length) {
                    process.stderr.write(`[unravel] Exclude list: ${args.exclude.join(', ')}\n`);
                }
                if (args.include?.length) {
                    const includes = args.include.map(p => p.replace(/\\/g, '/'));
                    const before = files.length;
                    files = files.filter(f => {
                        const norm = f.name.replace(/\\/g, '/');
                        return includes.some(inc => norm.includes(inc));
                    });
                    process.stderr.write(`[unravel] Include filter: ${files.length}/${before} files match [${args.include.join(', ')}]\n`);
                }
                deps.session.files = files;
                process.stderr.write(`[unravel] Found ${files.length} source files.\n`);

                const existingGraph = deps.loadGraph(dirPath);
                if (existingGraph && existingGraph.nodes?.length > 0 && !args.force) {
                    const changed = deps.getChangedFiles(files, existingGraph, deps.computeContentHashSync);
                    process.stderr.write(`[unravel] Existing KG found (${existingGraph.nodes.length} nodes). ${changed.length}/${files.length} files changed.\n`);

                    if (changed.length === 0) {
                        return await handleUnchangedGraph({
                            args,
                            deps,
                            dirPath,
                            files,
                            existingGraph,
                            buildStart,
                        });
                    }

                    if (deps.shouldPatchIncrementally(changed.length, files.length, deps.INCREMENTAL_THRESHOLD)) {
                        process.stderr.write(`[unravel] Incremental rebuild: patching ${changed.length} changed files...\n`);
                        const incrementalApiKey = (args.embeddings !== false) ? deps.resolveEmbeddingApiKey() : null;
                        const heal = await deps.patchKnowledgeGraph({
                            existingGraph,
                            allFiles: files,
                            changedFiles: changed,
                            GraphBuilder: core.GraphBuilder,
                            mergeGraphUpdate: core.mergeGraphUpdate,
                            attachStructuralAnalysisToChanged: core.attachStructuralAnalysisToChanged,
                            extractJsDocSummary: deps.extractJsDocSummary,
                            computeContentHashSync: deps.computeContentHashSync,
                            stampGraphMeta: deps.stampGraphMeta,
                            embeddingProvider: deps.describeEmbeddingProvider(),
                            embedChangedNodes: args.embeddings === false ? null : deps.embedChangedNodes,
                            embedAll: args.embeddings === 'all',
                            apiKey: incrementalApiKey,
                            onProgress: msg => process.stderr.write(`[unravel] ${msg}\n`),
                        });

                        const merged = heal.graph;
                        deps.session.graph = merged;

                        if (args.embeddings === false) {
                            process.stderr.write('[unravel:embed] Embeddings disabled by caller -> skipping incremental embedding.\n');
                        } else if (!incrementalApiKey) {
                            process.stderr.write('[unravel:embed] No GEMINI_API_KEY -> skipping incremental embedding.\n');
                        }

                        try {
                            deps.saveGraph(dirPath, merged);
                            process.stderr.write(`[unravel] Incremental graph saved (${merged.nodes.length} nodes).\n`);
                            deps.saveMeta(dirPath, {
                                builtAt:      new Date().toISOString(),
                                nodeCount:    merged.nodes?.length  || 0,
                                edgeCount:    merged.edges?.length  || 0,
                                callEdges:    deps.countCallEdges(merged),
                                filesIndexed: files.length,
                                filesChanged: changed.length,
                                mode:         incrementalApiKey ? 'semantic' : 'structural',
                                incremental:  true,
                                schemaVersion: merged.meta?.schemaVersion,
                                engineVersion: merged.meta?.engineVersion,
                                embeddingProvider: deps.describeEmbeddingProvider(),
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
                                        callEdgesAdded: heal.callEdgesAdded,
                                    },
                                    summary: `Incremental rebuild: ${changed.length} files patched out of ${files.length}. ${merged.nodes.length} nodes, ${merged.edges?.length || 0} edges (${heal.callEdgesAdded} call edges added). Use query_graph to find relevant files for a bug.`,
                                }, null, 2),
                            }],
                        };
                    }
                    process.stderr.write(`[unravel] ${changed.length} files changed (>${Math.round(deps.INCREMENTAL_THRESHOLD * 100)}%) -> doing full rebuild.\n`);
                } else if (existingGraph && args.force) {
                    process.stderr.write('[unravel] Force rebuild requested -> ignoring cached graph.\n');
                }

                return await fullRebuild({ args, deps, core, dirPath, files, buildStart });
            } catch (err) {
                return {
                    content: [{ type: 'text', text: `Error: ${err.message}` }],
                    isError: true,
                };
            }
        }
    );
}

async function handleUnchangedGraph({ args, deps, dirPath, files, existingGraph, buildStart }) {
    const unchangedEmbedOpt = args.embeddings;
    const unchangedApiKey = (unchangedEmbedOpt !== false) ? deps.resolveEmbeddingApiKey() : null;
    const wantsAllEmbeddings = unchangedEmbedOpt === 'all';
    const missingEmbeddings = wantsAllEmbeddings
        ? (existingGraph.nodes || []).filter(n => !n.embedding?.length)
        : [];

    if (unchangedApiKey && missingEmbeddings.length > 0) {
        process.stderr.write(`[unravel:embed] Cached KG has ${missingEmbeddings.length} unembedded node(s); upgrading embeddings:'all'.\n`);
        await deps.embedGraphNodes(existingGraph, unchangedApiKey, { embedAll: true }).catch(e =>
            process.stderr.write(`[unravel:embed] Cached embed upgrade error: ${e.message}\n`)
        );
        try {
            deps.stampGraphMeta(existingGraph, {
                builtAt: new Date().toISOString(),
                embeddingProvider: deps.describeEmbeddingProvider(),
            });
            deps.saveGraph(dirPath, existingGraph);
            deps.saveMeta(dirPath, {
                builtAt:      new Date().toISOString(),
                nodeCount:    existingGraph.nodes?.length  || 0,
                edgeCount:    existingGraph.edges?.length  || 0,
                callEdges:    deps.countCallEdges(existingGraph),
                filesIndexed: files.length,
                mode:         'semantic',
                incremental:  true,
                embeddingUpgrade: 'all',
                schemaVersion: existingGraph.meta?.schemaVersion,
                engineVersion: existingGraph.meta?.engineVersion,
                embeddingProvider: deps.describeEmbeddingProvider(),
            });
        } catch (saveErr) {
            process.stderr.write(`[unravel] Could not persist embedding upgrade: ${saveErr.message}\n`);
        }
    }

    deps.session.graph = existingGraph;
    process.stderr.write('[unravel] No changes detected -> using cached graph.\n');
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
                    embeddedNodes: (existingGraph.nodes || []).filter(n => n.embedding?.length > 0).length,
                },
                summary: `Knowledge Graph unchanged -> ${files.length} files, ${existingGraph.nodes.length} nodes. Loaded from cache${missingEmbeddings.length > 0 ? ' and upgraded embeddings' : ''}.`,
            }, null, 2),
        }],
    };
}

async function fullRebuild({ args, deps, core, dirPath, files, buildStart }) {
    process.stderr.write('[unravel] Running structural analysis...\n');
    const enriched = await core.attachStructuralAnalysis(files);

    process.stderr.write('[unravel] Building knowledge graph...\n');
    const builder = new core.GraphBuilder();
    let indexedCount = 0;
    for (const file of enriched) {
        indexedCount++;
        if (indexedCount % 25 === 0 || indexedCount === enriched.length) {
            process.stderr.write(`[unravel] Indexing... ${indexedCount}/${enriched.length} files\n`);
        }
        const sa = file.structuralAnalysis || {};
        const nodeMeta = deps.deriveNodeMetadata(file.name, sa, 0, file.content || '');
        builder.addFileWithAnalysis(file.name, sa, nodeMeta);
    }

    const fnToFiles = new Map();
    for (const file of enriched) {
        for (const fn of (file.structuralAnalysis?.functions || [])) {
            if (!fnToFiles.has(fn.name)) fnToFiles.set(fn.name, new Set());
            fnToFiles.get(fn.name).add(file.name);
        }
    }

    const fileImportIndex = new Map();
    for (const file of enriched) {
        fileImportIndex.set(file.name, buildImportMap(file.structuralAnalysis || {}));
    }

    let callEdges = 0;
    for (const file of enriched) {
        for (const imp of (file.structuralAnalysis?.imports || [])) {
            if (!imp.resolvedPath || imp.resolvedPath === file.name) continue;
            builder.addImportEdge(file.name, imp.resolvedPath);
        }
    }

    for (const file of enriched) {
        const importMap = fileImportIndex.get(file.name) || new Map();
        for (const call of (file.structuralAnalysis?.calls || [])) {
            const calleeFile = resolveCalleeFile(call, file.name, importMap, fnToFiles);
            if (!calleeFile) continue;
            builder.addCallEdge(file.name, call.caller, calleeFile, call.callee);
            callEdges++;
        }
    }

    const fileHashes = {};
    for (const file of files) {
        fileHashes[file.name] = deps.computeContentHashSync(file.content);
    }

    const graph = builder.build(args.directory, []);
    graph.files = fileHashes;
    deps.session.graph = graph;

    const embedOpt = args.embeddings;
    const fullBuildApiKey = (embedOpt !== false) ? deps.resolveEmbeddingApiKey() : null;
    const embedAll = embedOpt === 'all';
    if (fullBuildApiKey) {
        await deps.embedGraphNodes(graph, fullBuildApiKey, { embedAll }).catch(e =>
            process.stderr.write(`[unravel:embed] Embed-on-ingest error: ${e.message}\n`)
        );
    } else if (embedOpt === false) {
        process.stderr.write('[unravel:embed] Embeddings disabled by caller -> structural KG only.\n');
    } else {
        process.stderr.write('[unravel:embed] No GEMINI_API_KEY -> skipping node embedding. Keyword-only routing active.\n');
    }

    attachCodexHints({ deps, dirPath, graph });

    deps.stampGraphMeta(graph, {
        builtAt: new Date().toISOString(),
        embeddingProvider: deps.describeEmbeddingProvider(),
    });

    try {
        deps.saveGraph(dirPath, graph);
        process.stderr.write(`[unravel] Graph saved to ${dirPath}/.unravel/knowledge.json\n`);
        deps.saveMeta(dirPath, {
            builtAt:      new Date().toISOString(),
            nodeCount:    graph.nodes?.length  || 0,
            edgeCount:    graph.edges?.length  || 0,
            callEdges,
            filesIndexed: files.length,
            mode:         fullBuildApiKey ? 'semantic' : 'structural',
            incremental:  false,
            schemaVersion: graph.meta?.schemaVersion,
            engineVersion: graph.meta?.engineVersion,
            embeddingProvider: deps.describeEmbeddingProvider(),
        });
        const overview = deps.generateProjectOverview(graph, dirPath);
        deps.saveProjectOverview(dirPath, overview);
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
}

function buildImportMap(structuralAnalysis) {
    const importMap = new Map();
    for (const imp of (structuralAnalysis.imports || [])) {
        if (!imp.resolvedPath) continue;
        const stem = imp.resolvedPath.split('/').pop().replace(/\.[^.]+$/, '');
        importMap.set(stem, imp.resolvedPath);
        const srcStem = imp.source.split('/').pop().replace(/\.[^.]+$/, '');
        if (!importMap.has(srcStem)) importMap.set(srcStem, imp.resolvedPath);
    }
    return importMap;
}

function resolveCalleeFile(call, currentFileName, importMap, fnToFiles) {
    const importResolved = importMap.get(call.callee);
    if (importResolved && importResolved !== currentFileName) return importResolved;

    const candidates = fnToFiles.get(call.callee);
    if (!candidates || candidates.size !== 1) return null;
    const [single] = candidates;
    return single !== currentFileName ? single : null;
}

function attachCodexHints({ deps, dirPath, graph }) {
    try {
        const codexIndexPath = join(dirPath, '.unravel', 'codex', 'codex-index.md');
        if (!existsSync(codexIndexPath)) return;

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

            const discMatch = codexContent.match(/## Discoveries\s*\n([\s\S]*?)(?=\n## |$)/);
            if (!discMatch) continue;
            const discoveries = discMatch[1];

            for (const node of (graph.nodes || [])) {
                const nodeFile = node.filePath || node.name || '';
                const baseName = nodeFile.split(/[/\\]/).pop() || '';
                if (!baseName || !discoveries.includes(baseName)) continue;

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

        if (hintsAttached > 0) {
            process.stderr.write(`[unravel:codex] Phase 5c-2: ${hintsAttached} codex hint(s) attached to KG nodes.\n`);
        }
    } catch (codexErr) {
        process.stderr.write(`[unravel:codex] Phase 5c-2: hint attachment failed (${codexErr.message}) -> continuing.\n`);
    }
}
