import { join } from 'path';
import { z } from 'zod';

export function registerVerifyTool(server, deps) {
    server.tool(
        'verify',
        'VERIFICATION (Sandwich Protocol Phase 8): After completing your diagnosis based on AST evidence, you MUST call this to cross-check your claims. Unravel verifies your rootCause, evidence citations, and fix against the actual AST. Returns a PASSED/REJECTED verdict. Fix is not valid until this passes.\n\nPROTOCOL REQUIREMENTS (enforced by hard gates -> submission rejected if violated):\n1. HYPOTHESIS GATE: You must have generated >=1 competing hypothesis in Phase 3 before submitting. Pass them in hypotheses[]. Submitting without hypotheses[] means you skipped Phase 3 (Hypothesis Generation) -> the fix will not be accepted.\n2. EVIDENCE CITATION GATE: rootCause must contain at least one file:line citation (e.g. "scheduler.js:20") sourced from the analyze output. A rootCause with no code citation is hallucinated reasoning and will be rejected.',
        {
            rootCause: z.string().describe('Your root cause diagnosis. MUST contain at least one file:line citation (e.g. "scheduler.js:20") -> rootCause without a code citation is rejected.'),
            hypotheses: z.array(z.string()).optional().describe('REQUIRED: The competing hypotheses you generated in Phase 3 (e.g. ["H1: stale closure...", "H2: race condition...", "H3: incorrect state..."]). At least 1 required. Omitting this field means Phase 3 was skipped and verify will return PROTOCOL_VIOLATION.'),
            evidence: z.array(z.string()).optional().describe('Evidence citations (e.g. ["taskStore.ts L29: tasks.push(newTask)", "useSessionData.ts L32: const tasks = useTasks()"])'),
            codeLocation: z.string().optional().describe('File and line where the bug is (e.g. "taskStore.ts:29")'),
            minimalFix: z.string().optional().describe('Your proposed fix'),
            diffBlock: z.string().optional().describe(
                'Optional: unified diff of your fix (lines prefixed with + and -). ' +
                'If provided, Unravel checks whether your fix removes any function signature parameters ' +
                'that have callers in other files - activating the Fix Completeness check (Check 6).'
            ),
            files: z.array(z.object({
                name: z.string(),
                content: z.string(),
            })).optional().describe('Code files to verify against. If omitted, uses files from a previous analyze or build_map call.'),
        },
        async (args) => {
            try {
                const core = deps.getCore();
                const files = args.files
                    ? args.files.map(f => ({ name: f.name, content: f.content }))
                    : deps.session.files;

                if (!files || files.length === 0) {
                    throw new Error('No files available for verification. Call analyze or build_map first, or pass files directly.');
                }

                const hypothesisGate = checkHypothesisGate(args);
                if (hypothesisGate) return hypothesisGate;

                const citationGate = checkCitationGate(args);
                if (citationGate) return citationGate;

                const agentResult = {
                    report: {
                        rootCause:    args.rootCause,
                        evidence:     args.evidence    || [],
                        codeLocation: args.codeLocation || '',
                        minimalFix:   args.minimalFix   || '',
                        diffBlock:    args.diffBlock    || '',
                    },
                };

                const verification = core.verifyClaims(
                    agentResult,
                    files,
                    deps.session.astRaw,
                    deps.session.crossFileRaw,
                    'debug',
                    deps.session.lastSymptom
                );

                const passed = !verification.rootCauseRejected && verification.failures.length === 0;

                if (passed && deps.session.astRaw) {
                    await handlePassedVerification({ args, deps, core, verification });
                }

                if (!passed && deps.session.astRaw) {
                    await handleFailedVerification({ deps, core });
                }

                const layerBoundaryHint = await maybeCheckLayerBoundary({
                    deps,
                    core,
                    passed,
                    agentResult,
                    verification,
                    files,
                });

                const verdictStr = verification.rootCauseRejected
                    ? 'REJECTED'
                    : verification.failures.length > 0 ? 'FAILED' : 'PASSED';

                const responseObj = {
                    verdict:           verdictStr,
                    allClaimsPassed:   verification.failures.length === 0,
                    failures:          verification.failures.map(f => ({ claim: f.claim, reason: f.reason })),
                    confidencePenalty: verification.confidencePenalty,
                    rootCauseRejected: verification.rootCauseRejected,
                    summary: verification.failures.length === 0
                        ? 'All claims verified against actual code. Your diagnosis is consistent with the codebase.'
                        : `${verification.failures.length} claim(s) failed verification. ${verification.rootCauseRejected ? 'Root cause references code that does not exist.' : 'Some evidence citations could not be confirmed.'}`,
                };

                if (layerBoundaryHint) responseObj.layer_boundary = layerBoundaryHint;

                return {
                    content: [{
                        type: 'text',
                        text: JSON.stringify(responseObj, null, 2),
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

function checkHypothesisGate(args) {
    const hypotheses = args.hypotheses;
    if (hypotheses && hypotheses.length > 0) return null;

    process.stderr.write('[unravel-mcp] Phase 3e Gate 1 REJECTED: no hypotheses provided\n');
    return {
        content: [{
            type: 'text',
            text: JSON.stringify({
                verdict: 'PROTOCOL_VIOLATION',
                gate: 'HYPOTHESIS_GATE',
                allClaimsPassed: false,
                failures: [{
                    claim: 'hypotheses[]',
                    reason: 'Phase 3 (Hypothesis Generation) was skipped. You must generate at least 1 competing hypothesis before submitting a fix. Re-read the evidence, generate 3 mutually exclusive hypotheses, eliminate all but one with AST evidence, then re-submit verify with hypotheses[] populated.',
                }],
                summary: 'PROTOCOL_VIOLATION: Phase 3 (Hypothesis Generation) skipped. Fix not accepted. Generate hypotheses first, then re-call verify with hypotheses[] filled.',
                remediation: 'Add hypotheses: ["H1: ...", "H2: ...", "H3: ..."] to your verify call. These must be the competing mechanisms you considered and eliminated before arriving at your rootCause.',
            }, null, 2),
        }],
    };
}

function checkCitationGate(args) {
    const FILE_LINE_PATTERN = /[\w.\-/]+\.(js|jsx|ts|tsx|py|go|rs|java|cs)\s*[L:]\s*\d+/i;
    if (FILE_LINE_PATTERN.test(args.rootCause)) return null;

    process.stderr.write('[unravel-mcp] Phase 3e Gate 2 REJECTED: rootCause has no file:line citation\n');
    return {
        content: [{
            type: 'text',
            text: JSON.stringify({
                verdict: 'PROTOCOL_VIOLATION',
                gate: 'EVIDENCE_CITATION_GATE',
                allClaimsPassed: false,
                failures: [{
                    claim: args.rootCause,
                    reason: 'rootCause contains no file:line citation. Every rootCause must reference the specific code location where state was first corrupted (e.g. "scheduler.js:3 -> _cachedEntries captures stale reference"). A rootCause without a code citation cannot be verified and may be hallucinated.',
                }],
                summary: 'PROTOCOL_VIOLATION: rootCause has no file:line citation. Fix not accepted. Add a specific code location (e.g. "filename.js:42") to your rootCause string.',
                remediation: 'Rewrite rootCause to include the file and line where the bug originates. Example: "scheduler.js:3 -> const _cachedEntries = getEntries() captures a reference that becomes stale after rebalance() reassigns _entries at priority-queue.js:36"',
            }, null, 2),
        }],
    };
}

async function handlePassedVerification({ args, deps, core, verification }) {
    core.learnFromDiagnosis(deps.session.astRaw, verification);
    const patternFile = deps.session.mcpPatternFile
        || join(deps.mcpRoot, '.unravel', 'patterns.json');
    await core.savePatterns(patternFile);
    process.stderr.write('[unravel-mcp] Pattern weights updated and persisted.\n');

    const archiveKey = deps.resolveEmbeddingApiKey();
    if (archiveKey && deps.session.projectRoot) {
        try {
            const archived = await deps.archiveDiagnosis(
                deps.session.projectRoot,
                {
                    symptom:      deps.session.lastSymptom || args.rootCause,
                    rootCause:    args.rootCause,
                    codeLocation: args.codeLocation || '',
                    evidence:     args.evidence    || [],
                },
                archiveKey
            );
            if (archived) deps.session.diagnosisArchive.push(archived);
        } catch (archErr) {
            process.stderr.write(`[unravel:archive] Archive error (non-fatal): ${archErr.message}\n`);
        }
    } else if (archiveKey && !deps.session.projectRoot) {
        process.stderr.write('[unravel:archive] Skipping archive for inline-file verification (no projectRoot).\n');
    }

    deps.autoSeedCodex(deps.session.projectRoot, {
        symptom:      deps.session.lastSymptom || args.rootCause,
        rootCause:    args.rootCause,
        codeLocation: args.codeLocation || '',
        evidence:     args.evidence    || [],
    });

    if (deps.session.projectRoot) {
        deps.enrichProjectOverviewWithDiagnosis(deps.session.projectRoot, {
            rootCause:    args.rootCause,
            codeLocation: args.codeLocation || '',
            symptom:      deps.session.lastSymptom || args.rootCause,
        });
        process.stderr.write('[unravel] Project overview enriched with verified diagnosis.\n');
    }
}

async function handleFailedVerification({ deps, core }) {
    const patternFile = deps.session.mcpPatternFile
        || join(deps.session.projectRoot || deps.mcpRoot, '.unravel', 'patterns.json');
    core.penalizePattern(deps.session.astRaw);
    await core.savePatterns(patternFile);
    process.stderr.write('[unravel-mcp] Pattern weights decayed (FAILED verdict) and persisted.\n');
}

async function maybeCheckLayerBoundary({ deps, core, passed, agentResult, verification, files }) {
    if (passed || !core.checkSolvability) return null;
    try {
        const solvability = core.checkSolvability(
            agentResult,
            verification,
            files,
            deps.session.lastSymptom || ''
        );
        if (!solvability.isLayerBoundary) return null;

        const layerBoundaryHint = {
            verdict:           'LAYER_BOUNDARY',
            confidence:        solvability.confidence,
            rootCauseLayer:    solvability.rootCauseLayer,
            suggestedFixLayer: solvability.suggestedFixLayer,
            reason:            solvability.reason,
            message:           solvability.message,
        };
        process.stderr.write(`[unravel:solvability] LAYER_BOUNDARY - ${solvability.rootCauseLayer} (confidence: ${solvability.confidence})\n`);
        return layerBoundaryHint;
    } catch (solvErr) {
        process.stderr.write(`[unravel:solvability] Non-fatal error: ${solvErr.message}\n`);
        return null;
    }
}
