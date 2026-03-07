// ═══════════════════════════════════════════════════
// UNRAVEL — Claim Verifier Regression Tests
// Feeds deliberately bad data to ensure the verifier catches fabrications.
// Run: node benchmarks/verifier-tests.js
// ═══════════════════════════════════════════════════

// Inline the verifyClaims helpers so we can test without importing the full orchestrator.
// We extract the function by requiring the module — but since orchestrate uses ESM,
// we replicate the core logic here for isolated testing.

const PASS = '\x1b[32m✓\x1b[0m';
const FAIL = '\x1b[31m✗\x1b[0m';
let passed = 0;
let failed = 0;

function assert(condition, testName) {
    if (condition) {
        console.log(`  ${PASS} ${testName}`);
        passed++;
    } else {
        console.log(`  ${FAIL} ${testName}`);
        failed++;
    }
}

// ── Mock data ──
const mockFiles = [
    {
        name: 'timer.js',
        content: [
            'let duration = 60;',
            'let remaining = 60;',
            'let interval = null;',
            '',
            'function start() {',
            '    interval = setInterval(tick, 1000);',
            '}',
            '',
            'function tick() {',
            '    remaining--;',
            '    if (remaining <= 0) clearInterval(interval);',
            '}',
            '',
            'function pause() {',
            '    clearInterval(interval);',
            '    interval = null;',
            '    duration = remaining; // BUG',
            '}',
        ].join('\n'), // 18 lines
    },
    {
        name: 'utils.js',
        content: [
            'export function formatTime(seconds) {',
            '    const m = Math.floor(seconds / 60);',
            '    const s = seconds % 60;',
            '    return `${m}:${s.toString().padStart(2, "0")}`;',
            '}',
        ].join('\n'), // 5 lines
    },
];

const mockAST = {
    mutations: {
        'duration [timer.js]': {
            writes: [{ line: 1 }, { line: 17 }],
            reads: [{ line: 10 }],
        },
        'remaining [timer.js]': {
            writes: [{ line: 2 }, { line: 10 }],
            reads: [{ line: 11 }, { line: 17 }],
        },
        'interval [timer.js]': {
            writes: [{ line: 3 }, { line: 6 }, { line: 16 }],
            reads: [{ line: 11 }, { line: 15 }],
        },
    },
    closures: {},
    timingNodes: [],
};

