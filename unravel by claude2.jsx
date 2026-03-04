import { useState, useRef } from "react";

const LANGUAGES = {
  hindi: "Hindi",
  hinglish: "Hinglish",
  english: "English",
};

const LEVELS = {
  beginner: { label: "Complete Beginner", desc: "Coding kya hota hai pata nahi" },
  basic: { label: "Basic", desc: "Thoda suna hai, kuch try kiya hai" },
  intermediate: { label: "Intermediate", desc: "Samajh aata hai, bas deep nahi" },
};

const LANG_PROMPTS = {
  hindi: "Bilkul saral Hindi mein samjhao. Koi bhi technical jargon mat use karo. Analogies use karo jo Indian life se related ho.",
  hinglish: "Hinglish mein samjhao - natural Indian style mein. Thoda English mix karo but mostly Hindi flow rakho. Desi analogies use karo.",
  english: "Explain in simple plain English. Avoid jargon. Use relatable everyday analogies.",
};

const LEVEL_PROMPTS = {
  beginner: "The user is a complete beginner - they used AI to build something and have zero coding knowledge. Explain like they're 10 years old.",
  basic: "The user has very basic exposure to coding. They understand terms like 'file', 'website', 'button' but not code logic.",
  intermediate: "The user has some understanding but is not technical. They can follow logic if explained clearly.",
};

function IconCode({ size = 20 }) {
  return <svg width={size} height={size} viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2"><polyline points="16 18 22 12 16 6" /><polyline points="8 6 2 12 8 18" /></svg>;
}
function IconGithub({ size = 20 }) {
  return <svg width={size} height={size} viewBox="0 0 24 24" fill="currentColor"><path d="M12 2C6.477 2 2 6.477 2 12c0 4.42 2.865 8.17 6.839 9.49.5.092.682-.217.682-.482 0-.237-.008-.866-.013-1.7-2.782.603-3.369-1.342-3.369-1.342-.454-1.155-1.11-1.462-1.11-1.462-.908-.62.069-.608.069-.608 1.003.07 1.531 1.03 1.531 1.03.892 1.529 2.341 1.087 2.91.832.092-.647.35-1.088.636-1.338-2.22-.253-4.555-1.11-4.555-4.943 0-1.091.39-1.984 1.029-2.683-.103-.253-.446-1.27.098-2.647 0 0 .84-.269 2.75 1.025A9.578 9.578 0 0112 6.836c.85.004 1.705.115 2.504.337 1.909-1.294 2.747-1.025 2.747-1.025.546 1.377.203 2.394.1 2.647.64.699 1.028 1.592 1.028 2.683 0 3.842-2.339 4.687-4.566 4.935.359.309.678.919.678 1.852 0 1.336-.012 2.415-.012 2.741 0 .267.18.578.688.48C19.138 20.167 22 16.418 22 12c0-5.523-4.477-10-10-10z"/></svg>;
}
function IconUpload({ size = 20 }) {
  return <svg width={size} height={size} viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2"><polyline points="16 16 12 12 8 16"/><line x1="12" y1="12" x2="12" y2="21"/><path d="M20.39 18.39A5 5 0 0018 9h-1.26A8 8 0 103 16.3"/></svg>;
}
function IconShield({ size = 20 }) {
  return <svg width={size} height={size} viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2"><path d="M12 22s8-4 8-10V5l-8-3-8 3v7c0 6 8 10 8 10z"/></svg>;
}
function IconZap({ size = 20 }) {
  return <svg width={size} height={size} viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2"><polygon points="13 2 3 14 12 14 11 22 21 10 12 10 13 2"/></svg>;
}
function IconSearch({ size = 20 }) {
  return <svg width={size} height={size} viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2"><circle cx="11" cy="11" r="8"/><line x1="21" y1="21" x2="16.65" y2="16.65"/></svg>;
}
function IconFile({ size = 16 }) {
  return <svg width={size} height={size} viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2"><path d="M13 2H6a2 2 0 00-2 2v16a2 2 0 002 2h12a2 2 0 002-2V9z"/><polyline points="13 2 13 9 20 9"/></svg>;
}
function IconX({ size = 16 }) {
  return <svg width={size} height={size} viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2"><line x1="18" y1="6" x2="6" y2="18"/><line x1="6" y1="6" x2="18" y2="18"/></svg>;
}
function IconPlus({ size = 16 }) {
  return <svg width={size} height={size} viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2"><line x1="12" y1="5" x2="12" y2="19"/><line x1="5" y1="12" x2="19" y2="12"/></svg>;
}

