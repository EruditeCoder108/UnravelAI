# Consult V2 — From Evidence Assembler to Project Oracle

## The Gap: What Consult Is vs What It Should Be

### Today: Evidence Assembler (v1)
```
User query → KG routing → AST parse → cross-file graph → format as §0-§4 → JSON blob → hope the LLM reasons well
```

The LLM gets a structured evidence packet and §4 instructions that say "synthesize your answer from this evidence." But the LLM is flying blind — it has:
- AST facts about 4-12 files (low-level mutation chains, timing nodes)
- A flat cross-file call graph
- Pattern signals (confidence %)
- Codex/archive hits (if any exist)

**What it does NOT have:**
1. **Project-level mental model** — what this project IS, how it's architectured, what the goals are
2. **File-level summaries** — what each file DOES (not just what functions it exports)
3. **Deep reasoning mandate** — the instructions say "answer directly and concisely" which encourages surface-level responses
4. **Self-awareness of gaps** — no mechanism to say "I need more files" or "this answer requires information I don't have"
5. **Task Codex integration** — the detective's notebook exists in concept but isn't wired into consult's evidence

### Tomorrow: Project Oracle (v2)
```
User query
  → §0 PROJECT OVERVIEW (the senior dev's mental model — built progressively)
  → §1 STRUCTURAL CONTEXT (KG topology + file summaries — what each file does)
  → §2 TARGETED AST (deep analysis of routed files — mutations, races, closures)
  → §3 SOURCE EVIDENCE (§1.5 snippets — actual code at critical sites)
  → §4 CROSS-FILE GRAPH (call chains, symbol origins)
  → §5 MEMORY (codex discoveries, archive fixes, pattern signals)
  → §6 REASONING MANDATE (think hard, be thorough, identify gaps)
```

---

## The Two-Layer Context Model

### Layer 1: Project Overview (the Senior Dev's Brain)
*"He might not know exactly what line does what in which file, but he knows that these things exist, these ones are critical, how the overall flow works, what the goals of the project are."*

This is a **living document** stored at `.unravel/project-overview.md`. It's NOT auto-generated from AST. It's built progressively:

**Cold start (auto-generated on first `build_map` or `consult`):**
```markdown
## Project: UnravelAI (auto-generated — needs human refinement)

### Architecture Overview
- 2710-line MCP server (index.js) — tool definitions, session state, KG management
- Core engine (unravel-v3/src/core/) — AST analysis, orchestration, verification
- Embedding layer (embedding.js) — Gemini API, KG embeddings, archive search
- VSCode extension (unravel-vscode/) — editor integration

### Key Files (by connectivity)
  index.js — 13 edges, hub of all MCP tool handlers
  embedding.js — 18 edges, all semantic operations
  orchestrate.js — main diagnostic pipeline
  ast-engine-ts.js — 10 detectors, tree-sitter parsing

### Critical Paths
  analyze → orchestrate → AST → cross-file → format → verify
  consult → KG route → AST → snippet extract → evidence packet
  build_map → readFiles → structural analysis → GraphBuilder → embed → save

### Known Patterns (from pattern store)
  - race_condition_write_await_read (95%) — active in index.js async handlers
  - global_write_race (90%) — module-level state in index.js
```

**Progressive enrichment:** Every `analyze → verify(PASSED)` session adds to this. Every `consult` session can append discoveries. Over time it becomes the senior dev's actual mental model — not a generic summary, but a map of what matters.

**Key insight:** This is NOT the codex. The codex is task-scoped. The project overview is project-scoped. They complement each other:
- Project overview: "index.js is the MCP hub, has 20+ async handlers with global state"
- Codex entry: "Task sys-instr-001: The MCP_REASONING_PROTOCOL at orchestrate.js:343 MUST stay in sync with index.js:253"

### Layer 2: Targeted Deep Context (the Hot Path)
For a specific question, the KG routes to 4-12 files. These get full AST treatment. This is what consult v1 already does — but v2 enhances it:

1. **File summaries injected before AST facts** — "This file handles X. Key functions: Y, Z. It depends on A, B."
2. **AST facts scoped to relevance** — not all 600 mutation chains, but the ones that relate to the query
3. **Source snippets for every cited line** (§1.5 already does this for critical sites, expand to any cited line)

---

## The Reasoning Mandate

### The Problem with "Answer directly and concisely"
Current §4 instructions say: *"Answer the query directly and concisely — lead with the answer, then support it with evidence."*

This is wrong for a project oracle. A brief answer is fine for "what does function X do?" but terrible for:
- "Is it safe to refactor the session state?"
- "What would break if I removed the staleness check?"
- "How does data flow from user request to final response?"

### The Fix: Tiered Reasoning Depth

