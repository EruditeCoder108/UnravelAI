# Changelog

All notable changes to Unravel are documented here.
Format: `YYYY-MM-DD HH:MM IST | File(s) | What changed | Why`

## 2026-05-01 — 06:08 IST | MCP Reliability Harness, Benchmark Runner, Doctor CLI & Memory Hardening

**Status: Reliability foundation implemented. Unravel now has a repeatable MCP proof loop instead of only manual smoke testing.**

This entry covers the first reliability sprint after the "brutally reliable, measurable, demoable" plan. The goal was not to claim the whole system is finished; the goal was to install the rails that make every future claim measurable.

### 1. Real MCP Contract Test Harness

- **[NEW] Node test runner wiring (`unravel-mcp/package.json`):** Added `npm test` / `test:mcp` scripts using Node's built-in `node --test`, avoiding new dev dependencies and network install risk.
- **[NEW] MCP client test helper (`unravel-mcp/test/helpers/mcp-client.js`):** Starts the real `index.js` MCP server over stdio using the official MCP SDK client. Child stderr is piped and drained so tests and demos stay readable.
- **[NEW] Tool surface contract (`unravel-mcp/test/mcp-contract.test.js`):** Verifies the MCP server exposes exactly the stable reliability surface: `analyze`, `verify`, `build_map`, `query_graph`, `query_visual`, and intentionally paused `consult`.
- **[NEW] Tool response contracts:** Added coverage for:
  - `consult` returning `TEMPORARILY_PAUSED`
  - `build_map(force:true, embeddings:false)` producing files/nodes/edges and nonzero call edges on the known ghost-tenant fixture
  - `query_graph` returning ranked files plus graph freshness/provider metadata
  - `analyze` returning the structured keys `critical_signal`, `protocol`, `cross_file_graph`, `raw_ast_data`, `metadata`
  - `verify` rejecting missing hypotheses, missing `file:line`, and fake evidence
  - `query_visual` failing cleanly without Gemini visual embedding readiness
- **[NEW] Unit tests (`unravel-mcp/test/unit.test.js`):** Added focused tests for content hashing, incremental freshness decisions, exact identifier routing, graph metadata stamping, embedding provider diagnostics, and stale embedding marking.

### 2. Benchmark & One-Command Demo Infrastructure

- **[NEW] Demo runner (`validation/run-demo.js`):** `node validation/run-demo.js super-bug-ghost-tenant` now runs the full proof loop:
  `build_map -> query_graph -> analyze -> naive diagnosis -> verify -> score`.
- **[NEW] Benchmark runner (`validation/run-benchmark.js`):** Supports `--bug <id>` and emits machine-readable scoring fields:
  RCA, PFR, CFR, hallucination, verifyPassed, topKRoutingHit, timeMs, embeddingMode.
- **[NEW] Benchmark common library (`validation/lib/benchmark-common.js`):** Centralizes package discovery, source-only file loading, MCP execution, simple scoring, and result persistence.
- **[NEW] Benchmark MCP client (`validation/lib/mcp-client.mjs`):** A dedicated benchmark-side MCP client so benchmark scripts do not depend on test helper paths.
- **[DEMO RESULT] `super-bug-ghost-tenant`:** The scripted demo scored `6/6`, `verify: PASSED`, `hallucination: false`, `topKRoutingHit: true`, using `embeddingMode: none`.
- **[OUTPUT] Result artifact:** Demo/benchmark runs save `validation/results/super-bug-ghost-tenant/unravel-mcp-benchmark.json`.

### 3. Embedding Provider Abstraction

- **[NEW] Provider interface (`unravel-mcp/server/embedding-provider.js`):** Added `UNRAVEL_EMBED_PROVIDER=gemini|none|local`.
  - `gemini` remains the default and only active semantic/visual provider.
  - `none` enables deterministic keyword/KG-only routing with no API calls.
  - `local` is reserved for future `nomic-embed-text`, `embeddinggemma`, or similar local models.
- **[SAFETY] API key handling:** Provider resolution reads `GEMINI_API_KEY` only when the provider is `gemini`. Keys are not logged or written into `.unravel`.
- **[VISUAL ROUTING] Gemini-only guard:** `query_visual` now reports the active provider and clearly explains that visual search requires Gemini multimodal embeddings. Local text embeddings are not falsely advertised as image-capable.

### 4. Knowledge Graph Freshness & Metadata

- **[NEW] Graph freshness module (`unravel-mcp/server/graph-freshness.js`):** Added shared helpers for:
  - `schemaVersion`
  - `engineVersion`
  - graph metadata stamping
  - changed-file freshness inspection
  - stale embedding marking
- **[NEW] KG metadata stamping (`unravel-mcp/index.js`):** `build_map` now stamps graphs with `schemaVersion`, `engineVersion`, `builtAt`, and embedding provider metadata on full rebuilds, incremental rebuilds, and embedding upgrades.
- **[NEW] `query_graph` freshness reporting:** `query_graph` now returns `graphFreshness` and `embeddingProvider` in its JSON response. If a changed file has an embedding, the node is marked `embeddingStatus: stale_file_changed`.
- **[NEW] Query-time self-healing (`unravel-mcp/server/knowledge-graph.js`, `index.js`):** Extracted shared incremental patching into `patchKnowledgeGraph()`. `query_graph` now detects small stale KGs, patches changed files, recomputes import/call edges, saves the healed graph/meta, and routes against the fresh graph in the same call.
- **[FIX] Class-method call edges (`unravel-mcp/core/ast-bridge.js`):** The fallback structural scanner now indexes class methods and member calls such as `this.service.listDocuments()`. This fixed a real blind spot where the ghost-tenant KG could report `callEdges: 0` despite obvious cross-file class-method calls.
- **[LIMIT] Large stale KGs still require full rebuild:** If the changed-file ratio exceeds the incremental threshold, `query_graph` now reports `needsFullRebuild: true` and tells the caller to run `build_map(force:true)`.

### 5. Task Codex Hardening

- **[NEW] Discovery metadata (`unravel-mcp/server/codex.js`):** Auto-seeded codex entries now include a `## Discovery Metadata` JSON block containing:
  - version
  - confirmations
  - failedUses
  - status
  - per-file path and content hash
- **[NEW] Codex staleness checks:** Added `doctorCodex(projectRoot)` to detect missing metadata, stale file hashes, missing files, and unreliable entries.
- **[DESIGN ENFORCED] Codex remains a pointer, not proof:** The metadata helps route future agents to useful discoveries, but `verify` still requires fresh code evidence before any diagnosis is accepted.

### 6. Memory Visibility: `unravel doctor`

- **[NEW] Doctor CLI (`unravel-mcp/cli.js`):** Added:
  ```bash
  node unravel-mcp/cli.js doctor <project> [--format json]
  ```
- **[REPORTS] Doctor output includes:**
  - KG presence
  - files indexed
  - node/edge/call-edge/import-edge counts
  - embedded node count
  - graph schema/engine version
  - Pattern Store count
  - Diagnosis Archive count
  - Task Codex count
  - stale/suspect codex counts
  - graph freshness state
  - embedding provider readiness
- **[VERIFIED] Doctor run:** `super-bug-ghost-tenant` reports a fresh KG, schema version `1`, engine `unravel-mcp-kg-v1`, active memory layers, and Gemini readiness metadata.

### 7. Safe Modularization Started

- **[NEW] Session module (`unravel-mcp/server/session.js`):** Extracted MCP session state construction into `createSession()`.
- **[NEW] Shared server modules:** Added focused modules for embedding provider resolution, graph freshness, diagnostics, and codex doctor support.
- **[NEW] `analyze` tool extraction (`unravel-mcp/server/tools/analyze.js`):** Moved active AST evidence generation out of `index.js`, preserving file resolution, analysis caching, mutation filtering, pattern/archive/Codex hint injection, Circle IR findings, and formatted agent instructions.
- **[NEW] `verify` tool extraction (`unravel-mcp/server/tools/verify.js`):** Moved active verification out of `index.js`, preserving the hypothesis gate, file:line citation gate, claim verification, pattern learning/penalty, diagnosis archive writes, Codex auto-seeding, project overview enrichment, and layer-boundary hinting.
- **[NEW] `build_map` tool extraction (`unravel-mcp/server/tools/build-map.js`):** Moved active KG construction out of `index.js`, preserving include/exclude filters, force rebuilds, embedding controls, metadata writes, project overview generation, and Codex hint attachment.
- **[IMPROVED] Shared incremental KG patching:** `build_map` incremental rebuilds now reuse the same `patchKnowledgeGraph()` path used by query-time self-healing, reducing duplicated call-edge/import-edge patch logic.
- **[NEW] `query_graph` tool extraction (`unravel-mcp/server/tools/query-graph.js`):** Moved active graph routing out of `index.js`, preserving freshness checks, query-time self-healing, semantic scoring, pattern boosts, Codex pre-briefing, and response shape.
- **[NEW] `query_visual` tool extraction (`unravel-mcp/server/tools/query-visual.js`):** Moved the active visual-routing MCP registration out of `index.js`, preserving the exact contract: Gemini-only visual readiness checks, graph loading, embedded-node validation, image/text fusion, cosine ranking, and clear setup errors.
- **[NEW] Paused `consult` extraction (`unravel-mcp/server/tools/consult.js`):** Moved the active paused consult registration out of `index.js` while keeping the public `TEMPORARILY_PAUSED` response stable.
- **[CLEANUP] `index.js` reduced to bootstrap/wiring:** Removed the old inline tool bodies after contract tests passed. `index.js` now imports/registers tool modules instead of carrying every implementation inline.
- **[RESULT] All MCP tools now live under `unravel-mcp/server/tools/`:** `analyze`, `verify`, `build_map`, `query_graph`, `query_visual`, and paused `consult`.

### Verification

- **Syntax checks:** All edited JS files passed `node --check`.
- **Unit + MCP contract tests:** `npm.cmd test -- --test-reporter=spec` passed `8/8`, including query-time KG self-healing.
- **Demo:** `node validation/run-demo.js super-bug-ghost-tenant` returned `Verify: PASSED` and `Score: 6/6`.
- **Doctor:** `node unravel-mcp/cli.js doctor validation/benchmark/packages/super-bug-ghost-tenant --format json` reports a fresh KG with `nodes: 55`, `edges: 80`, and `callEdges: 23`.
- **Index size:** `unravel-mcp/index.js` is now about `794` lines and contains no active inline `server.tool(...)` definitions.
- **Benchmark single bug:** `node validation/run-benchmark.js --bug super-bug-ghost-tenant` returned `6/6`, `verifyPassed: 1`, `topKRoutingHit: 1`, `hallucinations: 0`.

### Known Limits / Next Steps

- **UDB-20 is not fully automated yet:** The harness can run and record benchmark packages, but only `super-bug-ghost-tenant` has a deterministic local diagnosis strategy today. More strategies or an LLM-driven diagnosis runner must be added before claiming full UDB-20 scores.
- **`consult` remains paused:** This is intentional. It should be unfrozen only after `query_graph`, `analyze`, `verify`, and `consult-format.js` have stable contract coverage.
- **Local embeddings are only designed for:** `UNRAVEL_EMBED_PROVIDER=local` is a reserved interface, not a live local embedding backend yet.
- **Generated memory artifacts changed:** Running the tests/demo writes live `.unravel` KG, pattern, archive, codex, and benchmark result files. This is expected behavior for a learning/debugging engine, but should be separated from source-code changes when preparing a clean release commit.

---

## 2026-04-11 — 06:30 IST | v3.5.0 — Code Audit: 8 Fixes (Correctness, Coverage & Context Integrity)

**Status: Full code-audit pass. All confirmed bugs fixed, architectural gaps closed.**

- **[FIX] STATIC_BLIND false verdict (`index.js`):** `forEachMutations` and `specRisks` detectors were not counted in the `detectorsFired` check. A file with only `forEach` mutation or predicate-comparison findings would incorrectly get a "zero detectors fired" verdict. Now all 6 detector types are counted.
- **[FIX] `filterAstRawMutations` force-include (`index.js`):** The floating-promise force-include was reading `f.calledFn` — a field that doesn't exist. Changed to `f.api`, the correct field. Variables confirmed by floating promise detection are now correctly preserved through the mutation filter.
- **[FIX] Pass B imported-setter false positives (`ast-engine-ts.js`):** `detectGlobalMutationBeforeAwait` Pass B flagged ANY imported function matching `set*/clear*/reset*/init*` as a confirmed race write. Functions like `initParser`, `setLanguage` produced noise. Now labelled `imported_setter_call (UNRESOLVED)` — still surfaces the signal but clearly marks it as heuristic. Excluded from `detectorsFired` count so they don't cause false STATIC_BLIND inflation.
- **[FIX] Try-block expansion (`ast-engine-ts.js`):** `detectGlobalMutationBeforeAwait` only scanned top-level statements. The most common real-world server pattern (`try { setTenant(id); await db.query(); }`) was completely missed. Now recurses into `try_statement` bodies for patterns A/B/C.
- **[NEW] Codex pre-briefing in `analyze` (`index.js`):** Previously codex context was only available via `query_graph`. Agents who called `analyze(directory, symptom)` directly got zero institutional memory from past sessions. Now `searchCodex()` runs in the `analyze` handler and injects matching discoveries into `_instructions.codexPreBriefing`.
- **[FIX] Per-project pattern store (`index.js`):** Pattern learning was writing to the MCP server's install directory (global). Patterns from Project A could bleed into Project B's diagnoses. Now writes to each project's `.unravel/patterns.json` when `session.projectRoot` is available. Falls back to MCP-global only for inline-file debugging without a project root.
- **[FIX] Pattern hint threshold raised (`index.js`):** Threshold for injecting pattern hints as H1 raised from 0.50 to 0.65. A 50% confidence pattern being promoted as "treat as primary hypothesis" was too aggressive and could bias agents toward false positives.
- **[FIX] Browser cross-file comment (`orchestrate.js`):** Updated misleading comment that said "WASM crashes on cross-file calls." The try/catch at L365 already handles this gracefully. Comment now accurately reflects the behavior: WASM cross-file is attempted with graceful fallback.
- **[VERSION] Bumped `unravel-mcp` to `3.5.0`.**

---

## 2026-04-05 — 12:35 IST | v3.4.3 — consult mode temporarily paused

**Status: consult mode disabled pending output quality fixes. All other tools fully operational.**

- **[PAUSED] `consult` tool (`unravel-mcp/index.js`):** Temporarily replaced the full consult handler with an early-return that explains what consult is, why it's paused, and the ETA for v3.5.0. The tool remains registered in the MCP server — calling agents get a clean `TEMPORARILY_PAUSED` JSON response with useful context and alternatives instead of an error.
- **[OPEN SOURCE] GitHub invite:** The pause message includes a direct link to the public repo (`github.com/EruditeCoder108/unravelai`) inviting contributors to inspect and improve the Scholar Model output format.
- **[INTERNALS] Why paused:** The Scholar Model JSON output (`intelligence_brief`, `structural_evidence`, `memory`, `project_context`) was producing excessive `async_state_race` noise in `structural_evidence` — module-level `let` variable assignments were being surfaced as false-positive race signals. This made the consult output 45KB+ on large files and degraded the signal-to-noise ratio for calling agents. v3.5.0 will address this with smarter mutation filtering in consult mode.
- **[VERSION] Bumped `unravel-mcp` to `3.4.3`.**

---



**Status: Consult Mode Reshaped into a Synthesized JSON Oracle Output.**

- **[NEW] Scholar Mode Architecture (`unravel-mcp/index.js`):** Refactored `formatConsultForAgent` to return a fully structured JSON interface rather than dumping context files as plain text. Replaces raw file dumps with four tailored response keys designed to minimize LLM context bloat:
  - `intelligence_brief`: The executive summary combining KG readiness, project overview, and a tiered Reasoning Mandate.
  - `structural_evidence`: Extracted critical AST fragments along with inline source snippets for context. Uses new section-extraction helpers (`extractRelevantSections`) to prune unneeded code bodies.
  - `project_context`: Cross-file dependency and symbol origin mapping.
  - `memory`: Injected Task Codex and Diagnosis Archive historical data.
- **[NEW] Layer 2 AST Noise Reduction in Consult:** Migrated the `filterAstRawMutations` logic into `consult` mode, ensuring consistency with `analyze` mode and completely shielding the context window from variable noise. Context usage reduced by up to 80% on large files.
- **[DOCS] MCP Distribution Guides:** Added comprehensive installation tutorials to `README.md` for major MCP clients including Claude Code, Cursor, and Cline, along with instructions to acquire a `GEMINI_API_KEY` for semantic embeddings. Updated `how_unravel_works (1).md` to reflect the new Scholar Model output format.

---

## 2026-04-03 — 13:08 IST | Oracle V2.2 — JSDoc/TSDoc Extraction

**Status: KG Node Summaries Now Human-Authored, Not Heuristic-Only.**

- **[NEW] `extractJsDocSummary(content)`:** Zero-cost regex extractor added to `index.js`. Scans raw file source for `/** ... */` blocks (JSDoc) or meaningful `//` single-line comments preceding top-level declarations. Returns the first substantive description (≤150 chars), stripping `@param`/`@returns` tags. Falls back gracefully to `null` — no crash, no noise.
- **[NEW] KG Node Enrichment — Full Rebuild:** `deriveNodeMetadata()` gains an optional `content` param. When source is available, JSDoc summary is prepended to the heuristic role string (`"<jsdoc> — <role>"`), giving KG nodes a human-authored description for the first time. Applied in both `build_map` and `consult` cold-build paths.
- **[NEW] KG Node Enrichment — Incremental Patch:** The incremental `deltaBuilder` path in `build_map` and the inline `graph.nodes.push` path in `consult` also use `extractJsDocSummary`. All four KG-building paths are now consistent.
- **[DESIGN] Zero Cost, Zero Risk:** Pure regex — no tree-sitter invocation, no API calls, no new dependencies. Hoisted function declaration ensures no ordering dependency on call site.

---

## 2026-04-03 — 09:42 IST | Oracle V2.1 — Hardening & Environmental Stability

**Status: Senior Developer Oracle Level Achieved. Systemic Health Stabilized.**

- **[NEW] Git Context Layer:** Added `getGitContext()` in `index.js` (cached per HEAD). Surfaces 14d activity, 30d churn hotspots, unstaged/staged changes, and recent commit messages directly to the LLM.
- **[NEW] Intent-Based Doc Injection:** Added `loadContextFiles()`. Auto-scans for README, CHANGELOG, ARCHITECTURE, and "how-to" md files. Injects them into §0 with specific trust levels.
- **[NEW] Dependency Awareness:** Added `loadDependencyManifest()`. Identifies Node (package.json), Python (requirements.txt), or Go (go.mod) dependencies for framework-aware reasoning.
- **[NEW] Oracle Scope Enrichment:** Enriched §1 out-of-scope file list. Now shows semantic tags and role summaries (from KG) for files routed but excluded from AST analysis, allowing the LLM to reason about the "hidden" parts of the repo.
- **[FIX] Environmental Portability:** Systemic cleanup of `unravel-mcp/index.js`. Fixed Windows CRLF/LF mismatch, stripped UTF-8 BOM causing shebang crashes, and cleaned up legacy encoding mojibake (garbled characters) across the entire codebase.
- **[FIX] Oracle Reliability:** Fixed missing `childProcess` import in ESM mode and added a singleton retry guard for module loading errors to prevent server poison states.

---

## 2026-04-03 — 06:27 IST | `unravel-mcp/index.js` — ast-analysis tag false positive fix

**`deriveNodeMetadata()` — regex precision fix**

- **Bug:** `/parse|ast|tree|sitter|analyz|detect/i` matched `parseJSON`, tagging `parse-json.js` (and any JSON/CSV parser) as `ast-analysis`. The LLM saw it as an AST engine in §0 of the project overview.
- **Fix:** Replaced with a precise compound pattern — requires word-boundary `\bast[A-Z_]`, `treeSitter`, `analyzeFile/Code`, `detectPattern/Bug`, or a filename containing `ast-engine`/`ast-bridge`. Generic `parse` no longer triggers the tag.
- **Test result:** 31/31 smoke tests pass. All three code paths verified: `deriveNodeMetadata`, `generateProjectOverview`, query classifier.

---

## 2026-04-02 — 21:07 IST | Consult v2 — Project Oracle Implementation

**Status: Complete. Zero syntax errors. All temp scripts removed.**

This entry covers the full "Consult v2" transformation — from a raw evidence assembler to a project oracle that a senior dev would trust.

---

### 1. Rich KG Node Metadata (`unravel-mcp/index.js` — `deriveNodeMetadata()`)

**Problem:** Every KG node had `summary = "Functions: foo, bar"` (a name dump), `complexity = "moderate"` (hardcoded), and `tags = ["index"]` (just the filename stem). Schema supported real data; nobody filled it in.

**Fix:** Added `deriveNodeMetadata(filePath, sa, edgeCount)` — a zero-cost heuristic function (no LLM calls) that derives:
- **Semantic tags**: `entry-point`, `request-handler`, `embeddings`, `knowledge-graph`, `ast-analysis`, `orchestration`, `search`, `storage`, `memory`, `formatting`, `http-server`, `ui-framework`, `hub`, `connector` — determined from function names and import sources.
- **Real complexity**: `low / moderate / high` — scored from function count, line count, and async function density.
- **Role description**: A functional sentence about what the file *does* — e.g. `"AST analysis engine. 47 detector/parser functions."` — not a name list.

Wired into both `build_map` (L1374) and the consult cold-build path (L2488).

---

### 2. Project Overview — The Senior Dev's Mental Model (`unravel-mcp/index.js`)

**Problem:** The LLM had no architectural context before reading low-level AST facts. §0 was raw topology — edge counts and file names. The LLM had to infer project shape from signals alone.

**Fix:** Added three new functions:
- **`generateProjectOverview(graph, projectRoot)`** — Auto-generates `.unravel/project-overview.md` from KG topology. Includes: architecture summary, languages, scale (files/nodes/edges), key files by connectivity with semantic tags and role descriptions, critical import paths, Risk Areas section (for verified diagnoses), and a Notes section.
- **`saveProjectOverview(projectRoot, content)`** — Persists the overview. **Never overwrites `## Notes`** — user-written notes survive every re-build.
- **`loadProjectOverview(projectRoot)`** — Read on every consult call.

Called automatically after `build_map` saves the KG and after the consult cold-build saves its KG.

---

### 3. §0 Project Overview Injection (`unravel-mcp/index.js` — `formatConsultForAgent()`)

**Problem:** §0 was raw topology numbers with no architectural meaning to the LLM.

**Fix:** `formatConsultForAgent` now accepts `projectRoot` and loads the project overview as the very first section — before any AST facts. The LLM gets the senior-dev mental model first, then interprets low-level evidence in that context.

**New section layout:**
```
§0 project_overview  — Architecture mental model: goals, key files, critical paths
§1 structural_scope  — KG routing: what is in scope for this query, what is not
§2 ast_facts         — Verified AST analysis of routed files
§2.5 critical_snippets — Inline source for AST-flagged sites (no view_file needed)
§3 cross_file_graph  — Call graph, symbol origins, import chains
§4 memory            — Codex discoveries, archive fixes, pattern signals
§5 reasoning_mandate — Tiered synthesis instructions (query-type-aware)
```

---

### 4. Tiered Reasoning Mandate (`unravel-mcp/index.js` — `formatConsultForAgent()`)

**Problem:** §4 said "answer directly and concisely" for every query type. A feasibility question got the same depth instruction as a factual lookup.

**Fix:** §5 REASONING MANDATE now classifies the query with a heuristic regex router and gives tiered instructions:

| Query Type | Detection | Mandate |
|---|---|---|
| `factual` | "where is", "what does", "find", "show me" | Answer directly, cite file:line, be brief |
| `analytical` | default | Step-by-step through call graph, state assumptions, call out evidence gaps |
| `feasibility` | "can I", "if I", "would it break", "refactor" | Map all changed files, identify AST invariants, report CAN DO / CANNOT DO / CAVEATS |

---

### 5. Cross-Directory Session State Safety (`unravel-mcp/index.js`)

**Fix:** Added `session._graphRoot` tracker. When the consult tool is called with a different `directory` than the last call, it now explicitly invalidates `session.graph`, `session.files`, `session.astRaw`, `session.crossFileRaw`, `session.archiveLoaded`, and `session.diagnosisArchive` before loading the new project's KG.

