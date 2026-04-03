# Unravel v3 — Master Implementation Plan (very stale)
*Last updated: March 18, 2026. Phases 1–5.5 complete. Phase 4B complete. Phase 8 (UDB-51) next.*

> **AI Code Generation = solved. AI Code Understanding = unsolved. Unravel solves understanding.**

---

## What Unravel Is

Most AI debugging tools pattern-match symptoms. They see "timer inaccurate" and suggest timer fixes. They never ask: where exactly did the data go wrong?

Unravel answers that question deterministically. Before any AI sees your code, a static analysis pass extracts verified facts — every variable mutation, every closure capture, every async boundary. These facts are injected as ground truth. The AI cannot hallucinate about what doesn't exist. Then a structured 8-phase reasoning pipeline forces the model to trace the actual root cause, not guess at the nearest symptom.

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
│  web-tree-sitter (WASM) — verified facts:│
│  • Variable mutation chains             │
│  • Closure captures                     │
│  • Timing nodes (setTimeout, etc.)      │
│  • Cross-file import/export resolution  │
└──────────────┬──────────────────────────┘
               │ Verified Context Map
               ▼
┌─────────────────────────────────────────┐
│  LAYER 1: Router Agent (mode-aware)     │
│  • Graph-Frontier BFS (import/call/     │
│    mutation graphs) + LLM fallback      │
│  • Debug: 5-8 files near symptom        │
│  • Explain: 15-25 files for breadth     │
│  • Security: 8-12 files on attack sfc   │
└──────────────┬──────────────────────────┘
               │ Code Slices + AST Facts
               ▼
┌─────────────────────────────────────────┐
│  LAYER 2: Core Engine (single call)     │
│  • Mode: 🐛 Debug | 🔍 Explain | 🛡 Sec│
│  • 8-phase deterministic pipeline       │
│  • Anti-sycophancy guardrails (7 rules) │
│  • Evidence-backed confidence score     │
│  • Dynamic output schema (presets)      │
│  • Can PAUSE and request missing files  │
│  • Streams progressively via SSE        │
│  • Generates Mermaid edge data for viz  │
└──────────────┬──────────────────────────┘
               │
               ▼
        Multi-View Report
        (Web App / VS Code Sidebar)
```

> **Note:** The architecture above reflects what is built today — a single-engine, multi-mode system with cross-file AST resolution and graph-frontier routing. Phase 4B.1 (planned) adds multi-agent adversarial debate — only if UDB-51 benchmark proves confident-wrong rate warrants it.

---

## Bug Taxonomy

Every diagnosis is classified using a primary category from 12 formal types, plus optional `secondaryTags[]` for rare/complex bugs that don't fit cleanly (regex backtracking, floating-point precision, serialization mismatches, DI misconfig, etc.). Primary categories drive UI coloring and stats. Secondary tags are freeform.

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
Rule 6: The crash site is NEVER the root cause. It is the symptom.
        Trace state BACKWARDS through mutation chains from the failure point.
        The root cause is where state was FIRST corrupted.
        (Exception: single-line bugs where crash site = root cause.)
Rule 7: A variable named `isPaused` does not guarantee the code is actually paused.
        A function named `cleanup()` does not guarantee cleanup occurs.
        Verify BEHAVIOR from the execution chain, not from naming conventions.
```

> **Rules 6-7 added from research analysis** — Rule 6 guards against "proximate fixation" (LLMs blaming the crash site instead of the distant corruption). Rule 7 guards against the "name-behavior fallacy" (LLMs trusting variable naming as semantics).

---

## 8-Phase Deterministic Pipeline

The model is forced through these phases in order. It cannot skip to conclusions. Phases 1–4 are shared across all modes (debug, explain, security). Phases 5–8 are debug-mode specific. Explain mode uses Phase 5 ARTICULATE; Security mode uses Phase 5 AUDIT.

```
── Shared Phases (all modes) ──────────────────────────────────────────────
PHASE 1  READ              Read every provided file completely. No opinions yet.
PHASE 2  UNDERSTAND        For each function/module: what is it trying to accomplish?
         INTENT            Derive intent from code structure, not assumptions.
PHASE 3  UNDERSTAND        What is the code actually doing vs what it intends?
         REALITY           Generate 3-5 competing explanations for divergences.
                           Do not commit to any single explanation yet.
PHASE 4  BUILD CONTEXT     Map dependencies and boundaries between components.
                           Use AST ground truth — do not contradict it.

── Debug Mode (Phases 5-8) ────────────────────────────────────────────────
PHASE 5  DIAGNOSE          User's description is a symptom, not a diagnosis.
                           Test each hypothesis against AST evidence. Kill
                           contradicted ones. Survivors are the root cause.
PHASE 6  MINIMAL FIX       Smallest surgical change. Architectural notes included if needed.
PHASE 7  CONCEPT           What programming concept does this bug teach?
PHASE 8  INVARIANTS        What conditions MUST hold for correctness?

── Explain Mode (Phase 5) ─────────────────────────────────────────────────
PHASE 5  ARTICULATE        Thorough codebase walkthrough: summary, entry points,
                           data flow, architecture layers, dependency map,
                           key patterns, gotchas, onboarding guide.

── Security Mode (Phase 5) ────────────────────────────────────────────────
PHASE 5  AUDIT             What does this code trust? Where can those assumptions
                           be violated? Cite exact code. Rate severity honestly.
```

Phases 3–5 (Debug) implement the **Hypothesis Elimination Model** — the key architectural improvement over the original 8-phase pipeline. Instead of committing to a single explanation early (which leads to confident-wrong output), the model generates multiple candidates in Phase 3 and eliminates the ones that don't survive evidence in Phase 5.

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
  "needsMoreInfo": false,
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
  "aiPrompt": "Fix the Pomodoro timer: preserve duration as immutable config. Add lastActiveRemaining for pause state.",
  "timelineEdges": [
    { "from": "User", "to": "start()", "label": "clicks start", "isBugPoint": false },
    { "from": "start()", "to": "pause()", "label": "mutates duration", "isBugPoint": true }
  ],
  "diffBlock": "--- script.js L69\n-    duration = remaining\n+    lastActiveRemaining = remaining",
  "hypothesisTree": [
    { "id": "H1", "text": "Stale closure in tick()", "status": "eliminated", "reason": "AST confirms tick gets fresh remaining", "eliminatedBy": "script.js L55: tick() reads remaining via closure — value is live, not captured" },
    { "id": "H2", "text": "State mutation in pause()", "status": "survived", "reason": "AST confirms duration write at L69", "eliminatedBy": null }
  ],
  "variableStateEdges": [
    { "variable": "duration", "edges": [{ "from": "pause()", "to": "duration", "label": "mutated L69", "type": "write" }] }
  ],
  "_provenance": {
    "engineVersion": "3.3",
    "astVersion": "2.2",
    "routerStrategy": "graph-frontier",
    "model": "gemini-2.5-flash",
    "provider": "google",
    "timestamp": "2026-03-18T16:30:00Z"
  }
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
| Anti-sycophancy guardrails (5 rules at launch, expanded to 7 — see Rules section) | ✅ |
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

