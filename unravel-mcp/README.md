# Unravel MCP

> **Deterministic AST evidence for AI coding agents.**  
> Zero hallucination. Verified ground truth. The Sandwich Protocol.

---

## What It Does

Unravel is a static analysis engine that wraps your AI agent's reasoning with AST-verified facts. It:

1. **Extracts** — mutation chains, async boundaries, closure captures, race conditions, call graphs — deterministically from source code
2. **Routes** — finds the exact files relevant to a bug symptom (semantic + graph search)
3. **Verifies** — cross-checks every claim the agent makes against actual file content before the fix is accepted
4. **Remembers** — learns from every verified diagnosis and surfaces past solutions automatically (Task Codex + Diagnosis Archive)

---

## Installation

```bash
npm install                     # from unravel-mcp/
```

### Register with Claude Code
```bash
claude mcp add unravel -- node /path/to/unravel-mcp/index.js
```

### Register with Gemini CLI
```json
// .gemini/settings.json
{
  "mcpServers": {
    "unravel": {
      "command": "node",
      "args": ["/path/to/unravel-mcp/index.js"]
    }
  }
}
```

**Optional — enable semantic search:**
```bash
export GEMINI_API_KEY=your_key_here
```
Required for: embedding-based file routing, semantic codex search, diagnosis archive hit-finding. Without it, keyword routing only.

---

## The Sandwich Protocol

```
                    ┌─────────────────────────────┐
                    │     UNRAVEL (Ground Truth)   │
                    └─────────────────────────────┘
                           ↑               ↓
          analyze()        │               │    verify()
          AST evidence ────┘               └──→ claim check
                    ┌─────────────────────────────┐
                    │    AGENT (LLM Reasoning)     │
                    │  Phases 3→8.5 of pipeline   │
                    └─────────────────────────────┘
```

The agent never reasons in a vacuum. Every diagnosis it produces is cross-checked against the actual file content before being accepted as ground truth.

---

## Tools

### `analyze` — Extract Structural Evidence

Runs Unravel's AST engine. Returns mutation chains, async boundaries, closure captures, floating promises, cross-file call graphs. No LLM involved — purely deterministic.

```js
// Minimal
analyze({ files: [{ name: "foo.ts", content: "..." }], symptom: "race on shared state" })

// From directory (reads all source files automatically)
analyze({ directory: "/path/to/project", symptom: "payments silently failing" })

// Verbosity control
analyze({ directory: "/repo", symptom: "...", detail: "priority" })  // top findings only (~50 lines)
analyze({ directory: "/repo", symptom: "...", detail: "full" })      // complete raw AST JSON
```

**Response — 5 keys:**
```json
{
  "critical_signal":   "...AST evidence block + pattern hints + semantic archive hits",
  "protocol":          "...per-call phase reminders + verify() field checklist",
  "cross_file_graph":  "...call graph edges + symbol origin table",
  "raw_ast_data":      "...full AST JSON (only in detail:'full')",
  "metadata":          "...engine version, file count, timestamps"
}
```

---

### `verify` — Cross-Check Claims Against Real Code

Two hard gates run before any claim is checked:

