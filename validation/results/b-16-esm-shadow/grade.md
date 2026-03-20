# B-16: ESM Shadow — Grade Sheet

**Category:** `ENV_DEPENDENCY` | **Difficulty:** Hard | **Files:** 3

**Ground truth:** `pathUtils.ts L3, L7, L11` — all three functions use `__dirname` which is never declared in the module. `app.ts` correctly defines its own `__dirname` via `dirname(fileURLToPath(import.meta.url))` but that definition does NOT carry into `pathUtils.ts` — each ESM module has its own scope. `pathUtils.ts` was simply never updated during the ESM migration. Result: `path.join(undefined, 'public', 'images')` → `"undefined/public/images"` → every static asset returns 404. The console log in the symptom report is the smoking gun.

**Proximate fixation trap:** `symptom.md` blames `app.ts`'s static middleware registration — "replace `buildAssetPath()` with a direct `join(__dirname, ...)` call in the middleware." This is a workaround that only fixes `app.ts`'s one call site and leaves `buildUploadPath` and `buildTemplatePath` broken.

---

## Unravel — Gemini 2.5 Flash + AST

| Axis | Score (0-2) | Notes |
|------|-------------|-------|
| RCA  | **2** | Correct file (`pathUtils.ts`), correct line (L3), correct mechanism: `__dirname` used without ESM declaration. AST `variableStateEdges` explicitly tracked `__dirname` as `read L3 (undefined)` in pathUtils vs correctly `written L4` in app.ts. |
| PFR  | **2** | H1 (`app.ts __dirname` wrong) eliminated: "AST confirms `app.ts L4` correctly defines `__dirname`." H2 (`buildAssetPath` argument undefined) eliminated: "`app.ts L8` passes literal `'images'`." Trap never accepted. |
| CFR  | **2** | Full chain: `getStaticRoot()` → `buildAssetPath('images')` → `pathUtils.ts:L3` → `path.join(undefined, 'public', 'images')` → `"undefined/public/images"` → static middleware → 404. Clean t0–t6 timeline. |
| **Total** | **6/6** | Fix: add `const __dirname = dirname(fileURLToPath(import.meta.url))` to `pathUtils.ts`. |

---

## Claude Sonnet 4.6 (structured prompt)

| Axis | Score (0-2) | Notes |
|------|-------------|-------|
| RCA  | **2** | Correct file (`pathUtils.ts`), correct lines (L4, L8, L12 — the three `join(__dirname...)` calls), correct mechanism. Used the console log symptom directly as evidence: "`join(undefined, 'public', 'images')` → `"undefined/public/images"` — exactly matching the console log." |
| PFR  | **2** | Explicitly cleared `app.ts` as the fix site: "fixing it there means all three utility functions work correctly for every caller, not just the one in `app.ts`." Named the trap without needing to say it's wrong — showed why the correct fix belongs in `pathUtils.ts`. |
| CFR  | **2** | Full 7-hop chain with file:line: `package.json` (`"type": "module"`) → `pathUtils.ts:4` (no `__dirname` def) → `app.ts:8` → `pathUtils.ts:4` (`join(undefined, ...)`) → `"undefined/public/images"` → Express static → 404. Smart to start from `package.json` as the root context. |
| **Total** | **6/6** | Fix: identical `const __dirname = dirname(fileURLToPath(import.meta.url))` addition. |

---

## Summary

| | Unravel | Claude (structured) |
|-|---------|---------------------|
| RCA | ✅ 2/2 — AST tracked __dirname scope per-file | ✅ 2/2 — console log as direct evidence |
| PFR | ✅ 2/2 | ✅ 2/2 |
| CFR | ✅ 2/2 | ✅ 2/2 — chain started from package.json "type":"module" |
| **Total** | **6/6** | **6/6** |

**Tie. Both perfect.** Unravel had a small structural edge: AST cross-file tracking of `__dirname` showed explicitly that it was defined in `app.ts` scope but `undefined` in `pathUtils.ts` scope — this is deterministic, not inferred. Claude used the `"undefined/public/images"` console log in the symptom report as its smoking gun evidence, which is equally valid reasoning.

---

## Running Totals (B-01 to B-16)

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
| B-16 | Hard | 6/6 | 6/6 | 0 |
| **Total** | | **95/96** | **88/96** | **+7** |

\* B-01 to B-11 Claude scores used unstructured prompt.
