# The Context Problem — Standalone Plan
*Created: 2026-03-27 — Thinking in progress, not finalized*

---

## The Problem, Precisely Stated

An agent reading a large codebase faces a hard limit: by the time it finishes reading file 5, the structural decisions from file 1 are compressed into vague impressions — not citable facts. Each subsequent read degrades earlier reads. The context problem is not about file size. It's about **relevance decay** and **cross-file connection loss**.

The failure mode:
```
Read ast-engine-ts.js (3600 lines) → understand deeply
Read orchestrate.js (1938 lines)   → ast-engine-ts.js is now a blur
Read config.js (1349 lines)        → orchestrate.js is fading
Read index.js (1034 lines)         → only vague impressions of all 4 remain
Make edit requiring all 4          → introduces inconsistency
```

The root insight: **the agent is reading implementation when it needs interface.** What matters is not what each file contains but what it does, what invariants it holds, how it connects to other files, and what not to touch.

---

## The ONE Fix: Task Codex

A living document the agent writes **during** a task, capturing only what matters for that specific task — not a generic summary, not a full transcription, but a focused knowledge artifact scoped to the problem at hand.

### Why task-scoped and not full-codebase

A full-codebase codex for a 500-file project produces 5000 lines — same problem, different wrapper. Task-scoping solves this: the relevant surface area of any single task is almost always 3-6 files. A codex for those 6 files, scoped to this problem, is ~100-150 lines. That fits in context easily and remains useful even 10 files later.

---

## File Structure

```
.unravel/codex/
├── codex-index.md           ← master index: tags + one-liner per codex
├── codex-{taskId}.md        ← one per problem/task session
└── codex-{taskId}.md
```

**codex-index.md format:**
```markdown
| Task ID          | Problem                          | Tags                              | Date       |
|------------------|----------------------------------|-----------------------------------|------------|
| sys-instr-001    | System instructions underselling | mcp-protocol, hypothesis-pipeline | 2026-03-27 |
| detector-add-002 | Add new AST detector             | ast-engine, formatAnalysis        | 2026-03-XX |
```

---

## Per-Codex Structure (3 sections)

### 1. DISCOVERIES
*Written as the agent reads files. Not file summaries — what mattered for THIS task.*

**The fundamental rule: Codex is a detective's notebook, not a wiki.**

```
❌ WRONG: "L1–L300 handles parser setup and AST initialization"
✅ RIGHT: "I was looking for mutation detection → L1–L300 does NOT have it.
           collectLoopNodes() at L214 is preprocessing only, not detection.
           Detection likely starts after fnBodyMap is built. Check beyond L300."
```

The question every entry answers is: **"What did I find vs what I was looking for?"**
Not: "What does this section do in general?"

**The 4 valid entry types:**

| Type | Format | When to use |
|---|---|---|
| **BOUNDARY** | "This section does NOT do X — X happens at [place]" | When a section you read doesn't have what you need |
| **CORRECTION** | "Earlier assumption wrong — it's actually Y" | When reading more context disproves an earlier note |
| **DECISION** | "L[N] → specifically does X, NOT Y" | When you find the exact thing you were looking for |
| **CONNECTION** | "fnBodyMap here → likely used by [function] later" | Cross-file or cross-section linkage |

