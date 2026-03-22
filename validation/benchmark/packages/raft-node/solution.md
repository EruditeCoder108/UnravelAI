# Solution — B-22 "The Collapsed Register"

## Category
`RACE_CONDITION + STATE_MUTATION` — three independent defects, two compound to produce
false quorum (split brain), one independently causes election instability.

---

## Bug 1 — Set.forEach delete+re-add: double-visit

**File:** `raft-node.js`  
**Location:** `VoteManager.checkQuorum` (L~537), `VoteManager._refreshVoterRecord` (L~526)

### The ECMAScript specification fact

ECMAScript 2023 §24.2.3.7 (`Set.prototype.forEach`):

> "Each value is normally visited only once. However, a value will be revisited
> if it is deleted before it has been visited and then re-added before the
> forEach call completes."

This is specified behavior — not undefined. Most developers and all LLMs trained
on general documentation assume "each value visited once." The exception clause
is in the spec but absent from essentially all tutorials, courses, and documentation.

### Mechanism

```js
// VoteManager._refreshVoterRecord
_refreshVoterRecord(voterId, currentTerm) {
    const record = this._voteRegistry.get(voterId);
    if (!record || record.refreshed) return;
    record.term = currentTerm;
    record.refreshed = true;
    this._grantedVotes.delete(voterId);   // remove from current position
    this._grantedVotes.add(voterId);      // re-insert at end
}

// VoteManager.checkQuorum
checkQuorum(majority, currentTerm) {
    let count = 1;
    this._grantedVotes.forEach(voterId => {
        const record = this._voteRegistry.get(voterId);
        if (!record) return;
        if (record.term < currentTerm && !record.refreshed) {
            this._refreshVoterRecord(voterId, currentTerm);
        }
        count++;  // fires again on re-visit
    });
    return { hasQuorum: count >= majority, voteCount: count };
}
```

Per §24.2.3.7: any voter deleted and re-added inside `forEach` is visited again
at its new tail position. `count++` fires twice for each such voter.

For two stale voters in a 5-node cluster: `count = 1 (self) + 2 (stale, first visit)
+ 1 (real vote) + 2 (stale, second visit) = 6`. Majority = 3. False quorum.

### Why this never triggered in the original code

`recordGrant(voterId, msg.term, ...)` is only called from `_handleVoteResponse`, which
guards `if (msg.term !== this._term) return`. So all stored VoteRecord terms equal
`this._term`. `checkQuorum(majority, this._term)` evaluates `record.term < this._term`
→ always false. `_refreshVoterRecord` is never called. Bug 1 is **latent** — it needs
Bug 2 to create the stale records that trigger it.

---

## Bug 2 — Pre-vote grants promoted to full-vote grants with stale term

**File:** `raft-node.js`  
**Location:** `VoteManager.promotePreVotesToGrants` (L~502), `_startElection` call site (L~1083)

### Mechanism

```js
// VoteManager.promotePreVotesToGrants
promotePreVotesToGrants(preVoters, electionTerm) {
    for (const voterId of preVoters) {
        if (this._grantedVotes.has(voterId)) continue;
        const record = new VoteRecord({
            voterId,
            term:     electionTerm - 1,   // pre-vote was in the previous term
            logIndex: 0,
            logTerm:  0,
        });
        this._voteRegistry.set(voterId, record);
        this._grantedVotes.add(voterId);
    }
}

// _startElection — called after this._term++ (now at electionTerm N)
if (this._election?.preVotesDone && this._election.preVotes.size > 0) {
    this._votes.promotePreVotesToGrants(
        [...this._election.preVotes],
        this._term       // electionTerm = N, so stored term = N-1
    );
}
```

Pre-vote participants are written into `_grantedVotes` with `term = electionTerm - 1`.
This activates Bug 1: `checkQuorum(majority, electionTerm)` sees `record.term (N-1)
< electionTerm (N)` → calls `_refreshVoterRecord` → `delete` + `add` → double-visit.

### Independent Raft violation

