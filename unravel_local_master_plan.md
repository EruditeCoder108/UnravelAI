# unravel-local — The Master Plan
### *The Definitive Build Document*

> **Cloud intelligence is general and rented. Local intelligence is specific and owned. Both will improve. But only one compounds with usage.**

---

## Part 0 — What This Is and What Already Exists

`unravel-local` is the 4th Unravel variant. It is not a debugging tool. It is a **codebase intelligence layer** — a local system that accumulates structural truth about your specific project over time and uses that truth to prevent bugs before they're written.

It runs entirely offline, requires zero API keys, owns the machine it runs on, and gets meaningfully smarter with every session.

### ⚠️ Critical Correction: What the MCP Already Has

The plan previously implied that KG, embeddings, pattern store, and memory were local-only innovations. **This was wrong.** The existing `unravel-mcp` ALREADY has all of this:

| Capability | In MCP today? | Notes |
|---|---|---|
| **Knowledge Graph** (`knowledge.json`) | ✅ Yes | `build_map` → `graph-builder.js` + `graph-storage.js`. Incremental SHA-256 diffing. Persists to `.unravel/`. Dynamic — updates on file change. |
| **Semantic Embeddings** | ✅ Yes | `embedGraphNodes()` via Gemini API. Top-50 hub nodes by default, `'all'` mode available. 768-dim. |
| **KG file routing** | ✅ Yes | `query_graph` → semantic cosine + keyword + graph expansion + pattern boosts |
| **Pattern Store** (`patterns.json`) | ✅ Yes | Written on every `verify(PASSED)`. Weight +0.05 on pass, -0.03 on reject. Injected as §C hints into every `analyze()` call. |
| **Diagnosis Archive** (`diagnosis-archive.json`) | ✅ Yes | Written on every `verify(PASSED)`. 768-dim embedding. Searched by cosine ≥ 0.75. Injected as §D ⚡ hits. |
| **Task Codex** (`.unravel/codex/`) | ✅ Yes | `autoSeedCodex()` seeds minimal entries on every `verify(PASSED)`. Agent writes richer full entries. `searchCodex()` returns `pre_briefing` in `query_graph`. |
| **Visual routing** (`query_visual`) | ✅ Yes | Image + text embedding fused 60/40. Requires Gemini API. |
| **Git context in `consult`** | ✅ Yes | Live `git log` / `git diff` cached per HEAD. |

**What `unravel-local` does is NOT invent these — it runs them on local infrastructure.** The only three things that need to change for the memory layers to work locally:
1. **Gemini embedding API** → `nomic-embed-text` via Ollama (zero cloud dependency)
2. **IDB (IndexedDB, browser-only)** for the webapp archive → `fs`-based JSON (already how MCP works — `graph-storage.js`)
3. **`GEMINI_API_KEY` requirement** → removed entirely

### How the 4 Variants Compare (Corrected)

| | `unravel-mcp` | `unravel-v3` | `unravel-vscode` | `unravel-local` |
|---|---|---|---|---|
| **Who reasons?** | External agent (you/Claude/etc.) | Cloud LLM | Cloud LLM | **Gemma 4 E4B (local)** |
| **Pipeline** | Phases 0→1d + returns evidence | Phases 0→9 full | Phases 0→9 full | **Phases 0→9 full + Runtime** |
| **KG + embeddings** | ✅ Gemini API | ✅ Gemini API | ❌ | **✅ nomic-embed-text (local)** |
| **Pattern store** | ✅ persistent | ✅ session only | ❌ | **✅ persistent + global** |
| **Diagnosis archive** | ✅ fs-based | ✅ IDB-based | ❌ | **✅ fs-based (same as MCP)** |
| **Task Codex** | ✅ auto-seeded + agent-written | ❌ | ❌ | **✅ same as MCP** |
| **Internet** | For embeddings only | Required | Required | **Zero** |
| **API key** | GEMINI_API_KEY optional | Required | Required | **Zero** |

---

## Part 1 — The Four Capability Layers

### ⚡ What's Genuinely New vs What Already Works

Before listing capabilities, here's the honest split:

| Capability | Status | What changes for `unravel-local` |
|---|---|---|
| AST engine, KG, pattern store, archive, Task Codex | **Already in MCP** | Just swap Gemini → nomic. Copy as-is. |
| Full 11-phase pipeline (not just evidence packet) | **Already in webapp** | Remove MCP short-circuit. Add Ollama provider. |
| fs-based archive (not IDB) | **Already in MCP** | Already works. No change needed. |
| Runtime instrumentation + Inspector Protocol | **New** | Not in any variant yet |
| Pre-commit guard, watch daemon | **New** | Not in any variant yet |
| Git blame enrichment + auto bisect | **New** | Not in any variant yet |
| Global pattern store (`~/.unravel/`) | **New** | Per-project already works; global merge is new |
| Model bias tracking + LoRA pipeline | **New** | Not in any variant yet |
| Multimodal input (Gemma vision) | **New** | query_visual uses Gemini; this uses Gemma natively |

