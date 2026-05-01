import { existsSync, mkdirSync, readFileSync, writeFileSync } from 'fs';
import { join } from 'path';

export function extractJsDocSummary(content) {
    if (!content || typeof content !== 'string') return null;

    // Pattern A: /** ... */ block immediately before a top-level declaration
    // Handles @param/@returns lines by filtering them out, keeping the description text.
    const jsdocRe = /\/\*\*\s*([\s\S]*?)\s*\*\/\s*(?:export\s+)?(?:async\s+)?(?:function|class|const|let|var)\s+\w/g;
    let match;
    while ((match = jsdocRe.exec(content)) !== null) {
        const text = match[1]
            .split('\n')
            .map(l => l.replace(/^\s*\*\s?/, '').trim())   // strip leading " * "
            .filter(l => l && !l.startsWith('@'))           // drop @param, @returns etc
            .join(' ')
            .replace(/\s+/g, ' ')
            .trim();
        if (text.length > 10) return text.slice(0, 150);
    }

    // Pattern B: A single // comment line directly above a top-level fn/class/const
    const singleRe = /\/\/\s*(.{10,})\n\s*(?:export\s+)?(?:async\s+)?(?:function|class|const\s+\w+\s*=\s*(?:async\s+)?\()/g;
    while ((match = singleRe.exec(content)) !== null) {
        const text = match[1].trim();
        // Skip comment lines that look like section dividers (all dashes, equals, etc.)
        if (/^[-=*]+$/.test(text)) continue;
        if (text.length > 10) return text.slice(0, 150);
    }

    return null;
}

export function deriveNodeMetadata(filePath, sa, edgeCount = 0, content = '') {
    const fns    = (sa && sa.functions)  || [];
    const imps   = (sa && sa.imports)    || [];
    const lines  = (sa && sa.lineCount)  || 0;
    const fnNames   = fns.map(f => f.name);
    const asyncFns  = fns.filter(f => f.isAsync).length;
    const fp        = filePath.replace(/\\/g, '/');
    const fileName  = fp.split('/').pop() || fp;
    const stem      = fp.replace(/\.[^.]+$/, '').replace(/\//g, '-');
    const impSrcs   = imps.map(i => (i.source || '').toLowerCase());

    //  Semantic tags 
    const tags = [];
    if (fnNames.some(n => /\bmain\b/i.test(n)) || /\/index\.|\/cli\./.test(fp)) tags.push('entry-point');
    if (fnNames.some(n => /handler|route|middleware|listen|serve/i.test(n)))      tags.push('request-handler');
    if (fnNames.some(n => /embed|semantic|vector|cosine|similarity/i.test(n)))    tags.push('embeddings');
    if (fnNames.some(n => /graph|node|edge|builder|kg|knowledg/i.test(n)))        tags.push('knowledge-graph');
    if (fnNames.some(n => /\bast[A-Z_]|\bast$|\btreeSitter\b|analyzeFile|analyzeCode|analyz[eEiI]|detectPattern|detectBug|runMultiFile/i.test(n)) || /ast.engine|ast.bridge|ast.project/i.test(fp)) tags.push('ast-analysis');
    if (fnNames.some(n => /orchestrat|pipeline|phase|verif/i.test(n)))            tags.push('orchestration');
    if (fnNames.some(n => /search|query|match|rank|score/i.test(n)))              tags.push('search');
    if (fnNames.some(n => /save|load|persist|store|read|write|cache/i.test(n)))   tags.push('storage');
    if (fnNames.some(n => /codex|archive|memory|recall/i.test(n)))                tags.push('memory');
    if (fnNames.some(n => /format|render|display|output|report/i.test(n)))        tags.push('formatting');
    if (impSrcs.some(s => /express|fastify|koa|hono|http/.test(s)))               tags.push('http-server');
    if (impSrcs.some(s => /react|preact|vue|svelte/.test(s)))                     tags.push('ui-framework');
    if (edgeCount >= 10) tags.push('hub');
    else if (edgeCount >= 5) tags.push('connector');
    tags.push(stem); // always include stem as identifier

    //  Complexity score 
    let complexity = 'low';
    if      (fns.length > 20 || lines > 500 || asyncFns > 6) complexity = 'high';
    else if (fns.length > 8  || lines > 200 || asyncFns > 2) complexity = 'moderate';

    //  Role description (functional, not a function-name dump) 
    let role = '';
    if (tags.includes('entry-point') && edgeCount >= 5) {
        role = `Entry point / orchestration hub. ${fns.length} handler functions, ${imps.length} dependencies.`;
    } else if (tags.includes('embeddings') && tags.includes('search')) {
        const keyFns = fnNames.filter(n => /embed|search|score|archive/i.test(n)).slice(0, 4);
        role = `Semantic layer: embeddings + search. Key: ${keyFns.join(', ')}.`;
    } else if (tags.includes('orchestration')) {
        role = `Diagnostic pipeline. Runs the multi-phase analysis protocol. ${fns.length} functions.`;
    } else if (tags.includes('ast-analysis') && fns.length > 8) {
        role = `AST analysis engine. ${fns.length} detector/parser functions.`;
    } else if (tags.includes('knowledge-graph') && fns.length > 3) {
        role = `Knowledge graph construction and management. ${fns.length} functions.`;
    } else if (tags.includes('storage')) {
        role = `Storage layer. Reads/writes graph and metadata to disk.`;
    } else if (tags.includes('request-handler')) {
        role = `HTTP/MCP request handler. ${fns.length} handler functions.`;
    } else if (fns.length > 0) {
        const top = fnNames.slice(0, 5).join(', ');
        role = `${fns.length} functions: ${top}${fnNames.length > 5 ? '...' : ''}.`;
    } else {
        role = `${fileName} -> ${imps.length > 0 ? `imports: ${imps.map(i => i.source || '').slice(0,3).join(', ')}` : 'no functions detected'}.`;
    }

    // Enrich fileSummary with JSDoc/TSDoc if present in raw source (zero cost)
    const _jsDoc = extractJsDocSummary(content);
    const fileSummary = _jsDoc ? `${_jsDoc} - ${role}`.slice(0, 200) : role;
    return { fileSummary, tags, complexity };
}

//  Helper: Project Overview  the senior dev's mental model 
// Auto-generated from KG topology. Stored at .unravel/project-overview.md.
// Injected as @0 in every consult call, giving the LLM architecture context
// before it sees low-level AST facts.
export function generateProjectOverview(graph, projectRoot) {
    const nodes     = graph.nodes || [];
    const edges     = graph.edges || [];
    const fileNodes = nodes.filter(n => n.type === 'file' || !n.type);

    const edgeCountMap = new Map();
    for (const edge of edges) {
        if (edge.source) edgeCountMap.set(edge.source, (edgeCountMap.get(edge.source) || 0) + 1);
        if (edge.target) edgeCountMap.set(edge.target, (edgeCountMap.get(edge.target) || 0) + 1);
    }

    const topFiles = [...fileNodes]
        .sort((a, b) => (edgeCountMap.get(b.id || b.filePath || '') || 0) - (edgeCountMap.get(a.id || a.filePath || '') || 0))
        .slice(0, 12);

    const EXT_LANG = { '.js': 'JavaScript', '.ts': 'TypeScript', '.jsx': 'React/JSX', '.tsx': 'React/TSX', '.py': 'Python', '.go': 'Go', '.rs': 'Rust', '.java': 'Java' };
    const langSet = new Set();
    for (const n of fileNodes) {
        const fp = n.filePath || n.name || '';
        const ext = fp.slice(fp.lastIndexOf('.'));
        const lang = EXT_LANG[ext];
        if (lang) langSet.add(lang);
    }

    const builtAt = new Date().toISOString().slice(0, 10);
    const outLines = [
        `# Project Overview`,
        `*Auto-generated by Unravel on ${builtAt}. Edit the "## Notes" section -> it is never overwritten.*`,
        ``,
        `## Architecture`,
        `**Language(s):** ${[...langSet].join(', ') || 'Multiple'}`,
        `**Scale:** ${fileNodes.length} files indexed * ${edges.length} relationships mapped * ${nodes.length} total KG nodes`,
        ``,
        `## Key Files (by connectivity)`,
    ];

    for (const n of topFiles) {
        const nodeId = n.id || n.filePath || n.name || '';
        const ec     = edgeCountMap.get(nodeId) || 0;
        const fp     = n.filePath || n.id || '';
        const sem    = (n.tags || []).filter(t => fp && !fp.includes(t) && t !== 'hub' && t !== 'connector').slice(0, 3).join(', ');
        const sum    = n.summary || '';
        outLines.push(`- **${fp}** (${ec} connections)${sem ? '  [' + sem + ']' : ''}`);
        if (sum) outLines.push(`  ${sum}`);
    }

    outLines.push(``);
    outLines.push(`## Critical Paths (import graph)`);
    const importEdges = edges.filter(e => e.type === 'imports');
    let pathsWritten = 0;
    for (const hub of topFiles.slice(0, 5)) {
        const hubId = hub.id || hub.filePath || hub.name || '';
        const deps  = importEdges
            .filter(e => e.source === hubId || e.source === `file:${hubId}`)
            .map(e => { const t = e.target.replace('file:', ''); return fileNodes.find(n => (n.filePath || n.id || '') === t)?.name || t.split('/').pop() || t; })
            .slice(0, 6);
        if (deps.length > 0) {
            const hubName = hub.name || hubId.split('/').pop() || hubId;
            outLines.push(`- ${hubName} -> ${deps.join(', ')}`);
            pathsWritten++;
        }
        if (pathsWritten >= 4) break;
    }
    if (pathsWritten === 0) outLines.push('*(Call graph will populate as more files are analyzed)*');

    outLines.push(``);
    outLines.push(`## Risk Areas (from AST analysis)`);
    outLines.push(`*Populated by analyze -> verify(PASSED) sessions. Debug more to grow this section.*`);
    outLines.push(``);
    outLines.push(`## Notes`);
    outLines.push(`*Add your own architecture notes, project goals, invariants, and decisions here. Never overwritten.*`);
    outLines.push(``);
    return outLines.join('\n');
}

export function loadProjectOverview(projectRoot) {
    try {
        const p = join(projectRoot, '.unravel', 'project-overview.md');
        if (existsSync(p)) return readFileSync(p, 'utf8');
    } catch (e) { /* non-fatal */ }
    return null;
}

export function saveProjectOverview(projectRoot, newContent) {
    try {
        const p = join(projectRoot, '.unravel', 'project-overview.md');
        mkdirSync(join(projectRoot, '.unravel'), { recursive: true });
        // Preserve the user's "## Notes" section; never overwrite it.
        if (existsSync(p)) {
            const existing = readFileSync(p, 'utf8');
            const notesMatch = existing.match(/## Notes\n([\s\S]*)$/);
            if (notesMatch && notesMatch[1].trim()) {
                newContent = newContent.replace(/## Notes\n[\s\S]*$/, `## Notes\n${notesMatch[1]}`);
            }
        }
        writeFileSync(p, newContent, 'utf8');
    } catch (e) {
        process.stderr.write(`[unravel] Could not save project overview: ${e.message}\n`);
    }
}

// Enrich project overview Risk Areas after a verified diagnosis (verify PASSED).
export function enrichProjectOverviewWithDiagnosis(projectRoot, { rootCause, codeLocation, symptom }) {
    try {
        const p = join(projectRoot, '.unravel', 'project-overview.md');
        if (!existsSync(p)) return;
        const date  = new Date().toISOString().slice(0, 10);
        const entry = `- [${date}] **${codeLocation || 'unknown'}**: ${(rootCause || '').slice(0, 150)}${rootCause && rootCause.length > 150 ? '...' : ''}  <- from: "${(symptom || '').slice(0, 80)}"`;
        let content = readFileSync(p, 'utf8');
        content = content.replace(
            /(## Risk Areas \(from AST analysis\)\n)([\s\S]*?)(\n## Notes)/,
            function(_, header, body, notesHeader) {
                const cleaned = body.replace('*Populated by analyze -> verify(PASSED) sessions. Debug more to grow this section.*', '').trim();
                const newBody = cleaned ? cleaned + '\n' + entry : entry;
                return header + newBody + '\n' + notesHeader;
            }
        );
        writeFileSync(p, content, 'utf8');
    } catch (e) { /* non-fatal */ }
}
