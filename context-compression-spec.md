# Context Compression for Unravel
## A Grounded Specification

**Status:** Pre-implementation hypothesis. Nothing here should be built until the weekend experiment validates the core claim.

---

## 1. Where This Came From

TurboQuant (Google Research, March 2026) compresses KV cache vectors in two stages. First, a random rotation is applied to each vector — this simplifies the geometry and makes angular distributions predictable, eliminating the need for expensive per-block normalization. Then PolarQuant converts the rotated vector into polar coordinates (radius + angles), using most of the compression budget on the main structure. Finally, QJL uses just 1 bit to store the residual error left over from PolarQuant — it does not delete the error, it stores it cheaply. The result: 6x memory reduction, 8x attention speedup, no accuracy loss — but only because it operates on floating point vectors inside the model, not on text.

The rotation step is what most summaries miss. Without it, angular distributions are irregular and the compression breaks. With it, the geometry becomes regular enough to compress efficiently. This matters for the analogy: the equivalent in a text system is **transforming representation before compressing**, not compressing raw text directly.

The question this document explores: does the *architectural instinct* behind TurboQuant — that not all dimensions of your data carry equal signal, and you should compress them differently — apply to text context in an agent system?

The honest answer after two independent reviews: **partially yes, in structured domains specifically.**

---

## 2. What Two Independent Reviews Confirmed

### Dead (do not pursue)

- **"World knowledge subtraction"** — the idea that you can cleanly identify what the model already knows and delete it. Models are fuzzy, distributed systems, not databases. Even "obvious" sentences can carry implicit scope, causal hints, or disambiguation that isn't visible on the surface.

- **"Zero semantic loss"** — graph compression silently drops when/why/edge case reasoning that natural language carries implicitly. `auth → JWT(ttl=24h) → redirect(login)` loses *why* the redirect happens. That missing why can break a diagnosis.

- **Clean taxonomic separation** — the WORLD/NOVEL/RELATIONAL/REDUNDANT buckets are a thinking tool, not a parsing algorithm. Real context is messier.

### Alive

- **Topology placement is real.** Beginning and end of context are high-attention zones. Middle is a dead zone. Placing decisive evidence near the end is a confirmed, low-cost gain.

- **Compression works in structured domains.** Code, ASTs, logs, dependency graphs carry explicit meaning with minimal reliance on linguistic glue. This is the best possible environment for the approach.

- **Relevance scoring as a heuristic.** Asking the model to rank context chunks by relevance is a useful proxy for importance. Not a verifier of sufficiency — a low-scored chunk can still prevent a wrong assumption — but a useful ranking signal.

### Narrowed But Surviving Core Principle

> Transmit the minimal sufficient proof state: preserve all structural facts, all active invariants, and all eliminations that constrain the answer. Compress everything else.

This is not a mathematical guarantee. It is an engineering principle that needs empirical validation in Unravel's specific domain before any code is written.

---

## 3. Why Unravel's Domain is the Right Environment

Unravel operates almost entirely on:

- TypeScript/JavaScript AST nodes
- Call chains and dependency graphs
- Error traces and stack frames
- Tool call outputs (structured JSON)
- File-level relationships

These are structured domains. Meaning is already explicit. The linguistic glue that makes compression risky in natural language tasks is minimal here.

The risks that killed the general theory — dropped causal context, missing edge cases, ambiguous scope — are lower in this domain because the context Unravel works with is already more graph-like than prose-like.

This does not mean compression is safe. It means it is *more testable* here than anywhere else.

---

## 4. The Core Hypothesis

**Formal statement:**

For structured codebase context (AST evidence, call chains, error traces, tool outputs), a prompt assembled using the following rules will produce answer quality equal to or better than naive truncation at the same token budget:

1. Preserve exact identifiers, function names, file paths, and error messages verbatim — never paraphrase these.
2. Preserve dependency chains and call sequences verbatim — never summarize these.
3. Compress or drop generic explanation of concepts the model demonstrably knows (what a Promise is, what async means, what null dereference means).
4. Place the most decisive evidence in the final 20% of the context, directly before the query.
5. Keep any sentence that carries implicit when/why/edge case reasoning, even if it looks like carrier signal.

**What this does not claim:**

- It does not claim zero semantic loss.
- It does not claim to work on natural language or open-ended tasks.
- It does not claim the gains are large — they could be 20% or 200%, unknown until tested.

---

## 5. The Weekend Experiment

Build nothing. Run this manually on 5 real Unravel cases first.

### Setup

Pick 5 existing Unravel debug cases where you have:
- The original context you sent
- The answer you got back
- A ground truth you can judge (you know what the actual bug was)

### Three Conditions Per Case

| Condition | What you send | Token count |
|---|---|---|
| A — Baseline | Your current raw context | Full |
| B — Naive truncation | First N tokens, cut at budget | Same as C |
| C — Structured compression | Manually compressed per the rules in section 4 | ~50-70% of A |

