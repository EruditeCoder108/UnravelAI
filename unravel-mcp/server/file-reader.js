import { readFileSync, readdirSync } from 'fs';
import { join, extname, resolve } from 'path';

const CODE_EXTENSIONS = new Set([
    '.js', '.jsx', '.ts', '.tsx', '.mjs', '.cjs',
    '.py', '.java', '.go', '.rs', '.rb', '.cs', '.cpp', '.c', '.h',
    '.vue', '.svelte', '.html', '.css', '.json',
]);

export function readFilesFromDirectory(dirPath, maxDepth = 5, excludePaths = []) {
    const files = [];
    const seen = new Set();

    // Normalize exclude list: resolve absolute, or treat as substring match
    const normalizedExcludes = (excludePaths || []).map(p => {
        try {
            // Try resolving as path relative to dirPath
            const abs = resolve(dirPath, p).replace(/\\/g, '/');
            return abs;
        } catch {
            return p.replace(/\\/g, '/');
        }
    });

    // Test file exclusion: intentional invalid state in mocks/fixtures causes
    // false positive pattern matches (deliberate race conditions, stale closures, etc.)
    const TEST_PATTERNS = [
        /[/\\]__tests__[/\\]/i,
        /[/\\]spec[/\\]/i,
        /[/\\]test[/\\]/i,
        /[/\\]mocks?[/\\]/i,
        /[/\\]fixtures?[/\\]/i,
        /\.test\.[jt]sx?$/i,
        /\.spec\.[jt]sx?$/i,
        /\.test\.d\.ts$/i,
    ];

    function isTestFile(fullPath) {
        return TEST_PATTERNS.some(p => p.test(fullPath.replace(/\\/g, '/')));
    }

    function isExcluded(fullPath) {
        if (!normalizedExcludes.length) return false;
        const normalized = fullPath.replace(/\\/g, '/');
        return normalizedExcludes.some(ex => normalized.startsWith(ex) || normalized.includes(ex));
    }

    function walk(currentPath, depth) {
        if (depth > maxDepth) return;
        let entries;
        try { entries = readdirSync(currentPath, { withFileTypes: true }); }
        catch { return; }

        for (const entry of entries) {
            const fullPath = join(currentPath, entry.name);

            if (isExcluded(fullPath)) continue;  // user-specified exclude

            // Skip common non-source directories
            if (entry.isDirectory()) {
                if (['node_modules', '.git', 'dist', 'build', '.next', '__pycache__',
                     'coverage', '.unravel', '.vscode', '.idea'].includes(entry.name)) continue;
                walk(fullPath, depth + 1);
                continue;
            }

            if (!entry.isFile()) continue;
            const ext = extname(entry.name).toLowerCase();
            if (!CODE_EXTENSIONS.has(ext)) continue;
            if (isTestFile(fullPath)) continue; // exclude test/spec/mock files

            const relativePath = fullPath.replace(dirPath, '').replace(/\\/g, '/').replace(/^\//, '');
            if (seen.has(relativePath)) continue;
            seen.add(relativePath);

            try {
                const content = readFileSync(fullPath, 'utf-8');
                // Skip very large files (> 500KB) to avoid memory issues
                if (content.length > 500_000) continue;
                files.push({ name: relativePath, content });
            } catch { /* skip unreadable files */ }
        }
    }

    walk(dirPath, 0);
    return files;
}
