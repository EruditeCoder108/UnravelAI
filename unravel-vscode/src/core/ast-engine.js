// ═══════════════════════════════════════════════════
// UNRAVEL v3 — AST Pre-Analysis Engine
// Deterministic static analysis using @babel/parser
// Outputs verified ground truth for the LLM prompt
// ═══════════════════════════════════════════════════

import * as parser from '@babel/parser';
import _traverse from '@babel/traverse';

// Handle both ESM default and CJS interop
const traverse = _traverse.default || _traverse;

// --- Timing/Async API names we care about ---
const TIMING_APIS = new Set([
    'setTimeout', 'setInterval', 'clearInterval', 'clearTimeout',
    'addEventListener', 'removeEventListener',
    'requestAnimationFrame', 'cancelAnimationFrame',
    'fetch', 'then', 'catch', 'finally',
]);

// ═══════════════════════════════════════════════════
// PARSER WRAPPER
// Safely parse JS/JSX/TS into a Babel AST
// ═══════════════════════════════════════════════════

function parseCode(code) {
    try {
        return parser.parse(code, {
            sourceType: 'module',
            plugins: [
                'jsx',
                'typescript',
                'classProperties',
                'optionalChaining',
                'nullishCoalescingOperator',
                'decorators-legacy',
            ],
            errorRecovery: true,
        });
    } catch (err) {
        console.warn('[AST] Parse failed, attempting script mode:', err.message);
        try {
            return parser.parse(code, {
                sourceType: 'script',
                plugins: ['jsx', 'typescript', 'classProperties', 'optionalChaining'],
                errorRecovery: true,
            });
        } catch (err2) {
            console.error('[AST] Parse failed completely:', err2.message);
            return null;
        }
    }
}

// ═══════════════════════════════════════════════════
// HELPER: Get the enclosing function name for a node
// ═══════════════════════════════════════════════════

function getEnclosingFunction(path) {
    let current = path.parentPath;
    while (current) {
        if (current.isFunctionDeclaration() && current.node.id) {
            return current.node.id.name;
        }
        if (current.isFunctionExpression() && current.node.id) {
            return current.node.id.name;
        }
        if (current.isArrowFunctionExpression() || current.isFunctionExpression()) {
            // Check if assigned to a variable: const foo = () => {}
            if (current.parentPath?.isVariableDeclarator()) {
                return current.parentPath.node.id?.name || '(anonymous)';
            }
            // Check if it's a method: { foo() {} } or { foo: () => {} }
            if (current.parentPath?.isObjectProperty()) {
                const key = current.parentPath.node.key;
                return key.name || key.value || '(anonymous)';
            }
            if (current.parentPath?.isObjectMethod?.() || current.parentPath?.isClassMethod?.()) {
                const key = current.parentPath.node.key;
                return key.name || key.value || '(method)';
            }
            return '(anonymous)';
        }
        if (current.isObjectMethod() || current.isClassMethod()) {
            const key = current.node.key;
            return key.name || key.value || '(method)';
        }
        current = current.parentPath;
    }
    return '(module scope)';
}

// ═══════════════════════════════════════════════════
// FEATURE 1: Variable Mutation Chains
// Walks AssignmentExpression and UpdateExpression nodes
// Records: variable name, line, enclosing function, direction
// ═══════════════════════════════════════════════════

