# Unravel v3 — Master Implementation Plan
*Last updated: Phase 3 complete. Phase 4 planned.*

> **AI Code Generation = solved. AI Code Understanding = unsolved. Unravel solves understanding.**

---

## What Unravel Is

Most AI debugging tools pattern-match symptoms. They see "timer inaccurate" and suggest timer fixes. They never ask: where exactly did the data go wrong?

Unravel answers that question deterministically. Before any AI sees your code, a static analysis pass extracts verified facts — every variable mutation, every closure capture, every async boundary. These facts are injected as ground truth. The AI cannot hallucinate about what doesn't exist. Then a structured 9-phase reasoning pipeline forces the model to trace the actual root cause, not guess at the nearest symptom.

The result: exact file, exact line, exact variable, evidence, confidence score, and why other AI tools would have failed on this specific bug.

---

## North Star Metrics

Three numbers define whether Unravel is working. Everything is measured against these.

| Metric | Definition | Target |
|--------|-----------|--------|
| **RCA** — Root Cause Accuracy | Did it find the real bug, not a plausible guess? | ≥ 85% on benchmark |
| **TTI** — Time To Insight | How fast does the user understand the bug? | < 2 minutes |
| **HR** — Hallucination Rate | Did it reference code or behavior that doesn't exist? | < 5% |

---

## Design Principles

Every decision in Unravel flows from these five rules:

1. **Deterministic facts before AI reasoning.** The AST pass runs first. The AI receives verified ground truth, not a blank canvas.
2. **Evidence required for every claim.** No bug claim without exact line number + code fragment. No exceptions.
3. **Eliminate wrong hypotheses, don't guess at right ones.** Generate multiple explanations, then kill the ones the evidence contradicts. The survivor is the diagnosis.
4. **Never hide uncertainty.** "Uncertain" is better than "confident-wrong." If 2 of 3 hypotheses survive elimination, say so.
5. **Optimize for developer understanding, not impressive output.** The goal is insight, not a longer report.

---

## System Architecture

```
User Code + Bug Description
        │
        ▼
┌─────────────────────────────────────────┐
│  LAYER 0: AST Analyzer (deterministic)  │
│  @babel/parser — verified facts:        │
│  • Variable mutation chains             │
│  • Closure captures                     │
│  • Timing nodes (setTimeout, etc.)      │
│  • Function call graph                  │
└──────────────┬──────────────────────────┘
               │ Verified Context Map
               ▼
┌─────────────────────────────────────────┐
│  LAYER 1: Router Agent (Haiku/Flash)    │
│  • Selects relevant files from project  │
│  • Reduces 12,000 lines → ~350 lines    │
└──────────────┬──────────────────────────┘
               │ Code Slices + AST Facts
               ▼
┌─────────────────────────────────────────┐
│  LAYER 2: Deep Debugger (Opus 4.6)      │
│  • 8-phase deterministic pipeline       │
│  • Anti-sycophancy guardrails           │
│  • Evidence-backed confidence score     │
│  • Can PAUSE and request missing files  │
└──────────────┬──────────────────────────┘
               │ If confidence < 80% → Phase 4
               ▼
┌─────────────────────────────────────────┐
│  LAYER 2b: Skeptic Agent (Opus 4.6)     │
│  • Forbidden from seeing Layer 2 output │
│  • Approaches from first principles     │
└──────────────┬──────────────────────────┘
               │ Both hypotheses
               ▼
┌─────────────────────────────────────────┐
│  LAYER 2c: Adversarial Reviewer         │
│  • Tries to DESTROY both hypotheses     │
│  • Cannot propose a third hypothesis    │
│  • Strongest surviving hypothesis wins  │
└──────────────┬──────────────────────────┘
               │ Stress-tested diagnosis
               ▼
┌─────────────────────────────────────────┐
│  LAYER 3: Explainer (Sonnet 4.6)        │
│  • Adapts to user's coding level        │
│  • Generates analogies + teaching path  │
│  • Produces "Why AI looped" analysis    │
└──────────────┬──────────────────────────┘
               │
               ▼
        Multi-View Report
```

---

## Bug Taxonomy

Every diagnosis is classified into one of 12 formal categories. No free-text bug types.

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

## Anti-Sycophancy Guardrails

Hardcoded into every prompt. The model cannot override these.

```
Rule 1: If the code is correct, say "No bug found." Do NOT invent problems.
Rule 2: If the user's description contradicts the code, point out the contradiction.
Rule 3: If uncertain, say "Cannot confirm without runtime execution."
Rule 4: Every bug claim must cite exact line number + code fragment as proof.
Rule 5: Never describe code behavior that cannot be verified from provided files.
```

---

## 9-Phase Deterministic Pipeline

The model is forced through these phases in order. It cannot skip to conclusions.

```
PHASE 1  INGEST            Read ALL provided code. Build complete mental model. No theories yet.
PHASE 2  TRACK STATE       Map every variable: declared where, read where, mutated where.
PHASE 3  SIMULATE +        Mentally execute the user's action sequence. Then generate 3
         HYPOTHESIZE       candidate hypotheses for the root cause.
PHASE 4  ELIMINATE         For each hypothesis, check against AST evidence. Kill the ones
                           the evidence contradicts. If 2+ survive, mark as uncertain.
PHASE 5  ROOT CAUSE        Confirm the surviving hypothesis. Exact file, line, variable, function.
PHASE 6  MINIMAL FIX       Smallest surgical change. Do NOT rewrite the whole program.
PHASE 7  AI LOOP           Why would ChatGPT/Cursor fail on this bug? What loop would they fall into?
PHASE 8  CONCEPT           What programming concept does this bug teach?
PHASE 9  INVARIANTS        What conditions MUST hold for correctness? Document for future prevention.
```

