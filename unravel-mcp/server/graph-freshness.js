export const GRAPH_SCHEMA_VERSION = 1;
export const GRAPH_ENGINE_VERSION = 'unravel-mcp-kg-v1';

export function stampGraphMeta(graph, extra = {}) {
    if (!graph || typeof graph !== 'object') return graph;
    graph.meta = {
        ...(graph.meta || {}),
        schemaVersion: GRAPH_SCHEMA_VERSION,
        engineVersion: GRAPH_ENGINE_VERSION,
        ...extra,
    };
    return graph;
}

export function inspectGraphFreshness(projectRoot, graph, { readFilesFromDirectory, getChangedFiles, computeContentHashSync, exclude = [] } = {}) {
    const result = {
        checked: false,
        stale: false,
        changedFiles: [],
        missingHashes: false,
        markedStaleEmbeddings: 0,
        reason: '',
    };

    if (!projectRoot || !graph?.nodes?.length || !readFilesFromDirectory || !getChangedFiles || !computeContentHashSync) {
        result.reason = 'freshness check skipped: missing project root, graph, or helpers';
        return result;
    }

    if (!graph.files || Object.keys(graph.files).length === 0) {
        result.checked = true;
        result.stale = true;
        result.missingHashes = true;
        result.reason = 'graph has no file hash table';
        return result;
    }

    const files = readFilesFromDirectory(projectRoot, 5, exclude);
    const changed = getChangedFiles(files, graph, computeContentHashSync);
    const changedSet = new Set(changed.map(f => f.name));

    result.checked = true;
    result.changedFiles = changed.map(f => f.name);
    result.stale = changed.length > 0;
    result.reason = changed.length > 0
        ? `${changed.length}/${files.length} indexed file(s) changed since KG build`
        : 'graph is fresh';

    if (changed.length > 0) {
        for (const node of graph.nodes || []) {
            const fp = node.filePath || node.name;
            if (fp && changedSet.has(fp) && node.embedding?.length) {
                node.embeddingStatus = 'stale_file_changed';
                result.markedStaleEmbeddings++;
            }
        }
    }

    return result;
}

