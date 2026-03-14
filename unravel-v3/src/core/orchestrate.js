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
    LAYER_BOUNDARY_VERDICT,
} from './config.js';
import { runMultiFileAnalysis, initParser } from './ast-engine-ts.js';
import { runCrossFileAnalysis, selectFilesByGraph } from './ast-project.js';
import { parseAIJson } from './parse-json.js';
import { callProvider, callProviderStreaming } from './provider.js';

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
        onPartialResult,
        onMissingFiles,
        _depth = 0,
        _forceNoAST = false,
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

    // ── Phase 0.5: Graph Router ──
    // When many files are provided, use the import/call graph to select the
    // most relevant ones before AST analysis + LLM call.
    const jsFiles = codeFiles.filter(f => /\.(js|jsx|ts|tsx)$/i.test(f.name));
    let _routerStrategy = 'all-files'; // captured for provenance
    if (!_forceNoAST && jsFiles.length > 15) {
        try {
            onProgress?.('GRAPH ROUTER: Selecting relevant files from import graph...');
            const { selectedFiles, strategy } = await selectFilesByGraph(codeFiles, symptom);
            _routerStrategy = strategy;
            if (strategy !== 'all-files') {
                const before = codeFiles.length;
                // selectedFiles contains short basenames — match by basename, not full path
                const selectedSet = new Set(selectedFiles);
                codeFiles = codeFiles.filter(f => {
                    const base = f.name.split(/[\\/]/).pop();
                    return selectedSet.has(base) || selectedSet.has(f.name);
                });
                console.log(`[GRAPH] Trimmed ${before} → ${codeFiles.length} files via ${strategy}`);
                onProgress?.(`GRAPH ROUTER: Focused on ${codeFiles.length}/${before} most relevant files.`);
            }
        } catch (routerErr) {
            console.warn('[GRAPH] Router failed, using all files:', routerErr.message);
        }
    }

    // ── Phase 1: AST Pre-Analysis ──
    onProgress?.('AST ANALYZER: Extracting verified ground truth from code...');
    const jsFilesForAST = codeFiles.filter(f => /\.(js|jsx|ts|tsx)$/i.test(f.name));
    let astContext = '';
    let astRaw = null; // Preserved for claim verifier
    if (_forceNoAST) {
        console.log('[AST] Skipped — _forceNoAST flag set (baseline run)');
    } else if (jsFilesForAST.length > 0) {
        try {
            await initParser(); // tree-sitter WASM: lazy init, no-op after first call
            const analysis = await runMultiFileAnalysis(jsFilesForAST);
            astContext = analysis.formatted;
            astRaw = analysis.raw; // { mutations, closures, timingNodes }
            console.log('[AST] Verified context extracted:', astContext);
        } catch (astErr) {
            console.warn('[AST] Analysis failed, proceeding without:', astErr.message);
        }
    }
    onProgress?.({ stage: 'ast', label: 'AST Pre-Analysis', complete: true, elapsed: elapsed() });

    // ── Phase 1b: Cross-File AST Resolution ──
    let crossFileRaw = null;
    if (jsFilesForAST.length >= 2 && astRaw) {
        try {
            const crossFile = await runCrossFileAnalysis(jsFilesForAST, astRaw);
            if (crossFile.formatted) {
                astContext += '\n' + crossFile.formatted;
                crossFileRaw = crossFile.raw;
                console.log('[AST] Cross-file context added:', crossFile.formatted);
            }
        } catch (cfErr) {
            console.warn('[AST] Cross-file analysis failed, proceeding without:', cfErr.message);
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

    // ── Phase 2.5: Global Resource Caps ──
    const MAX_FILES = 25;
    const MAX_TOTAL_CHARS = 1_500_000;
    let cappedFiles = codeFiles;
    if (codeFiles.length > MAX_FILES) {
        console.warn(`[Engine] File count ${codeFiles.length} exceeds cap of ${MAX_FILES}, truncating`);
        cappedFiles = codeFiles.slice(0, MAX_FILES);
        contextWarnings.push(`Only the first ${MAX_FILES} files were sent to the model (${codeFiles.length} total). Lower-priority files were excluded.`);
    }
    let totalChars = cappedFiles.reduce((sum, f) => sum + (f.content?.length || 0), 0);
    if (totalChars > MAX_TOTAL_CHARS) {
        console.warn(`[Engine] Total chars ${totalChars} exceeds cap of ${MAX_TOTAL_CHARS}, truncating files`);
        const trimmed = [];
        let running = 0;
        for (const f of cappedFiles) {
            const len = f.content?.length || 0;
            if (running + len <= MAX_TOTAL_CHARS) {
                trimmed.push(f);
                running += len;
            } else {
                // Truncate this file to fit
                const remaining = MAX_TOTAL_CHARS - running;
                if (remaining > 500) {
                    trimmed.push({ ...f, content: f.content.slice(0, remaining) + '\n// ... [TRUNCATED by Unravel: file exceeded context budget]' });
                }
                break;
            }
        }
        cappedFiles = trimmed;
        contextWarnings.push(`Total input was truncated to fit the context budget (${MAX_TOTAL_CHARS} chars).`);
    }

    // Do NOT truncate files here — the totalChars guard above already handled budget.
    // Per-file slice(0, 8000) was silently dropping content even when well within budget.
    const enginePrompt = `${astBlock}${projectContext}\n\nFILES PROVIDED:\n${cappedFiles.map(f => `=== FILE: ${f.name} ===\n${f.content}`).join('\n\n')}\n\n${symptomLabel}:\n${symptom || symptomDefault}${schemaInstruction}`;

    // ── Phase 3: Call AI (streaming when onPartialResult provided) ──
    const SAFE_STREAM_FIELDS = ['rootCause', 'evidence', 'fix', 'minimalFix', 'bugType', 'confidence', 'symptom', 'codeLocation', 'whyFixWorks', 'variableState', 'timeline', 'conceptExtraction', 'hypotheses', 'reproduction', 'aiPrompt', 'timelineEdges', 'hypothesisTree', 'variableStateEdges'];

    let raw;
    if (onPartialResult) {
        // Streaming mode: progressive JSON repair
        let streamBuffer = '';
        let chunkCounter = 0;
        let lastHash = '';

        raw = await callProviderStreaming({
            provider,
            apiKey,
            model,
            systemPrompt,
            userPrompt: enginePrompt,
            useSchema: true,
            responseSchema,
            onChunk: (textDelta) => {
                streamBuffer += textDelta;
                chunkCounter++;

                // Parse when } appears or every 5 chunks
                const shouldParse = textDelta.includes('}') || chunkCounter % 5 === 0;
                if (!shouldParse) return;

                try {
                    const partial = parseAIJson(streamBuffer, true /* isStreaming — suppress noise */);
                    if (!partial) return;

                    // Dedup: only emit when content actually changes
                    const hash = JSON.stringify(partial);
                    if (hash === lastHash) return;
                    lastHash = hash;

                    // Filter to safe-to-stream fields only
                    const safePartial = {};
                    for (const key of SAFE_STREAM_FIELDS) {
                        if (partial[key] !== undefined) safePartial[key] = partial[key];
                    }
                    // Also include nested report fields
                    if (partial.report) {
                        const safeReport = {};
                        for (const key of SAFE_STREAM_FIELDS) {
                            if (partial.report[key] !== undefined) safeReport[key] = partial.report[key];
                        }
                        if (Object.keys(safeReport).length > 0) safePartial.report = safeReport;
                    }

                    if (Object.keys(safePartial).length > 0) {
                        safePartial._streaming = true;
                        onPartialResult(safePartial);
                    }
                } catch {
                    // Parse failure during streaming is expected — buffer is still incomplete
                }
            },
        });
    } else {
        // Non-streaming mode: original behavior
        raw = await callProvider({
            provider,
            apiKey,
            model,
            systemPrompt,
            userPrompt: enginePrompt,
            useSchema: true,
            responseSchema,
        });
    }

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

    // ── Phase 5: Claim Verification ──
    onProgress?.({ stage: 'verify', label: 'Verifying Claims', complete: false, elapsed: elapsed() });
    const verification = verifyClaims(result, codeFiles, astRaw, crossFileRaw, mode);
    if (verification.failures.length > 0) {
        result._verification = verification;
        console.warn('[Verify] Claim failures:', verification.failures);
    }
    // Hard reject: if rootCause evidence is fabricated, reject the analysis
    if (verification.rootCauseRejected) {
        console.warn('[Verify] Root cause evidence fabricated — hard rejecting');
        result.needsMoreInfo = true;
        result._verificationRejected = true;
        result._rejectionReason = 'Root cause references code that does not exist in provided files.';
    }
    // Security mode: enforce confidence → severity mapping
    if (mode === 'security' && result.vulnerabilities && Array.isArray(result.vulnerabilities)) {
        for (const vuln of result.vulnerabilities) {
            if (typeof vuln.confidence === 'number' && vuln.confidence < 0.7) {
                if (vuln.severity && vuln.severity !== 'INFORMATIONAL') {
                    vuln._originalSeverity = vuln.severity;
                    vuln.severity = 'INFORMATIONAL';
                    vuln.requiresHumanVerification = true;
                }
            }
        }
    }
    onProgress?.({ stage: 'verify', label: 'Verifying Claims', complete: true, elapsed: elapsed() });

    // ── Phase 5.5: Solvability Check ──
    // Runs after claim verification so we have verification.failures available.
    // If the bug is upstream of all provided files, skip the fix and return
    // a LAYER_BOUNDARY verdict instead. This prevents the engine from generating
    // a patch that would be wrong by construction (information already lost upstream).
    if (mode === 'debug' && !result.needsMoreInfo) {
        const solvability = checkSolvability(result, verification, codeFiles, symptom);
        if (solvability.isLayerBoundary) {
            console.warn('[Solvability] LAYER_BOUNDARY detected:', solvability.reason);
            // Telemetry — log enough to tune heuristics, no PII
            console.log('[Telemetry] LAYER_BOUNDARY', {
                confidence: solvability.confidence,
                rootCauseLayer: solvability.rootCauseLayer,
                model: options.model || 'unknown',
                provider: options.provider || 'unknown',
                fileCount: codeFiles.length,
            });
            onProgress?.({ stage: 'complete', label: 'Analysis Complete', complete: true, elapsed: elapsed() });
            return {
                verdict: LAYER_BOUNDARY_VERDICT,
                schemaVersion: '1.0',
                confidence: solvability.confidence,
                rootCauseLayer: solvability.rootCauseLayer,
                reason: solvability.reason,
                suggestedFixLayer: solvability.suggestedFixLayer,
                symptom: result.report?.symptom || result.symptom || symptom,
                _mode: mode,
                _provenance: {
                    engineVersion: '3.3',
                    astVersion: '2.2',
                    routerStrategy: _routerStrategy,
                    crossFileAnalysis: !!crossFileRaw,
                    model: options.model || 'unknown',
                    provider: options.provider || 'unknown',
                    timestamp: new Date().toISOString(),
                },
            };
        }
    }

    // ── Phase 6: Handle missing files or return ──
    if (result.needsMoreInfo && result.missingFilesRequest && onMissingFiles && _depth < 2) {
        onProgress?.(`SELF-HEAL: Engine requesting additional files (attempt ${_depth + 1}/2)...`);
        const additionalFiles = await onMissingFiles(result.missingFilesRequest);
        if (additionalFiles && additionalFiles.length > 0) {
            // Recursive call with the additional files appended
            return orchestrate([...codeFiles, ...additionalFiles], symptom, { ...options, _depth: _depth + 1 });
        }
    } else if (result.needsMoreInfo && !result._verificationRejected && _depth >= 2) {
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
        engineVersion: '3.3',
        astVersion: '2.2',
        routerStrategy: _routerStrategy,        // actual strategy from selectFilesByGraph
        crossFileAnalysis: !!crossFileRaw,       // whether cross-file AST ran
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

// ═══════════════════════════════════════════════════
// Solvability Check — Layer Boundary Detection
// Determines if a bug is unfixable from within the
// provided codebase (root cause is upstream: OS,
// browser event system, native layer, etc.)
//
// Trigger conditions (ALL must be met):
//   1. PRIMARY (deterministic): verifyClaims produced
//      zero successful file citations — meaning the
//      rootCause text referenced no line/file from the
//      provided inputs that passed verification.
//      This is the hard signal. If any provided file is
//      cited in rootCause, this check does NOT fire.
//
//   2. SECONDARY (heuristic): evidence/rootCause/symptom
//      text contains keywords indicating an external
//      system layer. Required to avoid mis-classifying
//      cross-file bugs that just lack file citations.
//
// If verifyClaims rejected the rootCause (hallucination),
// that is NOT a layer boundary — it's a bad model output.
// ═══════════════════════════════════════════════════

const UPSTREAM_LAYER_KEYWORDS = [
    // Input / event layer
    'keycode', 'key code', 'keyboard', 'keybinding', 'key event',
    'keyboardevent', 'keyboard layout', 'keyboard mapping', 'scancode',
    'raw event', 'native event', 'os event', 'input event',
    // OS / platform layer
    'operating system', 'os layout', 'os keyboard', 'macos', 'windows',
    'eurkey', 'keyboard driver', 'layout translation',
    // Browser / electron layer
    'browser event', 'electron', 'nativekeymap', 'chromium',
    'web api', 'dom event', 'platform api',
    // Network / external service
    'external api', 'third-party api', 'upstream service',
    'network response', 'server response',
];

/** Fields required in a valid LAYER_BOUNDARY result */
const LAYER_BOUNDARY_REQUIRED_FIELDS = ['verdict', 'confidence', 'rootCauseLayer', 'reason', 'suggestedFixLayer'];

/**
 * Validate a candidate LAYER_BOUNDARY result against required fields and types.
 * Returns true if valid, false if schema is violated.
 */
function _validateLayerBoundaryShape(obj) {
    for (const field of LAYER_BOUNDARY_REQUIRED_FIELDS) {
        if (obj[field] === undefined || obj[field] === null || obj[field] === '') {
            console.warn(`[Solvability] LAYER_BOUNDARY shape invalid: missing field "${field}"`);
            return false;
        }
    }
    if (typeof obj.confidence !== 'number' || obj.confidence < 0 || obj.confidence > 1) {
        console.warn(`[Solvability] LAYER_BOUNDARY shape invalid: confidence must be 0-1 number`);
        return false;
    }
    return true;
}

/**
 * Check if the analysis result represents a bug that cannot be fixed
 * from within the provided codebase.
 *
 * @param {Object} result           - Parsed LLM result
 * @param {Object} verification     - Output of verifyClaims()
 * @param {Array}  codeFiles        - Files provided by user
 * @param {string} symptom          - Original bug description
 * @returns {{isLayerBoundary, confidence, rootCauseLayer, reason, suggestedFixLayer}}
 */
function checkSolvability(result, verification, codeFiles, symptom) {
    const NOT_BOUNDARY = { isLayerBoundary: false };

    const report = result.report || result;
    const rootCause = report.rootCause || '';
    if (!rootCause) return NOT_BOUNDARY;

    // ── Primary gate (deterministic): did rootCause cite any provided file? ──
    //
    // verifyClaims already walks all file references in rootCause.
    // We use its failures to determine if it found ANY provided file cited.
    // Specifically: if rootCauseRejected === true, that's hallucination (not a boundary).
    // If rootCauseRejected === false AND no rootCause failures exist → rootCause cited
    // provided files successfully → fixable here → NOT a boundary.
    //
    // The deterministic signal we want: rootCause has zero file citations from provided inputs.
    // We detect this by: (a) no rootCause-related failures in verification.failures that
    // indicate a provided file was found, AND (b) re-scan rootCause for file patterns.

    // Do not fire if rootCause was rejected (that means hallucination, not layer boundary)
    if (verification.rootCauseRejected) return NOT_BOUNDARY;

    // Re-scan rootCause for references to any provided file
    const fileRefPattern = /\b([\w\-./]+\.(js|jsx|ts|tsx|py|java|cs|cpp|c|go|rb|rs|swift))\b/gi;
    const rootCauseFileRefs = [...rootCause.matchAll(fileRefPattern)].map(m => m[1].toLowerCase());
    const providedFileNames = new Set(
        codeFiles.map(f => f.name.split(/[\\/]/).pop().toLowerCase())
    );
    // If rootCause mentions at least one provided file → fixable in this codebase
    const rootCauseMentionsProvidedFile = rootCauseFileRefs.some(ref =>
        providedFileNames.has(ref) ||
        [...providedFileNames].some(n => n.includes(ref) || ref.includes(n))
    );
    if (rootCauseMentionsProvidedFile) return NOT_BOUNDARY;

    // Also check: do verification failures show that rootCause DID reference provided files
    // (even if those references had issues like wrong line numbers)?
    const rootCauseFailuresWithProvidedFile = (verification.failures || []).some(f =>
        typeof f.claim === 'string' &&
        f.claim.toLowerCase().startsWith('rootcause') &&
        // The failure reason says "line exceeds" (file was found but line was wrong) —
        // that means a provided file WAS referenced, just with a bad line number.
        // This is still "in this codebase" — do NOT classify as layer boundary.
        f.reason && f.reason.includes('line exceeds')
    );
    if (rootCauseFailuresWithProvidedFile) return NOT_BOUNDARY;

    // ── Secondary gate (heuristic): upstream layer keywords in evidence+symptom ──
    const evidenceText = (Array.isArray(report.evidence) ? report.evidence.join(' ') : '').toLowerCase();
    const symptomText = (symptom || '').toLowerCase();
    const fullText = `${rootCause.toLowerCase()} ${evidenceText} ${symptomText}`;
    const matchedKeywords = UPSTREAM_LAYER_KEYWORDS.filter(kw => fullText.includes(kw));

    // Require at least one keyword to avoid false positives on cross-file bugs
    // that simply don't name files in rootCause.
    if (matchedKeywords.length === 0) return NOT_BOUNDARY;

    // ── Classify the upstream layer ──
    const layerClassification = (() => {
        if (matchedKeywords.some(k => ['keycode', 'keyboard', 'keybinding', 'keyboard layout',
            'key event', 'eurkey', 'keyboard driver', 'keyboard mapping', 'layout translation',
            'nativekeymap', 'scancode'].includes(k))) {
            return {
                rootCauseLayer: 'OS / keyboard layout layer',
                suggestedFixLayer: 'OS keyboard layout, browser nativeKeymap layer, or Electron keyboard API',
            };
        }
        if (matchedKeywords.some(k => ['browser event', 'dom event', 'native event', 'web api',
            'chromium', 'electron', 'platform api'].includes(k))) {
            return {
                rootCauseLayer: 'Browser / Electron native event layer',
                suggestedFixLayer: 'Browser API or Electron nativeKeymap',
            };
        }
        if (matchedKeywords.some(k => ['external api', 'third-party api', 'upstream service',
            'network response', 'server response'].includes(k))) {
            return {
                rootCauseLayer: 'Upstream external service / API',
                suggestedFixLayer: 'The external service or API provider',
            };
        }
        if (matchedKeywords.some(k => ['operating system', 'os layout', 'macos',
            'windows', 'os event'].includes(k))) {
            return {
                rootCauseLayer: 'Operating system layer',
                suggestedFixLayer: 'OS-level configuration or a platform abstraction layer',
            };
        }
        return {
            rootCauseLayer: 'Upstream system layer (outside provided codebase)',
            suggestedFixLayer: 'The upstream layer responsible for producing this input',
        };
    })();

    // Confidence: base 0.70, +0.05 per matched keyword (cap 0.95)
    // Boosted by +0.10 if verification found zero evidence of provided files in rootCause
    const citationBoost = rootCauseFileRefs.length === 0 ? 0.10 : 0;
    const confidence = Math.min(0.95, 0.70 + matchedKeywords.length * 0.05 + citationBoost);

    const solvabilityResult = {
        isLayerBoundary: true,
        confidence,
        rootCauseLayer: layerClassification.rootCauseLayer,
        suggestedFixLayer: layerClassification.suggestedFixLayer,
        reason:
            'The buggy input is indistinguishable from valid input at the entry point of the ' +
            'provided code. The root cause originates in ' + layerClassification.rootCauseLayer +
            ' — by the time this code receives the event/data, the distinguishing information ' +
            'has already been lost. No safe fix is possible from within this codebase alone.',
        message: 'This bug is upstream of the provided files; Unravel cannot safely generate a fix.',
    };

    // ── Schema validation before returning ──
    // If the shape is somehow invalid, fall back to needsMoreInfo rather than
    // returning a malformed result that breaks the UI.
    const candidateShape = {
        verdict: LAYER_BOUNDARY_VERDICT,
        confidence: solvabilityResult.confidence,
        rootCauseLayer: solvabilityResult.rootCauseLayer,
        reason: solvabilityResult.reason,
        suggestedFixLayer: solvabilityResult.suggestedFixLayer,
    };
    if (!_validateLayerBoundaryShape(candidateShape)) {
        console.warn('[Solvability] Schema validation failed — falling back to needsMoreInfo');
        return NOT_BOUNDARY;
    }

    return solvabilityResult;
}

// ═══════════════════════════════════════════════════
// Claim Verifier — Trust Layer (Sprint 1)
// Cross-checks model evidence against actual files and AST data.
// Two-tier policy:
//   - Evidence items fail → degrade confidence, flag _verified: false
//   - RootCause fails    → hard reject (needsMoreInfo = true)
// ═══════════════════════════════════════════════════

function verifyClaims(result, codeFiles, astRaw, crossFileRaw, mode) {
    const failures = [];
    let rootCauseRejected = false;
    let confidencePenalty = 0;

    // Build a lookup: filename → lines array (for quick line checks)
    const fileLookup = {};
    for (const f of codeFiles) {
        const shortName = f.name.split(/[\\/]/).pop();
        const fullName = f.name;
        const lines = (f.content || '').split('\n');
        fileLookup[shortName] = { lines, content: f.content || '' };
        fileLookup[fullName] = fileLookup[shortName];
        // Also index without extension for fuzzy matching
        const noExt = shortName.replace(/\.[^.]+$/, '');
        if (!fileLookup[noExt]) fileLookup[noExt] = fileLookup[shortName];
    }

    // Helper: find a file in lookup by partial name
    function findFile(name) {
        if (!name) return null;
        const clean = name.trim();
        if (fileLookup[clean]) return fileLookup[clean];
        // Try short name
        const short = clean.split(/[\\/]/).pop();
        if (fileLookup[short]) return fileLookup[short];
        // Fuzzy: find any key that ends with referenced name
        for (const key of Object.keys(fileLookup)) {
            if (key.endsWith(clean) || clean.endsWith(key)) return fileLookup[key];
        }
        return null;
    }

    // Helper: check if a code fragment appears near a line number (±3 lines)
    function fragmentNearLine(fileData, lineNum, fragment) {
        if (!fileData || !fragment) return true; // Can't verify → pass
        const frag = fragment.trim();
        if (frag.length < 5) return true; // Too short to verify meaningfully
        const start = Math.max(0, lineNum - 4);
        const end = Math.min(fileData.lines.length, lineNum + 3);
        const window = fileData.lines.slice(start, end).join('\n');
        // Normalize whitespace for comparison
        return window.replace(/\s+/g, ' ').includes(frag.replace(/\s+/g, ' '));
    }

    // Helper: extract line numbers from a text string
    function extractLineRefs(text) {
        if (!text) return [];
        const refs = [];
        // Patterns: "line 42", "L42", "line:42", ":42", "at line 42"
        const linePattern = /(?:line\s*[:.]?\s*|[Ll]|:)(\d{1,5})\b/g;
        let m;
        while ((m = linePattern.exec(text)) !== null) {
            const num = parseInt(m[1], 10);
            if (num > 0 && num < 100000) refs.push(num);
        }
        return refs;
    }

    // Helper: extract file references from text
    function extractFileRefs(text) {
        if (!text) return [];
        const refs = [];
        // Pattern: common file extensions
        const filePattern = /[\w\-./\\]+\.(js|jsx|ts|tsx|json|html|css|py|vue|svelte)\b/gi;
        let m;
        while ((m = filePattern.exec(text)) !== null) {
            refs.push(m[0].split(/[\\/]/).pop());
        }
        return [...new Set(refs)];
    }

    // Skip verification for explain mode (no claims about bugs)
    // NOTE: Vague evidence strings without file/line references (e.g. "duration mutated
    // inside pause() — confirmed by AST") pass the verifier silently. This is intentional:
    // the verifier catches *specific wrong claims*, not *vague non-claims*.
    if (mode === 'explain') return { failures, rootCauseRejected, confidencePenalty };

    // === Check 1: Evidence array (debug mode) ===
    // Only checks file references — NOT line numbers.
    // Evidence strings are narrative ("mutation at line 8 of sessionStore.js") and
    // models miscount lines in free text constantly. Checking line numbers here
    // produces false failures on correct analyses. The structured fields (Check 2 codeLocation,
    // Check 3 rootCause) are where line validation belongs.
    const report = result.report || result; // report may be nested or flat
    const evidenceList = report.evidence || result.evidence;
    if (Array.isArray(evidenceList)) {
        for (const e of evidenceList) {
            if (typeof e !== 'string') continue;
            const fileRefs = extractFileRefs(e);
            for (const fileName of fileRefs) {
                const fileData = findFile(fileName);
                if (!fileData) {
                    failures.push({ claim: e, reason: `references file "${fileName}" not in provided inputs` });
                    confidencePenalty += 0.2;
                }
                // Line number check intentionally removed — narrative evidence strings
                // have unreliable line citations. Only codeLocation and rootCause are checked.
            }
        }
    }

    // === Check 2: codeLocation ===
    // Only verifies that referenced files exist — NOT line numbers.
    // codeLocation often contains multiple files with multiple line ranges
    // (e.g. "sessionStore.js L8 & L12, useSessionData.js L9-10 & L32").
    // extractLineRefs pulls ALL numbers from the whole string and checks them
    // against ALL files — which creates false positives when line 32 (from file B)
    // gets checked against file A that only has 20 lines.
    // Line number accuracy in codeLocation is enforced by Check 3 (rootCause) instead.
    const codeLocation = report.codeLocation || result.codeLocation;
    if (codeLocation && typeof codeLocation === 'string') {
        const locFileRefs = extractFileRefs(codeLocation);
        for (const fileName of locFileRefs) {
            const fileData = findFile(fileName);
            if (!fileData) {
                failures.push({ claim: `codeLocation: ${codeLocation}`, reason: `file "${fileName}" not in inputs` });
                confidencePenalty += 0.3;
            }
            // Line number check intentionally omitted — see comment above.
        }
    }

    // === Check 3: rootCause — hard reject ONLY if file is fabricated (nonexistent) ===
    // Line number checking is intentionally removed from rootCause as well.
    // When rootCause references multiple files ("sessionStore.js L8, useSessionData.js L32"),
    // extractLineRefs returns [8, 32] as a flat list with no file association.
    // The verifier then checks line 32 against sessionStore.js (20 lines) → false failure.
    // There is no safe way to pair line numbers to their correct files from a narrative string.
    //
    // The ONLY reliable hallucination signal here is file existence.
    // If a model cites a file that doesn't exist → hard reject (fabrication).
    // If a model miscounts lines in a file that does exist → not fabrication, not rejected.
    const rootCause = report.rootCause || result.rootCause;
    if (rootCause && typeof rootCause === 'string') {
        const rcFileRefs = extractFileRefs(rootCause);
        for (const fileName of rcFileRefs) {
            const fileData = findFile(fileName);
            if (!fileData) {
                // Hard reject: file doesn't exist at all — clear hallucination
                failures.push({ claim: `rootCause: ${rootCause.slice(0, 100)}`, reason: `references nonexistent file "${fileName}"` });
                rootCauseRejected = true;
            }
            // Line number check intentionally omitted — see comment above.
        }
    }

    // === Check 4: variableStateEdges — cross-check with AST ===
    // Uses fuzzy matching: LLM often returns 'task' when AST key is 'task.status'.
    // A match fires if the claimed name equals, starts, or ends with a known AST var.
    // This is a WARNING only — no confidencePenalty, no rootCauseRejected.
    const varEdges = report.variableStateEdges || result.variableStateEdges;
    if (Array.isArray(varEdges) && astRaw?.mutations) {
        const knownVars = new Set();
        for (const key of Object.keys(astRaw.mutations)) {
            // Keys are like "varName [filename]" or "obj.prop [filename]"
            const varName = key.split(/\s*\[/)[0].trim();
            knownVars.add(varName);
            // Also add the root name (before first dot) for fuzzy matching
            const rootName = varName.split('.')[0];
            if (rootName !== varName) knownVars.add(rootName);
        }
        for (const vEdge of varEdges) {
            if (!vEdge.variable) continue;
            const claimed = vEdge.variable.trim();
            // Fuzzy: exact match OR claimed is a prefix of a known var OR known var is a prefix of claimed
            const matched = knownVars.has(claimed) ||
                [...knownVars].some(k => k.startsWith(claimed + '.') || claimed.startsWith(k + '.'));
            if (!matched) {
                // Soft warning only — non-JS variables (CSS props, Python attrs) legitimately
                // won't appear in JS AST mutations. Don't penalize confidence.
                failures.push({ claim: `variableStateEdge: ${claimed}`, reason: 'variable not found in AST mutation chains (may be non-JS)' });
            }
        }
    }

    // === Check 5: Security mode — verify vulnerability file references ===
    if (mode === 'security' && Array.isArray(result.vulnerabilities)) {
        for (const vuln of result.vulnerabilities) {
            if (vuln.location && typeof vuln.location === 'string') {
                const vulnFileRefs = extractFileRefs(vuln.location);
                for (const fileName of vulnFileRefs) {
                    if (!findFile(fileName)) {
                        failures.push({ claim: `vulnerability: ${vuln.type}`, reason: `location references file "${fileName}" not in inputs` });
                        confidencePenalty += 0.2;
                    }
                }
            }
        }
    }
    // === Check 6: Fix Completeness (Cross-File Call Graph) ===
    // Flags when a fix modifies a function but omits a co-dependent caller that
    // would also need updating. Example: changing a shared store function's signature
    // without updating all callers.
    //
    // INTENTIONALLY does NOT fire when the caller is a leaf UI component (*.jsx, *.tsx
    // with React component naming convention — PascalCase). Fixing a custom hook or
    // utility correctly does not require mentioning every consumer component in the fix.
    // That would be a false positive — encapsulation is working as intended.
    const callGraph = crossFileRaw?.callGraph;
    const minimalFix = report.minimalFix || result.minimalFix;
    if (callGraph?.length > 0 && minimalFix && typeof minimalFix === 'string') {
        const fixText = minimalFix.toLowerCase();

        // A function is "modified" if the fix explicitly mentions both the function AND its file
        const modifiedFunctions = new Set();
        for (const edge of callGraph) {
            if (!edge.function || !edge.callee) continue;
            const calleeBase = edge.callee.split(/[\\/]/).pop().toLowerCase();
            if (fixText.includes(edge.function.toLowerCase()) && fixText.includes(calleeBase)) {
                modifiedFunctions.add(edge.function);
            }
        }

        for (const edge of callGraph) {
            if (!modifiedFunctions.has(edge.function)) continue;

            const callerBase = edge.caller.split(/[\\/]/).pop().toLowerCase();
            if (fixText.includes(callerBase)) continue; // caller is already mentioned — fine

            // Skip if caller is a React component file (PascalCase filename or .jsx/.tsx extension).
            // These are leaf consumers — they don't need to be modified when a hook/utility is fixed.
            const callerFileName = edge.caller.split(/[\\/]/).pop();
            const isReactComponentFile =
                /\.(jsx|tsx)$/i.test(callerFileName) ||          // JSX/TSX files are almost always components
                /^[A-Z]/.test(callerFileName.replace(/\.[^.]+$/, '')); // PascalCase filename

            if (isReactComponentFile) continue;

            // Also skip if the caller is the file being fixed (self-referential call graph edge)
            const calleeBase = edge.callee.split(/[\\/]/).pop().toLowerCase();
            if (callerBase === calleeBase) continue;

            failures.push({
                claim: `Fix Completeness: ${edge.function}`,
                reason: `Fix modifies ${edge.function} in ${edge.callee} but misses updates to caller ${edge.caller}`
            });
            confidencePenalty += 0.15;

            const uncerts = report.uncertainties || result.uncertainties;
            if (Array.isArray(uncerts)) {
                uncerts.push(`AST Guard: Fix modifies '${edge.function}' but misses updates to downstream caller '${callerBase}'`);
            }
        }
    }

    // Apply confidence penalty
    if (confidencePenalty > 0) {
        const originalConf = report.confidence ?? result.confidence;
        if (typeof originalConf === 'number') {
            const adjusted = Math.max(0, originalConf - confidencePenalty);
            if (report.confidence !== undefined) {
                report._originalConfidence = originalConf;
                report.confidence = adjusted;
            } else if (result.confidence !== undefined) {
                result._originalConfidence = originalConf;
                result.confidence = adjusted;
            }
        }
    }

    return { failures, rootCauseRejected, confidencePenalty };
}

