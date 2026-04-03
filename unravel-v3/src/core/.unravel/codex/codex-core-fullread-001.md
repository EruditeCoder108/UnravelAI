## TLDR
18 files read. 8 files are MCP-path-irrelevant (browser/web-app only): provider, llm-analyzer, parse-json, ast-bridge-browser, graph-storage-idb, layer-detector (LLM path), sidebar-ref, barrel index.js.
The orchestrate.js web-app pipeline has 8 phases (0→5.7) plus 4 post-gen recalibrations. MCP terminates at Phase 1d with the MCP_REASONING_PROTOCOL block — no LLM is called.
The 3 critical post-gen mechanisms are: 4-dimensional confidence recalibration (L895-966), solvability/layer-boundary detection (L1045-1257), and verifyClaims 6-check verifier (L1267-1784).

## Meta
Problem: Read every file in unravel-v3/src/core to build a complete verified understanding of the engine for how_unravel_works.md update.
Tags: core-engine, ast, orchestrate, indexer, provider, layer-detector, llm-analyzer, parse-json, sidebar-ref
Files to read: 18 total
Files already audited (codex-core-audit.md has findings — do NOT re-read from scratch):
  - ast-engine-ts.js ✅ (L1-800+ read, mutation chains, scope resolver, NOISE_GLOBALS, TIMING_APIS)
  - config.js ✅ (full read, web-app only, ENGINE_SCHEMA, PRESETS, LLM prompt builder)
  - pattern-store.js ✅ (full read, hash/match/learn, top-5 at ≥0.5)
  - search.js ✅ (full read, queryGraphForFiles, expandWeighted 1-hop 0.4×)
  - graph-builder.js ✅ (full read, AST_VERIFIED vs LLM_INFERRED, edge weights)
  - graph-storage.js ✅ (full read, Node.js fs vs IndexedDB, SHA-256 sync hash)
  - ast-bridge.js ✅ (full read, calls[] always empty, AMBIGUOUS_STEMS)
  - indexer.js ✅ (full read, LLM analysis web-app path only, MCP passes no callProvider)
  - ast-project.js ✅ (full read, 5-stage cross-file pipeline, unawaited_promise DEFERRED)
  - orchestrate.js ✅ (partial — L1-800 read, full pipeline known from MCP behavior)
New files to read in this session:
  - orchestrate.js (L800-end — continuation needed)
  - index.js (1.7KB — entry point, quick)
  - layer-detector.js (7.3KB — solvability)
  - llm-analyzer.js (6.5KB — LLM analysis)
  - parse-json.js (9.7KB — JSON repair)
  - provider.js (9.4KB — LLM provider)
  - ast-bridge-browser.js (16KB — browser WASM bridge)
  - graph-storage-idb.js (7.8KB — browser IndexedDB)
  - sidebar-ref.js (65KB — UI, likely BOUNDARY)
Files touched: none yet
Invariants from prior audit:
  - MCP path: native tree-sitter, no WASM, no LLM calls in build_map
  - orchestrate.js:MCP_REASONING_PROTOCOL is the only source of MCP agent instructions
  - build_map must stay in sync with indexer.js:buildKnowledgeGraph options

## Discoveries

### index.js (49 lines — barrel export)
Discovery context: looking for what the core exposes and what's NOT exported (MCP-relevant filter)

- L1-49 → BOUNDARY: Pure barrel export. No logic here.
- DECISION: NOT exported (NOT in core public API): layer-detector.js, llm-analyzer.js, graph-builder.js, graph-storage.js, graph-storage-idb.js, indexer.js, ast-bridge.js, ast-bridge-browser.js, search.js
- DECISION: IS exported: runFullAnalysis, runMultiFileAnalysis, initParser (ast-engine), runCrossFileAnalysis + 6 more (ast-project), parseAIJson (parse-json), callProvider + callProviderStreaming (provider), orchestrate (orchestrate)
- CONNECTION: MCP's index.js imports directly from orchestrate.js and ast-project.js — does NOT go through this barrel. This file is for the web app Vite bundle only.

NOT relevant to any MCP task: this entire file.

---