```
REASONING MANDATE:
  For FACTUAL queries ("what does X do?", "where is Y defined?"):
    → Answer directly. Cite file:line. Be brief.

  For ANALYTICAL queries ("how does data flow?", "what are the risks?"):
    → Think step by step through the evidence.
    → Trace the full chain through the cross-file graph.
    → Identify what the evidence DOES and DOES NOT cover.
    → State assumptions explicitly.

  For FEASIBILITY queries ("can I add X?", "what would break?"):
    → Map every file that would need to change.
    → Identify invariants from the AST that must not break.
    → Assess based on structural complexity, not opinion.
    → Report: CAN DO / CANNOT DO / CAVEATS + constraints.

  For ALL queries:
    → If the routed files are insufficient, say so: "The KG routed to [N] files
       but this question likely requires [additional files]. Consider re-running
       with include: [suggestions]."
    → NEVER hallucinate structure that isn't in the evidence.
    → When uncertain, say "Based on the [N] files analyzed..." not "The project does X."
```

---

## The Project Overview Auto-Build

### What triggers it?
1. **First `build_map`** — generates a skeletal overview from KG topology
2. **First `consult`** on a project with no overview — same
3. **Each `verify(PASSED)`** — appends the root cause + fix as a "known issue resolved"
4. **Manual enrichment** — user can edit `.unravel/project-overview.md` directly

### What goes in it?
```
## Architecture Overview
  [Auto: from KG hub nodes and edge patterns]
  [Manual: project goals, design philosophy]

## File Map (what each file does, what it doesn't)
  [Auto: from KG node summaries + function names]
  [Enriched: by codex discoveries over time]

## Critical Paths (how requests flow through the system)
  [Auto: from cross-file call graph edges]
  [Enriched: by tracing done in consult/analyze sessions]

## Known Issues and Patterns
  [Auto: from pattern store matches]
  [Enriched: from verify(PASSED) diagnoses]

## Invariants (what must not break)
  [Manual: discovered during debugging, codified here]
  [Example: "config.js:186 is the single source of truth for hypothesis count"]
```

### How consult uses it
The project overview is injected as **§0 PROJECT OVERVIEW** — BEFORE the KG topology, before AST, before everything. It gives the LLM the senior dev's mental model so it can interpret the low-level evidence in context.

Without it: "orchestrate is written at L93, await at L97" → LLM has no idea what orchestrate does

With it: "orchestrate.js is the main diagnostic pipeline (11-phase). orchestrate is imported at L93 via dynamic import in the MCP server boot sequence." → LLM understands the race is in the boot loader, not in a request handler

---

## What Changes in the Evidence Packet

### Current (v1)
```
§0 PROJECT STRUCTURE — KG topology (flat node/edge counts)
§1 AST FACTS — raw mutation chains, timing, closures
§1.5 SOURCE SNIPPETS — code at critical sites
§2 CROSS-FILE GRAPH — call graph + symbol origins
§3 MEMORY — codex, archive, patterns
§4 INSTRUCTIONS — synthesis rules
```

### Proposed (v2)
```
§0 PROJECT OVERVIEW — senior dev mental model (architecture, goals, critical paths)
§1 STRUCTURAL CONTEXT — KG topology + file summaries for routed files
§2 AST FACTS — scoped to query relevance, with inline source
§3 CROSS-FILE GRAPH — call chains with direction annotations
§4 MEMORY — codex discoveries, archive fixes, pattern signals  
§5 REASONING MANDATE — tiered by query type, with gap detection
```

**Key differences:**
1. §0 is no longer raw topology — it's the human-readable project brain
2. File summaries appear BEFORE AST facts (context before detail)
3. AST facts are scoped to relevance (not all 600 chains)
4. §5 replaces the weak "answer directly" instruction with tiered reasoning

---

## Implementation Priority

### Phase 1: Fix the bugs (30 min)
- Cross-directory session state invalidation (Bug 1 + 2)
- Track `session._graphRoot` for KG/files cache

### Phase 2: Project Overview (.unravel/project-overview.md) (2-3 hours)
- Auto-generate from KG topology on first build
- Inject as §0 in consult evidence packet
- Design the progressive enrichment hooks

### Phase 3: Reasoning Mandate (1 hour)
- Replace §4 with tiered reasoning instructions
- Add gap detection ("evidence doesn't cover X")
- Add scope suggestions ("consider include: [X, Y]")

### Phase 4: File Summaries (2 hours)
- Generate per-file summaries from KG + AST function lists
- Inject between §0 and §2 as "what each routed file does"
- Cache in KG nodes for reuse

### Phase 5: Codex Integration (deferred — architecture exists, wiring needed)
- Wire task codex discoveries into §4 memory
- Auto-attach codex hints to KG nodes during build_map
- Semantic search across codex entries

---

## The Competitive Moat

A normal LLM pointed at a project: reads files, loses context, hallucinates connections.

Consult v2:
- **KG** gives it the right files (semantic routing = no wasted context)
- **Project Overview** gives it the senior dev's brain (architecture understanding)
- **AST** gives it verified structural facts (no hallucination possible)
- **Cross-file graph** gives it actual call chains (not guessed connections)
- **Codex** gives it past debugging discoveries (institutional memory)
- **Archive** gives it proven fixes (what worked before)
- **Patterns** give it statistical signals (what bugs look like in this codebase)
- **Source snippets** give it actual code (not line-number guessing)
- **Reasoning mandate** makes it think deeply (not answer superficially)

That's 9 intelligence layers firing simultaneously. No other tool does this.
