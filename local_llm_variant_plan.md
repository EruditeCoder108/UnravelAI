# `unravel-local` — Local LLM Variant: Implementation Plan

## What We're Actually Building

A **self-contained Node.js package** called `unravel-local` — the 4th Unravel variant. It wraps the same deterministic AST engine as the MCP, but adds a **built-in Ollama LLM layer** that executes the full 11-phase reasoning pipeline locally. No cloud APIs, no API keys.

```
                 ┌─────────────────────────────────────────────┐
                 │              unravel-local                   │
                 │                                             │
  stdin/CLI ──▶  │  [CLI interface]    [node API]              │
                 │       │                 │                   │
                 │  ┌────▼─────────────────▼───────────┐       │
                 │  │    Local Orchestrator             │       │
                 │  │  (Phases 0→1e: AST, identical     │       │
                 │  │   to MCP — no changes needed)     │       │
                 │  │                                   │       │
                 │  │  Phase 2+: Ollama LLM call        │ ◀─── Gemma 4 E4B
                 │  │  (NOT the MCP short-circuit!)     │      (Modelfile)
                 │  └───────────────────────────────────┘       │
                 │                                             │
                 │  [ollama-embed.js]  [ollama-llm.js]         │  ◀─ nomic-embed-text
                 │  [provider-local.js] ← routes all calls     │
                 └─────────────────────────────────────────────┘
```

**The key insight:** The MCP short-circuits at Phase 1d and returns evidence to the AGENT. `unravel-local` does NOT short-circuit. It continues through Phases 2–9, calling Ollama as the LLM for the full pipeline — just like the webapp calls Claude/Gemini. This is closer to a **self-hosted web-app engine** than to the MCP.

---

## How the 4 Variants Compare

| | `unravel-mcp` | `unravel-v3` (webapp) | `unravel-vscode` | `unravel-local` (new) |
|---|---|---|---|---|
| **Who reasons?** | External agent (Claude, Gemini, Antigravity) | Cloud LLM (Claude/Gemini/GPT) | Cloud LLM | **Ollama (Gemma 4 E4B)** |
| **Pipeline end** | Phase 1d (MCP exit) | Phase 9 | Phase 9 | **Phase 9 (full)** |
| **Embedding** | Gemini API (optional) | Gemini API (optional) | None | **nomic-embed-text (local)** |
| **UI** | None | Browser React | VS Code panel | **CLI / Node API** |
| **Internet required** | No (for AST); Yes for embeddings | Yes | Yes | **Zero** |
| **API key** | GEMINI_API_KEY (optional) | Required | Required | **Zero** |

---

## File Inventory: Copy vs Rewrite vs New

### ✅ Copy Exactly from `unravel-mcp/`
These files are pure deterministic logic — zero cloud API calls:

```
unravel-local/core/
  ast-engine-ts.js     ← native tree-sitter, identical
  ast-project.js       ← cross-file analysis, identical
  ast-bridge.js        ← regex fallback, identical
  graph-builder.js     ← KG data model, identical
  graph-storage.js     ← KG persistence (Node.js fs), identical
  search.js            ← queryGraphForFiles, identical
  parse-json.js        ← robust JSON parser, identical
  pattern-store.js     ← learned patterns, identical
  layer-detector.js    ← layer classification, identical
  indexer.js           ← KG builder/walker, identical
```

### ✏️ Adapt (light edits)