### Layer 1: Evidence
The deterministic foundation. AST engine, KG, pattern store, cross-file analysis — **all copy as-is from `unravel-mcp`**. The only change: swap embedding backend from Gemini → nomic-embed-text.

**What's genuinely new:** The Runtime Evidence sub-layer — no existing variant has this:
- Auto-instrumentation: inject `console.log` at AST-identified mutation sites into a temp copy
- Execute the instrumented code, capture stdout, compare predicted vs actual values
- Inject `RUNTIME_VERIFIED` facts into `astContext` at the same authority level as `AST_VERIFIED`
- Node.js Inspector Protocol for programmatic breakpoints at AST-flagged mutation sites

### Layer 2: Memory
**Already fully built in the MCP** — the local variant inherits it unchanged:
- **Pattern Store** (`patterns.json`): auto-written on `verify(PASSED)`, bumps +0.05, injected as §C hints
- **Diagnosis Archive** (`diagnosis-archive.json`): auto-written on `verify(PASSED)`, 768-dim cosine search, injected as §D ⚡ hits  
- **Knowledge Graph** (`knowledge.json`): incremental SHA-256 diffing, built by `build_map`, routes files via semantic + keyword + graph expansion
- **Task Codex** (`.unravel/codex/`): `autoSeedCodex()` seeds entries on every `verify(PASSED)`, `searchCodex()` returns `pre_briefing` in `query_graph`

**What's genuinely new in this layer:**
- **Global Pattern Store** (`~/.unravel/`): merges patterns across all projects — language-level structural patterns (forEach async, stale closure) transfer from project-A to project-B
- **Invariant Registry** (`.unravel/invariants.json`): Phase 8 invariants extracted and stored as live enforced rules, not just text in a report
- **Blame-enriched KG**: each KG node gets `{ introducedAt, lastModified, modifiedBy, frequency, riskScore }` from git history

### Layer 3: Action — Genuinely New
**None of this exists in any current variant:**
- **Watch Daemon**: real-time `fs.watch` → AST diff on every save → invariant check → pattern store match → alert (no LLM if pattern store confidence > 0.8)
- **Pre-Commit Guard**: `unravel-local guard --staged` as a git hook — blocks commits matching verified-bad structural patterns from the pattern store
- **Fix Verification**: apply fix to temp branch → run test suite → empirical PASS/FAIL before presenting the fix
- **Test Synthesis**: generate regression test from verified diagnosis → run it → commit to `__tests__/`
- **Auto Bisect**: after `verify(PASSED)`, trace the introducing commit via `git log --follow -p`
- **PR Structural Report**: per-PR AST diff report — new mutation sites, pattern matches, risk scores, suggested review focus

### Layer 4: Learning — Genuinely New
**None of this exists in any current variant:**
- **Self-Calibration**: log hypothesis elimination events → measure bias rates → inject CALIBRATION block into Modelfile, rebuild model
- **Teacher-Student Mode**: same bug through local + cloud → delta extracts training examples when Gemma misses what Sonnet caught
- **LoRA Fine-Tuning Pipeline**: 50 verified diagnoses → `lora-training-dataset.jsonl` in Alpaca format → fine-tune Gemma on your exact project history
- **Team Intelligence via Git**: commit `.unravel/` → teammates pull patterns/archive/invariants automatically via existing git workflow

---

## Part 2 — Architecture

### The Core Insight on Orchestrate.js

The MCP short-circuits at Phase 1d (`if (options._mode === 'mcp')` — L428–524 in orchestrate.js) and returns raw AST evidence to the calling agent. 

`unravel-local` **removes this short-circuit entirely**. The pipeline flows through all 11 phases, calling Ollama as the reasoning model at Phase 3. This is architecturally identical to how the webapp calls Claude/Gemini — just with a different provider.

```
unravel-local orchestrate flow:
  Phase 0:   Input validation            ← unchanged
  Phase 0.5: KG Router (nomic embed)     ← swap Gemini → nomic
  Phase 1:   AST extraction              ← unchanged (tree-sitter)
  Phase 1b:  Cross-file analysis         ← unchanged
  Phase 1c:  Symptom contradiction check ← unchanged
  Phase 1d:  Coverage enforcement        ← unchanged
  Phase 1e:  Pattern hints               ← unchanged
  Phase 1f:  Diagnosis archive search    ← swap IDB → fs + nomic
                                         ← NO MCP EXIT HERE
  Phase 2:   Build prompt                ← add 'ollama' format branch
  Phase 3:   Call Ollama (Gemma 4 E4B)   ← replace callProvider()
  Phase 4:   Parse JSON                  ← unchanged (parse-json.js)
  Phase 5:   verifyClaims()              ← unchanged
  Phase 5.5: Pattern learning            ← unchanged (learnFromDiagnosis)
  Phase 5.6: Archive to fs               ← swap IDB → fs
  Phase 6:   Solvability check           ← unchanged
  Phase 7:   Layer boundary              ← unchanged
  Phase 8+:  Return result               ← unchanged
```

