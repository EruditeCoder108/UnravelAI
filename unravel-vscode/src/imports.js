// ═══════════════════════════════════════════════════
// Import Resolution — Gather active file + its imports
// Handles ESM (import from) and CJS (require)
// maxDepth = 2 to avoid pulling in node_modules
// ═══════════════════════════════════════════════════

const fs = require('fs');
const path = require('path');

const EXTENSIONS = ['.js', '.jsx', '.ts', '.tsx', '/index.js', '/index.ts'];

/**
 * Resolve a relative import path to an absolute file path.
 * Returns null for node_modules / absolute imports.
 */
function resolveImportPath(importPath, fromFile) {
    // Skip node_modules and absolute imports
    if (!importPath.startsWith('.')) return null;

    const dir = path.dirname(fromFile);
    const base = path.resolve(dir, importPath);

    // Try exact path first, then with extensions
    if (fs.existsSync(base) && fs.statSync(base).isFile()) return base;
    for (const ext of EXTENSIONS) {
        const candidate = base + ext;
        if (fs.existsSync(candidate)) return candidate;
    }
    return null;
}

/**
 * Find all import/require paths in a file's source code.
 * Returns resolved absolute paths (relative imports only).
 */
function findImports(code, filePath) {
    const found = [];
    const seen = new Set();

    const patterns = [
        /import\s+(?:.*?\s+from\s+)?['"]([^'"]+)['"]/g,  // ESM
        /require\s*\(\s*['"]([^'"]+)['"]\s*\)/g,          // CJS
    ];

    for (const pattern of patterns) {
        let match;
        while ((match = pattern.exec(code)) !== null) {
            const importPath = match[1];
            const resolved = resolveImportPath(importPath, filePath);
            if (resolved && !seen.has(resolved)) {
                seen.add(resolved);
                found.push(resolved);
            }
        }
    }
    return found;
}

/**
 * Gather the active file and all its imports (up to maxDepth levels).
 * Returns an array of { name, content } objects ready for orchestrate().
 *
 * @param {string} activeFilePath - Absolute path to the active file
 * @param {number} maxDepth - How deep to follow imports (default: 2)
 * @returns {Array<{name: string, content: string}>}
 */
function gatherFiles(activeFilePath, maxDepth = 2) {
    const files = [];
    const visited = new Set();

    function walk(filePath, depth) {
        if (depth > maxDepth) return;
        if (visited.has(filePath)) return;
        if (!fs.existsSync(filePath)) return;
        visited.add(filePath);

        const content = fs.readFileSync(filePath, 'utf8');
        files.push({ name: filePath, content });

        const imports = findImports(content, filePath);
        for (const imp of imports) walk(imp, depth + 1);
    }

    walk(activeFilePath, 0);
    return files;
}

module.exports = { gatherFiles };