**web-tree-sitter (WASM)** static analysis pass that runs before any AI sees the code. An earlier version used `@babel/parser` + `@babel/traverse`; this was replaced in Sprint 4 due to Babel's all-or-nothing parse failures on large TypeScript monorepos. tree-sitter provides partial-parse resilience — files with syntax errors still yield valid structural facts.

Four core extractors:

**`extractMutationChains(tree)`** — walks every assignment expression, augmented assignment, update expression, object property mutation (`task.status = newStatus`), destructuring assignment, and rest pattern. Records variable name, enclosing function (via upward parent traversal), line number, and read/write direction. Also annotates each write as `conditional: true/false` via `isConditionalContext()` — walking up to detect `if`/`switch`/`try`/`catch` ancestors. The `[CONDITIONAL]` tag is appended in the formatted output so the LLM knows which mutations are branch-gated.

**`trackClosureCaptures(tree)`** — custom scope resolver built on tree-sitter S-expression queries (replaces Babel's `path.scope.getBinding()`). Identifies the three-part stale closure profile: referenced inside a function, defined in a parent scope, written anywhere in that parent scope.

**`findTimingNodes(tree)`** — maps every async boundary: `setTimeout`, `setInterval`, `clearInterval`, `requestAnimationFrame`, `fetch`, `.then()`, `.catch()`, `.finally()`, `addEventListener`, `removeEventListener`. Also detects floating promises via `detectFloatingPromises(tree)` — the `isAwaited(node)` guard walks upward from each async call; if traversal reaches `expression_statement` before `await_expression`, the promise is floating.

**`detectReactPatterns(tree)`** — `setState` inside a timer without the state variable in the dependency array; `useEffect` with side effects but no cleanup return; missing entries in `useMemo`/`useCallback` dependency arrays.

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

> **Note:** This is a development proxy for internal validation — used to verify the engine works during development. It is NOT the public credibility benchmark. The full 50-bug credibility benchmark is Phase 8 (UDB-51).

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
- GitHub published under BSL-1.1
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
├── ast-engine-ts.js  ← tree-sitter WASM analysis
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
| 8-phase pipeline forces depth standalone prompting can't match | Symptom description heavily influences which hypotheses get generated |
| AST mutation chains catch what pattern matching misses | Input truncation silently degrades analysis quality |
| AI loop analysis is unique — nobody else produces it | Hypothesis elimination doesn't always kill cleanly |
| Uncertainty flagging works — the HTML truncation case proved it | `task.status = newStatus` property mutation wasn't caught by AST |
| Output structure is consistent across bug types | |

#### 3.5.1 — Object Property Mutation Detection in AST ✅ BUILT (Sprint 4)

`extractMutationChains` now detects object property mutations (`task.status = newStatus`) in addition to direct variable assignment. The tree-sitter rewrite handles `AssignmentExpression` nodes where the left-hand side is a `MemberExpression`, including nested property access (`state.tasks[0].done = true`). This is the most common state mutation pattern in React (`useState`), Redux reducers, and Zustand stores — previously missed by the Babel engine.

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

### Phase 4B — "Intelligence Layer" ✅ COMPLETE

**Goal:** Cross-file AST intelligence, deterministic router, streaming UX, extensible taxonomy. Variable Trace UI. Code diff. Symptom-independent static analysis. Adversarial multi-agent debate (only if benchmark proves it's needed).

**All items complete. Sprint 3 (3 days) + Sprint 4 + post-arxiv hardening round completed all 19 priorities.**

**Priority order** (highest first):
1. ✅ Cross-File AST Import Resolution (4B.10) — **BUILT: Sprint 3 Day 1**
2. ✅ Graph-Based Router (4B.3) — **BUILT: Sprint 3 Day 2**
3. ✅ Streaming Response Display (4B.14) — **BUILT: Sprint 3 Day 3**
4. ✅ **Tree-Sitter Integration** — Replace Babel parser with tree-sitter for partial-parse resilience on large/complex TypeScript files. **BUILT: Sprint 4** — tree-sitter is now primary engine, Babel removed.
5. ✅ **Graph Router — Wire & Activate** — `buildCallGraph()`/`selectFilesByGraph()` wired into `orchestrate.js` as Phase 0.5. **BUILT: Sprint 4**
6. ✅ **Prompt Hardening** (Research R1–R5) — Rule 6 (proximate fixation), Rule 7 (name-behavior fallacy), buggy context warning, cross-file tracing, mutual exclusivity. **BUILT: Sprint 4**
7. ✅ **Floating Promise Detection** (4B.10+) — `detectFloatingPromises()` with `isAwaited` guard. **BUILT: Sprint 4**
8. ✅ **React-Specific AST Patterns** (4B.11) — `useState`, `useEffect`, `useMemo`/`useCallback`. **BUILT: Sprint 4**
9. ✅ Variable Trace UI (4B.2) — **BUILT: Sprint 4**
10. ✅ **Fix Completeness Verifier** (4B.17) — Cross-file guard enforcing all calling files are touched. **BUILT: Sprint 4**
11. ✅ **Token/Context Limit Truncation Fix** (4B.13) — Handled gracefully without mid-line cutting. **BUILT: Sprint 4**
12. ✅ **`proximate_crash_site` output field** (4B.16) — Now rendering below Technical Root Cause. **BUILT: Sprint 4**
13. ✅ **CFG Branch Annotation** (4B.6) — `isConditionalContext()` walks ancestor chain; every mutation write now carries `conditional: true/false`; `[CONDITIONAL]` tag in LLM ground truth block. **BUILT: post-arxiv**
14. ✅ **Hypothesis Elimination Scoring** (4B.7) — `eliminatedBy` field added to `hypothesisTree` schema; Phase 5 DIAGNOSE now requires quoting exact AST line per elimination; hypothesis without citation is flagged as UNVERIFIED REASONING. **BUILT: post-arxiv**
15. ✅ **Symptom Contradiction Check** (4B.8) — `checkSymptomContradictions()` runs pre-LLM: (a) Listener Gap — user says "not firing" but AST confirms `addEventListener` wired, (b) Crash Site ≠ Root Cause — user names a function that only reads state. Alerts injected as `SYMPTOM CONTRADICTION ALERTS`. **BUILT: post-arxiv**
16. 🟨 **Security Proof-of-Exploit** (4B.8+) — Concrete payload or max 0.6 confidence
17. 🟨 VS Code Security/Explain Diagnostics (4B.12)
18. 🟨 Multi-Symptom Mode (4B.9)
19. ✅ **Visual Diff Output** (4B.4) — `diffBlock` field added to `ENGINE_SCHEMA`; Phase 6 MINIMAL FIX instructs unified diff (`- OLD / + NEW` with `file:line` headers); wired into `SECTION_TO_SCHEMA_KEYS` and `buildDynamicSchemaInstruction`. **BUILT: post-arxiv**

**Trigger for multi-agent only:** Confident-but-wrong rate > 15% on UDB-51 benchmark. Do not build speculatively.

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

#### 4B.3 — Graph-Frontier Router ✅ BUILT (Sprint 3 Day 2) + WIRED (Sprint 4)

Functions in `ast-project.js`:
- `buildModuleMap()` — async (tree-sitter WASM), scans `import`/`export` across all files, builds cross-file import graph
- `buildCallGraph()` — extracts cross-file function call edges from tree-sitter ASTs
- `selectFilesByGraph(allFiles, symptom, crossFileData)` — BFS from symptom-adjacent files through call graph, returns deterministically ranked file list

**Live wiring in `orchestrate.js` (Phase 0.5):**
```
if (jsFiles > 15) → selectFilesByGraph() → trims codeFiles before Phase 1 AST
if (jsFiles ≤ 15) → no-op fast path (zero overhead)
```

Trimming cascades to all subsequent phases: AST analysis, cross-file resolution, and the LLM prompt all operate on the reduced file set. The router fires on real production runs, not just tests.

Every analysis result includes `_provenance.routerStrategy` — self-reports whether `graph-frontier`, `llm-heuristic`, or `all-files` was used.

#### 4B.4 — Visual Diff Output ✅ BUILT (post-arxiv)

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

#### 4B.5 — Benchmark Expansion → **Moved to Phase 8 (UDB-51)**

Expanded from a sub-item to a full phase. See Phase 8 below.

#### 4B.6 — CFG Branch Annotation ✅ BUILT (post-arxiv)

Every mutation write in the AST output now carries `conditional: true/false`. `isConditionalContext()` walks up from each mutation node looking for `if`/`switch`/`try`/`catch` ancestors in the tree-sitter parse tree. `formatAnalysis()` appends `[CONDITIONAL]` in the formatted ground truth block so the LLM knows which mutations only fire on specific code paths.

**Why this matters:** Without branch context, the LLM would see "duration written at pause() L69" and treat it as an unconditional fact. With `[CONDITIONAL]`, it knows the mutation only fires when a specific branch is taken — preventing incorrect hypothesis eliminations where a correct hypothesis gets killed because the LLM didn't know the mutation was branch-gated.

#### 4B.7 — Hypothesis Elimination Scoring ✅ BUILT (post-arxiv)

`eliminatedBy` field added to `hypothesisTree` schema. Phase 5 DIAGNOSE now explicitly requires quoting the exact AST-verified code fragment (file + line) that eliminates each hypothesis. A hypothesis without a line citation is flagged as UNVERIFIED REASONING.

**Why evidence-based not numerical:** Research analysis showed that numerical scoring (0.0–1.0) produces "numerical theater" — the LLM assigns scores that look rigorous but are just as sycophantic as prose. Requiring a specific code citation is more honest and directly auditable.

#### 4B.8 — Contradiction Guards ✅ BUILT (post-arxiv)

`checkSymptomContradictions()` runs in `orchestrate.js` after AST extraction, before the LLM call. Two checks implemented:

1. **Listener Gap** — User says "event not firing/not triggered" but AST confirms `addEventListener` is wired for that event type. The specific event type is extracted from the listener and checked against the symptom text.
2. **Crash Site ≠ Root Cause** — User names a specific function as the bug source, but AST mutation map shows that function only reads state (no writes). Flagged as "you've identified where failure is visible, not where state was corrupted."

Contradiction alerts are injected as `SYMPTOM CONTRADICTION ALERTS` prepended to the AST ground truth block — explicit challenges to the user's framing before reasoning starts.

The "Naming vs Behavior" check (variable named `isPaused` but code never actually pauses) is handled structurally by Rule 7 in the prompt. It is not an AST-detectable pattern since it requires semantic intent, not syntactic evidence.

#### 4B.9 — Multi-Symptom Mode ⏱️ 2 hours

The Bug 8 second run proved that a broader symptom unlocks more bugs. Add an optional **"Deep Scan"** mode where Unravel runs the pipeline three times with three different symptom framings derived from the same code:
- "UI not updating"
- "Performance issues"
- "Data inconsistency"

Then merges the findings. Catches layered bugs that single-symptom analysis misses.

**Key implementation concern:** Merging three pipeline outputs requires deduplication logic for findings that appear in multiple framings. 3x cost — opt-in only.

#### 4B.10 — AST Cross-File Import Resolution ✅ BUILT (Sprint 3 Day 1)

New file: **`ast-project.js`** — additive layer on top of `ast-engine.js`.

**What was built:**
- `buildModuleMap()` — async (tree-sitter), scans `import`/`export` statements across all files
- `resolveSymbolOrigins()` — traces where each imported symbol was originally defined
- `expandMutationChains()` — merges mutation chains across file boundaries
- `emitRiskSignals()` — flags `cross_file_mutation`, `async_state_race`, and `stale_closure` patterns
- `buildCallGraph()` — extracts cross-file function call edges
- `runCrossFileAnalysis()` — async, integrated into `orchestrate.js` as Phase 1b after per-file AST
- WASM memory management: `tree.delete()` called on all trees after `buildCallGraph` — no leaks at VS Code scale
- `resolveModuleName()` — correctly strips all leading `../` segments (deep nesting fixed)

#### 4B.10+ — Floating Promise Detection ✅ BUILT (Sprint 4)

`detectFloatingPromises(tree)` in `ast-engine-ts.js`:
- Detects async calls (`fetch`, `axios`, `.then()`, DB ops, etc.) NOT wrapped in `await`
- `isAwaited(node)` guard — walks AST upward to `await_expression` before statement boundary; returns false if it hits `expression_statement` first
- Correctly ignores `await fetch(...)` — only flags the bare `fetch(...)` call
- Results appear in `formatted` output under **"Floating Promises (unawaited async calls)"** section
- Wired into `runFullAnalysis()` and `runMultiFileAnalysis()` with per-file try/catch

#### 4B.14 — Progressive Streaming Response ✅ BUILT (Sprint 3 Day 3)

Three-layer streaming implementation:

**Layer 1 — `callProviderStreaming()`** in `provider.js`:
- Google: `streamGenerateContent?alt=sse` (one-line endpoint change)
- Anthropic: `stream: true` in body, parses `content_block_delta` SSE events
- OpenAI: `stream: true`, parses `choices[0].delta.content`
- Automatic fallback to non-streaming `callProvider()` on any failure

**Layer 2 — Progressive parse** in `orchestrate.js`:
- Chunk-count parsing: runs `parseAIJson(buffer)` when `}` appears in chunk OR every 5 chunks
- `lastHash` dedup: `JSON.stringify(parsed)` comparison prevents duplicate emissions
- Safe-field whitelist: only streams `rootCause`, `evidence`, `fix`, `bugType`, `confidence` — never `_verification` or `needsMoreInfo`
- Streaming activates only when `onPartialResult` callback is provided — zero regression risk

**Layer 3 — Progressive rendering** in `App.jsx`:
- `onPartialResult` callback merges partial data into report state
- Pulsing gradient streaming indicator: "Sections appearing as they generate..."
- Final result from `orchestrate()` overwrites partial, indicator disappears

#### 4B.11 — React-Specific AST Patterns ✅ BUILT (Sprint 4)

`detectReactPatterns(tree)` in `ast-engine-ts.js`:
- **useState Stale Closures**: Detects `setState` called inside a callback where the associated state variable is READ but not listed in the dependencies (or if deps are missing).
- **useEffect Cleanup**: Flags `useEffect` calls that perform side effects (timer setup, subscriptions) but lack a return cleanup function.
- **useMemo/useCallback Props**: Detects missing variables in dependency arrays by comparing the closure's captured variables against the provided dependency list.

#### 4B.15 — Tree-Sitter Integration ✅ BUILT (Sprint 4)

Tree-sitter is now the **primary AST engine** for Unravel, replacing Babel.
- **Resilience**: Handles partial parses and syntax errors in large TypeScript/JSX files far better than Babel's "all-or-nothing" parser.
- **Speed**: WASM-based native speed for multi-file analysis.
- **Scope API Replacement**: Custom scope resolver built on top of tree-sitter S-expression queries (replaces Babel's `path.scope.getBinding()`).
- **Memory Management**: Explicit `tree.delete()` lifecycle management prevents WASM memory leaks during large-scale project analysis.

#### 4B.16 — Prompt Hardening ✅ BUILT (Sprint 4)

Standardized Anti-Sycophancy guards based on research analysis:
- **Rule 6 (Proximate Fixation)**: Explicit instruction that the crash site is the symptom, not the cause. Forces backward state tracing.
- **Rule 7 (Name-Behavior Fallacy)**: Instruction to ignore semantic naming (e.g., `isPaused`) and verify actual execution logic.
- **Buggy Context Warning**: Softened high-level warning at Phase 1 READ to treat the codebase as "pre-infected" with bugs.
- **Cross-File Tracing**: Mandatory tracing rule for exported symbols in Phase 2.
- **Mutual Exclusivity**: Requirement that the 3 hypotheses generated in Phase 3 must be demonstrably different mechanisms.


#### 4B.12 — VS Code Diagnostics for Security & Explain Modes ⏱️ 1–2 hours

Currently, `extension.js` only applies diagnostics (red squiggly lines) and decorations (🔴 ROOT CAUSE overlay) in debug mode. Security mode results have exact vulnerability locations + severity — these should show as squiggly warnings on the actual lines. Explain mode could highlight entry points.

#### 4B.13 — Token/Context Limit Awareness ⏱️ 1–2 hours

No aggregate token check before sending to API. Individual files are capped at 8000 chars, and the router selects a subset, so current models (1M+ for Gemini, 200K for Claude) are unlikely to overflow. But edge cases with many large files + verbose AST output could exceed limits.

**Fix:** Simple character-count estimator (1 token ≈ 4 chars). Before the engine call, check if total exceeds 85% of model context. If over, truncate lowest-priority files or warn the user.

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

### Phase 5 — "GitHub & Action Center" ✅ COMPLETE

**Goal:** Turn Unravel from a read-only analysis tool into a fully actionable debugging workflow connected directly to source control and IDE contexts.

**Completed:** Fast-tracked due to user demand for actionable fixes immediately after analysis.

#### 5.1 — GitHub Issue Workflow Integration
- **Issue URL Parsing:** Users can paste a GitHub Issue URL instead of describing the symptom manually.
- **Context Fetching:** Unravel auto-fetches the issue title, body, and comments to construct a highly accurate debugging context string.
- **Workflow:** Solves the problem of developers having to manually translate user bug reports into debug prompts. Just paste the issue link.

#### 5.2 — Security Attack Vector Flowcharts
- **Enhancement to Security Mode:** Added dynamic Mermaid generation specifically tailored for vulnerabilities.
- **Exploitation Flow:** Visualizes exactly how an attacker enters the system, steps through the code, and exploits the flaw (e.g., `User Input -> Router -> Unsanitized DB Query -> SQLi`).

#### 5.3 — The Action Center (Web App)
After generating a fix, users need to apply it. The Action Center provides three terminal states for the workflow:
- **Copy CLI Command:** Generates a one-liner to apply the Git patch instantly.
- **Create Pull Request / Open Issue:** Pre-fills a GitHub PR or Issue with the Unravel diagnosis, evidence, and code patch natively using GitHub URL parameters. 

#### 5.4 — The Action Center (VS Code Extension)
- **Apply Fix Locally:** Non-destructively opens an untitled split-pane document containing the fix and instructions. Prevents messy inline replacements that break ASTs or formatting.
- **Give Fix to AI:** Native VS Code integration. Passes the Unravel-generated AI prompt directly to the VS Code built-in Copilot Chat (`workbench.action.chat.open`) with a clipboard fallback. Bridges Unravel's deep reasoning with Copilot's inline editing abilities.

#### 5.5 — API Key Security Hardening 📋 PLANNED ⏱️ 30 min

API keys are currently stored in `localStorage`, which is vulnerable to XSS. Add a "Remember key" checkbox — if unchecked, the key lives only in React state and is cleared on tab close. Default: unchecked for new users.

---

### Phase 5.5 — "Pipeline Hardening" ✅ COMPLETE

**Goal:** Stress-test the full pipeline against real-world GitHub issues of different error types. Discovered via openclaw issue #49806 (pnpm monorepo, `"Cannot find package 'openclaw'"` — a package resolution error that exposed 11 cascading failures in the pipeline).

**Core insight:** The pipeline was treating every bug class identically. A `PACKAGE_RESOLUTION` error and a `RUNTIME_LOGIC` bug need different routing, different verifier rules, and different solvability logic. Adding error type awareness propagated fixes through every downstream system.

**End-to-end result:** Running openclaw now produces `[ROUTER] Error type: PACKAGE_RESOLUTION` → `[Verify] ✓ All claims passed` → `[Solvability] Skipping — error type is PACKAGE_RESOLUTION` → 90% confidence, correct fix: `"openclaw": "workspace:*"` in `moltbot/package.json`.

#### Fix 1 — Error Type Classifier (`config.js`)

`classifyErrorType(symptom)` — deterministic, zero-LLM-cost. Returns one of:
- `PACKAGE_RESOLUTION` — cannot find package/module, workspace errors
- `BUILD_CONFIG` — compilation/tsconfig failures
- `RUNTIME_TYPE` — TypeError/undefined access
- `RUNTIME_LOGIC` — all other runtime bugs

Also fixed a silent operator precedence bug in the original classifier: `&&` inside `||` chain without parens was evaluating incorrectly.

#### Fix 2 — Pass 2 Discipline Rules (`config.js`)

`buildSecondPassRouterPrompt` now accepts `errorType` and injects per-type rules. For `PACKAGE_RESOLUTION`: *"Do NOT request .ts/.js source files. Package resolution errors are NEVER fixed in source code."* Four universal rules apply to all types: relevance chain required, empty return is valid, no filename-similarity fetching, max 5 files.

#### Fix 3 — App.jsx Wiring (`App.jsx`)

`classifyErrorType(effectiveSymptom)` now called right after issue fetch, `errorType` passed as 4th argument to `buildSecondPassRouterPrompt`. Added defensive guard for empty issue body responses.

#### Fix 4 — Symptom File Whitelist in Verifier (`orchestrate.js`)

`verifyClaims` builds a `Set` of all file paths mentioned in the raw symptom text before Check 1 and Check 3. Files in this whitelist are silently skipped — they're in the user's error message, not hallucinated. Prevents correct diagnoses from being hard-rejected when the LLM cites a file path from a stack trace.

#### Fix 5 — Cross-Repo Detection in Verifier (`orchestrate.js`)

Before hard-rejecting in Check 3, verifier now checks: does the cited file's package prefix differ from the scanned repo AND does that package name appear in the provided context? If yes → `_crossRepoFixTarget`, soft 0.05 confidence penalty, no rejection. Distinguishes "hallucinated file" from "real file in a different repo."

#### Fix 6 — `EXTERNAL_FIX_TARGET` Verdict + Phase 5.7 (`orchestrate.js`, `config.js`)

`EXTERNAL_FIX_TARGET_VERDICT` — third verdict type alongside `LAYER_BOUNDARY_VERDICT`. Phase 5.7 returns it when `_crossRepoFixTarget` is set and verification wasn't rejected. Returns full diagnosis, `targetRepository`, `targetFile`, `suggestedAction`. User gets the complete root cause and knows exactly which repo to apply the fix in.

#### Fix 7 — Self-Heal Skip for Cross-Repo Cases (`orchestrate.js`)

Phase 6 (self-heal loop) now early-exits when `_crossRepoFixTarget` is set. The file is in a different repo — fetching from the scanned tree always fails silently.

#### Fix 8 — `symptom` Passed to `verifyClaims` (`orchestrate.js`)

Proofread fix: `result._symptomText` was never actually set. Cross-repo detection was silently non-functional. Fixed by threading `symptom` as the 6th parameter to `verifyClaims`.

#### Fix 9 — Detailed Verifier Logging (`orchestrate.js`)

Per-decision logs for every verifier check: `[Verify] Check1 OK/SKIP/FAIL`, `[Verify] Check3 CROSS-REPO/HARD-REJECT`, `[Verify] ✓ All claims passed`. Makes every production failure debuggable in under 30 seconds.

#### Fix 10 — Framework Name Stop-List in `extractFileRefs` (`orchestrate.js`)

`PRODUCT_STOPLIST` covers Node.js, Vue.js, React.js, Next.js, Express.js, Nuxt.js, etc. These match the file regex pattern but are proper nouns in prose — never actual file references.

#### Fix 11 — `LAYER_BOUNDARY` False Positive for Package Errors (`orchestrate.js`)

Two-part fix: (1) `PACKAGE_RESOLUTION` and `BUILD_CONFIG` errors early-exit `checkSolvability` entirely — these are always config-fixable, layer boundary doesn't apply. (2) Keyword scan now operates only on the LLM's own output (`rootCause + evidence`), not the raw symptom text — OS version strings and environment metadata no longer poison the layer classification.

---

### Phase 6 — "The Breakthrough Execution" 📋 PLANNED

**Trigger:** Real user base asking for it. Build nothing in this phase speculatively.

#### 6.0 — Web Search Integration (Online Help Discovery)
When the engine detects a bug that looks like a known library issue, version mismatch, or deprecated API usage, search for existing solutions online.

#### 6.1 — Full WebContainers
- Load project into WebContainer (in-browser Node.js)
- Run buggy code → capture real values at each step
- Apply fix automatically → show before/after with real data

#### 6.2 — Interactive Dependency Graph (D3.js)
Clickable function call graph with bug path highlighted in red.
#### 6.3 — CLI Tool & Desktop App
CLI integration and native local file access.

#### ~~6.4 — Streaming Response Display~~ → **Moved to Phase 4B ✅ BUILT (Sprint 3 Day 3)**

---

### Phase 7 — "The Database" 📋 PLANNED (After Phase 8 + Real User Base)

**Trigger:** Requires real user session data. Cannot be built in isolation. Only begin after UDB-51 validation is complete and real users are generating sessions. This is effectively an **infinite phase** — it runs continuously as long as users are submitting bugs. Do not block any other phase on it.

> **New order note:** Phase 7 comes *after* Phase 8 — the benchmark data and real-world validation (Phase 9) will generate the first meaningful pattern signals. Starting Phase 7 before that means building on synthetic data only, which defeats the purpose.

Bug pattern database built from real user sessions. Eventually enables pre-analysis pattern matching before full LLM analysis runs.

```
"I've seen this pattern 847 times. It's always STALE_CLOSURE. Confidence: 99%."
```

---

### Phase 8 — "UDB-51: Unravel Debug Benchmark" ⏸ DEFERRED

**Goal:** Build a named, reproducible, academically-structured 51-bug benchmark dataset. Named **UDB-51** (Unravel Debug Benchmark). Make RCA claims publicly credible.

**Status:** Deferred. Real-world merged PRs (tldraw #8161, cal.com #28296) have superseded UDB-51 as the primary correctness signal — maintainer acceptance of diagnoses in major production repositories is a stronger external validation than an internally-constructed benchmark. UDB-51 will run after Phase 9 expands the real-world dataset to 20 issues. Grading infrastructure is complete and ready.

**Phased execution:**
1. **Run 1 — Now:** All 51 bugs, standalone vs enhanced, grading overhaul already complete → get first publishable numbers
2. **Run 2 — Post-improvements:** Re-run with any prompt or AST tuning learned from Run 1 → try Claude/GPT API keys to show real model improvement across providers
3. **Phase 6 in between:** Web search, WebContainers → run analysis again to validate nothing regressed
4. **Final run:** Hardest bugs, officially publish all accumulated results, compare every run side by side, move on

> **Phase 8 is the validation gate.** Nothing in Phase 9+ is credible without these numbers. The core philosophy of this phase is: run it multiple times as the engine improves, publish the final comparison.

#### Current Benchmark Results (11 Bugs, Gemini 2.5 Flash)

| Bug | Baseline | Enhanced | Delta |
|-----|----------|----------|-------|
| stale_closure_interval | 1.0 | 1.0 | — |
| timer_state_mutation | 1.0 | 1.0 | — |
| **parallel_fetch_race** | **0.5** | **1.0** | **+0.5** 🔥 |
| missing_cleanup_leak | 1.0 | 1.0 | — |
| **missing_await** | **0.5** | **1.0** | **+0.5** 🔥 |
| type_coercion_calc | 1.0 | 1.0 | — |
| timer_drift | 1.0 | 1.0 | — |
| stale_prop_drilling | 1.0 | 1.0 | — |
| reference_equality_render | 1.0 | 1.0 | — |
| stale_closure_effect_deps | 1.0 | 1.0 | — |
| cross_file_state_mutation | 1.0 | 1.0 | — (HR: 60%→25%) |
| **TOTAL** | **~91%** | **100%** | **+9% RCA** |

#### 8.1 — Dataset Structure (Modeled After SWE-Bench / HumanEval)

```
unravel-benchmark/
├─ README.md                    # Dataset description, usage
├─ dataset.json                 # Global index of all 50 bugs
├─ bugs/
│   ├─ async/
│   │   └─ missing_await/
│   │       ├─ files/            # Actual source files
│   │       │   └─ app.js
│   │       ├─ metadata.json     # ID, category, difficulty, symptom
│   │       └─ expected.json     # Root cause keywords, line numbers, fix
│   ├─ cross_file/
│   ├─ closure/
│   ├─ react/
│   ├─ lifecycle/
│   ├─ security/
│   └─ performance/
└─ runner/
    ├─ run-benchmark.js
    ├─ scoring.js
    └─ report.js
```

Each bug folder contains:
- `files/` — the actual source code files (supports multi-file)
- `metadata.json` — `{ id, category, difficulty, description, symptom, files[] }`
- `expected.json` — `{ root_cause_keywords[], files[], lines[], fix_hint }`

#### 8.2 — Bug Distribution (50 Total)

| Category | Count | Key Bugs | AST Delta Expected |
|----------|-------|----------|--------------------|
| **Async / Timing** | 12 | double_fetch_race, async_loop_order, setTimeout_stale_state, promise_chain_missing_return, retry_logic_parallel, async_error_swallowed, debounce_timer_leak, event_listener_async_race, promise_all_partial_failure, interval_cleanup_missing + 2 existing | **HIGH** — proven +50% on async |
| **Cross-File State** | 9 | shared_config_mutation, singleton_state_mutation, exported_array_mutation, circular_import_state_bug, event_bus_double_subscription, shared_store_write_after_read, module_level_mutation, cross_file_cache_invalidation + 1 existing | **HIGH** — proven -35% hallucination |
| **Closure / Scope** | 7 | loop_closure_capture (classic `var i`), stale_closure_state_update, callback_context_loss, nested_function_shadowing, closure_memory_leak, callback_reference_mutation + 1 existing | **MEDIUM** — LLM blind spot |
| **React State** | 7 | direct_state_mutation, missing_dependency_useEffect, derived_state_stale, key_mismatch_render_bug, state_update_batch_bug, prop_mutation_bug + 1 existing | **MEDIUM** — needs React AST patterns |
| **Resource Lifecycle** | 4 | file_handle_not_closed, db_connection_leak, event_listener_not_removed, worker_thread_orphan | **LOW** — pattern recognition |
| **Data Flow** | 4 | parameter_misordering, default_value_shadowing, object_reference_alias + 1 existing | **LOW** — mostly logic |
| **Security** | 4 | xss_via_innerHTML, prototype_pollution, unvalidated_input, hardcoded_credentials | **MEDIUM** — tests security mode |
| **Performance** | 3 | quadratic_loop_bug (subtle O(n²)), unnecessary_rerender_loop, large_object_clone_in_loop | **LOW** — optimization patterns |

#### 8.3 — Phased Rollout

```
Step 1: Grading system overhaul (LLM grader replaces keyword matching)  ✅ DONE
Step 2: Migrate 11 existing bugs to new folder structure                 ✅ DONE → 11 bugs
Step 3: Write 9 more bugs (focus: async + cross-file)                   → 20 bugs
Step 4: Run 20-bug suite — UDB-51 Run 1 (Gemini Flash)                  → first publishable numbers
Step 5: Write 31 more bugs (closure, react, security, perf)             → 51 bugs
Step 6: Run 51-bug suite — UDB-51 Run 2 (Gemini + Claude + GPT)         → cross-model comparison
Step 7: Final run — hardest bugs, compare all runs, publish officially
```

#### 8.4 — Scoring System (LLM Grader — Replaces Keyword Matching)

**Why the old system failed:** Keyword matching grades "did the model use the same words as expected.json" — not "did the model find the actual bug." A model can identify the exact root cause in different words and score 0.0. That's a grading flaw, not a model failure.

**New approach:** Run the full analysis engine, then ask the AI to produce a constrained structured output. An AI grader agent (which already knows the bug and solution) reads that output and scores it against a strict rubric.

**Constrained output per analysis (stored as JSON):**
```json
{
  "summary": "2-3 sentence display output — what the bug is and the fix",
  "reasoning": "fuller internal trace — for grader eyes only, not shown to user",
  "root_cause_location": "filename + line number if identified"
}
```

**Grader rubric (3 criteria, applied per bug):**
| Criterion | Yes | Partial | No |
|-----------|-----|---------|-----|
| Correct root cause identified? | 1.0 | 0.5 | 0.0 |
| Fix location correct (file + line)? | 1.0 | 0.5 | 0.0 |
| Grounded in actual code (not hallucinated)? | Pass | — | Fail |

**Grading bias guard:** The grader prompt explicitly prohibits charitable interpretation. Partial credit requires specific evidence, not "close enough" reasoning. Grader output is auditable — it must quote which line of Unravel's reasoning earned each score.

**Final score per bug:** Average of the two scored criteria. Hallucination flag is a separate column (does not inflate RCA score but tracks HR independently).

Additional metrics per bug:
- **Hallucination Rate** — grader flags any claim that cannot be verified in the actual source files
- **Time to First Answer (TTFA)** — latency measurement
- **Confidence Calibration** — track `model_confidence` vs `actual_correctness`

#### 8.5 — Target Report Format

```
Model               | Async | Cross | Closure | React | Lifecycle | Data | Security | Perf | Total RCA | HR   | Avg TTI
--------------------|-------|-------|---------|-------|-----------|------|----------|------|-----------|------|--------
Gemini 2.5 Flash    | ??%   | ??%   | ??%     | ??%   | ??%       | ??%  | ??%      | ??%  | ??%       | ??%  | ??s
Claude Sonnet 4.6   | ??%   | ??%   | ??%     | ??%   | ??%       | ??%  | ??%      | ??%  | ??%       | ??%  | ??s
Claude Opus 4.6     | ??%   | ??%   | ??%     | ??%   | ??%       | ??%  | ??%      | ??%  | ??%       | ??%  | ??s
GPT 5.3             | ??%   | ??%   | ??%     | ??%   | ??%       | ??%  | ??%      | ??%  | ??%       | ??%  | ??s
```

**"85% RCA on 50 bugs across 8 categories" is a conversation. "Cool VS Code extension" is not.**

---

### Phase 9 — "Real-World Validation" 📋 PLANNED (After Phase 8)

**Goal:** Move beyond synthetic bugs. Test Unravel on real bugs from real open-source projects. Results feed directly into the API pitch deck.

> **API Pitch:** "Unravel matched the maintainer's fix on X/20 real GitHub issues" is the strongest possible proof for the B2B API play.

#### Phase 9A — Real GitHub Issue Debugging
Curate 20 real closed GitHub issues from popular JS/TS repos (Next.js, React, Vite, Express). Feed each to Unravel. Compare diagnosis vs actual merged fix.

#### Phase 9B — Multi-Provider Benchmarking on Real Bugs
Same 20 real issues run through Gemini, Claude, GPT. Provider comparison table — real bugs, real codebases, real delta.

#### Phase 9C — Community Contributions *(optional — only if audience exists)*
"Submit Your Bug" form → curate into benchmark → public leaderboard. Only pursue if user base warrants it.

---

### Phase 10 — "Unravel Heavy" 📋 PLANNED (After Phase 9)

**Goal:** Solve the context problem architecturally for VS Code-scale codebases. Specialized parallel agents reading call-graph clusters through domain-specific lenses, synthesized by an agent that sees the full cross-agent picture.

**Why this order is correct:** Heavy mode needs tree-sitter, a wired graph router, and real benchmark numbers to evaluate whether it's actually working. Phases 8 and 9 will reveal exactly where the current architecture breaks on real codebases — so Phase 10 gets built with real failure data instead of assumptions.

#### Core Architecture

```
Large codebase (e.g. VS Code repo, 8+ files fetched)
        │
        ▼
┌─────────────────────────────────────┐
│  Code Splitting Layer               │
│  Call-graph clustering (not naive   │
│  file splitting) — related code     │
│  stays together per cluster         │
└──────────┬──────────────────────────┘
           │ N clusters
           ▼
┌──────────────────────────────────────────────┐
│  Specialized Parallel Agents                  │
│                                               │
│  Agent A (Async/Timing specialist)            │
│    → receives async-heavy clusters            │
│  Agent B (State Mutation specialist)          │
│    → receives state management clusters       │
│  Agent C (Type/Data Flow specialist)          │
│    → receives type boundary clusters          │
│                                               │
│  Each runs full 8-phase pipeline on           │
│  its clusters through its domain lens         │
└──────────┬───────────────────────────────────┘
           │ 3 structured reports
           ▼
┌─────────────────────────────────────┐
│  Agent 4: Synthesis                 │
│  • Sees all 3 reports               │
│  • Contradiction detection          │
│  • Confidence-weighted findings     │
│  • Cross-agent pattern emergence    │
│  • Finalizes root cause + fix       │
└─────────────────────────────────────┘
```

#### Key Design Decisions

**Chunk splitting by call-graph cluster, not file boundary.** Splitting by file is naive. Splitting by call-graph cluster means related functions stay together — Agent A gets async call chains, Agent B gets state mutation chains. Your existing `buildCallGraph()` directly enables this.

**Agent specialization over identical agents.** Identical agents getting different chunks is less powerful than specialized agents bringing domain expertise to their chunks. One reads for async race conditions, one reads for state mutations, one reads for type boundaries. This mirrors how senior engineering teams actually review complex code.

**Contradiction detection as a first-class signal.** If Agent A says "variable X is always defined here" and Agent B says "variable X can be undefined here" — that contradiction *is* the bug. Agent 4 must surface contradictions as high-confidence findings, not silently resolve them.

**Confidence-weighted synthesis.** A finding backed by 3 AST-verified mutation chains outranks one based purely on model reasoning. Agent 4 weights by evidence density, not by which agent was more verbose.

**Incremental spawning (token efficiency).** Don't spin up all agents at once. Start with the symptom-adjacent cluster. Only spawn additional agents if the first returns low confidence or explicitly requests more context. Simpler bugs don't pay the full Heavy mode cost.

**Sub-agent reports must be constrained.** If agents dump verbose reports, Agent 4 hits the same context window problem one level up. Sub-agent output format: structured JSON with `finding`, `evidence[]`, `confidence`, `ast_support_count`. Never free text.

#### Pros
- Solves context window problem architecturally, not with a patch
- Call-graph clustering keeps related code together — intelligent split
- Parallelism means large codebases don't get slower, they get better
- Specialization reduces each agent's problem space — fewer hallucinations
- Agent 4's cross-agent view is architecturally unique — no other tool does this
- Positions Unravel for enterprise (VS Code, Next.js, production mono-repos)

#### Risks & Limitations
- **Token cost is real.** Incremental spawning mitigates but doesn't eliminate. Heavy mode needs a cost-per-analysis estimate before shipping — users cannot hit surprise bills.
- **Agent 4 is the bottleneck.** The whole architecture is only as good as synthesis quality. If it can't reconcile conflicting findings, the output degrades badly. Hardest engineering problem in the design.
- **Chunk boundary edge cases.** Circular dependencies, dynamic imports, runtime-only relationships break clean cluster boundaries. Need fallback logic.
- **Runtime bugs are still out of scope.** No static analysis can fully close this gap regardless of how many agents run.
- **Python and dynamic languages have weaker call graphs.** Clustering is less clean — Heavy mode is primarily a JS/TS story initially.
- **Evaluation requires new benchmark design.** Phase 8 grading covers single-engine output. Grading Heavy mode means also evaluating whether the agent split was sensible. Plan this before building.

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
1. Prove it works standalone first (Phases 1–5.5) ✅
2. Real-world PR validation — 2 merged, expanding to 20 (Phase 9) ← NEXT
3. Fill UDB-51 with real numbers after Phase 9 (Phase 8)
4. "85% RCA + matched 17/20 real GitHub fixes" opens doors
5. Enterprise pilot → integration partnership
6. Unravel Heavy (Phase 10) — enterprise API for VS Code-scale codebases

---

## Where We Are Right Now

*Last updated: March 18, 2026*

```
PHASE 1    ✅  Web app, 8-phase pipeline, SOTA models, anti-sycophancy (7 rules)
PHASE 2    ✅  AST pre-analysis, 10-bug dev proxy, open source
PHASE 3    ✅  Core engine extracted, VS Code extension working end-to-end
PHASE 3.5  ✅  Pre-publish hardening (MemberExpression detection + input completeness)
PHASE 3.6  ✅  File handling hardening (Router-first GitHub, empty symptom support)
PHASE 4A   ✅  Multi-mode analysis (Debug/Explain/Security) + output presets
PHASE 5    ✅  GitHub Issue URL parsing, Action Center (Web + VS Code)
PHASE 4B   ✅  Intelligence layer — complete:
               ✅ #1  Cross-file AST import resolution (ast-project.js)
               ✅ #2  Graph-frontier deterministic router (BFS over import/call/mutation)
               ✅ #3  Progressive streaming response (callProviderStreaming + onPartialResult)
               ✅ #4  Tree-sitter PRIMARY — Babel removed
               ✅ #5  Graph router — wired as Phase 0.5 in live analysis
               ✅ #6  Prompt hardening (Rules 6-7, buggy context warning, cross-file tracing)
               ✅ #7  Floating promise detection (isAwaited guard)
               ✅ #8  React-specific AST patterns (useState, useEffect, useMemo/useCallback)
               ✅ #9  Variable Trace UI + proximate_crash_site field
               ✅ #10 Fix completeness verifier (cross-file call graph guard)
               ✅ #11 Token/context limit truncation handled gracefully
               ✅ #12 CFG branch annotation — conditional vs. unconditional per mutation
               ✅ #13 Hypothesis elimination scoring — eliminatedBy field, citation required
               ✅ #14 Symptom contradiction checks — listener gap + crash site detection
               ✅ #15 Visual diff output — unified diffBlock field in every fix

PHASE 5.5  ✅  Pipeline hardening — 11 fixes (error type classifier, cross-repo verdict,
               symptom whitelist, LAYER_BOUNDARY false-positive fix, Pass 2 discipline
               rules, EXTERNAL_FIX_TARGET verdict, framework stop-list, verifier logging)

PHASE 8    ⏸  UDB-51 benchmark — deferred. Real-world PR validation is the current
               primary evidence path. Grading overhaul ✅, runner ✅ — ready when needed.
PHASE 6    📋  Web search + WebContainers + CLI tool (trigger: real user demand)
PHASE 7    📋  Pattern database (infinite phase — trigger: real user session data, after Phase 9)
PHASE 9    ⏳  Real-world GitHub issue validation — 2 PRs already merged (tldraw #8161,
               cal.com #28296). Continuing to 20 issues total (9B: multi-provider, 9C: community)
PHASE 10   📋  Unravel Heavy — multi-agent parallel analysis for VS Code-scale codebases
```

**What's next (in order):**
1. **Phase 9 — Real-world validation** ← NOW — expand from 2 merged PRs to 20 GitHub issues, multi-provider comparison, API pitch data
2. **Phase 8 — UDB-51** — run after Phase 9 expands the real-world dataset; PRs provide the credibility foundation
3. **Phase 6** — web search, WebContainers, CLI
4. **Phase 10** — Unravel Heavy

**What exists and works right now:**
- Web app on Netlify with folder upload, GitHub import (Router-first, two-pass), 3 input methods
- 3 analysis modes: Debug (8-phase pipeline), Explain (architecture walkthrough), Security (vulnerability audit)
- Output presets: Quick Fix / Developer / Full Report / Custom with per-section checkboxes
- VS Code / Cursor / Windsurf extension v0.3.0 — 3 right-click commands, diagnostics, overlays, hover, sidebar
- Action Center: Apply Fix Locally (VS Code) / Create GitHub Issue (Web) / Give Fix to AI (VS Code Chat)
- Core engine v3.3: `orchestrate(files, symptom, options)` — one function, all platforms
- **Error type classifier** (`config.js`): zero-LLM-cost, PACKAGE_RESOLUTION / BUILD_CONFIG / RUNTIME_TYPE / RUNTIME_LOGIC
- **CFG branch annotation** (`ast-engine-ts.js`): every mutation tagged conditional/unconditional
- **Symptom contradiction checks** (`orchestrate.js`): listener gap + crash site detection before LLM call
- **Hypothesis elimination scoring**: `eliminatedBy` field with mandatory AST citation per hypothesis
- **Visual diff output**: unified `diffBlock` in every fix response
- **Three-verdict system**: REPORT / LAYER_BOUNDARY / EXTERNAL_FIX_TARGET — every outcome has a typed structured result
- **Claim verifier with whitelist + cross-repo detection**: distinguishes hallucination from external dependency reference
- **Cross-file AST** (ast-project.js): module map, symbol origins, mutation chain merging, risk signals
- **Graph-frontier router** (ast-project.js): BFS over import graph, call graph, and mutation chains
- **Progressive streaming** (provider.js + orchestrate.js): SSE for all 3 providers, chunk-count parse, lastHash dedup
- AST engine v2.2 with MemberExpression mutation detection + input completeness check
- Mermaid visualizations: Timeline, Hypothesis, AI Loop, Data Flow, Dependency, Attack Vector, Variable State
- 11-bug benchmark: **100% RCA enhanced vs 91% baseline (+9% delta)**, -35% hallucination on multi-file
- README, LICENSE, STORY.md, ARCHITECTURE.md, ROADMAP.md — launch-ready
- GitHub community standards: CODE_OF_CONDUCT, CONTRIBUTING, SECURITY, Issue Templates, PR Template

---

## The One Number That Matters

**RCA with AST pre-analysis vs without, on a SOTA model, across 50 bugs.**

Current delta on 11 bugs: **+9% RCA, -35% hallucination rate.**
Target (50 bugs): **≥85% RCA enhanced, ≥+10% delta over baseline.**
Real-world (20 GitHub issues): **≥75% match with actual merged fix.**