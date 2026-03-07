---
name: Unravel Architecture Guide
description: Deep project understanding and critical workflows for Unravel AI development.
---

# Unravel AI — Developer Skill

When you are asked to work on the Unravel project, you **MUST** follow these steps and internalize this experiential knowledge. Unravel is not a standard React/Node.js app; it is a complex, deterministic AI debugging engine with strict architectural rules.

---

## Step 1: Mandatory Reading

Before suggesting any architectural changes or writing any engine code, you **MUST** use the `view_file` tool to read these documents completely:

1. **`IMPLEMENTATION_PLAN.md`** — The master roadmap. Shows every phase, what's complete, what's planned, and the exact verification criteria. **Always check this first** so you know which phase the project is on.
2. **`unravel_blueprint.md`** — Deep technical architecture: the AST engine internals, the 9-phase prompt pipeline, bug taxonomy, output schema, anti-sycophancy rules.
3. **`README.md`** — Public-facing documentation. Keep this in sync with any changes you make.

---

## Step 2: Understand the Architecture

Unravel has three codebases that share one core engine:

### 1. The Shared Core Engine (`unravel-v3/src/core/`)

Six files (plus one additive cross-file layer) with **zero browser or React dependencies**:

| File | Purpose |
|------|---------|
| `index.js` | Barrel export — single entry point for all core modules |
| `config.js` | Providers, API models, bug taxonomy (12 primary + extensible `secondaryTags`), `buildDebugPrompt()`, `buildExplainPrompt()`, `buildSecurityPrompt()`, `buildRouterPrompt()`, `ENGINE_SCHEMA`, `EXPLAIN_SCHEMA`, `SECURITY_SCHEMA`, `buildSectionSchema()`, `estimateRuntime()` |
| `ast-engine.js` | Deterministic static analysis using `@babel/parser` + `@babel/traverse`. Produces variable mutation chains, closure captures, and timing/async node maps |
| `orchestrate.js` | The main pipeline: gathers AST facts → builds prompt → calls LLM → parses response → validates. Handles `checkFileCompleteness`, self-healing context (`onMissingFiles` recursion, depth 2), stamps `_provenance` on every result, and runs `verifyClaims()` to flag hallucinated line/file references |
| `provider.js` | API caller for Anthropic, Google, and OpenAI with retry and error handling |
| `parse-json.js` | Robust JSON extractor that handles markdown-wrapped responses, partial JSON, LLM formatting quirks, and **truncated JSON repair** (closes open braces/brackets when LLM hits token limit) |
| `ast-project.js` | Cross-file AST resolution: builds module map (imports/exports), resolves symbol origins, expands mutation chains across files, emits deterministic risk signals (`cross_file_mutation`, `async_state_race`, `unawaited_promise`) |

### 2. The Web App (`unravel-v3/`)

A React application built with **Vite**. Key file: `src/App.jsx` (~1700 lines).

- **Five-step UX flow**: Input (Paste/Upload/GitHub) → Mode (Debug/Explain/Security) → Configure (preset + sections) → Describe → Report
- **Three input methods:** Paste, Folder Upload, and GitHub URL import
- **Router Agent:** When a project has many files, `buildRouterPrompt()` selects 5-8 relevant files *before* the main analysis runs. The web app calls the Router Agent in **two places**: once inside `fetchGitHubRepo()` (Router-first fetch, selects before downloading) and once inside `executeAnalysis()` (selects from already-uploaded files)
- **Missing files flow:** If orchestrate detects incomplete context, it pauses and shows a UI for the user to provide additional files, then resumes
- **Error Boundary:** `ErrorBoundary.jsx` wraps the report rendering section. If Mermaid or data errors crash rendering, a fallback UI shows raw JSON instead of a white screen
- **Netlify proxy:** `netlify/functions/anthropic-proxy.mjs` proxies Anthropic API calls from the browser to avoid CORS blocking

### 3. The VS Code Extension (`unravel-vscode/`)

A standard VS Code extension. Key files:

| File | Purpose |
|------|---------|
| `extension.js` | Entry point: `activate()`, command registration, `debugCurrentFile()` handler |
| `imports.js` | **Regex-based** import resolver (ESM `import` and CJS `require` patterns). Walks local imports up to **depth 2** to gather related files — does NOT parse AST, uses regex patterns |
| `diagnostics.js` | VS Code diagnostic provider — creates red squiggly underlines on the root cause line |
| `decorations.js` | Inline `🔴 ROOT CAUSE: STATE_MUTATION` text overlays on the editor |
| `hover.js` | Hover tooltips showing the fix, confidence, and evidence when you hover over the root cause line |
| `sidebar.js` | Full HTML report rendered in a WebView panel |
| `core/` | **Exact copy** of the shared core engine (6 files, see above) |

**Build system:** `esbuild.js` bundles everything into a single `out/extension.js` file, converting ESM (`import`/`export`) syntax from the core files into CommonJS for the VS Code runtime.

---

## CRITICAL: Experiential Rules & Workflows

These rules come from real bugs and real mistakes made during development. Violating them will break things silently.

### Rule 1: The Sync Rule (Core Engine)

The core engine files live in `unravel-v3/src/core/`. An **exact copy** lives in `unravel-vscode/src/core/`. These 6 files must be byte-identical at all times.

**If you update ANY file in `unravel-v3/src/core/`, you MUST copy that exact file to `unravel-vscode/src/core/`.** There are NO VS Code-specific adaptations in the copy — they are raw duplicates.

The 7 files to sync: `index.js`, `config.js`, `ast-engine.js`, `orchestrate.js`, `provider.js`, `parse-json.js`, `ast-project.js`.

**Sync guard script:** Run `bash scripts/sync-core.sh` before every VSIX build — it copies all 6 files from `unravel-v3/src/core/` → `unravel-vscode/src/core/` ensuring they stay identical.

