// ═══════════════════════════════════════════════════
// UNRAVEL v3 — AST Pre-Analysis Engine (Tree-sitter)
// Replaces @babel/parser + @babel/traverse entirely.
// Uses web-tree-sitter (WASM) for parsing.
// Outputs the same data shapes as the old ast-engine.js.
// ═══════════════════════════════════════════════════

const isBrowser = typeof window !== 'undefined';

// Browser: ES module import. Node.js: require() via dynamic import.
let TreeSitter;
if (isBrowser) {
    // In Browser, we assume web-tree-sitter is available via ESM
    // Vite will handle this if it's in the dependencies
    TreeSitter = (await import('web-tree-sitter')).default;
} else {
    const { createRequire } = await import('module');
    const { fileURLToPath } = await import('url');
    const { join, dirname } = await import('path');
    const require = createRequire(import.meta.url);
    TreeSitter = require('web-tree-sitter');
    
    // Only needed in Node.js
    const __filename = fileURLToPath(import.meta.url);
    const __dirname = dirname(__filename);
    globalThis.__astEngineDir = __dirname; // stash for WASM path below
}
// --- Timing/Async API names we care about ---
const TIMING_APIS = new Set([
    'setTimeout', 'setInterval', 'clearInterval', 'clearTimeout',
    'addEventListener', 'removeEventListener',
    'requestAnimationFrame', 'cancelAnimationFrame',
    'fetch', 'then', 'catch', 'finally',
]);

// ═══════════════════════════════════════════════════
// PARSER INIT + PARSE
// Lazy-loaded, async init on first use.
// ═══════════════════════════════════════════════════

let jsLang = null;
let tsLang = null;
let tsxLang = null;
// NOTE: single shared parser instance — NOT thread-safe for concurrent parseCode() calls.
// The sequential for loop in runMultiFileAnalysis() makes this safe today.
// If you ever refactor that loop to Promise.all(), create a new TreeSitter() instance per call.
let parserInstance = null;
let _initPromise = null;

/**
 * Initialize the tree-sitter WASM parser. Must be called (and awaited)
 * before any parseCode() calls. Safe to call multiple times — no-ops after first.
 */
export async function initParser() {
    if (_initPromise) return _initPromise;
    _initPromise = (async () => {
        if (isBrowser) {
            await TreeSitter.init({
                locateFile: () => '/wasm/tree-sitter.wasm'
            });
            jsLang  = await TreeSitter.Language.load('/wasm/tree-sitter-javascript.wasm');
            tsLang  = await TreeSitter.Language.load('/wasm/tree-sitter-typescript.wasm');
            tsxLang = await TreeSitter.Language.load('/wasm/tree-sitter-tsx.wasm');
        } else {
            const { join } = await import('path');
            const dir = globalThis.__astEngineDir;
            const WASMS = join(dir, '..', '..', 'node_modules', 'tree-sitter-wasms', 'out');
            await TreeSitter.init();
            jsLang  = await TreeSitter.Language.load(join(WASMS, 'tree-sitter-javascript.wasm'));
            tsLang  = await TreeSitter.Language.load(join(WASMS, 'tree-sitter-typescript.wasm'));
            tsxLang = await TreeSitter.Language.load(join(WASMS, 'tree-sitter-tsx.wasm'));
        }
        parserInstance = new TreeSitter();
        console.log('[AST-TS] Tree-sitter WASM parser initialized.');
    })();
    return _initPromise;
}

/**
 * Parse code into a tree-sitter tree.
 * Returns a partial tree even on syntax errors (key advantage over Babel).
 * @param {string} code
 * @param {string} [filename] - used to select JS vs TS vs TSX grammar
 * @returns {import('web-tree-sitter').Tree | null}
 */
export function parseCode(code, filename = '') {
    if (!parserInstance || !jsLang) {
        console.error('[AST-TS] Parser not initialized. Call initParser() first.');
        return null;
    }

    // Select grammar based on file extension
    const ext = filename.split('.').pop()?.toLowerCase() || '';
    if (ext === 'tsx' || ext === 'jsx') {
        parserInstance.setLanguage(tsxLang);
    } else if (ext === 'ts') {
        parserInstance.setLanguage(tsLang);
    } else {
        parserInstance.setLanguage(jsLang);
    }

    try {
        return parserInstance.parse(code);
    } catch (err) {
        console.warn('[AST-TS] Parse failed:', err.message);
        return null;
    }
}

// ═══════════════════════════════════════════════════
// SCOPE RESOLVER
// Builds a scope chain for the entire tree.
// Replaces Babel's path.scope.getBinding() API.
// ═══════════════════════════════════════════════════

const SCOPE_NODE_TYPES = new Set([
    'function_declaration', 'function', 'function_expression',
    'arrow_function', 'method_definition', 'generator_function',
    'generator_function_declaration',
]);

const DECLARATION_NODE_TYPES = new Set([
    'variable_declarator', 'lexical_declaration', 'variable_declaration',
]);

/**
 * A scope record storing bindings for a scope node.
 * @typedef {{ parentScope: ScopeRecord|null, bindings: Map<string, {kind: string, line: number}>, node: object }} ScopeRecord
 */

