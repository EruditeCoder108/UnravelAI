## Root Cause
**File:** `src/auth/TokenValidator.ts` **Line:** 24
`payload.exp > Date.now()` compares JWT expiry (Unix seconds, ~1,700,000,000)
against `Date.now()` (Unix milliseconds, ~1,700,000,000,000). The millisecond
value is always three orders of magnitude larger than the seconds value, so
the comparison is always false — every token appears expired immediately.

## Causal Chain
1. Client sends request with `Authorization: Bearer <token>`
2. `AuthMiddleware.verify()` calls `TokenValidator.isValid(token)`
3. `TokenValidator.decode()` extracts `payload.exp` — a Unix timestamp in seconds
4. `payload.exp > Date.now()` evaluates: e.g. `1,720,000,000 > 1,720,000,000,000`
5. Result is `false` — token is treated as expired regardless of actual expiry
6. `isValid()` returns `false`
7. `AuthMiddleware` rejects the request with 401
8. All authenticated endpoints are inaccessible in production
Hops: 3 files (AuthMiddleware → TokenValidator bug → any protected route)

## Key AST Signals
- Temporal logic: `TokenValidator.ts L24` — `payload.exp` read (units: seconds)
  compared with `Date.now()` call (units: milliseconds) using `>`
- No `* 1000` multiplication or `/ 1000` division anywhere in the expression
  or its immediate context
- Dev tokens in test fixtures use `exp: 9999999999` — 9.9 billion seconds
  is ~316 years from epoch, large enough to survive the units mismatch
  (9.9e9 > 1.72e12 is still false, but test tokens are generated with
  `Date.now() + 3600` which gives millisecond values — this is the only
  reason tests pass: test token exp values are already in milliseconds,
  masking the production bug where real JWT libraries emit seconds)

## The Fix
```diff
- return payload.exp > Date.now();
+ return payload.exp * 1000 > Date.now();
```

## Why the Fix Works
Multiplying `payload.exp` by 1000 converts seconds to milliseconds, making
both sides of the comparison use the same unit. A token expiring at Unix
second 1,720,100,000 becomes 1,720,100,000,000ms which correctly compares
against `Date.now()`.

## Proximate Fixation Trap
The reporter blames the token signing logic in `TokenIssuer.ts` — if tokens
are being issued with wrong expiry values, they would appear expired. They
add extensive logging to `TokenIssuer` and verify the `exp` field looks
correct after signing. It is correct. The bug is one file away in
`TokenValidator.ts` where the units of `exp` are never reconciled with
the units of `Date.now()`.

## Benchmark Metadata
- Category: `TEMPORAL_LOGIC`
- Difficulty: Medium
- Files: 4
- File hops from symptom to root cause: 2 (AuthMiddleware → TokenValidator)
- Tests: ① RCA Accuracy ② Proximate Fixation Resistance
