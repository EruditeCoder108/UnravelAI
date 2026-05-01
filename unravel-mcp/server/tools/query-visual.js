import { resolve } from 'path';
import { z } from 'zod';

export function registerQueryVisualTool(server, deps) {
    server.tool(
        'query_visual',
        `Find source files relevant to a visual bug report (screenshot, diagram, or UI artifact).

Embeds the image using Gemini Embedding 2 Preview's cross-modal vector space -> where images and
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
                const visualProvider = deps.ensureGeminiVisualAvailable();
                if (!visualProvider.ok) {
                    return {
                        content: [{ type: 'text', text: JSON.stringify({
                            error: visualProvider.error,
                            hint: visualProvider.hint,
                            embeddingProvider: deps.describeEmbeddingProvider(),
                        }, null, 2) }],
                        isError: true,
                    };
                }
                const apiKey = visualProvider.apiKey;

                let graph = deps.session.graph;
                const projectRoot = args.directory ? resolve(args.directory) : deps.session.projectRoot;
                if (args.directory && projectRoot !== deps.session.projectRoot) {
                    graph = null;
                    deps.session.projectRoot = projectRoot;
                }
                if (!graph && projectRoot) {
                    graph = deps.loadGraph(projectRoot);
                    if (graph) deps.session.graph = graph;
                }

                if (!graph?.nodes?.length) {
                    return {
                        content: [{ type: 'text', text: JSON.stringify({
                            error: 'No Knowledge Graph found. Run build_map first.',
                            hint: 'build_map with GEMINI_API_KEY set will embed KG nodes so query_visual can search them.',
                            embeddingProvider: deps.describeEmbeddingProvider(),
                        }, null, 2) }],
                        isError: true,
                    };
                }

                const embeddedNodes = graph.nodes.filter(n => n.embedding?.length > 0);
                if (embeddedNodes.length === 0) {
                    return {
                        content: [{ type: 'text', text: JSON.stringify({
                            error: 'KG has no embedded nodes. Run build_map with GEMINI_API_KEY set to enable semantic search.',
                            hint: `Found ${graph.nodes.length} structural nodes but 0 embeddings. Delete .unravel/knowledge.json and rebuild.`,
                            embeddingProvider: deps.describeEmbeddingProvider(),
                        }, null, 2) }],
                        isError: true,
                    };
                }

                const maxResults = args.maxResults || 10;
                const startMs = Date.now();

                process.stderr.write('[unravel:visual] Embedding image...\n');
                const imageVec = await deps.embedImage(args.image, apiKey);
                if (!imageVec) {
                    return {
                        content: [{ type: 'text', text: JSON.stringify({
                            error: 'Failed to embed image. Check that the image is a valid PNG/JPEG/WebP/GIF and the API key is valid.',
                        }, null, 2) }],
                        isError: true,
                    };
                }

                let queryVec = imageVec;
                if (args.symptom?.trim()) {
                    process.stderr.write('[unravel:visual] Fusing with symptom text embedding...\n');
                    const textVec = await deps.embedText(args.symptom, apiKey, 'RETRIEVAL_QUERY');
                    queryVec = deps.fuseEmbeddings(imageVec, textVec, 0.6);
                }

                const scored = [];
                for (const node of embeddedNodes) {
                    const sim = deps.cosineSimilarity(queryVec, node.embedding);
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

                process.stderr.write(`[unravel:visual] Ranked ${embeddedNodes.length} nodes -> top ${uniqueFiles.length} files in ${Date.now() - startMs}ms.\n`);

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
}