const ConfidenceBadge = ({ score }) => {
  const pct = Math.round(score * 100);
  const color = pct >= 80 ? "#22c55e" : pct >= 60 ? "#f59e0b" : "#ef4444";
  return (
    <span style={{ display:"inline-flex", alignItems:"center", gap:4, background:color+"18", border:`1px solid ${color}44`, color, borderRadius:6, padding:"2px 8px", fontSize:12, fontWeight:600 }}>
      Confidence: {pct}%
    </span>
  );
};

const SectionCard = ({ icon, title, color, children, confidence }) => (
  <div style={{ background:"#0f1117", border:`1px solid ${color}33`, borderRadius:12, padding:20, marginBottom:16 }}>
    <div style={{ display:"flex", alignItems:"center", justifyContent:"space-between", marginBottom:12 }}>
      <div style={{ display:"flex", alignItems:"center", gap:8 }}>
        <span style={{ color }}>{icon}</span>
        <span style={{ color:"#e2e8f0", fontWeight:700, fontSize:15 }}>{title}</span>
      </div>
      {confidence !== undefined && <ConfidenceBadge score={confidence} />}
    </div>
    <div style={{ color:"#94a3b8", fontSize:14, lineHeight:1.7 }}>{children}</div>
  </div>
);

const LoadingPulse = ({ step }) => {
  const steps = ["Files scan kar raha hoon...","Project structure samajh raha hoon...","Errors dhundh raha hoon...","Security check kar raha hoon...","Report taiyar kar raha hoon..."];
  return (
    <div style={{ textAlign:"center", padding:"60px 20px" }}>
      <div style={{ width:64, height:64, borderRadius:"50%", border:"3px solid #7c3aed33", borderTop:"3px solid #7c3aed", animation:"spin 1s linear infinite", margin:"0 auto 24px" }} />
      <div style={{ color:"#a78bfa", fontSize:16, marginBottom:8 }}>Unravel kar raha hoon...</div>
      <div style={{ color:"#64748b", fontSize:13 }}>{steps[step % steps.length]}</div>
      <style>{`@keyframes spin { to { transform: rotate(360deg) } }`}</style>
    </div>
  );
};

function parseReport(text) {
  try {
    const jsonMatch = text.match(/```json\n?([\s\S]*?)\n?```/) || text.match(/(\{[\s\S]*\})/);
    if (jsonMatch) return JSON.parse(jsonMatch[1] || jsonMatch[0]);
  } catch {}
  return null;
}

function FileCard({ name, content, onRemove }) {
  const lines = content.split('\n').length;
  const ext = name.split('.').pop();
  const extColors = { js:"#f7df1e", jsx:"#61dafb", ts:"#3178c6", tsx:"#3178c6", css:"#1572b6", html:"#e34c26", json:"#5bcc14", py:"#3776ab" };
  const color = extColors[ext] || "#94a3b8";
  return (
    <div style={{ display:"flex", alignItems:"center", justifyContent:"space-between", background:"#0f1117", border:"1px solid #1e293b", borderRadius:8, padding:"8px 12px", marginBottom:6 }}>
      <div style={{ display:"flex", alignItems:"center", gap:8 }}>
        <span style={{ color }}><IconFile /></span>
        <span style={{ color:"#e2e8f0", fontSize:13 }}>{name}</span>
        <span style={{ color:"#475569", fontSize:11 }}>{lines} lines</span>
      </div>
      <button onClick={onRemove} style={{ background:"none", border:"none", color:"#475569", cursor:"pointer", padding:4 }}><IconX /></button>
    </div>
  );
}