/**
 * Build a scope map for the entire tree.
 * @param {import('web-tree-sitter').Tree} tree
 * @returns {Map<number, ScopeRecord>} Map from node.id → ScopeRecord
 */
export function buildScopeMap(tree) {
    const scopeMap = new Map(); // node.id → ScopeRecord
    const rootScope = { parentScope: null, bindings: new Map(), node: tree.rootNode };
    scopeMap.set(tree.rootNode.id, rootScope);

    // Collect import bindings into module (root) scope
    _collectImportBindings(tree.rootNode, rootScope);

    // Collect top-level var/let/const/function declarations into root scope
    _collectTopLevelBindings(tree.rootNode, rootScope);

    // Walk the tree and build scopes for each function node
    _walkForScopes(tree.rootNode, rootScope, scopeMap);

    return scopeMap;
}

function _collectImportBindings(rootNode, rootScope) {
    for (const child of rootNode.namedChildren) {
        if (child.type === 'import_statement') {
            // import { foo, bar } from './mod'  OR  import X from './mod'
            const clause = child.childForFieldName('import') // <-- the import_clause node
                || child.namedChildren.find(c => c.type === 'import_clause');
            if (!clause) continue;

            // Walk the import clause for identifiers/named imports
            _walkImportClause(clause, rootScope, child.startPosition.row + 1);
        }
    }
}

function _walkImportClause(node, scope, line) {
    if (!node) return;
    if (node.type === 'identifier') {
        scope.bindings.set(node.text, { kind: 'module', line });
        return;
    }
    if (node.type === 'import_specifier') {
        // import { foo as bar } → bar is the local alias
        const alias = node.childForFieldName('alias');
        const name = alias || node.childForFieldName('name');
        if (name) scope.bindings.set(name.text, { kind: 'module', line });
        return;
    }
    if (node.type === 'namespace_import') {
        // import * as X
        const nameNode = node.namedChildren.find(c => c.type === 'identifier');
        if (nameNode) scope.bindings.set(nameNode.text, { kind: 'module', line });
        return;
    }
    for (const child of node.namedChildren) {
        _walkImportClause(child, scope, line);
    }
}

function _collectTopLevelBindings(rootNode, rootScope) {
    for (const child of rootNode.namedChildren) {
        // function declarations are hoisted
        if (child.type === 'function_declaration') {
            const nameNode = child.childForFieldName('name');
            if (nameNode) {
                rootScope.bindings.set(nameNode.text, { kind: 'hoisted', line: child.startPosition.row + 1 });
            }
        }
        // var/let/const at top level
        if (child.type === 'lexical_declaration' || child.type === 'variable_declaration') {
            _collectVarBindings(child, rootScope);
        }
    }
}

function _collectVarBindings(declNode, scope) {
    for (const child of declNode.namedChildren) {
        if (child.type === 'variable_declarator') {
            const nameNode = child.childForFieldName('name');
            if (nameNode && nameNode.type === 'identifier') {
                const kind = declNode.type === 'lexical_declaration' ? 'let' : 'var';
                scope.bindings.set(nameNode.text, { kind, line: child.startPosition.row + 1 });
            }
            // Destructured: const { a, b } = ... or const [a, b] = ...
            if (nameNode && (nameNode.type === 'object_pattern' || nameNode.type === 'array_pattern')) {
                _collectDestructuredBindings(nameNode, scope, declNode.type === 'lexical_declaration' ? 'let' : 'var');
            }
        }
    }
}

function _collectDestructuredBindings(patternNode, scope, kind) {
    for (const child of patternNode.namedChildren) {
        if (child.type === 'identifier') {
            scope.bindings.set(child.text, { kind, line: child.startPosition.row + 1 });
        } else if (child.type === 'shorthand_property_identifier_pattern' || child.type === 'shorthand_property_identifier') {
            scope.bindings.set(child.text, { kind, line: child.startPosition.row + 1 });
        } else if (child.type === 'pair_pattern' || child.type === 'rest_pattern' || child.type === 'assignment_pattern') {
            _collectDestructuredBindings(child, scope, kind);
        } else if (child.type === 'object_pattern' || child.type === 'array_pattern') {
            _collectDestructuredBindings(child, scope, kind);
        }
    }
}

function _walkForScopes(node, currentScope, scopeMap) {
    for (const child of node.namedChildren) {
        if (SCOPE_NODE_TYPES.has(child.type)) {
            // Create a new scope for this function
            const fnScope = { parentScope: currentScope, bindings: new Map(), node: child };
            scopeMap.set(child.id, fnScope);

            // Collect parameters
            const params = child.childForFieldName('parameters')
                || child.childForFieldName('parameter'); // arrow with single param
            if (params) {
                _collectParams(params, fnScope);
            }

            // Collect function-level var/let/const + hoisted function declarations
            _collectFunctionBindings(child, fnScope);

            // Recurse into the function body
            const body = child.childForFieldName('body');
            if (body) {
                _walkForScopes(body, fnScope, scopeMap);
            }
        } else {
            // Not a scope-creating node — keep walking
            _walkForScopes(child, currentScope, scopeMap);
        }
    }
}

