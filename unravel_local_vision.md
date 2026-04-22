# What Becomes Possible When Unravel Owns the Machine

*"The cloud version answers the question: what is wrong with this code?
The local version answers a different question: what is the full truth about this codebase — and how does it evolve over time?"*

---

## 1. Execute the Code, Don't Just Read It

**Current state:** Unravel is static analysis. It reads code and reasons about behavior. It can prove that `duration` gets overwritten at L42 — but it cannot prove what `duration`'s value actually was at the moment the user saw the bug.

**What local unlocks:** You have Node.js. The code is on disk. You can run it.

### 1a. Hypothesis Testing by Execution

Today, Phase 5.5 (Adversarial Confirmation) works by logical argument — the model argues against its own surviving hypotheses using AST evidence. What if instead of arguing, it tested?

```
AST says: "duration is captured by closure at initialization"
Hypothesis H2: "pause() overwrites duration with a stale value"

Instead of reasoning about whether this is true:
  1. Inject a console.log at L42: console.log('duration before:', duration)
  2. Inject a console.log at L69: console.log('duration after pause:', duration)
  3. Run the reproduction steps
  4. Capture stdout
  5. Compare actual values to predicted values
  
If actual matches H2's prediction → H2 is CONFIRMED BY EXECUTION
If actual contradicts H2 → H2 is ELIMINATED BY MEASUREMENT, not by argument
```

This turns adversarial confirmation from a reasoning exercise into an empirical measurement. No model, regardless of size, can out-argue a `console.log`.

**The instrumentation flow:**
```
analyze() → AST finds mutation chain → identify key variables
  → auto-generate instrumentation (logging at mutation sites)
  → apply instrumentation to temp copy of files  
  → run code with reproduction steps
  → capture actual runtime values
  → inject values as RUNTIME_VERIFIED ground truth alongside AST_VERIFIED
  → model now reasons with two classes of evidence: structural + empirical
```

This is qualitatively different from what any cloud debugging tool can do. They can read code. You can execute it.

### 1b. Fix Verification — Before Presenting to the User

Today, `verify()` checks that your claims about code are textually accurate. It does NOT check that your fix actually works.

Locally, you can:
1. Apply the proposed fix to a temporary branch
2. Run the project's test suite
3. Run the reproduction steps
4. Report: "Fix applied. 47/47 tests pass. The originally reported behavior no longer occurs."

Or more powerfully: "Fix applied. 46/47 tests pass. `test_concurrent_payments.js` now fails — the fix introduced a regression in the concurrent payment path. Revising fix to account for this..."

That's a **self-healing loop with empirical feedback**. Static analysis proposes the fix. Runtime execution validates it. If it breaks something, the engine revises automatically. No human in the loop until the fix is confirmed working.

---

## 2. Git Becomes a First-Class Evidence Source

The cloud version sees code as a snapshot — a static moment in time. Locally, you have the full `.git` history. Every commit, every blame line, every branch, every merge conflict.

### 2a. Automated Git Bisect

Once Unravel diagnoses a bug and identifies the root cause at `scheduler.js:42`, it can automatically answer: *when was this bug introduced?*

```
Root cause identified: scheduler.js L42 — duration reassignment

Automatically running: git log --follow -p scheduler.js | grep 'duration'
  → Commit abc123 (3 days ago, author: dev-B): "Added pause feature"
  → Before this commit, L42 did not exist
  → The bug was introduced in commit abc123

Report:
  rootCause: "scheduler.js:42 — duration reassignment in pause()"
  introducedBy: { commit: "abc123", author: "dev-B", date: "2026-04-14", message: "Added pause feature" }
  priorBehavior: "duration was immutable before this commit"
```

No other tool does this. Copilot, Cursor, Claude — they see code as it IS. `unravel-local` sees code as it BECAME. That distinction matters enormously for understanding how bugs get introduced, and for preventing recurrence.

### 2b. Blame-Aware Risk Scoring

Every graph node in the Knowledge Graph gets enriched with temporal data:

```json
{
  "node": "function pause()",
  "file": "scheduler.js",
  "lastModifiedCommit": "abc123",
  "lastModifiedDate": "2026-04-14",
  "modificationFrequency": 7,
  "bugAssociations": 2,
  "riskScore": 0.82
}
```

After 50 debug sessions, the KG contains a map of where bugs cluster in the codebase. Not guessed — measured. Files that have been the root cause of verified bugs before are flagged as high-risk in all future analyses. Functions modified frequently have higher risk scores than stable ones.

### 2c. Pre-Commit Structural Guard

This is the single most commercially valuable feature in the entire roadmap.

A Git pre-commit hook that runs before every commit:

```bash
# .git/hooks/pre-commit
unravel-local guard --staged
```

What it does:
1. Takes the staged diff
2. Identifies which mutation chains, async boundaries, and cross-file edges are touched by this change
3. Cross-references against the pattern store: "Has this structural pattern caused bugs before?"
4. If yes: **blocks the commit** with an explanation

