# Unravel — Sprint 3 Implementation Report
*Cross-File AST · Graph Router · Streaming*
*Approved design. Ready to build.*

---

## Status Entering Sprint 3

| Sprint | Status |
|--------|--------|
| Sprint 0 — Docs | ✅ Complete |
| Sprint 1 — Trust Layer | ✅ Complete (Claim Verifier, confidence enforcement, resource caps) |
| Sprint 2 — Benchmark | ✅ Complete (10/10 RCA, honest proxy framing, AST delta pending) |
| **Sprint 3 — Intelligence Layer** | 🔨 Starting now |

Benchmark result entering Sprint 3: **100% RCA on 10-bug dev proxy with Gemini 2.5 Flash.**
This is an internal validation number. The AST delta proof (with vs without) is produced during Sprint 3.

---

## Priority Order — DO NOT REORDER

```
1. Cross-File AST Import Resolution   ← enables everything below
2. Graph-Frontier Router              ← consumes the graph
3. Streaming Response Display         ← pure UX, no dependencies
```

Rationale: Cross-file AST produces the project graph. The router consumes that graph for
deterministic file selection. Streaming is independent UX. Building out of order wastes effort.

---

## Task 1 — Cross-File AST Import Resolution
**Estimated effort: ~5 hours**
**File to create: `src/core/ast-project.js`**

### The Problem

The current AST engine (`ast-engine.js`) parses each file in isolation. It produces
mutation chains, closure captures, and timing nodes — but only within a single file's scope.

If `state.js` exports `let count = 0` and `App.js` imports and mutates it, the mutation
chain for `count` shows no writes. The cross-file connection is invisible to the engine.

This is the #1 gap preventing detection of the hardest bug classes:
shared state mutation, cross-component data flow, API misuse, imported helper errors.

### Architecture

```
Per-File AST (existing, unchanged)
        ↓
ast-project.js  ← NEW
        ↓
  Module Map
  Symbol Origins
  Dependency Graph
  Risk Signals
        ↓
Merged Mutation Chains (injected into prompt as ground truth)
```

`ast-engine.js` is not modified. `ast-project.js` is a post-processing pass
that runs after all individual files are parsed.

### Data Structures

Two maps. Nothing more complex than this.

```javascript
// moduleMap — what each file imports and exports
moduleMap = {
  "state.js": {
    exports: { count: { line: 1 } }
  },
  "App.js": {
    imports: { count: { from: "state.js", line: 1 } }
  },
  "Display.js": {
    imports: { count: { from: "state.js", line: 1 } }
  }
}

// symbolOrigins — where each symbol was originally declared
symbolOrigins = {
  "count": { file: "state.js", line: 1 }
}
```

### Implementation Steps

**Step 1 — Build Module Map**

Walk each file's AST. Collect:
- Every `import` statement → record `{ symbolName: { from: resolvedFile, line } }`
- Every `export` declaration → record `{ symbolName: { line } }`
- Resolve relative paths to canonical filenames (strip `./`, normalize extensions)

**Ignore node_modules entirely.** Only resolve local files. Pattern to skip:
```javascript
if (importPath.startsWith('.') === false) return; // skip external packages
```

**Step 2 — Resolve Symbol Origins**

For every imported symbol in every file, trace it back to its origin file using `moduleMap`.
Populate `symbolOrigins[symbolName] = { file, line }`.

**Step 3 — Expand Mutation Chains**

Take the per-file mutation data from `ast-engine.js`. For each mutation:
- Check if the variable is an imported symbol via `symbolOrigins`
- If yes, attach the mutation to the origin variable's chain

Before (file-local):
```
count [App.js]
  writes: App.js L14
```

After (cross-file):
```
count [state.js]  ← origin
  writes: App.js L14, Dashboard.js L22
  reads:  Display.js L9
```

The mutation chain now spans files. The AI sees the full lifecycle.

**Step 4 — Track Cross-File Function Calls**

For each `import { fetchData } from './api'` followed by a `fetchData()` call,
add a directed graph edge:

```javascript
callGraph.push({
  caller: "page.js",
  callee: "api.js",
  function: "fetchData",
  line: callLine
})
```

This becomes part of the dependency graph the router walks.

**Step 5 — Emit Risk Signals** ← The high-value addition

After building the merged chains, scan for structural patterns and annotate them.
These are facts, not guesses. They do not output bugs. They are injected as
pre-reasoning signals into the prompt.

