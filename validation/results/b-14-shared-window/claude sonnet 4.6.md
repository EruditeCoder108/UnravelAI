
## 1. Hypothesis Tree

**H1: `RequestHandler.ts` — `maxRequests`/`windowMs` thresholds are too restrictive for production traffic volume**
ELIMINATED. The developer already increased `maxRequests` to 500 — this only delayed onset, didn't fix it. Increasing thresholds can never fix blanket rejection that eventually hits *every* IP including ones that have never made a request, because that symptom is categorically impossible from a per-IP counter working correctly. Tuning thresholds treats a symptom of a different bug.

**H2: `RateLimiter.ts:13` — `check()` ignores `_identifier` and counts all requests globally rather than per-IP**
SURVIVED (contributing). `RateLimiter.ts:13`: the `_identifier` parameter is prefixed with `_` and never used. Every call increments the same global `count` regardless of which IP is making the request. This means all IPs share one counter — but this alone would still reset correctly every 60 seconds.

**H3: `RateLimiter.ts:1-2` — `windowStart` and `count` are module-level variables, making state shared across all `RateLimiter` instances and persistent across the module's lifetime in a serverless container**
SURVIVED (root cause). `RateLimiter.ts:1-2`: `let windowStart` and `let count` are declared at module scope, outside any class. In a serverless environment, the module is loaded once and the container stays warm. The window resets every 60 seconds — but at 200 req/s, `count` hits 100 in 500ms, then the window must expire before it resets. During that 59.5-second wait every request from every IP is rejected. Increasing `maxRequests` just extends how long it takes to hit the ceiling, which matches the observed behaviour exactly.

---

## 2. Root Cause

**File:** `RateLimiter.ts`, **lines 1–2**

```ts
let windowStart = Date.now(); // module-scope — shared across all instances
let count = 0;                // module-scope — shared across all instances
```

State is stored in module-level variables rather than instance fields. Combined with the unused `_identifier` parameter, this creates a single global counter shared by every IP, every `RateLimiter` instance, and every request for the entire lifetime of the serverless container.

---

## 3. Causal Chain

```
[RateLimiter.ts:1-2] count/windowStart declared at module scope, initialised once on container warm-start
  → [RateLimiter.ts:13] check() called — _identifier ignored, no per-IP tracking
  → [RateLimiter.ts:15-18] all IPs increment the same global count
  → [RateLimiter.ts:19] count exceeds maxRequests (100) after ~500ms at 200 req/s
  → [RateLimiter.ts:20] returns false for every IP including ones never seen before
  → [RequestHandler.ts:19] limiter.check() === false
  → [RequestHandler.ts:20-23] returns status 429 for all requests
  → Symptom: blanket rejection until redeployment resets the module
```

---

## 4. Proximate Trap

The report identifies **`RequestHandler.ts` threshold tuning** as the fix. This is wrong. The developer's own experiment proves it: raising `maxRequests` to 500 only pushed onset from ~1 minute to ~5 minutes — exactly proportional to the higher threshold, meaning the underlying accumulation behaviour is unchanged. No threshold value fixes a global counter that is never correctly scoped per-identifier: setting `maxRequests` to 12,000 would give ~1 minute of relief at 200 req/s before the same total lockout.

---

## 5. Minimal Fix

Move `count` and `windowStart` from module scope into instance fields on the class, and actually use `identifier` for per-IP tracking:

```ts
export class RateLimiter {
  private maxRequests: number;
  private windowMs: number;
  private counts: Map<string, number> = new Map();
  private windowStarts: Map<string, number> = new Map();

  constructor(maxRequests: number, windowMs: number) {
    this.maxRequests = maxRequests;
    this.windowMs = windowMs;
  }

  check(identifier: string): boolean {
    const now = Date.now();
    const windowStart = this.windowStarts.get(identifier) ?? now;
    let count = this.counts.get(identifier) ?? 0;

    if (now - windowStart >= this.windowMs) {
      count = 0;
      this.windowStarts.set(identifier, now);
    }

    count++;
    this.counts.set(identifier, count);
    return count <= this.maxRequests;
  }
}
```

No changes needed in `RequestHandler.ts` or `RateLimitConfig.ts`.