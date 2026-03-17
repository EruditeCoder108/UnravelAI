# Unravel — Future Thoughts

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
