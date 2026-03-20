
## 1. Hypothesis Tree

**H1: `TokenIssuer.ts` — `exp` calculation is wrong, producing a timestamp the validator rejects**
ELIMINATED. `TokenIssuer.ts:25` computes `exp: now + ttlSeconds` where `now = Math.floor(Date.now() / 1000)`. The developer confirmed the decoded `exp` is `now + 3600` — a correct Unix second timestamp. The issuer's arithmetic is fine.

**H2: `TokenIssuer.ts` — `btoa` encoding corrupts the payload in production**
ELIMINATED. The developer confirmed `TokenValidator.decode()` successfully parses the payload and returns the correct `exp` and `sub` values. If encoding were corrupt, `decode()` would return `null`. It doesn't.

**H3: `TokenValidator.ts:24` — `payload.exp` (Unix seconds) is compared against `Date.now()` (Unix milliseconds)**
SURVIVED. `TokenValidator.ts:24`: `return payload.exp > Date.now()`. `payload.exp` is ~`1,720,003,600` (seconds). `Date.now()` returns ~`1,720,003,600,000` (milliseconds). The exp value is always ~1000× smaller than the comparator — every token appears expired the instant it is issued.

---

## 2. Root Cause

**File:** `TokenValidator.ts`, **line 24**

```ts
return payload.exp > Date.now(); // exp is seconds, Date.now() is milliseconds
```

`payload.exp` is a Unix timestamp in **seconds**. `Date.now()` returns milliseconds. The comparison is between values three orders of magnitude apart, so the condition is always false.

---

## 3. Causal Chain

```
[TokenIssuer.ts:23] now = Math.floor(Date.now() / 1000) → correct Unix seconds
[TokenIssuer.ts:26] exp = now + ttlSeconds → e.g. 1_720_003_600
[TokenIssuer.ts:30] payload encoded into token body via btoa
  → [TokenValidator.ts:13] decode() parses body → payload.exp = 1_720_003_600
  → [TokenValidator.ts:24] 1_720_003_600 > Date.now() (≈ 1_720_003_600_000) → false
  → [TokenValidator.ts:24] isValid() returns false
  → [AuthMiddleware.ts:28] validator.isValid(token) === false
  → [AuthMiddleware.ts:29] returns { allowed: false, reason: 'Token is invalid or expired' }
  → [ProtectedRouter.ts:16] !result.allowed → status 401
  → Symptom: every authenticated request rejected
```

---

## 4. Proximate Trap

The report fingers **`TokenIssuer.ts`'s `exp` calculation or encoding**. This is wrong. The issuer produces a perfectly correct Unix-seconds timestamp, and `decode()` recovers it without corruption — the developer's own logs confirm `exp ≈ 1,720,003,600`, which is exactly right. The reason tests pass is that tests likely assert on `decode()` output or mock `isValid()` rather than calling it end-to-end against a real `Date.now()` — the unit under test was never the comparison operator on line 24.

---

## 5. Minimal Fix

Multiply `payload.exp` by 1000 before comparing in `TokenValidator.ts:24`:

```ts
return payload.exp * 1000 > Date.now();
```

No other file needs to change.