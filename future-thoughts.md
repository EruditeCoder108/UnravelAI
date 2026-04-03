# Unravel — Future Thoughts (stale)

Ideas, directions, and strategic context distilled from brainstorming sessions. Kept here as reference — not a roadmap, not a commitment. Things worth returning to at the right time.

---

## 1. Reasoning Integrity — The Most Important Idea Here

**The core insight**: Unravel currently verifies the *answer*. Nobody verifies the *reasoning path*.

There are three distinct failure modes in LLM debugging, and current tools — including Unravel — treat them identically:

| Type | Description | Currently caught? |
|---|---|---|
| Type 1 | Wrong answer, fabricated evidence | ✅ Claim verifier |
| Type 2 | Right answer, fabricated reasoning | ❌ Not caught anywhere |
| Type 3 | Mostly-correct reasoning, one unjustified leap at the end | ❌ Not caught anywhere |

Type 2 is the dangerous one. The fix works, you trust the diagnosis, and you have no idea the reasoning was confabulated. The next similar bug comes and the model reasons the same wrong way, this time getting unlucky.

**What to build**: A *Reasoning Auditor* — Phase 5.6 in the pipeline. For each hypothesis elimination, extract the factual claim the model makes (`"tick() gets fresh remaining"`), then check it against the AST ground truth deterministically.

- If the claim is verifiable and true → `evidenceVerified: true`
- If the claim is verifiable and false → reasoning fabrication — flag it even if the conclusion is right
- If the claim is too vague to evaluate → `evidenceVerified: 'unverifiable'`

**The new metric this creates**: *Reasoning Integrity* — what percentage of elimination steps were grounded in verifiable AST facts.

This lets you say: "Gemini 2.5 Flash — RCA 100%, Reasoning Integrity 78%." That's a more honest and useful characterization of model reliability than accuracy alone. No tool currently measures this.

**Adversarial extension**: For each elimination, automatically generate the strongest counter-argument and check whether it holds in the AST. The model says "tick() gets fresh remaining" — the counter is "remaining is captured at closure initialization, not read from current scope." The AST can check this. If the counter holds, the elimination is flagged as contested even if the model stated it confidently. This is automated devil's advocacy applied to the model's own reasoning.

**Why this is a research contribution**: The paper writes itself. *"Reasoning Integrity as a metric for LLM debugging reliability — distinguishing correct answers from correctly-reasoned answers using deterministic static analysis verification."* Nobody has measured this. Unravel has the AST ground truth that makes it possible.

---

## 2. Reasoning Bias Profiles Per Model

Over many UDB-50 runs, systematic patterns emerge in how specific models reason incorrectly.

Example: Gemini Flash may consistently over-eliminate stale closure hypotheses when it sees any "fresh value" evidence — missing the case where the closure was captured at initialization, before the fresh read.

Accumulate enough runs and you can build a *reasoning bias profile per model*. Then when running, Unravel can apply known corrections: "Flash has a documented tendency to over-eliminate H-type hypotheses on fresh-value evidence — apply extra scrutiny here."

This is not fine-tuning, not RAG. It's meta-reasoning — calibrating against known model failure modes in real time. It deepens as a moat with every run.

---

## 3. Gemini Embedding 2 — Five Concrete Use Cases

The multimodal capability is irrelevant for Unravel. The useful properties are 8192-token context, MRL (adjustable dimension size), and text-only pricing at $0.20/M tokens.

**Ranked by impact**:

1. **Symptom → known bug similarity** (highest, immediate). Before calling the LLM, embed the user's symptom and run cosine similarity against all UDB-50 bug symptoms. Inject the top 3 most similar confirmed bugs as grounding context into the prompt. The LLM now reasons anchored to verified prior cases instead of pattern-matching blind. No vector DB needed for 50 bugs — pure array cosine similarity in JS.

2. **Confidence calibration via response consistency**. Run the same bug 3 times at temperature 0.3, embed all 3 `rootCause` fields, measure cosine similarity. Tight cluster → model is confident. Wide scatter → model is guessing → confidence score should drop. This is black-box uncertainty quantification — works with any provider, no API internals needed.

3. **Hypothesis deduplication**. During hypothesis generation, embed each hypothesis. If two have cosine similarity > 0.92, they're the same idea rephrased — collapse them before Phase 4. Prevents the model from arguing with itself over semantically identical candidates.

