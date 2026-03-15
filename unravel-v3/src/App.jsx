import React, { useState, useRef, useEffect, useCallback } from 'react';
import {
    Code2, AlertTriangle, CheckSquare, Zap, Search, Loader2,
    Plus, Globe2, TerminalSquare, UploadCloud, Activity, Copy, Check,
    BrainCircuit, User, FolderTree, FileCode, Network, PauseCircle,
    Clock, Database, AlertOctagon, GitMerge, BookOpen, RefreshCw,
    ShieldAlert, Lightbulb, Key, ChevronRight, Baby, Palette, Book, Code, MessageSquare, Languages,
    Github, X, Link, Shield, Bug, Eye, Layers, Moon, Sun, Monitor, Download
} from 'lucide-react';
import html2pdf from 'html2pdf.js';
import {
    PROVIDERS, BUG_TAXONOMY, LEVELS, LANGUAGES,
    buildRouterPrompt, SECTION_REGISTRY, PRESETS, estimateRuntime,
    callProvider, orchestrate, parseAIJson,
    LAYER_BOUNDARY_VERDICT,
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
const Logo = ({ isAnalyzing }) => (
    <svg width="48" height="32" viewBox="0 0 120 80" fill="none" xmlns="http://www.w3.org/2000/svg" className={isAnalyzing ? "animate-pulse" : ""} style={{ marginRight: 8 }}>
        <defs>
            <linearGradient id="lineGrad" x1="60" y1="40" x2="110" y2="40" gradientUnits="userSpaceOnUse">
                <stop offset="0%" stopColor="#a855f7" />
                <stop offset="100%" stopColor="#06b6d4" />
            </linearGradient>
            <filter id="glow" x="-20%" y="-20%" width="140%" height="140%">
                <feGaussianBlur stdDeviation="3" result="blur" />
                <feMerge>
                    <feMergeNode in="blur" />
                    <feMergeNode in="SourceGraphic" />
                </feMerge>
            </filter>
        </defs>
        <path d="M 30 20 L 50 15 L 60 30 L 40 45 L 20 30 Z M 20 30 L 10 50 L 30 70 L 50 50 L 40 45 M 50 50 L 70 60 L 60 30 M 30 20 L 40 10 L 60 10 L 70 20 L 60 30 M 70 20 L 80 40 L 60 40 L 50 15" stroke="var(--text-primary)" strokeWidth="4" strokeLinecap="round" strokeLinejoin="round" />
        <line x1="60" y1="40" x2="110" y2="40" stroke="url(#lineGrad)" strokeWidth="5" strokeLinecap="round" />
        <circle cx="110" cy="40" r="4" fill="#06b6d4" filter="url(#glow)" />
    </svg>
);

const SvgLoader = ({ style = { width: 450 } }) => (
    <div className="main-container" style={{ ...style, perspective: 1000, display: 'flex', justifyContent: 'center', alignItems: 'center' }}>
        <div className="loader">
            <svg width="100%" height="100%" viewBox="0 0 800 500" xmlns="http://www.w3.org/2000/svg">
                <defs>
                    <linearGradient id="chipGradient" x1="0" y1="0" x2="1" y2="1">
                        <stop offset="0%" stopColor="#2c2c36"></stop>
                        <stop offset="25%" stopColor="#18181c"></stop>
                        <stop offset="70%" stopColor="#0a0a0e"></stop>
                        <stop offset="100%" stopColor="#020203"></stop>
                    </linearGradient>

                    <linearGradient id="goldPin" x1="1" y1="0" x2="0" y2="1">
                        <stop offset="0%" stopColor="#ffdf00"></stop>
                        <stop offset="40%" stopColor="#d4af37"></stop>
                        <stop offset="60%" stopColor="#aa7c11"></stop>
                        <stop offset="100%" stopColor="#553e05"></stop>
                    </linearGradient>

                    <linearGradient id="textGradient" x1="0" y1="0" x2="1" y2="0">
                        <stop offset="0%" stopColor="#ffffff"></stop>
                        <stop offset="50%" stopColor="#aafff0"></stop>
                        <stop offset="100%" stopColor="#ffffff"></stop>
                    </linearGradient>

                    <pattern id="circuit-pattern" x="0" y="0" width="20" height="20" patternUnits="userSpaceOnUse">
                        <path d="M 10 0 L 10 20 M 0 10 L 20 10" fill="none" stroke="#00ffcc" strokeWidth="0.5" strokeOpacity="0.1" />
                        <circle cx="10" cy="10" r="1.5" fill="#00ffcc" fillOpacity="0.2" />
                    </pattern>

                    <pattern id="bg-grid" width="30" height="30" patternUnits="userSpaceOnUse">
                        <path d="M 30 0 L 0 0 0 30" fill="none" stroke="#00e5ff" strokeWidth="1" strokeOpacity="0.25" />
                    </pattern>

                    <radialGradient id="grid-mask-grad" cx="400" cy="240" r="280" gradientUnits="userSpaceOnUse">
                        <stop offset="0%" stopColor="#ffffff" stopOpacity="1" />
                        <stop offset="40%" stopColor="#ffffff" stopOpacity="0.6" />
                        <stop offset="100%" stopColor="#ffffff" stopOpacity="0" />
                    </radialGradient>

                    <mask id="grid-mask">
                        <rect width="100%" height="100%" fill="url(#grid-mask-grad)" />
                    </mask>
                </defs>

                <circle cx="400" cy="240" r="160" fill="#00e5ff" filter="blur(55px)" opacity="0.06"></circle>
                <rect width="100%" height="100%" fill="url(#bg-grid)" mask="url(#grid-mask)"></rect>

                <g id="traces-bg">
                    <path d="M100 100 H180 L200 120 V200 L210 210 H326" className="trace-bg"></path>
                    <path d="M80 180 H160 L180 200 V220 L190 230 H326" className="trace-bg"></path>
                    <path d="M60 260 H130 L150 240 V240 L160 250 H326" className="trace-bg"></path>
                    <path d="M100 350 H180 L200 330 V280 L210 270 H326" className="trace-bg"></path>
                    <path d="M700 90 H600 L560 130 V200 L550 210 H474" className="trace-bg"></path>
                    <path d="M740 160 H620 L580 200 V220 L570 230 H474" className="trace-bg"></path>
                    <path d="M720 250 H610 L590 250 V250 L590 250 H474" className="trace-bg"></path>
                    <path d="M680 340 H610 L570 300 V280 L560 270 H474" className="trace-bg"></path>
                </g>

                <g className="purple flow-1"><path d="M100 100 H180 L200 120 V200 L210 210 H326" className="trace-glow"></path><path d="M100 100 H180 L200 120 V200 L210 210 H326" className="trace-core"></path></g>
                <g className="blue flow-2"><path d="M80 180 H160 L180 200 V220 L190 230 H326" className="trace-glow"></path><path d="M80 180 H160 L180 200 V220 L190 230 H326" className="trace-core"></path></g>
                <g className="yellow flow-3"><path d="M60 260 H130 L150 240 V240 L160 250 H326" className="trace-glow"></path><path d="M60 260 H130 L150 240 V240 L160 250 H326" className="trace-core"></path></g>
                <g className="green flow-4"><path d="M100 350 H180 L200 330 V280 L210 270 H326" className="trace-glow"></path><path d="M100 350 H180 L200 330 V280 L210 270 H326" className="trace-core"></path></g>
                <g className="cyan flow-5"><path d="M700 90 H600 L560 130 V200 L550 210 H474" className="trace-glow"></path><path d="M700 90 H600 L560 130 V200 L550 210 H474" className="trace-core"></path></g>
                <g className="green flow-6"><path d="M740 160 H620 L580 200 V220 L570 230 H474" className="trace-glow"></path><path d="M740 160 H620 L580 200 V220 L570 230 H474" className="trace-core"></path></g>
                <g className="red flow-7"><path d="M720 250 H610 L590 250 V250 L590 250 H474" className="trace-glow"></path><path d="M720 250 H610 L590 250 V250 L590 250 H474" className="trace-core"></path></g>
                <g className="yellow flow-8"><path d="M680 340 H610 L570 300 V280 L560 270 H474" className="trace-glow"></path><path d="M680 340 H610 L570 300 V280 L560 270 H474" className="trace-core"></path></g>

                <g id="nodes">
                    <circle cx="100" cy="100" r="7" className="node-outer"></circle><circle cx="100" cy="100" r="3" className="node-inner glow-p"></circle>
                    <circle cx="80" cy="180" r="7" className="node-outer"></circle><circle cx="80" cy="180" r="3" className="node-inner glow-b"></circle>
                    <circle cx="60" cy="260" r="7" className="node-outer"></circle><circle cx="60" cy="260" r="3" className="node-inner glow-y"></circle>
                    <circle cx="100" cy="350" r="7" className="node-outer"></circle><circle cx="100" cy="350" r="3" className="node-inner glow-g"></circle>
                    <circle cx="700" cy="90" r="7" className="node-outer"></circle><circle cx="700" cy="90" r="3" className="node-inner glow-c"></circle>
                    <circle cx="740" cy="160" r="7" className="node-outer"></circle><circle cx="740" cy="160" r="3" className="node-inner glow-g"></circle>
                    <circle cx="720" cy="250" r="7" className="node-outer"></circle><circle cx="720" cy="250" r="3" className="node-inner glow-r"></circle>
                    <circle cx="680" cy="340" r="7" className="node-outer"></circle><circle cx="680" cy="340" r="3" className="node-inner glow-y"></circle>
                </g>

                <g className="chip-group">
                    <rect x="325" y="178" width="150" height="140" fill="#06060a" stroke="#151520" strokeWidth="1" rx="12" ry="12"></rect>

                    <g>
                        <path d="M315 204 h15 v12 h-15 a3 3 0 0 1 -3 -3 v-6 a3 3 0 0 1 3 -3 z" fill="url(#goldPin)" className="chip-pin"></path>
                        <path d="M315 224 h15 v12 h-15 a3 3 0 0 1 -3 -3 v-6 a3 3 0 0 1 3 -3 z" fill="url(#goldPin)" className="chip-pin"></path>
                        <path d="M315 244 h15 v12 h-15 a3 3 0 0 1 -3 -3 v-6 a3 3 0 0 1 3 -3 z" fill="url(#goldPin)" className="chip-pin"></path>
                        <path d="M315 264 h15 v12 h-15 a3 3 0 0 1 -3 -3 v-6 a3 3 0 0 1 3 -3 z" fill="url(#goldPin)" className="chip-pin"></path>
                    </g>
                    <g transform="scale(-1, 1) translate(-800, 0)">
                        <path d="M315 204 h15 v12 h-15 a3 3 0 0 1 -3 -3 v-6 a3 3 0 0 1 3 -3 z" fill="url(#goldPin)" className="chip-pin"></path>
                        <path d="M315 224 h15 v12 h-15 a3 3 0 0 1 -3 -3 v-6 a3 3 0 0 1 3 -3 z" fill="url(#goldPin)" className="chip-pin"></path>
                        <path d="M315 244 h15 v12 h-15 a3 3 0 0 1 -3 -3 v-6 a3 3 0 0 1 3 -3 z" fill="url(#goldPin)" className="chip-pin"></path>
                        <path d="M315 264 h15 v12 h-15 a3 3 0 0 1 -3 -3 v-6 a3 3 0 0 1 3 -3 z" fill="url(#goldPin)" className="chip-pin"></path>
                    </g>

                    <rect x="325" y="170" width="150" height="140" fill="url(#chipGradient)" className="chip-body"></rect>
                    <rect x="326" y="171" width="148" height="138" fill="none" stroke="#4a4a5a" strokeWidth="1.5" strokeOpacity="0.6" rx="11" ry="11"></rect>
                    <rect x="332" y="177" width="136" height="126" fill="none" stroke="#ffffff" strokeWidth="0.5" strokeOpacity="0.05" rx="8"></rect>
                    <rect x="340" y="185" width="120" height="110" className="chip-die" fill="url(#circuit-pattern)"></rect>
                    <circle cx="400" cy="240" r="42" fill="none" stroke="#00ffcc" strokeWidth="1.5" strokeOpacity="0.1" filter="drop-shadow(0 0 2px #000)"></circle>
                    
                    <foreignObject x="250" y="90" width="300" height="300">
                        <div xmlns="http://www.w3.org/1999/xhtml" className="fluid-core-container">
                            <div className="fluid-loader">
                                <svg width="100" height="100" viewBox="0 0 100 100" className="fluid-svg">
                                    <defs>
                                        <mask id="clipping">
                                            <polygon points="0,0 100,0 100,100 0,100" fill="black"></polygon>
                                            <polygon points="25,25 75,25 50,75" fill="white"></polygon>
                                            <polygon points="50,25 75,75 25,75" fill="white"></polygon>
                                            <polygon points="35,35 65,35 50,65" fill="white"></polygon>
                                            <polygon points="35,35 65,35 50,65" fill="white"></polygon>
                                            <polygon points="35,35 65,35 50,65" fill="white"></polygon>
                                            <polygon points="35,35 65,35 50,65" fill="white"></polygon>
                                        </mask>
                                    </defs>
                                </svg>
                                <div className="fluid-box"></div>
                            </div>
                        </div>
                    </foreignObject>
                </g>
            </svg>
        </div>
    </div>
);

const BannerSplash = () => (
    <div style={{ width: '100vw', height: '100vh', display: 'flex', alignItems: 'center', justifyContent: 'center', background: '#030303', overflow: 'hidden' }}>
        <svg width="100%" height="100%" viewBox="0 0 1200 400" preserveAspectRatio="xMidYMid meet" xmlns="http://www.w3.org/2000/svg">
            <defs>
                <style>{`
                    .splash-bg { fill: #030303; }
                    .splash-grid { stroke: #ffffff; stroke-width: 0.5; opacity: 0.06; }
                    .splash-tech { font-family: 'JetBrains Mono', monospace; font-size: 10px; fill: #38bdf8; opacity: 0.15; }
                    .splash-cross { stroke: #ffffff; stroke-width: 0.8; opacity: 0.2; }
                    
                    .knot-path {
                        stroke-dasharray: 1000;
                        stroke-dashoffset: 1000;
                        stroke-linecap: round;
                        stroke-linejoin: round;
                        animation: drawKnot 2.5s cubic-bezier(0.4, 0, 0.2, 1) forwards;
                    }
                    .kp-1 { animation-delay: 0.1s; }
                    .kp-2 { animation-delay: 0.3s; }
                    .kp-3 { animation-delay: 0.5s; }
                    .kp-4 { animation-delay: 0.7s; }
                    .kp-5 { animation-delay: 0.9s; }

                    @keyframes drawKnot { to { stroke-dashoffset: 0; } }
                    @keyframes float { 0%, 100% { transform: translateY(0); } 50% { transform: translateY(-4px); } }
                    @keyframes floatParallax { 0%, 100% { transform: translate(0, 0); } 50% { transform: translate(2px, -6px); } }

                    .float-base { animation: float 6s ease-in-out infinite; }
                    .float-front { animation: floatParallax 6s ease-in-out infinite; }

                    .logo-line-weaving {
                        fill: none;
                        stroke: url(#brandGradientSplash);
                        stroke-width: 9;
                        stroke-linecap: round;
                        filter: url(#brandGlowSplash);
                        stroke-dasharray: 2000;
                        stroke-dashoffset: 2000;
                        animation: drawLine 3.5s cubic-bezier(0.1, 0, 0, 1) 1.2s forwards;
                    }

                    @keyframes drawLine { to { stroke-dashoffset: 0; } }

                    .letter { font-family: 'Outfit', sans-serif; font-weight: 800; font-size: 156px; fill: #ffffff; }
                    .letter-gradient { fill: url(#textGradientSplash); }
                    .subtitle { font-family: 'JetBrains Mono', monospace; font-size: 13px; fill: #94a3b8; letter-spacing: 12px; text-transform: uppercase; opacity: 0.6; }
                    .tag-pill { fill: #1e293b; stroke: #334155; stroke-width: 1; }
                    .tag-text { font-family: 'JetBrains Mono', monospace; font-size: 11px; fill: #38bdf8; font-weight: 900; }
                    .node-end { fill: #06b6d4; filter: url(#nodeGlowSplash); opacity: 0; animation: showNode 0.4s ease-out 3.0s forwards; }

                    @keyframes showNode { to { opacity: 1; } }
                    .mask-cutout { stroke: #030303; stroke-width: 16; fill: none; stroke-linecap: round; stroke-linejoin: round; }
                `}</style>

                <linearGradient id="brandGradientSplash" x1="0%" y1="0%" x2="100%" y2="0%">
                    <stop offset="0%" stopColor="#7e22ce" />
                    <stop offset="30%" stopColor="#6366f1" />
                    <stop offset="70%" stopColor="#0891b2" />
                    <stop offset="100%" stopColor="#22d3ee" />
                </linearGradient>

                <linearGradient id="textGradientSplash" x1="0%" y1="0%" x2="100%" y2="0%">
                    <stop offset="0%" stopColor="#ffffff" />
                    <stop offset="100%" stopColor="#64748b" />
                </linearGradient>

                <radialGradient id="mainGlowSplash" cx="50%" cy="50%" r="50%">
                    <stop offset="0%" stopColor="#38bdf8" stopOpacity="0.18" />
                    <stop offset="100%" stopColor="#000000" stopOpacity="0" />
                </radialGradient>

                <filter id="brandGlowSplash" x="-100%" y="-1500%" width="300%" height="3100%" filterUnits="objectBoundingBox">
                    <feGaussianBlur stdDeviation="15" result="blur" />
                    <feMerge>
                        <feMergeNode in="blur" />
                        <feMergeNode in="SourceGraphic" />
                    </feMerge>
                </filter>

                <filter id="whiteGlowSplash" x="-200%" y="-2000%" width="500%" height="4100%" filterUnits="objectBoundingBox">
                    <feGaussianBlur stdDeviation="6" result="blur" />
                    <feMerge>
                        <feMergeNode in="blur" />
                        <feMergeNode in="SourceGraphic" />
                    </feMerge>
                </filter>

                <filter id="nodeGlowSplash" x="-500%" y="-500%" width="1100%" height="1100%" filterUnits="objectBoundingBox">
                    <feGaussianBlur stdDeviation="28" result="blur" />
                    <feMerge>
                        <feMergeNode in="blur" />
                        <feMergeNode in="SourceGraphic" />
                    </feMerge>
                </filter>
            </defs>

            <rect width="1200" height="400" className="splash-bg" />
            <circle cx="500" cy="200" r="500" fill="url(#mainGlowSplash)" />

            <g className="splash-grid">
                {[50, 100, 150, 200, 250, 300, 350].map(v => <line key={`h${v}`} x1="0" y1={v} x2="1200" y2={v} />)}
                {[100, 200, 300, 400, 500, 600, 700, 800, 900, 1000, 1100].map(v => <line key={`v${v}`} x1={v} y1="0" x2={v} y2="400" />)}
            </g>

            <g className="splash-tech">
                <text x="30" y="30">FAST_INVERSE_SQRT_0x5F3759DF</text>
                <text x="1050" y="380">AST_RESOLVER_V3</text>
                <text x="30" y="380">MUTATION_TRACE_ENGINE_ENABLED</text>
                <text x="1080" y="30">BUILD_2026.03.15</text>
                <text x="50" y="150" opacity="0.6">_STATIC_ANALYSIS</text>
                <text x="1080" y="250" opacity="0.6">_ROOT_CAUSE</text>
            </g>

            <g className="splash-cross">
                <path d="M40 40 L40 60 M30 50 L50 50" />
                <path d="M1160 40 L1160 60 M1150 50 L1170 50" />
                <path d="M40 340 L40 360 M30 350 L50 350" />
                <path d="M1160 340 L1160 360 M1150 350 L1170 350" />
            </g>

            <g transform="translate(600, 200)">
                <text x="-375" y="30" className="letter">U</text>
                <text x="-115" y="30" className="letter letter-gradient">R</text>
                <text x="110" y="30" className="letter letter-gradient">V</text>
                <text x="345" y="30" className="letter letter-gradient">L</text>

                <path className="logo-line-weaving" d="M -540, -30 C -300, -30 -150, 0 100, 0 L 520, 0" />

                <text x="-250" y="30" className="letter">N</text>
                <text x="5" y="30" className="letter letter-gradient">A</text>
                <text x="215" y="30" className="letter letter-gradient">E</text>
                
                <circle cx="520" cy="0" r="20" className="node-end" />

                <g transform="translate(-720, -215) scale(1.1)">
                    <g className="float-base">
                        <g strokeOpacity="0.9">
                            <path d="M130,180 L160,130 L210,150 L240,100 L290,140 L260,190" className="knot-path kp-1 mask-cutout" />
                            <path d="M120,210 L150,250 L200,220 L230,270 L280,230 L300,180 L280,140" className="knot-path kp-2 mask-cutout" />
                            <path d="M150,150 L180,190 L160,230 L210,250 L250,210 L300,240" className="knot-path kp-3 mask-cutout" />
                            
                            <path d="M130,180 L160,130 L210,150 L240,100 L290,140 L260,190" className="knot-path kp-1" fill="none" stroke="#f8fafc" strokeWidth="4.5" filter="url(#whiteGlowSplash)" />
                            <path d="M120,210 L150,250 L200,220 L230,270 L280,230 L300,180 L280,140" className="knot-path kp-2" fill="none" stroke="#f8fafc" strokeWidth="4.5" filter="url(#whiteGlowSplash)" />
                            <path d="M150,150 L180,190 L160,230 L210,250 L250,210 L300,240" className="knot-path kp-3" fill="none" stroke="#f8fafc" strokeWidth="4.5" filter="url(#whiteGlowSplash)" />
                        </g>
                    </g>

                    <g className="float-front">
                        <g strokeOpacity="0.9">
                            <path d="M160,200 L200,160 L250,190 L280,150 L310,200 L270,240 L230,200" className="knot-path kp-4 mask-cutout" />
                            <path d="M180,240 L220,200 L270,250 L300,210 L250,170 L210,120 L170,160" className="knot-path kp-5 mask-cutout" />
                            
                            <path d="M160,200 L200,160 L250,190 L280,150 L310,200 L270,240 L230,200" className="knot-path kp-4" fill="none" stroke="#f8fafc" strokeWidth="4.5" filter="url(#whiteGlowSplash)" />
                            <path d="M180,240 L220,200 L270,250 L300,210 L250,170 L210,120 L170,160" className="knot-path kp-5" fill="none" stroke="#f8fafc" strokeWidth="4.5" filter="url(#whiteGlowSplash)" />
                        </g>
                    </g>
                    <circle cx="210" cy="185" r="5" fill="#ffffff" filter="url(#whiteGlowSplash)" />
                </g>

                <text x="0" y="115" className="subtitle" textAnchor="middle">THE AST-ENHANCED AI DEBUGGING ENGINE</text>

                <g transform="translate(-110, 150)">
                    <rect width="220" height="30" rx="15" className="tag-pill" />
                    <text x="110" y="20" className="tag-text" textAnchor="middle">STABLE RELEASE V3.3.4</text>
                </g>
            </g>
        </svg>
    </div>
);

const CopyBtn = ({ text, id, copiedId, onCopy, label = 'COPY' }) => (
    <button onClick={() => onCopy(text, id)}
        className="matte-button"
        style={{ display: 'flex', alignItems: 'center', gap: 6, padding: '6px 12px', fontSize: 11, fontWeight: 700, textTransform: 'uppercase', background: copiedId === id ? 'var(--accent-green)22' : 'var(--surface-hover)', color: copiedId === id ? 'var(--accent-green)' : 'var(--text-secondary)', border: `1px solid ${copiedId === id ? 'var(--accent-green)' : 'var(--border-light)'}` }}>
        {copiedId === id ? <Check size={14} /> : <Copy size={14} />}
        {copiedId === id ? 'COPIED' : label}
    </button>
);

const SectionBlock = ({ icon, title, color, borderSide = 'left', children, copyText, copyId, copiedId, onCopy }) => (
    <div className="glass-panel" style={{ padding: 32, marginBottom: 24, ...(borderSide === 'left' ? { borderLeft: `4px solid ${color}` } : { borderTop: `4px solid ${color}` }) }}>
        <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'flex-start', marginBottom: 20, paddingBottom: 16, borderBottom: '1px solid var(--border-light)' }}>
            <h3 style={{ fontWeight: 800, textTransform: 'uppercase', letterSpacing: 1.5, color, fontSize: 14, display: 'flex', alignItems: 'center', gap: 10, margin: 0 }}>
                {icon} {title}
            </h3>
            {copyText && <CopyBtn text={copyText} id={copyId} copiedId={copiedId} onCopy={onCopy} />}
        </div>
        {children}
    </div>
);

