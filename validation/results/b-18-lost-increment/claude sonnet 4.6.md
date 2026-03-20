
## 1. Hypothesis Tree

**H1: `VoteStore.ts` — `set()` has a deduplication or caching mechanism discarding duplicate values**
ELIMINATED. `VoteStore.ts:17-21`: `set()` unconditionally pushes to `writeLog` and calls `this.counts.set(pollId, value)` with no equality check, no conditional, no buffer. Every call persists exactly what it receives. The write log showing 500 entries with duplicated values is evidence of the *caller* passing duplicate values — not `set()` discarding them.

**H2: `VoteStore.ts:26-32` — `increment()` exists as an atomic alternative but is never used**
SURVIVED (points to fix, not root cause). `VoteStore.ts:26`: `increment()` reads and writes without an `await` gap, making it atomic within the JS event loop. Its existence alongside a non-atomic `get`/`set` pair signals the intended safe path was never wired up.

**H3: `VoteService.ts:16-19` — non-atomic read-modify-write across two `await` boundaries creates a race condition under concurrent load**
SURVIVED (root cause). `VoteService.ts:16`: `const current = await this.store.get(pollId)` — control yields here. `VoteService.ts:17`: `const next = current + 1` — computed locally. `VoteService.ts:18`: `await this.store.set(pollId, next)` — control yields again. Between the `get` and `set` awaits, 499 other concurrent calls can also `get` the same stale value, compute the same `next`, and write the same result. Classic read-modify-write race.

---

## 2. Root Cause

**File:** `VoteService.ts`, **lines 16–18**

```ts
const current = await this.store.get(pollId);  // yields — others read same value
const next = current + 1;
await this.store.set(pollId, next);            // all concurrent callers write same next
```

Two `await` boundaries bracket the read-modify-write, allowing the Node.js event loop to interleave hundreds of concurrent calls against the same stale `current` value.

---

## 3. Causal Chain

```
[VoteService.ts:16] 500 concurrent recordVote() calls all await store.get('poll1')
  → [VoteStore.ts:12] get() awaits 5ms setTimeout — yields to event loop
  → [VoteService.ts:16] all 500 calls resume with current = 0 (nothing written yet)
  → [VoteService.ts:17] all 500 compute next = 0 + 1 = 1
  → [VoteService.ts:18] all 500 await store.set('poll1', 1)
  → [VoteStore.ts:17-20] set() called 500 times — writeLog gets 500 entries, all value=1
  → [VoteStore.ts:20] counts.set('poll1', 1) written 500 times — final count = 1
  → Symptom: 500 votes recorded, count shows 1 (or similarly collapsed value)
```

---

## 4. Proximate Trap

The report blames **`VoteStore.set()` having a deduplication or caching mechanism**. This is wrong. `set()` does exactly what it's told — the 500 duplicate values in the write log are proof the *caller* computed 500 identical `next` values and passed them all in. There is no dedup logic anywhere in `set()`. The log is damning evidence against the store hypothesis, not for it.

---

## 5. Minimal Fix

Use `VoteStore.increment()` in `VoteService.recordVote()` instead of the non-atomic `get`/`set` pair. `increment()` has no `await` between its read and write, making it atomic within a single event loop tick:

```ts
// VoteService.ts
async recordVote(pollId: string, _userId: string): Promise<VoteResult> {
  const next = await this.store.increment(pollId);
  return { pollId, count: next };
}
```

No changes needed in `VoteStore.ts`, `VoteRouter.ts`, or anywhere else. The atomic primitive already exists — it just wasn't being used.