4. **Evidence claim semantic verification**. Embed each AI-produced evidence claim, check cosine similarity against embeddings of the actual code lines it references. If the claim embeds far from any real code line, flag it as potentially fabricated — a semantic grounding check layered on top of the existing syntactic one.

5. **Benchmark blind spot detection** (internal tool only). Embed all 51 UDB-50 symptoms and cluster them. Reveals whether the benchmark over-represents one bug category. Ten semantically identical bugs give inflated confidence in one type.

---

## 4. Explain Why Other Tools Would Have Failed

For every correct diagnosis, Unravel already knows which AST facts were essential to the right answer. It could identify which of those facts would have been invisible to a semantic-only tool — and say so explicitly.

> *"Without the mutation chain data, this bug presents as a stale closure. Three AI tools consistently make that mistake. The AST fact that `duration` is read by four other functions after being mutated in `pause()` is what eliminates that hypothesis — it's not discoverable by semantic similarity alone."*

This is not marketing copy. It's a verifiable, specific claim. It turns every correct diagnosis into a live demonstration of why the architecture exists. The benchmark narrative writes itself automatically.

---

## 5. Runtime Execution — Where and When It Makes Sense

Adding terminal execution to answer the question "which branch actually runs" is the one narrow case where dynamic data genuinely helps static analysis.

The right implementation is **WebContainers integration** (already on the roadmap): run reproduction steps in an in-browser sandboxed Node environment, capture actual variable values at the crash site, inject those as additional ground truth alongside AST facts. Not a terminal agent — a structured execution trace piped into the existing pipeline.

This gives: *"AST says this mutation could cause the bug. Runtime confirms `count` was 0 at the crash site."* That turns a "likely" diagnosis into a "confirmed" one.

Scope: Phase 6 territory, after UDB-50 and the reasoning verifier.

---

## 6. Codebase-Specific Confidence Calibration

Confidence as input, not just output.

When a fix is confirmed working, that outcome feeds back into how confidently the engine reasons about similar patterns in the same codebase. Not a global pattern database — a per-session calibration: "In this codebase, closure capture analysis has been accurate; React hook analysis produced one false positive in the previous run."

That's personalization no other tool has. Not fine-tuning. Codebase-specific epistemic calibration.

---

## 7. Observability — Instrument the Pipeline

Right now there's no visibility into where in the 9-phase pipeline bugs get missed.

**Opik** (Comet-ML, 17.7k stars, open source) and **Langfuse** (YC-backed, more mature) both provide LLM pipeline tracing with full input/output logging, timing, and token counts per phase. A flame graph of Unravel's own internals is directly useful for debugging the debugger.

Worth integrating after UDB-50 — the benchmark runs will be meaningful to trace.

---

## 8. External Validation and Publication

**arXiv first, everything else second.** An arXiv preprint gives the work a citable URL. A PDF emailed cold does not. Submit under `cs.SE` (Software Engineering). List affiliation as "Independent Researcher" or the college name — both are common and neither hurts the paper.

**File KAPILA provisional patent before the arXiv submission.** In India's system, public disclosure before filing can invalidate the patent. The Reddit posts are informal enough to be safe, but a published paper counts as prior art disclosure. File provisional → then post arXiv.

**HN posting window from IST**: Tuesday–Thursday, **7:30–10:30 PM IST**. Have everything written in advance. Spend the first 2 hours responding to every comment — that engagement window determines whether the post reaches the front page.

**Paper title direction**: Not "Future of Antigravity" — that reads as a pitch deck. The technical audience needs something like: *"Deterministic Pre-Analysis as a Missing Layer in Agentic IDEs: Empirical Results from UDB-50."*

**The Antigravity channel**: Google Developer Groups (GDG) — active chapters in Jabalpur, Bhopal, Indore — are more direct than cold email. GDG leads have lines to Google DevRel India. Demo Unravel at one meetup. The `#built-with-gemini` channel on the Google Developer Discord is also monitored by the Antigravity DevRel team.

---

## 9. The Moat Against Long-Context Models

The real competitive threat to Unravel is not embeddings + retrieval — it's long-context frontier models (Gemini 2.5 Pro at 1M tokens, Claude Opus). For small-to-medium repos, just dumping everything into a 1M-context window works reasonably well without infrastructure.

Where Unravel's moat actually sits:

- **Hypothesis elimination, not just generation.** A raw LLM still does symptom-chasing — it sees a familiar pattern and latches on. Unravel forces elimination, which is why it found bugs Opus missed with thinking mode enabled.
- **AST facts are ground truth injection.** You don't ask the LLM to infer that `duration` gets overwritten — you prove it deterministically. The model can't confabulate over a verified fact.
- **Anti-sycophancy guardrails.** When the user's symptom description is wrong or misleading, a raw LLM follows the user's framing down the wrong path. Unravel explicitly resists this.
- **Cost at scale.** 500k tokens through Opus per debug call ≈ $5–15. Unravel selects 10 relevant files via graph router, injects compact AST facts — prompt stays lean and cheap regardless of repo size.

Embeddings + LLM is what everyone else already does. Unravel is the layer that makes the LLM structurally not wrong on the hard cases.

---

## Execution Order

| Idea | When | Effort |
|---|---|---|
| UDB-50 + benchmark | Now (after exams) | Required for everything else |
| Reasoning Auditor (Phase 5.6) | After UDB-50 | 1–2 weeks |
| Symptom similarity via embeddings | After UDB-50 | Few hours, uses existing Gemini key |
| Confidence calibration (UQLM-style) | After UDB-50 | 1–2 days |
| arXiv + HN + KAPILA filing | After UDB-50 numbers | Sequential, coordinated |
| Opik/Langfuse pipeline tracing | During UDB-50 runs | Useful immediately |
| WebContainers runtime execution | Phase 6 | After the verifier work |
| Reasoning bias profiles per model | Long-term | Emerges from production data |

The sequencing is always the same: **UDB-50 first.** Everything that follows from it gets numbers behind it, and numbers are what make the rest of it matter.

---

## 10. The Integrated Vision — Where Unravel Stands When Everything Is Built

*Session: March 2026. This section synthesises the Understand-Anything integration discovery, the enterprise angle, and all roadmap items into a single coherent picture.*

### The Full Stack, Assembled

| Layer | What it does | Status |
|---|---|---|
| **Layer 0 — Deterministic Ground Truth** | Tree-sitter AST. Mutation chains, async boundaries, closure captures, call graphs, forEach mutation detection (ECMA-262 cited), predicate gate comparisons. Verified facts — the LLM cannot contradict them. | ✅ Exists |
| **Layer 0.5 — Persistent Semantic Map** | One-time `unravel index` scan using UA's multi-agent knowledge graph logic (MIT licensed — already cloned). Every module gets an architectural role label. Every subsequent analysis starts with the map already built. File routing drops from 2 LLM calls to 0 — pure graph traversal in milliseconds. Facts accumulate across sessions; the map gets richer with every run. | 🔜 Next |
| **Layer 0.75 — Semantic Similarity Engine** | Gemini Embedding 2 (text-image-video-audio-PDF all in one embedding space, 8192-token context, MRL-compressed 3072-dim vectors, $0.20/M tokens). Embeds the bug symptom. Retrieves most-similar past confirmed bugs as grounding context before any LLM call. Also handles multimodal: a screenshot of a broken UI state is embedded and compared against code sections by geometric distance — not keyword matching. | 🔜 After Layer 0.5 |
| **Layer 1 — Zero-Cost Routing** | On indexed repos: UA knowledge graph traversal from symptom symbols. On new repos: Gemini Embedding 2 retrieves candidate files by semantic similarity. LLM calls for file selection: zero. | 🔜 Follows 0.5 |
| **Layer 2 — 8-Phase Structured Reasoning** | Unchanged in mechanism. Now runs on top of: verified AST facts + architectural labels + similar past bugs + multimodal symptom embedding + retrieved documentation. Input is incomparably richer. | ✅ Exists |
| **Layer 3 — Verification + Coverage + Schema** | Claim Verifier, Fix Completeness, Symptom Coverage Alert, multi-root-cause schema. | ✅ Exists (B-22 additions) |
| **Multi-Agent Mode** | Heavy Mode: 4 agents partition large repos, each runs the full pipeline, Synthesis agent merges. Three-Agent Divergent: low-confidence runs force Agent 2 and Agent 3 to look in different directions. All converge = high confidence. They diverge = developer sees the full uncertainty picture, not false consensus. | 📄 Designed (§8.1-8.2) |
| **Web Crawlers** | Before the LLM call, crawl documentation for any external packages mentioned in the symptom. Embed and retrieve the relevant section. The model reasons against the actual spec, not training-data memory of it. | 📄 Designed (§8.5) |
| **WebContainers Runtime** | In-browser sandboxed Node execution of reproduction steps. Captures concrete variable values at crash site. Turns "AST indicates this mutation *could* cause the bug" into "runtime confirms `count` was 0, not Y." | 📄 Designed (§8.4) |