// ─── Mermaid Utilities ───────────────────────────────────────────────────────

// Generate UNIQUE Mermaid node IDs — uses a per-chart Map to ensure
// two different labels never collide even if they share the same prefix.
// The Map is reset before every builder call via resetMIds() so IDs are
// local to each chart — no cross-chart collisions.
let _mIdCounter = 0;
let _mIdCache = new Map();
function mId(s) {
    const key = String(s);
    if (_mIdCache.has(key)) return _mIdCache.get(key);
    const safe = key.replace(/[^a-zA-Z0-9]/g, '_').slice(0, 20);
    const id = `n${safe}_${_mIdCounter++}`;
    _mIdCache.set(key, id);
    return id;
}
// Full reset before each builder — creates a fresh Map each time to prevent
// unbounded growth across many charts rendered during a long session.
function resetMIds() { _mIdCounter = 0; _mIdCache = new Map(); }

// Escape ALL Mermaid-special characters for use inside ["..."] labels.
// Mermaid interprets |, [, ], (, ), {, }, `, # as syntax — escape them all.
// Also truncate to prevent dagre layout overflow.
const mLabel = (s, maxLen = 50) => {
    let t = String(s || '');
    if (t.length > maxLen) t = t.slice(0, maxLen) + '…';
    return t
        .replace(/"/g, '#quot;')
        .replace(/\|/g, '#124;')
        .replace(/\[/g, '#91;')
        .replace(/\]/g, '#93;')
        .replace(/\(/g, '#40;')
        .replace(/\)/g, '#41;')
        .replace(/\{/g, '#123;')
        .replace(/\}/g, '#125;')
        .replace(/`/g, '#96;')
        .replace(/</g, '#lt;')
        .replace(/>/g, '#gt;');
};

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
    const valid = edges.filter(e => e && e.from && e.to);
    if (valid.length === 0) return null;
    resetMIds();
    const lines = ['sequenceDiagram'];
    valid.forEach(({ from, to, label, isBugPoint }) => {
        const fId = mId(from), tId = mId(to);
        const arrow = isBugPoint ? '-->>' : '->>';
        if (isBugPoint) lines.push(`    Note over ${fId},${tId}: BUG HERE`);
        lines.push(`    ${fId}${arrow}${tId}: ${mLabel(label, 40)}`);
    });
    return lines.join('\n');
}

// Build hypothesis elimination flowchart from hypothesisTree
function buildHypothesisMermaid(tree) {
    if (!tree || tree.length === 0) return null;
    resetMIds();
    const lines = ['flowchart TD'];
    tree.forEach(({ id, text, status, reason }, idx) => {
        const nodeId = `H${idx}`;
        const shortText = mLabel((text || '').slice(0, 40));
        if (status === 'survived') {
            const survivedId = `S${idx}`;
            lines.push(`    ${nodeId}["${mLabel(id || 'H' + idx, 25)}: ${shortText}"]`);
            lines.push(`    ${nodeId} --> ${survivedId}["Root Cause Confirmed"]`);
            lines.push(`    style ${nodeId} fill:#00ff88,color:#000`);
            lines.push(`    style ${survivedId} fill:#00ff88,color:#000`);
        } else {
            const elimId = `E${idx}`;
            lines.push(`    ${nodeId}["${mLabel(id || 'H' + idx, 25)}: ${shortText}"]`);
            lines.push(`    ${nodeId} -->|"${mLabel((reason || '').slice(0, 35))}"| ${elimId}["Eliminated"]`);
            lines.push(`    style ${nodeId} fill:#333,color:#fff`);
            lines.push(`    style ${elimId} fill:#ff3333,color:#fff`);
        }
    });
    return lines.join('\n');
}