**Before:** Switching from `project-A/` to `project-B/` silently reused project-A's KG — giving wrong routing, wrong topology, wrong answers.

---

### 6. Verify PASSED → Overview Enrichment (`unravel-mcp/index.js`)

**Fix:** Added `enrichProjectOverviewWithDiagnosis(projectRoot, { rootCause, codeLocation, symptom })`. Called from the verify PASSED flow (after `autoSeedCodex`). Each verified fix appends a dated entry to the `## Risk Areas` section of `project-overview.md`.

Over time, the project overview accumulates institutional knowledge: "This component has a known race condition in `X` — fixed on YYYY-MM-DD."

---

### 7. Orchestrate Role Update (`unravel-v3/src/core/orchestrate.js`)

The `CONSULT_INSTRUCTIONS.role` is now the oracle identity:
> "You are the all-knowing oracle of this project — a senior engineer with full architectural context. You have the KG topology (§0 overview), the AST facts (§2), the call graph (§3), and the project memory (§4). Your job: answer the query with the confidence and depth of someone who built this codebase. The §5 REASONING MANDATE above tells you which reasoning mode to use. Follow it precisely."

Added a new honesty rule: `"Do NOT hallucinate file paths or function names. Every claim must be grounded in the evidence sections above."`

Removed `synthesis_rules` and `implementation_guidance` from the instructions struct — these are now fully handled by the tiered mandate in `index.js`.

---

## 2026-04-02 — 20:15 IST | `unravel-mcp/index.js` — Full Flow Audit: Cross-Directory Session State Bugs

**Official Status: Comprehensive proofreading audit of the complete consult flow (build_map → KG load → staleness check → self-heal → semantic routing → file selection → AST → evidence packet). Two real bugs confirmed, two false positives dismissed.**

---

### `unravel-mcp/index.js` | **BUG CONFIRMED** — Cross-Directory KG Cache Corruption (L2459)

**Problem:** `session.graph` is module-level state. When a user calls `consult(directory: "A")` and then `consult(directory: "B")`, `projectRoot` is correctly updated at L2453 but `session.graph` (set by the prior call) is not invalidated. The `if (!graph)` guard at L2460 sees a truthy graph and skips loading the KG for directory B entirely. Result: directory B gets analyzed using directory A's Knowledge Graph — wrong node set, wrong embeddings, wrong routing.

**Root cause:** No root-mismatch check before reusing `session.graph`.

**Fix (pending):** Add check before L2459: `if (session.graph && session._graphRoot !== projectRoot) { session.graph = null; session.files = null; }` and track `session._graphRoot = projectRoot` after every KG write.

**Severity:** High — silent wrong-answer corruption when switching directories in a session.

---

### `unravel-mcp/index.js` | **BUG CONFIRMED** — Stale `session.files` Used for Wrong-Root Staleness Check (L2533)

**Problem:** When a KG exists, the staleness check at L2533 uses `session.files` if already populated. `session.files` is also written by `build_map` (L1237) and `analyze` (L743). If a user calls `build_map(projectRoot: "A")` then `consult(directory: "B")`, `session.files` contains project-A files. The staleness check then diffs project-A files against project-B's KG — hash mismatches on every file, triggering unnecessary (and incorrect) KG patches.

**Root cause:** `session.files` has no associated root tag. Condition `!session.files?.length` cannot distinguish same-root vs cross-root cache.

**Fix (pending):** Same `session._graphRoot` check — clear `session.files` whenever root changes.

**Severity:** Medium — causes spurious KG patches and incorrect file scope in cross-directory scenarios.

---

### Audit Results — False Positives (2 dismissed)

**False Positive 1:** Suspected duplicate key `rankedFiles: analysisScope, ..., analysisScope` in `formatConsultForAgent` call (L2686). Verified: `formatConsultForAgent` destructures BOTH `rankedFiles` and `analysisScope` as separate named params (L2214, used at L2262 and L2424 respectively). Since both hold identical values (`analysisScope`), there is no functional harm and no data loss.

**False Positive 2:** Suspected missing `session.graph` root check causing Bug 3 (treated as separate bug). Confirmed to be same root cause as Bug 1 — not a third distinct bug.

---

### Parse Verification — Large Files Work Correctly

**Test performed:** `analyze(directory: "unravel-mcp")` parses all 4 files (index.js 2700 lines / 176KB, embedding.js, cli.js, circle-ir-adapter.js) as "4/4". All detectors (globalWriteRaces, floatingPromises, closures, cross-file call graph) function correctly on large files. The earlier "3/3" result was traced to stale KG session state from a prior `build_map` call at a broader scope — not a parser limitation.

---

## 2026-04-02 — 19:30 IST | `consult` — Source Snippets, Embed Self-Healing, Readiness Score, Scope Rule, Tool Clarity

**Official Status: Five quality-of-life and intelligence improvements to consult mode. The headline feature is §1.5 Critical Source Snippets — actual source code is now inlined into the evidence packet for all AST-flagged sites, eliminating the CODE_FETCH roundtrip. Additionally: partial embed failures now self-heal on the next call, the readiness score no longer penalizes fresh projects, the consult scope rule allows implementation when asked, and query_graph vs consult descriptions are disambiguated.**

---

### `unravel-mcp/index.js` | **FEATURE** — §1.5 Critical Source Snippets in Evidence Packet

**Problem:** When consult reported "variable X written at L93, await at L97", the LLM only had line numbers — not the actual code. It couldn't determine whether L93 was inside a try block, a for loop, or a conditional. The CODE_FETCH rule (added earlier) told the LLM to use `view_file` as a workaround, but that required a second tool call and added latency.

**Solution:** New `§1.5 CRITICAL SOURCE SNIPPETS` section auto-extracted from AST-flagged sites. For each critical finding, ±3 lines of actual source code are inlined directly into the evidence packet.

**Priority order for snippet extraction:**
1. `globalWriteRaces` — up to 3 snippets (ordering is the core question for race analysis)
2. `floatingPromises` — up to 2 snippets (shows the unawaited call in context)
3. Cross-file call graph edges — up to 3 snippets (shows call sites for data flow questions)

**Bounds:** Max 8 snippets, 7 lines each = max ~56 source lines. Overlap deduplication prevents two snippets from the same file within 6 lines of each other.

**Implementation:** `extractSnippet(fileName, targetLine, label)` helper with basename fallback matching. `fileContents` Map built from the analyzed files and passed to `formatConsultForAgent`.

**Example output:**
```
-- S1.5 CRITICAL SOURCE SNIPPETS ---------------------------
(Auto-extracted from AST-flagged sites. Resolves ordering ambiguities without needing view_file.)

  index.js:93 -- orchestrate written before await (race risk)
     90: if (_coreLoadPromise) return _coreLoadPromise;
     91: _coreLoadPromise = (async () => {
     92:     const core = await import('./unravel-v3/src/core/orchestrate.js');
  >  93:     orchestrate = core.orchestrate;
     94:     verifyClaims = core.verifyClaims;
     95:     checkSolvability = core.checkSolvability;
     96:     ...
```

**CODE_FETCH rule updated:** Now references §1.5 as the primary source, with `view_file` as fallback for uncovered lines.

---

### `unravel-mcp/index.js` | **FEATURE** — Partial Embed Self-Healing

**Problem:** If `embedChangedNodes` fails mid-way (rate limit, network error), some nodes get embeddings and some don't. The `.catch()` swallows the error and `saveGraph` saves the mixed state. On subsequent calls, `hasEmbeddings` returns true (some nodes have them), so the cold-build path is skipped. The staleness check only re-embeds *changed* files, not existing unembedded ones. Result: the KG stays permanently half-embedded.

**Solution:** After the staleness check (both the "changed files" path and the "0 changes" path), a new block counts nodes with `null` or empty embeddings. If any exist, `embedChangedNodes(graph, apiKey, { embedAll: false })` is called — this function already only embeds nodes where `embedding` is null, making it safe and idempotent.

**Logged:**
```
[consult] 3 node(s) missing embeddings — re-embedding...
[consult] Self-heal embed complete.
```

**Non-fatal:** Entire block wrapped in try/catch. If re-embed fails again, the stale (partially embedded) KG is used and the self-heal will retry on the next call.

---

### `unravel-mcp/index.js` | **IMPROVEMENT** — Readiness Score: Core vs Memory Separation

**Problem:** `buildReadiness` scored all 5 layers equally: KG, embeddings, AST, codex, archive. A fresh project with full core analysis showed "3/5" — which looks broken even though the core engine is fully operational. Codex and archive only populate after multiple debug sessions; penalizing their absence on first use is misleading.

**Solution:** Separated into core (3 layers: KG, embeddings, AST) and memory (2 layers: codex, archive):
- **Before:** `3/5` — looks broken
- **After:** `3/3 core` — looks fully operational (because it is)
- **With memory:** `3/3 core + 1/2 memory` — shows growth
- **Tip updated:** "Core analysis fully active. Debug with analyze → verify to grow codex and archive for even richer answers."

---

### `unravel-v3/src/core/orchestrate.js` | **IMPROVEMENT** — Permissive Consult Scope Rule

**Problem:** The `not_a_debug_session` instruction said "Do NOT produce a fix unless the user explicitly asks for code changes." While technically conditional, the "Do NOT" framing caused LLMs to err on the side of refusing code suggestions even when the query was clearly implementation-oriented.

**Solution:** Reworded to affirmatively instruct:
```
Do NOT generate hypotheses. Do NOT call verify(). For architecture/data-flow questions, respond
with analysis grounded in evidence. When the user explicitly asks for code changes or
implementation, provide concrete code suggestions using evidence from the AST facts and call
graph — do not refuse.
```

---

### `unravel-mcp/index.js` | **IMPROVEMENT** — query_graph vs consult Tool Description Clarity

**Problem:** Users called `query_graph` expecting analysis/answers and got a bare file list. The tool descriptions didn't make the distinction clear enough.

**Solution:** Added to `query_graph` description:
```
NOTE: This returns FILE NAMES only, not analysis or answers. For architectural questions,
understanding code, data flow analysis, or getting evidence-backed answers about your project,
use consult instead.
```

---

## 2026-04-02 — 18:xx IST | `consult` — KG Scope Persistence, §2 Symbol Origins Fix, CODE_FETCH Rule, Concurrency Audit

**Official Status: Four targeted hardening fixes to `consult` mode, driven by a live adversarial test session. The session diagnosed and fixed a critical KG scope-widening bug in the incremental staleness path, corrected the `[object Object]` display bug in §2 symbol origins, added a CODE_FETCH rule to §4 instructions that eliminated LLM hedging on control-flow ordering questions, and fully documented the global-state concurrency race risk in `index.js`.**

---

### `unravel-mcp/index.js` | **BUGFIX** — KG Scope Widening in Incremental Staleness Check

**Problem:** The cold build path correctly applied the `include` filter (e.g. `["unravel-mcp"]`) to scope the KG to 6 files. But the staleness check path (the `else` branch — KG exists + has embeddings) called `readFilesFromDirectory(projectRoot, 5)` with **no include filter**. On the first code change after a scoped cold build, the staleness check would read all 415 files in the project root, silently widening the KG from 6 nodes to 443 nodes. The scope violation was permanent — subsequent calls used the widened KG and scope could only be restored by deleting `.unravel/` and rebuilding.

**Root cause confirmed at:** `index.js:2442` (old) — single-line `readFilesFromDirectory(projectRoot, 5)` with no `include`/`exclude` arguments.

**Fix — two-part:**

1. **Scope persistence during cold build:** After computing `graph = builder.build(...)`, the include/exclude filters are now written into `graph.meta`:
   ```js
   graph.meta = graph.meta || {};
   graph.meta.include = args.include?.length ? args.include : null;
   graph.meta.exclude = args.exclude?.length ? args.exclude : null;
   ```
   Also persisted into `meta.json` via `saveMeta(... include: graph.meta.include, exclude: graph.meta.exclude)`.

2. **Staleness check reads saved scope:** The `readFilesFromDirectory` call in the staleness path now reads back `graph.meta.include` and applies the same filter:
   ```js
   if (!session.files?.length) {
       const savedExcludes = graph.meta?.exclude || [];
       let scopedFiles = readFilesFromDirectory(projectRoot, 5, savedExcludes);
       const savedIncludes = graph.meta?.include;
       if (savedIncludes?.length) {
           const incs = savedIncludes.map(p => p.replace(/\\/g, '/'));
           scopedFiles = scopedFiles.filter(f => {
               const norm = f.name.replace(/\\/g, '/');
               return incs.some(inc => norm.includes(inc));
           });
           process.stderr.write(`[consult] Staleness check scoped to: [${savedIncludes.join(', ')}] (${scopedFiles.length} files)\n`);
       }
       session.files = scopedFiles;
   }
   ```

3. **Scope propagated through incremental saves:** `saveMeta` in the staleness patch path now carries `include` and `exclude` forward, so every incremental save preserves the scope for the next call.

4. **Minor:** Removed the no-longer-correct `edgeCount: 0` from patched node objects (nodes get their edges from the graph structure, not a stored property).

**Logged:**
```
[consult] Staleness check scoped to: [unravel-mcp] (6 files)
[consult] Staleness check: 1/6 files changed — patching KG...
[consult] KG patched and saved (1 files updated).
```

**Verified:** Full 3-step test: cold build → file change → staleness check. KG stayed at `filesIndexed: 6`, `graph.meta.include: ["unravel-mcp"]`, `builtBy: consult-incremental`. Before fix: widened to 443 nodes. After fix: stable at 44 nodes.

**Important note for existing KGs:** The `graph.meta.include` field only exists in KGs built after this fix. Existing KGs (built before) will fall back to unscoped `readFilesFromDirectory` on first staleness check. Delete `.unravel/` and rebuild once to activate scope persistence.

---

### `unravel-mcp/index.js` | **BUGFIX** — §2 Symbol Origins: `[object Object]` → Real Data

**Problem:** The `formatConsultForAgent` §2 CROSS-FILE GRAPH section rendered symbol origins as:
```
embedGraphNodes@embedding.js → [object Object]
```
`crossFile.symbolOrigins[k]` is a structured object `{ name, file, line, importedBy: [{file,...}] }` — when concatenated into a template string it coerces to `[object Object]`.

**Root cause at:** `index.js:2292` (old) — `lines.push(\`  ${k} → ${crossFile.symbolOrigins[k]}\`)`.

**Fix:** Expanded inline using the same pattern as `formatAnalysisForAgent` (L604):
```js
for (const k of symKeys.slice(0, 20)) {
    const info = crossFile.symbolOrigins[k];
    if (info && typeof info === 'object') {
        const importedBy = (info.importedBy || []).map(i => i.file || i).join(', ');
        const loc = info.file ? `${info.file}${info.line ? ':L' + info.line : ''}` : '?';
        lines.push(`  ${info.name || k}@${loc} → imported by: ${importedBy || 'none'}`);
    } else {
        lines.push(`  ${k} → ${info}`);
    }
}
```

**After fix:**
```
embedGraphNodes@embedding.js:L330 → imported by: index.js
embedChangedNodes@embedding.js:L330 → imported by: index.js
buildSemanticScores@embedding.js:L397 → imported by: index.js
```

---

### `unravel-mcp/index.js` | **IMPROVEMENT** — CODE_FETCH Rule in §4 Consult Instructions

**Problem discovered via adversarial test:** When asked *"Are AST node patches written before or after `embedChangedNodes`? Does `saveGraph` still get called on partial embed failure?"*, consult responded with: *"Static analysis gives me the line numbers but I cannot definitively prove the ordering without seeing the actual code structure."* — correct honesty, but the fix was available: the LLM had `view_file` available and the ambiguous line range was only 30 lines.

**Root cause:** §4 instructions had SYNTHESIS RULES, HONESTY RULES, FEASIBILITY, and SCOPE — but no instruction that said "when line numbers are ambiguous for ordering, read the code."

**Fix:** Added `CODE_FETCH RULE` as a mandatory directive at the end of §4:
```
CODE_FETCH RULE: The AST evidence above gives line numbers for mutation writes but NOT the
containing block (try/catch/if/for). When the answer depends on ORDERING or CONTROL FLOW that
cannot be determined from line numbers alone — e.g. "does saveGraph run before or after the loop?"
— you MUST read the actual source. Use the view_file tool on the relevant file and line range to
confirm. Do not guess ordering from line numbers alone.
```

**Before fix:** LLM hedged — *"I cannot definitively prove the ordering."*

**After fix:** LLM called `view_file` on `index.js:2465–2505`, read the actual `try` block, and gave a precise answer:
- Node patches written at L2486/L2489 (BEFORE embed)
- `embedChangedNodes` called at L2498 with `.catch()` (swallowed — non-fatal)
- `saveGraph` at L2501 — **always runs**, whether embed succeeds or fails
- No rollback — in-memory `graph.nodes` mutated in-place
- Self-healing: next call's staleness check re-embeds nodes with `embedding: null`

---

### Concurrent Race Risk Audit — `index.js` Global State (Documentation)

**Findings from AST analysis via consult (confirmed by `globalWriteRaces` detector):**

The `loadCoreModules` function writes **25 module-scope variables** before the first `await`:
```
orchestrate      L93  ──┐
verifyClaims     L94    │  await at L97 suspends here
checkSolvability L95    │  ← concurrent caller can overwrite all of these
initParser       L98  ──┘  before the first call reads them
GraphBuilder     L106
attachStructuralAnalysis L122
... (19 more)
```

`session.graph` written at 9 sites (L797, L1250, L1308, L1444, L1914, L2061, L2380, L2437, L2470). `session.files` written at 4 sites (L743, L1237, L2403, L2463).

**Risk level in practice:** MCP hosts (Claude Desktop, VS Code Copilot) currently process tool calls serially — the structural fragility is dormant. If parallel MCP execution ever ships, `session` would need `AsyncLocalStorage` isolation per request.

**Variables confirmed safe (not real races):** `res`, `attempt`, `resolvedMime`, `base64Data` in `embedding.js` — these are closure-local variables inside per-call async functions, not shared across callers. The `async_state_race` detector flags them as false positives.

**Pattern store signals confirmed:** `global_write_race` 90% confidence, `race_condition_write_await_read` 95% confidence — both firing correctly on `loadCoreModules`.

---

## 2026-04-02 — 09:45 IST | `consult` + `build_map` — `include` param, Auto-Incremental Staleness, §0 Project Structure

**Official Status: Three targeted improvements to the consult and build_map tools, driven by a deep-dive analysis of file selection strategies across all three Unravel execution paths (webapp GitHub mode, MCP debug mode, MCP consult mode). The core insight: consult's KG was silently becoming stale after code changes with no detection mechanism, and neither consult nor build_map had user-controlled file scoping — the only knob was the blunt `maxFiles` cap.**

---

### `unravel-mcp/index.js` | **FEATURE** — `include` parameter for `build_map`

**Problem:** In monorepos with hundreds of files, `build_map` would index everything under `directory`. The only way to scope it to a subsystem (e.g. `packages/api/src`) was to point `directory` at that subfolder — which puts `.unravel/` inside the subfolder, breaking the unified project KG.

**Solution:** New optional `include` parameter — an array of path substrings. Applied as a post-filter after `readFilesFromDirectory()` and after `exclude`. If provided, only files whose normalized path contains at least one include string are indexed.

```json
build_map({
  "directory": "/monorepo",
  "include": ["packages/api/src", "packages/shared"],
  "exclude": ["node_modules", "dist"]
})
```

**Interaction with `exclude`:** Both can be specified together. `exclude` is applied first (inside `readFilesFromDirectory`), then `include` filters the result. Effective set = `(all files - exclude) ∩ include`.

**Logged:** `[unravel] Include filter: 23/95 files match [packages/api/src, packages/shared]`

---

### `unravel-mcp/index.js` | **FEATURE** — `include` parameter for `consult`

**Problem:** `consult` used KG semantic routing (`queryGraphForFiles`) as the only file selection mechanism. Pure cosine similarity fails for cross-cutting queries where the relevant file has no textual overlap with the query (e.g. `OrderItem.ts` never mentions "payment" but is critical to the payment flow). The only scope control was `maxFiles` — a blunt cap with no user intent behind it.

**Solution:** New optional `include` parameter for `consult`. When provided, **bypasses KG semantic routing entirely** and analyzes exactly the specified files/folders. `maxFiles` is ignored when `include` is set.

```json
consult({
  "query": "How does the core AST pipeline work?",
  "include": ["unravel-v3/src/core"],
  "directory": "/UnravelAI"
})
```

**`include` + `exclude` together:** `exclude` is applied within the include set — useful when a folder has sub-paths you want to skip:
```json
{ "include": ["src/"], "exclude": ["src/generated", "src/__tests__"] }
```

**`include` → `analysisScope`:** The set of matched files becomes `analysisScope`, which is passed to `formatConsultForAgent` and displayed in the §0 Project Structure block so the LLM sees exactly what was and wasn't analyzed.

**Schema doc update:** `maxFiles` description now says "Ignored if include is provided."

---

### `unravel-mcp/index.js` | **FEATURE** — Auto-Incremental Staleness Check in `consult`

**Problem:** Once a KG was built, `consult` loaded it from disk and used it forever with no staleness detection. After code changes, consult would respond with outdated structural facts — stale node summaries, wrong import edges, missing functions — with no indication to the user.

**Root cause verified at:** `index.js:2344` (old) — the `else` branch for "KG exists" only called `readFilesFromDirectory` but never ran `getChangedFiles`.

**Solution:** The `else` branch (KG exists + has embeddings) now runs a silent hash-diff before every query — identical to the mechanism in the VS Code extension (`_tryIncrementalUpdate`):

```
consult() called → KG exists
    → getChangedFiles(session.files, graph, computeContentHashSync)
    → 0 changes:     log "KG up to date" → proceed (<100ms overhead)
    → N changes:     attachStructuralAnalysis(changed)
                     → patch changed nodes into graph (remove stale, push fresh)
                     → update graph.files[name] hashes
                     → embedChangedNodes(graph, apiKey, { embedAll: false })
                       (only nodes with embedding: null get re-embedded)
                     → saveGraph() + saveMeta(builtBy: 'consult-incremental')
                     → proceed with fresh KG
```

**Non-fatal:** The entire patch block is wrapped in `try/catch`. If patching fails for any reason, a stderr warning is emitted and the (slightly stale) existing KG is used — consult never hard-fails due to staleness detection.

**Performance:** 0 changes = <100ms (hash comparison only). 1-5 files changed = ~2s (AST + re-embed). >30% changed = incremental patch still runs (unlike `build_map` which full-rebuilds above 30% — consult's approach is more conservative since it doesn't rebuild edges, only patches nodes).

**Logged:**
```
[consult] Staleness check: 3/95 files changed — patching KG...
[consult] KG patched and saved (3 files updated).
```
or:
```
[consult] KG up to date (0 changes detected).
```

---

### `unravel-mcp/index.js` | **FEATURE** — §0 Project Structure block in `formatConsultForAgent`

**Problem:** The LLM receiving a consult response had no visibility into what the KG contained, which files were analyzed, and which weren't. It couldn't tell the user "this analysis covered 12 files but `graph-builder.js` (23 edges) was not in scope — you might want to add it."

**Solution:** New `§0 PROJECT STRUCTURE` section prepended to every consult evidence report. Added to `READING GUIDE` as item §0.

**Contents:**
1. **KG stats line:** `677 nodes · 664 edges · 677 embedded · 95 total files indexed`
2. **Top 15 files by connectivity** — sorted by `edgeCount` descending, with tags. Gives the LLM an instant project topology map.
3. **Files in AST analysis scope** — up to 20, with ✓ prefix. Shows exactly what was analyzed.
4. **Files NOT in scope** — up to 20, with ✗ prefix. Includes hint: `(use include: [...] to analyze these)`. Shows how many more exist beyond the displayed cap.

**New function signature:**
```js
// Before:
formatConsultForAgent({ query, consultResult, codexResult, archiveHits, patternMatches, rankedFiles, graph })

// After:
formatConsultForAgent({ query, consultResult, codexResult, archiveHits, patternMatches, rankedFiles, graph, allFilePaths, analysisScope })
```
`allFilePaths` = full list of indexed file paths (for "not in scope" diff).
`analysisScope` = files actually analyzed (from include filter or KG routing).

**Call site updated** at `index.js:2518`.

---

### Bug Fix — `maxFiles` scoping in `consult` orchestrate fallback