```javascript
riskSignals = []

// Pattern 1: Exported variable mutated outside its origin file
if (symbolOrigins[varName] && mutationFile !== symbolOrigins[varName].file) {
  riskSignals.push({
    type: "cross_file_mutation",
    variable: varName,
    origin: symbolOrigins[varName].file,
    mutatedIn: mutationFile,
    line: mutationLine
  })
}

// Pattern 2: Variable written across async boundary
// (timing node in same function that writes variable)
if (withinAsyncBoundary && isWrite) {
  riskSignals.push({
    type: "async_state_race",
    variable: varName,
    file: fileName,
    line: mutationLine
  })
}

// Pattern 3: Stale closure (already detected by ast-engine, now annotated)
// Promote existing closure capture to risk signal if dependency array is empty
if (closureCapture && emptyDepArray) {
  riskSignals.push({
    type: "stale_closure",
    variable: varName,
    capturedIn: functionName,
    file: fileName
  })
}

// Pattern 4: Unawaited promise
if (callNode.isAsync && !hasAwait) {
  riskSignals.push({
    type: "unawaited_promise",
    function: calleeName,
    file: fileName,
    line: callLine
  })
}
```

**Critical rule:** Risk signals are hints, not diagnoses. Redux store mutations,
Zustand actions, and other intentional shared-state patterns will trigger
`cross_file_mutation`. The AI reasons about whether the pattern is a bug.
Never surface risk signals as confirmed bugs directly.

### Prompt Injection Format

The merged chains and risk signals replace the current per-file AST context block:

```
VERIFIED STATIC ANALYSIS — cross-file, deterministic
══════════════════════════════════════════════════════

Cross-File Mutation Chains:
  count [origin: state.js L1]
    written: App.js L14, Dashboard.js L22
    read:    Display.js L9

Risk Signals Detected:
  • cross_file_mutation  — count (state.js → App.js L14)
  • cross_file_mutation  — count (state.js → Dashboard.js L22)

[standard per-file chains below]
```

### Test Case to Write Before Coding

Create `benchmarks/bugs/cross_file_state.js` — a 2-file bug:

```javascript
// state.js
export let count = 0;
export function increment() { count++; }

// App.js
import { count } from './state.js';
setInterval(() => { count += 2; }, 1000); // BUG — direct mutation of exported var
```

The verifier test: after `runCrossFileAnalysis([stateFile, appFile])`,
`count`'s mutation chain must show writes in both files,
and a `cross_file_mutation` risk signal must be emitted.

**Write this test before writing `ast-project.js`.** Test-first here prevents building blind.

---

## Task 2 — Graph-Frontier Router
**Estimated effort: ~4 hours**
**Modifies: `src/core/orchestrate.js` (router call)**

### The Problem

The current router uses an LLM call (Haiku/Flash) to select which files to send to the engine.
This means file selection is probabilistic, costs tokens, and produces different results
on repeated runs. It also cannot improve — it's only as good as the model's heuristic.

`_provenance.routerStrategy: 'llm-heuristic'` in every report is the evidence this is unfixed.

### Design

Once Task 1 is complete, the dependency graph exists. File selection becomes graph traversal.

```
Entry Point (file containing the symptom keywords OR most-imported file)
        ↓
Walk import graph BFS/DFS
        ↓
Walk call graph from entry functions
        ↓
Walk mutation chains for variables mentioned in symptom
        ↓
Stop at: depth ≤ 3, files ≤ 15
        ↓
Return: exact file set, deterministic
```

Triple graph intersection (the full Phase 4B.3 design):

```
1. Import Graph:    file → imports → files
2. Call Graph:      function → calls → functions → files
3. Mutation Graph:  variable → written/read in → files

Intersection = the exact subgraph needed
```

For Sprint 3, build steps 1 and 3. Call graph (step 2) is additive and can follow.

### Stop Conditions

```javascript
const MAX_DEPTH = 3;
const MAX_FILES = 15;

// If a file is only imported by one file and has no mutations on
// symptom-relevant variables, skip it.
```

### Fallback

If the graph walk returns < 3 files (sparse project, or single-file input),
fall back to the existing LLM router. Do not remove it — demote it to fallback.

```javascript
_provenance.routerStrategy = graphFiles.length >= 3
  ? 'graph-frontier'
  : 'llm-heuristic-fallback'
```

This is how you detect in production whether the graph router is working.

---

## Task 3 — Streaming Response Display
**Estimated effort: ~3 hours**
**Modifies: `src/core/provider.js`, `src/App.jsx`, `sidebar.js`**

### The Problem

Users wait 15–60 seconds with a spinner. No feedback. Perceived as slow even when it isn't.
Streaming doesn't make the engine faster — it makes the wait feel shorter.

### Design

Stream sections in this order (matches user priority):

```
1. Root Cause + Bug Type     ← most wanted, show first
2. Evidence                  ← confirms the diagnosis
3. Minimal Fix               ← actionable
4. Execution Timeline        ← context
5. Concept Explanation       ← learning, show last
```

