// ═══════════════════════════════════════════════════════════════
// llm-analyzer.js — LLM Prompt Builders + Response Parsers
// Used by the indexer to get per-file summaries, tags, complexity.
// Wired to Unravel's existing callProvider() — no new API dependencies.
// ═══════════════════════════════════════════════════════════════

'use strict';

/**
 * Build the per-file analysis prompt.
 * Returns a string to send to callProvider().
 *
 * @param {string} filePath
 * @param {string} content
 * @param {string} projectContext — brief project description for context
 * @returns {string}
 */
function buildFileAnalysisPrompt(filePath, content, projectContext) {
    // Truncate very large files to avoid hitting context limits
    const truncated = content.length > 12000 ? content.slice(0, 12000) + '\n... [truncated]' : content;
    return `You are a code analysis assistant. Analyze the following source file and return a JSON object.

Project context: ${projectContext || 'Unknown project'}

File: ${filePath}

\`\`\`
${truncated}
\`\`\`

Return a JSON object with ONLY these fields:
- "fileSummary": A concise summary of what this file does (1-2 sentences).
- "tags": An array of 3-6 relevant tags (e.g., ["utility", "async", "api", "auth"]).
- "complexity": Exactly one of "simple", "moderate", or "complex".
- "functionSummaries": An object mapping function names to 1-sentence summaries. Only include functions visible in the snippet.
- "classSummaries": An object mapping class names to 1-sentence summaries.
- "languageNotes": Optional. A single sentence about language-specific patterns used (or omit the key entirely).

Respond ONLY with the JSON object, no markdown, no extra text.`;
}

/**
 * Build the project-level summary prompt.
 * Used once per indexing run to get description, frameworks, and layers.
 *
 * @param {string[]} fileList
 * @param {Array<{path: string, content: string}>} sampleFiles — up to 5 representative files
 * @returns {string}
 */
function buildProjectSummaryPrompt(fileList, sampleFiles) {
    const fileListStr = fileList.map(f => `  - ${f}`).join('\n');
    let samplesStr = '';
    if (sampleFiles && sampleFiles.length > 0) {
        samplesStr = '\n\nSample files:\n';
        for (const sample of sampleFiles) {
            const truncated = sample.content.length > 3000 ? sample.content.slice(0, 3000) + '\n...' : sample.content;
            samplesStr += `\n--- ${sample.path} ---\n\`\`\`\n${truncated}\n\`\`\`\n`;
        }
    }

    return `You are a code analysis assistant. Analyze the following project structure and return a JSON object describing the project.

File list:
${fileListStr}${samplesStr}

Return a JSON object with ONLY these fields:
- "description": A concise description of what this project does (2-3 sentences).
- "frameworks": An array of frameworks and major libraries detected (e.g., ["React", "Express", "Vitest"]).
- "layers": An array of 3-7 logical layers, each with:
  - "name": The layer name (e.g., "API", "Data", "UI")
  - "description": What this layer is responsible for (1 sentence)
  - "filePatterns": Array of path prefixes or glob patterns belonging to this layer

Respond ONLY with the JSON object, no markdown, no extra text.`;
}

// ── Response parsers ──────────────────────────────────────────────────────────

function _extractJson(response) {
    if (!response) return null;
    // Try markdown code fence first
    const fenceMatch = response.match(/```(?:json)?\s*\n?([\s\S]*?)\n?\s*```/);
    if (fenceMatch) return fenceMatch[1].trim();
    // Try raw JSON object
    const objMatch = response.match(/\{[\s\S]*\}/);
    if (objMatch) return objMatch[0].trim();
    return response.trim();
}

const VALID_COMPLEXITIES = new Set(['simple', 'moderate', 'complex']);

/**
 * Parse LLM response for file analysis.
 * Returns a normalized object or null on failure.
 *
 * @param {string} response
 * @returns {{ fileSummary, tags, complexity, functionSummaries, classSummaries, languageNotes } | null}
 */
function parseFileAnalysisResponse(response) {
    try {
        const jsonStr = _extractJson(response);
        if (!jsonStr) return null;
        const parsed = JSON.parse(jsonStr);

        let complexity = 'moderate';
        if (typeof parsed.complexity === 'string' && VALID_COMPLEXITIES.has(parsed.complexity)) {
            complexity = parsed.complexity;
        }

        return {
            fileSummary: typeof parsed.fileSummary === 'string' ? parsed.fileSummary : '',
            tags: Array.isArray(parsed.tags) ? parsed.tags.filter(t => typeof t === 'string') : [],
            complexity,
            functionSummaries: (typeof parsed.functionSummaries === 'object' && parsed.functionSummaries) ? parsed.functionSummaries : {},
            classSummaries: (typeof parsed.classSummaries === 'object' && parsed.classSummaries) ? parsed.classSummaries : {},
            languageNotes: typeof parsed.languageNotes === 'string' ? parsed.languageNotes : undefined,
        };
    } catch {
        return null;
    }
}

/**
 * Parse LLM response for project summary.
 * Returns a normalized object or null on failure.
 */
function parseProjectSummaryResponse(response) {
    try {
        const jsonStr = _extractJson(response);
        if (!jsonStr) return null;
        const parsed = JSON.parse(jsonStr);

        return {
            description: typeof parsed.description === 'string' ? parsed.description : '',
            frameworks: Array.isArray(parsed.frameworks) ? parsed.frameworks.filter(f => typeof f === 'string') : [],
            layers: Array.isArray(parsed.layers)
                ? parsed.layers
                    .filter(l => l && typeof l.name === 'string')
                    .map(l => ({
                        name: l.name,
                        description: typeof l.description === 'string' ? l.description : '',
                        filePatterns: Array.isArray(l.filePatterns) ? l.filePatterns.filter(p => typeof p === 'string') : [],
                    }))
                : [],
        };
    } catch {
        return null;
    }
}

module.exports = {
    buildFileAnalysisPrompt,
    buildProjectSummaryPrompt,
    parseFileAnalysisResponse,
    parseProjectSummaryResponse,
};