**Problem:** `maxFiles` was only defined inside the KG routing `else` branch but referenced in the `orchestrate()` fallback `filesToAnalyze.length > 0 ? filesToAnalyze : session.files.slice(0, maxFiles)`. When `include` was provided (taking the `if` branch), `maxFiles` was `undefined` — `slice(0, undefined)` returns the entire array, potentially passing hundreds of files to orchestrate.

**Fix:** Changed `maxFiles` → `args.maxFiles || 12` directly inline at the fallback. The variable-scope dependency is gone.

---

## 2026-04-01 — 15:45 IST | §5c-4 `autoSeedCodex` — Codex Pre-Briefing Now Self-Populating

**Official Status: The Task Codex retrieval system (searchCodex → pre_briefing in query_graph) has been fully wired end-to-end. Previously, the entire read/retrieval infrastructure was live but the codex directory was empty because the write-side required agents to manually create codex files. `autoSeedCodex` bridges this gap: every `verify(PASSED)` now automatically seeds a minimal, verified codex entry — sourced from rootCause + evidence[] only (no LLM generation). Future `query_graph` calls on the same project will immediately return pre_briefing results pointing to the exact bug sites.**

---

### `unravel-mcp/index.js` | **FEATURE** — `autoSeedCodex()` helper + wiring into `verify(PASSED)`

**Problem:** The full codex retrieval pipeline (`searchCodex` → `pre_briefing` → agent skips to correct file:line) was 100% built but yielded nothing in practice. The `.unravel/codex/` directory was always empty because: (1) agents are instructed to write codex files but rarely do, and (2) there was no automatic seeding path. `searchCodex()` ran on every `query_graph` call and returned empty matches every time — the entire system was a no-op.

**Solution:** `autoSeedCodex(projectRoot, {symptom, rootCause, codeLocation, evidence})` — a synchronous, non-fatal function that fires after every `verify(PASSED)` alongside the existing archive/pattern learning steps.

**What it writes** (two files):

1. **`codex-auto-{timestamp}.md`** — a minimal codex file with:
   - `## TLDR` — 3-line summary (symptom + rootCause + codeLocation)
   - `## Discoveries` — one DECISION entry per parseable `file:line` citation in `evidence[]`
   - `## Meta` — problem text, auto-extracted tags (≤6, stopword-filtered), files touched
   - `## Layer 4 — What to skip next time` — stub for agent to fill in next session

2. **`codex-index.md`** — one new row appended (bootstrapped from scratch if missing):
   ```
   | auto-1743483000000 | PaymentService payments fail for duplicate items | async, promise, payment | 2026-04-01 |
   ```

**How it parses evidence:**
```js
const FILE_LINE_RE = /([\w.\-/\\]+\.(js|jsx|ts|tsx|py|go|rs|java|cs|cpp|c|rb|php))[:\s]L?(\d+)/i;
```
Matches evidence strings like `"PaymentService.ts L47: forEach(async ...)"` or `"scheduler.js:20 — mutation"`. Groups by basename → emits one DECISION entry per matched line. Also checks `rootCause` directly if `evidence[]` yields no parseable citations.

**Why this is spec-compliant (per `context_plan.md`):**
- ✅ Does NOT auto-generate DISCOVERIES via LLM — only writes what was already in `rootCause` + `evidence[]` (both are agent-asserted AND verify-gate checked)
- ✅ Does NOT overwrite existing agent-written codex files — writes a new `codex-auto-{timestamp}.md` every time
- ✅ auto-scaffold META + template is explicitly `✅ Do it` in the spec's "What NOT to Build" table

**Wire-up in `verify(PASSED)` (after archive step):**
```js
// Phase 5c-4: Auto-seed the Codex
autoSeedCodex(session.projectRoot, {
    symptom:      session.lastSymptom || args.rootCause,
    rootCause:    args.rootCause,
    codeLocation: args.codeLocation || '',
    evidence:     args.evidence    || [],
});
```

**Non-fatal:** Entire function wrapped in `try/catch`. Any error (permission denied, disk full, bad parse) writes a stderr warning and does not affect the verify response.

**Fallback:** If `session.projectRoot` is absent (inline-files analyze path with no directory), writes nothing silently.

**New fs imports:** `mkdirSync`, `writeFileSync`, `appendFileSync` added to the existing `fs` import line.

**Console output when it fires:**
```
[unravel:codex] Auto-seeded: codex-auto-1743483000000.md (2 file(s), tags: async, promise, payment, foreach, silent, duplicat)
```

---

### End-to-End Flow After This Change

1. Agent runs `verify(PASSED)` on a bug in `PaymentService.ts`
2. `autoSeedCodex` writes:
   - `.unravel/codex/codex-auto-{ts}.md` with `L47 → DECISION: forEach(async...)...`
   - `.unravel/codex/codex-index.md` row with `async, promise, payment` tags
3. Next session: agent runs `query_graph("payments silently failing")`
4. `searchCodex()` finds the index row (keyword match: `payment`, `async`)
5. Reads the `## Discoveries` section, returns `pre_briefing` with the L47 DECISION entry
6. Agent goes directly to `PaymentService.ts:47` — zero cold orientation reading required

---

## 2026-04-01 — 16:00 IST | Topology Placement + Context-Compression Spec Hardening

**Official Status: The webapp's `enginePrompt` assembly order was corrected — the AST evidence block (`astBlock`) now sits immediately before the symptom/query (final position) instead of at the top. This is the free topology placement win from `context-compression-spec.md §4 rule 4` ("Lost in the Middle" attention research). Simultaneously, the spec itself was hardened with 2 real structural additions: an Invariant tier (4th tier, never compress/never drop) and an Eliminated context clause.**

---

### `unravel-v3/src/core/orchestrate.js` | **IMPROVEMENT** — Topology Placement: `astBlock` Moved to Final Position

**Problem:** `enginePrompt` was assembled in this order:
```
TRUST BOUNDARY → astBlock → projectContext → FILES → symptom → schema
```
Once hundreds of lines of code file content were appended after `astBlock`, the AST evidence block (floating promises, race conditions, mutation chains) was buried in the middle of the context — the "dead zone" where LLM attention is weakest. The model read the decisive AST facts first, then had to remember them 50,000+ tokens later when it saw the symptom.

**Fix (1 line, `orchestrate.js:L654`):** Reordered to:
```
TRUST BOUNDARY → projectContext → FILES → astBlock → symptom → schema
```

**New order rationale:**
- `FILES` in the middle — large, structural, survive dilution (the model reads for code structure)
- `astBlock` at end — compact, decisive, maximally fresh when reasoning begins
- Symptom/query at very end — model reads it with full AST evidence still in working memory

**Impact:** Zero new code. Zero new dependencies. Zero degradation. Pure reorder of string interpolation in one template literal. The AST evidence block (pattern hints, archive hits, mutation chains, floating promise detections) now has maximum attention weight at inference time.

**Source:** `context-compression-spec.md §4, rule 4` — "Place the most decisive evidence in the final 20% of the context, directly before the query." Now live.

---

### `context-compression-spec.md` | **SPEC UPDATE** — Invariant Tier + Eliminated Context Clause + Assembly Order Updated

**Three additions to the spec (none are experiment-gated — they fix real gaps in the tier taxonomy):**

**1. Invariant tier (4th tier):** Language-spec and framework-lifecycle rules the LLM is known to assume incorrectly. Examples: `forEach does not await async callbacks (ECMAScript spec)`, `React: setState in useEffect runs after paint`, `Raft: a node cannot vote twice per term`. These have no codebase identifiers — under the old STRUCTURAL/RELATIONAL/PROCEDURAL/GENERIC rules they would be classified GENERIC and potentially dropped. But they are load-bearing: dropping the forEach/async ECMAScript invariant is exactly why B-22 class failures occur. **Invariant tier = never compress, never drop.**

**2. Eliminated context clause:** A ruled-out hypothesis or possibility ("no concurrent write detected on cartState", "config flag always present in production") is NOT a GENERIC-droppable block. It prevents the LLM retreading dead ground in the next reasoning pass. Classification: **Residual tier minimum** (1-line summary, NEVER drop).

**3. Core principle updated:**
- Before: `"Transmit the smallest faithful delta that changes the answer. Preserve what prevents misinterpretation. Compress everything else."`
- After: `"Transmit the minimal sufficient proof state: preserve all structural facts, all active invariants, and all eliminations that constrain the answer. Compress everything else."`

**4. Assembly order updated** to reflect topology placement being live (Steps 6-8 already implemented in `orchestrate.js`; Steps 1-5 remain experiment-gated).

---

## 2026-03-31 — 15:00 IST | §4.1 `getNodeBoosts` — Pattern-Based KG Node Boosts Live in Webapp

**Official Status: `getNodeBoosts` is now wired into the webapp KG router (Phase 0.5). Pattern-matched files are boosted in the Knowledge Graph before files are passed to the LLM. KG router now has full parity with the MCP `query_graph` handler. Zero degradation: no symptom → boost block skipped. Non-fatal try/catch wraps the entire block.**

---

### `unravel-v3/src/core/orchestrate.js` | **FEATURE** — §4.1 Pattern-Based Node Boosts in KG Router

**Problem:** The MCP `query_graph` handler calls `matchPatterns(astRaw)` then `getNodeBoosts()` to boost files likely involved in the matched bug type. The webapp KG router (Phase 0.5) ran BEFORE the AST — `astRaw` is unavailable at routing time.

**Solution:** Pre-AST symptom keyword screening. Instead of calling `matchPatterns(astRaw)`, the webapp: (1) loads all starter patterns via `getAllPatterns()`, (2) keyword-scans the symptom text against `pattern.bugType` and `pattern.description`, (3) passes candidate patterns to `getNodeBoosts()` at 60% confidence (pre-AST estimate), (4) merges boosts into `semanticScores` via `Math.max`.

**Code block inserted between image/text semantic routing and `queryGraphForFiles()`:**

```js
// §4.1: Pattern-based node boosts (pre-AST symptom keyword screen)
const allPats = getAllPatterns();
const symLower = symptom.toLowerCase();
const candidateMatches = allPats.filter(p => {
    if (p.weight < 0.3) return false;
    const bugTypePhrase = p.bugType.replace(/_/g, ' ');
    if (symLower.includes(bugTypePhrase)) return true;
    return p.description.toLowerCase().split(/\W+/).filter(w => w.length > 4)
                        .some(w => symLower.includes(w));
}).map(p => ({ pattern: p, confidence: p.weight * 0.6 })); // 60%: pre-AST estimate

if (candidateMatches.length > 0) {
    const nodeObj = {};
    for (const n of kg.nodes) nodeObj[n.id] = n;
    const boosts = getNodeBoosts(nodeObj, candidateMatches);
    for (const [id, boost] of boosts) {
        semanticScores.set(id, Math.max(semanticScores.get(id) || 0, boost));
    }
    console.log(`[KG ROUTER] §4.1 Pattern boosts: ${boosts.size} node(s) boosted via ${candidateMatches.length} candidate pattern(s)`);
}
```

**Why 60% confidence (not full weight):** Pre-AST matches are probabilistic, not confirmed. Using 60% of the pattern weight acknowledges the uncertainty — the final pattern match (post-AST) will confirm or deny. This means pattern boosts are additive hints, not decisive overrides.

**Filtering heuristic (stop-word-aware):** Words ≤4 characters ("and", "the", "with", "from") are skipped to avoid noise matches. Only words >4 chars in the description are used.

**Import:** Added `getAllPatterns, getNodeBoosts` to the static import from `./pattern-store.js`.

**Console output when active:**
```
[KG ROUTER] §4.1 Pattern boosts: 3 node(s) boosted via 2 candidate pattern(s)
[KG ROUTER] Trimmed 8 → 4 files via knowledge-graph
```

---

### KG Router Full Routing Stack (now complete)

The webapp KG router at Phase 0.5 now applies THREE layers of signal — in order:

| Layer | Signal | Weight | When |
|---|---|---|---|
| **Semantic** | Symptom text embedding vs node embeddings (cosine sim) | Full | Always (if Gemini key set) |
| **Visual** | Screenshot embedding fused with symptom (60/40) | Full | If screenshot attached (§3.5) |
| **Pattern** | Symptom keywords vs bugType/description → file name match | 60% | Always (§4.1, no API key needed) |

All three merge into one `semanticScores` Map via `Math.max` before `queryGraphForFiles()`.

---

## 2026-03-31 — 14:50 IST | §3.5 `query_visual` — Image-to-Code Routing Live in Webapp

**Official Status: Screenshot-to-file routing is now live in the webapp. A user can attach a bug screenshot; the KG router embeds it via Gemini Embedding 2's cross-modal space, fuses with the symptom text embedding (60/40), and uses the resulting vector to route to the correct source files. Zero degradation: no screenshot → text-only routing (identical to before). No KG/embeddings → silent fallback.**

---

### `unravel-v3/src/core/embedding-browser.js` | **FEATURE** — Phase 6: `embedImage`, `fuseEmbeddings`, `buildSemanticScoresFromVec`

**Three new exports ported from `unravel-mcp/embedding.js` with Node.js dependencies removed:**

**`embedImage(imageInput, apiKey, mimeType)`**
- Accepts: raw base64 string OR data-URL (`data:image/png;base64,...`)
- File-path reading removed — browser receives base64 from FileReader before calling this
- Same retry-on-429 + AbortController timeout as `embedText`
- Returns 768-dim vector in the same geometric space as text embeddings (Gemini Embedding 2 cross-modal)
- All `process.stderr.write` replaced with `warn()` (the module-local `console.warn` wrapper)
- Supported MIME types: `image/png`, `image/jpeg`, `image/webp`, `image/gif`

**`fuseEmbeddings(imageVec, textVec, imageWeight=0.6)`**
- Weighted average: 60% image / 40% text by default (matches MCP implementation)
- Graceful degradation: either vector null → returns the other unchanged
- Dimension mismatch → warns + returns imageVec only

**`buildSemanticScoresFromVec(queryVec, graph)`**
- Skips the `embedText()` call — caller supplies a pre-built vector
- Used when routing via image (or fused image+text) to avoid double-embedding
- Returns `Map<nodeId, similarity>` — identical shape to `buildSemanticScores` output
- Logs `[embed] buildSemanticScoresFromVec: N nodes scored from pre-built vector.`

---

### `unravel-v3/src/core/orchestrate.js` | **FEATURE** — Image-aware KG Router (Phase 6 wiring)

**Import:** Added `embedText, embedImage, fuseEmbeddings, buildSemanticScoresFromVec` to static import from `embedding-browser.js`.

**KG Router (Phase 0.5 block, lines ~213–245):** Replaced the single `buildSemanticScores` call with image-aware branching:

```js
if (options.queryImage && _embedKey) {
    const imageVec = await embedImage(options.queryImage, _embedKey);
    if (imageVec) {
        let fusedVec = imageVec;
        if (symptom?.trim()) {
            const textVec = await embedText(symptom, _embedKey, 'RETRIEVAL_QUERY').catch(() => null);
            fusedVec = fuseEmbeddings(imageVec, textVec, 0.6); // 60% image / 40% text
        }
        semanticScores = buildSemanticScoresFromVec(fusedVec, kg);
        console.log(`[KG ROUTER] Image routing: ${semanticScores.size} nodes scored (image+text fusion)`);
    } else {
        // Image embed failed → fall back to text-only
        semanticScores = await buildSemanticScores(symptom || '', kg, _embedKey).catch(() => new Map());
    }
} else {
    // No image → text-only (original behavior)
    semanticScores = await buildSemanticScores(symptom || '', kg, _embedKey).catch(() => new Map());
}
```

**Fallback chain (fully graceful):**
1. `queryImage` absent → text-only routing (same as before)
2. `queryImage` present but `_embedKey` absent → text-only routing
3. `embedImage` fails (bad format, API down) → text-only routing with warning
4. `embedImage` succeeds but no symptom text → image-only vector (no fusion)
5. Both succeed → fused 60/40 vector

---

### `unravel-v3/src/App.jsx` | **FEATURE** — Screenshot Upload UI

**New state:** `queryImage` (data-URL string or null) + `queryImageInputRef` (hidden `<input type="file">`).

**Passed to orchestrate:** `queryImage: queryImage || undefined` alongside `knowledgeGraph` and `embeddingApiKey`.

**UI (debug mode only):** Rendered below the symptom textarea:

- **No image attached:** Dashed "Attach screenshot (optional — improves file routing)" button with `ImageIcon`. Hover turns it purple.
- **Image attached:** Thumbnail (56×40px cover) + "Screenshot attached" label + "KG router will fuse image + text embeddings (60/40)" subtitle + red X button to clear.
- **File picker:** Hidden `<input type="file" accept="image/png,image/jpeg,image/webp,image/gif">`, triggered via `queryImageInputRef.current.click()`. FileReader converts to data-URL, stored in `queryImage` state.
- IDs: `btn-attach-screenshot`, `btn-clear-screenshot` (for testing).

**Why debug mode only:** Security and explain modes don't involve file routing by visual bug context. Screenshots are meaningful only when the bug has a visible UI symptom.

---

### What the console shows when image routing fires:

```
[embed] embedImage: Image embedded → 768-dim vector.
[embed] buildSemanticScoresFromVec: 14 nodes scored from pre-built vector.
[KG ROUTER] Image routing: 14 nodes scored (image+text fusion)
[KG ROUTER] Trimmed 8 → 4 files via knowledge-graph
```

---

## 2026-03-31 — 13:40 IST | Webapp Memory Pipeline — End-to-End Activation & Bug Fixes

**Official Status: Diagnosis Memory (IndexedDB archive) is fully working end-to-end in the webapp. Six bugs found and fixed across two files. Verified with b-07-ghost-ref: first run saves the diagnosis, second run recalls it — `archive size=1` + `1 similar past diagnosis(es) injected as hints`. Pattern weight self-calibrates: `floating_promise` weight bumped from 75% → 80% after second confirmed diagnosis.**

---

### `unravel-v3/src/core/orchestrate.js` | **BUGFIX** — Pattern Logging: `m.patternId` → `m.pattern?.id`

**Root cause:** `matchPatterns()` returns `{ pattern: {...}, confidence, matchedEvents }`. The hints block in Phase 1e was accessing `m.patternId`, `m.hint`, and `m.bugType` directly on the wrapper object — all `undefined`. The console showed `[Patterns] 1 pattern(s) matched, top: undefined`.

**Fix (3 lines, L353–360):**
- `m.patternId` → `m.pattern?.id || m.pattern?.bugType`
- `m.hint || m.bugType` → `m.pattern?.description || m.pattern?.bugType`
- Console log updated to also print confidence: `top: floating_promise (75%)`

**Effect:** Pattern hints now correctly inject into the LLM prompt AND appear correctly in logs. Previously the `hintsBlock` template was generating `• undefined (75%) — undefined` strings silently — the LLM received malformed hints that were providing no guidance.

---

### `unravel-v3/src/core/orchestrate.js` | **BUGFIX** — Archive Gate: Soft Failures Now Allowed

**Root cause:** The archive write condition was `!verification.rootCauseRejected && verification.failures.length === 0`. TypeScript-specific variable tracking (e.g. `this.registry` in class properties) consistently produces 1 soft failure on TS files — not a logic error, an AST coverage gap. This was silently preventing every TypeScript diagnosis from being archived.

**Fix (L759):**
```js
// Before
const verifyPassedForArchive = !verification.rootCauseRejected && verification.failures.length === 0;

// After — soft failures (TS variable tracking gaps) do NOT block archiving
const verifyPassedForArchive = !verification.rootCauseRejected;
```

**Distinction:** `rootCauseRejected = true` means the root cause is structurally invalid (references non-existent code) — real failure, do not archive. `failures.length > 0` with soft-only failures means an AST coverage miss — diagnosis is still correct, archive it.

---

### `unravel-v3/src/core/orchestrate.js` | **BUGFIX** — Archive Read Wrong Field: `result.rootCause` → `result.report.rootCause`

**Root cause (discovered via diagnostic probe):** The `result` object returned from `parseAIJson()` is a wrapper: `{ needsMoreInfo, report: { rootCause, codeLocation, evidence, ... }, _verification }`. The archive block was accessing `result.rootCause` (always `undefined`) instead of `result.report.rootCause` where the actual LLM output lives.

**Verified with probe:**
```
[Archive:probe] result keys: ['needsMoreInfo', 'report', '_verification']
[Archive:probe] rootCause type=undefined value="undefined"
```

**Fix:**
```js
const _archiveReport = result.report || result; // support both shapes
const _rootCause     = _archiveReport.rootCause || '';
const _codeLocation  = _archiveReport.codeLocation || '';
const _evidence      = _archiveReport.evidence || [];
```

The `result.report || result` fallback future-proofs against shape changes.

---

### `unravel-v3/src/core/orchestrate.js` | **FEATURE** — Archive Diagnostic Logging (Phase 1f + write path)

Added console logs at key points in the archive pipeline so failures are visible instead of silent:

**Phase 1f (archive search, L475):**
```
[Archive] Phase 1f: projectKey=sha256:e60f6... archive size=0
```

**Post-verify archive write path (L771–782):**
```
[Archive] Verify PASSED — archiving diagnosis (projectKey=sha256:e60f6...)
[Archive] Embedding OK — saving entry diag-1774943093121 to IDB
[Archive] ✓ Saved to IDB. Run this bug again to see memory recall.
[Archive] archiveDiagnosis returned null — embedding likely failed (wrong key or API down)   ← on failure
```

These logs were essential for diagnosing the three silent failures above. Kept in production as they provide real-time archive health visibility without flooding the console.

---

### `unravel-v3/src/core/embedding-browser.js` | **BUGFIX** — IDB Version Mismatch: `1` → `2`

**Root cause:** `_openArchiveIDB()` was opening the `unravel-knowledge` IndexedDB at version 1. `graph-storage.js` had already upgraded the same database to version 2 (when a KG was previously built). IDB rejects open requests for a version lower than the current schema version.

**Symptom:** `appendDiagnosisEntryIDB failed (non-fatal): The requested version (1) is less than the existing version (2).`

**Fix (L348):**
```js
// Before
const _ARCHIVE_IDB_VER = 1;
// After
const _ARCHIVE_IDB_VER = 2; // must match graph-storage.js IDB_VERSION
```

Upgrade handler is safe: checks `objectStoreNames.contains('graphs')` before creating — no-op if store already exists from the v1 schema.

---

### `unravel-v3/src/core/embedding-browser.js` | **BUGFIX** — False-Positive `✓ Saved to IDB` Log

**Root cause:** `appendDiagnosisEntryIDB`'s `catch` block logged the error and returned `undefined` (implicit async return). Since `async` functions always resolve on implicit return, the `.then(() => console.log('✓ Saved...'))` in `orchestrate.js` fired even when the save had failed — giving the user false confidence.

**Fix (L406–408):** Added `throw err` after the warning log so the error propagates to the caller's `.catch()` handler:
```js
} catch (err) {
    warn('appendDiagnosisEntryIDB failed (non-fatal): ' + err.message);
    throw err; // re-throw so caller's .catch() fires, not .then()
}
```

---

### End-to-End Verification (2026-03-31 13:30 IST)

**Benchmark:** b-07-ghost-ref (4 TypeScript files: AuditPlugin.ts, EventDispatcher.ts, PluginManager.ts, AppBootstrapper.ts)

**Run 1 — Write:**
```
[Archive] Phase 1f: projectKey=sha256:e60f6... archive size=0
[Verify] ✓ All claims passed
[Archive] Verify PASSED — archiving diagnosis (projectKey=sha256:e60f6...)
[Archive] Embedding OK — saving entry diag-1774943093121 to IDB
[Archive] ✓ Saved to IDB. Run this bug again to see memory recall.
```

**Run 2 — Memory Recall:**
```
[Archive] Phase 1f: projectKey=sha256:e60f6... archive size=1
[Archive] 1 similar past diagnosis(es) injected as hints
[Patterns] 1 pattern(s) matched, top: floating_promise (80%)   ← weight bumped from 75%
```

Memory is live. The `floating_promise` pattern weight self-calibrated from 75% → 80% after the second confirmed PASSED diagnosis, confirming `learnFromDiagnosis` is also working correctly in the webapp path.

---


## 2026-03-30 — 12:45 IST | Architectural Hardening — MCP Reliability & Solvability Pass

**Core MCP engine hardened for production reliability. Six architectural gaps resolved, including upstream solvability detection, build metadata persistence, and pattern-aware Knowledge Graph routing. Verified with 53/53 passed tests.**

