# Task Codex — unravel-mcp Full Architecture

## TLDR
unravel-mcp is a 4-tool MCP server (analyze, verify, build_map, query_graph + consult) that runs deterministic AST analysis before the agent reasons, then cross-checks the agent's claims after — the "sandwich". No LLM is called inside the MCP; the agent IS the LLM.

---

## Discoveries

### index.js

Discovery context: entry point, server setup, session state, all 5 tools

- L1–50 → DECISION: ALL console.log/warn/error/info/debug redirected to stderr BEFORE any imports. MCP uses stdout as the JSON-RPC channel — any console.log hitting stdout breaks framing with "invalid character" errors. This must be the first executable code.
- L52–78 → DECISION: Core engine (orchestrate, ast-engine-ts, search, pattern-store, etc.) is loaded lazily via dynamic ESM import inside `loadCoreModules()`. Not at top-level. Reason: avoids partial-state windows and allows retry on failure.
- L86–153 → BOUNDARY: `_coreLoadPromise` singleton guard — only one load ever runs even if tools are called concurrently. Safe to skip unless debugging startup crashes.
- L156–174 → DECISION: `session` is a single in-memory object shared across ALL tool calls in a session. Keys: files[], astRaw, crossFileRaw, graph, projectRoot, patternsLoaded, mcpPatternFile, lastAnalysisHash, lastAnalysisResult, diagnosisArchive, archiveLoaded, lastSymptom.
- L177–260 → DECISION: `readFilesFromDirectory()` skips: node_modules, .git, dist, build, .next, __pycache__, coverage, .unravel, .vscode, .idea — AND test/spec/mock files via TEST_PATTERNS regex. Max file size 500KB.
- L261–326 → DECISION: `deriveNodeMetadata()` is purely heuristic (no LLM). Assigns semantic tags (entry-point, embeddings, knowledge-graph, ast-analysis, orchestration, search, storage, memory, hub/connector) by scanning function names with regex. Also assigns complexity: high (>20 fns or >500 lines), moderate (>8 fns or >200 lines), low otherwise.
- L329–406 → CONNECTION: `generateProjectOverview()` auto-writes `.unravel/project-overview.md` from KG topology. Injected as @0 in consult tool calls. Has a "## Notes" section that is NEVER overwritten.
- L434–452 → CONNECTION: `enrichProjectOverviewWithDiagnosis()` appends to "## Risk Areas" section after every verify(PASSED). Line format: `[date] **location**: rootCause <- from: "symptom"`.
- L454–479 → DECISION: `resolveFiles()` priority: explicit files[] → args.directory (sets session.projectRoot) → session.files. Throws with helpful message if none available.
- L485–661 → DECISION: Static server instructions sent ONCE on connect. Contains 3 major blocks:
  - L491–563: Sandwich Protocol (11-phase), tool usage guide (flowchart + rules), extended capabilities (web search / script execution)
  - L586–658: **FULL Task Codex section** — when to create, 4 entry types (BOUNDARY/DECISION/CONNECTION/CORRECTION), two-phase writing model, Layer 4 mandatory, EDIT LOG format, exact file format spec, index update rule, SUPERSEDES staleness rule, verify-on-use rule, what NOT to do.
  - CORRECTION to prior note: this is NOT just a protocol section. It contains the complete codex behavioral protocol for agents. The codex section alone is L586–658 (~72 lines). It IS the enforcement mechanism.
- L596 → DECISION: First thing agents told about codex: check pre_briefing from query_graph BEFORE opening any source file.
- L600 → DECISION: "detective's notebook, NOT a wiki" — explicitly in prompt.
- L611 → DECISION: Two-phase model enforced in prompt: Phase 1 append-only during task, Phase 2 restructure at end.
- L614–616 → DECISION: Layer 4 explicitly marked MANDATORY in the prompt.
- L622–641 → DECISION: Exact file format spec in the prompt (## TLDR, ## Discoveries, ## Edits, ## Meta with Tags/Files touched). searchCodex parses these headings.
- L643–646 → DECISION: Agents told to append to codex-index.md at end of task for query_graph discoverability.
- L653 → DECISION: "Codex tells you WHERE to look, not WHAT is true. Before citing, always confirm the actual line still matches."
- L940–954 → DECISION: Phase 3c — analyze result cache. Same `symptom + detail + sorted file names` → returns cached result immediately. Cache lives in session (not disk), clears on session restart.
- L994–1000 → DECISION: KG auto-restore from disk on analyze if session.graph is null but session.projectRoot exists. Covers MCP restart scenario.
- L1023–1036 → DECISION: `session.projectRoot` is set here in analyze when args.directory is provided. IMPORTANT: the codex pre-briefing at L1135 checks `session.projectRoot` — so if analyze is called with inline files[] (no directory), projectRoot is null and codex pre-briefing is SKIPPED.
- L1086–1098 → DECISION: Pattern hints injected into `base._instructions.patternHints` only if confidence ≥ 0.65. Threshold filters noise.
- L1135–1152 → DECISION: Phase 5c-1b — codex pre-briefing injected into `base._instructions.codexPreBriefing` when searchCodex() finds matches. This is the v3.5.0 addition — agents calling analyze() directly (no query_graph) also get codex context.
- L1232–1256 → DECISION: HYPOTHESIS_GATE — verify() immediately returns PROTOCOL_VIOLATION if hypotheses[] absent/empty. No claims are checked. This gate fires first.
- L1264–1282 → DECISION: EVIDENCE_CITATION_GATE — rootCause must match `/[\w.\-/]+\.(js|jsx|ts|tsx|py|go|rs|java|cs)\s*[L:]\s*\d+/i`. Fires second, before verifyClaims().
- L1311–1360 → DECISION: verify PASSED sequence: 1) learnFromDiagnosis → savePatterns, 2) archiveDiagnosis (awaited, needs GEMINI_API_KEY), 3) autoSeedCodex (fire-and-forget, always), 4) enrichProjectOverview. autoSeedCodex never blocks the verify response.
- L1342–1350 → DECISION: autoSeedCodex is called WITHOUT await — it's fire-and-forget. This means the codex file write happens in the background. If the process crashes immediately after verify returns, the codex entry may not be written. Acceptable tradeoff for non-blocking response.

