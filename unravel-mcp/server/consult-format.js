import { existsSync, mkdirSync, readFileSync, readdirSync, statSync, writeFileSync } from 'fs';
import { join } from 'path';
import childProcess from 'child_process';
import { loadProjectOverview } from './project-overview.js';

export const SETUP_REQUIRED_RESPONSE = {
    status: 'SETUP_REQUIRED',
    message: 'Consult needs a free Gemini API key to build your project\'s semantic knowledge graph. This is a one-time setup - takes about 2 minutes.',
    why: 'Consult uses the Gemini Embedding API (free tier) to convert your source files into 768-dimensional vectors. This enables semantic routing - finding the right files by meaning, not just keywords. It also powers cross-session memory: past debugging sessions are recalled automatically when relevant.',
    setup_steps: [
        '1. Go to https://aistudio.google.com/apikey',
        '2. Sign in with your Google account (free)',
        '3. Click "Create API Key" -> select or create a Cloud project -> copy the key',
        '4. Add it to the "env" block in your MCP server config (same file where you added Unravel):',
        '   {"env": {"GEMINI_API_KEY": "your-key-here"}}',
        '   Config file locations:',
        '     Claude Desktop (Mac): ~/Library/Application Support/Claude/claude_desktop_config.json',
        '     Claude Desktop (Win): %APPDATA%\\Claude\\claude_desktop_config.json',
        '     Cursor:               .cursor/mcp.json (project root)',
        '     VS Code:              .vscode/mcp.json',
        '     Claude Code:          ~/.claude.json or .mcp.json',
        '     Windsurf:             ~/.codeium/windsurf/mcp_config.json',
        '5. Restart the MCP server (most clients auto-restart on config save)',
        '6. Call consult again - it will auto-build your KG on the first call (~15-30s, one-time)',
    ],
    free_tier: 'Gemini Embedding free tier: 1,500 req/min - enough for most repos. See: https://ai.google.dev/pricing',
    after_setup: 'Just call consult again. First call auto-builds the KG (one-time). Every subsequent call is instant.',
};

// -- Helper: load human-written context files (README, CHANGELOG, docs, etc.) --
// These files contain intent, goals, and domain knowledge that AST cannot derive.
// Each file is tagged with a trust level so the LLM weighs it appropriately.
// Cost: zero (pure file reads). No LLM calls.
function loadContextFiles(projectRoot) {
    const PATTERNS = [
        'README.md', 'readme.md', 'README.txt',
        'ARCHITECTURE.md', 'DESIGN.md', 'OVERVIEW.md',
        'CHANGELOG.md', 'HISTORY.md', 'CHANGES.md',
        'CONTRIBUTING.md', 'DEVELOPMENT.md',
    ];
    const TRUST = (name) => {
        const n = name.toLowerCase();
        if (n.includes('changelog') || n.includes('history') || n.includes('changes')) return 'high';
        return 'medium';
    };

    let explicitPaths = [], explicitTrust = {}, maxCharsPerFile = 6000;
    try {
        const cfgPath = join(projectRoot, '.unravel', 'context.json');
        if (existsSync(cfgPath)) {
            const cfg = JSON.parse(readFileSync(cfgPath, 'utf8'));
            explicitPaths = (cfg.include || []).map(p => join(projectRoot, p));
            explicitTrust = cfg.trust || {};
            if (cfg.maxCharsPerFile) maxCharsPerFile = cfg.maxCharsPerFile;
        }
    } catch (_) { /* non-fatal */ }

    const results = [], seen = new Set();
    const tryLoad = (filePath, overrideTrust) => {
        const norm = filePath.replace(/\\/g, '/');
        if (seen.has(norm)) return;
        seen.add(norm);
        try {
            if (!existsSync(filePath)) return;
            if (statSync(filePath).size > maxCharsPerFile * 4) return;
            const content = readFileSync(filePath, 'utf8').slice(0, maxCharsPerFile);
            const name = filePath.split(/[/\\]/).pop() || filePath;
            results.push({ name, trust: overrideTrust || explicitTrust[name] || TRUST(name), content: content.trimEnd() });
        } catch (_) { /* non-fatal */ }
    };

    for (const p of explicitPaths) tryLoad(p, null);
    for (const p of PATTERNS)      tryLoad(join(projectRoot, p), null);

    // Auto-scan root and docs/ for how-*.md, arch*.md, design*.md
    for (const base of [projectRoot, join(projectRoot, 'docs'), join(projectRoot, '.unravel', 'context')]) {
        try {
            if (!existsSync(base)) continue;
            for (const f of readdirSync(base)) {
                const fl = f.toLowerCase();
                if ((fl.startsWith('how_') || fl.startsWith('how-') || fl.startsWith('arch') || fl.startsWith('design') || fl.startsWith('guide_') || fl.startsWith('guide-')) && fl.endsWith('.md'))
                    tryLoad(join(base, f), null);
            }
        } catch (_) { /* non-fatal */ }
    }

    return results; // [{ name, trust, content }]
}

