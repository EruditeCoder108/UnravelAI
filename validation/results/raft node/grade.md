# B-22 — Raft Consensus: Phantom Majority + Election Block
## Grade Sheet — Final Honest Result

**Bug:** `raft-node.js` (~2.8k lines). Three independent bugs forming two failure modes.

| Component | Description |
|-----------|-------------|
| **Mode A** | `promotePreVotesToGrants` injects pre-vote records with `term: N-1` into `_grantedVotes`. `checkQuorum._refreshVoterRecord` "upgrades" those records to `term: N` and counts them. False quorum → split-brain. |
| **Mode A (mechanism)** | `_grantedVotes.forEach` inside `checkQuorum` calls `_refreshVoterRecord` which does `.delete(voterId)` then `.add(voterId)` on the same Set being iterated — ECMA-262 §24.2.3.7: deleted-then-re-added elements are visited again. Votes may be double-counted. |
| **Mode B** | `_isLogUpToDate` uses strict `>` instead of `>=` for the index comparison when terms match. Peers with equal logs reject valid candidates — election stall. Raft §5.4.1 requires `>=`. |

---

## Run 1 (pre-improvements) — Unravel with old engine

- Found Mode A mechanism correctly
- Proposed wrong fix: `electionTerm - 1` → `electionTerm` in `promotePreVotesToGrants`
- Phantom votes persisted — records still entered `_grantedVotes`, refresh logic still activated
- Mode B not addressed — schema forced single root cause, symptom coverage not enforced
- **Score: 3/6**

---

## Run 2 (post-improvements) — Unravel with new engine

### What the engine contributed before the LLM saw the code

**detectForEachCollectionMutation (depth-1 expansion):**
```
Collection Mutated During Iteration ⚠ JS SPEC VIOLATION:
  🔴 CRITICAL: _grantedVotes.forEach() [raft-node.js] L539
  Mutations: delete() (via _refreshVoterRecord()) L526, add() (via _refreshVoterRecord()) L526
  ECMA-262 spec: deleted-then-re-added elements ARE visited again — elements may be processed TWICE.
  → Effect: elements may be visited MULTIPLE TIMES — counts/decisions based on this loop are unreliable.
```

This is a verified structural fact. The LLM cannot contradict it. It tells the model that `_refreshVoterRecord` is not just logically wrong — the `.delete()` + `.add()` pattern is a spec violation that causes double-counting independent of the term logic. This forced the fix to eliminate the pattern, not patch around it.

**Symptom coverage enforcer:**
The symptom enumerated Mode A and Mode B as separate numbered behaviors. Coverage enforcement injected:
```
⚠ SYMPTOM COVERAGE REQUIREMENT
The symptom contains a numbered list with 2 distinct behaviors.
Your analysis MUST account for EVERY described behavior...
```
This forced H4 (`_isLogUpToDate` strict `>`) to be addressed. The model found it by reading the code once directed to look — no domain vocabulary heuristic needed.

**Multi-root-cause schema:**
`additionalRootCauses[]` gave the model a structured place to put RC-2 (Mode B) independently of RC-1 (Mode A). Previous run forced both into a single `rootCause` string.

---

## Scorecard

| Axis | Unravel (Run 2) | Claude | Notes |
|------|:-:|:-:|-------|
| **RCA — Mode A identified** | ✅ | ✅ | Both: `promotePreVotesToGrants` → stale records → false quorum |
| **RCA — Mode B identified** | ✅ | ✅ | Both: `_isLogUpToDate` strict `>` |
| **Evidence quality** | ✅ | ✅ | Both cite specific lines; both have causal chains |
| **Fix — Mode B** | ✅ | ✅ | Both: `>` → `>=` in `_isLogUpToDate` |
| **Fix — Mode A correctness** | ✅ | ✅ | Both remove `promotePreVotesToGrants` call |
| **Fix — Mode A completeness** | **More complete** | Partial | See below |
| **Total** | **6/6** | **6/6** | Tie on rubric |

### Fix completeness comparison

**Claude's fix:**
1. Remove `promotePreVotesToGrants` function and call site ✅
2. Fix `_isLogUpToDate` `>` → `>=` ✅
3. `_refreshVoterRecord` and refresh logic in `checkQuorum` — **left as dead code** ❌

