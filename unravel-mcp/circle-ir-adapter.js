// ─────────────────────────────────────────────────────────────────────────────
// circle-ir-adapter.js — Supplementary reliability/performance analysis
//
// Uses circle-ir's 36-pass pipeline to surface bugs Unravel's core AST engine
// doesn't detect: serial-await, null-deref, resource-leak, infinite-loop, etc.
//
// Design contract:
//   - ADDITIVE ONLY. Never replaces or modifies existing Unravel output.
//   - GRACEFUL DEGRADATION. Any error → returns [] and logs to stderr.
//   - DEDUPLICATION. Excludes rules that overlap with Unravel's detectors.
//   - INIT ONCE. circle-ir's WASM parser is initialized once per process.
//
// Excluded categories: 'security' (taint), 'maintainability', 'architecture'
//   → not bugs in a debugging context; would pollute critical_signal with noise.
// Excluded rules (overlap or noise):
//   missing-await    → overlaps with Unravel's floating_promise detector
//   leaked-global    → overlaps with Unravel's globalWriteRaces detector
//   variable-shadowing → too broad; noisy in bug diagnosis context
//   unused-variable  → noise in diagnosis context
//   react-inline-jsx → performance micro-opt, not a reliability bug
//   missing-public-doc / todo-in-prod / stale-doc-ref → code quality, not bugs
//   dependency-fan-out / orphan-module / circular-dependency / deep-inheritance
//                    → architecture smell, out of scope for bug diagnosis
// ─────────────────────────────────────────────────────────────────────────────

import { extname } from 'path';

// ── Language detection (circle-ir supported langs only) ───────────────────
const EXT_TO_LANG = {
    '.js':   'javascript',
    '.mjs':  'javascript',
    '.cjs':  'javascript',
    '.ts':   'typescript',
    '.tsx':  'typescript',
    '.java': 'java',
    '.py':   'python',
    '.rs':   'rust',
    '.sh':   'bash',
    '.bash': 'bash',
};

// ── Rules suppressed even within reliability/performance categories ────────
const EXCLUDED_RULES = new Set([
    'missing-await',         // Overlaps with Unravel's floating_promise detector
    'leaked-global',         // Overlaps with Unravel's globalWriteRaces detector
    'variable-shadowing',    // Too broad/noisy in bug diagnosis context
    'unused-variable',       // Noise in diagnosis context
    'react-inline-jsx',      // Performance micro-opt, not a reliability bug
    'missing-public-doc',    // Code quality, not a bug
    'todo-in-prod',          // Not a bug
    'stale-doc-ref',         // Not a bug
    'dependency-fan-out',    // Architecture smell
    'orphan-module',         // Architecture
    'circular-dependency',   // Architecture
    'deep-inheritance',      // Architecture
]);

// ── Categories to include ─────────────────────────────────────────────────
const KEEP_CATEGORIES = new Set(['reliability', 'performance']);

// ── Severity ordering for sort ────────────────────────────────────────────
const SEV_ORDER = { critical: 0, high: 1, medium: 2, low: 3 };

// ── Singleton: init circle-ir WASM parser once per process ───────────────
let _circleIrModule = null;   // { analyze } after successful init
let _initPromise    = null;   // in-flight init promise (prevents double-init)

async function getCircleIr() {
    if (_circleIrModule) return _circleIrModule;
    if (_initPromise)    return _initPromise;

    _initPromise = (async () => {
        try {
            const { initAnalyzer, analyze } = await import('circle-ir');
            await initAnalyzer();                         // WASM boot (~150ms, once)
            _circleIrModule = { analyze };
            process.stderr.write('[circle-ir] WASM parser ready.\n');
            return _circleIrModule;
        } catch (err) {
            process.stderr.write(`[circle-ir] Init failed (non-fatal): ${err.message}\n`);
            _circleIrModule = null;
            _initPromise    = null;   // allow retry on next call
            return null;
        }
    })();

    return _initPromise;
}

// ── Public API ────────────────────────────────────────────────────────────
/**
 * Run circle-ir supplementary analysis on the provided files.
 *
 * @param {Array<{name: string, content: string}>} files
 * @returns {Promise<Array<{ruleId, category, severity, level, file, line, endLine, message, fix, cwe}>>}
 */
export async function runCircleIrAnalysis(files) {
    const circleIr = await getCircleIr();
    if (!circleIr) return [];                            // init failed — no-op

    const findings = [];
    let filesAnalyzed = 0;

    for (const file of files) {
        const lang = EXT_TO_LANG[extname(file.name).toLowerCase()];
        if (!lang) continue;                             // unsupported lang — skip

        try {
            const result = await circleIr.analyze(file.content, file.name, lang);
            filesAnalyzed++;

            for (const f of (result.findings ?? [])) {
                // Category gate — only reliability + performance
                if (!KEEP_CATEGORIES.has(f.category)) continue;
                // Rule exclusion gate
                if (EXCLUDED_RULES.has(f.rule_id)) continue;
                // Level gate — skip 'none' (informational only)
                if (f.level === 'none') continue;

                findings.push({
                    ruleId:   f.rule_id,
                    category: f.category,
                    severity: f.severity,
                    level:    f.level,
                    file:     f.file,
                    line:     f.line,
                    endLine:  f.end_line ?? null,
                    message:  f.message,
                    fix:      f.fix   ?? null,
                    cwe:      f.cwe   ?? null,
                });
            }
        } catch (fileErr) {
            // Per-file errors are non-fatal — log and continue
            process.stderr.write(
                `[circle-ir] Error analyzing ${file.name} (non-fatal): ${fileErr.message}\n`
            );
        }
    }

    // Sort: severity DESC, then file+line ASC
    findings.sort((a, b) => {
        const sa = SEV_ORDER[a.severity] ?? 9;
        const sb = SEV_ORDER[b.severity] ?? 9;
        if (sa !== sb) return sa - sb;
        if (a.file !== b.file) return a.file.localeCompare(b.file);
        return (a.line ?? 0) - (b.line ?? 0);
    });

    if (filesAnalyzed > 0) {
        process.stderr.write(
            `[circle-ir] ${findings.length} supplementary finding(s) across ${filesAnalyzed} analyzed file(s).\n`
        );
    }

    return findings;
}
