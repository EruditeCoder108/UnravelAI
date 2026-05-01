import { resolve } from 'path';
import { z } from 'zod';

export function registerQueryGraphTool(server, deps) {
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
                const core = deps.getCore();
                let graph = deps.session.graph;
                const projectRoot = args.directory ? resolve(args.directory) : deps.session.projectRoot;

                if (projectRoot && projectRoot !== deps.session.projectRoot) {
                    deps.session.projectRoot = projectRoot;
                    graph = deps.loadGraph(projectRoot);
                    if (graph) {
                        deps.session.graph = graph;
                        process.stderr.write(`[unravel] Directory changed -> loaded graph from ${projectRoot}/.unravel/knowledge.json\n`);
                    }
                }

                // Try loading from disk if not in session
                if (!graph && projectRoot) {
                    graph = deps.loadGraph(projectRoot);
                    if (graph) {
                        deps.session.graph = graph;
                        process.stderr.write(`[unravel] Loaded existing graph from ${projectRoot}/.unravel/knowledge.json\n`);
                    }
                }

                if (!graph || !graph.nodes || graph.nodes.length === 0) {
                    throw new Error('No Knowledge Graph available. Call build_map first to index your project.');
                }

                const maxResults = args.maxResults || 12;
                let graphFreshness = projectRoot
                    ? deps.inspectGraphFreshness(projectRoot, graph, {
                        readFilesFromDirectory: deps.readFilesFromDirectory,
                        getChangedFiles: deps.getChangedFiles,
                        computeContentHashSync: deps.computeContentHashSync,
                    })
                    : { checked: false, stale: null, changedFiles: [], reason: 'no project root' };

                if (projectRoot && graphFreshness.stale && graph.files && !graphFreshness.missingHashes) {
                    const allFiles = deps.readFilesFromDirectory(projectRoot, 5);
                    const changed = deps.getChangedFiles(allFiles, graph, deps.computeContentHashSync);
                    if (deps.shouldPatchIncrementally(changed.length, allFiles.length, deps.INCREMENTAL_THRESHOLD)) {
                        process.stderr.write(`[unravel] query_graph self-heal: patching ${changed.length}/${allFiles.length} changed file(s).\n`);
                        const heal = await deps.patchKnowledgeGraph({
                            existingGraph: graph,
                            allFiles,
                            changedFiles: changed,
                            GraphBuilder: core.GraphBuilder,
                            mergeGraphUpdate: core.mergeGraphUpdate,
                            attachStructuralAnalysisToChanged: core.attachStructuralAnalysisToChanged,
                            extractJsDocSummary: deps.extractJsDocSummary,
                            computeContentHashSync: deps.computeContentHashSync,
                            stampGraphMeta: deps.stampGraphMeta,
                            embeddingProvider: deps.describeEmbeddingProvider(),
                            embedChangedNodes: deps.embedChangedNodes,
                            apiKey: deps.resolveEmbeddingApiKey(),
                            onProgress: msg => process.stderr.write(`[unravel] query_graph self-heal: ${msg}\n`),
                        });
                        graph = heal.graph;
                        deps.session.graph = graph;
                        deps.session.files = allFiles;
                        deps.saveGraph(projectRoot, graph);
                        deps.saveMeta(projectRoot, {
                            builtAt:      new Date().toISOString(),
                            nodeCount:    graph.nodes?.length || 0,
                            edgeCount:    graph.edges?.length || 0,
                            callEdges:    deps.countCallEdges(graph),
                            filesIndexed: allFiles.length,
                            filesChanged: changed.length,
                            mode:         deps.resolveEmbeddingApiKey() ? 'semantic' : 'structural',
                            incremental:  true,
                            selfHealed:   true,
                            schemaVersion: graph.meta?.schemaVersion,
                            engineVersion: graph.meta?.engineVersion,
                            embeddingProvider: deps.describeEmbeddingProvider(),
                        });
                        graphFreshness = {
                            checked: true,
                            stale: false,
                            changedFiles: changed.map(f => f.name),
                            missingHashes: false,
                            markedStaleEmbeddings: 0,
                            selfHealed: true,
                            filesPatched: heal.changedCount,
                            callEdgesAdded: heal.callEdgesAdded,
                            reason: `query_graph self-healed ${heal.changedCount} changed file(s)`,
                        };
                    } else if (changed.length > 0) {
                        graphFreshness.needsFullRebuild = true;
                        graphFreshness.reason = `${changed.length}/${allFiles.length} file(s) changed; run build_map(force:true) for full rebuild`;
                        process.stderr.write(`[unravel] query_graph freshness: ${graphFreshness.reason}\n`);
                    }
                }

                if (graphFreshness.stale && graphFreshness.markedStaleEmbeddings > 0 && projectRoot) {
                    try {
                        deps.stampGraphMeta(graph, {
                            lastFreshnessCheck: new Date().toISOString(),
                            staleEmbeddingNodes: graphFreshness.markedStaleEmbeddings,
                        });
                        deps.saveGraph(projectRoot, graph);
                        process.stderr.write(`[unravel] KG freshness: ${graphFreshness.reason}; marked ${graphFreshness.markedStaleEmbeddings} stale embedded node(s).\n`);
                    } catch (freshSaveErr) {
                        process.stderr.write(`[unravel] KG freshness save warning: ${freshSaveErr.message}\n`);
                    }
                }

                //  Phase 5b hook: Semantic routing via gemini-embedding-2-preview
                // If GEMINI_API_KEY is set AND nodes have embeddings, compute cosine
                // similarity between the symptom and all node embeddings.
                // The resulting Map<nodeId, score> is passed into expandWeighted() which
                // adds a semantic bonus (+0.4 * similarity) to both seed and hop scores.
                // Falls back to keyword-only (empty Map) if key absent or embed fails.
                let _semanticScores = new Map();
                const queryApiKey = deps.resolveEmbeddingApiKey();
                const hasEmbeddings = graph.nodes?.some(n => n.embedding);
                if (queryApiKey && hasEmbeddings) {
                    _semanticScores = await deps.buildSemanticScores(args.symptom, graph, queryApiKey).catch(e => {
                        process.stderr.write(`[unravel:embed] Semantic scoring failed: ${e.message} -> using keyword-only.\n`);
                        return new Map();
                    });
                } else if (!queryApiKey) {
                    process.stderr.write('[unravel:embed] No GEMINI_API_KEY -> using keyword-only routing.\n');
                } else {
                    process.stderr.write('[unravel:embed] No node embeddings found -> run build_map with GEMINI_API_KEY to enable semantic routing.\n');
                }

                // -- Pattern boosts: if a prior analyze() ran, pattern-matched node boosts
                // are merged into _semanticScores. Files whose names match a detected bug-type
                // keyword (e.g. 'race', 'listener', 'closure') get a traversal bonus alongside
                // semantic embedding scores. No-op when session.astRaw is null (first call before analyze).
                if (deps.session.astRaw && core.getNodeBoosts) {
                    const _patternMatches = core.matchPatterns(deps.session.astRaw);
                    if (_patternMatches.length > 0) {
                        const _boosts = core.getNodeBoosts(graph.nodes, _patternMatches);
                        for (const [nodeId, boost] of _boosts) {
                            const existing = _semanticScores.get(nodeId) ?? 0;
                            _semanticScores.set(nodeId, Math.max(existing, boost));
                        }
                        if (_boosts.size > 0) {
                            process.stderr.write(`[unravel:pattern] query_graph: ${_boosts.size} node boost(s) from pattern matches merged into routing.\n`);
                        }
                    }
                }

                const rankedFiles = core.queryGraphForFiles(graph, args.symptom, maxResults, _semanticScores);

                // Phase 5c-1: Codex Pre-Briefing.
                // Search .unravel/codex/ for past debugging sessions relevant to
                // this symptom. If found, inject discoveries as pre_briefing so
                // the agent reads 10 lines of prior knowledge instead of opening
                // raw source files.
                const codexResult = await deps.searchCodex(projectRoot, args.symptom);

                const response = {
                    symptom: args.symptom,
                    relevantFiles: rankedFiles,
                    fileCount: rankedFiles.length,
                    graphFreshness,
                    embeddingProvider: deps.describeEmbeddingProvider(),
                    suggestion: rankedFiles.length > 0
                        ? `Read these ${rankedFiles.length} files and pass them to 'analyze' along with the symptom.`
                        : 'No relevant files found. The symptom may not match any indexed code. Try a different description or build_map with more files.',
                };

                // Inject pre_briefing ONLY if matching codex entries exist
                if (codexResult.matches.length > 0) {
                    response.pre_briefing = {
                        note: 'Prior debugging sessions matched this symptom. Read these discoveries BEFORE opening any files -> they may contain key insights that save investigation time.',
                        entries: codexResult.matches.map(m => ({
                            codex: `codex-${m.taskId}`,
                            problem: m.problem,
                            relevance_score: m.relevance_score ?? m.score,
                            discoveries: m.discoveries,
                        })),
                    };
                    response.suggestion = `FAST PRE-BRIEFING: ${codexResult.matches.length} past session(s) matched this symptom -> read the pre_briefing first. Then read the ${rankedFiles.length} files and pass them to 'analyze'.`;
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
}
