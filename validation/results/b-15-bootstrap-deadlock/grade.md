# B-15: Bootstrap Deadlock — Grade Sheet

**Category:** `DEPENDENCY_MANAGEMENT` | **Difficulty:** Hard | **Files:** 4

**Ground truth:** `Gateway.ts:37` / `bootstrap.ts:6` — `UserService` is constructed with `null as unknown as AuthService`. After `AuthService` is built with the incomplete `UserService`, the step to wire `authService` back into `userService` is missing. So `userService.authService` stays `null` forever. On the first request:
1. `Gateway.handle()` → `authService.validateToken()` → `userService.getRoles()` → `this.authService.hasPermission()` on `null` → **TypeError**
2. `catch` block calls `this.authService.logError()` — but logError is undefined (because `authService`'s own `userService` reference is broken) → **another TypeError**
3. That TypeError is caught by the same `catch` → calls `logError` again → **infinite recursion** → **RangeError**

**Proximate fixation trap:** `symptom.md` says the bug is in `Gateway.ts`'s error handler — "the error handler catches an exception and calls `logError` — if `logError` throws, the catch re-catches, creating infinite recursion. Fix: add a try/catch around `logError` or a recursion depth guard." This is the secondary symptom, not the cause.

---

## Unravel — Gemini 2.5 Flash + AST (hypothesis tree)

| Axis | Score (0-2) | Notes |
|------|-------------|-------|
| RCA  | **2** | Correct file (`Gateway.ts L37`), correct mechanism: `null` placeholder for `AuthService` in circular dependency construction, missing the back-injection step. `codeLocation: Gateway.ts:L37`. |
| PFR  | **2** | H2 (`AuthService.logError` itself throws) eliminated: "logError (AuthService.ts L43-L45) simply pushes to a pre-initialized array — this method cannot throw." H3 (user observations inaccurate) eliminated. The Gateway error handler trap is never accepted as the cause. |
| CFR  | **2** | Full T0–T16 timeline with file+line at every step: `buildGateway L37` (null init) → `validateToken` → `getRoles` → `null.hasPermission` (🐛) → TypeError → catch → `logError` undefined → new TypeError → catch → ∞ → RangeError. |
| **Total** | **6/6** | Fix: add `setAuthService()` to `UserService`, call `userService.setAuthService(authService)` in `buildGateway`. Identical to Claude's minimal fix. |

---

## Claude Sonnet 4.6 (structured prompt)

| Axis | Score (0-2) | Notes |
|------|-------------|-------|
| RCA  | **2** | Correct file (`bootstrap.ts:6` and `Gateway.ts:40`), correct mechanism. Also correctly noted the circular dependency is real but resolved in wrong order. Identified `bootstrap.ts:6` as the same null-construction bug. |
| PFR  | **2** | Explicitly named the `Gateway.ts` error handler recursion guard as the proximate trap: "Guarding `logError` stops the stack overflow but leaves the TypeError from `null.hasPermission` intact — the application still fails on every request, just more quietly. The error handler is not the disease; it's where the disease becomes visible." Precise and direct. |
| CFR  | **2** | Full 8-hop chain with file:line: `bootstrap.ts:6` → `bootstrap.ts:7` → `bootstrap.ts:8` → `Gateway.ts:26` → `AuthService.ts:27` → `UserService.ts:24` (🐛) → `Gateway.ts:28` → `Gateway.ts:29` → recursion. Also explained the secondary logError failure correctly. |
| **Total** | **6/6** | Fix: identical `setAuthService` setter + back-injection. Also noted `buildGateway()` at `Gateway.ts:40` has the same null pattern. |

---

## Summary

| | Unravel | Claude (structured) |
|-|---------|---------------------|
| RCA | ✅ 2/2 | ✅ 2/2 — also found bootstrap.ts:6 as parallel bug site |
| PFR | ✅ 2/2 | ✅ 2/2 — "the error handler is not the disease; it's where the disease becomes visible" |
| CFR | ✅ 2/2 | ✅ 2/2 — equally thorough chains |
| **Total** | **6/6** | **6/6** |

**Tie on a Hard bug.** Both produced complete chains through a 4-file circular dependency that crashes with a dual TypeError+RangeError. The structured prompt enabled Claude to match Unravel even on a "Hard" difficulty bug. B-10 remains the only scored gap so far when using the structured prompt.

---

## Running Totals (B-01 to B-15)

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
| B-15 | Hard | 6/6 | 6/6 | 0 |
| **Total** | | **89/90** | **82/90** | **+7** |

\* B-01 to B-11 Claude scores used unstructured prompt.