### Package Structure

```
unravel-local/
│
├── package.json                  name: "unravel-local", no MCP SDK
├── index.js                      Node API: export { analyze, verify, watch, guard }
├── cli.js                        CLI: unravel-local <command> [args]
├── Modelfile.unravel             ollama create unravel-gemma4 -f this
├── README.md
│
├── providers/
│   ├── ollama-embed.js           nomic-embed-text backend (drop-in for embedding.js)
│   ├── ollama-llm.js             Gemma 4 E4B reasoning backend
│   └── provider-config.js        routing: local (default) or cloud (env var fallback)
│
├── runtime/                      [Layer 1 Runtime Extension — Phase 2]
│   ├── inspector.js              Node.js Inspector Protocol client
│   ├── instrumenter.js           auto-inject console.log at mutation sites
│   └── test-runner.js            run project test suite, capture results
│
├── git/                          [Layer 3 Git Integration — Phase 3]
│   ├── bisect.js                 auto git bisect from root cause
│   ├── blame-enricher.js         enrich KG nodes with temporal data
│   ├── semantic-differ.js        AST diff between commits
│   └── pr-reporter.js            generate structural PR reports
│
├── daemon/                       [Layer 3 Action — Phase 3]
│   ├── watch.js                  fs.watch daemon, AST delta detection
│   ├── invariant-checker.js      check invariant registry on each save
│   └── guard.js                  pre-commit hook runner
│
├── learning/                     [Layer 4 — Phase 4+]
│   ├── bias-tracker.js           log reasoning steps, detect model bias
│   ├── distillation.js           compare local vs cloud, extract deltas
│   └── lora-prep.js              prepare fine-tuning dataset
│
├── scripts/
│   ├── health-check.js           doctor: verify Ollama + both models
│   ├── reembed-all.js            one-time re-embed after switching from Gemini
│   ├── install-hook.js           install .git/hooks/pre-commit
│   └── global-merge.js           merge project patterns into ~/.unravel/
│
└── core/                         deterministic engine (copied from unravel-mcp)
    ├── orchestrate.js            ← ADAPTED: no MCP short-circuit, Ollama call
    ├── config.js                 ← ADAPTED: ollama prompt format, schema kept
    ├── ast-engine-ts.js          ← copied as-is
    ├── ast-project.js            ← copied as-is
    ├── ast-bridge.js             ← copied as-is
    ├── graph-builder.js          ← copied as-is
    ├── graph-storage.js          ← copied as-is
    ├── search.js                 ← copied as-is
    ├── parse-json.js             ← copied as-is
    ├── pattern-store.js          ← copied as-is
    ├── layer-detector.js         ← copied as-is
    └── indexer.js                ← copied as-is
```

---

## Part 3 — Technical Specifications

### Spec 1: `providers/ollama-embed.js`

Drop-in replacement for `embedding.js`. All function signatures identical — callers don't change.

```javascript
const OLLAMA_BASE  = process.env.OLLAMA_HOST || 'http://localhost:11434';
const EMBED_MODEL  = process.env.UNRAVEL_EMBED_MODEL || 'nomic-embed-text';

// nomic task prefixes — critical for retrieval quality (+3-5%)
const TASK_PREFIXES = {
  RETRIEVAL_DOCUMENT: 'search_document: ',
  RETRIEVAL_QUERY:    'search_query: ',
  SEMANTIC_SIMILARITY: '',   // no prefix for similarity tasks
  CLASSIFICATION:      '',
};

export async function embedText(text, _apiKey, taskType = 'RETRIEVAL_DOCUMENT') {
  const prefix = TASK_PREFIXES[taskType] || '';
  const response = await fetch(`${OLLAMA_BASE}/api/embed`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ model: EMBED_MODEL, input: prefix + text }),
  });
  const data = await response.json();
  return data.embeddings?.[0] || null;  // 768-dim float array
}

export async function embedImage(_imageInput, _apiKey) {
  // nomic-embed-text: text only. Fall back gracefully.
  // query_visual becomes text-only in local mode.
  return null;
}

// [All other exports: embedTextsParallel, cosineSimilarity, buildSemanticScores,
//  archiveDiagnosis, searchDiagnosisArchive, fuseEmbeddings, etc.]
// Signatures identical to embedding.js — implementations swap Gemini → Ollama.
// Vector math (cosine, fuse) is pure JS — no changes needed.

// _apiKey parameters accepted everywhere but ignored — zero breaking changes.
```

> **The re-embed problem:** Gemini 768-dim and nomic 768-dim vectors live in different geometric spaces. Same dimension count, meaningless cosine between them. Run `reembed-all.js` once after switching. Takes ~30–60s for a medium project. After that, semantic search works correctly.

### Spec 2: `providers/ollama-llm.js`

