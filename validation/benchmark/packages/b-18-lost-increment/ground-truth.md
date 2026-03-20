## Root Cause
**File:** `src/services/VoteService.ts` **Lines:** 28-31
The async read-modify-write sequence `const current = await store.get(id);
await store.set(id, current + 1)` has an unguarded async gap between the
read and the write. Under concurrent load, multiple callers read the same
`current` value before any of them has written back. All callers write
`current + 1`, so N concurrent votes produce a final count of
`initial + 1` instead of `initial + N`.

## Causal Chain
1. Request A: `current = await store.get('poll-1')` → reads 0
2. Request B (concurrent): `current = await store.get('poll-1')` → reads 0
3. Request C (concurrent): `current = await store.get('poll-1')` → reads 0
4. Request A: `await store.set('poll-1', 0 + 1)` → writes 1
5. Request B: `await store.set('poll-1', 0 + 1)` → writes 1 (overwrites A)
6. Request C: `await store.set('poll-1', 0 + 1)` → writes 1 (overwrites B)
7. Final count: 1 instead of 3
Hops: 3 files (VoteRouter → VoteService bug → VoteStore)

## Key AST Signals
- Async boundary: `VoteService.ts L28` — `await store.get()` creates a gap
- The write at L31 `await store.set(id, current + 1)` uses the `current`
  variable captured before the gap — no re-read after the async boundary
- No lock, no CAS (compare-and-swap), no atomic increment between read and write
- `VoteStore.increment()` exists as an atomic method — it is never called
  anywhere in `VoteService.ts`, only `get()` and `set()` are used

## The Fix
```diff
  async recordVote(pollId: string, _userId: string): Promise<VoteResult> {
-   const current = await this.store.get(pollId);
-   const next = current + 1;
-   await this.store.set(pollId, next);
-   return { pollId, count: next };
+   const next = await this.store.increment(pollId);
+   return { pollId, count: next };
  }
```

## Why the Fix Works
`VoteStore.increment()` performs an atomic read-modify-write in a single
operation with no async gap. No concurrent caller can interleave between
the read and the write. Every vote is counted regardless of concurrency.

## Proximate Fixation Trap
The reporter blames `VoteStore.ts` — specifically the `set()` method —
because that is where votes are "lost." Adding logging to `set()` shows
it being called the correct number of times, but with the same value
repeated. The reporter concludes `set()` is deduplicating or caching
writes incorrectly. It is not — it faithfully stores every value it
receives. The values themselves are stale because they were computed
from reads that predated concurrent writes.

## Benchmark Metadata
- Category: `RACE_CONDITION`
- Difficulty: Hard
- Files: 4
- File hops from symptom to root cause: 2 (VoteRouter → VoteService)
- Tests: ① RCA Accuracy ② Proximate Fixation Resistance ③ Cross-file Reasoning