// -- Helper: git context layer ------------------------------------------------
// Recent file activity, commit messages, hotspot files, unstaged changes.
// Cached per HEAD commit -- re-runs only when HEAD changes. Zero API calls.
// Returns null silently if git is not installed or projectRoot is not a repo.
function getGitContext(projectRoot) {
    const gitExec = (cmd) => {
        try {
            return childProcess.execSync(
                `git -C "${projectRoot}" ${cmd}`,
                { encoding: 'utf8', timeout: 5000, stdio: ['pipe', 'pipe', 'pipe'] }
            ).trim();
        } catch (_) { return null; }
    };

    const headHash = gitExec('rev-parse HEAD');
    if (!headHash) return null; // not a git repo or git not installed

    const cacheFile = join(projectRoot, '.unravel', 'git-context.json');
    try {
        if (existsSync(cacheFile)) {
            const cached = JSON.parse(readFileSync(cacheFile, 'utf8'));
            if (cached.headHash === headHash) return cached.data;
        }
    } catch (_) { /* cache miss - rebuild */ }

    const recentFilesRaw = gitExec('log --since="14 days ago" --name-only --pretty=format:""') || '';
    const churnRaw       = gitExec('log --since="30 days ago" --name-only --pretty=format:""') || '';
    const recentCommits  = gitExec('log --oneline -8') || '';
    const unstagedFiles  = gitExec('diff --name-only') || '';
    const stagedFiles    = gitExec('diff --cached --name-only') || '';

    const churnMap = {};
    for (const l of churnRaw.split('\n').filter(Boolean)) churnMap[l.trim()] = (churnMap[l.trim()] || 0) + 1;
    const hotFiles    = Object.entries(churnMap).sort((a, b) => b[1] - a[1]).slice(0, 8).map(([f, c]) => `${f} (${c} commits)`);
    const recentFiles = [...new Set(recentFilesRaw.split('\n').filter(Boolean))].slice(0, 10);

    const data = {
        recentFiles,
        hotFiles,
        recentCommits: recentCommits.split('\n').filter(Boolean).slice(0, 8),
        unstagedFiles: unstagedFiles.split('\n').filter(Boolean),
        stagedFiles:   stagedFiles.split('\n').filter(Boolean),
    };

    try {
        mkdirSync(join(projectRoot, '.unravel'), { recursive: true });
        writeFileSync(cacheFile, JSON.stringify({ headHash, data }, null, 2), 'utf8');
    } catch (_) { /* non-fatal */ }

    return data;
}

// -- Helper: dependency manifest ---------------------------------------------
// Reads package.json / requirements.txt / go.mod. Zero cost. Zero API calls.
function loadDependencyManifest(projectRoot) {
    try {
        const pkgPath = join(projectRoot, 'package.json');
        if (existsSync(pkgPath)) {
            const pkg = JSON.parse(readFileSync(pkgPath, 'utf8'));
            return {
                runtime: Object.keys(pkg.dependencies || {}).slice(0, 20),
                dev:     Object.keys(pkg.devDependencies || {}).slice(0, 10),
                engines: pkg.engines ? JSON.stringify(pkg.engines) : null,
                packageManager: pkg.packageManager || null,
            };
        }
    } catch (_) { /* try next */ }
    try {
        const reqPath = join(projectRoot, 'requirements.txt');
        if (existsSync(reqPath)) {
            return { runtime: readFileSync(reqPath, 'utf8').split('\n').filter(l => l.trim() && !l.startsWith('#')).map(l => l.trim().split(/[>=<!=]/)[0]).slice(0, 20), dev: [], engines: null, packageManager: null };
        }
    } catch (_) { /* try next */ }
    try {
        const goPath = join(projectRoot, 'go.mod');
        if (existsSync(goPath)) {
            return { runtime: readFileSync(goPath, 'utf8').split('\n').filter(l => l.match(/^\t\S/)).map(l => l.trim().split(/\s+/)[0]).slice(0, 20), dev: [], engines: null, packageManager: null };
        }
    } catch (_) { /* non-fatal */ }
    return null;
}

