# B-09: Trusted Input — Grade Sheet

**Category:** `DATA_FLOW` / `TYPE_MISMATCH` | **Difficulty:** Hard | **Files:** 4

**Ground truth:** `req.query.total` (always a string in Express) is assigned directly to `cart.total` without parsing. `as unknown as CartSummary` silences TypeScript. In `DiscountService.validate()`, `discount.minOrderValue > cart.total` coerces `"$30"` → `NaN` → `200 > NaN = false` → minimum order check bypassed → discount granted.

**Proximate fixation trap:** Reporter sees `discount.minOrderValue` is 200 and the comparison uses `>` — suspects the operator or the stored value is wrong. Changing `>` to `>=` has zero effect because `200 >= NaN` is also `false`.

---

## Unravel — Gemini 2.5 Flash + AST (hypothesis tree)

| Axis | Score (0-2) | Notes |
|------|-------------|-------|
| RCA  | **2** | Correct file (`CartRouter.ts L21`), correct mechanism — `req.query` string → direct assignment → `as unknown as CartSummary` bypasses TS → NaN coercion at `DiscountService.ts L41`. Cross-file data flow traced precisely. |
| PFR  | **2** | H2 ("minOrderValue wrong") eliminated with `DiscountService.ts L10`. H3 ("`>` should be `>=`") eliminated — "changing the operator would not fix the NaN coercion." Both proximate suspects disposed. |
| CFR  | **2** | 8-node timeline through JS runtime coercion: string `"$30"` → NaN → `200 > NaN = false` → `valid: true`. Correctly identifies `CartRouter.ts L21` as the bug point, not `DiscountService.ts`. |
| **Total** | **6/6** | Confidence: 0.95 ✅ |

**Fix quality note:** Unravel's fix uses `parseFloat(String(total).replace(/[^0-9.]/g, '')) || 0`. The `|| 0` fallback is subtly wrong — a completely invalid string silently becomes 0, which may pass or fail validation in misleading ways rather than returning a clear error. Functionally fixes the NaN bug but hides invalid input instead of rejecting it.

---

## Claude Sonnet 4.6

| Axis | Score (0-2) | Notes |
|------|-------------|-------|
| RCA  | **2** | Correct: `CartRouter.ts L17`, same mechanism, additionally explained the NaN property table (all comparisons with NaN = false) and the desktop/mobile client asymmetry (plain `"150"` works, `"$150"` fails). |
| PFR  | **2** | Explicitly cleared `DiscountService` ("fix doesn't belong there — adding `Number()` inside validate would fix the symptom but make the service silently responsible for sanitising bad data from every possible caller"). Cleared the `>` vs `>=` operator hypothesis with precise NaN reasoning. |
| CFR  | **2** | Included the client format table showing exactly when NaN fires, explained `%24` URL-encoding in the stack trace, and noted the bonus note about `4.5` vs `NaN` arithmetic inconsistency in the reporter's example. |
| **Total** | **6/6** | Claude's explanation was more thorough but score is same — extra depth doesn't change the rubric |

**Fix quality note:** Claude's fix uses `parseFloat(total)` + explicit `isNaN(...) || parsedTotal < 0` guard returning HTTP 400. Correct and complete — invalid input is rejected at the boundary with a clear error, not silently coerced to 0. Also replaces `as unknown as CartSummary` with `satisfies CartSummary` — TypeScript will now catch this class of bug at compile time.

**Winner on fix quality: Claude**

---

## Summary

| | Unravel | Claude |
|-|---------|--------|
| RCA | ✅ 2/2 | ✅ 2/2 |
| PFR | ✅ 2/2 | ✅ 2/2 |
| CFR | ✅ 2/2 | ✅ 2/2 |
| **Total** | **6/6** | **6/6** |
| **Fix quality** | ⚠ `\|\| 0` silent fallback | ✅ `isNaN` guard + 400 + `satisfies` |

---

## Running Totals (B-01 to B-09)

| Bug | Difficulty | Unravel | Claude | Delta |
|-----|-----------|---------|--------|-------|
| B-01 | Easy | 6/6 | 5/6 | +1 |
| B-02 | Hard | 6/6 | 5/6 | +1 |
| B-03 | Medium | 6/6 | 5/6 | +1 |
| B-04 | Hard | 6/6 | 5/6 | +1 |
| B-05 | Medium | 5/6 | 5/6 | 0 |
| B-06 | Easy | 6/6 | 5/6 | +1 |
| B-07 | Medium | 6/6 | 6/6 | 0 |
| B-08 | Medium | 6/6 | 6/6 | 0 |
| B-09 | Hard | 6/6 | 6/6 | 0 |
| **Total** | | **53/54** | **48/54** | **+5** |
