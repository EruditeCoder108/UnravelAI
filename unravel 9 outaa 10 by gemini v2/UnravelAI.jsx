import React, { useState, useRef } from 'react';
import {
  Code2, AlertTriangle, CheckSquare,
  Zap, Search, ChevronRight, Loader2,
  Trash2, Plus, Globe2, TerminalSquare, FileDigit, UploadCloud,
  Activity, Copy, Check, BrainCircuit, User,
  FolderTree, FileCode, Network, PauseCircle, Clock, Database, AlertOctagon, GitMerge
} from 'lucide-react';

// --- Configuration ---
const apiKey = ""; // The execution environment provides the key at runtime.
const GEMINI_URL = `https://generativelanguage.googleapis.com/v1beta/models/gemini-2.5-flash-preview-09-2025:generateContent?key=${apiKey}`;

// --- Helper: Exponential Backoff API Caller ---
const fetchWithRetry = async (url, options, retries = 5) => {
  let delay = 1000;
  for (let i = 0; i < retries; i++) {
    try {
      const response = await fetch(url, options);
      if (!response.ok) {
        if (response.status === 429 || response.status >= 500) {
          throw new Error(`HTTP error! status: ${response.status}`);
        }
        const errData = await response.json();
        throw new Error(errData.error?.message || 'API Error');
      }
      return await response.json();
    } catch (error) {
      if (i === retries - 1) throw error;
      await new Promise(resolve => setTimeout(resolve, delay));
      delay *= 2;
    }
  }
};

