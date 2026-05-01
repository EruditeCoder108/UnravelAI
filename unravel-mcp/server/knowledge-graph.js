export const INCREMENTAL_THRESHOLD = 0.3;

export function shouldPatchIncrementally(changedCount, totalCount, threshold = INCREMENTAL_THRESHOLD) {
    return totalCount > 0 && changedCount > 0 && changedCount < totalCount * threshold;
}

export function countCallEdges(graph) {
    return (graph?.edges || []).filter(e => e.type === 'calls' || e.type === 'call').length;
}

export async function patchKnowledgeGraph({
    existingGraph,
    allFiles,
    changedFiles,
    GraphBuilder,
    mergeGraphUpdate,
    attachStructuralAnalysisToChanged,
    extractJsDocSummary,
    computeContentHashSync,
    stampGraphMeta,
    embeddingProvider,
    embedChangedNodes,
    embedAll = false,
    apiKey = null,
    onProgress = () => {},
}) {
    if (!existingGraph?.nodes?.length) throw new Error('patchKnowledgeGraph: existing graph is missing nodes');
    if (!Array.isArray(allFiles) || !Array.isArray(changedFiles)) {
        throw new Error('patchKnowledgeGraph: allFiles and changedFiles must be arrays');
    }
    if (changedFiles.length === 0) {
        return { graph: existingGraph, changedCount: 0, callEdgesAdded: 0, patched: false };
    }

    await attachStructuralAnalysisToChanged(changedFiles, allFiles);

    const deltaBuilder = new GraphBuilder();
    const changedPathSet = new Set(changedFiles.map(f => f.name));
    const fnToFiles = buildFunctionIndex(existingGraph, changedFiles, changedPathSet);
    const newHashes = {};
    let callEdgesAdded = 0;
    let patchedCount = 0;

    for (const file of changedFiles) {
        patchedCount++;
        if (patchedCount % 25 === 0 || patchedCount === changedFiles.length) {
            onProgress(`Patching... ${patchedCount}/${changedFiles.length} files`);
        }

        const sa = file.structuralAnalysis || {};
        const tags = [file.name.replace(/\.[^.]+$/, '').replace(/[/\\]/g, '-')];
        const fnNames = (sa.functions || []).map(f => f.name).join(', ');
        const jsDoc = extractJsDocSummary(file.content || '');
        const summary = jsDoc || (fnNames ? `Functions: ${fnNames}` : '');
        deltaBuilder.addFileWithAnalysis(file.name, sa, { fileSummary: summary, tags });
        newHashes[file.name] = file.hash || computeContentHashSync(file.content || '');

        for (const imp of (sa.imports || [])) {
            if (imp.resolvedPath && imp.resolvedPath !== file.name) {
                deltaBuilder.addImportEdge(file.name, imp.resolvedPath);
            }
        }

        const importMap = buildImportMap(sa);
        for (const call of (sa.calls || [])) {
            const calleeFile = resolveCalleeFile(call, file.name, importMap, fnToFiles);
            if (!calleeFile) continue;
            deltaBuilder.addCallEdge(file.name, call.caller, calleeFile, call.callee);
            callEdgesAdded++;
        }
    }

    const deltaGraph = deltaBuilder.build();
    const merged = mergeGraphUpdate(
        existingGraph,
        changedFiles.map(f => f.name),
        deltaGraph.nodes,
        deltaGraph.edges,
        newHashes,
        ''
    );

    if (apiKey && embedChangedNodes) {
        await embedChangedNodes(merged, apiKey, { embedAll }).catch(e =>
            onProgress(`Incremental embed error: ${e.message}`)
        );
    }

    stampGraphMeta(merged, {
        builtAt: new Date().toISOString(),
        embeddingProvider,
        selfHealedAt: new Date().toISOString(),
        selfHealedFiles: changedFiles.length,
    });

    return {
        graph: merged,
        changedCount: changedFiles.length,
        callEdgesAdded,
        patched: true,
    };
}

function buildFunctionIndex(existingGraph, changedFiles, changedPathSet) {
    const fnToFiles = new Map();
    for (const node of (existingGraph.nodes || [])) {
        if (node.type !== 'function' || !node.name || !node.filePath) continue;
        if (changedPathSet.has(node.filePath)) continue;
        if (!fnToFiles.has(node.name)) fnToFiles.set(node.name, new Set());
        fnToFiles.get(node.name).add(node.filePath);
    }
    for (const file of changedFiles) {
        for (const fn of (file.structuralAnalysis?.functions || [])) {
            if (!fnToFiles.has(fn.name)) fnToFiles.set(fn.name, new Set());
            fnToFiles.get(fn.name).add(file.name);
        }
    }
    return fnToFiles;
}

function buildImportMap(structuralAnalysis) {
    const importMap = new Map();
    for (const imp of (structuralAnalysis.imports || [])) {
        if (!imp.resolvedPath) continue;
        const stem = imp.resolvedPath.split('/').pop().replace(/\.[^.]+$/, '');
        importMap.set(stem, imp.resolvedPath);
        const srcStem = imp.source.split('/').pop().replace(/\.[^.]+$/, '');
        if (!importMap.has(srcStem)) importMap.set(srcStem, imp.resolvedPath);
    }
    return importMap;
}

function resolveCalleeFile(call, currentFileName, importMap, fnToFiles) {
    const importResolved = importMap.get(call.callee);
    if (importResolved && importResolved !== currentFileName) return importResolved;

    const candidates = fnToFiles.get(call.callee);
    if (!candidates || candidates.size !== 1) return null;
    const [single] = candidates;
    return single !== currentFileName ? single : null;
}

