// ═══════════════════════════════════════════════════
// UNRAVEL v3 — AST Pre-Analysis Engine (Tree-sitter)
// Replaces @babel/parser + @babel/traverse entirely.
// Uses web-tree-sitter (WASM) for parsing.
// Outputs the same data shapes as the old ast-engine.js.
// ═══════════════════════════════════════════════════

const isBrowser = typeof window !== 'undefined';

// TreeSitter is loaded lazily inside initParser()
// — NOT at module scope so there is no top-level await
// that would break esbuild's es2020 target.
let TreeSitter = null;

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
        try {
            if (!TreeSitter) {
                // ── web-tree-sitter module resolution ──────────────────────────────
                //
                // web-tree-sitter 0.22.x switched to a new Emscripten build pipeline
                // that changes the export shape depending on the bundler/environment.
                // Vite dev mode (even with optimizeDeps.exclude) can produce any of:
                //
                //   A  tsModule.default            — ESM default (most common)
                //   B  tsModule.default.default     — double-wrapped CJS interop
                //   C  tsModule.Parser              — named export
                //   D  tsModule.default.Parser      — nested named export
                //   E  tsModule.TreeSitter          — named export by old package name
                //   F  tsModule                     — namespace IS the class (CJS passthrough)
                //
                // ADDITIONALLY, 0.22.x may use the Emscripten MODULARIZE factory pattern,
                // where the export is an async factory function rather than the class itself:
                //   G  await tsModule.default()     — factory returns the Parser class
                //   H  await tsModule()             — namespace is the factory
                //
                // We probe A–F for `.init()` first (old-style direct class).
                // If none match, we try G–H (new-style factory).
                // ──────────────────────────────────────────────────────────────────
                const tsModule = await import('web-tree-sitter');

                // Debug: log the actual shape so we can diagnose on first failure
                console.log('[AST-TS] web-tree-sitter module shape:', {
                    moduleType:   typeof tsModule,
                    moduleKeys:   Object.keys(tsModule).slice(0, 15),
                    defaultType:  typeof tsModule.default,
                    defaultKeys:  tsModule.default ? Object.keys(tsModule.default).slice(0, 15) : [],
                    hasInit:      typeof tsModule.default?.init,
                    hasDblDefault:typeof tsModule.default?.default,
                    hasParser:    typeof tsModule.Parser ?? typeof tsModule.default?.Parser,
                });

                // ── Phase 1: direct class probe (shapes A–F) ──────────────────────
                const directCandidates = [
                    tsModule.default,             // A
                    tsModule.default?.default,    // B
                    tsModule.Parser,              // C
                    tsModule.default?.Parser,     // D
                    tsModule.TreeSitter,          // E
                    tsModule,                     // F
                ];
                TreeSitter = directCandidates.find(c => c && typeof c.init === 'function') ?? null;

                // ── Phase 2: factory function probe (shapes G–H) ──────────────────
                // In web-tree-sitter >= 0.22 with MODULARIZE=1 Emscripten output,
                // the export is a callable that returns a promise resolving to the class.
                if (!TreeSitter) {
                    for (const factory of [tsModule.default, tsModule]) {
                        if (typeof factory !== 'function') continue;
                        try {
                            const result = await factory();
                            const factoryCandidates = [result, result?.Parser, result?.default];
                            const found = factoryCandidates.find(c => c && typeof c.init === 'function');
                            if (found) {
                                TreeSitter = found;
                                console.log('[AST-TS] Resolved via factory pattern.');
                                break;
                            }
                        } catch { /* factory call failed — try next */ }
                    }
                }

                if (!TreeSitter) {
                    throw new Error(
                        'web-tree-sitter 0.22.x: Parser class not found after exhaustive probe ' +
                        '(checked shapes A–H including Emscripten factory pattern). ' +
                        'See [AST-TS] log above for the actual module shape. ' +
                        'Try: npm install web-tree-sitter@0.20.8 to pin to the last stable API, ' +
                        'or clear the Vite cache: rm -rf node_modules/.vite && npx vite --force'
                    );
                }
            }

            const wasmBase = typeof __dirname !== 'undefined' ? __dirname + '/../wasm' : '/wasm';
            await TreeSitter.init({ locateFile: () => `${wasmBase}/tree-sitter.wasm` });
            jsLang  = await TreeSitter.Language.load(`${wasmBase}/tree-sitter-javascript.wasm`);
            tsLang  = await TreeSitter.Language.load(`${wasmBase}/tree-sitter-typescript.wasm`);
            tsxLang = await TreeSitter.Language.load(`${wasmBase}/tree-sitter-tsx.wasm`);
            parserInstance = new TreeSitter();
            console.log('[AST-TS] Tree-sitter WASM parser initialized.');

        } catch (err) {
            // Reset so a hot-reload / next call can retry instead of returning
            // a permanently cached rejected promise.
            _initPromise = null;
            TreeSitter = null;
            throw err;
        }
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

/**
 * Recursively collect all identifier bindings from a destructure LHS pattern,
 * pushing them as `type: 'reassigned'` writes into the mutations map.
 * Handles: simple { a, b }, aliases { a: b }, nested { a: { b } }, arrays [x, [y]],
 * rest elements (...z), and assignment defaults ({ a = 1 }).
 */
