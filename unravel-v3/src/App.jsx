import React, { useState, useRef } from 'react';
import {
    Code2, AlertTriangle, CheckSquare, Zap, Search, Loader2,
    Plus, Globe2, TerminalSquare, UploadCloud, Activity, Copy, Check,
    BrainCircuit, User, FolderTree, FileCode, Network, PauseCircle,
    Clock, Database, AlertOctagon, GitMerge, BookOpen, RefreshCw,
    ShieldAlert, Lightbulb, Key, ChevronRight, Baby, Palette, Book, Code, MessageSquare, Languages,
    Github, X, Link
} from 'lucide-react';
import {
    PROVIDERS, BUG_TAXONOMY, LEVELS, LANGUAGES,
    buildSystemPrompt, buildRouterPrompt, ENGINE_SCHEMA, ENGINE_SCHEMA_INSTRUCTION,
    callProvider, orchestrate, parseAIJson,
} from './core/index.js';

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

    const dirInputRef = useRef(null);

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

    const fetchGitHubRepo = async () => {
        setGithubError('');
        setGithubLoading(true);
        try {
            // Parse GitHub URL → owner/repo
            const urlObj = new URL(githubUrl.trim());
            const parts = urlObj.pathname.replace(/^\//, '').replace(/\/$/, '').split('/');
            if (parts.length < 2) throw new Error('URL must be github.com/owner/repo');
            const [owner, repo] = parts;
            const branch = parts[3] || 'main'; // /tree/branch support

            // Fetch the repo tree
            const treeRes = await fetch(`https://api.github.com/repos/${owner}/${repo}/git/trees/${branch}?recursive=1`);
            if (!treeRes.ok) {
                if (treeRes.status === 404) throw new Error('Repo not found. Is it public?');
                throw new Error(`GitHub API error: ${treeRes.status}`);
            }
            const treeData = await treeRes.json();

            // Filter files
            const validExts = ['.js', '.jsx', '.ts', '.tsx', '.html', '.css', '.json', '.py', '.md', '.vue', '.svelte'];
            const blacklist = ['node_modules', '.git', '.next', 'dist', 'build', 'coverage', '__pycache__', 'package-lock.json', 'yarn.lock'];
            const candidates = (treeData.tree || []).filter(f =>
                f.type === 'blob'
                && f.size < 500000
                && validExts.some(ext => f.path.endsWith(ext))
                && !blacklist.some(d => f.path.includes(`${d}/`) || f.path === d)
            ).slice(0, 50); // Cap at 50 files

            if (candidates.length === 0) throw new Error('No valid source files found in repo.');

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

            if (fetched.length === 0) throw new Error('Could not fetch any files.');

            // Convert to File-like objects for compatibility with directoryFiles
            const fileObjects = fetched.map(f => ({
                name: f.name,
                webkitRelativePath: f.webkitRelativePath,
                size: f.content.length,
                _content: f.content, // pre-loaded content
                text: () => Promise.resolve(f.content), // mimic File.text()
            }));

            // Append to directoryFiles
            setDirectoryFiles(prev => {
                const existingPaths = new Set(prev.map(f => f.webkitRelativePath || f.name));
                const newFiles = fileObjects.filter(f => !existingPaths.has(f.webkitRelativePath));
                return [...prev, ...newFiles];
            });
            setInputType('upload'); // Switch to upload tab to show files
        } catch (err) {
            setGithubError(err.message);
        } finally {
            setGithubLoading(false);
        }
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
        if (!resumeWithExtra) { setViewMode(null); setMissingFileRequest(null); }

        try {
            let codeFiles = [];
            let projectContext = '';

            // ── Gather files (UI-specific: paste vs upload/github) ──
            if (inputType === 'upload' || inputType === 'github') {
                if (directoryFiles.length === 0) throw new Error('Upload a project folder first.');
                setLoadingStage('ROUTER AGENT: Mapping directory tree...');
                const filePaths = directoryFiles.map(f => f.webkitRelativePath);
                projectContext = `Project tree: ${filePaths.length} files total.`;

                if (!resumeWithExtra) {
                    // Router pass — uses callProvider directly (not orchestrate)
                    const routerPrompt = buildRouterPrompt(filePaths, userError);
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
                    // Resume: reuse the router-selected paths from the first run
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
                onProgress: (stage) => setLoadingStage(stage),
                onMissingFiles: async (request) => {
                    // Show the missing files UI
                    setMissingFileRequest(request);
                    setAdditionalFiles((request.filesNeeded || []).map(f => ({ name: f, content: '' })));
                    setStep(3.5);
                    // Return null — the user will click "Resume" which calls executeAnalysis(true)
                    return null;
                },
            });

            // If orchestrate returned with a report, show it
            if (result?.report) {
                setReport(result.report);
                setStep(4);
            } else if (!result?.needsMoreInfo) {
                throw new Error('Unexpected engine response format.');
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
        (inputType === 'github' && directoryFiles.length > 0)
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
                                        <strong style={{ display: 'flex', alignItems: 'center', gap: 6 }}><Github size={14} /> PUBLIC REPOS ONLY</strong>
                                        <span style={{ color: '#aaa' }}>Paste a GitHub repo URL. Files are fetched directly — no auth needed.</span>
                                    </div>
                                    <div style={{ display: 'flex', gap: 8 }}>
                                        <div style={{ position: 'relative', flex: 1 }}>
                                            <Link size={14} style={{ position: 'absolute', left: 12, top: '50%', transform: 'translateY(-50%)', color: '#555' }} />
                                            <input
                                                type="text"
                                                style={{ ...S.input, paddingLeft: 34, fontFamily: "'JetBrains Mono',monospace", fontSize: 12 }}
                                                placeholder="https://github.com/user/repo"
                                                value={githubUrl}
                                                onChange={(e) => setGithubUrl(e.target.value)}
                                            />
                                        </div>
                                        <button
                                            onClick={fetchGitHubRepo}
                                            disabled={!githubUrl.trim() || githubLoading}
                                            style={{ ...S.btnPrimary, width: 'auto', padding: '11px 24px', fontSize: 13, opacity: githubUrl.trim() && !githubLoading ? 1 : 0.4, display: 'flex', alignItems: 'center', gap: 8 }}>
                                            {githubLoading ? <Loader2 size={14} className="animate-spin" /> : <Github size={14} />}
                                            {githubLoading ? 'FETCHING...' : 'FETCH'}
                                        </button>
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

                            {/* Symptom */}
                            <div style={{ borderTop: '2px solid #333', paddingTop: 20, marginTop: 20 }}>
                                <div style={{ ...S.label, color: '#ff003c' }}><Activity size={14} /> Define The Symptom</div>
                                <textarea style={S.codeInput} placeholder="E.g., Timer resets to wrong value after pause. Include stack traces if you have them..."
                                    value={userError} onChange={(e) => setUserError(e.target.value)} />
                            </div>

                            {analysisError && (
                                <div style={{ background: '#ff003c18', border: '1px solid #ff003c44', padding: 12, color: '#fca5a5', fontSize: 13, marginTop: 14, fontFamily: "'JetBrains Mono',monospace" }}>
                                    ⚠️ {analysisError}
                                </div>
                            )}

                            <button style={{ ...S.btnPrimary, marginTop: 16, opacity: canExecute ? 1 : 0.4, display: 'flex', justifyContent: 'center', alignItems: 'center', gap: 10 }}
                                disabled={!canExecute || isAnalyzing} onClick={() => executeAnalysis(false)}>
                                Execute Engine <Zap size={20} />
                            </button>
                            <p style={{ color: '#555', fontSize: 11, fontFamily: "'JetBrains Mono',monospace", marginTop: 8, textAlign: 'center' }}>
                                Using: {prov?.models[Object.keys(prov.models).find(k => prov.models[k].id === model)]?.label || model} with extended thinking
                            </p>
                        </div>
                    </div>
                )}

                {/* ═══ STEP 3: Loading ═══ */}
                {step === 3 && (
                    <div className="animate-in" style={{ paddingTop: 100, display: 'flex', flexDirection: 'column', alignItems: 'center', textAlign: 'center' }}>
                        <BrainCircuit size={80} color="#ff00ff" className="animate-pulse" style={{ marginBottom: 28 }} />
                        <h2 style={{ fontSize: 36, fontWeight: 800, textTransform: 'uppercase', color: '#fff', letterSpacing: 3 }}>SYSTEM ACTIVE</h2>
                        <div style={{ marginTop: 28, width: '100%', maxWidth: 500, border: '2px solid #555', background: '#111', padding: 20, textAlign: 'left', position: 'relative', overflow: 'hidden' }}>
                            <div style={{ position: 'absolute', top: 0, left: 0, height: 2, background: '#ccff00', width: '100%' }} className="animate-pulse" />
                            <p style={{ fontFamily: "'JetBrains Mono',monospace", color: '#00ffff', fontSize: 14, textTransform: 'uppercase', display: 'flex', alignItems: 'center', gap: 10 }}>
                                <Loader2 size={16} className="animate-spin" /> {loadingStage || 'Initializing...'}
                            </p>
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

                {/* ═══ STEP 4: Output Menu ═══ */}
                {step === 4 && report && (
                    <div className="animate-slide-up" style={{ maxWidth: 1100, margin: '0 auto', paddingTop: 20 }}>
                        <div style={{ textAlign: 'center', marginBottom: 32, borderBottom: '2px solid #333', paddingBottom: 24 }}>
                            <div style={{ display: 'inline-flex', alignItems: 'center', gap: 8, background: '#ccff00', color: '#000', fontWeight: 800, fontFamily: "'JetBrains Mono',monospace", padding: '4px 16px', border: '2px solid #000', marginBottom: 14 }}>
                                ENGINE CONFIDENCE: {displayConfidence(report.confidence)}%
                                {displayConfidence(report.confidence) > 80 ? <CheckSquare size={14} /> : <AlertTriangle size={14} />}
                            </div>
                            <h2 style={{ fontSize: 42, fontWeight: 800, color: '#fff', textTransform: 'uppercase', margin: '10px 0 6px' }}>Diagnosis Ready</h2>
                            <p style={{ color: '#aaa', fontFamily: "'JetBrains Mono',monospace" }}>Root cause identified. Choose output format:</p>
                        </div>

                        <div style={{ display: 'grid', gap: 12 }}>
                            {[
                                { mode: 'plain', label: '1. Human Explanation', desc: 'Symptoms, Metaphors, Concepts to learn', icon: <User size={24} />, accent: '#ccff00' },
                                { mode: 'tech', label: '2. Technical Breakdown', desc: 'State Mutation Tables, Timelines, Invariants', icon: <Database size={24} />, accent: '#00ffff' },
                                { mode: 'prompt', label: '3. Agent Prompt', desc: 'Prompt for Cursor/Bolt to apply fix safely', icon: <TerminalSquare size={24} />, accent: '#ff00ff' },
                                { mode: 'code', label: '4. Minimal Code Fix', desc: 'The exact snippet required, no massive refactors', icon: <Code2 size={24} />, accent: '#ffaa00' },
                            ].map(({ mode, label, desc, icon, accent }) => (
                                <button key={mode} onClick={() => { setViewMode(mode); setStep(5); }}
                                    style={{ ...S.card, padding: 20, display: 'flex', justifyContent: 'space-between', alignItems: 'center', cursor: 'pointer', border: '2px solid #333', transition: 'all 0.15s', textAlign: 'left' }}>
                                    <div>
                                        <h3 style={{ fontSize: 20, fontWeight: 800, color: '#fff', textTransform: 'uppercase', margin: 0 }}>{label}</h3>
                                        <p style={{ color: '#888', fontFamily: "'JetBrains Mono',monospace", fontSize: 12, marginTop: 4 }}>{desc}</p>
                                    </div>
                                    <span style={{ color: '#555' }}>{icon}</span>
                                </button>
                            ))}
                            <button onClick={() => { setViewMode('all'); setStep(5); }}
                                style={{ padding: 18, border: '2px dashed #555', background: 'transparent', color: '#aaa', fontWeight: 700, fontSize: 17, textTransform: 'uppercase', cursor: 'pointer', marginTop: 8 }}>
                                5. Show Me Everything
                            </button>
                        </div>
                    </div>
                )}

                {/* ═══ STEP 5: The Report ═══ */}
                {step === 5 && report && viewMode && (
                    <div className="animate-slide-up" style={{ paddingBottom: 80 }}>
                        {/* Sticky header */}
                        <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'flex-end', borderBottom: '4px solid #fff', paddingBottom: 14, marginBottom: 28, position: 'sticky', top: 72, background: '#050505f2', backdropFilter: 'blur(8px)', zIndex: 15, paddingTop: 12, gap: 12, flexWrap: 'wrap' }}>
                            <div>
                                <div style={{ display: 'flex', gap: 8, marginBottom: 6, flexWrap: 'wrap' }}>
                                    <span style={{ fontFamily: "'JetBrains Mono',monospace", fontSize: 11, background: bugMeta?.color || '#888', color: '#fff', padding: '3px 10px', textTransform: 'uppercase', fontWeight: 700 }}>{bugMeta?.label || report.bugType}</span>
                                    <span style={{ fontFamily: "'JetBrains Mono',monospace", fontSize: 11, background: '#222', color: '#ccff00', border: '1px solid #ccff00', padding: '3px 10px', textTransform: 'uppercase' }}>CFD: {displayConfidence(report.confidence)}%</span>
                                </div>
                                <h2 style={{ fontSize: 32, fontWeight: 800, color: '#fff', textTransform: 'uppercase', margin: 0 }}>
                                    Mode: <span style={{ color: '#ccff00' }}>{viewMode}</span>
                                </h2>
                            </div>
                            <button style={S.btnOutline} onClick={() => setStep(4)}>← Output Menu</button>
                        </div>

                        {/* --- HUMAN VIEW --- */}
                        {(viewMode === 'plain' || viewMode === 'tech' || viewMode === 'all') && report.symptom && (
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
                        {(viewMode === 'plain' || viewMode === 'all') && report.evidence?.length > 0 && (
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
                        {(viewMode === 'plain' || viewMode === 'all') && report.conceptExtraction && (
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
                        {(viewMode === 'plain' || viewMode === 'all') && report.conceptExtraction?.realWorldAnalogy && (
                            <SectionBlock icon={<Lightbulb size={14} />} title="Real World Analogy" color="#ccff00" copyId="analogy" copiedId={copiedSection} onCopy={handleCopy}
                                copyText={report.conceptExtraction.realWorldAnalogy}>
                                <p style={{ fontSize: 18, color: '#e0e0e0', lineHeight: 1.7, fontStyle: 'italic' }}>
                                    "{report.conceptExtraction.realWorldAnalogy}"
                                </p>
                            </SectionBlock>
                        )}

                        {/* Why AI Looped */}
                        {(viewMode === 'plain' || viewMode === 'all') && report.whyAILooped && (
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

                        {/* --- TECH VIEW --- */}
                        {(viewMode === 'tech' || viewMode === 'all') && report.variableState?.length > 0 && (
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

                        {(viewMode === 'tech' || viewMode === 'all') && report.timeline?.length > 0 && (
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

                        {(viewMode === 'tech' || viewMode === 'all') && report.invariants?.length > 0 && (
                            <SectionBlock icon={<ShieldAlert size={14} />} title="Invariant Violations" color="#ff003c"
                                copyText={report.invariants.join('\n')} copyId="inv" copiedId={copiedSection} onCopy={handleCopy}>
                                <ul style={{ listStyleType: 'disc', paddingLeft: 20, color: '#ccc', fontFamily: "'JetBrains Mono',monospace", fontSize: 13, lineHeight: 1.8 }}>
                                    {report.invariants.map((inv, i) => <li key={i}>{inv}</li>)}
                                </ul>
                            </SectionBlock>
                        )}

                        {(viewMode === 'tech' || viewMode === 'all') && (
                            <SectionBlock icon={<GitMerge size={14} />} title="Technical Root Cause" color="#fff"
                                copyText={report.rootCause} copyId="root" copiedId={copiedSection} onCopy={handleCopy}>
                                <p style={{ color: '#e0e0e0', lineHeight: 1.7, marginBottom: 12 }}>{report.rootCause}</p>
                                <div style={{ background: '#050505', padding: 10, border: '1px solid #333', fontFamily: "'JetBrains Mono',monospace", color: '#00ffff', fontSize: 13 }}>
                                    Location: {report.codeLocation}
                                </div>
                            </SectionBlock>
                        )}

                        {(viewMode === 'tech' || viewMode === 'all') && report.hypotheses?.length > 0 && (
                            <SectionBlock icon={<BrainCircuit size={14} />} title="Alternative Hypotheses" color="#888" borderSide="top">
                                <ul style={{ listStyleType: 'disc', paddingLeft: 20, color: '#888', fontFamily: "'JetBrains Mono',monospace", fontSize: 12, lineHeight: 1.8 }}>
                                    {report.hypotheses.map((h, i) => <li key={i}>{h}</li>)}
                                </ul>
                            </SectionBlock>
                        )}

                        {/* --- PROMPT VIEW --- */}
                        {(viewMode === 'prompt' || viewMode === 'all') && report.aiPrompt && (
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
                        {(viewMode === 'code' || viewMode === 'all') && report.minimalFix && (
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

                        {/* New Analysis Button */}
                        <div style={{ textAlign: 'center', paddingTop: 24, borderTop: '2px solid #333', marginTop: 24 }}>
                            <button style={{ ...S.btnPrimary, maxWidth: 400, margin: '0 auto' }} onClick={reset}>
                                <RefreshCw size={16} style={{ display: 'inline', marginRight: 8, verticalAlign: 'middle' }} />
                                New Analysis
                            </button>
                        </div>
                    </div>
                )}

            </main>
        </div>
    );
}