Phases 3–4 are the **Hypothesis Elimination Model** — the key architectural improvement over the original 8-phase pipeline. Instead of committing to a single explanation early (which leads to confident-wrong output), the model generates multiple candidates and eliminates the ones that don't survive evidence.

---

## Provider-Specific Formatting

Same content, different wrapper per provider. Models respond better to their native format.

| Provider | Format | Why |
|----------|--------|-----|
| Claude | XML tags | Trained on XML — parses `<instructions>`, `<rules>`, `<code>` with higher fidelity |
| Gemini | Markdown | Google recommends headers, bold, bullet points for system instructions |
| GPT | `###` + delimiters | OpenAI recommends section headers and triple-backtick delimiters |

---

## Output Schema

Every analysis produces the same structured JSON — consumed by all UI views and all platforms.

```json
{
  "bugType": "STATE_MUTATION",
  "confidence": 0.92,
  "symptom": "Timer shows wrong value after pause/resume",
  "reproduction": ["Start timer", "Let it run 10s", "Pause", "Reset — shows wrong value"],
  "evidence": [
    "duration mutated at pause() line 69 — confirmed by AST",
    "reset() reads duration at line 79 — gets wrong value",
    "Reproduction path verified: start → pause → reset → wrong display"
  ],
  "uncertainties": ["Cannot verify visibilitychange behavior without runtime execution"],
  "rootCause": "duration variable mutated in pause() at line 69.",
  "codeLocation": "script.js line 69",
  "minimalFix": "Remove `duration = remaining` from pause(). Add a separate `lastActiveRemaining` variable.",
  "whyFixWorks": "Preserving duration as immutable config means reset() always returns to the correct original length.",
  "variableState": [
    { "variable": "duration", "meaning": "Total session length in seconds", "whereChanged": "pause() L69, setMode() L86" }
  ],
  "timeline": [
    { "time": "T0", "event": "start() called — duration=1500, remaining=1500" },
    { "time": "T0+10s", "event": "pause() called — duration mutated to 1490 ⚠️" },
    { "time": "T0+15s", "event": "reset() called — remaining set to 1490, not 1500" }
  ],
  "invariants": ["duration must remain constant for the duration of a mode session"],
  "hypotheses": ["Alternative: visibilitychange handler not updating startTimestamp"],
  "conceptExtraction": {
    "bugCategory": "STATE_MUTATION",
    "concept": "Immutable Configuration Values",
    "whyItMatters": "When a config variable gets mutated at runtime, all calculations using it break silently.",
    "patternToAvoid": "Never reassign a variable representing a fixed session parameter inside a runtime function.",
    "realWorldAnalogy": "Recipe mein sugar ki quantity ek baar decide hoti hai. Cooking ke beech mein change karne se dish kharab ho jaati hai."
  },
  "whyAILooped": {
    "pattern": "Symptom-chasing: AI focused on setInterval mechanism, not state management",
    "explanation": "AI never traced duration's lifecycle. Each error looked isolated.",
    "loopSteps": [
      "User: timer ends early → AI: adds remaining check → timer freezes",
      "User: timer freezes → AI: adds force-restart → timer double-counts"
    ]
  },
  "aiPrompt": "Fix the Pomodoro timer: preserve duration as immutable config. Add lastActiveRemaining for pause state."
}
```

---

## Roadmap

---

### Phase 1 — "Deep Thinking" ✅ COMPLETE

**Goal:** Production-ready app with SOTA models, anti-sycophancy, and teaching output.

**Built in:** 1 day.

| Task | Status |
|------|--------|
| BYOK API key management — Anthropic / Google / OpenAI | ✅ |
| SOTA models: Opus 4.6, Sonnet 4.6, Haiku 4.5, Gemini 2.5 Flash/Pro, GPT-5.3 | ✅ |
| Extended thinking (high effort mode on Opus) | ✅ |
| Provider-specific prompt formatting (XML / Markdown / Delimiters) | ✅ |
| 8-phase deterministic reasoning pipeline | ✅ |
| Anti-sycophancy guardrails (5 rules) | ✅ |
| Evidence-backed confidence output | ✅ |
| Bug taxonomy (12-category enum) | ✅ |
| Concept extraction ("what did this bug teach?") | ✅ |
| "Why AI looped" analysis | ✅ |
| User coding level selector (Vibe / Intermediate / Developer) | ✅ |
| Output language selector (Hinglish / English / Hindi) | ✅ |
| 5-step UI (Profile → Code Input → Loading → Output Menu → Report) | ✅ |
| 4 report views (Human / Technical / Agent Prompt / Minimal Fix) | ✅ |
| Missing files request loop (engine pauses and asks user) | ✅ |
| Smart folder upload with router agent (selects relevant files) | ✅ |

---

### Phase 2 — "The Proof" ✅ COMPLETE

**Goal:** Add deterministic pre-analysis. Prove with numbers that it works.

**Built in:** Same day as Phase 1.

#### 2.1 — AST Pre-Analysis ✅

`@babel/parser` + `@babel/traverse` static analysis pass that runs before any AI sees the code.

Three extractors:

**`extractMutationChains(code)`** — walks every AssignmentExpression and UpdateExpression. Records variable name, enclosing function, line number, read/write direction.

