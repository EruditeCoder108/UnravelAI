## Root Cause
**File:** `src/services/DatabaseService.ts` **Line:** 34  
`this.connect()` is called without `await` inside `init()`. `connect()` is
an async function that returns a Promise. Without `await`, execution continues
immediately — `this.isReady` is never set to `true` before the first query
attempt, so every query issued during the connection window throws.

## Causal Chain
1. `Application.bootstrap()` calls `db.init()` — but does NOT await it
2. `db.init()` calls `this.connect()` — but does NOT await it internally
3. `connect()` begins an async TCP handshake (simulated with setTimeout)
4. Execution returns immediately — `this.isReady` is still `false`
5. `Application.bootstrap()` calls `userRouter.handleRequest()` synchronously
6. `UserRepository.findById()` calls `db.query()` — checks `this.isReady`
7. `this.isReady === false` → throws `DatabaseNotReadyError`
8. In warm environments this is invisible: `connect()` resolves before
   the first real request arrives. On cold start or fast test runners,
   the race is lost every time.
Hops: 3 files (Application → DatabaseService bug, UserRepository observes it)

## Key AST Signals
- Floating promise: `DatabaseService.ts L34` — `this.connect()` called as
  expression statement, no `await`, no `.then()` — detected by `isAwaited` guard
- `connect()` is declared `async` (returns Promise) — AST confirms it is async
- `this.isReady` written inside `connect()` at L48 — read in `query()` at L58
  — mutation chain shows write is in async body never awaited by callers
- `Application.ts`: `db.init()` also called without `await` — second floating promise

## The Fix
```diff
  async init(): Promise<void> {
-   this.connect();
+   await this.connect();
    console.log('[DB] Init complete');
  }
```
And in `Application.bootstrap()`:
```diff
- db.init();
+ await db.init();
  userRouter.handleRequest(req);
```

## Why the Fix Works
`await` pauses execution until the Promise resolves. `this.isReady` is set
to `true` inside `connect()` after the handshake completes. With `await`,
no caller can reach `query()` before `isReady` is true.

## Proximate Fixation Trap
The reporter blames `UserRepository.findById()` because that is where
the `DatabaseNotReadyError` is thrown — the stack trace points directly
at it. The `isReady` guard inside `query()` looks like overly defensive
code that is misfiring. The actual bug is two files away: the missing
`await` in `DatabaseService.init()` means the guard is correct and
necessary — it's the initialization that is broken, not the guard.

## Benchmark Metadata
- Category: `ASYNC_ORDERING`
- Difficulty: Easy
- Files: 3
- File hops from symptom to root cause: 2 (UserRepository → DatabaseService)
- Tests: ① RCA Accuracy ② Proximate Fixation Resistance
