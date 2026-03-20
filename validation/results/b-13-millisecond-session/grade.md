# B-13: Millisecond Session — Grade Sheet

**Category:** `TEMPORAL_LOGIC` | **Difficulty:** Medium | **Files:** 4

**Ground truth:** `TokenValidator.ts:23` — `payload.exp > Date.now()`. `TokenIssuer` sets `exp` with `Math.floor(Date.now() / 1000)` — Unix seconds (~1.72 billion). `Date.now()` returns milliseconds (~1.72 trillion). The comparison is always false. Fix: `payload.exp * 1000 > Date.now()`. The symptom that "tests pass but prod fails" is a red herring on the surface — actually tests also call `isValid()` the same way, but likely mock `Date.now()` or don't test the full flow end-to-end.

**Proximate fixation trap:** `symptom.md` points at `TokenIssuer.ts` — "the `exp` field calculation or token encoding is producing values that the validator rejects… possibly a timezone or locale issue affecting `Date.now()` on the production host."

---

## Unravel — Gemini 2.5 Flash + AST

| Axis | Score (0-2) | Notes |
|------|-------------|-------|
| RCA  | **2** | Correct file (`TokenValidator.ts`), correct line (L23), correct mechanism: `payload.exp` (seconds) vs `Date.now()` (milliseconds). Cited `TokenIssuer.ts:L20` as proof that `exp` is in seconds. |
| PFR  | **2** | H1 (`TokenIssuer exp` wrong) eliminated: "produces a valid Unix timestamp in seconds, semantically correct." H2 (`decode()` corrupt) eliminated: developer confirmed decode returns non-null payload. Neither trap in the symptom.md touched. |
| CFR  | **2** | Full chain: `TokenIssuer.ts:L20` (exp set in seconds) → `TokenValidator.ts:L23` (🐛 compared to milliseconds → always false) → `AuthMiddleware.ts:L21` (isValid false) → 401. Every hop cited. |
| **Total** | **6/6** | Confidence 0.95. Also found a bonus: missing signature verification is a critical security flaw. Fix + security note. |

**Bonus finding:** Unravel's `aiPrompt` explicitly called out that `TokenValidator.decode()` never verifies the signature against `TokenIssuer`'s generated signature — a complete authentication bypass. Not required for grading but genuinely useful.

---

## Claude Sonnet 4.6 (structured prompt)

| Axis | Score (0-2) | Notes |
|------|-------------|-------|
| RCA  | **2** | Correct file (`TokenValidator.ts`), correct line (24), correct mechanism. Also noted the concrete numbers: `1,720,003,600` (seconds) vs `1,720,003,600,000` (ms) — "always ~1000× smaller." |
| PFR  | **2** | Explicitly named `TokenIssuer.ts exp calculation or encoding` as the trap. Explained why tests pass: "tests likely assert on `decode()` output or mock `isValid()` rather than calling it end-to-end." Clean rebuttal. |
| CFR  | **2** | Full chain with file:line at every hop: `TokenIssuer.ts:23` → `TokenIssuer.ts:26` → `TokenIssuer.ts:30` → `TokenValidator.ts:13` → `TokenValidator.ts:24` (🐛) → `AuthMiddleware.ts:28` → `AuthMiddleware.ts:29` → `ProtectedRouter.ts:16` → 401. |
| **Total** | **6/6** | |

---

## Summary

| | Unravel | Claude (structured) |
|-|---------|---------------------|
| RCA | ✅ 2/2 | ✅ 2/2 |
| PFR | ✅ 2/2 | ✅ 2/2 |
| CFR | ✅ 2/2 | ✅ 2/2 |
| **Total** | **6/6** | **6/6** |

**Tie again on a medium bug.** Both engines correctly traced the seconds/milliseconds unit mismatch across the issuer→validator boundary. Claude's chain was actually more granular (8 hops vs Unravel's 5). Unravel's bonus security finding is outside the scope of the grading axes but adds real value.

**Pattern emerging:** On well-defined medium bugs with a clear linear mechanism, both engines match at 6/6 with the structured prompt. The benchmark will diverge on B-14 (shared-window — serverless singleton scope) and B-15 (bootstrap-deadlock — circular DI), where the mechanism is architecturally subtle.

---

## Running Totals (B-01 to B-13)

| Bug | Difficulty | Unravel | Claude | Delta |
|-----|-----------|---------|--------|-------|
| B-01 | Easy | 6/6 | 5/6* | +1 |
| B-02 | Hard | 6/6 | 5/6* | +1 |
| B-03 | Medium | 6/6 | 5/6* | +1 |
| B-04 | Hard | 6/6 | 5/6* | +1 |
| B-05 | Medium | 5/6 | 5/6* | 0 |
| B-06 | Easy | 6/6 | 5/6* | +1 |
| B-07 | Medium | 6/6 | 6/6* | 0 |
| B-08 | Medium | 6/6 | 6/6* | 0 |
| B-09 | Hard | 6/6 | 6/6* | 0 |
| B-10 | Hard | 6/6 | 4/6* | +2 |
| B-11 | Medium | 6/6 | 5/6* | +1 |
| B-12 | Medium | 6/6 | 6/6 | 0 |
| B-13 | Medium | 6/6 | 6/6 | 0 |
| **Total** | | **77/78** | **70/78** | **+7** |

\* B-01 to B-11 Claude scores used unstructured prompt — CFR penalty likely accounts for most of the -1s.