```
⛔ COMMIT BLOCKED — Structural risk detected

Your change at payment-service.js:89 introduces a forEach(async ...) loop
over charge items. This pattern has caused silent payment failures in this
codebase before (verified diagnosis diag-1713285612, confidence 0.92).

The forEach discards the returned promises. Use Promise.all(items.map(...))
instead.

To override: git commit --no-verify
```

This is not a linter. A linter finds *syntax* violations. This finds *semantic* violations — patterns that have been empirically proven to cause bugs in this specific project, stored in the pattern store across sessions.

No cloud service can do this because no cloud service has the accumulated project-specific pattern history.

---

## 3. The Perpetual Learning Loop

Cloud debugging is stateless. Each call is independent. Local changes this entirely.

### 3a. The Background Daemon

```bash
unravel-local watch ./src
```

A daemon process that:
- Watches file changes in real-time (fs.watch)
- On every save: re-runs the AST detectors on changed files
- Compares current AST output to the last-known state
- If a new mutation chain, race condition, or floating promise appears: emits a notification

This turns bug detection from reactive (user reports a bug → analyze) to proactive (Unravel sees the bug being written in real-time).

Low resource cost: AST analysis is pure tree-sitter, no LLM needed. The daemon only invokes Gemma when it finds something structurally suspicious — and even then, only if the pattern store recognizes the signature.

### 3b. Cross-Project Pattern Transfer

When you debug project-A and accumulate 30 verified diagnoses, those patterns live in `project-A/.unravel/patterns.json`. When you start debugging project-B, those patterns don't transfer — each project has its own store.

Locally, you can build a **global pattern store**:

```
~/.unravel/
  global-patterns.json    ← merged from all projects
  global-archive.json     ← all verified diagnoses, cross-project
```

"forEach(async) → silent failure" is not project-specific. It's a JavaScript-language-level structural pattern. Once learned in any project, it should be recognized everywhere.

The global store becomes your personal AI debugging experience — it gets smarter across every project you work on, regardless of which one taught it the pattern.

### 3c. Developer-Specific Reasoning Bias Profiles

This is from `future-thoughts.md` (§2) but local makes it practical.

Over many sessions, the local model develops measurable tendencies. Maybe your Gemma 4 E4B instance consistently over-eliminates stale closure hypotheses when it sees fresh-value evidence. Maybe it under-weights race conditions in timer code.

Log every reasoning step:
```json
{
  "hypothesis": "H2: stale closure captures duration at init",
  "modelVerdict": "ELIMINATED — tick() reads fresh remaining",
  "verifyResult": "REJECTED — remaining IS captured at init, not fresh",
  "biasType": "premature-elimination-on-fresh-value-evidence"
}
```

After 50 sessions, you have a statistical profile of how the model fails. Inject calibration into the system prompt:

```
CALIBRATION NOTE: This model has a documented tendency (28% of sessions) to 
over-eliminate stale closure hypotheses when it sees any "fresh value" evidence. 
Apply extra scrutiny to fresh-value eliminations. Require ≥2 distinct code 
citations before eliminating a closure hypothesis.
```

This is **meta-reasoning** — the system learns not just about code, but about its own reasoning flaws. No cloud tool can do this because they don't persist your session history.

---

## 4. Multi-Model Ensemble Debugging

On a local machine with 12-16GB RAM, you can run multiple small models simultaneously. This unlocks something impossible in the cloud: **disagreement as signal**.

### 4a. Divergent Reasoning Mode

```
Bug: "timer shows stale value"

Agent 1 (Gemma 4 E4B):     H-winner: stale closure
Agent 2 (Phi-4):            H-winner: mutation race
Agent 3 (Llama 3.2 3B):     H-winner: stale closure

Result: 2/3 agree on stale closure. Agent 2 diverges.
  → Surface Agent 2's reasoning to the user as ALTERNATIVE HYPOTHESIS
  → Run both fixes through test suite
  → Present empirical results
```

When all three agree, confidence goes up. When they diverge, that divergence IS information — it reveals which aspects of the bug are ambiguous from the available evidence.

### 4b. Teacher-Student Distillation

The cloud version still exists. Use it strategically:

1. Run the same bug through both `unravel-local` (Gemma 4 E4B) and `unravel-mcp` (via Claude Sonnet)
2. When Sonnet catches something Gemma missed → that becomes a training example
3. Accumulate 50 such examples
4. LoRA fine-tune Gemma specifically on the cases where it was wrong

Over time, the local model absorbs the larger model's reasoning patterns **for your specific project**. The cloud model is the teacher. The local model is the student. The curriculum is your actual bugs.

After fine-tuning, the local model handles 90%+ of bugs independently. You only escalate to the cloud for the remaining edge cases. Cost drops to near-zero for routine debugging.

---

## 5. Full Environmental Awareness

The cloud version sees code files. The local version sees everything.

### 5a. Environment as Evidence

```
.env variables
docker-compose.yml
package-lock.json (exact dependency versions)
tsconfig.json (compiler settings)
.nvmrc (Node.js version)
Runtime process.env values
```

Today, when AST analysis finds STATIC_BLIND (no structural bugs detected), the model suggests investigating "environment configuration." Locally, it can actually DO that:

```
STATIC_BLIND detected. Checking environment:
  → .env: DATABASE_URL=postgresql://localhost:5432/prod  ← WARNING: prod DB in local env
  → package-lock: lodash@4.17.20 ← KNOWN CVE: prototype pollution (CVE-2021-23337)
  → tsconfig: strictNullChecks=false ← 37% of null-reference bugs in verified archive
  → Node.js: v18.12 ← process.nextTick scheduling changed in v20, may affect race conditions
```

The debugging scope expands from "what's wrong with the code" to "what's wrong with the system."

### 5b. Dependency Structural Analysis

Read `node_modules` (or at least the entry points of key dependencies). When the AST finds a call to `lodash.get()` and the bug is a null reference, `unravel-local` can:

1. Read the actual `lodash` source from `node_modules`
2. Trace the call through lodash's implementation
3. Determine that `lodash.get()` returns `undefined` (not `null`) on missing paths
4. Identify type coercion as the mechanism

No cloud tool reads your `node_modules`. Too expensive per token. Locally, disk reads are free.

---

## 6. Test Synthesis and Execution

After finding and fixing a bug, generate a regression test. Then **run it**.

```
Bug: forEach(async) discards promises in PaymentService.ts:47
Fix: Replace with Promise.all(items.map(async ...))

Generated test:
  test('all payment charges complete before response', async () => {
    const items = [item1, item2, item3];
    const result = await processPayment(items);
    expect(result.charged.length).toBe(3);
    expect(result.failed.length).toBe(0);
  });

Execution result: ✓ PASS with fix applied, ✗ FAIL without fix
  → Test correctly captures the bug's observable behavior
  → Writing to __tests__/payment-regression-001.test.ts
```

Over time, the test suite grows from real bugs. Not generated speculatively — each test was born from an actual confirmed diagnosis with `verify(PASSED)`. The test suite IS the project's institutional memory, in executable form.

---

## 7. The Unified Intelligence Layer

When all of this converges — AST facts + runtime values + git history + environment context + pattern store + diagnosis archive + test results — you have something categorically different from a debugging tool.

```
┌────────────────────────────────────────────────────────────────┐
│                     UNRAVEL LOCAL                              │
│                                                                │
│  Evidence Layer:                                               │
│    [AST Ground Truth]  — structural facts from tree-sitter     │
│    [Runtime Capture]   — actual values from instrumented runs  │
│    [Git Archaeology]   — when/who/why each line changed        │
│    [Environment Scan]  — config, deps, versions, CVEs          │
│    [Test Results]      — empirical validation of fixes         │
│                                                                │
│  Memory Layer:                                                 │
│    [Pattern Store]     — structural bug signatures, weighted   │
│    [Diagnosis Archive] — 768-dim semantic history of all bugs  │
│    [Developer Profiles]— per-developer reasoning bias data     │
│    [Risk Graph]        — temporal risk scores per function     │
│    [Global Patterns]   — cross-project structural knowledge    │
│                                                                │
│  Action Layer:                                                 │
│    [Pre-Commit Guard]  — block commits matching known patterns │
│    [Watch Daemon]      — proactive bug detection on save       │
│    [Fix Verification]  — run tests before presenting fix       │
│    [Test Synthesis]    — generate regression tests from fixes  │
│    [Auto Bisect]       — find introducing commit automatically │
│                                                                │
│  Learning Layer:                                               │
│    [Self-Calibration]  — measure and correct reasoning biases  │
│    [Teacher-Student]   — distill cloud model into local model  │
│    [LoRA Fine-Tuning]  — train on own verified diagnosis data  │
│    [Pattern Evolution] — patterns strengthen/decay with usage  │
│                                                                │
└────────────────────────────────────────────────────────────────┘
```

None of this is possible through a cloud API. Not because of compute — because of access. The cloud doesn't have your git history. It doesn't have your node_modules. It can't run your code. It can't watch your files. It can't accumulate 6 months of project-specific diagnostic memory without you paying per token to upload it every time.

---

## The Killer Realization

Cloud debugging tools get better when the model gets bigger.
`unravel-local` gets better when **you debug more bugs on your project**.

That's a fundamentally different growth curve. Claude Sonnet improves when Anthropic trains a new version — which you have zero control over. `unravel-local` improves every single day you use it — and the improvement is specific to YOUR codebase, YOUR patterns, YOUR team's tendencies.

After 6 months of use on a production codebase:
- The pattern store knows the 15 structural patterns that cause 80% of your bugs
- The diagnosis archive contains 200+ verified root causes searchable by semantic similarity  
- The risk graph shows which files and functions are historically unstable
- The developer profiles know that dev-A tends to introduce async bugs and dev-B tends to introduce state mutation bugs
- The regression test suite has 200 tests, each born from a real bug
- The pre-commit guard catches ~60% of recurring bug patterns before they're even committed
- The local model has been fine-tuned on your project's exact diagnostic history

**At that point, Claude Sonnet — in all its 70B-parameter glory — knows less about your project than your 4.5B-parameter local Gemma.** Because Sonnet starts from zero every session, and your Gemma has 6 months of accumulated, verified, project-specific intelligence.

That's the moat. Not model size. Accumulated local intelligence.
