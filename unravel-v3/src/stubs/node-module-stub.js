// ═══════════════════════════════════════════════════════════════
// node-module-stub.js — Browser stub for Node.js 'module' built-in
//
// Vite externalizes the 'module' built-in but its browser shim
// doesn't export `createRequire`, causing a binding error:
//   "createRequire" is not exported from 'module'
//
// This stub provides a `createRequire` that returns a function
// which throws when called. graph-storage.js and indexer.js both
// guard all Node.js usage with _isNodeAvailable(), which calls
// _require('fs') — that will throw and return false in browser
// context, gracefully skipping all Node.js-only paths.
//
// Usage in vite.config.js:
//   resolve: { alias: { 'module': '/src/stubs/node-module-stub.js' } }
// ═══════════════════════════════════════════════════════════════

/**
 * Browser-safe no-op createRequire.
 * Returns a function that throws — caught by _isNodeAvailable() guards.
 */
export function createRequire(_url) {
    return function browserRequire(id) {
        throw new Error(`[node-stub] Cannot require('${id}') in a browser context.`);
    };
}

// Provide other common exports from Node.js 'module' in case anything else uses them
export function builtinModules() { return []; }
export const Module = {};
export default { createRequire, builtinModules, Module };
