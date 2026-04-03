#!/usr/bin/env node
// ═══════════════════════════════════════════════════════════════════════════════
// unravel-cli.js — Unravel Command-Line Interface
//
// Run Unravel's AST engine from the command line for CI/CD integration.
// Produces SARIF 2.1.0 output for GitHub PR annotations.
//
// Usage:
//   node unravel-mcp/cli.js --directory ./src --symptom "bug description"
//   node unravel-mcp/cli.js --directory ./src --symptom "..." --format sarif --output findings.sarif
//   node unravel-mcp/cli.js --directory ./src --symptom "..." --format json
//
// Exit codes:
//   0 — analysis complete, no CRITICAL findings (weight >= 0.9)
//   1 — CRITICAL findings confirmed by AST (at least one race/floating/stale with high pattern weight)
//   2 — analysis error (bad directory, parse failure, etc.)
//
// ═══════════════════════════════════════════════════════════════════════════════

import { resolve, join, extname } from 'path';
import { existsSync, writeFileSync, readFileSync, readdirSync, statSync } from 'fs';
import { pathToFileURL } from 'url';
import { createRequire } from 'module';

// Parse CLI args
function parseArgs(argv) {
    const args = {};
    for (let i = 2; i < argv.length; i++) {
        const arg = argv[i];
        if (arg.startsWith('--')) {
            const key = arg.slice(2);
            const next = argv[i + 1];
            if (next && !next.startsWith('--')) {
                args[key] = next;
                i++;
            } else {
                args[key] = true;
            }
        }
    }
    return args;
}

const args = parseArgs(process.argv);

if (args.help || (!args.directory && !args.files)) {
    console.log([
        'Unravel CLI — deterministic AST bug analyzer',
        '',
        'Usage:',
        '  node unravel-mcp/cli.js --directory <path> --symptom <description> [options]',
        '',
        'Options:',
        '  --directory <path>    Project root to analyze (required)',
        '  --symptom <text>      Bug description (default: "general analysis")',
        '  --format <fmt>        Output format: "text" (default), "json", "sarif"',
        '  --output <file>       Write output to file instead of stdout',
        '  --detail <level>      Evidence verbosity: priority, standard (default), full',
        '  --threshold <0-1>     Pattern weight threshold for exit code 1 (default: 0.9)',
        '  --help                Show this help',
        '',
        'Exit codes:',
        '  0   No critical findings',
        '  1   Critical findings detected (pattern weight >= threshold)',
        '  2   Error (bad input, parse failure)',
    ].join('\n'));
    process.exit(0);
}

const CORE_PATH = resolve(import.meta.dirname, '..', 'unravel-v3', 'src', 'core');
process.env.UNRAVEL_NATIVE_BASE = pathToFileURL(resolve(import.meta.dirname, 'package.json')).href;

function coreModule(filename) {
    return pathToFileURL(join(CORE_PATH, filename)).href;
}

// ── File reader (same as MCP server) ─────────────────────────────────────────
const CODE_EXTENSIONS = new Set([
    '.js', '.jsx', '.ts', '.tsx', '.mjs', '.cjs',
    '.py', '.java', '.go', '.rs', '.rb', '.cs', '.cpp', '.c', '.h',
]);

const TEST_PATTERNS = [
    /[/\\]__tests__[/\\]/i, /[/\\]spec[/\\]/i, /[/\\]test[/\\]/i,
    /[/\\]mocks?[/\\]/i, /[/\\]fixtures?[/\\]/i,
    /\.test\.[jt]sx?$/i, /\.spec\.[jt]sx?$/i,
];