**`trackClosureCaptures(code)`** — walks function nodes, compares identifiers in inner scope against outer scope bindings via Babel's scope API. Flags stale closure candidates.

**`findTimingNodes(code)`** — walks CallExpression nodes for setTimeout, setInterval, addEventListener, fetch, Promise chains. Maps every async boundary.

Output injected into prompt as verified ground truth:

```
VERIFIED STATIC ANALYSIS — deterministic, not hallucinated
══════════════════════════════════════════════════════════

Variable Mutation Chains:
  duration
    written: pause() L69 ⚠, setMode() L86
    read:    tick() L55, start() L42

Async / Timing Nodes:
  setInterval → tick() [L57]
  addEventListener("visibilitychange") → handler() [L110]

Closure Captures:
  tick() captures → duration, remaining, interval
```

#### 2.2 — 10-Bug Development Proxy ✅

> **Note:** This is a development proxy for internal validation — used to verify the engine works during development. It is NOT the public credibility benchmark. The full 50-bug credibility benchmark is Phase 7.

| # | Category | Description |
|---|----------|-------------|
| 1 | `STALE_CLOSURE` | setInterval capturing stale state |
| 2 | `STATE_MUTATION` | Pomodoro duration overwrite |
| 3 | `RACE_CONDITION` | Two parallel API fetches overriding state |
| 4 | `EVENT_LIFECYCLE` | Missing cleanup in useEffect |
| 5 | `ASYNC_ORDERING` | Missing await |
| 6 | `TYPE_COERCION` | "5" + 3 implicit coercion |
| 7 | `TEMPORAL_LOGIC` | Date.now() pausing issues |
| 8 | `DATA_FLOW` | Props not updating downstream component |
| 9 | `UI_LOGIC` | Object reference equality blocking React render |
| 10 | `STALE_CLOSURE` | useEffect missing vital dependency |

Runner runs each bug twice — without AST (baseline) and with AST (enhanced). Scores RCA and Hallucination Rate per run.

**Preliminary run (Gemini 2.5 Flash, free tier):** Baseline 15% → Enhanced 20% RCA, 0.8% → 0.0% HR. Low RCA because Flash struggles with the structured JSON demands of the full 8-phase pipeline.

**Full proxy benchmark pending** — requires paid API run with Claude Opus or Gemini Pro.

```
Configuration          | RCA Score | Hallucination Rate
-----------------------|-----------|-------------------
Gemini Flash (prelim)  |   20%     |       0.0%
Claude Opus (pending)  |   ??%     |       ??%
```

The 10-bug proxy benchmark exists only to validate architectural improvements during development. Public claims rely exclusively on Phase 7’s extended benchmark.

#### 2.3 — Open Source Launch ✅

- Web app deployed to Netlify
- GitHub published under MIT
- README with architecture, setup, benchmark section
- Launch posts planned for Dev.to, LinkedIn, IndieHackers, Reddit, YouTube (not yet written)

---

### Phase 3 — "The Demo" ✅ COMPLETE

**Goal:** Extract the engine. Ship a VS Code / Cursor / Windsurf extension.

**Built in:** Same day.

#### 3.1 — Core Engine Extraction ✅

All engine logic extracted into `src/core/` with zero React dependencies.

```
src/core/
├── index.js          ← barrel export
├── config.js         ← providers, taxonomy, prompts, schema
├── ast-engine.js     ← @babel/parser analysis
├── parse-json.js     ← robust JSON parser
├── provider.js       ← API calling + retry logic
└── orchestrate.js    ← full pipeline as single async function
```

Single entry point: `orchestrate(codeFiles, symptom, options)`. Change the engine once, all platforms update.

#### 3.2 — VS Code / Cursor / Windsurf Extension ✅

```
unravel-vscode/
├── package.json
├── esbuild.js            ← ESM→CJS bundler
├── src/
│   ├── extension.js      ← activate(), command handler, status bar
│   ├── imports.js        ← resolve ESM/CJS imports (depth 2)
│   ├── diagnostics.js    ← red squiggly underlines on bug lines
│   ├── decorations.js    ← inline 🔴 ROOT CAUSE overlay text
│   ├── hover.js          ← tooltip with fix + confidence on hover
│   ├── sidebar.js        ← full HTML report WebView panel
│   └── core/
└── out/extension.js      ← 1.6MB bundled output
```

**User flow:**
```
Right-click .js/.ts file → "Unravel: Debug This File"
  ↓ First time: API key prompt → saved to VS Code settings
  ↓ "Describe the bug in one sentence"
  ↓ Status bar: $(loading~spin) AST analyzing → calling AI → parsing
  ↓ Results:
    • Red squiggly on root cause line
    • 🔴 ROOT CAUSE: STATE_MUTATION inline text
    • Hover → fix + confidence + evidence
    • Sidebar → full structured report
```

**Verified on:** Pomodoro timer bug. Confidence 1.0, both bugs identified, exact line numbers, full timeline.

**Key implementation notes:**
- VS Code lines are 0-indexed — line 69 in file = index 68 in API
- `codeLocation` normalized to string before `.toLowerCase()` — model sometimes returns object
- Context menu scoped to JS/TS only via `when` clause
- Import resolution walks depth 2 only — prevents pulling in node_modules

#### 3.3 — Web App UX Improvements ✅

Added after Phase 3 core work:

| Feature | What It Does |
|---------|-------------|
| File list with names | Every uploaded file shown by path with 📄 icon |
| Remove files (✕) | Individual remove button per file + "Clear All" |
| Upload appends | Re-uploading adds new files instead of replacing. Set-based dedup skips duplicates. |
| GitHub Import tab | Paste a public repo URL → files fetched via GitHub API → added to workspace |
| readSelectedFiles dual-mode | Handles both browser File objects (upload) and pre-loaded content (GitHub) |

