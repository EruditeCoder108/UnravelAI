import React, { useState, useRef, useEffect, useCallback } from 'react';
import {
    Code2, AlertTriangle, CheckSquare, Zap, Search, Loader2,
    Plus, Globe2, TerminalSquare, UploadCloud, Activity, Copy, Check,
    BrainCircuit, User, FolderTree, FileCode, Network, PauseCircle,
    Clock, Database, AlertOctagon, GitMerge, BookOpen, RefreshCw,
    ShieldAlert, Lightbulb, Key, ChevronRight, Baby, Palette, Book, Code, MessageSquare, Languages,
    Github, X, Link, Shield, Bug, Eye, Layers
} from 'lucide-react';
import {
    PROVIDERS, BUG_TAXONOMY, LEVELS, LANGUAGES,
    buildRouterPrompt, SECTION_REGISTRY, PRESETS, estimateRuntime,
    callProvider, orchestrate, parseAIJson,
} from './core/index.js';
import { ReportErrorBoundary } from './ErrorBoundary.jsx';

// ─── Helpers ────────────────────────────────────────────



const displayConfidence = (val) => {
    if (val == null) return 0;
    return val <= 1 ? Math.round(val * 100) : Math.round(val);
};

const getStoredKey = (provider) => localStorage.getItem(`unravel_key_${provider}`) || '';
const storeKey = (provider, key) => localStorage.setItem(`unravel_key_${provider}`, key);

// ─── Sub-Components ─────────────────────────────────────
const CopyBtn = ({ text, id, copiedId, onCopy, label = 'COPY' }) => (
    <button onClick={() => onCopy(text, id)}
        style={{ display: 'flex', alignItems: 'center', gap: 6, padding: '4px 10px', fontFamily: "'JetBrains Mono',monospace", fontSize: 10, fontWeight: 700, textTransform: 'uppercase', background: copiedId === id ? '#ccff00' : '#222', color: copiedId === id ? '#000' : '#aaa', border: '1px solid #444', cursor: 'pointer', transition: 'all 0.15s' }}>
        {copiedId === id ? <Check size={12} /> : <Copy size={12} />}
        {copiedId === id ? 'COPIED' : label}
    </button>
);

const SectionBlock = ({ icon, title, color, borderSide = 'left', children, copyText, copyId, copiedId, onCopy }) => (
    <div style={{ background: '#111', border: '2px solid #333', padding: 28, marginBottom: 14, ...(borderSide === 'left' ? { borderLeftWidth: 8, borderLeftColor: color } : { borderTopWidth: 8, borderTopColor: color }) }}>
        <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'flex-start', marginBottom: 14, paddingBottom: 10, borderBottom: '1px solid #333' }}>
            <h3 style={{ fontFamily: "'JetBrains Mono',monospace", fontWeight: 800, textTransform: 'uppercase', letterSpacing: 2, color, fontSize: 13, display: 'flex', alignItems: 'center', gap: 8 }}>
                {icon} {title}
            </h3>
            {copyText && <CopyBtn text={copyText} id={copyId} copiedId={copiedId} onCopy={onCopy} />}
        </div>
        {children}
    </div>
);

// ─── Mermaid Utilities ───────────────────────────────────────────────────────

// Sanitize any string into a valid Mermaid node ID
const mId = (s) => String(s).replace(/[^a-zA-Z0-9]/g, '_').slice(0, 30);