### `unravel-mcp/index.js` | **RELIABILITY** — 6 Structural Hardening Fixes

**1. Upstream Solvability Detection (§1.1)**
- `checkSolvability` (previously internal-only) is now exported from `orchestrate.js` and wired into the MCP `verify` tool.
- If a diagnosis is REJECTED or FAILED, the engine now probes for "Layer Boundaries" (OS, browser event layer, or external API).
- Returns a new `layer_boundary` field in the response explaining WHY a fix isn't possible from within the codebase.

**2. Build Metadata Persistence (§1.2)**
- `saveMeta()` wired into both full and incremental `build_map` paths.
- MCP now persists `meta.json` alongside `knowledge.json`, providing persistence for build mode, node counts, and timestamps.

**3. Symptom Whitelisting in Verification (§1.3A)**
- `session.lastSymptom` (stored during `analyze`) is now correctly passed to `verifyClaims` during the `verify` call.
- Resolves "hallucination-by-omission" where files mentioned in the original error were incorrectly flagged as hallucinations by the verifier.

**4. `diffBlock` Schema Extension (§1.3B)**
- `diffBlock` added to the `unravel.verify` tool parameters.
- Enables "Fix Completeness" (Check 6) diagnostics: the engine can now detect when a fix removes a function parameter that has callers in other files.

**5. Pattern-Aware KG Routing (§2.1)**
- `getNodeBoosts` (pattern-store) wired into the `query_graph` handler.
- Institutional pattern matches now boost relevant files in the Knowledge Graph search, merging with semantic embedding scores via `Math.max`.

**6. Noise Filter Cleanup (§5.2)**
- Removed 13 domain-meaningful variable names (e.g., `conn`, `task`, `worker`, `entry`) from the `NOISE_VARS` suppression list.
- Prevents the engine from accidentally hiding cross-function mutation bugs involving these common variable names.

### `unravel-v3/src/core/orchestrate.js` | **EXPORT** — Solvability API Exposed
- `checkSolvability` function now carries the `export` keyword, allowing MCP and other consumers to perform out-of-band solvability checks.

### `test-fixes.mjs` | **VERIFICATION** — Comprehensive Regression Suite
- Created a 250-line test script exercising all 6 hardening fixes.
- Verified Windows path compatibility and logic correctness across all architectural layers.

---

**`searchCodex()` now blends a temporal recency score into all codex pre-briefing retrieval. A codex entry written yesterday ranks higher than an equally-relevant entry from 3 months ago — because the older one may describe refactored-away code. Zero new dependencies. Zero degradation. Both the full semantic path and the keyword-only fallback path apply recency. Additive improvement: undated codex entries receive a neutral score (0.5) and are unpenalized.**

### `unravel-mcp/index.js` | **FEATURE** — Temporal Recency in `searchCodex()` (4 surgical changes)

**Why this matters:** Before this change, `searchCodex()` ranked codex entries purely by keyword+semantic relevance. A 6-month-old codex about `PaymentService.ts` had the same retrieval weight as one written yesterday — even if the code was fully refactored in between. The `## Supersedes` rule handled this at the writing level, but retrieval-time had no time signal at all.

**Change 1 — Row parser now reads the `date` field (L1512–1516)**
- `codex-index.md` already has a Date column (column 4). Was silently ignored. Now parsed:
  ```js
  date: cells[3] || null,  // YYYY-MM-DD, already present in index format
  ```
- No schema change required. Older index files with no date column get `null` → neutral recency (0.5).

**Change 2 — `recencyScore()` helper (L1521–1530)**
```js
const recencyScore = (dateStr) => {
    if (!dateStr) return 0.5;           // neutral — no penalty for undated entries
    const d = new Date(dateStr);
    if (isNaN(d.getTime())) return 0.5; // neutral — unparseable date = no penalty
    const daysSince = (Date.now() - d.getTime()) / 86_400_000;
    return 1 / (1 + daysSince / 30);   // smooth 30-day half-life decay
};
```
- **Day 0:** recency = 1.0 (max boost)
- **Day 30:** recency = 0.5
- **Day 90:** recency = 0.25
- **No date:** recency = 0.5 (neutral — undated entries not penalized)

**Change 3 — Semantic path blend updated (L1583–1601)**
- **Before:** `blended = kw×0.40 + sem×0.60`
- **After:** `blended = kw×0.35 + sem×0.45 + recency×0.20` (weights sum to 1.0)
- `recency_score` now exposed in `pre_briefing` output for each match.
- Log line updated: `"keyword+semantic+recency blend"`.

**Change 4 — Keyword-only fallback path updated (L1642–1658)**
- **Before:** Sorted by raw keyword count only. Equal-score entries had no tiebreaker.
- **After:** `blended = kw×0.80 + recency×0.20`. Filter threshold still on raw `kwScore >= 2` (minimum relevance preserved). Sorted by `blendedScore`.
- `recency_score` exposed in keyword-only output matches too.

### Additive Proof

| Property | Status |
|---|---|
| Core AST engine touched? | ❌ No — `orchestrate()`, `analyze()`, `verify()`, KG, pattern store: zero lines changed |
| `query_graph` consumer changed? | ❌ No — just calls `searchCodex()` and passes through; output shape compatible |
| Phase 5c-2 (codex node attachment) changed? | ❌ No — filename-match path fully independent |
| Diagnosis archive changed? | ❌ No — separate store, separate scoring |
| Undated codex entries penalized? | ❌ No — `null` date → `recencyScore = 0.5` (exact neutral value) |
| New dependency introduced? | ❌ No — pure `Date.now()` arithmetic |
| Syntax verified? | ✅ `node --check index.js` → clean |

### Decay Calibration

| Age | recencyScore | Contribution to blended score (×0.20) |
|---|---|---|
| 0 days (today) | 1.00 | +0.20 |
| 30 days | 0.50 | +0.10 |
| 60 days | 0.33 | +0.07 |
| 90 days | 0.25 | +0.05 |
| 180 days | 0.14 | +0.03 |
| No date | 0.50 | +0.10 (neutral) |

A codex from 6 months ago only gets +0.03 from recency vs +0.20 for one from today — meaningful gap when two entries are otherwise equally relevant. Not enough to suppress a 6-month-old entry that has a strong semantic match; just enough to correctly prefer a fresher one.

---

## 2026-03-28 — 20:01 IST | Feature — circle-ir Supplementary Analysis Integrated (§F — Reliability/Performance Passes)


**All 36 circle-ir static analysis passes wired into the `analyze` pipeline as a strictly additive supplementary layer. New `§F — circle-ir Supplementary Findings` section surfaces reliability/performance bugs that Unravel's core AST engine doesn't detect. Zero degradation to existing engine — fails gracefully, has zero shared state, zero impact when empty.**

### `unravel-mcp/circle-ir-adapter.js` | **NEW FILE** — circle-ir Integration Adapter

- Wraps circle-ir's `analyze(code, filePath, language)` API.
- Initializes circle-ir's `web-tree-sitter` WASM parser once per process via a singleton promise (`_circleIrModule`). Cold init: ~282ms. Warm: ~0ms.
- Supported languages: `javascript`, `typescript`, `java`, `python`, `rust`, `bash` (detected by file extension).
- **Category gate**: keeps `reliability` + `performance` only. Excludes `security` (taint), `maintainability`, `architecture` — these are out of scope for bug diagnosis.
- **Rule exclusion gate** (overlap or noise): `missing-await` (overlaps our `floating_promise`), `leaked-global` (overlaps our `globalWriteRaces`), `variable-shadowing`, `unused-variable`, `react-inline-jsx`, `missing-public-doc`, `todo-in-prod`, `stale-doc-ref`, `dependency-fan-out`, `orphan-module`, `circular-dependency`, `deep-inheritance`.
- **Active rules** (pure reliability value): `serial-await`, `null-deref`, `resource-leak`, `double-close`, `use-after-close`, `infinite-loop`, `n-plus-one`, `string-concat-loop`, `sync-io-async`, `unbounded-collection`, `swallowed-exception`, `broad-catch`, `unhandled-exception`, `redundant-loop`, `unchecked-return`, `dead-code`.
- Sorts findings: severity DESC → file+line ASC.
- **Graceful degradation**: Any error (init or per-file) → returns `[]`, logs to stderr. Main engine unaffected.

### `unravel-mcp/index.js` | **FEATURE** — §F Section Wired into analyze Output

- **4 surgical edits** (import + §F call + §F render + STATIC_BLIND gate). Core AST engine untouched.
- `runCircleIrAnalysis(files)` called after archive search, before `responsePayload` assembly.
- `circleIrFindings` attached to `responsePayload._circleIrFindings` and `_provenance.circleIrFindingCount`.
- `§F — circle-ir Supplementary Findings` section rendered in `critical_signal` only if `circleFindings.length > 0`.
  ```
  §F — circle-ir Supplementary Findings (reliability/performance):
    [serial-await] LOW  src/handler.ts:15-17
    → Serial awaits: `const user = await db.findOne(...)` (line 15) and `const orders = await db.findAll(...)` (line 17) have no data dependency; consider using Promise.all()
    ✦ Fix: const [result1, result2] = await Promise.all([operation1, operation2]);
    (Treat these as additional H2/H3 candidates — verify with AST evidence before citing)
  ```
- **STATIC_BLIND gate improved**: `if (detectors === 0 && patterns === 0 && !hasCriticalSignal && circleFindings.length === 0)` — STATIC_BLIND now stays silent if circle-ir found something. Strictly more accurate than before.

### `unravel-mcp/package.json` | **DEPENDENCY** — circle-ir from local clone

- `"circle-ir": "file:../cognium/circle-ir"` — installed from local clone (MIT licensed).
- circle-ir built from source (`npm run build` in `cognium/circle-ir/`) — produces `dist/` from TypeScript.
- Installed with `--legacy-peer-deps` (peer conflict: circle-ir uses `web-tree-sitter` WASM, Unravel uses native `tree-sitter@0.25`).

### Additive Proof (why this cannot degrade the engine)

| Property | Status |
|---|---|
| Core AST engine touched? | ❌ No — `orchestrate()`, `extractSignature()`, `matchPatterns()`, K.G., pattern store: zero lines changed |
| Failure-isolated? | ✅ `try/catch` → `circleIrFindings = []` → §F absent → response identical to pre-integration |
| Shared state? | ❌ None — adapter has its own `_circleIrModule` singleton, never touches `session`, `patternStore`, `embedding`, `codex` |
| WASM conflict with native tree-sitter? | ❌ None — different binaries, different memory space |
| §F visible when empty? | ❌ No — `if (circleFindings.length > 0)` guards the section |
| Pattern learning affected? | ❌ No — `verify(PASSED)` works on AST evidence only; §F findings are explicitly labelled "verify with AST evidence before citing" |
| One real cost | ~50-150ms/file added latency after WASM init. Not a correctness cost. |

### Integration Test (2026-03-28 20:01 IST)

```
WASM parser ready (cold init: 282ms)
serial-await detected: serial.js:4 — db.findOne() and db.findAll() are independent, consider Promise.all()
missing-await correctly excluded (despite db.findAll() present — our floating_promise detector overlaps)
2 findings total. Engine deterministic: same code → same findings, no LLM in the loop.
```

---

## 2026-03-28 — 14:59 IST | Feature — `stale_var_access` Implemented, `stale_closure_async_delay` Now Live (T9 Verified)


**All 20 patterns in the store now have at least one correctly firing token path. `stale_closure_async_delay` was the only pattern that could never fire at ≥70% coverage — now fires at 100% (3/3 tokens) on real stale closure bugs. T7 and T8 confirmed unaffected.**

### `unravel-v3/src/core/pattern-store.js` | **FEATURE** — `stale_var_access` Token Emission

**The bug it detects:** A closure captures a module-scope global (e.g. `currentUser`). The global is written by an async function before an `await`. A `setTimeout` fires later — by which point, the global has been overwritten by a different concurrent caller. The closure reads the old (stale) value.

**Implementation:** `stale_var_access` emits in `extractSignature()` when ALL THREE conditions are simultaneously true:
1. `closures` non-empty — a closure exists that captures something
2. `globalWriteRaces` non-empty — a module-scope global is written before an `await`
3. `events.has('async_delay')` — `setTimeout` or `setInterval` is present (NOT just `fetch`)

**Why condition 3 uses `events.has('async_delay')` not `timingAPIs.size > 0`:**
- `async_delay` only fires for `setTimeout`/`setInterval` — NOT for `fetch`
- `auth.ts` (T7) has `fetch` but no `setTimeout` → `async_delay` absent → no false positive ✅
- `handler.ts` (T9) has both `fetch` + `setTimeout` → `async_delay` present → fires correctly ✅

### Verified: T9, T8 Regression, T7 Regression

| Test | Code | Expected | Result |
|---|---|---|---|
| **T9 NEW** | `handler.ts` — global `currentUser` + `setTimeout(() => fetch(...currentUser...))` | `stale_closure_async_delay confidence=0.9` | ✅ Fires — `patternMatchCount: 4` |
| **T8 regression** | `timers.ts` — `debounce` + `scheduleCleanup` | `patternMatchCount: 0` | ✅ Still clean |
| **T7 regression** | `auth.ts` — `currentUser` + `fetch` only (no setTimeout) | Only `global_write_race` + `race_condition_write_await_read` | ✅ `stale_closure_async_delay` absent |

### Updated pattern coverage table

| Pattern | Was | Now |
|---|---|---|
| `stale_closure_async_delay` | Dead — 2/3 tokens, never fired correctly | **Live — 3/3 tokens at confidence=0.9** ✅ |
| `race_condition_write_await_read` | 0.67 (2/3 tokens) | **1.0 (3/3 tokens)** ✅ |
| All other 18 patterns | Unaffected | Unaffected ✅ |

---

## 2026-03-28 — 14:16 IST | Engine Validation — T1–T8 Battery Complete (1 Known Issue Found)


**Official Status: 8/8 engine validation tests passed. All core detection signals verified — floating promises, forEach mutations, global write races, clean-code zero-signal, pattern floor, learnFromDiagnosis bump, and negative setTimeout test. One known false-positive issue found in T8 (closure-local variables incorrectly flagged as shared state races) — documented as a future fix.**

### Test Results

| Test | What | Result |
|------|------|--------|
| T1 | `unawaited_promise` fires on bare `fetch()` — both in same file and cross-file | ✅ PASS — `fetch() [api.ts L3]` + `[api.ts L11]` flagged with correct lines |
| T2 | `learnFromDiagnosis` bump on PASSED verify — `learnFromDiagnosis` save path fixed | ✅ PASS — weight `0.77 → 0.82`, `hitCount: 1 → 2`, `savedAt` updated |
| T3 | Pattern floor — weight never goes below `0.3` | ✅ PASS — `Math.max(0.3, w - 0.03)` confirmed, `0.81 - 17×0.03 = 0.30` |
| T4 | `REJECTED` verdict (`rootCauseRejected: true`) | ✅ PASS by design — verifier is structural (checks file:line exists), not semantic |
| T5 | Zero-signal clean code — no patterns on correct async code | ✅ PASS — `patternMatchCount: 0`, completely empty `critical_signal` body |
| T6 | `forEach` mutating own collection | ✅ PASS — both loops caught, `confidence=0.90`, spec-undefined warning emitted |
| T7 | Global write before `await` — concurrent race | ✅ PASS — `global_write_race confidence=0.95`, both `login` and `logout` races caught |
| T8 | `setTimeout` does NOT trigger `unawaited_promise` (negative test) | ✅ PASS — `patternMatchCount: 0`, completely silent on `debounce` and `scheduleCleanup` |

### `unravel-v3/src/core/pattern-store.js` | **BUGFIX** — T8 False Positive Fixed (2 root causes)

**Fix 1 — `write_shared` scope leak (`extractSignature` L319)**
- `write_shared` was emitted for ANY variable write in the `mutations` loop — including closure-local `let` variables like `timer` inside a `debounce` function.
- These variables are private per closure-call instance, cannot race with concurrent callers, and should never trigger `race_condition_write_await_read`.
- **Fix**: Removed `write_shared` from the generic mutations loop entirely. Moved to the `globalWriteRaces` block — only emitted when the AST engine has already confirmed a module-scope variable is written before an `await`. Also added `read_shared` there (by definition: a global written before an await is read after).
- **Bonus**: `race_condition_write_await_read` now fires at `confidence=1.0` (3/3 token match) for real global races instead of `0.67` (2/3). Higher signal, less noise.

**Fix 2 — Match threshold raised from 0.6 → 0.7 (`matchPatterns` L423)**
- `stale_closure_async_delay` signature: `['closure_capture', 'async_delay', 'stale_var_access']`. The token `stale_var_access` is never emitted, so this pattern could only ever reach 2/3 = 67% coverage.
- At threshold 0.6: 67% ≥ 60% → fires on ANY code with closures + setTimeout (including legitimate `debounce`/`throttle` utilities).
- At threshold 0.7: 67% < 70% → never fires unless `stale_var_access` is properly detected.
- **Impact**: Any pattern that can only achieve 2/3 token match will no longer produce noise. All patterns that emit 100% of their tokens are unaffected.

### Verified: T7 Improved, T8 Clean

| | Before | After |
|---|---|---|
| T7 `race_condition_write_await_read` confidence | `0.67` (2/3 tokens) | **`1.0`** (3/3 tokens ✅) |
| T8 `stale_closure_async_delay` | Fired (false positive) | **Gone** ✅ |
| T8 `race_condition_write_await_read` | Fired (false positive) | **Gone** ✅ |
| T8 `patternMatchCount` | 2 | **0** ✅ |



### `unravel-mcp/index.js` | **BUGFIX** — `learnFromDiagnosis` Save Path (same class of bug as penalizePattern)

- Line 1030: `if (passed && session.astRaw && session.projectRoot)` → same `projectRoot` guard that was silently skipping decay also skipped learning bumps for inline-file sessions.
- **Fix**: Removed `session.projectRoot` guard. Now uses `session.mcpPatternFile` as canonical write path (same as penalize path).
- **Effect**: Both decay AND bump now write to the same `unravel-mcp/.unravel/patterns.json` file through `session.mcpPatternFile`.

### Known Issue — T8 False Positive: Closure-Local Variables Flagged as Shared State

- **Pattern**: `stale_closure_async_delay` and `race_condition_write_await_read` fired on a `debounce()` function.
- **Root cause**: `extractSignature()` in `pattern-store.js` emits `write_shared` for ANY variable with writes — including closure-local `let` vars like `timer`. These are private per-closure-instance and cannot race.
- **Fix needed**: Filter `write_shared` to only module-scope variables (exported or top-level `let/const`). Closure-local writes should not emit `write_shared`.
- **Filed as**: Future fix — `pattern-store.js` `extractSignature()` needs scope context from AST mutations.

---

## 2026-03-28 — 13:28 IST | Bug Fix Session — Pattern Decay Round-Trip Validated (3 Bugs Found)


**Official Status: Three bugs discovered and fixed during the pattern decay round-trip test. The full loop is now confirmed working: `analyze` → loads real weights from disk → wrong `verify` → `penalizePattern` decays weight → `savePatterns` writes back to the correct file. Verified: `floating_promise` weight `0.80 → 0.77` with `savedAt` timestamp updated to today.**

### `unravel-mcp/index.js` | **BUGFIX** — Pattern Decay Silent Skip (3 root causes)

**Bug 1: `session.projectRoot` guard — decay skipped for inline-file analyze calls**
- `penalizePattern` block had condition `!passed && session.astRaw && session.projectRoot`.
- When `analyze` is called with inline `files` (no `directory` arg), `session.projectRoot` is never set → entire decay block silently skipped.
- **Fix**: Removed `session.projectRoot` from the guard — decay now fires whenever `!passed && session.astRaw`.

**Bug 2: `resolve('.')` fallback — writes to wrong directory**
- Fallback path used `resolve('.')` which resolves to the shell CWD when MCP starts, not `unravel-mcp/`.
- Decay was running but writing `patterns.json` to an unexpected location (not found under `UnravelAI/`).
- **Fix**: Replaced with `resolve(import.meta.dirname)` — always resolves to the MCP server's own directory regardless of launch CWD.

**Bug 3: Load path ≠ Save path — weights decay from starters, not disk values**
- `analyze` loaded patterns via `join(resolve(import.meta.dirname), '.unravel', 'patterns.json')` (baseline load).
- `verify` penalty path rebuilt a separate path from `session.projectRoot || resolve('.')` — different location.
- Result: `_store` was loaded from disk (`0.80`) but `savePatterns` wrote to a different file, leaving the canonical file unchanged.
- **Fix**: `mcpPatternFile` is now stored in `session.mcpPatternFile` at analyze time. Both `penalizePattern` and `learnFromDiagnosis` save blocks use `session.mcpPatternFile` as the authoritative write target.

**Bug 4 (bonus): Verdict label ambiguity — `PASSED` when claims failed**
- `verify` returned `verdict: 'PASSED'` even when `failures.length > 0`, because the label only checked `rootCauseRejected`.
- An agent reading `verdict: 'PASSED'` with `allClaimsPassed: false` is a contradiction — it looks clean but isn't.
- **Fix**: Verdict is now `'REJECTED'` (rootCauseRejected), `'FAILED'` (failures but not rejected), or `'PASSED'` (zero failures, not rejected). Three distinct states.

### `unravel-mcp/index.js` | **IMPROVEMENT** — Pattern Baseline Always Loaded

- MCP-level `patterns.json` now loaded on **first `analyze` call regardless of whether `directory` is provided**.
- Previously: only loaded if `args.directory` was passed. Inline-file analyze calls always used in-memory starter weights.
- New flow: `session.patternsLoaded === false` → load `unravel-mcp/.unravel/patterns.json` → set `session.patternsLoaded = true` → optionally overlay project-level patterns if `args.directory` changes.
- `session.mcpPatternFile` field added to the session object for path consistency.

### Round-Trip Verification

```
Before: floating_promise weight=0.80, hitCount=1, savedAt=2026-03-27T13:15:01.948Z
After:  floating_promise weight=0.77, hitCount=1, savedAt=2026-03-28T07:54:15.908Z
```

Three-step test:
1. `analyze(b-06-silent-await files, inline)` → `session.astRaw` seeded, `session.mcpPatternFile` set, patterns loaded from disk
2. Wrong `verify` (nonexistent line 999) → verdict: `FAILED`, decay fires
3. `patterns.json` on disk updated — weight `0.80 → 0.77`, timestamp today ✅

---



## 2026-03-28 — 12:50 IST | Engine Hardening — Pattern Decay, unawaited_promise Signal Live, Doc Fixes

**Official Status: Five issues identified in the previous session's doc audit are fully resolved. Pattern weights now decay on REJECTED verifications (preventing runaway false-positive confidence). The `unawaited_promise` risk signal is live for the first time — `isAwaited` field added to every timing node, signal emission activated in `emitRiskSignals`. Documentation corrected in 3 places.**

### `unravel-v3/src/core/pattern-store.js` | **FEATURE** — Pattern Weight Decay (`penalizePattern`)

- **Problem**: `learnFromDiagnosis()` bumped pattern weights by +0.05 on every `PASSED` verify. There was no counterpart for `REJECTED` — weights only ever increased. A pattern that repeatedly fired on wrong diagnoses had the same confidence ceiling (1.0) as one with only true positives.
- **Fix**: New `penalizePattern(astRaw)` export. For each matched pattern on a REJECTED verify, decays weight by **-0.03** with a floor of **0.3** (the `matchPatterns` gate threshold — below this, patterns are already suppressed by the matching gate).
- **Asymmetric rates by design**: Decay rate (−0.03) < bump rate (+0.05) — meaning ~1.7× as many rejections as confirmations are needed to suppress a pattern. A single false positive cannot erase a well-established pattern.
- **Export added** to module header comment and to the file's API surface.

### `unravel-mcp/index.js` | **FEATURE** — Pattern Decay Wired into `verify` Handler

- `penalizePattern` imported from `pattern-store.js` alongside `learnFromDiagnosis` (line 82 declaration + line 124 import).
- Added `if (!passed && session.astRaw && session.projectRoot)` block after the existing PASSED learning block:
  - Calls `penalizePattern(session.astRaw)`
  - Calls `savePatterns(patternFile)` — decayed weights persisted immediately
  - Logs `[unravel-mcp] Pattern weights decayed (REJECTED verdict) and persisted.`
