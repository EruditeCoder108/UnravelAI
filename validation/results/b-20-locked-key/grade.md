# B-20: Locked Key — Grade Sheet

**Category:** `ENV_DEPENDENCY` | **Difficulty:** Hard | **Files:** 3

**Ground truth:** `ShortcutHandler.ts:L30` (second run) / `L31` (first run) — `this.registry.lookup(event.key, modifiers)`. `event.key` is the OS/layout-translated character (`]` on US, `+` on German QWERTZ). `event.code` is always `BracketRight` regardless of layout. Both registration and lookup must use `event.code` consistently.

**Proximate fixation trap:** `symptom.md` blames `ShortcutHandler.ts` and suggests a key translation table. The developer tried this — it broke other layouts. A translation table is an infinite maintenance surface with no correct terminal state.

> [!NOTE]
> **First run vs second run:** First run (wrong files given) proposed a translation table fix — the exact trap from symptom.md. Second run (correct files) produced the clean `event.code` refactor. Grading uses the second run.

---

## Unravel — Gemini 2.5 Flash + AST (second run)

| Axis | Score (0-2) | Notes |
|------|-------------|-------|
| RCA  | **2** | Correct file (`ShortcutHandler.ts L30` + `ShortcutRegistry.ts:normalize L21`), correct mechanism: `event.key` (layout-dependent character) vs `event.code` (physical key, layout-invariant). Console noted: `LAYER_BOUNDARY` — the distinguishing information is already lost by the time the JS code receives the event. |
| PFR  | **2** | H2 (`registerDefaults` uses incorrect key strings) eliminated: "']' is the correct logical key as intended for US layout — the problem is its interpretation across layouts." H3 (modifier normalization wrong) eliminated: "Cmd+F and Cmd+S work fine on all layouts, contradicting a global modifier issue." Translation table trap never accepted. |
| CFR  | **2** | Full 8-hop chain: `KeyboardManager:L23` (registered `key: ']'`) → `ShortcutRegistry` (stored as `"Meta+Shift+]"`) → German keyboard press → `event.key='+'` → `ShortcutHandler:L30` (`lookup('+'`) → `normalize` (🐛 produces `"Meta+Shift++"`) → Map lookup fails → `matched: false`. Bug point correctly placed at `normalize` call site. |
| **Total** | **6/6** | Fix: coordinated 3-file refactor — `ShortcutDefinition.key → code`, `lookup(event.code)`, registrations use `'BracketRight'`/`'BracketLeft'`/`'KeyF'`/`'KeyS'`. Identical to Claude's fix. |

---

## Claude Sonnet 4.6 (structured prompt)

| Axis | Score (0-2) | Notes |
|------|-------------|-------|
| RCA  | **2** | Correct: `ShortcutHandler.ts:35` + `KeyboardManager.ts:26,34`. "event.code is BracketRight on both. The system uses the wrong field." |
| PFR  | **2** | H1 (translation table) explicitly eliminated using the developer's own experiment: "fixing +→] for German breaks other layouts." H2 (normalize should use code) correctly identified as pointing to the fix. Translation table trap directly dismantled. |
| CFR  | **2** | 7-hop chain: `KeyboardManager.ts:26` → `ShortcutRegistry.ts:22` → OS produce `event.key="+"` → `ShortcutHandler.ts:35` → `"Meta+Shift++"` → Map undefined → action never fires. |
| **Total** | **6/6** | Clean `event.code` refactor across all 3 files. Also noted: "Cmd+F and Cmd+S work because KeyF/KeyS happen to match event.key on all layouts — switching to event.code makes them consistent too." |

---

## Summary

| | Unravel (2nd run) | Claude (structured) |
|-|---------|---------------------|
| RCA | ✅ 2/2 | ✅ 2/2 |
| PFR | ✅ 2/2 | ✅ 2/2 |
| CFR | ✅ 2/2 | ✅ 2/2 |
| **Total** | **6/6** | **6/6** |

**Tie. Both perfect with the correct files.** The first run's translation-table fix was a file input problem, not an engine reasoning problem: without `ShortcutRegistry.ts`, the engine couldn't see that `normalize` needed to change. With all 3 files, Unravel correctly produced the same coordinated refactor as Claude.

**LAYER_BOUNDARY** from the console is still the most interesting meta-signal: Unravel detected that `event.key` represents information already transformed by the OS keyboard driver — no safe fix is possible without changing which event property you consume.

---

## Running Totals — Full Benchmark B-01 to B-20

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
| B-17 | Hard | 6/6 | 6/6 | 0 |
| B-18 | Hard | 6/6 | 6/6 | 0 |
| B-19 | Hard | 6/6 | 6/6 | 0 |
| B-20 | Hard | 6/6 | 6/6 | 0 |
| **TOTAL** | | **119/120** | **112/120** | **+7** |
| **%** | | **99.2%** | **93.3%** | |

\* B-01 to B-11 Claude scores used unstructured prompt.

**Key finding:** With structured prompt (B-12–B-20): Claude **54/54 (100%)**, Unravel **53/54 (98.1%)**. The entire +7 gap is from the unstructured prompt era. B-10 would still gap even with structured prompt (required `passive` listener spec knowledge).