function _collectParams(paramsNode, scope) {
    for (const child of paramsNode.namedChildren) {
        if (child.type === 'identifier') {
            scope.bindings.set(child.text, { kind: 'param', line: child.startPosition.row + 1 });
        } else if (child.type === 'assignment_pattern') {
            // Default params: function(x = 5) — the 'left' child is the name
            const left = child.childForFieldName('left');
            if (left?.type === 'identifier') {
                scope.bindings.set(left.text, { kind: 'param', line: left.startPosition.row + 1 });
            } else if (left?.type === 'object_pattern' || left?.type === 'array_pattern') {
                _collectDestructuredBindings(left, scope, 'param');
            }
        } else if (child.type === 'rest_pattern') {
            const nameNode = child.namedChildren.find(c => c.type === 'identifier');
            if (nameNode) scope.bindings.set(nameNode.text, { kind: 'param', line: nameNode.startPosition.row + 1 });
        } else if (child.type === 'object_pattern' || child.type === 'array_pattern') {
            _collectDestructuredBindings(child, scope, 'param');
        }
    }
}

function _collectFunctionBindings(fnNode, scope) {
    // Walk the function body for declarations (but NOT into nested functions)
    const body = fnNode.childForFieldName('body');
    if (!body) return;
    _collectBindingsInBlock(body, scope);
}

function _collectBindingsInBlock(node, scope) {
    for (const child of node.namedChildren) {
        if (SCOPE_NODE_TYPES.has(child.type)) {
            // Hoisted function declarations inside this scope
            if (child.type === 'function_declaration') {
                const nameNode = child.childForFieldName('name');
                if (nameNode) scope.bindings.set(nameNode.text, { kind: 'hoisted', line: child.startPosition.row + 1 });
            }
            // Don't recurse into nested functions — they'll create their own scope
            continue;
        }
        if (child.type === 'lexical_declaration' || child.type === 'variable_declaration') {
            _collectVarBindings(child, scope);
        }
        // Recurse into blocks, if-statements, etc. (not function bodies)
        _collectBindingsInBlock(child, scope);
    }
}

/**
 * Resolve a binding for a name starting from a given scope.
 * Walks up the scope chain until found or returns null.
 * @param {ScopeRecord} scope
 * @param {string} name
 * @returns {{ kind: string, line: number } | null}
 */
export function getBinding(scope, name) {
    let current = scope;
    while (current) {
        if (current.bindings.has(name)) {
            return current.bindings.get(name);
        }
        current = current.parentScope;
    }
    return null;
}

/**
 * Check if a scope has its own binding (not inherited from parent).
 * @param {ScopeRecord} scope
 * @param {string} name
 * @returns {boolean}
 */
export function hasOwnBinding(scope, name) {
    return scope.bindings.has(name);
}

/**
 * Find the scope record for a node by walking up to find the nearest containing scope.
 * @param {import('web-tree-sitter').Node} node
 * @param {Map<number, ScopeRecord>} scopeMap
 * @returns {ScopeRecord}
 */
function findScopeForNode(node, scopeMap) {
    let current = node;
    while (current) {
        if (scopeMap.has(current.id)) return scopeMap.get(current.id);
        current = current.parent;
    }
    // Should not happen — root should always be in the map
    return scopeMap.values().next().value;
}

// ═══════════════════════════════════════════════════
// HELPERS
// ═══════════════════════════════════════════════════

const NOISE_GLOBALS = new Set([
    'undefined', 'null', 'console', 'window', 'document',
    'module', 'exports', 'require', 'process', 'globalThis',
    'NaN', 'Infinity', 'Object', 'Array', 'String', 'Number',
    'Boolean', 'Promise', 'Error', 'JSON', 'Math', 'Date',
    'Map', 'Set', 'Symbol', 'RegExp', 'Proxy', 'Reflect',
    'parseInt', 'parseFloat', 'isNaN', 'isFinite',
    'encodeURIComponent', 'decodeURIComponent',
    'setTimeout', 'setInterval', 'clearTimeout', 'clearInterval',
    'requestAnimationFrame', 'cancelAnimationFrame',
    'fetch', 'alert', 'confirm', 'prompt',
]);

/**
 * Get the enclosing function name for a node.
 */
function getEnclosingFunction(node) {
    let current = node.parent;
    while (current) {
        if (SCOPE_NODE_TYPES.has(current.type)) {
            return _getFunctionName(current);
        }
        current = current.parent;
    }
    return '(module scope)';
}

function _getFunctionName(fnNode) {
    // function foo() {}
    const nameField = fnNode.childForFieldName('name');
    if (nameField) return nameField.text;

    // const foo = () => {} or const foo = function() {}
    const parent = fnNode.parent;
    if (parent?.type === 'variable_declarator') {
        const name = parent.childForFieldName('name');
        return name?.text || '(anonymous)';
    }
    // { foo: () => {} }
    if (parent?.type === 'pair') {
        const key = parent.childForFieldName('key');
        return key?.text || '(anonymous)';
    }
    // class method
    if (parent?.type === 'method_definition') {
        const key = parent.childForFieldName('name');
        return key?.text || '(method)';
    }
    return '(anonymous)';
}