// Build variable mutation flow from variableStateEdges
function buildVariableMermaid(varEdges) {
    if (!varEdges || varEdges.length === 0) return null;
    const result = [];
    varEdges.forEach(({ variable, edges }) => {
        if (!edges || edges.length < 3) return; // only show variables with meaningful flow
        const validEdges = edges.filter(e => e && e.from && e.to);
        if (validEdges.length < 3) return;
        resetMIds();
        const lines = ['flowchart LR'];
        // Shared nodeMap — shared nodes so the graph is connected, not disconnected pairs
        const nodeMap = new Map();
        const getNode = (label) => {
            if (nodeMap.has(label)) return nodeMap.get(label);
            const id = `V${nodeMap.size}`;
            nodeMap.set(label, id);
            lines.push(`    ${id}["${mLabel(label)}"]`);
            return id;
        };
        validEdges.forEach(({ from, to, label, type }) => {
            const f = getNode(from), t = getNode(to);
            lines.push(`    ${f} -->|"${mLabel(label, 30)}"| ${t}`);
            if (type === 'write')  lines.push(`    style ${f} fill:#ffaa00,color:#000`);
            if (type === 'read')   lines.push(`    style ${t} fill:#448aff,color:#fff`);
            if (type === 'mutate') lines.push(`    style ${f} fill:#ff003c,color:#fff`);
        });
        result.push({ variable, mermaid: lines.join('\n') });
    });
    return result.length > 0 ? result : null;
}


// Build data flow flowchart from flowchartEdges (Explain Mode)
function buildDataFlowMermaid(edges) {
    if (!edges || edges.length === 0) return null;
    const valid = edges.filter(e => e && e.from && e.to);
    if (valid.length === 0) return null;
    if (hasCycle(valid)) return null;
    resetMIds();
    const lines = ['flowchart TD'];
    const nodeMap = new Map();
    valid.forEach(({ from, to }) => {
        if (!nodeMap.has(from)) { const id = `D${nodeMap.size}`; nodeMap.set(from, id); lines.push(`    ${id}["${mLabel(from)}"]`); }
        if (!nodeMap.has(to)) { const id = `D${nodeMap.size}`; nodeMap.set(to, id); lines.push(`    ${id}["${mLabel(to)}"]`); }
    });
    valid.forEach(({ from, to, label }) => {
        lines.push(`    ${nodeMap.get(from)} -->|"${mLabel(label, 35)}"| ${nodeMap.get(to)}`);
    });
    return lines.join('\n');
}

// Build dependency graph from dependencyEdges (Explain Mode)
function buildDependencyMermaid(deps) {
    if (!deps || deps.length === 0) return null;
    resetMIds();
    const lines = ['graph LR'];
    const nodeMap = new Map();
    deps.forEach(({ file, imports }) => {
        if (!nodeMap.has(file)) { const id = `F${nodeMap.size}`; nodeMap.set(file, id); lines.push(`    ${id}["${mLabel(file)}"]`); }
        (imports || []).forEach(imp => {
            if (!nodeMap.has(imp)) { const id = `F${nodeMap.size}`; nodeMap.set(imp, id); lines.push(`    ${id}["${mLabel(imp)}"]`); }
            lines.push(`    ${nodeMap.get(file)} --> ${nodeMap.get(imp)}`);
        });
    });
    if (lines.length <= 1) return null; // only header, no edges
    return lines.join('\n');
}

// Build attack vector flowchart from attackVectorEdges (Security Mode)
function buildAttackVectorMermaid(edges) {
    if (!edges || edges.length === 0) return null;
    const valid = edges.filter(e => e && e.from && e.to);
    if (valid.length === 0) return null;
    resetMIds();
    const lines = ['flowchart TD'];
    const nodeMap = new Map();
    valid.forEach(({ from, to }) => {
        if (!nodeMap.has(from)) { const id = `X${nodeMap.size}`; nodeMap.set(from, id); lines.push(`    ${id}["${mLabel(from)}"]`); }
        if (!nodeMap.has(to)) { const id = `X${nodeMap.size}`; nodeMap.set(to, id); lines.push(`    ${id}["${mLabel(to)}"]`); }
    });
    valid.forEach(({ from, to, label, isExploitStep }) => {
        const f = nodeMap.get(from), t = nodeMap.get(to);
        lines.push(`    ${f} -->|"${mLabel(label, 35)}"| ${t}`);
        if (isExploitStep) {
            lines.push(`    style ${f} fill:#ff003c,color:#fff`);
            lines.push(`    style ${t} fill:#ff003c,color:#fff`);
        } else {
            lines.push(`    style ${f} fill:#ffaa00,color:#000`);
        }
    });
    return lines.join('\n');
}

// Mermaid renderer — uses mermaid.render() (off-DOM) instead of mermaid.run()
// to completely avoid null-ref issues from React StrictMode and streaming re-renders.
let _mermaidRenderCounter = 0;
function MermaidChart({ chart, caption }) {
    const containerRef = React.useRef(null);
    const renderIdRef = React.useRef(0);
    React.useEffect(() => {
        if (!chart || !containerRef.current) return;
        const currentRender = ++renderIdRef.current;
        const container = containerRef.current;
        const svgId = `mermaid_svg_${_mermaidRenderCounter++}`;

        // Use mermaid.render() — renders to SVG string without touching the DOM
        // This avoids ALL null-ref issues from run() operating on live DOM nodes
        const renderChart = async () => {
            try {
                if (!window.mermaid) return;
                const { svg } = await window.mermaid.render(svgId, chart);
                // Only apply if this is still the latest render and container exists
                if (currentRender === renderIdRef.current && container && container.isConnected) {
                    container.innerHTML = svg;
                }
            } catch (err) {
                // Silently degrade — don't spam console, show fallback
                if (currentRender === renderIdRef.current && container && container.isConnected) {
                    container.innerHTML = '<p style="color:#555;font-size:11px;font-family:monospace;padding:8px">⚠️ Diagram could not render</p>';
                }
                // Clean up any orphaned SVG element mermaid may have left in the DOM
                const orphan = document.getElementById(svgId);
                if (orphan) orphan.remove();
            }
        };
        renderChart();

        return () => {
            // Cleanup: abort stale renders
            renderIdRef.current++;
        };
    }, [chart]);
    if (!chart) return null;
    return (
        <div style={{ background: '#0a0a0a', border: '1px solid #333', padding: 16, marginTop: 12, borderRadius: 0, overflow: 'auto' }}>
            <div ref={containerRef} />
            {caption && <p style={{ fontFamily: "'JetBrains Mono',monospace", fontSize: 10, color: '#666', marginTop: 8, textTransform: 'uppercase', letterSpacing: 1 }}>{caption}</p>}
        </div>
    );
}