| File | Source | What Changes |
|---|---|---|
| `orchestrate.js` | `unravel-mcp/core/orchestrate.js` | **Remove MCP short-circuit block (L428–L524)**. Keep Phases 0→1e identical, continue to Phase 2+ with Ollama call instead of cloud provider. Remove browser-specific IDB archive, use fs-based archive. |
| `config.js` | `unravel-v3/src/core/config.js` | **Remove cloud PROVIDERS block** (anthropic/google/openai). Keep: bug taxonomy, phases, system prompt builders, schema. Add `PROVIDERS.ollama` entry. Keep `_formatPrompt()` — add a `'ollama'` branch that outputs plain markdown (Ollama doesn't support XML tags). |
| `embedding.js` | `unravel-mcp/embedding.js` | **Replace Gemini API calls with Ollama**. Keep all function signatures identical. See `ollama-embed.js` design below. |

### 🆕 New Files

```
unravel-local/
  index.js                    ← Node API entry point (not MCP, not CLI)
  cli.js                      ← command: unravel-local debug <dir> "symptom"
  providers/
    ollama-embed.js           ← embedText/embedDocument/embedQuery via Ollama
    ollama-llm.js             ← chat() via Ollama API, streaming supported
  config/
    provider-config.js        ← routes all provider calls (local default, cloud fallback)
  scripts/
    reembed-all.js            ← one-time re-embed of existing KG/archive
    health-check.js           ← verify Ollama + both models are ready
  Modelfile.unravel           ← baked Gemma 4 E4B with full system prompt
  package.json                ← new package, no MCP SDK dependency
  README.md
```

---

## Architecture Deep-Dive

### 1. `providers/ollama-embed.js`

Replace `embedding.js`'s Gemini calls. **Key differences from Gemini:**

- Endpoint: `POST http://localhost:11434/api/embed`
- Model: `nomic-embed-text`
- nomic uses task prefixes: `"search_document: "` for indexing, `"search_query: "` for search
- Same 768 dimensions as Gemini text-embedding-004 → cosine math is unchanged
- **Image embedding**: nomic-embed-text cannot do images. For `embedImage()`, fall back gracefully (return null) — `query_visual` becomes text-only in local mode.
- No API key parameter needed anywhere

```javascript
// Clean interface — drop-in for embedding.js exports
export async function embedText(text, _apiKey, taskType = 'RETRIEVAL_DOCUMENT') { ... }
export async function embedImage(imageInput, _apiKey) { return null; } // not supported locally
export async function embedTextsParallel(texts, _apiKey, taskType) { ... }
export async function cosineSimilarity(a, b) { ... }            // unchanged math
export async function embedChangedNodes(graph, _apiKey, opts) { ... }
export async function buildSemanticScores(symptom, graph, _apiKey) { ... }
export async function archiveDiagnosis(projectRoot, entry, _apiKey) { ... }
export async function searchDiagnosisArchive(symptom, archive, _apiKey, opts) { ... }
```

All `_apiKey` parameters are accepted but ignored — zero breaking changes when swapping.

### 2. `providers/ollama-llm.js`

Wraps Ollama `/api/chat`. Supports both streaming and non-streaming.

```javascript
// Key config
const REASONING_MODEL = process.env.UNRAVEL_MODEL || 'unravel-gemma4';
// Defaults tuned for the 11-phase reasoning protocol:
// temp: 0.1 (structured output, no creativity needed)
// num_ctx: 32768 (full AST payload + files)
// num_predict: 6000 (full diagnosis output)
// repeat_penalty: 1.1 (prevents looping in long reasoning)
```

Streaming: Ollama `/api/chat` with `stream: true` returns NDJSON chunks. Each chunk is `{ message: { content: "..." } }`. Easy to wire into `onChunk` callbacks.

### 3. `config/provider-config.js`

Single routing module. The `orchestrate.js` calls `provider.chat()` instead of `callProvider()`:

```javascript
const PROVIDER = process.env.UNRAVEL_PROVIDER || 'local';

const providers = {
  local: {
    chat: ollamaLLM.chat,
    chatStreaming: ollamaLLM.chatStreaming,
    embedDocument: ollamaEmbed.embedDocument,
    embedQuery: ollamaEmbed.embedQuery,
    embedBatch: ollamaEmbed.embedBatch,
    cosineSim: ollamaEmbed.cosineSimilarity,
    checkHealth: async () => { ... }
  },
  cloud: {
    // future: route to original provider.js with keys
  }
};

export default providers[PROVIDER];
```

### 4. `Modelfile.unravel` — The Critical File

This bakes the **full Unravel system prompt** directly into Gemma 4 E4B as a named model. The model knows the Sandwich Protocol before any request arrives.

```
FROM gemma4:e4b

PARAMETER temperature 0.1
PARAMETER top_p 0.9
PARAMETER repeat_penalty 1.1
PARAMETER num_ctx 32768

SYSTEM """
[Full 11-phase pipeline protocol from config.js]
[Hard gates: HYPOTHESIS_GATE, EVIDENCE_CITATION_GATE]
[All 16 rules including Proximate Fixation Guard, Name-Behavior Fallacy]
[Output format: plain JSON matching ENGINE_SCHEMA]
"""
```

Build once with `ollama create unravel-gemma4 -f Modelfile.unravel`.

**Why this matters:** Every session starts with a model that already knows the protocol — no system prompt token cost per call. The reasoning instructions are weights, not tokens.

### 5. Modified `orchestrate.js`

Remove the MCP short-circuit block entirely (L428–L524 in the current core). The pipeline continues:

```javascript
// Phase 2: Build system prompt (adapted for Ollama — plain markdown format)
const systemPrompt = buildDebugPrompt(level, language, 'ollama');

// Phase 3: Call Ollama (replaces callProvider())
const provider = await import('../config/provider-config.js');
const raw = await provider.chat([
  { role: 'system', content: systemPrompt },
  { role: 'user', content: enginePrompt },
], { num_ctx: 32768, num_predict: 6000 });

// Phase 4–9: Identical to webapp — parse JSON, run verifyClaims(), learnFromDiagnosis()
```

### 6. The CLI (`cli.js`)

```bash
# Debug a directory
unravel-local debug ./my-project "timer shows wrong value after pause"

# Explain mode
unravel-local explain ./my-project

# Build knowledge graph
unravel-local index ./my-project

# Health check
unravel-local doctor

# Re-embed after switching from Gemini
unravel-local reembed ./my-project

# Use cloud fallback for one call
UNRAVEL_PROVIDER=cloud ANTHROPIC_API_KEY=sk-... unravel-local debug ./my-project "..."
```

Output: colored terminal output with diff blocks, confidence scores, and causal chains.

---

## Gemma 4 E4B Specific Adaptations

### What changes from the existing prompts

The existing `_formatPrompt()` in `config.js` has 3 branches: `anthropic` (XML tags), `google` (markdown headers), `openai` (markdown + delimiters). We add:

```javascript
if (provider === 'ollama') {
    // Plain markdown — no XML tags, no special delimiters
    // Gemma 4 E4B responds better to direct numbered lists
    // lower verbosity needed — model already has baked-in protocol from Modelfile
    return `${role}

## Pipeline
${phases.map(p => `**Phase ${p.n} — ${p.name}:**\n${p.desc}`).join('\n\n')}

## Rules
${rules.map((r, i) => `${i+1}. ${r}`).join('\n')}

Return JSON matching the schema.`;
}
```

### Gemma 4 E4B specific strengths to exploit

The model is natively multimodal with **function calling + structured JSON output**. This means:

1. **Structured output:** Gemma can output clean JSON natively via its `response_format` equivalent in Ollama's options. Set `format: "json"` in the payload to constrain output format — fewer parse failures than Claude/Gemini.
2. **128K context:** Full AST payload + all files + schema instructions fit comfortably. No truncation needed for normal repos.
3. **Per-Layer Embeddings (PLE):** 4.5B active params — smarter reasoning than a standard 4B. The 11-phase protocol will get meaningful hypothesis elimination.

### Realistic quality expectations

| Bug complexity | Expected quality |
|---|---|
| Single-file, clear mutation chain | ~90% of Sonnet quality (AST constrains hallucination) |
| Multi-file, async race | ~70–75% — may need `UNRAVEL_PROVIDER=cloud` fallback |
| Novel pattern, no archive match | ~60% — will produce something but may need iteration |
| Any bug with archive match | ~85%+ — archive pre-loading compensates for model size |

The pattern store and diagnosis archive are **model-agnostic** — after 20–30 `verify(PASSED)` sessions, these catch up significantly regardless of model size.

---

## Implementation Sequence

### Phase 1 — Foundation (1–2 days)
1. `cp -r unravel-mcp unravel-local` — start from MCP, don't greenfield
2. Delete: `index.js` (MCP specific), the MCP SDK dependency from `package.json`
3. Create `providers/ollama-embed.js` — all exports, nomic-embed-text backend
4. Create `providers/ollama-llm.js` — chat + streaming
5. Create `scripts/health-check.js` — verify Ollama, both models, 768-dim test
6. Test embeddings: `node -e "import('./providers/ollama-embed.js').then(m => m.checkEmbedHealth())"`

### Phase 2 — Orchestrator Adaptation (1–2 days)
7. Copy `unravel-mcp/core/orchestrate.js` → `unravel-local/core/orchestrate.js`
8. **Remove MCP short-circuit block** (lines ~428–524 where `options._mode === 'mcp'`)
9. **Remove CONSULT short-circuit block** similarly
10. Replace `callProvider()` with `provider.chat()` from `provider-config.js`
11. Replace `embedding-browser.js` imports with `providers/ollama-embed.js`
12. Remove `embeddingApiKey` / `_embedKey` patterns — no API key needed
13. Keep `learnFromDiagnosis()`, `archiveDiagnosis()`, pattern store — unchanged

### Phase 3 — Config Adaptation (half day)
14. Copy `config.js` from `unravel-v3/src/core/config.js` (richer than MCP's)
15. Add `'ollama'` branch to `_formatPrompt()` — plain markdown format
16. Remove cloud `PROVIDERS` object (or keep for cloud fallback mode)
17. Create `Modelfile.unravel` with full baked system prompt

### Phase 4 — CLI + Node API (1 day)
18. Create `cli.js` with `debug`, `explain`, `index`, `doctor`, `reembed` commands
19. Create `index.js` as the programmatic Node API entry point
20. Create `scripts/reembed-all.js`
21. Update `package.json`: `name: "unravel-local"`, remove `@modelcontextprotocol/sdk`

### Phase 5 — Modelfile + First Run (half day)
22. Create `Modelfile.unravel`
23. `ollama create unravel-gemma4 -f Modelfile.unravel`
24. Run against benchmark package `b-01-invisible-update` — compare to MCP result
25. Tune `num_ctx`, `num_predict`, `temperature` based on output quality

### Phase 6 — Validation (ongoing)
26. Run against 5 benchmark packages, compare confidence + root cause accuracy
27. Calibrate Modelfile system prompt based on Phase 3 quality (most common failure mode)
28. Consider LoRA fine-tuning after 50 `verify(PASSED)` sessions (future)

---

## The `reembed-all` Problem

Your existing `.unravel/knowledge.json` and `diagnosis-archive.json` have Gemini 768-dim vectors. Gemini and nomic vectors are **NOT interchangeable** — same dimension count, different vector space. Cosine between them is meaningless.

**Fix:** Run once after switching:

```bash
node unravel-local/scripts/reembed-all.js ./your-project
```

This re-embeds all KG nodes and archive entries using nomic. Takes ~30–60s for a medium project. After that, cosine search works correctly.

---

## Package Structure (Final)

```
unravel-local/
├── package.json             name: "unravel-local", no MCP SDK
├── index.js                 Node API: export { analyze, verify, ... }
├── cli.js                   CLI entry point
├── Modelfile.unravel        ollama create unravel-gemma4 -f this
├── README.md
├── providers/
│   ├── ollama-embed.js      nomic-embed-text backend
│   └── ollama-llm.js        Gemma 4 E4B backend (chat + stream)
├── config/
│   └── provider-config.js   routes to local or cloud
├── scripts/
│   ├── health-check.js      doctor command
│   └── reembed-all.js       one-time re-embed script
└── core/                    copied from unravel-mcp/core (deterministic files)
    ├── orchestrate.js        ← adapted: no MCP short-circuit, Ollama call
    ├── config.js             ← adapted: ollama prompt format added
    ├── ast-engine-ts.js      ← copied as-is
    ├── ast-project.js        ← copied as-is
    ├── ast-bridge.js         ← copied as-is
    ├── graph-builder.js      ← copied as-is
    ├── graph-storage.js      ← copied as-is
    ├── search.js             ← copied as-is
    ├── parse-json.js         ← copied as-is
    ├── pattern-store.js      ← copied as-is
    ├── layer-detector.js     ← copied as-is
    └── indexer.js            ← copied as-is
```

---

## What Makes This Genuinely Different from Just "Ollama + Code"

Every other local-LLM debugging tool gives the model code and asks it to find bugs. `unravel-local` does:

1. **Deterministic AST extraction first** — mutation chains, race conditions, floating promises — the LLM receives verified facts, not just code
2. **Pattern store** — past bugs feed into every new session as structural hints
3. **Diagnosis archive** — 768-dim semantic search over verified past fixes; identical bugs get matched even with different vocabulary
4. **verify()** — deterministic claim checking via literal-string matching before any result is accepted
5. **Full 11-phase pipeline** — forced hypothesis generation and adversarial confirmation

The Gemma 4 E4B model is the reasoning brain. Unravel is the epistemics layer that makes it structurally harder to reason wrong.

---

## One Open Decision

**Should `unravel-local` also expose MCP tools** (as a secondary mode)?

Two possible approaches:
- **Option A:** Pure local engine — `unravel-local debug ./project "symptom"`. Simple. Standalone.
- **Option B:** Local engine + optional MCP server. When `--mcp` flag is set, runs as an MCP server but uses Ollama for the short-circuit reasoning inside `analyze`. This gives you a fully local version of the MCP that any MCP-compatible agent can use.

Option B is more powerful — it means Claude Code / Cursor can use Unravel locally without touching any cloud. The underlying mechanism: the MCP `analyze` tool passes the evidence packet back AND immediately calls Ollama to run the 11-phase reasoning, returning a pre-reasoned diagnosis that the agent can just verify. This eliminates cloud dependency entirely even for MCP users.

**Recommendation:** Build Option A first (1 week), extend to Option B after validating quality (another week).