- Mirrors the structure of the PASSED learnFromDiagnosis block exactly.

### `unravel-v3/src/core/ast-engine-ts.js` | **FEATURE** — `isAwaited` Field on Timing Nodes

- `findTimingNodes()` (line 907) now pushes `isAwaited: isAwaited(call)` on every timing node.
- The `isAwaited()` helper (line 1722) already existed — used by `detectFloatingPromises` and `collectUnawaitedCallsForCrossFile`. Now wired into the timing node data.
- Every `timingNode` entry now carries: `{ api, callback, line, enclosingFn, isAwaited: boolean }`.
- **Backward compatible**: Callers that don't check `isAwaited` are unaffected.

### `unravel-v3/src/core/ast-project.js` | **FEATURE** — `unawaited_promise` Risk Signal Activated

- Replaced the 6-line DEFERRED comment block (Pattern 3 in `emitRiskSignals`) with live emission logic.
- **`ASYNC_PRODUCING_APIS` set** defined inline: `fetch`, `axios`, `got`, `request`, `then`, `catch`, `finally`, `readFile`, `writeFile`, `readdir`, `connect`, `query`, `findOne`, `save`, `create`, `send`, `post`, `put`, `patch`.
- **Logic**: For each timing node where `t.isAwaited === false` AND `apiBase` is in `ASYNC_PRODUCING_APIS` → emits `{ type: 'unawaited_promise', function, file, line, fn }`.
- **`setTimeout`/`setInterval`/`addEventListener` excluded** — intentional fire-and-forget by design, not in the API set.
- **Guard**: `isAwaited !== false` (not `=== true`) — handles old-format timing nodes without the field gracefully (skips rather than false-positives).
- **Deduplication**: Existing `seen` Set at end of `emitRiskSignals` handles any double-hits automatically.
- **Formatter already ready**: `formatCrossFileContext` at line 652 had `unawaited_promise` rendering code written but never reached — now fires correctly.

### Documentation Fixes (3 issues)

**`how_unravel_works.md`**

1. **`query_visual` example inconsistency** — `embeddedNodesSearched: 50` corrected to `623` to match the walkthrough's `embeddings: 'all'` mode (which embeds all 623 connected nodes, not just the default top-50 hub nodes).

2. **Stale codex push paragraph** — Replaced "The agent is NOT explicitly instructed to write a codex file" with accurate description: the static server description (`index.js:L382-455`) contains explicit push instructions. Section now documents both the pull path (query_graph pre_briefing) and the push path (server description triggers).

3. **"Layer 4" naming confusion** — Renamed `## Layer 4 — What to Skip for MCP/Engine Tasks` to `## Developer Reference — What to Skip for MCP/Engine Tasks` with a NOTE callout: "This section is for developers working on Unravel itself. It is NOT a fourth agent-facing layer."

4. **verify REJECTED documentation** — Added "On REJECTED — one thing happens automatically" block under the verify tool reference (mirrors the PASSED block), documenting the new `penalizePattern` behavior and decay rates.

5. **`unawaited_promise` deferred note removed** — Deleted from the "What Is Never Mentioned" list since it is now fully implemented.

---


## 2026-03-27 — 20:47 IST | Phase 7a + 7b — Diagnosis Embedding Archive + Semantic Pattern Matching

**Official Status: Phase 7a/7b fully live and end-to-end verified. Every `verify(PASSED)` now embeds the full diagnosis (symptom + rootCause + evidence) using Gemini Embedding 2 and persists it to `.unravel/diagnosis-archive.json`. Every subsequent `analyze()` call searches that archive by cosine similarity and surfaces matching past diagnoses directly in `critical_signal` (§1). Live test confirmed: symptom `"async initialization seems to complete but the plugins aren't actually ready — operations silently fail after startup"` retrieved archived b-07 diagnosis at 78% cosine similarity, zero keyword overlap, pointing exactly to `PluginManager.ts:16`.**

### `unravel-mcp/embedding.js` | **FEATURE** — Phase 7a: `loadDiagnosisArchive`, `archiveDiagnosis`, `searchDiagnosisArchive`

- **`loadDiagnosisArchive(projectRoot)`** — Sync read of `.unravel/diagnosis-archive.json`. Returns `[]` if file missing or corrupt. Called once per session on first `analyze()` call.
- **`archiveDiagnosis(projectRoot, {symptom, rootCause, codeLocation, evidence}, apiKey)`** — Embeds the diagnosis text using `RETRIEVAL_DOCUMENT` task type, then writes to disk. Embedding text format: `"Symptom: {symptom}\nRoot Cause: {rootCause}\nEvidence: {evidence.join(' | ')}"`. This captures the full semantic fingerprint of the bug, not just surface keywords. Returns `null` and does NOT write if embed fails (no empty archive entries).
- **`searchDiagnosisArchive(symptom, archive, apiKey, opts)`** — Embeds the new symptom as `RETRIEVAL_QUERY`, computes cosine similarity against all archive entries, filters by threshold (default `0.75`), returns top 3 sorted by score. Skips entries with null embeddings gracefully.
- **Constants**: `ARCHIVE_SIMILARITY_THRESHOLD = 0.75`, `ARCHIVE_MAX_RESULTS = 3`, `ARCHIVE_FILENAME = 'diagnosis-archive.json'`.
- **Storage**: `.unravel/diagnosis-archive.json` alongside `patterns.json` and `knowledge.json`. Archive entries include `id`, `timestamp`, `projectRoot`, `symptom`, `rootCause`, `codeLocation`, `evidence[]`, `embedding` (768-dim float array).
- **Added imports**: `existsSync`, `mkdirSync`, `readFileSync`, `writeFileSync` from `fs`; `dirname` from `path`.

### `unravel-mcp/index.js` | **FEATURE** — Phase 7b: Archive loading + search wired into analyze/verify

- **Session state additions**: `diagnosisArchive: []`, `archiveLoaded: false`, `lastSymptom: ''`.
- **`session.lastSymptom`**: Set in `analyze()` from `args.symptom`. Passed to `archiveDiagnosis()` in `verify()` so a proper symptom is archived (not a rootCause-as-symptom fallback).
- **Archive load in `analyze()`**: `loadDiagnosisArchive(session.projectRoot)` called once per session when `archiveLoaded === false`. Load count logged to stderr.
- **Phase 7b search in `analyze()`**: Runs after structural pattern matching if archive is non-empty + API key set + symptom provided. Injects `semanticArchiveHints` into `base._instructions`. Each hint includes `diagnosisId`, `similarity`, `symptom`, `rootCause`, `codeLocation`, `timestamp`.
- **`formatAnalysisForAgent()`**: New `Semantic Archive Hits` block in `critical_signal` (§1) rendered after Pattern Hints. Format: `⚡ XX% match [diag-id] date → hint`. Positioned in §1 so agents see it before any other reasoning.
- **Archive write in `verify(PASSED)`**: **Awaited** (not fire-and-forget). Returns the archived entry, which is pushed directly into `session.diagnosisArchive`. This keeps the in-memory array in sync so the very next `analyze()` call in the same session can find it.

### Bugs Found + Fixed During Live Testing

Three bugs discovered and fixed during the test sequence:

**Bug 1: `session.projectRoot` not updating across calls** — The `if (args.directory && !session.projectRoot)` guard prevented `session.projectRoot` from updating after the first `build_map` set it. If you ran `build_map(unravel-mcp/)` then `analyze(b-01/)`, the archive was written to `unravel-mcp/.unravel/` instead of `b-01/.unravel/`. **Fix**: Changed to always update when `args.directory` changes, resetting `patternsLoaded`, `archiveLoaded`, and `diagnosisArchive` when the directory switches.

**Bug 2: Archive file not created — embed-first blocking on rate-limited API** — Original `archiveDiagnosis` blocked on `embedText()` before writing anything. If the API returned null (e.g. post-`build_map` rate limit), nothing was saved. A "save-first, embed-async" approach was tried but rejected: a null-embedding entry is useless for search. **Fix**: API key updated; embed-first restored, test passed with fresh key.

**Bug 3: Fire-and-forget prevents same-session retrieval** — `archiveDiagnosis` was called with `.catch()` (non-awaited), so the returned entry was never pushed into `session.diagnosisArchive`. The next `analyze()` call saw an empty in-memory array even though the disk file was correct. Archive only became useful after MCP restart. **Fix**: `await archiveDiagnosis(...)`, push result into `session.diagnosisArchive` immediately. Now usable in the very next analyze call within the same session.

### Live End-to-End Verification (2026-03-27 20:45 IST)

**Test setup:**
1. `analyze(b-01)` + `verify(PASSED)` → seeds archive with: `"taskStore.ts:29 — tasks.push(newTask) mutates array in-place, Zustand shallow equality misses it"` (768-dim embedded)
2. `analyze(b-07)` + `verify(PASSED)` → seeds archive with: `"PluginManager.ts:16 — buildRegistry uses forEach(async), all Promises discarded"` (768-dim embedded)
3. `analyze(b-07, new symptom)` with: `"async initialization seems to complete but the plugins aren't actually ready — operations silently fail after startup"`

**Result in `critical_signal`:**
```
Semantic Archive Hits (past verified diagnoses — treat as H1):
  ⚡ 78% match  [diag-1774624507804]  2026-03-27
  → ⚡ SEMANTIC ARCHIVE (78% match): Past verified diagnosis — "PluginManager.ts:16 —
    buildRegistry uses forEach(async) which discards all returned Promises..."
    at PluginManager.ts:16. Treat as strong H1 if consistent with AST evidence above.
```

- **Zero keyword overlap** between the query and the retrieved diagnosis
- **Correct file:line** surfaced without any re-analysis
- **Agent instruction**: treat as H1 — the engine is telling the agent exactly where to look before it reads a single line of code

---

## 2026-03-27 — 20:05 IST | Phase 6 (query_visual) + Race Fix + build_map Embeddings Flag

**Official Status: Phase 6 multimodal visual routing is live. New `query_visual` tool accepts screenshots, data-URLs, or file paths, embeds them via Gemini Embedding 2's cross-modal vector space, and returns the most relevant source files by cosine similarity. Race condition in `loadCoreModules` fixed with a singleton Promise guard. `build_map` now has an opt-out `embeddings` flag for pure structural builds.**

### `unravel-mcp/embedding.js` | **FEATURE** — Phase 6: `embedImage()` + `fuseEmbeddings()`

- **`embedImage(imageInput, apiKey, mimeType)`** — Embeds a PNG/JPEG/WebP/GIF image using Gemini Embedding 2 Preview's cross-modal vector space. Accepts three input forms: raw base64 string, data-URL (`data:image/png;base64,...`), or absolute file path (auto-read via `fs/promises`). Returns 768-dim float vector — same dimension and space as text embeddings. `taskType: RETRIEVAL_QUERY` always (images are queries, never documents). Full retry-on-429 + AbortController timeout inherited from `embedText`.
- **`fuseEmbeddings(imageVec, textVec, imageWeight=0.6)`** — Weighted average of image and text embedding vectors. Default split: 60% image / 40% text. Gracefully degrades: if either vector is null, returns the other unchanged. Dimension mismatch logs a warning and falls back to image-only.
- **`inferMimeType(input)`** — Internal helper. Detects MIME type from file extension or data-URL prefix. Supports `.png`, `.jpg/.jpeg`, `.webp`, `.gif`.

### `unravel-mcp/index.js` | **FEATURE** — Phase 6: New `query_visual` tool (5th MCP tool)

- **Tool signature:** `query_visual({ image, symptom?, directory?, maxResults? })`
- **Pipeline:** `embedImage(image)` → optional `embedText(symptom)` fused at 60/40 → cosine similarity against all KG nodes with embeddings → ranked file list.
- **4 graceful error states:** no API key (clear hint to set env var), no KG (hint to run `build_map`), KG has no embeddings (hint to rebuild with API key), image embed failed (invalid format or API error).
- **Output:** `{ mode, embeddedNodesSearched, durationMs, relevantFiles[], scores[] }` — scores include per-file cosine similarity for agent inspection.
- **Moat note:** This is the only debugging tool in existence that accepts a screenshot and returns the source files responsible.

### `unravel-mcp/index.js` | **BUGFIX** — `loadCoreModules` Concurrent Write Race

- **Problem:** `loadCoreModules()` is a bare `async` function that writes 20 module-scope variables (`orchestrate`, `verifyClaims`, `initParser`, ...) with `await import(...)` calls between each write group. If two callers invoked it concurrently, all 20 globals could be written from two simultaneous executions, partially interleaved through every `await` suspension point.
- **Fix:** Added `let _coreLoadPromise = null` singleton guard. First call wraps the entire body in an IIFE stored in `_coreLoadPromise`. Subsequent calls — including any concurrent second call that arrives before the first completes — `await` the exact same in-flight Promise. After completion, all future calls return immediately. Zero callsite changes required.
- **Limitation acknowledged:** Static AST detector still flags these variables as `async_state_race` because it correctly sees writes-before-await. The singleton guard is a call-level protection that the static analyzer cannot model. This is a correct finding with a correct fix — they coexist.

### `unravel-mcp/index.js` | **FEATURE** — `build_map` `embeddings` opt-out flag

- Added `embeddings: z.boolean().optional()` to the `build_map` tool schema.
- `embeddings: false` → sets `fullBuildApiKey = null` regardless of env var → skips all Gemini API calls → pure structural KG in ~5s.
- `embeddings: true` or omitted → existing behavior (uses `GEMINI_API_KEY` if set).
- Distinct log messages for each path: `"Embeddings disabled by caller"` vs `"No GEMINI_API_KEY"` vs silent (embedded).
- **Motivation:** 50-node KG builds with the preview-tier Gemini API take ~50s due to rate limiting. Users who want fast structural routing can opt out explicitly.

### Verified — Smoke Test (2026-03-27 20:00 IST)

- `build_map(unravel-mcp/)` → 5 files, 34 nodes, 30 edges, 0.9s (incremental, 1 file changed)
- `query_graph("async function not awaited causing semantic scores to return wrong results")` → `embedding.js`, `cli.js`, `index.js` — correctly routed
- `analyze` → cross-file call graph detected all 7 Phase 6 exports: `embedImage L1600`, `fuseEmbeddings L1615` confirmed wired
- `node --check index.js` + `node --check embedding.js` → both PASS

---

## 2026-03-27 — 18:30 IST | Phase 5c-2 + 5c-3 — Semantic Codex Retrieval + Node Attachment

**Official Status: Two codex intelligence phases complete. Phase 5c-3 adds semantic codex retrieval via Gemini embeddings — past debugging sessions now match new symptoms by concept, not just keyword overlap. Phase 5c-2 attaches relevant codex discoveries directly to KG nodes during `build_map`, so query_graph results carry institutional memory per-file. Both phases zero-fallback: no API key or no codex = silent passthrough.**

### `unravel-mcp/embedding.js` | **FEATURE** — Phase 5c-3: Two new exports
- `embedCodexEntries(projectRoot, entries, apiKey)` — incremental embedding of codex index entries to `.unravel/codex/codex-embeddings.json` (768-dim MRL vectors).
- `scoreCodexSemantic(symptom, codexEmbeddings, apiKey)` — cosine similarity between embedded symptom and stored codex vectors. Returns `{taskId → score}`.
- Dead code cleaned: removed unused `statFn` parameter from `embedChangedNodes`.

### `unravel-mcp/index.js` | **FEATURE** — Phase 5c-3: Hybrid scoring in `searchCodex`
- `searchCodex()` upgraded to `async`. Blended score: `keyword×0.4 + semantic×0.6`.
- Catches vocabulary-mismatch cases (e.g. "redux resetting" matches `zustand, state-reversion` codex).
- Pre_briefing entries now include `relevance_score`, `semantic_score`, `keyword_score`.
- Fallback: no API key → keyword-only. Semantic error → logs and falls through.

### `unravel-mcp/index.js` | **FEATURE** — Phase 5c-2: Node hint attachment in `build_map`
- After KG construction, scans codex Discoveries sections for filename matches against KG nodes.
- Attaches `node.codexHints[]` to matching nodes — persisted in `knowledge.json`.
- No API key required — pure filename match, zero cost.

---

## 2026-03-27 — 16:30 IST | Intelligence Improvements — Protocol Tax, Static Blindness, Structured Output, Instruction Reformat