**Example entry (from ChatGPT's target format):**
```markdown
## ast-engine-ts.js
Discovery context: looking for mutation detection entry point

- L1–L82 → parser + AST setup
  → NOT relevant to mutation logic. Skip for any mutation task.

- L214 → collectLoopNodes(node)
  → ONLY collects loop bodies. Does NOT detect mutation.
  → CORRECTION: earlier assumption wrong — this is a preprocessing step, not detection.

- L248 → fnBodyMap initialized
  → CONNECTION candidate: likely used for cross-function lookup in detection phase.
  → Not confirmed yet.

- BOUNDARY: No mutation detection in L1–L300.
  → Detection happens AFTER collection phase. Scan beyond L300 or search fnBodyMap usage.

- NOT relevant to this task: imports, parser config, error handling (L1–L100)
```

Notice what's NOT there: no paragraph describing what the file does. Every line is a decision, correction, boundary, or connection — anchored to what the task was looking for.

### 2. EDIT LOG
*Chronological. Append-only. Never modify, only supersede.*

```markdown
## Edits (chronological)

1. **index.js:259** — Changed FILLING step from "Phase 1-8" to "11-phase structured pipeline"
   Reason: pipeline actually has 11 phases, not 8. Agents were told wrong count.

2. **index.js:260-261** — Added Phase 3 description (exactly 3 hypotheses, distinct mechanisms)
   Added Phase 3.5 description (expansion after Phase 4, closes permanently)
   Reason: Phase 3.5 was completely absent from all instructions. Agents never knew expansion existed.

3. **index.js:264** — Updated Phase 5.5 to include re-entry rule
   Reason: adversarial kill → re-enter Phase 3.5 (max 2 rounds) was in config.js but not in instructions.

4. **orchestrate.js:343-374** — Added pipelineReminder block to MCP_REASONING_PROTOCOL
   Added hardGates block to verifyCallInstructions
   Added hypotheses[] to requiredFields
   Reason: per-call _instructions were silent on Phase 3.5, 5.5 re-entry, and HYPOTHESIS_GATE.
```

Format rule: `**file:line** — what changed | Reason: why it was wrong before`

**Why the reason matters:** Future sessions reading the edit log need to know *why* something was changed, not just what changed. The "before" state is context for not reverting it accidentally.

### 3. META
*Problem statement + tags. Written at task start, updated at end.*

```markdown
## Meta

**Problem:** MCP system instructions (both static server description and per-call _instructions)
undersold the 11-phase pipeline. Phase 3.5 (Hypothesis Expansion) was completely absent.
Phase 5.5 (Adversarial Confirmation) missing re-entry rule. hypotheses[] not listed
as required field in verify. No mention of ⛔ annotation authority.

**Tags:** mcp-protocol, system-instructions, hypothesis-pipeline, verify-gates, phase-3.5, adversarial

**Files touched:** unravel-mcp/index.js, unravel-v3/src/core/orchestrate.js
**Files read, not edited:** unravel-v3/src/core/ast-engine-ts.js, unravel-v3/src/core/config.js

**Invariants confirmed:**
- config.js:186 is the single source of truth for hypothesis count (exactly 3)
- config.js:214 is Phase 3.5 definition — must match index.js and orchestrate.js
- orchestrate.js:343 (MCP_REASONING_PROTOCOL) must stay in sync with index.js:253 (static description)

**Superseded entries:** none
```

---

## Agent Workflow

### Beginning of a task
```
1. Check codex-index.md for tags matching the new task
2. If match found → read that codex BEFORE reading any raw files
   → Start with DISCOVERIES (known connections, danger zones)
   → Read EDIT LOG (what was touched, why)
   → Go directly to relevant files at specific lines
3. If no match → start new codex-{taskId}.md, write META section
```

### During a task
```
After reading each file:
  → Append DISCOVERIES for that file (within 5-10 minutes of reading it, while hot)
  → Write cross-file connections immediately when found
  → Tag irrelevant sections explicitly

After each edit:
  → Append one entry to EDIT LOG
  → Update META if invariants are newly discovered
```

### End of a task
```
  → Complete META section
  → Add entry to codex-index.md
  → If any discovery supersedes a previous codex → add SUPERSEDES note
```

---

## Integration with KG and Embeddings

This is where Task Codex connects to the broader Phase 5 plan:

```
build_map(directory)
  └── Scan .unravel/codex/ for existing codexes
       → For each codex discovery tagged to a file in this KG:
           attach as metadata on the KG node
       → File node for orchestrate.js now carries:
           "Task sys-instr-001: MCP_REASONING_PROTOCOL at L343"
           "Task sys-instr-001: DANGER — must stay in sync with index.js:253"

query_graph(symptom)
  ├── Lexical + semantic (embedding) expansion → ranked files
  └── Tag search in codex-index.md
       → If match: return matching codex as pre_briefing field in response
       → Agent reads codex first, goes directly to right file + line
```

**With embeddings (Phase 5a/5b):**
- Each DISCOVERY bullet is a candidate for embedding
- Cosine similarity can find relevant past discoveries even when tags don't exactly match
- "Something about the instructions being wrong" → matches sys-instr-001 by semantic similarity

---

## The Cross-Codex Problem (Staleness)

A discovery that was true in March may be wrong in April after a refactor.

**Solution: SUPERSEDES links**

```markdown
## Supersedes

SUPERSEDES: codex-sys-instr-001, Discovery #2 in orchestrate.js
  Was: "MCP_REASONING_PROTOCOL previously only had groundTruth + verifyCallInstructions"
  Now: also has pipelineReminder + hardGates (added in this task, see Edit #4)
  As of: 2026-03-27
```

Any session reading codex-sys-instr-001 after this should see the SUPERSEDES note and know to check the newer codex.

---

## What NOT to Build

| Idea | Why not |
|---|---|
| Auto-generate codex via LLM | Defeats purpose — generic summaries, not task-scoped discoveries |
| Full-codebase codex | Same context problem, different wrapper. Task-scope is the key |
| Store codex in knowledge.json | Keep separate — codex is human+agent readable, KG is graph traversal data |
| Codex for every file read | Too much noise. Only write what connects to the task goal |
| Version control codex with git | Unnecessary — SUPERSEDES + date is enough traceability |

---

## Status

🟡 **Design phase** — architecture settled, implementation not started

**Open questions:**
1. What triggers a new codex vs appending to an existing one? (same ongoing task = append; new session = new codex)
2. Should the agent assistant (me) be writing codex as a habit now, even before the infra is built? **Yes — the workflow works without tooling. Just write the file.**
3. When does codex-index.md get stale? Need a periodic "prune old codexes after N months" rule.

---

## Immediate Next Action

Start writing the codex for today's task (sys-instr-001) manually.
This validates the format and creates the first real entry.
Infrastructure (codex-index search in query_graph, KG node attachment) comes in Phase 5c.

---

## Format Specification — The Target Codex Entry

### The fundamental rule

Codex is a **detective's notebook, not a wiki.**

```
❌ WRONG: "L1–L300 handles parser setup and AST initialization"
   This is a description. It tells future-you nothing actionable.

✅ RIGHT: "I was looking for mutation detection. L1–L300 does NOT have it.
           collectLoopNodes() at L214 is preprocessing only, not detection.
           fnBodyMap initialized at L248 — likely the cross-function lookup hook.
           Detection starts AFTER collection. Scan beyond L300."
   This is a decision + boundary + connection. It tells future-you exactly
   what was confirmed, what was ruled out, and where to look next.
```

**The question every entry answers:** *"What did I find vs what I was looking for?"*
Not: *"What does this section do in general?"*

---

### The 4 valid entry types

| Type | Marker | When to write |
|---|---|---|
| **BOUNDARY** | `→ NOT here. X happens at [place]` | When a section doesn't have what you need — ruling out is as valuable as finding |
| **CORRECTION** | `→ CORRECTION: earlier assumption wrong` | When reading more context disproves a note you already wrote |
| **DECISION** | `→ L[N] specifically does X, NOT Y` | When you find exactly what you were looking for — pin the line |
| **CONNECTION** | `→ CONNECTION: links to [file/fn] because...` | Cross-file or cross-section dependency, confirmed or suspected |

---

### Full example — the target format

```markdown
## ast-engine-ts.js
Discovery context: looking for mutation detection entry point

- L1–L82 → parser + AST setup
  → BOUNDARY: NOT relevant to mutation logic. Skip for any mutation task.

- L214 → collectLoopNodes(node)
  → DECISION: ONLY collects loop bodies. Does NOT detect mutation.
  → CORRECTION: earlier assumption wrong — this is preprocessing, not detection.

- L248 → fnBodyMap initialized here
  → CONNECTION: likely used for cross-function lookup in detection phase.
  → Not confirmed yet. Need to trace fnBodyMap usage.

- BOUNDARY: No mutation detection found in L1–L300.
  → Detection happens AFTER collection phase.
  → Next step: scan L300+ or search for `fnBodyMap` usage across file.

- NOT relevant to this task: imports, parser config, error handling (L1–L100)
```

Notice what's absent: no paragraph explaining the file's purpose, no summary of
what tree-sitter does, no description of the class structure. Every line is one of
the 4 types: decision, correction, boundary, connection. Each is anchored to the task goal.

---

### Two-phase writing model

**Phase 1 — During the task (write like a lab notebook):**
- Append-only. Don't organize. Don't clean up.
- Write immediately after each read, before moving to the next file.
- Use `?` markers freely: `? unclear if this is the right path — need to check...`
- Capture corrections the moment you realize you were wrong.
- Write the EDIT LOG entry immediately after each edit — not at the end.

**Phase 2 — At task end (~5 minutes, once):**
- Restructure into layered format: TLDR → DISCOVERIES → EDIT LOG → META
- Collapse the lab notebook notes into the 4 entry types
- Write TLDR last — it's a 3-line summary that future-you can read in 10 seconds
- Add mandatory Layer 4: what files/sections to SKIP for this class of task

**Why two phases:**
- Writing during the task is cheap if it's append-only (no organization pressure)
- Reading the codex next time is cheap if it's layered (TLDR may be enough)
- The reorganization at end is ~5 minutes and happens once — future sessions pay zero

---

### Layered output format (end-of-task restructure)

```markdown
## TLDR
[3 lines max. What was wrong, what was fixed, where the source of truth lives.]

## LAYER 1 — What each file does (re: this task only)
[One paragraph per file. Role in this task. What it handles, what it doesn't.]

## LAYER 2 — Edits made (chronological)
[Edit log. file:line — what changed | Reason: why it was wrong before]

## LAYER 3 — Cross-file connections and risks
[The sync and dependency relationships discovered. Danger zones.]

## LAYER 4 — What to skip next time
[Files/sections read but irrelevant. The most underrated section.
 "ast-engine-ts.js: 3600 lines read, zero useful facts for instructions tasks. Skip."]
```

Layer 4 is mandatory. A discovery that a file is irrelevant is worth more than most positive discoveries — it's guaranteed saved reading time for every future session of this type.

---

## Discovery Quality and Reliability (Critique Responses)

### Problem: wrong discoveries get embedded and amplified

A discovery written while misunderstanding a function gets embedded into the KG
and returned as a "briefing" in future sessions — amplifying the original mistake.

**Three mechanisms to prevent this:**

**1. Confirmation counter (most important)**
```
Each discovery bullet gets implicit metadata:
  confirmations: 0       ← incremented when re-used in a PASSING task
  failedUses: 0          ← incremented when re-used in a FAILING task
  status: active         ← active | unreliable (3+ failed uses) | superseded
```
After 3 failed uses: auto-tag as `⚠ UNRELIABLE — verify before trusting`.
After 2+ successful uses: tag as `✅ CONFIRMED` — high trust.

**2. File hash staleness**
Each discovery is tagged with the SHA-256 hash of the file content at time of writing.
`build_map` already computes these hashes (from incremental rebuild). When a file changes:
- Discovery is auto-tagged `⚠ FILE CHANGED SINCE DISCOVERY — verify before trusting`
- Agent checks the actual lines before relying on the discovery
Cost: zero — hashes already exist. Just store them alongside discoveries.

**3. Verify-on-use, not trust-and-use**
Codex tells you WHERE to look, not WHAT is true.
Agent always verifies a specific discovery by checking the actual line before citing it.
Same principle as Unravel's [verify](file:///C:/Users/mukti/Desktop/UnravelAI/unravel-v3/src/core/orchestrate.js#1267-1786) tool: accelerate, don't substitute.

---

### Problem: fragmentation across 40+ codexes

SUPERSEDES handles local corrections. For global consolidation:

**Periodic merge pass** (triggered when codex count for a file exceeds 5):
```
consolidate(orchestrate.js) → reads all codexes that mention this file
  → extracts decision/correction/boundary/connection entries
  → collapses: earlier entries superseded by later corrections are dropped
  → produces: consolidated.orchestrate.js.md with confirmations aggregated
  → marks source codexes as "consolidated into consolidated.X"
```
This IS a valid LLM use: aggregating validated entries, not creating new knowledge.
The consolidation never invents discoveries — it only merges what's confirmed.

---

### Updated "What NOT to Build"

| Idea | Verdict | Why |
|---|---|---|
| Auto-generate DISCOVERIES via LLM | ❌ Never | Generic, unvalidated — defeats purpose |
| Auto-scaffold META + template | ✅ Do it | Structure is free; discoveries must be earned |
| Auto-consolidate confirmed entries | ✅ Do it (Phase 5c+) | Aggregating validated knowledge is safe |
| Full-codebase codex | ❌ Never | Task-scope is the whole point |
| Store codex in knowledge.json | ❌ Never | Keep human+agent readable, separate from graph |
| Version-control codex with git | ⚠ Optional | SUPERSEDES + date is enough; git is overkill |
| Codex for every file read | ❌ Never | Only write what connects to the task goal |

---

## Status

🟡 **Design phase** — architecture settled, implementation not started

**Open questions:**
1. What triggers a new codex vs appending to an existing one? (same ongoing task = append; new session = new codex)
2. Should the agent write codex now, before the infra is built? **Yes — the workflow works without tooling. Just write the file.**
3. When does codex-index.md get stale? Periodic prune after N months or after consolidation.
4. Confirmation counter: tracked in-file (metadata frontmatter) or in knowledge.json?
   → In-file is more portable. knowledge.json is more queryable. Decision pending.
