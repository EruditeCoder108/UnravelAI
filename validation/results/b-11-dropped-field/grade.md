# B-11: Dropped Field — Grade Sheet

**Category:** `DATA_FLOW` | **Difficulty:** Medium | **Files:** 4

**Ground truth:** `ProfileMapper.toInternal()` at `src/mappers/ProfileMapper.ts L6` explicitly omits `avatarUrl` from the destructure of `profile` and then sets `avatarUrl: undefined as unknown as string` — a type-cast hack that silences TypeScript while knowingly discarding the field. `ExternalMapper` correctly maps `avatar_url → avatarUrl`, and `ProfileService` correctly invokes both mappers, so the bug sits entirely in `ProfileMapper`.

**Proximate fixation trap:** `symptom.md` points blame at the display layer — "The bug must be in the display components. The component is receiving a user object where `avatarUrl` is undefined, so either the prop drilling is dropping it or the component's internal state handling is resetting it." A naive engine fixates on `UserCard` / `UserProfile` interfaces.

---

## Unravel — Gemini 2.5 Flash + AST (hypothesis tree)

| Axis | Score (0-2) | Notes |
|------|-------------|-------|
| RCA  | **2** | Correct file (`ProfileMapper.ts`), correct line (L6), correct mechanism: `avatarUrl` omitted from destructuring, then explicitly set to `undefined as unknown as string`. Cited verbatim from source. |
| PFR  | **2** | Hypothesis tree explicitly eliminated H1 (API missing field — ruled out by `ProfileService.ts L9`) and H2 (`ExternalMapper` drops the field — ruled out by `ExternalMapper.ts L8: avatarUrl: raw.avatar_url`). Never touched the display layer trap. |
| CFR  | **2** | Full causal chain: `fetchFromApi` → `ExternalMapper.toProfile` (maps correctly) → `ProfileMapper.toInternal` (🐛 drops field, sets `undefined`) → `InternalUser` returned with `avatarUrl: undefined` → frontend receives `undefined` → broken image. Every hop has file+line evidence. |
| **Total** | **6/6** | Confidence 0.95. Fix is exact one-liner: add `avatarUrl` to destructuring, remove the `undefined` cast. |

**Note on verifier warning:** The verifier flagged `variableStateEdge: avatarUrl` as "variable not found in AST mutation chains (may be non-JS)". This is expected — `avatarUrl` is a field inside a returned object literal, not a standalone JS variable mutation. The verifier applied a soft confidence penalty (0) and correctly continued. Diagnosis was unaffected.

---

## Claude Sonnet 4.6

| Axis | Score (0-2) | Notes |
|------|-------------|-------|
| RCA  | **2** | Correct file, correct line, correct mechanism — `ProfileMapper.toInternal()` omits `avatarUrl` from destructuring and explicitly sets it to `undefined as unknown as string`. |
| PFR  | **2** | Explicitly cleared the display layer trap: "The display layer, ProfileService, ExternalMapper, and the interfaces are all fine." Direct and precise. |
| CFR  | **1** | Correct root node and fix, but the causal chain is compressed — does not explicitly trace `ExternalMapper → ProfileMapper → InternalUser → Frontend` with file/line evidence at each hop. States the mechanism correctly but skips intermediate evidence. |
| **Total** | **5/6** | Clean diagnosis, slightly less structured chain than Unravel. |

---

## Summary

| | Unravel | Claude |
|-|---------|--------|
| RCA | ✅ 2/2 | ✅ 2/2 |
| PFR | ✅ 2/2 | ✅ 2/2 |
| CFR | ✅ 2/2 — full chain with file+line at every hop | ⚠ 1/2 — correct mechanism, no intermediate evidence |
| **Total** | **6/6** | **5/6** |

Both correctly identified the `undefined as unknown as string` type-cast hack as the smoking gun. Unravel's hypothesis tree trace (H1 → H2 → H3 survived) gave it a tighter chain.

---

## Running Totals (B-01 to B-11)

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
| B-11 | Medium | 6/6 | 5/6 | +1 |
| **Total** | | **65/66** | **58/66** | **+7** |
