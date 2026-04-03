# Unravel Roadmap
*Dynamic — updated as work completes. Last updated: 2026-04-01*

---

## ✅ Completed — Error Removal & Feature Parity Sprint
*Completed 2026-03-30 → 2026-04-01*

| Item | What | Done |
|---|---|---|
| §1.1 `checkSolvability` in MCP verify | Layer boundary detection on REJECTED diagnoses | 2026-03-30 |
| §1.2 `saveMeta` after `build_map` | Persists `meta.json` alongside `knowledge.json` | 2026-03-30 |
| §1.3A Symptom whitelisting in verify | Pass `session.lastSymptom` to `verifyClaims()` | 2026-03-30 |
| §1.3B `diffBlock` in verify schema | Enables Fix Completeness check (Check 6) | 2026-03-30 |
| §2.1 `getNodeBoosts` in MCP `query_graph` | Pattern-aware KG routing in MCP | 2026-03-30 |
| §2.2 `unawaited_promise` signal | `isAwaited` field on timing nodes, cross-file risk signal live | 2026-03-28 |
| §3.1 Pattern hints in webapp LLM prompt | `matchPatterns` + `learnFromDiagnosis` + `penalizePattern` in webapp | 2026-03-31 |
| §3.2 KG embeddings in webapp | Semantic file routing via Gemini Embedding 2 | 2026-03-31 |
| §3.3 Diagnosis Archive in webapp | IndexedDB archive + semantic recall via cosine search | 2026-03-31 |
| §3.5 `query_visual` in webapp | Image-to-code routing (screenshot → Gemini cross-modal → relevant files) | 2026-03-31 |
| §4.1 `getNodeBoosts` in webapp KG router | Pre-AST pattern boosts (60% confidence, no API key needed) | 2026-03-31 |
| §4.3 `AMBIGUOUS_STEMS` guard in WASM bridge | KG edge quality fix for ambiguous import stems | 2026-03-31 |
| §5.2 `NOISE_VARS` cleanup | Removed 13 domain-meaningful names from noise suppression | 2026-03-30 |
| §5c-4 `autoSeedCodex` in MCP | Auto-seeds Task Codex from `verify(PASSED)` — codex retrieval now self-populating | 2026-04-01 |

---

## ⏳ Pending — MCP

| Priority | Item | What | Effort |
|---|---|---|---|
| Medium | **§5.1 Modularise `index.js`** | Extract `session.js`, `file-reader.js`, `format.js`, `instructions.js` from 2100-line monolith. No logic changes — pure file extraction. | Medium |
| Future | **§1.4 `explain` / `security` modes** | New MCP tools (or `mode:` param on `analyze`) for code explanation and vulnerability analysis with CWE mapping. Needs design decision first. | Medium |
| Future | **§5.3 SSE / HTTP transport** | Eliminates `console.log` hijack risk. Enables web deployment. Only matters when deploying as hosted service. | High |

---

## ⏳ Pending — Webapp

| Priority | Item | What | Effort |
|---|---|---|---|
| Future | **§3.4 Task Codex in browser** | Full IndexedDB-backed Codex for webapp sessions. `autoSeedCodex` in MCP already covers base case. Full version adds BOUNDARY/CONNECTION/Layer 4 skip zones from agent. | High |
| Future | **Web Search / Crawler** | Agent can trigger web search mid-diagnosis (latest dep versions, known CVEs, deprecated API patterns, prior art). Surfaces live data static analysis can't see. | Medium |
| Future | **Multi-Agent Mode** |  | High |
| Future | **Heavy Mode** |  | Medium |

---

## Permanent Exclusions

| Item | Reason |
|---|---|
| `llm-analyzer.js` in MCP | LLM hallucination risk in deterministic fact pipeline |
| circle-ir adapter in webapp | Structurally blocked: `path` (Node.js built-in) + `process.stderr` + WASM ABI conflict |
| Webapp self-heal loop in MCP | MCP gives evidence to external agent — agent decides file fetching |
| MCP streaming results | MCP is one-shot request-response; streaming is webapp-only |
| Full-codebase Task Codex | Task-scope is the entire point — full-codebase produces same context problem |