#### 3.4 — Phase 3 Gaps (Deferred to Phase 4)

These were in the original Phase 3 plan but not built. They're presentation layer features that depend on Variable Trace (Phase 4.2).

| Feature | Status | Why Deferred |
|---------|--------|--------------|
| 🟠 Contributing functions decoration | ❌ | Only 🔴 root cause built. Multi-color requires Variable Trace data. |
| 🟡 Related variables decoration | ❌ | Same — needs causal chain from Phase 4.2 |
| 🔵 Timeline gutter markers | ❌ | Requires timeline data not yet surfaced in extension |
| Clickable line jumps from sidebar | ❌ | Sidebar shows HTML report, not interactive tree |
| [Apply Fix] button on hover | ❌ | Hover is info-only — applying diffs safely needs Phase 4.4 |
| Variable mutation tree (sidebar) | ❌ | Moved to Phase 4.2 Variable Trace |

---

### Phase 3.5 — "Pre-Publish Hardening" ✅ COMPLETE

**Goal:** Fix the two concrete gaps discovered during Bug 8 benchmark verification. These are engine-level issues that will cause silent misses or degraded analysis on real user code.

**Completed:** Both items verified with 3 runs of Bug 8 on the live site.

**What the Bug 8 verification revealed:**

| What Works | What's Brittle |
|------------|---------------|
| 9-phase pipeline forces depth standalone prompting can't match | Symptom description heavily influences which hypotheses get generated |
| AST mutation chains catch what pattern matching misses | Input truncation silently degrades analysis quality |
| AI loop analysis is unique — nobody else produces it | Hypothesis elimination doesn't always kill cleanly |
| Uncertainty flagging works — the HTML truncation case proved it | `task.status = newStatus` property mutation wasn't caught by AST |
| Output structure is consistent across bug types | |

#### 3.5.1 — Object Property Mutation Detection in AST ⏱️ 2–3 hours

**Priority: #1. Most impactful engine improvement.**

The `extractMutationChains` function catches array-level mutations (`push`, `splice`, direct assignment) correctly. It missed `task.status = newStatus` — a property mutation on an object inside an array. This is the most common state mutation bug pattern in modern JavaScript (React `useState`, Redux reducers, Zustand stores).

**Implementation:** Detect `AssignmentExpression` nodes where the left-hand side is a `MemberExpression` and the object traces back to a variable that lives inside an array or state container.

```
// Currently caught:
state.tasks.push(task)         ← method call on tracked array ✅
state.tasks.splice(idx, 1)     ← method call on tracked array ✅
state.tasks = [...state.tasks]  ← direct reassignment ✅

// Currently missed:
task.status = newStatus         ← property mutation on object inside array ❌
state.tasks[0].done = true      ← nested property mutation ❌
```

**Test:** Re-run Bug 8 analysis after the fix. `moveTask`'s `task.status = newStatus` should now appear in the mutation chain output.

#### 3.5.2 — Input Completeness Check ⏱️ 30 minutes

**Priority: #2. Prevents silent context degradation.**

Before the pipeline runs, check every uploaded file for truncation signals:
- HTML without closing `</body>` or `</html>` tags
- JS/TS with unclosed braces or abrupt ending
- File size suspiciously small relative to import graph expectations

**Action on detection:** Show a top-level banner on the entire report:

```
⚠️ One or more files may be incomplete. Analysis confidence reduced.
```

Right now the warning is buried in one evidence item. It must be top-level. A diagnosis built on incomplete context should carry a visible warning on the entire report.

**Test:** Upload a truncated HTML file. Banner should appear before the report content.

---

### Phase 3.6 — "File Handling Hardening" ✅ COMPLETE

**Goal:** Harden the file upload and GitHub fetch flows. Add Router-first optimization and allow symptom-free scanning.

**Completed:** All items verified with successful builds of both web app and VS Code extension.

| Task | Status |
|------|--------|
| VS Code allows empty symptom (scan mode) | ✅ |
| Router-first GitHub fetch (pick files before downloading) | ✅ |
| Symptom field marked "optional" in both web + VS Code | ✅ |
| Rebuilt .vsix v0.2.0 with all Phase 3.5 + 3.6 changes | ✅ |

---

### Phase 4A — "Analysis Modes & Output Control" ✅ COMPLETE

**Goal:** Transform Unravel from a single-mode debugger into a multi-mode analysis platform with user-controlled output. Users pick what they need; the engine delivers only that.

**Trigger:** Before adding more features. The current "output everything" approach won't scale.

**Why this comes first:** Every feature after this (security scan, project explainer, web search) needs the mode system to exist. Building them without it means every new mode dumps a novel. This is the architectural foundation for Phase 4B and beyond.

#### 4A.1 — Analysis Mode Selector ✅ BUILT

Three modes, each with a different system prompt and output schema:

```
┌──────────────────────────────────────────────────────────────┐
│  Choose Analysis Mode                                        │
│                                                              │
│  🐛 Debug Mode         (default — current behavior)          │
│     Find bugs, trace root cause, provide fix                 │
│                                                              │
│  🔍 Explain Mode       (new)                                 │
│     Understand this project — architecture, data flow,       │
│     entry points, how components connect                     │
│                                                              │
│  🛡️ Security Scan      (new)                                 │
│     Find vulnerabilities — injection, hardcoded secrets,     │
│     unsafe DOM ops, missing auth, CSRF exposure              │
│                                                              │
│  📊 Code Review        (future — Phase 5)                    │
│     Quality audit — patterns, anti-patterns, complexity      │
└──────────────────────────────────────────────────────────────┘
```