```javascript
const OLLAMA_BASE    = process.env.OLLAMA_HOST || 'http://localhost:11434';
const REASON_MODEL   = process.env.UNRAVEL_MODEL || 'unravel-gemma4';

// Tuned for the 11-phase structured reasoning protocol
const DEFAULT_OPTIONS = {
  temperature:    0.1,   // low: structured output, not creative
  top_p:          0.9,
  repeat_penalty: 1.1,   // prevents looping in long JSON output
  num_ctx:        32768, // fits full AST payload + codefiles + schema
  num_predict:    6000,  // full diagnosis output
};

export async function chat(messages, opts = {}) {
  const response = await fetch(`${OLLAMA_BASE}/api/chat`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({
      model: REASON_MODEL,
      messages,
      stream: false,
      format: 'json',     // Gemma 4 native structured output — fewer parse failures
      options: { ...DEFAULT_OPTIONS, ...opts },
    }),
  });
  const data = await response.json();
  return data.message?.content || '';
}

export async function chatStreaming(messages, opts = {}, onChunk) {
  const response = await fetch(`${OLLAMA_BASE}/api/chat`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({
      model: REASON_MODEL,
      messages,
      stream: true,
      options: { ...DEFAULT_OPTIONS, ...opts },
    }),
  });
  // Ollama streams NDJSON: one JSON object per line
  // Each chunk: { message: { content: "..." }, done: boolean }
  let accumulated = '';
  for await (const line of response.body) {
    const chunk = JSON.parse(line);
    const delta = chunk.message?.content || '';
    if (delta) { accumulated += delta; onChunk?.(delta); }
    if (chunk.done) break;
  }
  return accumulated;
}
```

### Spec 3: `Modelfile.unravel`

This is the single most important file. It bakes the full 11-phase protocol into Gemma 4 E4B as a persistent named model. Protocol instructions become weights, not tokens — zero per-call overhead.

```
FROM gemma4:e4b

PARAMETER temperature    0.1
PARAMETER top_p          0.9
PARAMETER repeat_penalty 1.1
PARAMETER num_ctx        32768
PARAMETER num_predict    6000

SYSTEM """
You are UNRAVEL — a deterministic AI debugging engine. You do NOT guess bugs.
You reason systematically through a structured pipeline.

═══ HARD PROTOCOL GATES ═══
These cannot be bypassed for any reason:

HYPOTHESIS_GATE: You MUST generate exactly 3 mutually exclusive competing
hypotheses in Phase 3. If you have fewer than 3, you have not thought broadly
enough. Submitting fewer is a protocol violation.

EVIDENCE_CITATION_GATE: Every rootCause claim MUST contain a file:line
citation (e.g., "scheduler.js:42"). A rootCause with no code citation is
hallucinated reasoning and will be rejected.

═══ ANALYSIS PIPELINE ═══

Phase 1 — READ: Read every file completely before forming any opinion.
Do not diagnose until you have a complete mental model. The bug may look
syntactically correct — verify behavior from execution, not from naming.

Phase 2 — UNDERSTAND INTENT: For each function, what is it trying to
accomplish? Trace every exported symbol across all files. Never confine
state analysis to a single file.

Phase 3 — UNDERSTAND REALITY + GENERATE 3 HYPOTHESES:
What is the code actually doing vs what it intends?
Generate exactly 3 competing hypotheses. They MUST be mutually exclusive —
distinct root mechanisms, not variations of the same idea.
For each: state falsifiableIf[] conditions (what evidence would disprove it).

Phase 3.5 — HYPOTHESIS EXPANSION: After Phase 4, does the context reveal
cross-file mechanisms invisible before? Add at most 2 new hypotheses.
The hypothesis space CLOSES here.

Phase 4 — BUILD CONTEXT: What does each part depend on / affect?
For each hypothesis: populate evidenceMap with supporting[], contradicting[],
missing[] evidence. Set verdict: SUPPORTED | CONTESTED | UNVERIFIABLE | SPECULATIVE.

Phase 5 — DIAGNOSE: Test each hypothesis against AST evidence.
Kill hypotheses contradicted by evidence. Cite the exact code fragment.
Rate survivors: STRONG (≥2 AST citations) | WEAK (1 citation) | DEFAULT (elimination only).
Cap DEFAULT confidence at 0.75. Build causalChain[] for survivors.

Phase 5.5 — ADVERSARIAL CONFIRMATION:
PRE-CHECK: List every ⛔ annotation. These are spec facts, not disputable.
For each remaining survivor: actively try to disprove it.
If 2+ survive all attacks: set multipleHypothesesSurvived: true — do NOT force a winner.

Phase 6 — MINIMAL FIX: Smallest possible change. Include diffBlock as unified diff.
Apply ARCHITECTURAL EXCEPTION for: (A) patch hides root cause, (B) creates
maintenance debt, (C) fundamental design flaw. When triggered: provide both
surgical patch AND architectural note with full implementation.

Phase 7 — CONCEPT EXTRACTION: What bug class does this teach? How to avoid forever?

Phase 7.5 — PATTERN PROPAGATION: Scan for other locations with the same structural
pattern. Populate relatedRisks[]. Label POTENTIAL RISK, not confirmed bug.

Phase 8 — INVARIANTS: What conditions MUST always be true for this to work?

Phase 8.5 — FIX-INVARIANT CONSISTENCY: Does Phase 6 fix satisfy all invariants?
If violated: add to fixInvariantViolations[] and revise fix ONCE. No more loops.

═══ RULES ═══
1. NEVER make up code behavior you cannot verify from provided files.
2. Every bug claim MUST include exact file + line number. No citation = do not claim.
3. The user's description is a symptom, NOT a diagnosis. Verify everything.
4. CONFIDENCE: 0.85+ when you have code-level evidence. Only below 0.75 if:
   critical files are missing, OR two hypotheses survive with equal evidence.
5. PROXIMATE FIXATION GUARD: crash site ≠ root cause. Trace backwards.
6. NAME-BEHAVIOR FALLACY: isPaused doesn't mean code pauses. Verify from execution.
7. AST SPEC AUTHORITY: ⛔ annotations are deterministic facts. Not disputable.
8. UNCERTAINTY: only specific unknowns that change the diagnosis. No generic disclaimers.

Return your analysis as a JSON object. All field values must be substantiated by
file:line citations from the provided code.
"""
```