// ── Replicate verifyClaims core logic for testing ──
function verifyClaims(result, codeFiles, astRaw, mode) {
    const failures = [];
    let rootCauseRejected = false;
    let confidencePenalty = 0;

    const fileLookup = {};
    for (const f of codeFiles) {
        const shortName = f.name.split(/[\\/]/).pop();
        const lines = (f.content || '').split('\n');
        fileLookup[shortName] = { lines, content: f.content || '' };
        fileLookup[f.name] = fileLookup[shortName];
    }

    function findFile(name) {
        if (!name) return null;
        const clean = name.trim();
        if (fileLookup[clean]) return fileLookup[clean];
        const short = clean.split(/[\\/]/).pop();
        if (fileLookup[short]) return fileLookup[short];
        for (const key of Object.keys(fileLookup)) {
            if (key.endsWith(clean) || clean.endsWith(key)) return fileLookup[key];
        }
        return null;
    }

    function extractLineRefs(text) {
        if (!text) return [];
        const refs = [];
        const linePattern = /(?:line\s*[:.]?\s*|[Ll]|:)(\d{1,5})\b/g;
        let m;
        while ((m = linePattern.exec(text)) !== null) {
            const num = parseInt(m[1], 10);
            if (num > 0 && num < 100000) refs.push(num);
        }
        return refs;
    }

    function extractFileRefs(text) {
        if (!text) return [];
        const refs = [];
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

    const report = result.report || result;
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
                        failures.push({ claim: `rootCause line ${lineNum}`, reason: `line exceeds file length (${fileData.lines.length})` });
                        rootCauseRejected = true;
                    }
                }
            }
        }
    }

    const varEdges = report.variableStateEdges || result.variableStateEdges;
    if (Array.isArray(varEdges) && astRaw?.mutations) {
        const knownVars = new Set();
        for (const key of Object.keys(astRaw.mutations)) {
            const varName = key.split(/\s*\[/)[0].trim();
            knownVars.add(varName);
        }
        for (const vEdge of varEdges) {
            if (vEdge.variable && !knownVars.has(vEdge.variable)) {
                failures.push({ claim: `variableStateEdge: ${vEdge.variable}`, reason: 'variable not found in AST mutation chains' });
            }
        }
    }

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

// ═══════════════════════════════════════════════════
// TEST 1: Fake line numbers
// Evidence claims line 999 in an 18-line file.
// ═══════════════════════════════════════════════════
console.log('\nTest 1: Fake line numbers');
const fakeLineResult = {
    report: {
        bugType: 'STATE_MUTATION',
        confidence: 0.9,
        evidence: [
            'timer.js line 999 — duration is reassigned inside a loop',
            'timer.js line 500 — remaining is decremented incorrectly',
        ],
        rootCause: 'timer.js line 17 — duration = remaining mutates a constant',
        codeLocation: 'timer.js:17',
    },
};
const test1 = verifyClaims(fakeLineResult, mockFiles, mockAST, 'debug');
assert(test1.failures.length >= 2, 'Detects 2+ fake line numbers (999, 500)');
assert(test1.confidencePenalty >= 0.4, 'Applies confidence penalty >= 0.4');
assert(fakeLineResult.report.confidence <= 0.5, 'Confidence reduced on result object (0.9 - penalty)');
assert(!test1.rootCauseRejected, 'Does NOT reject rootCause (line 17 is valid)');

// ═══════════════════════════════════════════════════
// TEST 2: Fabricated code snippets (nonexistent file)
// Evidence quotes code from a file not in the input set.
// ═══════════════════════════════════════════════════
console.log('\nTest 2: Fabricated code snippets (nonexistent file)');
const fabricatedResult = {
    report: {
        bugType: 'DATA_FLOW',
        confidence: 0.85,
        evidence: [
            'config.js line 12 — the API_URL constant is hardcoded without validation',
            'database.js line 45 — connection pool is never closed',
        ],
        rootCause: 'The data flow between config.js and database.js causes a connection leak',
        codeLocation: 'database.js:45',
    },
};
const test2 = verifyClaims(fabricatedResult, mockFiles, mockAST, 'debug');
assert(test2.failures.length >= 2, 'Detects references to nonexistent files');
assert(test2.confidencePenalty >= 0.4, 'Applies confidence penalty for fabricated files');

// ═══════════════════════════════════════════════════
// TEST 3: Nonexistent file in rootCause → hard reject
// rootCause names a file that doesn't exist in inputs.
// ═══════════════════════════════════════════════════
console.log('\nTest 3: Nonexistent file in rootCause');
const nonexistentRootResult = {
    report: {
        bugType: 'RACE_CONDITION',
        confidence: 0.95,
        evidence: ['timer.js line 6 — setInterval creates async execution'],
        rootCause: 'The race condition originates in scheduler.js line 23 where two intervals overlap',
        codeLocation: 'scheduler.js:23',
    },
};
const test3 = verifyClaims(nonexistentRootResult, mockFiles, mockAST, 'debug');
assert(test3.rootCauseRejected === true, 'Hard rejects rootCause referencing nonexistent file');
assert(test3.failures.some(f => f.reason.includes('nonexistent file')), 'Failure message mentions nonexistent file');

// ═══════════════════════════════════════════════════
// TEST 4: Valid result passes (no false positives)
// ═══════════════════════════════════════════════════
console.log('\nTest 4: Valid result passes verification');
const validResult = {
    report: {
        bugType: 'STATE_MUTATION',
        confidence: 0.92,
        evidence: [
            'AST confirms duration is mutated inside pause() at line 17',
            'timer.js line 10 — remaining is decremented in tick()',
        ],
        rootCause: 'In timer.js line 17, duration = remaining mutates a value that should be constant',
        codeLocation: 'timer.js:17',
        variableStateEdges: [
            { variable: 'duration', edges: [{ from: 'pause()', to: 'duration', label: 'mutated L17' }] },
        ],
    },
};
const test4 = verifyClaims(validResult, mockFiles, mockAST, 'debug');
assert(test4.failures.length === 0, 'No failures on valid evidence');
assert(!test4.rootCauseRejected, 'Root cause not rejected');
assert(test4.confidencePenalty === 0, 'No confidence penalty');

// ═══════════════════════════════════════════════════
// TEST 5: Variable edge for unknown variable (soft flag)
// ═══════════════════════════════════════════════════
console.log('\nTest 5: Unknown variable in edges (soft flag)');
const unknownVarResult = {
    report: {
        bugType: 'STATE_MUTATION',
        confidence: 0.8,
        evidence: ['timer.js line 17 — duration is reassigned'],
        rootCause: 'timer.js line 17',
        codeLocation: 'timer.js:17',
        variableStateEdges: [
            { variable: 'nonExistentVar', edges: [] },
        ],
    },
};
const test5 = verifyClaims(unknownVarResult, mockFiles, mockAST, 'debug');
assert(test5.failures.length >= 1, 'Flags unknown variable');
assert(!test5.rootCauseRejected, 'Does NOT hard reject (variable check is soft)');

// ═══════════════════════════════════════════════════
// Summary
// ═══════════════════════════════════════════════════
console.log(`\n${'═'.repeat(40)}`);
console.log(`Results: ${passed} passed, ${failed} failed`);
if (failed > 0) {
    console.log('\x1b[31mSome tests FAILED!\x1b[0m');
    process.exit(1);
} else {
    console.log('\x1b[32mAll tests passed.\x1b[0m');
}
