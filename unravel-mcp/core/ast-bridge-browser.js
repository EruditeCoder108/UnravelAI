// ═══════════════════════════════════════════════════════════════
// ast-bridge-browser.js — WASM tree-sitter AST bridge (browser)
//
// ▸ WASM approach (primary): web-tree-sitter loaded via fetch()
//   which is native in all browsers. WASM files are served from
//   /wasm/ by the Vite dev server and Netlify in production.
//   Gives richer extraction: exact line ranges, TypeScript type
//   annotations, parameter names, method definitions in classes.
//
// ▸ Regex fallback: if WASM fails for any reason (CSP, quota,
//   old browser), falls back to ast-bridge.js regex extractor.
//   Same output shape — callers never need to know which ran.
//   Loaded lazily (dynamic import) to avoid bundling ast-engine-ts.js
//   unless actually needed.
//
// Compatible with: web-tree-sitter@0.22.4 + ABI-13 WASM files
// WASM files served from: public/wasm/ → /wasm/ at runtime
// ═══════════════════════════════════════════════════════════════

// NOTE: ast-bridge.js is loaded lazily on demand (see regexFallback helper below)
// This avoids including the ast-engine-ts.js WASM path in the initial bundle.

// ── Globals ──────────────────────────────────────────────────────────────────

let _parser   = null;
let _jsLang   = null;
let _tsLang   = null;
let _tsxLang  = null;
let _initDone = false;
let _initFailed = false;

// ── WASM initializer ──────────────────────────────────────────────────────────

async function initWasm() {
    if (_initDone || _initFailed) return !_initFailed;

    try {
        // Dynamic import so Vite can tree-shake this in SSR/Node builds
        // Cache the import so the module is only fetched once
        const tsModule  = await import('web-tree-sitter');
        const TreeSitter = tsModule.default ?? tsModule;

        // locateFile tells tree-sitter where to fetch tree-sitter.wasm from.
        // In production (Netlify) and dev (Vite), /wasm/ serves from public/wasm/.
        await TreeSitter.init({
            locateFile: (filename) => `/wasm/${filename}`,
        });

        _jsLang  = await TreeSitter.Language.load('/wasm/tree-sitter-javascript.wasm');
        _tsLang  = await TreeSitter.Language.load('/wasm/tree-sitter-typescript.wasm');
        _tsxLang = await TreeSitter.Language.load('/wasm/tree-sitter-tsx.wasm');
        _parser  = new TreeSitter();

        _initDone = true;
        console.log('[AST-BROWSER] Tree-sitter WASM initialized (ABI-13 compatible)');
        return true;
    } catch (err) {
        _initFailed = true;
        console.warn('[AST-BROWSER] WASM init failed, regex fallback active:', err.message);
        return false;
    }
}

// ── Language picker ───────────────────────────────────────────────────────────

function pickLanguage(filename) {
    const ext = filename.split('.').pop().toLowerCase();
    if (ext === 'tsx') return _tsxLang;
    if (ext === 'ts')  return _tsLang;
    return _jsLang; // js, jsx, mjs, cjs
}

// ── AST extractors ────────────────────────────────────────────────────────────

