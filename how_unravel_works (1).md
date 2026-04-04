# How Unravel Works — Complete Source-Verified Explainer
*Source-verified against all 18 files in unravel-v3/src/core/. MCP path and web-app path documented separately. Last updated 2026-04-03: Oracle V2.x — Consult tool documented; JSDoc/TSDoc KG enrichment added; five zero-cost intelligence layers (Git context, human-written context files, dependency manifest, readiness score, JSDoc extraction) source-verified and documented.*

---

## The Three Layers of Instructions

Unravel talks to the agent in 3 distinct ways. You need to understand all 3 to understand what the agent actually knows at any moment.

---

## Layer 1 — Static Server Description (Sent Once on Connect)

When the agent connects to Unravel, the SDK immediately sends a server description block. **This is sent ONCE and permanently lives in the agent's context for the entire session.** The agent does NOT need to call any tool for this — it arrives automatically.

This block contains:

### 1a. What Unravel Is
> "Unravel is a deterministic bug-diagnosis engine. It uses static AST analysis to extract verified structural facts from code — mutation chains, closure captures, async boundaries, race conditions — and returns them as ground truth that cannot be hallucinated."

### 1b. The Sandwich Protocol (3 layers)
```
1. BASE (Evidence):   analyze() → AST facts
2. FILLING (Reason):  Agent reasons through 11-phase pipeline
3. TOP (Verify):      verify() → claims checked against real code
```

### 1c. The Full 11-Phase Pipeline (key phases spelled out)
The agent gets ALL of this in the static description:

- **Phase 3 (Hypothesis Generation):**
  Generate exactly 3 mutually exclusive competing hypotheses. Distinct root mechanisms — NOT variations of same idea. State `falsifiableIf[]` for each.
  EXCEPTION: trivially obvious bug (missing semicolon, typo) = 1 hypothesis only — but MUST state "trivially obvious because: [sentence]". Without that sentence, the exception does not apply.

- **Phase 3.5 (Hypothesis Expansion):**  
  Runs AFTER Phase 4 reveals the full dependency map. Add **at most +2 new hypotheses** if cross-file mechanisms were invisible before.  
  **Hypothesis space CLOSES permanently after Phase 3.5. No new hypotheses after this.**

- **Phase 4 (Evidence Map):**  
  Per hypothesis: `supporting[]`, `contradicting[]`, `missing[]`, verdict: `SUPPORTED / CONTESTED / UNVERIFIABLE / SPECULATIVE`

- **Phase 5 (Hypothesis Elimination):**  
  Every eliminated hypothesis MUST cite the exact code fragment (file + line) that kills it.

- **Phase 5.5 (Adversarial Confirmation):**  
  PRE-CHECK FIRST: list all ⛔ annotations — these are off-limits for adversarial disproof. Do NOT argue against them using browser speculation or absence of tests.
  For each surviving hypothesis: actively try to disprove it.
  If adversarial kills it → re-enter Phase 3.5 to add a replacement (max 2 re-entry rounds total).
  If 2+ survive all attacks: `multipleHypothesesSurvived: true` — do NOT force a single winner.

- **Phases 8+8.5 (Invariants + Fix-Invariant Check):**  
  State invariants. Check fix satisfies every invariant. Revise once if violated.

### 1d. Hard Gates (pre-read before calling verify)
- **HYPOTHESIS_GATE:** `hypotheses[]` must be non-empty — verify() rejects immediately with `PROTOCOL_VIOLATION` if absent
- **EVIDENCE_CITATION_GATE:** `rootCause` must contain at least one `file:line` citation — rejected if missing

### 1e. Decision Flowchart
```
User reports bug →
  Know the files? → analyze(files[], symptom)
  Small repo (<30 files)? → analyze(directory, symptom)
  Large repo, no screenshot? → build_map(directory) → query_graph(symptom) → analyze(files, symptom)
  Have a screenshot? → build_map(directory) → query_visual(image, symptom) → analyze(files, symptom)
  → Read _instructions in analyze response (phases 3-8.5)
  → verify(rootCause, evidence, codeLocation, fix, hypotheses)
  → If PASSED: present fix. If REJECTED: revise + re-verify.
```

### 1f. Extended Capabilities (agent is told to use its own tools)
The agent is explicitly told when to use web search:
- Latest version of a dependency (never assume package.json is current)
- API changed recently and code uses deprecated pattern
- Cryptic error message → search known issues before hypothesizing
- Official documentation for specific function signatures
- Stuck after ambiguous evidence → search prior art, known bugs, CVEs

And when to run scripts:
- Minimal reproduction to test a hypothesis
- Run test suite after proposing fix to confirm no regressions
- Inspect actual runtime values (static gives structure, runtime gives values)
- Confirm fix compiles correctly before claiming it's correct

### 1g. Task Codex Instructions (agent is told to write structured reading notes)

This is the **largest section** of the static server description — the complete Task Codex protocol. The agent receives all of this on connect, before any tool call. Source: `index.js:L385-458`.

**The problem it solves (agent is told this verbatim):**
> "When you read 4+ files in a single session, earlier files decay into vague impressions. By file 5, the specific line number and invariant you found in file 1 is gone. You are making edits using summaries of summaries. The Task Codex is the fix."

**When to create (agent is told explicitly):**
- Task touches 3+ files
- Session will last longer than ~30 minutes
- About to read a large file (1000+ lines) to find one specific thing
- Do NOT create for: single-file fixes, trivial typos, tasks where you already know the exact line

**How to start:**
1. Check if `query_graph` returned a `pre_briefing` — if YES, read it BEFORE opening any source file. Go directly to the specific lines it cites.
2. If no pre_briefing: create `.unravel/codex/codex-{taskId}.md`, write `## Meta` immediately.

**The 4 valid entry types (ONLY these 4 — no generic file summaries):**

| Type | Marker | Write when |
|---|---|---|
| **BOUNDARY** | `→ BOUNDARY: NOT relevant. X happens at [place]` | Section doesn't have what you need — ruling out is as valuable as finding |
| **DECISION** | `→ DECISION: L[N] specifically does X, confirmed` | You found exactly what you were looking for — pin the line |
| **CONNECTION** | `→ CONNECTION: links to [file/fn] because...` | Cross-file or cross-section dependency, confirmed or suspected |
| **CORRECTION** | `→ CORRECTION: earlier note was wrong. Actually Y` | Reading more context disproves a note you already wrote |

**Wrong vs. right (agent is given this exact example):**
```
❌ "L1–L300 handles parser setup and AST initialization."
   This is a description. Tells future sessions nothing actionable.

✅ "Looking for mutation detection → L1–L300 does NOT have it.
   BOUNDARY. collectLoopNodes() at L214 is preprocessing only.
   Detection starts after fnBodyMap at L248."
```

**Two-phase writing model:**
- **Phase 1 — During task:** Append-only. Do NOT organize. Write immediately after each file read, while hot. Use `?` markers for uncertainty. Write EDIT LOG entry immediately after each edit — NOT at the end.
- **Phase 2 — At task end (~5 min, once):** Restructure into: `TLDR (3 lines max) → ## Discoveries → ## Edits → ## Meta`. Write TLDR last.

**Layer 4 is MANDATORY in the end restructure:**
Add `## Layer 4 — What to skip next time`. List every file/section read that turned out irrelevant. Example: `"ast-engine-ts.js L1–L200: parser init only, zero relevance to MCP instruction tasks. Skip."`
This is the most underrated section — a confirmed irrelevance saves every future session the same wasted reading time.

**EDIT LOG format (Reason field is mandatory):**
```
**file.ts:47** — replaced forEach(async) with await Promise.all() | Reason: forEach discards promise returns
```
The Reason field is mandatory. Future sessions need to know WHY it changed to avoid accidentally reverting it.

**File format (must match exactly — `searchCodex()` parses these headings):**
```
## TLDR
[3 lines max. What was wrong, what was fixed, where source of truth lives.]

## Discoveries
### filename.ts
Discovery context: looking for [specific thing]
- L47 → DECISION: forEach(async (item) => charge(item)) — confirmed bug site.
- L1–L80 → BOUNDARY: NOT relevant to payment logic. Skip for any payment task.

## Edits
1. **PaymentService.ts:47** — replaced forEach(async) with await Promise.all() | Reason: forEach discards promise returns

## Meta
Problem: Silent payment failure for duplicate cart items
Tags: async, promise, payment, cart
Files touched: PaymentService.ts, CartRouter.ts
Files read but NOT edited: OrderItem.ts (read to understand call chain, no changes needed)
```

**At end of task — update the index:**
Append one row to `.unravel/codex/codex-index.md`:
```
| payment-fix-001 | Silent payment failure for duplicate cart items | async, promise, cart, payment | 2026-03-28 |
```
This makes the codex searchable by future `query_graph` calls — they will find it and inject it as `pre_briefing` automatically.

**SUPERSEDES rule (staleness handling):**
If a past codex discovery is now wrong (code refactored), add `## Supersedes` to the new codex:
```
SUPERSEDES: codex-payment-fix-001, Discovery at PaymentService.ts L47.
Was: forEach(async). Now: refactored to processQueue() at L89.
```

**Verify-on-use principle:**
Codex tells you WHERE to look, not WHAT is true. Before citing a discovery in `verify()`, always confirm the actual line still matches. Same principle as `verify()` itself — accelerate, do not substitute.

**What NOT to do (agent is told explicitly):**
- Do NOT auto-generate discoveries from a file summary — discoveries must be earned by reading
- Do NOT write a codex for every file read — only what connects to the task goal
- Do NOT write a full-codebase summary — task-scope is the entire point

---

## Layer 2 — Per-Call Instructions (Returned from analyze())

Every `analyze()` call returns a 5-key JSON object. The agent is told to read `critical_signal` first and stop when sufficient. Here is **exactly** what each key contains:

### Key 1: `critical_signal`

The agent reads this first. Contains:

**§A — Reading Guide (5 lines):**
```
critical_signal  — START HERE. AST evidence, pattern hints. Usually sufficient.
protocol         — Phase reminders + verify() field list. Read when composing verify call.
cross_file_graph — Call graph + symbol origins. Read if cross-file chains are ambiguous.
raw_ast_data     — Full structured JSON. Read only for deep investigation.
metadata         — Engine version, timestamps. Skip unless debugging the engine.
```

**§B — AST Evidence Block (the `contextFormatted` text):**
The raw formatted AST analysis. What it contains depends on what detectors fired:
- Global write races (mutable shared variables written across function scopes)
- Constructor captures (closures capturing constructor args/fields)
- Stale module captures (module-level variables initialized once from changing function)
- Floating promises (`forEach(async ...)`, unawaited calls) — detected via `findTimingNodes` + async boundary detectors in `ast-engine-ts.js`
- Cross-file mutation chains: exact file + line of every write, read, and display — sourced from `ast-project.js:expandMutationChains`
- Cross-file call graph edges (MCP path only) — `ast-project.js:buildCallGraph` using native tree-sitter; **not** the regex fallback `ast-bridge.js` which always emits `calls: []`

> [!NOTE]
> **Three parsers, three behaviors for call edges:** (1) `ast-engine-ts.js` (native tree-sitter, MCP path) — **produces real call edges**. (2) `ast-bridge-browser.js` (WASM, browser path) — **produces real call edges** via `extractCalls()`. (3) `ast-bridge.js` (pure regex, Node.js fallback) — **`calls: []` always empty**. Only the regex fallback is empty. The web app and MCP both get genuine call data.
- ⛔ annotations on deterministic spec facts (off-limits for adversarial disproof)

> [!NOTE]
> **`unawaited_promise` risk signal is LIVE as of 2026-03-28.** `ast-engine-ts.js:L907` now sets `isAwaited: isAwaited(call)` on every timing node. `ast-project.js:emitRiskSignals` gates on `t.isAwaited !== false` and fires on any unawaited call to async-producing APIs (`fetch`, `axios`, `readFile`, `query`, `save`, etc.). `setTimeout`/`setInterval`/`addEventListener` are excluded — intentional fire-and-forget. Floating promise detection runs via BOTH the dedicated AST detector in `ast-engine-ts.js` AND the cross-file risk signal in `ast-project.js`.