export default function Unravel() {
  const [screen, setScreen] = useState("onboard");
  const [profile, setProfile] = useState({ level:"", goal:"", language:"" });
  const [files, setFiles] = useState([]);
  const [inputMode, setInputMode] = useState("paste");
  const [pasteFileName, setPasteFileName] = useState("");
  const [pasteContent, setPasteContent] = useState("");
  const [report, setReport] = useState(null);
  const [loadingStep, setLoadingStep] = useState(0);
  const [error, setError] = useState("");
  const [clarifications, setClarifications] = useState([]);
  const fileInputRef = useRef();
  const stepTimer = useRef();

  const handleOnboardSubmit = () => {
    if (!profile.level || !profile.goal || !profile.language) { setError("Saari fields fill karo pehle!"); return; }
    setError(""); setScreen("input");
  };

  const addPasteFile = () => {
    if (!pasteFileName.trim() || !pasteContent.trim()) { setError("File ka naam aur content dono chahiye!"); return; }
    setFiles(f => [...f, { name:pasteFileName.trim(), content:pasteContent.trim() }]);
    setPasteFileName(""); setPasteContent(""); setError("");
  };

  const handleFileUpload = (e) => {
    Array.from(e.target.files).forEach(file => {
      if (file.size > 2*1024*1024) { setError(`${file.name} too big`); return; }
      const reader = new FileReader();
      reader.onload = ev => setFiles(f => [...f, { name:file.name, content:ev.target.result }]);
      reader.readAsText(file);
    });
  };

  const buildPrompt = () => {
    const filesSummary = files.map(f => `\n\n=== FILE: ${f.name} ===\n${f.content.slice(0, 3000)}`).join('');
    return `You are Unravel — an AI that explains broken vibe-coded projects to Indian non-technical users.

LANGUAGE INSTRUCTION: ${LANG_PROMPTS[profile.language]}
USER LEVEL: ${LEVEL_PROMPTS[profile.level]}
USER'S PROJECT GOAL: "${profile.goal}"

IMPORTANT RULES:
1. Detect missing critical files. If a file should exist but is not provided (e.g. a script referenced in HTML but not uploaded), list it in missing_files with the reason.
2. Do NOT hallucinate fixes. If confidence is low, say so clearly.
3. Use DESI analogies (compare variables to "dabbe", APIs to "delivery boy", functions to "naukar jo kaam karta hai", etc.)
4. Be honest. This person needs to learn, not just copy-paste.
5. Confidence score: 0.0 to 1.0 — be conservative. If a file is missing that would help analysis, reduce confidence.

FILES PROVIDED:
${filesSummary}

Analyze this project and return ONLY a raw JSON object (no markdown, no backticks, no explanation outside JSON) with this exact structure:
{
  "missing_files": ["list any critical missing files with brief reason"],
  "needs_clarification": false,
  "clarification_question": "",
  "project_summary": {
    "what_it_does": "2-3 sentences in chosen language",
    "analogy": "one desi analogy for the whole project",
    "tech_stack": ["detected technologies"],
    "confidence": 0.85
  },
  "file_map": [
    {"file": "filename", "role": "what this file does in simple language", "importance": "high|medium|low"}
  ],
  "bugs_found": [
    {
      "title": "short bug title",
      "file": "filename",
      "line_hint": "approximate location",
      "what_broke": "explanation in chosen language",
      "why_it_broke": "why with analogy",
      "why_ai_looped": "why AI kept making it worse",
      "confidence": 0.8
    }
  ],
  "what_you_must_learn": [
    {"concept": "concept name", "explanation": "1-2 line simple explanation", "analogy": "desi analogy"}
  ],
  "security_scan": {
    "issues": [
      {"title": "issue", "severity": "high|medium|low", "explanation": "layman explanation", "analogy": "desi analogy"}
    ],
    "overall": "safe|warning|critical",
    "confidence": 0.75
  },
  "seo_performance": {
    "issues": [
      {"title": "issue", "impact": "effect on user/search", "fix_hint": "simple hint"}
    ],
    "confidence": 0.7
  }
}`;
  };

  const analyzeProject = async () => {
    if (files.length === 0) { setError("Koi file toh do analyse karne ke liye!"); return; }
    setError(""); setScreen("analyzing"); setLoadingStep(0);
    stepTimer.current = setInterval(() => setLoadingStep(s => s+1), 1800);
    try {
      const response = await fetch("https://api.anthropic.com/v1/messages", {
        method:"POST",
        headers:{ "Content-Type":"application/json" },
        body: JSON.stringify({
          model:"claude-sonnet-4-20250514",
          max_tokens:4000,
          messages:[{ role:"user", content:buildPrompt() }]
        })
      });
      const data = await response.json();
      clearInterval(stepTimer.current);
      const rawText = data.content?.map(c=>c.text||"").join("") || "";
      const parsed = parseReport(rawText);
      if (!parsed) { setError("Analysis process mein kuch gadbad ho gayi. Dobara try karo."); setScreen("input"); return; }
      if (parsed.needs_clarification && parsed.clarification_question) {
        setClarifications(c=>[...c, parsed.clarification_question]); setScreen("input"); return;
      }
      setReport(parsed); setScreen("report");
    } catch(err) {
      clearInterval(stepTimer.current);
      setError("Error: " + err.message); setScreen("input");
    }
  };

  const reset = () => {
    setScreen("onboard"); setProfile({level:"",goal:"",language:""}); setFiles([]);
    setReport(null); setClarifications([]); setError("");
  };

  const S = {
    app:{ minHeight:"100vh", background:"#070a0f", fontFamily:"'Inter',system-ui,sans-serif", color:"#e2e8f0" },
    nav:{ display:"flex", alignItems:"center", justifyContent:"space-between", padding:"16px 24px", borderBottom:"1px solid #1e293b", background:"#070a0f", position:"sticky", top:0, zIndex:100 },
    logo:{ fontSize:20, fontWeight:800, letterSpacing:"-0.5px", background:"linear-gradient(135deg,#a78bfa,#7c3aed)", WebkitBackgroundClip:"text", WebkitTextFillColor:"transparent" },
    wrap:{ maxWidth:720, margin:"0 auto", padding:"32px 20px" },
    card:{ background:"#0d1117", border:"1px solid #1e293b", borderRadius:16, padding:28, marginBottom:20 },
    h1:{ fontSize:28, fontWeight:800, marginBottom:8, letterSpacing:"-0.5px" },
    h2:{ fontSize:18, fontWeight:700, marginBottom:16, color:"#e2e8f0" },
    p:{ color:"#64748b", fontSize:14, lineHeight:1.6, marginBottom:16 },
    label:{ display:"block", color:"#94a3b8", fontSize:13, marginBottom:6, fontWeight:500 },
    input:{ width:"100%", background:"#0f1117", border:"1px solid #1e293b", borderRadius:8, padding:"10px 14px", color:"#e2e8f0", fontSize:14, outline:"none", boxSizing:"border-box" },
    textarea:{ width:"100%", background:"#0f1117", border:"1px solid #1e293b", borderRadius:8, padding:"10px 14px", color:"#e2e8f0", fontSize:13, outline:"none", boxSizing:"border-box", fontFamily:"monospace", resize:"vertical", minHeight:120 },
    btn:{ background:"linear-gradient(135deg,#7c3aed,#6d28d9)", color:"#fff", border:"none", borderRadius:8, padding:"10px 20px", cursor:"pointer", fontWeight:600, fontSize:14 },
    btnOut:{ background:"transparent", color:"#a78bfa", border:"1px solid #7c3aed44", borderRadius:8, padding:"8px 16px", cursor:"pointer", fontSize:13, fontWeight:500 },
    err:{ background:"#ef444418", border:"1px solid #ef444433", borderRadius:8, padding:"10px 14px", color:"#fca5a5", fontSize:13, marginBottom:12 },
    tag:{ display:"inline-block", background:"#1e293b", borderRadius:4, padding:"2px 8px", fontSize:11, color:"#94a3b8", margin:"2px" },
    optCard:(sel,c="#7c3aed")=>({ background:sel?c+"18":"#0f1117", border:`1px solid ${sel?c:"#1e293b"}`, borderRadius:10, padding:"12px 14px", cursor:"pointer", transition:"all 0.15s" }),
  };

  // ── ONBOARD ──────────────────────────────────────────────────
  if (screen === "onboard") return (
    <div style={S.app}>
      <nav style={S.nav}><span style={S.logo}>⚡ Unravel</span><span style={{color:"#475569",fontSize:12}}>Beta v1.0</span></nav>
      <div style={S.wrap}>
        <div style={{textAlign:"center",padding:"40px 0 32px"}}>
          <div style={{display:"inline-flex",alignItems:"center",gap:6,background:"#7c3aed18",border:"1px solid #7c3aed44",borderRadius:20,padding:"4px 14px",marginBottom:16}}>
            <span style={{color:"#a78bfa",fontSize:12}}>🇮🇳 Made for Indian Vibe Coders</span>
          </div>
          <h1 style={{...S.h1,color:"#f1f5f9",textAlign:"center"}}>
            Apna broken project<br/>
            <span style={{background:"linear-gradient(135deg,#a78bfa,#7c3aed)",WebkitBackgroundClip:"text",WebkitTextFillColor:"transparent"}}>Unravel karo</span>
          </h1>
          <p style={{...S.p,textAlign:"center",maxWidth:420,margin:"0 auto 32px"}}>
            AI ne kuch banaya, phir toot gaya, phir ChatGPT se fix karaya, aur aur toot gaya?<br/>
            <strong style={{color:"#94a3b8"}}>Yahi solve karta hai Unravel.</strong>
          </p>
        </div>
        <div style={S.card}>
          {error && <div style={S.err}>{error}</div>}
          <label style={S.label}>Tumhara coding level kya hai?</label>
          <div style={{display:"grid",gridTemplateColumns:"repeat(3,1fr)",gap:10,marginBottom:16}}>
            {Object.entries(LEVELS).map(([key,val])=>(
              <div key={key} style={S.optCard(profile.level===key)} onClick={()=>setProfile(p=>({...p,level:key}))}>
                <div style={{color:profile.level===key?"#a78bfa":"#e2e8f0",fontWeight:600,fontSize:13,marginBottom:4}}>{val.label}</div>
                <div style={{color:"#475569",fontSize:11}}>{val.desc}</div>
              </div>
            ))}
          </div>
          <label style={S.label}>Tumhara project kya karta hai? (apne words mein batao)</label>
          <input style={{...S.input,marginBottom:16}} placeholder="Jaise: Ek portfolio website banai thi, contact form kaam nahi kar raha..." value={profile.goal} onChange={e=>setProfile(p=>({...p,goal:e.target.value}))} />
          <label style={S.label}>Explanation kis language mein chahiye?</label>
          <div style={{display:"grid",gridTemplateColumns:"repeat(3,1fr)",gap:10,marginBottom:16}}>
            {Object.entries(LANGUAGES).map(([key,val])=>(
              <div key={key} style={S.optCard(profile.language===key,"#0ea5e9")} onClick={()=>setProfile(p=>({...p,language:key}))}>
                <div style={{color:profile.language===key?"#38bdf8":"#94a3b8",fontWeight:600,fontSize:14,textAlign:"center"}}>{val}</div>
              </div>
            ))}
          </div>
          <button style={{...S.btn,width:"100%",padding:"12px",fontSize:15}} onClick={handleOnboardSubmit}>Aage Badho →</button>
        </div>
      </div>
    </div>
  );

  // ── INPUT ─────────────────────────────────────────────────────
  if (screen === "input") return (
    <div style={S.app}>
      <nav style={S.nav}><span style={S.logo}>⚡ Unravel</span><button style={S.btnOut} onClick={reset}>← Wapas</button></nav>
      <div style={S.wrap}>
        <div style={{marginBottom:24}}>
          <h2 style={S.h2}>Apna project do</h2>
          <p style={S.p}>Files paste karo. Jitni zyada files, utna better analysis.</p>
        </div>
        {clarifications.length > 0 && (
          <div style={{background:"#f59e0b18",border:"1px solid #f59e0b44",borderRadius:10,padding:14,marginBottom:16}}>
            <div style={{color:"#fbbf24",fontWeight:600,marginBottom:4}}>🤔 Unravel ko kuch aur chahiye:</div>
            {clarifications.map((q,i)=><div key={i} style={{color:"#94a3b8",fontSize:13}}>• {q}</div>)}
          </div>
        )}
        {error && <div style={S.err}>{error}</div>}
        <div style={S.card}>
          <div style={{display:"flex",gap:8,marginBottom:16}}>
            <div style={{flex:1}}>
              <label style={S.label}>File ka naam (jaise: index.html, app.js)</label>
              <input style={S.input} placeholder="index.html" value={pasteFileName} onChange={e=>setPasteFileName(e.target.value)} />
            </div>
            <button style={{...S.btn,alignSelf:"flex-end",padding:"10px 14px",display:"flex",alignItems:"center",gap:4}} onClick={addPasteFile}>
              <IconPlus size={14}/> Add
            </button>
          </div>
          <label style={S.label}>Code paste karo</label>
          <textarea style={S.textarea} placeholder="Yahan apna code paste karo..." value={pasteContent} onChange={e=>setPasteContent(e.target.value)} />
          <div style={{display:"flex",alignItems:"center",gap:10,marginTop:10}}>
            <button style={S.btnOut} onClick={()=>fileInputRef.current.click()}>
              <span style={{display:"flex",alignItems:"center",gap:4}}><IconUpload size={14}/> File Upload Karo</span>
            </button>
            <span style={{color:"#475569",fontSize:11}}>Max 2MB per file • .js .jsx .html .css .json .ts</span>
          </div>
          <input ref={fileInputRef} type="file" multiple accept=".js,.jsx,.ts,.tsx,.html,.css,.json,.py,.txt,.md" style={{display:"none"}} onChange={handleFileUpload} />
        </div>
        {files.length > 0 && (
          <div style={{marginBottom:16}}>
            <div style={{color:"#94a3b8",fontSize:13,marginBottom:8}}>📁 {files.length} file{files.length>1?"s":""} ready</div>
            {files.map((f,i)=><FileCard key={i} name={f.name} content={f.content} onRemove={()=>setFiles(fs=>fs.filter((_,j)=>j!==i))} />)}
          </div>
        )}
        <button style={{...S.btn,width:"100%",padding:"13px",fontSize:15,opacity:files.length===0?0.5:1}} onClick={analyzeProject} disabled={files.length===0}>
          🔍 Unravel Karo →
        </button>
      </div>
    </div>
  );

  // ── ANALYZING ────────────────────────────────────────────────
  if (screen === "analyzing") return (
    <div style={S.app}>
      <nav style={S.nav}><span style={S.logo}>⚡ Unravel</span></nav>
      <div style={S.wrap}><LoadingPulse step={loadingStep} /></div>
    </div>
  );

  // ── REPORT ────────────────────────────────────────────────────
  if (screen === "report" && report) {
    const R = report;
    return (
      <div style={S.app}>
        <nav style={S.nav}>
          <span style={S.logo}>⚡ Unravel</span>
          <button style={S.btnOut} onClick={reset}>🔄 Naya Analysis</button>
        </nav>
        <div style={S.wrap}>
          <div style={{marginBottom:24}}>
            <div style={{display:"inline-flex",alignItems:"center",gap:6,background:"#22c55e18",border:"1px solid #22c55e44",borderRadius:20,padding:"4px 14px",marginBottom:12}}>
              <span style={{color:"#86efac",fontSize:12}}>✅ Analysis Complete</span>
            </div>
            <h1 style={{...S.h1,fontSize:22}}>Tumhare project ki X-Ray Report</h1>
          </div>

          {R.missing_files?.length > 0 && (
            <div style={{background:"#f59e0b18",border:"1px solid #f59e0b44",borderRadius:10,padding:16,marginBottom:16}}>
              <div style={{color:"#fbbf24",fontWeight:700,marginBottom:8}}>⚠️ Kuch files missing lagti hain</div>
              {R.missing_files.map((f,i)=><div key={i} style={{color:"#94a3b8",fontSize:13,marginBottom:4}}>• {f}</div>)}
              <div style={{color:"#64748b",fontSize:12,marginTop:8}}>In files ko bhi add karo for complete analysis.</div>
            </div>
          )}

          {/* Project Summary */}
          <SectionCard icon={<IconSearch size={18}/>} title="Project Kya Karta Hai?" color="#a78bfa" confidence={R.project_summary?.confidence}>
            <p style={{margin:"0 0 10px",color:"#cbd5e1"}}>{R.project_summary?.what_it_does}</p>
            {R.project_summary?.analogy && (
              <div style={{background:"#7c3aed18",borderRadius:8,padding:"10px 14px",borderLeft:"3px solid #7c3aed",marginBottom:10}}>
                <span style={{color:"#a78bfa",fontWeight:600}}>🪔 Simple mein: </span><span>{R.project_summary.analogy}</span>
              </div>
            )}
            {R.project_summary?.tech_stack?.length > 0 && (
              <div><span style={{color:"#475569",fontSize:12}}>Tech: </span>{R.project_summary.tech_stack.map(t=><span key={t} style={S.tag}>{t}</span>)}</div>
            )}
          </SectionCard>

          {/* File Map */}
          {R.file_map?.length > 0 && (
            <SectionCard icon={<IconFile size={18}/>} title="Har File Ka Role" color="#38bdf8">
              {R.file_map.map((f,i)=>(
                <div key={i} style={{display:"flex",gap:10,marginBottom:8,padding:"8px 12px",background:"#070a0f",borderRadius:8,border:"1px solid #0f172a"}}>
                  <span style={{fontSize:10,fontWeight:700,padding:"2px 6px",borderRadius:4,alignSelf:"flex-start",marginTop:2,
                    background:f.importance==="high"?"#ef444422":f.importance==="medium"?"#f59e0b22":"#1e293b",
                    color:f.importance==="high"?"#fca5a5":f.importance==="medium"?"#fbbf24":"#475569"}}>
                    {f.importance}
                  </span>
                  <div>
                    <div style={{color:"#7dd3fc",fontSize:12,fontFamily:"monospace",marginBottom:3}}>{f.file}</div>
                    <div style={{color:"#94a3b8",fontSize:13}}>{f.role}</div>
                  </div>
                </div>
              ))}
            </SectionCard>
          )}

          {/* Bugs */}
          <SectionCard icon={<IconZap size={18}/>} title={R.bugs_found?.length > 0 ? `${R.bugs_found.length} Problem${R.bugs_found.length>1?"s":""} Mili` : "Bugs"} color="#ef4444">
            {R.bugs_found?.length > 0 ? R.bugs_found.map((bug,i)=>(
              <div key={i} style={{background:"#0f1117",border:"1px solid #ef444422",borderRadius:10,padding:14,marginBottom:10}}>
                <div style={{display:"flex",justifyContent:"space-between",alignItems:"flex-start",marginBottom:8}}>
                  <span style={{color:"#fca5a5",fontWeight:700,fontSize:14}}>🐛 {bug.title}</span>
                  <ConfidenceBadge score={bug.confidence} />
                </div>
                <div style={{color:"#64748b",fontSize:11,fontFamily:"monospace",marginBottom:8}}>{bug.file}{bug.line_hint && ` • ${bug.line_hint}`}</div>
                <div style={{marginBottom:6}}><span style={{color:"#ef4444",fontWeight:600,fontSize:12}}>Kya hua: </span><span style={{color:"#94a3b8",fontSize:13}}>{bug.what_broke}</span></div>
                <div style={{marginBottom:6}}><span style={{color:"#f59e0b",fontWeight:600,fontSize:12}}>Kyun hua: </span><span style={{color:"#94a3b8",fontSize:13}}>{bug.why_it_broke}</span></div>
                {bug.why_ai_looped && (
                  <div style={{background:"#f59e0b11",borderRadius:6,padding:"6px 10px",borderLeft:"2px solid #f59e0b"}}>
                    <span style={{color:"#fbbf24",fontWeight:600,fontSize:12}}>AI loop kyun bana: </span>
                    <span style={{color:"#94a3b8",fontSize:12}}>{bug.why_ai_looped}</span>
                  </div>
                )}
              </div>
            )) : <span style={{color:"#86efac"}}>✅ Koi obvious bug nahi mila provided files mein.</span>}
          </SectionCard>

          {/* Must Learn */}
          {R.what_you_must_learn?.length > 0 && (
            <SectionCard icon={<span>🧠</span>} title="Ye Samajhna Zaroori Hai" color="#f59e0b">
              {R.what_you_must_learn.map((item,i)=>(
                <div key={i} style={{marginBottom:12,paddingBottom:12,borderBottom:i<R.what_you_must_learn.length-1?"1px solid #1e293b":"none"}}>
                  <div style={{color:"#fbbf24",fontWeight:700,fontSize:13,marginBottom:4}}>#{i+1} {item.concept}</div>
                  <div style={{color:"#94a3b8",fontSize:13,marginBottom:4}}>{item.explanation}</div>
                  {item.analogy && <div style={{color:"#78716c",fontSize:12,fontStyle:"italic"}}>💡 {item.analogy}</div>}
                </div>
              ))}
            </SectionCard>
          )}

          {/* Security */}
          <SectionCard icon={<IconShield size={18}/>} title="Security Scan" color="#8b5cf6" confidence={R.security_scan?.confidence}>
            {R.security_scan?.issues?.length > 0 ? R.security_scan.issues.map((issue,i)=>(
              <div key={i} style={{background:issue.severity==="high"?"#ef444411":issue.severity==="medium"?"#f59e0b11":"#0f172a",border:`1px solid ${issue.severity==="high"?"#ef444433":issue.severity==="medium"?"#f59e0b33":"#1e293b"}`,borderRadius:8,padding:12,marginBottom:8}}>
                <div style={{display:"flex",gap:8,alignItems:"center",marginBottom:6}}>
                  <span style={{fontSize:10,fontWeight:700,padding:"2px 6px",borderRadius:4,background:issue.severity==="high"?"#ef4444":issue.severity==="medium"?"#f59e0b":"#475569",color:"#fff"}}>{issue.severity.toUpperCase()}</span>
                  <span style={{color:"#e2e8f0",fontWeight:600,fontSize:13}}>{issue.title}</span>
                </div>
                <div style={{color:"#94a3b8",fontSize:13,marginBottom:4}}>{issue.explanation}</div>
                {issue.analogy && <div style={{color:"#64748b",fontSize:12,fontStyle:"italic"}}>🔐 {issue.analogy}</div>}
              </div>
            )) : <span style={{color:"#86efac"}}>✅ Koi obvious security issue nahi mila!</span>}
          </SectionCard>

          {/* SEO */}
          <SectionCard icon={<span>🚀</span>} title="SEO & Performance" color="#06b6d4" confidence={R.seo_performance?.confidence}>
            {R.seo_performance?.issues?.length > 0 ? R.seo_performance.issues.map((issue,i)=>(
              <div key={i} style={{marginBottom:10,paddingBottom:10,borderBottom:i<R.seo_performance.issues.length-1?"1px solid #0f172a":"none"}}>
                <div style={{color:"#7dd3fc",fontWeight:600,fontSize:13,marginBottom:3}}>📌 {issue.title}</div>
                <div style={{color:"#94a3b8",fontSize:13,marginBottom:3}}>{issue.impact}</div>
                {issue.fix_hint && <div style={{color:"#475569",fontSize:12}}>💡 Fix: {issue.fix_hint}</div>}
              </div>
            )) : <span style={{color:"#86efac"}}>✅ Basic SEO theek lag raha hai!</span>}
          </SectionCard>

          <div style={{textAlign:"center",padding:"24px 0 40px"}}>
            <button style={{...S.btn,padding:"12px 28px",marginRight:10}} onClick={()=>{setFiles([]);setScreen("input");}}>Nayi Files Add Karo</button>
            <button style={S.btnOut} onClick={reset}>New Project Shuru Karo</button>
          </div>
        </div>
      </div>
    );
  }

  return null;
}