### layer-detector.js (156 lines)
Discovery context: looking for how layer detection works and whether MCP uses it

- L6-16 → DECISION: LAYER_PATTERNS = 9 categories (API, Service, Data, UI, Middleware, Utility, Test, Configuration, Core). Pure string-pattern matching on path segments and filename stems.
- L33-54 → DECISION: matchFileToLayer() — checks ALL directory segments + filename stem (no extension). Substring match: "userController.js" matches "controller". Files not matching any pattern → default 'Core'.
- L60-82 → DECISION: detectLayers(graph) — heuristic, zero LLM cost. Assigns ONLY file-type nodes.
- L87-113 → DECISION: buildLayerDetectionPrompt() + parseLayerDetectionResponse() — LLM path. Returns 3-7 layers with filePatterns. Used by indexer.js when LLM analysis is active.
- L118-155 → DECISION: applyLLMLayers() — applies LLM-detected layers to graph by path-prefix matching.
- CONNECTION: indexer.js uses detectLayers() (heuristic, fast) by default. LLM layers used only if LLM analysis enabled (web app path).
- BOUNDARY: MCP build_map calls detectLayers() (heuristic) from indexer.js. LLM layer detection NOT used in MCP.

NOT relevant to MCP: buildLayerDetectionPrompt, parseLayerDetectionResponse, applyLLMLayers (LLM path).

---

### llm-analyzer.js (149 lines)
Discovery context: looking for what LLM analysis produces and whether MCP uses it

- L17-39 → DECISION: buildFileAnalysisPrompt() — truncates file content at 12000 chars, asks LLM for: fileSummary, tags (3-6), complexity (simple/moderate/complex), functionSummaries{}, classSummaries{}, languageNotes.
- L49-74 → DECISION: buildProjectSummaryPrompt() — sends file list + up to 5 sample files (3000 char each), asks LLM for: description, frameworks[], layers[].
- L98-120 → DECISION: parseFileAnalysisResponse() — normalizes LLM output. Falls back gracefully to defaults if any field missing. Complexity validated against 3-value set.
- L126-148 → DECISION: parseProjectSummaryResponse() — same pattern.
- CONNECTION: indexer.js calls both. MCP build_map passes no callProvider → _analyzeFile() returns EMPTY_META → all LLM metadata is empty strings/arrays. These prompt builders are NEVER called in MCP path.
- BOUNDARY: Entire file is web-app path only. MCP produces zero LLM summaries on build_map.

NOT relevant to MCP: entire file.

---

### provider.js (213 lines)
Discovery context: looking for what providers are supported and how streaming works

- L12-32 → DECISION: fetchWithRetry() — exponential backoff, 4 retries, starts at 1500ms, doubles each. Retries only on 429 + 5xx. AbortError is NEVER retried (user clicked cancel).
- L47-86 → DECISION: callProvider() — supports: 'anthropic' | 'google' | 'openai'. Google: structured output schema attached if useSchema+responseSchema both truthy. Anthropic: browser path routes to /api/anthropic proxy; Node path hits API directly. OpenAI: standard.
- L61-66 → DECISION: Anthropic browser path: injects _apiKey into body (proxied) rather than sending key in headers. This is the Netlify proxy pattern — key stays server-side.
- L98-212 → DECISION: callProviderStreaming() — SSE reading via ReadableStream. Provider-specific chunk extraction: Google (candidates[0].content.parts[].text), Anthropic (content_block_delta → text_delta), OpenAI (choices[0].delta.content). Falls back to callProvider() on stream error (except AbortError).
- L183-188 → DECISION: Anthropic extended thinking — thinking_delta events fire onChunk('') as heartbeat. Progress bar stays alive during thinking phase without accumulating text.
- CONNECTION: orchestrate.js calls callProvider() and callProviderStreaming() for all LLM calls in web app mode. MCP path returns at Phase 1d BEFORE any callProvider call.
- BOUNDARY: MCP never reaches callProvider(). Entire file is web-app path and VS Code extension path only.

NOT relevant to MCP: entire file (MCP terminates before any LLM call).

---

### parse-json.js (253 lines)
Discovery context: looking for how LLM JSON responses are parsed and what repair strategies exist

