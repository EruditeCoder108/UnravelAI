import { useState, useRef } from "react";

const C = {
  bg:"#0a0a0f",surface:"#12121a",border:"#1e1e2e",
  accent:"#7c6aff",accentG:"#7c6aff33",accentD:"#4a3fa0",
  text:"#e8e6ff",muted:"#6b6890",dim:"#3d3b5c",danger:"#f87171",
};
const EXP=[
  {id:"zero",e:"🧸",l:"Zero coding",d:"Maine kabhi code nahi likha"},
  {id:"vibe",e:"🎨",l:"Vibe coder",d:"AI se banata hoon, samajh nahi aata"},
  {id:"some",e:"📚",l:"Thoda seekha",d:"Basics aate hain, advanced nahi"},
  {id:"dev",e:"💻",l:"Developer",d:"Code likhta hoon but confuse hoon"},
];
const LANGS=[
  {id:"hinglish",e:"🇮🇳",l:"Hinglish",d:"Mix of Hindi + English"},
  {id:"hindi",e:"🕉️",l:"Pure Hindi",d:"Seedhi baat, Hindi mein"},
  {id:"english",e:"🌐",l:"English",d:"Simple English only"},
];

function getSys(exp,lang){
  const eM={zero:"ZERO coding knowledge. Explain like they're 10 using simple analogies.",vibe:"Vibe coder using Cursor/Bolt/Lovable. Knows what app should DO, not HOW it works.",some:"Knows basic HTML/CSS, lost with JS logic and APIs.",dev:"Developer confused about why something is broken or how parts connect."};
  const lM={hinglish:"CRITICAL: Reply ONLY in natural Hinglish (Hindi+English mix) like Indian friends talk. E.g. 'Yaar, yeh file basically tera app ka brain hai.' Technical terms in English, explained in Hindi.",hindi:"CRITICAL: Reply ONLY in simple clear Hindi. Translate all technical terms.",english:"CRITICAL: Reply ONLY in very simple plain English. Zero jargon."};
  return `You are Unravel - friendly AI that explains broken code to Indian users in plain language.\nUSER: ${eM[exp]}\nLANGUAGE: ${lM[lang]}\n\nTASK:\n1. If critical files seem missing, ask for them FIRST. Say exactly which file and why.\n2. Otherwise give this structured report:\n\n**🧩 Kya Bana Hai?**\nWhat is this? 3-4 sentences with real Indian-life analogy.\n\n**⚙️ Kaise Kaam Karta Hai?**\nHow it works, like a story. No unexplained jargon.\n\n**🐛 Kya Toota Hua Hai?**\nEach bug: what's wrong + why + how to fix (exact steps).\n\n**🔐 Security Check**\nSecurity holes with analogies (ghar ki chaabi, doormat, etc.)\n\n**🚀 Speed & Performance**\nFast or slow? Why? Quick fixes?\n\n**📈 SEO**\nWill Google find this? What's missing?\n\n**💡 Sabse Pehle Yeh Fix Karo**\nThe ONE most important fix right now.\n\nRULES: Use Indian daily life analogies. Never make up behavior you cannot see. Be warm like a senior developer dost.`;
}

