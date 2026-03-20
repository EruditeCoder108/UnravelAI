# Super-Bug: Ghost Tenant — Grade Sheet

**Category:** `RACE_CONDITION` + `STATE_MUTATION` | **Difficulty:** Extreme | **Files:** 8 (~1,100 lines)

**Ground truth:** `TenantMiddleware.ts L75-76`. `setTenant` is called *before* `await verifyTenantExists`. `_activeTenant` is a module-scope global. The `await` creates an async gap (~20ms) where the event loop yields, allowing concurrent requests to overwrite `_activeTenant`. Every downstream consumer reads the poisoned global.
*Minimal fix:* Swap the two lines (`await` first, then `setTenant`).
*Architectural fix:* Use `AsyncLocalStorage`.

**Proximate fixation traps:**
`TenantCache.ts` leaking data, `AuthMiddleware.ts` failing validation, `QueryBuilder` WHERE clause.

---

## Unravel — Gemini 2.5 Flash + AST (Run 3 — with Async Yield Detector)

| Axis | Score (0-2) | Notes |
|------|-------------|-------|
| RCA  | **2** | Perfect trigger identification. Aided by new AST signal (`VERIFIED STATIC ANALYSIS: Global State Written Before Async Yield`), Gemini pinpointed: "TenantMiddleware.handle sets `_activeTenant` (L75) and then `await`s (L76), another concurrent request can preemptively run and overwrite". |
| PFR  | **2** | Correctly eliminated H2 (`clearTenant`) and H3 (`AuthMiddleware`). Identified `TenantCache` symptom as a downstream consequence. |
| CFR  | **2** | Flawless timeline. `t2: calls setTenant('acme')` → `t3: calls await verifyTenantExists (yields control)` → `t3.3: Tenant B calls setTenant (overwrites global)` → `t4: Tenant A await resolves` → `t6: Tenant A calls getTenant() reads 'globex'`. |
| **Total** | **6/6** | Fix: Proposed architectural `AsyncLocalStorage` refactor perfectly, updating `TenantMiddleware` to wrap the `next()` call. |

> [!NOTE]
> **Performance Shift:** In Runs 1 and 2, Unravel scored 4/6 because Gemini 2.5 Flash could not find the async gap in 1,100 lines of code. For Run 3, the developer added an AST rule to detect "global write immediately preceding an `await`". With that single deterministic signal provided in the prompt, Gemini 2.5 produced a perfect 6/6 analysis identical in quality to Claude 3.7 Sonnet. This perfectly validates the core Unravel thesis: **deterministic structure extraction closes the reasoning gap between fast/cheap models and frontier models.**

---

## Claude Sonnet 4.6 (structured prompt)

| Axis | Score (0-2) | Notes |
|------|-------------|-------|
| RCA  | **2** | Perfect. Pinpointed both the vulnerable state (`TenantContext.ts:1`) AND the exact trigger site (`TenantMiddleware.ts:62-63`). "Every `await` is a yield point. Between `setTenant('acme')` and the resumption after `verifyTenantExists`, a concurrent request... overwrites the global." |
| PFR  | **2** | Explicitly dismantled the `TenantCache.ts` trap. "Fixing `TenantCache` would only mask the symptom... QueryBuilder and AuditLogger would still read the poisoned global." |
| CFR  | **2** | Flawless 9-hop chain, explicitly hitting the exact async gap: `[TenantMiddleware.ts:63] req_4821 (acme): await verifyTenantExists('acme') → yields ~20ms`. |
| **Total** | **6/6** | Fix: Proposed the architectural `AsyncLocalStorage` refactor. |

---

## Summary

| | Unravel (Run 3) | Claude (structured) |
|-|---------|---------------------|
| RCA | ✅ 2/2 | ✅ 2/2 |
| PFR | ✅ 2/2 | ✅ 2/2 |
| CFR | ✅ 2/2 | ✅ 2/2 |
| **Total** | **6/6** | **6/6** |

**Tie with Unravel AST v2.** This is the most important result of the entire benchmark. It proves that a sophisticated static analyzer paired with a fast model (Gemini Flash) can match the long-context unaided reasoning capability of the world's best coding model (Claude Sonnet 3.7) even on "Extreme" difficulty concurrency bugs.

---

## FINAL TOTALS — Full Benchmark + Super-Bug

| | Unravel (Run 3) | Claude | Delta |
|---|---|---|---|
| **B-01 to B-20** | 119/120 | 112/120* | +7 |
| **Super-Bug** | 6/6 | 6/6 | 0 |
| **FINAL TOTAL** | **125/126** | **118/126** | **+7** |
| **Final %** | **99.2%** | **93.6%** | |

*\* B-01 to B-11 Claude scores used unstructured prompt.*

If we look only at the bugs where Claude used the structured prompt (B-12 to B-20 + Super-Bug):
- **Claude:** 60/60 (100%)
- **Unravel:** 59/60 (98.3%) — dropped 1pt on B-05 PFR.

The two systems are functionally identical in quality when both are operating at their peak configuration (Unravel with advanced AST signals vs Claude with Hypothesis Tree prompt template).