### Rule 2: The VS Code Build & Package Workflow

Changes to the VS Code extension are NOT visible until bundled and packaged:

```
1. npm run build        ← runs esbuild → creates out/extension.js
2. npm run package      ← runs vsce package → creates .vsix file
3. Bump version in package.json if making a logical release
```

**After packaging:** Verify the bundled `out/extension.js` contains your changes. Use  `Select-String` (PowerShell) or `grep` to confirm key function names or strings are present in the output.

### Rule 3: The "Deterministic Before Reasoning" Philosophy

This is the core architectural principle. Never bypass it:

1. **AST runs first** — `runFullAnalysis()` from `ast-engine.js` extracts mutations, closures, timing nodes as empirical facts
2. **Ground truth injection** — These AST facts are injected verbatim into the LLM prompt with a header: `VERIFIED STATIC ANALYSIS — deterministic, not hallucinated`
3. **9-phase pipeline** — The LLM is forced through 9 phases in strict order (INGEST → TRACK STATE → SIMULATE+HYPOTHESIZE → ELIMINATE → ROOT CAUSE → MINIMAL FIX → AI LOOP → CONCEPT → INVARIANTS). It cannot skip phases.
4. **Hypothesis elimination** — The LLM must generate 3 hypotheses and eliminate the wrong ones using AST evidence before committing to a root cause

### Rule 4: Output Must Be Surgical

The engine returns a structured JSON report conforming to `ENGINE_SCHEMA` (defined in `config.js`). Every field has a purpose. Do not add freeform text fields or unstructured output. The report schema includes: `bugType`, `secondaryTags[]`, `customLabel`, `confidence`, `symptom`, `reproduction`, `evidence`, `rootCause`, `codeLocation`, `minimalFix`, `whyFixWorks`, `variableState`, `timeline`, `whyAILooped`, `conceptExtraction`, `aiPrompt`, Mermaid edge data (`timelineEdges`, `hypothesisTree`, `aiLoopEdges`, `variableStateEdges`), and `_provenance` (engine version, model, timestamp). Security mode adds `exploitability` per vulnerability.

### Rule 5: File Handling Details

- **VS Code:** `imports.js` uses regex (NOT AST) to find `import ... from '...'` and `require('...')` patterns, then resolves relative paths with extension guessing (`.js`, `.jsx`, `.ts`, `.tsx`, `/index.js`, `/index.ts`). Max depth = 2 to avoid pulling in `node_modules`.
- **Web App:** Directory upload filters by extension (`.js`, `.jsx`, `.ts`, `.tsx`, `.html`, `.css`, `.json`, `.py`, `.md`, `.vue`, `.svelte`), blacklists folders (`node_modules`, `.git`, `.next`, `dist`, `build`), and caps file size at 500KB.
- **GitHub Fetch:** Router-first — when >10 candidate files are found in a repo, the Router Agent (`buildRouterPrompt`) picks 5-8 relevant files BEFORE their raw content is downloaded. Falls back to fetching all (capped at 50) if the Router fails.
- **Empty symptom:** Both Web App and VS Code allow empty symptom input. Orchestrate falls back to `'No specific error described. Analyze for any issues.'`

### Rule 6: Multi-Mode Architecture (✅ COMPLETE — Phase 4A)

Unravel is a multi-mode analysis platform with 3 built modes:
- 🐛 **Debug Mode** — 9-phase pipeline, root cause, fix, hypothesis elimination
- 🔍 **Explain Mode** — Architecture walkthrough, data flow, entry points, onboarding guide
- 🛡️ **Security Scan** — Vulnerability audit with severity, exploitability, CWE IDs, attack vector flowcharts

**Output presets:** Quick Fix / Developer / Full Report / Custom (per-section checkboxes). Presets control which schema fields are requested — smaller schema = fewer tokens = faster response.

**Action Center (Phase 5):** After analysis, users can apply the fix locally (VS Code), create a GitHub Issue/PR (Web), or pass the fix to Copilot Chat (VS Code).

Any new analytical feature **MUST** integrate into this mode system. Do not build one-off features outside the mode architecture.

---

## Quick Reference: Key Functions

| Function | File | What It Does |
|----------|------|-------------|
| `orchestrate()` | `orchestrate.js` | Main pipeline entry point — takes `(files, symptom, options)` |
| `runFullAnalysis()` | `ast-engine.js` | AST pre-analysis — returns mutation chains, closures, timing nodes |
| `buildDebugPrompt()` | `config.js` | Constructs the 9-phase debug system prompt (provider-specific formatting) |
| `buildExplainPrompt()` | `config.js` | Constructs the explain mode system prompt |
| `buildSecurityPrompt()` | `config.js` | Constructs the security audit system prompt |
| `buildRouterPrompt()` | `config.js` | Constructs the Router Agent prompt for file selection |
| `buildSectionSchema()` | `config.js` | Builds a subset of ENGINE_SCHEMA based on selected output sections |
| `estimateRuntime()` | `config.js` | Estimates analysis time based on file count and section count |
| `callProvider()` | `provider.js` | Sends prompt to Anthropic/Google/OpenAI API with retry |
| `parseAIJson()` | `parse-json.js` | Extracts JSON from raw LLM response text (includes truncated JSON repair) |
| `verifyClaims()` | `orchestrate.js` | Post-analysis: flags hallucinated file/line references in evidence |
| `gatherFiles()` | `imports.js` (VS Code only) | Walks import chains from the active file |
| `checkFileCompleteness()` | `orchestrate.js` | Detects truncated/incomplete files before analysis |

---

When you begin your task, confirm to the user that you have loaded the Unravel skill and are proceeding according to these architectural rules.