- L17-74 → DECISION: parseAIJson() — 4-stage cascade: (1) direct JSON.parse, (2) markdown code fence extraction (handles fences anywhere), (3) balanced brace matching via findJsonCandidates() preferring objects with 'report' or 'needsMoreInfo' keys, (4) truncated JSON repair.
- L83-115 → DECISION: migrateSchema() — schema migration v1.x → v2.0. Backfills 8 new fields (causalChain, adversarialCheck, wasReentered, multipleHypothesesSurvived, evidenceMap, fixInvariantViolations, relatedRisks). Also backfills falsifiableIf + eliminationQuality on each hypothesisTree entry.
- L127-165 → DECISION: findJsonCandidates() — balanced brace matching with string-skip logic. Sanitizes literal newlines inside strings before scanning (the #1 LLM JSON failure mode). Results sorted largest-first.
- L172-196 → DECISION: sanitizeLiteralNewlines() — character-by-character scan, replaces literal \n/\r inside string values with escaped equivalents. Called before BOTH candidate finding AND repair.
- L206-252 → DECISION: repairTruncatedJson() — strips markdown fences, counts unclosed braces/brackets, strips trailing partial values (incomplete strings, trailing commas, incomplete keys), closes open brackets then braces.
- CONNECTION: orchestrate.js calls parseAIJson() on every LLM response. migrateSchema() called on parsed result to handle old analysis results.
- BOUNDARY: MCP path returns before any LLM call → parseAIJson() never called in MCP mode. But migrateSchema() fields reveal the ENGINE_SCHEMA structure — useful for understanding what the web app produces.

NOT relevant to MCP: most of this file. migrateSchema() fields list is useful for documenting web app output schema.

---

### orchestrate.js (1951 lines) — web app pipeline [continuation from prior audit L1-800]
Discovery context: understanding post-LLM phases, claim verifier, solvability check — all of which are WEB APP ONLY

- L601-620 → DECISION: Schema retry — if parseAIJson fails, retries WITHOUT schema constraint, adds "CRITICAL: You MUST respond with valid JSON only" to userPrompt. Max 1 retry.
- L626-660 → DECISION: Phase 5 verifyClaims() call — soft failures (wrong line#) degrade confidence; hard rejection (hallucinated file) sets needsMoreInfo=true + _verificationRejected=true. Security mode: cvulns with confidence<0.7 downgraded to INFORMATIONAL.
- L662-700 → DECISION: Phase 5.5 Solvability (checkSolvability) — fires ONLY in debug mode, ONLY when NOT result.needsMoreInfo. Returns LAYER_BOUNDARY_VERDICT JSON (not a report) when root cause is upstream of provided files.
- L702-788 → DECISION: Phase 5.6 Missing Fix Target — detects when LLM diagnosed correctly but fix is in an unprovided file. Signal A: speculative phrases in minimalFix text. Signal B: codeLocation references file not in codeFiles. Triggers self-heal (needsMoreInfo+missingFilesRequest).
- L790-828 → DECISION: Phase 5.7 External Fix Target — if fix is in a DIFFERENT REPO (cross-repo reference, not hallucination), returns EXTERNAL_FIX_TARGET_VERDICT with full diagnosis preserved.
- L830-877 → DECISION: Phase 6 Self-heal — recursive orchestrate() call with additional files appended (max _depth=2). GitHub mode: if onMissingFiles returns null, clears needsMoreInfo and attaches _missingImplementation banner.
- L879-893 → DECISION: Post-Gen UNVERIFIABLE check — any UNVERIFIABLE hypothesis + missing[] evidence → triggers another self-heal to fetch those missing files.
- L895-966 → DECISION: 4-Dimensional Confidence Recalibration:
  - Dim 1: UNVERIFIABLE hypothesis → cap 0.70
  - Dim 2: causalCompleteness=false → cap 0.70
  - Dim 3: elimination quality DEFAULT→ cap 0.75, WEAK → cap 0.82
  - Dim 4: multiple survivors → orthogonal (no shared citations) → cap 0.85; competing (shared) → cap 0.65
- L989-1001 → DECISION: _provenance stamped on all results: schemaVersion '2.0', engineVersion '3.3', astVersion '2.2', routerStrategy, crossFileAnalysis flag, model/provider, timestamp.
- L1009-1043 → DECISION: checkFileCompleteness() — detects truncated files: HTML missing </html>, JS/TS unbalanced braces (>2 unclosed), CSS unbalanced braces. Pure heuristic.
- L1045-1257 → DECISION: checkSolvability() — detailed above. Two gates: (1) PRIMARY deterministic: rootCause cited 0 provided files; (2) SECONDARY heuristic: UPSTREAM_LAYER_KEYWORDS in rootCause+evidence text. Confidence: base 0.70 + 0.05 per keyword +0.10 if no citations.
- L1267-1784 → DECISION: verifyClaims() — 6 checks:
  - Check 1: evidence[] — file refs must be in codeFiles (penalty +0.2 per bad ref). Line numbers NOT checked here.
  - Check 2: codeLocation — file refs (+0.3 penalty), line numbers checked (line>file.length+6 → +0.3).
  - Check 3: rootCause — file refs: HARD REJECT if not in codeFiles AND not in symptom whitelist AND not cross-repo. Line numbers: soft penalty only (+0.15 if line>file.length+10).
  - Check 4: variableStateEdges vs AST mutations — warning only, no confidence penalty. Fuzzy matching (strips this., [], parentheticals).
  - Check 5: Security mode — vulnerability.location file refs checked (+0.2 penalty).
  - Check 6: Fix Completeness — if fix changes a function signature (removedLines contains function declaration), checks all callers in callGraph. Skips React component files and additive-only changes.
- L1787-1950 → DECISION: checkSymptomContradictions() — 3 checks injected as prompt alerts:
  - Check 1: LISTENER GAP — "not firing" symptom + addEventListener IS present in AST.
  - Check 2: CRASH SITE ≠ ROOT CAUSE — accused function only READS state, makes no writes.
  - Check 3: LIFECYCLE CONTEXT REQUIRED — N:N proportional accumulation + navigation context, no router file provided.
- BOUNDARY: ALL of this is web-app only. MCP path returns at Phase 1d (before any LLM call) with MCP_REASONING_PROTOCOL block. None of phases 2→5.7, post-gen recalibration, or claim verifier run in MCP.
- CONNECTION: orchestrate.js L1-800 contains the MCP_REASONING_PROTOCOL block (verified in prior audit). The web-app pipeline is phases L250-1001. Verification helpers are L1004-1950.

NOT relevant to MCP: ALL of L601-1951 (web-app LLM path). L100-250 (MCP termination at Phase 1d) IS relevant.

---

### graph-storage-idb.js (193 lines)
Discovery context: confirming this is browser-only, nothing shared with MCP path

- L1-9 → BOUNDARY: "Zero Node.js dependencies — safe to import in Vite browser builds." Confirmation: browser-only.
- L11-14 → DECISION: IDB stores: 'graphs' (full graph, large) + 'graph-meta' (lightweight metadata). Version 2 — added graph-meta in v2.
- L24-31 → DECISION: computeContentHashAsync() — Web Crypto API SHA-256, async. Same "sha256:" prefix format as graph-storage.js computeContentHashSync. Connection: dual implementations for different runtime environments.
- L80-121 → DECISION: CRUD: saveGraphIDB, loadGraphIDB, deleteGraphIDB. deleteGraphIDB is a SINGLE transaction spanning both stores.
- L140-193 → DECISION: saveGraphMeta/listAllGraphMeta — lightweight metadata: {repoName, repoUrl, nodeCount, edgeCount, builtAt, mode:'structural'|'llm'}.
- BOUNDARY: MCP uses graph-storage.js (Node.js fs, sync). This file is never touched in MCP path.

NOT relevant to MCP: entire file.

---

### ast-bridge-browser.js (394 lines)
Discovery context: understanding WASM vs native tree-sitter difference for accuracy comparison

- L4-18 → DECISION: WASM primary, regex fallback. Compatible with web-tree-sitter@0.22.4 + ABI-13 WASM files. WASM served from public/wasm/ → /wasm/ at runtime.
- L34-62 → DECISION: initWasm() — dynamic import of 'web-tree-sitter', loads JS+TS+TSX grammars. If fails → _initFailed=true → regex fallback activated. Single init (cached via _initDone flag).
- L75-105 → DECISION: extractImports() — ESM import_statement + export_statement (re-exports) via AST walk, plus CJS require() via regex supplement.
- L111-151 → DECISION: extractFunctions() — covers function_declaration, generator_function_declaration, arrow_function+const pattern, method_definition. Dedup via seen Set.
- L172-201 → DECISION: extractExports() — export_statement walk: named declarations + export_clause specifiers.
- L218-265 → DECISION: extractCalls() — tracks enclosing function via AST walk. Member calls (foo.bar()) → last identifier = callee. Filters built-ins, skips self-calls. PRODUCES calls[] with {caller, callee} pairs.
- CORRECTION of prior audit finding: ast-bridge.js (Node.js regex version) returns calls:[] empty. But ast-bridge-browser.js (WASM version) does produce real call edges via extractCalls(). This distinction matters: MCP uses native tree-sitter (ast-engine-ts.js) which ALSO produces call edges. Browser uses WASM. Regex bridge (ast-bridge.js) is the only one that genuinely produces no calls.
- L330-365 → DECISION: attachStructuralAnalysis() — resolves import paths using resolveImportPath() with try-extensions (.js,.ts,.jsx,.tsx,.mjs,.cjs) + index.js fallback. Attaches to file.structuralAnalysis.
- CONNECTION: Indexes files the same way as ast-engine-ts.js (MCP) but via different parser. Same structuralAnalysis shape. graph-builder.js consumes either.
- BOUNDARY: This file is browser-only. MCP never imports it.

NOT relevant to MCP: entire file (but confirms WASM path produces real call edges — useful for accuracy comparison section in docs).

---

### sidebar-ref.js (65KB, ~1400 lines)
Discovery context: checking if any shared logic or exports

- L1 → BOUNDARY: grep found zero exports. No `export function`, `export const`, `export default`, or `export class`. Pure internal React component file.
- BOUNDARY: 65KB of UI rendering logic. Not shared with any other file. Zero relevance to engine, MCP, or any non-UI task.

NOT relevant to MCP: entire file. NOT relevant to any engine task. Skip always.

---

## Layer 4 — What to Skip Next Time

For any MCP, engine, or core logic task:
- sidebar-ref.js — 65KB UI React component, zero exports, skip always
- provider.js — web-app LLM calls only, MCP never reaches callProvider
- llm-analyzer.js — LLM per-file summary prompts, MCP build_map never calls these
- parse-json.js — LLM response repair, MCP has no LLM response to parse
- graph-storage-idb.js — browser IndexedDB, MCP uses graph-storage.js (Node fs)
- ast-bridge-browser.js — WASM browser bridge, MCP uses native tree-sitter (ast-engine-ts.js)
- graph-storage-idb.js — browser only
- core/index.js — barrel export only, MCP imports directly not through barrel
- orchestrate.js L601-1951 — entire web-app pipeline, all post-gen mechanisms, claim verifier. MCP terminates at L~340 (Phase 1d return).
- layer-detector.js L87-155 (LLM path only) — heuristic detectLayers IS used in MCP

For MCP tasks, the ONLY relevant sections are:
- orchestrate.js L1-340: Pipeline phases 0-1d, MCP termination, MCP_REASONING_PROTOCOL injection
- ast-engine-ts.js: full file (native parser, MCP path)
- ast-project.js: full file (cross-file analysis, MCP path)
- indexer.js: buildKnowledgeGraph, _analyzeFile (structural path only)
- graph-builder.js: node/edge structure
- graph-storage.js: Node.js persistence
- search.js: queryGraphForFiles, expandWeighted
- pattern-store.js: structural pattern matching
- ast-bridge.js: calls[] always empty (regex fallback, never WASM)
- layer-detector.js L60-82: detectLayers() heuristic only

## Edits

### circle-ir Integration (2026-03-28)

**Files added/changed:**
- `unravel-mcp/circle-ir-adapter.js` [NEW] — Adapter wrapping circle-ir's `analyze()` API
- `unravel-mcp/index.js` [MODIFIED] — 4 surgical edits (import, §F call, §F render, STATIC_BLIND gate)
- `unravel-mcp/package.json` [MODIFIED] — `"circle-ir": "file:../cognium/circle-ir"` added to dependencies

**What was added (strictly additive):**
- New `§F — circle-ir Supplementary Findings` section in `critical_signal` output
- Rendered ONLY if circle-ir finds reliability/performance issues (empty → section absent entirely)
- Kept categories: `reliability` + `performance` only
- Excluded categories: `security` (taint), `maintainability`, `architecture` — not bugs in diagnosis context

**Excluded rules (overlap or noise):**
```
missing-await     → overlaps with Unravel's floating_promise detector
leaked-global     → overlaps with Unravel's globalWriteRaces detector
variable-shadowing → too broad/noisy in diagnosis context
unused-variable   → noise
react-inline-jsx  → micro-opt, not a bug
missing-public-doc / todo-in-prod / stale-doc-ref → quality, not bugs
dependency-fan-out / orphan-module / circular-dependency / deep-inheritance → architecture
```

**Active rules (kept — pure reliability value):**
```
serial-await        — independent sequential awaits → should be Promise.all() [performance]
null-deref          — explicit null → used without guard [CWE-476, reliability]  
resource-leak       — stream/connection opened, never closed [CWE-772, reliability]
double-close        — resource closed twice [CWE-675, reliability]
use-after-close     — method called after close() [CWE-672, reliability]
infinite-loop       — loop with no reachable exit [CWE-835, reliability]
n-plus-one          — DB/HTTP calls inside loops [CWE-1049, performance]
string-concat-loop  — string += in loop, O(n²) [CWE-1046, performance]
sync-io-async       — blocking *Sync calls in async functions [reliability]
unbounded-collection — collection grows in loop with no size limit [CWE-770, reliability]
swallowed-exception — catch block with no throw/log/return [CWE-390, reliability]
broad-catch         — catch(Exception)/bare except [CWE-396, reliability]
unhandled-exception — throw/raise outside try/catch [CWE-390, reliability]
redundant-loop      — loop-invariant .length/.size() [CWE-1050, performance]
unchecked-return    — ignored boolean return from File.delete etc. [CWE-252, reliability]
dead-code           — CFG blocks unreachable from entry [CWE-561, reliability]
```

**Additive proof (why it cannot degrade the engine):**

1. Core AST engine untouched — `orchestrate()`, `extractSignature()`, `matchPatterns()`, pattern store, K.G., embedding: zero lines changed
2. Failure-isolated — `try/catch` in `index.js` analyze handler: any error → `circleIrFindings = []` → `§F` section absent → response identical to pre-integration
3. Zero shared state — adapter has its own `_circleIrModule` singleton. Never touches `session`, `patternStore`, `embedding`, `codex`, or any Unravel state
4. WASM sandbox — circle-ir uses `web-tree-sitter` (WASM). Unravel uses native `tree-sitter`. Different binaries, different memory space, no interference possible
5. §F render gate — `if (circleFindings.length > 0)` — empty means zero output change
6. STATIC_BLIND improved (not degraded) — added `&& circleFindings.length === 0` so STATIC_BLIND stays silent if circle-ir found something. Strictly more accurate.
7. Pattern learning unaffected — `verify(PASSED)` still works on AST evidence. §F findings labelled "verify with AST evidence before citing" — agents cannot accidentally learn false patterns from them

**One honest cost:** ~50-150ms additional latency per analyzed file after WASM init (282ms cold init, ~50ms warm). Not a correctness degradation — a speed/coverage tradeoff.

**Integration test result (2026-03-28):**
- WASM init: 282ms (cold)
- `serial-await` correctly detected on `serial.js:4` (two independent awaits)
- `resource-leak` not detected on JS test (Node.js streams in factory RESOURCE_FACTORY_METHODS)
- `missing-await` correctly excluded (not in findings despite `db.findAll()` present)
- Engine remains deterministic: same code → same findings, no LLM in the loop

