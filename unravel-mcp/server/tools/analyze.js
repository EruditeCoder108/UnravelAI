import { existsSync } from 'fs';
import { join, resolve } from 'path';
import { z } from 'zod';

export function registerAnalyzeTool(server, deps) {
    server.tool(
        'analyze',
        'Run Unravel\'s AST engine to extract verified structural facts: mutation chains, async boundaries, closure captures, and races. This is Phase 1 of the "Sandwich Protocol". It returns deterministic ground truth and the required Phase 2-8 instructions you must follow to diagnose the bug.',
        {
            files: z.array(z.object({
                name: z.string().describe('File path (e.g. "src/store/taskStore.ts")'),
                content: z.string().describe('Full file content'),
            })).optional().describe('Code files to analyze. If omitted, uses files from a previous build_map call or reads from "directory".'),
            directory: z.string().optional().describe('Path to project root. Reads all source files automatically.'),
            symptom: z.string().describe('Bug description or error message from the user.'),
            detail: z.enum(['priority', 'standard', 'full']).optional().describe(
                "Output verbosity. 'standard' (default): filtered high-signal findings (~200 lines). " +
                "'priority': confirmed critical findings only (~50 lines). " +
                "'full': complete unfiltered output -> use only if standard output is missing a key mutation chain."
            ),
        },
        async (args) => {
            try {
                const core = deps.getCore();
                const files = deps.resolveFiles(args);
                deps.session.files = files;

                const sortedNames = files.map(f => f.name).sort().join('|');
                const analysisHash = `${args.symptom}::${args.detail || 'standard'}::${sortedNames}`;
                if (deps.session.lastAnalysisHash === analysisHash && deps.session.lastAnalysisResult) {
                    process.stderr.write('[unravel-mcp] Phase 3c: Cache hit -> returning cached analysis.\n');
                    return deps.session.lastAnalysisResult;
                }

                const result = await core.orchestrate(files, args.symptom, {
                    _mode: 'mcp',
                    detail: args.detail || 'standard',
                    provider: 'none',
                    apiKey: 'none',
                    model: 'none',
                    mode: 'debug',
                    onProgress: (msg) => {
                        if (typeof msg === 'string') process.stderr.write(`[unravel] ${msg}\n`);
                    },
                });

                const detail = args.detail || 'standard';
                let astRawForResponse = result.evidence?.astRaw || null;
                let _mutationsSuppressed = 0;
                let _mutationsTotal = 0;

                if (astRawForResponse && detail !== 'full') {
                    const { filtered, suppressed, total } = deps.filterAstRawMutations(astRawForResponse);
                    astRawForResponse = filtered;
                    _mutationsSuppressed = suppressed;
                    _mutationsTotal = total;
                    process.stderr.write(`[unravel-mcp] astRaw.mutations filtered: ${total - suppressed}/${total} kept (${suppressed} noise vars suppressed)\n`);
                }

                deps.session.astRaw = result.evidence?.astRaw || null;
                deps.session.crossFileRaw = result.evidence?.crossFileRaw || null;

                if (!deps.session.graph && deps.session.projectRoot) {
                    const restored = deps.loadGraph(deps.session.projectRoot);
                    if (restored) {
                        deps.session.graph = restored;
                        process.stderr.write(`[unravel-mcp] KG auto-restored from ${deps.session.projectRoot}/.unravel/knowledge.json (${restored.nodes?.length || 0} nodes)\n`);
                    }
                }

                await ensurePatternStore({ args, deps, core });
                await ensureArchiveLoaded({ args, deps });

                if (args.symptom) deps.session.lastSymptom = args.symptom;

                const patternMatches = deps.session.astRaw ? core.matchPatterns(deps.session.astRaw) : [];
                const topPatterns = patternMatches.slice(0, 5).map(m => ({
                    patternId:     m.pattern.id,
                    bugType:       m.pattern.bugType,
                    description:   m.pattern.description,
                    severity:      m.pattern.severity,
                    confidence:    Math.round(m.confidence * 100) / 100,
                    hitCount:      m.pattern.hitCount,
                    matchedEvents: m.matchedEvents,
                }));

                const base = result.mcpEvidence || result;

                if (base.evidence && astRawForResponse) {
                    base.evidence.astRaw = astRawForResponse;
                }

                if (detail !== 'full' && base.evidence?.astRaw?.mutations) {
                    const keptCount = Object.keys(base.evidence.astRaw.mutations).length;
                    delete base.evidence.astRaw.mutations;
                    base.evidence.astRaw._mutationsDropped = `${keptCount} entries suppressed in standard mode -> use detail:'full' to see raw mutations JSON`;
                    process.stderr.write(`[unravel-mcp] P4: astRaw.mutations dropped (${keptCount} entries) -> contextFormatted carries the signal\n`);
                }

                injectPatternHints({ base, topPatterns });
                await injectSemanticArchiveHints({ args, deps, base });
                await injectCodexPreBriefing({ args, deps, base });

                let circleIrFindings = [];
                try {
                    circleIrFindings = await deps.runCircleIrAnalysis(files);
                } catch (cIrErr) {
                    process.stderr.write(`[circle-ir] Unexpected adapter error (non-fatal): ${cIrErr.message}\n`);
                }

                const responsePayload = {
                    ...base,
                    patternMatches: topPatterns,
                    _circleIrFindings: circleIrFindings,
                    _provenance: {
                        ...(base._provenance || {}),
                        patternsChecked:        core.getPatternCount(),
                        patternMatchCount:      topPatterns.length,
                        mutationsKept:          _mutationsTotal - _mutationsSuppressed,
                        mutationsSuppressed:    _mutationsSuppressed,
                        circleIrFindingCount:   circleIrFindings.length,
                    },
                };

                const returnValue = {
                    content: [{
                        type: 'text',
                        text: deps.formatAnalysisForAgent(responsePayload, detail),
                    }],
                };

                deps.session.lastAnalysisHash = analysisHash;
                deps.session.lastAnalysisResult = returnValue;

                return returnValue;
            } catch (err) {
                return {
                    content: [{ type: 'text', text: `Error: ${err.message}` }],
                    isError: true,
                };
            }
        }
    );
}