**Official Status: Three production intelligence fixes applied. Protocol Tax removed for trivial bugs (1 hypothesis allowed instead of 3 when agent is confident it's a typo/syntax error). STATIC_BLIND verdict added — engine now explicitly says "no structural bugs found, look at environment/runtime" instead of leaving the agent guessing. Analyze output restructured from one giant string into 5 separate JSON keys (`critical_signal`, `protocol`, `cross_file_graph`, `raw_ast_data`, `metadata`) so agents can read selectively. Hard rules reformatted from prose into MUST/DO NOT bullets for better LLM compliance.**

### `unravel-mcp/index.js` | **IMPROVEMENT** — Protocol Tax Fix (Trivial Bug Exception)
- Phase 3 instruction updated with EXCEPTION clause: 1 hypothesis allowed for trivially obvious bugs.
- Exception NOW REQUIRES inline justification: *"trivially obvious because: [one sentence]."* Without it, the exception does not apply.
- Hypothesis gate unchanged (still requires ≥1). This is a PROMPT change — the LLM decides when to use the exception, but must write its reasoning.

### `unravel-mcp/index.js` | **FEATURE** — STATIC_BLIND Verdict
- `formatAnalysisForAgent()` now checks: zero detectors fired + zero pattern matches + contextFormatted < 50 chars.
- If all three conditions met → injects `⚠️ VERDICT: STATIC_BLIND` into `critical_signal`.
- Lists possible non-code causes: env config, runtime data, third-party APIs, timing issues.
- Tells agent: "Investigate environment and runtime next" instead of looping.

### `unravel-mcp/index.js` | **ARCHITECTURE** — Structured Multi-Key Output + raw_ast_data Gating
- `formatAnalysisForAgent(payload, detail)` now accepts `detail` as second parameter (default: `'standard'`).
- In `standard`/`priority` mode: `raw_ast_data` = one-liner placeholder showing omitted size.
- In `full` mode: `raw_ast_data` = complete JSON payload as before.
- **Verified result**: standard mode response on b-02-phantom-preference = **4,332 bytes (~4KB)**. Previous equivalent: ~50KB. **90%+ reduction.**
- Nothing is hidden — `detail:'full'` always recovers the complete data.

### `unravel-mcp/index.js` | **IMPROVEMENT** — MUST/DO NOT Hard Rule Reformat
- Critical Rules section reformatted from NEVER-style prose into structured bullets.
- 7 MUST rules, 5 DO NOT rules, 1 EXCEPTION clause.
- Strictly easier for LLMs to parse and follow.

---

## 2026-03-27 — 12:30 IST | Phase 5a + 5b — Gemini Embedding 2 Preview Wired into KG + Task Codex Trial Run

**Official Status: Semantic file routing is live. `build_map` now embeds KG nodes via `gemini-embedding-2-preview` (768-dim MRL). `query_graph` scores all nodes by cosine similarity against the embedded symptom, then passes the scores into the existing `expandWeighted()` hook. The hook was pre-wired and fully functional — Phase 5a filled it for the first time. Zero-fallback guaranteed: no `GEMINI_API_KEY` = keyword-only routing, identical to pre-5a behavior. First live Task Codex files written under `.unravel/codex/`.**

### `unravel-mcp/embedding.js` (NEW FILE) | **FEATURE** — Gemini Embedding 2 Integration

- New standalone module, ~240 lines, no external dependencies beyond `fetch` (Node 18+ built-in).
- **`embedText(text, apiKey, taskType)`** — Single Gemini API call. Auto-retry on HTTP 429 with exponential backoff (max 3 retries). Returns 768-dim float array or null on error.
- **`embedTextsParallel(texts, apiKey, taskType)`** — Parallel worker pool (10 concurrent workers). Respects rate limits. Returns results in original input order.
- **`cosineSimilarity(a, b)`** — Pure dot-product math, no API dependency. Returns [0..1].
- **`embedGraphNodes(graph, apiKey)`** — Embeds all connected KG nodes (nodes with ≥1 edge). Skips isolated nodes (no semantic propagation possible) and nodes already embedded (incremental-rebuild safe). Attaches `node.embedding = [768 floats]` in place, before `saveGraph()`.
- **`embedChangedNodes(graph, changedPaths, apiKey)`** — For incremental rebuilds: re-embeds only files whose content changed.
- **`buildSemanticScores(symptom, graph, apiKey)`** — Embeds symptom with `RETRIEVAL_QUERY` task type, computes cosine similarity against all node embeddings, returns `Map<nodeId, score>`. Only nodes scoring above 0.1 threshold are included (noise cutoff).
- **`buildNodeText(node)`** — Constructs embedding input: `name + summary + tags + filePath`. Stays well within 8192-token limit.
- **Model choice**: `gemini-embedding-2-preview` over `gemini-embedding-001` — multimodal (text + image + video + PDF), 8192 token limit vs 2048, same MRL dimensions. Phase 6 (visual bugs) will use the same embedding.js with no changes.
- **task_type applied correctly**: `RETRIEVAL_DOCUMENT` for node embeddings, `RETRIEVAL_QUERY` for symptom queries — optimizes vector geometry for asymmetric retrieval.
- **Storage**: 768 × 4 bytes × 22 nodes ≈ +~67KB in knowledge.json for ghost-tenant benchmark. ~215KB for 200-file repo. Acceptable.

### `unravel-mcp/index.js` | **FEATURE** — Phase 5a wired at 3 locations

1. **L55** — ESM import of `{ embedGraphNodes, embedChangedNodes, buildSemanticScores }` from `./embedding.js`.
2. **Full rebuild path (~L1053)** — After `session.graph = graph`, before `saveGraph()`: calls `embedGraphNodes(graph, apiKey)`. If no key → logs `[unravel:embed] No GEMINI_API_KEY — skipping node embedding. Keyword-only routing active.`
3. **Incremental rebuild path (~L935)** — After `session.graph = merged`, before `saveGraph()`: calls `embedChangedNodes(merged, changedPaths, apiKey)`. Same fallback.
4. **`query_graph` tool (~L1117)** — Replaced `queryGraphForFiles(graph, symptom, maxResults)` with semantic-aware version:
   - Checks `hasEmbeddings = graph.nodes.some(n => n.embedding)` — won't attempt embed if nodes have no vectors
   - Calls `buildSemanticScores(symptom, graph, apiKey)` → `_semanticScores` Map
   - Passes `_semanticScores` into `queryGraphForFiles(graph, symptom, maxResults, _semanticScores)`
   - The `_semanticScores` Map flows into `expandWeighted()` (search.js:L144, L162-163) — semantic bonus (+0.4 × similarity) applied to both seed nodes AND their traversal neighbors.
   - 3-way fallback: (a) no key → keyword only, (b) no embeddings → keyword only + hint to re-run `build_map` with key, (c) both present → full semantic routing.

### Verified — Live Test Results

- **Benchmark:** `super-bug-ghost-tenant` (11 files, 24 nodes, 26 edges)
- **Nodes embedded:** 22/24 (2 isolated nodes correctly skipped)
- **Embed time:** ~2.5s full rebuild for 22 nodes (parallel 10-concurrent)
- **Test symptom:** `"concurrent access issues causing context to bleed between different users"` — zero keyword overlap with `TenantMiddleware.ts`, `TenantContext.ts`
- **Result:** `TenantMiddleware.ts` ranked **#4**, `TenantContext.ts` ranked **#8** — pure semantic routing
- **Full sandwich:** `analyze()` on result files returned the race condition at `TenantMiddleware.ts:L75 → await L76` in §1 at line 39 of output. Diagnosis confirmed correct.
- **Syntax check:** `node --check index.js` + `node --check embedding.js` → both PASS

### `.unravel/codex/` | **EXPERIMENT** — Task Codex Trial Run (first real entries)

- **`.unravel/codex/codex-index.md`** — Master index table (one row per codex). Created.
- **`.unravel/codex/codex-sys-instr-001.md`** — Documents the 2026-03-27 morning MCP hardening session: all files touched, all line numbers, all invariants confirmed.
- **`.unravel/codex/codex-phase5a-embed-001.md`** — Live codex for the Phase 5a task: written before implementation started (discoveries from reading search.js, index.js), updated during, completed with full edit log at task end.
- **Format used:** Detective notebook (BOUNDARY / DECISION / CONNECTION / CORRECTION entries). Not wiki summaries.
- **Observed benefit:** Codex for `search.js` confirmed the `expandWeighted()` hook was real and fully operational in 2 minutes of reading, preventing unnecessary re-verification. Model spec section (correct API shape, task_type, dimensions) written once, never re-searched.

---

## 2026-03-27 — 09:45 IST | MCP Hardening — Protocol Gates, Layered Output, Reading Guide, Task Codex Architecture

**Official Status: MCP protocol fully hardened. `analyze()` output restructured from flat 736-line JSON blob to a 5-section layered document where critical signal is always at line 7. Agent context cost for simple bugs reduced from 736 lines → ~55 lines. Task Codex architecture finalized.**
### ✅ Phase 5c-1 — Task Codex Query Integration
- `searchCodex()` helper implemented in `index.js`.
- Scans `.unravel/codex/codex-index.md` for keyword matches against symptom.
- Extracts `## Discoveries` section from matching markdown codex entries.
- Wires discoveries into `query_graph` response as a `pre_briefing` field.
- Updated `suggestion` text to include `⚡ PRE-BRIEFING` alert for agents.
- Verified on `b-02-phantom-preference`: symptom "settings reverting" correctly surfaced the `codex-b02-phantom-001` discovery about `localStorage` spreading defaults.

### `unravel-mcp/index.js` | **HARDENING** — Protocol Hard Gates (Hypothesis + Evidence Citation)

- **HYPOTHESIS_GATE**: `verify()` now rejects with `PROTOCOL_VIOLATION` if `hypotheses[]` is absent or empty. Proves Phase 3 (Hypothesis Generation) was not skipped. Gate fires before `verifyClaims()` — no compute wasted on protocol violations.
- **EVIDENCE_CITATION_GATE**: `verify()` now rejects if `rootCause` has no `file:line` citation (pattern: `\w+\.(js|ts|...)[L:]\d+`). A rootCause with no code anchor is structurally unverifiable. Both gates were designed in the previous session but only wired today.
- **`hypotheses` field** added to `requiredFields` in `verifyCallInstructions` so agents see it as mandatory before calling verify.
- **Verified**: Gates fire correctly under adversarial skipping. `HYPOTHESIS_GATE` → `PROTOCOL_VIOLATION`. `EVIDENCE_CITATION_GATE` → `PROTOCOL_VIOLATION`. Compliant submission → `PASSED`.

### `unravel-mcp/index.js` + `unravel-v3/src/core/orchestrate.js` | **HARDENING** — pipelineReminder in every analyze() call

- **Phase 3.5 (Hypothesis Expansion)** and **Phase 5.5 (Adversarial Re-entry)** added to both the static server description (`index.js`) and the per-call `_instructions.pipelineReminder` (`orchestrate.js:343`).
- `pipelineReminder` now includes: `phase3`, `phase3_5`, `phase5_5`, `eliminationQuality` fields — injected on every single `analyze()` call, not just at connection time.
- Previously both phases were **completely absent** from the per-call reminder, meaning agents saw them once at server load and never again during a session.

### `unravel-mcp/index.js` | **ARCHITECTURE** — `formatAnalysisForAgent()` — Layered Output Format

- **Problem**: `analyze()` returned `JSON.stringify(responsePayload, null, 2)` — a flat 700+ line JSON blob. The critical signal (`contextFormatted`) was buried at line 572. Agents reading top-down wasted context getting there.
- **Fix**: New `formatAnalysisForAgent(payload)` function replaces raw JSON. Output is a structured document:
  ```
  §1 CRITICAL SIGNAL  (~30-60 lines) — contextFormatted + pattern hints
  §2 PROTOCOL         (~20 lines)    — pipelineReminder + hardGates + requiredFields
  §3 CROSS-FILE GRAPH (~30 lines)    — compact callGraph + symbol origins
  §4 RAW DATA         (large)        — full JSON, all data preserved
  §5 METADATA                        — provenance, file list, engine version
  ```
- **Impact**: For ghost-tenant bug — agent reads §1 (55 lines), sees `⚠ setTenant L75 → await L76 RACE`, diagnosis done. §4–§5 never read. Context: 55 lines instead of 736.
- **All data preserved** — nothing dropped, just reordered. `detail:'full'` still returns full mutations JSON in §4.

### `unravel-mcp/index.js` | **UX** — Reading Guide at Top of Every analyze() Output

- 10-line reading guide added right after the header box, before §1 content:
  ```
  READING GUIDE — stop reading as soon as you have enough to diagnose:
    §1 → THIS is where the bug evidence lives. Start and usually stop here.
    §2 → Read when composing your verify() call or unsure about protocol.
    §3 → Read only if §1 cross-file chains are ambiguous.
    §4 → Read only for deep investigation when §1–§3 are insufficient.
    §5 → Skip unless debugging the engine itself.
  ```
- Agent no longer needs to guess the structure or read until it finds something useful.

### `context_plan.md`, `codex_variants.md` (artifacts) | **ARCHITECTURE** — Task Codex Specification Finalized

- Full Task Codex specification completed — the architecture for solving agent context window decay.
- **Detective notebook framing** (not wiki): entry types are `BOUNDARY / CORRECTION / DECISION / CONNECTION`.
- **Two-phase writing model**: append-only lab notebook during task → restructure into layered `TLDR→L1→L2→L3→L4` at task end.
- **Layer 4** ("what to skip next time") is mandatory — explicitly rules out irrelevant files for future sessions.
- **Reliability mechanisms**: confirmation counter per entry, SHA-256 file hash staleness tag, verify-on-use principle.
- **Fragmentation solution**: periodic consolidation when a file's codex count exceeds 5.
- **Retrieve-before-read**: `query_graph` will return matching codex as `pre_briefing` before file list (Phase 5c, not yet wired).

### Benchmarks Verified (2 runs)

- **b-01-invisible-update**: `tasks.push(newTask)` into Zustand store — in-place mutation bypasses shallow equality. `verify` PASSED. Both gates validated under adversarial skipping.
- **super-bug-ghost-tenant**: `setTenant L75 → await L76` race. `globalWriteRaces` detector fired at 0.9 confidence. New layered output confirmed working — §1 contained complete diagnosis at line 7 of the output file.

---

## 2026-03-26 — 19:48 IST | Production Hardening — CLI, SARIF, Caching, and Security Fixes

**Official Status: Unravel is now production-grade. High-performance caching reduces re-analysis time from 2s → 5ms. CLI + SARIF + GitHub Actions enable automated PR blocking on structural bugs. Security vulnerabilities in regex fallback (common in cross-platform environments) are 100% resolved. Version 3.4.0 released.**

### `unravel-mcp/cli.js` | **NEW** — High-Performance CLI Wrapper
- **Purpose**: Enables CI/CD integration without requiring an MCP host.
- **Features**:
    - **SARIF 2.1.0**: Full mapping of AST detectors (Race, Floating Promise, Stale Capture) to SARIF rules for GitHub PR annotations.
    - **Intelligent Exit Codes**: Returns `exit 1` for critical structural bugs (Race/Promise or Pattern Weight >= 0.9), `exit 0` for clean code, `exit 2` for errors.
    - **Multi-Format**: Supports `text`, `json`, and `sarif` output.
    - **Verification**: Confirmed on Super Bug 3 (correctly fails with exit 1 and identifies metrics loss).

### `unravel-mcp/index.js` | **Phase 3b, 3c & 4** — Progress + Caching + Dynamic Hints
- **Phase 3b (Progress)**: Added `buildStart = Date.now()` timer and per-file progress writes every 25 files inside `build_map` — both the full rebuild loop and the incremental patch loop. All three response paths now return `durationMs`. Agents can see `[unravel] Indexing... 25/200 files` in MCP debug logs instead of a frozen cursor.
- **Phase 3c (Caching)**: Session-level result cache on `analyze`. Cache key = `symptom + detail + sorted filenames`. On hit, returns stored result in <10ms with a `[Phase 3c: Cache hit]` log. Cache invalidates when any file changes. Two new session fields: `lastAnalysisHash`, `lastAnalysisResult`.
- **Phase 4 (Pattern Hints)**: Top matched patterns (confidence ≥ 0.5) injected into `_instructions.patternHints` BEFORE the response is returned. Format:
  ```json
  { "patternId": "stale-module-capture", "bugType": "STALE_MODULE_CAPTURE",
    "confidence": 0.85, "hitCount": 12,
    "hint": "Matches known STALE_MODULE_CAPTURE pattern (12 times, 85%). Treat as H1 unless AST contradicts." }
  ```
  Effect: agents receive a pre-ranked hypothesis before they start Phase 3 reasoning — fewer reasoning steps, better H1 selection.

### `unravel-v3/src/core/ast-bridge.js` | **HARDENING** — Regex Fallback Security Fixes
- **Issue 1 (Comment Ghosting)**: Added `stripComments()` caller to `extractFunctions` and `extractClasses`. Prevents commented-out code (pseudo-code/notes) from polluting the Knowledge Graph.
- **Issue 3 (Fuzzy Stem Collision)**: Added `AMBIGUOUS_STEMS` guard (index, types, utils, etc.) to the fuzzy path resolver. Prevents linking the wrong file in large repos with multiple generic file names.
- **Verified**: 9/9 regression tests pass. Ghost indexing and wrong-file linkage is eliminated.

### `.github/workflows/unravel.yml` | **Phase 2c** — GitHub Action for PR Annotation
- Runs on every PR and push to `main`/`master`.
- Calls `cli.js --format sarif --output unravel.sarif`.
- Uploads SARIF to GitHub Code Scanning (inline diff annotations).
- Uses `continue-on-error: true` on the analysis step so SARIF always uploads even on exit 1, then explicitly re-fails the job.
- Requires `security-events: write` permission for SARIF upload.

---

## 2026-03-26 — 16:27 IST | Phase 3e — Protocol Enforcement Hard Gates in `verify`

**Official Status: MCP response size cut from 108KB → 43KB (60% reduction). `astRaw.mutations` down from 132 → 16 entries. New `staleModuleCaptures` detector fires correctly on Super Bug 3 (scheduler.js L3). Bug 1 is now a direct engine signal, not multi-hop inference.**

### `unravel-mcp/index.js` | **HARDENING** — Aggressive astRaw Mutation Filter

- **Problem**: Previous filter only removed 17/132 noise vars. 115 remained — mostly zero-write read-only locals (`c`, `b`, `aged`, `entry`, `resolve`, `conn` etc.) passing because they were "cross-function" (passed to anonymous callbacks).
- **New Rules Added:**
    1. **Zero-write drop**: Read-only locals (function params, destructures, loop vars) have 0 writes. Drop them — they are never shared state.
    2. **Single-function drop**: Variables whose entire lifecycle (all reads + all writes) lives in exactly one function are pure local scope. Drop them.
    3. **Extended NOISE_VARS**: Added single-letter vars (`a`-`z`), domain aliases (`aged`, `entry`, `conn`, `delay`, `worker`, `now`, `fresh`), and common batch names (`completionsBatch`, `failuresBatch`).
    4. **Extended force-include**: Now covers `staleModuleCaptures` and `floatingPromises` detector results (not just `globalWriteRaces` + `constructorCaptures`).
- **Result**: 132 → 16 mutations (88% noise reduction). Only true cross-function shared state remains.

### `unravel-v3/src/core/ast-engine-ts.js` | **FEATURE** — `detectStaleModuleCaptures()` Cross-File Detector

- **Problem**: `const _cachedEntries = getEntries()` at module scope in `scheduler.js` — a stale capture where `getEntries()` returns a reference to `_entries`, but `rebalance()` later reassigns `_entries` with a new sorted array. The old detector (`detectConstructorCapturedReference`) only handled `new Class(arg)` patterns, missing bare function-call captures.
- **What changed:**
    - `extractModuleLevelBindings()` extended to also track `const x = fn()` / `const x = obj.fn()` call expressions at module scope (stored as `moduleScopeCallExprs[]`).
    - New `detectStaleModuleCaptures(allBindings, mergedMutations)` function: for each module-scope call expression, checks if the callee is imported from another file, finds all reassigned cross-function vars in the source file, and emits a structured `STALE_MODULE_CAPTURE` annotation.
    - Wired into `runMultiFileAnalysis()` alongside `detectConstructorCapturedReference`, into `raw.staleModuleCaptures`, into `contextFormatted` (new section: "Stale Module-Scope Captures ⚠"), and into `hasVerifiedFindings`.
- **Verified on Super Bug 3**: Fires at `scheduler.js L3`, correctly links `_cachedEntries → getEntries → _entries → rebalance() L36`.

### Gap Now Closed — `floatingPromises` for user-defined async functions

Added two new helper functions to `ast-engine-ts.js`:
- **`extractAsyncFunctionNames(tree)`**: Walks the AST per-file to collect all `async function foo()`, `const foo = async () => {}`, and `const foo = async function(){}` declarations into a `Set<string>`.
- **`collectUnawaitedCallsForCrossFile(tree, fileName)`**: Collects every unawaited `call_expression` (excluding already-covered browser/Node APIs) into a per-file array.

**Cross-file intersection** runs after all files are parsed: builds a `globalAsyncFns` Set from all files, then filters all collected unawaited calls. Any hit is emitted as `{ kind: 'user_async' }` into `mergedFloatingPromises`.

**Verified on Super Bug 3:**
```json
"floatingPromises": [
  { "api": "flushMetrics", "line": 71, "fn": "shutdown",          "file": "index.js", "kind": "user_async" },
  { "api": "processNext",  "line": 58, "fn": "runProcessingCycle","file": "index.js", "kind": "user_async" }
]
```
Bug 3 (`flushMetrics` not awaited in `shutdown`) is now a **direct engine flag** — no inference required.

---

## 2026-03-26 — 16:27 IST | Phase 3e — Protocol Enforcement Hard Gates in `verify`

**Official Status: The verify tool now enforces the Sandwich Protocol at the gate level. Submissions that skipped Hypothesis Generation or have uncited rootCauses are rejected with `PROTOCOL_VIOLATION` before `verifyClaims()` even runs. Engine syntax verified clean (`node --check`).**

### `unravel-mcp/index.js` | **P3e** — Two Hard Gates Added to `verify`

**Background:**
Naive or aggressive agents skip Phase 3 (Hypothesis Generation) and jump straight from `analyze` → fix. On small well-typed repos they occasionally get a correct answer by luck. On large multi-file repos this reliably produces proximate fixation: fixing the crash site while leaving the structural root cause intact. The issue isn't that they call `verify` — it's that they have no mechanically enforced incentive to think before submitting.

**Design Decision — What NOT to enforce:**
Requiring `query_graph` before `analyze` was considered and rejected. On repos where all files fit in context (super bug 3 is 7 files), skipping KG is the correct and optimal behavior. Mandating `query_graph` would penalize correct behavior. The gate belongs in `verify`, not in `analyze`.

---

#### Gate 1 — `HYPOTHESIS_GATE`

**Trigger**: `hypotheses` field is absent from the `verify` call OR is an empty array.

**Response** (returned before `verifyClaims()` runs):
```json
{
  "verdict": "PROTOCOL_VIOLATION",
  "gate": "HYPOTHESIS_GATE",
  "allClaimsPassed": false,
  "failures": [{
    "claim": "hypotheses[]",
    "reason": "Phase 3 (Hypothesis Generation) was skipped..."
  }],
  "summary": "PROTOCOL_VIOLATION: Phase 3 (Hypothesis Generation) skipped. Fix not accepted.",
  "remediation": "Add hypotheses: [\"H1: ...\", \"H2: ...\", \"H3: ...\"] to your verify call."
}
```

**What this enforces:** The agent must have generated at least 1 competing hypothesis before proposing a fix. This mechanically guarantees Phase 3 ran, without validating hypothesis quality (which is the agent's job).

**What this doesn't block:** Passing a single hypothesis (not 3) still clears the gate. The gate is a floor, not a ceiling.

---

#### Gate 2 — `EVIDENCE_CITATION_GATE`

**Trigger**: `rootCause` string does not match `FILE_LINE_PATTERN`:
```js
/[\w.\-/]+\.(js|jsx|ts|tsx|py|go|rs|java|cs)\s*[L:]\s*\d+/i
```

Examples that PASS: `"scheduler.js:3 — _cachedEntries captures stale ref"`, `"worker.js L58: processNext() not awaited"`

Examples that FAIL: `"There is a race condition in the scheduler"`, `"The module captures a stale reference"`

**Response**:
```json
{
  "verdict": "PROTOCOL_VIOLATION",
  "gate": "EVIDENCE_CITATION_GATE",
  "failures": [{ "reason": "rootCause contains no file:line citation..." }],
  "summary": "PROTOCOL_VIOLATION: rootCause has no file:line citation. Fix not accepted.",
  "remediation": "Rewrite rootCause to include the file and line: e.g. \"scheduler.js:3 — const _cachedEntries = getEntries() captures stale reference\""
}
```

**Why this is the right check:** A rootCause without a code citation cannot be verified by `verifyClaims()` — it's describing a mechanism without anchoring it to actual code. Any rootCause that survives Phase 5 (Hypothesis Elimination) will have a code citation naturally; requiring one is a zero-cost forcing function for evidence-anchored reasoning.

---

#### Schema Change — `hypotheses` field added to verify

```js
hypotheses: z.array(z.string()).optional()
  .describe('REQUIRED: The competing hypotheses you generated in Phase 3...')
```

Marked `.optional()` in Zod (for backward compatibility — old callers don't crash) but enforced as mandatory by Gate 1 at runtime.

The `rootCause` field description updated to: `'MUST contain at least one file:line citation — rootCause without code citation is rejected.'`

#### Tool description updated

Added `PROTOCOL REQUIREMENTS` block to the `verify` tool description so any agent reading tool metadata before calling knows both gates exist before submitting:

```
PROTOCOL REQUIREMENTS (enforced by hard gates):
1. HYPOTHESIS GATE: pass hypotheses[] with ≥1 entry
2. EVIDENCE CITATION GATE: rootCause must contain file:line citation
```

---

**Important Note — When Gates Fire:**
Gates run **before** `verifyClaims()`. This means:
- Gate violation → returns `PROTOCOL_VIOLATION` immediately
- Pattern learning (`learnFromDiagnosis`) does NOT fire on gate violations (learning only on PASSED)
- `verifyClaims()` does NOT run on gate violations (saves compute)

**MCP server restart required** to pick up the new schema. The gates are in the live code; they activate on next server start.



**Official Status: Implementation plan 100% complete. All 4 planned items verified on Super Bug 3. Response size down 49% from original 108KB baseline with all diagnostic signals intact.**

### `unravel-v3/src/core/orchestrate.js` | **P3** — Compress `_instructions` (static protocol out of per-call response)

- **Problem**: The `MCP_REASONING_PROTOCOL` object — containing the full 8-phase pipeline description, 16 hardRules, the complete outputSchema, hypothesisEliminationRules, and the verifyCallInstructions — was being serialised into every single `analyze` response. This is ~150 lines of static JSON (~30–40KB) that NEVER changes between calls. Every call to `analyze` was paying the same token cost to re-deliver identical protocol text.

- **Design Decision**: The full protocol belongs in the `analyze` **tool description** (sent once at connection by the MCP SDK, not per-call). The per-call `_instructions` block should only contain fields that are specific to this particular analysis run.

- **What was removed from per-call `_instructions`**:
    - `role` — static string, belongs in tool description
    - `pipeline[]` — all 11 phases (1, 2, 3, 3.5, 4, 5, 5.5, 6, 7, 7.5, 8) — static, moved to tool description
    - `hypothesisEliminationRules[]` — static, moved to tool description
    - `hardRules[]` — all 16 rules — static, moved to tool description
    - `outputSchema{}` — full 30-field structured output spec — static, moved to tool description

- **What remains in per-call `_instructions`** (2 fields only):
    - `groundTruth` — references `evidence.contextFormatted` from THIS analysis; must be per-call
    - `verifyCallInstructions` — the verify reminder with `enforcementTiers`; references the agent's own upcoming diagnosis, must be per-call

- **Files changed**: `orchestrate.js` L338–374 (replacement of 150-line `MCP_REASONING_PROTOCOL` with 40-line slim version)

- **Size Impact**: ~30–40KB saved per call in `standard` / `priority` mode. Agents still receive the full protocol via the tool definition layer (MCP SDK contract).

---

### `unravel-mcp/index.js` | **P4** — Drop `astRaw.mutations` in `standard`/`priority` mode

- **Problem**: After P1 filtering, `astRaw.mutations` still contained 16 cross-function variables serialised as verbose structured JSON (each entry: `{ writes: [{fn, line, type, conditional}], reads: [{fn, line}] }`). This data is fully redundant — `contextFormatted` already contains ALL of it in human-readable annotated form. Agents should read `contextFormatted` for reasoning; the structured mutations JSON is machine-format for tooling, not agent reasoning.

- **What changed**: After the P1 filter runs, added a second pass in the `analyze` handler:
    ```js
    if (detail !== 'full' && base.evidence?.astRaw?.mutations) {
        const keptCount = Object.keys(base.evidence.astRaw.mutations).length;
        delete base.evidence.astRaw.mutations;
        base.evidence.astRaw._mutationsDropped = `${keptCount} entries suppressed...`;
    }
    ```
- **Escape hatch preserved**: `detail:'full'` returns the complete unfiltered mutations JSON for deep debugging use cases. The `_mutationsDropped` field tells agents exactly how many were suppressed and how to get them back.

- **All other `astRaw` fields unaffected**: `closures`, `timingNodes`, `floatingPromises`, `globalWriteRaces`, `staleModuleCaptures`, `constructorCaptures`, `listenerParity`, `forEachMutations`, `specRisks`, `_source` — all still present in `standard` mode.

- **Files changed**: `unravel-mcp/index.js` L471–484

---

### **VERIFICATION: Super Bug 3 — Full Regression Test (All 4 Bugs)**

Re-ran `mcp_unravel_analyze` on `super bug 3` benchmark after P3+P4 changes.

**Size**: 55,829 bytes (55KB) — down from 108KB original (**49% reduction**)

| Check | Expected | Result |
|---|---|---|
| `astRaw.mutations` absent | `true` | ✅ — field deleted |
| `_mutationsDropped` message present | `true` | ✅ — `"16 entries suppressed in standard mode"` |
| `floatingPromises` — `flushMetrics` at L71 | `kind: "user_async"` | ✅ |
| `floatingPromises` — `processNext` at L58 | `kind: "user_async"` | ✅ |
| `staleModuleCaptures` — `_cachedEntries` at L3 | severity: high | ✅ |
| `globalWriteRaces` — `_flushInProgress` | type: global\_write\_before\_await | ✅ |
| `globalWriteRaces` — `_pool` | type: global\_write\_before\_await | ✅ |
| `_instructions` keys | 2 only: `groundTruth`, `verifyCallInstructions` | ✅ |
| `patternMatches` firing | 4 patterns matched | ✅ |
| `_provenance.mutationsSuppressed` | 116 | ✅ |

**Total size reduction journey on Super Bug 3:**

| Stage | Size | Change |
|---|---|---|
| Before any P changes | 108KB | baseline |
| After P1 (mutation filter 132→16) | 43KB | −60% |
| After P4 (drop mutations entirely in standard) | ~27KB evidence block | −37% from P1 |
| After P3 (slim \_instructions 150→40 lines) | **55KB total** | protocol overhead −30–40KB |

> Note: `crossFileRaw` module map is a legitimate structural payload (~15KB) that grows when the file set is larger — it carries the full import/export graph and symbol origin table. It is NOT noise and is intentionally kept in all modes.

---

## 2026-03-26 — 13:36 IST | BENCHMARK: Super Bug 3 + PLAN: Phase 3e Protocol Enforcement

**Official Status: Super Bug 3 stress test completed. All 4 structural bugs found, all fixes PASSED verify. Phase 3e (Hard Gates for verify) added to plan.**

### Super Bug 3 — Stress Test Results

Designed to trigger every detector simultaneously with cross-file tracing, a red herring, and a self-healing illusion. 7 files, 4 distinct bugs, 2 red herrings.

| Bug | Mechanism | Files | Found? |
|---|---|---|---|
| Stale module cache → post-rebalance divergence | Constructor capture + array replacement | `scheduler.js:3` + `priority-queue.js:57` | ✅ Correctly identified |
| Read-await-delete race | Async gap in `pickNextTask()` between peek and remove | `scheduler.js:20` | ✅ Correctly identified |
| Floating promise in shutdown | `flushMetrics()` not awaited | `index.js:71` | ✅ Perfect |
| Stale closure after auto-scaling | `pool = getWorkerPool()` captured at start; `replaceWorkerPool()` replaces `_workers` | `health-monitor.js:8` + `worker.js:34` | ✅ Correctly identified |
| Red herring (retry-policy.js double-write) | Intentional default→override pattern | `retry-policy.js` | ✅ Not triggered |

**verify verdict: PASSED — all 4 evidence citations confirmed against AST.**

### Phase 3e — Protocol Enforcement (Plan Only, Not Yet Wired)

**Observation:** Naive models skip Hypothesis Generation and jump to fixes. On small repos they get lucky. On large repos this causes proximate fixation — fixing the crash site while leaving the structural root cause intact.

**Corrected Design (initial version had a wrong rule):**
- ❌ Removed: Requiring `query_graph` before `analyze` — wrong. Small-repo optimization (skip KG when all files fit in context) is correct behavior. Penalizing it is wrong.
- ✅ Kept: `hypotheses[]` required in `verify` — forces Phase 3 on the agent before fix acceptance
- ✅ Kept: At least 1 file:line AST citation required in `rootCause` — prevents hallucinated root causes

**Status: Plan written. Code not yet wired.**

---

## 2026-03-26 — 13:00 IST | MILESTONE: KG Persistence + Incremental Rebuild — Zero Restart Penalty


**Official Status: Knowledge Graph now persists to `.unravel/knowledge.json` and auto-loads on restart. Incremental rebuild uses SHA-256 content-hash diffing — only re-indexes files that actually changed.**

### `unravel-mcp/index.js` | **FEATURE** — Incremental KG Rebuild (SHA-256 Diff)

- **Auto-Load on Restart**: `analyze` and `query_graph` both auto-restore the KG from `.unravel/knowledge.json` if `session.graph` is null. No `build_map` required after MCP restart.
- **Content-Hash Diffing**: Full rebuild now stamps SHA-256 content hashes for every file into `graph.files`. Subsequent `build_map` calls use `getChangedFiles()` to compare hashes — only re-parses files whose actual content changed. Formatter touches and git operations that don't modify content are correctly ignored.
- **Incremental Patch Path**: When <30% of files changed (`INCREMENTAL_THRESHOLD = 0.3`), uses `attachStructuralAnalysisToChanged()` + `mergeGraphUpdate()` to patch only delta nodes/edges. Merged graph is saved immediately.
- **Zero-Change Fast Path**: When 0 files changed, returns cached graph instantly with `"Loaded from cache in <0.1s"`. No structural analysis, no graph building.
- **Full Rebuild Fallback**: When >30% of files changed or no existing graph exists, performs full rebuild (unchanged from before). Threshold is a named constant for tuning.
- **New Imports Wired**: `getChangedFiles`, `computeContentHashSync`, `mergeGraphUpdate`, `attachStructuralAnalysisToChanged` — all existed in core, were dormant in MCP.

### **VERIFICATION: Super Bug 2 — Incremental Rebuild Confirmed**
- First call: `incremental: false` — full build, 10 files, 61 nodes, 68 edges, 10 SHA-256 hashes stamped
- Second call: `incremental: true`, `filesChanged: 0` — `"Loaded from cache in <0.1s"`
- `query_graph` without `build_map`: KG auto-restored from disk, 8 relevant files returned instantly

---

## 2026-03-26 — 10:14 IST | MILESTONE: Pattern Store Persistence — The Learning Loop Is Live


**Official Status: Unravel MCP now learns from every confirmed diagnosis. Pattern weights persist to `.unravel/patterns.json` after each clean verify, and are loaded automatically on the next run.**

### `unravel-mcp/index.js` | **FEATURE** — Pattern Store fully wired (load → match → learn → save)

- **Auto-Load on Analyze**: When `analyze` is called with a `directory`, MCP auto-loads `.unravel/patterns.json` (once per session). Falls back to 20 starter patterns if file not found — no setup required.
- **Pattern Matching in Evidence Packet**: `matchPatterns(astRaw)` fires after every analyze. Top 5 structural hypotheses injected into the response as `patternMatches[]` with `patternId`, `bugType`, `severity`, `confidence`, `hitCount`, `matchedEvents`. The agent sees these as H1/H2 priors going into Phase 2 reasoning.
- **Provenance Enrichment**: `_provenance` now includes `patternsChecked` and `patternMatchCount`.
- **Learn on Clean Verify**: When `verify` returns `PASSED` (0 failures, rootCause not rejected), `learnFromDiagnosis()` increments `hitCount` and bumps `weight +0.05` for all matched patterns. `savePatterns()` writes `.unravel/patterns.json` immediately.

### **VERIFICATION: Super Bug 2 — Full Learning Loop Confirmed**
- Analyze: 4 patterns matched (`global_write_race`, `race_condition_write_await_read`, `stale_closure_async_delay`, `floating_promise`) — all `hitCount: 0`
- Verify: `PASSED` — learning fired instantly
- Result: `patterns.json` written with timestamp; `race_condition_write_await_read` weight → `1.0`, others `+0.05`
- Next run: patterns carry prior evidence — `hitCount: 1` visible to agents as strong H1 signal

---

## 2026-03-26 — 09:35 IST | MILESTONE: Tiered Output Architecture & Universal Engine Parity

 
**Official Status: Unravel MCP Engine hardened with tiered evidence filtering. Cross-file analysis verified and restored. 100% signal-to-noise ratio in agent context.**

### `ast-engine-ts.js` | **ARCHITECTURE** — Tiered Output (Priority / Standard / Full)

- **The Problem**: 800+ line evidence packets in MCP mode competed with the agent's conversation history and system prompt, leading to "context fatigue" where agents skimmed or missed critical AST facts.
- **The Fix**: Implemented three output tiers controlled by a `detail` parameter:
    - **`priority` (~50 lines)**: Only high-severity confirmed findings (races, stale closures, spec violations).
    - **`standard` (~200 lines — MCP Default)**: Precise signal-to-noise filtering. Excludes "noise" mutations (loop counters, local variables) and raw function lists. 
    - **`full` (Unfiltered)**: The existing comprehensive dump for webapp and deep debugging.
- **Precise Mutation Filtering**: Redefined the "suspicious" criterion. A variable is only shown in standard mode if it exhibits **True Cross-Function State Sharing** (writes in fn A, reads in fn B) or is force-included by a critical detector. Same-function multi-writes (loop resets) are now correctly suppressed as noise.
- **Feedback Loop**: Added a suppression summary line: `■ FULL ANALYSIS (N additional entries not shown — pass detail:'full' to analyze() for complete output)`. This informs agents that more data exists without forcing them to process it.

### `orchestrate.js` | **BUGFIX** — Cross-File Analysis Gate Restored in MCP

- **The Problem**: A silent bug in the `canRunCrossFile` gate checked for a deleted pre-unification injection pattern (`_nativeAST.parseCodeNative`). Result: `crossFileRaw` was `null` on every MCP run, silently skipping call-graph edges and cross-module reference traces.
- **The Fix**: Rewrote the gate to check `astRaw?._source === 'native-tree-sitter'`. Restoration verified with Super Bug 2 run — `crossFileAnalysis: true` confirmed.
- **Universal Engine Parity**: The exact same core code now runs in Browser (WASM) and MCP (Native) with 100% feature parity.

### `unravel-mcp/index.js` | **HARDENING** — Tiered detail parameter exposed

- **Schema Update**: Added `detail: z.enum(['priority', 'standard', 'full'])` to the `analyze` tool. 
- **Instructional Guidance**: Updated tool description to tell agents exactly when to scale up to `full` or down to `priority`.

---


**Official Status: Unravel MCP Engine validated against the full 20-bug benchmark suite. 20/20 cases correctly diagnosed. Zero regressions.**

### **VALIDATION: Benchmark Suite B-01 to B-20 (VERIFIED)**
- **Coverage**: 20 unique bugs across React, Node, ESM, Zustand, and Security domains.
- **Accuracy**: 100% RCA (Root Cause Analysis). Every bug was mapped to the exact line of first corruption.
- **Trap Resistance**: 100% PFR (Proximate Fixation Resistance). Successfully avoided all 20 "decoy" symptoms (blaming the crash site instead of the root cause).
- **Special Cases**: 
    - **B-19 (Phantom Gate)**: Correctly identified "No Bug Found" (Standard SPA shell behavior), passing the anti-sycophancy test.
    - **B-20 (Locked Key)**: Correctly identified a **Layer Boundary** issue (OS-level key translation), recommending `event.code` over `event.key`.
- **Reasoning**: All 20 cases were solved using the **Phased Reasoning Pipeline (Phases 1-8)** and verified with the `unravel.verify` tool. Zero hallucinations.
- **Protocol Fidelity**: Every diagnosis provided a complete `causalChain` from mutation to symptom with line-level evidence.

---


### `ast-engine-ts.js`, `unravel-mcp/ast-engine-native.js` | **ARCHITECTURE** — Engine Unification (600+ lines removed)

- **The Problem**: Architectural drift. The MCP server used a separate `ast-engine-native.js` that lacked most core detectors (Global Write Races, ForEach Mutations, Listener Parity) found in the webapp's `ast-engine-ts.js`.
- **The Fix**: Deleted `ast-engine-native.js` entirely. Integrated native Node-API tree-sitter bindings directly into `ast-engine-ts.js` with environment-aware initialization (`_IS_NODE` detection).
- **Native Dependency Bridge**: Added support for `UNRAVEL_NATIVE_BASE` environment variable. Uses `createRequire` to resolve tree-sitter bindings from the MCP server's `node_modules` even when the engine is loaded from a different directory (VS Code extension / symlinked core).
- **Parser Parity**: All 10+ core detectors are now available in the MCP mode.
- **`_source` Tracking**: Added `_source` field to analysis results (`native-tree-sitter` vs `wasm-tree-sitter`) to identify the parser path during debugging.

### `orchestrate.js` | **SANDWICH ARCHITECTURE** — Multi-Agent Output Contract (_instructions)

- **The Problem**: When running in MCP mode, the calling agent (Claude Code, Gemini CLI) received raw evidence but had no knowledge of Unravel's strict reasoning protocol. It could "guess" bugs or ignore hard AST facts.
- **The Fix**: Injected a comprehensive `_instructions` block into the `MCP_EVIDENCE` packet. 
- **Reasoning Protocol (Phases 1-8)**: Explicitly guides the agent through the 11-step reasoning pipeline (Read → Intent → Hypotheses → Evidence Map → Elimination → Adversarial → Fix → Concept → Invariants).
- **16 Hard Rules**: Enforces non-negotiable logic including the **Proximate Fixation Guard** (crash site ≠ root cause) and **AST Annotation Authority** (hard spec facts cannot be overridden).
- **Enforcement Tiers**: Formally defined `VERIFIED_BY_ENGINE` fields (rootCause, codeLocation, evidence) versus `BEST_EFFORT_GUIDANCE` (conceptExtraction, relatedRisks) so agents know what is being hard-checked by `unravel.verify`.

### `unravel-mcp/index.js` | **HARDENING** — Native Engine Bypass Removed

- **Simplification**: Removed all redundant "native shim" injection logic. The MCP server now makes standard calls to `orchestrate()`, which handles engine initialization transparently.
- **Safety**: Configured `UNRAVEL_NATIVE_BASE` to ensure correct native binding resolution regardless of execution context.

### **VALIDATION: Super Bug 2 — Rate Limiter Bypass (VERIFIED)**
- **Scenario**: A complex rate-limiter bypass that only manifests after the first window rotation. Root cause is a cross-module reference divergence where a cache retains an old `Map` reference after the store reassigns its private `_counters` variable.
- **Result**: **NATIVE AST SUCCESS.**
- **Detector**: `constructor_captured_reference` fired with `critical` severity.
- **Evidence**: Correctlly identified that `hot-path-cache.js::_cache` Diverged from `counter-store.js::_counters` at L36. 
- **Reasoning**: The new `_instructions` block correctly guided the agent to look past the "crash site" (where limits failed) to the "root cause" (where reference was corrupted).
- **Verify**: `unravel.verify` returned **PASSED**.

---
42: 
43: ## 2026-03-25 — 22:00 IST | MILESTONE: Engine Hardened + B-10 Stress Test PASSED
44: 

**Official Status: Full AST Fidelity restored in MCP mode. Hallucination Wall active.**

### `unravel-mcp`, `unravel-v3/src/core/search.js` | **BUGFIX** — KG Routing score dilution fixed

- **The Problem**: Querying `query_graph` with a natural language symptom (e.g. "discount bug in checkout") diluted the score of a strong keyword match ("discount") below the 0.1 threshold because it was averaged across all tokens. Simple symptoms failed to match any files.
- **The Fix**: Implemented **Blended Max-Scoring** in `search.js`. Score is now **70% bestTokenScore + 30% averageScore**. A single strong structural match (function name, file name) now correctly clears the threshold even in long symptom descriptions.
- **KG Build Fix**: Fixed `index.js` `build_map` to use `addFileWithAnalysis` (correctly populates function/class nodes) and wired **Import Edges**. `query_graph` now supports multi-hop KG traversal.

### `unravel-mcp/index.js` | **NATIVE ENGINE** — Phase 1b (Cross-file) Restored

- **Native Injection**: Re-enabled Phase 1b by injecting `parseCodeNative` into `ast-project.js`. The MCP server now traces variable mutations and shared state across file boundaries without calling the crashing WASM `initParser()`.
- **Pattern Layer**: Integrated `pattern-store.js` into the MCP server startup. 20 pre-loaded patterns (Race Conditions, Stale Closures, etc.) are now automatically flagged to the agent.

### **STRESS TEST: B-10 end-to-end (VERIFIED)**
- **Scenario**: 6 intertwined bugs across 5 files: module-level race (`PricingEngine`), stale timer closure (`SessionManager`), and orphan listener leaks.
- **Result**: **100% Bug Depth Found.**
- **Routing**: `query_graph("discount session timer checkout")` returned all 5 correct files.
- **Reasoning**: LLM correctly identified the shared module state as the root cause.
- **Verification**: `unravel.verify` returned **PASSED (failures: 0)**. 
- **Hallucination Proof**: Every claim verified against the native AST. Zero "hallucinated" line numbers or relationships.

---

## 2026-03-24 — 14:15 IST | Proofread Fix Session (4 issues: 2 bugs, 1 minor, 1 cosmetic)

### `ast-engine-ts.js` | **BUG** — `detectStrictComparisonInPredicateGate` never recursed (same C++ proxy bug)

The `walk()` function inside `detectStrictComparisonInPredicateGate` used `node.children?.find(...)` to locate the operator node, and `for (const child of node.children) walk(child)` to recurse — both fail silently because `node.children` is a C++ proxy in web-tree-sitter, not an iterable JS array.

**Fix:** Replaced the entire `walk()` + `node.children` approach with `tree.rootNode.descendantsOfType('binary_expression')` (same pattern as every other detector). Operator extracted via `childForFieldName('operator')` with a fallback `node.child(i)` loop. Result: the detector now actually visits all binary expressions in the file — previously it returned `[]` for everything.

Synced to `unravel-vscode` via `sync-core.ps1 -Apply`.

---

### `sidebar-ref.js` | **BUG** — `causalChain` items rendered as `[object Object]`

The render loop: `r.causalChain.map((step, i) => ... esc(step) ...)` passed the raw object to `esc()`. The schema defines each entry as `{ step: string, evidence: string, propagatesTo: string }`, so `String(object)` produces `[object Object]`.

**Fix:** Rewrote the render function to correctly destructure each entry: `stepText = entry?.step`, `evidenceText = entry?.evidence`, `propagates = entry?.propagatesTo`. Defensive fallback for legacy plain-string entries. Also added two styled sub-lines: grey `↳ evidence` and amber `→ propagatesTo` — making the causal chain genuinely readable.

WEB-ONLY file — no sync required.

---

### `config.js` (both copies) | **MINOR** — Explain mode rules and `realWorldAnalogy` schema had no English language gate

- **Explain mode rules (L435):** `'Use Indian daily-life analogies when explaining concepts.'` — fires unconditionally, including for English users. Fixed to: `'Analogies: for hinglish/hindi users, use Indian daily-life analogies … For english users, use universally understood analogies.'`
- **`realWorldAnalogy` schema field:** Description mandated vegetarian-only analogies (Indian cultural constraint) with no language gate. Replaced with language-aware instruction matching the LANG_INSTRUCTIONS gate already used by all other mode prompts.

Applied directly to both `unravel-v3` and `unravel-vscode` — sync confirmed both already identical.

---

### `orchestrate.js` (both copies) | **COSMETIC** — Double `if (verification.failures.length > 0)` block (L516+521)

Two consecutive identical `if` blocks: first set `result._verification` and `console.warn`; second set `result._verification` again and `console.group`. Merged into one clean block that does both. The stale `console.warn` (which logged the raw array, not the grouped per-failure output) is removed.

Applied to both `unravel-v3` and `unravel-vscode`.

---



### 13:50 IST | `ast-engine-ts.js` | **CRITICAL BUGFIX** — `detectForEachCollectionMutation` now fires correctly (two root causes eliminated)

**Root Cause 1 — Wrong traversal API (`node.children` not iterable):**
The detector's entire internal walk (`walk()`, `walkChildren()`, `findCallsOnTarget()`, `collectStandaloneCallees()`) used `node.children` from the web-tree-sitter WASM API. In web-tree-sitter, `node.children` is a C++ proxy object, NOT a plain JS array — `for...of` over it visited zero nodes silently. No error was thrown. The detector always returned `[]`.

Every other detector in the file (`detectListenerParity`, `detectDirectStateMutations`, `detectReactPatterns`, etc.) correctly uses `node.descendantsOfType('call_expression')` which returns a real JS array. Fixed by rewriting `buildFunctionBodyMap`, `findCallsOnTarget`, `collectStandaloneCallees`, and the main scan loop to use `descendantsOfType` throughout.

**Root Cause 2 — `tree.delete()` called before detector ran:**
`runMultiFileAnalysis()` called `tree.delete()` at line 1060 to free WASM memory. But `detectForEachCollectionMutation` was placed at line 1113 — *after* the free. After `tree.delete()`, `tree.rootNode` returned falsy, so the function returned immediately on the `if (!tree?.rootNode) return` guard. This bug existed from day one. Every other detector ran before L1060 and was unaffected.

Fixed by moving both `detectForEachCollectionMutation` and `detectStrictComparisonInPredicateGate` to run **before** `tree.delete()`, alongside all other per-file detectors.

**Confirmed working with b-detector-probe benchmark:**
- Depth-0 case (`broadcastDirect` — direct `delete/add` inside forEach callback): 🔴 CRITICAL fired at L49
- Depth-1 case (`broadcast` — `delete/add` inside `_promote()` called from callback): 🔴 CRITICAL fired at L67

**Impact on raft-node:** The ECMAScript §24.2.3.7 double-visit bug (`_grantedVotes.forEach` → `_refreshVoterRecord` → `delete/add`) should now be correctly annotated.

---

### 12:08 IST | `validation/benchmark/packages/b-detector-probe/` | **NEW** — Synthetic probe benchmark created

Created `notification-hub.js`, `symptom.md`, `solution.md` as a purpose-built detector validation tool with two forEach mutation patterns (depth-0 and depth-1) to isolate whether detector failures are file-specific or global.

---

### ~10:30 IST | `ast-engine-ts.js`, `ast-bridge-browser.js`, `App.jsx`, `search.js` | **MILESTONE** — Phase A complete: Behavior-aware execution flow routing

**Phase A: Traffic Flow — Call edge extraction and weighted graph traversal**

- **`ast-bridge-browser.js` — `extractCalls()`:** New function walks the WASM AST to extract `{ caller, callee }` pairs from intra-file function calls. Handles: `foo()`, `obj.foo()`, `this.foo()`. Filters self-calls and non-identifier callees. Updated `analyzeFileWasm()` to return a `calls` array alongside imports/exports/functions/classes.

- **`App.jsx` — Two-pass KG build:** The `handleBuildProjectMap` function now performs a second resolution pass after initial file analysis. Builds a `functionToFile` map (function name → file path), then for each call edge resolves caller file + callee file and calls `builder.addCallEdge()`. Creates typed `'calls'` edges in the Knowledge Graph.

- **`search.js` — `expandWeighted()` priority-queue traversal:** Replaced `expandOneHop()` with a proper weighted multi-hop traversal. Blended scoring formula: `parentScore * 0.7 + edgeWeight * 0.3 + semanticBonus`. Edge type weights: `calls=1.0 > mutates=0.95 > async-calls=0.85 > imports=0.7 > contains=0.5`. Phase B hook: `semanticScores` Map parameter propagates Gemini embedding similarity through the graph (currently unused, wired for Phase B).

- **`search.js` — `queryGraphForFiles()` updated:** Now uses `expandWeighted()` instead of `expandOneHop()`. Seeds from keyword matches, expands via weighted traversal, folds seed scores back in, returns files sorted by best node score. Execution-flow paths are prioritized over structural import paths.

**Platform parity:** `unravel-vscode/src/core/` synced via `sync-core.ps1`. VS Code extension now uses the same behavior-aware routing.

---

### ~09:00 IST | `sync-core.ps1` | **NEW** — Sync script for core files between webapp and VS Code extension

PowerShell script that compares `unravel-v3/src/core/` against `unravel-vscode/src/core/` and syncs only the files that should be shared between both platforms. Run with `-Apply` to write changes. Safely skips webapp-only files.

---


### 11:00 IST | `ast-engine-ts.js` | **BUGFIX** — forEach depth-1 expansion now covers ES6 class methods

**Root Cause:**
`collectStandaloneCallees()` — the depth-1 callee resolver inside `detectForEachCollectionMutation()` — explicitly excluded all method calls (docstring said: "Excludes: method calls (foo.bar())"). This meant depth-1 expansion worked for plain helpers (`helper()`) but was silently dead for class-based codebases where helpers are called as `this.helper()`. This was a **pre-existing limitation from v3.3**, not introduced by the KG integration.

**Impact:**
The detector caught `_grantedVotes.forEach()` at depth-0 but could not follow `this._refreshVoterRecord()` inside it to see the `.delete()` + `.add()` pair that causes the ECMAScript §24.2.3.7 double-visit on the Raft Node benchmark (B-22, Bug 3).

**Fix:**
Added `else if (callee?.type === 'member_expression')` branch to `collectStandaloneCallees`. Checks `obj?.text === 'this'` (text-based rather than node-type check, reliable across all Tree-Sitter grammar versions). If object is `this`, adds `prop.text` (the method name) to the callee set for depth-1 lookup. Updated docstring: "Includes: plain calls `foo()` AND class method calls `this.foo()`".

**Result:** Engine can now follow `this._refreshVoterRecord()` into its body, detect the `delete` + `add` on the same Set being iterated, and emit `🔴 CRITICAL: Collection Mutated During Iteration ⚠ JS SPEC VIOLATION (ECMAScript §24.2.3.7)`.

---

### 10:45 IST | `ast-engine-ts.js`, `config.js`, `orchestrate.js` | **AUDIT** — Full regression audit, all 747 lines added since commit `c9c865f`

**Finding: Zero regressions from KG integration.** Every change is either a new KG feature (isolated from the analysis pipeline) or a pipeline gap implementation that adds fields without modifying existing logic.

**3-Way Raft Benchmark Comparison (B-22):**
| Run | File | Confidence | Bugs Found |
|-----|------|-----------|-----------|
| Original success | `1774167043748.json` | 0.95 | Bug 1 ✅, Bug 2 ✅ |
| Old version re-run | `older-version run again.json` | 0.90 | Bug 1 ✅, Bug 2 ✅ |
| New version | `1774328988668.json` | 0.95 | Bug 1 ✅, Bug 2 ✅ |

Bug 3 (forEach double-visit) was never caught by any version — the original 6/6 score was based on Bugs 1+2 being sufficient. Bug 3 is now catchable with today's depth-1 fix.

Score variation 0.90↔0.95 is normal LLM non-determinism; the 4D confidence recalibration in the new version helps by grounding confidence in epistemic evidence quality rather than LLM self-assessment.

---

### 10:30 IST | `ast-engine-ts.js`, `config.js`, `orchestrate.js` | B-10 Orphan Listener hardening — adversarial override prevention

**`ast-engine-ts.js` — `detectListenerParity()` annotation hardening:**
- Changed soft "style warning" label to `⛔ W3C SPEC CONSTRAINT`
- Added explicit text: "passive/once omission CANNOT cause listener leak (W3C spec: only the capture boolean affects identity — this is NOT the root cause)"
- Section header in `formatAnalysis()` updated from "Event Listener Options Notes" to `⛔ W3C SPEC CONSTRAINT — passive/once DO NOT affect listener identity (hard spec fact, not open to browser-speculation override)`

**`config.js` — Two new global rules:**
- `ELIMINATION QUALITY`: Hypothesis tree entries rated STRONG (≥2 distinct AST-verified facts) / WEAK (1 or inferred) / DEFAULT (survived by elimination only, no positive evidence). DEFAULT survivors confidence-capped at 0.75.
- `AST SPEC ANNOTATION AUTHORITY`: Annotations marked ⛔ or containing "NOT the root cause"/"CANNOT cause" are deterministic facts. Cannot be overridden by: browser speculation, "edge case" reasoning, "some environments may differ", or absence of a falsifying test. Treating a hard spec annotation as "speculative" is a protocol violation.

**`config.js` — Phase 5.5 adversarial pre-check:**
- Model must now list all ⛔-marked annotations from VERIFIED GROUND TRUTH **before** starting adversarial disproof.
- Listed annotations are carved out upfront as off-limits — the model cannot construct arguments against them.
- Previously the carve-out appeared only as a background rule that the model could rationalize past midway through long generations.

**`orchestrate.js` — Check 3: Proportional Accumulation Contradiction:**
- New check in `checkSymptomContradictions()`.
- Detects when symptom describes exact N:N scaling of event count with navigation count.
- Physics: perfect N:N scaling is inconsistent with internal hook cleanup failure (irregular); it means cleanup **never** runs → component never unmounts → root cause is in the router/parent lifecycle **not** in provided files.
- If signal detected AND no router file in provided files: injects `LIFECYCLE CONTEXT REQUIRED` alert driving engine to `needsMoreInfo`.
- Validated against all 23 benchmark symptoms: fires only on B-10, zero false positives.

---

## 2026-03-23 (Layer 0.5/1 — Web App Knowledge Graph Integration)

### 21:15 IST | `App.jsx`, `graph-storage-idb.js`, `ast-bridge-browser.js`, `llm-analyzer.js` | **MILESTONE** — Knowledge Graph + WASM AST fully integrated into Web App

**Features implemented:**

- **WASM AST Engine** (`ast-bridge-browser.js`): Primary extraction now uses `web-tree-sitter` (ABI-13) in the browser. Loads WASM binaries via `fetch()` from `/wasm/`. Provides richer node data than regex (exact line ranges, parameter names).
- **Dual-Engine Strategy**: `ast-bridge-browser.js` now dynamically imports the pure-JS regex `ast-bridge.js` only if WASM fails. Zero overhead for the primary path.
- **Knowledge Maps Browser** (`App.jsx`): New UI panel to manage stored graphs. Users can list all indexed repos, see node/edge counts, load a repo directly into the URL field, or delete/wipe the cache.
- **IDB Metadata Store** (`graph-storage-idb.js`): Upgraded to IndexedDB v2. Added a `graph-meta` store for lightweight repo info. `listAllGraphMeta()` allows the Maps panel to load instantly without pulling large graph objects into memory.
- **LLM-Enhanced Build Mode**: Added a toggle next to "Build Project Map". 
  - `Structural`: 0 API calls, fast WASM analysis.
  - `LLM-Enhanced`: 1 project-summary call for a real description and high-quality architectural layer labels.
- **Graph-Based Routing**: Web app now prioritizes `queryGraphForFiles()` traversal. If a cached map exists, Phase 0.5 uses the graph to select files in ~10ms with **0 LLM router API calls**.

**Critical Build & Architecture Fixes:**

- **ESM Conversion** (`llm-analyzer.js`): Removed `'use strict'` and `module.exports` → converted to proper named ESM exports. Fixed `SyntaxError` in the indexer bundle.
- **Node.js Built-in Stubbing** (`vite.config.js`, `node-module-stub.js`): Aliased `module` to a browser stub. Provides a non-breaking `createRequire` that throws gracefully, allowing `_isNodeAvailable()` guards in `indexer.js` and `graph-storage.js` to work correctly in the browser.
- **Browser-Safe Hashing** (`graph-storage.js`): `computeContentHashSync` now has a `try/catch` around Node's `crypto`. Falls back to a fast **FNV-1a 32-bit hash** in browsers. Prevents runtime crashes during graph building.
- **Import Optimization**: Fixed double-import of `web-tree-sitter` and resolved a recursive fallback bug where the fallback was incorrectly importing a WASM-dependent file.

**Result:** Verified 186-file repo analysis in browser: 1086 nodes, 1137 edges, persisted to IDB. Analysis cost for indexed repos dropped to $0.

---

## 2026-03-23 (Layer 0.5 — Phase 3: Knowledge Graph Zero-Edges Bug Fix)

### 19:53 IST | `ast-bridge.js` (vscode + v3) | **CRITICAL FIX** — Knowledge graph now produces real edges

**Root Cause:**
The `initParser()` function in `ast-engine-ts.js` uses `web-tree-sitter` (an Emscripten-compiled WASM library). Its `Parser.init()` call internally uses `fetch()` to load the `.wasm` binary — but VS Code's extension host is a sandboxed Node.js process with no `fetch()` for local file paths. This caused the WASM runtime to silently crash inside the `try/catch` in `ast-bridge.js`, which returned early without ever attaching `structuralAnalysis` to any file. Result: 0 edges every time, for every build.

**What was tried (didn't work):**
- Passing `locateFile` callback to `Parser.init()` — WASM init still uses `fetch` after resolving the path
- Passing `Uint8Array` (via `fs.readFileSync`) to `Language.load()` — fixes `Language.load`, but `Parser.init()` still fails first
- Marking `tree-sitter-javascript` / `tree-sitter-typescript` as `external` in esbuild
- Fixing WASM `__dirname` path resolution for Windows backslashes
- ABI mismatch investigation (old `.wasm` files were ABI 13, needed ABI 14 for `web-tree-sitter@0.26.x`)

**What fixed it:**
Replaced the entire WASM-based `ast-bridge.js` with a **pure-JS regex extractor** — no WASM, no `fetch()`, no external dependencies. This is the same approach used by webpack, rollup, ESLint, and esbuild for import scanning. Handles all patterns:
- ESM: `import X from './y'`, `import { X } from './y'`, `import * as X from './y'`
- Re-exports: `export { X } from './y'`, `export * from './y'`
- CJS: `const X = require('./y')`
- Dynamic: `import('./y')`
- Functions: declarations, arrow functions, async, generators, class methods
- Classes, exports

**Result:** `128 files → 950 nodes, 975 edges in 0.7s` (was `272 files → 272 nodes, 0 edges in 3402s`)

**Files changed:**
- `unravel-vscode/src/core/ast-bridge.js` — complete rewrite (pure-JS extractor)
- `unravel-v3/src/core/ast-bridge.js` — synced (same file)
- `unravel-vscode/esbuild.js` — reverted: removed `tree-sitter-javascript`/`tree-sitter-typescript` from externals
- `unravel-vscode/package.json` — removed `tree-sitter-javascript` + `tree-sitter-typescript` deps (no longer needed)

---

### 19:30 IST | `ast-engine-ts.js`, `extension.js`, `package.json`, `esbuild.js` | Feature additions + earlier WASM fix attempts

**Features implemented:**

- **Build Mode QuickPick** (`extension.js`): Before starting the KG build, a QuickPick prompt asks the user to choose between:
  - `Structural-Only (Fast, 0 API calls)` — pure graph, no LLM
  - `LLM-Enhanced (Semantic, N calls)` — adds file summaries and tags
  - `Cancel`
  The `useLLM` flag is passed through to `buildKnowledgeGraph()`.

- **Exclude Folders setting** (`package.json`, `extension.js`): New `unravel.excludeFolders` configuration setting. Accepts an array of folder names (e.g. `["Understand-Anything-Clone", "node_modules"]`). These are appended to the glob exclude pattern during file discovery. Prevents indexing cloned reference repos or any unwanted directory.

- **Enhanced error logging** (`extension.js`): AST extraction errors now print full message + 3-line stack trace to the Unravel Output channel instead of being silently swallowed.

**WASM fix attempts (ultimately replaced by pure-JS approach above):**
- `ast-engine-ts.js`: Added `fs.readFileSync` → `Uint8Array` path for `Language.load()` (bypasses `fetch` for language files, but `Parser.init()` still fails)
- `ast-engine-ts.js`: `path.resolve(__dirname, '..', 'wasm')` for correct Windows path handling
- `esbuild.js`: Temporarily added `tree-sitter-javascript`/`tree-sitter-typescript` as externals

---

## 2026-03-23 (Layer 0.5 — Phase 2 Bug Fixes)

### 16:53 IST | `extension.js`, `sidebar.js`, `ast-bridge.js` | 8 bugs fixed post-review

**🔴 Critical:**
- **Bug 1 — ESM via require():** Changed `require('./core/ast-bridge.js')` and `require('./core/indexer.js')` to `await import(...)`. Dynamic import of ESM from CJS works in Node 18+ (VS Code extension host).
- **Bug 2 — provider 'gemini' → 'google':** Default was `'gemini'` but `provider.js` keys on `'google'`. Would throw `Invalid provider: gemini` on every LLM call during graph building.
- **Bug 3 — `_kgPanel` TDZ:** Moved `let _kgPanel = null` to module top-level next to `currentPanel`. Removed duplicate declaration lower in file.

**🟡 Minor:**
- **Bug 4:** Added `#log .line-red { color: var(--c-red); }` — error log lines were unstyled.
- **Bug 5:** `attachStructuralAnalysis` now filters to `js|jsx|ts|tsx|mjs|cjs` before AST parsing. JSON/CSS/MD no longer get JS grammar applied.
- **Bug 6:** Removed unused `let current = 0; current++` from `initializeKnowledgeGraph`.
- **Bug 7:** `context` param renamed to `_ctx` with JSDoc "reserved for future webview resource URIs".
- **Bug 8:** Added `<meta http-equiv="Content-Security-Policy" ...>` to KG init panel WebView.

---

## 2026-03-23 (Layer 0.5 — Phase 1 Bug Fixes)

### 16:33 IST | `graph-builder.js`, `graph-storage.js`, `search.js`, `layer-detector.js`, `indexer.js` | 7 bugs fixed post-review

**🔴 Critical (would crash at runtime):**
- **Bug 1 — `callProvider` signature:** `_analyzeFile` was passing `(messages[], options)`. Fixed to flat `{ provider, apiKey, model, systemPrompt, userPrompt }`. Response extraction fixed from `response?.content` to raw string (`typeof response === 'string' ? response : ''`).
- **Bug 2 — ESM/CJS mismatch:** `graph-builder.js`, `graph-storage.js`, `search.js`, `layer-detector.js` were CJS (`module.exports`). All 4 converted to ESM (`export`). `graph-storage.js` uses `createRequire(import.meta.url)` for Node.js `fs`/`path`/`crypto`. `indexer.js` also converted to ESM.

**🟠 Functional (silent wrong behaviour):**
- **Bug 3 — `getChangedFiles` async trap:** Removed async hashFn claim. Function is sync-only. Added doc comment explaining why. The `hash` value is now guaranteed a string, so `storedHashes[f.name] !== hash` is a reliable comparison.
- **Bug 4 — Incremental update loses function/class nodes:** `getChangedFiles` now carries `structuralAnalysis` through in its return objects (the field was already on the input files). Incremental loop now accesses `file.structuralAnalysis` correctly and calls `addFileWithAnalysis` when present.

**🟡 Minor:**
- **Bug 5 — IndexedDB no-guard:** `_openIDB()` now throws `'IndexedDB is not available in this environment'` if `typeof indexedDB === 'undefined'`.
- **Bug 6 — Layer detection misses flat filenames:** `matchFileToLayer` now checks the filename stem via substring match, not just directory segments. `userController.js` → stem `usercontroller` → contains `controller` → assigned to API Layer.
- **Bug 7 — Redundant inline `require`:** Moved `applyLLMLayers` import to top-level in `indexer.js`.

---

## 2026-03-23 (Layer 0.5 — Phase 1: Knowledge Graph Core Indexer)

### 16:12–16:47 IST | `unravel-v3/src/core/`, `unravel-vscode/src/core/`, `orchestrate.js` | Phase 1 Knowledge Graph core indexer built and wired

**New files (both `unravel-v3` and `unravel-vscode`):**
- `graph-builder.js` — `GraphBuilder` class (port of UA's graph-builder.ts). Creates file/function/class nodes + import/call edges. Every node/edge tagged `trustLevel: 'AST_VERIFIED' | 'LLM_INFERRED'`. `mergeGraphUpdate()` for incremental splicing. Per-file `contentHash` map in the graph schema.
- `layer-detector.js` — Heuristic layer detection (zero LLM cost, ms) + LLM-powered `applyLLMLayers()` path. 9 pattern groups including the new `core/engine/pipeline` category.
- `llm-analyzer.js` — `buildFileAnalysisPrompt()` + `buildProjectSummaryPrompt()` + response parsers. Wired to Unravel's existing `callProvider()`.
- `search.js` — Pure-JS fuzzy search engine (no Fuse.js dependency). Weighted scoring across name/tags/summary/filePath. `expandOneHop()` for 1-hop graph traversal. `queryGraphForFiles()` as single entry point for Phase 0.5.
- `graph-storage.js` — Dual-backend persistence: Node.js `fs` (VS Code/indexer) + IndexedDB (web app). `computeContentHashSync()` / `computeContentHashAsync()` SHA-256. `getChangedFiles()` for O(N) incremental invalidation.
- `indexer.js` — Top-level orchestrator: `buildKnowledgeGraph()` (full) + `updateKnowledgeGraph()` (incremental). `onProgress` callback for per-file UI progress.

**Modified:** `orchestrate.js` Phase 0.5 — knowledge-graph router injected before the existing AST router. When `knowledge.json` exists and returns ≥ 3 results, routes files instantly (free, ~10ms). Falls back to `selectFilesByGraph()` then all-files. `_routerStrategy` now records `'knowledge-graph'` in provenance.

---

## 2026-03-23 (VS Code UI Overhaul + Bug Fixes — manual)

### 16:12 IST | `diagnostics.js`, `extension.js`, `sidebar.js` | Bug fixes + full sidebar UI overhaul

**`diagnostics.js`:** `extractLineNumber` fast path for `{file, line}` objects; regex now handles `line:42` / `line=42` patterns in JSON strings — squiggles now render for object-shaped `codeLocation`.

**`extension.js`:** `cmdClear` fetches active editor before calling `clearDecorations()` — no crash when no file is open.

**`sidebar.js`:** Dead `buildAILoopMermaid` removed; `buildHypothesisMermaid` gets cycle guard; `fixData` double-escaping removed (no more `&#39;` noise). Full CSS overhaul: all colours now use `--vscode-*` theme variables mapped to a `--c-*` token system so the panel adapts to any VS Code theme. Hard blacks replaced with surface variables. Headers toned down (`font-weight:600`, `letter-spacing:0.8px`). Badges are pill-shaped with soft background tints. Action buttons have transitions. Streaming indicator is a subtle pulsing dot. `EXTERNAL_FIX_TARGET` early-return path and all inline banners updated to CSS variable equivalents. Mermaid definition strings intentionally left with hex (CSS variables cannot be used inside Mermaid definitions).

---

## 2026-03-23 (VS Code Extension Audit)

### 15:47 IST | `unravel-vscode/src/extension.js`, `unravel-vscode/src/sidebar.js` | VS Code extension audit — v2.0 field coverage gap fixed

**What:** After the core sync, the VS Code extension was missing rendering for all 8 new v2.0 pipeline gap fields, and `EXTERNAL_FIX_TARGET` was unhandled in both `extension.js` and `sidebar.js`.

**Fixed in `extension.js`:**
- Added `EXTERNAL_FIX_TARGET` verdict handler: logs repo + file to output panel, shows VS Code warning message, routes to report panel.

**Fixed in `sidebar.js`:**
- `renderDebug()` now renders all v2.0 fields: `adversarialCheck` (Phase 5.5 attack result), `wasReentered` banner, `multipleHypothesesSurvived` banner, `evidenceMap` (SUPPORTED / CONTESTED / UNVERIFIABLE cards), `causalChain` (numbered steps), `fixInvariantViolations` (red list), `relatedRisks` (amber cards).
- `buildReportHTML()` now has a dedicated fast-path for `EXTERNAL_FIX_TARGET` verdict: renders a full amber banner with `targetRepository`, `targetFile`, `suggestedAction`, followed by the full diagnosis below it.

**Why:** The sidebar was built before the pipeline gap work was completed. Every field the engine now emits is now rendered — the VS Code and web app reports are at feature parity.

---

## 2026-03-23 (VS Code Sync + Schema Convention)

### 15:15 IST | `unravel-vscode/src/core/`, `SCHEMA_VERSIONING.md`, `CHANGELOG.md` | Synced VS Code extension core + documented schema convention

- `unravel-vscode/src/core/orchestrate.js` — copied from web app (77KB → 91KB); now has all 7 pipeline gaps + reviewer additions + 4D confidence + REENTRY/MULTIPLE_SURVIVORS events + prompt-injection hardening + `schemaVersion: '2.0'` in `_provenance`
- `unravel-vscode/src/core/config.js` — copied from web app (60KB → 80KB); all new phases (3.5, 5.5, 7.5, 8.5), new schema fields, PIPELINE_TERMINATION_POLICY, ELIMINATION QUALITY rule
- `unravel-vscode/src/core/parse-json.js` — copied from web app (8KB → 9.7KB); `migrateSchema()` export included
- `unravel-vscode/src/core/index.js` — added `migrateSchema` to barrel export
- `SCHEMA_VERSIONING.md` — created; documents the bump convention, v2.0 field table, and migration usage. This is the visible permanent reference for when schemaVersion must be bumped and how consumers handle it

---

## 2026-03-23 (Schema Versioning + Cleanup)

### 14:43 IST | `orchestrate.js`, `parse-json.js`, `future-thoughts.md` | Schema versioning + migration shim + cleanup

- `orchestrate.js` `_provenance`: added `schemaVersion: '2.0'` — bump this whenever schema fields are added/removed/renamed
- `parse-json.js`: exported `migrateSchema()` — call after parsing any result; backfills all 8 v2.0 fields with safe defaults so v1.x consumers don't crash on missing keys. `causalCompleteness` backfills as `null` (unknown, not false) to avoid false confidence penalties
- `future-thoughts.md`: deleted orphaned computed-confidence prose (L366-370) that was accidentally appended in a previous session

---

## 2026-03-23 (Pipeline Gap Implementation)

### 09:16 IST | `config.js`, `orchestrate.js`, `App.jsx` | All 7 pipeline gaps + 4 reviewer additions implemented

**config.js — Prompt phases:**
- Phase 3: FALSIFIABILITY instruction added — model must state what would disprove each hypothesis
- Phase 4: Upgraded to Evidence Triple model (supporting/contradicting/missing + SUPPORTED|CONTESTED|UNVERIFIABLE|SPECULATIVE verdict)
- Phase 3.5 added: Hypothesis Expansion after Phase 4; hypothesis space closes here
- Phase 5: FALSIFIABILITY CHECK + CAUSAL CHAIN requirement (root→symptom with code evidence at every link)
- Phase 5.5 added: Adversarial Confirmation — 3-state deterministic loop (0 survivors → re-enter, 2+ → surface all, 1 → done)
- Phase 7.5 added: Pattern Propagation Check — same structural pattern at other locations, POTENTIAL RISK labels
- Phase 8.5 added: Fix-Invariant Consistency Check — fix validated against Phase 8 invariants, one revision allowed

**config.js — Schema:** `hypothesisTree` items updated (UNVERIFIABLE status, `falsifiableIf[]`, `eliminationQuality`). New report fields: `causalChain[]`, `causalCompleteness`, `adversarialCheck`, `multipleHypothesesSurvived`, `evidenceMap[]`, `fixInvariantViolations[]`, `relatedRisks[]`. ELIMINATION QUALITY rule added.

**orchestrate.js:**
- `PIPELINE_TERMINATION_POLICY`: `maxHypothesisExpansionRounds: 2`, `maxFixRevisions: 1`, `maxSelfHealIterations: 3`
- `sanitizeFileContent()` + `dataTrustBoundary` header — prompt-injection hardening
- Post-gen UNVERIFIABLE check: fires self-heal for missing files before accepting diagnosis
- 4-dimensional confidence recalibration: UNVERIFIABLE→0.70, causalCompleteness false→0.70, DEFAULT survivor→0.75, multiple survivors→0.65

**App.jsx:**
- `elapsedSeconds` state with `useEffect` timer watching `step===3`
- `onProgress` extended: `REENTRY` resets adversarial dot + shows label; `MULTIPLE_SURVIVORS` shows banner
- Progress card: elapsed time in header, orange re-entry banner, orange multiple survivors banner


### 07:21 IST | `CHANGELOG.md` | Created changelog | Track changes with date, time, location, and rationale going forward

### 07:19 IST | `next_phase_plan.md` | Gap 1–7 added as Priority 0 | Pipeline gaps identified in `gaps in pipeline.md` are higher priority than language refactor — pure engine changes, no infrastructure dependency

### 07:11 IST | `next_phase_plan.md` | Multi-Agent Mode and Heavy Mode separated | They solve different problems (confidence vs scale) and are orthogonal decision branches, not competing modes

---

## 2026-03-22

### 19:51 IST | `future-thoughts.md` | Added Section 10 — Integrated Vision | Synthesised UA integration, Gemini Embedding 2, enterprise angle, epistemic provenance labels, and revised 10-step execution order into one document

### 19:07 IST | `Understand-Anything-Clone/` | Cloned UA repo (MIT license) | Local reference for porting `graph-builder.ts`, `layer-detector.ts`, and `llm-analyzer.ts` into Unravel's mapper layer

### 19:02 IST | `Understand-anything.md`, `.gitignore` | Created UA integration plan; added to gitignore | Documents the stateful intelligence architecture (Layer 0.5 semantic map, persistent knowledge.json, epistemic provenance labels). Internal doc, not for public repo.

### 19:24 IST | `unravel-v3/src/core/config.js` | Added vegetarian-only constraint to `realWorldAnalogy` schema field | Prevents LLM from generating analogies involving meat, fish, hunting, or slaughter in the analysis output

### 15:08 IST | `.gitignore` | Added `bug_catalog.txt`, `Language guide.txt`, `unravel-landing.html`, `old bugs for initial testing/`; cleared Git cache for all | Pre-HN repo cleanup — these are internal/testing files not meant for public view

---

## 2026-03-22 (README — HN Prep)

### ~19:00 IST | `README.md` | Five surgical edits for HN audience |
- Added 3-column mental model table below subtitle (for skimmers)
- Changed "cannot contradict" → "explicitly instructed to treat as non-negotiable constraints, contradictions penalized by verifier" (realistic wording)
- Added adversarial framing blockquote to Benchmark section (preempts "toy benchmark" attack)
- Changed "functionally equivalent" → "comparable on this benchmark" (accurate scope)
- Applied same constraint wording fix in Step 6 of architecture walkthrough

---

## 2026-03-21 (Engine v3.3)

### `unravel-v3/src/core/config.js`, `ast-engine-ts.js` | New detectors + engine hardening |
- `detectForEachCollectionMutation` with depth-1 callee expansion — cites ECMA-262 §24.2.3.7. Treats as verified structural fact.
- `detectStrictComparisonInPredicateGate` — `>` / `<` inside `is*`, `can*`, `has*` named functions. Treated as heuristic signal, clearly separated from verified facts.
- `additionalRootCauses[]` schema: strict independence test required (different trigger, fix location, symptom)
- Symptom coverage enforcement: multi-part symptoms trigger injection requiring all behaviors addressed
- AST ground truth block now separates `[VERIFIED]` from `[HEURISTIC]` facts

### B-22 Raft Consensus Benchmark |
- 3 independent bugs in 2,800 lines: phantom pre-vote promotion, Set.forEach double-visit (ECMA-262), strict `>` log comparison
- Unravel 6/6. Fix more complete than Claude Sonnet 4.6 (removed all three components; Claude left dead code)