**§C — Pattern Hints (only if patterns matched with confidence ≥ 0.7):**
```
Pattern Hints (treat highest-confidence as H1):
  [floating_promise]  confidence=0.95  hitCount=4
  → This analysis matches a known floating-promise pattern (confirmed 4 times, confidence 95%).
    Treat this as H1 in your hypothesis tree unless AST evidence contradicts it.
```
These come from `.unravel/patterns.json` — structural patterns learned from every past `verify(PASSED)` call in THIS project. More bugs fixed = higher confidence, higher hit count.

> [!NOTE]
> **Match threshold is 0.7 (70% token coverage required).** This means a pattern's signature tokens must be ≥70% present in the extracted events for it to appear as a hint. Before 2026-03-28 this was 0.6, which allowed partial matches (e.g. 2/3 tokens) to fire on legitimate utility code like `debounce`. Raised to prevent false positives from closure-local timer variables.

**§D — ⚡ Semantic Archive Hits (only if ≥75% cosine match found):**
```
Semantic Archive Hits (past verified diagnoses — treat as H1):
  ⚡ 78% match  [diag-1774624507804]  2026-03-27
  → ⚡ SEMANTIC ARCHIVE (78% match): Past verified diagnosis —
    "PluginManager.ts:16 — buildRegistry uses forEach(async)..."
    at PluginManager.ts:16. Treat as strong H1 if consistent with AST evidence above.
```
These come from `.unravel/diagnosis-archive.json` — diagnoses from past `verify(PASSED)` calls embedded as 768-dim vectors, searched by cosine similarity against the new symptom. Zero keyword overlap needed — semantic meaning carries it.

**§E — STATIC_BLIND Verdict (only if zero detectors fired + zero pattern matches):**
```
⚠️  VERDICT: STATIC_BLIND
No structural bugs found. Zero detectors fired, zero pattern matches.
Possible causes outside static analysis scope:
  - Environment configuration
  - Runtime data (database state, API responses)
  - Third-party service behavior
  - Timing/deployment issues
Unravel cannot diagnose these. Investigate environment and runtime next.
If you believe there IS a structural bug, try:
  1. A more specific symptom description
  2. Including additional files
  3. Running analyze(detail:'full') for unfiltered output
```

### Key 2: `protocol`

Contains the **per-call** `_instructions` block from `orchestrate.js:MCP_REASONING_PROTOCOL`:

```
NOTE: The full 11-phase protocol is in the server description. Key phases agents skip:
  Phase 3:   HYPOTHESIS GENERATION — exactly 3 mutually exclusive hypotheses, distinct mechanisms.
  Phase 3.5: HYPOTHESIS EXPANSION — after Phase 4. At most +2 new hypotheses. Space CLOSES here.
  Phase 5.5: ADVERSARIAL CONFIRMATION — list ⛔ first. Re-enter Phase 3.5 if adversarial kills (max 2 rounds).
  Quality:   Rate each hypothesis STRONG (≥2 AST citations) | WEAK (1 citation) | DEFAULT (survived by elimination, cap confidence 0.75)

Hard Gates (verify rejects immediately if violated):
  [HYPOTHESIS_GATE]       hypotheses[] MUST be present and non-empty.
  [EVIDENCE_CITATION_GATE] rootCause MUST contain file:line citation.

requiredFields for verify():
  rootCause:    must contain file:line citation
  codeLocation: filename:lineNumber
  evidence:     array of verifiable literal strings from file content
  minimalFix:   proposed fix
  hypotheses:   array of all hypotheses from Phase 3 — REQUIRED
```