Build once: `ollama create unravel-gemma4 -f Modelfile.unravel`
Update when protocol changes: `ollama rm unravel-gemma4 && ollama create unravel-gemma4 -f Modelfile.unravel`

### Spec 4: `config.js` — Ollama Prompt Format

Add the `'ollama'` branch to `_formatPrompt()`. Gemma 4 responds better to plain numbered markdown — no XML tags.

```javascript
if (provider === 'ollama') {
  // Streamlined — model already has full protocol from Modelfile.
  // User prompt carries only the per-call dynamic context:
  // files, AST evidence, symptom, schema.
  // System prompt here is REINFORCEMENT only — not the primary protocol.
  return `You are UNRAVEL. Follow the 11-phase pipeline from your system context.

User profile:
- Level: ${levelInst}
- Language: ${langInst}

${schemaLine}`;
  // The Modelfile system prompt IS the full protocol.
  // This user-prompt system reinforcement is intentionally brief.
}
```

### Spec 5: CLI Command Map

```bash
unravel-local debug <dir> "<symptom>"        # Full 11-phase debug
unravel-local explain <dir>                  # Explain mode
unravel-local security <dir>                 # Security audit mode
unravel-local index <dir>                    # Build/update knowledge graph
unravel-local watch <dir>                    # Start watch daemon
unravel-local guard --staged                 # Pre-commit check (used by hook)
unravel-local install-hook <dir>             # Install .git/hooks/pre-commit
unravel-local doctor                         # Health check: Ollama + models
unravel-local reembed <dir>                  # Re-embed KG/archive (nomic)
unravel-local global-sync                    # Merge patterns to ~/.unravel/
unravel-local assess-update <dir>            # Dependency update risk

# Cloud escalation (one-off):
UNRAVEL_PROVIDER=cloud \
ANTHROPIC_API_KEY=sk-... \
unravel-local debug <dir> "<symptom>"
```

---

## Part 4 — Implementation Roadmap

Divided into 4 phases. Each has a clear milestone that defines completion.

---

### PHASE 0 — Foundation (Week 1)
*Goal: Full 11-phase pipeline running locally. Identical quality to webapp, zero cloud dependency.*

**Step 1: Scaffold**
```bash
cp -r unravel-mcp unravel-local
cd unravel-local
# Delete: index.js (MCP server), helpers/ (MCP formatting)
# Update package.json: name, version, remove @modelcontextprotocol/sdk
```

**Step 2: Providers**
- Create `providers/ollama-embed.js` — nomic backend, all signatures from embedding.js
- Create `providers/ollama-llm.js` — chat + chatStreaming, Gemma 4 E4B
- Create `providers/provider-config.js` — UNRAVEL_PROVIDER router

**Step 3: Core adaptations**
- Copy `unravel-v3/src/core/config.js` → `core/config.js`  
  Add `'ollama'` branch to `_formatPrompt()`, keep all schema/phases
- Copy `unravel-mcp/core/orchestrate.js` → `core/orchestrate.js`  
  **Remove:** MCP short-circuit block (search `_mode === 'mcp'`)  
  **Remove:** CONSULT short-circuit block (search `_mode === 'consult'`)  
  **Replace:** `callProvider()` → `provider.chat()`  
  **Replace:** `embedding-browser.js` imports → `providers/ollama-embed.js`  
  **Replace:** IDB archive calls → fs-based archive (graph-storage.js pattern)  
  **Remove:** `embeddingApiKey` / `_embedKey` parameters (no key needed)  
  **Keep:** `learnFromDiagnosis()`, `verifyClaims()`, pattern store — unchanged

**Step 4: Modelfile**
- Write `Modelfile.unravel` with full baked system prompt (Spec 3 above)
- `ollama pull gemma4:e4b`
- `ollama pull nomic-embed-text`
- `ollama create unravel-gemma4 -f Modelfile.unravel`

