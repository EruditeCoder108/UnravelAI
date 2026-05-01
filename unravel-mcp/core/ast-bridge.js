// ═══════════════════════════════════════════════════════════════
// ast-bridge.js  — Pure-JS structural extractor (no WASM)
//
// Extracts imports, exports, functions, and classes using fast
// regex patterns. This is how bundlers (webpack, rollup) and
// linters (eslint) do quick structural scanning — no AST needed.
//
// Zero external dependencies — works in ANY environment:
// - VS Code extension host (no fetch(), no WASM)
// - Browser (used as the fallback from ast-bridge-browser.js)
// - Node.js / tests
//
// This is the FALLBACK for ast-bridge-browser.js when WASM fails.
// The primary (WASM) path gives richer data; this gives reliable data.
// ═══════════════════════════════════════════════════════════════

// ── normalizeKey ─────────────────────────────────────────────────────────────
function normalizeKey(p) {
    return p.replace(/\\/g, '/');
}

// ── Import source extractor ───────────────────────────────────────────────────
// Handles all common JS/TS import patterns:
//   import X from './y'
//   import { X, Y } from './y'
//   import * as X from './y'
//   export { X } from './y'
//   export * from './y'
//   const X = require('./y')
//   const X = require('./y').something
const IMPORT_PATTERNS = [
    // ESM static imports/re-exports
    /\bimport\s+(?:[^'"]+?\s+from\s+)?['"]([^'"]+)['"]/g,
    /\bexport\s+(?:\*|{[^}]*})\s+from\s+['"]([^'"]+)['"]/g,
    // CJS require()
    /\brequire\s*\(\s*['"]([^'"]+)['"]\s*\)/g,
    // Dynamic import()
    /\bimport\s*\(\s*['"]([^'"]+)['"]\s*\)/g,
];

function extractImportSources(code) {
    // Strip line comments and block comments to avoid false matches
    const stripped = code
        .replace(/\/\/[^\n]*/g, '')
        .replace(/\/\*[\s\S]*?\*\//g, '');

    const sources = new Set();
    for (const pattern of IMPORT_PATTERNS) {
        pattern.lastIndex = 0; // reset global regex
        let m;
        while ((m = pattern.exec(stripped)) !== null) {
            const src = m[1];
            if (src && src !== '') sources.add(src);
        }
    }
    return [...sources];
}

// ── Comment stripper (shared by function + class extractors) ─────────────────
// Removes line comments and block comments before regex matching.
// Preserves newlines so that line numbers remain accurate.
// NOTE: This is intentionally kept identical to the strip logic already used
// in extractImportSources — consistent approach across all extractors.
function stripComments(code) {
    return code
        .replace(/\/\/[^\n]*/g, '')          // strip // line comments
        .replace(/\/\*[\s\S]*?\*\//g, m => {  // strip /* block comments */
            // Preserve newlines so line count stays accurate
            return m.replace(/[^\n]/g, '');
        });
}