// Escape double quotes for use inside Mermaid text labels ["..."]
const mLabel = (s) => String(s || '').replace(/"/g, '#quot;');

// Detect cycles in an edge list — returns true if cycle exists
function hasCycle(edges) {
    if (!edges || edges.length === 0) return false;
    const graph = {};
    edges.forEach(({ from, to }) => {
        if (!graph[from]) graph[from] = [];
        graph[from].push(to);
    });
    const visited = new Set();
    const check = (node, path) => {
        if (path.has(node)) return true;
        if (visited.has(node)) return false;
        visited.add(node); path.add(node);
        for (const next of (graph[node] || [])) {
            if (check(next, path)) return true;
        }
        path.delete(node);
        return false;
    };
    return edges.some(({ from }) => check(from, new Set()));
}

// Build sequence diagram from timelineEdges
function buildTimelineMermaid(edges) {
    if (!edges || edges.length === 0) return null;
    const lines = ['sequenceDiagram'];
    edges.forEach(({ from, to, label, isBugPoint }) => {
        const arrow = isBugPoint ? '-->>' : '->>';
        const prefix = isBugPoint ? '    Note over ' + mId(from) + ',' + mId(to) + ': 🐛 BUG HERE\n' : '';
        lines.push(`${prefix}    ${mId(from)}${arrow}${mId(to)}: ${mLabel(label)}`);
    });
    return lines.join('\n');
}

// Build hypothesis elimination flowchart from hypothesisTree
function buildHypothesisMermaid(tree) {
    if (!tree || tree.length === 0) return null;
    const lines = ['flowchart TD'];
    tree.forEach(({ id, text, status, reason }, idx) => {
        const nodeId = mId(id);
        const shortText = mLabel(text.slice(0, 40));
        if (status === 'survived') {
            const survivedId = `SURVIVED_${idx}`;
            lines.push(`    ${nodeId}["${mLabel(id)}: ${shortText}"]`);
            lines.push(`    ${nodeId} --> ${survivedId}["✅ Root Cause Confirmed"]`);
            lines.push(`    style ${nodeId} fill:#00ff88,color:#000`);
            lines.push(`    style ${survivedId} fill:#00ff88,color:#000`);
        } else {
            const elimId = mId(id + '_elim');
            lines.push(`    ${nodeId}["${mLabel(id)}: ${shortText}"]`);
            lines.push(`    ${nodeId} -->|"${mLabel((reason || '').slice(0, 35))}"| ${elimId}["❌ Eliminated"]`);
            lines.push(`    style ${nodeId} fill:#333,color:#fff`);
            lines.push(`    style ${elimId} fill:#ff3333,color:#fff`);
        }
    });
    return lines.join('\n');
}

// Build AI loop cycle diagram from aiLoopEdges
function buildAILoopMermaid(edges) {
    if (!edges || edges.length === 0) return null;
    const lines = ['flowchart LR'];
    edges.forEach(({ from, to, label, isEscapePath }) => {
        const f = mId(from); const t = mId(to);
        lines.push(`    ${f}["${mLabel(from)}"] -->|"${mLabel(label)}"| ${t}["${mLabel(to)}"]`);
        if (isEscapePath) {
            lines.push(`    style ${f} fill:#00ff88,color:#000`);
            lines.push(`    style ${t} fill:#00ff88,color:#000`);
        }
    });
    return lines.join('\n');
}

// Build variable mutation flow from variableStateEdges (only for complex variables)
function buildVariableMermaid(varEdges) {
    if (!varEdges || varEdges.length === 0) return null;
    const result = [];
    varEdges.forEach(({ variable, edges }) => {
        if (!edges || edges.length < 5) return; // only complex variables
        const lines = [`flowchart LR`];
        const declId = mId(variable + '_decl');
        const firstEdgeFrom = mId(edges[0].from + '0');
        lines.push(`    ${declId}["${mLabel(variable)} declared"]`);
        lines.push(`    ${declId} --> ${firstEdgeFrom}`);
        edges.forEach(({ from, to, label, type }, i) => {
            const f = mId(from + i); const t = mId(to + i);
            lines.push(`    ${f}["${mLabel(from)}"] -->|"${mLabel(label)}"| ${t}["${mLabel(to)}"]`);
            if (type === 'write') lines.push(`    style ${f} fill:#ffaa00,color:#000`);
            if (type === 'read') lines.push(`    style ${t} fill:#448aff,color:#fff`);
            if (type === 'mutate') lines.push(`    style ${f} fill:#ff003c,color:#fff`);
        });
        result.push({ variable, mermaid: lines.join('\n') });
    });
    return result;
}

// Build data flow flowchart from flowchartEdges (Explain Mode)
function buildDataFlowMermaid(edges) {
    if (!edges || edges.length === 0) return null;
    if (hasCycle(edges)) return null; // fall back to table on cycles
    const lines = ['flowchart TD'];
    const seen = new Set();
    edges.forEach(({ from, to, label }) => {
        const f = mId(from); const t = mId(to);
        if (!seen.has(f)) { lines.push(`    ${f}["${mLabel(from)}"]`); seen.add(f); }
        if (!seen.has(t)) { lines.push(`    ${t}["${mLabel(to)}"]`); seen.add(t); }
        lines.push(`    ${f} -->|"${mLabel(label)}"| ${t}`);
    });
    return lines.join('\n');
}

// Build dependency graph from dependencyEdges (Explain Mode)
function buildDependencyMermaid(deps) {
    if (!deps || deps.length === 0) return null;
    const lines = ['graph LR'];
    deps.forEach(({ file, imports }) => {
        (imports || []).forEach(imp => {
            lines.push(`    ${mId(file)}["${mLabel(file)}"] --> ${mId(imp)}["${mLabel(imp)}"]`);
        });
    });
    return lines.join('\n');
}

// Build attack vector flowchart from attackVectorEdges (Security Mode)
function buildAttackVectorMermaid(edges) {
    if (!edges || edges.length === 0) return null;
    const lines = ['flowchart TD'];
    const seen = new Set();
    edges.forEach(({ from, to, label, isExploitStep }) => {
        const f = mId(from); const t = mId(to);
        if (!seen.has(f)) { lines.push(`    ${f}["${mLabel(from)}"]`); seen.add(f); }
        if (!seen.has(t)) { lines.push(`    ${t}["${mLabel(to)}"]`); seen.add(t); }
        lines.push(`    ${f} -->|"${mLabel(label)}"| ${t}`);
        if (isExploitStep) {
            lines.push(`    style ${f} fill:#ff003c,color:#fff`);
            lines.push(`    style ${t} fill:#ff003c,color:#fff`);
        } else {
            lines.push(`    style ${f} fill:#ffaa00,color:#000`);
        }
    });
    return lines.join('\n');
}

// Mermaid renderer component — renders the diagram or falls back gracefully
function MermaidChart({ chart, caption }) {
    const ref = React.useRef(null);
    React.useEffect(() => {
        if (!ref.current || !chart) return;
        ref.current.removeAttribute('data-processed');
        ref.current.innerHTML = chart;
        try {
            const result = window.mermaid?.run({ nodes: [ref.current] });
            // mermaid.run returns a promise — catch render errors silently
            if (result && typeof result.catch === 'function') {
                result.catch(err => {
                    console.warn('[MERMAID] Chart render failed:', err);
                    if (ref.current) {
                        ref.current.innerHTML = '<p style="color:#666;font-size:12px;font-family:monospace">⚠️ Chart could not be rendered</p>';
                    }
                });
            }
        } catch (err) {
            console.warn('[MERMAID] Chart render error:', err);
            if (ref.current) {
                ref.current.innerHTML = '<p style="color:#666;font-size:12px;font-family:monospace">⚠️ Chart could not be rendered</p>';
            }
        }
    }, [chart]);
    if (!chart) return null;
    return (
        <div style={{ background: '#0a0a0a', border: '1px solid #333', padding: 16, marginTop: 12, borderRadius: 0, overflow: 'auto' }}>
            <div className="mermaid" ref={ref}>{chart}</div>
            {caption && <p style={{ fontFamily: "'JetBrains Mono',monospace", fontSize: 10, color: '#666', marginTop: 8, textTransform: 'uppercase', letterSpacing: 1 }}>{caption}</p>}
        </div>
    );
}

// ─── Main App ───────────────────────────────────────────
export default function App() {
    // State
    const [step, setStep] = useState(1);
    const [level, setLevel] = useState('vibe');
    const [language, setLanguage] = useState('hinglish');
    const [provider, setProvider] = useState('anthropic');
    const [model, setModel] = useState('');
    const [apiKey, setApiKey] = useState('');
    const [showKey, setShowKey] = useState(false);

    const [inputType, setInputType] = useState('paste');
    const [pastedFiles, setPastedFiles] = useState([{ name: '', content: '' }]);
    const [directoryFiles, setDirectoryFiles] = useState([]);
    const [githubUrl, setGithubUrl] = useState('');
    const [githubLoading, setGithubLoading] = useState(false);
    const [githubError, setGithubError] = useState('');
    const [userError, setUserError] = useState('');

    const [isAnalyzing, setIsAnalyzing] = useState(false);
    const [analysisError, setAnalysisError] = useState('');
    const [loadingStage, setLoadingStage] = useState('');
    const [report, setReport] = useState(null);

    const [missingFileRequest, setMissingFileRequest] = useState(null);
    const [additionalFiles, setAdditionalFiles] = useState([]);
    const [viewMode, setViewMode] = useState(null);
    const [copiedSection, setCopiedSection] = useState(null);
    const [routerSelectedPaths, setRouterSelectedPaths] = useState([]);

    // ── Phase 4A: Mode + Preset State ──
    const [analysisMode, setAnalysisMode] = useState('debug');
    const [preset, setPreset] = useState('full');
    const [outputSections, setOutputSections] = useState(null); // null = use preset default
    const [progressStages, setProgressStages] = useState([]);

    const dirInputRef = useRef(null);
    const githubRepoContext = useRef(null); // Stores { owner, repo, branch, tree } for missing-files callback

    // ── localStorage Persistence ──
    useEffect(() => {
        try {
            const saved = JSON.parse(localStorage.getItem('unravel_prefs') || '{}');
            if (saved.analysisMode) setAnalysisMode(saved.analysisMode);
            if (saved.preset) setPreset(saved.preset);
            if (saved.outputSections) setOutputSections(saved.outputSections);
            if (saved.level) setLevel(saved.level);
            if (saved.language) setLanguage(saved.language);
        } catch { /* ignore corrupt localStorage */ }
    }, []);

    // ── Mermaid Init ──
    useEffect(() => {
        import('mermaid').then(m => {
            m.default.initialize({
                startOnLoad: false,
                theme: 'dark',
                flowchart: { curve: 'basis', htmlLabels: true },
                sequence: { actorMargin: 50, useMaxWidth: true },
            });
            window.mermaid = m.default;
        });
    }, []);

    const savePrefs = useCallback((overrides = {}) => {
        const prefs = { analysisMode, preset, outputSections, level, language, ...overrides };
        localStorage.setItem('unravel_prefs', JSON.stringify(prefs));
    }, [analysisMode, preset, outputSections, level, language]);

    // Save prefs whenever they change
    useEffect(() => { savePrefs(); }, [savePrefs]);

    // Init model from provider
    React.useEffect(() => {
        const prov = PROVIDERS[provider];
        if (prov) {
            setModel(prov.models[prov.defaultModel]?.id || '');
            setApiKey(getStoredKey(provider));
        }
    }, [provider]);

    // Handlers
    const handleCopy = (text, id) => {
        navigator.clipboard?.writeText(text).catch(() => {
            const ta = document.createElement('textarea');
            ta.value = text; document.body.appendChild(ta); ta.select();
            document.execCommand('copy'); document.body.removeChild(ta);
        });
        setCopiedSection(id);
        setTimeout(() => setCopiedSection(null), 2000);
    };

    const handleDirectoryUpload = (e) => {
        const files = Array.from(e.target.files);
        const validExts = ['.js', '.jsx', '.ts', '.tsx', '.html', '.css', '.json', '.py', '.md', '.env.example', '.vue', '.svelte'];
        const blacklist = ['node_modules', '.git', '.next', 'dist', 'build', 'coverage', '__pycache__'];
        const clean = files.filter(f => {
            const path = f.webkitRelativePath || f.name;
            return !blacklist.some(d => path.includes(`/${d}/`) || path.includes(`\\${d}\\`) || path.startsWith(`${d}/`))
                && validExts.some(ext => path.endsWith(ext))
                && f.size < 500000;
        });
        // Append new files, skip duplicates by path
        setDirectoryFiles(prev => {
            const existingPaths = new Set(prev.map(f => f.webkitRelativePath || f.name));
            const newFiles = clean.filter(f => !existingPaths.has(f.webkitRelativePath || f.name));
            return [...prev, ...newFiles];
        });
    };

    const removeDirectoryFile = (index) => {
        setDirectoryFiles(prev => prev.filter((_, i) => i !== index));
    };

    // ── GitHub: fetch repo tree, Router-select relevant files, download content ──
    // This is called from executeAnalysis (not from a separate button)
    // so the symptom (userError) is always available for the Router Agent.
    const fetchGitHubFiles = async (symptom, onProgress) => {
        // Parse GitHub URL → owner/repo (also detect issue URLs)
        const urlObj = new URL(githubUrl.trim());
        const parts = urlObj.pathname.replace(/^\//, '').replace(/\/$/, '').split('/');
        if (parts.length < 2) throw new Error('URL must be github.com/owner/repo or github.com/owner/repo/issues/123');
        const [owner, repo] = parts;

        // ── Detect GitHub Issue URL: github.com/owner/repo/issues/123 ──
        let effectiveSymptom = symptom;
        if (parts.length >= 4 && parts[2] === 'issues' && /^\d+$/.test(parts[3])) {
            const issueNumber = parts[3];
            onProgress?.(`GITHUB: Fetching issue #${issueNumber} details...`);
            try {
                const issueRes = await fetch(`https://api.github.com/repos/${owner}/${repo}/issues/${issueNumber}`);
                if (issueRes.ok) {
                    const issueData = await issueRes.json();
                    const issueTitle = issueData.title || '';
                    const issueBody = (issueData.body || '').slice(0, 3000); // cap to avoid token overflow
                    effectiveSymptom = `[GitHub Issue #${issueNumber}] ${issueTitle}\n\n${issueBody}`;
                    // Auto-fill the symptom field in the UI
                    setUserError(effectiveSymptom);
                    console.log(`[ISSUE] Fetched issue #${issueNumber}: ${issueTitle}`);
                } else {
                    console.warn(`[ISSUE] Could not fetch issue #${issueNumber}: ${issueRes.status}`);
                }
            } catch (issueErr) {
                console.warn('[ISSUE] Failed to fetch issue:', issueErr.message);
            }
        }

        const branch = (parts[2] === 'tree' && parts[3]) ? parts[3] : 'main'; // /tree/branch support

        onProgress?.('GITHUB: Fetching repository tree...');

        // Fetch the repo tree
        const treeRes = await fetch(`https://api.github.com/repos/${owner}/${repo}/git/trees/${branch}?recursive=1`);
        if (!treeRes.ok) {
            if (treeRes.status === 404) throw new Error('Repo not found. Is it public?');
            throw new Error(`GitHub API error: ${treeRes.status}`);
        }
        const treeData = await treeRes.json();

        // Full file tree (minus blacklist) — stored for missing-files lookup
        const blacklist = ['node_modules', '.git', '.next', 'dist', 'build', 'coverage', '__pycache__', 'package-lock.json', 'yarn.lock'];
        const allRepoFiles = (treeData.tree || []).filter(f =>
            f.type === 'blob'
            && f.size < 500000
            && !blacklist.some(d => f.path.includes(`${d}/`) || f.path === d)
        );

        // Filter to valid source files for the Router Agent
        const validExts = ['.js', '.jsx', '.ts', '.tsx', '.html', '.css', '.json', '.py', '.md', '.vue', '.svelte'];
        const allCandidates = allRepoFiles.filter(f =>
            validExts.some(ext => f.path.endsWith(ext))
        );

        if (allCandidates.length === 0) throw new Error('No valid source files found in repo.');

        // Store context for onMissingFiles callback
        githubRepoContext.current = { owner, repo, branch, tree: allRepoFiles };

        // ── Router Agent: pick relevant files using the symptom ──
        let candidates = allCandidates;
        if (allCandidates.length > 10 && apiKey && provider && model) {
            try {
                onProgress?.(`ROUTER AGENT: Selecting from ${allCandidates.length} files...`);
                const allPaths = allCandidates.map(f => `${repo}/${f.path}`);
                const routerPrompt = buildRouterPrompt(allPaths, effectiveSymptom, analysisMode);
                const routerRaw = await callProvider({
                    provider, apiKey, model,
                    systemPrompt: 'You are a file routing agent. Return JSON only.',
                    userPrompt: routerPrompt,
                    useSchema: false,
                });
                const routerData = parseAIJson(routerRaw);
                const selectedPaths = routerData?.filesToRead || [];
                if (selectedPaths.length > 0) {
                    const selectedSet = new Set(selectedPaths.map(p =>
                        p.startsWith(`${repo}/`) ? p.slice(repo.length + 1) : p
                    ));
                    const filtered = allCandidates.filter(f => selectedSet.has(f.path));
                    if (filtered.length >= 2) {
                        candidates = filtered;
                        console.log(`[ROUTER] Selected ${filtered.length} files from ${allCandidates.length} candidates`);
                    }
                }
            } catch (routerErr) {
                console.warn('[ROUTER] Failed, falling back to all candidates:', routerErr.message);
            }
        }

        // Cap at 50 files max
        candidates = candidates.slice(0, 50);
        onProgress?.(`GITHUB: Downloading ${candidates.length} files...`);

        // Fetch file contents in parallel (batches of 10)
        const fetched = [];
        for (let i = 0; i < candidates.length; i += 10) {
            const batch = candidates.slice(i, i + 10);
            const results = await Promise.all(batch.map(async (f) => {
                try {
                    const rawRes = await fetch(`https://raw.githubusercontent.com/${owner}/${repo}/${branch}/${f.path}`);
                    if (!rawRes.ok) return null;
                    const content = await rawRes.text();
                    return { name: `${repo}/${f.path}`, content, webkitRelativePath: `${repo}/${f.path}` };
                } catch { return null; }
            }));
            fetched.push(...results.filter(Boolean));
        }

        if (fetched.length === 0) throw new Error('All file downloads failed.');

        // Convert to File-like objects and update state for UI display
        const fileObjects = fetched.map(f => ({
            name: f.name,
            webkitRelativePath: f.webkitRelativePath,
            size: f.content.length,
            _content: f.content,
            text: () => Promise.resolve(f.content),
        }));

        setDirectoryFiles(fileObjects);
        return fileObjects;
    };

    const readSelectedFiles = async (paths) => {
        const toRead = directoryFiles.filter(f => paths.includes(f.webkitRelativePath));
        return Promise.all(toRead.map(file => {
            // GitHub-fetched files have pre-loaded _content
            if (file._content) {
                return Promise.resolve({ name: file.webkitRelativePath, content: file._content });
            }
            // Browser-uploaded File objects use FileReader
            return new Promise(resolve => {
                const reader = new FileReader();
                reader.onload = (e) => resolve({ name: file.webkitRelativePath, content: e.target.result });
                reader.readAsText(file);
            });
        }));
    };

    // ═══ THE ENGINE ═══════════════════════════════════════
    const executeAnalysis = async (resumeWithExtra = false) => {
        setIsAnalyzing(true);
        setAnalysisError('');
        setStep(3);
        setProgressStages([]);
        if (!resumeWithExtra) { setViewMode(null); setMissingFileRequest(null); }

        try {
            let codeFiles = [];
            let projectContext = '';

            // ── Gather files ──
            if (inputType === 'github') {
                // GitHub mode: fetch + route + download in one flow
                if (directoryFiles.length === 0 && !resumeWithExtra) {
                    // First run — fetch from GitHub (Router uses symptom)
                    if (!githubUrl.trim()) throw new Error('Enter a GitHub repository URL.');
                    const ghFiles = await fetchGitHubFiles(userError, setLoadingStage);
                    const filePaths = ghFiles.map(f => f.webkitRelativePath);
                    setRouterSelectedPaths(filePaths);
                    projectContext = `Project tree: GitHub repo, ${ghFiles.length} files selected.`;
                    codeFiles = ghFiles.map(f => ({ name: f.webkitRelativePath, content: f._content }));
                } else {
                    // Resume or files already fetched
                    const resumePaths = routerSelectedPaths.length > 0
                        ? routerSelectedPaths
                        : directoryFiles.slice(0, 7).map(f => f.webkitRelativePath);
                    codeFiles = await readSelectedFiles(resumePaths);
                    projectContext = `Project tree: ${directoryFiles.length} files total.`;
                }
            } else if (inputType === 'upload') {
                if (directoryFiles.length === 0) throw new Error('Upload a project folder first.');
                setLoadingStage('ROUTER AGENT: Mapping directory tree...');
                const filePaths = directoryFiles.map(f => f.webkitRelativePath);
                projectContext = `Project tree: ${filePaths.length} files total.`;

                if (!resumeWithExtra) {
                    const routerPrompt = buildRouterPrompt(filePaths, userError, analysisMode);
                    const routerRaw = await callProvider({
                        provider, apiKey, model,
                        systemPrompt: 'You are a file routing agent. Return JSON only.',
                        userPrompt: routerPrompt,
                        useSchema: false,
                    });
                    const routerData = parseAIJson(routerRaw);
                    const selectedPaths = routerData?.filesToRead || filePaths.slice(0, 7);
                    setRouterSelectedPaths(selectedPaths);
                    setLoadingStage(`ROUTER: Selected ${selectedPaths.length} files...`);
                    codeFiles = await readSelectedFiles(selectedPaths);
                } else {
                    const resumePaths = routerSelectedPaths.length > 0
                        ? routerSelectedPaths
                        : directoryFiles.slice(0, 7).map(f => f.webkitRelativePath);
                    codeFiles = await readSelectedFiles(resumePaths);
                }
            } else {
                codeFiles = pastedFiles.filter(f => f.name.trim() && f.content.trim());
                if (codeFiles.length === 0) throw new Error('Paste at least one file with code.');
            }

            // Append additional files from missing files step
            if (additionalFiles.length > 0) {
                codeFiles = [...codeFiles, ...additionalFiles.filter(f => f.name && f.content)];
            }

            // ── Run the core engine pipeline via orchestrate() ──
            const result = await orchestrate(codeFiles, userError, {
                provider,
                apiKey,
                model,
                level,
                language,
                projectContext,
                mode: analysisMode,
                preset,
                outputSections,
                onProgress: (msg) => {
                    // Handle both string and structured progress
                    if (typeof msg === 'string') {
                        setLoadingStage(msg);
                    } else if (msg && typeof msg === 'object') {
                        setLoadingStage(msg.label || '');
                        setProgressStages(prev => {
                            const existing = prev.findIndex(s => s.stage === msg.stage);
                            if (existing >= 0) {
                                const updated = [...prev];
                                updated[existing] = msg;
                                return updated;
                            }
                            return [...prev, msg];
                        });
                    }
                },
                onMissingFiles: async (request) => {
                    const filesNeeded = request.filesNeeded || [];
                    if (filesNeeded.length === 0) return null;

                    // GitHub mode: auto-fetch from API
                    if (inputType === 'github' && githubRepoContext.current) {
                        const { owner, repo, branch, tree } = githubRepoContext.current;
                        setLoadingStage(`SELF-HEAL: Fetching ${filesNeeded.length} additional files (${request.reason})...`);

                        const additional = [];
                        for (const requestedPath of filesNeeded) {
                            // Normalize: strip repo prefix if present
                            const cleanPath = requestedPath.startsWith(`${repo}/`)
                                ? requestedPath.slice(repo.length + 1)
                                : requestedPath;

                            // Exact match in tree, or fuzzy match by filename
                            let matchedEntry = tree.find(f => f.path === cleanPath);
                            if (!matchedEntry) {
                                const filename = cleanPath.split(/[\\/]/).pop();
                                matchedEntry = tree.find(f =>
                                    f.path.endsWith('/' + filename) || f.path === filename
                                );
                            }

                            if (matchedEntry) {
                                try {
                                    const res = await fetch(
                                        `https://raw.githubusercontent.com/${owner}/${repo}/${branch}/${matchedEntry.path}`
                                    );
                                    if (res.ok) {
                                        const content = await res.text();
                                        additional.push({ name: `${repo}/${matchedEntry.path}`, content });
                                    }
                                } catch { /* skip failed downloads */ }
                            }
                        }

                        if (additional.length > 0) {
                            console.log(`[SELF-HEAL] Fetched ${additional.length}/${filesNeeded.length} additional files`);
                            return additional; // Orchestrator will recursively re-run
                        }
                        // If no files could be fetched, fall through to manual UI
                    }

                    // Non-GitHub / fallback: show manual paste UI
                    setMissingFileRequest(request);
                    setAdditionalFiles(filesNeeded.map(f => ({ name: f, content: '' })));
                    setStep(3.5);
                    return null;
                },
            });

            // If orchestrate returned with a report, show it
            // Handle debug report shape (nested or flat)
            if (analysisMode === 'explain' || analysisMode === 'security') {
                // Explain/Security results are directly the output
                setReport(result);
                setViewMode('all');
                setStep(5);
            } else if (result?.report) {
                setReport(result.report);
                setViewMode('all');
                setStep(5);
            } else if (result?.bugType || result?.rootCause) {
                // Model returned report fields at top level instead of nested
                setReport(result);
                setViewMode('all');
                setStep(5);
            } else if (!result?.needsMoreInfo) {
                throw new Error('Unexpected engine response format. The model returned data we could not display.');
            }

        } catch (err) {
            console.error('Engine Error:', err);
            setAnalysisError(err.message);
            setStep(2);
        } finally {
            setIsAnalyzing(false);
        }
    };

    const reset = () => {
        setStep(1); setReport(null); setMissingFileRequest(null);
        setAdditionalFiles([]); setAnalysisError(''); setViewMode(null);
    };

    const canExecute = apiKey.trim() && (
        (inputType === 'upload' && directoryFiles.length > 0) ||
        (inputType === 'paste' && pastedFiles.some(f => f.name.trim() && f.content.trim())) ||
        (inputType === 'github' && githubUrl.trim())
    );

    const prov = PROVIDERS[provider];
    const bugMeta = report ? (BUG_TAXONOMY[report.bugType] || BUG_TAXONOMY.OTHER) : null;

    const ICON_MAP = {
        Baby: <Baby size={20} />, Palette: <Palette size={20} />, Book: <Book size={20} />, Code: <Code size={20} />,
        MessageSquare: <MessageSquare size={16} />, Languages: <Languages size={16} />, Globe2: <Globe2 size={16} />
    };

    // ═══ STYLES ═══════════════════════════════════════════
    const S = {
        wrap: { maxWidth: 1600, margin: '0 auto', paddingLeft: 32, paddingRight: 32 },
        card: { background: '#111', border: '2px solid #333', padding: 28, marginBottom: 20 },
        label: { fontFamily: "'JetBrains Mono',monospace", textTransform: 'uppercase', fontSize: 12, fontWeight: 700, letterSpacing: 2, display: 'flex', alignItems: 'center', gap: 8, marginBottom: 8 },
        input: { width: '100%', background: '#0a0a0a', border: '2px solid #333', padding: '11px 14px', color: '#e0e0e0', fontSize: 14, fontFamily: 'inherit', boxSizing: 'border-box' },
        codeInput: { width: '100%', background: '#0a0a0a', border: '2px solid #333', padding: '11px 14px', color: '#ddd', fontSize: 13, fontFamily: "'JetBrains Mono',monospace", boxSizing: 'border-box', minHeight: 140, resize: 'vertical' },
        btnPrimary: { background: '#ccff00', color: '#000', border: '2px solid #000', padding: '14px 24px', fontWeight: 800, fontSize: 16, textTransform: 'uppercase', letterSpacing: 2, fontFamily: 'inherit', width: '100%', cursor: 'pointer', transition: 'all 0.15s' },
        btnOutline: { background: 'transparent', color: '#aaa', border: '2px solid #555', padding: '10px 18px', fontFamily: "'JetBrains Mono',monospace", fontSize: 13, fontWeight: 600, textTransform: 'uppercase', cursor: 'pointer' },
        optBtn: (active, accentColor = '#ccff00') => ({
            padding: '14px 16px', fontWeight: 700, textTransform: 'uppercase', letterSpacing: 1, border: '2px solid', borderColor: active ? accentColor : '#333', background: active ? accentColor + '18' : 'transparent', color: active ? '#fff' : '#888', cursor: 'pointer', fontFamily: 'inherit', fontSize: 13, transition: 'all 0.15s',
        }),
        tabBtn: (active) => ({
            flex: 1, padding: '14px', display: 'flex', alignItems: 'center', justifyContent: 'center', gap: 8, fontFamily: "'JetBrains Mono',monospace", fontWeight: 700, fontSize: 13, textTransform: 'uppercase', cursor: 'pointer', border: 'none', borderBottom: active ? 'none' : '2px solid #333', background: active ? '#e0e0e0' : 'transparent', color: active ? '#050505' : '#888', transition: 'all 0.15s',
        }),
    };

    // ═══ RENDER ═══════════════════════════════════════════

    return (
        <div style={{ minHeight: '100vh', background: '#050505', color: '#e0e0e0', fontFamily: "'Bricolage Grotesque',sans-serif", position: 'relative', overflowX: 'hidden' }}>
            {/* Noise overlay */}
            <div className="bg-noise" style={{ position: 'absolute', inset: 0, pointerEvents: 'none', zIndex: 0, mixBlendMode: 'overlay' }} />

            {/* Header */}
            <header style={{ borderBottom: '2px solid #222', background: '#050505e6', backdropFilter: 'blur(12px)', position: 'sticky', top: 0, zIndex: 20 }}>
                <div style={{ ...S.wrap, paddingTop: 14, paddingBottom: 14, paddingLeft: 24, paddingRight: 24, display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
                    <div style={{ display: 'flex', alignItems: 'center', gap: 12, cursor: 'pointer' }} onClick={() => setStep(1)}>
                        <div style={{ background: '#ccff00', padding: 4, border: '2px solid #000' }}>
                            <Code2 size={28} color="#000" />
                        </div>
                        <h1 style={{ fontSize: 26, fontWeight: 800, letterSpacing: -1, color: '#fff', textTransform: 'uppercase', margin: 0 }}>
                            UNRAVEL <span style={{ color: '#00ffff', fontFamily: "'JetBrains Mono',monospace", fontSize: 12 }}>v3.Engine</span>
                        </h1>
                    </div>
                    {step > 1 && <button style={S.btnOutline} onClick={reset}>← Reset</button>}
                </div>
            </header>

            <main style={{ ...S.wrap, paddingTop: 40, paddingBottom: 80, position: 'relative', zIndex: 10 }}>

                {/* ═══ STEP 1: Profile + API Key ═══ */}
                {step === 1 && (
                    <div className="animate-in" style={{ maxWidth: 1200, margin: '0 auto' }}>
                        {/* Hero */}
                        <div style={{ borderLeft: '4px solid #ccff00', paddingLeft: 24, marginBottom: 40 }}>
                            <h2 style={{ fontSize: 48, fontWeight: 800, color: '#fff', textTransform: 'uppercase', lineHeight: 1.1, margin: 0 }}>
                                Deterministic<br />Debug Engine.
                            </h2>
                            <p style={{ color: '#888', fontFamily: "'JetBrains Mono',monospace", marginTop: 10, fontSize: 13 }}>
                                Not a guess. Not a vibe. A structured debugging pipeline.
                            </p>
                        </div>

                        <div style={S.card}>
                            {/* API Key Setup */}
                            <div style={{ marginBottom: 28, paddingBottom: 24, borderBottom: '2px solid #222' }}>
                                <div style={{ ...S.label, color: '#ff003c', marginBottom: 14 }}>
                                    <Key size={14} /> [00] API Configuration
                                </div>
                                <div style={{ display: 'flex', gap: 8, marginBottom: 12, flexWrap: 'wrap' }}>
                                    {Object.entries(PROVIDERS).map(([key, p]) => (
                                        <button key={key} style={S.optBtn(provider === key, '#ff003c')} onClick={() => setProvider(key)}>
                                            {p.name}
                                        </button>
                                    ))}
                                </div>
                                {prov && (
                                    <div style={{ display: 'flex', gap: 8, marginBottom: 12, flexWrap: 'wrap' }}>
                                        {Object.entries(prov.models).map(([key, m]) => (
                                            <button key={key} style={S.optBtn(model === m.id, '#00ffff')} onClick={() => setModel(m.id)}>
                                                {m.label} <span style={{ opacity: 0.5, fontSize: 10 }}>({m.tier})</span>
                                            </button>
                                        ))}
                                    </div>
                                )}
                                <div style={{ position: 'relative' }}>
                                    <input
                                        type={showKey ? 'text' : 'password'}
                                        style={{ ...S.input, paddingRight: 60, fontFamily: "'JetBrains Mono',monospace", fontSize: 12 }}
                                        placeholder={`Enter your ${prov?.name || ''} API key...`}
                                        value={apiKey}
                                        onChange={(e) => { setApiKey(e.target.value); storeKey(provider, e.target.value); }}
                                    />
                                    <button onClick={() => setShowKey(!showKey)} style={{ position: 'absolute', right: 8, top: '50%', transform: 'translateY(-50%)', background: 'none', border: 'none', color: '#666', fontSize: 11, fontFamily: "'JetBrains Mono',monospace", cursor: 'pointer' }}>
                                        {showKey ? 'HIDE' : 'SHOW'}
                                    </button>
                                </div>
                                <p style={{ color: '#555', fontSize: 11, fontFamily: "'JetBrains Mono',monospace", marginTop: 6 }}>
                                    Stored locally in your browser. Never sent anywhere except the API provider.
                                </p>
                            </div>

                            {/* Level */}
                            <div style={{ marginBottom: 24 }}>
                                <div style={{ ...S.label, color: '#ccff00' }}><TerminalSquare size={14} /> [01] Coding Level</div>
                                <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(140px, 1fr))', gap: 8 }}>
                                    {Object.entries(LEVELS).map(([key, v]) => (
                                        <button key={key} style={S.optBtn(level === key)} onClick={() => setLevel(key)}>
                                            <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'center', gap: 8, marginBottom: 4 }}>
                                                <span style={{ color: level === key ? '#fff' : '#ccff00', display: 'flex' }}>{ICON_MAP[v.icon]}</span>
                                                <span style={{ fontSize: 15 }}>{v.label}</span>
                                            </div>
                                            <div style={{ fontSize: 10, opacity: 0.6, fontWeight: 400, textTransform: 'none' }}>{v.desc}</div>
                                        </button>
                                    ))}
                                </div>
                            </div>

                            {/* Language */}
                            <div style={{ marginBottom: 28 }}>
                                <div style={{ ...S.label, color: '#ff00ff' }}><Globe2 size={14} /> [02] Output Language</div>
                                <div style={{ display: 'flex', gap: 8, flexWrap: 'wrap' }}>
                                    {Object.entries(LANGUAGES).map(([key, v]) => (
                                        <button key={key} style={S.optBtn(language === key, '#ff00ff')} onClick={() => setLanguage(key)}>
                                            <div style={{ display: 'flex', alignItems: 'center', gap: 6 }}>
                                                <span style={{ color: language === key ? '#fff' : '#ff00ff', display: 'flex' }}>{ICON_MAP[v.icon]}</span>
                                                {v.label}
                                            </div>
                                        </button>
                                    ))}
                                </div>
                            </div>

                            <button style={{ ...S.btnPrimary, opacity: apiKey.trim() ? 1 : 0.4 }}
                                disabled={!apiKey.trim()} onClick={() => setStep(2)}>
                                Initialize Workspace →
                            </button>
                        </div>
                    </div>
                )}

                {/* ═══ STEP 2: Code Input ═══ */}
                {step === 2 && (
                    <div className="animate-in" style={{ maxWidth: 1200, margin: '0 auto' }}>
                        <h2 style={{ fontSize: 36, fontWeight: 800, color: '#fff', textTransform: 'uppercase', borderBottom: '2px solid #333', paddingBottom: 14, marginBottom: 24 }}>
                            Inject Architecture
                        </h2>

                        <div style={S.card}>
                            {/* Tabs */}
                            <div style={{ display: 'flex', borderBottom: '2px solid #333', marginBottom: 24 }}>
                                <button style={S.tabBtn(inputType === 'upload')} onClick={() => setInputType('upload')}>
                                    <FolderTree size={14} /> Folder Upload
                                </button>
                                <button style={{ ...S.tabBtn(inputType === 'paste'), borderLeft: '2px solid #333' }} onClick={() => setInputType('paste')}>
                                    <FileCode size={14} /> Raw Paste
                                </button>
                                <button style={{ ...S.tabBtn(inputType === 'github'), borderLeft: '2px solid #333' }} onClick={() => setInputType('github')}>
                                    <Github size={14} /> GitHub Import
                                </button>
                            </div>

                            {inputType === 'upload' && (
                                <div>
                                    <div style={{ background: '#00ffff18', borderLeft: '4px solid #00ffff', padding: 14, fontFamily: "'JetBrains Mono',monospace", color: '#00ffff', fontSize: 13, marginBottom: 16 }}>
                                        <strong style={{ display: 'flex', alignItems: 'center', gap: 6 }}><Search size={14} /> SMART ROUTING ACTIVE</strong>
                                        <span style={{ color: '#aaa' }}>Upload entire folder. AI will selectively read relevant files only.</span>
                                    </div>
                                    <div onClick={() => dirInputRef.current?.click()}
                                        style={{ border: '2px dashed #555', background: '#0a0a0a', padding: 48, textAlign: 'center', cursor: 'pointer', transition: 'border-color 0.15s' }}>
                                        <UploadCloud size={40} color="#555" style={{ margin: '0 auto 12px' }} />
                                        <p style={{ fontFamily: "'JetBrains Mono',monospace", color: '#aaa', fontSize: 15, fontWeight: 700, textTransform: 'uppercase' }}>
                                            {directoryFiles.length > 0 ? 'Add More Files' : 'Upload Project Folder'}
                                        </p>
                                        <input type="file" webkitdirectory="true" directory="true" multiple ref={dirInputRef} onChange={handleDirectoryUpload} style={{ display: 'none' }} />
                                    </div>
                                    {directoryFiles.length > 0 && (
                                        <div style={{ marginTop: 12, border: '1px solid #333', background: '#0a0a0a' }}>
                                            <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', padding: '10px 14px', borderBottom: '1px solid #333', background: '#111' }}>
                                                <span style={{ fontFamily: "'JetBrains Mono',monospace", fontSize: 12, color: '#ccff00', fontWeight: 700 }}>
                                                    <CheckSquare size={14} style={{ display: 'inline', marginRight: 6, verticalAlign: 'middle' }} />
                                                    {directoryFiles.length} FILE{directoryFiles.length !== 1 ? 'S' : ''} READY
                                                </span>
                                                <button onClick={() => setDirectoryFiles([])} style={{ background: 'none', border: '1px solid #555', color: '#888', fontSize: 10, fontFamily: "'JetBrains Mono',monospace", padding: '3px 8px', cursor: 'pointer', textTransform: 'uppercase' }}>
                                                    Clear All
                                                </button>
                                            </div>
                                            <div style={{ maxHeight: 240, overflowY: 'auto', padding: '4px 0' }}>
                                                {directoryFiles.map((f, idx) => (
                                                    <div key={idx} style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', padding: '6px 14px', borderBottom: idx < directoryFiles.length - 1 ? '1px solid #222' : 'none' }}>
                                                        <span style={{ fontFamily: "'JetBrains Mono',monospace", fontSize: 12, color: '#aaa', overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap', flex: 1, marginRight: 8 }}>
                                                            <FileCode size={12} style={{ display: 'inline', marginRight: 6, verticalAlign: 'middle', color: '#555' }} />
                                                            {f.webkitRelativePath || f.name}
                                                        </span>
                                                        <button onClick={() => removeDirectoryFile(idx)} style={{ background: 'none', border: 'none', color: '#555', cursor: 'pointer', padding: '2px 4px', display: 'flex', alignItems: 'center' }}
                                                            onMouseEnter={e => e.target.style.color = '#ff003c'}
                                                            onMouseLeave={e => e.target.style.color = '#555'}>
                                                            <X size={14} />
                                                        </button>
                                                    </div>
                                                ))}
                                            </div>
                                        </div>
                                    )}
                                </div>
                            )}

                            {inputType === 'github' && (
                                <div>
                                    <div style={{ background: '#ff00ff18', borderLeft: '4px solid #ff00ff', padding: 14, fontFamily: "'JetBrains Mono',monospace", color: '#ff00ff', fontSize: 13, marginBottom: 16 }}>
                                        <strong style={{ display: 'flex', alignItems: 'center', gap: 6 }}><Github size={14} /> PUBLIC REPOS & ISSUES</strong>
                                        <span style={{ color: '#aaa' }}>Paste a repo URL or an Issue URL (e.g. github.com/user/repo/issues/123). Issue details auto-fill the symptom.</span>
                                    </div>
                                    <div style={{ display: 'flex', gap: 8 }}>
                                        <div style={{ position: 'relative', flex: 1 }}>
                                            <Link size={14} style={{ position: 'absolute', left: 12, top: '50%', transform: 'translateY(-50%)', color: '#555' }} />
                                            <input
                                                type="text"
                                                style={{ ...S.input, paddingLeft: 34, fontFamily: "'JetBrains Mono',monospace", fontSize: 12 }}
                                                placeholder="https://github.com/user/repo  or  https://github.com/user/repo/issues/123"
                                                value={githubUrl}
                                                onChange={(e) => setGithubUrl(e.target.value)}
                                            />
                                        </div>
                                        {githubUrl.trim() && (
                                            <div style={{ display: 'flex', alignItems: 'center', gap: 6, padding: '8px 0' }}>
                                                <CheckSquare size={14} style={{ color: '#ccff00' }} />
                                                <span style={{ fontFamily: "'JetBrains Mono',monospace", fontSize: 11, color: '#888' }}>
                                                    Repo will be fetched when you click Analyze
                                                </span>
                                            </div>
                                        )}
                                    </div>
                                    {githubError && (
                                        <div style={{ background: '#ff003c18', border: '1px solid #ff003c44', padding: 10, color: '#fca5a5', fontSize: 12, marginTop: 10, fontFamily: "'JetBrains Mono',monospace" }}>
                                            ⚠️ {githubError}
                                        </div>
                                    )}
                                    {directoryFiles.length > 0 && (
                                        <div style={{ marginTop: 12, border: '1px solid #333', background: '#0a0a0a' }}>
                                            <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', padding: '10px 14px', borderBottom: '1px solid #333', background: '#111' }}>
                                                <span style={{ fontFamily: "'JetBrains Mono',monospace", fontSize: 12, color: '#ccff00', fontWeight: 700 }}>
                                                    <CheckSquare size={14} style={{ display: 'inline', marginRight: 6, verticalAlign: 'middle' }} />
                                                    {directoryFiles.length} FILE{directoryFiles.length !== 1 ? 'S' : ''} FETCHED
                                                </span>
                                                <button onClick={() => setDirectoryFiles([])} style={{ background: 'none', border: '1px solid #555', color: '#888', fontSize: 10, fontFamily: "'JetBrains Mono',monospace", padding: '3px 8px', cursor: 'pointer', textTransform: 'uppercase' }}>
                                                    Clear All
                                                </button>
                                            </div>
                                            <div style={{ maxHeight: 240, overflowY: 'auto', padding: '4px 0' }}>
                                                {directoryFiles.map((f, idx) => (
                                                    <div key={idx} style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', padding: '6px 14px', borderBottom: idx < directoryFiles.length - 1 ? '1px solid #222' : 'none' }}>
                                                        <span style={{ fontFamily: "'JetBrains Mono',monospace", fontSize: 12, color: '#aaa', overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap', flex: 1, marginRight: 8 }}>
                                                            <FileCode size={12} style={{ display: 'inline', marginRight: 6, verticalAlign: 'middle', color: '#555' }} />
                                                            {f.webkitRelativePath || f.name}
                                                        </span>
                                                        <button onClick={() => removeDirectoryFile(idx)} style={{ background: 'none', border: 'none', color: '#555', cursor: 'pointer', padding: '2px 4px', display: 'flex', alignItems: 'center' }}
                                                            onMouseEnter={e => e.target.style.color = '#ff003c'}
                                                            onMouseLeave={e => e.target.style.color = '#555'}>
                                                            <X size={14} />
                                                        </button>
                                                    </div>
                                                ))}
                                            </div>
                                        </div>
                                    )}
                                </div>
                            )}

                            {inputType === 'paste' && (
                                <div>
                                    {pastedFiles.map((file, idx) => (
                                        <div key={idx} style={{ border: '2px solid #333', background: '#050505', marginBottom: 12 }}>
                                            <input type="text" placeholder="filename.js" value={file.name}
                                                onChange={(e) => { const nf = [...pastedFiles]; nf[idx].name = e.target.value; setPastedFiles(nf); }}
                                                style={{ ...S.input, borderBottom: '2px solid #333', borderTop: 'none', borderLeft: 'none', borderRight: 'none', color: '#ccff00', fontFamily: "'JetBrains Mono',monospace", fontSize: 12 }}
                                            />
                                            <textarea placeholder="// Paste source code..." value={file.content}
                                                onChange={(e) => { const nf = [...pastedFiles]; nf[idx].content = e.target.value; setPastedFiles(nf); }}
                                                style={S.codeInput}
                                            />
                                        </div>
                                    ))}
                                    <button onClick={() => setPastedFiles([...pastedFiles, { name: '', content: '' }])}
                                        style={{ width: '100%', padding: 14, border: '2px dashed #555', background: 'transparent', color: '#888', fontFamily: "'JetBrains Mono',monospace", textTransform: 'uppercase', fontSize: 12, display: 'flex', justifyContent: 'center', alignItems: 'center', gap: 6, cursor: 'pointer' }}>
                                        <Plus size={14} /> Add File Block
                                    </button>
                                </div>
                            )}

                            {/* ═══ MODE + PRESET SELECTOR (Phase 4A) ═══ */}
                            <div style={{ borderTop: '2px solid #333', paddingTop: 20, marginTop: 20 }}>
                                <div style={{ ...S.label, color: '#ff00ff' }}><BrainCircuit size={14} /> Analysis Mode</div>
                                <div style={{ display: 'grid', gridTemplateColumns: 'repeat(3, 1fr)', gap: 10, marginBottom: 20 }}>
                                    {[
                                        { key: 'debug', label: 'Debug', icon: <Bug size={20} />, color: '#ff003c', desc: 'Find & fix bugs' },
                                        { key: 'explain', label: 'Explain', icon: <Eye size={20} />, color: '#00ffff', desc: 'Understand code' },
                                        { key: 'security', label: 'Security', icon: <Shield size={20} />, color: '#ffaa00', desc: 'Audit vulnerabilities', beta: true },
                                    ].map(m => (
                                        <button key={m.key} onClick={() => { setAnalysisMode(m.key); if (m.key !== 'debug') setPreset('full'); }}
                                            style={{
                                                padding: '16px 14px', border: '2px solid', position: 'relative',
                                                borderColor: analysisMode === m.key ? m.color : '#333',
                                                background: analysisMode === m.key ? m.color + '18' : 'transparent',
                                                color: analysisMode === m.key ? '#fff' : '#888',
                                                cursor: 'pointer', fontFamily: 'inherit', textAlign: 'center', transition: 'all 0.15s',
                                            }}>
                                            {m.beta && <span style={{ position: 'absolute', top: 4, right: 6, fontSize: 9, fontWeight: 800, color: m.color, fontFamily: "'JetBrains Mono',monospace", letterSpacing: 1 }}>BETA</span>}
                                            <div style={{ display: 'flex', justifyContent: 'center', marginBottom: 6, color: analysisMode === m.key ? m.color : '#555' }}>{m.icon}</div>
                                            <div style={{ fontWeight: 800, fontSize: 14, textTransform: 'uppercase', letterSpacing: 1 }}>{m.label}</div>
                                            <div style={{ fontSize: 11, opacity: 0.6, fontWeight: 400, marginTop: 4 }}>{m.desc}</div>
                                        </button>
                                    ))}
                                </div>

                                {/* Preset Selector — only for Debug mode */}
                                {analysisMode === 'debug' && (
                                    <div style={{ marginBottom: 16 }}>
                                        <div style={{ ...S.label, color: '#ccff00', marginBottom: 8 }}><Zap size={14} /> Output Preset</div>
                                        <div style={{ display: 'grid', gridTemplateColumns: 'repeat(4, 1fr)', gap: 8 }}>
                                            {Object.entries(PRESETS).map(([key, p]) => (
                                                <button key={key} onClick={() => { setPreset(key); if (key !== 'custom') setOutputSections(null); }}
                                                    style={{
                                                        padding: '10px 8px', border: '2px solid',
                                                        borderColor: preset === key ? '#ccff00' : '#333',
                                                        background: preset === key ? '#ccff0018' : 'transparent',
                                                        color: preset === key ? '#fff' : '#888',
                                                        cursor: 'pointer', fontFamily: "'JetBrains Mono',monospace", fontSize: 11, fontWeight: 700,
                                                        textTransform: 'uppercase', transition: 'all 0.15s', textAlign: 'center',
                                                    }}>
                                                    <div style={{ fontSize: 13, marginBottom: 2 }}>{p.label}</div>
                                                    <div style={{ fontSize: 9, opacity: 0.6, fontWeight: 400, textTransform: 'none' }}>{p.description}</div>
                                                </button>
                                            ))}
                                        </div>
                                    </div>
                                )}

                                {/* Section Toggles — only for Custom preset */}
                                {analysisMode === 'debug' && preset === 'custom' && (
                                    <div style={{ marginBottom: 16, background: '#0a0a0a', border: '1px solid #333', padding: 14 }}>
                                        <div style={{ ...S.label, color: '#888', fontSize: 10, marginBottom: 10 }}>Toggle Sections</div>
                                        <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fill, minmax(180px, 1fr))', gap: 6 }}>
                                            {Object.entries(SECTION_REGISTRY).filter(([, s]) => s.modes.includes('debug')).map(([key, sec]) => {
                                                const active = (outputSections || PRESETS.full.sections).includes(key);
                                                const costColor = sec.tokenCost === 'high' ? '#ff003c' : sec.tokenCost === 'medium' ? '#ffaa00' : '#888';
                                                return (
                                                    <button key={key} onClick={() => {
                                                        const current = outputSections || [...PRESETS.full.sections];
                                                        setOutputSections(active ? current.filter(s => s !== key) : [...current, key]);
                                                    }}
                                                        style={{
                                                            padding: '8px 10px', display: 'flex', alignItems: 'center', justifyContent: 'space-between',
                                                            border: '1px solid', borderColor: active ? '#ccff00' : '#333',
                                                            background: active ? '#ccff0010' : 'transparent',
                                                            color: active ? '#e0e0e0' : '#666',
                                                            cursor: 'pointer', fontFamily: "'JetBrains Mono',monospace", fontSize: 11, transition: 'all 0.1s',
                                                        }}>
                                                        <span>{sec.label}</span>
                                                        <span style={{ fontSize: 9, color: costColor, fontWeight: 700 }}>{sec.tokenCost.toUpperCase()}</span>
                                                    </button>
                                                );
                                            })}
                                        </div>
                                    </div>
                                )}
                            </div>

                            {/* Symptom / Intent field — mode-aware */}
                            <div style={{ borderTop: '2px solid #333', paddingTop: 20, marginTop: 8 }}>
                                <div style={{ ...S.label, color: '#ff003c' }}>
                                    <Activity size={14} />
                                    {analysisMode === 'debug' ? 'Define The Symptom' : analysisMode === 'explain' ? 'What To Explain' : 'Security Concerns'}
                                    <span style={{ color: '#666', fontWeight: 'normal', fontSize: 11 }}>(optional)</span>
                                </div>
                                <textarea style={S.codeInput} value={userError} onChange={(e) => setUserError(e.target.value)}
                                    placeholder={analysisMode === 'debug'
                                        ? "Describe the bug — what happens vs what you expected. Include stack traces if you have them..."
                                        : analysisMode === 'explain'
                                            ? "What do you want to understand about this code? Leave empty for full architecture overview."
                                            : "Any specific security concerns? Leave empty to scan for common vulnerabilities."
                                    } />
                            </div>

                            {analysisError && (
                                <div style={{ background: '#ff003c18', border: '1px solid #ff003c44', padding: 12, color: '#fca5a5', fontSize: 13, marginTop: 14, fontFamily: "'JetBrains Mono',monospace" }}>
                                    ⚠️ {analysisError}
                                </div>
                            )}

                            {/* Analyze button with runtime estimate */}
                            {(() => {
                                const fileCount = inputType === 'upload' ? directoryFiles.length : inputType === 'paste' ? pastedFiles.filter(f => f.content.trim()).length : 1;
                                const totalLines = inputType === 'paste' ? pastedFiles.reduce((sum, f) => sum + (f.content.match(/\n/g) || []).length, 0) : fileCount * 80;
                                const est = estimateRuntime(fileCount, totalLines, provider, preset);
                                return (
                                    <>
                                        <button style={{ ...S.btnPrimary, marginTop: 16, opacity: canExecute ? 1 : 0.4, display: 'flex', justifyContent: 'center', alignItems: 'center', gap: 10 }}
                                            disabled={!canExecute || isAnalyzing} onClick={() => executeAnalysis(false)}>
                                            {analysisMode === 'debug' ? 'Execute Engine' : analysisMode === 'explain' ? 'Explain Code' : 'Run Security Audit'}
                                            {' '}<Zap size={20} />
                                            {canExecute && <span style={{ fontWeight: 400, fontSize: 12, opacity: 0.7 }}>— est. {est.min}-{est.max}s</span>}
                                        </button>
                                        <p style={{ color: '#555', fontSize: 11, fontFamily: "'JetBrains Mono',monospace", marginTop: 8, textAlign: 'center' }}>
                                            {analysisMode.toUpperCase()} mode • {prov?.models[Object.keys(prov.models).find(k => prov.models[k].id === model)]?.label || model} • {PRESETS[preset]?.label || preset}
                                        </p>
                                    </>
                                );
                            })()}
                        </div>
                    </div>
                )}

                {/* ═══ STEP 3: Loading with Structured Progress ═══ */}
                {step === 3 && (
                    <div className="animate-in" style={{ paddingTop: 60, display: 'flex', flexDirection: 'column', alignItems: 'center', textAlign: 'center' }}>
                        <BrainCircuit size={64} color="#ff00ff" className="animate-pulse" style={{ marginBottom: 20 }} />
                        <h2 style={{ fontSize: 32, fontWeight: 800, textTransform: 'uppercase', color: '#fff', letterSpacing: 3, marginBottom: 6 }}>
                            {analysisMode === 'debug' ? 'ENGINE ACTIVE' : analysisMode === 'explain' ? 'EXPLAINING' : 'AUDITING'}
                        </h2>
                        <p style={{ fontFamily: "'JetBrains Mono',monospace", color: '#888', fontSize: 12, marginBottom: 24 }}>
                            {analysisMode.toUpperCase()} mode • {PRESETS[preset]?.label || preset}
                        </p>

                        {/* Structured Progress Bar */}
                        <div style={{ width: '100%', maxWidth: 540, border: '2px solid #333', background: '#111', padding: 20, textAlign: 'left' }}>
                            <div style={{ fontFamily: "'JetBrains Mono',monospace", fontSize: 11, fontWeight: 700, color: '#888', textTransform: 'uppercase', marginBottom: 12, letterSpacing: 1 }}>Pipeline Progress</div>
                            <div style={{ borderTop: '1px solid #333', paddingTop: 10 }}>
                                {['input', 'ast', 'engine', 'parse', 'complete'].map(stageId => {
                                    const stg = progressStages.find(s => s.stage === stageId);
                                    const labels = { input: 'Input Validation', ast: 'AST Pre-Analysis', engine: 'AI Engine', parse: 'Parse Response', complete: 'Complete' };
                                    const isActive = stg && !stg.complete;
                                    const isDone = stg && stg.complete;
                                    return (
                                        <div key={stageId} style={{ display: 'flex', alignItems: 'center', gap: 10, padding: '6px 0', fontFamily: "'JetBrains Mono',monospace", fontSize: 12 }}>
                                            <span style={{ width: 20, textAlign: 'center', fontSize: 14 }}>
                                                {isDone ? '✅' : isActive ? <Loader2 size={14} className="animate-spin" style={{ color: '#ccff00' }} /> : '⬚'}
                                            </span>
                                            <span style={{ flex: 1, color: isDone ? '#aaa' : isActive ? '#fff' : '#555' }}>
                                                {labels[stageId] || stageId}
                                            </span>
                                            {stg && <span style={{ color: '#555', fontSize: 10 }}>{stg.elapsed}s</span>}
                                        </div>
                                    );
                                })}
                            </div>
                            {/* Current text status */}
                            <div style={{ borderTop: '1px solid #333', marginTop: 10, paddingTop: 10 }}>
                                <p style={{ fontFamily: "'JetBrains Mono',monospace", color: '#00ffff', fontSize: 12, display: 'flex', alignItems: 'center', gap: 8, margin: 0 }}>
                                    <Loader2 size={14} className="animate-spin" /> {loadingStage || 'Initializing...'}
                                </p>
                            </div>
                        </div>
                    </div>
                )}

                {/* ═══ STEP 3.5: Missing Files ═══ */}
                {step === 3.5 && missingFileRequest && (
                    <div className="animate-slide-up" style={{ maxWidth: 1100, margin: '0 auto', paddingTop: 28 }}>
                        <div style={{ background: '#ffaa00', color: '#000', padding: 28, border: '2px solid #000' }} className="brutal-shadow-white">
                            <div style={{ display: 'flex', alignItems: 'flex-start', gap: 14, marginBottom: 20, paddingBottom: 16, borderBottom: '2px solid rgba(0,0,0,0.2)' }}>
                                <PauseCircle size={40} />
                                <div>
                                    <h2 style={{ fontSize: 32, fontWeight: 800, textTransform: 'uppercase', margin: 0 }}>Analysis Paused</h2>
                                    <p style={{ fontFamily: "'JetBrains Mono',monospace", fontWeight: 700 }}>Engine needs more context to avoid hallucinating.</p>
                                </div>
                            </div>
                            <p style={{ fontSize: 16, marginBottom: 16 }}><strong>Reason:</strong> {missingFileRequest.reason}</p>
                            {additionalFiles.map((file, idx) => (
                                <div key={idx} style={{ background: 'rgba(0,0,0,0.1)', border: '2px solid #000', padding: 14, marginBottom: 10 }}>
                                    <label style={{ fontFamily: "'JetBrains Mono',monospace", fontWeight: 700, marginBottom: 6, display: 'block' }}>{file.name}</label>
                                    <textarea placeholder="Paste contents here..." value={file.content}
                                        onChange={(e) => { const nf = [...additionalFiles]; nf[idx].content = e.target.value; setAdditionalFiles(nf); }}
                                        style={{ width: '100%', minHeight: 100, background: '#000', color: '#ccff00', fontFamily: "'JetBrains Mono',monospace", padding: 12, border: 'none', boxSizing: 'border-box', resize: 'vertical' }}
                                    />
                                </div>
                            ))}
                            <button style={{ ...S.btnPrimary, background: '#000', color: '#ffaa00', marginTop: 10 }}
                                disabled={additionalFiles.some(f => !f.content.trim())} onClick={() => executeAnalysis(true)}>
                                Resume Engine →
                            </button>
                        </div>
                    </div>
                )}

                {/* ═══ STEP 5: The Report (renders immediately — no Output Menu) ═══ */}
                {step === 5 && report && (
                    <ReportErrorBoundary rawResult={report}>
                        <div className="animate-slide-up" style={{ paddingBottom: 80 }}>
                            {/* Sticky header — mode-aware */}
                            <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'flex-end', borderBottom: '4px solid #fff', paddingBottom: 14, marginBottom: 28, position: 'sticky', top: 72, background: '#050505f2', backdropFilter: 'blur(8px)', zIndex: 15, paddingTop: 12, gap: 12, flexWrap: 'wrap' }}>
                                <div>
                                    <div style={{ display: 'flex', gap: 8, marginBottom: 6, flexWrap: 'wrap' }}>
                                        <span style={{ fontFamily: "'JetBrains Mono',monospace", fontSize: 11, background: analysisMode === 'debug' ? (bugMeta?.color || '#888') : analysisMode === 'explain' ? '#00ffff' : '#ffaa00', color: analysisMode === 'explain' ? '#000' : '#fff', padding: '3px 10px', textTransform: 'uppercase', fontWeight: 700 }}>
                                            {analysisMode === 'debug' ? (bugMeta?.label || report.bugType || 'DEBUG') : analysisMode === 'explain' ? 'EXPLAIN' : 'SECURITY AUDIT'}
                                        </span>
                                        {report.confidence != null && (
                                            <span style={{ fontFamily: "'JetBrains Mono',monospace", fontSize: 11, background: '#222', color: '#ccff00', border: '1px solid #ccff00', padding: '3px 10px', textTransform: 'uppercase' }}>CFD: {displayConfidence(report.confidence)}%</span>
                                        )}
                                    </div>
                                    <h2 style={{ fontSize: 32, fontWeight: 800, color: '#fff', textTransform: 'uppercase', margin: 0 }}>
                                        {analysisMode === 'debug' ? 'Diagnosis' : analysisMode === 'explain' ? 'Code Explanation' : 'Security Report'}
                                    </h2>
                                </div>
                                <button style={S.btnOutline} onClick={reset}>← New Analysis</button>
                            </div>

                            {/* ── Explain Mode Report ── */}
                            {analysisMode === 'explain' && (
                                <div>
                                    {report.summary && (
                                        <SectionBlock icon={<BookOpen size={14} />} title="Summary" color="#00ffff" copyText={report.summary} copyId="expl-sum" copiedId={copiedSection} onCopy={handleCopy}>
                                            <p style={{ fontSize: 18, color: '#e0e0e0', lineHeight: 1.8 }}>{report.summary}</p>
                                        </SectionBlock>
                                    )}
                                    {report.entryPoints?.length > 0 && (
                                        <SectionBlock icon={<Zap size={14} />} title="Entry Points" color="#ff00ff" copyId="expl-entry" copiedId={copiedSection} onCopy={handleCopy}>
                                            {report.entryPoints.map((ep, i) => (
                                                <div key={i} style={{ background: '#050505', border: '1px solid #333', padding: 14, marginBottom: 8 }}>
                                                    <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: 6 }}>
                                                        <h4 style={{ fontFamily: "'JetBrains Mono',monospace", fontSize: 13, color: '#ff00ff', margin: 0 }}>{ep.name}</h4>
                                                        <span style={{ fontSize: 11, color: '#aaa', border: '1px solid #555', padding: '2px 6px', fontFamily: "'JetBrains Mono',monospace" }}>{ep.type}</span>
                                                    </div>
                                                    <p style={{ color: '#d0d0d0', fontSize: 15, lineHeight: 1.7, marginBottom: 6 }}>{ep.description}</p>
                                                    {ep.file && <div style={{ fontFamily: "'JetBrains Mono',monospace", fontSize: 12, color: '#777' }}>📍 {ep.file}{ep.line ? `:${ep.line}` : ''}</div>}
                                                </div>
                                            ))}
                                        </SectionBlock>
                                    )}
                                    {/* Architecture Layers */}
                                    {report.architectureLayers?.length > 0 && (
                                        <SectionBlock icon={<Layers size={14} />} title="Architecture Layers" color="#ccff00" copyId="expl-layers" copiedId={copiedSection} onCopy={handleCopy}>
                                            <p style={{ color: '#aaa', fontSize: 13, marginBottom: 16, fontFamily: "'JetBrains Mono',monospace" }}>High-level semantic grouping of the system</p>
                                            <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(280px, 1fr))', gap: 16 }}>
                                                {report.architectureLayers.map((layer, i) => (
                                                    <div key={i} style={{ background: '#111', border: '1px solid #333', borderTop: `4px solid ${['#00ffff', '#ffaa00', '#ff00ff', '#ccff00', '#22c55e'][i % 5]}`, padding: 16, display: 'flex', flexDirection: 'column' }}>
                                                        <h4 style={{ fontFamily: "'JetBrains Mono',monospace", fontSize: 16, color: '#fff', margin: '0 0 8px' }}>Layer {i + 1} — {layer.name}</h4>
                                                        <p style={{ color: '#aaa', fontSize: 14, lineHeight: 1.6, marginBottom: 16, flexGrow: 1 }}>{layer.description}</p>
                                                        {layer.components?.length > 0 && (
                                                            <div style={{ background: '#050505', padding: 12, border: '1px solid #222' }}>
                                                                {layer.components.map((comp, j) => (
                                                                    <div key={j} style={{ color: '#d0d0d0', fontSize: 14, fontFamily: "'JetBrains Mono',monospace", padding: '4px 0', borderBottom: j < layer.components.length - 1 ? '1px solid #222' : 'none' }}>
                                                                        <span style={{ color: '#777', marginRight: 8 }}>•</span>{comp}
                                                                    </div>
                                                                ))}
                                                            </div>
                                                        )}
                                                    </div>
                                                ))}
                                            </div>
                                        </SectionBlock>
                                    )}
                                    {/* Data Flow + Mermaid Chart */}
                                    {report.dataFlow?.length > 0 && (
                                        <SectionBlock icon={<GitMerge size={14} />} title="Data Flow" color="#ffaa00" copyId="expl-flow" copiedId={copiedSection} onCopy={handleCopy}>
                                            <MermaidChart
                                                chart={buildDataFlowMermaid(report.flowchartEdges || [])}
                                                caption="How data moves through the system"
                                            />
                                            <div style={{ overflowX: 'auto', marginTop: 12 }}>
                                                <table style={{ width: '100%', textAlign: 'left', fontFamily: "'JetBrains Mono',monospace", fontSize: 13, borderCollapse: 'collapse' }}>
                                                    <thead>
                                                        <tr style={{ background: '#222', color: '#ffaa00', borderBottom: '2px solid #ffaa00' }}>
                                                            <th style={{ padding: 10, width: '25%' }}>From</th>
                                                            <th style={{ padding: 10, width: '45%' }}>Mechanism</th>
                                                            <th style={{ padding: 10, width: '25%' }}>To</th>
                                                            <th style={{ padding: 10, width: '5%' }}>Line</th>
                                                        </tr>
                                                    </thead>
                                                    <tbody>
                                                        {report.dataFlow.map((flow, i) => (
                                                            <tr key={i} style={{ borderBottom: '1px solid #333' }}>
                                                                <td style={{ padding: 10, color: '#e0e0e0' }}>{flow.from}</td>
                                                                <td style={{ padding: 10, color: '#ccc', fontStyle: 'italic' }}>→ {flow.mechanism} →</td>
                                                                <td style={{ padding: 10, color: '#e0e0e0' }}>{flow.to}</td>
                                                                <td style={{ padding: 10, color: '#aaa' }}>{flow.line ? `L${flow.line}` : '—'}</td>
                                                            </tr>
                                                        ))}
                                                    </tbody>
                                                </table>
                                            </div>
                                        </SectionBlock>
                                    )}
                                    {/* Component & Dependency Map + Mermaid Chart */}
                                    {report.componentMap?.length > 0 && (
                                        <SectionBlock icon={<FolderTree size={14} />} title="Component & Dependency Map" color="#ccff00" copyId="expl-comp" copiedId={copiedSection} onCopy={handleCopy}>
                                            <MermaidChart
                                                chart={buildDependencyMermaid(report.dependencyEdges || [])}
                                                caption="File-level import dependencies — explicit imports only"
                                            />
                                            {report.componentMap.map((comp, i) => (
                                                <div key={i} style={{ background: '#111', borderLeft: '3px solid #ccff00', padding: 12, marginBottom: 10, marginTop: 10 }}>
                                                    <h4 style={{ fontFamily: "'JetBrains Mono',monospace", fontSize: 15, color: '#ccff00', margin: '0 0 8px' }}>{comp.name}</h4>
                                                    {comp.children?.length > 0 && (
                                                        <div style={{ marginBottom: 6 }}>
                                                            <span style={{ color: '#aaa', fontSize: 12, textTransform: 'uppercase', marginRight: 8 }}>Dependencies:</span>
                                                            <span style={{ color: '#e0e0e0', fontSize: 14 }}>{comp.children.join(', ')}</span>
                                                        </div>
                                                    )}
                                                    {comp.stateOwned?.length > 0 && (
                                                        <div>
                                                            <span style={{ color: '#aaa', fontSize: 12, textTransform: 'uppercase', marginRight: 8 }}>State:</span>
                                                            <span style={{ color: '#ffaa00', fontFamily: "'JetBrains Mono',monospace", fontSize: 13 }}>{comp.stateOwned.join(', ')}</span>
                                                        </div>
                                                    )}
                                                </div>
                                            ))}
                                        </SectionBlock>
                                    )}
                                    {/* Key Patterns */}
                                    {report.keyPatterns?.length > 0 && (
                                        <SectionBlock icon={<Lightbulb size={14} />} title="Key Patterns" color="#22c55e" copyId="expl-pattern" copiedId={copiedSection} onCopy={handleCopy}>
                                            <ul style={{ listStyleType: 'square', paddingLeft: 20, color: '#e0e0e0', fontSize: 15, lineHeight: 1.9 }}>
                                                {report.keyPatterns.map((p, i) => <li key={i}>{p}</li>)}
                                            </ul>
                                        </SectionBlock>
                                    )}
                                    {/* Non-Obvious Insights */}
                                    {report.nonObviousInsights?.length > 0 && (
                                        <SectionBlock icon={<Eye size={14} />} title="Non-Obvious Insights" color="#ff00ff" copyId="expl-insights" copiedId={copiedSection} onCopy={handleCopy}>
                                            <p style={{ color: '#aaa', fontSize: 12, marginBottom: 10, textTransform: 'uppercase', fontFamily: "'JetBrains Mono',monospace" }}>Things that would surprise a developer reading this for the first time</p>
                                            <ul style={{ listStyleType: 'none', padding: 0 }}>
                                                {report.nonObviousInsights.map((insight, i) => (
                                                    <li key={i} style={{ color: '#e0e0e0', fontSize: 15, lineHeight: 1.8, padding: '10px 0', borderBottom: '1px solid #222' }}>💡 {insight}</li>
                                                ))}
                                            </ul>
                                        </SectionBlock>
                                    )}
                                    {/* Gotchas */}
                                    {report.gotchas?.length > 0 && (
                                        <SectionBlock icon={<AlertTriangle size={14} />} title="Gotchas" color="#ff003c" copyId="expl-gotchas" copiedId={copiedSection} onCopy={handleCopy}>
                                            <p style={{ color: '#aaa', fontSize: 12, marginBottom: 10, textTransform: 'uppercase', fontFamily: "'JetBrains Mono',monospace" }}>Hidden landmines — things that break when changed</p>
                                            {report.gotchas.map((g, i) => (
                                                <div key={i} style={{ background: '#ff003c08', borderLeft: '3px solid #ff003c', padding: 14, marginBottom: 10 }}>
                                                    <div style={{ fontFamily: "'JetBrains Mono',monospace", fontSize: 14, color: '#ff003c', fontWeight: 700, marginBottom: 6 }}>⚠️ {g.title}</div>
                                                    <p style={{ color: '#ddd', fontSize: 14, lineHeight: 1.7, marginBottom: 6 }}>{g.description}</p>
                                                    {g.location && <code style={{ fontFamily: "'JetBrains Mono',monospace", fontSize: 12, color: '#777' }}>📍 {g.location}</code>}
                                                </div>
                                            ))}
                                        </SectionBlock>
                                    )}
                                    {/* Onboarding Guide */}
                                    {report.onboarding?.length > 0 && (
                                        <SectionBlock icon={<User size={14} />} title="Onboarding Guide" color="#00ffff" copyId="expl-onboard" copiedId={copiedSection} onCopy={handleCopy}>
                                            <p style={{ color: '#aaa', fontSize: 12, marginBottom: 10, textTransform: 'uppercase', fontFamily: "'JetBrains Mono',monospace" }}>Exactly where to go for the most common tasks</p>
                                            {report.onboarding.map((item, i) => (
                                                <div key={i} style={{ background: '#050505', border: '1px solid #333', padding: 16, marginBottom: 10 }}>
                                                    <div style={{ fontFamily: "'JetBrains Mono',monospace", fontSize: 14, color: '#00ffff', fontWeight: 700, marginBottom: 6 }}>🎯 {item.task}</div>
                                                    <div style={{ color: '#ddd', fontSize: 14, marginBottom: 4 }}><strong style={{ color: '#aaa' }}>Where:</strong> <code style={{ color: '#ccff00' }}>{item.whereToLook}</code></div>
                                                    <div style={{ color: '#ddd', fontSize: 14 }}><strong style={{ color: '#aaa' }}>Model after:</strong> {item.patternToFollow}</div>
                                                </div>
                                            ))}
                                        </SectionBlock>
                                    )}
                                    {/* Architecture Decisions */}
                                    {report.architectureDecisions?.length > 0 && (
                                        <SectionBlock icon={<Network size={14} />} title="Architecture Decisions" color="#ffaa00" copyId="expl-arch" copiedId={copiedSection} onCopy={handleCopy}>
                                            {report.architectureDecisions.map((d, i) => (
                                                <div key={i} style={{ background: '#111', borderLeft: '3px solid #ffaa00', padding: 12, marginBottom: 10 }}>
                                                    <div style={{ fontFamily: "'JetBrains Mono',monospace", fontSize: 15, color: '#fff', fontWeight: 700, marginBottom: 6 }}>{d.decision}</div>
                                                    {d.visibleReason && <div style={{ color: '#ddd', fontSize: 14, marginBottom: 4 }}><strong style={{ color: '#aaa' }}>Why (visible in code):</strong> {d.visibleReason}</div>}
                                                    {d.tradeoff && <div style={{ color: '#ffaa00', fontSize: 14 }}><strong style={{ color: '#aaa' }}>Tradeoff:</strong> {d.tradeoff}</div>}
                                                </div>
                                            ))}
                                        </SectionBlock>
                                    )}
                                </div>
                            )}

                            {/* ── Security Mode Report ── */}
                            {analysisMode === 'security' && (
                                <div>
                                    {report.overallRisk && (
                                        <div style={{ background: '#111', border: '2px solid #ffaa00', borderLeftWidth: 8, padding: 20, marginBottom: 14 }}>
                                            <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
                                                <h3 style={{ fontFamily: "'JetBrains Mono',monospace", fontWeight: 800, textTransform: 'uppercase', color: '#ffaa00', fontSize: 14, display: 'flex', alignItems: 'center', gap: 8, margin: 0 }}>
                                                    <ShieldAlert size={16} /> Overall Risk: {report.overallRisk}
                                                </h3>
                                                <span style={{ background: '#ff003c22', color: '#ff003c', fontFamily: "'JetBrains Mono',monospace", fontSize: 11, padding: '4px 10px', fontWeight: 700 }}>
                                                    REQUIRES HUMAN VERIFICATION
                                                </span>
                                            </div>
                                        </div>
                                    )}
                                    {report.summary && (
                                        <SectionBlock icon={<Shield size={14} />} title="Security Summary" color="#ffaa00" copyText={report.summary} copyId="sec-sum" copiedId={copiedSection} onCopy={handleCopy}>
                                            <p style={{ fontSize: 15, color: '#e0e0e0', lineHeight: 1.7 }}>{report.summary}</p>
                                        </SectionBlock>
                                    )}
                                    {report.vulnerabilities?.length > 0 && (
                                        <SectionBlock icon={<AlertTriangle size={14} />} title={`Vulnerabilities (${report.vulnerabilities.length})`} color="#ff003c" copyId="sec-vuln" copiedId={copiedSection} onCopy={handleCopy}>
                                            {report.vulnerabilities.map((v, i) => (
                                                <div key={i} style={{ background: '#050505', border: '1px solid #333', borderLeftWidth: 4, borderLeftColor: v.severity === 'critical' ? '#ff003c' : v.severity === 'high' ? '#ffaa00' : '#888', padding: 14, marginBottom: 8 }}>
                                                    <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: 8 }}>
                                                        <h4 style={{ fontFamily: "'JetBrains Mono',monospace", fontSize: 13, color: '#fff', margin: 0 }}>{v.type || v.title}</h4>
                                                        <span style={{
                                                            fontFamily: "'JetBrains Mono',monospace", fontSize: 10, padding: '2px 8px', fontWeight: 700, textTransform: 'uppercase',
                                                            background: v.severity === 'critical' ? '#ff003c33' : v.severity === 'high' ? '#ffaa0033' : '#88888833',
                                                            color: v.severity === 'critical' ? '#ff003c' : v.severity === 'high' ? '#ffaa00' : '#888',
                                                        }}>{v.severity}</span>
                                                    </div>
                                                    <p style={{ color: '#aaa', fontSize: 13, lineHeight: 1.6, marginBottom: 6 }}>{v.description}</p>
                                                    {v.location && <p style={{ fontFamily: "'JetBrains Mono',monospace", fontSize: 11, color: '#555' }}>📍 {v.location}</p>}
                                                    {v.remediation && <p style={{ color: '#22c55e', fontSize: 12, fontFamily: "'JetBrains Mono',monospace", marginTop: 6 }}>✅ Fix: {v.remediation}</p>}
                                                </div>
                                            ))}
                                        </SectionBlock>
                                    )}
                                    {/* Attack Vector Mermaid Flowchart */}
                                    {report.attackVectorEdges?.length > 0 && (
                                        <SectionBlock icon={<Network size={14} />} title="Attack Vector Flowchart" color="#ff003c" copyId="sec-attack" copiedId={copiedSection} onCopy={handleCopy}
                                            copyText={report.attackVectorEdges.map(e => `${e.from} → ${e.to}: ${e.label}`).join('\n')}>
                                            <p style={{ color: '#aaa', fontSize: 12, marginBottom: 10, textTransform: 'uppercase', fontFamily: "'JetBrains Mono',monospace" }}>How an attacker could exploit the identified vulnerabilities — red nodes mark the critical exploitation point</p>
                                            <MermaidChart
                                                chart={buildAttackVectorMermaid(report.attackVectorEdges)}
                                                caption="Attack vector chain — red = exploitation point, orange = attacker progression"
                                            />
                                        </SectionBlock>
                                    )}
                                    {report.positives?.length > 0 && (
                                        <SectionBlock icon={<CheckSquare size={14} />} title="Security Positives" color="#22c55e" copyId="sec-pos" copiedId={copiedSection} onCopy={handleCopy}>
                                            <ul style={{ listStylePosition: 'inside', color: '#ccc', fontFamily: "'JetBrains Mono',monospace", fontSize: 13, lineHeight: 2 }}>
                                                {report.positives.map((p, i) => <li key={i}>{p}</li>)}
                                            </ul>
                                        </SectionBlock>
                                    )}
                                </div>
                            )}

                            {/* ── Debug Mode Report (existing views, now shown as "all") ── */}
                            {analysisMode === 'debug' && (
                                <>
                                    {report.symptom && (
                                        <SectionBlock icon={<AlertOctagon size={14} />} title="Observed Symptom" color="#ff003c" copyText={`Symptom: ${report.symptom}\nReproduction:\n${(report.reproduction || []).join('\n')}`} copyId="symp" copiedId={copiedSection} onCopy={handleCopy}>
                                            <p style={{ fontSize: 20, color: '#fff', fontWeight: 700, lineHeight: 1.5, marginBottom: 16 }}>{report.symptom}</p>
                                            {report.reproduction?.length > 0 && (
                                                <div style={{ background: '#050505', padding: 14, border: '1px solid #333' }}>
                                                    <h4 style={{ fontFamily: "'JetBrains Mono',monospace", fontSize: 12, color: '#888', textTransform: 'uppercase', marginBottom: 8 }}>Reproduction Path</h4>
                                                    <ol style={{ listStylePosition: 'inside', color: '#ccc', fontFamily: "'JetBrains Mono',monospace", fontSize: 13, lineHeight: 1.8 }}>
                                                        {report.reproduction.map((s, i) => <li key={i}>{s}</li>)}
                                                    </ol>
                                                </div>
                                            )}
                                        </SectionBlock>
                                    )}

                                    {/* Evidence */}
                                    {report.evidence?.length > 0 && (
                                        <SectionBlock icon={<CheckSquare size={14} />} title="Confidence Evidence" color="#22c55e" copyId="evi" copiedId={copiedSection} onCopy={handleCopy}
                                            copyText={(report.evidence || []).join('\n')}>
                                            <div style={{ marginBottom: 10 }}>
                                                <span style={{ fontFamily: "'JetBrains Mono',monospace", fontSize: 12, color: '#22c55e', fontWeight: 700 }}>VERIFIED:</span>
                                                <ul style={{ listStyleType: 'disc', paddingLeft: 20, color: '#ccc', fontFamily: "'JetBrains Mono',monospace", fontSize: 13, lineHeight: 1.8 }}>
                                                    {report.evidence.map((e, i) => <li key={i}>{e}</li>)}
                                                </ul>
                                            </div>
                                            {report.uncertainties?.length > 0 && (
                                                <div>
                                                    <span style={{ fontFamily: "'JetBrains Mono',monospace", fontSize: 12, color: '#ffaa00', fontWeight: 700 }}>UNCERTAIN:</span>
                                                    <ul style={{ listStyleType: 'disc', paddingLeft: 20, color: '#888', fontFamily: "'JetBrains Mono',monospace", fontSize: 13, lineHeight: 1.8 }}>
                                                        {report.uncertainties.map((u, i) => <li key={i}>{u}</li>)}
                                                    </ul>
                                                </div>
                                            )}
                                        </SectionBlock>
                                    )}

                                    {/* Concept Extraction */}
                                    {report.conceptExtraction && (
                                        <SectionBlock icon={<BookOpen size={14} />} title="Concept To Learn" color="#00ffff" copyId="concept" copiedId={copiedSection} onCopy={handleCopy}
                                            copyText={`Concept: ${report.conceptExtraction.concept}\nWhy: ${report.conceptExtraction.whyItMatters}\nPattern: ${report.conceptExtraction.patternToAvoid}`}>
                                            <div style={{ marginBottom: 12 }}>
                                                <span style={{ fontFamily: "'JetBrains Mono',monospace", fontSize: 11, background: bugMeta?.color + '22' || '#333', color: bugMeta?.color || '#aaa', padding: '2px 8px', fontWeight: 700, textTransform: 'uppercase' }}>{report.conceptExtraction.bugCategory}</span>
                                            </div>
                                            <h4 style={{ fontSize: 18, color: '#fff', fontWeight: 700, marginBottom: 8 }}>{report.conceptExtraction.concept}</h4>
                                            <p style={{ color: '#ccc', lineHeight: 1.7, marginBottom: 10 }}>{report.conceptExtraction.whyItMatters}</p>
                                            <div style={{ background: '#ccff0018', borderLeft: '3px solid #ccff00', padding: 12, marginBottom: 10 }}>
                                                <span style={{ color: '#ccff00', fontWeight: 700, fontSize: 12, fontFamily: "'JetBrains Mono',monospace" }}>PATTERN TO AVOID:</span>
                                                <p style={{ color: '#ddd', marginTop: 4 }}>{report.conceptExtraction.patternToAvoid}</p>
                                            </div>
                                            {report.conceptExtraction.realWorldAnalogy && (
                                                <p style={{ color: '#aaa', fontStyle: 'italic', lineHeight: 1.7 }}>💡 {report.conceptExtraction.realWorldAnalogy}</p>
                                            )}
                                        </SectionBlock>
                                    )}

                                    {/* Metaphor / Analogy */}
                                    {report.conceptExtraction?.realWorldAnalogy && (
                                        <SectionBlock icon={<Lightbulb size={14} />} title="Real World Analogy" color="#ccff00" copyId="analogy" copiedId={copiedSection} onCopy={handleCopy}
                                            copyText={report.conceptExtraction.realWorldAnalogy}>
                                            <p style={{ fontSize: 18, color: '#e0e0e0', lineHeight: 1.7, fontStyle: 'italic' }}>
                                                "{report.conceptExtraction.realWorldAnalogy}"
                                            </p>
                                        </SectionBlock>
                                    )}

                                    {/* Why AI Looped */}
                                    {report.whyAILooped && (
                                        <SectionBlock icon={<RefreshCw size={14} />} title="Why AI Keeps Breaking It" color="#ff00ff" copyId="ailoop" copiedId={copiedSection} onCopy={handleCopy}
                                            copyText={`Pattern: ${report.whyAILooped.pattern}\n\n${report.whyAILooped.explanation}\n\nLoop:\n${(report.whyAILooped.loopSteps || []).join('\n')}`}>
                                            <p style={{ color: '#e0e0e0', lineHeight: 1.7, marginBottom: 14 }}>{report.whyAILooped.explanation}</p>
                                            {report.whyAILooped.loopSteps?.length > 0 && (
                                                <div style={{ background: '#ff00ff11', border: '1px solid #ff00ff33', padding: 14 }}>
                                                    <h4 style={{ fontFamily: "'JetBrains Mono',monospace", fontSize: 11, color: '#ff00ff', textTransform: 'uppercase', marginBottom: 8 }}>The AI Fix Loop</h4>
                                                    {report.whyAILooped.loopSteps.map((s, i) => (
                                                        <div key={i} style={{ color: '#ccc', fontFamily: "'JetBrains Mono',monospace", fontSize: 12, padding: '4px 0', borderBottom: i < report.whyAILooped.loopSteps.length - 1 ? '1px solid #333' : 'none' }}>
                                                            {i + 1}. {s}
                                                        </div>
                                                    ))}
                                                </div>
                                            )}
                                        </SectionBlock>
                                    )}
                                    {/* AI Loop Chart */}
                                    {report.aiLoopEdges?.length > 0 && (
                                        <MermaidChart
                                            chart={buildAILoopMermaid(report.aiLoopEdges)}
                                            caption="The fix loop AI tools fall into — green path is how Unravel escapes it"
                                        />
                                    )}

                                    {/* --- TECH VIEW --- */}
                                    {report.variableState?.length > 0 && (
                                        <SectionBlock icon={<Database size={14} />} title="State Mutation Tracker" color="#00ffff" borderSide="top"
                                            copyText={JSON.stringify(report.variableState, null, 2)} copyId="state" copiedId={copiedSection} onCopy={handleCopy}>
                                            <div style={{ overflowX: 'auto' }}>
                                                <table style={{ width: '100%', textAlign: 'left', fontFamily: "'JetBrains Mono',monospace", fontSize: 13, borderCollapse: 'collapse' }}>
                                                    <thead>
                                                        <tr style={{ background: '#222', color: '#00ffff', borderBottom: '2px solid #00ffff' }}>
                                                            <th style={{ padding: 12, borderRight: '1px solid #444', width: '25%' }}>Variable</th>
                                                            <th style={{ padding: 12, borderRight: '1px solid #444', width: '45%' }}>Meaning / Role</th>
                                                            <th style={{ padding: 12, width: '30%' }}>Where Mutated</th>
                                                        </tr>
                                                    </thead>
                                                    <tbody>
                                                        {report.variableState.map((st, i) => (
                                                            <tr key={i} style={{ borderBottom: '1px solid #333' }}>
                                                                <td style={{ padding: 12, borderRight: '1px solid #444', color: '#ccff00', fontWeight: 700 }}>{st.variable}</td>
                                                                <td style={{ padding: 12, borderRight: '1px solid #444', color: '#ccc' }}>{st.meaning}</td>
                                                                <td style={{ padding: 12, color: '#ffaa00' }}>{st.whereChanged}</td>
                                                            </tr>
                                                        ))}
                                                    </tbody>
                                                </table>
                                            </div>
                                        </SectionBlock>
                                    )}
                                    {/* Variable State Chart */}
                                    {(() => {
                                        const charts = buildVariableMermaid(report.variableStateEdges);
                                        if (!charts || charts.length === 0) return null;
                                        return charts.map(({ variable, mermaid }) => (
                                            <MermaidChart
                                                key={variable}
                                                chart={mermaid}
                                                caption={`Mutation flow for ${variable}`}
                                            />
                                        ));
                                    })()}

                                    {report.timeline?.length > 0 && (
                                        <SectionBlock icon={<Clock size={14} />} title="Execution Timeline" color="#ccff00"
                                            copyText={report.timeline.map(t => `${t.time}: ${t.event}`).join('\n')} copyId="timeline" copiedId={copiedSection} onCopy={handleCopy}>
                                            <div style={{ position: 'relative', paddingLeft: 40 }}>
                                                <div style={{ position: 'absolute', left: 16, top: 0, bottom: 0, width: 2, background: 'linear-gradient(to bottom, #ccff00, #ff00ff)' }} />
                                                {report.timeline.map((item, i) => (
                                                    <div key={i} style={{ position: 'relative', marginBottom: 16, paddingLeft: 20 }}>
                                                        <div style={{ position: 'absolute', left: -30, top: 4, width: 28, height: 28, borderRadius: '50%', border: '3px solid #111', background: '#222', color: '#ccff00', fontFamily: "'JetBrains Mono',monospace", fontSize: 10, fontWeight: 700, display: 'flex', alignItems: 'center', justifyContent: 'center' }}>
                                                            {item.time}
                                                        </div>
                                                        <div style={{ background: '#222', padding: 12, border: '1px solid #444' }}>
                                                            <p style={{ fontFamily: "'JetBrains Mono',monospace", fontSize: 13, color: '#fff' }}>{item.event}</p>
                                                        </div>
                                                    </div>
                                                ))}
                                            </div>
                                        </SectionBlock>
                                    )}
                                    {/* Timeline Chart */}
                                    {report.timelineEdges?.length > 0 && (
                                        <MermaidChart
                                            chart={buildTimelineMermaid(report.timelineEdges)}
                                            caption="Execution sequence — 🐛 marks where the bug manifests"
                                        />
                                    )}

                                    {report.invariants?.length > 0 && (
                                        <SectionBlock icon={<ShieldAlert size={14} />} title="Invariant Violations" color="#ff003c"
                                            copyText={report.invariants.join('\n')} copyId="inv" copiedId={copiedSection} onCopy={handleCopy}>
                                            <ul style={{ listStyleType: 'disc', paddingLeft: 20, color: '#ccc', fontFamily: "'JetBrains Mono',monospace", fontSize: 13, lineHeight: 1.8 }}>
                                                {report.invariants.map((inv, i) => <li key={i}>{inv}</li>)}
                                            </ul>
                                        </SectionBlock>
                                    )}

                                    {report.rootCause && (
                                        <SectionBlock icon={<GitMerge size={14} />} title="Technical Root Cause" color="#fff"
                                            copyText={report.rootCause} copyId="root" copiedId={copiedSection} onCopy={handleCopy}>
                                            <p style={{ color: '#e0e0e0', lineHeight: 1.7, marginBottom: 12 }}>{report.rootCause}</p>
                                            <div style={{ background: '#050505', padding: 10, border: '1px solid #333', fontFamily: "'JetBrains Mono',monospace", color: '#00ffff', fontSize: 13 }}>
                                                Location: {report.codeLocation}
                                            </div>
                                        </SectionBlock>
                                    )}

                                    {report.hypotheses?.length > 0 && (
                                        <SectionBlock icon={<BrainCircuit size={14} />} title="Alternative Hypotheses" color="#888" borderSide="top">
                                            <ul style={{ listStyleType: 'disc', paddingLeft: 20, color: '#888', fontFamily: "'JetBrains Mono',monospace", fontSize: 12, lineHeight: 1.8 }}>
                                                {report.hypotheses.map((h, i) => <li key={i}>{h}</li>)}
                                            </ul>
                                        </SectionBlock>
                                    )}
                                    {/* Hypothesis Chart */}
                                    {report.hypothesisTree?.length > 0 && (
                                        <MermaidChart
                                            chart={buildHypothesisMermaid(report.hypothesisTree)}
                                            caption="Hypothesis elimination — how competing explanations were tested and killed"
                                        />
                                    )}

                                    {/* --- PROMPT VIEW --- */}
                                    {report.aiPrompt && (
                                        <div style={{ background: '#ff00ff18', border: '2px solid #ff00ff', padding: 28, marginBottom: 14 }} className="brutal-shadow-magenta">
                                            <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'flex-start', marginBottom: 16, paddingBottom: 12, borderBottom: '1px solid #ff00ff44' }}>
                                                <h3 style={{ fontFamily: "'JetBrains Mono',monospace", fontWeight: 800, textTransform: 'uppercase', color: '#ff00ff', fontSize: 18 }}>Deterministic AI Fix Prompt</h3>
                                                <button onClick={() => handleCopy(report.aiPrompt, 'ai-prompt')}
                                                    style={{ display: 'flex', alignItems: 'center', gap: 6, padding: '8px 18px', fontFamily: "'JetBrains Mono',monospace", fontWeight: 700, textTransform: 'uppercase', fontSize: 12, background: '#ff00ff', color: '#fff', border: 'none', cursor: 'pointer' }}>
                                                    {copiedSection === 'ai-prompt' ? <Check size={14} /> : <Copy size={14} />}
                                                    {copiedSection === 'ai-prompt' ? 'COPIED!' : 'COPY PROMPT'}
                                                </button>
                                            </div>
                                            <p style={{ color: '#aaa', fontFamily: "'JetBrains Mono',monospace", fontSize: 12, marginBottom: 12 }}>
                                                Paste this directly into Cursor / Bolt / Copilot to apply the fix:
                                            </p>
                                            <pre style={{ background: '#050505', padding: 20, color: '#fff', fontFamily: "'JetBrains Mono',monospace", fontSize: 13, border: '1px solid #ff00ff33', lineHeight: 1.6, overflow: 'auto' }}>
                                                {report.aiPrompt}
                                            </pre>
                                        </div>
                                    )}

                                    {/* --- CODE VIEW --- */}
                                    {report.minimalFix && (
                                        <>
                                            <SectionBlock icon={<Code2 size={14} />} title="Minimal Code Fix" color="#ffaa00"
                                                copyText={report.minimalFix} copyId="cfix" copiedId={copiedSection} onCopy={handleCopy}>
                                                <div style={{ fontFamily: "'JetBrains Mono',monospace", fontSize: 12, color: '#888', textTransform: 'uppercase', marginBottom: 10 }}>
                                                    File: {report.codeLocation}
                                                </div>
                                                <pre style={{ background: '#050505', padding: 20, color: '#00ffff', fontFamily: "'JetBrains Mono',monospace", fontSize: 13, border: '1px solid #333', overflow: 'auto' }}>
                                                    {report.minimalFix}
                                                </pre>
                                            </SectionBlock>
                                            <SectionBlock icon={<CheckSquare size={14} />} title="Why This Works" color="#fff">
                                                <p style={{ fontSize: 17, color: '#fff', lineHeight: 1.7 }}>{report.whyFixWorks}</p>
                                            </SectionBlock>
                                        </>
                                    )}
                                </>
                            )}

                            {/* ═══ ACTION CENTER ═══ */}
                            <div style={{ background: '#111', border: '2px solid #333', borderTop: '4px solid #ccff00', padding: 28, marginTop: 20, marginBottom: 14 }}>
                                <h3 style={{ fontFamily: "'JetBrains Mono',monospace", fontWeight: 800, textTransform: 'uppercase', letterSpacing: 2, color: '#ccff00', fontSize: 14, display: 'flex', alignItems: 'center', gap: 8, marginBottom: 16, paddingBottom: 10, borderBottom: '1px solid #333' }}>
                                    <Zap size={16} /> Action Center
                                </h3>
                                <div style={{ display: 'flex', gap: 10, flexWrap: 'wrap' }}>
                                    {/* Create GitHub Issue — only if source was GitHub */}
                                    {inputType === 'github' && githubRepoContext.current && (() => {
                                        const { owner, repo } = githubRepoContext.current;
                                        const issueTitle = encodeURIComponent(
                                            analysisMode === 'debug'
                                                ? `[Unravel] ${report.bugType || 'Bug'}: ${(report.rootCause || report.symptom || 'Issue detected').slice(0, 80)}`
                                                : analysisMode === 'security'
                                                    ? `[Unravel Security] ${report.overallRisk || 'Risk'}: ${(report.summary || 'Security finding').slice(0, 80)}`
                                                    : `[Unravel] Code Analysis`
                                        );
                                        const bodyParts = [];
                                        if (analysisMode === 'debug') {
                                            if (report.symptom) bodyParts.push(`## Symptom\n${report.symptom}`);
                                            if (report.rootCause) bodyParts.push(`## Root Cause\n${report.rootCause}`);
                                            if (report.codeLocation) bodyParts.push(`**Location:** \`${typeof report.codeLocation === 'object' ? JSON.stringify(report.codeLocation) : report.codeLocation}\``);
                                            if (report.minimalFix) bodyParts.push(`## Suggested Fix\n\`\`\`\n${report.minimalFix}\n\`\`\``);
                                            if (report.whyFixWorks) bodyParts.push(`**Why this works:** ${report.whyFixWorks}`);
                                        } else if (analysisMode === 'security') {
                                            if (report.summary) bodyParts.push(`## Security Summary\n${report.summary}`);
                                            if (report.vulnerabilities?.length > 0) {
                                                bodyParts.push(`## Vulnerabilities\n${report.vulnerabilities.map(v => `- **${v.type}** (${v.severity}): ${v.description}${v.remediation ? `\n  Fix: ${v.remediation}` : ''}`).join('\n')}`);
                                            }
                                        }
                                        bodyParts.push(`\n---\n*Generated by [Unravel AI](https://github.com/unravel-ai) — Deterministic Debug Engine*`);
                                        const issueBody = encodeURIComponent(bodyParts.join('\n\n').slice(0, 4000));
                                        const issueUrl = `https://github.com/${owner}/${repo}/issues/new?title=${issueTitle}&body=${issueBody}`;
                                        return (
                                            <a href={issueUrl} target="_blank" rel="noopener noreferrer"
                                                style={{ display: 'flex', alignItems: 'center', gap: 8, padding: '12px 20px', background: '#22c55e18', border: '2px solid #22c55e', color: '#22c55e', fontFamily: "'JetBrains Mono',monospace", fontSize: 13, fontWeight: 700, textTransform: 'uppercase', textDecoration: 'none', cursor: 'pointer', transition: 'all 0.15s' }}>
                                                <Github size={16} /> Create GitHub Issue
                                            </a>
                                        );
                                    })()}

                                    {/* Copy Fix CLI Command — debug mode only */}
                                    {analysisMode === 'debug' && report.minimalFix && (() => {
                                        const loc = typeof report.codeLocation === 'object' ? JSON.stringify(report.codeLocation) : (report.codeLocation || 'file');
                                        const cliCmd = `git checkout -b unravel-fix && echo "Apply fix to ${loc}" && git add -A && git commit -m "fix: ${(report.rootCause || 'bug fix').slice(0, 50).replace(/"/g, "'")}" && gh pr create --title "fix: Unravel diagnosis" --body "Auto-generated from Unravel analysis"`;
                                        return (
                                            <button onClick={() => handleCopy(cliCmd, 'cli-fix')}
                                                style={{ display: 'flex', alignItems: 'center', gap: 8, padding: '12px 20px', background: copiedSection === 'cli-fix' ? '#ccff0018' : '#ff00ff18', border: `2px solid ${copiedSection === 'cli-fix' ? '#ccff00' : '#ff00ff'}`, color: copiedSection === 'cli-fix' ? '#ccff00' : '#ff00ff', fontFamily: "'JetBrains Mono',monospace", fontSize: 13, fontWeight: 700, textTransform: 'uppercase', cursor: 'pointer', transition: 'all 0.15s' }}>
                                                {copiedSection === 'cli-fix' ? <Check size={16} /> : <Copy size={16} />}
                                                {copiedSection === 'cli-fix' ? 'Copied!' : 'Copy Fix CLI'}
                                            </button>
                                        );
                                    })()}
                                </div>
                                <p style={{ color: '#555', fontSize: 11, fontFamily: "'JetBrains Mono',monospace", marginTop: 10 }}>
                                    {inputType === 'github' ? 'Create Issue opens a pre-filled GitHub issue in a new tab. You review before submitting.' : 'Use the Copy Fix CLI to generate a git workflow for applying the fix.'}
                                </p>
                            </div>

                            {/* New Analysis Button */}
                            <div style={{ textAlign: 'center', paddingTop: 24, borderTop: '2px solid #333', marginTop: 24 }}>
                                <button style={{ ...S.btnPrimary, maxWidth: 400, margin: '0 auto' }} onClick={reset}>
                                    <RefreshCw size={16} style={{ display: 'inline', marginRight: 8, verticalAlign: 'middle' }} />
                                    New Analysis
                                </button>
                            </div>
                        </div>
                    </ReportErrorBoundary>
                )
                }

            </main >
        </div >
    );
}