**Step 5: scripts/health-check.js**
```javascript
// doctor command — verify everything is ready:
// 1. Ollama reachable at localhost:11434
// 2. unravel-gemma4 model exists
// 3. nomic-embed-text model exists
// 4. Test embed: "hello world" → 768-dim vector returned
// 5. Test chat: single token response
// Output: colored pass/fail per check
```

**Step 6: scripts/reembed-all.js**
```javascript
// Load existing .unravel/knowledge.json
// For every node with an embedding vector:
//   re-embed the node.summary via nomic
//   replace the vector
// Save back
// Same for diagnosis-archive.json
```

**Step 7: cli.js — basic commands only**
- `debug`, `explain`, `index`, `doctor`, `reembed`

**Step 8: First real run**
```bash
node cli.js doctor
node cli.js index ./validation/benchmark/packages/b-01-invisible-update
node cli.js debug ./validation/benchmark/packages/b-01-invisible-update \
  "timer shows wrong value after pause"
```
Compare output to known `unravel-mcp` diagnosis for the same bug.

**✅ PHASE 0 MILESTONE:** Full diagnosis produced locally, verify() PASSED, root cause matches known answer for b-01-invisible-update within acceptable quality threshold.

---

### PHASE 1 — Runtime Evidence Layer (Week 2–3)
*Goal: Hypotheses backed by actual execution, not just structural inference.*

**Step 1: `runtime/instrumenter.js`**
```javascript
// Input: astRaw mutation chain
// Output: instrumented copy of the file with console.log at each mutation site
// Key constraint: never modify original files — work on tmp/ copy
// Preserve line numbers so AST citations remain valid
```

**Step 2: `runtime/inspector.js`**
```javascript
// Node.js Inspector Protocol client
// Uses CDP (Chrome DevTools Protocol) via node --inspect
// API:
//   startProcess(entryFile, args) → session
//   setBreakpoint(session, file, line, condition)
//   captureCallStack(session)
//   evaluateAt(session, expression)
//   stopProcess(session)
```

**Step 3: `runtime/test-runner.js`**
```javascript
// Detect test runner: jest, vitest, mocha, node:test
// Run test suite: spawn child process, capture output
// Parse results: pass count, fail count, failing test names
// Apply fix to temp branch, re-run, compare results
```

**Step 4: Integrate into orchestrate.js as Phase 1r (Runtime)**
```javascript
// After Phase 1e (Pattern Hints):
// If UNRAVEL_RUNTIME=true and project has a start script:
//   a. Identify mutation sites from astRaw
//   b. Run instrumenter to inject logging
//   c. Run code with reproduction steps from symptom
//   d. Capture output
//   e. Inject as RUNTIME_VERIFIED block in astContext
// This block carries the same authority as AST_VERIFIED —
// the model cannot contradict actual measured values
```

**Step 5: Phase 5b — Fix Verification**
```javascript
// After verifyClaims() PASSED:
// If project has test suite:
//   1. Apply minimalFix to a git stash / temp branch
//   2. Run test-runner.js
//   3. Report: "47/47 tests pass" or "46/47 — regression in test X"
//   4. If regression: feed failure back to Ollama with same context
//      "Your fix broke test X. Revise minimalFix to address this."
//   5. Add fixVerification field to output
```

**✅ PHASE 1 MILESTONE:** For any bug with a reproduction script, Unravel shows RUNTIME_VERIFIED evidence alongside AST_VERIFIED. Fix proposals are empirically validated before presentation.

---

### PHASE 2 — Git Layer (Week 3–4)
*Goal: Every diagnosis knows its history. Every commit is analyzed structurally.*

**Step 1: `git/blame-enricher.js`**
```javascript
// For each KG node (function/variable):
//   git log --follow -p <file> | extract commit for line range
//   Add to node: { introducedAt, lastModified, modifiedBy, frequency }
//   Calculate riskScore: (bugAssociations * 3 + frequency * 0.5) / age
```

**Step 2: `git/bisect.js`**
```javascript
// Input: rootCause (file:line)
// Run: git log --follow -p <file> -- past 100 commits max
// Find: the commit where this line/pattern was introduced
// Output: introducedBy { commit, author, date, message, priorBehavior }
// Add to diagnosis output automatically when detect == PASSED
```

**Step 3: `git/semantic-differ.js`**
```javascript
// For a given diff (staged or between commits):
//   Run AST analysis on before+after versions of changed files
//   Compute semantic delta: new mutation sites, changed call edges, new async boundaries
//   Output: { newMutationSites[], removedCallEdges[], riskLevel, patternMatches[] }
```

**Step 4: `daemon/guard.js` + pre-commit hook**
```javascript
// guard --staged:
//   1. Get staged diff (git diff --cached)
//   2. Run semantic-differ on changed files
//   3. Cross-reference new mutation patterns vs pattern store
//   4. If match with confidence > 0.7: print block message + exit 1
//   5. else: exit 0

// install-hook command:
//   Write .git/hooks/pre-commit:
//   #!/bin/sh
//   unravel-local guard --staged
```

