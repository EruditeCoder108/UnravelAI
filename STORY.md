# How We Built Unravel

> Most AI tools can write code. Unravel is built to explain **why that code broke.**

---

## The Core Problem We're Solving

You write code. It breaks. You paste it into ChatGPT. It gives you a fix. You apply it. Something else breaks. You paste again. An hour later you've made 12 changes and the original bug is still there.

This happens because ChatGPT doesn't actually understand your code. It pattern-matches. It sees "timer inaccurate" in your description and thinks "timer problem → suggest timer fix." It never asks the real question: **where exactly did the data go wrong?**

Unravel is built to answer that real question. Deterministically. With evidence.

## The Analogy

Think of debugging like investigating a crime.

**ChatGPT is a witness.** It saw something happen, it gives you a story. The story might be mostly right. It might be completely wrong. It's confident either way.

**Unravel is a forensic investigator.** Before it forms any theory, it collects evidence. It maps the crime scene. It traces exactly who touched what, when, and in what order. Only then does it tell you what happened — and it shows you the evidence.

---

## Phase 1 — "We Built the Investigator"

*Built in: 1 day.*

This was the first version. The web app. Five screens:

1. Enter your API key
2. Paste your code
3. Describe the bug
4. Wait for analysis
5. Read the report

### What Made It Different From Just Asking ChatGPT

**The 8-phase pipeline.** Instead of letting the AI jump straight to a guess, we force it through 8 steps in order:

1. **INGEST** — Read everything, don't theorize yet
2. **TRACK STATE** — Map every variable: where was it created? Where was it changed? Where was it read?
3. **SIMULATE** — What happens when the user does the thing that causes the bug?
4. **INVARIANTS** — What rule is being violated?
5. **ROOT CAUSE** — Only NOW name the root cause
6. **MINIMAL FIX** — Not a rewrite, one surgical change
7. **AI LOOP** — Why would ChatGPT have failed on this specific bug?
8. **CONCEPT** — What programming concept does this bug teach?

This is like the difference between a doctor who says "take this pill" after you describe your symptoms over text, versus one who runs blood tests, checks your history, examines you properly, and then diagnoses.

### Anti-Sycophancy Rules

AI models are trained to be agreeable. If you say "I think the bug is on line 50," they'll often validate that even if line 50 is perfectly fine. We hardcoded 5 rules that override this:

1. If there's no bug, say so. Don't invent one.
2. If the user's description contradicts the code, point it out.
3. If uncertain, say "I can't confirm without running the code."
4. Every claim needs exact line number + exact code as proof.
5. Never describe behavior that isn't visible in the provided files.

We also built for three AI providers — Anthropic (Claude), Google (Gemini), OpenAI (GPT). You bring your own API key. Nothing goes to our servers.

**Phase 1 result:** A working web app that produces structured, evidence-backed bug diagnoses. Smarter than ChatGPT for debugging. Proven on real bugs.

---

## Phase 2 — "We Proved It Works"

*Built in: Same day as Phase 1.*

Phase 1 was smart. Phase 2 made it **deterministic** — meaning part of the analysis is now mathematically guaranteed to be correct, not just AI-estimated.

### The Big Idea: AST Pre-Analysis

AST stands for Abstract Syntax Tree. When a computer reads code, it doesn't see text — it sees a tree of logical pieces. An AST parser lets you walk that tree and extract facts about the code **without running it**.

Think of it like this. Instead of asking the AI "where is the duration variable changed?" — which it might get wrong — we just **tell it** before the conversation starts:

```
VERIFIED FACTS (extracted by code, not guessed):
  duration
    written at: pause() line 69, setMode() line 86
    read at:    tick() line 55, start() line 42
```

This is injected into the prompt as ground truth. The AI can't disagree with it. It can't hallucinate. These are facts extracted directly from your code by a parser — same tool that the JavaScript engine itself uses.

### What We Extract

1. **Variable mutation chains** — every variable, everywhere it's written, everywhere it's read, which function does each.
2. **Closure captures** — when a function "remembers" a variable from outside itself, sometimes that memory gets stale. The parser detects exactly which functions hold onto which variables.
3. **Timing nodes** — every `setTimeout`, `setInterval`, `addEventListener`, `fetch`, `Promise`. These are where bugs hide most often in JavaScript because they run at different times than the rest of the code.

### The Benchmark Suite

10 deliberately buggy programs, each with a known correct answer — the real root cause. We run Unravel on all 10 twice: once without AST context (baseline), once with AST context (enhanced). The difference in accuracy is the proof that AST pre-analysis actually helps.

**Phase 2 result:** The engine now has a deterministic, hallucination-free foundation before AI reasoning even starts. The benchmark suite lets us measure accuracy with real numbers.

---

## Phase 3 — "We Made It Reusable and Put It in VS Code (Antigravity, Windsurf, Cursor)"

*Built in: Same day.*

### Part 1: Core Extraction

Until now, the engine lived inside the web app. If we wanted to put it in a VS Code extension, we'd have to rewrite everything.

We extracted all the important logic — the AST analyzer, the AI calling code, the prompt builder, the JSON parser — into a separate folder called `src/core/`. Zero React, zero browser dependencies. Pure Node.js.

Now the engine is a module. One function: `orchestrate(files, symptom, options)`. You give it files and a bug description, it gives you back a structured report. Doesn't matter if the caller is a web app, a VS Code extension, a CLI tool, or anything else.

