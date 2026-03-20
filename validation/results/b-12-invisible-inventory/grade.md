# B-12: Invisible Inventory — Grade Sheet

**Category:** `DATA_FLOW` | **Difficulty:** Medium | **Files:** 5

**Ground truth:** `ProductSerializer.ts L3` / `L5` — `ALLOWED_FIELDS` omits `'reservedStock'`. The `serialize()` method only copies whitelisted fields, so `reservedStock` is silently stripped from every serialized product. When `CheckoutService.validateAvailability()` receives this `SerializedProduct`, `product.reservedStock` is `undefined` and `?? 0` correctly fires — but its result (0) is wrong because the field was removed upstream. The `?? 0` is not the bug; it is working exactly as designed with missing input data.

**Proximate fixation trap:** `symptom.md` plants the trap directly: "The `?? 0` fallback is suspicious… The bug must be in `CheckoutService.ts`."

> [!NOTE]
> **Prompt note:** The initial Claude result was from a plain "what's the bug?" prompt and only produced a paragraph answer. After giving Claude the standardized structured prompt (hypothesis tree, causal chain with file+line, explicit trap rebuttal), it produced a 6/6 response. **Going forward, Claude results use the structured prompt for fair comparison.**

---

## Unravel — Gemini 2.5 Flash + AST

| Axis | Score (0-2) | Notes |
|------|-------------|-------|
| RCA  | **2** | Correct file (`ProductSerializer.ts`), correct line (L5), correct mechanism. |
| PFR  | **2** | H1 (CheckoutService) and H2 (Repository) explicitly eliminated with file+line. `?? 0` explicitly exonerated. |
| CFR  | **2** | Full chain: Repository → Serializer (🐛) → CheckoutService → `reserved = 0` → `available: true`. Every hop has file+line. |
| **Total** | **6/6** | |

---

## Claude Sonnet 4.6 (structured prompt)

| Axis | Score (0-2) | Notes |
|------|-------------|-------|
| RCA  | **2** | Correct file (`ProductSerializer.ts`), correct line (L3), correct mechanism: `ALLOWED_FIELDS` missing `'reservedStock'`. |
| PFR  | **2** | Explicitly named `CheckoutService ?? 0` as the trap. Explained why it's NOT the bug — it's a type-correct guard for an optional field. |
| CFR  | **2** | Full chain with file:line at every hop: `ProductRepository.ts:21` → `app.ts:24` → `ProductSerializer.ts:3` → `ProductSerializer.ts:5–9` → `app.ts:25` → `CheckoutService.ts:16` → symptom. |
| **Total** | **6/6** | |

---

## Summary

| | Unravel | Claude (structured) |
|-|---------|--------|
| RCA | ✅ 2/2 | ✅ 2/2 |
| PFR | ✅ 2/2 | ✅ 2/2 |
| CFR | ✅ 2/2 | ✅ 2/2 |
| **Total** | **6/6** | **6/6** |

**Tie on a medium bug — expected.** Both engines have sufficient reasoning capacity to trace a 4-hop linear data pipeline. The benchmark's value will emerge on harder bugs (B-15+) where the causal chain is non-obvious and AST-verified facts are decisive. B-10 already demonstrated: Claude got 4/6 with the structured prompt; Unravel got 6/6 after one deterministic AST annotation.

---

## Running Totals (B-01 to B-12)

> B-01 to B-10 Claude scores use original (unstructured) prompt. B-11 onwards use structured prompt.

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
| B-10 | Hard | 6/6 | 4/6 | +2 |
| B-11 | Medium | 6/6 | 5/6* | +1 |
| B-12 | Medium | 6/6 | 6/6 | 0 |
| **Total** | | **71/72** | **64/72** | **+7** |

*B-11 Claude used unstructured prompt — will re-run with structured prompt if needed.
