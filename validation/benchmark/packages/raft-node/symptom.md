# Bug Report — Intermittent Split Brain in 5-Node Raft Cluster

## Symptom

In a 5-node cluster under production load, two interleaved failure modes appear:

**Mode A (frequent, ~1 in 8 election cycles):** A node wins a leader election and begins
heartbeating, but `_confirmLeadership()` fails — only 1 or 2 peers acknowledge.
The node steps down immediately. `SafetyMonitor` records a `SPLIT_BRAIN` violation:
two nodes were briefly both in state `leader` for the same term.

**Mode B (infrequent, ~1 in 40 election cycles):** An election takes unusually long.
A candidate receives what appears to be a quorum but `_becomeLeader` is never called.
A second election fires. Mode B almost always follows a period where some peers were
network-partitioned and recently rejoined.

Both modes produce `SafetyMonitor.violations()` entries of type `SPLIT_BRAIN`.

## getDiagnostics() at failure point (Mode A)

Node-1 won the election, entered state `leader`, term 9:

```json
{
  "nodeId": "node-1",
  "state": "leader",
  "term": 9,
  "votes": {
    "granted": ["node-2", "node-3", "node-4"],
    "registry": [
      { "voterId": "node-2", "term": 8, "refreshed": true },
      { "voterId": "node-3", "term": 8, "refreshed": true },
      { "voterId": "node-4", "term": 9, "refreshed": false }
    ]
  }
}
```

Three voters in `granted`. Majority of 5 is 3. Election appears valid.
After `_becomeLeader()`, `_confirmLeadership()` sends heartbeats to all 4 peers.
Only node-4 acknowledges. node-2 and node-3 believe a different node is leader.
Confirmed count = 2 < 3. Node-1 steps down.

## getDiagnostics() at failure point (Mode B)

```json
{
  "nodeId": "node-1",
  "state": "candidate",
  "term": 9,
  "votes": {
    "granted": ["node-2", "node-3"],
    "registry": [
      { "voterId": "node-2", "term": 9, "refreshed": false },
      { "voterId": "node-3", "term": 9, "refreshed": false }
    ]
  }
}
```

Two real votes. Majority needs 3. node-4 and node-5 sent vote responses but
`_handleVoteRequest` on their end rejected the candidate.

## What the team investigated

1. **MessageDeduplicator TTL:** Suspected vote messages from reconnected nodes were being
   deduplicated (expired TTL → second vote passes dedup → both counted). Checked
   `_msgDedup.stats()` across all failure events — duplicate drop rate is near zero.
   Not the cause.

2. **`_handleVoteRequest` grant logic:** `alreadyVoted` guard and `termOk` checks look
   correct. Added logging: every grant in failing elections is a legitimate vote request
   from the correct candidate in the correct term.

3. **`_isLogUpToDate` comparison:** Mode B logging shows peers ARE rejecting votes even
   when the candidate's log is equal in length (`lastIndex` and `lastTerm` identical).
   This explains Mode B — but fixing the log comparison alone does not prevent Mode A.

## Critical observation

In every Mode A failure, `votes.registry` shows **two voters with `term: N-1`** and
one voter with `term: N` (N = election term). The `term: N-1` voters always correspond
to nodes that participated in the **pre-vote phase** before the full election.

The `term: N-1` voters have `refreshed: true`. Checking their local state confirms
they voted for a *different* candidate in term N — not for node-1. Yet they appear
in node-1's `granted` set.

We cannot explain why pre-vote participants appear as full-vote grants for an election
they did not vote in, or why their presence inflates the quorum count above 3.