This is like taking the engine out of a car and making it work standalone. Now you can put it in a truck, a boat, whatever.

### Part 2: VS Code / Cursor / Windsurf Extension

The extension is a shell around `orchestrate()`. Here's the complete user flow:

1. You're in VS Code, Cursor, or Windsurf looking at buggy code
2. You right-click the file → **"Unravel: Debug This File"**
3. First time only: it asks for your API key, saves it
4. It asks: "describe the bug in one sentence"
5. Status bar shows: `AST analyzing... → calling AI... → parsing...`
6. Results appear simultaneously:
   - **Red squiggly line** on the exact bug line (like a spelling mistake underline, but for logic)
   - **Inline text** appears after that line: `🔴 ROOT CAUSE: STATE_MUTATION`
   - **Hover** over the red line → tooltip showing the fix + confidence percentage
   - **Sidebar panel** opens with the full structured report

The extension also reads imported files automatically. If your buggy file imports from `utils.js`, Unravel reads `utils.js` too (up to 2 levels deep). This matters because many bugs span multiple files.

### Part 3: Web App UX

We also upgraded the web app's file handling:
- **File list with names** — see every uploaded file, not just a count
- **Remove individual files** — ✕ button per file + "Clear All"
- **Upload appends** — adding more files doesn't replace what's already there
- **GitHub Import** — paste a public repo URL and the codebase is fetched automatically

**Phase 3 result:** The engine is now a reusable module that can live anywhere. The VS Code / Cursor extension is built, packaged as a `.vsix`, and tested end-to-end. The web app has proper file management and GitHub import.

---

## Where We Are Right Now

Three things that actually exist and work:

1. **The web app** — live on Netlify. Any developer in the world can use it right now. Bring your own API key, paste code (or upload a folder, or import from GitHub), get a structured diagnosis.
2. **The extension (VS Code / Cursor / Windsurf)** — packaged as a `.vsix` file. Distributable. Right-click debugging with inline red squiggles, hover tooltips, sidebar report. Tested end-to-end.
3. **The core engine** — `orchestrate()`, a standalone module. This is what makes future phases buildable without starting from scratch.

---

## 🏆 The Benchmark Proof: Beating SOTA with Flash

The entire architecture of Unravel hinges on a specific hypothesis: **giving a weaker AI model deterministic context over 9 phases is better than giving a state-of-the-art model raw code.**

We proved this on the hardest bug class in software engineering: **The Heisenbug**.

We ran the exact same code (a React UI race condition where observing the bug via `console.log` changes the timing enough to mathematically eliminate the bug) through:
1. **Claude 4.6 Extended Thinking** (Anthropic's current SOTA)
2. **ChatGPT 5.3** (OpenAI's current SOTA)
3. **Unravel Engine using Gemini 2.5 Flash** (A free-tier, blazing fast, but far weaker general model)

### The Results

| Feature Correctness | Claude 4.6 | ChatGPT 5.3 | Unravel (Gemini Flash) |
|---|---|---|---|
| Bug category correct | ✅ | ✅ | ✅ |
| Heisenbug correctly identified | ✅ | ❌ Dismissed | ✅ Fully explained |
| Why console.log "fixes" it | ✅ | ❌ Missed | ✅ Exact mechanism |
| **AI Symptom-Chasing Loop** | ❌ Not included | ❌ Not included | ✅ **7-step loop traced** |
| Spread syntax behavior | ⚠️ Imprecise | ✅ Exact | ✅ Exact |
| Stale read scenario explained | ❌ | ❌ Missed | ✅ Timeline mapped |
| Variable state tracker | ❌ | ❌ | ✅ Included |

**The most crucial victory:** ChatGPT wrote 600 words of generalized analysis but completely missed the Heisenbug nature. Claude 4.6 caught the Heisenbug, but neither of these state-of-the-art models predicted the AI symptom-chasing loop. Unravel not only caught the bug, it mapped out the **exact wrong path** a human developer would take (adding a log) and how that would trick them into thinking the bug was fixed. 

It predicted the AI loop before it even happened.

**The takeaway:** The 9-phase pipeline and AST pre-analysis are doing the actual heavy lifting. Unravel gives a cheap, fast model the structural superpowers of a senior engineer.

---

## What the Phases Ahead Mean

### Phase 4 — Multiple Investigators

Right now one AI does the whole analysis. Phase 4 adds a second AI that analyzes independently — can't see what the first one found. Then a third AI acts as an **adversarial reviewer** — its job is to try to **destroy** both hypotheses. The hypothesis that survives the attack wins. This is how real peer review works — not by agreement, but by surviving scrutiny.

Only activates when single-agent confidence is below 80%. No point tripling API costs on easy bugs.

### Phase 5 — Actually Running the Code

Right now Unravel simulates execution in its head. Phase 5 uses WebContainers (in-browser Node.js) to actually run your code, capture real variable values at every step, then show you exactly what happened. Not approximated. Actual.

### Phase 6 — Pattern Database

After thousands of bugs are analyzed, patterns emerge. Certain code structures always produce certain bugs. Phase 6 detects these patterns before the full AI analysis even runs — like a spell-checker that knows common mistakes.

---

## The Goal

Debugging shouldn't feel like guessing.

If AI can generate code, it should also help us **understand it.**

Unravel exists to make that possible.
