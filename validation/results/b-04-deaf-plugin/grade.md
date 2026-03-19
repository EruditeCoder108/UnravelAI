# B-04 — The Deaf Plugin — Grade Sheet

**Date:** 2026-03-19
**Grader:** Antigravity
**Engines tested:** Unravel (Gemini 2.5 Flash + AST + hypothesis tree), Claude Sonnet 4.6 (baseline, no AST)

---

## Ground Truth
- **Root cause file:** `src/plugins/NotificationPlugin.ts` Lines 57–58
- **Mechanism:** `init()` calls `getConfig()` once → destructures into `const` primitives `logLevel`, `maxRetries` → event handler closes over these locals → all future `updateConfig()` calls update `ConfigLoader.currentConfig` but have no path to the already-captured primitives
- **Proximate trap:** Reporter suspects `ConfigLoader` is sharing a mutable internal reference that the plugin captured — almost right, but the snapshot is of primitive VALUES, not of the object itself. Reporter's proposed fix (re-init plugins after config update) would work but is wrong.
- **4-file causal chain:** Application → PluginRegistry → NotificationPlugin.init() → handler closure

---

## Unravel — Gemini 2.5 Flash + AST (hypothesis tree)

| Axis | Score (0-2) | Notes |
|------|-------------|-------|
| RCA  | **2** | Correct file + lines (L29-30), mechanism exact: "`const { logLevel, maxRetries } = config` inside `init()` — primitives copied into locals → handler closes over these locals → stale forever" |
| PFR  | **2** | H1 is the exact proximate trap ("ConfigLoader returns shared mutable reference") — eliminated with evidence: `ConfigLoader.ts L28: this.currentConfig = { ...this.currentConfig, ...partial }`. H3 eliminates the re-init workaround. ConfigLoader explicitly cleared. |
| CFR  | **2** | Full 4-file timeline: Application.start() → PluginRegistry.initAll() → NotificationPlugin.init() → captures closure at T2.1 → EventBus fires at T4 → stale config used at T4.2. `isBugPoint: true` correctly placed at the closure capture edge. |
| **Total** | **6/6** | |

**Correct file + lines:** ✅  
**Proximate trap eliminated:** ✅ explicitly — H1 eliminated with ConfigLoader.ts L28  
**Full 4-file chain:** ✅  
**Hallucinations:** None — all AST-verified

---

## Baseline — Claude Sonnet 4.6 (raw, no AST)

| Axis | Score (0-2) | Notes |
|------|-------------|-------|
| RCA  | **2** | Correct file, correct mechanism. Notes that Application.ts comment "pointed at the wrong file as the place to fix it" — correctly identifies the misdirection in the source itself. |
| PFR  | **2** | Explicitly: "ConfigLoader is actually fine — it returns a fresh object on each getConfig() call and updateConfig() correctly replaces currentConfig. The problem is the plugin never calls getConfig() again." Direct, precise rebuttal. |
| CFR  | **1** | Chain: init() captures → handler runs → stale values used. Misses the PluginRegistry hop in the middle (Application → Plugin directly). 3-hop chain shown, ground truth is 4 hops. |
| **Total** | **5/6** | |

**Correct file:** ✅  
**Proximate trap:** ✅ explicitly cleared with precise language  
**CFR gap:** Missing PluginRegistry in the chain — goes Application → NotificationPlugin directly

---

## Delta Summary

| | Unravel | Claude |
|---|---|---|
| RCA | **2** | **2** |
| PFR | **2** | **2** |
| CFR | **2** | 1 |
| **Total** | **6/6** | **5/6** |

**Score delta: Unravel +1**

**Pattern continues:** CFR is consistently where Claude drops points — it gets the root cause and trap right, but the multi-hop chain reconstruction is weaker without AST.

---

## Running Totals

| Bug | Tier | Unravel | Claude | Delta |
|-----|------|---------|--------|-------|
| B-01 | Easy | 6/6 | 5/6 | +1 |
| B-02 | Hard | 6/6 | 5/6 | +1 |
| B-03 | Medium | 6/6 | 5/6 | +1 |
| B-04 | Hard | 6/6 | 5/6 | +1 |
| **Running** | | **24/24** | **20/24** | **+4** |