### embedding.js

Discovery context: all embedding, semantic search, diagnosis archive logic

- L46–95 → DECISION: `embedText()` uses `gemini-embedding-2-preview`, 768-dim (MRL), 10s AbortController timeout, 3 retries with exponential backoff on 429. Returns null on failure — callers must handle null.
- L134–223 → DECISION: `embedImage()` accepts file path | base64 string | data-URL. Always uses `RETRIEVAL_QUERY` task type (images are always queries, never documents). Same 768-dim space as text — cross-modal cosine similarity works directly.
- L237–247 → DECISION: `fuseEmbeddings()` — weighted average. Default imageWeight=0.6 (60% image, 40% text). Graceful: if either vector is null, returns the other unchanged.
- L262–279 → DECISION: `embedTextsParallel()` — max 10 concurrent workers (rate limit protection). Returns results in same order as input texts. Failed embeds return null in that slot.
- L330–382 → DECISION: `embedChangedNodes()` — default embeds only top-50 hubs by edge count. `embedAll:true` embeds all connected nodes. Non-connected nodes get NO embedding — they fall back to keyword routing via expandWeighted() hops from embedded hubs.
- L433–476 → DECISION: `embedCodexEntries()` — incremental. Reads `.unravel/codex/codex-embeddings.json`, only embeds entries without stored vectors. Text = `"${problem}. Tags: ${tags.join(', ')}"`. Writes back after embedding.
- L488–500 → DECISION: `scoreCodexSemantic()` — embeds symptom as RETRIEVAL_QUERY, cosine against all stored codex vectors. Returns `{taskId: score}` map.
- L548–549 → DECISION: Diagnosis archive threshold = 0.75, max 3 results per analyze call. Hard constants, not configurable from args.
- L577–619 → DECISION: `archiveDiagnosis()` embed text format: `"Symptom: {symptom}\nRoot Cause: {rootCause}\nEvidence: {evidence.join(' | ')}"`. This is the semantic fingerprint of the bug. Stored as RETRIEVAL_DOCUMENT in `.unravel/diagnosis-archive.json`.
- L1–20 → BOUNDARY: All `loadDiagnosisArchiveIDB` / `appendDiagnosisEntryIDB` functions in this file are for browser webapp IDB. MCP uses the file-based `loadDiagnosisArchive()` / `archiveDiagnosis()` only.

### core/search.js

Discovery context: KG query logic — how query_graph finds relevant files

- L19–53 → DECISION: `scoreNode()` field weights: name=0.4, tags=0.3, summary=0.2, filePath=0.1. Blend: 70% best-single-token + 30% average-all-tokens. The blend prevents a strong 1-token hit from being diluted by unrelated tokens in the symptom.
- L130–179 → DECISION: `expandWeighted()` — beam search. Edge type weights: calls=1.0, mutates=0.95, async-calls=0.85, imports=0.7, contains=0.5. Score formula per hop: `parentScore * 0.7 + edgeWeight * 0.3 + semBonus`. TOP_K=5 paths kept per hop, MIN_SCORE=0.2 early stop. maxHops=2 default.
- L190–228 → DECISION: `queryGraphForFiles()` pipeline: keyword search → seed IDs → merge semantic scores → expandWeighted → collect filePaths → sort by best node score → slice to maxFiles=12.
- L102–109 → BOUNDARY: `expandOneHop()` is a simple 1-hop helper. Not used in the main query pipeline (expandWeighted handles multi-hop). Only referenced from graph-related utilities.

### core/orchestrate.js

Discovery context: the full pipeline that runs inside analyze() and consult()