// ─── Main App ───────────────────────────────────────────
export default function App() {
    // State
    const [isInitialLoading, setIsInitialLoading] = useState(true);
    const [isSplashExiting, setIsSplashExiting] = useState(false);
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
    const [layerBoundary, setLayerBoundary] = useState(null); // LAYER_BOUNDARY verdict

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
    
    // ── Theming System ──
    const [theme, setTheme] = useState('dark');

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
            if (saved.theme) setTheme(saved.theme);
        } catch { /* ignore corrupt localStorage */ }
        
        // Initial splash screen with dissolve effect
        const exitTimer = setTimeout(() => setIsSplashExiting(true), 4800);
        const finishTimer = setTimeout(() => setIsInitialLoading(false), 5600); // 4.8s + 0.8s dissolve
        return () => { clearTimeout(exitTimer); clearTimeout(finishTimer); };
    }, []);
    
    // Apply theme to document root
    useEffect(() => {
        document.documentElement.setAttribute('data-theme', theme);
    }, [theme]);

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
        const prefs = { analysisMode, preset, outputSections, level, language, theme, ...overrides };
        localStorage.setItem('unravel_prefs', JSON.stringify(prefs));
    }, [analysisMode, preset, outputSections, level, language, theme]);

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
                onPartialResult: (partial) => {
                    // Progressive rendering: unwrap nested report (same as final handler)
                    // LLM returns { report: { rootCause: ..., evidence: ... } }
                    // but the UI expects flat { rootCause: ..., evidence: ... }
                    const reportData = partial.report || partial;
                    setReport(prev => prev ? { ...prev, ...reportData, _streaming: true } : { ...reportData, _streaming: true });
                    if (step !== 5) {
                        setViewMode('all');
                        setStep(5);
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
            if (result?.verdict === LAYER_BOUNDARY_VERDICT) {
                // Solvability check fired — root cause is upstream of this codebase.
                // Defensive: if a report also exists (shouldn't happen but guard anyway),
                // prefer the report and log the discrepancy.
                if (result?.report || result?.bugType || result?.rootCause) {
                    console.warn('[App] LAYER_BOUNDARY verdict present alongside report data — preferring report');
                    setReport(result.report || result);
                    setViewMode('all');
                    setStep(5);
                } else {
                    setLayerBoundary(result);
                    setStep(5);
                }
            } else if (analysisMode === 'explain' || analysisMode === 'security') {
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
        setStep(1); setReport(null); setLayerBoundary(null); setMissingFileRequest(null);
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
        wrap: { width: '100%', paddingLeft: 'min(5%, 40px)', paddingRight: 'min(5%, 40px)', margin: '0 auto' },
        label: { fontFamily: 'inherit', textTransform: 'uppercase', fontSize: 12, fontWeight: 700, letterSpacing: 1, display: 'flex', alignItems: 'center', gap: 8, marginBottom: 16, color: 'var(--text-secondary)' },
        optBtn: (active, accentColor = 'var(--accent-blue)') => ({
            padding: '16px 20px', fontWeight: 600, 
            border: '1px solid', borderColor: active ? accentColor : 'var(--border-light)', 
            background: active ? `var(--surface-active)` : 'var(--surface-base)', 
            color: active ? accentColor : 'var(--text-primary)', 
            cursor: 'pointer', fontFamily: 'inherit', fontSize: 14, 
            transition: 'all 0.2s', borderRadius: 'var(--radius-md)',
            backdropFilter: 'var(--blur-sm)', WebkitBackdropFilter: 'var(--blur-sm)',
            transform: active ? 'translateY(-2px)' : 'none',
            boxShadow: active ? `0 8px 16px rgba(0,0,0,0.1)` : 'none'
        }),
        tabBtn: (active) => ({
            flex: 1, padding: '16px', display: 'flex', alignItems: 'center', justifyContent: 'center', gap: 8, 
            fontFamily: 'inherit', fontWeight: 600, fontSize: 14, cursor: 'pointer', border: 'none', 
            borderBottom: active ? '2px solid var(--accent-blue)' : '2px solid transparent', 
            background: active ? 'var(--surface-hover)' : 'transparent', 
            color: active ? 'var(--text-primary)' : 'var(--text-secondary)', transition: 'all 0.2s',
        }),
    };

    // ═══ RENDER ═══════════════════════════════════════════

    return (
        <div id="app-root" style={{ position: 'relative', overflowX: 'hidden' }}>
            {isInitialLoading && (
                <div className={`splash-overlay ${isSplashExiting ? 'splash-exit' : ''}`}>
                    <BannerSplash />
                </div>
            )}

            <div className={isSplashExiting ? "app-dissolve-in" : ""} style={{ opacity: isInitialLoading && !isSplashExiting ? 0 : 1 }}>
                {/* Ambient background noise remains subtle */}
                <div className="bg-noise" />

                {/* Header */}
                <header style={{ borderBottom: '1px solid var(--border-light)', background: 'var(--surface-base)', backdropFilter: 'var(--blur-md)', WebkitBackdropFilter: 'var(--blur-md)', position: 'sticky', top: 0, zIndex: 50, transition: 'all 0.3s' }}>
                <div style={{ ...S.wrap, paddingTop: 16, paddingBottom: 16, display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
                    <div style={{ display: 'flex', alignItems: 'center', gap: 24 }}>
                        <div style={{ display: 'flex', alignItems: 'center', gap: 12, cursor: 'pointer' }} onClick={() => setStep(1)}>
                            <Logo isAnalyzing={isAnalyzing} />
                            <div>
                                <h1 style={{ fontSize: 22, fontWeight: 700, letterSpacing: '-0.02em', color: 'var(--text-primary)', margin: 0, lineHeight: 1 }}>
                                    Unravel<span style={{ color: 'transparent', backgroundClip: 'text', WebkitBackgroundClip: 'text', backgroundImage: 'linear-gradient(to right, #a855f7, #06b6d4)' }}>AI</span>
                                </h1>
                            </div>
                        </div>
                        
                        {/* Desktop Headline (Moved to header) */}
                        <div className="hide-on-mobile" style={{ borderLeft: '1px solid var(--border-heavy)', paddingLeft: 24 }}>
                            <h2 style={{ fontSize: 14, fontWeight: 500, color: 'var(--text-secondary)', margin: 0 }}>
                                Deterministic AI Debug Engine.
                            </h2>
                        </div>
                    </div>
                    
                    <div style={{ display: 'flex', alignItems: 'center', gap: 12 }}>
                        {/* Theme Toggle */}
                        <div style={{ display: 'flex', background: 'var(--surface-solid)', padding: 4, borderRadius: 'var(--radius-full)', border: '1px solid var(--border-light)' }}>
                            <button onClick={() => setTheme('light')} style={{ padding: 6, borderRadius: 'var(--radius-full)', background: theme === 'light' ? 'var(--surface-hover)' : 'transparent', color: theme === 'light' ? 'var(--text-primary)' : 'var(--text-tertiary)', border: 'none' }}>
                                <Sun size={14} />
                            </button>
                            <button onClick={() => setTheme('dark')} style={{ padding: 6, borderRadius: 'var(--radius-full)', background: theme === 'dark' ? 'var(--surface-hover)' : 'transparent', color: theme === 'dark' ? 'var(--text-primary)' : 'var(--text-tertiary)', border: 'none' }}>
                                <Moon size={14} />
                            </button>
                            <button onClick={() => setTheme('slate')} style={{ padding: 6, borderRadius: 'var(--radius-full)', background: theme === 'slate' ? 'var(--surface-hover)' : 'transparent', color: theme === 'slate' ? 'var(--text-primary)' : 'var(--text-tertiary)', border: 'none' }}>
                                <Monitor size={14} />
                            </button>
                        </div>

                        {step > 1 && <button className="matte-button" onClick={reset}>← Reset</button>}
                    </div>
                </div>
            </header>

            <main style={{ ...S.wrap, paddingTop: 48, paddingBottom: 40, position: 'relative', zIndex: 10 }}>

                {/* ═══ STEP 1: Profile + API Key ═══ */}
                {step === 1 && (
                    <div className="animate-in" style={{ margin: '0 auto', display: 'flex', flexDirection: 'column', gap: 32 }}>
                        
                        {/* Provider & Key Configuration */}
                        <div className="glass-panel" style={{ padding: 32 }}>
                            <div style={{ ...S.label, color: 'var(--accent-red)' }}>
                                <Key size={16} /> Connection Configuration
                            </div>
                            
                            <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(300px, 1fr))', gap: 32 }}>
                                <div>
                                    <div style={{ marginBottom: 16, fontSize: 13, color: 'var(--text-secondary)' }}>Select your primary AI provider:</div>
                                    <div style={{ display: 'flex', gap: 12, flexWrap: 'wrap', marginBottom: 24 }}>
                                        {Object.entries(PROVIDERS).map(([key, p]) => (
                                            <button key={key} style={S.optBtn(provider === key, 'var(--accent-red)')} onClick={() => setProvider(key)}>
                                                {p.name}
                                            </button>
                                        ))}
                                    </div>
                                    
                                    {prov && (
                                        <>
                                            <div style={{ marginBottom: 16, fontSize: 13, color: 'var(--text-secondary)' }}>Choose a model tier:</div>
                                            <div style={{ display: 'flex', gap: 12, flexWrap: 'wrap' }}>
                                                {Object.entries(prov.models).map(([key, m]) => (
                                                    <button key={key} style={S.optBtn(model === m.id, 'var(--accent-cyan)')} onClick={() => setModel(m.id)}>
                                                        <div style={{ fontWeight: 600 }}>{m.label}</div>
                                                        <div style={{ fontSize: 11, color: 'var(--text-tertiary)', marginTop: 4 }}>{m.tier} tier</div>
                                                    </button>
                                                ))}
                                            </div>
                                        </>
                                    )}
                                </div>
                                
                                <div style={{ display: 'flex', flexDirection: 'column', justifyContent: 'center' }}>
                                    <div style={{ marginBottom: 16, fontSize: 13, color: 'var(--text-secondary)' }}>Authentication:</div>
                                    <div style={{ position: 'relative' }}>
                                        <input
                                            type={showKey ? 'text' : 'password'}
                                            className="glass-input"
                                            style={{ width: '100%', paddingRight: 80, fontSize: 14 }}
                                            placeholder={`Enter ${prov?.name || ''} API key`}
                                            value={apiKey}
                                            onChange={(e) => { setApiKey(e.target.value); storeKey(provider, e.target.value); }}
                                        />
                                        <button onClick={() => setShowKey(!showKey)} style={{ position: 'absolute', right: 12, top: '50%', transform: 'translateY(-50%)', background: 'var(--surface-hover)', borderRadius: 'var(--radius-sm)', border: '1px solid var(--border-light)', color: 'var(--text-secondary)', fontSize: 11, fontWeight: 600, padding: '4px 8px', cursor: 'pointer', transition: 'all 0.2s' }}>
                                            {showKey ? 'HIDE' : 'SHOW'}
                                        </button>
                                    </div>
                                    <div style={{ display: 'flex', alignItems: 'center', gap: 8, marginTop: 12, color: 'var(--text-tertiary)', fontSize: 12 }}>
                                        <Shield size={14} />
                                        Stored locally in browser localStorage. Never transmitted elsewhere.
                                    </div>
                                </div>
                            </div>
                        </div>

                        <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(400px, 1fr))', gap: 32 }}>
                            {/* Level Settings */}
                            <div className="glass-panel" style={{ padding: 32 }}>
                                <div style={{ ...S.label, color: 'var(--accent-green)' }}><TerminalSquare size={16} /> Interpretation Depth</div>
                                <div style={{ display: 'grid', gridTemplateColumns: '1fr', gap: 12 }}>
                                    {Object.entries(LEVELS).map(([key, v]) => (
                                        <button key={key} style={{ ...S.optBtn(level === key, 'var(--accent-green)'), display: 'flex', alignItems: 'center', gap: 16, textAlign: 'left' }} onClick={() => setLevel(key)}>
                                            <div style={{ color: level === key ? 'var(--accent-green)' : 'var(--text-tertiary)' }}>{ICON_MAP[v.icon]}</div>
                                            <div>
                                                <div style={{ fontSize: 15, fontWeight: 600 }}>{v.label}</div>
                                                <div style={{ fontSize: 12, color: level === key ? 'var(--text-primary)' : 'var(--text-secondary)', marginTop: 4, fontWeight: 400 }}>{v.desc}</div>
                                            </div>
                                        </button>
                                    ))}
                                </div>
                            </div>

                            {/* Language Settings */}
                            <div className="glass-panel" style={{ padding: 32 }}>
                                <div style={{ ...S.label, color: 'var(--accent-purple)' }}><Globe2 size={16} /> Output Language</div>
                                <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fill, minmax(140px, 1fr))', gap: 12 }}>
                                    {Object.entries(LANGUAGES).map(([key, v]) => (
                                        <button key={key} style={{ ...S.optBtn(language === key, 'var(--accent-purple)'), display: 'flex', flexDirection: 'column', alignItems: 'center', justifyContent: 'center', gap: 8, padding: '24px 16px' }} onClick={() => setLanguage(key)}>
                                            <div style={{ color: language === key ? 'var(--accent-purple)' : 'var(--text-tertiary)' }}>{ICON_MAP[v.icon]}</div>
                                            <div style={{ fontSize: 14 }}>{v.label}</div>
                                        </button>
                                    ))}
                                </div>
                            </div>
                        </div>

                        {/* Continue Button */}
                        <div style={{ display: 'flex', justifyContent: 'flex-end', marginTop: 16 }}>
                            <button className="matte-button primary" style={{ padding: '16px 40px', fontSize: 16, borderRadius: 'var(--radius-lg)' }}
                                disabled={!apiKey.trim()} onClick={() => setStep(2)}>
                                Initialize Context <ChevronRight size={18} />
                            </button>
                        </div>
                    </div>
                )}

                {/* ═══ STEP 2: Code Input ═══ */}
                {step === 2 && (
                    <div className="animate-in" style={{ margin: '0 auto', display: 'flex', flexDirection: 'column', gap: 32 }}>
                        
                        {/* Tabs */}
                        <div style={{ display: 'flex', gap: 8, background: 'var(--surface-base)', padding: 6, borderRadius: 'var(--radius-lg)', backdropFilter: 'var(--blur-md)' }}>
                            <button onClick={() => setInputType('upload')}
                                className={inputType === 'upload' ? 'matte-button active' : 'matte-button'} style={{flex: 1, padding: '12px 16px', background: inputType === 'upload' ? 'var(--surface-hover)' : 'transparent', color: inputType === 'upload' ? 'var(--accent-blue)' : 'var(--text-secondary)', border: 'none'}}>
                                <FolderTree size={16} /> Folder Upload
                            </button>
                            <button onClick={() => setInputType('paste')}
                                className={inputType === 'paste' ? 'matte-button active' : 'matte-button'} style={{flex: 1, padding: '12px 16px', background: inputType === 'paste' ? 'var(--surface-hover)' : 'transparent', color: inputType === 'paste' ? 'var(--accent-cyan)' : 'var(--text-secondary)', border: 'none'}}>
                                <FileCode size={16} /> Raw Paste
                            </button>
                            <button onClick={() => setInputType('github')}
                                className={inputType === 'github' ? 'matte-button active' : 'matte-button'} style={{flex: 1, padding: '12px 16px', background: inputType === 'github' ? 'var(--surface-hover)' : 'transparent', color: inputType === 'github' ? 'var(--accent-purple)' : 'var(--text-secondary)', border: 'none'}}>
                                <Github size={16} /> GitHub Import
                            </button>
                        </div>

                        <div className="glass-panel" style={{ padding: 32, display: 'flex', flexDirection: 'column', gap: 24 }}>
                            {inputType === 'upload' && (
                                <div className="animate-fade-in">
                                    <div style={{ background: 'var(--accent-cyan)22', borderLeft: '4px solid var(--accent-cyan)', padding: '16px 20px', borderRadius: '4px', fontSize: 13, marginBottom: 24, display: 'flex', flexDirection: 'column', gap: 8 }}>
                                        <strong style={{ display: 'flex', alignItems: 'center', gap: 8, color: 'var(--accent-cyan)' }}><Search size={16} /> SMART ROUTING ACTIVE</strong>
                                        <span style={{ color: 'var(--text-secondary)' }}>Upload entire folder. AI will selectively read relevant files only, saving tokens and time.</span>
                                    </div>
                                    <div onClick={() => dirInputRef.current?.click()}
                                        style={{ border: '2px dashed var(--border-heavy)', background: 'var(--surface-base)', borderRadius: 'var(--radius-lg)', padding: 64, textAlign: 'center', cursor: 'pointer', transition: 'all 0.2s', display: 'flex', flexDirection: 'column', alignItems: 'center', justifyContent: 'center' }}
                                        onMouseEnter={(e) => { e.currentTarget.style.borderColor = 'var(--accent-cyan)'; e.currentTarget.style.background = 'var(--surface-hover)'; }}
                                        onMouseLeave={(e) => { e.currentTarget.style.borderColor = 'var(--border-heavy)'; e.currentTarget.style.background = 'var(--surface-base)'; }}>
                                        <UploadCloud size={48} color="var(--accent-cyan)" style={{ marginBottom: 16, opacity: 0.8 }} />
                                        <p style={{ fontWeight: 600, fontSize: 16, color: 'var(--text-primary)' }}>
                                            {directoryFiles.length > 0 ? 'Add More Files' : 'Drop Project Folder Here'}
                                        </p>
                                        <p style={{ color: 'var(--text-tertiary)', fontSize: 13, marginTop: 8 }}>or click to browse</p>
                                        <input type="file" webkitdirectory="true" directory="true" multiple ref={dirInputRef} onChange={handleDirectoryUpload} style={{ display: 'none' }} />
                                    </div>
                                    {directoryFiles.length > 0 && (
                                        <div style={{ marginTop: 24, border: '1px solid var(--border-light)', borderRadius: 'var(--radius-md)', overflow: 'hidden' }}>
                                            <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', padding: '12px 16px', borderBottom: '1px solid var(--border-light)', background: 'var(--surface-active)' }}>
                                                <span style={{ fontSize: 12, color: 'var(--accent-green)', fontWeight: 600, display: 'flex', alignItems: 'center', gap: 8 }}>
                                                    <CheckSquare size={14} />
                                                    {directoryFiles.length} FILE{directoryFiles.length !== 1 ? 'S' : ''} READY
                                                </span>
                                                <button onClick={() => setDirectoryFiles([])} className="matte-button" style={{ fontSize: 11, padding: '4px 8px', borderRadius: '4px' }}>
                                                    Clear All
                                                </button>
                                            </div>
                                            <div style={{ maxHeight: 240, overflowY: 'auto', background: 'var(--surface-base)' }}>
                                                {directoryFiles.map((f, idx) => (
                                                    <div key={idx} style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', padding: '8px 16px', borderBottom: idx < directoryFiles.length - 1 ? '1px solid var(--border-light)' : 'none', fontSize: 13 }}>
                                                        <span style={{ color: 'var(--text-secondary)', overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap', flex: 1, display: 'flex', alignItems: 'center', gap: 8 }}>
                                                            <FileCode size={14} color="var(--text-tertiary)" />
                                                            {f.webkitRelativePath || f.name}
                                                        </span>
                                                        <button onClick={() => removeDirectoryFile(idx)} style={{ background: 'none', border: 'none', color: 'var(--text-tertiary)', cursor: 'pointer', padding: '4px', borderRadius: '4px', transition: 'all 0.2s' }}
                                                            onMouseEnter={e => { e.currentTarget.style.color = 'var(--accent-red)'; e.currentTarget.style.background = 'var(--surface-hover)'; }}
                                                            onMouseLeave={e => { e.currentTarget.style.color = 'var(--text-tertiary)'; e.currentTarget.style.background = 'transparent'; }}>
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
                                <div className="animate-fade-in">
                                    <div style={{ background: 'var(--accent-purple)22', borderLeft: '4px solid var(--accent-purple)', padding: '16px 20px', borderRadius: '4px', fontSize: 13, marginBottom: 24, display: 'flex', flexDirection: 'column', gap: 8 }}>
                                        <strong style={{ display: 'flex', alignItems: 'center', gap: 8, color: 'var(--accent-purple)' }}><Github size={16} /> PUBLIC REPOS & ISSUES</strong>
                                        <span style={{ color: 'var(--text-secondary)' }}>Paste a repo URL or an Issue URL. Unravel processes issues automatically.</span>
                                    </div>
                                    <div style={{ display: 'flex', gap: 12, alignItems: 'center' }}>
                                        <div style={{ position: 'relative', flex: 1 }}>
                                            <Link size={16} style={{ position: 'absolute', left: 16, top: '50%', transform: 'translateY(-50%)', color: 'var(--text-tertiary)' }} />
                                            <input
                                                type="text"
                                                className="glass-input"
                                                style={{ width: '100%', paddingLeft: 44 }}
                                                placeholder="https://github.com/user/repo  or  https://github.com/user/repo/issues/123"
                                                value={githubUrl}
                                                onChange={(e) => setGithubUrl(e.target.value)}
                                            />
                                        </div>
                                        {githubUrl.trim() && (
                                            <div style={{ display: 'flex', alignItems: 'center', gap: 8, padding: '0 12px' }}>
                                                <CheckSquare size={16} color="var(--accent-green)" />
                                                <span style={{ fontSize: 12, color: 'var(--text-secondary)' }}>Ready</span>
                                            </div>
                                        )}
                                    </div>
                                    {githubError && (
                                        <div style={{ background: 'rgba(255,59,48,0.1)', border: '1px solid rgba(255,59,48,0.3)', padding: 12, borderRadius: 'var(--radius-sm)', color: 'var(--accent-red)', fontSize: 13, marginTop: 16, display: 'flex', alignItems: 'center', gap: 8 }}>
                                            <AlertTriangle size={16} /> {githubError}
                                        </div>
                                    )}
                                </div>
                            )}

                            {inputType === 'paste' && (
                                <div className="animate-fade-in" style={{ display: 'flex', flexDirection: 'column', gap: 16 }}>
                                    {pastedFiles.map((file, idx) => (
                                        <div key={idx} style={{ border: '1px solid var(--border-light)', borderRadius: 'var(--radius-md)', background: 'var(--surface-base)', overflow: 'hidden' }}>
                                            <input type="text" placeholder="filename.js (optional)" value={file.name}
                                                className="glass-input"
                                                onChange={(e) => { const nf = [...pastedFiles]; nf[idx].name = e.target.value; setPastedFiles(nf); }}
                                                style={{ border: 'none', borderBottom: '1px solid var(--border-light)', borderRadius: 0, fontWeight: 600, color: 'var(--accent-cyan)' }}
                                            />
                                            <textarea placeholder="// Paste source code here..." value={file.content}
                                                onChange={(e) => { const nf = [...pastedFiles]; nf[idx].content = e.target.value; setPastedFiles(nf); }}
                                                className="glass-input font-code"
                                                style={{ border: 'none', borderRadius: 0, minHeight: 160, resize: 'vertical', background: 'transparent' }}
                                            />
                                        </div>
                                    ))}
                                    <button onClick={() => setPastedFiles([...pastedFiles, { name: '', content: '' }])}
                                        className="matte-button" style={{ borderStyle: 'dashed', padding: 16 }}>
                                        <Plus size={16} /> Add Another File Block
                                    </button>
                                </div>
                            )}

                            {/* ═══ MODE + PRESET SELECTOR ═══ */}
                            <div style={{ borderTop: '1px solid var(--border-light)', paddingTop: 32, marginTop: 8 }}>
                                <div style={S.label}><BrainCircuit size={16} /> Analysis Engine Mode</div>
                                <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(200px, 1fr))', gap: 16, marginBottom: 32 }}>
                                    {[
                                        { key: 'debug', label: 'Debug', icon: <Bug size={24} />, color: 'var(--accent-red)', desc: 'Find & fix complex bugs' },
                                        { key: 'explain', label: 'Explain', icon: <Eye size={24} />, color: 'var(--accent-cyan)', desc: 'Understand codebase' },
                                        { key: 'security', label: 'Security', icon: <Shield size={24} />, color: 'var(--accent-orange)', desc: 'Audit vulnerabilities', beta: true },
                                    ].map(m => (
                                        <button key={m.key} onClick={() => { setAnalysisMode(m.key); if (m.key !== 'debug') setPreset('full'); }}
                                            style={{
                                                ...S.optBtn(analysisMode === m.key, m.color),
                                                display: 'flex', flexDirection: 'column', alignItems: 'center', gap: 12, padding: '24px 16px', position: 'relative'
                                            }}>
                                            {m.beta && <span style={{ position: 'absolute', top: 8, right: 12, fontSize: 10, fontWeight: 700, color: m.color, background: `${m.color}22`, padding: '2px 6px', borderRadius: 4 }}>BETA</span>}
                                            <div style={{ color: analysisMode === m.key ? m.color : 'var(--text-tertiary)' }}>{m.icon}</div>
                                            <div style={{ fontWeight: 700, fontSize: 15, letterSpacing: '0.02em' }}>{m.label}</div>
                                            <div style={{ fontSize: 12, opacity: 0.8, fontWeight: 400, marginTop: -4 }}>{m.desc}</div>
                                        </button>
                                    ))}
                                </div>

                                {/* Preset Selector — only for Debug mode */}
                                {analysisMode === 'debug' && (
                                    <div style={{ marginBottom: 24 }}>
                                        <div style={S.label}><Zap size={16} /> Output Report Style</div>
                                        <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(150px, 1fr))', gap: 12 }}>
                                            {Object.entries(PRESETS).map(([key, p]) => (
                                                <button key={key} onClick={() => { setPreset(key); if (key !== 'custom') setOutputSections(null); }}
                                                    style={{...S.optBtn(preset === key, 'var(--accent-green)'), padding: '16px', textAlign: 'left', display: 'flex', flexDirection: 'column', gap: 4 }}>
                                                    <div style={{ fontSize: 14, fontWeight: 600 }}>{p.label}</div>
                                                    <div style={{ fontSize: 11, fontWeight: 400, opacity: 0.8 }}>{p.description}</div>
                                                </button>
                                            ))}
                                        </div>
                                    </div>
                                )}

                                {/* Section Toggles — only for Custom preset */}
                                {analysisMode === 'debug' && preset === 'custom' && (
                                    <div className="animate-fade-in" style={{ marginBottom: 24, background: 'var(--surface-hover)', borderRadius: 'var(--radius-md)', padding: 20 }}>
                                        <div style={{ ...S.label, fontSize: 11, marginBottom: 12 }}>Toggle Custom Sections</div>
                                        <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fill, minmax(220px, 1fr))', gap: 10 }}>
                                            {Object.entries(SECTION_REGISTRY).filter(([, s]) => s.modes.includes('debug')).map(([key, sec]) => {
                                                const active = (outputSections || PRESETS.full.sections).includes(key);
                                                const costColor = sec.tokenCost === 'high' ? 'var(--accent-red)' : sec.tokenCost === 'medium' ? 'var(--accent-orange)' : 'var(--text-secondary)';
                                                return (
                                                    <button key={key} onClick={() => {
                                                        const current = outputSections || [...PRESETS.full.sections];
                                                        setOutputSections(active ? current.filter(s => s !== key) : [...current, key]);
                                                    }}
                                                        style={{
                                                            padding: '12px 14px', display: 'flex', alignItems: 'center', justifyContent: 'space-between', borderRadius: 'var(--radius-sm)',
                                                            border: '1px solid', borderColor: active ? 'var(--accent-blue)' : 'var(--border-light)',
                                                            background: active ? 'var(--accent-blue)22' : 'var(--surface-base)',
                                                            color: active ? 'var(--text-primary)' : 'var(--text-secondary)',
                                                            cursor: 'pointer', fontSize: 13, transition: 'all 0.15s',
                                                        }}>
                                                        <span>{sec.label}</span>
                                                        <span style={{ fontSize: 10, color: costColor, fontWeight: 600 }}>{sec.tokenCost.toUpperCase()}</span>
                                                    </button>
                                                );
                                            })}
                                        </div>
                                    </div>
                                )}

                                {/* Symptom / Intent field */}
                                <div style={{ borderTop: '1px solid var(--border-light)', paddingTop: 24, marginTop: 16 }}>
                                    <div style={{ ...S.label, color: 'var(--text-primary)' }}>
                                        <Activity size={16} />
                                        {analysisMode === 'debug' ? 'Define The Symptom' : analysisMode === 'explain' ? 'What To Explain' : 'Security Concerns'}
                                        <span style={{ color: 'var(--text-tertiary)', fontWeight: 400, marginLeft: 8 }}>(Optional)</span>
                                    </div>
                                    <textarea className="glass-input" value={userError} onChange={(e) => setUserError(e.target.value)}
                                        placeholder={analysisMode === 'debug'
                                            ? "Describe the bug — what happens vs what you expected. Include stack traces if you have them..."
                                            : analysisMode === 'explain'
                                                ? "What do you want to understand about this code? Leave empty for full architecture overview."
                                                : "Any specific security concerns? Leave empty to scan for common vulnerabilities."
                                        } 
                                        style={{ minHeight: 120 }}
                                    />
                                </div>

                                {analysisError && (
                                    <div style={{ background: 'rgba(255,59,48,0.1)', border: '1px solid rgba(255,59,48,0.3)', padding: 16, borderRadius: 'var(--radius-md)', color: 'var(--accent-red)', fontSize: 14, marginTop: 24, display: 'flex', alignItems: 'flex-start', gap: 12 }}>
                                        <AlertTriangle size={20} style={{ flexShrink: 0 }} /> 
                                        <div style={{ lineHeight: 1.5 }}>{analysisError}</div>
                                    </div>
                                )}
                            </div>

                            {/* Execute Actions */}
                            {(() => {
                                const fileCount = inputType === 'upload' ? directoryFiles.length : inputType === 'paste' ? pastedFiles.filter(f => f.content.trim()).length : 1;
                                const totalLines = inputType === 'paste' ? pastedFiles.reduce((sum, f) => sum + (f.content.match(/\n/g) || []).length, 0) : fileCount * 80;
                                const est = estimateRuntime(fileCount, totalLines, provider, preset);
                                return (
                                    <div style={{ display: 'flex', flexDirection: 'column', alignItems: 'center', marginTop: 16 }}>
                                        <button className="matte-button primary" style={{ padding: '20px 48px', fontSize: 18, borderRadius: 'var(--radius-lg)', width: '100%', maxWidth: 400, display: 'flex', gap: 12 }}
                                            disabled={!canExecute || isAnalyzing} onClick={() => executeAnalysis(false)}>
                                            {analysisMode === 'debug' ? 'Execute Engine' : analysisMode === 'explain' ? 'Explain Code' : 'Run Security Audit'}
                                            <Zap size={22} />
                                        </button>
                                        <div style={{ display: 'flex', justifyContent: 'center', gap: 16, color: 'var(--text-tertiary)', fontSize: 13, marginTop: 16 }}>
                                            {canExecute && <span>Est. pipeline runtime: {est.min}-{est.max}s</span>}
                                            <span style={{ opacity: 0.5 }}>•</span>
                                            <span>{analysisMode.toUpperCase()} | {prov?.models[Object.keys(prov.models).find(k => prov.models[k].id === model)]?.label || model}</span>
                                        </div>
                                    </div>
                                );
                            })()}
                        </div>
                    </div>
                )}

                {/* ═══ STEP 3: Loading with Structured Progress ═══ */}
                {step === 3 && (
                    <div className="animate-in" style={{ paddingTop: 10, display: 'flex', flexDirection: 'column', alignItems: 'center', textAlign: 'center' }}>
                        <SvgLoader />
                        <h2 style={{ fontSize: 32, fontWeight: 800, textTransform: 'uppercase', color: 'var(--text-primary)', letterSpacing: 2, marginBottom: 8 }}>
                            {analysisMode === 'debug' ? 'Engine Active' : analysisMode === 'explain' ? 'Explaining' : 'Auditing'}
                        </h2>
                        <p style={{ color: 'var(--text-secondary)', fontSize: 13, marginBottom: 32, fontWeight: 500 }}>
                            {analysisMode.toUpperCase()} mode • {PRESETS[preset]?.label || preset}
                        </p>

                        {/* Structured Progress Bar */}
                        <div className="glass-panel" style={{ width: '100%', maxWidth: 540, padding: 24, textAlign: 'left' }}>
                            <div style={{ fontSize: 12, fontWeight: 700, color: 'var(--text-secondary)', textTransform: 'uppercase', marginBottom: 16, letterSpacing: 1 }}>Pipeline Progress</div>
                            <div style={{ borderTop: '1px solid var(--border-light)', paddingTop: 16, display: 'flex', flexDirection: 'column', gap: 12 }}>
                                {['input', 'ast', 'engine', 'parse', 'complete'].map(stageId => {
                                    const stg = progressStages.find(s => s.stage === stageId);
                                    const labels = { input: 'Input Validation', ast: 'AST Pre-Analysis', engine: 'AI Engine', parse: 'Parse Response', complete: 'Complete' };
                                    const isActive = stg && !stg.complete;
                                    const isDone = stg && stg.complete;
                                    return (
                                        <div key={stageId} style={{ display: 'flex', alignItems: 'center', gap: 12, fontSize: 14 }}>
                                            <span style={{ width: 24, display: 'flex', justifyContent: 'center' }}>
                                                {isDone ? <CheckSquare size={16} color="var(--accent-green)" /> : isActive ? <Loader2 size={16} className="animate-spin" style={{ color: 'var(--accent-cyan)' }} /> : <div style={{ width: 8, height: 8, borderRadius: '50%', background: 'var(--border-heavy)' }} />}
                                            </span>
                                            <span style={{ flex: 1, color: isDone ? 'var(--text-tertiary)' : isActive ? 'var(--text-primary)' : 'var(--text-secondary)', fontWeight: isActive ? 600 : 400 }}>
                                                {labels[stageId] || stageId}
                                            </span>
                                            {stg && <span style={{ color: 'var(--text-tertiary)', fontSize: 11, fontWeight: 500 }}>{stg.elapsed}s</span>}
                                        </div>
                                    );
                                })}
                            </div>
                            {/* Current text status */}
                            <div style={{ borderTop: '1px solid var(--border-light)', marginTop: 16, paddingTop: 16 }}>
                                <p style={{ color: 'var(--accent-cyan)', fontSize: 13, display: 'flex', alignItems: 'center', gap: 8, margin: 0, fontWeight: 500 }}>
                                    <Loader2 size={14} className="animate-spin" /> {loadingStage || 'Initializing...'}
                                </p>
                            </div>
                        </div>
                    </div>
                )}

                {/* ═══ STEP 3.5: Missing Files ═══ */}
                {step === 3.5 && missingFileRequest && (
                    <div className="animate-slide-up" style={{ maxWidth: 800, margin: '0 auto', paddingTop: 40 }}>
                        <div className="glass-panel" style={{ padding: 40, borderLeft: '4px solid var(--accent-orange)' }}>
                            <div style={{ display: 'flex', alignItems: 'flex-start', gap: 16, marginBottom: 24, paddingBottom: 24, borderBottom: '1px solid var(--border-light)' }}>
                                <PauseCircle size={48} color="var(--accent-orange)" />
                                <div>
                                    <h2 style={{ fontSize: 28, fontWeight: 800, color: 'var(--text-primary)', margin: '0 0 8px 0' }}>Analysis Paused</h2>
                                    <p style={{ color: 'var(--text-secondary)', fontWeight: 500, margin: 0 }}>Engine needs more context to avoid hallucinating.</p>
                                </div>
                            </div>
                            <p style={{ fontSize: 15, marginBottom: 24, color: 'var(--text-primary)', lineHeight: 1.6 }}>
                                <strong style={{ color: 'var(--accent-orange)' }}>Reason:</strong> {missingFileRequest.reason}
                            </p>
                            {additionalFiles.map((file, idx) => (
                                <div key={idx} style={{ background: 'var(--surface-base)', border: '1px solid var(--border-light)', borderRadius: 'var(--radius-md)', padding: 16, marginBottom: 16 }}>
                                    <label style={{ fontWeight: 600, color: 'var(--text-primary)', marginBottom: 12, display: 'flex', alignItems: 'center', gap: 8 }}>
                                        <FileCode size={16} /> {file.name}
                                    </label>
                                    <textarea placeholder="Paste contents here..." value={file.content}
                                        className="glass-input font-code"
                                        onChange={(e) => { const nf = [...additionalFiles]; nf[idx].content = e.target.value; setAdditionalFiles(nf); }}
                                        style={{ width: '100%', minHeight: 120, resize: 'vertical' }}
                                    />
                                </div>
                            ))}
                            <button className="matte-button primary" style={{ marginTop: 16, width: '100%', padding: '16px', fontSize: 16 }}
                                disabled={additionalFiles.some(f => !f.content.trim())} onClick={() => executeAnalysis(true)}>
                                Resume Engine →
                            </button>
                        </div>
                    </div>
                )}

                {/* ═══ STEP 5: LAYER_BOUNDARY — Upstream Issue Card ═══ */}
                {step === 5 && layerBoundary && !report && (
                    <div className="animate-slide-up" style={{ maxWidth: 1000, margin: '0 auto', paddingBottom: 80 }}>
                        {/* Header */}
                        <div className="glass-header" style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'flex-end', borderBottom: '1px solid var(--accent-orange)', paddingBottom: 16, marginBottom: 32, position: 'sticky', top: 72, zIndex: 15, paddingTop: 16, gap: 12, flexWrap: 'wrap' }}>
                            <div>
                                <div style={{ display: 'flex', gap: 8, marginBottom: 8, flexWrap: 'wrap' }}>
                                    <span style={{ fontSize: 11, background: 'var(--accent-orange)22', color: 'var(--accent-orange)', border: '1px solid var(--accent-orange)', padding: '4px 10px', borderRadius: 'var(--radius-sm)', textTransform: 'uppercase', fontWeight: 700, letterSpacing: 1 }}>
                                        UPSTREAM ISSUE
                                    </span>
                                    <span style={{ fontSize: 11, background: 'var(--surface-base)', color: 'var(--text-secondary)', border: '1px solid var(--border-light)', padding: '4px 10px', borderRadius: 'var(--radius-sm)', textTransform: 'uppercase', fontWeight: 600 }}>
                                        CFD: {Math.round((layerBoundary.confidence || 0) * 100)}%
                                    </span>
                                </div>
                                <h2 style={{ fontSize: 32, fontWeight: 800, color: 'var(--text-primary)', textTransform: 'uppercase', margin: 0, letterSpacing: -0.5 }}>
                                    Fix Impossible Here
                                </h2>
                            </div>
                            <button className="matte-button" onClick={reset}>← New Analysis</button>
                        </div>

                        {/* Layer boundary explanation */}
                        <div className="glass-panel" style={{ borderLeft: '4px solid var(--accent-orange)', padding: 32, marginBottom: 24 }}>
                            <div style={{ display: 'flex', alignItems: 'center', gap: 12, marginBottom: 16 }}>
                                <AlertTriangle size={24} color="var(--accent-orange)" />
                                <span style={{ fontSize: 13, color: 'var(--accent-orange)', fontWeight: 700, textTransform: 'uppercase', letterSpacing: 1 }}>
                                    Layer Boundary Detected
                                </span>
                            </div>
                            <p style={{ color: 'var(--text-secondary)', fontSize: 16, lineHeight: 1.8, margin: 0 }}>
                                {layerBoundary.reason}
                            </p>
                        </div>

                        {/* Root cause layer */}
                        <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(280px, 1fr))', gap: 16, marginBottom: 24 }}>
                            <div className="glass-panel" style={{ padding: 24 }}>
                                <div style={{ fontSize: 11, color: 'var(--text-tertiary)', fontWeight: 600, textTransform: 'uppercase', marginBottom: 8, letterSpacing: 1 }}>Root Cause Layer</div>
                                <div style={{ color: 'var(--accent-red)', fontSize: 16, fontWeight: 700 }}>{layerBoundary.rootCauseLayer}</div>
                            </div>
                            <div className="glass-panel" style={{ padding: 24 }}>
                                <div style={{ fontSize: 11, color: 'var(--text-tertiary)', fontWeight: 600, textTransform: 'uppercase', marginBottom: 8, letterSpacing: 1 }}>Where the Fix Must Go</div>
                                <div style={{ color: 'var(--accent-green)', fontSize: 16, fontWeight: 700 }}>{layerBoundary.suggestedFixLayer}</div>
                            </div>
                        </div>

                        {/* Visual layer stack */}
                        <div className="glass-panel" style={{ padding: 32, marginBottom: 24 }}>
                            <div style={{ fontSize: 11, color: 'var(--text-tertiary)', fontWeight: 600, textTransform: 'uppercase', marginBottom: 24, letterSpacing: 1 }}>Call Stack — Where Information Was Lost</div>
                            {[
                                { label: layerBoundary.rootCauseLayer, isBug: true },
                                { label: 'Browser / Runtime Event System', isBug: false },
                                { label: 'Your Codebase (provided files)', isBug: false, isHere: true },
                            ].map((layer, i) => (
                                <div key={i} style={{ display: 'flex', alignItems: 'center', gap: 16, marginBottom: i < 2 ? 0 : 0 }}>
                                    <div style={{ display: 'flex', flexDirection: 'column', alignItems: 'center' }}>
                                        <div style={{ width: 14, height: 14, borderRadius: '50%', background: layer.isBug ? 'var(--accent-red)' : layer.isHere ? 'var(--accent-green)' : 'var(--text-tertiary)', border: `2px solid ${layer.isBug ? 'var(--accent-red)55' : layer.isHere ? 'var(--accent-green)55' : 'transparent'}` }} />
                                        {i < 2 && <div style={{ width: 2, height: 32, background: 'var(--border-heavy)', margin: '4px 0' }} />}
                                    </div>
                                    <div style={{ fontSize: 14, fontWeight: 500, color: layer.isBug ? 'var(--accent-red)' : layer.isHere ? 'var(--accent-green)' : 'var(--text-secondary)' }}>
                                        {layer.label}
                                        {layer.isBug && <span style={{ marginLeft: 12, fontSize: 10, fontWeight: 700, background: 'var(--accent-red)22', color: 'var(--accent-red)', borderRadius: 'var(--radius-sm)', padding: '4px 8px' }}>BUG ORIGIN</span>}
                                        {layer.isHere && <span style={{ marginLeft: 12, fontSize: 10, fontWeight: 700, background: 'var(--accent-green)22', color: 'var(--accent-green)', borderRadius: 'var(--radius-sm)', padding: '4px 8px' }}>ANALYSIS SCOPE</span>}
                                    </div>
                                </div>
                            ))}
                        </div>

                        {/* What Unravel found (symptom) */}
                        {layerBoundary.symptom && (
                            <div className="glass-panel" style={{ padding: 24, marginBottom: 24 }}>
                                <div style={{ fontSize: 11, color: 'var(--text-tertiary)', fontWeight: 600, textTransform: 'uppercase', marginBottom: 12, letterSpacing: 1 }}>Reported Symptom</div>
                                <p style={{ color: 'var(--text-secondary)', fontSize: 15, lineHeight: 1.7, margin: 0 }}>{layerBoundary.symptom}</p>
                            </div>
                        )}

                        {/* Provenance */}
                        {layerBoundary._provenance && (
                            <div style={{ fontSize: 11, color: 'var(--text-tertiary)', borderTop: '1px solid var(--border-light)', paddingTop: 16, marginTop: 16, display: 'flex', gap: 16 }}>
                                <span>Engine v{layerBoundary._provenance.engineVersion}</span>
                                <span>•</span>
                                <span>{layerBoundary._provenance.model}</span>
                                <span>•</span>
                                <span>{layerBoundary._provenance.timestamp?.slice(0, 19).replace('T', ' ')}</span>
                            </div>
                        )}

                        {/* Copy Issue button */}
                        <div style={{ marginTop: 32 }}>
                            <button
                                className="matte-button" style={{ border: '1px solid var(--accent-orange)', color: 'var(--accent-orange)' }}
                                onClick={() => {
                                    const issueBody = [
                                        `## Upstream Bug Report`,
                                        ``,
                                        `**Root Cause Layer:** ${layerBoundary.rootCauseLayer}`,
                                        `**Suggested Fix Location:** ${layerBoundary.suggestedFixLayer}`,
                                        ``,
                                        `### Symptom`,
                                        layerBoundary.symptom || '(see description)',
                                        ``,
                                        `### Why this cannot be fixed in user code`,
                                        layerBoundary.reason,
                                        ``,
                                        `### Analysis provenance`,
                                        layerBoundary._provenance
                                            ? `Unravel engine v${layerBoundary._provenance.engineVersion} · model: ${layerBoundary._provenance.model} · ${layerBoundary._provenance.timestamp?.slice(0, 10)}`
                                            : 'Unravel v3',
                                    ].join('\n');
                                    navigator.clipboard.writeText(issueBody).catch(() => {
                                        const ta = document.createElement('textarea');
                                        ta.value = issueBody;
                                        document.body.appendChild(ta);
                                        ta.select();
                                        document.execCommand('copy');
                                        document.body.removeChild(ta);
                                    });
                                }}
                            >
                                <Copy size={16} /> Copy Upstream Issue Template
                            </button>
                        </div>
                    </div>
                )}

                {/* ═══ STEP 5: The Report (renders immediately — no Output Menu) ═══ */}
                {step === 5 && report && (
                    <ReportErrorBoundary rawResult={report}>
                        <div id="unravel-report-container" className="animate-slide-up" style={{ paddingBottom: 80 }}>
                            {/* Sticky header — mode-aware */}
                            <div className="glass-header no-print" style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'flex-end', borderBottom: '1px solid var(--border-light)', paddingBottom: 16, marginBottom: 32, position: 'sticky', top: 72, zIndex: 15, paddingTop: 16, gap: 12, flexWrap: 'wrap' }}>
                                <div>
                                    <div style={{ display: 'flex', gap: 8, marginBottom: 8, flexWrap: 'wrap' }}>
                                        <span style={{ fontSize: 11, background: analysisMode === 'debug' ? `${bugMeta?.color || '#888'}22` : analysisMode === 'explain' ? 'var(--accent-cyan)22' : 'var(--accent-orange)22', color: analysisMode === 'debug' ? (bugMeta?.color || 'var(--text-secondary)') : analysisMode === 'explain' ? 'var(--accent-cyan)' : 'var(--accent-orange)', border: `1px solid ${analysisMode === 'debug' ? (bugMeta?.color || '#888') : analysisMode === 'explain' ? 'var(--accent-cyan)' : 'var(--accent-orange)'}`, padding: '4px 10px', borderRadius: 'var(--radius-sm)', textTransform: 'uppercase', fontWeight: 700, letterSpacing: 1 }}>
                                            {analysisMode === 'debug' ? (bugMeta?.label || report.bugType || 'DEBUG') : analysisMode === 'explain' ? 'EXPLAIN' : 'SECURITY AUDIT'}
                                        </span>
                                        {report.confidence != null && (
                                            <span style={{ fontSize: 11, background: 'var(--surface-base)', color: 'var(--accent-green)', border: '1px solid var(--border-light)', padding: '4px 10px', borderRadius: 'var(--radius-sm)', textTransform: 'uppercase', fontWeight: 600 }}>CFD: {displayConfidence(report.confidence)}%</span>
                                        )}
                                    </div>
                                    <h2 style={{ fontSize: 32, fontWeight: 800, color: 'var(--text-primary)', textTransform: 'uppercase', margin: 0, letterSpacing: -0.5 }}>
                                        {analysisMode === 'debug' ? 'Diagnosis' : analysisMode === 'explain' ? 'Code Explanation' : 'Security Report'}
                                    </h2>
                                </div>
                                <div style={{ display: 'flex', gap: 12 }}>
                                    <button className="matte-button primary" onClick={() => {
                                        const el = document.getElementById('unravel-report-container');
                                        if (!el) return;
                                        // Temporarily force light theme for printing
                                        const prevTheme = document.documentElement.getAttribute('data-theme');
                                        document.documentElement.setAttribute('data-theme', 'light');
                                        
                                        const opt = {
                                            margin: 0.5,
                                            filename: `unravel-report-${Date.now()}.pdf`,
                                            image: { type: 'jpeg', quality: 0.98 },
                                            html2canvas: { scale: 2, useCORS: true },
                                            jsPDF: { unit: 'in', format: 'letter', orientation: 'portrait' }
                                        };
                                        
                                        html2pdf().set(opt).from(el).save().then(() => {
                                            if (prevTheme) document.documentElement.setAttribute('data-theme', prevTheme);
                                            else document.documentElement.removeAttribute('data-theme');
                                        });
                                    }}>
                                        <Download size={16} /> PDF Export
                                    </button>
                                    <button className="matte-button" onClick={reset}>← New Analysis</button>
                                </div>
                            </div>

                            {/* Streaming indicator */}
                            {report._streaming && (
                                <div style={{
                                    background: 'linear-gradient(90deg, var(--accent-cyan)11, var(--accent-purple)11, var(--accent-cyan)11)',
                                    backgroundSize: '200% 100%',
                                    animation: 'streamPulse 2s ease-in-out infinite',
                                    border: '1px solid var(--accent-cyan)33',
                                    borderRadius: 12,
                                    padding: '12px 20px',
                                    marginBottom: 24,
                                    display: 'flex',
                                    alignItems: 'center',
                                    gap: 12,
                                    fontFamily: 'inherit',
                                    fontSize: 13,
                                    color: 'var(--accent-cyan)',
                                    fontWeight: 600,
                                    backdropFilter: 'var(--blur-sm)'
                                }}>
                                    <Loader2 size={16} className="animate-spin" />
                                    Parsing internal logic traces — results appearing in real-time...
                                </div>
                            )}

                            {/* ── Explain Mode Report ── */}
                            {analysisMode === 'explain' && (
                                <div>
                                    {report.summary && (
                                        <SectionBlock icon={<BookOpen size={14} />} title="Summary" color="var(--accent-cyan)" copyText={report.summary} copyId="expl-sum" copiedId={copiedSection} onCopy={handleCopy}>
                                            <p style={{ fontSize: 18, color: 'var(--text-primary)', lineHeight: 1.8 }}>{report.summary}</p>
                                        </SectionBlock>
                                    )}
                                    {report.entryPoints?.length > 0 && (
                                        <SectionBlock icon={<Zap size={14} />} title="Entry Points" color="var(--accent-purple)" copyId="expl-entry" copiedId={copiedSection} onCopy={handleCopy}>
                                            {report.entryPoints.map((ep, i) => (
                                                <div key={i} style={{ background: 'var(--surface-base)', border: '1px solid var(--border-light)', borderRadius: 'var(--radius-md)', padding: 16, marginBottom: 12 }}>
                                                    <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: 8 }}>
                                                        <h4 style={{ fontSize: 14, color: 'var(--accent-purple)', margin: 0, fontWeight: 600 }}>{ep.name}</h4>
                                                        <span style={{ fontSize: 11, color: 'var(--text-secondary)', border: '1px solid var(--border-light)', padding: '2px 8px', borderRadius: 'var(--radius-sm)' }}>{ep.type}</span>
                                                    </div>
                                                    <p style={{ color: 'var(--text-primary)', fontSize: 15, lineHeight: 1.7, marginBottom: 8, margin: 0 }}>{ep.description}</p>
                                                    {ep.file && <div style={{ fontSize: 13, color: 'var(--text-tertiary)', marginTop: 8 }}>📍 {ep.file}{ep.line ? `:${ep.line}` : ''}</div>}
                                                </div>
                                            ))}
                                        </SectionBlock>
                                    )}
                                    {/* Architecture Layers */}
                                    {report.architectureLayers?.length > 0 && (
                                        <SectionBlock icon={<Layers size={14} />} title="Architecture Layers" color="var(--accent-indigo)" copyId="expl-layers" copiedId={copiedSection} onCopy={handleCopy}>
                                            <p style={{ color: 'var(--text-tertiary)', fontSize: 13, marginBottom: 16 }}>High-level semantic grouping of the system</p>
                                            <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(280px, 1fr))', gap: 16 }}>
                                                {report.architectureLayers.map((layer, i) => (
                                                    <div key={i} className="glass-panel" style={{ borderTop: `4px solid ${['var(--accent-cyan)', 'var(--accent-orange)', 'var(--accent-purple)', 'var(--accent-green)', 'var(--accent-blue)'][i % 5]}`, padding: 20, display: 'flex', flexDirection: 'column' }}>
                                                        <h4 style={{ fontSize: 16, color: 'var(--text-primary)', margin: '0 0 12px', fontWeight: 700 }}>Layer {i + 1} — {layer.name}</h4>
                                                        <p style={{ color: 'var(--text-secondary)', fontSize: 14, lineHeight: 1.6, marginBottom: 16, flexGrow: 1 }}>{layer.description}</p>
                                                        {layer.components?.length > 0 && (
                                                            <div style={{ background: 'var(--surface-base)', padding: 16, borderRadius: 'var(--radius-md)', border: '1px solid var(--border-light)' }}>
                                                                {layer.components.map((comp, j) => (
                                                                    <div key={j} style={{ color: 'var(--text-primary)', fontSize: 14, padding: '6px 0', borderBottom: j < layer.components.length - 1 ? '1px solid var(--border-light)' : 'none' }}>
                                                                        <span style={{ color: 'var(--text-tertiary)', marginRight: 12 }}>•</span>{comp}
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
                                        <SectionBlock icon={<GitMerge size={14} />} title="Data Flow" color="var(--accent-orange)" copyId="expl-flow" copiedId={copiedSection} onCopy={handleCopy}>
                                            <MermaidChart
                                                chart={buildDataFlowMermaid(report.flowchartEdges || [])}
                                                caption="How data moves through the system"
                                            />
                                            <div style={{ overflowX: 'auto', marginTop: 12, borderRadius: 'var(--radius-md)', border: '1px solid var(--border-light)' }}>
                                                <table style={{ width: '100%', textAlign: 'left', fontSize: 14, borderCollapse: 'collapse', background: 'var(--surface-base)' }}>
                                                    <thead>
                                                        <tr style={{ background: 'var(--surface-hover)', color: 'var(--accent-orange)', borderBottom: '2px solid var(--accent-orange)' }}>
                                                            <th style={{ padding: '12px 16px', width: '25%', fontWeight: 600 }}>From</th>
                                                            <th style={{ padding: '12px 16px', width: '45%', fontWeight: 600 }}>Mechanism</th>
                                                            <th style={{ padding: '12px 16px', width: '25%', fontWeight: 600 }}>To</th>
                                                            <th style={{ padding: '12px 16px', width: '5%', fontWeight: 600 }}>Line</th>
                                                        </tr>
                                                    </thead>
                                                    <tbody>
                                                        {report.dataFlow.map((flow, i) => (
                                                            <tr key={i} style={{ borderBottom: '1px solid var(--border-light)' }}>
                                                                <td style={{ padding: '12px 16px', color: 'var(--text-primary)' }}>{flow.from}</td>
                                                                <td style={{ padding: '12px 16px', color: 'var(--text-secondary)', fontStyle: 'italic' }}>→ {flow.mechanism} →</td>
                                                                <td style={{ padding: '12px 16px', color: 'var(--text-primary)' }}>{flow.to}</td>
                                                                <td style={{ padding: '12px 16px', color: 'var(--text-tertiary)' }}>{flow.line ? `L${flow.line}` : '—'}</td>
                                                            </tr>
                                                        ))}
                                                    </tbody>
                                                </table>
                                            </div>
                                        </SectionBlock>
                                    )}
                                    {/* Component & Dependency Map + Mermaid Chart */}
                                    {report.componentMap?.length > 0 && (
                                        <SectionBlock icon={<FolderTree size={14} />} title="Component & Dependency Map" color="var(--accent-blue)" copyId="expl-comp" copiedId={copiedSection} onCopy={handleCopy}>
                                            <MermaidChart
                                                chart={buildDependencyMermaid(report.dependencyEdges || [])}
                                                caption="File-level import dependencies — explicit imports only"
                                            />
                                            {report.componentMap.map((comp, i) => (
                                                <div key={i} style={{ background: 'var(--surface-base)', borderLeft: '3px solid var(--accent-green)', borderRadius: 'var(--radius-md)', border: '1px solid var(--border-light)', padding: 16, marginBottom: 12, marginTop: 12 }}>
                                                    <h4 style={{ fontSize: 15, color: 'var(--accent-green)', margin: '0 0 10px', fontWeight: 600 }}>{comp.name}</h4>
                                                    {comp.children?.length > 0 && (
                                                        <div style={{ marginBottom: 8 }}>
                                                            <span style={{ color: 'var(--text-tertiary)', fontSize: 12, textTransform: 'uppercase', marginRight: 12, fontWeight: 700 }}>Dependencies:</span>
                                                            <span style={{ color: 'var(--text-primary)', fontSize: 14 }}>{comp.children.join(', ')}</span>
                                                        </div>
                                                    )}
                                                    {comp.stateOwned?.length > 0 && (
                                                        <div>
                                                            <span style={{ color: 'var(--text-tertiary)', fontSize: 12, textTransform: 'uppercase', marginRight: 12, fontWeight: 700 }}>State:</span>
                                                            <span style={{ color: 'var(--accent-orange)', fontSize: 13 }}>{comp.stateOwned.join(', ')}</span>
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
                                        <SectionBlock icon={<AlertTriangle size={14} />} title="Gotchas" color="var(--accent-red)" copyId="expl-gotchas" copiedId={copiedSection} onCopy={handleCopy}>
                                            <p style={{ color: 'var(--text-tertiary)', fontSize: 13, marginBottom: 16 }}>Hidden landmines — things that break when changed</p>
                                            {report.gotchas.map((g, i) => (
                                                <div key={i} style={{ background: 'var(--surface-base)', borderLeft: '3px solid var(--accent-red)', borderRadius: 'var(--radius-md)', padding: 16, marginBottom: 12, border: '1px solid var(--border-light)' }}>
                                                    <div style={{ fontSize: 14, color: 'var(--accent-red)', fontWeight: 700, marginBottom: 8 }}>⚠️ {g.title}</div>
                                                    <p style={{ color: 'var(--text-secondary)', fontSize: 14, lineHeight: 1.7, marginBottom: 8, margin: 0 }}>{g.description}</p>
                                                    {g.location && <code style={{ fontSize: 12, color: 'var(--text-tertiary)', marginTop: 8, display: 'block' }}>📍 {g.location}</code>}
                                                </div>
                                            ))}
                                        </SectionBlock>
                                    )}
                                    {/* Onboarding Guide */}
                                    {report.onboarding?.length > 0 && (
                                        <SectionBlock icon={<User size={14} />} title="Onboarding Guide" color="var(--accent-cyan)" copyId="expl-onboard" copiedId={copiedSection} onCopy={handleCopy}>
                                            <p style={{ color: 'var(--text-tertiary)', fontSize: 13, marginBottom: 16 }}>Exactly where to go for the most common tasks</p>
                                            {report.onboarding.map((item, i) => (
                                                <div key={i} style={{ background: 'var(--surface-base)', border: '1px solid var(--border-light)', borderRadius: 'var(--radius-md)', padding: 18, marginBottom: 12 }}>
                                                    <div style={{ fontSize: 15, color: 'var(--accent-cyan)', fontWeight: 700, marginBottom: 10 }}>🎯 {item.task}</div>
                                                    <div style={{ color: 'var(--text-secondary)', fontSize: 14, marginBottom: 6 }}><strong style={{ color: 'var(--text-tertiary)' }}>Where:</strong> <code style={{ color: 'var(--text-primary)', background: 'var(--surface-hover)', padding: '2px 6px', borderRadius: '4px' }}>{item.whereToLook}</code></div>
                                                    <div style={{ color: 'var(--text-secondary)', fontSize: 14 }}><strong style={{ color: 'var(--text-tertiary)' }}>Model after:</strong> {item.patternToFollow}</div>
                                                </div>
                                            ))}
                                        </SectionBlock>
                                    )}
                                    {/* Architecture Decisions */}
                                    {report.architectureDecisions?.length > 0 && (
                                        <SectionBlock icon={<Network size={14} />} title="Architecture Decisions" color="var(--accent-orange)" copyId="expl-arch" copiedId={copiedSection} onCopy={handleCopy}>
                                            {report.architectureDecisions.map((d, i) => (
                                                <div key={i} style={{ background: 'var(--surface-base)', borderLeft: '3px solid var(--accent-orange)', borderRadius: 'var(--radius-md)', padding: 16, marginBottom: 12, border: '1px solid var(--border-light)' }}>
                                                    <div style={{ fontSize: 15, color: 'var(--text-primary)', fontWeight: 700, marginBottom: 8 }}>{d.decision}</div>
                                                    {d.visibleReason && <div style={{ color: 'var(--text-secondary)', fontSize: 14, marginBottom: 6 }}><strong style={{ color: 'var(--text-tertiary)' }}>Why (visible in code):</strong> {d.visibleReason}</div>}
                                                    {d.tradeoff && <div style={{ color: 'var(--accent-orange)', fontSize: 14 }}><strong style={{ color: 'var(--text-tertiary)' }}>Tradeoff:</strong> {d.tradeoff}</div>}
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
                                        <div className="glass-panel" style={{ borderLeft: '4px solid var(--accent-orange)', padding: 24, marginBottom: 20 }}>
                                            <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
                                                <h3 style={{ fontWeight: 800, textTransform: 'uppercase', color: 'var(--accent-orange)', fontSize: 16, display: 'flex', alignItems: 'center', gap: 10, margin: 0 }}>
                                                    <ShieldAlert size={18} /> Overall Risk: {report.overallRisk}
                                                </h3>
                                                <span style={{ background: 'var(--accent-red)22', color: 'var(--accent-red)', fontSize: 11, padding: '4px 10px', fontWeight: 700, borderRadius: 'var(--radius-sm)' }}>
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
                                        <SectionBlock icon={<AlertTriangle size={14} />} title={`Vulnerabilities (${report.vulnerabilities.length})`} color="var(--accent-red)" copyId="sec-vuln" copiedId={copiedSection} onCopy={handleCopy}>
                                            {report.vulnerabilities.map((v, i) => (
                                                <div key={i} style={{ background: 'var(--surface-base)', border: '1px solid var(--border-light)', borderLeftWidth: 4, borderLeftColor: v.severity === 'critical' ? 'var(--accent-red)' : v.severity === 'high' ? 'var(--accent-orange)' : 'var(--text-secondary)', borderRadius: 'var(--radius-md)', padding: 16, marginBottom: 12 }}>
                                                    <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: 10 }}>
                                                        <h4 style={{ fontSize: 15, color: 'var(--text-primary)', margin: 0, fontWeight: 700 }}>{v.type || v.title}</h4>
                                                        <span style={{
                                                            fontSize: 11, padding: '4px 10px', fontWeight: 700, textTransform: 'uppercase', borderRadius: 'var(--radius-sm)',
                                                            background: v.severity === 'critical' ? 'var(--accent-red)22' : v.severity === 'high' ? 'var(--accent-orange)22' : 'var(--surface-hover)',
                                                            color: v.severity === 'critical' ? 'var(--accent-red)' : v.severity === 'high' ? 'var(--accent-orange)' : 'var(--text-secondary)',
                                                        }}>{v.severity}</span>
                                                    </div>
                                                    <p style={{ color: 'var(--text-secondary)', fontSize: 14, lineHeight: 1.6, marginBottom: 8, margin: 0 }}>{v.description}</p>
                                                    {v.location && <p style={{ fontSize: 13, color: 'var(--text-tertiary)', marginTop: 8, margin: 0 }}>📍 {v.location}</p>}
                                                    {v.remediation && <p style={{ color: 'var(--accent-green)', fontSize: 13, marginTop: 10, margin: 0, fontWeight: 600 }}>✅ Fix: {v.remediation}</p>}
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
                                        <SectionBlock icon={<CheckSquare size={14} />} title="Security Positives" color="var(--accent-green)" copyId="sec-pos" copiedId={copiedSection} onCopy={handleCopy}>
                                            <ul style={{ listStylePosition: 'inside', color: 'var(--text-secondary)', fontSize: 14, lineHeight: 1.8, margin: 0 }}>
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
                                        <SectionBlock icon={<AlertOctagon size={14} />} title="Observed Symptom" color="var(--accent-red)" copyText={`Symptom: ${report.symptom}\nReproduction:\n${(report.reproduction || []).join('\n')}`} copyId="symp" copiedId={copiedSection} onCopy={handleCopy}>
                                            <p style={{ fontSize: 20, color: 'var(--text-primary)', fontWeight: 700, lineHeight: 1.5, marginBottom: 16 }}>{report.symptom}</p>
                                            {report.reproduction?.length > 0 && (
                                                <div style={{ background: 'var(--surface-base)', padding: 16, borderRadius: 'var(--radius-md)', border: '1px solid var(--border-light)' }}>
                                                    <h4 style={{ fontSize: 13, color: 'var(--text-tertiary)', textTransform: 'uppercase', marginBottom: 12, fontWeight: 600 }}>Reproduction Path</h4>
                                                    <ol style={{ listStylePosition: 'inside', color: 'var(--text-secondary)', fontSize: 14, lineHeight: 1.8, margin: 0 }}>
                                                        {report.reproduction.map((s, i) => <li key={i}>{s}</li>)}
                                                    </ol>
                                                </div>
                                            )}
                                        </SectionBlock>
                                    )}

                                    {/* Evidence */}
                                    {report.evidence?.length > 0 && (
                                        <SectionBlock icon={<CheckSquare size={14} />} title="Confidence Evidence" color="var(--accent-green)" copyId="evi" copiedId={copiedSection} onCopy={handleCopy}
                                            copyText={(report.evidence || []).join('\n')}>
                                            <div style={{ marginBottom: 16 }}>
                                                <span style={{ fontSize: 13, color: 'var(--accent-green)', fontWeight: 700 }}>VERIFIED:</span>
                                                <ul style={{ listStyleType: 'disc', paddingLeft: 20, color: 'var(--text-secondary)', fontSize: 14, lineHeight: 1.8, margin: '8px 0 0 0' }}>
                                                    {report.evidence.map((e, i) => <li key={i}>{e}</li>)}
                                                </ul>
                                            </div>
                                            {report.uncertainties?.length > 0 && (
                                                <div>
                                                    <span style={{ fontSize: 13, color: 'var(--accent-orange)', fontWeight: 700 }}>UNCERTAIN:</span>
                                                    <ul style={{ listStyleType: 'disc', paddingLeft: 20, color: 'var(--text-tertiary)', fontSize: 14, lineHeight: 1.8, margin: '8px 0 0 0' }}>
                                                        {report.uncertainties.map((u, i) => <li key={i}>{u}</li>)}
                                                    </ul>
                                                </div>
                                            )}
                                        </SectionBlock>
                                    )}

                                    {/* Concept Extraction */}
                                    {report.conceptExtraction && (
                                        <SectionBlock icon={<BookOpen size={14} />} title="Concept To Learn" color="var(--accent-cyan)" copyId="concept" copiedId={copiedSection} onCopy={handleCopy}
                                            copyText={`Concept: ${report.conceptExtraction.concept}\nWhy: ${report.conceptExtraction.whyItMatters}\nPattern: ${report.conceptExtraction.patternToAvoid}`}>
                                            <div style={{ marginBottom: 16 }}>
                                                <span style={{ fontSize: 11, background: bugMeta?.color + '22' || 'var(--surface-hover)', color: bugMeta?.color || 'var(--text-secondary)', padding: '4px 10px', borderRadius: 'var(--radius-sm)', fontWeight: 700, textTransform: 'uppercase' }}>{report.conceptExtraction.bugCategory}</span>
                                            </div>
                                            <h4 style={{ fontSize: 18, color: 'var(--text-primary)', fontWeight: 700, marginBottom: 10 }}>{report.conceptExtraction.concept}</h4>
                                            <p style={{ color: 'var(--text-secondary)', lineHeight: 1.7, marginBottom: 16 }}>{report.conceptExtraction.whyItMatters}</p>
                                            <div style={{ background: 'var(--accent-green)18', borderLeft: '3px solid var(--accent-green)', padding: 16, borderRadius: 'var(--radius-md)', marginBottom: 12 }}>
                                                <span style={{ color: 'var(--accent-green)', fontWeight: 700, fontSize: 13 }}>PATTERN TO AVOID:</span>
                                                <p style={{ color: 'var(--text-primary)', marginTop: 8, margin: 0 }}>{report.conceptExtraction.patternToAvoid}</p>
                                            </div>

                                        </SectionBlock>
                                    )}

                                    {/* Metaphor / Analogy */}
                                    {report.conceptExtraction?.realWorldAnalogy && (
                                        <SectionBlock icon={<Lightbulb size={14} />} title="Real World Analogy" color="var(--accent-yellow)" copyId="analogy" copiedId={copiedSection} onCopy={handleCopy}
                                            copyText={report.conceptExtraction.realWorldAnalogy}>
                                            <p style={{ fontSize: 18, color: 'var(--text-primary)', lineHeight: 1.7, fontStyle: 'italic' }}>
                                                "{report.conceptExtraction.realWorldAnalogy}"
                                            </p>
                                        </SectionBlock>
                                    )}

                                    {/* --- TECH VIEW --- */}
                                    {report.variableState?.length > 0 && (
                                        <SectionBlock icon={<Database size={14} />} title="State Mutation Tracker" color="var(--accent-cyan)" borderSide="top"
                                            copyText={JSON.stringify(report.variableState, null, 2)} copyId="state" copiedId={copiedSection} onCopy={handleCopy}>
                                            <div style={{ overflowX: 'auto', borderRadius: 'var(--radius-md)', border: '1px solid var(--border-light)' }}>
                                                <table style={{ width: '100%', textAlign: 'left', fontSize: 14, borderCollapse: 'collapse', background: 'var(--surface-base)' }}>
                                                    <thead>
                                                        <tr style={{ background: 'var(--surface-hover)', color: 'var(--accent-cyan)', borderBottom: '2px solid var(--accent-cyan)' }}>
                                                            <th style={{ padding: '12px 16px', borderRight: '1px solid var(--border-light)', width: '25%', fontWeight: 600 }}>Variable</th>
                                                            <th style={{ padding: '12px 16px', borderRight: '1px solid var(--border-light)', width: '45%', fontWeight: 600 }}>Meaning / Role</th>
                                                            <th style={{ padding: '12px 16px', width: '30%', fontWeight: 600 }}>Where Mutated</th>
                                                        </tr>
                                                    </thead>
                                                    <tbody>
                                                        {report.variableState.map((st, i) => (
                                                            <tr key={i} style={{ borderBottom: '1px solid var(--border-light)' }}>
                                                                <td style={{ padding: '12px 16px', borderRight: '1px solid var(--border-light)', color: 'var(--accent-green)', fontWeight: 700 }}>{st.variable}</td>
                                                                <td style={{ padding: '12px 16px', borderRight: '1px solid var(--border-light)', color: 'var(--text-secondary)' }}>{st.meaning}</td>
                                                                <td style={{ padding: '12px 16px', color: 'var(--accent-orange)' }}>{st.whereChanged}</td>
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
                                        <SectionBlock icon={<Clock size={14} />} title="Execution Timeline" color="var(--accent-green)"
                                            copyText={report.timeline.map(t => `${t.time}: ${t.event}`).join('\n')} copyId="timeline" copiedId={copiedSection} onCopy={handleCopy}>
                                            <div style={{ position: 'relative', paddingLeft: 40 }}>
                                                <div style={{ position: 'absolute', left: 16, top: 0, bottom: 0, width: 2, background: 'linear-gradient(to bottom, var(--accent-green), var(--accent-purple))' }} />
                                                {report.timeline.map((item, i) => (
                                                    <div key={i} style={{ position: 'relative', marginBottom: 16, paddingLeft: 20 }}>
                                                        <div style={{ position: 'absolute', left: -30, top: 4, width: 28, height: 28, borderRadius: '50%', border: '2px solid var(--surface-base)', background: 'var(--surface-hover)', color: 'var(--accent-green)', fontSize: 11, fontWeight: 700, display: 'flex', alignItems: 'center', justifyContent: 'center' }}>
                                                            {item.time}
                                                        </div>
                                                        <div style={{ background: 'var(--surface-hover)', padding: '12px 16px', borderRadius: 'var(--radius-md)', border: '1px solid var(--border-light)' }}>
                                                            <p style={{ fontSize: 14, color: 'var(--text-primary)', margin: 0 }}>{item.event}</p>
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
                                        <SectionBlock icon={<ShieldAlert size={14} />} title="Invariant Violations" color="var(--accent-red)"
                                            copyText={report.invariants.join('\n')} copyId="inv" copiedId={copiedSection} onCopy={handleCopy}>
                                            <ul style={{ listStyleType: 'disc', paddingLeft: 20, color: 'var(--text-secondary)', fontSize: 14, lineHeight: 1.8 }}>
                                                {report.invariants.map((inv, i) => <li key={i}>{inv}</li>)}
                                            </ul>
                                        </SectionBlock>
                                    )}

                                    {report.rootCause && (
                                        <SectionBlock icon={<GitMerge size={14} />} title="Technical Root Cause" color="var(--text-primary)"
                                            copyText={report.rootCause} copyId="root" copiedId={copiedSection} onCopy={handleCopy}>
                                            <p style={{ color: 'var(--text-primary)', lineHeight: 1.7, marginBottom: 16 }}>{report.rootCause}</p>
                                            <div style={{ background: 'var(--surface-base)', padding: 16, borderRadius: 'var(--radius-md)', border: '1px solid var(--border-light)', color: 'var(--accent-cyan)', fontSize: 14, fontWeight: 500 }}>
                                                <span style={{ color: 'var(--text-tertiary)', marginRight: 10 }}>Location:</span>{report.codeLocation}
                                            </div>
                                        </SectionBlock>
                                    )}

                                    {/* Proximate Crash Site — only shown when different from root cause */}
                                    {report.proximate_crash_site && (
                                        <SectionBlock icon={<AlertOctagon size={14} />} title="Crash Site" color="var(--accent-orange)"
                                            copyText={report.proximate_crash_site} copyId="crash-site" copiedId={copiedSection} onCopy={handleCopy}>
                                            <div style={{ background: 'var(--surface-base)', borderLeft: '3px solid var(--accent-orange)', borderRadius: 'var(--radius-md)', padding: 16, border: '1px solid var(--border-light)' }}>
                                                <div style={{ fontSize: 12, color: 'var(--accent-orange)', fontWeight: 700, textTransform: 'uppercase', marginBottom: 10, letterSpacing: 1 }}>
                                                    WHERE THE FAILURE BECAME VISIBLE ↓
                                                </div>
                                                <p style={{ color: 'var(--text-primary)', fontSize: 15, fontWeight: 600, lineHeight: 1.6, marginBottom: 10, margin: 0 }}>{report.proximate_crash_site}</p>
                                                <p style={{ color: 'var(--text-tertiary)', fontSize: 13, margin: 0, marginTop: 10, fontStyle: 'italic' }}>
                                                    ↑ This is where the exception or wrong value surfaced — the actual root cause is above.
                                                </p>
                                            </div>
                                        </SectionBlock>
                                    )}

                                    {report.hypotheses?.length > 0 && (
                                        <SectionBlock icon={<BrainCircuit size={14} />} title="Alternative Hypotheses" color="var(--text-secondary)" borderSide="top">
                                            <ul style={{ listStyleType: 'disc', paddingLeft: 20, color: 'var(--text-secondary)', fontSize: 14, lineHeight: 1.8, margin: 0 }}>
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
                                        <div className="glass-panel" style={{ padding: 32, marginBottom: 24, border: '1px solid var(--accent-purple)' }}>
                                            <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'flex-start', marginBottom: 20, paddingBottom: 16, borderBottom: '1px solid var(--accent-purple)44' }}>
                                                <h3 style={{ fontWeight: 800, textTransform: 'uppercase', color: 'var(--accent-purple)', fontSize: 18, margin: 0 }}>Deterministic AI Fix Prompt</h3>
                                                <button onClick={() => handleCopy(report.aiPrompt, 'ai-prompt')}
                                                    className="matte-button"
                                                    style={{ background: 'var(--accent-purple)', color: 'var(--text-inverse)', border: 'none' }}>
                                                    {copiedSection === 'ai-prompt' ? <Check size={16} /> : <Copy size={16} />}
                                                    {copiedSection === 'ai-prompt' ? 'COPIED!' : 'COPY PROMPT'}
                                                </button>
                                            </div>
                                            <p style={{ color: 'var(--text-tertiary)', fontSize: 14, marginBottom: 16 }}>
                                                Paste this directly into Cursor / Bolt / Copilot to apply the fix:
                                            </p>
                                            <pre className="glass-input" style={{ padding: 20, color: 'var(--text-primary)', fontSize: 14, border: '1px solid var(--accent-purple)33', lineHeight: 1.6, overflow: 'auto', whiteSpace: 'pre-wrap', fontFamily: 'monospace' }}>
                                                {report.aiPrompt}
                                            </pre>
                                        </div>
                                    )}
                                    {/* --- CODE VIEW --- */}
                                    {report.minimalFix && (
                                        <>
                                            <SectionBlock icon={<Code2 size={14} />} title="Minimal Code Fix" color="var(--accent-orange)"
                                                copyText={report.minimalFix} copyId="cfix" copiedId={copiedSection} onCopy={handleCopy}>
                                                <div style={{ fontSize: 13, color: 'var(--text-tertiary)', textTransform: 'uppercase', marginBottom: 10, fontWeight: 600 }}>
                                                    File: {report.codeLocation}
                                                </div>
                                                <pre className="glass-input" style={{ padding: 20, color: 'var(--accent-cyan)', fontSize: 14, overflow: 'auto', whiteSpace: 'pre-wrap', fontFamily: 'monospace' }}>
                                                    {report.minimalFix}
                                                </pre>
                                            </SectionBlock>
                                            <SectionBlock icon={<CheckSquare size={14} />} title="Why This Works" color="var(--accent-green)">
                                                <p style={{ fontSize: 17, color: 'var(--text-primary)', lineHeight: 1.7 }}>{report.whyFixWorks}</p>
                                            </SectionBlock>
                                        </>
                                    )}
                                </>
                            )}

                            {/* ═══ ACTION CENTER ═══ */}
                            <div className="glass-panel no-print" style={{ borderTop: '4px solid var(--accent-green)', padding: 32, marginTop: 32, marginBottom: 24 }}>
                                <h3 style={{ fontWeight: 800, textTransform: 'uppercase', letterSpacing: 1.5, color: 'var(--accent-green)', fontSize: 14, display: 'flex', alignItems: 'center', gap: 10, marginBottom: 20, paddingBottom: 16, borderBottom: '1px solid var(--border-light)', margin: '0 0 20px 0' }}>
                                    <Zap size={18} /> Action Center
                                </h3>
                                <div style={{ display: 'flex', gap: 12, flexWrap: 'wrap' }}>
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
                                                className="matte-button"
                                                style={{ border: '1px solid var(--accent-green)', color: 'var(--accent-green)', textDecoration: 'none' }}>
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
                                                className="matte-button"
                                                style={{ border: `1px solid ${copiedSection === 'cli-fix' ? 'var(--accent-green)' : 'var(--accent-purple)'}`, color: copiedSection === 'cli-fix' ? 'var(--accent-green)' : 'var(--accent-purple)' }}>
                                                {copiedSection === 'cli-fix' ? <Check size={16} /> : <Copy size={16} />}
                                                {copiedSection === 'cli-fix' ? 'Copied!' : 'Copy Fix CLI'}
                                            </button>
                                        );
                                    })()}
                                </div>
                                <p style={{ color: 'var(--text-tertiary)', fontSize: 13, marginTop: 16, margin: '16px 0 0 0' }}>
                                    {inputType === 'github' ? 'Create Issue opens a pre-filled GitHub issue in a new tab. You review before submitting.' : 'Use the Copy Fix CLI to generate a git workflow for applying the fix.'}
                                </p>
                            </div>

                            {/* New Analysis Button */}
                            <div className="no-print" style={{ textAlign: 'center', paddingTop: 32, borderTop: '1px solid var(--border-light)', marginTop: 32 }}>
                                <button className="matte-button primary" style={{ width: '100%', maxWidth: 400, margin: '0 auto', padding: '16px', fontSize: 16 }} onClick={reset}>
                                    <RefreshCw size={18} style={{ marginRight: 10 }} />
                                    New Analysis
                                </button>
                            </div>
                        </div>
                    </ReportErrorBoundary>
                )
                }
            </main>
        </div>
        </div>
    );
}
