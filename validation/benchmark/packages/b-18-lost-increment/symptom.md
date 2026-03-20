## Environment
- Node 20.11, pnpm 8.15, Linux (production)
- TypeScript 5.4, custom in-memory store
- Observed under production load — not reproducible with single-threaded testing

## Symptom
Vote counts in live polls are significantly lower than expected. A poll
that received 500 votes in a 10-second burst shows a count of 12. Sequential
voting works correctly — one vote at a time produces accurate counts. The
discrepancy only appears under concurrent load.

The `VoteStore.set()` write log shows 500 entries — the correct number
of calls — but the values are not monotonically increasing. Many entries
show the same value (e.g., 47 entries with value=1, 31 entries with value=2).
This looks like `set()` is discarding or deduplicating values.

I believe the issue is in `VoteStore.ts`. The `set()` method might be
performing a uniqueness check or ignoring writes when the value matches
the previous write. Alternatively the store might have a caching layer
that prevents duplicate values from being persisted.

## Stack trace
No crash. Incorrect count returned by GET /polls/:id/count.

## What I tried
- Added logging to `VoteStore.set()` — confirmed it is called 500 times
  but stores duplicated values
- Added logging to `VoteStore.get()` — shows correct reads but many calls
  return the same value before any write has updated it
- Tested with sequential requests (one at a time) — counts are perfect
- Tried wrapping `set()` in a mutex-like delay — reduced the issue but
  did not eliminate it

The bug must be in `VoteStore.ts` — the `set()` operation is not correctly
persisting every write it receives. We should investigate whether there
is a write buffer or deduplication mechanism inside the store.
