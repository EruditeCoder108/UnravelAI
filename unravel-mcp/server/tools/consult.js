import { z } from 'zod';

export function registerConsultTool(server, { loadCoreModules }) {
    server.tool(
        'consult',
        'Ask anything about your project - architecture, data flow, feature feasibility, impact analysis, or understanding any part of the codebase. Consult fires every memory layer simultaneously: Knowledge Graph (semantic routing), AST analysis (mutation chains, closures, async), cross-file call graph, Task Codex (past discoveries), Diagnosis Archive (past verified fixes), Pattern Store. Returns a structured evidence packet with synthesis instructions. FIRST-TIME USE: Requires GEMINI_API_KEY (free) in MCP env config. If no KG exists, auto-builds one on first call (~15-30s, one-time). If key is absent, returns SETUP_REQUIRED with guided instructions.',
        {
            query:     z.string().describe('Your question about the project - architecture, data flow, feasibility, impact, or any module.'),
            directory: z.string().optional().describe('Project root. Required on first call if no prior build_map. Omit to use directory from last build_map.'),
            maxFiles:  z.number().optional().describe('Max files to analyze after KG routing (default: 12). Increase for broad architectural questions. Ignored if include is provided.'),
            include:   z.array(z.string()).optional().describe('Paths or folders to analyze (e.g. ["src/core", "src/App.jsx"]). If provided, bypasses KG semantic routing and analyzes these files directly. Combine with exclude to refine further. Takes precedence over maxFiles.'),
            detail:    z.enum(['standard', 'full']).optional().describe("'standard' (default): high-signal AST. 'full': complete unfiltered AST."),
            exclude:   z.array(z.string()).optional().describe('Paths or folder names to exclude when auto-building the KG (e.g. ["validation", "cognium"]). Ignored if a KG already exists on disk.'),
        },
        async () => {
            try {
                await loadCoreModules();
                return {
                    content: [{
                        type: 'text',
                        text: JSON.stringify({
                            status: 'TEMPORARILY_PAUSED',
                            tool: 'consult',
                            message: 'consult is temporarily paused while we improve output quality and reduce noise in the Scholar Model response format. The tool works; it is intentionally frozen during the rework.',
                            what_consult_does: 'consult is Unravel project oracle: it answers architecture, data-flow, and feasibility questions by combining Knowledge Graph routing, AST analysis, cross-file call graph, Task Codex, Diagnosis Archive, and Pattern Store evidence.',
                            alternatives: [
                                'Use build_map to index your project, then query_graph to find relevant files for a symptom.',
                                'Use analyze to get deterministic AST evidence for a specific bug.',
                                'Use verify to cross-check your diagnosis against real code.',
                            ],
                            eta: 'coming back soon in v3.5.0',
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

