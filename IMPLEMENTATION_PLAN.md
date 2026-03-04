# Unravel v3 — Master Implementation Plan

> **AI Code Generation = solved. AI Code Understanding = unsolved. Unravel solves understanding.**

---

## North Star Metrics

Three numbers define whether Unravel is working. Everything we build is measured against these.

| Metric | Definition | Target |
|--------|-----------|--------|
| **RCA** — Root Cause Accuracy | Did it find the *real* bug, not a plausible guess? | ≥ 85% on benchmark suite |
| **TTI** — Time To Insight | How fast does the user *understand* the bug? | < 2 minutes |
| **HR** — Hallucination Rate | Did it reference code, variables, or behavior that doesn't exist? | < 5% |

---

## Architecture Overview

```
User Code + Bug Description
        │
        ▼
┌─────────────────────────────────────────┐
│  LAYER 0: AST Analyzer (browser, free)  │
│  @babel/parser — deterministic facts:   │
│  • Variable mutation chains             │
│  • Closure captures                     │
│  • Timing nodes (setTimeout, etc.)      │
│  • Function call graph                  │
└──────────────┬──────────────────────────┘
               │ Verified Context Map
               ▼
┌─────────────────────────────────────────┐
│  LAYER 1: Router Agent (Haiku/Flash)    │
│  • Selects relevant files               │
│  • Produces function-level code slices  │
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
               │ If confidence < 80%
               ▼
┌─────────────────────────────────────────┐
│  LAYER 2b: Skeptic Agent (Opus 4.6)     │
│  • Sees ONLY the AST facts + code       │
│  • FORBIDDEN from seeing Layer 2 output │
│  • Approaches from completely different │
│    angle — first principles only        │
└──────────────┬──────────────────────────┘
               │ Both hypotheses
               ▼
┌─────────────────────────────────────────┐
│  LAYER 3: Reconciler                    │
│  • Agreement → boosted confidence       │
│  • Conflict → both hypotheses surfaced  │
│    with evidence for each               │
└──────────────┬──────────────────────────┘
               │ Final Diagnosis
               ▼
┌─────────────────────────────────────────┐
│  LAYER 4: Explainer (Sonnet 4.6)        │
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

Hardcoded into every prompt. The engine cannot override these.

```
Rule 1: If the code is correct, say "No bug found." Do NOT invent problems.
Rule 2: If the user's description contradicts the code, point out the contradiction.
Rule 3: If uncertain, say "Cannot confirm without runtime execution."
Rule 4: Every bug claim must cite exact line number + code fragment as proof.
Rule 5: Never describe code behavior that cannot be verified from provided files.
```

---

## Output Schema

Every analysis produces the same structured JSON — consumed by all UI views and all platforms.

```json
{
  "bugCategory": "STATE_MUTATION",
  "rootCause": {
    "file": "script.js",
    "line": 69,
    "variable": "duration",
    "function": "pause()",
    "description": "duration is mutated here but must remain constant"
  },
  "confidence": 0.92,
  "evidence": [
    "Mutation of `duration` confirmed at line 69 in pause()",
    "Invariant violated: duration changed 1500 → 1487 during pause",
    "Reproduction path verified: start → pause → resume triggers wrong elapsed"
  ],
  "uncertainties": [
    "Cannot verify visibilitychange behavior without runtime execution"
  ],
  "minimalFix": {
    "diff": "- duration = remaining\n+ lastActiveRemaining = remaining",
    "explanation": "Remove the mutation. Track remaining separately."
  },
  "bugReplay": [
    { "step": 1, "fn": "start()", "state": { "duration": 1500, "remaining": 1500 } },
    { "step": 2, "fn": "tick()",  "state": { "elapsed": 5, "remaining": 1495 } },
    { "step": 3, "fn": "pause()", "state": { "duration": 1495, "note": "⚠️ BUG" } },
    { "step": 4, "fn": "start()", "state": { "note": "wrong elapsed → timer jumps" } }
  ],
  "whyAILooped": {
    "pattern": "Symptom patch → new symptom → patch that → loop",
    "explanation": "AI never traced duration's lifecycle. Each error looked isolated.",
    "loopSteps": [
      "User: timer ends early → AI: adds remaining check → timer freezes",
      "User: timer freezes → AI: adds force-restart → timer double-counts"
    ]
  },
  "conceptExtraction": {
    "concept": "Immutable Configuration Values",
    "whyItMatters": "When a config variable gets mutated at runtime, all calculations using it break silently.",
    "patternToAvoid": "Never reassign a variable that represents a fixed session parameter inside a runtime function.",
    "analogy": "Recipe mein sugar ki quantity ek baar decide hoti hai. Cooking ke beech mein change karne se dish kharab ho jaati hai."
  },
  "learningPath": [
    { "topic": "What is state in a program?", "duration": "5 min" },
    { "topic": "Why shared mutable variables are dangerous", "duration": "3 min" },
    { "topic": "The single source of truth pattern", "duration": "5 min" },
    { "topic": "Practice: refactor this function", "duration": "2 min" }
  ]
}
```

---

## Prompt Architecture

### 8-Phase Deterministic Pipeline

The model is forced through these phases in order. It cannot skip to conclusions.

```
PHASE 1  INGEST       Read ALL provided code. Build complete mental model. No theories yet.
PHASE 2  TRACK STATE  Map every variable: declared where, read where, mutated where.
PHASE 3  SIMULATE     Mentally execute the user's exact action sequence step by step.
PHASE 4  INVARIANTS   What conditions MUST hold for the program to be correct? Which are violated?
PHASE 5  ROOT CAUSE   NOW identify the exact file, line, variable, and function.
PHASE 6  MINIMAL FIX  Smallest surgical change. Do NOT rewrite the whole program.
PHASE 7  AI LOOP      Why would ChatGPT/Cursor fail on this bug? What loop would they fall into?
PHASE 8  CONCEPT      What programming concept does this bug teach?
```

### Provider-Specific Formatting

Same content, different wrapper per provider. Models respond significantly better to their native format.

| Provider | Format | Reason |
|----------|--------|--------|
| Claude | XML tags | Trained on XML — parses `<instructions>`, `<rules>`, `<code>` with higher fidelity |
| Gemini | Markdown | Google recommends headers, bold, and bullet points for system instructions |
| GPT | Markdown + Delimiters | OpenAI recommends `###` sections and triple-backtick delimiters |