- **HYPOTHESIS_GATE**: `hypotheses[]` must be present (proves Phase 3 wasn't skipped)
- **EVIDENCE_CITATION_GATE**: `rootCause` must contain `file:line` (proves it's grounded, not hallucinated)

```js
verify({
  rootCause:    "PaymentService.ts:47 — forEach(async) discards all Promises",
  codeLocation: "PaymentService.ts:47",
  evidence:     ["PaymentService.ts L47: processDuplicates.forEach(async (item) => charge(item))"],
  minimalFix:   "await Promise.all(processDuplicates.map(async item => charge(item)))",
  hypotheses:   ["H1: floating promise", "H2: race on shared state", "H3: dedup drops items"]
})
```

**On PASSED:** Pattern weights updated in `.unravel/patterns.json`. Diagnosis embedded and saved to `.unravel/diagnosis-archive.json` — the next similar bug hits a ⚡ semantic archive match instantly.

**On REJECTED:** Returns which specific claims failed and why.

---

### `build_map` — Build Knowledge Graph

Indexes a project's structure once. The graph persists to `.unravel/knowledge.json` and is reused on every subsequent call.

```js
build_map({ directory: "/repo" })                           // default: embed top-50 hub nodes
build_map({ directory: "/repo", embeddings: "all" })        // embed every node (slower, fuller coverage)
build_map({ directory: "/repo", embeddings: false })        // structural only, no API calls
build_map({ directory: "/repo", exclude: ["src/generated", "vendor"] })
```

**Incremental updates:** On rebuild, only changed files (by SHA-256 hash) are re-analyzed. ≤30% changed = fast patch. >30% changed = full rebuild.

---

### `query_graph` — Route Symptoms to Files

Finds the exact files relevant to a bug without reading the full codebase.

```js
query_graph({ symptom: "race condition in task store" })
// → { relevantFiles: ["taskStore.ts", "useSessionData.ts", ...] }
```

**With semantic search enabled:** Also searches the Task Codex for past debugging sessions matching this symptom. If found, injects a `pre_briefing` — the agent reads past discoveries *before* opening a single file.

```json
{
  "pre_briefing": {
    "note": "Prior session matched. Read these BEFORE opening files.",
    "entries": [{ "codex": "payment-001", "discoveries": "PaymentService.ts L47 — confirmed bug site..." }]
  },
  "relevantFiles": ["PaymentService.ts", "CartRouter.ts"]
}
```

---

### `query_visual` — Route Visual Bugs to Files

For screenshot-based bugs. Embeds the image in Gemini's cross-modal vector space and finds the code files most likely responsible.

```js
query_visual({ image: "/path/to/screenshot.png", symptom: "UI shows wrong user avatar" })
```

Requires: `GEMINI_API_KEY` + prior `build_map` with embeddings enabled.

---

### `consult` 

Unlike `analyze` (which needs a bug), `consult` takes any plain-language question and finds the structural truth. Used for architecture, data-flow analysis, and feasibility.

```js
consult({ query: "How does the auth middleware interact with the session store?" })

// Force specific context (The Scalpel)
consult({ query: "...", include: ["src/core"] })

// Adjust routing breadth (The Search)
consult({ query: "...", maxFiles: 20 })
```

**Response — The Source-Verified Intelligence Report:**
*   **§0 Project Overview**: Merged intelligence from Git context, JSDoc, and human-written docs.
*   **§1 Structural Scope**: Which files were routed/embedded vs left out.
*   **§2 AST Facts**: Deterministic mutation chains and async boundaries.
*   **§3 Cross-File Graph**: Call edges and symbol origins.
*   **§4 Memory**: Past codex and archive hits.
*   **§5 Reasoning Mandate**: Direct step-by-step synthesis instructions for the LLM.

---

## CLI — CI/CD & GitHub PR Integration

Unravel ships a CLI for integration into GitHub Actions, pre-commit hooks, and any CI pipeline.

```bash
# Basic analysis
node unravel-mcp/cli.js --directory ./src --symptom "race condition in auth flow"

# Output formats
node unravel-mcp/cli.js --directory ./src --symptom "..." --format text    # human-readable (default)
node unravel-mcp/cli.js --directory ./src --symptom "..." --format json    # machine-readable JSON
node unravel-mcp/cli.js --directory ./src --symptom "..." --format sarif   # GitHub PR annotations

# Write to file
node unravel-mcp/cli.js --directory ./src --symptom "..." --format sarif --output findings.sarif

# Tune critical threshold
node unravel-mcp/cli.js --directory ./src --symptom "..." --threshold 0.8
```

**Exit codes:**
- `0` — Clean. No critical findings
- `1` — **CRITICAL** — race condition or floating promise detected (or pattern weight ≥ threshold)
- `2` — Error (bad directory, parse failure)

**SARIF output for GitHub PR annotations:**

Unravel produces SARIF 2.1.0 — the format GitHub natively understands for PR code scanning.

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
      - name: Run Unravel
        run: |
          node unravel-mcp/cli.js \
            --directory ./src \
            --symptom "identify all race conditions and async issues" \
            --format sarif \
            --output findings.sarif
        continue-on-error: true          # don't block PR on exit 1, let SARIF do it
      - name: Upload SARIF
        uses: github/codeql-action/upload-sarif@v3
        with:
          sarif_file: findings.sarif
```

**What gets annotated in the PR:**

| Detector | SARIF Rule | Severity |
|---|---|---|
| Global variable written before `await` | `RACE_CONDITION` | `error` |
| `async` function called without `await` | `FLOATING_PROMISE` | `error` |
| Module-scope const captures mutable value | `STALE_MODULE_CAPTURE` | `warning` |
| Constructor captures external reference | `CONSTRUCTOR_CAPTURE` | `warning` |
| Array mutated inside `forEach` | `FOREACH_MUTATION` | `warning` |
| `addEventListener` without `removeEventListener` | `LISTENER_PARITY` | `warning` |

GitHub surfaces each finding inline on the diff line where the bug lives.

---

## The Task Codex — Institutional Memory

Every debugging session can be recorded as a **codex file** in `.unravel/codex/`. Future sessions on similar bugs get a `pre_briefing` in the `query_graph` response — the agent reads past discoveries before touching a single file.

```
.unravel/
  knowledge.json          ← Knowledge Graph (build_map output)
  patterns.json           ← Structural patterns (learned from verify PASSED)
  diagnosis-archive.json  ← Past diagnoses as 768-dim embeddings
  codex/
    codex-index.md        ← Master index of all task codexes
    codex-payment-001.md  ← One file per debugging task
    codex-auth-002.md
    codex-embeddings.json ← Semantic embeddings of codex entries
```

The agent writes to `.unravel/codex/` during a session. The format is a **detective's notebook** — not a wiki. Only what was relevant to THAT task: `BOUNDARY` (what to skip), `DECISION` (confirmed facts), `CONNECTION` (cross-file links), `CORRECTION` (prior findings that turned out wrong).

---

## Full Flow for a Large Repo

```
1. build_map(directory)              → indexes 500 files, 623 nodes, 2104 edges
2. query_graph(symptom)              → returns 12 relevant files + pre_briefing if past codex matches
3. read pre_briefing (agent reads past discoveries if present)
4. analyze(relevantFiles, symptom)   → AST evidence packet, pattern hints, archive hits
5. agent reasons (phases 3→8.5)      → generates hypotheses, eliminates, confirms fix
6. verify(diagnosis)                 → PASSED or REJECTED
   └── on PASSED: patterns.json updated, diagnosis-archive.json extended
```

---

## Output Schema Cheatsheet

```
analyze() returns:
  critical_signal._instructions      ← reading guide + phase reminders
  critical_signal.contextFormatted   ← AST evidence (mutations, races, timing)
  critical_signal.patternHints[]     ← matched patterns with confidence
  critical_signal.archiveHits[]      ← ⚡ past diagnoses at ≥75% cosine match
  cross_file_graph.callEdges[]       ← {caller, callee, file, line}
  cross_file_graph.symbolOrigins[]   ← who imports what from where
  metadata.engineVersion             ← "3.3"
  metadata.crossFileAnalysis         ← boolean

verify() returns:
  verdict                            ← "PASSED" | "REJECTED" | "PROTOCOL_VIOLATION"
  failures[]                         ← {claim, reason} for each failed check
  confidencePenalty                  ← total penalty applied
  gate                               ← which gate failed (if PROTOCOL_VIOLATION)
```

---

##  Acknowledgements & Prior Art

Unravel stands on the shoulders of the community’s collective effort in making code more understandable for machines. Special thanks to:

*   **[circle-ir](https://github.com/cogniumhq/circle-ir)** (Cognium) — For the multi-pass reliability and performance analysis concepts that inspired our supplementary analysis layer.
*   **[Understand-Anything](https://github.com/Lum1104/Understand-Anything)** — For early conceptual inspiration on how to map and navigate deep codebase structures semantically.

---

## 🤝 Built with AI Partnership

Unravel is a testament to the power of human-AI collaboration. While the core deterministic engine and architectural vision were driven by its creator, this project was developed, debugged, and documented through an intensive partnership with state-of-the-art AI coding agents.

This collaborative process wasn't just about writing code—it was a meta-experiment in using AI to build a tool that makes AI better. By leveraging AI to help architect the "Sandwich Protocol," Unravel stands as a model for how high-trust, deterministic software can be built in the age of agentic coding.

---

##  A Personal Note & Open Call

Unravel began as an ambitious experiment: **Could we build a debugging engine that doesn't just guess, but genuinely *knows*?**

As a student developer working on this project, I’ve poured everything into creating this deterministic "Sandwich Protocol"—but the road ahead is even more exciting. With the right tools and more rigorous testing, I believe Unravel can evolve into the ultimate Project Oracle for every developer.

Because I'm working with a limited budget and a huge vision, I would love to hear from anyone—developers, researchers, or companies—who is interested in the intersection of AST analysis and AI. Whether you've found a bug, have an architectural suggestion, or want to discuss the future of deterministic AI coding, my door is open.

**Let's build the future of zero-hallucination coding together.**

*   **Telegram:** [@TheEruditeSpartan108](https://t.me/TheEruditeSpartan108)
*   **Email:** [eruditespartan@gmail.com](mailto:eruditespartan@gmail.com)

---

##  License

Unravel is licensed under the **Business Source License 1.1 (BSL-1.1)**.
*   **Personal & Non-Commercial Use:** Completely free and open.
*   **Small Teams (< 3 devs):** Completely free.
*   **Commercial Use:** Terms apply for larger organizations.

See [LICENSE](LICENSE) for the full text.