export default function App(){
  const [step,setStep]=useState(1);
  const [exp,setExp]=useState(null);
  const [lang,setLang]=useState(null);
  const [mode,setMode]=useState("paste");
  const [ghUrl,setGhUrl]=useState("");
  const [files,setFiles]=useState([]);
  const [fname,setFname]=useState("");
  const [fc,setFc]=useState("");
  const [loading,setLoading]=useState(false);
  const [lmsg,setLmsg]=useState("");
  const [lpct,setLpct]=useState(0);
  const [err,setErr]=useState(null);
  const [conv,setConv]=useState([]);
  const [fup,setFup]=useState("");
  const [fupL,setFupL]=useState(false);
  const ref=useRef(null);

  const card={background:C.surface,border:`1px solid ${C.border}`,borderRadius:16,padding:24,marginBottom:14};
  const btnS=(v="p")=>({background:v==="p"?"linear-gradient(135deg,#7c6aff,#9b5de5)":"transparent",border:v==="p"?"none":`1.5px solid ${C.border}`,color:v==="p"?"#fff":C.muted,borderRadius:10,padding:"10px 20px",fontSize:14,fontWeight:600,cursor:"pointer",fontFamily:"inherit",display:"inline-flex",alignItems:"center",gap:8});
  const inp={width:"100%",background:"#0d0d15",border:`1.5px solid ${C.border}`,borderRadius:10,color:C.text,fontSize:14,padding:"11px 14px",outline:"none",boxSizing:"border-box",fontFamily:"inherit",marginBottom:8};
  const ta={...inp,fontFamily:"monospace",fontSize:13,resize:"vertical",minHeight:90};
  const optS=(sel)=>({background:sel?C.accentG:"transparent",border:`1.5px solid ${sel?C.accent:C.border}`,borderRadius:12,padding:"12px 13px",cursor:"pointer"});
  const tabS=(a)=>({padding:"7px 14px",borderRadius:8,fontSize:13,fontWeight:600,cursor:"pointer",background:a?C.accentG:"transparent",border:`1.5px solid ${a?C.accent:C.border}`,color:a?C.text:C.muted});

  async function fetchGH(url){
    const m=url.match(/github\.com\/([^\/]+)\/([^\/\s#?]+)/);
    if(!m)throw new Error("GitHub URL sahi nahi. Format: https://github.com/user/repo");
    const[,owner,repo]=m;const r=repo.replace(/\.git$/,"");
    setLmsg("GitHub repo fetch kar raha hoon...");setLpct(20);
    const tr=await fetch(`https://api.github.com/repos/${owner}/${r}/git/trees/HEAD?recursive=1`);
    if(!tr.ok)throw new Error("Repo nahi mila. Kya yeh public hai?");
    const tree=await tr.json();
    const exts=[".js",".jsx",".ts",".tsx",".html",".css",".py",".json",".md",".vue"];
    const skip=["node_modules",".git","dist","build",".next"];
    const picks=(tree.tree||[]).filter(f=>f.type==="blob"&&exts.some(e=>f.path.endsWith(e))&&!skip.some(d=>f.path.startsWith(d+"/"))&&(f.size||0)<55000).slice(0,16);
    setLmsg(`${picks.length} files mil gayi...`);setLpct(40);
    const out=await Promise.all(picks.map(async f=>{
      try{const res=await fetch(`https://api.github.com/repos/${owner}/${r}/contents/${f.path}`);if(!res.ok)return null;const d=await res.json();return{name:f.path,content:atob(d.content.replace(/\n/g,"")).slice(0,3500)};}catch{return null;}
    }));
    return out.filter(Boolean);
  }

  async function analyze(){
    setLoading(true);setErr(null);setLpct(5);setLmsg("Shuruaat...");
    try{
      let fs=mode==="github"?await fetchGH(ghUrl):files;
      if(!fs.length)throw new Error("Koi file nahi mili.");
      const block=fs.map(f=>`=== ${f.name} ===\n${f.content}`).join("\n\n");
      const um=`Yeh mera project hai:\n\n${block}`;
      setLmsg("AI analyze kar rahi hai...");setLpct(65);
      const res=await fetch("https://api.anthropic.com/v1/messages",{method:"POST",headers:{"Content-Type":"application/json"},body:JSON.stringify({model:"claude-sonnet-4-20250514",max_tokens:1000,system:getSys(exp,lang),messages:[{role:"user",content:um}]})});
      const data=await res.json();
      const text=(data.content||[]).map(c=>c.text||"").join("");
      if(!text)throw new Error("AI se jawab nahi aaya.");
      setLpct(100);setConv([{role:"user",content:um},{role:"assistant",content:text}]);
      setStep(4);setTimeout(()=>ref.current?.scrollIntoView({behavior:"smooth"}),200);
    }catch(e){setErr(e.message);setStep(2);}
    finally{setLoading(false);}
  }

  async function doFup(){
    if(!fup.trim()||fupL)return;setFupL(true);
    const nc=[...conv,{role:"user",content:fup}];setFup("");
    try{
      const res=await fetch("https://api.anthropic.com/v1/messages",{method:"POST",headers:{"Content-Type":"application/json"},body:JSON.stringify({model:"claude-sonnet-4-20250514",max_tokens:1000,system:getSys(exp,lang),messages:nc})});
      const data=await res.json();const text=(data.content||[]).map(c=>c.text||"").join("");
      setConv([...nc,{role:"assistant",content:text}]);
    }catch{setErr("Follow-up error.");}
    finally{setFupL(false);}
  }

  function renderReport(){
    const txt=conv.filter(m=>m.role==="assistant").map(m=>m.content).join("\n\n---\n\n");
    const ic={"🧩":"#7c6aff22","⚙️":"#4ade8022","🐛":"#f8717122","🔐":"#fbbf2422","🚀":"#60a5fa22","📈":"#a78bfa22","💡":"#f472b622"};
    return txt.split(/(?=\*\*[🧩⚙️🐛🔐🚀📈💡])/).map((p,i)=>{
      const m=p.match(/^\*\*([^*]+)\*\*\n?([\s\S]*)/);
      if(!m)return <div key={i} style={{fontSize:14,color:"#c4c0e8",lineHeight:1.85,whiteSpace:"pre-wrap"}}>{p.trim()}</div>;
      const[,title,body]=m;const em=[...title].find(c=>ic[c]);
      return(
        <div key={i}>
          {i>0&&<div style={{height:1,background:C.border,margin:"16px 0"}}/>}
          <div style={{display:"flex",alignItems:"center",gap:9,marginBottom:10}}>
            <div style={{width:30,height:30,borderRadius:8,background:ic[em]||"#fff1",display:"flex",alignItems:"center",justifyContent:"center",fontSize:15,flexShrink:0}}>{em}</div>
            <div style={{fontSize:15,fontWeight:700,color:C.text}}>{title.replace(em||"","").trim()}</div>
          </div>
          <div style={{fontSize:14,color:"#c4c0e8",lineHeight:1.85,whiteSpace:"pre-wrap"}}>{body.trim()}</div>
        </div>
      );
    });
  }

  const canGo=(mode==="github"&&ghUrl.trim())||(mode==="paste"&&files.length>0);

  return(
    <div style={{minHeight:"100vh",background:C.bg,color:C.text,fontFamily:"'Inter',-apple-system,sans-serif",display:"flex",flexDirection:"column",alignItems:"center",padding:"0 16px 80px"}}>
      <div style={{width:"100%",maxWidth:700,padding:"28px 0 0",display:"flex",alignItems:"center",gap:12}}>
        <div style={{fontSize:26,fontWeight:800,background:"linear-gradient(135deg,#7c6aff,#f472b6)",WebkitBackgroundClip:"text",WebkitTextFillColor:"transparent"}}>Unravel</div>
        <div style={{fontSize:10,fontWeight:700,background:C.accentG,color:C.accent,border:`1px solid ${C.accentD}`,borderRadius:6,padding:"2px 8px",letterSpacing:1,textTransform:"uppercase"}}>Beta v1</div>
      </div>
      <div style={{width:"100%",maxWidth:700,marginTop:28}}>

        {/* STEP 1 */}
        <div style={{...card,opacity:step>1?0.4:1,pointerEvents:step>1?"none":"all"}}>
          <div style={{fontSize:11,fontWeight:700,color:C.accent,letterSpacing:2,textTransform:"uppercase",marginBottom:6}}>Step 1 of 3</div>
          <div style={{fontSize:18,fontWeight:700,marginBottom:6}}>Pehle batao — tum code kitna jaante ho?</div>
          <div style={{fontSize:13,color:C.muted,marginBottom:18}}>Yeh batane se Unravel tumhare level pe explain karega.</div>
          <div style={{display:"grid",gridTemplateColumns:"repeat(auto-fit,minmax(145px,1fr))",gap:8,marginBottom:20}}>
            {EXP.map(o=><div key={o.id} style={optS(exp===o.id)} onClick={()=>setExp(o.id)}><div style={{fontSize:20,marginBottom:4}}>{o.e}</div><div style={{fontSize:13,fontWeight:600,color:exp===o.id?C.text:C.muted,marginBottom:2}}>{o.l}</div><div style={{fontSize:11,color:C.dim,lineHeight:1.4}}>{o.d}</div></div>)}
          </div>
          <div style={{fontSize:18,fontWeight:700,marginBottom:6}}>Kaunsi language mein samjhao?</div>
          <div style={{display:"grid",gridTemplateColumns:"repeat(3,1fr)",gap:8,marginBottom:20}}>
            {LANGS.map(o=><div key={o.id} style={optS(lang===o.id)} onClick={()=>setLang(o.id)}><div style={{fontSize:20,marginBottom:4}}>{o.e}</div><div style={{fontSize:13,fontWeight:600,color:lang===o.id?C.text:C.muted,marginBottom:2}}>{o.l}</div><div style={{fontSize:11,color:C.dim,lineHeight:1.4}}>{o.d}</div></div>)}
          </div>
          <button style={btnS()} disabled={!exp||!lang} onClick={()=>setStep(2)}>Aage Chalo →</button>
        </div>

        {/* STEP 2 */}
        {step>=2&&(
          <div style={{...card,opacity:step>2?0.4:1,pointerEvents:step>2?"none":"all"}}>
            <div style={{fontSize:11,fontWeight:700,color:C.accent,letterSpacing:2,textTransform:"uppercase",marginBottom:6}}>Step 2 of 3</div>
            <div style={{fontSize:18,fontWeight:700,marginBottom:6}}>Apna code do</div>
            <div style={{fontSize:13,color:C.muted,marginBottom:18}}>GitHub link do ya files paste karo. Jitna zyada doge, utna better report milegi.</div>
            <div style={{display:"flex",gap:8,marginBottom:14}}>
              <div style={tabS(mode==="paste")} onClick={()=>setMode("paste")}>📋 Files Paste Karo</div>
              <div style={tabS(mode==="github")} onClick={()=>setMode("github")}>🐙 GitHub Repo</div>
            </div>
            {mode==="github"&&<><input style={inp} placeholder="https://github.com/username/my-project" value={ghUrl} onChange={e=>setGhUrl(e.target.value)}/><div style={{fontSize:12,color:C.dim,marginBottom:14}}>Sirf public repos ke liye abhi</div></>}
            {mode==="paste"&&<>
              {files.length>0&&<div style={{marginBottom:10}}>{files.map((f,i)=><span key={i} style={{display:"inline-flex",alignItems:"center",gap:5,background:"#0d0d15",border:`1px solid ${C.border}`,borderRadius:6,padding:"3px 9px",fontSize:12,color:C.muted,margin:"3px 3px 3px 0",fontFamily:"monospace"}}>📄 {f.name}<button onClick={()=>setFiles(p=>p.filter((_,j)=>j!==i))} style={{background:"none",border:"none",color:C.dim,cursor:"pointer",padding:0,fontSize:14}}>×</button></span>)}</div>}
              <input style={inp} placeholder="File ka naam (e.g. App.jsx, index.html)" value={fname} onChange={e=>setFname(e.target.value)}/>
              <textarea style={{...ta,marginBottom:8}} placeholder="Yahan code paste karo..." value={fc} onChange={e=>setFc(e.target.value)} rows={5}/>
              <div style={{display:"flex",alignItems:"center",gap:10,marginBottom:14}}>
                <button style={btnS("s")} onClick={()=>{if(fname.trim()&&fc.trim()){setFiles(p=>[...p,{name:fname.trim(),content:fc.trim()}]);setFname("");setFc("");}}} disabled={!fname.trim()||!fc.trim()}>+ File Add Karo</button>
                {files.length>0&&<span style={{fontSize:13,color:C.muted}}>{files.length} file{files.length>1?"s":""} ready ✓</span>}
              </div>
            </>}
            {err&&<div style={{color:C.danger,fontSize:13,marginBottom:12,padding:"10px 14px",background:"#f8717111",borderRadius:8}}>⚠️ {err}</div>}
            {loading?<div><div style={{fontSize:14,color:C.muted,marginBottom:4}}>{lmsg}</div><div style={{width:"100%",height:3,background:C.border,borderRadius:2,overflow:"hidden"}}><div style={{height:"100%",width:`${lpct}%`,background:"linear-gradient(90deg,#7c6aff,#f472b6)",transition:"width 0.4s ease"}}/></div></div>
            :<button style={btnS()} disabled={!canGo} onClick={()=>{setStep(3);analyze();}}>🔍 Unravel Karo</button>}
          </div>
        )}

        {step===3&&<div style={card}><div style={{fontSize:11,fontWeight:700,color:C.accent,letterSpacing:2,textTransform:"uppercase",marginBottom:6}}>Analyzing...</div><div style={{fontSize:18,fontWeight:700,marginBottom:6}}>{lmsg}</div><div style={{fontSize:13,color:C.muted,marginBottom:14}}>Ek second yaar...</div><div style={{width:"100%",height:3,background:C.border,borderRadius:2,overflow:"hidden"}}><div style={{height:"100%",width:`${lpct}%`,background:"linear-gradient(90deg,#7c6aff,#f472b6)",transition:"width 0.4s ease"}}/></div></div>}

        {/* STEP 4 */}
        {step===4&&<div ref={ref}>
          <div style={{display:"flex",justifyContent:"space-between",alignItems:"flex-start",marginBottom:14}}>
            <div><div style={{fontSize:19,fontWeight:800}}>Unravel Report 📋</div><div style={{fontSize:13,color:C.muted,marginTop:2}}>Tera project, seedha samjhaya gaya</div></div>
            <button style={btnS("s")} onClick={()=>{setStep(2);setConv([]);setErr(null);}}>← Naya Project</button>
          </div>
          <div style={card}>{renderReport()}</div>
          <div style={card}>
            <div style={{fontSize:15,fontWeight:700,marginBottom:4}}>Aur kuch poochna hai? 💬</div>
            <div style={{fontSize:13,color:C.muted,marginBottom:14}}>Koi bhi sawaal — main usi language mein jawab dunga.</div>
            {conv.slice(2).map((m,i)=><div key={i} style={{marginBottom:10,padding:"10px 14px",borderRadius:10,background:m.role==="user"?C.accentG:"#0d0d15",border:`1px solid ${m.role==="user"?C.accentD:C.border}`}}><div style={{fontSize:11,color:m.role==="user"?C.accent:C.muted,fontWeight:700,marginBottom:4,textTransform:"uppercase",letterSpacing:1}}>{m.role==="user"?"Tumne Pucha":"Unravel"}</div><div style={{fontSize:14,lineHeight:1.75,whiteSpace:"pre-wrap"}}>{m.content}</div></div>)}
            <textarea style={{...ta,marginBottom:8}} placeholder="E.g. 'Yeh security bug kaise fix karun?' ya 'Bina React seekhe improve kar sakta hoon?'" value={fup} onChange={e=>setFup(e.target.value)} rows={3} onKeyDown={e=>{if(e.key==="Enter"&&(e.ctrlKey||e.metaKey))doFup();}}/>
            <button style={btnS()} onClick={doFup} disabled={fupL||!fup.trim()}>{fupL?"Soch raha hoon...":"Poochho →"}</button>
            <div style={{fontSize:11,color:C.dim,marginTop:6}}>Ctrl+Enter bhi kaam karta hai</div>
          </div>
        </div>}

        {step===1&&<div style={{textAlign:"center",marginTop:32,fontSize:13,color:C.dim,lineHeight:2}}>Tera AI-built code kya kar raha hai — plain language mein batao.<br/>Bugs • Security • Speed • SEO — sab kuch, bina bakwas ke.</div>}
      </div>
    </div>
  );
}