---

## Roadmap

---

### Phase 1 — "Deep Thinking" ✅ COMPLETE

**Goal:** Production-ready app with SOTA models, anti-sycophancy, and teaching output.

| Task | Status |
|------|--------|
| BYOK API key management (Anthropic / Google / OpenAI) | ✅ |
| SOTA model integration: Opus 4.6, Sonnet 4.6, Gemini 3.x, GPT 5.3 | ✅ |
| Extended thinking (64K tokens on Opus) | ✅ |
| Provider-specific prompt formatting (XML / Markdown / Delimiters) | ✅ |
| 8-phase deterministic reasoning prompt | ✅ |
| Anti-sycophancy guardrails | ✅ |
| Evidence-backed confidence output | ✅ |
| Bug taxonomy (12-category enum) | ✅ |
| Concept extraction ("what did this bug teach?") | ✅ |
| "Why AI looped" analysis | ✅ |

---

### Phase 2 — "The Proof" 📍 IN PROGRESS

**Goal:** Add deterministic pre-analysis. Prove with numbers that it works. Open source.

**Rule for this phase:** No multi-agent work. No UI changes. Pure engine + validation.

#### 2.1 — AST Pre-Analysis (Weeks 1–2)

Replace guesswork with verified facts injected before the LLM sees any code.

**Parser:** Use `@babel/parser` (not Acorn). Handles JSX, TypeScript, and modern syntax natively.

```bash
npm install @babel/parser @babel/traverse
```

Build these three functions in this order:

**Function 1 — `extractMutationChains(code)`**
Walk `AssignmentExpression` nodes. For each assignment, record:
- Left-hand identifier name
- Containing function name
- Line number
- Read/write direction

**Function 2 — `trackClosureCaptures(code)`**
Walk `FunctionDeclaration` and `ArrowFunctionExpression` nodes.
Compare identifiers used inside against declarations in outer scopes.
Flag any variable that is captured from outside the function.

**Function 3 — `findTimingNodes(code)`**
Walk `CallExpression` nodes where `callee.name` is:
`setTimeout`, `setInterval`, `clearInterval`, `clearTimeout`,
`addEventListener`, `removeEventListener`, `requestAnimationFrame`, `fetch`, `Promise`