function readFilesFromDirectory(dirPath, maxDepth = 5) {
    const files = [];
    const seen = new Set();
    function walk(currentPath, depth) {
        if (depth > maxDepth) return;
        let entries;
        try { entries = readdirSync(currentPath, { withFileTypes: true }); }
        catch { return; }
        for (const entry of entries) {
            const fullPath = join(currentPath, entry.name);
            if (entry.isDirectory()) {
                if (['node_modules', '.git', 'dist', 'build', '.next', '__pycache__',
                     'coverage', '.unravel', '.vscode', '.idea'].includes(entry.name)) continue;
                walk(fullPath, depth + 1);
                continue;
            }
            if (!entry.isFile()) continue;
            const ext = extname(entry.name).toLowerCase();
            if (!CODE_EXTENSIONS.has(ext)) continue;
            if (TEST_PATTERNS.some(p => p.test(fullPath.replace(/\\/g, '/')))) continue;
            const relativePath = fullPath.replace(dirPath, '').replace(/\\/g, '/').replace(/^\//, '');
            if (seen.has(relativePath)) continue;
            seen.add(relativePath);
            try {
                const content = readFileSync(fullPath, 'utf-8');
                if (content.length > 500_000) continue;
                files.push({ name: relativePath, content });
            } catch { /* skip */ }
        }
    }
    walk(dirPath, 0);
    return files;
}

// ── SARIF 2.1.0 builder ───────────────────────────────────────────────────────
const SARIF_RULES = {
    RACE_CONDITION: {
        id: 'RACE_CONDITION',
        name: 'GlobalWriteRace',
        shortDescription: { text: 'Global variable written before await in async function' },
        fullDescription: { text: 'A module-level variable is written before an await boundary. Concurrent callers see inconsistent state.' },
        helpUri: 'https://github.com/unravel-mcp#race-condition',
        defaultConfiguration: { level: 'error' },
    },
    FLOATING_PROMISE: {
        id: 'FLOATING_PROMISE',
        name: 'FloatingPromise',
        shortDescription: { text: 'Async function called without await' },
        fullDescription: { text: 'A user-defined async function is called without await. Errors are silently swallowed and execution order is non-deterministic.' },
        helpUri: 'https://github.com/unravel-mcp#floating-promise',
        defaultConfiguration: { level: 'error' },
    },
    STALE_MODULE_CAPTURE: {
        id: 'STALE_MODULE_CAPTURE',
        name: 'StaleModuleCapture',
        shortDescription: { text: 'Module-scope const captures a value that may become stale' },
        fullDescription: { text: 'A module-level const is initialized at load time from a mutable source. If the source changes later, this binding holds the old value.' },
        helpUri: 'https://github.com/unravel-mcp#stale-module-capture',
        defaultConfiguration: { level: 'warning' },
    },
    CONSTRUCTOR_CAPTURE: {
        id: 'CONSTRUCTOR_CAPTURE',
        name: 'ConstructorCapture',
        shortDescription: { text: 'Constructor captures reference that may mutate' },
        fullDescription: { text: 'A constructor assigns an external reference that may be mutated by the caller after construction, causing shared mutable state.' },
        helpUri: 'https://github.com/unravel-mcp#constructor-capture',
        defaultConfiguration: { level: 'warning' },
    },
    FOREACH_MUTATION: {
        id: 'FOREACH_MUTATION',
        name: 'ForEachMutation',
        shortDescription: { text: 'Array mutation inside forEach' },
        fullDescription: { text: 'An array is mutated (push/splice/shift) inside a forEach loop. This causes length inconsistencies and missed elements.' },
        helpUri: 'https://github.com/unravel-mcp#foreach-mutation',
        defaultConfiguration: { level: 'warning' },
    },
    LISTENER_PARITY: {
        id: 'LISTENER_PARITY',
        name: 'ListenerParity',
        shortDescription: { text: 'Event listener registered without corresponding removal' },
        fullDescription: { text: 'An addEventListener call has no matching removeEventListener, causing memory leaks and duplicate handler execution.' },
        helpUri: 'https://github.com/unravel-mcp#listener-parity',
        defaultConfiguration: { level: 'warning' },
    },
};

function buildSarif(astRaw, patternMatches, projectRoot, version = '3.4.0') {
    const results = [];
    const ruleSet = new Map();

    function addRule(ruleId) {
        if (!ruleSet.has(ruleId) && SARIF_RULES[ruleId]) {
            ruleSet.set(ruleId, SARIF_RULES[ruleId]);
        }
    }

    function locationFromFileLine(file, line) {
        return {
            physicalLocation: {
                artifactLocation: { uri: file.replace(/\\/g, '/'), uriBaseId: '%SRCROOT%' },
                region: { startLine: line || 1 },
            },
        };
    }

    // globalWriteRaces → RACE_CONDITION
    for (const race of (astRaw?.globalWriteRaces || [])) {
        addRule('RACE_CONDITION');
        results.push({
            ruleId: 'RACE_CONDITION',
            level: 'error',
            message: { text: `"${race.variable}" written before await in ${race.fn}() — concurrent callers see inconsistent state` },
            locations: [locationFromFileLine(race.file || 'unknown', race.line)],
        });
    }

    // floatingPromises → FLOATING_PROMISE
    for (const fp of (astRaw?.floatingPromises || [])) {
        addRule('FLOATING_PROMISE');
        results.push({
            ruleId: 'FLOATING_PROMISE',
            level: 'error',
            message: { text: `${fp.calledFn}() is async but called without await in ${fp.callerFn || 'unknown'}() — errors silently swallowed` },
            locations: [locationFromFileLine(fp.file || 'unknown', fp.line)],
        });
    }

    // staleModuleCaptures → STALE_MODULE_CAPTURE
    for (const cap of (astRaw?.staleModuleCaptures || [])) {
        addRule('STALE_MODULE_CAPTURE');
        results.push({
            ruleId: 'STALE_MODULE_CAPTURE',
            level: 'warning',
            message: { text: `"${cap.variable}" initialized at module load time — may become stale if source mutates (severity: ${cap.severity || 'high'})` },
            locations: [locationFromFileLine(cap.file || 'unknown', cap.line)],
        });
    }

    // constructorCaptures → CONSTRUCTOR_CAPTURE
    for (const cap of (astRaw?.constructorCaptures || [])) {
        addRule('CONSTRUCTOR_CAPTURE');
        results.push({
            ruleId: 'CONSTRUCTOR_CAPTURE',
            level: 'warning',
            message: { text: `Constructor in "${cap.className || 'unknown'}" captures "${cap.sourceBinding}" — caller may mutate after construction` },
            locations: [locationFromFileLine(cap.file || 'unknown', cap.line)],
        });
    }

    // forEachMutations → FOREACH_MUTATION
    for (const m of (astRaw?.forEachMutations || [])) {
        addRule('FOREACH_MUTATION');
        results.push({
            ruleId: 'FOREACH_MUTATION',
            level: 'warning',
            message: { text: `Array "${m.array || 'unknown'}" mutated inside forEach in ${m.fn || 'unknown'}()` },
            locations: [locationFromFileLine(m.file || 'unknown', m.line)],
        });
    }

    // listenerParity → LISTENER_PARITY
    for (const lp of (astRaw?.listenerParity || [])) {
        addRule('LISTENER_PARITY');
        results.push({
            ruleId: 'LISTENER_PARITY',
            level: 'warning',
            message: { text: `"${lp.event || 'unknown'}" event listener registered without removal in ${lp.fn || 'unknown'}()` },
            locations: [locationFromFileLine(lp.file || 'unknown', lp.line)],
        });
    }

    const sarif = {
        version: '2.1.0',
        $schema: 'https://schemastore.azurewebsites.net/schemas/json/sarif-2.1.0-rtm.5.json',
        runs: [{
            tool: {
                driver: {
                    name: 'Unravel',
                    version,
                    informationUri: 'https://github.com/unravel-mcp',
                    rules: [...ruleSet.values()],
                },
            },
            originalUriBaseIds: {
                '%SRCROOT%': { uri: pathToFileURL(projectRoot).href + '/' },
            },
            results,
            ...(patternMatches.length > 0 ? {
                _unravelPatternHints: patternMatches.slice(0, 5).map(m => ({
                    patternId: m.pattern?.id || m.patternId,
                    confidence: m.confidence,
                    hitCount: m.pattern?.hitCount || m.hitCount,
                })),
            } : {}),
        }],
    };

    return { sarif, resultCount: results.length, ruleCount: ruleSet.size };
}

// ── Determine critical exit code ──────────────────────────────────────────────
function isCritical(astRaw, patternMatches, threshold = 0.9) {
    // Exit 1 if: any race condition OR floating promise exists (always critical)
    if ((astRaw?.globalWriteRaces?.length || 0) > 0) return true;
    if ((astRaw?.floatingPromises?.length || 0) > 0) return true;
    // OR if a matched pattern has weight >= threshold
    if (patternMatches.some(m => (m.confidence || 0) >= threshold)) return true;
    return false;
}

// ── Main ──────────────────────────────────────────────────────────────────────
async function main() {
    const format = args.format || 'text';
    const detail = args.detail || 'standard';
    const symptom = args.symptom || 'general analysis — identify all structural issues';
    const threshold = parseFloat(args.threshold || '0.9');

    let dirPath;
    try {
        dirPath = resolve(args.directory);
        if (!existsSync(dirPath)) throw new Error(`Directory not found: ${dirPath}`);
    } catch (e) {
        process.stderr.write(`[unravel-cli] Error: ${e.message}\n`);
        process.exit(2);
    }

    process.stderr.write(`[unravel-cli] Loading core modules...\n`);

    let orchestrate, initParser, matchPatterns, loadPatterns, getPatternCount;
    let learnFromDiagnosis, savePatterns;
    try {
        const orchestrateModule = await import(coreModule('orchestrate.js'));
        orchestrate = orchestrateModule.orchestrate;
        const astEngine = await import(coreModule('ast-engine-ts.js'));
        initParser = astEngine.initParser;
        const patternStore = await import(coreModule('pattern-store.js'));
        matchPatterns = patternStore.matchPatterns;
        loadPatterns = patternStore.loadPatterns;
        getPatternCount = patternStore.getPatternCount;
        await initParser();
    } catch (e) {
        process.stderr.write(`[unravel-cli] Fatal: could not load core modules — ${e.message}\n`);
        process.exit(2);
    }

    // Load patterns
    const patternFile = join(dirPath, '.unravel', 'patterns.json');
    try { await loadPatterns(patternFile); } catch { /* no patterns yet */ }

    process.stderr.write(`[unravel-cli] Reading ${dirPath}...\n`);
    const files = readFilesFromDirectory(dirPath);
    process.stderr.write(`[unravel-cli] Found ${files.length} source files. Running analysis...\n`);

    let result;
    try {
        result = await orchestrate(files, symptom, {
            _mode: 'mcp',
            detail,
            provider: 'none',
            apiKey: 'none',
            model: 'none',
            mode: 'debug',
            onProgress: (msg) => { if (typeof msg === 'string') process.stderr.write(`[unravel] ${msg}\n`); },
        });
    } catch (e) {
        process.stderr.write(`[unravel-cli] Analysis failed: ${e.message}\n`);
        process.exit(2);
    }

    const base = result.mcpEvidence || result;
    const astRaw = base.evidence?.astRaw || null;
    const patternMatches = astRaw ? matchPatterns(astRaw) : [];

    let output;
    let exitCode = isCritical(astRaw, patternMatches, threshold) ? 1 : 0;

    if (format === 'sarif') {
        const { sarif, resultCount, ruleCount } = buildSarif(astRaw, patternMatches, dirPath);
        output = JSON.stringify(sarif, null, 2);
        process.stderr.write(`[unravel-cli] SARIF: ${resultCount} findings across ${ruleCount} rule types.\n`);
    } else if (format === 'json') {
        output = JSON.stringify({
            symptom,
            directory: dirPath,
            filesAnalyzed: files.length,
            findings: {
                globalWriteRaces: astRaw?.globalWriteRaces || [],
                floatingPromises: astRaw?.floatingPromises || [],
                staleModuleCaptures: astRaw?.staleModuleCaptures || [],
                constructorCaptures: astRaw?.constructorCaptures || [],
                forEachMutations: astRaw?.forEachMutations || [],
                listenerParity: astRaw?.listenerParity || [],
            },
            patternMatches: patternMatches.slice(0, 5).map(m => ({
                patternId: m.pattern?.id,
                confidence: m.confidence,
                bugType: m.pattern?.bugType,
            })),
            critical: exitCode === 1,
            exitCode,
        }, null, 2);
    } else {
        // Text format
        const lines = [
            `Unravel Analysis — ${dirPath}`,
            `Symptom: ${symptom}`,
            `Files: ${files.length} | Patterns: ${getPatternCount()}`,
            '',
        ];

        const races = astRaw?.globalWriteRaces || [];
        const promises = astRaw?.floatingPromises || [];
        const stale = astRaw?.staleModuleCaptures || [];
        const ctor = astRaw?.constructorCaptures || [];

        if (races.length) {
            lines.push(`RACE CONDITIONS (${races.length}):`);
            races.forEach(r => lines.push(`  [ERROR] ${r.file}:${r.line} — "${r.variable}" written before await in ${r.fn}()`));
        }
        if (promises.length) {
            lines.push(`FLOATING PROMISES (${promises.length}):`);
            promises.forEach(p => lines.push(`  [ERROR] ${p.file}:${p.line} — ${p.calledFn}() async but not awaited`));
        }
        if (stale.length) {
            lines.push(`STALE MODULE CAPTURES (${stale.length}):`);
            stale.forEach(s => lines.push(`  [WARN]  ${s.file}:${s.line} — "${s.variable}" captured at module load`));
        }
        if (ctor.length) {
            lines.push(`CONSTRUCTOR CAPTURES (${ctor.length}):`);
            ctor.forEach(c => lines.push(`  [WARN]  ${c.file}:${c.line} — "${c.sourceBinding}" captured in constructor`));
        }

        if (!races.length && !promises.length && !stale.length && !ctor.length) {
            lines.push('No structural issues found in standard mode.');
        }

        lines.push('');
        lines.push(exitCode === 1 ? 'VERDICT: CRITICAL — exit 1' : 'VERDICT: CLEAN — exit 0');
        output = lines.join('\n');
    }

    if (args.output) {
        writeFileSync(args.output, output, 'utf-8');
        process.stderr.write(`[unravel-cli] Output written to ${args.output}\n`);
    } else {
        process.stdout.write(output + '\n');
    }

    process.exit(exitCode);
}

main();