**Implementation:**
- New `buildExplainPrompt()` and `buildSecurityPrompt()` in `config.js`
- `orchestrate()` receives a `mode` option: `'debug' | 'explain' | 'security'`
- Each mode has its own output schema (explain mode doesn't need `minimalFix`, security mode doesn't need `whyAILooped`)
- AST engine serves all modes (mutations are relevant to security too)

**VS Code:** Mode selector dropdown in extension settings + quick-pick popup before analysis.

#### 4A.2 — Output Section Controls ✅ BUILT

Before running the analysis, user picks which sections they want in the report:

```
┌──────────────────────────────────────────────────────────────┐
│  Output Sections                          [All] [Minimal]    │
│                                                              │
│  ☑ 🎯 Root Cause + Evidence              (always on)        │
│  ☑ 🔧 Minimal Fix                        (always on)        │
│  ☑ 📊 Variable State Table                                  │
│  ☐ ⏱️ Execution Timeline                                    │
│  ☐ 🔄 Why AI Tools Loop                                     │
│  ☐ 💡 Concept Extraction + Analogy                          │
│  ☐ 📋 Reproduction Steps                                    │
│  ☑ 🤖 AI Fix Prompt                                         │
│  ☐ 📉 Confidence Evidence                                   │
└──────────────────────────────────────────────────────────────┘
```

**Presets:**
- **Quick Fix** — Root Cause + Fix + AI Prompt only (fastest, cheapest)
- **Developer** — Root Cause + Fix + Variables + Timeline (technical depth)
- **Full Report** — Everything (current behavior, default for beginners)
- **Custom** — Pick your own

**Implementation:**
- The system prompt already forces all 8 phases of reasoning. What changes is the **output schema** — we only request the sections the user checked.
- Smaller output schema = fewer tokens = faster response + lower cost.
- Sections are passed as an `outputSections` array in the orchestrate options.
- The prompt's output instruction dynamically lists only the requested fields.

**VS Code:** Configurable in `settings.json` under `unravel.outputSections` and `unravel.outputPreset`. Default: `"developer"`. This means users set their preference once and it applies to every analysis.

#### 4A.3 — Web App UX Redesign ✅ BUILT

Current: structured flow with clear panels across 5 visual steps.

```
┌────────────────────────────────────────────────────────────┐
│  STEP 1: Input                                             │
│  ┌──────────┬────────────┬──────────────┐                  │
│  │ 📋 Paste │ 📁 Upload  │ 🐙 GitHub    │                  │
│  └──────────┴────────────┴──────────────┘                  │
│                                                            │
│  STEP 2: Configure                                         │
│  ┌─────────────┬───────────────┬──────────────────┐        │
│  │ 🐛 Debug    │ 🔍 Explain    │ 🛡️ Security     │        │
│  └─────────────┴───────────────┴──────────────────┘        │
│  [Quick Fix ▼] — preset dropdown for output sections       │
│                                                            │
│  STEP 3: Describe (optional)                               │
│  ┌──────────────────────────────────────────────┐          │
│  │ What's going wrong? (leave empty to scan)    │          │
│  └──────────────────────────────────────────────┘          │
│                                                            │
│  [▶ ANALYZE]                                               │
└────────────────────────────────────────────────────────────┘
```

**Key design decisions:**
- Mode selection is a clear visual step, not buried in settings
- Output preset is a dropdown, not a long checklist (but "Custom" opens the checklist)
- Symptom is the LAST step, after mode — because the mode affects what the engine looks for

#### 4A.4 — VS Code Extension Settings ✅ BUILT

```json
{
    "unravel.mode": {
        "type": "string",
        "enum": ["debug", "explain", "security"],
        "default": "debug",
        "description": "Analysis mode: debug (find bugs), explain (understand code), security (find vulnerabilities)"
    },
    "unravel.outputPreset": {
        "type": "string",
        "enum": ["quick", "developer", "full", "custom"],
        "default": "developer",
        "description": "How much detail to include in the report"
    },
    "unravel.outputSections": {
        "type": "array",
        "default": ["rootCause", "minimalFix", "variableState", "timeline", "aiPrompt"],
        "description": "Custom sections to include (used when outputPreset is 'custom')"
    },
    "unravel.level": {
        "type": "string",
        "enum": ["beginner", "vibe", "basic", "intermediate"],
        "default": "intermediate",
        "description": "Your coding level — affects explanation depth"
    },
    "unravel.language": {
        "type": "string",
        "enum": ["english", "hinglish", "hindi"],
        "default": "english",
        "description": "Output language"
    }
}
```

**VS Code command palette:**
- `Unravel: Debug This File` (existing)
- `Unravel: Explain This File` (new — shortcut for explain mode)
- `Unravel: Security Scan This File` (new — shortcut for security mode)

#### 4A.5 — VS Code Output Integration (Sidebars & Charts) ✅ BUILT