**AST Output (injected into prompt as verified ground truth):**

```
VERIFIED STATIC ANALYSIS — deterministic, not hallucinated
══════════════════════════════════════════════════════════

Relevant Functions:
  start(), pause(), tick(), setMode()

Variable Mutation Chains:
  duration
    written: pause() L69 ⚠, setMode() L86
    read:    tick() L55, start() L42

Async / Timing Nodes:
  setInterval  → tick()    [L57]
  addEventListener("visibilitychange") → handler() [L110]

Closure Captures:
  tick()    captures → duration, remaining, interval (module scope)
  handler() captures → isPaused, interval (module scope)
```

This is injected *before* the user's code in the prompt. The LLM cannot hallucinate about what variables exist or where they're mutated — the AST already told it.

#### 2.2 — The 10 Bug Benchmark (Week 2–3)

10 deliberately buggy JS/React programs with defined root causes. These specific bug types are chosen to cover the most common patterns in vibe-coded projects.

| # | Bug Category | Description | Difficulty |
|---|-------------|-------------|-----------|
| 1 | `STALE_CLOSURE` | setInterval capturing stale variable | Medium |
| 2 | `STATE_MUTATION` | Config variable overwritten at runtime | Medium |
| 3 | `RACE_CONDITION` | Two parallel fetches writing to same state | Hard |
| 4 | `EVENT_LIFECYCLE` | Event listener added, never removed | Medium |
| 5 | `ASYNC_ORDERING` | Value read before `await` resolves | Easy |
| 6 | `TYPE_COERCION` | `"5" + 3` in a real calculation context | Easy |
| 7 | `TEMPORAL_LOGIC` | `Date.now()` drift in countdown timer | Hard |
| 8 | `DATA_FLOW` | Prop passed incorrectly between React components | Medium |
| 9 | `UI_LOGIC` | Object reference equality blocks re-render | Hard |
| 10 | `STALE_CLOSURE` | `useEffect` missing dependency (different shape than #1) | Medium |

Two stale closure bugs intentionally — it's the most common vibe-coded bug. Different shapes show Unravel handles both.

**Each benchmark file includes:**
```json
{
  "id": "timer_state_mutation",
  "bugCategory": "STATE_MUTATION",
  "userSymptom": "Timer becomes inaccurate after pause/resume",
  "trueRootCause": "duration variable mutated in pause() at line 69",
  "trueFile": "script.js",
  "trueLine": 69,
  "difficulty": "medium"
}
```

**Test Runner (`benchmarks/runner.js`):**
```javascript
for (const bug of bugs) {
  // Run 1: WITHOUT AST context
  const baselineResult = await runUnravel(bug.code, bug.symptom, { ast: false });

  // Run 2: WITH AST context injected
  const enhancedResult = await runUnravel(bug.code, bug.symptom, { ast: true });

  const baselineScore = scoreRCA(baselineResult, bug);
  const enhancedScore = scoreRCA(enhancedResult, bug);

  console.log(`Bug ${bug.id}: Baseline ${baselineScore} → Enhanced ${enhancedScore}`);
}
```

**RCA Scoring:**
```
Match   = AI identifies exact variable + line = 1.0 point
Partial = AI identifies right area, wrong specifics = 0.5 points
Miss    = AI suggests plausible but wrong cause = 0 points

RCA Score = total points / 10
```

**Hallucination Detection:**
After each run, cross-reference AI output against actual file:
- Does AI reference a variable that doesn't exist in the code?
- Does AI cite a line that doesn't contain what it claims?
- Does AI describe behavior the code cannot produce?

```
HR = hallucinated_claims / total_claims_in_output
```

#### 2.3 — Open Source Launch

Once benchmark numbers are in:

1. Update README with actual measured RCA scores
2. Publish results table:

```
Configuration          | RCA Score | Hallucination Rate
-----------------------|-----------|-------------------
Standard prompting     |   ??%     |       ??%
+ 8-phase pipeline     |   ??%     |       ??%
+ AST pre-analysis     |   ??%     |       ??%   ← this is the headline number
```

3. Push to GitHub. Open source under MIT.
4. Write one honest technical post: *"Why AI tools keep failing to fix your bugs — and what deterministic analysis looks like."*

**The delta between "standard prompting" and "+ AST pre-analysis" is the entire technical story of Unravel.**

---

### Phase 3 — "The Demo" 📋 PLANNED

**Goal:** Take Unravel from a website to the place developers actually live — VS Code.

**Trigger:** Start Phase 3 within 4 weeks of Phase 2 launch. Don't wait for user requests.

#### 3.1 — Core Engine Extraction

Before building the extension, extract the pure JS engine into a standalone package.

```
@unravel/core (zero DOM dependencies)
├── buildSystemPrompt(level, language, provider)
├── buildRouterPrompt(files, error)
├── callAPI(provider, key, system, user)
├── parseEngineResponse(raw)
├── runASTAnalyzer(code)
├── BUG_TAXONOMY
└── ENGINE_SCHEMA
```

This package is consumed by all platforms. Change the engine once, all platforms update.

#### 3.2 — VS Code Extension + Live Bug Lens ⭐

**This is the viral moment.** A screenshot of a bug appearing inline in VS Code with a one-click fix is what gets shared.

**User flow:**
```
1. Right-click anywhere → "Unravel: Debug This"
2. Extension reads workspace files automatically (no copy-paste)
3. Quick input: describe the bug in one sentence
4. Live Bug Lens activates — decorations overlay on the code
5. Side panel opens with full structured report
```

**What the developer sees in the editor:**
```javascript
function pause(){
    clearInterval(interval)
    interval = null
    duration = remaining   // 🔴 ROOT CAUSE: STATE_MUTATION
                           //    duration must remain constant
}
```

**Hover tooltip:**
```
🔴 Root Cause: STATE_MUTATION
duration represents total session time.
Mutating it here causes tick() to compute remaining incorrectly.
Minimal Fix: remove this assignment.
Confidence: 92% (3 evidence points)
[Apply Fix]  [Show Full Report]
```

**Decoration color system:**
```
🔴 Root cause line         — the exact mutation causing the bug
🟠 Contributing functions  — functions that interact with the bug
🟡 Related variables       — other mutations in the chain
🔵 Timeline markers        — gutter icons showing execution order
```

**Variable mutation tree (sidebar):**
```
duration
├── declared: line 3
├── written: pause() line 69  🔴 BUG
├── written: setMode() line 86
├── read: tick() line 55
└── read: start() line 42
```
Each entry is clickable — jumps to that line.

**Technical implementation (standard VS Code APIs):**
```javascript
// Root cause decoration
const bugDeco = vscode.window.createTextEditorDecorationType({
  backgroundColor: 'rgba(255,0,0,0.15)',
  after: { contentText: ' 🔴 ROOT CAUSE', color: '#ff4444' }
});
editor.setDecorations(bugDeco, [{ range: bugRange }]);

// Hover provider
vscode.languages.registerHoverProvider('*', {
  provideHover(doc, pos) {
    if (isOnBugLine(pos)) return new vscode.Hover(bugMarkdown);
  }
});
```

Works in VS Code, Cursor, Windsurf — anywhere VS Code extensions run.

**Phase 3 verification:**
- Right-click debug works end to end?
- Go-to-line from report jumps correctly?
- Live Bug Lens decorations render with correct tooltips?

---

### Phase 4 — "Intelligence Layer" 📋 PLANNED

**Goal:** Replace single-agent guessing with adversarial multi-agent debate. Add real visual diff and timeline UI.

**Trigger:** Start Phase 4 only after Phase 2 benchmark shows single-agent RCA has a measurable ceiling. If RCA is already ≥ 85% with Opus + AST context, assess whether multi-agent is worth the added complexity before committing.

#### 4.1 — Adversarial Multi-Agent Debate

The core insight: two agents that independently analyze the same problem, then reconcile, produce more accurate output than one confident agent. This turns uncertainty from a failure mode into a feature.

```
                        AST Context + Code Slices
                               │
              ┌────────────────┴────────────────┐
              ▼                                 ▼
   Agent 1: The Detective             Agent 2: The Skeptic
   (Opus 4.6, 64K thinking)           (Opus 4.6, 64K thinking)
   Analyzes everything.               FORBIDDEN from seeing
   Outputs hypothesis + confidence.   Agent 1's output.
                                       Approaches first principles.
              │                                 │
              └────────────────┬────────────────┘
                               ▼
                    The Reconciler
                         │
          ┌──────────────┴──────────────┐
          ▼                             ▼
    They agree                    They disagree
    → Boost confidence            → Surface both hypotheses:
    → Single diagnosis            "Hypothesis A: stale closure L47
                                   Hypothesis B: race condition L52
                                   Evidence for each below."
          │                             │
          └──────────────┬──────────────┘
                         ▼
                  Explainer Agent
```

**Critical implementation rule:** Agent 2's prompt must explicitly begin with:
```
You are analyzing this code fresh. You have NOT seen any prior analysis.
Do not anchor to any previous hypothesis. Approach from first principles only.
```

Without this, Agent 2 anchors to Agent 1's output and the adversarial value is lost.

#### 4.2 — Function-Level Code Slicing

Use the AST to trace dependencies and extract *only* the functions involved in the mutation chain.

```
Full project:  47 files, 12,000 lines
After Router:   5 files,  2,400 lines
After Slicing: 14 functions,  ~350 lines  ← this is what the LLM sees
```

This eliminates context explosion on large projects and keeps LLM reasoning sharp.

#### 4.3 — Visual Diff Output

Replace "here's the entire fixed file" with a minimal surgical diff.

```diff
 function pause(){
     if(!interval) return
     clearInterval(interval)
     interval = null
-    duration = remaining    // ← THE BUG
 }

 function start(){
     if(interval) return
     startTimestamp = Date.now()
+    lastActiveRemaining = remaining  // ← THE FIX
     interval = setInterval(tick, 1000)
 }
```

#### 4.4 — AI-Simulated Bug Replay

The Debugger agent generates a step-by-step execution trace with approximate variable values. Rendered as a clickable timeline in the UI. Each step expands to show variable state.

```
▶ Step 1: start()    duration=1500  remaining=1500  startTimestamp=1000
▶ Step 2: tick()     elapsed=5      remaining=1495
▶ Step 3: pause()    duration=1495  ← ⚠️ MUTATED (was 1500)
▶ Step 4: start()    elapsed calculated from wrong base → timer jumps
```

> Note: This is AI-simulated, not real execution. Values are approximations. Phase 5 replaces this with actual instrumented execution via WebContainers.

**Phase 4 verification:**
- Multi-agent pipeline vs single-call: measure RCA delta on the 10-bug benchmark
- Visual diff renders correctly for all 10 benchmark bugs
- Timeline renders without crashing on edge cases

---

### Phase 5 — "The Breakthrough" 📋 PLANNED

**Goal:** Real instrumented execution. Take Unravel to every platform developers use.

**Trigger:** Start Phase 5 when you have a genuine user base asking for it. Do not build this in a vacuum.

#### 5.1 — Real Instrumented Bug Replay (WebContainers)

Replace AI-simulated replay with real execution. Every variable value is actual, not approximated.

```
1. Load user's project into WebContainer (in-browser Node.js)
2. Instrument the code — inject logging at every mutation point
3. Run the buggy code → capture actual variable values at each step
4. Apply Unravel's fix automatically
5. Run again → capture values post-fix
6. Show before/after comparison with real data
```

```
BEFORE FIX (real execution):
  pause() called → duration mutated: 1500 → 1495 ← actual value captured

AFTER FIX (real execution):
  pause() called → duration unchanged: 1500 ✓ — actual value captured
```

#### 5.2 — Interactive Dependency Graph (D3.js)

Visualize the function call graph and variable mutation paths.

```
[start()] ──calls──► [tick()] ──reads──► duration
    │                                        ▲
    └──sets──► startTimestamp        ⚠️ MUTATED BY
                                          │
                                     [pause()]
```

Clickable nodes jump to that function. Bug path highlighted in red.

#### 5.3 — Debug Journal

After each session, one click generates a permanent personal takeaway.

```
Session: Pomodoro Timer Bug
Lesson: Never mutate a variable that represents a fixed config value
        inside a runtime function. Use a separate variable for changing state.
Pattern: STATE_MUTATION → Immutable Config Values
```

Lessons accumulate in localStorage across sessions. After 5+ sessions:

```
📓 Your Debug Journal

1. STATE_MUTATION — Never mutate config variables at runtime
2. STALE_CLOSURE — Use refs for values inside intervals
3. RACE_CONDITION — Never write shared state from parallel fetches
4. EVENT_LIFECYCLE — Always clean up listeners in useEffect return
5. TYPE_COERCION — Use === not == for mixed types

🔥 Pattern: 3/5 of your bugs involve shared state.
   Learn about immutability and pure functions next.
```

This turns Unravel from "fix my bug" into "make me a better developer."

#### 5.4 — CLI Tool

```bash
npm install -g @unravel/cli
unravel analyze ./src --symptom "timer skips after pause" --output json
```

Reads project files automatically. JSON output for CI/CD pipelines.

#### 5.5 — Desktop App (Electron)

Standalone installable. Native file access. Drag-and-drop project folders.

#### 5.6 — OpenClaw Agent Integration

Unravel as a callable skill for autonomous AI agents.

```
Path 1 — CLI Skill: OpenClaw calls `unravel analyze` as a shell tool
Path 2 — Custom Skill: skills/unravel/ directory with SKILL.md + analyze.js
```

**Phase 5 platform priority:**
```
1. VS Code Extension (already shipped in Phase 3) ← category-defining
2. CLI Tool                                        ← power users, CI/CD
3. OpenClaw Integration                            ← agent ecosystem
4. Desktop App                                     ← broadest audience
```

---

## Summary Timeline

```
PHASE 1 "Deep Thinking"       ✅ COMPLETE
├── BYOK multi-provider (Anthropic / OpenAI / Google)
├── SOTA models: Opus 4.6, Sonnet 4.6, Gemini 3.x, GPT 5.3
├── Extended thinking (64K tokens)
├── Provider-specific prompt formatting (XML / Markdown / Delimiters)
├── 8-phase deterministic reasoning pipeline
├── Anti-sycophancy guardrails (5 rules)
├── Evidence-backed confidence output
├── Bug taxonomy (12-category enum)
├── Concept extraction
└── "Why AI loops" analysis

PHASE 2 "The Proof"            📍 IN PROGRESS — Weeks 1–3
├── 2.1 AST Pre-Analysis (@babel/parser)
│   ├── extractMutationChains(code)
│   ├── trackClosureCaptures(code)
│   └── findTimingNodes(code)
├── 2.2 10-Bug Benchmark
│   ├── 10 bugs with defined root causes (see taxonomy table)
│   └── runner.js: RCA with/without AST context
└── 2.3 Open Source Launch with proven RCA numbers

PHASE 3 "The Demo"             📋 PLANNED — Weeks 4–8
├── Extract @unravel/core shared engine (npm package)
└── VS Code Extension + Live Bug Lens

PHASE 4 "Intelligence Layer"   📋 PLANNED — Weeks 9–16
├── Adversarial multi-agent debate (Detective + Skeptic + Reconciler)
├── Function-level code slicing
├── Visual diff output
└── AI-simulated bug replay timeline

PHASE 5 "The Breakthrough"     📋 PLANNED — Month 5+
├── WebContainers live instrumented execution
├── Interactive D3.js dependency graph
├── Debug Journal + learning path system
├── CLI Tool
├── OpenClaw Agent integration
└── Desktop App (Electron)
```

---

## Verification Checkpoints

### Phase 2 (Critical Path)
- Run `extractMutationChains()` on the Pomodoro timer bug. Does output match the expected context map?
- Run all 10 benchmark bugs through runner.js. Do the without/with AST numbers show a statistically meaningful delta?
- Is the hallucination rate below 10% before launch? (Target is < 5% — get to < 10% for v1 open source)

### Phase 3
- Right-click debug works end to end in a fresh VS Code window?
- Live Bug Lens decorations render correctly with hover tooltips?
- Go-to-line from the report panel jumps to the correct line?

### Phase 4
- Multi-agent pipeline RCA vs single-agent on the 10-bug benchmark: is the delta > 10%? If not, reassess whether the added complexity is worth it.
- Does the Skeptic agent reliably produce independent hypotheses, or does it anchor to Agent 1? (Check by comparing outputs on 5 known bugs)

### Phase 5
- WebContainers: do captured variable values match the AI-simulated replay from Phase 4?
- CLI: does `unravel analyze ./src` produce valid JSON output on the 10 benchmark bugs?
- Debug Journal: does localStorage accumulation work correctly across 10+ sessions?

---

*Last updated: Phase 1 complete. Phase 2 in progress.*