/**
 * Build dotted name from member_expression node: obj.prop → "obj.prop"
 */
function getMemberExpressionName(node) {
    const parts = [];
    let current = node;
    let depth = 0;
    while (current?.type === 'member_expression' && depth < 4) {
        const prop = current.childForFieldName('property');
        const isComputed = current.children.some(c => c.type === '[');
        if (isComputed) {
            parts.unshift('[]');
        } else if (prop) {
            parts.unshift(prop.text);
        }
        current = current.childForFieldName('object');
        depth++;
    }
    if (current?.type === 'identifier') {
        parts.unshift(current.text);
    }
    if (parts.length < 2) return null;
    return parts.join('.').replace(/\.\[\]/g, '[]');
}

// ═══════════════════════════════════════════════════
// FEATURE 1: Variable Mutation Chains
// ═══════════════════════════════════════════════════

export function extractMutationChains(tree) {
    const mutations = {};
    if (!tree) return mutations;
    const root = tree.rootNode;

    // --- Track assignments ---
    const assignments = root.descendantsOfType('assignment_expression');
    for (const node of assignments) {
        const left = node.childForFieldName('left');
        if (!left) continue;
        const fn = getEnclosingFunction(node);
        const line = node.startPosition.row + 1;

        if (left.type === 'identifier') {
            const name = left.text;
            if (!mutations[name]) mutations[name] = { writes: [], reads: [] };
            mutations[name].writes.push({ fn, line });
        }
        if (left.type === 'array_pattern') {
            for (const el of left.namedChildren) {
                if (el.type === 'identifier') {
                    const name = el.text;
                    if (!mutations[name]) mutations[name] = { writes: [], reads: [] };
                    mutations[name].writes.push({ fn, line });
                }
            }
        }
        if (left.type === 'object_pattern') {
            for (const prop of left.namedChildren) {
                const val = prop.childForFieldName('value') || prop;
                if (val.type === 'identifier' || val.type === 'shorthand_property_identifier_pattern') {
                    const name = val.text;
                    if (!mutations[name]) mutations[name] = { writes: [], reads: [] };
                    mutations[name].writes.push({ fn, line });
                }
            }
        }
        if (left.type === 'member_expression') {
            const name = getMemberExpressionName(left);
            if (name) {
                if (!mutations[name]) mutations[name] = { writes: [], reads: [] };
                mutations[name].writes.push({ fn, line });
            }
        }
        // subscript_expression: cache[key] = value → track as cache[]
        if (left.type === 'subscript_expression') {
            const obj = left.namedChildren[0];
            if (obj?.type === 'identifier') {
                const name = `${obj.text}[]`;
                if (!mutations[name]) mutations[name] = { writes: [], reads: [] };
                mutations[name].writes.push({ fn, line });
            }
        }
    }

    // --- Track update expressions: i++, --count ---
    const updates = root.descendantsOfType('update_expression');
    for (const node of updates) {
        const arg = node.childForFieldName('argument');
        if (arg?.type === 'identifier') {
            const name = arg.text;
            const fn = getEnclosingFunction(node);
            const line = node.startPosition.row + 1;
            if (!mutations[name]) mutations[name] = { writes: [], reads: [] };
            mutations[name].writes.push({ fn, line });
        }
    }

    // --- Track reads: identifiers not on LHS ---
    const identifiers = root.descendantsOfType('identifier');
    for (const node of identifiers) {
        const name = node.text;
        if (NOISE_GLOBALS.has(name)) continue;

        const parent = node.parent;
        if (!parent) continue;

        // Skip declarations
        if (parent.type === 'variable_declarator' && parent.childForFieldName('name')?.id === node.id) continue;
        // Skip LHS of assignment
        if (parent.type === 'assignment_expression' && parent.childForFieldName('left')?.id === node.id) continue;
        // Skip function params
        if (parent.type === 'formal_parameters') continue;
        if (parent.type === 'required_parameter' || parent.type === 'optional_parameter') continue;
        // Skip property access key (member_expression)
        if (parent.type === 'member_expression' && parent.childForFieldName('property')?.id === node.id) continue;
        // Skip subscript object — e.g. 'cache' in cache[key] (it's a write, tracked separately)
        if (parent.type === 'subscript_expression' && parent.namedChildren[0]?.id === node.id) continue;
        // Skip object key
        if (parent.type === 'pair' && parent.childForFieldName('key')?.id === node.id) continue;
        // Skip import specifiers
        if (parent.type === 'import_specifier') continue;
        // Skip function name
        if ((parent.type === 'function_declaration' || parent.type === 'function') && parent.childForFieldName('name')?.id === node.id) continue;

        const fn = getEnclosingFunction(node);
        const line = node.startPosition.row + 1;

        if (!mutations[name]) mutations[name] = { writes: [], reads: [] };
        const existing = mutations[name].reads.find(r => r.fn === fn && r.line === line);
        if (!existing) {
            mutations[name].reads.push({ fn, line });
        }
    }

    return mutations;
}