function extractImports(rootNode, code) {
    const imports = [];
    for (const node of rootNode.namedChildren) {
        // ESM: import x from './y', import { x } from './y', import * as x from './y'
        if (node.type === 'import_statement') {
            const src = node.namedChildren.find(n => n.type === 'string');
            if (src) {
                const source = src.text.replace(/['"]/g, '');
                imports.push({ source, resolvedPath: null });
            }
        }
        // ESM re-export: export { x } from './y', export * from './y'
        if (node.type === 'export_statement') {
            const src = node.namedChildren.find(n => n.type === 'string');
            if (src) {
                const source = src.text.replace(/['"]/g, '');
                imports.push({ source, resolvedPath: null });
            }
        }
    }

    // CJS require() — regex scan as supplement (tree-sitter JS grammar
    // models require as a call_expression so we'd need to walk deeply)
    const requireRe = /\brequire\s*\(\s*['"]([^'"]+)['"]\s*\)/g;
    let m;
    const seen = new Set(imports.map(i => i.source));
    while ((m = requireRe.exec(code)) !== null) {
        if (!seen.has(m[1])) { seen.add(m[1]); imports.push({ source: m[1], resolvedPath: null }); }
    }
    return imports;
}

function nodeLine(node) {
    return node.startPosition.row + 1; // 0-indexed → 1-indexed
}

function extractFunctions(rootNode) {
    const fns = [];
    const seen = new Set();

    function walk(node) {
        // Named function declarations: function foo() {}, async function* foo() {}
        if (node.type === 'function_declaration' || node.type === 'generator_function_declaration') {
            const nameNode = node.namedChildren.find(n => n.type === 'identifier');
            if (nameNode && !seen.has(nameNode.text)) {
                seen.add(nameNode.text);
                fns.push({ name: nameNode.text, lineRange: [nodeLine(node), node.endPosition.row + 1] });
            }
        }
        // Arrow/expression: const foo = () => {}, const foo = function() {}
        if ((node.type === 'lexical_declaration' || node.type === 'variable_declaration')) {
            for (const declarator of node.namedChildren) {
                if (declarator.type !== 'variable_declarator') continue;
                const name = declarator.namedChildren.find(n => n.type === 'identifier');
                const val  = declarator.namedChildren.find(n =>
                    n.type === 'arrow_function' || n.type === 'function' || n.type === 'generator_function'
                );
                if (name && val && !seen.has(name.text)) {
                    seen.add(name.text);
                    fns.push({ name: name.text, lineRange: [nodeLine(declarator), declarator.endPosition.row + 1] });
                }
            }
        }
        // Method definitions inside class bodies
        if (node.type === 'method_definition') {
            const nameNode = node.namedChildren.find(n => n.type === 'property_identifier');
            if (nameNode && !seen.has(nameNode.text)) {
                seen.add(nameNode.text);
                fns.push({ name: nameNode.text, lineRange: [nodeLine(node), node.endPosition.row + 1] });
            }
        }
        for (const child of node.namedChildren) walk(child);
    }

    walk(rootNode);
    return fns;
}

function extractClasses(rootNode) {
    const classes = [];
    const seen = new Set();

    function walk(node) {
        if (node.type === 'class_declaration') {
            const nameNode = node.namedChildren.find(n => n.type === 'type_identifier' || n.type === 'identifier');
            if (nameNode && !seen.has(nameNode.text)) {
                seen.add(nameNode.text);
                classes.push({ name: nameNode.text, lineRange: [nodeLine(node), node.endPosition.row + 1] });
            }
        }
        for (const child of node.namedChildren) walk(child);
    }

    walk(rootNode);
    return classes;
}

function extractExports(rootNode) {
    const exports = [];
    const seen = new Set();

    for (const node of rootNode.namedChildren) {
        if (node.type !== 'export_statement') continue;
        // export const/let/var/function/class name
        const decl = node.namedChildren.find(n =>
            ['function_declaration', 'class_declaration', 'lexical_declaration', 'variable_declaration'].includes(n.type)
        );
        if (decl) {
            const nameNode = decl.namedChildren.find(n =>
                n.type === 'identifier' || n.type === 'type_identifier'
            );
            if (nameNode && !seen.has(nameNode.text)) {
                seen.add(nameNode.text); exports.push({ name: nameNode.text });
            }
        }
        // export { a, b as c }
        const clause = node.namedChildren.find(n => n.type === 'export_clause');
        if (clause) {
            for (const spec of clause.namedChildren) {
                if (spec.type !== 'export_specifier') continue;
                const name = spec.namedChildren[spec.namedChildren.length - 1]?.text;
                if (name && !seen.has(name)) { seen.add(name); exports.push({ name }); }
            }
        }
    }
    return exports;
}

/**
 * Extract intra-file function calls — used to build cross-file call edges in the KG.
 *
 * Walks the AST tracking the enclosing function name. When it finds a call_expression,
 * records { caller, callee } so the KG build loop can resolve callee → file and call
 * builder.addCallEdge(callerFile, caller, calleeFile, callee).
 *
 * Handles:
 *   - foo()         → callee = 'foo'
 *   - obj.foo()     → callee = 'foo' (member call — last identifier)
 *   - this.foo()    → callee = 'foo'
 *
 * @param {object} rootNode - tree-sitter root node
 * @returns {Array<{ caller: string, callee: string }>}
 */
function extractCalls(rootNode) {
    const calls = [];
    const seen  = new Set();

    function walk(node, enclosingFn) {
        // Track which function we're currently inside
        const isFn = node.type === 'function_declaration'         ||
                     node.type === 'generator_function_declaration'||
                     node.type === 'arrow_function'               ||
                     node.type === 'function'                     ||
                     node.type === 'method_definition';

        let currentFn = enclosingFn;
        if (isFn) {
            // function foo() {} — identifier child
            const nameNode = node.namedChildren.find(
                n => n.type === 'identifier' || n.type === 'property_identifier'
            );
            if (nameNode) currentFn = nameNode.text;
        }

        if (node.type === 'call_expression' && currentFn) {
            const fnNode = node.namedChildren[0];
            if (fnNode) {
                // member call: foo.bar() / this.bar() → callee = last identifier
                const callee = fnNode.type === 'member_expression'
                    ? fnNode.namedChildren[fnNode.namedChildren.length - 1]?.text
                    : fnNode.text;

                // Only record valid identifiers, skip built-ins and self-calls
                if (callee &&
                    /^[a-zA-Z_$][a-zA-Z0-9_$]*$/.test(callee) &&
                    callee !== currentFn) {
                    const key = `${currentFn}→${callee}`;
                    if (!seen.has(key)) {
                        seen.add(key);
                        calls.push({ caller: currentFn, callee });
                    }
                }
            }
        }

        for (const child of node.namedChildren) walk(child, currentFn);
    }

    walk(rootNode, null);
    return calls;
}

// ── analyzeFileWasm — single-file AST extraction ──────────────────────────────

function analyzeFileWasm(name, content) {
    const ext = name.split('.').pop().toLowerCase();
    if (!['js', 'jsx', 'ts', 'tsx', 'mjs', 'cjs'].includes(ext)) return null;

    try {
        const lang = pickLanguage(name);
        if (!lang) return null;
        _parser.setLanguage(lang);
        const tree = _parser.parse(content);
        const root = tree.rootNode;

        return {
            functions: extractFunctions(root),
            classes:   extractClasses(root),
            imports:   extractImports(root, content),
            exports:   extractExports(root),
            calls:     extractCalls(root),   // Phase A2: caller → callee pairs
        };
    } catch {
        return null;
    }
}

// ── Import path resolver ──────────────────────────────────────────────────────

function normalizeKey(p) { return p.replace(/\\/g, '/'); }

function resolveImportPath(source, importerPath, knownPaths) {
    if (!source.startsWith('.') && !source.startsWith('/')) return null;
    const dir    = importerPath.split('/').slice(0, -1).join('/');
    const joined = dir ? `${dir}/${source}` : source;
    const parts  = joined.split('/');
    const segs   = [];
    for (const p of parts) {
        if (p === '..') segs.pop();
        else if (p !== '.') segs.push(p);
    }
    const base = segs.join('/');
    if (knownPaths.has(base)) return base;
    for (const ext of ['.js', '.ts', '.jsx', '.tsx', '.mjs', '.cjs']) {
        if (knownPaths.has(base + ext)) return base + ext;
    }
    for (const ext of ['.js', '.ts', '.jsx', '.tsx']) {
        if (knownPaths.has(`${base}/index${ext}`)) return `${base}/index${ext}`;
    }
    // Fix (backport from ast-bridge.js March 26 hardening): skip ambiguous stems
    // that appear in many directories (utils, config, index, etc.). If we let the
    // fuzzy match run on these, we'd link to the first alphabetical file with that
    // stem — which is almost certainly wrong. Return null and leave unresolved.
    const AMBIGUOUS_STEMS = new Set([
        'index', 'types', 'utils', 'helpers', 'constants', 'common',
        'shared', 'base', 'config', 'main', 'core', 'hooks', 'styles',
        'theme', 'api', 'model', 'models', 'service', 'services',
    ]);
    const srcBase = source.split('/').pop();
    const srcStem = srcBase.replace(/\.[^.]+$/, '');
    if (AMBIGUOUS_STEMS.has(srcStem)) return null; // too many matches — safer than a wrong link
    for (const kp of knownPaths) {
        const kBase = kp.split('/').pop();
        const kStem = kBase.replace(/\.[^.]+$/, '');
        if (kStem === srcStem || kBase === srcBase) return kp;
    }
    return null;
}

// ── Main export ───────────────────────────────────────────────────────────────

/**
 * Attach structuralAnalysis to each file object.
 * Uses WASM tree-sitter in the browser (richer AST), falls back to regex.
 */
export async function attachStructuralAnalysis(files) {
    if (!files || files.length === 0) return files;

    const wasmOk = await initWasm();

    // Regex fallback path — identical contract, different engine
    if (!wasmOk) {
        console.warn('[AST-BROWSER] Using regex fallback for structural extraction');
        const { attachStructuralAnalysis: regexFallback } = await import('./ast-bridge.js');
        return regexFallback(files);
    }

    const knownPaths = new Set(files.map(f => normalizeKey(f.name)));

    let attached = 0;
    let resolvedEdges = 0;

    for (const file of files) {
        const normalizedPath = normalizeKey(file.name);
        const info = analyzeFileWasm(file.name, file.content || '');

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

    console.log(`[AST-BROWSER] WASM: attached=${attached}/${files.length}, edges=${resolvedEdges}`);
    return files;
}

/**
 * Incremental variant — same logic, for changed files only.
 */
export async function attachStructuralAnalysisToChanged(changedFiles, allFiles) {
    if (!changedFiles || changedFiles.length === 0) return changedFiles;
    const wasmOk = await initWasm();
    if (!wasmOk) {
        const { attachStructuralAnalysis: regexFallback } = await import('./ast-bridge.js');
        return regexFallback(changedFiles);
    }

    const knownPaths = new Set((allFiles || changedFiles).map(f => normalizeKey(f.name)));

    for (const file of changedFiles) {
        const normalizedPath = normalizeKey(file.name);
        const info = analyzeFileWasm(file.name, file.content || '');
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