Pre-votes are gauges of electability (RFC Raft §9.6: "the Pre-Vote algorithm... a
server only starts an election if it would probably win"). They are explicitly NOT
actual votes. A node that grants a pre-vote to candidate A may grant its real vote
to candidate B (whoever sends the actual vote request first). Treating pre-votes as
provisional real-vote grants violates the one-vote-per-term invariant. Even if Bug 1
were fixed (the Set iteration fixed), Bug 2 alone means the quorum can include nodes
that never voted for this candidate, producing a phantom majority.

### The compound

Bug 2 creates the stale records. Bug 1 double-counts them. Together they inflate
`voteCount` by 2× the number of pre-voters promoted. In a 5-node cluster with 2
pre-voters, `count = 6` for 3 actual supporters. Both bugs must be fixed.

---

## Bug 3 — `_isLogUpToDate` strict inequality rejects equal logs

**File:** `raft-node.js`  
**Location:** `RaftNode._isLogUpToDate` (L~1582)

```js
_isLogUpToDate(candidateIndex, candidateTerm) {
    if (candidateTerm !== this._log.lastTerm) {
        return candidateTerm > this._log.lastTerm;
    }
    return candidateIndex > this._log.lastIndex;  // bug: > should be >=
}
```

Raft §5.4.1: "the voter denies its vote if its own log is more up-to-date."
Equal logs are NOT more up-to-date — the candidate should receive the vote.
Using `>` instead of `>=` means a candidate with an identical log to the voter is
incorrectly rejected. In clusters where all nodes have synchronized logs (common
after a stable period), this causes widespread vote rejection → elections fail
to complete → second elections fire → Mode B.

This bug is independent of Bugs 1 and 2. Fixing it alone stops Mode B but not Mode A.
Fixing only Bugs 1 and 2 stops Mode A but leaves Mode B reduced in frequency.
All three must be fixed for a correct implementation.

---

## Why LLMs fail even with the structured 3-hypothesis prompt

Given 2878 lines and the structured prompt requiring three hypotheses with `eliminatedBy`
citations, LLMs consistently produce one of these wrong outcomes:

### Wrong diagnosis A (most common): "Fix the log comparison"

The symptom description explicitly reveals that Mode B correlates with equal-log
rejections. LLMs identify Bug 3 (`>` instead of `>=`) immediately and correctly.
They propose fixing it. This fixes Mode B. Mode A continues. The LLM's stated
root cause ("incorrect log comparison causing election instability") is correct but
incomplete — it says nothing about why `votes.registry` shows `term: N-1` entries
or why confirmed voter count is 6.

### Wrong diagnosis B: "Pre-vote promotion is a Raft violation"

More capable LLMs read `promotePreVotesToGrants` and correctly identify it as a
protocol violation. They propose removing it. This removes Bug 2, which removes
the stale records, which means Bug 1 never fires. Mode A appears fixed.

BUT: Bug 1 remains in `checkQuorum` as a latent vulnerability. Any future code
path that introduces stale VoteRecord terms (e.g., vote carry-over between elections,
snapshot restore, membership change) will trigger the double-visit. The test suite
passes because the trigger is gone, not because the counting logic is correct. A
partial fix that passes tests while leaving a loaded gun in the codebase.

### Wrong diagnosis C: "Set mutation during forEach is undefined behavior"

LLMs that read `checkQuorum` carefully see `_grantedVotes.forEach` with a callee
that modifies `_grantedVotes` and correctly flag it as dangerous. But without the
specific ECMAScript citation, they describe it as "undefined behavior" — not
"specified double-visit." This leads to a defensive patch (snapshot the Set first)
that is CORRECT but for the wrong stated reason. The LLM doesn't know HOW the
double-visit occurs (spec-defined, not random), so it cannot explain why the count
is inflated by exactly `2 × stale_voter_count`. The explanation is incomplete.

### What Unravel injects that changes the outcome

Two deterministic structural annotations fire before any LLM token:

```
Set mutation during iteration — SPECIFIED DOUBLE-VISIT BEHAVIOR:
  VoteManager.checkQuorum L537: this._grantedVotes.forEach(...)
  Within forEach (via _refreshVoterRecord L526 [depth 2]):
    this._grantedVotes.delete(voterId) at L533
    this._grantedVotes.add(voterId)    at L534
  ECMAScript §24.2.3.7: values deleted and re-added before forEach()
  completes ARE visited again at their new tail position.
  EFFECT: count++ fires twice per refreshed voter.
  INFLATION: voteCount = 1 + unique_voters + stale_voter_count

Constructor-term mismatch — STALE VOTERECORD CREATED AT ELECTION START:
  VoteManager.promotePreVotesToGrants L507:
    new VoteRecord({ term: electionTerm - 1 })
  Called from _startElection L1084 with this._term (post-increment = N)
  Stored term = N-1 < N → triggers _refreshVoterRecord on first checkQuorum call
  PROTOCOL VIOLATION: pre-vote grants stored as full-vote grants with stale term
  COMPOUND: Bug 2 creates the stale records that activate Bug 1's double-visit
```

With both signals, the LLM receives: (a) the exact spec fact explaining the double-visit,
(b) the exact compound — stale records created at `_startElection` → trigger the
double-visit at `checkQuorum` → count inflated by exactly the number of pre-voters.
The fix is unambiguous: remove `promotePreVotesToGrants` AND fix `checkQuorum`
iteration, AND fix `_isLogUpToDate`.

---

## Minimal fixes

**Bug 1 — Snapshot before iterating:**
```js
checkQuorum(majority, currentTerm) {
    // Refresh stale records before counting — prevents delete+re-add inside forEach
    for (const voterId of [...this._grantedVotes]) {
        const record = this._voteRegistry.get(voterId);
        if (record && record.term < currentTerm && !record.refreshed) {
            this._refreshVoterRecord(voterId, currentTerm);
        }
    }
    let count = 1;
    for (const voterId of this._grantedVotes) {
        if (this._voteRegistry.get(voterId)) count++;
    }
    return { hasQuorum: count >= majority, voteCount: count };
}
```

**Bug 2 — Remove pre-vote promotion entirely:**
```js
// Delete promotePreVotesToGrants from VoteManager.
// Delete the promotePreVotesToGrants call from _startElection.
// Pre-votes are not votes. Quorum is determined by actual VOTE_RESPONSE grants only.
```

**Bug 3 — Restore >= in log comparison:**
```js
_isLogUpToDate(candidateIndex, candidateTerm) {
    if (candidateTerm !== this._log.lastTerm) {
        return candidateTerm > this._log.lastTerm;
    }
    return candidateIndex >= this._log.lastIndex;  // >= per Raft §5.4.1
}
```

---

## New detectors required

### `detectSetMutationDuringIteration()` — catches Bug 1

Walk all `Set.forEach(callback)` and `for...of set` expressions. For each, traverse
the callback body to depth 2 (following called functions). If both `set.delete(x)`
and `set.add(x)` appear on the SAME Set reference within the callback's execution
path, emit the annotation with the ECMAScript §24.2.3.7 citation.

Depth-2 traversal is non-negotiable: the forEach callback calls `_refreshVoterRecord`,
which calls `delete`/`add`. A depth-1 detector misses this entirely.

### `detectVoteRecordTermMismatch()` — catches Bug 2

In any constructor call that produces a `VoteRecord` (or any object with a `term`
field stored in a vote/grant collection), check whether the `term` argument is
`electionTerm - 1` or any expression that evaluates to less than the current
election term variable in scope. If the stored term is demonstrably less than
the term under which the record will be queried, emit the annotation naming the
delta and the compound effect on `checkQuorum`.

---

## UDB classification

| Field             | Value                                                                 |
|-------------------|-----------------------------------------------------------------------|
| Name              | "The Collapsed Register"                                              |
| Tier              | Hard                                                                  |
| Lines             | 2878 (single file)                                                    |
| Bug 1             | `VoteManager.checkQuorum` — Set double-visit (ECMAScript §24.2.3.7) |
| Bug 2             | `VoteManager.promotePreVotesToGrants` — pre-vote→vote with stale term |
| Bug 3             | `_isLogUpToDate` — `>` instead of `>=` (Raft §5.4.1 violation)      |
| Compound          | Bug 2 triggers Bug 1. Bug 3 is independent.                          |
| Trap 1            | `MessageDeduplicator` — zero duplicates in failure logs              |
| Trap 2            | `_handleVoteRequest` term/voted-for checks — all correct             |
| Trap 3            | Bug 3 itself — finding it explains Mode B but not Mode A             |
| Why LLMs fail     | Know forEach+mutation is suspicious but not the spec rule; find Bug 3 or Bug 2 but not both; partial fix passes tests while Bug 1 remains |
| Unravel advantage | Injects ECMAScript §24.2.3.7 citation AND the term-delta compound signal as verified ground truth before token 1 |