export function extractMutationChains(ast) {
    // Map: variableName -> { writes: [{fn, line}], reads: [{fn, line}] }
    const mutations = {};

    if (!ast) return mutations;

    traverse(ast, {
        // Track assignments: x = ..., x += ..., etc.
        AssignmentExpression(path) {
            const left = path.node.left;
            if (left.type === 'Identifier') {
                const name = left.name;
                const fn = getEnclosingFunction(path);
                const line = path.node.loc?.start?.line || 0;

                if (!mutations[name]) mutations[name] = { writes: [], reads: [] };
                mutations[name].writes.push({ fn, line });
            }
            // Also handle destructuring: [a, b] = ... or { a, b } = ...
            if (left.type === 'ArrayPattern') {
                left.elements.forEach(el => {
                    if (el?.type === 'Identifier') {
                        const name = el.name;
                        const fn = getEnclosingFunction(path);
                        const line = path.node.loc?.start?.line || 0;
                        if (!mutations[name]) mutations[name] = { writes: [], reads: [] };
                        mutations[name].writes.push({ fn, line });
                    }
                });
            }
            if (left.type === 'ObjectPattern') {
                left.properties.forEach(prop => {
                    if (prop.value?.type === 'Identifier') {
                        const name = prop.value.name;
                        const fn = getEnclosingFunction(path);
                        const line = path.node.loc?.start?.line || 0;
                        if (!mutations[name]) mutations[name] = { writes: [], reads: [] };
                        mutations[name].writes.push({ fn, line });
                    }
                });
            }
        },

        // Track post/pre increment/decrement: i++, --count, etc.
        UpdateExpression(path) {
            const arg = path.node.argument;
            if (arg.type === 'Identifier') {
                const name = arg.name;
                const fn = getEnclosingFunction(path);
                const line = path.node.loc?.start?.line || 0;

                if (!mutations[name]) mutations[name] = { writes: [], reads: [] };
                mutations[name].writes.push({ fn, line });
            }
        },

        // Track reads: any Identifier that isn't on the left side of an assignment
        Identifier(path) {
            // Skip declarations and left-hand sides
            if (path.parentPath?.isVariableDeclarator() && path.key === 'id') return;
            if (path.parentPath?.isAssignmentExpression() && path.key === 'left') return;
            if (path.parentPath?.isFunction() && path.listKey === 'params') return;
            if (path.parentPath?.isProperty() && path.key === 'key') return;
            if (path.parentPath?.isImportSpecifier?.()) return;
            if (path.parentPath?.isMemberExpression() && path.key === 'property') return;

            const name = path.node.name;
            // Skip common globals / noise
            if (['undefined', 'null', 'console', 'window', 'document', 'module', 'exports', 'require', 'process'].includes(name)) return;

            const fn = getEnclosingFunction(path);
            const line = path.node.loc?.start?.line || 0;

            if (!mutations[name]) mutations[name] = { writes: [], reads: [] };
            // Only add if not already tracked at this exact location
            const existing = mutations[name].reads.find(r => r.fn === fn && r.line === line);
            if (!existing) {
                mutations[name].reads.push({ fn, line });
            }
        },
    });

    return mutations;
}

// ═══════════════════════════════════════════════════
// FEATURE 2: Closure Captures
// Detects variables captured from outer scopes
// Returns: functionName -> [captured variable names]
// ═══════════════════════════════════════════════════

export function trackClosureCaptures(ast) {
    // Map: functionName -> [{ variable, declaredIn }]
    const captures = {};

    if (!ast) return captures;

    traverse(ast, {
        'FunctionDeclaration|FunctionExpression|ArrowFunctionExpression'(path) {
            const fnName = getFunctionName(path);
            const capturedVars = new Set();

            // Get this function's own scope bindings
            const ownBindings = path.scope.bindings;

            // Walk all identifiers inside this function
            path.traverse({
                Identifier(innerPath) {
                    const name = innerPath.node.name;

                    // Skip if it's a declaration in this scope
                    if (ownBindings[name]) return;
                    // Skip property access keys
                    if (innerPath.parentPath?.isMemberExpression() && innerPath.key === 'property') return;
                    // Skip function params (they ARE own bindings, but double-check)
                    if (innerPath.parentPath?.isFunction() && innerPath.listKey === 'params') return;
                    // Skip object keys
                    if (innerPath.parentPath?.isProperty() && innerPath.key === 'key') return;
                    // Skip imports
                    if (innerPath.parentPath?.isImportSpecifier?.()) return;

                    // Check if this variable is bound in an outer scope
                    const binding = innerPath.scope.getBinding(name);
                    if (binding && !path.scope.hasOwnBinding(name)) {
                        capturedVars.add(name);
                    }
                },
            });

            if (capturedVars.size > 0) {
                captures[fnName] = Array.from(capturedVars);
            }
        },
    });

    return captures;
}

function getFunctionName(path) {
    if (path.node.id) return path.node.id.name;
    if (path.parentPath?.isVariableDeclarator()) {
        return path.parentPath.node.id?.name || '(anonymous)';
    }
    if (path.parentPath?.isObjectProperty()) {
        const key = path.parentPath.node.key;
        return key.name || key.value || '(anonymous)';
    }
    if (path.parentPath?.isObjectMethod?.() || path.parentPath?.isClassMethod?.()) {
        const key = path.parentPath.node.key;
        return key.name || key.value || '(method)';
    }
    return '(anonymous)';
}

// ═══════════════════════════════════════════════════
// FEATURE 3: Timing / Async Node Detection
// Finds calls to setTimeout, setInterval, fetch, etc.
// Returns array of { api, callback, line, enclosingFn }
// ═══════════════════════════════════════════════════