- **Self-Healing Callback**: Implemented `onMissingFiles` in VS Code using `vscode.workspace.findFiles` with both exact and fuzzy filename matching, enabling the recursive fetch loop locally without relying on GitHub APIs.
- **Mermaid JS Webview Support**: Ported 5 Mermaid builders (Timeline, Data Flow, Dependency, AI Loop, Hypothesis) from React to Vanilla JS formatting inside the `sidebar.js` Webview. Loads Mermaid via an ESM CDN (`mermaid@10`) directly into the panel with `try/catch` per-node error boundaries to gracefully degrade if the model generates invalid graph syntax.
- **Dynamic Mode Formatting**: Completely rewrote the HTML builder in `sidebar.js` to branch based on `report._mode`. Generates 3 entirely structurally unique reports: Explain (Architecture Layers grid, data flow tables), Security (vulnerability list with severity coloring), and Debug (VERIFIED/UNCERTAIN segregation, AI loop flowchart, Variable State).

---

### Phase 4B — "Intelligence Layer" 📋 PLANNED

**Goal:** Adversarial multi-agent debate. Variable Trace UI. Code diff. Symptom-independent static analysis.
*(Note: One feature from this phase was built early during Phase 3.6).*

**Trigger:** First reports of confident-but-wrong diagnoses from real users. Do not build speculatively.

#### 4B.0 — Self-Healing Context (Recursive Fetching) ✅ BUILT EARLY (Phase 3.6)

**The pipeline upgrade:** The engine can realize mid-analysis that it lacks critical context.
- Identifies missing files needed to accurately diagnose a bug.
- Emits `missingFilesRequest` with specific paths.
- Automatically fetches those files from the GitHub repository API.
- Re-runs the entire AST-to-Diagnosis pipeline with the expanded context.
- Capable of fuzzy-matching paths and exploring unfiltered trees (e.g. `.env`, `.yaml`).

#### 4B.1 — Hypothesis Elimination Model + Adversarial Debate

**The pipeline upgrade.** Current Phase 3–5 in the 8-phase reasoning is: Simulate → Root Cause. This commits to a single explanation too early.

**New flow:** Simulate → Generate 3 hypotheses → Eliminate using AST evidence → Confirm survivor.

This prevents early commitment to wrong explanations. Makes uncertainty honest — if 2 of 3 hypotheses can't be eliminated, output says "uncertain" instead of confident-wrong.

**Then, three agents stress-test the survivor:**

```
              AST Context + Code
                     │
       ┌─────────────┴─────────────┐
       ▼                           ▼
Agent A: Detective         Agent B: Skeptic
Full 8-phase analysis      FORBIDDEN from seeing
with hypothesis             Agent A's output.
elimination.               First principles only.
       │                           │
       └─────────────┬─────────────┘
                     ▼
         Agent C: Adversarial Reviewer

         Job: Try to DESTROY both hypotheses.
         Rules:
         1. Cannot propose a third hypothesis.
         2. Must attack each claim with specific evidence.
         3. Hypothesis that survives attack wins.
                     │
         ┌───────────┴───────────┐
         ▼                       ▼
   Both survive            One broken
   → Boost confidence      → Surviving hypothesis
   → Single diagnosis        shown with attacker's
                              evidence attached
```

**Why an attacker not a reconciler:** A reconciler looks for agreement. An attacker looks for holes. Hypotheses must survive scrutiny, not just agree with each other.

**Agent B critical prompt rule:**
```
You are analyzing this code fresh. You have NOT seen any prior analysis.
Do not anchor to any previous hypothesis. Approach from first principles only.
```

**Cost control:** Only activate multi-agent when single-agent confidence < 80%. Prevents 3x API cost on every analysis.

#### 4B.2 — Variable Trace ("Where Did It Break?")

The killer feature. The AST engine already has this data. This is a presentation layer.

```
DURATION — complete lifecycle

Line 1    declared     let duration = 25 * 60         ✓
Line 55   read by      tick() — elapsed calculation   ✓
Line 69   mutated by   pause() — duration = remaining 🔴 ROOT CAUSE
Line 55   read by      tick() — gets wrong value      ← cascade begins
Line 79   read by      reset() — resets to wrong val  ← cascade ends
```

Each line clickable — jumps to that line in the editor.

**Bug Timeline (companion view):**

```
BUG TIMELINE

T0       start()   duration=1500, remaining=1500
T0+10s   tick()    elapsed=10, remaining=1490
T0+10s   pause()   duration mutated: 1500→1490  🔴 mutation happens here
T0+15s   reset()   remaining = duration = 1490 (wrong)
T0+15s   render()  shows 24:50 instead of 25:00  ← symptom appears here
```

Developer sees: where it started, where it changed, where it manifested. This is how humans debug — causally.

**VS Code integration:** Click the 🔴 overlay → Variable Trace panel opens in sidebar with clickable lifecycle lines.

#### 4B.3 — Function-Level Code Slicing + Router Hardening

```
Full project:   47 files, 12,000 lines
After Router:    5 files,  2,400 lines
After Slicing:  14 functions,  ~350 lines  ← what the LLM sees
```

**Known risk:** Router selects wrong files → AI reasons on incomplete context → wrong diagnosis.

**Mitigation:** Triple graph tracing — intersect three graphs to select files deterministically:

```
1. Call Graph:   this function → calls these functions → in which files?
2. Data Flow:    this variable → read/written by which functions → in which files?
3. Import Graph: this file → imports which files → those import which?

Intersection of all three = the exact subgraph the AI needs.
Result: deterministic file selection, not probabilistic.
```

The AST already has function call data, variable read/write locations, and import paths. The router should use this as hard constraints, not just AI judgment.

#### 4B.4 — Visual Diff Output

```diff
 function pause(){
     clearInterval(interval)
     interval = null
-    duration = remaining    ← BUG
 }

 function start(){
     startTimestamp = Date.now()
+    lastActiveRemaining = remaining  ← FIX
     interval = setInterval(tick, 1000)
 }
```

