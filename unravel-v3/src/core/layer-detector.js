// ═══════════════════════════════════════════════════════════════
// layer-detector.js — Heuristic + LLM Layer Detection
// ESM (matches the rest of the core pipeline).
// ═══════════════════════════════════════════════════════════════

const LAYER_PATTERNS = [
    { patterns: ['route', 'controller', 'handler', 'endpoint', 'api'], layerName: 'API Layer', description: 'HTTP endpoints, route handlers, and API controllers' },
    { patterns: ['service', 'usecase', 'use-case', 'business'], layerName: 'Service Layer', description: 'Business logic and application services' },
    { patterns: ['model', 'entity', 'schema', 'database', 'db', 'migration', 'repository', 'repo'], layerName: 'Data Layer', description: 'Data models, database access, and persistence' },
    { patterns: ['component', 'view', 'page', 'screen', 'layout', 'widget', 'ui'], layerName: 'UI Layer', description: 'User interface components and views' },
    { patterns: ['middleware', 'interceptor', 'guard', 'filter', 'pipe'], layerName: 'Middleware Layer', description: 'Request/response middleware and interceptors' },
    { patterns: ['util', 'helper', 'lib', 'common', 'shared'], layerName: 'Utility Layer', description: 'Shared utilities, helpers, and common libraries' },
    { patterns: ['test', 'spec'], layerName: 'Test Layer', description: 'Test files and test utilities' },
    { patterns: ['config', 'setting', 'env'], layerName: 'Configuration Layer', description: 'Application configuration and environment settings' },
    { patterns: ['core', 'engine', 'pipeline'], layerName: 'Core Layer', description: 'Core engine logic and pipeline orchestration' },
];

function toLayerId(name) {
    return `layer:${name.toLowerCase().replace(/\s+/g, '-')}`;
}

/**
 * Bug #6 fix: check BOTH directory segments AND the filename (without extension).
 * Previously, a flat file like `src/userController.js` would not match 'controller'
 * because we only matched exact directory segment names.
 *
 * Now: for each path segment AND for the filename stem, we check if the pattern
 * appears as a substring (case-insensitive). This handles:
 *   - Exact dir: routes/ → "route" ✓
 *   - Pluralised dir: controllers/ → "controller" ✓ (via substring)
 *   - Flat filename: userController.js → "controller" ✓ (stem contains pattern)
 */
function matchFileToLayer(filePath) {
    const normalizedPath = filePath.replace(/\\/g, '/').toLowerCase();
    const parts = normalizedPath.split('/');

    // Extract filename stem (no extension)
    const filename = parts[parts.length - 1] || '';
    const stem = filename.replace(/\.[^.]+$/, ''); // remove last extension

    // Check all directory segments + the stem
    const tokensToCheck = [...parts.slice(0, -1), stem];

    for (const { patterns, layerName } of LAYER_PATTERNS) {
        for (const token of tokensToCheck) {
            for (const pattern of patterns) {
                // substring match so "userController" matches "controller",
                // "controllers" matches "controller", etc.
                if (token === pattern || token.includes(pattern)) return layerName;
            }
        }
    }
    return null;
}

/**
 * Heuristic layer detection — zero LLM cost, runs in milliseconds.
 * Only FILE-type nodes are assigned to layers.
 */
export function detectLayers(graph) {
    const layerMap = new Map();

    for (const node of graph.nodes) {
        if (node.type !== 'file') continue;
        const layerName = (node.filePath && matchFileToLayer(node.filePath)) || 'Core';
        const existing = layerMap.get(layerName) || [];
        existing.push(node.id);
        layerMap.set(layerName, existing);
    }

    const layers = [];
    for (const [name, nodeIds] of layerMap) {
        const found = LAYER_PATTERNS.find(p => p.layerName === name);
        layers.push({
            id: toLayerId(name),
            name,
            description: (found && found.description) || 'Core application files',
            nodeIds,
        });
    }
    return layers;
}

/**
 * Build the LLM prompt for layer detection from the graph's file list.
 */
export function buildLayerDetectionPrompt(graph) {
    const filePaths = graph.nodes
        .filter(n => n.type === 'file' && n.filePath)
        .map(n => n.filePath);
    const fileListStr = filePaths.map(f => `  - ${f}`).join('\n');
    return `You are a software architecture analyst. Given the following list of file paths from a codebase, identify the logical architectural layers.\n\nFile paths:\n${fileListStr}\n\nReturn a JSON array of 3-7 layers. Each layer object must have:\n- "name": A short layer name (e.g., "API", "Data", "UI")\n- "description": What this layer is responsible for (1 sentence)\n- "filePatterns": An array of path prefixes that belong to this layer\n\nRespond ONLY with the JSON array, no additional text.`;
}

/**
 * Parse LLM response for layer detection.
 */
export function parseLayerDetectionResponse(response) {
    if (!response || !response.trim()) return null;
    try {
        const fenceMatch = response.match(/```(?:json)?\s*\n?([\s\S]*?)\n?\s*```/);
        const jsonStr = fenceMatch ? fenceMatch[1].trim() : response.trim();
        const arrayMatch = jsonStr.match(/\[[\s\S]*\]/);
        if (!arrayMatch) return null;
        const parsed = JSON.parse(arrayMatch[0]);
        if (!Array.isArray(parsed) || parsed.length === 0) return null;
        return parsed.filter(l => l && typeof l.name === 'string').map(l => ({
            name: l.name,
            description: typeof l.description === 'string' ? l.description : '',
            filePatterns: Array.isArray(l.filePatterns) ? l.filePatterns.filter(p => typeof p === 'string') : [],
        }));
    } catch { return null; }
}

/**
 * Apply LLM-defined layers to a graph (path-prefix matching).
 */
export function applyLLMLayers(graph, llmLayers) {
    const layerMap = new Map();
    for (const ll of llmLayers) layerMap.set(ll.name, []);

    for (const node of graph.nodes) {
        if (node.type !== 'file') continue;
        const normalizedPath = node.filePath ? node.filePath.replace(/\\/g, '/') : '';
        let assigned = false;
        for (const ll of llmLayers) {
            for (const pattern of ll.filePatterns) {
                if (normalizedPath.startsWith(pattern) || normalizedPath.includes('/' + pattern)) {
                    layerMap.get(ll.name).push(node.id);
                    assigned = true;
                    break;
                }
            }
            if (assigned) break;
        }
        if (!assigned) {
            const other = layerMap.get('Other') || [];
            other.push(node.id);
            layerMap.set('Other', other);
        }
    }

    const layers = [];
    for (const [name, nodeIds] of layerMap) {
        if (nodeIds.length === 0) continue;
        const ll = llmLayers.find(l => l.name === name);
        layers.push({
            id: toLayerId(name),
            name,
            description: (ll && ll.description) || 'Uncategorized files',
            nodeIds,
        });
    }
    return layers;
}
