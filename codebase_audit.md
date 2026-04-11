# Unravel MCP — Full Code Audit
*Source-verified against: `ast-engine-ts.js` (3608 lines), `orchestrate.js` (2222 lines), `graph-builder.js` (204 lines), `index.js` (3374 lines)*

---

## ✅ What Is Correctly Wired

### 1. MCP Short-Circuit is Correct
`orchestrate.js:449` — The `if (options._mode === 'mcp')` guard fires *after* Phases 0→1e (input validation, KG routing, AST analysis, cross-file, symptom contradiction, coverage alert, pattern hints). It returns before any LLM call. This is exactly right. The agent gets everything deterministic; it brings its own reasoning.

### 2. `detail` Mode Gating is Correct
- `ast-engine-ts.js:963` — `runMultiFileAnalysis(files, detail)` receives the `detail` flag from `orchestrate.js:337`.
- `orchestrate.js:337` — `const detail = options._mode === 'mcp' ? (options.detail || 'standard') : 'full'` — browser always gets `full`, MCP defaults to `standard`. Correct.
- `formatAnalysis()` at `ast-engine-ts.js:3012` — `isPriority` and `isStandard` gates correctly suppress the "Relevant Functions" dump and apply the cross-function mutation filter in non-full modes.

### 3. `astRaw.mutations` Double-Drop is Intentional and Correct
`index.js:1062-1066` — The filtered `astRaw.mutations` is DELETED in standard/priority mode, replaced with `_mutationsDropped` string. `contextFormatted` already carries the same signal in readable form. This is the right call — saves ~20–50 KB depending on file count.

### 4. `filterAstRawMutations()` is Correctly Gated
`index.js:979-984` — Only runs when `detail !== 'full'`. It correctly uses `forceInclude` from `globalWriteRaces`, `constructorCaptures`, `staleModuleCaptures`, and `floatingPromises` to preserve confirmed-signal variables even if they'd pass the noise filter. The `NOISE_VARS` set at `index.js:846` is correctly deduped from the one in `formatAnalysis()` at `ast-engine-ts.js:3045`.

### 5. Native vs WASM Detection is Solid
`ast-engine-ts.js:13` — `_IS_NODE` correctly uses `typeof process !== 'undefined' && !!process.versions?.node && typeof window === 'undefined'`. The lazy `_initPromise` guard (L54) makes `initParser()` idempotent. The single shared `parserInstance` is safe because the `for` loop in `runMultiFileAnalysis()` is sequential (correctly noted in L44 comment).

### 6. Cross-File Gating is Correct
`orchestrate.js:354-355`:
```js
const isNativePath = astRaw?._source === 'native-tree-sitter';
const canRunCrossFile = options._mode !== 'mcp' || isNativePath;
```
Cross-file only runs on native (MCP Node.js path). WASM cross-file is blocked. This prevents WASM panic propagating across all files — confirmed by the comment.

### 7. `autoSeedCodex()` is Correctly Non-Blocking
`index.js:2099` — The function is wrapped in try/catch and any error is non-fatal. The `verify()` tool response is returned immediately; codex seeding is fire-and-forget. Good.

### 8. Diagnosis Archive is Correctly Loaded Once Per Session
`index.js:1028` — `if (session.projectRoot && !session.archiveLoaded)` gate prevents repeated disk reads. Pattern loading at L1006 also has a `session.patternsLoaded` guard. Both correct.

### 9. `graph-builder.js` — Trust Levels Are Correct
File nodes → `LLM_INFERRED`. Function/class nodes from AST → `AST_VERIFIED`. Import/call/contains edges → `AST_VERIFIED`. This matches the design. `mergeGraphUpdate()` correctly prunes removed nodes and their edges before merging new ones.

---

## 🔴 Real Bugs / Regressions

### BUG 1: `async_state_race` is NOT a Detector — It's a Cross-File Signal That Produces False Positives

**What the design doc says is suppressed:** "async_state_race false positives" from consult mode (Scholar Model noise).

**What actually fires:** `ast-project.js:runCrossFileAnalysis()` emits `async_state_race` signals via `emitRiskSignals`. However, the *primary* noise source is `detectGlobalMutationBeforeAwait()` at `ast-engine-ts.js:1925`. 

