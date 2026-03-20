## Root Cause
**File:** `src/middleware/RateLimiter.ts` **Line:** 8
`let windowStart = Date.now()` is declared at module scope, outside any
function or class. In a long-running Node.js process this resets once on
startup and then never again. In a serverless environment (Vercel, AWS Lambda,
Cloudflare Workers) the module is initialised on cold start and then reused
across warm invocations. After the TTL window elapses, `windowStart` is still
frozen at cold-start time. The window never advances, all requests accumulate
into the same window forever, and the counter eventually exceeds the limit —
at which point every subsequent request is rejected until the next cold start.

## Causal Chain
1. Cold start: `windowStart = Date.now()` captures e.g. T=1000
2. Requests arrive — counter increments correctly
3. T=1060 (60 seconds later): `Date.now() - windowStart = 60000ms >= windowMs`
4. Code path to reset: `if (Date.now() - windowStart >= windowMs) { count = 0; windowStart = Date.now(); }`
5. This reset path IS correct — but `windowStart` is a module-level `let`
6. In a serverless warm invocation the module was already loaded — `windowStart`
   was captured at T=1000 and lives in module scope across invocations
7. Each invocation runs `check()`, increments `count`, but `windowStart` never
   resets between invocations because the reset only fires when the elapsed time
   crosses the threshold — and every warm invocation sees the same frozen `windowStart`
8. After enough warm invocations within the window, `count > maxRequests` permanently
Hops: 3 files (RequestHandler → RateLimiter bug, observed at route level)

## Key AST Signals
- `windowStart` declared with `let` at module scope, line 8 — outside any class or function
- Written with `Date.now()` at declaration — initialised once on module load
- Read inside `RateLimiter.check()` at L18 — mutation chain shows the only
  other write is inside the `if` block at L21, which depends on the elapsed
  time condition evaluating to true
- In serverless: module scope persists across warm invocations, so
  `windowStart` accumulates elapsed time from cold start, not per-invocation

## The Fix
```diff
- let windowStart = Date.now();
- let count = 0;

  export class RateLimiter {
+   private windowStart = Date.now();
+   private count = 0;

    check(identifier: string): boolean {
-     if (Date.now() - windowStart >= this.windowMs) {
-       count = 0;
-       windowStart = Date.now();
+     if (Date.now() - this.windowStart >= this.windowMs) {
+       this.count = 0;
+       this.windowStart = Date.now();
      }
-     count++;
-     return count <= this.maxRequests;
+     this.count++;
+     return this.count <= this.maxRequests;
    }
  }
```

## Why the Fix Works
Instance properties are initialised each time `new RateLimiter()` is called.
In serverless, the handler creates a new instance per invocation, so
`windowStart` resets correctly. In long-running servers, using instance state
rather than module-level state allows multiple rate limiter instances for
different routes without sharing counts.

## Proximate Fixation Trap
The reporter blames the threshold values — `maxRequests` and `windowMs` —
believing they are too low for the traffic volume. They increase the limits,
which delays the onset of blanket rejection but does not fix the window
never sliding. The issue is visible only in production serverless deployments;
tests always create a fresh module, resetting module-level state automatically.

## Benchmark Metadata
- Category: `TEMPORAL_LOGIC`
- Difficulty: Hard
- Files: 4
- File hops from symptom to root cause: 2 (RequestHandler → RateLimiter)
- Tests: ① RCA Accuracy ② Proximate Fixation Resistance ③ Cross-file Reasoning