**Step 5: `git/pr-reporter.js`**
```javascript
// Generate structural report for a PR (branch diff vs main):
//   All new mutation sites with associated files
//   Pattern store matches with historical bug references
//   Risk score per file (from blame-enricher data)
//   Suggested review focus areas
// Output: markdown file suitable for PR description or CI comment
```

**✅ PHASE 2 MILESTONE:** Every new bug diagnosis automatically answers "when was this introduced and by whom." Pre-commit guard blocks at least one known-pattern commit on first real-project test.

---

### PHASE 3 — Live Intelligence Layer (Week 4–5)
*Goal: Proactive detection. Stop waiting for bug reports.*

**Step 1: `daemon/watch.js`**
```javascript
// unravel-local watch <dir>
// fs.watch(src, { recursive: true })
// On change:
//   1. Run AST analysis on changed file only (fast: <100ms)
//   2. Diff vs last-known AST state for this file
//   3. Check: any new mutation chain? new floating promise? new async boundary?
//   4. If yes: check invariant registry for violations
//   5. If invariant violation: send OS notification + console alert
//   6. If pattern store match (confidence > 0.8): send alert WITHOUT LLM call
//   7. If pattern store match (confidence 0.5-0.8): invoke Gemma for quick assessment
// Low resource: LLM only invoked when structurally suspicious
```

**Step 2: `daemon/invariant-checker.js`**
```javascript
// Load .unravel/invariants.json for project
// Each invariant: { id, rule, file, variable, allowedWriteSites[], algebraicConstraint }
// On AST diff: check if any invariant conditions are violated by new code
// Types:
//   Write-site invariant: "variable X may only be written at these lines"
//   Algebraic invariant: "total === sum(items) - discount" (check structure, not value)
//   Absence invariant: "forEach with async callback must not exist in this file"
```

**Step 3: `scripts/global-merge.js`**
```javascript
// Merge project patterns into global store:
// ~/.unravel/global-patterns.json
// ~/.unravel/global-archive.json
// 
// Merge strategy: patterns with confidence > 0.7 from any project
// go into global. Language-specific patterns (forEach async, closure capture)
// are shared. Project-specific patterns (domain logic) are filtered.
// Re-embed archive entries with nomic if not yet embedded.
```

**✅ PHASE 3 MILESTONE:** Watch daemon running on a real project for 48 hours. Reports at least one structural risk before it becomes a bug. Pre-commit guard has blocked at least one problematic commit.

---

### PHASE 4 — Multimodal Input (Week 5–6)
*Goal: Exploit Gemma 4 E4B's native multimodal capabilities.*

**Step 1: Screenshot input**
```javascript
// cli: unravel-local debug <dir> --screenshot <image.png> "<symptom>"
// Load image → base64
// Gemma 4 E4B accepts image in chat messages natively via Ollama:
// { role: 'user', content: [
//     { type: 'image', data: base64 },
//     { type: 'text', text: enginePrompt }
// ]}
// Model sees both the broken UI and the code — zero API cost
```

**Step 2: Audio input**
```javascript
// cli: unravel-local listen <dir>
// Record mic via node-record-lpcm16 or similar
// Pass audio to Gemma 4 E4B (natively multimodal)
// Extract: symptom string, temporal markers ("was working yesterday")
// Then run standard pipeline with extracted symptom
```

**Step 3: Screen recording frames**
```javascript
// cli: unravel-local debug <dir> --video <recording.mp4> "<symptom>"
// Extract key frames (ffmpeg) — UI state changes
// Pass frames to Gemma: show temporal UI evolution
// Model sees the bug HAPPENING, not just described
```

> **Note:** Image/audio/video input is only possible because we're running locally with Gemma 4 E4B. Cloud tools cannot read your screen recording. This is a fundamentally local capability.

**✅ PHASE 4 MILESTONE:** Screenshot-driven debugging works end-to-end on at least one real visual bug. nomic `embedImage()` gap is compensated by Gemma's own vision — visual route works differently but effectively.

---

### PHASE 5 — Learning Layer (Month 2–3)
*Goal: The engine starts improving itself.*

**Step 1: `learning/bias-tracker.js`**
```javascript
// Log every hypothesis-elimination event:
// { bugType, hypothesis, modelVerdict, astEvidence, verifyResult }
// After 50 sessions: compute bias statistics
// e.g., "30% rate of over-eliminating closure hypotheses on fresh-value evidence"
// 
// Auto-generate calibration block for Modelfile system prompt:
// "CALIBRATION: This engine has documented tendency to X in Y% of sessions.
//  Apply extra scrutiny to Z."
// Rebuild unravel-gemma4 model with updated SYSTEM block
```

**Step 2: `learning/distillation.js`**
```javascript
// Teacher-Student mode:
// UNRAVEL_TEACHER=cloud ANTHROPIC_API_KEY=... unravel-local debug <dir> "<symptom>"
// 
// Runs same bug through both local (Gemma) and cloud (Claude)
// Captures both results
// Delta analysis:
//   - Same root cause: + local confidence, no training example needed
//   - Different root cause: if cloud verified PASSED + local REJECTED → training example
//   - Cloud catches risk local missed: → Phase 7.5 example
// Save training examples to .unravel/training-data/
// Output: "Local caught this. Cloud also caught this. Agreement: 94%"
```