// ═══════════════════════════════════════════════════
// FEATURE 2: Closure Captures
// Uses the scope resolver to detect variables captured
// from outer scopes — equivalent to old Babel version.
// ═══════════════════════════════════════════════════

export function trackClosureCaptures(tree) {
    const captures = {};
    if (!tree) return captures;

    const scopeMap = buildScopeMap(tree);
    const root = tree.rootNode;

    // Find all function nodes
    const fnTypes = [...SCOPE_NODE_TYPES];
    const fnNodes = root.descendantsOfType(fnTypes);

    for (const fnNode of fnNodes) {
        const fnName = _getFunctionName(fnNode);
        const fnScope = scopeMap.get(fnNode.id);
        if (!fnScope) continue;

        const capturedVars = new Set();

        // Find all identifiers inside this function
        const body = fnNode.childForFieldName('body');
        if (!body) continue;

        const identifiers = body.descendantsOfType('identifier');
        for (const idNode of identifiers) {
            const name = idNode.text;

            // Skip if it's an own binding of this function
            if (hasOwnBinding(fnScope, name)) continue;

            // Skip property access keys
            const parent = idNode.parent;
            if (parent?.type === 'member_expression' && parent.childForFieldName('property')?.id === idNode.id) continue;
            // Skip function params (already in own bindings, but double-check)
            if (parent?.type === 'formal_parameters') continue;
            // Skip object keys
            if (parent?.type === 'pair' && parent.childForFieldName('key')?.id === idNode.id) continue;
            // Skip import specifiers
            if (parent?.type === 'import_specifier') continue;

            // Check if this variable has a binding in an outer scope
            const binding = getBinding(fnScope.parentScope, name);
            if (binding) {
                // Skip module imports — immutable references, never stale
                if (binding.kind === 'module') continue;
                // Skip hoisted function declarations — not a closure risk
                if (binding.kind === 'hoisted') continue;

                capturedVars.add(name);
            }
        }

        if (capturedVars.size > 0) {
            captures[fnName] = Array.from(capturedVars);
        }
    }

    return captures;
}

// ═══════════════════════════════════════════════════
// FEATURE 3: Timing / Async Node Detection
// ═══════════════════════════════════════════════════