async function ensurePatternStore({ args, deps, core }) {
    const globalPatternFile = join(deps.mcpRoot, '.unravel', 'patterns.json');
    const projectPatternFile = deps.session.projectRoot
        ? join(deps.session.projectRoot, '.unravel', 'patterns.json')
        : null;
    deps.session.mcpPatternFile = projectPatternFile || globalPatternFile;

    if (!deps.session.patternsLoaded) {
        await core.loadPatterns(globalPatternFile);
        if (projectPatternFile && existsSync(projectPatternFile)) {
            await core.loadPatterns(projectPatternFile);
            process.stderr.write(`[unravel-mcp] Project patterns overlaid from ${projectPatternFile}\n`);
        }
        deps.session.patternsLoaded = true;
        process.stderr.write(`[unravel-mcp] Pattern store ready (${core.getPatternCount()} patterns)\n`);
    }

    if (args.directory) {
        const resolvedDir = resolve(args.directory);
        if (resolvedDir !== deps.session.projectRoot) {
            deps.session.projectRoot = resolvedDir;
            deps.session.archiveLoaded = false;
            deps.session.diagnosisArchive = [];
            const projPatternFile = join(resolvedDir, '.unravel', 'patterns.json');
            if (existsSync(projPatternFile)) {
                await core.loadPatterns(projPatternFile);
                process.stderr.write('[unravel-mcp] Project patterns overlaid\n');
            }
        }
    }
}

async function ensureArchiveLoaded({ deps }) {
    if (deps.session.projectRoot && !deps.session.archiveLoaded) {
        deps.session.diagnosisArchive = deps.loadDiagnosisArchive(deps.session.projectRoot);
        deps.session.archiveLoaded = true;
        process.stderr.write(`[unravel:archive] Diagnosis archive loaded (${deps.session.diagnosisArchive.length} entries).\n`);
    }
}

function injectPatternHints({ base, topPatterns }) {
    if (!base._instructions || topPatterns.length === 0) return;
    const strongPatterns = topPatterns.filter(p => p.confidence >= 0.65);
    if (strongPatterns.length === 0) return;

    base._instructions.patternHints = strongPatterns.map(p => ({
        patternId:   p.patternId,
        bugType:     p.bugType,
        confidence:  p.confidence,
        hitCount:    p.hitCount,
        hint: `This analysis matches a known ${p.bugType} pattern (confirmed ${p.hitCount} times, confidence ${Math.round(p.confidence * 100)}%). Treat this as H1 in your hypothesis tree unless AST evidence contradicts it.`,
    }));
    process.stderr.write(`[unravel-mcp] Phase 4: Injected ${strongPatterns.length} pattern hint(s) into _instructions.\n`);
}

async function injectSemanticArchiveHints({ args, deps, base }) {
    const archiveApiKey = deps.resolveEmbeddingApiKey();
    if (!archiveApiKey || deps.session.diagnosisArchive.length === 0 || !args.symptom) return;
    try {
        const archiveHits = await deps.searchDiagnosisArchive(
            args.symptom,
            deps.session.diagnosisArchive,
            archiveApiKey
        );
        if (archiveHits.length > 0 && base._instructions) {
            base._instructions.semanticArchiveHints = archiveHits.map(h => ({
                diagnosisId:  h.id,
                similarity:   Math.round(h.score * 100) / 100,
                symptom:      h.symptom,
                rootCause:    h.rootCause,
                codeLocation: h.codeLocation,
                timestamp:    h.timestamp,
                hint: `FAST SEMANTIC ARCHIVE (${(h.score * 100).toFixed(0)}% match): Past verified diagnosis -> "${h.rootCause}" at ${h.codeLocation}. Treat as strong H1 if consistent with AST evidence above.`,
            }));
            process.stderr.write(`[unravel:archive] Phase 7b: ${archiveHits.length} semantic match(es) injected.\n`);
        }
    } catch (archiveErr) {
        process.stderr.write(`[unravel:archive] Phase 7b search error (non-fatal): ${archiveErr.message}\n`);
    }
}

async function injectCodexPreBriefing({ args, deps, base }) {
    if (!deps.session.projectRoot || !args.symptom) return;
    try {
        const codexResult = await deps.searchCodex(deps.session.projectRoot, args.symptom);
        if (codexResult.matches.length > 0 && base._instructions) {
            base._instructions.codexPreBriefing = {
                note: 'Prior debugging sessions matched this symptom. Read these discoveries - they may contain key insights.',
                entries: codexResult.matches.map(m => ({
                    codex: `codex-${m.taskId}`,
                    problem: m.problem,
                    relevance_score: m.relevance_score ?? m.score,
                    discoveries: m.discoveries,
                })),
            };
            process.stderr.write(`[unravel:codex] analyze: ${codexResult.matches.length} codex pre-briefing(s) injected.\n`);
        }
    } catch (codexErr) {
        process.stderr.write(`[unravel:codex] analyze pre-briefing error (non-fatal): ${codexErr.message}\n`);
    }
}