function _collectDestructuredMutations(patternNode, mutations, fn, line) {
    if (!patternNode) return;
    for (const child of patternNode.namedChildren) {
        if (child.type === 'identifier') {
            if (!mutations[child.text]) mutations[child.text] = { writes: [], reads: [] };
            mutations[child.text].writes.push({ fn, line, type: 'reassigned' });
        } else if (child.type === 'shorthand_property_identifier_pattern' || child.type === 'shorthand_property_identifier') {
            if (!mutations[child.text]) mutations[child.text] = { writes: [], reads: [] };
            mutations[child.text].writes.push({ fn, line, type: 'reassigned' });
        } else if (child.type === 'pair_pattern') {
            // { key: localName } — the local name is the value child
            const value = child.childForFieldName('value');
            if (value) _collectDestructuredMutations(value, mutations, fn, line);
        } else if (child.type === 'assignment_pattern') {
            // { a = defaultVal } — 'a' is the left child
            const left = child.childForFieldName('left');
            if (left) _collectDestructuredMutations(left, mutations, fn, line);
        } else if (child.type === 'rest_pattern') {
            // [...rest] or {...rest}
            const inner = child.namedChildren[0];
            if (inner?.type === 'identifier') {
                if (!mutations[inner.text]) mutations[inner.text] = { writes: [], reads: [] };
                mutations[inner.text].writes.push({ fn, line, type: 'reassigned' });
            }
        } else if (child.type === 'object_pattern' || child.type === 'array_pattern') {
            _collectDestructuredMutations(child, mutations, fn, line);
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

/**
 * Check if a node is inside a conditional branch (if/switch/ternary/try/catch).
 * Walks up from the node to its enclosing function scope boundary.
 * Returns true if ANY ancestor between node and scope is a branch-type body.
 */
const BRANCH_BODY_TYPES = new Set([
    'if_statement', 'else_clause', 'switch_case', 'switch_default',
    'ternary_expression', 'try_statement', 'catch_clause',
    'conditional_expression',
]);

function isConditionalContext(node) {
    let current = node.parent;
    while (current) {
        // Stop at function scope boundary
        if (SCOPE_NODE_TYPES.has(current.type)) return false;
        if (BRANCH_BODY_TYPES.has(current.type)) return true;
        current = current.parent;
    }
    return false;
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
    // Object.create(null) gives a map with NO inherited properties.
    // A plain {} inherits Object.prototype — so keys like 'constructor',
    // 'toString', 'valueOf', 'hasOwnProperty' already exist and are functions,
    // not undefined. On large TypeScript files (VS Code, chatServiceImpl.ts)
    // constructor parameters or destructure bindings hit these names and
    // mutations['constructor'].writes.push() throws "is not a function".
    const mutations = Object.create(null);
    if (!tree) return mutations;
    const root = tree.rootNode;

    // --- Track assignments ---
    // write.type: 'reassigned' = variable gets a new value entirely
    //             'written'    = property/element on an existing object is mutated
    // This distinction matters for dependency analysis: reassignment breaks object
    // identity, while a property write preserves it but mutates shared state.
    const assignments = root.descendantsOfType('assignment_expression');
    for (const node of assignments) {
        const left = node.childForFieldName('left');
        if (!left) continue;
        const fn = getEnclosingFunction(node);
        const line = node.startPosition.row + 1;
        const conditional = isConditionalContext(node);

        if (left.type === 'identifier') {
            const name = left.text;
            if (!mutations[name]) mutations[name] = { writes: [], reads: [] };
            mutations[name].writes.push({ fn, line, type: 'reassigned', conditional });
        }
        if (left.type === 'array_pattern' || left.type === 'object_pattern') {
            // Use the recursive helper that handles nested patterns, aliases, rest elements.
            // e.g. [a, [b, c]] = x  or  { a: { b }, c: d } = x
            _collectDestructuredMutations(left, mutations, fn, line);
        }
        if (left.type === 'member_expression') {
            // obj.prop = value  — property write, object identity preserved
            const name = getMemberExpressionName(left);
            if (name) {
                if (!mutations[name]) mutations[name] = { writes: [], reads: [] };
                mutations[name].writes.push({ fn, line, type: 'written', conditional });
            }
        }
        // subscript_expression: cache[key] = value → track as cache[]
        if (left.type === 'subscript_expression') {
            const obj = left.namedChildren[0];
            if (obj?.type === 'identifier') {
                const name = `${obj.text}[]`;
                if (!mutations[name]) mutations[name] = { writes: [], reads: [] };
                mutations[name].writes.push({ fn, line, type: 'written', conditional });
            }
        }
    }

    // --- Track augmented assignments: +=, -=, ||=, ??=, &&=, **=, etc. ---
    // Strategy A: tree-sitter grammars that emit augmented_assignment_expression as a
    //   distinct node type (most modern grammars).
    // Strategy B: fallback — scan assignment_expression nodes where the operator is not
    //   plain '=' (older grammars that lump all assignments under one node type).
    const AUG_OPERATORS = new Set(['+=','-=','*=','/=','%=','**=','|=','&=','^=','<<=','>>=','>>>=','||=','&&=','??=']);

    const augAssignments = root.descendantsOfType('augmented_assignment_expression');
    for (const node of augAssignments) {
        const left = node.childForFieldName('left');
        if (!left) continue;
        const fn = getEnclosingFunction(node);
        const line = node.startPosition.row + 1;
        const conditional = isConditionalContext(node);
        if (left.type === 'identifier') {
            const name = left.text;
            if (!mutations[name]) mutations[name] = { writes: [], reads: [] };
            mutations[name].writes.push({ fn, line, type: 'reassigned', conditional });
        } else if (left.type === 'member_expression') {
            const name = getMemberExpressionName(left);
            if (name) {
                if (!mutations[name]) mutations[name] = { writes: [], reads: [] };
                mutations[name].writes.push({ fn, line, type: 'written', conditional });
            }
        }
    }
    // Strategy B fallback: catch grammars where augmented = plain assignment_expression + operator
    for (const node of root.descendantsOfType('assignment_expression')) {
        const op = node.childForFieldName('operator')?.text || node.children.find(c => AUG_OPERATORS.has(c.text))?.text;
        if (!op || !AUG_OPERATORS.has(op)) continue;
        const left = node.childForFieldName('left');
        if (!left) continue;
        const fn = getEnclosingFunction(node);
        const line = node.startPosition.row + 1;
        const col  = node.startPosition.column; // used in dedup key — multiple stmts can share a line
        const conditionalB = isConditionalContext(node);
        if (left.type === 'identifier') {
            const name = left.text;
            if (!mutations[name]) mutations[name] = { writes: [], reads: [] };
            // Avoid double-counting if Strategy A already found it (match on line+col+fn)
            if (!mutations[name].writes.some(w => w.line === line && w.col === col && w.fn === fn)) {
                mutations[name].writes.push({ fn, line, col, type: 'reassigned', conditional: conditionalB });
            }
        } else if (left.type === 'member_expression') {
            const name = getMemberExpressionName(left);
            if (name) {
                if (!mutations[name]) mutations[name] = { writes: [], reads: [] };
                if (!mutations[name].writes.some(w => w.line === line && w.col === col && w.fn === fn)) {
                    mutations[name].writes.push({ fn, line, col, type: 'written', conditional: conditionalB });
                }
            }
        }
    }

    // --- Track update expressions: i++, --count, obj.count++ ---
    const updates = root.descendantsOfType('update_expression');
    for (const node of updates) {
        const arg = node.childForFieldName('argument');
        if (!arg) continue;
        const fn = getEnclosingFunction(node);
        const line = node.startPosition.row + 1;
        const conditional = isConditionalContext(node);
        if (arg.type === 'identifier') {
            const name = arg.text;
            if (!mutations[name]) mutations[name] = { writes: [], reads: [] };
            mutations[name].writes.push({ fn, line, type: 'reassigned', conditional });
        } else if (arg.type === 'member_expression') {
            // obj.count++  — property is mutated in-place → 'written'
            const name = getMemberExpressionName(arg);
            if (name) {
                if (!mutations[name]) mutations[name] = { writes: [], reads: [] };
                mutations[name].writes.push({ fn, line, type: 'written', conditional });
            }
        } else if (arg.type === 'subscript_expression') {
            // obj[expr]++  — computed property mutation. We can't know which element
            // statically, so record as objectName[] with computed: true.
            const obj = arg.namedChildren[0];
            if (obj?.type === 'identifier') {
                const name = `${obj.text}[]`;
                if (!mutations[name]) mutations[name] = { writes: [], reads: [] };
                mutations[name].writes.push({ fn, line, type: 'written', computed: true, conditional });
            }
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
    const captures = Object.create(null); // null prototype — function names can collide with Object.prototype
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

    let mutations = Object.create(null), closures = Object.create(null), timing = [], reactPatterns = [], floatingPromises = [], listenerParity = [], stateMutations = [];

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

    try { listenerParity = detectListenerParity(tree); }
    catch (e) { console.warn('[AST-TS] Listener parity detection failed:', e.message); }

    try { stateMutations = detectDirectStateMutations(tree); }
    catch (e) { console.warn('[AST-TS] State mutation detection failed:', e.message); }

    const formatted = formatAnalysis(mutations, closures, timing, reactPatterns, floatingPromises, listenerParity, stateMutations);

    tree.delete(); // Free WASM memory
    return { raw: { mutations, closures, timingNodes: timing, reactPatterns, floatingPromises, listenerParity, stateMutations }, formatted };
}

// ═══════════════════════════════════════════════════
// MULTI-FILE ANALYSIS (async — was sync with Babel)
// ═══════════════════════════════════════════════════

export async function runMultiFileAnalysis(files) {
    await initParser();

    const mergedMutations = Object.create(null);
    const mergedClosures = Object.create(null);
    const mergedTiming = [];
    const mergedReactPatterns = [];
    const mergedFloatingPromises = [];
    const mergedListenerParity = [];
    const mergedStateMutations = [];
    let totalParsed = 0;
    let totalFailed = 0;
    const failedFiles = [];
    const partialFiles = [];

    console.log(`[AST-TS DIAG] Starting batch: ${files.length} file(s) — ${files.map(f => f.name.split(/[\\/]/).pop()).join(', ')}`);

    for (const file of files) {
        const shortName = file.name.split(/[\\/]/).pop();
        console.log(`[AST-TS DIAG] Parsing: ${shortName} (${file.content?.length ?? 0} chars)`);
        const tree = parseCode(file.content, shortName);
        if (!tree) {
            console.warn(`[AST-TS DIAG] parseCode() returned null for ${shortName} — WASM threw during parse`);
            totalFailed++;
            failedFiles.push(shortName);
            continue;
        }
        console.log(`[AST-TS DIAG] parseCode() succeeded for ${shortName} — tree type: ${typeof tree}, rootNode: ${!!tree.rootNode}`);

        // Count error nodes vs total named nodes to get an error ratio.
        // Tree-sitter's key advantage is returning a partial tree even on syntax errors —
        // extraction functions (descendantsOfType) naturally walk around ERROR nodes.
        // Policy:
        //   ratio < 10% → analyze normally
        //   ratio 10–40% → analyze with PARTIAL_RESULT flag (injected into prompt as uncertain)
        //   ratio > 40%  → skip (tree is too broken to yield reliable facts)
        // Absolute floor: never skip a file with ≤ 20 total named nodes (tiny files are fine).
        //
        // IMPORTANT: this block is wrapped in try/catch because a tree can be returned by
        // parseCode() but have an internally inconsistent rootNode (WASM edge case on very
        // large/complex TS files). Calling .descendantsOfType() on such a tree causes a WASM
        // panic that propagates all the way to the outer catch in orchestrate.js, which then
        // skips AST analysis for ALL files. The try/catch here demotes that to a per-file skip.
        let errorCount, totalNodes, errorRatio;
        try {
            errorCount = tree.rootNode.descendantsOfType('ERROR').length;
            // descendantCount is the real web-tree-sitter API (total nodes at all depths).
            // namedDescendantCount does NOT exist in web-tree-sitter.
            totalNodes = tree.rootNode.descendantCount || 1;
            errorRatio = errorCount / totalNodes;
            console.log(`[AST-TS DIAG] ${shortName} — errorCount: ${errorCount}, totalNodes: ${totalNodes}, ratio: ${(errorRatio * 100).toFixed(1)}%`);
        } catch (introspectErr) {
            console.warn(`[AST-TS DIAG] Tree introspection CRASHED for ${shortName}: ${introspectErr.message}`);
            console.warn(`[AST-TS DIAG]   tree object keys: ${Object.keys(tree).join(', ')}`);
            console.warn(`[AST-TS DIAG]   rootNode: ${tree.rootNode}`);
            tree.delete();
            totalFailed++;
            failedFiles.push(shortName);
            continue;
        }

        if (errorRatio > 0.40 && totalNodes > 20) {
            console.warn(`[AST-TS] Skipping ${shortName}: error ratio ${(errorRatio * 100).toFixed(1)}% (${errorCount}/${totalNodes} nodes)`);
            totalFailed++;
            failedFiles.push(shortName);
            tree.delete();
            continue;
        }

        const isPartialResult = errorRatio > 0.10 && totalNodes > 20;
        if (isPartialResult) {
            console.warn(`[AST-TS] Partial analysis for ${shortName}: error ratio ${(errorRatio * 100).toFixed(1)}% — results flagged in output`);
        }

        let mutations = Object.create(null), closures = Object.create(null), timing = [], reactPatterns = [], floatingPromises = [], listenerParity = [], stateMutations = [];
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

        try { listenerParity = detectListenerParity(tree); anySucceeded = true; }
        catch (e) { console.warn(`[AST-TS] Listener parity failed for ${shortName}:`, e.message); }

        try { stateMutations = detectDirectStateMutations(tree); anySucceeded = true; }
        catch (e) { console.warn(`[AST-TS] State mutations failed for ${shortName}:`, e.message); }

        tree.delete(); // Free WASM memory

        if (!anySucceeded) {
            totalFailed++;
            failedFiles.push(shortName);
            continue;
        }

        totalParsed++;
        // Track partial files separately — DO NOT embed the flag in the map key.
        // Downstream code (expandMutationChains, emitRiskSignals) does moduleMap[fileName]
        // lookups using the extracted key fragment, so keys must stay clean shortNames.
        if (isPartialResult) partialFiles.push(shortName);

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
        for (const p of listenerParity) {
            mergedListenerParity.push({ ...p, file: shortName });
        }
        for (const p of stateMutations) {
            mergedStateMutations.push({ ...p, file: shortName });
        }
    }

    if (totalParsed === 0) {
        return {
            raw: { mutations: {}, closures: {}, timingNodes: [] },
            formatted: `⚠️ AST parse failed on all ${files.length} files — falling back to LLM-only analysis.`,
        };
    }

    const formatted = formatAnalysis(mergedMutations, mergedClosures, mergedTiming, mergedReactPatterns, mergedFloatingPromises, mergedListenerParity, mergedStateMutations);
    const header = `Files parsed: ${totalParsed}/${files.length}`;
    const failNote = totalFailed > 0
        ? ` (${totalFailed} failed: ${failedFiles.join(', ')})`
        : '';
    const partialNote = partialFiles.length > 0
        ? `\n⚠️ Partial parse (10–40% error ratio, treat facts as uncertain): ${partialFiles.join(', ')}`
        : '';
    const fullFormatted = `${header}${failNote}${partialNote}\n\n${formatted}`;

    return {
        raw: { mutations: mergedMutations, closures: mergedClosures, timingNodes: mergedTiming,
               reactPatterns: mergedReactPatterns, floatingPromises: mergedFloatingPromises,
               listenerParity: mergedListenerParity, stateMutations: mergedStateMutations },
        formatted: fullFormatted,
        partialFiles,
    };
}

// ═══════════════════════════════════════════════════
// FEATURE 4: React-Specific Pattern Detection
// Detects useState stale closures, missing useEffect cleanup,
// useCallback/useMemo with missing deps, unstable deps (new X()
// inline without useMemo), and listener options parity issues.
// ═══════════════════════════════════════════════════

const REACT_STATE_HOOKS = new Set(['useState', 'useReducer']);
const REACT_EFFECT_HOOKS = new Set(['useEffect', 'useLayoutEffect']);
const REACT_MEMO_HOOKS = new Set(['useCallback', 'useMemo']);

/**
 * Check whether a node is directly inside a useMemo() or useCallback() call.
 * Used to avoid false-positives when a value that looks unstable is in fact memoized.
 * @param {import('web-tree-sitter').Node} node
 * @returns {boolean}
 */
function isWrappedInMemoHook(node) {
    let cur = node.parent;
    while (cur) {
        if (cur.type === 'call_expression') {
            const fnNode = cur.childForFieldName('function');
            if (fnNode) {
                const name = fnNode.type === 'identifier' ? fnNode.text
                    : fnNode.type === 'member_expression' ? fnNode.childForFieldName('property')?.text
                    : null;
                if (name && REACT_MEMO_HOOKS.has(name)) return true;
            }
        }
        // Stop at function/arrow boundaries — useMemo in a different component doesn't count
        if (cur.type === 'function_declaration' || cur.type === 'function' ||
            cur.type === 'arrow_function' || cur.type === 'method_definition') break;
        cur = cur.parent;
    }
    return false;
}

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

                // Check if callback returns a cleanup function.
                // Use top-level child walk — NOT descendantsOfType — to avoid counting
                // return statements inside nested functions within the effect body.
                let hasCleanupReturn = false;
                const callbackBody = callback.childForFieldName('body') || callback;
                if (callbackBody) {
                    for (const stmt of callbackBody.namedChildren) {
                        if (stmt.type === 'return_statement') { hasCleanupReturn = true; break; }
                    }
                }

                if (hasTimingCall && !hasCleanupReturn) {
                    findings.push({
                        type: 'react_effect_no_cleanup',
                        description: `${hookName}() — contains timing/subscription call but no cleanup return`,
                        line,
                        fn: enclosingFn,
                    });
                }

                // Also flag useEffect that contains async operations (await) without a cleanup.
                // An async fetch inside an effect with no cleanup is a classic stale-update race:
                // if the component unmounts before the promise resolves, setState fires on dead state.
                //
                // IMPORTANT: only check top-level return statements (not returns inside nested
                // callbacks/functions). A return inside a .then() does NOT count as a cleanup.
                // Also: only flag when the return yields a function (cleanup fn), not just any return.
                const hasAwait = callback.descendantsOfType('await_expression').length > 0;
                if (hasAwait && !hasCleanupReturn) {
                    // Verify hasCleanupReturn is not being fooled by a return inside nested fn.
                    // Re-check: look for a top-level return that itself returns a function node.
                    let hasSyncFunctionReturn = false;
                    if (callbackBody) {
                        for (const stmt of callbackBody.namedChildren) {
                            if (stmt.type === 'return_statement') {
                                const retVal = stmt.namedChildren[0];
                                // A cleanup return must yield a function: () => {} or named fn
                                if (retVal && (
                                    retVal.type === 'arrow_function' ||
                                    retVal.type === 'function' ||
                                    retVal.type === 'function_expression' ||
                                    retVal.type === 'identifier'  // return cleanup (named fn ref)
                                )) {
                                    hasSyncFunctionReturn = true;
                                    break;
                                }
                            }
                        }
                    }
                    if (!hasSyncFunctionReturn && !hasTimingCall) {
                        // hasTimingCall already caught above — only emit once per useEffect
                        findings.push({
                            type: 'react_effect_async_no_cleanup',
                            description: `${hookName}() — contains async/await but no cleanup return (stale update risk on unmount)`,
                            line,
                            fn: enclosingFn,
                        });
                    }
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

                // ── Unstable dep detection ──
                // A dep is "unstable" if it's a new X(), {}, [], or inline function
                // created inside the component body without useMemo/useCallback.
                // Such deps produce a new reference every render, causing the effect
                // to re-run on EVERY render — adding a new listener each time.
                //
                // Strategy: for each identifier in the deps array, look for its
                // declaration in the tree. If the RHS is an unstable expression and
                // is NOT wrapped in useMemo/useCallback, flag it.
                if (depsArray && depsArray.type === 'array') {
                    for (const dep of depsArray.namedChildren) {
                        if (dep.type !== 'identifier') continue;
                        const depName = dep.text;

                        // Search all variable_declarator nodes in the file
                        const decls = root.descendantsOfType('variable_declarator');
                        for (const decl of decls) {
                            const nameNode = decl.childForFieldName('name');
                            const valueNode = decl.childForFieldName('value');
                            if (!nameNode || !valueNode) continue;
                            // Only match the exact dep name
                            if (nameNode.type !== 'identifier' || nameNode.text !== depName) continue;

                            const isNewExpr       = valueNode.type === 'new_expression';
                            const isObjectLiteral = valueNode.type === 'object';
                            const isArrayLiteral  = valueNode.type === 'array';
                            const isInlineArrow   = valueNode.type === 'arrow_function' ||
                                                    valueNode.type === 'function_expression';

                            if (isNewExpr || isObjectLiteral || isArrayLiteral || isInlineArrow) {
                                // Skip if wrapped in useMemo / useCallback
                                if (isWrappedInMemoHook(decl)) continue;

                                const ctorName = isNewExpr
                                    ? valueNode.childForFieldName('constructor')?.text || 'Object'
                                    : null;
                                const kind = isNewExpr      ? `new ${ctorName}()`
                                           : isObjectLiteral ? '{}'
                                           : isArrayLiteral  ? '[]'
                                           : '() => ...';

                                findings.push({
                                    type: 'react_unstable_dep',
                                    description: `${hookName}() dep \`${depName}\` is \`${kind}\` — new reference each render, effect re-runs every render → listener/subscription accumulation`,
                                    line,
                                    fn: enclosingFn,
                                    dep: depName,
                                });
                            }
                        }
                    }
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
// FEATURE 4b: Listener Options Parity Detection
// Checks that addEventListener and removeEventListener
// use the same `capture` flag. Passive/once don't affect
// listener identity (per DOM spec) — only capture does.
// Also flags asymmetric passive/once as a style warning.
// ═══════════════════════════════════════════════════

/**
 * Extract boolean value from an options object property.
 * Looks for { capture: true } or { capture: false } patterns.
 * @param {import('web-tree-sitter').Node} optionsNode
 * @param {string} propName
 * @returns {boolean|null} — true/false if found, null if not present
 */
function extractOptionFlag(optionsNode, propName) {
    if (!optionsNode || optionsNode.type !== 'object') return null;
    for (const prop of optionsNode.namedChildren) {
        if (prop.type !== 'pair' && prop.type !== 'shorthand_property_identifier_pattern') continue;
        const key = prop.childForFieldName('key');
        const val = prop.childForFieldName('value');
        if (key?.text === propName && val) {
            if (val.text === 'true')  return true;
            if (val.text === 'false') return false;
        }
    }
    return null;
}

/**
 * Detect addEventListener / removeEventListener options parity issues.
 * The capture flag MUST match between add and remove — this is the only flag
 * that affects listener identity per the DOM Event Listener specification.
 * Also warns about asymmetric passive/once as a style issue.
 *
 * @param {import('web-tree-sitter').Tree} tree
 * @returns {Array<{type: string, description: string, addLine: number, removeLine: number, fn: string}>}
 */
export function detectListenerParity(tree) {
    const findings = [];
    if (!tree) return findings;
    const root = tree.rootNode;

    // Collect all addEventListener calls with their options
    const addCalls = [];
    const removeCalls = [];

    const calls = root.descendantsOfType('call_expression');
    for (const call of calls) {
        const fnNode = call.childForFieldName('function');
        if (!fnNode || fnNode.type !== 'member_expression') continue;
        const prop = fnNode.childForFieldName('property');
        if (!prop) continue;

        const argsNode = call.childForFieldName('arguments');
        const callArgs = argsNode?.namedChildren || [];
        if (callArgs.length < 2) continue;

        const eventType = callArgs[0]?.text?.replace(/['"`]/g, '') || '';
        const listenerNode = callArgs[1];
        const listenerName = listenerNode?.type === 'identifier' ? listenerNode.text : '(anonymous)';
        const optionsNode  = callArgs[2] || null;
        const line = call.startPosition.row + 1;
        const enclosingFn = getEnclosingFunction(call);

        if (prop.text === 'addEventListener') {
            addCalls.push({ eventType, listenerName, optionsNode, line, enclosingFn });
        } else if (prop.text === 'removeEventListener') {
            removeCalls.push({ eventType, listenerName, optionsNode, line, enclosingFn });
        }
    }

    // For each add, find a corresponding remove with the same (eventType, listenerName)
    for (const add of addCalls) {
        const match = removeCalls.find(r =>
            r.eventType === add.eventType && r.listenerName === add.listenerName
        );
        if (!match) continue; // no remove found — missing cleanup detected elsewhere

        const addCapture    = extractOptionFlag(add.optionsNode, 'capture') ?? false;
        const removeCapture = extractOptionFlag(match.optionsNode, 'capture') ?? false;
        const addPassive    = extractOptionFlag(add.optionsNode, 'passive');
        const removePassive = extractOptionFlag(match.optionsNode, 'passive');

        // capture mismatch — this WILL break listener removal (spec-defined)
        if (addCapture !== removeCapture) {
            findings.push({
                type: 'listener_capture_mismatch',
                description: `addEventListener('${add.eventType}', ${add.listenerName}) added with capture:${addCapture} but removed with capture:${removeCapture} — listener will NOT be removed (capture flag must match)`,
                addLine: add.line,
                removeLine: match.line,
                fn: add.enclosingFn,
            });
        }

        // passive/once mismatch — style warning only, does NOT affect removal
        // but signals that the add/remove calls were written inconsistently
        if (addPassive !== null && removePassive !== null && addPassive !== removePassive) {
            findings.push({
                type: 'listener_options_asymmetric',
                description: `addEventListener('${add.eventType}', ${add.listenerName}) options differ between add (passive:${addPassive}) and remove (passive:${removePassive}) — passive does not affect removal but signals inconsistent cleanup code`,
                addLine: add.line,
                removeLine: match.line,
                fn: add.enclosingFn,
            });
        }

        // The most common pattern: add has options but remove omits them entirely
        // Flag this as a style warning so the LLM doesn't hallucinate it as the bug
        if (add.optionsNode && !match.optionsNode) {
            const hasRealCapture = addCapture === true; // passive-only: not a bug
            findings.push({
                type: hasRealCapture ? 'listener_capture_mismatch' : 'listener_options_omitted',
                description: `addEventListener('${add.eventType}', ${add.listenerName}) added with options ${add.optionsNode.text} but removeEventListener omits options — ${hasRealCapture ? '⚠ capture:true will prevent removal' : 'passive/once omission is harmless (spec: only capture affects identity)'}`,
                addLine: add.line,
                removeLine: match.line,
                fn: add.enclosingFn,
            });
        }
    }

    return findings;
}

// ═══════════════════════════════════════════════════
// FEATURE 4c: Direct State Mutation Detection
// Finds useState-derived variables that are mutated
// in-place (arr.push, obj.key = val) instead of going
// through the setter — React won't detect these as
// changes and the component won't re-render.
// ═══════════════════════════════════════════════════

// In-place array/object mutation methods — calling any of these on a
// useState variable is a bug. Excludes non-mutating methods (.map, .filter etc.)
const STATE_MUTATION_METHODS = new Set([
    'push', 'pop', 'shift', 'unshift', 'splice',
    'sort', 'reverse', 'fill', 'copyWithin',
    'delete',           // Map/Set
    'set', 'add',       // Map/Set (context-dependent, included for coverage)
    'clear',            // Map/Set
]);

/**
 * Detect direct in-place mutations of React useState variables.
 * Returns findings when state (derived from useState) is mutated with methods
 * like .push()/.splice()/.sort() or via direct property assignment (state.x = y).
 * React's reconciler only triggers re-renders when the state *reference* changes
 * via the setter — in-place mutations are invisible to it.
 *
 * @param {import('web-tree-sitter').Tree} tree
 * @returns {Array<{type: string, description: string, line: number, fn: string, stateVar: string}>}
 */
export function detectDirectStateMutations(tree) {
    const findings = [];
    if (!tree) return findings;
    const root = tree.rootNode;

    // ── Step 1: collect all state variable names from useState() calls ──
    // Pattern: const [value, setValue] = useState(...)
    // We want the first identifier in the array destructuring.
    const stateVars = new Set();
    const calls = root.descendantsOfType('call_expression');
    for (const call of calls) {
        const fnNode = call.childForFieldName('function');
        if (!fnNode) continue;
        // Allow both `useState(...)` and `React.useState(...)`
        const name = fnNode.type === 'identifier' ? fnNode.text
            : fnNode.type === 'member_expression' ? fnNode.childForFieldName('property')?.text
            : null;
        if (name !== 'useState' && name !== 'useReducer') continue;

        // Walk up to find the variable_declarator
        let cur = call.parent;
        while (cur && cur.type !== 'variable_declarator') cur = cur.parent;
        if (!cur) continue;

        const nameNode = cur.childForFieldName('name');
        if (!nameNode) continue;

        // Array destructuring: const [state, setState] = useState(...)
        if (nameNode.type === 'array_pattern') {
            const first = nameNode.namedChildren[0];
            if (first && first.type === 'identifier') {
                stateVars.add(first.text);
            }
        }
        // Bare assignment: const state = useState(...) — less common but valid
        if (nameNode.type === 'identifier') {
            stateVars.add(nameNode.text);
        }
    }

    if (stateVars.size === 0) return findings;

    // ── Step 2: scan for mutations of those variables ──

    // 2a. Method calls: stateVar.push(...), stateVar.splice(...) etc.
    for (const call of calls) {
        const fnNode = call.childForFieldName('function');
        if (!fnNode || fnNode.type !== 'member_expression') continue;
        const obj  = fnNode.childForFieldName('object');
        const prop = fnNode.childForFieldName('property');
        if (!obj || !prop) continue;
        if (obj.type !== 'identifier') continue;
        if (!stateVars.has(obj.text)) continue;
        if (!STATE_MUTATION_METHODS.has(prop.text)) continue;

        const line = call.startPosition.row + 1;
        const enclosingFn = getEnclosingFunction(call);
        findings.push({
            type: 'react_direct_state_mutation',
            description: `\`${obj.text}.${prop.text}()\` mutates state in-place — React will NOT re-render. Use \`set${obj.text.charAt(0).toUpperCase() + obj.text.slice(1)}([...${obj.text}, ...])\` or spread/copy instead.`,
            line,
            fn: enclosingFn,
            stateVar: obj.text,
        });
    }

    // 2b. Direct property assignment: stateVar.key = val OR stateVar[key] = val
    const assignments = root.descendantsOfType('assignment_expression');
    for (const assign of assignments) {
        const left = assign.childForFieldName('left');
        if (!left) continue;
        // Must be a member expression (stateVar.prop = ... or stateVar[key] = ...)
        if (left.type !== 'member_expression' && left.type !== 'subscript_expression') continue;
        const obj = left.childForFieldName('object');
        if (!obj || obj.type !== 'identifier') continue;
        if (!stateVars.has(obj.text)) continue;
        // Exclude setter-call-like patterns (stateVar = ... would be caught above)
        const prop = left.childForFieldName('property') ?? left.childForFieldName('index');
        const propText = prop?.text ?? '?';

        const line = assign.startPosition.row + 1;
        const enclosingFn = getEnclosingFunction(assign);
        findings.push({
            type: 'react_direct_state_mutation',
            description: `\`${obj.text}.${propText} = ...\` directly mutates state — React will NOT detect this change. Use the state setter with a new object copy: \`set${obj.text.charAt(0).toUpperCase() + obj.text.slice(1)}({ ...${obj.text}, ${propText}: newValue })\`.`,
            line,
            fn: enclosingFn,
            stateVar: obj.text,
        });
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
    'connect', 'query', 'findOne', 'save', 'create',
    'send', 'post', 'put', 'patch',
]);

// Array iteration methods that do NOT handle Promise return values from callbacks.
// Passing an async callback to any of these silently discards all Promises.
const VOID_ITERATION_METHODS = new Set(['forEach', 'find', 'findIndex', 'some', 'every', 'filter', 'reduce']);

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

        if (!apiName) {
            // forEach(async) / find(async) etc — the async callback IS internally awaited
            // but the iteration method ignores the returned Promise entirely, so all
            // background work runs fire-and-forget with no way to await completion.
            if (fnNode.type === 'member_expression') {
                const prop = fnNode.childForFieldName('property');
                if (prop && VOID_ITERATION_METHODS.has(prop.text)) {
                    const argsNode = call.childForFieldName('arguments');
                    const firstArg = argsNode?.namedChildren?.[0];
                    if (
                        firstArg &&
                        (firstArg.type === 'arrow_function' ||
                         firstArg.type === 'function_expression' ||
                         firstArg.type === 'function') &&
                        firstArg.text.trimStart().startsWith('async ')
                    ) {
                        const line = call.startPosition.row + 1;
                        const enclosingFn = getEnclosingFunction(call);
                        floating.push({ api: `${prop.text}(async)`, line, fn: enclosingFn, kind: 'forEach_async' });
                    }
                }
            }
            continue;
        }

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
// CAUSAL CHAIN BUILDER
// Connects timing nodes → state writes into explicit
// cause→effect chains using already-extracted data.
// No new AST traversal — pure post-processing.
// ═══════════════════════════════════════════════════

/**
 * Build cause→effect chains by joining timing nodes with downstream state writes.
 * A chain is: async trigger → React state setter in same function, after trigger line.
 *
 * @param {Array<{api,callback,line,enclosingFn,file?}>} timing  — from findTimingNodes()
 * @param {Object} mutations  — from extractMutationChains(), keys "varName [file]" or "varName"
 * @param {Array<{type,line,file?}>} reactPatterns  — from detectReactPatterns()
 * @returns {Array<{trigger,write,triggerFn,guardPresent,inEffectNoCleanup,file?}>}
 */
function buildCausalChains(timing, mutations, reactPatterns) {
    const chains = [];

    // Index: fn → writes [{name, line, type}]
    const writesByFn = Object.create(null);
    for (const [key, data] of Object.entries(mutations)) {
        const varName = key.split(/\s*\[/)[0].trim();
        for (const w of data.writes) {
            if (!writesByFn[w.fn]) writesByFn[w.fn] = [];
            writesByFn[w.fn].push({ name: varName, line: w.line });
        }
    }

    // Index: fn → reads [{name, line}]  (for cancellation guard detection)
    const readsByFn = Object.create(null);
    for (const [key, data] of Object.entries(mutations)) {
        const varName = key.split(/\s*\[/)[0].trim();
        for (const r of data.reads) {
            if (!readsByFn[r.fn]) readsByFn[r.fn] = [];
            readsByFn[r.fn].push({ name: varName, line: r.line });
        }
    }

    // Index: fn → writes (for detecting let cancelled = false; and cleanup return patterns)
    const writeNamesByFn = Object.create(null);
    for (const [key, data] of Object.entries(mutations)) {
        const varName = key.split(/\s*\[/)[0].trim();
        for (const w of data.writes) {
            if (!writeNamesByFn[w.fn]) writeNamesByFn[w.fn] = new Set();
            writeNamesByFn[w.fn].add(varName);
        }
    }

    // Substring keywords as LOW-CONFIDENCE fallback only.
    // Primary guard detection is structural (see below).
    const CANCEL_KEYWORDS_SUBSTR = ['cancel', 'abort', 'ignore', 'stale', 'mount', 'active'];

    // AbortController variable names — variables whose name contains 'controller' or 'abort'
    // and are written in the same function as the trigger.
    const ABORT_CONTROLLER_SUBSTR = ['controller', 'abort', 'ac'];

    // Only async-boundary triggers produce stale-write risk
    const ASYNC_APIS = new Set(['fetch', 'then', 'catch', 'finally']);

    for (const t of timing) {
        if (!ASYNC_APIS.has(t.api)) continue;

        // Resolve effective callback function name.
        const callbackFn = (t.callback === '(inline)' || t.callback === '(arrow)')
            ? t.enclosingFn
            : t.callback;

        // Find state writes in this function that occur AFTER the trigger line.
        // React setter convention: /^set[A-Z]/, dispatch, or this.setState
        const writesAfter = (writesByFn[callbackFn] || []).filter(w => w.line > t.line);
        const stateWrites = writesAfter.filter(w =>
            /^set[A-Z]/.test(w.name) || w.name === 'dispatch' || w.name === 'setState'
        );

        if (stateWrites.length === 0) continue;

        for (const sw of stateWrites) {
            const readsInFn = readsByFn[callbackFn] || [];
            const writtenInFn = writeNamesByFn[callbackFn] || new Set();

            // ── Guard detection (three strategies, strongest first) ────────────

            // Strategy 1 (strongest): AbortController pattern
            // Detected when: a variable containing 'controller'/'abort'/'ac' is written
            // in this function AND read between trigger and write lines.
            const hasAbortController = [...writtenInFn].some(name =>
                ABORT_CONTROLLER_SUBSTR.some(kw => name.toLowerCase().includes(kw))
            ) && readsInFn.some(r =>
                r.line > t.line && r.line <= sw.line &&
                ABORT_CONTROLLER_SUBSTR.some(kw => r.name.toLowerCase().includes(kw))
            );

            // Strategy 2 (strong): boolean flag pattern
            // let cancelled = false written in fn, then read as a condition before the write.
            // Detected: a variable written (assigned) in this fn that is also read between
            // trigger and write → classic `if (!cancelled) setState(...)` guard.
            const hasBooleanFlagGuard = readsInFn.some(r =>
                r.line > t.line && r.line <= sw.line &&
                writtenInFn.has(r.name) &&
                // Must look like a boolean guard name (not just any variable read)
                CANCEL_KEYWORDS_SUBSTR.some(kw => r.name.toLowerCase().includes(kw))
            );

            // Strategy 3 (fallback, low confidence): pure substring heuristic on reads
            const hasSubstringGuard = !hasAbortController && !hasBooleanFlagGuard &&
                readsInFn.some(r =>
                    r.line > t.line && r.line <= sw.line &&
                    CANCEL_KEYWORDS_SUBSTR.some(kw => r.name.toLowerCase().includes(kw))
                );

            const guardPresent = hasAbortController || hasBooleanFlagGuard || hasSubstringGuard;
            const guardConfidence = hasAbortController ? 'high'
                : hasBooleanFlagGuard ? 'high'
                : hasSubstringGuard ? 'low'
                : null;

            // Missing async cleanup signal
            const inEffectNoCleanup = reactPatterns.some(p =>
                (p.type === 'react_effect_no_cleanup' || p.type === 'react_effect_async_no_cleanup') &&
                (!t.file || !p.file || p.file === t.file)
            );

            chains.push({
                trigger: `${t.api}() [L${t.line}]`,
                triggerFn: callbackFn,
                write: `${sw.name}() in ${callbackFn} [L${sw.line}]`,
                guardPresent,
                guardConfidence,  // 'high' | 'low' | null
                inEffectNoCleanup,
                file: t.file,
                // Provenance for downstream UI / solvability logic
                _provenance: {
                    triggerLine: t.line,
                    writeLine: sw.line,
                    triggerApi: t.api,
                    writeVar: sw.name,
                    file: t.file || null,
                },
            });
        }
    }

    return chains;
}

// ═══════════════════════════════════════════════════
// MULTI-SOURCE RACE DETECTOR
// Post-processes buildCausalChains() output.
// If 2+ distinct async triggers both write to the same
// state variable without guards, that is a write race.
// No new AST traversal — pure grouping of existing data.
// ═══════════════════════════════════════════════════

/**
 * Detect multi-source write races from an existing chains array.
 * @param {Array} chains — result of buildCausalChains()
 * @returns {Array<{varName: string, sources: Array}>}
 */
function detectMultiSourceRace(chains) {
    const byWriteVar = Object.create(null);
    for (const c of chains) {
        if (c.guardPresent) continue; // guarded writes are intentionally safe
        // Write field format: "setResults() in doSearch [L22]" → varName = "setResults"
        const varName = c.write.split('(')[0].trim();
        if (!byWriteVar[varName]) byWriteVar[varName] = [];
        byWriteVar[varName].push(c);
    }

    const races = [];
    for (const [varName, writingChains] of Object.entries(byWriteVar)) {
        if (writingChains.length < 2) continue;
        // Only a race if the writes come from at least 2 independent async triggers
        const uniqueTriggers = new Set(writingChains.map(c => c.trigger));
        if (uniqueTriggers.size < 2) continue;
        races.push({
            varName,
            sources: writingChains.map(c => ({ trigger: c.trigger, write: c.write, file: c.file })),
        });
    }
    return races;
}

// ═══════════════════════════════════════════════════
// FORMAT: Same output format as the old engine
// ═══════════════════════════════════════════════════

function formatAnalysis(mutations, closures, timing, reactPatterns = [], floatingPromises = [], listenerParity = [], stateMutations = []) {
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
                // Split by mutation type for clearer output:
                //   reassigned: variable received a new value (a = x, augmented +=, destructured)
                //   written:    property/element on the object was mutated (a.x = y, a[k] = y)
                // Unlabeled writes (pre-migration data) fall back to old behaviour.
                const reassigned = data.writes.filter(w => w.type === 'reassigned' || (!w.type && !isPropertyMutation));
                const written    = data.writes.filter(w => w.type === 'written'    || (!w.type && isPropertyMutation));
                if (reassigned.length > 0) {
                    lines.push(`    reassigned: ${reassigned.map(w => `${w.fn} L${w.line}${w.conditional ? ' [CONDITIONAL]' : ''}`).join(', ')}`);
                }
                if (written.length > 0) {
                    const annotation = name.includes('[]')
                        ? (written.some(w => w.computed) ? ' ← computed property write' : ' ← array element')
                        : ' ← property write';
                    lines.push(`    written: ${written.map(w => `${w.fn} L${w.line}${w.conditional ? ' [CONDITIONAL]' : ''}`).join(', ')}${annotation}`);
                }
                if (reassigned.length === 0 && written.length === 0) {
                    // Fallback — shouldn't occur after full migration but keeps output safe
                    lines.push(`    written: ${data.writes.map(w => `${w.fn} L${w.line}`).join(', ')}`);
                }
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

    // React patterns — split into unstable deps (own section) and other patterns
    const unstableDeps    = reactPatterns.filter(p => p.type === 'react_unstable_dep');
    const otherReactPats  = reactPatterns.filter(p => p.type !== 'react_unstable_dep');

    if (otherReactPats.length > 0) {
        lines.push('React Patterns Detected:');
        for (const p of otherReactPats) {
            lines.push(`  [${p.type}] ${p.description}  [L${p.line}]`);
        }
        lines.push('');
    }

    // Unstable useEffect deps — own section for clarity.
    // Each entry means the dep produces a new reference every render,
    // causing the effect to re-run and accumulate listeners/subscriptions.
    if (unstableDeps.length > 0) {
        lines.push('Unstable useEffect Dependencies (new reference each render):');
        for (const p of unstableDeps) {
            lines.push(`  [${p.dep || p.fn}] ${p.description}  [L${p.line}]`);
        }
        lines.push('  → Wrap with useMemo/useCallback in the parent, or remove from deps if stable.');
        lines.push('');
    }

    // Floating promises — split by kind for targeted output
    const trueFloating    = floatingPromises.filter(p => p.kind !== 'forEach_async');
    const forEachAsyncCalls = floatingPromises.filter(p => p.kind === 'forEach_async');

    if (trueFloating.length > 0) {
        lines.push('Floating Promises (unawaited async calls):');
        for (const p of trueFloating) {
            lines.push(`  ${p.api}()  in ${p.fn}  [L${p.line}]  ← not awaited`);
        }
        lines.push('');
    }

    if (forEachAsyncCalls.length > 0) {
        lines.push('forEach(async) — Promises silently discarded by iteration method:');
        for (const p of forEachAsyncCalls) {
            lines.push(`  ${p.api}  in ${p.fn}  [L${p.line}]  ← use Promise.all(array.map(async ...)) instead`);
        }
        lines.push('');
    }

    // Causal chains — connects async triggers to downstream state writes.
    // Only emitted when there is at least one unguarded chain worth flagging.
    const chains = buildCausalChains(timing, mutations, reactPatterns);
    const flaggedChains = chains.filter(c => !c.guardPresent);
    const lowConfGuarded = chains.filter(c => c.guardPresent && c.guardConfidence === 'low');
    if (flaggedChains.length > 0 || lowConfGuarded.length > 0) {
        lines.push('Causal Chains (async → state write):');
        for (const c of flaggedChains) {
            const fileTag = c.file ? ` [${c.file}]` : '';
            lines.push(`  ${c.trigger}${fileTag}  →  ${c.write}`);
            lines.push(`  ⚠ no cancellation guard — stale write risk`);
            if (c.inEffectNoCleanup) {
                lines.push(`  ⚠ async inside useEffect with no cleanup return`);
            }
            lines.push('');
        }
        for (const c of lowConfGuarded) {
            const fileTag = c.file ? ` [${c.file}]` : '';
            lines.push(`  ${c.trigger}${fileTag}  →  ${c.write}`);
            lines.push(`  ~ guard detected (low confidence — verify manually)`);
            lines.push('');
        }
    }

    // Multi-source write races — two unguarded async paths writing to the same state var
    const multiSourceRaces = detectMultiSourceRace(chains);
    if (multiSourceRaces.length > 0) {
        lines.push('Multi-Source Write Races:');
        for (const race of multiSourceRaces) {
            lines.push(`  ${race.varName} — written by ${race.sources.length} independent async sources`);
            for (const src of race.sources) {
                const fileTag = src.file ? ` [${src.file}]` : '';
                lines.push(`    ${src.trigger}${fileTag}  →  ${src.write}`);
            }
            lines.push(`  ⚠ unguarded — last to resolve silently overwrites all prior results`);
            lines.push('');
        }
    }

    // Listener options parity issues
    if (listenerParity.length > 0) {
        // Separate breaking issues (capture mismatch) from style warnings (passive asymmetry)
        const breaking = listenerParity.filter(p => p.type === 'listener_capture_mismatch');
        const styleWarn = listenerParity.filter(p => p.type !== 'listener_capture_mismatch');

        if (breaking.length > 0) {
            lines.push('Event Listener Removal Failures (capture flag mismatch):');
            for (const p of breaking) {
                lines.push(`  ${p.description}  [addL${p.addLine} / removeL${p.removeLine}]`);
            }
            lines.push('');
        }
        if (styleWarn.length > 0) {
            lines.push('Event Listener Options Notes (style, does not affect removal):');
            for (const p of styleWarn) {
                lines.push(`  ${p.description}  [addL${p.addLine} / removeL${p.removeLine}]`);
            }
            lines.push('');
        }
    }

    // Direct state mutations (React useState variables mutated in-place)
    if (stateMutations.length > 0) {
        lines.push('Direct State Mutations (React will NOT re-render):');
        for (const m of stateMutations) {
            lines.push(`  ${m.description}  [L${m.line}]`);
        }
        lines.push('  ⚠ React only detects state changes via the setter (setState). In-place mutations are invisible to the reconciler.');
        lines.push('');
    }

    if (mutatedVars.length === 0 && timing.length === 0 && captureEntries.length === 0
        && reactPatterns.length === 0 && floatingPromises.length === 0 && listenerParity.length === 0
        && stateMutations.length === 0) {
        lines.push('No significant mutation chains, timing nodes, or closure captures detected.');
        lines.push('The LLM should analyze the code without AST hints.');
        lines.push('');
    }

    return lines.join('\n');
}