export function findTimingNodes(ast) {
    const timingNodes = [];

    if (!ast) return timingNodes;

    traverse(ast, {
        CallExpression(path) {
            const callee = path.node.callee;
            let apiName = null;

            // Direct call: setTimeout(...)
            if (callee.type === 'Identifier' && TIMING_APIS.has(callee.name)) {
                apiName = callee.name;
            }

            // Method call: window.setTimeout(...), element.addEventListener(...)
            if (callee.type === 'MemberExpression' && callee.property) {
                const propName = callee.property.name || callee.property.value;
                if (TIMING_APIS.has(propName)) {
                    apiName = propName;
                }
            }

            // Promise chain: .then(...), .catch(...)
            if (callee.type === 'MemberExpression' && callee.property) {
                const propName = callee.property.name;
                if (propName === 'then' || propName === 'catch' || propName === 'finally') {
                    apiName = propName;
                }
            }

            if (apiName) {
                const line = path.node.loc?.start?.line || 0;
                const enclosingFn = getEnclosingFunction(path);

                // Try to identify the callback function name
                let callbackName = '(inline)';
                const firstArg = path.node.arguments[0];
                if (firstArg?.type === 'Identifier') {
                    callbackName = firstArg.name;
                }
                if (firstArg?.type === 'ArrowFunctionExpression' || firstArg?.type === 'FunctionExpression') {
                    callbackName = firstArg.id?.name || '(arrow)';
                }
                // For addEventListener, the event type is the first arg, callback is second
                if (apiName === 'addEventListener' || apiName === 'removeEventListener') {
                    const eventArg = path.node.arguments[0];
                    const callbackArg = path.node.arguments[1];
                    const eventName = eventArg?.value || '?';
                    callbackName = callbackArg?.type === 'Identifier'
                        ? callbackArg.name
                        : '(inline handler)';
                    apiName = `${apiName}("${eventName}")`;
                }

                timingNodes.push({ api: apiName, callback: callbackName, line, enclosingFn });
            }
        },
    });

    return timingNodes;
}

// ═══════════════════════════════════════════════════
// INTEGRATION: Combines all 3 analyses into a single
// formatted string for injection into the LLM prompt
// ═══════════════════════════════════════════════════

export function runFullAnalysis(code) {
    const ast = parseCode(code);
    if (!ast) {
        return {
            raw: { mutations: {}, closures: {}, timingNodes: [] },
            formatted: '⚠️ AST parse failed — falling back to LLM-only analysis.',
        };
    }

    const mutations = extractMutationChains(ast);
    const closures = trackClosureCaptures(ast);
    const timing = findTimingNodes(ast);

    const formatted = formatAnalysis(mutations, closures, timing);

    return {
        raw: { mutations, closures, timingNodes: timing },
        formatted,
    };
}

// ═══════════════════════════════════════════════════
// FORMAT: Turns raw analysis into the prompt string
// ═══════════════════════════════════════════════════

function formatAnalysis(mutations, closures, timing) {
    const lines = [];
    lines.push('VERIFIED STATIC ANALYSIS — deterministic, not hallucinated');
    lines.push('══════════════════════════════════════════════════════════');
    lines.push('');

    // --- Functions that appear in mutations ---
    const allFunctions = new Set();
    for (const variable of Object.keys(mutations)) {
        for (const w of mutations[variable].writes) allFunctions.add(w.fn);
        for (const r of mutations[variable].reads) allFunctions.add(r.fn);
    }
    allFunctions.delete('(module scope)');
    if (allFunctions.size > 0) {
        lines.push(`Relevant Functions:`);
        lines.push(`  ${Array.from(allFunctions).join(', ')}`);
        lines.push('');
    }

    // --- Variable Mutation Chains ---
    // Filter to only show variables that are WRITTEN (mutated) inside functions
    const mutatedVars = Object.entries(mutations).filter(([, data]) =>
        data.writes.some(w => w.fn !== '(module scope)')
    );

    if (mutatedVars.length > 0) {
        lines.push('Variable Mutation Chains:');
        for (const [name, data] of mutatedVars) {
            lines.push(`  ${name}`);
            if (data.writes.length > 0) {
                const writeStr = data.writes
                    .map(w => `${w.fn} L${w.line}`)
                    .join(', ');
                lines.push(`    written: ${writeStr}`);
            }
            if (data.reads.length > 0) {
                // Deduplicate reads by function
                const readFns = [...new Set(data.reads.map(r => `${r.fn} L${r.line}`))];
                lines.push(`    read:    ${readFns.join(', ')}`);
            }
        }
        lines.push('');
    }

    // --- Timing / Async Nodes ---
    if (timing.length > 0) {
        lines.push('Async / Timing Nodes:');
        for (const t of timing) {
            lines.push(`  ${t.api}  → ${t.callback}  [L${t.line}]`);
        }
        lines.push('');
    }

    // --- Closure Captures ---
    const captureEntries = Object.entries(closures);
    if (captureEntries.length > 0) {
        lines.push('Closure Captures:');
        for (const [fnName, vars] of captureEntries) {
            lines.push(`  ${fnName}  captures → ${vars.join(', ')}`);
        }
        lines.push('');
    }

    // If nothing was found
    if (mutatedVars.length === 0 && timing.length === 0 && captureEntries.length === 0) {
        lines.push('No significant mutation chains, timing nodes, or closure captures detected.');
        lines.push('The LLM should analyze the code without AST hints.');
        lines.push('');
    }

    return lines.join('\n');
}
