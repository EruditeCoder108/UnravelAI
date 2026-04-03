// ═══════════════════════════════════════════════════════════════
// graph-builder.js — Unravel Knowledge Graph Builder
// ESM (matches the rest of the core pipeline).
// ═══════════════════════════════════════════════════════════════

const EXTENSION_LANGUAGE = {
    '.ts': 'typescript', '.tsx': 'typescript',
    '.js': 'javascript', '.jsx': 'javascript',
    '.mjs': 'javascript', '.cjs': 'javascript',
    '.py': 'python', '.rb': 'ruby', '.go': 'go',
    '.rs': 'rust', '.java': 'java', '.kt': 'kotlin',
    '.swift': 'swift', '.c': 'c', '.cpp': 'cpp',
    '.h': 'c', '.hpp': 'cpp', '.cs': 'csharp',
    '.php': 'php', '.lua': 'lua',
    '.sh': 'shell', '.bash': 'shell', '.zsh': 'shell',
    '.json': 'json', '.yaml': 'yaml', '.yml': 'yaml',
    '.toml': 'toml', '.xml': 'xml', '.html': 'html',
    '.css': 'css', '.scss': 'scss', '.less': 'less',
    '.md': 'markdown', '.sql': 'sql',
};

export function detectLanguage(filePath) {
    const lastDot = filePath.lastIndexOf('.');
    if (lastDot === -1) return 'unknown';
    const ext = filePath.slice(lastDot).toLowerCase();
    return EXTENSION_LANGUAGE[ext] || 'unknown';
}

/**
 * GraphBuilder accumulates nodes and edges then produces a KnowledgeGraph.
 *
 * Usage:
 *   const builder = new GraphBuilder('my-app', 'abc123', existingFileHashes);
 *   builder.addFileWithAnalysis(filePath, structuralAnalysis, llmMeta);
 *   builder.addImportEdge(from, to);
 *   builder.addCallEdge(callerFile, callerFn, calleeFile, calleeFn);
 *   const graph = builder.build();
 */
export class GraphBuilder {
    constructor(projectName, gitHash = '', existingFileHashes = {}) {
        this._nodes = [];
        this._edges = [];
        this._languages = new Set();
        this._fileHashes = Object.assign({}, existingFileHashes);
        this._projectName = projectName;
        this._gitHash = gitHash;
    }

    setFileHash(filePath, contentHash) {
        this._fileHashes[filePath] = contentHash;
    }

    /**
     * Add a file node + its function/class children from AST structural analysis.
     * - Structural nodes → trustLevel: 'AST_VERIFIED'
     * - LLM metadata on the file node → trustLevel: 'LLM_INFERRED'
     */
    addFileWithAnalysis(filePath, structuralAnalysis, llmMeta) {
        const lang = detectLanguage(filePath);
        if (lang !== 'unknown') this._languages.add(lang);

        const fileName = filePath.replace(/\\/g, '/').split('/').pop() || filePath;
        const fileId = `file:${filePath}`;

        this._nodes.push({
            id: fileId,
            type: 'file',
            name: fileName,
            filePath,
            summary: (llmMeta && llmMeta.fileSummary) || '',
            tags: (llmMeta && llmMeta.tags) || [],
            complexity: (llmMeta && llmMeta.complexity) || 'moderate',
            languageNotes: (llmMeta && llmMeta.languageNotes) || undefined,
            trustLevel: 'LLM_INFERRED',
        });

        const fns = (structuralAnalysis && structuralAnalysis.functions) || [];
        for (const fn of fns) {
            const funcId = `func:${filePath}:${fn.name}`;
            this._nodes.push({
                id: funcId,
                type: 'function',
                name: fn.name,
                filePath,
                lineRange: fn.lineRange,
                summary: (llmMeta && llmMeta.functionSummaries && llmMeta.functionSummaries[fn.name]) || '',
                tags: [],
                complexity: (llmMeta && llmMeta.complexity) || 'moderate',
                trustLevel: 'AST_VERIFIED',
            });
            this._edges.push({
                source: fileId, target: funcId,
                type: 'contains', direction: 'forward', weight: 1,
                trustLevel: 'AST_VERIFIED',
            });
        }

        const classes = (structuralAnalysis && structuralAnalysis.classes) || [];
        for (const cls of classes) {
            const classId = `class:${filePath}:${cls.name}`;
            this._nodes.push({
                id: classId,
                type: 'class',
                name: cls.name,
                filePath,
                lineRange: cls.lineRange,
                summary: (llmMeta && llmMeta.classSummaries && llmMeta.classSummaries[cls.name]) || '',
                tags: [],
                complexity: (llmMeta && llmMeta.complexity) || 'moderate',
                trustLevel: 'AST_VERIFIED',
            });
            this._edges.push({
                source: fileId, target: classId,
                type: 'contains', direction: 'forward', weight: 1,
                trustLevel: 'AST_VERIFIED',
            });
        }
    }

    addFile(filePath, summary = '', tags = [], complexity = 'moderate') {
        const lang = detectLanguage(filePath);
        if (lang !== 'unknown') this._languages.add(lang);
        const fileName = filePath.replace(/\\/g, '/').split('/').pop() || filePath;
        this._nodes.push({
            id: `file:${filePath}`,
            type: 'file',
            name: fileName,
            filePath,
            summary,
            tags,
            complexity,
            trustLevel: 'LLM_INFERRED',
        });
    }

    addImportEdge(fromFile, toFile) {
        this._edges.push({
            source: `file:${fromFile}`, target: `file:${toFile}`,
            type: 'imports', direction: 'forward', weight: 0.7,
            trustLevel: 'AST_VERIFIED',
        });
    }

    addCallEdge(callerFile, callerFunc, calleeFile, calleeFunc) {
        this._edges.push({
            source: `func:${callerFile}:${callerFunc}`,
            target: `func:${calleeFile}:${calleeFunc}`,
            type: 'calls', direction: 'forward', weight: 0.8,
            trustLevel: 'AST_VERIFIED',
        });
    }

    build(projectDescription = '', frameworks = [], layers = [], tour = []) {
        return {
            version: '1.0.0',
            project: {
                name: this._projectName,
                languages: [...this._languages].sort(),
                frameworks,
                description: projectDescription,
                analyzedAt: new Date().toISOString(),
                gitCommitHash: this._gitHash,
            },
            files: this._fileHashes,
            nodes: this._nodes,
            edges: this._edges,
            layers,
            tour,
        };
    }
}

/**
 * Merge new nodes/edges into an existing graph after an incremental update.
 */
export function mergeGraphUpdate(existingGraph, changedFilePaths, newNodes, newEdges, newFileHashes, newCommitHash) {
    const changedSet = new Set(changedFilePaths);

    const removedNodeIds = new Set(
        existingGraph.nodes
            .filter(n => n.filePath !== undefined && changedSet.has(n.filePath))
            .map(n => n.id)
    );

    const retainedNodes = existingGraph.nodes.filter(n => !removedNodeIds.has(n.id));
    const retainedEdges = existingGraph.edges.filter(
        e => !removedNodeIds.has(e.source) && !removedNodeIds.has(e.target)
    );

    const mergedFiles = Object.assign({}, existingGraph.files || {}, newFileHashes);

    return {
        ...existingGraph,
        project: {
            ...existingGraph.project,
            gitCommitHash: newCommitHash || existingGraph.project.gitCommitHash,
            analyzedAt: new Date().toISOString(),
        },
        files: mergedFiles,
        nodes: [...retainedNodes, ...newNodes],
        edges: [...retainedEdges, ...newEdges],
    };
}