- L133–177 → BOUNDARY: orchestrate() options — most are webapp-only (onPartialResult, signal, outputSections, sourceMode, queryImage). MCP only uses: files, symptom, _mode:'mcp', detail, provider:'none', apiKey:'none', model:'none'.
- L188–300 → DECISION: Phase 0.5 KG Router fires when `explicitKG exists OR jsFiles.length > 15`. If KG query returns <3 files, it falls through to AST router. DECISION: the 15-file threshold only applies to file-system KG discovery. Explicitly passed KG always tries (even for small benchmark files).
- L247–278 → DECISION: §4.1 pattern boosts at routing time use 60% confidence (pre-AST estimate). Words ≤4 chars skipped as stop words. On confirmed AST match post-analysis, full pattern weight applies.
- L427–524 → DECISION: MCP SHORT-CIRCUIT at Phase 1d. Returns `{verdict:'MCP_EVIDENCE', evidence:{astRaw, crossFileRaw, contextFormatted, filesAnalyzed}, _instructions: MCP_REASONING_PROTOCOL}`. The `_instructions` here is per-call (groundTruth, pipelineReminder, verifyCallInstructions) — NOT the static protocol (that's in server description).
- L547–598 → DECISION: CONSULT SHORT-CIRCUIT returns `{verdict:'CONSULT_EVIDENCE'}` with different `_instructions`. Consult mode: no hypothesis generation, no verify required, answer architecture questions directly from AST facts.
- L305–321 → BOUNDARY: AST Router fallback (selectFilesByGraph from ast-project.js) only fires if KG didn't produce results AND >15 JS files. Skip this section for small repos.
- L354–368 → DECISION: Phase 1b cross-file analysis only runs if `isNativePath` (astRaw._source === 'native-tree-sitter'). WASM path does NOT run cross-file. This is the MCP/Node.js-only gate.
- L628–736 → DECISION: Prompt topology — trust boundary → projectContext → files → astBlock → symptom. astBlock is LAST before symptom (high-attention zone). Before 2026-04-01 it was first (buried in dead zone after files were appended). This reorder was a 10-line change with measurable accuracy improvement.

### core/pattern-store.js

Discovery context: bug pattern database, learning, KG boosting

- L51–291 → DECISION: 20 starter patterns shipped pre-populated. Key ones: race_condition_write_await_read (w=0.95), global_write_race (0.90), foreach_collection_mutation (0.90), floating_promise (0.75), orphan_listener (0.88). All have CWE mappings.
- L316–436 → DECISION: `extractSignature()` — `write_shared` is ONLY emitted from `globalWriteRaces`, NOT from generic mutations. This was a deliberate choice to prevent false positives on debounce/throttle (which mutate closure-local timers, not shared state). `stale_var_access` requires all three: closures + globalWriteRaces + async_delay (setTimeout) simultaneously.
- L449–471 → DECISION: `matchPatterns()` requires ≥70% of a pattern's signature events to match (raised from 60%). weight < 0.3 patterns are gated out. Confidence = weight × coverage, capped at 1.0.
- L520–530 → DECISION: Learning: +0.05 weight, +1 hitCount per PASSED verify. Penalty: -0.03 per REJECTED (floor 0.3). Asymmetric intentionally — need 1.5× false positives to suppress a pattern vs once to promote.
- L483–507 → CONNECTION: `getNodeBoosts()` — takes matched patterns → returns nodeId → boost score for use in `expandWeighted()`. Boost = confidence × 0.5, applied only when bugType keywords match filename. Connected to §4.1 in orchestrate.js.

### core/graph-storage.js

Discovery context: KG persistence — how knowledge.json gets saved/loaded

- L28–41 → DECISION: `computeContentHashSync()` — SHA256 via Node crypto (primary), FNV-1a 32-bit (browser fallback). Output format: `"sha256:hexstring"` or `"fnv1a:hexstring"`.
- L72–87 → DECISION: `getChangedFiles()` — compares current file content hashes against `existingGraph.files` map. Only changed/new files are returned. This is the incremental build mechanism for build_map.
- L107–134 → DECISION: Node.js storage: graph → `.unravel/knowledge.json`, meta → `.unravel/meta.json`. Both use sync read/write. `loadGraph()` returns null if file absent (no throw).
- L149–202 → BOUNDARY: IDB backend (saveGraphIDB, loadGraphIDB, computeProjectKey) is browser-only. MCP never calls these. Key = SHA256 of sorted filenames. Skip for MCP debugging.

### core/graph-builder.js

Discovery context: how KG nodes and edges are structured

- L64 → DECISION: Node ID format: file node = `"file:${filePath}"`, function node = `"func:${filePath}:${fn.name}"`, class node = `"class:${filePath}:${cls.name}"`. Important for lookups in search and expandWeighted.
- L58–118 → DECISION: `addFileWithAnalysis()` — file node gets trustLevel `LLM_INFERRED` (tags/summary from deriveNodeMetadata heuristics). Function/class child nodes get `AST_VERIFIED` (extracted by ast-bridge regex). Edge from file→function is type `contains`.
- L136–142 → DECISION: Import edges: weight=0.7, type=`imports`. Call edges: weight=0.8, type=`calls`. NOTE: search.js `expandWeighted` overrides these with its own EDGE_WEIGHTS map — calls=1.0, imports=0.7. The builder weights are stored in graph but traversal weights win.
- L176–203 → DECISION: `mergeGraphUpdate()` — removes ALL nodes/edges belonging to changed files, then appends new ones. Safe merge: retained edges only kept if BOTH source and target nodes still exist.

### core/ast-bridge.js

Discovery context: how structural analysis (imports, functions, classes) is extracted for KG build

- L31–57 → DECISION: Import extraction handles: ESM static imports, re-exports (`export * from`), CJS require, dynamic import(). Line comments and block comments stripped first to avoid false matches.
- L146–187 → DECISION: `resolveImportPath()` — resolves relative paths with extension probing (.js, .ts, .jsx, .tsx, .mjs, .cjs, then /index.ext). AMBIGUOUS_STEMS set (index, utils, types, helpers, constants, etc.) returns null — avoids linking wrong file when stem matches many directories.
- L200–201 → DECISION: `calls: []` is ALWAYS empty from ast-bridge. Regex cannot track which function a call-site is enclosed in. Call edges are only populated by the WASM bridge (ast-bridge-browser.js). In MCP `build_map`, call edges come from native tree-sitter via ast-engine-ts.js.
- L214–239 → BOUNDARY: `attachStructuralAnalysis()` only processes .js/.jsx/.ts/.tsx/.mjs/.cjs extensions. HTML/CSS/JSON files get structuralAnalysis=null.

---

## Edits
None — this is a read-only architecture session.

---

## Meta
Tags: #architecture #mcp #unravel #knowledge-graph #codex #patterns #embedding #search #ast
Problem: Understand the complete unravel-mcp codebase — how all modules connect, what each file owns, and how the full flow works end-to-end.

---

### index.js — build_map tool (L1440–1814)

Discovery context: how the KG gets built and what the incrementall path does

- L1440–1460 → DECISION: Incremental threshold is 30% of files changed. If ≤30% changed → incremental patch (mergeGraphUpdate). If >30% → full rebuild. This prevents the cost of a full rebuild for small edits.
- L1534–1601 → DECISION: Incremental path: `attachStructuralAnalysisToChanged()` → `deltaBuilder.addFileWithAnalysis()` → `mergeGraphUpdate()` → `embedChangedNodes()` (re-embeds only changed nodes) → `saveGraph()`. Same sequence as full but scoped.
- L1606–1686 → DECISION: Full rebuild path: `attachStructuralAnalysis(files)` → `GraphBuilder` → wire import edges → wire call edges via fnToFiles+fileImportIndex resolution → stamp content hashes → `builder.build()` → store in `session.graph`.
- L1627–1677 → DECISION: Call edge wiring uses A+1 import-guided resolution. First checks if callee name is in the importer's own importMap. If not found, falls back to `fnToFiles` (global function→file map) — but ONLY if exactly 1 file defines that function. Ambiguous (multiple definitions) → no edge added. This prevents wrong cross-file links.
- L1689–1701 → DECISION: Embedding controlled by `args.embeddings` option. `false` → skip entirely. `'all'` → embedAll. Anything else + GEMINI_API_KEY set → top-50 hubs. No key → structural-only KG (no semantic routing).
- L1703–1768 → DECISION: Phase 5c-2 Codex Node Attachment. After full build, scans `codex-index.md`, reads each matching `codex-{taskId}.md`, extracts `## Discoveries` section, matches filenames against KG node `filePath`. Attaches up to 3 lines of the discovery excerpt as `node.codexHints[]`. Non-fatal try/catch.
- L1770–1807 → DECISION: After build: `saveGraph()` → `saveMeta()` → `generateProjectOverview()` → `saveProjectOverview()`. Project overview is always regenerated on full rebuild. Risk Areas section preserved from existing file.

### index.js — searchCodex() (L1831–2028)

Discovery context: the retrieval function that powers pre-briefing in query_graph and analyze

- L1835–1836 → BOUNDARY: Returns empty immediately if `projectRoot` is null (inline-files path) or `codex-index.md` doesn't exist. Nothing to search.
- L1843–1856 → DECISION: Index parsing — splits `codex-index.md` on `\n`, filters lines starting with `|`, skips header/separator, maps to `{taskId, problem, tags[], date}`. Tags are comma-split and lowercased.
- L1861–1867 → DECISION: Temporal recency score formula: `1 / (1 + daysSince/30)`. At 0 days=1.0, 30 days=0.5, 60 days=0.33. Neutral (0.5) if no date. Weight in semantic blend: 20%.
- L1872–1903 → DECISION: Stop words list is extensive — includes domain-neutral words like "bug", "error", "issue", "problem", "broken", "fix", "fails". Symptom tokens: len>2, not in stop words. Scoring: exact tag match = +2, problem text match = +1. Slice top 3 before re-ranking.
- L1905–1977 → DECISION: Semantic blend weights: keyword=0.35, semantic=0.45, recency=0.20. Filter: `blendedScore >= 0.3 OR keywordScore >= 2`. This means a strong keyword hit (score≥2) surfaces even if semantic score is 0 (no API key), preventing pure keyword misses.
- L1979–2027 → DECISION: Keyword-only fallback blend: kw=0.80, recency=0.20. This path fires when no API key or semantic scoring fails. Minimum keyword score threshold: ≥2 (must match at least 1 tag token).

### index.js — autoSeedCodex() (L2050–2140)

Discovery context: the auto-write side of the codex triggered by verify(PASSED)

- L2055 → DECISION: taskId format = `"auto-${Date.now()}"`. This means multiple verify(PASSED) in rapid succession create separate codex files (no collision). Not a bug.
- L2062–2073 → DECISION: FILE_LINE_RE regex extracts file citations from evidence[]. Groups: (filename)(ext)(lineNumber). Organizes by basename → [{lineN, snippet}] map.
- L2075–2083 → DECISION: rootCause is ALSO parsed for file:line citations as a fallback when evidence[] is sparse. Avoids empty discoveries blocks.
- L2088–2098 → DECISION: Discoveries block format per file: `### filename\nDiscovery context: {symptom}\n\n- L{line} → DECISION: {snippet} — confirmed bug site. _(auto-seeded from verify)_\n`
- L2100–2107 → DECISION: Tags extracted from `symptom + ' ' + rootCause`, lowercased, stopword-filtered (len>3), deduplicated, max 6. Used in both codex file Meta section and index row.
- L2116 → DECISION: codex file structure: `## TLDR\n## Discoveries\n## Edits\n## Meta\n## Layer 4`. The "Layer 4" section is pre-populated as empty (agent fills it). Edits section says "(auto-seeded — no edits recorded)".
- L2126–2133 → DECISION: If `codex-index.md` doesn't exist → bootstrapped with header + first row. If exists → `appendFileSync` (appends one row). Never rewrites the whole file.

### index.js — query_graph tool (L2142–2255)

Discovery context: the tool that runs searchCodex + KG query + semantic scores

- L2155–2163 → DECISION: `projectRoot` resolved from `args.directory` OR `session.projectRoot`. If graph not in session, tries `loadGraph(projectRoot)` from disk.
- L2178–2208 → DECISION: Semantic routing: if GEMINI_API_KEY + nodes have embeddings → `buildSemanticScores()`. Then pattern boosts from `session.astRaw` (if a prior analyze ran) merged via `Math.max`. Pattern boosts are additive — they don't replace semantic scores.
- L2217–2239 → DECISION: `searchCodex(projectRoot, symptom)` called AFTER file ranking. If matches found → `response.pre_briefing` added with all match discoveries. Suggestion text changes to `"⚡ PRE-BRIEFING: N past session(s) matched"`.

### index.js — query_visual tool (L2257–2397)

Discovery context: cross-modal image-to-code routing

- L2292–2301 → DECISION: Hard fails immediately with helpful error if no GEMINI_API_KEY. Not a degradation — visual search is impossible without embedding.
- L2322–2331 → DECISION: Also hard fails if KG exists but has 0 embedded nodes. Tells user to delete knowledge.json and rebuild with API key.
- L2338–2353 → DECISION: Image embedded first → if `args.symptom` present, text embedded and fused 60% image / 40% text. Same fuseEmbeddings() as everywhere else.
- L2356–2371 → DECISION: Scoring: cosine similarity of queryVec vs ALL embedded nodes (not just hub-50). Deduplicates by filePath (keeps highest scoring node per file).

### index.js — consult tool helpers (L2404–2700+)

Discovery context: helper functions that power the consult tool's rich context assembly

- L2407–2429 → DECISION: `SETUP_REQUIRED_RESPONSE` — returned when GEMINI_API_KEY missing. Contains step-by-step setup guide for all major MCP clients (Claude Desktop, Cursor, VS Code, Claude Code, Windsurf). This is a first-class UX concern, not an afterthought.
- L2431–2464 → DECISION: `extractJsDocSummary()` — regex-based, zero cost. Pattern A: `/** ... */` blocks before top-level declarations (strips @param/@returns). Pattern B: `//` single-line comments above functions. Returns ≤150 chars. Used in `deriveNodeMetadata()` to enrich KG node summaries.
- L2466–2524 → DECISION: `loadContextFiles()` — reads README.md, ARCHITECTURE.md, CHANGELOG.md, CONTRIBUTING.md etc. ALSO reads `.unravel/context.json` for explicit `include[]` paths + `trust` levels + `maxCharsPerFile`. Scans root + `docs/` + `.unravel/context/` for how-*.md, arch*.md, design*.md automatically.
- L2526–2576 → DECISION: `getGitContext()` — runs git commands via `childProcess.execSync`. Gets: files changed in last 14 days, hotspot files (30-day churn), last 8 commits, unstaged/staged files. Cached in `.unravel/git-context.json` keyed by HEAD hash — only re-runs when HEAD changes.
- L2578–2606 → DECISION: `loadDependencyManifest()` — reads package.json (runtime+dev deps, engines, packageManager), requirements.txt, or go.mod. Returns first found, null if none.
- L2608–2629 → DECISION: `formatReadinessInline()` — produces a quick text score like "2/3 core + 1/2 memory" for display at the top of consult responses. Helps agent know what layers are active.
- L2650–2678 → DECISION: `buildReadiness()` — detailed layer-by-layer status: KG, semantic embeddings, AST, codex, diagnosis archive. Each layer has `active: bool` + `detail: string`. Tips guide user to grow inactive layers.
- L2680–2700 → DECISION: `extractRelevantSections()` — scholar-mode: extracts only heading-relevant sections from large context docs instead of dumping everything. Stops at 2500 chars total. Prevents context bloat from large READMEs.

### circle-ir-adapter.js (full, 158 lines)

Discovery context: supplementary analysis layer, additive only

- L1–24 → DECISION: Circle-IR is a 36-pass pipeline for bugs Unravel's core AST doesn't detect: serial-await, null-deref, resource-leak, infinite-loop. Categories kept: `reliability`, `performance` only. No security/maintainability (noise in debug context).
- L43–56 → DECISION: Excluded rules (overlap or noise): `missing-await` (overlaps floating_promise), `leaked-global` (overlaps globalWriteRaces), `variable-shadowing`, `unused-variable`, `react-inline-jsx`, all code-quality and architecture rules.
- L64–88 → DECISION: WASM parser initialized once per process via `_circleIrModule` singleton + `_initPromise`. ~150ms boot time. If init fails → `_initPromise` is reset to null → retry is allowed on next call.
- L97–157 → DECISION: `runCircleIrAnalysis()`: per-file errors are non-fatal. Results sorted severity DESC then file+line ASC. The findings[] is added to `responsePayload._circleIrFindings` in index.js — ADDITIVE to main Unravel output, never replaces it.

---

## Edits
None — this is a read-only architecture session.

---

## Meta
Tags: #architecture #mcp #unravel #knowledge-graph #codex #patterns #embedding #search #ast #build-map #query-graph #consult #circle-ir
Problem: Understand the complete unravel-mcp codebase — how all modules connect, what each file owns, and how the full flow works end-to-end.

---

### index.js — consult tool (L2749–3100)

Discovery context: how consult assembles its multi-key response

- L2749–2800 → DECISION: `formatConsultForAgent()` outputs 4 structured JSON keys: `intelligence_brief` (START HERE — mandate + overview + scope), `structural_evidence` (AST facts + snippets + call graph), `memory` (past discoveries + archive hits), `project_context` (deps, git, docs — verbose, last resort).
- L2771–2795 → DECISION: Query classification at L2772–2774: auto-detects `feasibility` ("can i", "what would break", "could i"), `factual` ("where is", "what is", "show me"), `analytical` (default). Each type gets different reasoning mandate instructions injected into `intelligence_brief`.
- L2811–2819 → CONNECTION: `loadProjectOverview(projectRoot)` reads `.unravel/project-overview.md` and injects it as the first section of the brief — the "senior dev mental model". Generated by `generateProjectOverview()` in build_map.
- L2862–2865 → DECISION: `structural_evidence` starts with contextFormatted (AST facts from orchestrate.js). NULL-safe — shows "No AST analysis available" if not run.
- L2867–2921 → DECISION: Critical source snippets auto-extracted for `globalWriteRaces` (top 3) and `floatingPromises` (top 2) and cross-file `callGraph` edges. CONTEXT_LINES=3 above/below the target line. MAX_SNIPPETS=8. Overlap check prevents duplicate regions. Eliminates need to call view_file for the most critical lines.
- L2923–2960 → DECISION: Call graph in `structural_evidence` sorted by query relevance (query keywords in caller/callee/function text). Top 25 edges shown.
- L2964–2993 → DECISION: `memory` key contains: pattern signals (top 3), codex pre-briefing (discoveries sections, first 6 lines, first 300 chars), diagnosis archive hits (score + rootCause + symptom). Shown in order: patterns → codex → archive.
- L2996–3055 → DECISION: `project_context` key: dependencies → git context (scope-filtered to in-scope + query-keyword files) → context files (scholar-mode section extraction). This key is verbose and the reading order explicitly says to read it ONLY if intelligence_brief is insufficient.
- L3075–3100 → DECISION: **consult is currently TEMPORARILY_PAUSED** (v3.4.3). Returns `{status: 'TEMPORARILY_PAUSED'}` immediately without running any analysis. The full `formatConsultForAgent()` implementation exists and is complete — but the tool is short-circuiting at L3094. This is intentional — paused for output quality improvements.

### core/ast-project.js (full, 786 lines)

Discovery context: cross-file analysis pipeline — runs AFTER per-file AST

- L25–134 → DECISION: `buildModuleMap()` — runs tree-sitter on each JS/TS file to extract imports (ESM static, namespace, named, default) + exports (named clause, let/const/var, function/class, default). Returns `{moduleMap, asts}`. If `parseCodeFn` injected (native tree-sitter) → WASM `initParser()` is skipped. MCP path always injects native parser.
- L145–177 → DECISION: `resolveSymbolOrigins()` — traces every imported symbol to its export in the source module. Key format: `"symbolName@filename"`. Output: `{name, file, line, importedBy: [{file, localName, line}]}`. Skips re-exports and external module symbols.
- L190–251 → DECISION: `expandMutationChains()` — merges per-file mutation data using symbol origins. If a variable is imported, its writes/reads get merged into the origin chain. Only exported variables are tracked (local-only vars skipped at L229). Key format: `"varName [originFile]"`.
- L265–346 → DECISION: `emitRiskSignals()` — 3 deterministic patterns: 1) cross_file_mutation (exported var written outside origin file), 2) async_state_race (timer function writes shared var), 3) unawaited_promise (async-producing API without await). setTimeout/setInterval excluded from unawaited_promise (fire-and-forget by design). Deduplication by type+variable+file+line.
- L359–412 → DECISION: `buildCallGraph()` — walks tree-sitter AST for `call_expression` nodes. Matches direct calls (`importedFn()`) and method calls on imported objects (`importedObj.method()`). Deduplicates by caller→callee:function. This is the call graph used in consult's cross-file graph view.
- L431–572 → DECISION: `selectFilesByGraph()` — fallback AST router (used in orchestrate.js Phase 0.5 when KG is absent). Scores files by: filename keyword match (+5 per keyword), content keyword match (+1), import centrality (+2 per incoming import). BFS walks from top-scored entry point, max depth=3, max files=15. Also includes cross-file mutation chain files for symptom-related variables. Fallback if BFS yields <3 files: top-15 by symptom score.
- L586–625 → DECISION: `runCrossFileAnalysis()` — main integration function called from orchestrate.js Phase 1b. Pipeline: buildModuleMap → resolveSymbolOrigins → expandMutationChains → buildCallGraph → free WASM tree memory → emitRiskSignals → formatCrossFileContext. Returns `{formatted, raw: {moduleMap, symbolOrigins, crossFileChains, callGraph, riskSignals}}`.
- L703–741 → DECISION: `isLikelyNodeModule()` — determines if an import string is npm vs. project alias. Rules: relative paths (./ ../ /) → project. Tilde (~) → project. `@scope/pkg` (exactly 1 slash) → npm. `@/anything` → tsconfig alias. No slash → npm. Has slashes, no @ → check if any file's basename matches, if yes → project, if no → npm.
- L743–785 → DECISION: `resolveModuleName()` — 3-pass resolution: Pass 1 full-path match, Pass 2 basename match, Pass 3 index files. Falls back to last segment of path. Used in buildModuleMap to normalize import paths to shortnames.