### Implementation

Gemini supports SSE streaming via `stream: true`. Anthropic supports streaming natively.

The challenge is that the engine currently expects a complete JSON object.
Streaming gives you chunks of text that form JSON incrementally.

Two approaches:

**Option A — Section-first streaming (recommended)**
Change the output schema to emit one JSON section per response segment.
Parse and render each section as it arrives. Requires schema restructuring.

**Option B — Progressive JSON repair**
Buffer the streaming response. As each new chunk arrives, attempt
`repairTruncatedJson()` on the buffer. Render whatever fields are now parseable.
Simpler, reuses existing infrastructure, lower risk.

Go with Option B first. Option A is cleaner but takes longer and touches more files.

### VS Code

The webview panel renders HTML. Add a `<div id="streaming-indicator">` that shows
"Analyzing root cause..." → "Building evidence..." → "Generating fix..." as stages arrive.
This works even without true streaming since `onProgress` callbacks already exist.

---

## Risk Signals — Bug Class Coverage

| Bug Class | Risk Signal | Benchmark Impact |
|-----------|-------------|-----------------|
| Shared state mutation | `cross_file_mutation` | Huge |
| Race condition | `async_state_race` | Huge |
| Stale closure | `stale_closure` | Huge |
| Missing await | `unawaited_promise` | Medium |

These four classes represent the bugs that most commonly defeat pure-LLM debuggers.
Deterministic pre-labeling of these patterns is a direct competitive advantage.

---

## What Sprint 3 Proves

After Sprint 3, you can run this benchmark comparison:

| Configuration | Expected RCA |
|---------------|-------------|
| Gemini Flash, no pipeline | ~40-60% |
| + 9-phase pipeline | ~70-80% |
| + per-file AST | ~85-90% |
| + cross-file AST + risk signals | ~95-100% |

Each row is a publishable delta. The cross-file row is the one that proves
the system handles real multi-file codebases — which is what every real project is.

**"AST pre-analysis with cross-file resolution improved RCA by X% on multi-file bugs"**
is a concrete, defensible, publishable claim. That number is what opens the door
to the 20-bug suite, the launch post, and eventually the API pitch.

---

## Implementation Sequence

```
Day 1 (~5 hrs)
  Write cross_file_state.js test case
  Build ast-project.js:
    - buildModuleMap()
    - resolveSymbolOrigins()
    - expandMutationChains()
    - emitRiskSignals()
  Run test case. Confirm cross-file chain and risk signal appear.
  Sync to unravel-vscode/src/core/

Day 2 (~4 hrs)
  Build graph-frontier router in orchestrate.js
  Add _provenance.routerStrategy = 'graph-frontier'
  Run 10-bug proxy. Confirm no regression.
  Add multi-file bug to proxy suite. Confirm 100% with graph router.

Day 3 (~3 hrs)
  Implement streaming (Option B — progressive JSON repair)
  Test in web app. Confirm sections appear progressively.
  Test in VS Code. Confirm onProgress stages show correctly.
```

---

## Files Touched

| File | Change |
|------|--------|
| `src/core/ast-project.js` | NEW — entire cross-file layer |
| `src/core/orchestrate.js` | Import ast-project, swap router, inject risk signals |
| `src/core/provider.js` | Add streaming support (Task 3) |
| `src/App.jsx` | Progressive rendering (Task 3) |
| `unravel-vscode/src/sidebar.js` | Stage indicators (Task 3) |
| `benchmarks/bugs/cross_file_state.js` | NEW — test case |
| `benchmarks/verifier-tests.js` | Add cross-file test assertions |
| `sync-core.sh` | Run after every core change |

`ast-engine.js` and `parse-json.js` are NOT modified. The existing per-file engine
is preserved. `ast-project.js` is purely additive.

---

## Definition of Done

Sprint 3 is complete when:

- [ ] `ast-project.js` exists with all 4 functions
- [ ] Cross-file mutation chains appear in prompt context for multi-file inputs
- [ ] Risk signals appear in prompt for all 4 bug classes
- [ ] `_provenance.routerStrategy` reads `'graph-frontier'` on multi-file inputs
- [ ] 10-bug proxy still passes 100% (no regression)
- [ ] At least 1 new multi-file bug added to proxy and passing
- [ ] Streaming shows progressive sections in web app
- [ ] All 6 core files synced via `sync-core.sh`
- [ ] AST delta benchmark run documented (with vs without cross-file)

---

*The benchmark delta from the last item above is the number that makes Unravel's
technical story externally publishable. Everything in Sprint 3 builds toward that one number.*
