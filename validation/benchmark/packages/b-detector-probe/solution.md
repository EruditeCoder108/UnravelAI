# Solution — b-detector-probe

## What this bug tests

This is a **detector validation probe** — not a real benchmark.
Its only purpose is to verify that `detectForEachCollectionMutation` fires
correctly under two conditions:

1. **Direct mutation** (depth-0): `this._subscribers.delete/add` inside the
   `forEach` callback body directly → `broadcastDirect()`
2. **Indirect via helper** (depth-1): `this._promote()` is called from the 
   callback; inside `_promote`, `this._subscribers.delete/add` → `broadcast()`

This is structurally identical to the raft-node bug:
- `VoteManager.checkQuorum` → `this._grantedVotes.forEach`
- Inside callback: `this._refreshVoterRecord(voterId, ...)` (depth-1)
- Inside `_refreshVoterRecord`: `this._grantedVotes.delete + .add`

## Expected detector output

If the engine is working correctly, the AST annotation section should contain:

```
🔴 CRITICAL: this._subscribers.forEach()  L57
  Mutations inside callback: delete() L59, add() L60
  ECMA-262 spec: deleted-then-re-added elements ARE visited again...
```

AND:

```
🔴 CRITICAL: this._subscribers.forEach()  L73
  Mutations inside callback: delete() (via _promote()) L80, add() (via _promote()) L81
  ECMA-262 spec: deleted-then-re-added elements ARE visited again...
```

## Diagnosis

ECMAScript §24.2.3.7 (`Set.prototype.forEach`):
> A value will be revisited if it is deleted before it has been visited
> and then re-added before the forEach call completes.

`_promote()` does exactly `delete + add` on the same Set being iterated.
This causes the promoted subscriber to be visited twice per broadcast.

## Root Cause

`NotificationHub._promote()` uses `delete + add` on `this._subscribers` to
move a record to the tail of the Set. When called from inside
`this._subscribers.forEach(...)`, this triggers the re-visit behavior
specified in §24.2.3.7.

## Minimal Fix

```js
// Option A: snapshot before iterating
broadcast(event) {
    for (const id of [...this._subscribers]) {
        const record = this._registry.get(id);
        if (!record) return;
        if (record.priority && !record.promoted) this._promote(id);
        record.fn(event);
        this._fired++;
    }
}

// Option B: separate the promote phase
broadcast(event) {
    // Phase 1: promote all priority subscribers (mutates Set safely, no forEach)
    for (const id of this._subscribers) {
        const rec = this._registry.get(id);
        if (rec?.priority && !rec.promoted) this._promote(id);
    }
    // Phase 2: notify all (Set is now stable)
    for (const id of this._subscribers) {
        const rec = this._registry.get(id);
        if (rec) { rec.fn(event); this._fired++; }
    }
}
```