### How to Build Condition C (manually)

For each case, go through the original context sentence by sentence and assign it to a tier:

**Full tier — keep verbatim:**
- Contains a function name, file path, identifier, error message, or AST node
- Connects two specific codebase facts (X calls Y, Z throws when W)
- Is an ordered step in a sequence where position matters

**Residual tier — compress to one line:**
- Explains a general concept BUT includes a codebase-specific when/why/condition ("this fails only when the config flag is missing", "redirect occurs on token expiry not on invalid input")
- Looks like generic explanation but contains an implicit constraint you would miss if deleted

**Dropped — delete entirely:**
- Explains a general programming concept with no codebase-specific content (what a Promise is, what async means, what null dereference means, how JWT works in general)

Then reassemble: system instructions first, residual summaries in the middle, decisive structural evidence at the end immediately before the query.

### Scoring Sheet

Score each answer 1–5 on three dimensions:

| Dimension | What to look for |
|---|---|
| **Correctness** | Did it identify the right bug / right location? |
| **Specificity** | Did it reference actual codebase identifiers, not generic advice? |
| **No false assumptions** | Did it avoid claiming something wrong about the codebase? |

Record token count for each condition.

### What You're Looking For

**Primary test:** Does C score ≥ A on all three dimensions?

**Hard test:** Does C score ≥ B at the same token budget? This is the real bar. Naive truncation is the default fallback everyone uses. If structured compression doesn't beat dumb truncation, there's no case for building it.

**Minimum bar to proceed:** C ties or beats B on specificity and correctness in 4 out of 5 cases, at lower or equal token cost.

### What a Negative Result Tells You

If C loses to B: structured compression for codebase context doesn't beat dumb truncation. The linguistic glue you're dropping is doing more work than expected. Stop here, don't build the module, use the 5 cases as a benchmark suite for future context strategy evaluation.

If C beats A but loses to B at the same budget: compression helps but placement doesn't, or your compression is losing when/why context you need. Revisit rule 5 (preserve implicit reasoning) and try again.

---

## 6. If the Experiment Succeeds: What to Build

Build only after 4/5 cases pass the hard test. The module is small and surgical.

### Location in Unravel

`orchestrate.js` — context assembly pass, before the LLM call is made.

### Module: `context-compressor.js`

**Input:** Raw context array (each element is a context block with type and content)

**Output:** Assembled prompt string, token count

**Three functions:**

```
classifyBlock(block) → 'STRUCTURAL' | 'GENERIC' | 'RELATIONAL' | 'PROCEDURAL'
compressBlock(block, classification) → { full: string, residual: string | null }
assembleContext(blocks, query) → { prompt: string, residuals: map }
```

**The three-tier storage model (this is the core architectural fix from reading the actual paper):**

TurboQuant does not delete the residual error after PolarQuant — it stores it cheaply with 1 bit via QJL. The equivalent here is: **never delete a context block outright. Store it at one of three tiers.**

| Tier | What | When | Cost |
|---|---|---|---|
| **Invariant** | Verbatim, never dropped | Language-spec or framework-lifecycle rules the LLM is known to assume incorrectly. No codebase identifiers, but essential. Examples: `forEach does not await async callbacks (ECMAScript spec)`, `React: setState in useEffect runs after paint`, `Raft: a node cannot vote twice per term` | Full tokens |
| **Full** | Verbatim content | Identifiers, call chains, error traces, AST nodes, relational facts | Full tokens |
| **Residual** | 1-line summary preserving when/why/edge case | Generic explanation that carries implicit constraints | ~8-12 tokens |
| **Dropped** | Nothing | Truly generic concept explanation with no codebase-specific constraint and no invariant relevance | Zero |

The residual tier is what the previous version of this spec was missing. It is the direct analog to QJL. It prevents the silent semantic loss that both reviews flagged — the implicit when/why/edge case reasoning that looks like carrier signal but isn't. You compress it to one line rather than delete it.

**Classification rules (strict):**

- `INVARIANT` — language-spec or framework-lifecycle fact that the LLM is known to assume incorrectly → **Invariant tier** (keep verbatim, always, even if it looks like "generic explanation")
- `ELIMINATED` — a hypothesis or possibility that was ruled out by evidence ("no concurrent write detected on cartState", "config flag is always present in production") → **Residual tier minimum** (compress to 1 line, NEVER drop — eliminated context prevents the LLM retreading dead ground)
- `STRUCTURAL` — identifiers, file paths, function names, error messages, AST nodes → **Full tier**
- `RELATIONAL` — connects two specific codebase facts (X calls Y, Z throws when W) → **Full tier**
- `PROCEDURAL` — ordered steps where sequence matters → **Full tier, compress language only**
- `GENERIC` with constraint — explains a concept but includes a codebase-specific when/why/condition → **Residual tier** (compress to one line, keep the constraint)
- `GENERIC` pure — explains a general concept with no codebase-specific content and no invariant relevance → **Dropped**

