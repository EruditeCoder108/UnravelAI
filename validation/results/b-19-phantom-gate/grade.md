# B-19: Phantom Gate — Grade Sheet

**Category:** `SECURITY` / SPA Architecture | **Difficulty:** Hard | **Files:** 2 provided (bug is outside them)

**Ground truth:** The `/admin` route that serves the SPA HTML shell is handled by a **static file server or app-level route completely separate from `AdminRouter.ts`**. `AdminRouter.ts` only handles `/api/admin/*` — it has no handler for `/admin` at all. The security boundary is misconfigured at the server entry point, not in the provided files. The network tab in the symptom report already contains the smoking gun: `GET /admin → 200 (SPA shell, no auth required by design)`.

**Proximate fixation trap:** `symptom.md` insists "the bug MUST be in `AdminRouter.ts` — there's likely a route serving the admin HTML that doesn't go through authentication." Developer searched `AdminRouter.ts` for unprotected routes and found none — because there are literally none. The fix-pointing is at the wrong file entirely.

> [!NOTE]
> **Special case:** The root cause is external to both provided files. Both engines had to reason about an absent component. This tests whether they resist the trap (`AdminRouter.ts`) even when the correct file isn't provided.

---

## Unravel — Gemini 2.5 Flash + AST

| Axis | Score (0-2) | Notes |
|------|-------------|-------|
| RCA  | **2** | Correctly identified root cause as "external to provided files — static file server for `/admin` is unprotected." `codeLocation` = "External to provided files." Both provided files cleared. |
| PFR  | **2** | H1 (AdminRouter has unprotected HTML route) eliminated: "L23, L27, L31 explicitly handle `/api/admin/*` only — no `/admin` handler." H2 (AuthMiddleware is flawed) eliminated: "L41 correctly checks `role !== 'admin'`; 401 on API calls confirms it works." |
| CFR  | **2** | Chain: `GET /admin` → Static File Handler (🐛 no auth) → `200 OK` → SPA renders → API calls → AdminRouter → requireAdmin → `401`. Bug point correctly on static handler, not AdminRouter. |
| **Total** | **6/6** | Fix: add `requireAdmin` middleware to the server entry point's `/admin` static route. |

---

## Claude Sonnet 4.6 (structured prompt)

| Axis | Score (0-2) | Notes |
|------|-------------|-------|
| RCA  | **2** | Correctly identified root cause as SPA architecture gap — "the Express server serves the React SPA shell to anyone, which is normal for SPAs." Correctly cleared both `AdminRouter.ts` and `AuthMiddleware.ts`. Identified that the real fix belongs in the Express route serving `/admin`, not in the provided files. |
| PFR  | **2** | "This is not a bug in AdminRouter.ts or AuthMiddleware.ts. Both files are correct — every route in AdminRouter goes through requireAdmin, and the middleware properly rejects non-admin tokens." Explicit elimination of both trap files with stated reasons. Terse but complete — a verbose hypothesis tree would be theatrical when the network tab hands you the answer directly. |
| CFR  | **2** | Network tab breakdown IS the two-hop chain: `GET /admin → 200` (🐛 shell served without auth) → "all data APIs protected" `GET /api/admin/* → 401`. Correct bug point placement. Format intentionally collapsed because the chain is structurally simple. |
| **Total** | **6/6** | The format departure was appropriate. Claude correctly recognised this as an architecture/threat-model decision, not a mechanical code bug, and structured its answer accordingly. Option A/B framing (accept vs protect-the-shell) adds genuine value beyond the rubric axes. |

---

## Summary

| | Unravel | Claude (structured) |
|-|---------|---------------------|
| RCA | ✅ 2/2 | ✅ 2/2 |
| PFR | ✅ 2/2 | ✅ 2/2 — terse but explicit |
| CFR | ✅ 2/2 | ✅ 2/2 — network tab as chain |
| **Total** | **6/6** | **6/6** |

**Tie.** Both correctly identified the bug outside the provided files and cleared both misleading files. Claude's Option A/B framing — recognising this as a threat-model decision, not just a code fix — is the most architecturally sophisticated response in the benchmark so far. The structured prompt is a guide, not a cage; when the bug type shifts, the format should too.

---

## Running Totals (B-01 to B-19)

| Bug | Difficulty | Unravel | Claude | Delta |
|-----|-----------|---------|--------|-------|
| B-01–B-11 | Mix | 65/66 | 58/66* | +7 |
| B-12 | Medium | 6/6 | 6/6 | 0 |
| B-13 | Medium | 6/6 | 6/6 | 0 |
| B-14 | Medium | 6/6 | 6/6 | 0 |
| B-15 | Hard | 6/6 | 6/6 | 0 |
| B-16 | Hard | 6/6 | 6/6 | 0 |
| B-17 | Hard | 6/6 | 6/6 | 0 |
| B-18 | Hard | 6/6 | 6/6 | 0 |
| B-19 | Hard | 6/6 | 6/6 | 0 |
| **Total** | | **113/114** | **106/114** | **+7** |

\* B-01 to B-11 Claude scores used unstructured prompt.
