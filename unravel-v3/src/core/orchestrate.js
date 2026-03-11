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
    if (!_forceNoAST && jsFiles.length > 15) {
        try {
            onProgress?.('GRAPH ROUTER: Selecting relevant files from import graph...');
            const { selectedFiles, strategy } = await selectFilesByGraph(codeFiles, symptom);
            if (strategy !== 'all-files') {
                const before = codeFiles.length;
                codeFiles = codeFiles.filter(f => selectedFiles.includes(f.name));
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

    const enginePrompt = `${astBlock}${projectContext}\n\nFILES PROVIDED:\n${cappedFiles.map(f => `=== FILE: ${f.name} ===\n${f.content.slice(0, 8000)}`).join('\n\n')}\n\n${symptomLabel}:\n${symptom || symptomDefault}${schemaInstruction}`;

    // ── Phase 3: Call AI (streaming when onPartialResult provided) ──
    const SAFE_STREAM_FIELDS = ['rootCause', 'evidence', 'fix', 'minimalFix', 'bugType', 'confidence', 'symptom', 'codeLocation', 'whyFixWorks', 'variableState', 'timeline', 'conceptExtraction', 'whyAILooped', 'hypotheses', 'reproduction', 'aiPrompt', 'timelineEdges', 'hypothesisTree', 'aiLoopEdges', 'variableStateEdges'];

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
    const verification = verifyClaims(result, codeFiles, astRaw, mode);
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
        routerStrategy: crossFileRaw ? 'graph-frontier' : 'llm-heuristic',
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
// Claim Verifier — Trust Layer (Sprint 1)
// Cross-checks model evidence against actual files and AST data.
// Two-tier policy:
//   - Evidence items fail → degrade confidence, flag _verified: false
//   - RootCause fails    → hard reject (needsMoreInfo = true)
// ═══════════════════════════════════════════════════

function verifyClaims(result, codeFiles, astRaw, mode) {
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
    const report = result.report || result; // report may be nested or flat
    const evidenceList = report.evidence || result.evidence;
    if (Array.isArray(evidenceList)) {
        for (const e of evidenceList) {
            if (typeof e !== 'string') continue;
            const lineRefs = extractLineRefs(e);
            const fileRefs = extractFileRefs(e);
            for (const fileName of fileRefs) {
                const fileData = findFile(fileName);
                if (!fileData) {
                    failures.push({ claim: e, reason: `references file "${fileName}" not in provided inputs` });
                    confidencePenalty += 0.2;
                    continue;
                }
                for (const lineNum of lineRefs) {
                    if (lineNum > fileData.lines.length) {
                        failures.push({ claim: e, reason: `line ${lineNum} exceeds file length (${fileData.lines.length} lines)` });
                        confidencePenalty += 0.2;
                    }
                }
            }
        }
    }

    // === Check 2: codeLocation ===
    const codeLocation = report.codeLocation || result.codeLocation;
    if (codeLocation && typeof codeLocation === 'string') {
        const locFileRefs = extractFileRefs(codeLocation);
        const locLineRefs = extractLineRefs(codeLocation);
        for (const fileName of locFileRefs) {
            const fileData = findFile(fileName);
            if (!fileData) {
                failures.push({ claim: `codeLocation: ${codeLocation}`, reason: `file "${fileName}" not in inputs` });
                confidencePenalty += 0.3;
            } else {
                for (const lineNum of locLineRefs) {
                    if (lineNum > fileData.lines.length) {
                        failures.push({ claim: `codeLocation: ${codeLocation}`, reason: `line ${lineNum} exceeds ${fileData.lines.length}` });
                        confidencePenalty += 0.3;
                    }
                }
            }
        }
    }

    // === Check 3: rootCause — hard reject if fabricated ===
    const rootCause = report.rootCause || result.rootCause;
    if (rootCause && typeof rootCause === 'string') {
        const rcFileRefs = extractFileRefs(rootCause);
        const rcLineRefs = extractLineRefs(rootCause);
        for (const fileName of rcFileRefs) {
            const fileData = findFile(fileName);
            if (!fileData) {
                failures.push({ claim: `rootCause: ${rootCause.slice(0, 100)}`, reason: `references nonexistent file "${fileName}"` });
                rootCauseRejected = true;
            } else {
                for (const lineNum of rcLineRefs) {
                    if (lineNum > fileData.lines.length + 2) {
                        // Allow small slack (+2) since models sometimes miscount by 1-2 lines
                        failures.push({ claim: `rootCause line ${lineNum}`, reason: `line exceeds file length (${fileData.lines.length})` });
                        rootCauseRejected = true;
                    }
                }
            }
        }
    }

    // === Check 4: variableStateEdges — cross-check with AST ===
    const varEdges = report.variableStateEdges || result.variableStateEdges;
    if (Array.isArray(varEdges) && astRaw?.mutations) {
        const knownVars = new Set();
        for (const key of Object.keys(astRaw.mutations)) {
            // Keys are like "varName [filename]" — extract the variable name
            const varName = key.split(/\s*\[/)[0].trim();
            knownVars.add(varName);
        }
        for (const vEdge of varEdges) {
            if (vEdge.variable && !knownVars.has(vEdge.variable)) {
                // Variable claimed in edges but not found in AST
                // This could be a non-JS variable, so don't hard reject — just flag
                failures.push({ claim: `variableStateEdge: ${vEdge.variable}`, reason: 'variable not found in AST mutation chains' });
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