// ── Function extractor ────────────────────────────────────────────────────────
const FN_PATTERNS = [
    // Named function declarations (including async/export/generator)
    /(?:export\s+(?:default\s+)?)?(?:async\s+)?function\s*\*?\s+(\w+)\s*\(/gm,
    // Arrow / function expression: const|let|var name = ...
    /(?:const|let|var)\s+(\w+)\s*=\s*(?:async\s+)?(?:\([^)]*\)|[\w]+)\s*=>/gm,
    /(?:const|let|var)\s+(\w+)\s*=\s*(?:async\s+)?function\s*\*?\s*\(/gm,
    // MCP tool registrations behave like route handlers and need to be searchable.
    /\bserver\.tool\s*\(\s*['"`]([\w-]+)['"`]/gm,
];

function extractFunctions(code) {
    const stripped = stripComments(code); // Fix 1: prevent commented-out fn defs from being indexed
    const fns = [];
    const seen = new Set();

    for (const pattern of FN_PATTERNS) {
        pattern.lastIndex = 0;
        let m;
        while ((m = pattern.exec(stripped)) !== null) {
            const name = m[1];
            if (!name || seen.has(name)) continue;
            seen.add(name);
            const before = stripped.slice(0, m.index);
            const lineNum = (before.match(/\n/g) || []).length + 1;
            fns.push({ name, lineRange: [lineNum, lineNum] });
        }
    }
    for (const method of extractClassMethods(stripped)) {
        if (seen.has(method.name)) continue;
        seen.add(method.name);
        fns.push(method);
    }
    return fns;
}

const CALL_SKIP_WORDS = new Set([
    'if', 'for', 'while', 'switch', 'catch', 'function', 'return', 'await',
    'typeof', 'new', 'class', 'super', 'import', 'require',
]);

function findMatchingBrace(code, openIndex) {
    let depth = 0;
    for (let i = openIndex; i < code.length; i++) {
        const ch = code[i];
        if (ch === '{') depth++;
        else if (ch === '}') {
            depth--;
            if (depth === 0) return i;
        }
    }
    return -1;
}

function extractClassMethods(stripped) {
    const methods = [];
    const seen = new Set();
    const classPattern = /(?:export\s+(?:default\s+)?)?class\s+\w+(?:\s+extends\s+[\w.]+)?\s*\{/gm;
    let classMatch;

    while ((classMatch = classPattern.exec(stripped)) !== null) {
        const classOpen = stripped.indexOf('{', classPattern.lastIndex - 1);
        if (classOpen < 0) continue;
        const classClose = findMatchingBrace(stripped, classOpen);
        if (classClose < 0) continue;

        const body = stripped.slice(classOpen + 1, classClose);
        const bodyOffset = classOpen + 1;
        const methodPattern = /(?:^|[\r\n]\s*)(?:(?:public|private|protected|static|async|override|readonly)\s+)*([A-Za-z_$][\w$]*)\s*\([^)]*\)\s*(?::\s*[^{;]+)?\s*\{/gm;
        let methodMatch;
        while ((methodMatch = methodPattern.exec(body)) !== null) {
            const name = methodMatch[1];
            if (!name || CALL_SKIP_WORDS.has(name)) continue;
            const openBrace = body.indexOf('{', methodPattern.lastIndex - 1);
            if (openBrace < 0) continue;
            const closeBrace = findMatchingBrace(body, openBrace);
            if (closeBrace < 0) continue;

            const absoluteIndex = bodyOffset + methodMatch.index;
            const lineNum = (stripped.slice(0, absoluteIndex).match(/\n/g) || []).length + 1;
            const key = `${name}:${lineNum}`;
            if (!seen.has(key)) {
                seen.add(key);
                methods.push({ name, lineRange: [lineNum, lineNum] });
            }

            methodPattern.lastIndex = closeBrace + 1;
        }

        classPattern.lastIndex = classClose + 1;
    }

    return methods;
}

function extractCalls(code) {
    const stripped = stripComments(code);
    const calls = [];
    const seen = new Set();
    const fnBodies = [];

    const fnPatterns = [
        /(?:export\s+(?:default\s+)?)?(?:async\s+)?function\s*\*?\s+(\w+)\s*\([^)]*\)\s*\{/gm,
        /(?:const|let|var)\s+(\w+)\s*=\s*(?:async\s+)?(?:\([^)]*\)|[\w$]+)\s*=>\s*\{/gm,
        /(?:const|let|var)\s+(\w+)\s*=\s*(?:async\s+)?function\s*\*?\s*\([^)]*\)\s*\{/gm,
    ];

    for (const pattern of fnPatterns) {
        pattern.lastIndex = 0;
        let m;
        while ((m = pattern.exec(stripped)) !== null) {
            const caller = m[1];
            const openBrace = stripped.indexOf('{', pattern.lastIndex - 1);
            if (!caller || openBrace < 0) continue;
            const closeBrace = findMatchingBrace(stripped, openBrace);
            if (closeBrace < 0) continue;
            fnBodies.push({ caller, body: stripped.slice(openBrace + 1, closeBrace) });
        }
    }
    for (const method of extractClassMethodBodies(stripped)) {
        fnBodies.push(method);
    }

    const callPattern = /\b(?:[A-Za-z_$][\w$]*\s*\.\s*)*([A-Za-z_$][\w$]*)\s*\(/g;
    for (const { caller, body } of fnBodies) {
        callPattern.lastIndex = 0;
        let m;
        while ((m = callPattern.exec(body)) !== null) {
            const callee = m[1];
            if (!callee || callee === caller || CALL_SKIP_WORDS.has(callee)) continue;
            const key = `${caller}->${callee}`;
            if (seen.has(key)) continue;
            seen.add(key);
            calls.push({ caller, callee });
        }
    }

    return calls;
}

function extractClassMethodBodies(stripped) {
    const bodies = [];
    const classPattern = /(?:export\s+(?:default\s+)?)?class\s+\w+(?:\s+extends\s+[\w.]+)?\s*\{/gm;
    let classMatch;

    while ((classMatch = classPattern.exec(stripped)) !== null) {
        const classOpen = stripped.indexOf('{', classPattern.lastIndex - 1);
        if (classOpen < 0) continue;
        const classClose = findMatchingBrace(stripped, classOpen);
        if (classClose < 0) continue;

        const body = stripped.slice(classOpen + 1, classClose);
        const methodPattern = /(?:^|[\r\n]\s*)(?:(?:public|private|protected|static|async|override|readonly)\s+)*([A-Za-z_$][\w$]*)\s*\([^)]*\)\s*(?::\s*[^{;]+)?\s*\{/gm;
        let methodMatch;
        while ((methodMatch = methodPattern.exec(body)) !== null) {
            const caller = methodMatch[1];
            if (!caller || CALL_SKIP_WORDS.has(caller)) continue;
            const openBrace = body.indexOf('{', methodPattern.lastIndex - 1);
            if (openBrace < 0) continue;
            const closeBrace = findMatchingBrace(body, openBrace);
            if (closeBrace < 0) continue;
            bodies.push({ caller, body: body.slice(openBrace + 1, closeBrace) });
            methodPattern.lastIndex = closeBrace + 1;
        }

        classPattern.lastIndex = classClose + 1;
    }

    return bodies;
}

// ── Class extractor ───────────────────────────────────────────────────────────
const CLASS_PATTERN = /(?:export\s+(?:default\s+)?)?class\s+(\w+)(?:\s+extends\s+[\w.]+)?\s*\{/gm;

function extractClasses(code) {
    const stripped = stripComments(code); // Fix 1: prevent commented-out class defs from being indexed
    const classes = [];
    const seen = new Set();
    CLASS_PATTERN.lastIndex = 0;
    let m;
    while ((m = CLASS_PATTERN.exec(stripped)) !== null) {
        const name = m[1];
        if (!name || seen.has(name)) continue;
        seen.add(name);
        const before = stripped.slice(0, m.index);
        const lineNum = (before.match(/\n/g) || []).length + 1;
        classes.push({ name, lineRange: [lineNum, lineNum] });
    }
    return classes;
}

// ── Export extractor ──────────────────────────────────────────────────────────
const EXPORT_NAMED_PATTERN = /\bexport\s+(?:const|let|var|function|class)\s+(\w+)/gm;
const EXPORT_CLAUSE_PATTERN = /\bexport\s+\{([^}]+)\}/gm;

function extractExports(code) {
    const exports = [];
    const seen = new Set();

    EXPORT_NAMED_PATTERN.lastIndex = 0;
    let m;
    while ((m = EXPORT_NAMED_PATTERN.exec(code)) !== null) {
        if (!seen.has(m[1])) { seen.add(m[1]); exports.push({ name: m[1] }); }
    }
    EXPORT_CLAUSE_PATTERN.lastIndex = 0;
    while ((m = EXPORT_CLAUSE_PATTERN.exec(code)) !== null) {
        for (const spec of m[1].split(',')) {
            const name = spec.trim().split(/\s+as\s+/).pop().trim();
            if (name && !seen.has(name)) { seen.add(name); exports.push({ name }); }
        }
    }
    return exports;
}

// ── Import path resolver ──────────────────────────────────────────────────────
function resolveImportPath(source, importerPath, knownPaths) {
    if (!source.startsWith('.') && !source.startsWith('/')) return null;

    const importerDir = importerPath.split('/').slice(0, -1).join('/');
    const joined = importerDir ? `${importerDir}/${source}` : source;
    const parts = joined.split('/');
    const resolved = [];
    for (const part of parts) {
        if (part === '..') resolved.pop();
        else if (part !== '.') resolved.push(part);
    }
    const base = resolved.join('/');

    if (knownPaths.has(base)) return base;
    for (const ext of ['.js', '.ts', '.jsx', '.tsx', '.mjs', '.cjs']) {
        const c = base + ext;
        if (knownPaths.has(c)) return c;
    }
    for (const ext of ['.js', '.ts', '.jsx', '.tsx']) {
        const c = `${base}/index${ext}`;
        if (knownPaths.has(c)) return c;
    }
    // Fix 3: Fuzzy stem fallback — skip ambiguous stems that appear in many
    // directories (index, types, utils, etc.). If multiple files share the same
    // stem AND the stem is a common generic name, returning the first hit would
    // link the wrong file into the Knowledge Graph. Return null instead and let
    // the agent handle the unresolved import gracefully.
    const AMBIGUOUS_STEMS = new Set([
        'index', 'types', 'utils', 'helpers', 'constants', 'common',
        'shared', 'base', 'config', 'main', 'core', 'hooks', 'styles',
        'theme', 'api', 'model', 'models', 'service', 'services',
    ]);
    const sourceBase = source.split('/').pop();
    const sourceStem = sourceBase.replace(/\.[^.]+$/, '');
    if (AMBIGUOUS_STEMS.has(sourceStem)) return null; // too many matches — safer than a wrong link
    for (const knownPath of knownPaths) {
        const knownBase = knownPath.split('/').pop();
        const knownStem = knownBase.replace(/\.[^.]+$/, '');
        if (knownStem === sourceStem || knownBase === sourceBase) return knownPath;
    }
    return null;
}

// ── analyzeFile — pure-JS structural extraction ───────────────────────────────
function analyzeFile(name, content) {
    try {
        const ext = name.split('.').pop().toLowerCase();
        if (!['js', 'jsx', 'ts', 'tsx', 'mjs', 'cjs'].includes(ext)) return null;
        const importSources = extractImportSources(content);
        return {
            functions: extractFunctions(content),
            classes:   extractClasses(content),
            imports:   importSources.map(source => ({ source, resolvedPath: null })),
            exports:   extractExports(content),
            calls:     extractCalls(content),
        };
    } catch {
        return null;
    }
}

// ── Main bridge function ──────────────────────────────────────────────────────

/**
 * Attach structuralAnalysis to each file object.
 * Pure-JS regex — no WASM, no Node.js APIs. Works in all environments.
 */
export async function attachStructuralAnalysis(files) {
    if (!files || files.length === 0) return files;

    const knownPaths = new Set(files.map(f => normalizeKey(f.name)));
    let attached = 0;
    let resolvedEdges = 0;

    for (const file of files) {
        const normalizedPath = normalizeKey(file.name);
        const info = analyzeFile(file.name, file.content || '');

        if (info) {
            attached++;
            for (const imp of info.imports) {
                imp.resolvedPath = resolveImportPath(imp.source, normalizedPath, knownPaths);
                if (imp.resolvedPath) resolvedEdges++;
            }
            file.structuralAnalysis = info;
        } else {
            file.structuralAnalysis = null;
        }
    }

    console.log(`[AST-BRIDGE] Regex: attached=${attached}/${files.length}, resolvedEdges=${resolvedEdges}`);
    return files;
}

/**
 * Incremental update variant — same logic, subset of files.
 */
export async function attachStructuralAnalysisToChanged(changedFiles, allFiles) {
    if (!changedFiles || changedFiles.length === 0) return changedFiles;
    const knownPaths = new Set((allFiles || changedFiles).map(f => normalizeKey(f.name)));

    for (const file of changedFiles) {
        const normalizedPath = normalizeKey(file.name);
        const info = analyzeFile(file.name, file.content || '');
        if (info) {
            for (const imp of info.imports) {
                imp.resolvedPath = resolveImportPath(imp.source, normalizedPath, knownPaths);
            }
            file.structuralAnalysis = info;
        } else {
            file.structuralAnalysis = null;
        }
    }
    return changedFiles;
}
