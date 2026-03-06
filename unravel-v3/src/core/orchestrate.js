// ═══════════════════════════════════════════════════
// UNRAVEL v3 — Orchestrator
// The full analysis pipeline as a single async function.
// Used by both the web app and VS Code extension.
// ═══════════════════════════════════════════════════

import { buildSystemPrompt } from './config.js';
import { runMultiFileAnalysis } from './ast-engine.js';
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
        _depth = 0,
    } = options;

    if (!provider || !apiKey || !model) {
        throw new Error('Missing required options: provider, apiKey, model');
    }

    // ── Phase 0: Input Completeness Check ──
    const contextWarnings = checkFileCompleteness(codeFiles);
    if (contextWarnings.length > 0) {
        console.warn('[INPUT] Completeness warnings:', contextWarnings);
        onProgress?.('⚠️ INPUT WARNING: Some files may be incomplete. Proceeding with reduced confidence...');
    }

    // ── Phase 1: AST Pre-Analysis ──
    onProgress?.('AST ANALYZER: Extracting variable mutations, closures, timing nodes...');
    const jsFiles = codeFiles.filter(f => /\.(js|jsx|ts|tsx)$/i.test(f.name));
    let astContext = '';
    if (jsFiles.length > 0) {
        try {
            const analysis = runMultiFileAnalysis(jsFiles);
            astContext = analysis.formatted;
            console.log('[AST] Verified context extracted:', astContext);
        } catch (astErr) {
            console.warn('[AST] Analysis failed, proceeding without:', astErr.message);
        }
    }

    // Prepend input warnings to AST context so the model sees them
    if (contextWarnings.length > 0) {
        const warningBlock = '⚠️ INPUT COMPLETENESS WARNING\n'
            + contextWarnings.map(w => `  - ${w}`).join('\n')
            + '\nSome files may be truncated. Do NOT make assertions about missing elements '
            + 'if the file appears incomplete. Flag any such claims as UNCERTAIN.\n\n';
        astContext = warningBlock + astContext;
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

    // ── Phase 3: Parse Response ──
    // raw might be a string (most cases) or already an object (Gemini structured output)
    let result;
    if (raw && typeof raw === 'object') {
        // Already parsed — Gemini responseSchema can return pre-structured objects
        result = raw;
    } else {
        result = parseAIJson(raw);
    }

    // If parse failed, retry WITHOUT schema constraint (gives model more freedom)
    if (!result) {
        console.warn('[Engine] Structured output parse failed. Retrying without schema constraint...');
        onProgress?.('RETRYING: Model response was malformed, retrying with relaxed constraints...');

        const retryRaw = await callProvider({
            provider,
            apiKey,
            model,
            systemPrompt,
            userPrompt: enginePrompt + '\n\nCRITICAL: You MUST respond with valid JSON only. No markdown fences, no explanation text. Just the raw JSON object.',
            useSchema: false,
        });

        if (retryRaw && typeof retryRaw === 'object') {
            result = retryRaw;
        } else {
            result = parseAIJson(retryRaw);
        }
    }

    if (!result) throw new Error('Engine failed to produce structured output after retry. The model may be overloaded — try again or use a different model.');

    // ── Phase 4: Handle missing files or return ──
    if (result.needsMoreInfo && result.missingFilesRequest && onMissingFiles && _depth < 2) {
        onProgress?.(`SELF-HEAL: Engine requesting additional files (attempt ${_depth + 1}/2)...`);
        const additionalFiles = await onMissingFiles(result.missingFilesRequest);
        if (additionalFiles && additionalFiles.length > 0) {
            // Recursive call with the additional files appended
            return orchestrate([...codeFiles, ...additionalFiles], symptom, { ...options, _depth: _depth + 1 });
        }
    } else if (result.needsMoreInfo && _depth >= 2) {
        console.warn('[Engine] Max self-heal depth (2) reached, proceeding with available files.');
        onProgress?.('⚠️ Max file-fetch attempts reached. Analyzing with available context...');
        // If the LLM only returned needsMoreInfo with no report after max retries,
        // clear the flag so App.jsx doesn't silently swallow it
        if (!result.report && !result.bugType) {
            result.needsMoreInfo = false;
            // Let App.jsx throw "Unexpected engine response" so user sees an error
        }
    }

    // Attach context warnings to result so UI can show a top-level banner
    if (contextWarnings.length > 0) {
        result.contextWarnings = contextWarnings;
    }

    return result;
}

// ═══════════════════════════════════════════════════
// Input Completeness Check
// Detects truncated files before the pipeline reasons from them
// ═══════════════════════════════════════════════════

function checkFileCompleteness(codeFiles) {
    const warnings = [];
    for (const file of codeFiles) {
        const content = file.content?.trim();
        if (!content) continue;

        // HTML: missing closing tags or suspiciously small
        if (/\.html?$/i.test(file.name)) {
            if (content.length < 50) {
                warnings.push(`${file.name} is only ${content.length} bytes — likely truncated`);
            } else if (!content.includes('</html>') && !content.includes('</body>')) {
                warnings.push(`${file.name} may be truncated (missing </html> or </body>)`);
            }
        }

        // JS/TS: unbalanced braces
        if (/\.(js|jsx|ts|tsx)$/i.test(file.name)) {
            const opens = (content.match(/{/g) || []).length;
            const closes = (content.match(/}/g) || []).length;
            if (opens > closes + 2) {
                warnings.push(`${file.name} may be truncated (${opens - closes} unclosed braces)`);
            }
        }

        // CSS: unbalanced braces
        if (/\.css$/i.test(file.name)) {
            const opens = (content.match(/{/g) || []).length;
            const closes = (content.match(/}/g) || []).length;
            if (opens > closes + 2) {
                warnings.push(`${file.name} may be truncated (${opens - closes} unclosed braces)`);
            }
        }
    }
    return warnings;
}