---

## Edits
None — read-only architecture session. Codex file written as discoveries accumulated.

---

## Meta
Tags: #architecture #mcp #unravel #knowledge-graph #codex #patterns #embedding #search #ast #build-map #query-graph #consult #circle-ir #cross-file
Problem: Understand the complete unravel-mcp codebase — how all modules connect, what each file owns, and how the full flow works end-to-end.
Files touched: index.js, embedding.js, core/search.js, core/orchestrate.js, core/pattern-store.js, core/graph-storage.js, core/graph-builder.js, core/ast-bridge.js, core/ast-project.js, circle-ir-adapter.js

## Remaining
- cli.js (optional — standalone CLI that is not part of the MCP flow)

---

### index.js — consult tool live body (L3086–3395)

Discovery context: the actual running consult logic that is PAUSED at runtime but fully written

- L3090–3111 → DECISION: **CURRENTLY SHORT-CIRCUITS here.** Returns `TEMPORARILY_PAUSED` immediately. Everything below L3111 is real code but unreachable. Paused at v3.4.3 for output quality rework.
- L3124–3138 → DECISION: Cross-directory session safety guard. If `projectRoot` changed from `session._graphRoot` → wipes `session.graph`, `session.files`, `session.astRaw`, `session.crossFileRaw`, `session.archiveLoaded`, `session.diagnosisArchive`. Prevents stale KG from prior directory silently giving wrong answers.
- L3143–3213 → DECISION: Cold build path (no KG or no embeddings): `readFilesFromDirectory` → include filter → `attachStructuralAnalysis` → `GraphBuilder` → import edges → content hashes → **embed FIRST then save** (prevents zero-embedded KG sitting on disk from a cancelled embed that the `hasEmbeddings` check wrongly accepts next time) → `saveGraph` + `saveMeta` + `generateProjectOverview`.
- L3215–3289 → DECISION: KG exists path — silent incremental staleness check on every call. Scope-stability: re-uses `graph.meta.include`/`graph.meta.exclude` from cold build. Self-heal: re-embeds any nodes with `null` embeddings (from prior cancelled embed) automatically. Zero changes = <100ms.
- L3291–3336 → DECISION: Semantic routing for file selection. `args.include` bypasses KG entirely (explicit file list). Otherwise `queryGraphForFiles(graph, query, maxFiles, semanticScores)` → ranked paths → filter `session.files` to match.
- L3339–3348 → DECISION: Memory recall layer order: `searchCodex` → `loadDiagnosisArchive` → `searchDiagnosisArchive`. Archive loaded once per session (`archiveLoaded` flag).
- L3350–3362 → DECISION: Calls `orchestrate(filesToAnalyze, query, {_mode: 'consult', provider: 'none', apiKey: 'none', model: 'none', projectRoot, knowledgeGraph: graph})`. Provider=none means orchestrate short-circuits at Phase 1d (MCP mode) — returns AST evidence packet without calling any LLM.
- L3364–3388 → DECISION: Caches `consultResult.evidence.astRaw` into `session.astRaw` for later verify() calls. Applies mutation noise filtering. Builds `fileContents` Map for source snippet extraction. Returns `formatConsultForAgent(...)` result.
- L3397–3411 → DECISION: Entry point. `main()` calls `loadCoreModules()` then `server.connect(new StdioServerTransport())`. All MCP communication over stdio. Fatal errors write to stderr and `process.exit(1)`.