---

### The Enterprise Angle

For individual developers: Unravel saves time on hard bugs.

For a company managing a large repo — 50,000 files, 200 engineers, 3 years of accumulated complexity — Unravel becomes something categorically different:

- Every debugging session every engineer runs deposits verified structural facts into the knowledge graph.
- After six months, the graph knows: which modules are most frequently implicated in bugs, which async boundaries are highest risk, which architectural assumptions are most often violated in practice.
- **This is institutional memory that no individual engineer has** — because it is derived from the aggregate of every debugging session, not any person's understanding.

The graph also enables something that doesn't exist anywhere now: **proactive structural risk scoring on PRs.** Before a PR is merged, Unravel traverses the knowledge graph from the changed files, identifies all mutation chains and call graph edges the change touches, and flags structural risk — based on verified static analysis of actual execution paths, not review heuristics.

That's not a debugging tool. That's infrastructure teams want to pay for.

---

### The Epistemic Provenance Principle (Most Novel Idea)

The knowledge graph needs **provenance labels on every node**:

- `[AST_VERIFIED]` — deterministically extracted. Ground truth. (e.g., "session token written at L234")
- `[LLM_INFERRED]` — probabilistic. Heuristic signal. (e.g., "this is the Authentication layer")
- `[AGENT_VERIFIED]` — cross-checked by multiple passes.

Nobody has built a knowledge graph where the model knows the epistemic status of each fact before reasoning. This is a research contribution. It extends the verified/heuristic separation that already exists in Unravel's output to a persistent, accumulating graph — so the model can be appropriately confident about structural facts and appropriately uncertain about architectural labels, simultaneously, in the same reasoning pass.

---

### Where It Stands Competitively

Every current tool — Cursor, Copilot, Devin, OpenHands — operates the same way: give the LLM code, let it reason probabilistically, hope it's right. They differ in agentic scaffolding, not in epistemics. The model is always guessing from incomplete context.

Unravel with the full stack is architecturally different. Before the model generates a single token it has:

- Verified structural facts about every mutation, async boundary, and call relationship
- Architectural role labels for every module in the repo
- The three most similar past bugs with their verified diagnoses
- The visual/audio symptom embedded in the same space as the code
- Relevant documentation retrieved by semantic similarity
- A coverage constraint requiring every described failure mode to be addressed
- A schema requiring every hypothesis elimination to cite the exact verified code fragment

The model cannot hallucinate about entities in the verified block. It cannot ignore failure modes the coverage enforcer flagged. It cannot produce a fix that leaves the structural violation uncorrected.

**That is not a better LLM. That is a different architecture.**

---

### The One-Line Answer

> When all of this is built, Unravel is the **deterministic ground truth layer for all AI reasoning about code** — not a debugging tool, not a code assistant, but the infrastructure layer that sits between any LLM and any codebase, ensuring that whatever the model concludes is constrained by verified structural reality.
>
> That's a platform. Nobody else is building it.

---

### Honest Open Questions

1. **UA's graph quality is model-dependent.** Their architectural labels are LLM-inferred — probabilistic, not verified. Must be treated as heuristic signals, not ground truth. The existing epistemic separation handles this, but it needs to be maintained carefully as the graph grows.
2. **Embedding-based file retrieval is unproven on real repos.** The current LLM router has been tested. Replacing it with embedding retrieval will have edge cases on repos where module names are generic. Needs its own benchmark before fully replacing the LLM router.
3. **Multi-agent mode hasn't been built yet.** The design is sound. Implementation will surface real problems around context overlap between agents, synthesis instructions, and confidence calibration. Budget more time than expected.

---

### Updated Execution Order (March 2026 revision)

| Step | What | Effort |
|---|---|---|
| 1 | UDB-50 benchmark | Required for everything else |
| 2 | `.unravel/knowledge.json` persistence (file-hash invalidation) | Weekend |
| 3 | UA graph-builder port → `unravel index` command | 1–2 weeks |
| 4 | Layer 1 graph-traversal routing (UA map first, LLM router fallback) | 1 week |
| 5 | Gemini Embedding 2 — symptom similarity (top-3 prior bug injection) | Few hours |
| 6 | Gemini Embedding 2 — multimodal symptom input (screenshot → candidate files) | 1–2 days |
| 7 | Web crawler documentation retrieval | 1 week |
| 8 | Multi-agent Heavy Mode | 2–3 weeks |
| 9 | WebContainers runtime execution | Phase 6 |
| 10 | Enterprise PR risk scoring (knowledge graph traversal on diff) | Phase 7 |