export function findTimingNodes(tree) {
    const timingNodes = [];
    if (!tree) return timingNodes;
    const root = tree.rootNode;

    const calls = root.descendantsOfType('call_expression');
    for (const call of calls) {
        const fnNode = call.childForFieldName('function');
        if (!fnNode) continue;

        let apiName = null;

        // Direct call: setTimeout(...)
        if (fnNode.type === 'identifier' && TIMING_APIS.has(fnNode.text)) {
            apiName = fnNode.text;
        }

        // Method call: window.setTimeout(...), promise.then(...)
        if (fnNode.type === 'member_expression') {
            const prop = fnNode.childForFieldName('property');
            if (prop && TIMING_APIS.has(prop.text)) {
                apiName = prop.text;
            }
        }

        if (!apiName) continue;

        const line = call.startPosition.row + 1;
        const enclosingFn = getEnclosingFunction(call);

        // Identify callback
        let callbackName = '(inline)';
        const argsNode = call.childForFieldName('arguments');
        const firstArg = argsNode?.namedChildren?.[0];

        if (firstArg?.type === 'identifier') {
            callbackName = firstArg.text;
        }
        if (firstArg?.type === 'arrow_function' || firstArg?.type === 'function' || firstArg?.type === 'function_expression') {
            callbackName = '(arrow)';
        }

        // For addEventListener, event type is first arg, callback is second
        if (apiName === 'addEventListener' || apiName === 'removeEventListener') {
            const eventArg = argsNode?.namedChildren?.[0];
            const callbackArg = argsNode?.namedChildren?.[1];
            const eventName = eventArg?.type === 'string' ? eventArg.text.replace(/['"]/g, '') : '?';
            callbackName = callbackArg?.type === 'identifier'
                ? callbackArg.text
                : '(inline handler)';
            apiName = `${apiName}("${eventName}")`;
        }

        timingNodes.push({ api: apiName, callback: callbackName, line, enclosingFn });
    }

    return timingNodes;
}

// ═══════════════════════════════════════════════════
// INTEGRATION: Run full analysis (single file)
// ═══════════════════════════════════════════════════

export async function runFullAnalysis(code, filename = '') {
    await initParser();
    const tree = parseCode(code, filename);
    if (!tree) {
        return {
            raw: { mutations: {}, closures: {}, timingNodes: [] },
            formatted: '⚠️ AST parse failed — falling back to LLM-only analysis.',
        };
    }

    let mutations = {}, closures = {}, timing = [], reactPatterns = [], floatingPromises = [];

    try { mutations = extractMutationChains(tree); }
    catch (e) { console.warn('[AST-TS] Mutation analysis failed:', e.message); }

    try { closures = trackClosureCaptures(tree); }
    catch (e) { console.warn('[AST-TS] Closure analysis failed:', e.message); }

    try { timing = findTimingNodes(tree); }
    catch (e) { console.warn('[AST-TS] Timing analysis failed:', e.message); }

    try { reactPatterns = detectReactPatterns(tree); }
    catch (e) { console.warn('[AST-TS] React pattern detection failed:', e.message); }

    try { floatingPromises = detectFloatingPromises(tree); }
    catch (e) { console.warn('[AST-TS] Floating promise detection failed:', e.message); }

    const formatted = formatAnalysis(mutations, closures, timing, reactPatterns, floatingPromises);

    tree.delete(); // Free WASM memory
    return { raw: { mutations, closures, timingNodes: timing, reactPatterns, floatingPromises }, formatted };
}

// ═══════════════════════════════════════════════════
// MULTI-FILE ANALYSIS (async — was sync with Babel)
// ═══════════════════════════════════════════════════

export async function runMultiFileAnalysis(files) {
    await initParser();

    const mergedMutations = {};
    const mergedClosures = {};
    const mergedTiming = [];
    const mergedReactPatterns = [];
    const mergedFloatingPromises = [];
    let totalParsed = 0;
    let totalFailed = 0;
    const failedFiles = [];

    for (const file of files) {
        const shortName = file.name.split(/[\\/]/).pop();
        const tree = parseCode(file.content, shortName);
        if (!tree) {
            totalFailed++;
            failedFiles.push(shortName);
            continue;
        }

        // Count error nodes — skip files with too many parse errors
        const errorCount = tree.rootNode.descendantsOfType('ERROR').length;
        if (errorCount > 20) {
            console.warn(`[AST-TS] Skipping ${shortName}: ${errorCount} parse errors`);
            totalFailed++;
            failedFiles.push(shortName);
            tree.delete();
            continue;
        }

        let mutations = {}, closures = {}, timing = [], reactPatterns = [], floatingPromises = [];
        let anySucceeded = false;

        try { mutations = extractMutationChains(tree); anySucceeded = true; }
        catch (e) { console.warn(`[AST-TS] Mutation failed for ${shortName}:`, e.message); }

        try { closures = trackClosureCaptures(tree); anySucceeded = true; }
        catch (e) { console.warn(`[AST-TS] Closure failed for ${shortName}:`, e.message); }

        try { timing = findTimingNodes(tree); anySucceeded = true; }
        catch (e) { console.warn(`[AST-TS] Timing failed for ${shortName}:`, e.message); }

        try { reactPatterns = detectReactPatterns(tree); anySucceeded = true; }
        catch (e) { console.warn(`[AST-TS] React patterns failed for ${shortName}:`, e.message); }

        try { floatingPromises = detectFloatingPromises(tree); anySucceeded = true; }
        catch (e) { console.warn(`[AST-TS] Float promise failed for ${shortName}:`, e.message); }

        tree.delete(); // Free WASM memory

        if (!anySucceeded) {
            totalFailed++;
            failedFiles.push(shortName);
            continue;
        }

        totalParsed++;

        // Merge mutations
        for (const [varName, data] of Object.entries(mutations)) {
            const key = `${varName} [${shortName}]`;
            if (!mergedMutations[key]) mergedMutations[key] = { writes: [], reads: [] };
            mergedMutations[key].writes.push(...data.writes);
            mergedMutations[key].reads.push(...data.reads);
        }

        // Merge closures
        for (const [fnName, vars] of Object.entries(closures)) {
            const key = `${fnName} [${shortName}]`;
            if (!mergedClosures[key]) mergedClosures[key] = [];
            for (const v of vars) {
                if (!mergedClosures[key].includes(v)) mergedClosures[key].push(v);
            }
        }

        // Merge timing
        for (const t of timing) {
            mergedTiming.push({ ...t, file: shortName });
        }

        // Merge react patterns and floating promises (per-file, annotate with filename)
        for (const p of reactPatterns) {
            mergedReactPatterns.push({ ...p, file: shortName });
        }
        for (const p of floatingPromises) {
            mergedFloatingPromises.push({ ...p, file: shortName });
        }
    }

    if (totalParsed === 0) {
        return {
            raw: { mutations: {}, closures: {}, timingNodes: [] },
            formatted: `⚠️ AST parse failed on all ${files.length} files — falling back to LLM-only analysis.`,
        };
    }

    const formatted = formatAnalysis(mergedMutations, mergedClosures, mergedTiming, mergedReactPatterns, mergedFloatingPromises);
    const header = `Files parsed: ${totalParsed}/${files.length}`;
    const failNote = totalFailed > 0
        ? ` (${totalFailed} failed: ${failedFiles.join(', ')})`
        : '';
    const fullFormatted = `${header}${failNote}\n\n${formatted}`;

    return {
        raw: { mutations: mergedMutations, closures: mergedClosures, timingNodes: mergedTiming,
               reactPatterns: mergedReactPatterns, floatingPromises: mergedFloatingPromises },
        formatted: fullFormatted,
    };
}

// ═══════════════════════════════════════════════════
// FEATURE 4: React-Specific Pattern Detection
// Detects useState stale closures, missing useEffect cleanup,
// and useCallback/useMemo with missing deps.
// ═══════════════════════════════════════════════════

const REACT_STATE_HOOKS = new Set(['useState', 'useReducer']);
const REACT_EFFECT_HOOKS = new Set(['useEffect', 'useLayoutEffect']);
const REACT_MEMO_HOOKS = new Set(['useCallback', 'useMemo']);

/**
 * Detect React-specific patterns that are common sources of bugs.
 * Returns an array of findings with type, description, and line.
 * @param {import('web-tree-sitter').Tree} tree
 * @returns {Array<{type: string, description: string, line: number, fn: string}>}
 */
export function detectReactPatterns(tree) {
    const findings = [];
    if (!tree) return findings;
    const root = tree.rootNode;

    const calls = root.descendantsOfType('call_expression');
    for (const call of calls) {
        const fnNode = call.childForFieldName('function');
        if (!fnNode) continue;

        const hookName = fnNode.type === 'identifier' ? fnNode.text
            : fnNode.type === 'member_expression' ? fnNode.childForFieldName('property')?.text
            : null;
        if (!hookName) continue;

        const argsNode = call.childForFieldName('arguments');
        const args = argsNode?.namedChildren || [];
        const line = call.startPosition.row + 1;
        const enclosingFn = getEnclosingFunction(call);

        // ── useState / useReducer: stale setter in closure ──
        if (REACT_STATE_HOOKS.has(hookName)) {
            // Check if the setter (second destructured var) is called inside a timing callback
            // Pattern: const [state, setState] = useState(...)
            const parent = call.parent;
            if (parent?.type === 'variable_declarator') {
                const pattern = parent.childForFieldName('name');
                if (pattern?.type === 'array_pattern') {
                    const setterNode = pattern.namedChildren[1];
                    if (setterNode) {
                        findings.push({
                            type: 'react_state_hook',
                            description: `${hookName}() — setter \`${setterNode.text}\` may be stale in closures`,
                            line,
                            fn: enclosingFn,
                        });
                    }
                }
            }
        }

        // ── useEffect / useLayoutEffect: missing cleanup return ──
        if (REACT_EFFECT_HOOKS.has(hookName)) {
            const callback = args[0]; // first arg is the effect callback
            const depsArray = args[1]; // second arg is deps array
            if (callback) {
                // Check if the callback has any timing node inside (subscription, interval, listener)
                const callsInsideEffect = callback.descendantsOfType('call_expression');
                const hasTimingCall = callsInsideEffect.some(c => {
                    const fn = c.childForFieldName('function');
                    const name = fn?.type === 'identifier' ? fn.text
                        : fn?.type === 'member_expression' ? fn.childForFieldName('property')?.text
                        : null;
                    return name && (TIMING_APIS.has(name) || name === 'subscribe' || name === 'on');
                });

                // Check if callback returns a cleanup function
                const hasCleanupReturn = callback.descendantsOfType('return_statement').length > 0;

                if (hasTimingCall && !hasCleanupReturn) {
                    findings.push({
                        type: 'react_effect_no_cleanup',
                        description: `${hookName}() — contains timing/subscription call but no cleanup return`,
                        line,
                        fn: enclosingFn,
                    });
                }

                // Missing deps array entirely
                if (!depsArray) {
                    findings.push({
                        type: 'react_effect_no_deps',
                        description: `${hookName}() — no dependency array (runs after every render)`,
                        line,
                        fn: enclosingFn,
                    });
                }
            }
        }

        // ── useCallback / useMemo: no deps array (always re-creates) ──
        if (REACT_MEMO_HOOKS.has(hookName)) {
            const depsArray = args[1];
            if (!depsArray) {
                findings.push({
                    type: 'react_memo_no_deps',
                    description: `${hookName}() — no dependency array (defeats memoization)`,
                    line,
                    fn: enclosingFn,
                });
            }
        }
    }

    return findings;
}

// ═══════════════════════════════════════════════════
// FEATURE 5: Floating Promise Detection
// Detects async calls that are NOT wrapped in await.
// isAwaited guard: skips valid await fetch(...) calls.
// ═══════════════════════════════════════════════════

const ASYNC_CALL_PATTERNS = new Set([
    'fetch', 'axios', 'got', 'request',
    'then', 'catch', 'finally',
    'readFile', 'writeFile', 'readdir',
    'connect', 'query', 'find', 'findOne', 'save', 'create', 'delete',
    'send', 'get', 'post', 'put', 'patch',
]);

/**
 * Check if a node is directly inside an await_expression.
 * @param {import('web-tree-sitter').Node} node
 * @returns {boolean}
 */
function isAwaited(node) {
    // Walk up — if we hit await_expression before hitting a statement boundary, it's awaited
    let current = node.parent;
    while (current) {
        if (current.type === 'await_expression') return true;
        // Statement boundaries — stop looking up
        if (
            current.type === 'expression_statement' ||
            current.type === 'return_statement' ||
            current.type === 'variable_declarator' ||
            current.type === 'assignment_expression'
        ) return false;
        current = current.parent;
    }
    return false;
}

/**
 * Detect floating (unawaited) async calls.
 * @param {import('web-tree-sitter').Tree} tree
 * @returns {Array<{api: string, line: number, fn: string}>}
 */
export function detectFloatingPromises(tree) {
    const floating = [];
    if (!tree) return floating;
    const root = tree.rootNode;

    // Only meaningful inside async functions
    const calls = root.descendantsOfType('call_expression');
    for (const call of calls) {
        const fnNode = call.childForFieldName('function');
        if (!fnNode) continue;

        let apiName = null;

        if (fnNode.type === 'identifier' && ASYNC_CALL_PATTERNS.has(fnNode.text)) {
            apiName = fnNode.text;
        }
        if (fnNode.type === 'member_expression') {
            const prop = fnNode.childForFieldName('property');
            if (prop && ASYNC_CALL_PATTERNS.has(prop.text)) {
                apiName = prop.text;
            }
        }

        if (!apiName) continue;

        // The isAwaited guard — skip calls that are properly awaited
        if (isAwaited(call)) continue;

        // Must be inside an async function to be a real floating promise
        // (calling fetch() at module level without await is a floating promise too,
        //  but less common — we flag it regardless)
        const line = call.startPosition.row + 1;
        const enclosingFn = getEnclosingFunction(call);
        floating.push({ api: apiName, line, fn: enclosingFn });
    }

    return floating;
}

// ═══════════════════════════════════════════════════
// FORMAT: Same output format as the old engine
// ═══════════════════════════════════════════════════

function formatAnalysis(mutations, closures, timing, reactPatterns = [], floatingPromises = []) {
    const lines = [];
    lines.push('VERIFIED STATIC ANALYSIS — deterministic, not hallucinated');
    lines.push('══════════════════════════════════════════════════════════');
    lines.push('');

    // Functions
    const allFunctions = new Set();
    for (const variable of Object.keys(mutations)) {
        for (const w of mutations[variable].writes) allFunctions.add(w.fn);
        for (const r of mutations[variable].reads) allFunctions.add(r.fn);
    }
    allFunctions.delete('(module scope)');
    if (allFunctions.size > 0) {
        lines.push('Relevant Functions:');
        lines.push(`  ${Array.from(allFunctions).join(', ')}`);
        lines.push('');
    }

    // Mutation chains
    const mutatedVars = Object.entries(mutations).filter(([, data]) =>
        data.writes.some(w => w.fn !== '(module scope)')
    );
    const allMutatedNames = mutatedVars.map(([name]) => name);

    if (mutatedVars.length > 0) {
        lines.push('Variable Mutation Chains:');
        for (const [name, data] of mutatedVars) {
            const isPropertyMutation = name.includes('.') || name.includes('[]');
            const rootName = name.split(/[.\[]/)[0];
            const hasRelatedArrayMutation = isPropertyMutation && allMutatedNames.some(
                n => n !== name && (n === rootName || n.startsWith(rootName + '.'))
            );

            lines.push(`  ${name}`);
            if (data.writes.length > 0) {
                const writeStr = data.writes.map(w => `${w.fn} L${w.line}`).join(', ');
                let annotation = '';
                if (isPropertyMutation) {
                    annotation = name.includes('[]')
                        ? ' ← property mutation on array element'
                        : ' ← property write';
                }
                lines.push(`    written: ${writeStr}${annotation}`);
            }
            if (data.reads.length > 0) {
                const readFns = [...new Set(data.reads.map(r => `${r.fn} L${r.line}`))];
                lines.push(`    read:    ${readFns.join(', ')}`);
            }
            if (hasRelatedArrayMutation) {
                lines.push(`    note:    shares root with ${rootName} — both array and element mutations present`);
            }
        }
        lines.push('');
    }

    // Timing
    if (timing.length > 0) {
        lines.push('Async / Timing Nodes:');
        for (const t of timing) {
            lines.push(`  ${t.api}  → ${t.callback}  [L${t.line}]`);
        }
        lines.push('');
    }

    // Closures
    const captureEntries = Object.entries(closures);
    if (captureEntries.length > 0) {
        lines.push('Closure Captures:');
        for (const [fnName, vars] of captureEntries) {
            lines.push(`  ${fnName}  captures → ${vars.join(', ')}`);
        }
        lines.push('');
    }

    // React patterns
    if (reactPatterns.length > 0) {
        lines.push('React Patterns Detected:');
        for (const p of reactPatterns) {
            lines.push(`  [${p.type}] ${p.description}  [L${p.line}]`);
        }
        lines.push('');
    }

    // Floating promises
    if (floatingPromises.length > 0) {
        lines.push('Floating Promises (unawaited async calls):');
        for (const p of floatingPromises) {
            lines.push(`  ${p.api}()  in ${p.fn}  [L${p.line}]  ← not awaited`);
        }
        lines.push('');
    }

    if (mutatedVars.length === 0 && timing.length === 0 && captureEntries.length === 0
        && reactPatterns.length === 0 && floatingPromises.length === 0) {
        lines.push('No significant mutation chains, timing nodes, or closure captures detected.');
        lines.push('The LLM should analyze the code without AST hints.');
        lines.push('');
    }

    return lines.join('\n');
}