Look at the detector: **Pass B** (lines 1974-1998) collects *any imported identifier matching `SETTER_PREFIX_RE = /^(?:set|clear|reset|init)[A-Z]/`*. This means:
- `initParser` → flagged ⚠
- `setLanguage` → flagged ⚠  
- `clearTimeout` → NOT flagged (in NOISE_GLOBALS, exempted at the call site? Actually no — it's in TIMING_APIS but NOT in NOISE_GLOBALS for this detector)
- `resetButton`, `setTitle`, `initRouter` → all flagged

Any call to `setXxx()` before an `await` gets tagged as a potential race. The false positive rate scales with the number of `set*`/`init*` imports in a file. **This is the confirmed source of the noise you see in consult mode.**

**Where it's NOT suppressed:** `index.js:734-739`:
```js
const detectorsFired = [
    ...(astRaw.globalWriteRaces    || []),
    ...(astRaw.constructorCaptures || []),
    ...
].length;
```
`globalWriteRaces` is included in STATIC_BLIND detection, so even noisy fires show up in `critical_signal`.

**The fix:** Pass B needs a resolver — check that the imported `set*` function's source module actually exports a `let` binding before flagging it. Without that, it's a heuristic, not a fact.

---

### BUG 2: `session.astRaw` Stores UNFILTERED, but `base.evidence.astRaw` is FILTERED — Verify Uses the Wrong One

**Flow:**
1. `index.js:985-988` — filtered `astRawForResponse` is computed; then `session.astRaw = result.evidence?.astRaw` (the **unfiltered** original).
2. `index.js:1053-1055` — `base.evidence.astRaw = astRawForResponse` (filtered).
3. Later, `verify()` calls `verifyClaims()` using `session.astRaw` (unfiltered) — **correct**.
4. But `formatAnalysisForAgent()` at `index.js:733` reads `payload.evidence?.astRaw` (which is now filtered) for the STATIC_BLIND check.

**The problem:** `detectorsFired` at `index.js:734-739` reads from `payload.evidence?.astRaw` which has had `mutations` deleted (P4 drop at L1062-1066). The detector arrays (`globalWriteRaces`, `constructorCaptures`, etc.) are NOT part of `mutations` — they're separate keys on `astRaw` — so this is actually fine. But the `_mutationsDropped` string in `astRaw` misleads agents trying to read raw data. This is an **info hazard, not a logic bug** — but it's worth knowing.

---

### BUG 3: `forceInclude` in `filterAstRawMutations()` Has a Silent Empty String Problem

`index.js:871`:
```js
...(raw.floatingPromises || []).map(f => f.calledFn || ''),
```
`floatingPromises` entries have `{ api, line, fn, kind }` — there is **no `calledFn` field**. Every floating promise produces an empty string `''` in the forceInclude set. Empty string is never a valid variable name, so this is a no-op but it silently wastes a set entry per floating promise. Low severity but indicates a stale field reference.

**The correct field is `f.api`** — that's the function name for non-forEach floating promises.

---

### BUG 4: `canRunCrossFile` Blocks Cross-File for Browser Even When WASM Is Working

`orchestrate.js:355`:
```js
const canRunCrossFile = options._mode !== 'mcp' || isNativePath;
```
The comment at L350-352 says: "WASM cross-file is not supported — WASM crashes on cross-file calls." So browser always has cross-file disabled.

**But the webapp runs `orchestrate()` without `_mode: 'mcp'`** — the left side `options._mode !== 'mcp'` is TRUE for browser, so browser cross-file IS enabled (condition passes). Then `runCrossFileAnalysis(jsFilesForAST, astRaw, null)` runs on WASM. If this is stable in the browser, no bug. If WASM cross-file still panics, this is an unguarded crash path. Worth verifying which it is.

---

## 🟡 Architectural Gaps / Missing Wires

### GAP 1: Task Codex Pre-Briefing Is NOT Available in `analyze` — Only in `query_graph`

The design doc shows the `pre_briefing` being injected by `searchCodex()` in `query_graph`. In `analyze`, there is **no codex search**. If an agent skips `query_graph` and calls `analyze` directly (which the decision flowchart permits for known small repos), codex context is never surfaced.

The `_instructions` block in the `analyze` response mentions codex at `index.js:596-659` (the server-level instructions), but only as protocol guidance — no actual codex content is injected into the response.

**Fix:** After `session.archiveLoaded` check in `analyze` (L1028), also run `searchCodex()` and inject the pre-briefing into `base._instructions` if a match is found.

---

### GAP 2: Pattern Store Uses MCP-Local Path, Not Project Path

`index.js:1004`:
```js
const mcpPatternFile = join(resolve(import.meta.dirname), '.unravel', 'patterns.json');
```
This stores patterns in the **MCP server's own install directory**, not the project being debugged. So pattern learning is global across all projects, not per-project.

The project-level pattern overlay (L1018-1022) only runs when `args.directory` is provided AND the directory changed. If the same project is debugged across multiple sessions without `args.directory`, the project patterns are never loaded.

**This means:** `verify(PASSED)` writes to `session.mcpPatternFile` (MCP install dir), not to the project's `.unravel/patterns.json`. Pattern learning accumulates globally, not per-project. This is probably intentional for sharing patterns, but it's not documented and could cause cross-project pattern bleed.

---

### GAP 3: `detectGlobalMutationBeforeAwait` Only Checks Top-Level Statement Block

`ast-engine-ts.js:2009-2012` (comment):
> *Limitation: only inspects direct children of the statement_block. Setter calls wrapped in a try/if/switch at the top level are NOT caught.*

This is accurately documented as a known gap. The most common pattern in real server code (`try { setTenant(id); ... await db.query(...) }`) is missed. So the very race pattern the engine is designed to catch most reliably is actually missed when wrapped in a try block — which is how well-written server code is structured.

---

### GAP 4: `buildSymptomCoverageAlert` Only Fires on 50+ Char Symptoms

`orchestrate.js:61`:
```js
if (!symptom || symptom.length < 50) return null;
```
A two-word symptom like `"rate limiting bypass"` is 20 chars and gets no coverage alert. But single-symptom analysis is correct, so this guard is fine — just worth knowing the threshold.

---

### GAP 5: `STATIC_BLIND` Verdict Missing `forEachMutations` and `specRisks` in the Count

`index.js:734-739`:
```js
const detectorsFired = [
    ...(astRaw.globalWriteRaces || []),
    ...(astRaw.constructorCaptures || []),
    ...(astRaw.staleModuleCaptures || []),
    ...(astRaw.floatingPromises || []),
].length;
```
`forEachMutations` and `specRisks` are NOT counted. A file with only `foreach_collection_mutation` or `predicate_strict_comparison` findings will get a false `STATIC_BLIND` verdict. The agent is told "zero detectors fired" when two detectors actually fired.

**Fix:** Add `...(astRaw.forEachMutations || []), ...(astRaw.specRisks || [])` to the array.

---

### GAP 6: `KG Auto-Restore` Happens After `loadPatterns` — Session Can Miss KG on First Analyze

`index.js:991-998` — KG is auto-restored from disk. But in `orchestrate.js:208`:
```js
if (!kg && projectRoot) {
    const { loadGraph } = await import('./graph-storage.js');
    kg = loadGraph(projectRoot);
}
```
The KG is ALSO loaded inside `orchestrate()` itself using `session.projectRoot`. But `session.projectRoot` is only set at `resolveFiles()` (L469) when `args.directory` is provided. If the agent calls `analyze(files: [...])` with explicit files and no directory, `session.projectRoot` is empty, and both the in-orchestrate KG load AND the post-orchestrate auto-restore fail. **KG routing is silently skipped.**

This is expected per the design, but the failure is completely silent — no warning to the agent.

---

## 🟠 Context Efficiency Issues

### ISSUE 1: `cross_file_graph` Is Always Sent, Even for Single-File Bugs

The `formatAnalysisForAgent()` function always sends the cross-file graph as a key. For single-file bugs with no cross-file calls, this is just:
```
"cross_file_graph": "No cross-file analysis available."
```
That's fine — it's tiny. But when cross-file IS present, it's always sent regardless of whether the agent asked for it. This is the minor context efficiency issue noted in previous sessions. It's not a bug; just a potential optimization.

### ISSUE 2: Pattern Hints Threshold Is 0.5 — Potentially Too Low

`index.js:1075`:
```js
const strongPatterns = topPatterns.filter(p => p.confidence >= 0.5);
```
A pattern with 50% confidence injected as "treat as H1" could bias the agent toward a false positive. The design doc says ≥0.7 token coverage → matched. The `matchPatterns()` function returns patterns at their learned weight — a fresh install has all patterns at 0.5 default. Consider raising the injection threshold to 0.7+.

---

## Summary Table

| # | Type | Location | Severity | Status |
|---|---|---|---|---|
| BUG 1 | `detectGlobalMutationBeforeAwait` Pass B false positives (set* imports) | `ast-engine-ts.js:1985` | 🔴 High | Open — primary consult noise source |
| BUG 2 | `f.calledFn` field doesn't exist in floating promises | `index.js:871` | 🟡 Low | Silent no-op, wrong field |
| BUG 3 | Cross-file in browser: canRunCrossFile passes without native guard | `orchestrate.js:355` | 🟡 Medium | Needs runtime verification |
| GAP 1 | `analyze` never injects codex pre-briefing | `index.js:analyze handler` | 🟠 Medium | Missing wire |
| GAP 2 | Pattern store is global (MCP dir), not per-project | `index.js:1004` | 🟠 Medium | Undocumented design decision |
| GAP 3 | `globalWriteRace` misses try-block wrapped setters | `ast-engine-ts.js:2009` | 🟠 Medium | Self-documented limitation |
| GAP 5 | STATIC_BLIND doesn't count `forEachMutations` / `specRisks` | `index.js:734-739` | 🟡 Medium | False STATIC_BLIND possible |
| GAP 6 | KG routing silently skipped when no `args.directory` | `orchestrate.js:208` | 🟡 Low | Expected but silent |
| PERF 2 | Pattern hint threshold 0.5 may inject weak hints as H1 | `index.js:1075` | 🟡 Low | Consider raising to 0.7 |

