# B-06: Silent Await — Grade Sheet

**Category:** `ASYNC_ORDERING` | **Difficulty:** Easy | **Files:** 3

**Ground truth:** Missing `await` at two levels — `DatabaseService.init()` not awaiting `this.connect()`, and `Application.bootstrap()` not awaiting `this.db.init()`. Root cause file: `DatabaseService.ts` (L34); caller fix also needed in `Application.ts` (L34).

**Proximate fixation trap:** Reporter blames `UserRepository.findById()` / `db.query()` because that's where the `DatabaseNotReadyError` is thrown and the stack trace points. The `isReady` guard looks like overly defensive code misfiring.

---

## Unravel — Gemini 2.5 Flash + AST (hypothesis tree)

| Axis | Score (0-2) | Notes |
|------|-------------|-------|
| RCA  | **2** | Correct file (`DatabaseService.ts` + `Application.ts`), correct lines (L37 / L34), correct mechanism — both `this.connect()` and `this.db.init()` fired without await. Two-level cascade clearly described. |
| PFR  | **2** | H3 ("UserRepository not robust to non-ready DB") explicitly eliminated with `UserRepository.ts L31` evidence — "adding retry logic here would mask the upstream initialization defect." The proximate scapegoat is named and disposed of cleanly. |
| CFR  | **2** | Full timeline: `bootstrap()` fires `db.init()` → `init()` fires `connect()` → `connect()` enqueues `setTimeout` → both return immediately → `handleRequest()` called → `findById()` → `db.query()` → `isReady` is false → `DatabaseNotReadyError` → `connect()` resolves later and sets `isReady = true`. Bug point correctly placed at `query()` checking `isReady`. |
| **Total** | **6/6** | Confidence: 0.95 ✅ (after fix — see verifier note below) |

**Verifier fix this run:** `this.isReady` claim failed match because AST tracks the property as `isReady` (no prefix), but AI output used `this.isReady`. Fixed `orchestrate.js` to also strip `this.` from the **claim** side at match time (not just from knownVars build side).

---

## Claude Sonnet 4.6

| Axis | Score (0-2) | Notes |
|------|-------------|-------|
| RCA  | **2** | Correct: identified both `Application.bootstrap()` and `DatabaseService.init()` as the two sites. Named both missing `await` keywords. |
| PFR  | **1** | Mentions `UserRepository` and `isReady` guard are "blameless" but doesn't explicitly construct and eliminate a hypothesis. No formal H-and-E structure — more of a passing note than a deliberate elimination. |
| CFR  | **2** | Traced the two-level fire-and-forget: `bootstrap()` → `init()` → `connect()` with `setTimeout`. Noted the cold-start vs warm-start asymmetry. |
| **Total** | **5/6** | PFR is half-credit — the trap is acknowledged but not formally eliminated |

---

## Summary

| | Unravel | Claude |
|-|---------|--------|
| RCA | ✅ 2/2 | ✅ 2/2 |
| PFR | ✅ 2/2 | ⚠ 1/2 |
| CFR | ✅ 2/2 | ✅ 2/2 |
| **Total** | **6/6** | **5/6** |

---

## Running Totals (B-01 to B-06)

| Bug | Difficulty | Unravel | Claude | Delta |
|-----|-----------|---------|--------|-------|
| B-01 | Easy | 6/6 | 5/6 | +1 |
| B-02 | Hard | 6/6 | 5/6 | +1 |
| B-03 | Medium | 6/6 | 5/6 | +1 |
| B-04 | Hard | 6/6 | 5/6 | +1 |
| B-05 | Medium | 5/6 | 5/6 | 0 |
| B-06 | Easy | 6/6 | 5/6 | +1 |
| **Total** | | **35/36** | **30/36** | **+5** |