export default function App() {
  // App State
  const [step, setStep] = useState(1);

  // User Profile
  const [level, setLevel] = useState('beginner');
  const [goal, setGoal] = useState('');
  const [language, setLanguage] = useState('hinglish');

  // Input State
  const [inputType, setInputType] = useState('upload');
  const [pastedFiles, setPastedFiles] = useState([{ name: 'index.js', content: '' }]);
  const [directoryFiles, setDirectoryFiles] = useState([]);
  const [userError, setUserError] = useState('');

  // Processing & Engine State
  const [isAnalyzing, setIsAnalyzing] = useState(false);
  const [analysisError, setAnalysisError] = useState('');
  const [loadingStage, setLoadingStage] = useState('');
  const [report, setReport] = useState(null);

  // Interactive Detective State
  const [missingFileRequest, setMissingFileRequest] = useState(null);
  const [additionalFiles, setAdditionalFiles] = useState([]);

  // View & Copy State
  const [viewMode, setViewMode] = useState(null);
  const [copiedSection, setCopiedSection] = useState(null);

  // Helper: normalize confidence to 0-100 display value
  const displayConfidence = (val) => {
    if (val == null) return 0;
    return val <= 1 ? Math.round(val * 100) : Math.round(val);
  };

  const fileInputRef = useRef(null);
  const dirInputRef = useRef(null);

  // --- Handlers ---
  const handleCopyText = (text, sectionId) => {
    const textArea = document.createElement("textarea");
    textArea.value = text;
    document.body.appendChild(textArea);
    textArea.select();
    try {
      document.execCommand('copy');
      setCopiedSection(sectionId);
      setTimeout(() => setCopiedSection(null), 2000);
    } catch (err) {
      console.error('Copy failed');
    }
    document.body.removeChild(textArea);
  };

  const handleDirectoryUpload = (e) => {
    const files = Array.from(e.target.files);
    if (files.length === 0) return;

    const validExtensions = ['.js', '.jsx', '.ts', '.tsx', '.html', '.css', '.json', '.py', '.md', '.env.example'];
    const blacklistedDirs = ['node_modules', '.git', '.next', 'dist', 'build', 'coverage'];

    const cleanFiles = files.filter(f => {
      const path = f.webkitRelativePath || f.name;
      const isBlacklisted = blacklistedDirs.some(dir => path.includes(`/${dir}/`) || path.startsWith(`${dir}/`));
      const hasValidExt = validExtensions.some(ext => path.endsWith(ext));
      return !isBlacklisted && hasValidExt && f.size < 1000000;
    });

    setDirectoryFiles(cleanFiles);
  };

  const readSelectedFiles = async (filePathsToRead) => {
    const filesToRead = directoryFiles.filter(f => filePathsToRead.includes(f.webkitRelativePath));
    const fileDataPromises = filesToRead.map(file => {
      return new Promise((resolve) => {
        const reader = new FileReader();
        reader.onload = (e) => resolve({ name: file.webkitRelativePath, content: e.target.result });
        reader.readAsText(file);
      });
    });
    return await Promise.all(fileDataPromises);
  };

  // --- Deterministic Debugging Engine ---
  const executeAnalysis = async (resumeWithExtraFiles = false) => {
    setIsAnalyzing(true);
    setAnalysisError('');
    setStep(3);
    if (!resumeWithExtraFiles) {
      setViewMode(null);
      setMissingFileRequest(null);
    }

    // Helper for robust JSON parsing in case AI wraps response in markdown
    const parseAIJson = (text) => {
      try {
        return JSON.parse(text);
      } catch (e) {
        const clean = text.replace(/^```(json)?\n?/gi, '').replace(/\n?```$/g, '').trim();
        return JSON.parse(clean);
      }
    };

    try {
      let codeFilesForAgents = [];
      let projectContext = "";

      // Gather Files
      if (inputType === 'upload') {
        if (directoryFiles.length === 0) throw new Error("Please upload a project folder first.");
        setLoadingStage("ROUTER AGENT: Mapping Directory Tree...");
        const filePaths = directoryFiles.map(f => f.webkitRelativePath);

        // Router Pass
        if (!resumeWithExtraFiles) {
          const routerPrompt = `You are the Router Agent. Look at this project file tree and the user's error. 
            Return exactly the relative paths of up to 7 files you need to inspect.
            File Tree: ${JSON.stringify(filePaths)}\nUser Error: ${userError}`;

          const routerRes = await fetchWithRetry(GEMINI_URL, {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({
              contents: [{ parts: [{ text: routerPrompt }] }],
              generationConfig: { responseMimeType: "application/json", responseSchema: { type: "OBJECT", properties: { filesToRead: { type: "ARRAY", items: { type: "STRING" } } }, required: ["filesToRead"] } }
            })
          });

          const textResponse = routerRes.candidates?.[0]?.content?.parts?.[0]?.text;
          if (!textResponse) throw new Error("Router Agent failed to respond.");
          const routerData = parseAIJson(textResponse);
          setLoadingStage(`ROUTER AGENT: Selected ${routerData.filesToRead?.length || 0} files...`);
          codeFilesForAgents = await readSelectedFiles(routerData.filesToRead || []);
        } else {
          // Re-use previous router selection (simulated by reading all past and new)
          // In a real DB we'd cache this, but for this MVP we pass what we have
          codeFilesForAgents = await readSelectedFiles(directoryFiles.slice(0, 5).map(f => f.webkitRelativePath));
        }
        projectContext = `Project Tree Contains: ${filePaths.length} files.`;

      } else if (inputType === 'paste') {
        codeFilesForAgents = pastedFiles.filter(f => f.name && f.content);
        if (codeFilesForAgents.length === 0) throw new Error("No code pasted. Please paste your files before executing.");
      }

      // Append any newly requested files from Step 3.5
      if (additionalFiles.length > 0) {
        codeFilesForAgents = [...codeFilesForAgents, ...additionalFiles.filter(f => f.name && f.content)];
      }

      // THE CORE DEBUGGING ENGINE PROMPT
      setLoadingStage(`DEEP ENGINE: Reconstructing execution timeline and state invariants...`);

      const systemInstruction = `Improve the Unravel debugging system to produce structured and reliable bug analysis.
      You are connected to the internet. Search stackoverflow, documentation, or Reddit if a stack trace is unknown.

      USER PROFILE: Level: ${level}, Output Language: ${language}
      
      The system must follow this deterministic debugging pipeline:
      1. If you cannot solve this without seeing another specific file from their codebase, set 'needsMoreInfo' to true and specify what you need. DO NOT HALLUCINATE A FIX.
      2. Identify the user-visible symptom.
      3. Determine how the bug can be reproduced.
      4. Analyze variable state changes across functions (State Mutation).
      5. Construct a timeline of execution events.
      6. Detect invariant violations in the system.
      7. Identify the root cause and exact code location.
      8. Suggest the minimal fix required. Avoid rewriting large sections of code unless absolutely necessary.
      9. Explain why the fix works.
      10. Classify the bug type.
      11. Provide a simple metaphor/explanation for non-technical users.
      
      Think of every way possible to fix it. Construct multiple hypotheses before settling on the root cause. Provide a confidence score.`;

      const engineSchema = {
        type: "OBJECT",
        properties: {
          needsMoreInfo: { type: "BOOLEAN", description: "Set to TRUE ONLY if a critical file is missing and you cannot debug without it." },
          missingFilesRequest: {
            type: "OBJECT",
            properties: {
              filesNeeded: { type: "ARRAY", items: { type: "STRING" } },
              reason: { type: "STRING" }
            }
          },
          report: {
            type: "OBJECT",
            properties: {
              bugType: { type: "STRING", description: "e.g., State Mutation, Timing, Race Condition, Env Bug" },
              confidence: { type: "NUMBER" },
              symptom: { type: "STRING" },
              reproduction: { type: "ARRAY", items: { type: "STRING" } },
              rootCause: { type: "STRING" },
              codeLocation: { type: "STRING", description: "Filename and exact lines/function." },
              minimalFix: { type: "STRING", description: "The exact, minimal code snippet to fix it." },
              whyFixWorks: { type: "STRING" },
              concept: { type: "STRING", description: "The core software engineering concept to learn." },
              metaphor: { type: "STRING", description: "Simple analogy for non-technical user." },
              variableState: {
                type: "ARRAY",
                description: "Table of variables and where they changed.",
                items: {
                  type: "OBJECT",
                  properties: { variable: { type: "STRING" }, meaning: { type: "STRING" }, whereChanged: { type: "STRING" } }
                }
              },
              timeline: {
                type: "ARRAY",
                description: "Execution timeline.",
                items: {
                  type: "OBJECT",
                  properties: { time: { type: "STRING", description: "e.g., t0, t1" }, event: { type: "STRING" } }
                }
              },
              invariants: { type: "ARRAY", items: { type: "STRING" }, description: "Rules broken (e.g., duration must not change during pause)." },
              hypotheses: { type: "ARRAY", items: { type: "STRING" }, description: "Alternative causes considered." },
              aiPrompt: { type: "STRING", description: "Prompt for Cursor/Bolt to fix it." }
            }
          }
        },
        required: ["needsMoreInfo"]
      };

      const enginePrompt = `Code Context: ${projectContext}\nFiles Analyzed: ${JSON.stringify(codeFilesForAgents)}\nUser Issue: ${userError}`;

      const res = await fetchWithRetry(GEMINI_URL, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          contents: [{ parts: [{ text: enginePrompt }] }],
          systemInstruction: { parts: [{ text: systemInstruction }] },
          generationConfig: { responseMimeType: "application/json", responseSchema: engineSchema }
        })
      });

      const textResponse = res.candidates?.[0]?.content?.parts?.[0]?.text;
      if (!textResponse) throw new Error("Engine failed to generate a diagnostic report.");
      const resultData = parseAIJson(textResponse);

      if (resultData.needsMoreInfo && resultData.missingFilesRequest) {
        setMissingFileRequest(resultData.missingFilesRequest);
        setAdditionalFiles(resultData.missingFilesRequest.filesNeeded.map(f => ({ name: f, content: '' })));
        setStep(3.5); // INTERACTIVE MODE
      } else {
        setReport(resultData.report);
        setStep(4);
      }

    } catch (err) {
      console.error("Engine Error:", err);
      setAnalysisError(err.message || "Diagnostic sequence failed. Check your API payload or try again.");
      setStep(2);
    } finally {
      setIsAnalyzing(false);
    }
  };

  // --- Sub-components ---
  const CopyBtn = ({ textToCopy, sectionId, label = "COPY" }) => (
    <button
      onClick={() => handleCopyText(textToCopy, sectionId)}
      className="flex items-center gap-2 px-3 py-1 font-code text-[10px] font-bold uppercase transition-all bg-[#222] text-[#aaa] hover:bg-[#ccff00] hover:text-black border border-[#444] hover:border-black"
    >
      {copiedSection === sectionId ? <Check className="w-3 h-3" /> : <Copy className="w-3 h-3" />}
      {copiedSection === sectionId ? 'COPIED' : label}
    </button>
  );

  return (
    <div className="min-h-screen bg-[#050505] text-[#e0e0e0] font-display relative overflow-x-hidden selection:bg-[#ccff00] selection:text-black">
      <style dangerouslySetInnerHTML={{
        __html: `
        @import url('https://fonts.googleapis.com/css2?family=Bricolage+Grotesque:opsz,wght@12..96,400;700;800&family=JetBrains+Mono:wght@400;700;800&display=swap');
        .font-display { font-family: 'Bricolage Grotesque', sans-serif; }
        .font-code { font-family: 'JetBrains Mono', monospace; }
        .bg-noise { background-image: url("data:image/svg+xml,%3Csvg viewBox='0 0 200 200' xmlns='http://www.w3.org/2000/svg'%3E%3Cfilter id='noiseFilter'%3E%3CfeTurbulence type='fractalNoise' baseFrequency='0.8' numOctaves='3' stitchTiles='stitch'/%3E%3C/filter%3E%3Crect width='100%25' height='100%25' filter='url(%23noiseFilter)' opacity='0.04'/%3E%3C/svg%3E"); }
        .brutal-border { border: 2px solid #333; }
        .brutal-shadow-lime { box-shadow: 6px 6px 0px 0px #ccff00; }
        .brutal-shadow-cyan { box-shadow: 6px 6px 0px 0px #00ffff; }
        .brutal-shadow-magenta { box-shadow: 6px 6px 0px 0px #ff00ff; }
        .tab-active { background-color: #e0e0e0; color: #050505; border-bottom: none; }
        .tab-inactive { background-color: transparent; color: #888; border-bottom: 2px solid #333; }
        ::-webkit-scrollbar { width: 10px; }
        ::-webkit-scrollbar-track { background: #050505; border-left: 1px solid #222; }
        ::-webkit-scrollbar-thumb { background: #555; }
        ::-webkit-scrollbar-thumb:hover { background: #ccff00; }
      `}} />

      <div className="absolute inset-0 bg-noise pointer-events-none z-0 mix-blend-overlay"></div>

      <header className="border-b-2 border-[#222] bg-[#050505]/90 backdrop-blur-md sticky top-0 z-20">
        <div className="max-w-6xl mx-auto px-6 py-4 flex justify-between items-center">
          <div className="flex items-center gap-3 group cursor-pointer" onClick={() => setStep(1)}>
            <div className="bg-[#ccff00] p-1 border-2 border-black group-hover:brutal-shadow-cyan transition-shadow">
              <Code2 className="w-8 h-8 text-black" />
            </div>
            <h1 className="text-3xl font-extrabold tracking-tighter text-white uppercase">UNRAVEL <span className="text-[#00ffff] font-code text-sm">v2.Engine</span></h1>
          </div>
        </div>
      </header>

      <main className="max-w-5xl mx-auto px-6 py-12 relative z-10">

        {/* Step 1: Profile */}
        {step === 1 && (
          <div className="animate-in fade-in slide-in-from-bottom-8 duration-500 space-y-10">
            <div className="space-y-4 border-l-4 border-[#ccff00] pl-6 py-2">
              <h2 className="text-5xl md:text-6xl font-black text-white leading-tight uppercase">
                Deterministic <br /> Debug Engine.
              </h2>
            </div>

            <div className="bg-[#111] brutal-border p-8 space-y-8 relative overflow-hidden">
              <div className="absolute top-0 right-0 p-4 opacity-10 pointer-events-none">
                <Network className="w-64 h-64" />
              </div>

              <div className="space-y-4 relative z-10">
                <label className="font-code text-[#ccff00] text-sm uppercase tracking-wider flex items-center gap-2">
                  <TerminalSquare className="w-4 h-4" /> [01] Select Coding Level
                </label>
                <div className="grid md:grid-cols-3 gap-4">
                  {['beginner', 'basic', 'intermediate'].map(lvl => (
                    <button key={lvl} onClick={() => setLevel(lvl)}
                      className={`py-4 px-4 font-bold uppercase tracking-wide border-2 transition-all ${level === lvl ? 'bg-[#e0e0e0] text-black border-white brutal-shadow-magenta' : 'bg-transparent text-[#888] border-[#333] hover:border-[#666]'}`}
                    > {lvl} </button>
                  ))}
                </div>
              </div>

              <div className="space-y-4 relative z-10">
                <label className="font-code text-[#ff00ff] text-sm uppercase tracking-wider flex items-center gap-2">
                  <Globe2 className="w-4 h-4" /> [02] Output Protocol
                </label>
                <div className="flex flex-wrap gap-4">
                  {['hindi', 'hinglish', 'english'].map(lang => (
                    <button key={lang} onClick={() => setLanguage(lang)}
                      className={`py-3 px-6 font-bold uppercase tracking-wide border-2 transition-all ${language === lang ? 'bg-[#ff00ff] text-white border-[#ff00ff] brutal-shadow-white' : 'bg-transparent text-[#888] border-[#333] hover:border-[#666]'}`}
                    > {lang} </button>
                  ))}
                </div>
              </div>

              <button onClick={() => setStep(2)}
                className="w-full bg-[#ccff00] text-black border-2 border-black py-5 font-black text-xl uppercase tracking-widest hover:brutal-shadow-cyan transition-shadow mt-4 relative z-10"
              > Initialize Workspace &rarr; </button>
            </div>
          </div>
        )}

        {/* Step 2: Input */}
        {step === 2 && (
          <div className="animate-in fade-in duration-500 space-y-8">
            <h2 className="text-4xl font-black text-white uppercase border-b-2 border-[#333] pb-4">Inject Architecture</h2>

            <div className="bg-[#111] brutal-border flex flex-col">
              <div className="flex font-code font-bold uppercase text-sm border-b-2 border-[#333]">
                <button onClick={() => setInputType('upload')} className={`flex-1 py-4 flex items-center justify-center gap-2 transition-all ${inputType === 'upload' ? 'tab-active' : 'tab-inactive'}`}>
                  <FolderTree className="w-4 h-4" /> Folder Upload
                </button>
                <button onClick={() => setInputType('paste')} className={`flex-1 py-4 flex items-center justify-center gap-2 border-l-2 border-[#333] transition-all ${inputType === 'paste' ? 'tab-active' : 'tab-inactive'}`}>
                  <FileCode className="w-4 h-4" /> Raw Paste
                </button>
              </div>

              <div className="p-8 space-y-8">
                {inputType === 'upload' && (
                  <div className="space-y-4">
                    <div className="bg-[#00ffff]/10 border-l-4 border-[#00ffff] p-4 font-code text-[#00ffff] text-sm">
                      <p className="font-bold mb-1 flex items-center gap-2"><Search className="w-4 h-4" /> SMART ROUTING ACTIVE</p>
                      Upload the entire folder. AI will map the tree and selectively read files to reconstruct the state graph.
                    </div>
                    <div
                      className="border-2 border-dashed border-[#555] hover:border-[#ff00ff] bg-[#0a0a0a] p-12 text-center cursor-pointer transition-colors"
                      onClick={() => dirInputRef.current?.click()}
                    >
                      <UploadCloud className="w-12 h-12 text-[#555] mx-auto mb-4" />
                      <p className="font-code text-[#aaa] text-lg uppercase font-bold">Upload Project Folder</p>
                      <input type="file" webkitdirectory="true" directory="true" multiple ref={dirInputRef} onChange={handleDirectoryUpload} className="hidden" />
                    </div>
                    {directoryFiles.length > 0 && (
                      <div className="font-code text-sm text-[#ccff00] border border-[#ccff00] p-4 bg-[#ccff00]/5">
                        <CheckSquare className="w-5 h-5 inline mr-2" /> Mapped {directoryFiles.length} files. Ready.
                      </div>
                    )}
                  </div>
                )}

                {inputType === 'paste' && (
                  <div className="space-y-6">
                    {pastedFiles.map((file, idx) => (
                      <div key={idx} className="border-2 border-[#333] bg-[#050505] relative">
                        <input
                          type="text" placeholder="filename.js" value={file.name}
                          onChange={(e) => { const newF = [...pastedFiles]; newF[idx].name = e.target.value; setPastedFiles(newF); }}
                          className="bg-[#111] border-b-2 border-[#333] text-[#ccff00] font-code px-4 py-2 w-full focus:outline-none"
                        />
                        <textarea
                          placeholder="// Paste source code..." value={file.content}
                          onChange={(e) => { const newF = [...pastedFiles]; newF[idx].content = e.target.value; setPastedFiles(newF); }}
                          className="w-full h-48 bg-transparent text-[#ddd] font-code p-4 focus:outline-none resize-y"
                        ></textarea>
                      </div>
                    ))}
                    <button onClick={() => setPastedFiles([...pastedFiles, { name: '', content: '' }])} className="w-full py-4 border-2 border-dashed border-[#555] text-[#888] font-code uppercase hover:border-[#ccff00] hover:text-[#ccff00] transition-colors flex justify-center items-center gap-2">
                      <Plus className="w-4 h-4" /> Add File Block
                    </button>
                  </div>
                )}

                <div className="border-t-2 border-[#333] pt-6 mt-6">
                  <label className="font-code text-white block uppercase mb-2 flex items-center gap-2">
                    <Activity className="w-4 h-4 text-[#ff003c]" /> Define The Symptom
                  </label>
                  <textarea
                    placeholder="E.g., Timer resets to wrong duration after pause. Or paste stack trace..."
                    value={userError} onChange={(e) => setUserError(e.target.value)}
                    className="w-full bg-[#050505] brutal-border text-[#ffaa00] px-4 py-4 font-code h-32 focus:outline-none focus:border-[#ffaa00]"
                  ></textarea>
                </div>

                <button
                  onClick={() => executeAnalysis(false)}
                  disabled={
                    isAnalyzing ||
                    (inputType === 'upload' && directoryFiles.length === 0) ||
                    (inputType === 'paste' && pastedFiles.filter(f => f.name && f.content).length === 0)
                  }
                  className="w-full bg-[#ccff00] text-black border-2 border-black py-6 font-black text-2xl uppercase tracking-widest hover:bg-white brutal-shadow-lime transition-all disabled:opacity-50 disabled:cursor-not-allowed flex justify-center items-center gap-3 mt-4"
                >
                  Execute Engine <Zap className="w-6 h-6" />
                </button>
              </div>
            </div>
          </div>
        )}

        {/* Step 3: Loading */}
        {step === 3 && (
          <div className="py-32 flex flex-col items-center justify-center text-center animate-in fade-in duration-500">
            <BrainCircuit className="w-24 h-24 text-[#ff00ff] animate-pulse mb-8" />
            <h2 className="text-4xl font-black uppercase text-white tracking-widest">SYSTEM ACTIVE</h2>
            <div className="mt-8 w-full max-w-lg border-2 border-[#555] bg-[#111] p-6 text-left relative overflow-hidden">
              <div className="absolute top-0 left-0 h-1 bg-[#ccff00] animate-[pulse_1s_ease-in-out_infinite] w-full"></div>
              <p className="font-code text-[#00ffff] text-lg uppercase flex items-center gap-3">
                <Loader2 className="w-5 h-5 animate-spin" /> {loadingStage || "Initializing..."}
              </p>
            </div>
          </div>
        )}

        {/* Step 3.5: Missing File Interruption */}
        {step === 3.5 && missingFileRequest && (
          <div className="animate-in slide-in-from-bottom-8 duration-500 space-y-8 max-w-3xl mx-auto py-8">
            <div className="bg-[#ffaa00] text-black p-8 brutal-border border-black brutal-shadow-white relative">
              <div className="flex items-start gap-4 mb-6 border-b-2 border-black/20 pb-6">
                <PauseCircle className="w-12 h-12 flex-shrink-0" />
                <div>
                  <h2 className="text-4xl font-black uppercase leading-none mb-2">Analysis Paused</h2>
                  <p className="font-code font-bold">The AI Detective needs more context to avoid hallucinating.</p>
                </div>
              </div>

              <div className="space-y-6">
                <div>
                  <h3 className="font-code uppercase text-sm font-bold mb-1 opacity-70">Reason for halt:</h3>
                  <p className="text-xl font-medium">{missingFileRequest.reason}</p>
                </div>

                <div className="space-y-4">
                  <h3 className="font-code uppercase text-sm font-bold opacity-70">Please provide the following files:</h3>
                  {additionalFiles.map((file, idx) => (
                    <div key={idx} className="bg-black/10 border-2 border-black p-4">
                      <label className="font-code font-bold mb-2 block">{file.name}</label>
                      <textarea
                        placeholder="Paste the contents of this file here..."
                        value={file.content}
                        onChange={(e) => {
                          const newF = [...additionalFiles]; newF[idx].content = e.target.value; setAdditionalFiles(newF);
                        }}
                        className="w-full h-32 bg-black text-[#ccff00] font-code p-4 focus:outline-none"
                      />
                    </div>
                  ))}
                </div>

                <button
                  onClick={() => executeAnalysis(true)}
                  disabled={additionalFiles.some(f => !f.content)}
                  className="w-full bg-black text-[#ffaa00] border-2 border-black py-4 font-black text-xl uppercase tracking-widest hover:bg-white hover:text-black transition-all disabled:opacity-50"
                >
                  Resume Engine &rarr;
                </button>
              </div>
            </div>
          </div>
        )}

        {/* Step 4: Choice Interstitial */}
        {step === 4 && report && (
          <div className="animate-in slide-in-from-bottom-8 duration-500 space-y-8 max-w-2xl mx-auto py-8">
            <div className="text-center space-y-4 mb-10 border-b-2 border-[#333] pb-8">
              <div className="inline-block bg-[#ccff00] text-black font-black font-code px-4 py-1 border-2 border-black mb-4 flex items-center gap-2 w-max mx-auto">
                ENGINE CONFIDENCE: {displayConfidence(report.confidence)}%
                {displayConfidence(report.confidence) > 80 ? <CheckSquare className="w-4 h-4" /> : <AlertTriangle className="w-4 h-4" />}
              </div>
              <h2 className="text-5xl font-black text-white uppercase">Diagnosis Ready</h2>
              <p className="text-xl text-[#aaa] font-code">We mapped the state and found the root cause. Choose output format:</p>
            </div>

            <div className="grid gap-4">
              <button onClick={() => { setViewMode('plain'); setStep(5); }} className="bg-[#111] brutal-border p-6 hover:border-[#ccff00] hover:brutal-shadow-lime transition-all text-left group flex items-center justify-between">
                <div>
                  <h3 className="text-2xl font-black text-white uppercase group-hover:text-[#ccff00]">1. Human Explanation</h3>
                  <p className="text-[#888] font-code mt-2">Symptoms, Metaphors, and Concepts to learn.</p>
                </div>
                <User className="w-8 h-8 text-[#555] group-hover:text-[#ccff00]" />
              </button>

              <button onClick={() => { setViewMode('tech'); setStep(5); }} className="bg-[#111] brutal-border p-6 hover:border-[#00ffff] hover:brutal-shadow-cyan transition-all text-left group flex items-center justify-between">
                <div>
                  <h3 className="text-2xl font-black text-white uppercase group-hover:text-[#00ffff]">2. Technical Breakdown</h3>
                  <p className="text-[#888] font-code mt-2">State Mutation Tables, Execution Timelines, Invariants.</p>
                </div>
                <Database className="w-8 h-8 text-[#555] group-hover:text-[#00ffff]" />
              </button>

              <button onClick={() => { setViewMode('prompt'); setStep(5); }} className="bg-[#111] brutal-border p-6 hover:border-[#ff00ff] hover:brutal-shadow-magenta transition-all text-left group flex items-center justify-between">
                <div>
                  <h3 className="text-2xl font-black text-white uppercase group-hover:text-[#ff00ff]">3. Agent Prompt</h3>
                  <p className="text-[#888] font-code mt-2">Prompt to paste into Cursor/Bolt to fix it safely.</p>
                </div>
                <TerminalSquare className="w-8 h-8 text-[#555] group-hover:text-[#ff00ff]" />
              </button>

              <button onClick={() => { setViewMode('code'); setStep(5); }} className="bg-[#111] brutal-border p-6 hover:border-[#ffaa00] hover:brutal-shadow-white transition-all text-left group flex items-center justify-between">
                <div>
                  <h3 className="text-2xl font-black text-white uppercase group-hover:text-[#ffaa00]">4. Minimal Code Fix</h3>
                  <p className="text-[#888] font-code mt-2">The exact snippet required. No massive refactors.</p>
                </div>
                <Code2 className="w-8 h-8 text-[#555] group-hover:text-[#ffaa00]" />
              </button>

              <button onClick={() => { setViewMode('all'); setStep(5); }} className="bg-transparent border-2 border-dashed border-[#555] p-6 hover:border-white transition-all text-center group mt-4">
                <h3 className="text-xl font-bold text-[#aaa] uppercase group-hover:text-white">5. Show Me Everything</h3>
              </button>
            </div>
          </div>
        )}

        {/* Step 5: The Specific Results */}
        {step === 5 && report && viewMode && (
          <div className="animate-in slide-in-from-bottom-8 duration-700 space-y-12 pb-24">

            {/* Header */}
            <div className="flex flex-col md:flex-row justify-between items-start md:items-end border-b-4 border-white pb-6 gap-4 sticky top-[72px] bg-[#050505]/95 backdrop-blur z-30 pt-4">
              <div>
                <div className="flex gap-2 mb-2">
                  <span className="font-code text-xs bg-[#ff003c] text-white px-2 py-1 uppercase">{report.bugType}</span>
                  <span className="font-code text-xs bg-[#222] text-[#ccff00] border border-[#ccff00] px-2 py-1 uppercase">CFD: {displayConfidence(report.confidence)}%</span>
                </div>
                <h2 className="text-4xl font-black text-white uppercase">Mode: <span className="text-[#ccff00]">{viewMode}</span></h2>
              </div>
              <button onClick={() => setStep(4)} className="font-code border-2 border-[#555] px-4 py-2 hover:bg-white hover:text-black transition-colors uppercase text-sm">
                &larr; Output Menu
              </button>
            </div>

            <div className="grid gap-8">

              {/* --- HUMAN VIEW --- */}
              {(viewMode === 'plain' || viewMode === 'tech' || viewMode === 'all') && (
                <div className="bg-[#111] brutal-border p-8 border-l-8 border-l-[#ff003c]">
                  <div className="flex justify-between items-start mb-4">
                    <h3 className="font-code font-bold uppercase text-[#ff003c] tracking-widest mb-4">Observed Symptom</h3>
                    <CopyBtn textToCopy={`Symptom: ${report.symptom}\nReproduction:\n${report.reproduction.join('\n')}`} sectionId="symp" />
                  </div>
                  <p className="text-2xl text-white font-bold leading-tight mb-6">{report.symptom}</p>

                  <div className="bg-[#050505] p-4 border border-[#333]">
                    <h4 className="font-code text-sm text-[#888] uppercase mb-2">Reproduction Path</h4>
                    <ol className="list-decimal list-inside text-[#ccc] space-y-1 font-code">
                      {report.reproduction.map((step, i) => <li key={i}>{step}</li>)}
                    </ol>
                  </div>
                </div>
              )}

              {(viewMode === 'plain' || viewMode === 'all') && (
                <>
                  <div className="bg-[#111] brutal-border p-8 border-l-8 border-l-[#ccff00]">
                    <div className="flex justify-between items-start mb-4">
                      <h3 className="font-code font-bold uppercase text-[#ccff00] tracking-widest mb-4">The Real World Analogy</h3>
                      <CopyBtn textToCopy={report.metaphor} sectionId="metaphor" />
                    </div>
                    <p className="text-xl text-[#e0e0e0] leading-relaxed italic">"{report.metaphor}"</p>
                  </div>

                  <div className="bg-[#111] brutal-border p-8 border-l-8 border-l-[#00ffff]">
                    <div className="flex justify-between items-start mb-4">
                      <h3 className="font-code font-bold uppercase text-[#00ffff] tracking-widest mb-4">The Concept To Learn</h3>
                      <CopyBtn textToCopy={report.concept} sectionId="concept" />
                    </div>
                    <p className="text-lg text-white leading-relaxed">{report.concept}</p>
                  </div>
                </>
              )}


              {/* --- TECH VIEW --- */}
              {(viewMode === 'tech' || viewMode === 'all') && (
                <>
                  <div className="bg-[#111] brutal-border p-8 border-t-8 border-t-[#00ffff]">
                    <div className="flex justify-between items-start mb-6 border-b-2 border-[#333] pb-4">
                      <h3 className="font-code font-black uppercase text-2xl text-white">State Mutation Tracker</h3>
                      <CopyBtn textToCopy={JSON.stringify(report.variableState, null, 2)} sectionId="state" />
                    </div>
                    <div className="overflow-x-auto">
                      <table className="w-full text-left font-code text-sm border-collapse">
                        <thead>
                          <tr className="bg-[#222] text-[#00ffff] border-b-2 border-[#00ffff]">
                            <th className="p-4 border-r border-[#444] w-1/4">Variable</th>
                            <th className="p-4 border-r border-[#444] w-1/2">Meaning / Role</th>
                            <th className="p-4 w-1/4">Where it Mutated</th>
                          </tr>
                        </thead>
                        <tbody>
                          {report.variableState.map((st, i) => (
                            <tr key={i} className="border-b border-[#333] hover:bg-[#1a1a1a]">
                              <td className="p-4 border-r border-[#444] text-[#ccff00] font-bold">{st.variable}</td>
                              <td className="p-4 border-r border-[#444] text-[#ccc]">{st.meaning}</td>
                              <td className="p-4 text-[#ffaa00]">{st.whereChanged}</td>
                            </tr>
                          ))}
                        </tbody>
                      </table>
                    </div>
                  </div>

                  <div className="grid md:grid-cols-2 gap-8">
                    <div className="bg-[#111] brutal-border p-8">
                      <div className="flex justify-between items-start mb-6 border-b-2 border-[#333] pb-4">
                        <h3 className="font-code font-black uppercase text-xl text-white flex items-center gap-2"><Clock className="w-5 h-5" /> Execution Timeline</h3>
                        <CopyBtn textToCopy={report.timeline.map(t => `${t.time}: ${t.event}`).join('\n')} sectionId="timeline" />
                      </div>
                      <div className="space-y-4 relative before:absolute before:inset-0 before:ml-5 before:-translate-x-px md:before:mx-auto md:before:translate-x-0 before:h-full before:w-0.5 before:bg-gradient-to-b before:from-[#ccff00] before:to-[#ff00ff]">
                        {report.timeline.map((item, i) => (
                          <div key={i} className="relative flex items-center justify-between md:justify-normal md:odd:flex-row-reverse group is-active">
                            <div className="flex items-center justify-center w-10 h-10 rounded-full border-4 border-[#111] bg-[#222] text-[#ccff00] font-code text-xs font-bold z-10 shadow shrink-0 md:order-1 md:group-odd:-translate-x-1/2 md:group-even:translate-x-1/2">
                              {item.time}
                            </div>
                            <div className="w-[calc(100%-4rem)] md:w-[calc(50%-2.5rem)] bg-[#222] p-4 rounded border border-[#444]">
                              <p className="font-code text-sm text-white">{item.event}</p>
                            </div>
                          </div>
                        ))}
                      </div>
                    </div>

                    <div className="space-y-8">
                      <div className="bg-[#ff003c]/10 brutal-border border-[#ff003c] p-6">
                        <div className="flex justify-between items-start mb-4 border-b border-[#ff003c]/30 pb-2">
                          <h3 className="font-code font-black uppercase text-lg text-[#ff003c] flex items-center gap-2"><AlertOctagon className="w-4 h-4" /> Invariant Violations</h3>
                          <CopyBtn textToCopy={report.invariants.join('\n')} sectionId="inv" />
                        </div>
                        <ul className="list-disc list-inside space-y-2 text-[#ccc] font-code text-sm">
                          {report.invariants.map((inv, i) => <li key={i}>{inv}</li>)}
                        </ul>
                      </div>

                      <div className="bg-[#111] brutal-border p-6">
                        <div className="flex justify-between items-start mb-4 border-b border-[#333] pb-2">
                          <h3 className="font-code font-black uppercase text-lg text-white flex items-center gap-2"><GitMerge className="w-4 h-4" /> Technical Root Cause</h3>
                          <CopyBtn textToCopy={report.rootCause} sectionId="root" />
                        </div>
                        <p className="text-[#e0e0e0] leading-relaxed">{report.rootCause}</p>
                        <div className="mt-4 bg-[#050505] p-3 border border-[#333] font-code text-[#00ffff] text-sm">
                          Location: {report.codeLocation}
                        </div>
                      </div>

                      {report.hypotheses.length > 0 && (
                        <div className="bg-[#111] brutal-border p-6 border-dashed">
                          <h3 className="font-code font-black uppercase text-sm text-[#888] mb-4">Alternative Hypotheses Considered</h3>
                          <ul className="list-disc list-inside space-y-1 text-[#888] font-code text-xs">
                            {report.hypotheses.map((hyp, i) => <li key={i}>{hyp}</li>)}
                          </ul>
                        </div>
                      )}
                    </div>
                  </div>
                </>
              )}

              {/* --- PROMPT VIEW --- */}
              {(viewMode === 'prompt' || viewMode === 'all') && (
                <div className="bg-[#ff00ff]/10 brutal-border border-[#ff00ff] p-8 brutal-shadow-magenta">
                  <div className="flex justify-between items-start mb-6 border-b border-[#ff00ff]/30 pb-4">
                    <h3 className="font-code font-black uppercase text-2xl text-[#ff00ff]">Deterministic AI Fix Prompt</h3>
                    <button
                      onClick={() => handleCopyText(report.aiPrompt, 'ai-prompt')}
                      className="flex items-center gap-2 px-6 py-2 font-code font-bold uppercase transition-all bg-[#ff00ff] text-white hover:bg-white hover:text-black"
                    >
                      {copiedSection === 'ai-prompt' ? <Check className="w-4 h-4" /> : <Copy className="w-4 h-4" />}
                      {copiedSection === 'ai-prompt' ? 'PROMPT COPIED!' : 'COPY PROMPT'}
                    </button>
                  </div>
                  <p className="text-[#aaa] font-code text-sm mb-4">Paste this directly into your AI editor to apply the minimal fix safely:</p>
                  <pre className="bg-[#050505] p-6 text-white font-code text-sm overflow-x-auto border border-[#ff00ff]/30 whitespace-pre-wrap leading-relaxed">
                    {report.aiPrompt}
                  </pre>
                </div>
              )}

              {/* --- CODE VIEW --- */}
              {(viewMode === 'code' || viewMode === 'all') && (
                <div className="space-y-8">
                  <div className="bg-[#111] brutal-border p-8 border-l-8 border-l-[#ffaa00]">
                    <div className="flex justify-between items-start mb-6">
                      <h3 className="font-code font-black uppercase text-2xl text-[#ffaa00]">Minimal Code Fix</h3>
                      <CopyBtn textToCopy={report.minimalFix} sectionId="c-code" />
                    </div>
                    <div className="mb-4 font-code text-[#888] text-sm uppercase">File: {report.codeLocation}</div>
                    <pre className="bg-[#050505] p-6 text-[#00ffff] font-code text-sm overflow-x-auto border border-[#333]">
                      {report.minimalFix}
                    </pre>
                  </div>

                  <div className="bg-[#111] brutal-border p-8 border-l-8 border-l-white">
                    <h3 className="font-code font-black uppercase text-[#888] tracking-widest mb-4">Why this works</h3>
                    <p className="text-xl text-white leading-relaxed">{report.whyFixWorks}</p>
                  </div>
                </div>
              )}

            </div>
          </div>
        )}

      </main>
    </div>
  );
}