---

## 11. Long-Term Vision — Reviewer Additions

*March 2026. These items require infrastructure not yet built. They belong here, not in the current implementation sprint.*

---

### 11.1 Temporal / Commit-Aware Reasoning

Every knowledge graph node today is static — it represents current code, not code history. The missing dimension is **when** something changed.

**What to add:** Extend graph nodes with git blame data:
```json
{
  "node": "function pause",
  "introducedAt": "commit_hash",
  "lastModified": "commit_hash",
  "bugAssociated": true
}
```

**What this enables:**
- Blame-aware debugging: "this mutation was introduced in commit X, triggered after commit Y"
- Regression detection: "this PR modifies a function with a prior bug association"
- Enterprise PR risk: "this change intersects a historically unstable mutation chain"

This is particularly powerful for the enterprise angle — institutional memory isn't just what the code does, it's what it did and when it changed.

**Dependency:** Requires the persistent `.unravel/knowledge.json` layer (Priority 2 in next_phase_plan.md) plus git log integration.

---

### 11.2 Disagreement Analyzer for Multi-Agent Mode

When 3 agents diverge, the current design surfaces all three diagnoses ranked by confidence. That's honest. But it doesn't extract information from the disagreement itself.

**What research systems do:** Disagreement is treated as signal of missing evidence or ambiguous causality — not just a display problem.

**Add a Disagreement Analyzer:**
```json
{
  "disagreementType": [
    "different hypotheses",
    "same hypothesis different cause",
    "same cause different fix"
  ],
  "rootReason": [
    "missing file",
    "ambiguous control flow",
    "insufficient AST coverage"
  ]
}
```

Then feed the `rootReason` back into the pipeline — "agents disagree due to missing runtime state" → automatically trigger runtime phase or self-heal loop. This upgrades multi-agent from voting to **multi-agent epistemic reasoning**.

**Dependency:** Requires Multi-Agent Mode to be built first (Priority 6 in next_phase_plan.md).

---

### 11.3 Regression Test Synthesis

After Phase 8.5 confirms the fix is invariant-consistent, the system should synthesise a minimal regression test from the symptom + surviving hypothesis + invariants.

```
Given:
  symptom: "timer shows wrong value after pause/resume"
  invariant: "duration must remain constant for a mode session"
  fix: "remove duration = remaining from pause()"

Generate: a test that fails before the fix and passes after it.
```

This transforms Unravel from a debugger into a **learning system** — every bug it fixes leaves behind a permanent proof that the bug class was handled. Over time, the test suite grows from actual bugs encountered in the wild.

**Dependency:** Requires runtime execution (WebContainers, Phase 9) to validate the generated test.

---

### 11.4 Typed Object Architecture (Long-Term Refactor)

The current pipeline uses text instructions that describe what the model should do. A more robust architecture treats every pipeline artifact as a typed object with validators:

```
Hypothesis { text, falsifiableIf[], status, eliminationQuality, causalChain[] }
EvidenceItem { file, line, type: support|contradiction|missing }
Invariant { statement, satisfiedByFix: boolean }
Fix { diffBlock, violatedInvariants[] }
Risk { file, line, pattern, confidence }
```

Each phase transforms these objects. A phase cannot produce invalid output because the schema enforces it at generation time. This is architecturally more robust than relying on prompt wording.

**This is a significant refactor** — not a sprint item. Document it here so the architectural direction is clear before building more on top of the current text-instruction approach. The schema fields being added in the current sprint (Gap 0–7) are a stepping stone toward this.

---

### 11.5 Schema Versioning

The implementation sprint adds 8+ new schema fields. Future sprints will add more. Any consumer of the analysis JSON (VS Code extension, web app, future CLI, future API) will break silently when fields are added or restructured.

**Add `_schemaVersion` to `_provenance`:**
```js
_provenance: { engineVersion: "3.4", schemaVersion: "2.0", ... }
```

**Migration layer in `parse-json.js`:** If incoming schema version is older, backfill defaults for new fields. If schema version is newer than consumer expects, surface a warning rather than crashing.

**Not needed immediately** — becomes essential once the engine is used repeatedly or compared across versions. Build before the v4.0 architecture release.


