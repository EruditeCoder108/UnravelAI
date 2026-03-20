# B-14: Shared Window — Grade Sheet

**Category:** `DATA_FLOW` / `STATE_MANAGEMENT` | **Difficulty:** Medium | **Files:** 3

**Ground truth:** `RateLimiter.ts L1-L2` — `let windowStart` and `let count` are declared at **module scope**, outside the class. This means all `RateLimiter` instances in a process share the same counter. Additionally, `check(_identifier)` ignores the identifier — there is no per-IP tracking, so all IPs share one global counter. In a serverless warm container at 200 req/s, the 100-request limit fills in 500ms, then every request (from any IP, including ones never seen before) is rejected for the remaining 59.5 seconds. Increasing `maxRequests` only delays onset proportionally — as the developer's experiment confirmed.

**Proximate fixation trap:** `symptom.md` says the fix is to increase `maxRequests` to 1000 in `RequestHandler.ts`. The developer already proved this wrong: raising to 500 only pushed onset from ~1 min to ~5 min, proportionally.

---

## Unravel — Gemini 2.5 Flash + AST

| Axis | Score (0-2) | Notes |
|------|-------------|-------|
| RCA  | **2** | Correct file (`RateLimiter.ts`), correct lines (L1-L2), correct mechanism: module-scoped `count`/`windowStart` instead of instance properties. AST mutation chains correctly traced `windowStart` and `count` as originating at `(module scope)` and mutated inside `check()`. |
| PFR  | **2** | H1 (state resets on every request) eliminated with "if state reset on every request, maxRequests would be irrelevant" — clean logical elimination. H2 (window condition never resets) eliminated by reading the actual code. `RequestHandler.ts` threshold tuning never accepted. |
| CFR  | **2** | Full chain: module loaded (globals initialized) → `limiter` instance uses module-scoped state → `count` exceeds `maxRequests` → `check()` returns false → `RequestHandler.ts:20` → HTTP 429. Every hop cited with file+line. |
| **Total** | **6/6** | Confidence 0.95. Fix is structurally correct: moves `count`/`windowStart` to instance properties. |

**Note:** Unravel's fix moves state to instance properties but retains `_identifier` as unused — still a global counter, just scoped per-instance not per-module. In a serverless context where one warm container handles all 200 req/s, this is the meaningful fix. Claude's fix goes further (per-IP Map), which is the architecturally complete solution.

---

## Claude Sonnet 4.6 (structured prompt)

| Axis | Score (0-2) | Notes |
|------|-------------|-------|
| RCA  | **2** | Correct file (`RateLimiter.ts`), correct lines (L1-L2), correct mechanism. Also explicitly identified H2 (contributing): `_identifier` unused means no per-IP tracking — all IPs share one counter. Precise timing: "100 requests in 500ms at 200 req/s → 59.5s of blanket rejection." |
| PFR  | **2** | Named `RequestHandler.ts` threshold tuning explicitly as the trap. Used developer's own experiment as proof: "raising to 500 delayed onset to ~5 minutes — exactly proportional, the accumulation is unchanged." Airtight rebuttal. |
| CFR  | **2** | Full chain: `RateLimiter.ts:1-2` → `RateLimiter.ts:13` (identifier ignored) → `RateLimiter.ts:15-18` (global count++) → `RateLimiter.ts:19-20` (count > maxRequests → false) → `RequestHandler.ts:19-23` → 429. Timing analysis at every step. |
| **Total** | **6/6** | Fix is architecturally superior: per-IP `Map<string, {count, windowStart}>`, not just instance scope. |

---

## Summary

| | Unravel | Claude (structured) |
|-|---------|---------------------|
| RCA | ✅ 2/2 | ✅ 2/2 — also identified unused `_identifier` |
| PFR | ✅ 2/2 | ✅ 2/2 — used developer's own experiment as proof |
| CFR | ✅ 2/2 | ✅ 2/2 — more precise timing analysis |
| **Total** | **6/6** | **6/6** |

**Tie again, but Claude's analysis was notably deeper.** Both got the correct file/lines/mechanism and resisted the trap. Claude additionally identified the unused identifier bug and produced the architecturally complete fix (per-IP Map). Unravel's minimal fix is correct for the serverless single-instance case but incomplete for multi-client isolation.

---

## Running Totals (B-01 to B-14)

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
| B-14 | Medium | 6/6 | 6/6 | 0 |
| **Total** | | **83/84** | **76/84** | **+7** |

\* B-01 to B-11 Claude scores used unstructured prompt — CFR penalty likely accounts for most -1s.