### core/orchestrate.js — full pipeline (L800–2222)

Discovery context: the phases AFTER the MCP short-circuit, relevant to web app / full analysis mode

- L800–811 → DECISION: Phase 3 (non-streaming): `callProvider()` with schema-constrained structured output. Provider=none → exits after Phase 1d (MCP short-circuit at the top of orchestrate, not here).
- L815–848 → DECISION: Phase 4 parse: if raw is already an object (Gemini structured output) → use directly. Otherwise `parseAIJson()`. If parse fails → retry WITHOUT schema, adding explicit JSON instruction. If still fails → throws.
- L850–884 → DECISION: Phase 5 claim verification: `verifyClaims(result, codeFiles, astRaw, crossFileRaw, mode, symptom)`. If rootCause hard-rejected → `needsMoreInfo=true`, `_verificationRejected=true`. Soft failures only → confidence penalty logged but not blocking.
- L886–898 → DECISION: Pattern learning: in `debug` mode after verify, if verify passed → `learnFromDiagnosis(astRaw, verification)` (bumps pattern weights). If rejected → `penalizePattern(astRaw)` (decays patterns). In-memory only for web app (no savePatterns call).
- L900–932 → DECISION: Diagnosis archive (IDB): fire-and-forget. Only archives if NOT `rootCauseRejected`. Embeds rootCause then appends to IndexedDB per-project. Non-fatal if it fails.
- L938–971 → DECISION: Phase 5: `checkSolvability()` — layer boundary detection. If bug origin is upstream (OS/browser/network), returns `LAYER_BOUNDARY_VERDICT` immediately. Skips fix generation when the fix can't be written.
- L973–1059 → DECISION: Phase 5.6 Missing Fix Target Detection — 2 signals: (A) fix text contains phrases like "not provided in the files", (B) `codeLocation` references a file not in `codeFiles`. If triggered → `needsMoreInfo=true` + `missingFilesRequest` → triggers self-heal (Phase 6).
- L1061–1099 → DECISION: Phase 5.7 External Fix Target Verdict — if rootCause is correct but fix lives in a different repo (detected by cross-repo path prefix). Returns `EXTERNAL_FIX_TARGET_VERDICT` with full diagnosis preserved and explicit instruction to apply fix in the other repo.
- L1101–1148 → DECISION: Phase 6 Self-Heal: if `needsMoreInfo` + `missingFilesRequest` + `onMissingFiles` callback provided + depth<2 → calls `onMissingFiles()` → appends returned files → recursive `orchestrate()` call with `_depth+1`. Max depth=2. GitHub-mode-only fallback: if files genuinely not in repo, attaches `_missingImplementation` and clears `needsMoreInfo` so UI renders partial analysis.
- L1150–1164 → DECISION: Unverifiable hypothesis post-check: if any hypothesis in `evidenceMap` has `verdict: 'UNVERIFIABLE'` AND missing[] has entries AND depth<max → triggers self-heal to fetch missing files.
- L1166–1237 → DECISION: 4-dimensional confidence recalibration: Dim1 (evidence completeness: UNVERIFIABLE → cap 0.70). Dim2 (causal chain completeness: missing steps → cap 0.70). Dim3 (elimination quality: DEFAULT survived → cap 0.75, WEAK → cap 0.82). Dim4 (uniqueness: multiple survivors sharing evidence → competing cap 0.65; orthogonal → 0.85).
- L1255–1273 → DECISION: Result stamped with `_mode`, `_sections`, `_provenance` (engineVersion: '3.3', astVersion: '2.2', routerStrategy, crossFileAnalysis, model, provider, timestamp).

