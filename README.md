<div align="center">

<img src="assets/banner.svg" alt="Unravel — AST-Enhanced AI Debugging Engine" width="900"/>

<br/>

# **A debugging pipeline that forces any AI model to think before it guesses.**

**Unravel runs a static analysis pass before any LLM sees your code** — extracting mutation chains, async boundaries, closure captures, and cross-file data flows as verified facts. These become ground truth injected into a structured 9-phase reasoning pipeline. Any model you already have becomes significantly more accurate on the bugs that actually matter.

> *Not a smarter model. A smarter way to use the model you already have.*

<br/>

[![Version](https://img.shields.io/badge/engine-v3.3-58a6ff?style=flat-square&labelColor=0d1117)](https://github.com/EruditeCoder108/UnravelAI)
[![Benchmark](https://img.shields.io/badge/UDB--50-in_progress-f0883e?style=flat-square&labelColor=0d1117)](https://github.com/EruditeCoder108/UnravelAI/blob/main/ROADMAP.md)
[![License](https://img.shields.io/badge/license-BSL1.1-7d8590?style=flat-square&labelColor=0d1117)](LICENSE)
[![VS Code](https://img.shields.io/badge/VS_Code-v0.3.0-007ACC?style=flat-square&labelColor=0d1117&logo=visualstudiocode&logoColor=007ACC)](https://marketplace.visualstudio.com/items?itemName=EruditeCoder108.unravel)
[![Web App](https://img.shields.io/badge/web_app-live-58a6ff?style=flat-square&labelColor=0d1117&logo=netlify&logoColor=00C7B7)](https://vibeunravel.netlify.app)

<br/>

**[Web App →](https://vibeunravel.netlify.app)** &nbsp;&nbsp;·&nbsp;&nbsp; **[VS Code Extension →](https://marketplace.visualstudio.com/items?itemName=EruditeCoder108.unravel)** &nbsp;&nbsp;·&nbsp;&nbsp; **[Architecture →](ARCHITECTURE.md)** &nbsp;&nbsp;·&nbsp;&nbsp; **[Roadmap →](ROADMAP.md)**

</div>

---

## What Unravel Does

Most AI debuggers pattern-match symptoms. They see `TypeError` and suggest type fixes. They never ask: where did the data actually go wrong?

Unravel answers that question deterministically. Before any model sees your code, a static AST pass extracts verified facts — every variable mutation, every closure capture, every async boundary, every cross-file import chain. These become ground truth injected into a 9-phase structured prompt pipeline. The AI cannot hallucinate about what doesn't exist in the code. It cannot guess — it must trace.

The result: **exact file, exact line, exact variable, with evidence and confidence score.**

---

## How It Works

```
User Code + Bug Description
        │
        ▼
┌─────────────────────────────────────────┐
│  LAYER 0 — AST Analyzer (deterministic) │
│  @babel/parser — verified facts:        │
│  • Variable mutation chains             │
│  • Closure captures                     │
│  • Async boundaries (setTimeout, etc.)  │
│  • Cross-file import/export resolution  │
└──────────────┬──────────────────────────┘
               │  Verified Context Map
               ▼
┌─────────────────────────────────────────┐
│  LAYER 1 — Router Agent (mode-aware)    │
│  Graph-Frontier BFS over import/call/   │
│  mutation graphs + LLM fallback         │
│  • Debug:    5–8 files near symptom     │
│  • Explain:  15–25 files for breadth    │
│  • Security: 8–12 files on attack sfc   │
└──────────────┬──────────────────────────┘
               │  Code Slices + AST Facts
               ▼
┌─────────────────────────────────────────┐
│  LAYER 2 — Core Engine (single call)    │
│  • 9-phase deterministic pipeline       │
│  • Anti-sycophancy guardrails (7 rules) │
│  • Evidence-backed confidence score     │
│  • Streams progressively via SSE        │
│  • Can PAUSE and request missing files  │
│  • Generates Mermaid edge data for viz  │
└──────────────┬──────────────────────────┘
               │
               ▼
        Multi-View Report
        (Web App / VS Code Sidebar)
```

---

## The 9-Phase Pipeline

The model is forced through these phases in order. It cannot skip to conclusions.

| # | Phase | What happens |
|---|-------|--------------|
| 1 | **READ** | Read every file completely. No opinions yet. |
| 2 | **UNDERSTAND INTENT** | For each function/module: what is it trying to do? |
| 3 | **SYMPTOM MAPPING** | What observable behavior is failing? What's the exact failure event? |
| 4 | **AST FACT INJECTION** | Inject verified mutation chains, closures, async boundaries as ground truth |
| 5 | **HYPOTHESIS GENERATION** | Generate 3 mutually exclusive, non-overlapping hypotheses |
| 6 | **HYPOTHESIS ELIMINATION** | Kill hypotheses the AST evidence contradicts. Quote the exact line. |
| 7 | **ROOT CAUSE ISOLATION** | The surviving hypothesis is the diagnosis. Exact file + line + variable. |
| 8 | **FIX PROPOSAL** | Minimal targeted fix with before/after diff |
| 9 | **CONFIDENCE SCORING** | Evidence-backed score (0.0–1.0) + what would lower confidence |

---

## Anti-Sycophancy Guardrails

Hardcoded into every prompt. The model cannot override these.

```
Rule 1: If the code is correct, say "No bug found." Do NOT invent problems.
Rule 2: If the user's description contradicts the code, point out the contradiction.
Rule 3: If uncertain, say "Cannot confirm without runtime execution."
Rule 4: Every bug claim must cite exact line number + code fragment as proof.
Rule 5: Never describe code behavior that cannot be verified from provided files.
Rule 6: The crash site is NEVER the root cause. It is the symptom.
        Trace state BACKWARDS through mutation chains from the failure point.
        The root cause is where state was FIRST corrupted.
Rule 7: A variable named `isPaused` does not guarantee the code is paused.
        Verify BEHAVIOR from the execution chain, not naming conventions.
```

---

## Benchmark

Unravel's edge is not on easy bugs. Standalone LLMs already perform well on isolated, small-context bugs — and an 11-bug suite over a limited codebase isn't going to expose that gap meaningfully. The early numbers (+9% RCA, −35% hallucination on UDB-11) show directional signal, but that suite is small, the bugs are relatively contained, and the baseline model can still do reasonably well on that kind of input.

**Where Unravel is actually built to perform is the opposite scenario:** large repos, deep cross-file mutation chains, async races across 8+ files, bugs where the symptom and the root cause are in completely different modules. That's where standalone LLMs hallucinate, chase the symptom, and give up. Unravel's AST pre-analysis was built specifically for that context.

Validation so far has been on real large-scale repositories — including VS Code, Cal.com, and tldraw — where the pipeline correctly identified and traced root causes that raw model queries either missed or misattributed. These aren't controlled benchmark bugs; they're production issues from projects with tens of thousands of lines of code.

**The formal proof is in progress:**

| Suite | Status | Model | Notes |
|-------|--------|-------|-------|
| UDB-11 (11 bugs) | ✅ Complete | Gemini 2.5 Flash (free tier) | Small suite, easy-to-medium bugs. Directional only. |
| UDB-50 (50 bugs, 8 categories) | 🔄 In progress | Gemini 2.5 Flash → Claude Opus 4.6 | The real benchmark — hard bugs, large context, multi-file |
| 20 real GitHub issues | 📋 Planned | Multi-model | Closed issues from Next.js, React, Vite, Express — compared against actual merged fixes |

> UDB-50 with Claude Opus 4.6 on hard, large-context bugs is where the real numbers will come from. That's what gets published.

---

## Three Analysis Modes

<details>
<summary><b>🐛 Debug Mode</b> — Full 9-phase root cause diagnosis</summary>

<br/>

The full pipeline. Traces state backwards from the symptom through mutation chains to the exact corruption point. Returns: root cause, evidence, fix proposal, confidence score, and 7 Mermaid visualizations.

Best for: production bugs, async races, cross-file state corruption, anything that resisted 3+ AI attempts.

</details>

<details>
<summary><b>🔍 Explain Mode</b> — Architecture walkthrough for unfamiliar codebases</summary>

<br/>

Reads 15–25 files for breadth. Maps module responsibilities, data flow direction, entry points, and dependency graph. Generates Data Flow and Dependency diagrams. No fix proposed — insight is the goal.

Best for: onboarding to a new codebase, understanding legacy code, pre-refactor mapping.

</details>

<details>
<summary><b>🛡 Security Mode</b> — Vulnerability audit with exploit tracing</summary>

<br/>

Traces attack surface across 8–12 files. Requires concrete exploit payload for any vulnerability flagged — no vague "this could be vulnerable" claims. Returns: vulnerability type, attack vector, proof-of-exploit, severity, and remediation.

Best for: pre-deploy security checks, reviewing user-input handling, third-party dependency chains.

</details>

---

## Output Presets

| Preset | Fields |
|--------|--------|
| **Quick Fix** | Root cause + fix only. Read in 30 seconds. |
| **Developer** | Root cause + fix + evidence + confidence. |
| **Full Report** | All sections — hypothesis elimination, per-phase trace, all diagrams. |
| **Custom** | Per-section checkboxes. Build your own report. |

---

## Mermaid Visualizations

Every Full Report includes up to 7 auto-generated diagrams:

- **Timeline** — Event sequence leading to the bug
- **Hypothesis Tree** — Branching elimination logic
- **AI Loop** — Where raw AI models get stuck (and why)
- **Data Flow** — How data moves through the system
- **Dependency Graph** — Module import relationships
- **Attack Vector** *(Security mode)* — Exploit entry-to-impact path
- **Variable State** — Mutation chain for the root cause variable

---

## Supported Models

ALL LLMs whose API is available

Your API key. Your model. No data sent to Unravel servers.

---

## Bug Taxonomy

Every diagnosis is classified across 12 formal categories:

```javascript
const BUG_TAXONOMY = {
  STATE_MUTATION:  "Variable meant to be constant is modified unexpectedly",
  STALE_CLOSURE:   "Function captures outdated variable value",
  RACE_CONDITION:  "Multiple async operations conflict on shared state",
  TEMPORAL_LOGIC:  "Timing assumptions break (drift, wrong timestamps)",
  EVENT_LIFECYCLE: "Missing cleanup, double-binds, or wrong event order",
  TYPE_COERCION:   "Implicit type conversion causes unexpected behavior",
  ENV_DEPENDENCY:  "Code behaves differently across environments",
  ASYNC_ORDERING:  "Operations execute in wrong sequence",
  DATA_FLOW:       "Data passes incorrectly between components/files",
  UI_LOGIC:        "Visual behavior doesn't match intent",
  MEMORY_LEAK:     "Resources not released, accumulate over time",
  INFINITE_LOOP:   "Recursive or cyclic behavior creates runaway effect",
};
```

---

## Getting Started

### Web App

No install. Visit **[vibeunravel.netlify.app](https://vibeunravel.netlify.app)** and:

1. Enter your API key (Anthropic, Google, or OpenAI)
2. Upload your project files, paste code, or import a GitHub URL
3. Describe the bug symptom
4. Choose Debug / Explain / Security mode
5. Read the diagnosis

### VS Code Extension

```bash
# Install from the VS Code Marketplace
# Search: "Unravel"
```

Or install from the [Marketplace page](https://marketplace.visualstudio.com/items?itemName=EruditeCoder108.unravel).

**Usage:** Right-click any file in Explorer → *Unravel: Debug this file* / *Explain* / *Security Audit*

### Run Locally

```bash
git clone https://github.com/EruditeCoder108/UnravelAI.git
cd UnravelAI
npm install
npm run dev
```

---

## Project Status

```
Phase 1    ✅  Web app, 9-phase pipeline, multi-provider, anti-sycophancy (7 rules)
Phase 2    ✅  AST pre-analysis, open source
Phase 3    ✅  Core engine extracted, VS Code extension (v0.3.0) end-to-end
Phase 4A   ✅  Multi-mode analysis (Debug / Explain / Security) + output presets
Phase 5    ✅  GitHub Issue URL parsing, Action Center (Web + VS Code)
Phase 4B   ⏳  Intelligence layer:
               ✅ Cross-file AST import resolution (ast-project.js)
               ✅ Graph-frontier deterministic router (BFS)
               ✅ Progressive streaming (SSE, all 3 providers)
               📋 Floating promise detection
               📋 React-specific AST patterns, CFG branch annotation
               📋 Variable Trace UI, visual diff, proximate_crash_site field
Phase 8    📋  UDB-50 benchmark — 50 bugs, 8 categories, multi-model ← NEXT
Phase 9    📋  Real-world validation — 20 real GitHub issues, API pitch data
```

**[See full roadmap →](ROADMAP.md)**

---

## The Number That Will Matter

**RCA with AST pre-analysis vs without, on hard bugs, on a SOTA model, at scale.**

The honest version of that number doesn't exist yet. UDB-11 is early signal. UDB-50 with Claude Opus 4.6 across 8 bug categories — async races, cross-file state, closures, React state, security, performance — run against the same bugs on a raw baseline, is what actually proves the claim.

Target: **≥85% RCA enhanced, ≥+10% delta over baseline, <5% hallucination rate.**

Until then: the pipeline is open source, the web app is live, and you can run it on your own hardest bugs right now.

---

## Design Principles

Every decision flows from five rules:

1. **Deterministic facts before AI reasoning.** AST runs first. The model gets verified ground truth.
2. **Evidence required for every claim.** No bug report without exact line + code fragment.
3. **Eliminate wrong hypotheses, don't guess at right ones.** Generate 3, kill what the evidence contradicts.
4. **Never hide uncertainty.** "Uncertain" is better than "confident-wrong."
5. **Optimize for developer understanding, not impressive output.** Insight over length.

---

## Contributing

See [CONTRIBUTING.md](CONTRIBUTING.md). Bug reports, new benchmark bugs, and prompt improvement proposals are especially welcome.

```bash
# Run the benchmark suite
node benchmark/runner.js

# Run tests
npm test
```

---

## License

BSL1.1 — see [LICENSE](LICENSE).

---

<div align="center">

**Built by [Sambhav Jain](https://github.com/EruditeCoder108)**

*If Unravel found a bug your AI missed, leave a ⭐ — it helps.*

</div>