#### 4B.5 — Benchmark Expansion

Expand 10-bug suite to 20+ bugs. Include cross-file bugs and multi-component React bugs.

#### 4B.6 — Symptom-Independent AST Scan ⏱️ 1–2 hours

Currently the AST facts are injected but the pipeline reasons strictly toward the reported symptom. Add a second AST pass that runs completely independent of the symptom — flags everything suspicious regardless of what the user reported:
- Mutation of objects inside arrays
- `WeakRef` usage patterns
- Direct DOM references that might not exist
- Async operations without error handling

This becomes a separate **"Static Warnings"** section in the report. These aren't necessarily bugs — they're code smells worth knowing about. Key risk: noise. Needs a severity threshold or it'll dump 50 warnings on a 5-file project.

#### 4B.7 — Hypothesis Elimination Scoring ⏱️ 2 hours

Right now hypotheses are generated and the surviving one is reported. Add explicit elimination reasoning to the output — not just "hypothesis 2 eliminated" but:

```
Hypothesis 2 eliminated: AST confirms scheduleUpdate is called in all
four mutation functions — missing emit is not possible.
```

Forces the model to show its elimination work, not just its conclusion. Makes confident-wrong outputs harder to produce. Makes the output auditable.

#### 4B.8 — Symptom Contradiction Check ⏱️ 1 hour

Add a rule in Phase 1 (INGEST) that checks: does the symptom description contradict anything the AST already knows?

Example: user says "event isn't firing" but AST shows `addEventListener` is correctly wired. Flag the contradiction before the 9-phase reasoning continues.

This implements Anti-Sycophancy Rule 2 at the pipeline level, not just the prompt level. Implemented inside Phase 1 rather than as a separate "Phase 0" to avoid an extra LLM call — the model already reads everything during INGEST.

#### 4B.9 — Multi-Symptom Mode ⏱️ 2 hours

The Bug 8 second run proved that a broader symptom unlocks more bugs. Add an optional **"Deep Scan"** mode where Unravel runs the pipeline three times with three different symptom framings derived from the same code:
- "UI not updating"
- "Performance issues"
- "Data inconsistency"

Then merges the findings. Catches layered bugs that single-symptom analysis misses.

**Key implementation concern:** Merging three pipeline outputs requires deduplication logic for findings that appear in multiple framings. 3x cost — opt-in only.

**Phase 4A verification:**
- All 3 modes produce correctly scoped output (no minimalFix in explain mode, etc.)
- Output presets filter sections correctly
- VS Code settings persist and apply to analyses
- Web UX flow works: Input → Mode → Configure → Analyze

**Phase 4B verification:**
- Multi-agent RCA delta vs single-agent > 10%? If not, reassess complexity cost
- Agent B produces genuinely independent hypotheses (test on 5 known bugs)
- Agent C cannot propose new hypotheses (constraint working)
- Variable Trace renders correctly and line jumps work
- Hypothesis elimination scoring produces auditable reasoning on 5 test bugs
- Symptom contradiction check fires on at least 1 known contradictory case

---

### Phase 5 — "The Breakthrough" 📋 PLANNED

**Trigger:** Real user base asking for it. Build nothing in this phase speculatively.

#### 5.0 — Web Search Integration (Online Help Discovery)

When the engine detects a bug that looks like a known library issue, version mismatch, or deprecated API usage, search for existing solutions online.

**Flow:**
```
Orchestrate detects: "TypeError: model.generateContent is not a function"
  → Recognizes this as an external dependency issue
  → Searches: GitHub Issues, Stack Overflow, npm changelogs
  → Returns: "This was fixed in @google/generative-ai v0.22.0. You're on v0.19.0."
```

**Implementation options:**
- Google Custom Search API (paid, reliable)
- GitHub Issues search API (free, scoped to repos)
- Prompt-level hint (free, uses LLM training data): *"If this looks like a version mismatch or known library issue, say so and suggest checking the library's changelog/GitHub issues."*

**Start with the free option (prompt hint). Add API search only after user demand is proven.**

#### 5.1 — Instrumentation Without Execution (Intermediate Step)

Before full WebContainers, do the simpler version first:

```
1. Inject logging at AST-identified mutation points
2. Run in sandboxed iframe (not full WebContainer)
3. Capture variable values at each step
4. No security/resource concerns — just an iframe
```

**80% of the value, 20% of the risk.** This gives real variable values without the complexity of a full in-browser Node.js runtime.

#### 5.2 — Full WebContainers

**Trigger:** Only after 5.1 is proven and users specifically request real execution.

```
1. Load project into WebContainer (in-browser Node.js)
2. Instrument code at every AST-identified mutation point
3. Run buggy code → capture actual values at each step
4. Apply fix automatically
5. Run again → capture values post-fix
6. Show before/after with real data
```

#### 5.3 — Interactive Dependency Graph (D3.js)

Clickable function call graph with bug path highlighted in red.

#### 5.4 — Debug Journal

Personal learning log. After each session, one-click saves the lesson to localStorage. After 5+ sessions, shows your recurring bug patterns.

```
🔥 Pattern: 3/5 of your bugs involve shared state.
   Learn about immutability and pure functions next.
```

#### 5.5 — CLI Tool

```bash
npm install -g @unravel/cli
unravel analyze ./src --symptom "timer skips after pause" --output json
```

#### 5.6 — Desktop App (Electron)

Native file access. Drag-and-drop project folders.