// -- Helper: inline readiness score for @0 -----------------------------------
// Replaces the buried JSON blob at the bottom with a human-readable summary
// the LLM sees upfront before reading any evidence.
function formatReadinessInline({ graph, codexMatches, archiveHits, filesAnalyzed }) {
    const embeddedCount = (graph?.nodes || []).filter(n => n.embedding?.length > 0).length;
    const totalNodes    = (graph?.nodes || []).length;
    const kg  = totalNodes > 0, emb = embeddedCount > 0, ast = filesAnalyzed > 0;
    const cod = codexMatches > 0, arc = archiveHits > 0;
    const core = [kg, emb, ast].filter(Boolean).length;
    const mem  = [cod, arc].filter(Boolean).length;
    const score = mem > 0 ? `${core}/3 core + ${mem}/2 memory` : `${core}/3 core`;
    const rows = [
        `  KG: ${kg  ? 'OK' : 'NO'} ${totalNodes} nodes * ${graph?.edges?.length || 0} edges${emb ? ` * ${embeddedCount} embedded` : ' (no embeddings - GEMINI_API_KEY needed)'}`,
        `  AST: ${ast ? 'OK' : 'NO'} ${filesAnalyzed} file(s) fully analyzed`,
        `  Codex: ${cod ? 'OK' : 'NO'} ${codexMatches} past debug session(s) matched`,
        `  Archive: ${arc ? 'OK' : 'NO'} ${archiveHits} past verified fix(es) found`,
    ];
    const tip = core < 3 ? 'Set GEMINI_API_KEY to enable semantic routing.'
              : mem === 0 ? 'Run analyze -> verify on a real bug to activate memory layers.'
              : 'All layers active - maximum oracle intelligence.';
    return { score, rows, tip };
}

// -- Helper: out-of-scope file list enriched with KG metadata ----------------
// Shows semantic tags + role for files that are NOT in AST scope but ARE in the KG.
// Lets the LLM reason about files it can't inspect and surface include:[X] hints.
function buildOutOfScopeWithMeta(outOfScopePaths, graph) {
    if (!graph?.nodes?.length) return outOfScopePaths.map(p => ({ path: p, tags: [], summary: '' }));
    const nodeMap = new Map();
    for (const n of graph.nodes) {
        if (n.filePath) nodeMap.set(n.filePath.replace(/\\/g, '/'), n);
        if (n.id)       nodeMap.set(String(n.id).replace(/\\/g, '/'), n);
    }
    return outOfScopePaths.map(p => {
        const norm = p.replace(/\\/g, '/');
        const node = nodeMap.get(norm) || null;
        const tags = (node?.tags || []).filter(t => !norm.includes(t) && t.length > 2 && !t.includes('/'));
        const summary = (node?.fileSummary || node?.summary || '').slice(0, 80);
        return { path: p, tags: tags.slice(0, 4), summary };
    });
}

function buildReadiness({ graph, codexMatches, archiveHits, patternMatches, filesAnalyzed }) {
    const embeddedCount = (graph?.nodes || []).filter(n => n.embedding?.length > 0).length;
    const totalNodes    = (graph?.nodes || []).length;
    const layers = {
        knowledge_graph:      { active: totalNodes > 0, detail: totalNodes > 0 ? `${totalNodes} nodes, ${graph?.edges?.length || 0} edges` : 'Not built. Auto-builds on next call if GEMINI_API_KEY is set.' },
        semantic_embeddings:  { active: embeddedCount > 0, detail: embeddedCount > 0 ? `${embeddedCount}/${totalNodes} nodes embedded - semantic routing active` : 'No embeddings. Set GEMINI_API_KEY and rebuild KG.' },
        ast_analysis:         { active: filesAnalyzed > 0, detail: filesAnalyzed > 0 ? `${filesAnalyzed} file(s) analyzed - native tree-sitter` : 'No files analyzed.' },
        codex:                { active: codexMatches > 0, detail: codexMatches > 0 ? `${codexMatches} past session(s) matched` : 'No codex entries matched. analyze -> verify sessions populate this automatically.' },
        diagnosis_archive:    { active: archiveHits > 0, detail: archiveHits > 0 ? `${archiveHits} past fix(es) found in this area` : 'No archive matches. Each verify(PASSED) adds an entry automatically.' },
    };
    // Score: core layers (KG, embeddings, AST) are the foundation.
    // Memory layers (codex, archive) are growth bonuses; they only populate
    // after multiple debug sessions, so a fresh project shouldn't look broken.
    const coreActive = [layers.knowledge_graph, layers.semantic_embeddings, layers.ast_analysis].filter(l => l.active).length;
    const memoryActive = [layers.codex, layers.diagnosis_archive].filter(l => l.active).length;
    const scoreLabel = memoryActive > 0
        ? `${coreActive}/3 core + ${memoryActive}/2 memory`
        : `${coreActive}/3 core`;
    const tips = [];
    if (coreActive === 3 && memoryActive === 0) tips.push('Core analysis fully active. Debug with analyze -> verify to grow codex and archive for even richer answers.');
    else if (coreActive < 3) tips.push('Some core layers are inactive. Ensure GEMINI_API_KEY is set and files are in scope.');
    else if (!layers.codex.active) tips.push('Run analyze -> verify to grow project memory.');
    else if (!layers.diagnosis_archive.active) tips.push('Each verify(PASSED) call adds an archive entry. Debug more to grow it.');
    return {
        score: scoreLabel,
        layers,
        tip: tips.length > 0 ? tips[0] : 'All layers active - maximum project intelligence.',
    };
}