The `protocol` key also lists **VERIFIED_BY_ENGINE** (what `verify()` actually checks) vs **BEST_EFFORT_GUIDANCE** (what it doesn't):
- VERIFIED: `rootCause`, `codeLocation`, `evidence[]`, `minimalFix`, `hypothesisTree` line citations
- NOT VERIFIED (but required): `conceptExtraction`, `relatedRisks`, `adversarialCheck`, `fixInvariantViolations`

### Key 3: `cross_file_graph`

```
Call Graph:
  CartRouter.ts → PaymentService.ts:charge()  L47
  PaymentService.ts → OrderItem.ts:getTotal()  L23

Symbol Origins (who imports what from where):
  charge [PaymentService.ts:47]  ←  imported by: CartRouter.ts
```

### Key 4: `raw_ast_data`

In `standard`/`priority` mode:
```
Raw data omitted in standard mode — call analyze(detail:'full') to include.
Size if included: ~38KB.
```
In `full` mode: the complete JSON payload with all AST fields preserved including the full `mutations` dictionary.

### Key 5: `metadata`

```
  engineVersion:     3.3
  crossFileAnalysis: true
  patternsChecked:   20   patternMatchCount: 1
  mutationsKept:     4    mutationsSuppressed: 12
  filesAnalyzed:     CartRouter.ts, PaymentService.ts, OrderItem.ts
  timestamp:         2026-03-28T01:30:00.000Z
```

---

## Layer 3 — verify() Response (After Agent Reasons)

The agent sends its complete diagnosis. Here is the **exact input it provides**:

```json
{
  "rootCause": "PaymentService.ts:47 — forEach(async (item) => charge(item)) discards all Promises",
  "codeLocation": "PaymentService.ts:47",
  "evidence": [
    "PaymentService.ts L47: processDuplicates.forEach(async (item) => charge(item))",
    "CartRouter.ts L23: await processPayment(cart)"
  ],
  "minimalFix": "Replace with: await Promise.all(processDuplicates.map(async (item) => charge(item)))",
  "hypotheses": [
    "H1: floating promise — forEach(async) discards charge() promises",
    "H2: race condition — shared cartState written from multiple handlers",
    "H3: deduplication logic silently drops items before payment"
  ],
  "files": []  // optional — if omitted, uses session.files from last analyze()
}
```

**Gate 1 — HYPOTHESIS_GATE:** Are `hypotheses[]` present and non-empty?  
**Gate 2 — EVIDENCE_CITATION_GATE:** Does `rootCause` match regex `/[\w.\-/]+\.(js|jsx|ts|tsx|py|...)[\sL:]\d+/i`?

Both gates fire BEFORE any claim is checked. If either fails:
```json
{
  "verdict": "PROTOCOL_VIOLATION",
  "gate": "HYPOTHESIS_GATE",
  "summary": "Phase 3 skipped. Generate hypotheses first.",
  "remediation": "Add hypotheses: [\"H1...\", \"H2...\", \"H3...\"] to verify call."
}
```

If both pass, `verifyClaims()` runs — checks every literal string in `evidence[]` exists in actual file content:
```json
{
  "verdict": "PASSED",
  "allClaimsPassed": true,
  "failures": [],
  "summary": "All claims verified against actual code."
}
```
Or:
```json
{
  "verdict": "REJECTED",
  "failures": [{ "claim": "PaymentService.ts L47: ...", "reason": "Literal not found at line 47" }]
}
```

**On PASSED — four things happen automatically:**
1. `learnFromDiagnosis()` updates `.unravel/patterns.json` — bumps weight +0.05 for all matched patterns
2. `archiveDiagnosis()` embeds the full diagnosis (symptom + rootCause + evidence) as a 768-dim vector and writes to `.unravel/diagnosis-archive.json`
3. The new archive entry is pushed into `session.diagnosisArchive` immediately — the very next `analyze()` call can find it without restarting the MCP server
4. **`autoSeedCodex()` (§5c-4, 2026-04-01):** Parses `rootCause` and `evidence[]` for `file:line` citations and auto-writes a minimal codex entry to `.unravel/codex/codex-auto-{timestamp}.md` + appends a row to `codex-index.md` (bootstrapping it if missing). This makes `searchCodex()` in `query_graph` immediately useful — no agent discipline required for the codex to start producing `pre_briefing` results. Entries contain only DECISION markers sourced from verified evidence (no LLM generation). Non-fatal: any write error is logged to stderr and does not affect the verify response.

> [!NOTE]
> **Archive gate (2026-03-31):** The write condition is `!rootCauseRejected` — NOT `failures.length === 0`. TypeScript-specific variable tracking (e.g. `this.registry` in class properties) consistently produces 1 soft failure due to an AST coverage gap, not a logic error. Blocking on `failures.length === 0` was silently preventing every TypeScript diagnosis from being archived. The distinction: `rootCauseRejected = true` means the root cause references non-existent code — real failure, do not archive. Soft failures mean an AST coverage miss — diagnosis is still correct, archive it. End-to-end archive write + recall verified 2026-03-31 (b-07-ghost-ref: run 1 saves, run 2 recalls with `archive size=1`, pattern weight self-calibrates 75% → 80%).

**On REJECTED — one thing happens automatically:**
- `penalizePattern()` decays matched pattern weights by -0.03 per rejection (floor: 0.3). Decay rate is less than the bump rate (+0.05) so ~1.5x as many rejections as confirmations are needed to suppress a pattern. Patterns are never fully removed from the store.

> [!NOTE]
> **Pattern learning after T1–T8 validation (2026-03-28):** The following patterns have confirmed `hitCount ≥ 1` from real verify(PASSED) cycles in the unravel-mcp project itself: `race_condition_write_await_read` (confidence=1.0), `global_write_race` (0.95), `floating_promise` (0.78), `stale_closure_async_delay` (0.9 — newly live as of 2026-03-28, was dead because `stale_var_access` token was never emitted). `stale_var_access` is now emitted in `extractSignature()` when: closures non-empty + globalWriteRaces non-empty + `async_delay` in events (setTimeout/setInterval only, NOT fetch). This triple guard correctly excludes `debounce`/`throttle` utilities.

---

## Complete Tool Reference

### `analyze` — All Inputs

| Param | Type | Required | Description |
|---|---|---|---|
| `symptom` | string | **YES** | Bug description or error message |
| `files` | `{name, content}[]` | No | Explicit file list. If omitted: uses `directory` or session cache |
| `directory` | string | No | Path to project root — reads all source files automatically |
| `detail` | `'standard'` \| `'priority'` \| `'full'` | No | Output verbosity. Default: `'standard'` (~200 lines). `'priority'`: ~50 lines (confirmed critical only). `'full'`: complete unfiltered JSON |

**Session cache behavior:** If `files` and `directory` are both omitted AND session has files from a previous call, those are reused automatically.

**Cache behavior (Phase 3c):** If same `symptom + detail + filenames` is called again within the same session, returns cached result instantly. Saves full orchestrate cost (~1-2s) on re-calls after failed verify.

---

### `verify` — All Inputs

| Param | Type | Required | Description |
|---|---|---|---|
| `rootCause` | string | **YES** | Must contain `file:line` citation |
| `hypotheses` | string[] | **YES** (gate) | All hypotheses from Phase 3 |
| `evidence` | string[] | No | Literal strings from file content |
| `codeLocation` | string | No | `filename:lineNumber` |
| `minimalFix` | string | No | Proposed fix |
| `diffBlock` | string | No | Unified diff of the proposed fix. Enables Check 6 (Fix Completeness) — detects when a changed function signature has callers in other files that are now broken |
| `files` | `{name, content}[]` | No | Override verification files. Default: session files from last analyze |

**Reliability notes (2026-03-30):**

**Symptom whitelisting:** `session.lastSymptom` (stored during `analyze()`) is passed to `verifyClaims()`. Files mentioned in the original error/stack trace are pre-indexed as a whitelist — the verifier never penalizes evidence strings that reference them. This prevents "hallucination-by-omission" where a file cited in the original error was being incorrectly flagged as fabricated.

**Solvability probe on failure:** If a diagnosis is REJECTED or FAILED, the MCP engine now calls `checkSolvability()` and returns a `layer_boundary` field in the response explaining why a fix isn't possible from within the codebase (e.g. the root cause is in the OS, browser event layer, or an external API). This is the MCP equivalent of Phase 5.5 in the web app.

```json
{
  "verdict": "REJECTED",
  "layer_boundary": {
    "detected": true,
    "reason": "Root cause is in the browser keyboard event layer — outside the provided codebase.",
    "confidence": 0.80
  }
}
```

---

---

### `consult` — All Inputs

> **The Project Oracle.** Unlike `analyze` (which needs files and a bug), `consult` takes only a plain-language question and returns a self-contained evidence packet — KG topology, AST facts, cross-file call graph, memory layers, and a structured reasoning mandate — in one call. Used for architecture questions, data-flow analysis, feasibility, and codebase understanding.

| Param | Type | Required | Description |
|---|---|---|---|
| `query` | string | **YES** | Plain-language question — architecture, data flow, feasibility, impact |
| `directory` | string | No | Project root. Required on first call. Omit to reuse from prior call |
| `include` | string[] | No | Specific paths/folders to analyze. **Bypasses KG routing entirely.** Takes precedence over `maxFiles` |
| `exclude` | string[] | No | Paths to skip during cold KG build. Ignored if KG already exists |
| `maxFiles` | number | No | Max files to route via KG (default: 12). Ignored if `include` is provided |
| `detail` | `'standard'` \| `'full'` | No | AST verbosity. Default: `'standard'` |

**Auto-builds KG on first call** if none exists (~15-30s, one-time). Every subsequent call is instant (incremental staleness check).

**What §0 contains (Oracle Scholar Model intelligence layers — all zero-cost):**

| Layer | Source | Trust |
|---|---|---|
| **Readiness Score** | Computed from KG node/embedding/AST counts | Deterministic |
| **Dependency Manifest** | `package.json` / `requirements.txt` / `go.mod` | HIGH — direct file read |
| **Git Context** | Live `git log` / `git diff`, cached per HEAD | HIGH — deterministic |
| **Context Files** | `README.md`, `CHANGELOG.md`, `ARCHITECTURE.md`, `how-*.md`, `.unravel/context.json` | MEDIUM/HIGH — human-authored |
| **JSDoc/TSDoc** | Regex scan of raw file source (compiled into KG node `fileSummary`) | MEDIUM — regex |

**`include` vs `maxFiles`:**
- `include: ["src/core"]` — only those files/folders are analyzed. KG routing is completely bypassed. Works like a scalpel.
- `maxFiles: 20` — KG routes semantically and picks the top N files. Works like a search.
- Both can coexist: `include` wins if both are set.

**Human-written context files (`.unravel/context.json`):**
You can tell `consult` which files to always inject into its context by creating this file:
```json
{
  "include": ["how_unravel_works.md", "docs/architecture.md"],
  "trust": { "how_unravel_works.md": "high" },
  "maxCharsPerFile": 8000
}
```
This is the recommended way to give `consult` your own architectural documents, ADRs, or runbooks.

**Reasoning Mandate — query type classification:**
Every response includes a classified reasoning directive under `intelligence_brief`:
- `FACTUAL` — "answer directly, cite exact file:line from structural_evidence"
- `ANALYTICAL` — "think step by step, trace through project_context call graph"
- `FEASIBILITY` — "map every file that must change, identify invariants"

**What it returns (The Scholar Model output):**
```json
{
  "intelligence_brief": {
    "project_overview": "Architecture mental model: goals, dependencies...",
    "structural_scope": "KG routing: what is in scope for this query",
    "readiness_score": "3/3 core + 1/2 memory",
    "reasoning_mandate": "Analytical step-by-step trace..."
  },
  "structural_evidence": {
    "ast_facts": "Verified AST analysis of routed files",
    "critical_snippets": "Inline source for AST-flagged sites (no view_file needed)"
  },
  "project_context": {
    "cross_file_graph": "Call graph, symbol origins, import chains"
  },
  "memory": {
    "codex_discoveries": "Prior task context",
    "diagnosis_archive": "Verified fixes matching this query"
  }
}
```

---

### `build_map` — All Inputs

| Param | Type | Required | Description |
|---|---|---|---|
| `directory` | string | **YES** | Project root path |
| `embeddings` | `true` \| `false` \| `'all'` | No | `true` (default): embed top-50 hub nodes by edge count (~5-8s). `'all'`: embed every connected node (slower, complete coverage). `false`: structural KG only, no API calls |
| `exclude` | string[] | No | Paths to skip — relative to project root or substrings. E.g. `["src/generated", "vendor/legacy"]` |

**What it skips automatically (always):** `node_modules`, `.git`, `dist`, `build`, `.next`, `__pycache__`, `coverage`, `.unravel`, `.vscode`, `.idea`. Also: test files (`.test.ts`, `.spec.js`, files in `__tests__/`, `spec/`, `mocks/`, `fixtures/`), files >500KB.

**Import resolution and the AMBIGUOUS_STEMS heuristic:** When `ast-bridge.js` resolves cross-file import paths, it skips imports whose stem matches any of: `index, types, utils, helpers, constants, common, shared, base, config, main, core, hooks, styles, theme, api, model, models, service, services`. If an import resolves to one of these names ambiguously (multiple files could match), it returns `null` rather than linking the wrong file. This is intentional — you may see fewer KG cross-file edges for files with these common names, not a bug.

**What it returns:**
```json
{
  "status": "ok",
  "incremental": false,
  "durationMs": 31200,
  "stats": { "filesIndexed": 487, "nodes": 623, "edges": 2104, "callEdges": 891 },
  "summary": "Knowledge Graph built: 487 files, 623 nodes..."
}
```

> [!NOTE]
> **Build metadata persistence (2026-03-30):** `saveMeta()` is now wired into both full and incremental `build_map` paths. `meta.json` is written alongside `knowledge.json` in `.unravel/`, persisting build mode, node counts, and timestamps across MCP server restarts.

**Incremental mode (automatic):** If `.unravel/knowledge.json` already exists:
- Computes SHA-256 hash of every file
- Compares against stored hashes
- ≤30% changed → incremental patch (fast, ~2-3s). Only changed nodes re-analyzed + re-embedded
- >30% changed → full rebuild
- 0 changed → returns cached graph in <100ms

**What gets embedded:**
- Default (`embeddings: true`): top-50 nodes by edge count (most-connected hubs first). Remaining nodes: keyword routing only
- `embeddings: 'all'`: every connected node (nodes with ≥1 import/call edge). Isolated leaf nodes without any edges are not embedded even in 'all' mode (they have no meaningful relationship text to embed)
- `embeddings: false`: no embedding at all

**Codex attachment (Phase 5c-2):** After building the graph, `build_map` scans `.unravel/codex/codex-index.md`. For each codex whose Discoveries section mentions a file in the KG, that discovery excerpt is attached as `node.codexHints` on the KG node. This means `query_graph`'s results carry prior debugging session memory automatically.

**KG Node Summaries (Oracle V2.2 — JSDoc/TSDoc Extraction):**
During indexing, `extractJsDocSummary(content)` runs a zero-cost regex pass over each file's raw source. The first meaningful `/** ... */` block or `//` comment above a top-level declaration (≤150 chars, `@param`/`@returns` stripped) is prepended to the heuristic role string in `node.fileSummary`:
```
"Unravel's semantic embedding layer — Semantic layer: embeddings + search. Key: embedText, embedImage."
```
This enrichment is visible in `consult`'s §1 out-of-scope list, giving the LLM human-authored descriptions of files outside the 12-file AST window.

---


### `query_graph` — All Inputs

| Param | Type | Required | Description |
|---|---|---|---|
| `symptom` | string | **YES** | Bug description |
| `directory` | string | No | Project root. If omitted: uses `session.projectRoot` from last `build_map` |
| `maxResults` | number | No | Max files to return. Default: 12 |

**What happens inside:**
1. Checks `session.graph`. If missing, tries loading from `projectRoot/.unravel/knowledge.json`
2. If `GEMINI_API_KEY` set AND nodes have embeddings: embeds symptom as `RETRIEVAL_QUERY`, computes cosine against all embedded nodes → `semanticScores` Map
3. **Pattern-aware KG routing (§2.1, 2026-03-30):** `matchPatterns(session.astRaw)` → `getNodeBoosts()` boosts files associated with matched structural patterns. Merged into `semanticScores` via `Math.max`. MCP and webapp now have parity on this.
4. `queryGraphForFiles(graph, symptom, maxResults, semanticScores)`:
   - Keyword matching: file/function names, tags
   - Semantic scores: cosine bonus for embedded nodes
   - `expandWeighted()`: boosts neighbors of top matches (+0.4 × similarity hop)
4. Searches `.unravel/codex/` via `searchCodex()`:
   - Keyword match against codex tags and problem text (stopword-filtered)
   - If `GEMINI_API_KEY` set: embed codex entries + symptom → semantic re-rank (35% keyword + 45% semantic + 20% recency blend)
   - Keyword-only fallback: 80% keyword score + 20% recency score (recency as tiebreaker)
   - Recency: 30-day half-life decay (`1 / (1 + daysSince / 30)`). Undated entries get neutral 0.5.
   - Returns top-3 matching codex entries
5. Assembles response

**Response — no codex match:**
```json
{
  "symptom": "...",
  "relevantFiles": ["CartRouter.ts", "PaymentService.ts", ...],
  "fileCount": 12,
  "suggestion": "Read these 12 files and pass them to 'analyze' along with the symptom."
}
```

**Response — codex match found:**
```json
{
  "relevantFiles": [...],
  "pre_briefing": {
    "note": "Prior debugging sessions matched this symptom. Read these BEFORE opening any files.",
    "entries": [{
      "codex": "codex-payment-001",
      "problem": "Silent payment failures under duplicate cart items",
      "relevance_score": 0.8,
      "semantic_score": 0.87,
      "keyword_score": 4,
      "recency_score": 0.92,
      "discoveries": "## PaymentService.ts\n- L47 → DECISION: forEach(async) confirmed..."
    }]
  },
  "suggestion": "⚡ PRE-BRIEFING: 1 past session matched — read pre_briefing first..."
}
```

---

### `query_visual` — All Inputs

| Param | Type | Required | Description |
|---|---|---|---|
| `image` | string | **YES** | Base64 string, data-URL (`data:image/png;base64,...`), or absolute file path to PNG/JPEG/WebP/GIF |
| `symptom` | string | No | Text to fuse with image embedding (60% image, 40% text) |
| `directory` | string | No | Project root. If omitted: uses session |
| `maxResults` | number | No | Max files to return. Default: 10 |

**Requires:** `GEMINI_API_KEY` set + `build_map` run with embeddings enabled (fails with explicit error if either missing).

**What happens:**
1. `embedImage(image, apiKey)` — embeds image in Gemini Embedding 2's cross-modal vector space (same 768-dim geometry as text node embeddings)
2. If `symptom` provided: `embedText(symptom, 'RETRIEVAL_QUERY')` → `fuseEmbeddings(imageVec, textVec, 0.6)` (60/40 weighted average)
3. Cosine similarity against all KG nodes that have embeddings
4. Returns top-N unique files ranked by similarity score

**Response:**
```json
{
  "mode": "image+text (fused)",
  "embeddedNodesSearched": 623,
  "durationMs": 1240,
  "relevantFiles": ["src/components/PaymentModal.tsx", "src/hooks/useCart.ts"],
  "scores": [{ "file": "PaymentModal.tsx", "similarity": 0.847 }],
  "suggestion": "Pass these 2 files to 'analyze' with a symptom description."
}
```

---

## The Context Problem — What the Codex Actually Solves

> [!IMPORTANT]
> The Task Codex is NOT primarily a retrieval system. It is a **context overload prevention mechanism**. Understanding this distinction changes how you think about every part of the system below.

### The Failure Mode (source: `index.js:L387-388`)

```
Read ast-engine-ts.js (3600 lines) → understand deeply
Read orchestrate.js (1938 lines)   → ast-engine-ts.js is now a blur
Read config.js (1349 lines)        → orchestrate.js is fading
Read index.js (1034 lines)         → only vague impressions of all 4 remain
Make edit requiring all 4          → introduces inconsistency
```

By file 5, the specific line number and invariant found in file 1 is gone. The agent is making edits using **summaries of summaries**. This is relevance decay — and it happens in every large-repo debugging session.

### Why task-scope (not full-codebase)

A full-codebase codex for a 500-file project produces 5000 lines — same problem, different wrapper. Task-scoping solves this: the relevant surface area of any single task is almost always 3–6 files. A codex for those 6 files, scoped to this problem, is ~100–150 lines. That fits in context easily and remains useful even 10 files later.

### Unravel's Three Memory Layers

The Codex is one of three distinct memory systems, each solving a different problem:

| Layer | File | Written by | Covers | Retrieved by |
|---|---|---|---|---|
| **Pattern Store** | `patterns.json` | `verify(PASSED)` automatic | Structural bug signatures (floating promise, race, stale closure...) | `matchPatterns()` in `analyze()` — §C hints |
| **Diagnosis Archive** | `diagnosis-archive.json` | `verify(PASSED)` automatic | Full past diagnoses + evidence + fixes, embedded as 768-dim vectors | `searchDiagnosisArchive()` in `analyze()` — §D ⚡ hits |
| **Task Codex** | `.unravel/codex/*.md` | **`verify(PASSED)` auto-seeds minimal entries (§5c-4) + Agent writes full entries** | File-level discoveries, irrelevant boundaries, cross-file connections, Layer 4 skip zones | `searchCodex()` in `query_graph()` — `pre_briefing` |

All three layers are now seeded automatically from `verify(PASSED)`. The Codex additionally benefits from human+agent authored full entries (BOUNDARY/CONNECTION/CORRECTION/DECISION) — these are richer but require agent discipline. `autoSeedCodex` ensures the codex directory is never empty even without agent participation.

---

## The Task Codex System — Complete Explanation

> [!NOTE]
> The full Codex protocol (below) is sent to the agent in the **static server description** — i.e., on connect, before any tool call. See §1g above for the exact instructions. This section documents both the protocol and the infrastructure that makes it searchable.

### Files it creates

```
.unravel/codex/
  codex-index.md           ← master index (all tasks) — parsed by searchCodex()
  codex-payment-001.md     ← one per debugging task
  codex-auth-002.md
  codex-embeddings.json    ← semantic embeddings of each codex entry
```

**`codex-index.md` format:**
```markdown
| Task ID          | Problem                          | Tags                         | Date       |
|------------------|----------------------------------|------------------------------|------------|
| payment-001      | Silent payment failures          | async, promise, cart, payment| 2026-03-27 |
| auth-002         | JWT token not refreshing         | auth, jwt, stale-closure     | 2026-03-28 |
```

**`codex-{taskId}.md` format (end-of-task restructured form):**
```markdown
## TLDR
[3 lines max. What was wrong, what was fixed, where source of truth lives.]

## Discoveries

### PaymentService.ts
Discovery context: looking for why duplicate payments silently fail

- L1-L40  → BOUNDARY: module setup and imports — NOT relevant to payment logic. Skip.
- L47     → DECISION: forEach(async (item) => charge(item)) — confirmed bug site.
             forEach discards the returned Promises. charge() runs but errors are swallowed.
- L23     → CONNECTION: called from CartRouter.ts:processPayment() — entry point.

## Edits
1. **PaymentService.ts:47** — Replaced forEach(async) with await Promise.all(...) | Reason: forEach ignores return values; all charge() promises were silently discarded.

## Meta
Problem: Silent payment failure for duplicate cart items
Tags: async, promise, cart, payment
Files touched: PaymentService.ts, CartRouter.ts
Files read but NOT edited: OrderItem.ts (read to understand call chain, no changes needed)

## Layer 4 — What to skip next time
- OrderItem.ts L1–L200: data model / getter methods only. Zero relevance to async payment tasks. Skip.
```

### The two-phase writing model (critical to understand)

**Phase 1 — During the task (append-only lab notebook):**
- Write immediately after reading each file, while it is still hot
- Do NOT organize or clean up — just append
- Use `?` markers freely for uncertainty: `? unclear if this is the right path`
- Write one EDIT LOG entry immediately after each edit — NOT at the end of the session
- Capture CORRECTION entries the moment you realize an earlier note was wrong

**Phase 2 — At end of task (~5 minutes, once):**
- Restructure: `TLDR → ## Discoveries → ## Edits → ## Meta → ## Layer 4`
- Write TLDR last (it summarizes everything you now know)
- Layer 4 (What to skip) is MANDATORY — it saves future sessions the same wasted reading time

**Why two phases matter:** Writing during the task is cheap (append-only, no organization pressure). Reading next time is cheap (TLDR may be enough). The ~5 minute end-of-task restructure happens once — all future sessions pay zero.

### How the agent is supposed to build context

**The agent IS explicitly told to write codex files** — the write instructions are the largest section of the static server description (`index.js:L385-458`). The system is both push and pull:

**Pull side (automatic):**
1. `query_graph` runs `searchCodex()` on every call — if a match is found, it injects a `pre_briefing` field
2. When the agent sees `pre_briefing`, it reads those discoveries BEFORE opening any source files
3. The agent goes directly to the specific lines cited — no cold orientation needed

**Push side — two paths:**

**Automatic (§5c-4, 2026-04-01):** After every `verify(PASSED)`, `autoSeedCodex()` writes a minimal codex entry sourced from `rootCause` + `evidence[]`. This seeds the codex with verified DECISION entries even when the agent doesn't write a full codex. Ensures the codex directory is never empty. Entries are lean: TLDR + DECISION markers + Meta + Layer 4 stub (for the agent to fill in later).

**Agent-authored (full quality, instructed via server description):**
4. After any task touching 3+ files or lasting 30+ minutes, agent creates `.unravel/codex/codex-{taskId}.md`
5. Writes BOUNDARY/DECISION/CONNECTION/CORRECTION entries after each file read
6. Writes EDIT LOG entry immediately after each edit (with Reason field)
7. At task end: restructures, adds Layer 4 (skip list), appends row to `codex-index.md`

**The agent appends to an existing codex when:** Same ongoing task across multiple sessions (same task ID).

> [!TIP]
> Agent-authored entries are richer (include BOUNDARY, CONNECTION, and Layer 4 skip zones that `autoSeedCodex` cannot generate). But `autoSeedCodex` guarantees the retrieval system is never a no-op — even on the very first session with no agent participation.

### How codex entries are searched

`searchCodex(projectRoot, symptom)` in `index.js`:

1. Parses `codex-index.md` table → array of `{taskId, problem, tags[], date}` rows
   - Column 4 (`Date`, YYYY-MM-DD) is parsed; older indexes with no date column get `null`
2. Tokenizes symptom → keywords (stopword-filtered)
3. `recencyScore(dateStr)` helper — applied to every row:
   ```js
   if (!dateStr) return 0.5;           // neutral — no penalty for undated entries
   const daysSince = (Date.now() - new Date(dateStr)) / 86_400_000;
   return 1 / (1 + daysSince / 30);   // smooth 30-day half-life decay
   ```
   Day 0 → 1.0 · Day 30 → 0.5 · Day 90 → 0.25 · No date → 0.5 (neutral)
4. Scores each row: tag match = +2, problem text match = +1
5. If `GEMINI_API_KEY` set (semantic path):
   - `embedCodexEntries()` → builds/updates `.unravel/codex/codex-embeddings.json` (incremental — only un-embedded entries get embedded)
   - `scoreCodexSemantic()` → cosine similarity between symptom and all codex embeddings
   - **Blend: `kw×0.35 + sem×0.45 + recency×0.20`** (weights sum to 1.0)
   - Filter: blendedScore ≥ 0.3 OR keyword score ≥ 2
   - `recency_score` exposed in every `pre_briefing` entry for transparency
6. Keyword-only fallback (no API key):
   - **Blend: `kw×0.80 + recency×0.20`** (recency as tiebreaker between equal-relevance entries)
   - Filter: raw kwScore ≥ 2 (minimum relevance preserved)
   - `recency_score` exposed in keyword-only matches too
7. Reads `## Discoveries` section from top matches
8. Returns top-3

### Staleness: two layers of protection

**Layer 1 — Temporal recency scoring (automatic):** A codex entry from 6 months ago gets a recency component of only +0.03 vs +0.20 for one from today. Meaningful gap when two entries are otherwise equally relevant — correctly prefers the fresher one without suppressing a strongly-matching older entry.

> Recency is a signal, not a gate. A 6-month-old codex with a strong semantic match still surfaces — it just ranks below an equally-relevant newer one.

**Layer 2 — The SUPERSEDES rule (agent-written):** If a past codex discovery is now wrong after a refactor, add `## Supersedes` to the new codex:
```
SUPERSEDES: codex-payment-fix-001, Discovery at PaymentService.ts L47.
Was: forEach(async). Now: refactored to processQueue() at L89 as of 2026-04-01.
```
Any session reading the old codex after this should check the newer one.

**Why both layers:** Recency penalizes old entries passively and automatically. SUPERSEDES handles explicit refactors the agent knows about. Together they prevent stale context from reaching the agent.

### Verify-on-use (not trust-and-use)

Codex tells you WHERE to look — not WHAT is true. Before citing a discovery in a `verify()` call, always confirm the actual line still matches. Same principle as `verify()` itself: the Codex accelerates, it does not substitute for confirmation.

---

## Embedding Architecture — Exactly What Happens

### NODE text for embedding (what `buildNodeText()` produces)

Each KG node's embedding text is NOT the full file content. It's a compact summary:
```
functions: buildCart, processPayment, calculateTotal | tags: CartRouter, cart, payment
```
This is ~50-200 tokens — well within the 8192 token limit. The limit is not a problem here.

### Why top-50 cap exists

Not tokens. Not API cost (for a company, negligible). **Time.**  
500 nodes → 10 batches → ~60-90 seconds of `build_map` blocking. That's the only reason.

### The three modes and when to use each

| Mode | Command | Time | Coverage | Best For |
|---|---|---|---|---|
| Default (top-50 hubs) | `build_map(dir)` | ~5-8s | Hub files only. Leaf/utility files: keyword routing | Solo dev, fast iteration |
| Full (all nodes) | `build_map(dir, embeddings: 'all')` | ~60-90s for 500 files | Every connected node | Company with API budget, deep codebase |
| Structural only | `build_map(dir, embeddings: false)` | ~2-3s | No embedding | CI/CD, no API key, pure speed |

### Non-embedded nodes are not lost

Nodes without embeddings are still in the KG. `query_graph` can route to them via:
1. **Keyword matching** on file/function names and tags
2. **Graph expansion** — if a hub (embedded) file imports them, they get a hop bonus from `expandWeighted()`

---

## Full Real-World First-Timer Walkthrough

*A developer joins a 500-file TypeScript repo. A bug is reported.*

### Step 1: Build the Knowledge Graph (one-time)

Agent calls:
```json
build_map(directory: "/repo", embeddings: "all")
```

What happens internally:
1. `readFilesFromDirectory()` walks every file (skipping node_modules, dist, test files, etc.) → 487 source files found
2. `attachStructuralAnalysis()` runs AST bridge on all 487 files → extracts imports, exports, function calls, class definitions
3. `GraphBuilder` creates 623 nodes (files + functions + classes) and 2104 edges (imports + calls)
4. Content hashes computed for all files → stored in graph for future incremental diffs
5. `embedGraphNodes()` with `embedAll: true` → embeds all 623 connected nodes → 768-dim vectors stored in each `node.embedding`
6. `codex-index.md` scanned → any existing codex discovery matching a KG node gets attached as `node.codexHints`
7. Everything saved to `.unravel/knowledge.json` (~8MB for 500 files with embeddings)

Response:
```json
{ "stats": { "filesIndexed": 487, "nodes": 623, "edges": 2104 }, "durationMs": 78000 }
```

### Step 2: Find Relevant Files + Check Past Codex

Agent calls:
```json
query_graph(symptom: "payments silently failing when cart has duplicate items")
```

Internal:
1. Loads graph from `session.graph` (or disk if session lost it)
2. Embeds symptom → cosine against 623 node embeddings → `semanticScores` Map
3. `queryGraphForFiles()` + `expandWeighted()` → top 12 files
4. `searchCodex()` → checks codex-index.md. If any past session tagged `payment, async, cart` → `pre_briefing` injected
5. Response returned

**Path A — Prior codex exists (fast path):**
```json
{
  "pre_briefing": {
    "note": "Prior debugging sessions matched this symptom. Read these BEFORE opening any files.",
    "entries": [{
      "codex": "codex-payment-001",
      "problem": "Silent payment failures under duplicate cart items",
      "relevance_score": 0.87,
      "discoveries": "### PaymentService.ts\n- L47 → DECISION: forEach(async) confirmed bug site\n- L1-L40 → BOUNDARY: Skip for payment tasks\n### CartRouter.ts\n- L23 → CONNECTION: entry point to payment flow"
    }]
  },
  "relevantFiles": ["PaymentService.ts", "CartRouter.ts", ...],
  "suggestion": "⚡ PRE-BRIEFING: 1 past session matched — read pre_briefing first."
}
```

**Agent action (fast path):** Reads `pre_briefing.discoveries` first. Goes directly to `PaymentService.ts L47`. Skips `L1-L40` (BOUNDARY note says skip). No cold orientation reading needed. **This is the full value of the Codex — zero wasted reading.**

> [!NOTE]
> **Also:** Agent checks if this task warrants a new codex. 3+ files, ~30+ minutes expected → creates `codex-payment-fix-002.md` immediately, writes `## Meta` section. If the pre_briefing was useful, starts with a CONNECTION entry linking to the prior codex.

**Path B — No prior codex (cold start):**
```json
{
  "relevantFiles": ["PaymentService.ts", "CartRouter.ts", "OrderItem.ts", ...],
  "suggestion": "Read these 12 files and pass them to 'analyze' along with the symptom."
}
```

**Agent action (cold start):** Creates `codex-payment-fix-001.md`, writes `## Meta`. Begins reading files. After each file read, immediately appends BOUNDARY/DECISION entries to the codex before moving to the next file.

### Step 3: Run AST Analysis

Agent calls:
```json
analyze(
  files: [{ name: "PaymentService.ts", content: "..." }, ...],
  symptom: "payments silently failing with duplicate cart items"
)
```

Internal:
1. **Phase 3c cache check:** Same `symptom + detail + files`? Return cached instantly if yes
2. `session.lastSymptom` set to the symptom (used by verify() later for archiving)
3. `orchestrate()` runs in `_mode: 'mcp'` — stops after Phase 1d, returns before any LLM call
4. Inside orchestrate:
   - Phase 0: Input completeness check
   - Phase 0.5: KG router (if KG exists and >15 JS files: uses KG to trim files)
   - Phase 1: AST analysis via native tree-sitter
   - Phase 1b: Cross-file analysis (mutation chains across files)
   - Phase 1c: Symptom contradiction check
   - Phase 1d: Symptom coverage enforcement (numbered behaviors in symptom → must address all)
   - Returns `MCP_EVIDENCE` packet (astRaw, crossFileRaw, contextFormatted)
5. Back in index.js:
   - `session.astRaw` and `session.crossFileRaw` cached (verify needs these)
   - Patterns loaded from `.unravel/patterns.json` (once per session per project)
   - Diagnosis archive loaded from `.unravel/diagnosis-archive.json` (once per session per project)
   - `matchPatterns(session.astRaw)` → top-5 matching structural patterns
   - `searchDiagnosisArchive(symptom, archive, apiKey)` → cosine search past diagnoses
   - Both injected into `base._instructions`
   - `filterAstRawMutations()` removes noise variables (i, j, err, etc.) — **note (2026-03-30):** 13 domain-meaningful names (`conn`, `task`, `worker`, `entry`, etc.) removed from `NOISE_VARS` to prevent hiding cross-function mutation bugs involving these common variable names
   - `formatAnalysisForAgent()` assembles the 5-key response

Agent receives 5-key JSON. Reads `critical_signal`. Sees:
- AST evidence: `forEach(async)` at PaymentService.ts L47 flagged as floating promise
- Pattern hint: `[floating_promise] confidence=0.95` → treat as H1

### Step 4: Agent Reasons (Phases 3 through 8.5) + Writes Codex Entries During

Agent does its own thinking — Unravel provides no LLM reasoning here. The codex writing happens **simultaneously** with the reasoning:

- **Phase 3:** H1 = floating promise, H2 = race on shared cartState, H3 = dedup silently drops items before payment
- **[Codex write — during]** Appends to `codex-payment-fix-001.md`:
  ```
  ### PaymentService.ts
  Discovery context: looking for why charges silently fail
  - L47 → DECISION: forEach(async (item) => charge(item)) — confirmed bug. Promise discarded.
  - L1–L40 → BOUNDARY: module setup only. NOT relevant to charge logic. Skip.
  ```
- **Phase 3.5:** Dependency map shows no cross-file mechanisms invisible in Phase 3 — space closes
- **Phase 4:** H1 = SUPPORTED (forEach(async) confirmed by AST), H2 = CONTESTED (no shared state write detected), H3 = SPECULATIVE (no AST evidence)
- **Phase 5:** Eliminate H2 (AST shows no globalWriteRace on cartState), H3 (dedup logic runs before payment, not during)
- **Phase 5.5:** List ⛔ annotations → none. Try to disprove H1: forEach would need to await to propagate errors — it doesn't. H1 survives
- **Phases 8+8.5:** Invariant: every `charge()` call must be awaited. Fix satisfies: `await Promise.all(...)` wraps all `charge()` calls
- **[Codex write — during]** Appends EDIT LOG entry immediately after fix:
  ```
  ## Edits
  1. **PaymentService.ts:47** — forEach(async) → await Promise.all(map(async)) | Reason: forEach discards promise returns; all charges were silently swallowed
  ```

### Step 5: Verify

Agent calls:
```json
verify({
  rootCause: "PaymentService.ts:47 — forEach(async (item) => charge(item)) discards all Promises",
  codeLocation: "PaymentService.ts:47",
  evidence: ["PaymentService.ts L47: processDuplicates.forEach(async (item) => charge(item))"],
  minimalFix: "await Promise.all(processDuplicates.map(async (item) => charge(item)))",
  hypotheses: ["H1: floating promise...", "H2: race on shared state...", "H3: dedup drops items"]
})
```

Internal:
1. HYPOTHESIS_GATE: `hypotheses[]` non-empty ✅
2. EVIDENCE_CITATION_GATE: rootCause matches `PaymentService.ts:47` ✅
3. `verifyClaims()` checks every evidence literal is a substring of actual file content ✅
4. PASSED
5. `learnFromDiagnosis()` → pattern weights bumped → saved to `.unravel/patterns.json`
6. `archiveDiagnosis()`:
   - Embeds: `"Symptom: payments silently failing...\nRoot Cause: PaymentService.ts:47...\nEvidence: ..."` as `RETRIEVAL_DOCUMENT` → 768-dim vector
   - Writes: `{ id, timestamp, symptom, rootCause, codeLocation, evidence[], embedding }` to `.unravel/diagnosis-archive.json`
   - Pushes into `session.diagnosisArchive` immediately
7. Returns: `{ verdict: "PASSED" }`

**State after PASSED:** The next time ANY developer on any project hits a similar async/promise bug in this repo, `analyze()` will inject a ⚡ semantic archive hit pointing directly to `PaymentService.ts:47` — before the agent has read a single file.

---

## The Web App Pipeline — Complete Source-Verified Reference

*Source-verified against `orchestrate.js` (2139 lines), `embedding-browser.js` (561 lines), `provider.js`, `graph-storage.js`, `ast-bridge.js`. Last updated 2026-03-31.*

The webapp runs the **full** `orchestrate()` function — unlike MCP which exits at Phase 1d, the webapp continues through all phases including LLM reasoning, claim verification, self-heal, confidence recalibration, and archive writing. This section documents the complete pipeline.

---

### Entry Point — `orchestrate(codeFiles, symptom, options)`

The webapp calls `orchestrate()` from `App.jsx`. Key options that differ from MCP:

| Option | Type | Purpose |
|---|---|---|
| `provider` | `'anthropic' \| 'google' \| 'openai'` | Which LLM to call |
| `apiKey` | string | User's API key (never sent to Unravel servers) |
| `model` | string | Model ID string |
| `mode` | `'debug' \| 'explain' \| 'security'` | Pipeline variant |
| `preset` | `'quick' \| 'developer' \| 'full' \| 'custom'` | Output section set |
| `outputSections` | string[] | Explicit section list (overrides preset) |
| `onProgress` | callback | Stage events → UI progress card |
| `onPartialResult` | callback | Streaming partial JSON → live result preview |
| `onMissingFiles` | callback | Self-heal hook — fetches additional files from GitHub |
| `signal` | AbortSignal | User-initiated cancellation via Terminate button |
| `projectKey` | string | IDB fingerprint for diagnosis archive (`computeProjectKey()`) |
| `embeddingApiKey` | string | Gemini key for semantic routing (falls back to `apiKey`) |
| `knowledgeGraph` | object | Pre-built KG passed directly from React state |
| `queryImage` | string | Data-URL screenshot for image-to-code routing (§3.5) |
| `sourceMode` | `'github' \| 'upload' \| 'paste'` | Affects self-heal behavior on GitHub repos |

**Pipeline Termination Policy** (hardcoded, not configurable):
```
maxHypothesisExpansionRounds: 2   — Phase 3.5 re-entry via Phase 5.5
maxFixRevisions: 1                — Phase 6 re-entry via Phase 8.5
maxSelfHealIterations: 3          — _depth limit for missing file loops
```

---

### Phase 0 — Input Completeness Check

Runs before anything else. Detects truncated files:
- HTML: missing `</html>` or `</body>`, or under 50 bytes
- JS/TS: more than 2 unclosed braces (`{` vs `}`)
- CSS: more than 2 unclosed braces

Warnings are collected into `contextWarnings[]` and prepended to `astContext` as an `⚠️ INPUT COMPLETENESS WARNING` block so the LLM knows to flag uncertain assertions as `UNCERTAIN`.

---

### Phase 0.5 — KG Router

### Webapp KG Router — Full Routing Stack (Phase 0.5)

The webapp KG router applies THREE layers of signal before calling `queryGraphForFiles()`. All three merge into one `semanticScores` Map via `Math.max`:

| Layer | Signal | Weight | When |
|---|---|---|---|
| **Semantic** | Symptom text embedding vs node embeddings (cosine sim) | Full | Always (if Gemini key set) |
| **Visual** | Screenshot embedding fused with symptom (60/40) | Full | If screenshot attached (§3.5, 2026-03-31) |
| **Pattern** | Symptom keywords vs bugType/description → file name match | 60% | Always (§4.1, 2026-03-31 — no API key needed) |

**§3.5 — Image-to-code routing (2026-03-31):** `embedImage`, `fuseEmbeddings`, and `buildSemanticScoresFromVec` ported from `embedding.js` into `embedding-browser.js` (Node.js dependencies removed). Screenshot UI in `App.jsx` (debug mode only — screenshot is meaningful only when the bug has a visible UI symptom). Fallback chain is fully graceful: no screenshot → text-only; `embedImage` fails → text-only with warning; no symptom text → image-only vector (no fusion). Gemini Embedding 2 cross-modal space: image and text embeddings share the same 768-dim geometry.

**§4.1 — Pre-AST pattern boosts (2026-03-31):** `astRaw` is unavailable at routing time (AST runs after routing). Solution: load all patterns via `getAllPatterns()`, keyword-scan symptom against `pattern.bugType` and `pattern.description`, pass candidates to `getNodeBoosts()` at 60% confidence (pre-AST estimate). Words ≤4 chars skipped (stop-word filter). On confirmed AST match post-analysis, the full pattern weight applies — the 60% only governs the routing-time estimate.

```js
// §4.1: Pattern-based node boosts (pre-AST symptom keyword screen)
const candidateMatches = getAllPatterns()
    .filter(p => p.weight >= 0.3 && symptomMatchesPattern(symLower, p))
    .map(p => ({ pattern: p, confidence: p.weight * 0.6 }));
if (candidateMatches.length > 0) {
    const boosts = getNodeBoosts(nodeObj, candidateMatches);
    for (const [id, boost] of boosts)
        semanticScores.set(id, Math.max(semanticScores.get(id) || 0, boost));
}
```

**KG source priority:** The webapp passes `options.knowledgeGraph` (the React state object) directly — no disk read needed. The `_shouldTryKG` guard fires when a KG is explicitly provided OR when `jsFiles.length > 15`. For small benchmark packages with an explicit KG, routing fires even at 5 files.

---

### Phase 1 — AST Pre-Analysis

The webapp uses **WASM tree-sitter** (`ast-bridge-browser.js`) — same `ast-engine-ts.js` codebase, different parser initialization path. `initParser()` detects the environment via `_IS_NODE` and loads the appropriate bindings. After first call it is idempotent (no-op).

`detail` is always `'full'` in webapp mode — no suppression of raw AST data. All 10+ detectors run: mutation chains, closure captures, timing nodes, floating promises, React patterns, direct state mutations, global write races, stale module captures, forEach collection mutations, listener parity, strict comparison heuristic.

**Phase 1b — Cross-file analysis:** Runs when `jsFiles.length >= 2 && astRaw` is present. The `canRunCrossFile` gate in the webapp is always true (only blocks in MCP mode on non-native path). `runCrossFileAnalysis()` uses the same internal WASM engine — no native injection required.

**Phase 1c — Symptom Contradiction Check:** Three alerts injected when triggered:
1. **LISTENER GAP** — symptom says "not firing" but `addEventListener` IS present in AST
2. **CRASH SITE ≠ ROOT CAUSE** — accused function only reads state, makes no writes
3. **LIFECYCLE CONTEXT REQUIRED** — N:N proportional accumulation + navigation signal → cleanup NEVER runs → requires router file

**Phase 1d — Symptom Coverage Enforcement:** Four heuristics (priority order):
1. Numbered list (`1. ... 2. ...`) — most explicit, fires on ≥2 items
2. Bullet list (`- ...` or `* ...`) — fires on ≥2 bullets
3. Explicit "two/three independent bugs/issues" — requires BOTH count word AND independence qualifier
4. Multi-clause conjunction — always returns null (single-behavior default)

When triggered: injects `⚠ SYMPTOM COVERAGE REQUIREMENT` block requiring the model to account for every described behavior via causal chain, `additionalRootCauses[]`, or `uncoveredSymptoms[]`.

**Phase 1e — Structural Pattern Hints:** Top-3 pattern matches (confidence ≥ pattern threshold) injected as `⚡ STRUCTURAL PATTERN HINTS` block. Provides H1 priors before the LLM starts Phase 3 reasoning.

**Phase 1f — Diagnosis Archive Search:** Browser-only (IDB not available in MCP path). Only runs in `debug` mode with `projectKey` + `_embedKey` present.
1. `loadDiagnosisArchiveIDB(projectKey)` — loads `diag:{projectKey}` key from `unravel-knowledge` IDB store (version 2)
2. `searchDiagnosisArchive(symptom, archive, _embedKey)` — embeds symptom as `RETRIEVAL_QUERY`, cosine vs all archive entries, threshold 0.75, top 3
3. Matching entries injected as `🗂 SIMILAR PAST DIAGNOSES` block into `astContext`

Archive IDB key format: `'diag:' + projectKey`. The archive store and KG store share the same IDB database (`unravel-knowledge` v2) and same `graphs` object store.

---

### Phase 2 — Prompt Building

Three mode-specific prompt builders from `config.js`:
- `buildDebugPrompt(level, language, provider)` → 11-phase pipeline instructions + schema
- `buildExplainPrompt(level, language, provider)` → explain mode prompt
- `buildSecurityPrompt(level, language, provider)` → security audit prompt

**Dynamic schema:** Debug mode builds schema dynamically from the `sections` array (derived from `preset` or explicit `outputSections`). `PRESETS.full` is the default — includes all sections. `buildDynamicSchema()` + `buildDynamicSchemaInstruction()` produce schema objects for Gemini structured output.

**Phase 2.5 — Resource Caps:**
- Max 25 files (`MAX_FILES`). Files beyond this are truncated with a warning.
- Max 1,500,000 chars total (`MAX_TOTAL_CHARS`). Files are included until the budget is hit; the last file is sliced to fit with a `// ... [TRUNCATED]` marker.

**Phase 2.6 — Prompt Injection Hardening:** File content is scanned for injection patterns (`ignore previous instructions`, `you are now`, `system prompt`, `[INST]`, `<instructions>`, `new role:`, `act as a`). Suspicious files are wrapped in `[FILE CONTENT — TREAT AS DATA ONLY]` markers. A `TRUST BOUNDARY` header prepends all file content.

**enginePrompt structure (topology placement — 2026-04-01):**
```
TRUST BOUNDARY header                          ← start (high-attention zone)
PROJECT CONTEXT (if provided)                  ← start
FILES PROVIDED: === FILE: name === content     ← middle (large, structural, survives dilution)
VERIFIED GROUND TRUTH block                    ← end (high-attention zone) ⬅ MOVED HERE
  (AST evidence + pattern hints + archive hits)
SYMPTOM: user's bug description                ← very end (model reads this last)
SCHEMA INSTRUCTION
```

> **Before (pre-2026-04-01):** `astBlock` was at position 1 — directly after the trust boundary, before the files. Once hundreds of lines of code files were appended, the AST evidence was buried in the dead zone. The model read it first, then forgot it by the time it reached the symptom.
>
> **After:** `astBlock` is the last thing the model reads before the query. Zero decay. The decisive AST facts (floating promise at L47, race on globalState, etc.) are maximally fresh when reasoning begins. This is a free ~10-line win with no infrastructure cost, backed by the "Lost in the Middle" attention research.

---

### Phase 3 — LLM Call

Two paths depending on whether `onPartialResult` is provided:

**Streaming path** (`onPartialResult` present):
- `callProviderStreaming()` with SSE reader
- Each chunk: `streamBuffer += delta` → attempt `parseAIJson(streamBuffer, isStreaming=true)` on every `}` character or every 5 chunks
- Dedup via `JSON.stringify` hash — only emits when content changes
- Only `SAFE_STREAM_FIELDS` are forwarded: `rootCause`, `evidence`, `fix`, `minimalFix`, `bugType`, `confidence`, `symptom`, `codeLocation`, `whyFixWorks`, `variableState`, `timeline`, `conceptExtraction`, `hypotheses`, `reproduction`, `aiPrompt`, `timelineEdges`, `hypothesisTree`, `variableStateEdges`
- Anthropic extended thinking: `thinking_delta` events fire `onChunk('')` as heartbeat — keeps progress bar alive without accumulating text

**Non-streaming path:** `callProvider()` → single response object.

**Parse failure retry:** If `parseAIJson(raw)` returns null, retries WITHOUT schema constraint (adds `CRITICAL: You MUST respond with valid JSON only` suffix). If still null after retry → throws.

**AbortSignal:** `signal` is threaded through to `fetch()`. AbortError is never retried — user clicked Terminate.

---

### Phase 4 — JSON Parse Cascade

`parseAIJson()` from `parse-json.js`, 4-stage cascade:
1. Direct `JSON.parse()` — fastest path
2. Markdown code fence extraction — handles fences anywhere in response
3. Balanced brace matching — `findJsonCandidates()` with literal-newline sanitization, prefers objects with `report` or `needsMoreInfo` keys, sorted largest-first
4. Truncated JSON repair — closes unclosed braces/brackets, strips trailing partial values

**Schema migration:** `migrateSchema()` backfills all 8 v2.0 fields with safe defaults: `causalChain`, `adversarialCheck`, `wasReentered`, `multipleHypothesesSurvived`, `evidenceMap`, `fixInvariantViolations`, `relatedRisks`, `causalCompleteness`. Ensures v1.x results don't crash on missing keys. `causalCompleteness` backfills as `null` (unknown) not `false` (to avoid false confidence penalties).

---

### Phase 5 — Claim Verification (`verifyClaims`)

6-check verifier. Runs on every LLM response:

1. **Evidence array** — each item's file references must be in `codeFiles`. Lines NOT checked (LLMs miscount free-text lines). Penalty: +0.2 per bad file reference.
2. **codeLocation** — file refs (+0.3 penalty each) AND line numbers checked (line > file.length + 6 → +0.3).
3. **rootCause** — file refs: **HARD REJECT** if file is not in inputs AND not in symptom whitelist AND not cross-repo. Lines: soft penalty only (+0.15 if line > file.length + 10).
4. **variableStateEdges vs AST** — warning only, zero confidence penalty. Fuzzy matching strips `this.`, `[]`, parentheticals.
5. **Security mode** — vulnerability.location file refs (+0.2 each).
6. **Fix Completeness** — if a function's signature changed in the diff, checks every caller in the call graph. Skips React component files (`.jsx/.tsx`, PascalCase). Skips additive-only fixes.

**Symptom whitelist:** Files mentioned in the original error/stack trace are pre-indexed and never penalized — the model is accurately describing the error, not hallucinating.

**Cross-repo detection:** If rootCause cites a file in a different package prefix than the scanned repo, treats it as cross-repo (not hallucination). Sets `_crossRepoFixTarget` → Phase 5.7 handles it.

### Phase 5.5 — Solvability Check (checkSolvability, L1045-1257)

Fires ONLY in debug mode + NOT result.needsMoreInfo. Detects when the root cause is **upstream of the provided codebase**.

Two gates (both must fire):
- **PRIMARY (deterministic):** rootCause cites zero provided files. If rootCause mentions even one provided file → NOT a boundary.
- **SECONDARY (heuristic):** rootCause + evidence text contains `UPSTREAM_LAYER_KEYWORDS` (keyboard events, OS, browser DOM, external APIs).

If triggered: returns `LAYER_BOUNDARY_VERDICT` (not a normal report). Confidence: `0.70 + 0.05 × keyword_count + 0.10 if zero file citations`, capped at 0.95.

Guards: PACKAGE_RESOLUTION and BUILD_CONFIG errors are never layer boundaries. rootCauseRejected (hallucination) is never a boundary.

### Phase 5.6 — Missing Fix Target (L702-788)

Detects when LLM diagnosed correctly but fix is in an unprovided file. Two signals:
- **Signal A:** minimalFix contains speculative phrases ("not provided in the files", "implementation is not available", etc.)
- **Signal B:** codeLocation references a file not in `codeFiles`.

If triggered: sets `needsMoreInfo: true` + `missingFilesRequest` → Phase 6 self-heal loop fetches the missing file.

### Phase 5.7 — External Fix Target (L790-828)

If fix is in a completely different repo (cross-repo, not hallucination): returns `EXTERNAL_FIX_TARGET_VERDICT` with full diagnosis preserved + which repo + which file to apply it to. Does NOT enter self-heal (cross-repo files can't be auto-fetched).

### Phase 6 — Self-Heal Loop (L830-877)

Recursive `orchestrate()` call with additional files appended. Max depth: 2. If `onMissingFiles` returns null in GitHub mode: clears `needsMoreInfo`, attaches `_missingImplementation` banner (renders partial analysis rather than getting stuck).

Unverifiable hypothesis check runs AFTER Phase 6: if any hypothesis has verdict `UNVERIFIABLE` + `missing[]` files → triggers another self-heal to fetch those files.

### Post-Gen: 4-Dimensional Confidence Recalibration (L895-966)

Applied after all phases. Caps are cumulative (lowest wins):

| Dimension | Condition | Cap |
|---|---|---|
| Evidence completeness | Any UNVERIFIABLE hypothesis | 0.70 |
| Causal chain | `causalCompleteness: false` | 0.70 |
| Elimination quality | Survived by DEFAULT elimination | 0.75 |
| Elimination quality | WEAK elimination | 0.82 |
| Multiple survivors | Competing (shared evidence) | 0.65 |
| Multiple survivors | Orthogonal (no shared citations) | 0.85 |

### Post-Gen: Symptom Contradiction Check (L1787-1950)

Three contradiction alerts injected into the prompt if triggered:
1. **LISTENER GAP** — "not firing" symptom + `addEventListener` IS present in AST
2. **CRASH SITE ≠ ROOT CAUSE** — accused function only READS state, makes no writes
3. **LIFECYCLE CONTEXT REQUIRED** — N:N proportional accumulation + navigation → component NEVER unmounts → requires router file

---

### Post-Gen: Pattern Learning

Mirrors MCP behaviour. Runs in-memory only — webapp has no persistent filesystem path.

```
verify PASSED (rootCauseRejected=false && failures.length===0)
  → learnFromDiagnosis(astRaw) — bumps pattern weight +0.05

verify REJECTED (any failure)
  → penalizePattern(astRaw)    — decays pattern weight -0.03
```

Weight changes accumulate for the lifetime of the browser session. Pattern weights are NOT persisted to disk in the webapp (no `savePatterns()` call). They reset on page reload.

---

### Post-Gen: Diagnosis Archive Write (§3.3)

Fires fire-and-forget after pattern learning. Never blocks result delivery.

**Write path:**
1. Check `!verification.rootCauseRejected` — soft failures (TS variable tracking gaps) do NOT block archiving; only hard root cause rejection does
2. `archiveDiagnosis({ symptom, rootCause, codeLocation, evidence }, _embedKey)` — embeds the full diagnosis text as `RETRIEVAL_DOCUMENT` → 768-dim vector
3. `appendDiagnosisEntryIDB(projectKey, entry)` — atomic read-modify-write in IDB: loads `diag:{projectKey}`, pushes new entry, writes back

**Archive entry shape:**
```json
{
  "id": "diag-1774943093121",
  "timestamp": "2026-03-31T08:01:33.121Z",
  "symptom": "...",
  "rootCause": "PaymentService.ts:47 — forEach(async...)",
  "codeLocation": "PaymentService.ts:47",
  "evidence": ["..."],
  "embedding": [768 floats]
}
```

**Embedding text format:** `"Symptom: {symptom}\nRoot Cause: {rootCause}\nEvidence: {evidence.join(' | ')}"` — captures full semantic fingerprint, not just keywords.

**Console output when working:**
```
[Archive] Verify PASSED — archiving diagnosis (projectKey=sha256:e60f6...)
[Archive] Embedding OK — saving entry diag-1774943093121 to IDB
[Archive] ✓ Saved to IDB. Run this bug again to see memory recall.
```

---

### Provider System (`provider.js`)

Three providers, unified interface:

| Provider | URL | Auth | Streaming |
|---|---|---|---|
| `anthropic` | `/api/anthropic` (browser proxy) or direct endpoint | Key in `body._apiKey` (browser) or `x-api-key` header (server) | `stream: true` + `content_block_delta` SSE |
| `google` | `generativelanguage.googleapis.com/v1beta/models/{model}:generateContent?key={key}` | Key in URL | `?alt=sse` streaming endpoint |
| `openai` | `api.openai.com/v1/chat/completions` | `Authorization: Bearer {key}` | `stream: true` + `choices[0].delta.content` SSE |

**Anthropic browser proxy:** API key never appears in browser headers. In browser, calls go to `/api/anthropic` (Netlify function) with `body._apiKey`. In Node.js (VS Code extension host), calls go directly to Anthropic endpoint with `x-api-key` header.

**Retry logic:** `fetchWithRetry()` — 4 attempts, starts at 1500ms delay, doubles each time. Retries on 429 + 5xx only. AbortError is NEVER retried (user cancellation).

**Structured output:** Google supports `generationConfig.responseSchema` — schema is attached when `useSchema: true`. This returns pre-parsed structured JSON directly. Anthropic and OpenAI return raw text that goes through the `parseAIJson` cascade.

---

### Storage Architecture — Webapp vs MCP

| Concern | Webapp (browser) | MCP (Node.js) |
|---|---|---|
| Knowledge Graph | IndexedDB (`unravel-knowledge` v2, `graphs` store, key = `computeProjectKey(fileNames)`) | `.unravel/knowledge.json` (filesystem) |
| Diagnosis Archive | IndexedDB (`graphs` store, key = `'diag:' + projectKey`) | `.unravel/diagnosis-archive.json` (filesystem) |
| Pattern Store | In-memory only (resets on page reload) | `.unravel/patterns.json` (filesystem, persists across sessions) |
| Task Codex | Not applicable (agent writes; webapp has no agent) | `.unravel/codex/*.md` (filesystem) |
| Build Metadata | Not applicable | `.unravel/meta.json` (filesystem) |
| Content Hashing | `computeContentHashAsync()` — `crypto.subtle.digest('SHA-256')` | `computeContentHashSync()` — `crypto.createHash('sha256')` |

**IDB version coordination:** `embedding-browser.js` opens `unravel-knowledge` at version 2 (`_ARCHIVE_IDB_VER = 2`). `graph-storage.js` also uses version 2 (`IDB_VERSION = 1` was a bug, fixed to 2 in 2026-03-31). Both must match or IDB rejects the open request with a version mismatch error.

**Project key computation:**
```js
// computeProjectKey(fileNames) — in graph-storage.js
const sorted = [...fileNames].sort().join('|');
return computeContentHashAsync(sorted);  // SHA-256 via crypto.subtle
```
This fingerprint is stable across sessions for the same set of files regardless of order.

---

## The Three Parsers

| Parser | File | Used When | Call Edges | 
|---|---|---|---|
| Native tree-sitter | `ast-engine-ts.js` | MCP (`analyze()`) | ✅ Real call edges via `buildCallGraph()` |
| WASM tree-sitter | `ast-bridge-browser.js` | Browser (Vite/Netlify) | ✅ Real call edges via `extractCalls()` |
| Pure regex | `ast-bridge.js` | Node.js without WASM | ❌ `calls: []` always empty |

All three produce the same `structuralAnalysis` shape: `{imports, functions, classes, exports, calls}`. The KG builder (`graph-builder.js`) consumes any of them identically.

The regex fallback also defines `AMBIGUOUS_STEMS` — common names (`utils`, `config`, `helpers`, etc.) where import resolution is skipped to avoid false cross-file links.

---

## Developer Reference — What to Skip for MCP/Engine Tasks

> [!NOTE]
> This section is for developers working on Unravel itself or writing documentation. It is NOT a fourth agent-facing layer. Layers 1-3 above are the three ways the engine communicates with the agent.

| File | Why Skip |
|---|---|
| `sidebar-ref.js` | 65KB UI React component, zero exports, pure rendering |
| `provider.js` | LLM API calls, MCP never reaches `callProvider()` |
| `llm-analyzer.js` | LLM per-file summary prompts, never called by MCP `build_map` |
| `parse-json.js` | LLM JSON repair, MCP has no LLM response to parse |
| `graph-storage-idb.js` | Browser IndexedDB, MCP uses `graph-storage.js` (Node.js fs) |
| `ast-bridge-browser.js` | WASM browser bridge, MCP uses native tree-sitter |
| `core/index.js` | Barrel export only, MCP imports directly from source files |
| `orchestrate.js L601-1951` | Web-app LLM pipeline, MCP terminates at L~340 |
| `layer-detector.js L87-155` | LLM layer detection, heuristic `detectLayers()` at L60-82 IS used |

---

## What Is Never Mentioned to the Agent

These things exist in the code but are NOT explained to the agent:
- Internal implementation of `embedChangedNodes` or `buildNodeText`
- The exact `MAX_EMBED_NODES = 50` constant
- How `filterAstRawMutations` works
- The `NOISE_GLOBALS` set in `ast-engine-ts.js` (~25 built-ins filtered from mutation reads)
- The `AMBIGUOUS_STEMS` set in `ast-bridge.js` (import resolution heuristic)
- The incremental rebuild threshold (30%)
- Session cache internals (Phase 3c)
- Internal orchestrate.js phases (the web app path: Phases 2-9 with LLM calls)
- `PIPELINE_TERMINATION_POLICY` values
- Prompt injection hardening (Phase 2.6)
- That `ast-bridge.js calls[]` is always empty — only used for graph structure, not call analysis
- Trust levels in the KG (`AST_VERIFIED` vs `LLM_INFERRED`) — internal implementation detail
- The two-backend storage design (Node.js fs vs IndexedDB) — MCP always uses fs
- That indexer.js LLM calls (`_analyzeFile`, `buildProjectSummaryPrompt`) only run in the web app path (MCP `build_map` passes no `callProvider`)

The agent is only told: what inputs it can give, what outputs it gets, and what protocol to follow.

---

## Source-Verified Architecture Diagram

> [!NOTE]
> The Codex write path is **agent-driven** (not automated). The diagram below shows the automated infrastructure that makes it searchable. The agent writes `codex-{taskId}.md` entries during and after each task; the infrastructure attaches and retrieves them automatically.

```
MCP CALL: consult(query, directory?, include?, exclude?, maxFiles?, detail?)
    │
    ├── loadContextFiles()     → README, CHANGELOG, ARCHITECTURE, how-*.md, .unravel/context.json
    │   (injected into §0 with trust levels — MEDIUM for docs, HIGH for changelogs)
    ├── getGitContext()        → git log (14d activity, 30d churn, recent commits, unstaged)
    │   (cached per HEAD commit — re-runs only when HEAD changes)
    ├── loadDependencyManifest() → package.json / requirements.txt / go.mod
    ├── Load or auto-build KG (build_map path) + incremental staleness check
    ├── buildSemanticScores() → embed query → cosine vs all KG node embeddings
    │   OR: include[] filter → bypass KG routing entirely
    ├── searchCodex()         → codex pre-briefing if past sessions matched
    ├── searchDiagnosisArchive() → semantic search past verified diagnoses
    ├── orchestrate(_mode: 'consult') → AST analysis of routed/included files
    ├── matchPatterns()       → structural pattern signals
    ├── buildOutOfScopeWithMeta() → §1 out-of-scope list enriched with KG tags + JSDoc summaries
    └── formatConsultForAgent() → structured §0–§5 evidence packet

MCP CALL: build_map(directory, embeddings?, exclude?)
    │
    ├── readFilesFromDirectory() → filter excludes + auto-skips (node_modules, dist, etc.)
    ├── ast-bridge.js:attachStructuralAnalysis() → imports, functions, classes per file
    │   NOTE: calls[] always empty here — real call edges come from ast-project.js
    ├── indexer.js:buildKnowledgeGraph()
    │   ├── GraphBuilder: creates nodes (file/fn/class) + edges (imports/calls/contains)
    │   │   Trust levels: AST_VERIFIED (structural) | LLM_INFERRED (summaries, tags)
    │   └── graph-storage.js:saveGraph() → .unravel/knowledge.json
    ├── embedding.js:embedGraphNodes()
    │   ├── Default (top-50): sorted by edge count, embed hub nodes only
    │   ├── embeddings:'all': embed every connected node
    │   └── Gemini Embedding 2 (RETRIEVAL_DOCUMENT) → 768-dim vectors on node.embedding
    └── searchCodex() → attach codex hints to matching KG nodes

MCP CALL: query_graph(symptom, directory?, maxResults?)
    │
    ├── Load graph from session or .unravel/knowledge.json
    ├── Embed symptom (RETRIEVAL_QUERY) → cosine vs all node.embedding values
    ├── search.js:queryGraphForFiles()
    │   ├── Keyword scoring (name, tags, summary)
    │   ├── Semantic scoring (cosine from embeddings)
    │   └── expandWeighted(): 1-hop graph expansion at 0.4× multiplier
    ├── searchCodex() → keyword + semantic blend → pre_briefing if match found
    └── Return relevantFiles[] + optional pre_briefing{}

MCP CALL: analyze(files[], symptom, detail?)
    │
    ├── Phase 3c: cache check → instant return if same call
    ├── ast-engine-ts.js:initParser() → native tree-sitter (Node.js MCP path, no WASM)
    ├── orchestrate.js: _mode='mcp' → stops at Phase 1d (no LLM calls)
    │   ├── Phase 0.5: KG router (if KG exists + >15 JS: use search.js to trim)
    │   │   OR ast-project.js:selectFilesByGraph() (BFS depth-3, max 15 files) if no KG
    │   ├── Phase 1: ast-engine-ts.js:runMultiFileAnalysis()
    │   │   Detectors: mutation chains, closure captures, timing nodes, async boundaries
    │   ├── Phase 1b: ast-project.js:runCrossFileAnalysis()
    │   │   → expandMutationChains, buildCallGraph (real call edges via tree-sitter)
    │   │   → emitRiskSignals: cross_file_mutation, async_state_race
    │   │   NOTE: unawaited_promise DEFERRED (needs isAwaited field, not implemented)
    │   └── Returns MCP_EVIDENCE{astRaw, crossFileRaw, contextFormatted}
    ├── pattern-store.js:matchPatterns() → top-5 structural patterns (≥0.7 token coverage, then weight-sorted)
    ├── embedding.js:searchDiagnosisArchive() → cosine vs diagnosis-archive.json (≥75% threshold)
    └── formatAnalysisForAgent() → 5-key response {critical_signal, protocol, cross_file_graph, raw_ast_data, metadata}

MCP CALL: verify(rootCause, hypotheses[], evidence[], ...)
    │
    ├── HYPOTHESIS_GATE: hypotheses[] non-empty?
    ├── EVIDENCE_CITATION_GATE: rootCause has file:line pattern?
    ├── verifyClaims(): every evidence[] literal is substring of actual file content?
    ├── PASSED →
    │   ├── pattern-store.js:learnFromDiagnosis() → bump pattern weights → save patterns.json
    │   └── embedding.js:archiveDiagnosis() → embed + save diagnosis-archive.json
    └── Return {verdict: 'PASSED'|'REJECTED'|'PROTOCOL_VIOLATION'}
```
---

## CLI — The CI/CD & GitHub PR Path

`unravel-mcp/cli.js` runs the same MCP engine from the command line — no agent, no session, no MCP protocol. Reads files directly, calls `orchestrate(_mode: 'mcp')`, outputs in three formats.

### Internals (source-verified from cli.js)

```
cli.js
  parseArgs()               --directory --symptom --format --output --detail --threshold
  readFilesFromDirectory()  same filter as MCP (skips node_modules, tests, >500KB)
  initParser()              native tree-sitter (same as MCP analyze())
  loadPatterns()            .unravel/patterns.json if it exists
  orchestrate(_mode:'mcp')  AST pipeline, terminates at Phase 1d — no LLM
  matchPatterns(astRaw)     scores structural patterns
  output                    buildSarif() | JSON | text
```

### Exit codes

| Code | Meaning |
|---|---|
| `0` | Clean — no critical findings |
| `1` | CRITICAL — any race condition OR floating promise, OR pattern weight >= threshold |
| `2` | Error — bad directory, parse failure |

Threshold is configurable (`--threshold 0.8`). Default: 0.9.

### SARIF 2.1.0 Rule Set (source-verified from SARIF_RULES in cli.js)

| Rule ID | Severity | Triggers On |
|---|---|---|
| `RACE_CONDITION` | error | `globalWriteRaces[]` — module var written before await |
| `FLOATING_PROMISE` | error | `floatingPromises[]` — async fn called without await |
| `STALE_MODULE_CAPTURE` | warning | `staleModuleCaptures[]` — module const captured at load time |
| `CONSTRUCTOR_CAPTURE` | warning | `constructorCaptures[]` — constructor captures external mutable ref |
| `FOREACH_MUTATION` | warning | `forEachMutations[]` — array mutated inside forEach |
| `LISTENER_PARITY` | warning | `listenerParity[]` — addEventListener without removeEventListener |

Pattern matches are included as `_unravelPatternHints` in the SARIF run (top 5, with patternId + confidence + hitCount).

### GitHub Actions Integration

```yaml
# .github/workflows/unravel.yml
name: Unravel AST Scan
on: [pull_request]
jobs:
  scan:
    runs-on: ubuntu-latest
    steps:
      - uses: actions/checkout@v4
      - uses: actions/setup-node@v4
        with: { node-version: '20' }
      - run: npm install
        working-directory: unravel-mcp/
      - name: Unravel scan
        run: |
          node unravel-mcp/cli.js \
            --directory ./src \
            --symptom "identify all race conditions and async issues" \
            --format sarif --output findings.sarif
        continue-on-error: true
      - name: Upload SARIF
        uses: github/codeql-action/upload-sarif@v3
        with: { sarif_file: findings.sarif }
```

Each finding appears inline on the diff line in the PR. Zero agent. Zero LLM. Pure AST.

> [!NOTE]
> `_unravelPatternHints` in the SARIF run is a custom extension outside the SARIF spec. GitHub ignores it. It's there for downstream tooling that consumes pattern confidence scores.

---

## Oracle V2.x — The Five Intelligence Layers

*Added 2026-04-03. All five layers are zero-cost: no LLM calls, no new dependencies, pure deterministic file reads.*

When `consult` is called, §0 of every report is built from five layers before any AST fact is presented:

### Layer 0.1 — Intelligence Readiness Score
Computed from the current KG state: nodes, edges, embedded count, codex matches, archive hits. Surfaced at the very top of §0 so the LLM can calibrate trust before reading evidence.
```
Intelligence Score: 3/3 core
  KG: ✓ 39 nodes · 41 edges · 31 embedded
  AST: ✓ 9 file(s) fully analyzed
  Codex: ✗ 0 past debug session(s) matched
  Archive: ✗ 0 past verified fix(es) found
```

### Layer 0.2 — Dependency Manifest
`loadDependencyManifest(projectRoot)` — reads `package.json` (Node), `requirements.txt` (Python), or `go.mod` (Go). Returns runtime deps, dev tools, engine constraints. The LLM can reason about the framework stack without guessing.

### Layer 0.3 — Git Context
`getGitContext(projectRoot)` — runs five `git` commands (14-day activity, 30-day churn, recent commits, unstaged+staged changes). Cached per HEAD hash in `.unravel/git-context.json` — only re-executes when HEAD changes. Zero API calls. Tagged `[GIT TRUST: HIGH - deterministic from live git log]`.

### Layer 0.4 — Human-Written Context Files
`loadContextFiles(projectRoot)` — auto-scans for `README.md`, `CHANGELOG.md`, `ARCHITECTURE.md`, `CONTRIBUTING.md`, `how-*.md`, `arch*.md`, `guide-*.md`, and files listed in `.unravel/context.json`. Injects them into §0 with trust levels:
- `CHANGELOG.md`, `HISTORY.md` → **HIGH** trust (documented decisions)
- Everything else → **MEDIUM** trust

The LLM is explicitly told: *"where these conflict with §2 AST facts, AST wins."*

**`.unravel/context.json` — user-controlled override:**
You can add any file you want injected into every `consult` call:
```json
{
  "include": ["how_unravel_works.md", "docs/subsystem-payments.md"],
  "trust": { "how_unravel_works.md": "high" },
  "maxCharsPerFile": 8000
}
```
This is the **recommended way to share architectural documents, ADRs, and runbooks** with the oracle. Files you personally authored and vouch for should be marked `"high"` trust.

### Layer 0.5 — JSDoc/TSDoc KG Enrichment
`extractJsDocSummary(content)` — a zero-cost regex function (no tree-sitter, no API) that runs during `build_map` and during `consult` cold builds. It scans each file's raw source for:
- `/** ... */` blocks immediately before a top-level `function`/`class`/`const`/`let`/`var`
- Meaningful single-line `//` comments directly above a declaration

The first match (≤150 chars, `@param`/`@returns` stripped) is prepended to the heuristic role description in the KG node's `fileSummary`. Result visible in §1 out-of-scope enrichment:
```
✗ embedding.js "Unravel's semantic embedding layer — Semantic layer: embeddings + search. Key: embedText, embedImage."
```
Four code paths are covered: `build_map` full rebuild, `build_map` incremental patch, `consult` cold build, `consult` incremental patch.

> [!IMPORTANT]
> These five layers are completely independent from the Diagnosis Archive, Task Codex, and Pattern Store. They require no past debugging sessions — they work from the very first `consult` call on a fresh project. A **rebuild of the KG** (`build_map` or first `consult`) is needed to pick up JSDoc enrichment on existing projects.

---

## Repo-Level Context — The Missing Layer (Strategic Analysis)

### What we currently have

| Layer | What it covers | Who writes it |
|---|---|---|
| Knowledge Graph | File structure, imports, call edges, JSDoc summaries | `build_map` (automatic) |
| Oracle §0 | Git activity, dependency stack, human-authored docs | `consult` (automatic) |
| Task Codex | Past bugs and their solutions | Agent during debugging |
| Patterns + Archive | Structural patterns + past diagnoses | `verify PASSED` (automatic) |

### What the KG does NOT cover

The KG knows that `PaymentService.ts` imports `OrderItem.ts`. It does not know:
- The payment flow has a legal requirement to log every charge attempt
- The `v1/` API is intentionally frozen for backwards compat — never refactor
- `authContext` must never be accessed from a Worker thread (architectural invariant)
- All new services must implement `IRetryable` (team convention)

These are **intentional architectural facts** — not structurally detectable, not derivable from bug history.

### The Repo Atlas — proposed shape

```
.unravel/
  atlas/
    repo-atlas.md              top-level: what this repo does, subsystem map, owners
    subsystem-payments.md      payment invariants, SLAs, compliance constraints
    subsystem-auth.md          security constraints, never-change-without-review list
    conventions.md             naming, patterns, style decisions
    constraints.md             tech debt, performance SLAs, legacy contracts
```

### How it integrates with query_graph

```
query_graph(symptom)
  existing:  searchCodex()   -> pre_briefing   (past bug solutions)
  new:       searchAtlas()   -> repo_context   (architectural constraints for files being touched)
```

Agent gets: "here's where this bug appeared before" AND "here are the invariants you must not break."

### Verdict

**Solo dev / small team:** No gap. Task Codex + KG + Oracle §0 is sufficient. Architectural decisions fit in one head.

**Large company (100+ engineers, complex domain):** Real gap. The Codex grows from bugs. The KG grows from structure. Neither captures architectural intent that hasn't surfaced as a bug yet — the constraints that survive team turnover.

> [!IMPORTANT]
> The Repo Atlas is the natural next evolution of Unravel's memory. NOT redundant with the KG (structure). NOT redundant with the Codex (bug history). NOT the same as patterns (AST-detectable rules). It is the intentional human-authored layer — **why the code is the way it is**. For enterprise customers this is the highest-value context piece because it's the one no automated system can generate correctly alone.

**Critical constraint:** The Atlas must be a deliberate human artifact. Auto-generating it risks encoding LLM hallucinations as authoritative architectural decisions. The write flow must be human-gated — like writing ADRs (Architecture Decision Records), not auto-generated from code.

---

## Acknowledgements

Unravel's design philosophy and several architectural concepts were informed by prior work in the open-source community:

1. **[circle-ir](https://github.com/cogniumhq/circle-ir)** (Cognium) — For pioneering the multi-pass reliability and performance analysis pipeline.
2. **[Understand-Anything](https://github.com/Lum1104/Understand-Anything)** — For inspiring the fusion of graph-based and semantic code navigation.
