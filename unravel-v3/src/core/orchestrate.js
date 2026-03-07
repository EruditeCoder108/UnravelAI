// ═══════════════════════════════════════════════════
// UNRAVEL v3 — Orchestrator
// The full analysis pipeline as a single async function.
// Used by both the web app and VS Code extension.
// ═══════════════════════════════════════════════════

import {
    buildDebugPrompt, buildExplainPrompt, buildSecurityPrompt,
    ENGINE_SCHEMA, ENGINE_SCHEMA_INSTRUCTION,
    EXPLAIN_SCHEMA, EXPLAIN_SCHEMA_INSTRUCTION,
    SECURITY_SCHEMA, SECURITY_SCHEMA_INSTRUCTION,
    PRESETS,
    buildDynamicSchema, buildDynamicSchemaInstruction,
} from './config.js';
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
 * @param {string} [options.mode]         - 'debug' | 'explain' | 'security' (default: 'debug')
 * @param {string} [options.preset]       - 'quick' | 'developer' | 'full' | 'custom' (default: 'full')
 * @param {Array}  [options.outputSections] - Array of section keys (overrides preset)
 * @param {function} [options.onProgress] - Progress callback: (msg: string | object) => void
 * @param {function} [options.onMissingFiles] - Missing files callback: (request) => Promise<Array|null>
 * @returns {Promise<Object>} - The parsed analysis result
 */
export async function orchestrate(codeFiles, symptom, options = {}) {
    const {
        provider,
        apiKey,
        model,
        level = 'intermediate',
        language = 'english',
        projectContext = '',
        mode = 'debug',
        preset = 'full',
        outputSections = null,
        onProgress,
        onMissingFiles,
        _depth = 0,
    } = options;

    // Resolve which sections to request for debug mode
    const sections = outputSections || PRESETS[preset]?.sections || PRESETS.full.sections;

    if (!provider || !apiKey || !model) {
        throw new Error('Missing required options: provider, apiKey, model');
    }

    const startTime = Date.now();
    const elapsed = () => ((Date.now() - startTime) / 1000).toFixed(1);

    // ── Phase 0: Input Completeness Check ──
    onProgress?.({ stage: 'input', label: 'Input Validation', complete: true, elapsed: 0 });
    const contextWarnings = checkFileCompleteness(codeFiles);
    if (contextWarnings.length > 0) {
        console.warn('[INPUT] Completeness warnings:', contextWarnings);
        onProgress?.('⚠️ INPUT WARNING: Some files may be incomplete. Proceeding with reduced confidence...');
    }

    // ── Phase 1: AST Pre-Analysis ──
    onProgress?.('AST ANALYZER: Extracting verified ground truth from code...');
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
    onProgress?.({ stage: 'ast', label: 'AST Pre-Analysis', complete: true, elapsed: elapsed() });

    // Prepend input warnings to AST context so the model sees them
    if (contextWarnings.length > 0) {
        const warningBlock = '⚠️ INPUT COMPLETENESS WARNING\n'
            + contextWarnings.map(w => `  - ${w}`).join('\n')
            + '\nSome files may be truncated. Do NOT make assertions about missing elements '
            + 'if the file appears incomplete. Flag any such claims as UNCERTAIN.\n\n';
        astContext = warningBlock + astContext;
    }

    // Frame AST as verified ground truth (not a checklist)
    const astBlock = astContext
        ? `VERIFIED GROUND TRUTH — confirmed by static analysis\nThe following facts about this code are certain. Use them as evidence when reasoning. Do not contradict them.\n\n${astContext}\n\n`
        : '';

    // ── Phase 2: Build Prompts (mode-specific) ──
    onProgress?.('DEEP ENGINE: Building analysis pipeline...');
    onProgress?.({ stage: 'engine', label: `AI Engine (${mode} mode)`, complete: false, elapsed: elapsed() });

    let systemPrompt, schemaInstruction, responseSchema;

    if (mode === 'explain') {
        systemPrompt = buildExplainPrompt(level, language, provider);
        schemaInstruction = EXPLAIN_SCHEMA_INSTRUCTION;
        responseSchema = EXPLAIN_SCHEMA;
    } else if (mode === 'security') {
        systemPrompt = buildSecurityPrompt(level, language, provider);
        schemaInstruction = SECURITY_SCHEMA_INSTRUCTION;
        responseSchema = SECURITY_SCHEMA;
    } else {
        // Debug mode — use dynamic schema based on selected sections
        systemPrompt = buildDebugPrompt(level, language, provider);
        const allSections = PRESETS.full.sections.filter(s => s !== 'architecture' && s !== 'vulnerabilities');
        const isFullSchema = sections.length >= allSections.length;
        schemaInstruction = isFullSchema ? ENGINE_SCHEMA_INSTRUCTION : buildDynamicSchemaInstruction(sections);
        responseSchema = isFullSchema ? ENGINE_SCHEMA : buildDynamicSchema(sections);
    }

    // Build the user-facing prompt with symptom context
    const symptomLabel = mode === 'debug' ? "USER'S BUG REPORT" : mode === 'explain' ? "USER'S QUESTION" : "USER'S SECURITY CONCERN";
    const symptomDefault = mode === 'debug'
        ? 'No specific error described. Analyze for any issues.'
        : mode === 'explain'
            ? 'Explain what this code does and how it works.'
            : 'Analyze this code for security vulnerabilities.';

    const enginePrompt = `${astBlock}${projectContext}\n\nFILES PROVIDED:\n${codeFiles.map(f => `=== FILE: ${f.name} ===\n${f.content.slice(0, 8000)}`).join('\n\n')}\n\n${symptomLabel}:\n${symptom || symptomDefault}${schemaInstruction}`;

    // ── Phase 3: Call AI ──
    const raw = await callProvider({
        provider,
        apiKey,
        model,
        systemPrompt,
        userPrompt: enginePrompt,
        useSchema: true,
        responseSchema,
    });

    onProgress?.({ stage: 'parse', label: 'Parse Response', complete: false, elapsed: elapsed() });

    // ── Phase 4: Parse Response ──
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

    onProgress?.({ stage: 'parse', label: 'Parse Response', complete: true, elapsed: elapsed() });
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

    // Attach context warnings and mode to result so UI can show a top-level banner
    if (contextWarnings.length > 0) {
        result.contextWarnings = contextWarnings;
    }
    result._mode = mode;
    result._sections = sections;
    result._provenance = {
        engineVersion: '3.2',
        astVersion: '2.1',
        routerStrategy: 'llm-heuristic', // becomes 'graph-frontier' in Phase 4B
        model: options.model || 'unknown',
        provider: options.provider || 'unknown',
        timestamp: new Date().toISOString(),
    };

    onProgress?.({ stage: 'complete', label: 'Analysis Complete', complete: true, elapsed: elapsed() });
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