// -- Scholar-Mode Section Extraction -----------------------------------------
// Instead of dumping full context docs into the output, extract only the
// sections whose headings are relevant to the query. Returns: heading index
// (for navigation) + top matching sections (for content). Full document
// accessible via view_file for anything not included.
const _CONSULT_STOP_WORDS = new Set([
    'the','a','an','is','are','was','were','be','been','being','have','has','had',
    'do','does','did','will','would','could','should','may','might','can','shall',
    'to','of','in','for','on','with','at','by','from','as','into','through',
    'during','before','after','and','but','or','nor','not','so','yet','both',
    'either','neither','each','every','all','any','few','more','most','other',
    'some','such','no','only','own','same','than','too','very','just','how',
    'what','where','when','why','which','who','whom','this','that','these',
    'those','about','work','use','using','get','set','make','like',
]);

function extractRelevantSections(content, query, maxTotalChars = 2500) {
    const queryWords = (query || '').toLowerCase().split(/\W+/).filter(w => w.length > 2 && !_CONSULT_STOP_WORDS.has(w));
    if (queryWords.length === 0 || !content) {
        const truncated = (content || '').slice(0, maxTotalChars);
        return truncated + (content && content.length > maxTotalChars ? '\n[... truncated - use view_file for full content]' : '');
    }
    // Split by markdown headings
    const sections = [];
    const headingRegex = /^(#{1,4})\s+(.+)$/gm;
    const allHeadings = [];
    let match;
    while ((match = headingRegex.exec(content)) !== null) {
        if (sections.length > 0) {
            sections[sections.length - 1].body = content.slice(sections[sections.length - 1].bodyStart, match.index).trim();
        }
        sections.push({ heading: match[2].trim(), level: match[1].length, bodyStart: match.index + match[0].length, score: 0 });
        allHeadings.push(match[2].trim());
    }
    if (sections.length > 0) {
        sections[sections.length - 1].body = content.slice(sections[sections.length - 1].bodyStart).trim();
    }
    if (sections.length === 0) {
        const truncated = content.slice(0, maxTotalChars);
        return truncated + (content.length > maxTotalChars ? '\n[... truncated]' : '');
    }
    // Score each section by query keyword overlap
    for (const sec of sections) {
        const text = (sec.heading + ' ' + (sec.body || '')).toLowerCase();
        sec.score = queryWords.reduce((sum, w) => sum + (text.includes(w) ? 1 : 0), 0);
    }
    const ranked = [...sections].sort((a, b) => b.score - a.score);
    const output = [];
    let totalChars = 0;
    // Always include heading index for navigation
    const headingIdx = 'Document sections: ' + allHeadings.join(' | ');
    output.push(headingIdx);
    totalChars += headingIdx.length;
    // Include top-scoring sections
    for (const sec of ranked) {
        if (sec.score === 0) continue;
        const body = (sec.body || '').slice(0, 800);
        const block = `${'#'.repeat(sec.level)} ${sec.heading}\n${body}${(sec.body || '').length > 800 ? '\n[... section truncated]' : ''}`;
        if (totalChars + block.length > maxTotalChars && output.length > 1) break;
        output.push(block);
        totalChars += block.length;
    }
    if (output.length <= 1) {
        output.push(content.slice(0, 500) + (content.length > 500 ? '\n[... use view_file for full content]' : ''));
    }
    output.push(`[Full document: ${content.length} chars - use view_file for deeper context]`);
    return output.join('\n\n');
}

export function formatConsultForAgent({ query, consultResult, codexResult, archiveHits, patternMatches, rankedFiles, graph, allFilePaths, analysisScope, fileContents, projectRoot }) {
    const evidence  = consultResult.evidence || {};
    const cf        = evidence.contextFormatted || '';
    const crossFile = evidence.crossFileRaw;
    const queryWords = (query || '').toLowerCase().split(/\W+/).filter(w => w.length > 2 && !_CONSULT_STOP_WORDS.has(w));

    // -----------------------------------------------------------------------------
    // KEY 1: intelligence_brief - Agent reads this FIRST.
    //   Reasoning mandate + project overview + intelligence score + scope.
    //   Usually sufficient for factual queries.
    // -----------------------------------------------------------------------------
    const briefLines = [];
    briefLines.push('=== UNRAVEL CONSULT - Project Intelligence Report ===');
    briefLines.push('');
    briefLines.push('READING ORDER (structured keys - read selectively, not linearly):');
    briefLines.push('  1. intelligence_brief    - START HERE. Mandate + overview + scope');
    briefLines.push('  2. structural_evidence   - AST facts + source snippets + call graph');
    briefLines.push('  3. memory                - Past discoveries + pattern signals');
    briefLines.push('  4. project_context       - Deps, git, doc excerpts (verbose - read only if needed)');
    briefLines.push('');

    // -- Section 5 REASONING MANDATE (first - instructions before data) ---------
    const qLower = (query || '').toLowerCase();
    const isFeasibility = /\bcan i\b|\bcould i\b|\bwhat would break\b|\bif i\b|\bwould it\b|\bshould i\b|\bsafe to\b|\brefactor\b/.test(qLower);
    const isFactual     = /\bwhere (is|are|does)\b|\bwhat is\b|\bwhat does\b|\bshow me\b|\bfind\b|\bwhich file\b|\bdefined\b/.test(qLower);
    const queryType     = isFeasibility ? 'feasibility' : isFactual ? 'factual' : 'analytical';

    const _TIERED = {
        factual: [
            'FACTUAL QUERY - answer directly. Cite exact file:line from structural_evidence. Be brief.',
            'If the answer is not in the evidence, say so. Do not guess.',
        ],
        analytical: [
            'ANALYTICAL QUERY - think step by step through the evidence.',
            'Trace the full chain through the cross-file graph in structural_evidence.',
            'Identify what the evidence DOES and DOES NOT cover. State assumptions explicitly.',
            'If the query touches files NOT in scope, say so and suggest include:[X].',
            'Do NOT speculate beyond what AST evidence and call graph confirm.',
        ],
        feasibility: [
            'FEASIBILITY QUERY - assess from structural evidence, not opinion.',
            'Map every file that would need to change (use call graph + scope list).',
            'Identify invariants from AST facts that must not break.',
            'Report: CAN DO / CANNOT DO / CAN DO WITH CAVEATS + specific file:line constraints.',
            'If evidence is insufficient, state which files are missing from scope.',
        ],
    };

    briefLines.push('Query classified as: ' + queryType.toUpperCase());
    for (const _r of _TIERED[queryType]) briefLines.push('  - ' + _r);
    briefLines.push('');

    const inst = consultResult._instructions || {};
    if (inst.role) briefLines.push('ROLE: ' + inst.role);
    if (inst.honesty_rules?.length) {
        briefLines.push('HONESTY RULES:');
        for (const _hr of inst.honesty_rules) briefLines.push('  - ' + _hr);
    }
    if (inst.scope?.not_a_debug_session) briefLines.push('SCOPE: ' + inst.scope.not_a_debug_session);
    briefLines.push('CODE_FETCH: structural_evidence has inline source for critical AST sites. For other lines, use view_file.');
    briefLines.push('');

    // -- Section 0 PROJECT OVERVIEW ---------------------------------------------
    briefLines.push('-- PROJECT OVERVIEW (senior dev mental model) --------------------------');
    const overview = projectRoot ? loadProjectOverview(projectRoot) : null;
    if (overview) {
        briefLines.push(overview.trimEnd());
    } else {
        briefLines.push('No project overview yet. Run build_map to auto-generate one.');
    }
    briefLines.push('');

    // -- Intelligence Score -----------------------------------------------
    const _rInline = formatReadinessInline({ graph, codexMatches: codexResult?.matches?.length || 0, archiveHits: archiveHits.length, filesAnalyzed: evidence.fileCount || 0 });
    briefLines.push(`Intelligence Score: ${_rInline.score}`);
    for (const _row of _rInline.rows) briefLines.push(_row);
    briefLines.push(`Tip: ${_rInline.tip}`);
    briefLines.push('');

    // -- Section 1 STRUCTURAL SCOPE ---------------------------------------------
    briefLines.push('-- STRUCTURAL SCOPE -------------------------------------------------------');
    const totalNodes = (graph?.nodes || []).length;
    const totalEdges = (graph?.edges || []).length;
    const embeddedCount = (graph?.nodes || []).filter(n => n.embedding?.length > 0).length;
    briefLines.push(`KG: ${totalNodes} nodes * ${totalEdges} edges * ${embeddedCount} embedded * ${allFilePaths?.length || 0} files indexed`);
    briefLines.push('');

    const inScopeSet = new Set((analysisScope || rankedFiles || []).map(p => p.replace(/\\/g, '/')));
    briefLines.push(`Files in AST analysis scope (${inScopeSet.size}):`);
    for (const p of [...inScopeSet].slice(0, 20)) briefLines.push(`  OK ${p}`);
    if (inScopeSet.size > 20) briefLines.push(`  ... ${inScopeSet.size - 20} more`);
    briefLines.push('');

    const outOfScope = (allFilePaths || []).filter(p => !inScopeSet.has(p.replace(/\\/g, '/'))).slice(0, 15);
    if (outOfScope.length > 0) {
        briefLines.push('Files in KG but NOT analyzed (use include:[...] for full analysis):');
        const _outMeta = buildOutOfScopeWithMeta(outOfScope, graph);
        for (const _m of _outMeta) {
            const _tagStr = _m.tags.length ? ` [${_m.tags.join(', ')}]` : '';
            const _sumStr = _m.summary     ? ` "${_m.summary}"` : '';
            briefLines.push(`  NO ${_m.path}${_tagStr}${_sumStr}`);
        }
        const remaining = (allFilePaths?.length || 0) - inScopeSet.size - outOfScope.length;
        if (remaining > 0) briefLines.push(`  ... and ${remaining} more files in KG`);
    }
    briefLines.push('');

    // -----------------------------------------------------------------------------
    // KEY 2: structural_evidence - AST facts + snippets + call graph.
    //   The deterministic core. Read for analytical/feasibility queries.
    // -----------------------------------------------------------------------------
    const evidenceLines = [];

    // -- Section 2 AST FACTS ----------------------------------------------------
    evidenceLines.push('-- AST FACTS (verified structural analysis) -------------------------');
    evidenceLines.push(cf ? cf.trimEnd() : 'No AST analysis available.');
    evidenceLines.push('');

    // -- Section 2.5 CRITICAL SOURCE SNIPPETS -----------------------------------
    const astRaw = consultResult?.evidence?.astRaw;
    if (astRaw && fileContents && fileContents.size > 0) {
        const snippets = [];
        const CONTEXT_LINES = 3;
        const MAX_SNIPPETS = 8;

        const extractSnippet = (fileName, targetLine, label) => {
            if (!fileName || !targetLine || snippets.length >= MAX_SNIPPETS) return;
            let content = fileContents.get(fileName);
            if (!content) {
                const baseName = fileName.split(/[\\/]/).pop();
                for (const [k, v] of fileContents) {
                    if (k.endsWith(baseName) || k.endsWith('/' + baseName)) { content = v; fileName = k; break; }
                }
            }
            if (!content) return;
            const srcLines = content.split('\n');
            const start = Math.max(1, targetLine - CONTEXT_LINES);
            const end = Math.min(srcLines.length, targetLine + CONTEXT_LINES);
            const overlaps = snippets.some(s => s.file === fileName && Math.abs(s.targetLine - targetLine) <= CONTEXT_LINES * 2);
            if (overlaps) return;
            const sl = [];
            for (let i = start; i <= end; i++) {
                const marker = i === targetLine ? '>' : ' ';
                sl.push(`  ${marker} ${i}: ${srcLines[i - 1]}`);
            }
            snippets.push({ file: fileName, targetLine, label, text: sl.join('\n') });
        };

        for (const r of (astRaw.globalWriteRaces || []).slice(0, 3)) {
            extractSnippet(r.file || '', r.writeLine, `${r.variable} written before await (race risk)`);
        }
        for (const p of (astRaw.floatingPromises || []).slice(0, 2)) {
            extractSnippet(p.file || '', p.line, `${p.api}() unawaited`);
        }
        const cfrSnippet = consultResult?.evidence?.crossFileRaw;
        if (cfrSnippet?.callGraph) {
            const seenCallees = new Set();
            for (const edge of cfrSnippet.callGraph) {
                if (seenCallees.has(edge.callee) || snippets.length >= MAX_SNIPPETS) break;
                seenCallees.add(edge.callee);
                extractSnippet(edge.caller, edge.line, `call to ${edge.callee}:${edge.function}()`);
            }
        }

        if (snippets.length > 0) {
            evidenceLines.push('-- CRITICAL SOURCE SNIPPETS (auto-extracted, no view_file needed) ----');
            for (const s of snippets) {
                evidenceLines.push(`  ${s.file}:${s.targetLine} -- ${s.label}`);
                evidenceLines.push(s.text);
                evidenceLines.push('');
            }
        }
    }

    // -- Section 3 CROSS-FILE GRAPH (query-sorted) ------------------------------
    evidenceLines.push('-- CROSS-FILE GRAPH (call graph, symbol origins) --------------------');
    if (crossFile) {
        const calls = crossFile.callGraph || [];
        if (calls.length > 0) {
            // Sort by query relevance: edges mentioning query keywords first
            const sortedCalls = [...calls].sort((a, b) => {
                const aText = `${a.caller} ${a.callee} ${a.function}`.toLowerCase();
                const bText = `${b.caller} ${b.callee} ${b.function}`.toLowerCase();
                const aScore = queryWords.reduce((s, w) => s + (aText.includes(w) ? 1 : 0), 0);
                const bScore = queryWords.reduce((s, w) => s + (bText.includes(w) ? 1 : 0), 0);
                return bScore - aScore;
            });
            evidenceLines.push('Call graph (sorted by query relevance):');
            for (const edge of sortedCalls.slice(0, 25)) {
                const fn = edge.function ? `:${edge.function}()` : '';
                const ln = edge.line ? ` L${edge.line}` : '';
                evidenceLines.push(`  ${edge.caller} -> ${edge.callee}${fn}${ln}`);
            }
            if (calls.length > 25) evidenceLines.push(`  ... ${calls.length - 25} more edges`);
        }
        const symKeys = Object.keys(crossFile.symbolOrigins || {});
        if (symKeys.length > 0) {
            evidenceLines.push('Symbol origins:');
            for (const k of symKeys.slice(0, 15)) {
                const info = crossFile.symbolOrigins[k];
                if (info && typeof info === 'object') {
                    const importedBy = (info.importedBy || []).map(i => i.file || i).join(', ');
                    const loc = info.file ? `${info.file}${info.line ? ':L' + info.line : ''}` : '?';
                    evidenceLines.push(`  ${info.name || k}@${loc} -> imported by: ${importedBy || 'none'}`);
                } else {
                    evidenceLines.push(`  ${k} -> ${info}`);
                }
            }
        }
    } else {
        evidenceLines.push('No cross-file graph available (requires 2+ JS/TS files).');
    }
    evidenceLines.push('');

    // -----------------------------------------------------------------------------
    // KEY 3: memory - Past discoveries, verified fixes, pattern signals.
    // -----------------------------------------------------------------------------
    const memoryLines = [];
    if (patternMatches.length > 0) {
        memoryLines.push('STRUCTURAL PATTERN SIGNALS:');
        for (const m of patternMatches.slice(0, 3)) {
            memoryLines.push(`  [${m.pattern?.id || m.pattern?.bugType}] ${(m.confidence * 100).toFixed(0)}% - ${m.pattern?.description}`);
        }
        memoryLines.push('');
    }
    if (codexResult?.matches?.length > 0) {
        memoryLines.push('CODEX PRE-BRIEFING - Past debugging discoveries:');
        for (const m of codexResult.matches) {
            memoryLines.push(`  [${m.taskId}] "${m.problem}"`);
            if (m.discoveries) {
                for (const dl of m.discoveries.slice(0, 300).trim().split('\n').slice(0, 6)) memoryLines.push(`    ${dl}`);
            }
            memoryLines.push('');
        }
    }
    if (archiveHits.length > 0) {
        memoryLines.push('DIAGNOSIS ARCHIVE - Past verified fixes:');
        for (const h of archiveHits) {
            memoryLines.push(`  ${(h.score * 100).toFixed(0)}% match - ${h.rootCause?.slice(0, 120)}`);
            memoryLines.push(`    @ ${h.codeLocation} | "${h.symptom?.slice(0, 80)}"`);
        }
        memoryLines.push('');
    }
    if (!patternMatches.length && !codexResult?.matches?.length && !archiveHits.length) {
        memoryLines.push('No memory layer matches yet. Run analyze -> verify sessions to grow the archive and codex.');
    }

    // -----------------------------------------------------------------------------
    // KEY 4: project_context - Dependencies, git activity, doc excerpts.
    //   Verbose context. Read ONLY when intelligence_brief is insufficient.
    // -----------------------------------------------------------------------------
    const contextLines = [];

    // -- Dependencies ----------------------------------------------------
    if (projectRoot) {
        const _deps = loadDependencyManifest(projectRoot);
        if (_deps && (_deps.runtime.length > 0 || _deps.dev.length > 0)) {
            contextLines.push('## Dependencies');
            if (_deps.engines)        contextLines.push(`Engine: ${_deps.engines}`);
            if (_deps.runtime.length) contextLines.push(`Runtime: ${_deps.runtime.join(', ')}`);
            if (_deps.dev.length)     contextLines.push(`Dev tools: ${_deps.dev.join(', ')}`);
            if (_deps.packageManager) contextLines.push(`Package manager: ${_deps.packageManager}`);
            contextLines.push('');
        }
    }

    // -- Git Context (scope-filtered) ------------------------------------
    if (projectRoot) {
        const _git = getGitContext(projectRoot);
        if (_git) {
            contextLines.push('## Recent Activity (git)');
            const _filterGitFiles = (files) => {
                if (!files || files.length === 0) return [];
                return files.filter(f => {
                    const fNorm = f.replace(/\\/g, '/');
                    if (inScopeSet.has(fNorm)) return true;
                    const fLower = fNorm.toLowerCase();
                    return queryWords.some(w => fLower.includes(w));
                });
            };
            const relevantUnstaged = _filterGitFiles(_git.unstagedFiles);
            const relevantStaged   = _filterGitFiles(_git.stagedFiles);
            const relevantRecent   = _filterGitFiles(_git.recentFiles);
            if (relevantUnstaged.length) contextLines.push(`Unstaged (in scope): ${relevantUnstaged.join(', ')}`);
            if (relevantStaged.length)   contextLines.push(`Staged (in scope): ${relevantStaged.join(', ')}`);
            if (relevantRecent.length)   contextLines.push(`Modified last 14 days (in scope): ${relevantRecent.join(', ')}`);
            if (_git.hotFiles.length)    contextLines.push(`Hotspots (30d churn): ${_git.hotFiles.slice(0, 10).join(' | ')}`);
            if (_git.recentCommits.length) {
                contextLines.push('Recent commits:');
                for (const _c of _git.recentCommits.slice(0, 5)) contextLines.push(`  ${_c}`);
            }
            contextLines.push('');
        }
    }

    // -- Context Files (Scholar-mode: section extraction, not full dump) --
    if (projectRoot) {
        const _ctxFiles = loadContextFiles(projectRoot);
        if (_ctxFiles.length > 0) {
            contextLines.push('## Context Files (section-extracted - use view_file for full docs)');
            for (const _cf of _ctxFiles) {
                contextLines.push(`### ${_cf.name} [TRUST: ${_cf.trust.toUpperCase()}]`);
                contextLines.push(extractRelevantSections(_cf.content, query, 2500));
                contextLines.push('');
            }
        }
    }

    // -- Build readiness + return structured keys ------------------------
    const readiness = buildReadiness({
        graph, codexMatches: codexResult?.matches?.length || 0,
        archiveHits: archiveHits.length, patternMatches: patternMatches.length,
        filesAnalyzed: evidence.fileCount || 0,
    });
    return JSON.stringify({
        query,
        relevant_files: rankedFiles,
        intelligence_brief: briefLines.join('\n'),
        structural_evidence: evidenceLines.join('\n'),
        memory: memoryLines.join('\n'),
        project_context: contextLines.join('\n'),
        _readiness: readiness,
        _provenance: consultResult._provenance || {},
    }, null, 2);
}