**Step 3: `learning/lora-prep.js`**
```javascript
// When .unravel/training-data/ has >= 50 examples:
// Generate lora-training-dataset.jsonl in Alpaca format:
// { "instruction": "<system_prompt>", "input": "<AST+files>", "output": "<diagnosis_json>" }
// 
// Instructions to user:
// "Run: python finetune.py --base gemma4:e4b --data lora-training-dataset.jsonl"
// After fine-tuning: ollama create unravel-gemma4-ft -f Modelfile.finetuned
// Update UNRAVEL_MODEL=unravel-gemma4-ft
```

**Step 4: `scripts/global-sync.js`** (enhanced)
```javascript
// Team intelligence via git:
// Commit .unravel/ to project repo
// When teammate pulls:
//   their install-hook runs on post-checkout
//   their pre-commit guard learns from your verified patterns
//   their watch daemon knows your invariants
// No server. No sync service. Just git.
```

**✅ PHASE 5 MILESTONE:** After 50 real sessions, bias-tracker identifies at least one measurable model tendency. Distillation mode running. LoRA training dataset exists and is valid.

---

## Part 5 — Quality Calibration

### Realistic Quality by Bug Complexity

| Bug Type | Day 1 | After 30 Sessions | After 100 Sessions + LoRA |
|---|---|---|---|
| Single-file mutation chain | 85–90% of Sonnet | 90–93% | 95%+ |
| Multi-file async race | 65–75% | 78–85% | 88%+ |
| Novel pattern (no archive) | 55–65% | 70–78% | 82%+ |
| Archive match (same pattern) | 88–92% | 92–95% | 96%+ |
| Environment/dep issue | 70% | 82% (env scanner) | 88% |

The quality floor is set by the AST engine (deterministic), not the model size. Every constraint on reasoning is one less place a small model can fail.

### The Compound Curve

```
Quality
  │
  │                                          ··· (LoRA fine-tuned)
  │                              ············
  │                   ···········  (global patterns active)
  │         ··········   (archive builds up)
  │ ·········  (pattern store learns)
  │·  (Day 1 baseline)
  └──────────────────────────────────────────────────────── Sessions
     1   10   30   50   100  200  500
```

Cloud tools are flat on this chart. They start high and stay there. `unravel-local` starts lower and crosses over somewhere between 30–100 sessions depending on project complexity — **after which the local system consistently outperforms the cloud on YOUR specific project.**

---

## Part 6 — The North Star (Month 6+)

After all phases are built and 6 months of real use have accumulated on a production codebase:

```
A developer writes code
  → Watch daemon detects structural change       (real-time, <100ms)
  → Invariant checker flags violation            (instant, no LLM)
  → Developer investigates with screenshot       (Gemma 4 multimodal)
  → Full pipeline: AST + runtime + git history   (empirical evidence)
  → Diagnosis with verified root cause           (11-phase)
  → Fix verified by running tests                (automated)
  → Regression test synthesized + committed      (permanent memory)
  → Pattern store updated from diagnosis         (learning)
  → Invariant updated from Phase 8               (prevention)
  → Commit analyzed structurally                 (git layer)
  → Pre-commit guard validates the fix commit    (prevention)
  → PR structural report generated               (team context)
  → Teammate pulls and inherits new patterns     (git-native propagation)
  → Model is slightly better at this bug class  (calibration)
```

This is not reactive bug-fixing. It is a **self-improving immune system for a codebase**.

---

## Part 7 — Build Priority Summary

| Priority | What | Phase | Why First |
|---|---|---|---|
| 🔴 Critical | Foundation: providers + orchestrate adaptation + CLI | 0 | Nothing else works without this |
| 🔴 Critical | Modelfile.unravel + first real benchmark run | 0 | Validates quality before building more |
| 🟠 High | Runtime instrumentation + fix verification | 1 | Biggest quality lift; makes small model viable |
| 🟠 High | Pre-commit guard | 2 | Most commercially valuable; single best demo |
| 🟡 Medium | Watch daemon + invariant checker | 3 | Shifts from reactive to proactive |
| 🟡 Medium | Auto bisect | 2 | High wow factor, low engineering cost |
| 🟢 Later | Multimodal input | 4 | Differentiator; needs Phase 0 stable first |
| 🟢 Later | Bias tracker + distillation | 5 | Needs session history to work |
| 🔵 Future | LoRA fine-tuning pipeline | 5+ | Needs 50+ verified diagnoses |
| 🔵 Future | Full team git sync | 5+ | Needs stable per-project foundation |

---

## One Sentence

> **`unravel-local` is the system that makes a 4.5B-parameter model running on a laptop know more about your specific codebase than a 70B frontier model that's never seen it — by accumulating 6 months of verified structural intelligence that compounds with every session.**