**Platform priority:**
```
1. VS Code / Cursor / Windsurf Extension  ← shipped ✅
2. CLI Tool
3. Agent Integration
4. Desktop App
```

---

### Phase 6 — "The Database" 📋 PLANNED (Future)

Bug pattern database built from real user sessions. Eventually enables pre-analysis pattern matching before full LLM analysis runs.

```
"I've seen this pattern 847 times. It's always STALE_CLOSURE. Confidence: 99%."
```

---

### Phase 7 — "Extended Benchmark" 📋 PLANNED

**Goal:** Make RCA claims publicly credible and academically defensible.

**Trigger:** Start after Phase 4 multi-agent is live. The benchmark should test the full stack, not just the single-agent version.

**50 bugs minimum**, split across:

| Category | Count | Why |
|----------|-------|-----|
| JavaScript (vanilla) | 10 | Baseline, easiest case |
| React / state management | 10 | Most common vibe-coded stack |
| Async / Promise / timing | 10 | Hardest category, most failures |
| Node.js / backend | 10 | Different patterns from frontend |
| Multi-file cross-component | 10 | Where router agent is tested hardest |

Three difficulty levels per category: **Easy / Medium / Hard.** Hard bugs are the ones where single-agent analysis without AST context is most likely to fail — these prove the system.

**What this phase produces:**

1. **Published benchmark dataset** — open source, others can run it
2. **Per-model RCA table:** Flash vs Sonnet vs Opus vs GPT — makes model dependence visible and honest
3. **Per-category breakdown:** shows exactly where Unravel is strong and where it isn't
4. **Version tracking:** run the same benchmark on every major release to catch regressions

```
Model               | JS    | React | Async | Node  | Multi | Total RCA | Avg TTI
--------------------|-------|-------|-------|-------|-------|-----------|--------
Gemini 2.5 Flash    | ??%   | ??%   | ??%   | ??%   | ??%   | ??%       | ??s
Claude Sonnet 4.6   | ??%   | ??%   | ??%   | ??%   | ??%   | ??%       | ??s
Claude Opus 4.6     | ??%   | ??%   | ??%   | ??%   | ??%   | ??%       | ??s
GPT 5.3             | ??%   | ??%   | ??%   | ??%   | ??%   | ??%       | ??s
```

RCA alone is one number. RCA + TTI per category tells a story — async bugs take 2.5 minutes, JS bugs take 1.3 minutes. That’s useful data for users choosing a model.

**"85% RCA on 50 bugs across 5 categories" is a conversation. "Cool VS Code extension" is not.**

---

## The API Play (Future Vision)

**Long-term: Unravel as a debugging engine for AI coding tools.**

Target integrations: Cursor, Bolt, Lovable, Replit, Codeium, Claude Code, Gemini CLI, and others. These tools generate code at scale. When it breaks, they have no good answer.

**"Debug with Unravel" API:**
```
POST /analyze
{ files, symptom, options }
→ structured diagnosis JSON
```

**Business model:** B2B per-call API. They pay per analysis.

**Sequence:**
1. Prove it works standalone first (Phases 1–4) ✅ in progress
2. Fill the Phase 7 benchmark with real numbers
3. Approach platforms with benchmark data
4. "85% RCA across 50 bugs, 5 categories, 4 models" opens doors
5. Enterprise pilot → integration partnership

---

## Where We Are Right Now

```
PHASE 1    ✅  Web app, 8-phase pipeline, SOTA models, anti-sycophancy
PHASE 2    ✅  AST pre-analysis, 10-bug dev proxy, open source
               ⏳ Full Opus/Pro benchmark still pending
PHASE 3    ✅  Core engine extracted, VS Code extension working end-to-end
               ✅ Web app UX: file list, remove, append, GitHub import
PHASE 3.5  ✅  Pre-publish hardening (MemberExpression detection + input completeness)
               ✅ Verified with 3 Bug 8 runs — flawless
PHASE 3.6  ✅  File handling hardening (Router-first GitHub, empty symptom support)
               ✅ VSIX v0.2.0 rebuilt with all changes
PHASE 4A   📋  Analysis modes (Debug/Explain/Security) + output controls
               + Web app UX redesign + VS Code settings expansion
PHASE 4B   📋  Intelligence layer: adversarial debate, Variable Trace,
               code slicing, elimination scoring, multi-symptom mode
PHASE 5    📋  Web search integration + instrumented execution + CLI tool
PHASE 6    📋  Pattern database
PHASE 7    📋  50-bug credibility benchmark — the number that opens doors
```

**What exists and works right now:**
- Web app on Netlify with folder upload, GitHub import (Router-first), 3 input methods
- VS Code / Cursor / Windsurf extension as .vsix v0.2.0 — right-click debug with squigglies, overlays, hover, sidebar
- Core engine: `orchestrate(files, symptom, options)` — one function, all platforms
- AST engine with MemberExpression mutation detection + input completeness check
- Empty-symptom scanning mode (engine finds issues on its own)
- 10-bug development proxy with runner and preliminary results
- README, LICENSE, STORY.md — launch-ready

**What's next:**
1. Ship current version — gather real user feedback
2. Phase 4A — Analysis modes + output controls (this is the UX foundation)
3. Full proxy benchmark run with Claude Opus or Gemini Pro (paid credits)
4. Launch posts (Dev.to, Reddit, YouTube, LinkedIn)

---

## The One Number That Matters

**RCA with AST pre-analysis vs without, on a SOTA model, across 50 bugs.**

That delta is the entire technical story of Unravel. Phase 7 fills it in. Then the API play becomes real.