### core/orchestrate.js — verifyClaims() (L1538–1957)

Discovery context: the claim verifier — checks model output against real code

- L1538–1554 → DECISION: File lookup built with 3 keys: full name, short name (basename), no-extension. Fuzzy `findFile()` tries all three + suffix matching.
- L1566–1576 → DECISION: **Symptom whitelist** — file names mentioned in the original bug report/stack trace are whitelisted. Model quoting them in evidence is correct (not fabricated). Without this, correct diagnoses citing error-message paths get hard-rejected.
- L1715–1744 → DECISION: Check 1 (evidence array): verifies file NAMES only (not lines). Evidence strings are narrative — models miscount lines in free text. Line validation belongs to Checks 2+3. Penalty +0.2 per fabricated filename.
- L1746–1774 → DECISION: Check 2 (codeLocation): verifies file names (+0.3 penalty) AND line numbers (+0.3 penalty if line > fileLength+6, the +6 buffer handles off-by-one).
- L1776–1846 → DECISION: Check 3 (rootCause): hard reject if file is fabricated (not in inputs, not symptom-mentioned, not cross-repo). Cross-repo reference: soft +0.05 penalty + sets `result._crossRepoFixTarget`. Line validation: soft +0.15 penalty per wrong line.
- L1848–1940 → DECISION: Check 4 (variableStateEdges): cross-check against AST mutation chains. WARNING ONLY, no confidence penalty. Extensive fuzzy matching: strips `this.`, `[]`, parenthetical annotations, dot-prefix matching. Only fires when mutations dict is non-empty.
- L1944–1956 → DECISION: Check 5 (security mode): verifies vulnerability location file refs. +0.2 penalty per fabricated file.
- L1957–2222 → DECISION: Check 6 (Fix Completeness): triggered only if callGraph exists + fix modifies a function's SIGNATURE (detected via diff `-` lines touching function declarations). Flags if callers of that function are not also updated. Intentionally does NOT fire for additive-only diffs or React component consumers.

