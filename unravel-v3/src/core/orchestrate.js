// ═══════════════════════════════════════════════════
// UNRAVEL v3 — Orchestrator
// The full analysis pipeline as a single async function.
// Used by both the web app and VS Code extension.
// ═══════════════════════════════════════════════════

import { buildSystemPrompt } from './config.js';
import { runFullAnalysis } from './ast-engine.js';
import { parseAIJson } from './parse-json.js';
import { callProvider } from './provider.js';

/**
 * Run the full Unravel analysis pipeline.
 *
 * @param {Array<{name: string, content: string}>} codeFiles - Files to analyze
 * @param {string} symptom - User's bug description
 * @param {Object} options
 * @param {string} options.provider       - 'anthropic' | 'google' | 'openai'
 * @param {string} options.apiKey         - API key
 * @param {string} options.model          - Model ID
 * @param {string} [options.level]        - User coding level (default: 'intermediate')
 * @param {string} [options.language]     - Output language (default: 'english')
 * @param {string} [options.projectContext] - Optional project context string
 * @param {function} [options.onProgress] - Progress callback: (stage: string) => void
 * @param {function} [options.onMissingFiles] - Missing files callback: (request) => Promise<Array|null>
 * @returns {Promise<Object>} - The parsed analysis result { needsMoreInfo, report, ... }
 */
export async function orchestrate(codeFiles, symptom, options = {}) {
    const {
        provider,
        apiKey,
        model,
        level = 'intermediate',
        language = 'english',
        projectContext = '',
        onProgress,
        onMissingFiles,
    } = options;

    if (!provider || !apiKey || !model) {
        throw new Error('Missing required options: provider, apiKey, model');
    }

    // ── Phase 1: AST Pre-Analysis ──
    onProgress?.('AST ANALYZER: Extracting variable mutations, closures, timing nodes...');
    const jsFiles = codeFiles.filter(f => /\.(js|jsx|ts|tsx)$/i.test(f.name));
    let astContext = '';
    if (jsFiles.length > 0) {
        const combinedCode = jsFiles.map(f => f.content).join('\n\n');
        try {
            const analysis = runFullAnalysis(combinedCode);
            astContext = analysis.formatted;
            console.log('[AST] Verified context extracted:', astContext);
        } catch (astErr) {
            console.warn('[AST] Analysis failed, proceeding without:', astErr.message);
        }
    }

    // ── Phase 2: Build Prompts ──
    onProgress?.('DEEP ENGINE: Reconstructing execution timeline and state invariants...');
    const systemPrompt = buildSystemPrompt(level, language, provider);
    const astBlock = astContext ? `${astContext}\n\n` : '';
    const enginePrompt = `${astBlock}${projectContext}\n\nFILES PROVIDED:\n${codeFiles.map(f => `=== FILE: ${f.name} ===\n${f.content.slice(0, 8000)}`).join('\n\n')}\n\nUSER'S BUG REPORT:\n${symptom || 'No specific error described. Analyze for any issues.'}`;

    // ── Phase 3: Call AI ──
    const raw = await callProvider({
        provider,
        apiKey,
        model,
        systemPrompt,
        userPrompt: enginePrompt,
        useSchema: true,
    });


    const result = parseAIJson(raw);
    if (!result) throw new Error('Engine failed to produce structured output. Try again.');

    // ── Phase 4: Handle missing files or return ──
    if (result.needsMoreInfo && result.missingFilesRequest && onMissingFiles) {
        const additionalFiles = await onMissingFiles(result.missingFilesRequest);
        if (additionalFiles && additionalFiles.length > 0) {
            // Recursive call with the additional files appended
            return orchestrate([...codeFiles, ...additionalFiles], symptom, options);
        }
    }

    return result;
}