**Assembly order (topology placement — live in `orchestrate.js` as of 2026-04-01):**

1. System instructions and trust boundary header (start — high attention zone)
2. Key constraints and query-relevant config (start)
3. PROCEDURAL chains (middle — order matters, survives dilution)
4. Residual summaries (middle — cheap, keeps implicit reasoning anchored)
5. Raw code files (middle — large, structural, survive dilution)
6. **INVARIANT facts** (end — never move these to middle)
7. **STRUCTURAL and RELATIONAL evidence / AST block** (end — high attention zone, decisive evidence)
8. Query restatement (very end)

> **Note:** Steps 6-8 are already live. `orchestrate.js` was reordered on 2026-04-01: `astBlock` (AST evidence) was moved from position 1 (top, buried) to position N-1 (directly before the symptom/query). Before this change, the entire AST evidence block was in the dead zone once files were appended. The full tier taxonomy (steps 1-5) is experiment-gated per §5.

**The correction pass (cheap, required):**

After assembling, make a fast call (low token limit) to a small/fast model:

> "Given only this context, can you identify where in the codebase [the bug / the issue] is? Answer yes or no and name the location."

If yes: send the compressed context to the main diagnosis call.

If no: **promote residuals to full for the failing region** — do not re-fetch from scratch. You already have the residual stored. Binary search: remove halves of the assembled context until you isolate which region caused the failure, then promote that region's residuals to full and re-verify. This is cheaper than re-fetching because the residual is already in memory, just compressed.

### What Not to Build

- Do not build an automatic classifier using another LLM call per block — too expensive per diagnosis run, defeats the token savings.
- Do not build graph compression (the `auth → JWT` notation) — it silently drops implicit reasoning and is not recoverable without another LLM call.
- Do not build a general-purpose compressor — this module is scoped to structured codebase context only.

---

## 7. Fit Into Unravel's Existing Architecture

### Where It Sits in the Sandwich

Unravel's sandwich architecture: deterministic AST evidence → LLM reasoning → claim verification.

The compressor sits at the boundary between AST evidence collection and LLM reasoning. It does not touch the AST engine or the verifier. It only affects what gets assembled into the prompt.

```
ast-engine-ts.js   →   [context-compressor.js]   →   orchestrate.js   →   verifier
     (evidence)              (assembly)                  (reasoning)        (checks)
```

### What Changes in orchestrate.js

One function call added to the context assembly step. The rest of orchestrate.js is untouched.

```javascript
// Before (current)
const prompt = assembleRawContext(evidence, query, config);

// After (with compressor)
const prompt = compressor.assembleContext(evidence, query, config);
// compressor internally: classify → tier (full/residual/drop) → order → correction pass → return
```

### Token Budget Implications

If the experiment shows even 40% token reduction per diagnosis run, at scale (YC demo, real user runs, extended agentic loops) this compounds significantly. It also directly enables longer codebases to fit within context windows that previously hit memory limits.

---

## 8. What This Is Not

This is not a solution to the general context problem in LLMs. That problem requires model-level changes (like TurboQuant itself) or architectural changes (like retrieval-augmented generation with better rankers).

This is a domain-specific, empirically-validated (if the experiment passes) context assembly strategy for structured codebase debugging. Scoped correctly, it is a real engineering improvement. Scoped incorrectly, it is a gimmick.

The experiment is the gate. Run it first.

---

## 9. Open Questions After the Experiment

If the experiment succeeds, these are the next honest unknowns:

1. **Does residual promotion actually recover the failures?** The correction pass assumes that promoting a 1-line residual to full restores the missing context. This may not hold if the residual itself was written too aggressively — if the 1-line summary dropped the specific constraint that mattered. The experiment will reveal how often this happens. If it's frequent, the residual writing rules need tightening, not the correction pass logic.

2. **Does the classification hold across different bug types?** The STRUCTURAL/GENERIC/RELATIONAL/PROCEDURAL taxonomy was designed around call-chain bugs. It may need adjustment for type errors, async race conditions, or configuration bugs.

3. **How do you detect INVARIANT blocks automatically?** The invariant tier is the hardest to classify without an LLM — a rule like "this sentence contains no identifiers but contradicts ECMAScript spec" requires knowing the spec. A practical heuristic: maintain a small curated list of known high-risk invariants per language (the forEach/async one, React useEffect timing, Raft quorum rules, Promise.all vs Promise.allSettled semantics) and exact-match against context blocks. This is bounded and auditable.

4. **What is the actual token reduction number?** The 50-70% estimate is a guess. The experiment will give you a real number for Unravel's specific context distribution.

5. **Does it generalize outside Unravel?** If it works well, the module is potentially extractable as `@eruditecoder/context-compress`. That question is worth asking only after it demonstrably works inside Unravel first.