### core/orchestrate.js — checkSolvability() (L1386–1528)

Discovery context: the layer boundary detector

- L1393–1401 → DECISION: Package/build errors (PACKAGE_RESOLUTION, BUILD_CONFIG) immediately return NOT_BOUNDARY — always config-fixable, never OS-level.
- L1416–1429 → DECISION: Primary gate: if rootCause mentions any provided filename → fixable in this codebase → NOT a boundary.
- L1444–1455 → DECISION: Secondary gate: scans rootCause + evidence text (NOT raw symptom text — symptom often contains OS metadata like "Operating system: macOS" triggering false positives). Requires at least 1 upstream keyword.
- L1494–1497 → DECISION: Confidence formula: base 0.70 + 0.05 per matched keyword + 0.10 citation boost if rootCause has zero file refs. Cap 0.95.

### cli.js (full, 441 lines)

Discovery context: standalone CI/CD entry point, completely separate from MCP server

- L1–18 → BOUNDARY: cli.js is NOT the MCP server. It's a standalone script for GitHub PR annotations. No session state, no KG, no codex, no embeddings.
- L78–121 → DECISION: Same `readFilesFromDirectory` as index.js (copy, not import) — reads all code files, skips test patterns, node_modules, .unravel, .git, dist, build.
- L123–287 → DECISION: SARIF 2.1.0 builder. Maps 6 bug types to SARIF rules: RACE_CONDITION, FLOATING_PROMISE, STALE_MODULE_CAPTURE, CONSTRUCTOR_CAPTURE, FOREACH_MUTATION, LISTENER_PARITY. Pattern hints attached as `_unravelPatternHints` extension field.
- L290–297 → DECISION: `isCritical()` — exit code 1 if: any globalWriteRace OR any floatingPromise (always critical), OR any pattern match ≥ threshold. Default threshold = 0.9.
- L300–437 → DECISION: Main flow: parse args → load orchestrate + ast-engine + pattern-store → `initParser()` → load patterns from `.unravel/patterns.json` → `readFilesFromDirectory` → `orchestrate(files, symptom, {_mode: 'mcp', provider: 'none'})` → extracts `astRaw` from `result.mcpEvidence || result` → formats as text/json/sarif → writes to file or stdout.
- L14–17 → DECISION: Exit codes: 0=clean, 1=critical findings detected, 2=analysis error. This matches GitHub Actions `continue-on-error: false` contract.

---

## COMPLETE — All files read. Nothing remaining.