**Unravel's fix (diffBlock):**
1. Remove `promotePreVotesToGrants` function and call site ✅
2. Remove `_refreshVoterRecord` function entirely ✅
3. Replace `if (record.term < currentTerm && !record.refreshed) { _refreshVoterRecord... } count++` with `if (record.term === currentTerm) { count++ }` — positive guard, no refresh mechanism ✅
4. Fix `_isLogUpToDate` `>` → `>=` ✅

Unravel removed all three components: the erroneous function, its caller, and the activation mechanism that would have triggered future stale records. Claude left `_refreshVoterRecord` in place — it becomes dead code in Claude's fix because there are no longer stale records to refresh, but it remains a latent hazard if `promotePreVotesToGrants` (or anything like it) is re-introduced.

The ECMA-262 annotation is why. Telling the LLM "this `.delete()` + `.add()` pattern inside forEach is a spec violation" caused it to reason: "the right fix eliminates the pattern, not the records that trigger it." That's a structurally different reasoning path than "remove the function that creates bad records."

---

## What detectSpecViolationRisks (Raft vocabulary) contributed: nothing

Mode B (`_isLogUpToDate`) was found by the **symptom coverage enforcer**, not by the spec heuristic.

The enforcer injected a requirement to address the Mode B behavior ("peers reject votes even when the candidate's log is identical"). The model found the `>` by reading the code once directed to look at log comparisons. The domain vocabulary heuristic (`quorum`, `election`, etc.) was not present — it was replaced by `detectStrictComparisonInPredicateGate` (structural, general) which fires on any `is*`, `can*`, `has*` function name. That detector may or may not have fired on `_isLogUpToDate` — the point is it wasn't needed here.

**This is the important result.** The symptom coverage enforcer does real independent work. If the symptom is well-described and contains enumerated failure modes, the enforcer forces coverage — and a model with access to the code will find the relevant mechanism. No domain vocabulary is required.

---

## The boundary finding

The wrong fix in Run 1 revealed precisely where AST grounding ends:

- The ECMA-262 annotation was **accurate** — the spec fact is real.
- The LLM applied it **correctly** — it identified the double-counting mechanism.
- But it proposed a wrong fix because **fixing the double-count doesn't fix phantom votes entering `_grantedVotes` in the first place.**

Knowing `Set.forEach` with `.delete()` + `.add()` double-visits elements doesn't tell you that pre-voters shouldn't be in `_grantedVotes` at all. That requires external knowledge: pre-votes are a Raft liveness optimization (§9.6), not votes.

Run 2 got the correct fix because:
1. The ECMA-262 annotation told the model the `.delete()` + `.add()` pattern is the wrong mechanism — so eliminate it entirely.
2. The multi-root-cause schema forced it to look for additional root causes and find the `term: N-1` source.
3. With both structural facts present simultaneously, the model reasoned that the right fix removes the entire promotion-refresh chain, not just one end of it.

No single improvement produced this. All three general improvements working together produced a fix that is structurally cleaner than Claude's.

---

## Engine improvements assessed

| Improvement | General? | B-22 contribution |
|-------------|:--------:|-------------------|
| `detectForEachCollectionMutation` (depth-1) | ✅ Yes — any codebase | Direct: ECMA-262 annotation changed *how* the fix was reasoned, leading to complete removal of the refresh mechanism |
| `detectStrictComparisonInPredicateGate` | ✅ Yes — structural naming convention | Indirect: fires on `is*` functions generally; not the primary signal that found Mode B here |
| `additionalRootCauses[]` schema | ✅ Yes — any multi-bug report | Direct: gave RC-2 a structured output slot; both modes appeared in the report |
| Symptom coverage enforcer | ✅ Yes — any structured bug report | Direct: forced Mode B to be addressed; found Mode B without domain vocabulary |
| ~~`detectSpecViolationRisks` (Raft vocabulary)~~ | ❌ Raft-targeted | Not present in final engine — removed and replaced |

---

## Paper result

> **Three general-purpose engine improvements — a structural spec detector with depth-1 callee expansion, a multi-root-cause output schema, and a symptom coverage enforcer — produced a 6/6 result on a benchmark with three independent bugs, with a fix that is structurally more complete than Claude Sonnet 4.6's. The fourth improvement (domain vocabulary heuristic) was identified as Raft-targeted and removed before the benchmark was re-run. None of the three improvements that produced the result are domain-specific.**
