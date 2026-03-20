# B-08: Twin Effect — Grade Sheet

**Category:** `DATA_FLOW` / `REACT_HOOK_MISUSE` | **Difficulty:** Medium | **Files:** 3

**Ground truth:** Two identical `useEffect` blocks in `useRealtimeComments.ts` — both subscribe a separate handler to the same `channelId`. Single WS message invokes both, `setComments` fires twice, comment appears twice. Root cause file: `useRealtimeComments.ts` L27-L33 (the second, redundant block).

**Proximate fixation trap:** Reporter blames `CommentFeed.tsx` because that's where duplicates are visible. Also suspects `wsClient.unsubscribe` because cleanup seems not to work on re-renders.

---

## Unravel — Gemini 2.5 Flash + AST (hypothesis tree)

| Axis | Score (0-2) | Notes |
|------|-------------|-------|
| RCA  | **2** | Correct file (`useRealtimeComments.ts`), correct mechanism — two `useEffect` blocks creating two separate handler closures (`handleMessageA` / `handleMessageB`) that both fire on each message. Referenced WebSocketClient.ts L43 (`receive` iterates all handlers) as the amplification point. |
| PFR  | **2** | H2 (`unsubscribe` failing) explicitly eliminated — `WebSocketClient.ts L35` uses `indexOf`/`splice` with strict reference equality; cleanup correctly captures the same reference. H3 (stale `setComments`) eliminated — functional update form `(prev) => [...]` is closure-safe by design. |
| CFR  | **2** | Dual-handler chain: Effect 1 → `handleMessageA`, Effect 2 → `handleMessageB`. WS message → `wsClient` iterates handlers → both fire → `setComments` twice. Both call sites marked as `isBugPoint: true`. Clean and correct. |
| **Total** | **6/6** | Confidence: 0.95 ✅ — no verifier warnings on this run |

**Note on first run:** Unravel analyzed B-07 files on the first attempt (stale router context). Re-run with correct files produced a clean result.

---

## Claude Sonnet 4.6

| Axis | Score (0-2) | Notes |
|------|-------------|-------|
| RCA  | **2** | Correct: second `useEffect` (lines 27-34) identified as the duplicate. Explained the PR #388 origin story — developer added it as a "redundancy measure" after misdiagnosing a channel-switch issue. |
| PFR  | **2** | Explicitly cleared `CommentFeed.tsx` (dedup was masking, not fixing), cleared `wsClient.unsubscribe` (cleanup via closure reference is correct), cleared server (one broadcast confirmed). Explained why the channel-switching hypothesis was wrong — `[channelId]` dep handles it already. |
| CFR  | **2** | StrictMode double-invocation explains the 2-4 range (dev: 2 effects × 2 StrictMode invocations = 4). Named `handleMessageA` and `handleMessageB` as distinct closures, traced accumulation pattern correctly. |
| **Total** | **6/6** | Claude's explanation of StrictMode amplification was the strongest part — explains the "climbs again" symptom precisely |

**Notable:** Claude's fix adds that `CommentFeed.tsx` dedup cleanup is optional ("code hygiene call") — a thoughtful note Unravel didn't include.

---

## Summary

| | Unravel | Claude |
|-|---------|--------|
| RCA | ✅ 2/2 | ✅ 2/2 |
| PFR | ✅ 2/2 | ✅ 2/2 |
| CFR | ✅ 2/2 | ✅ 2/2 |
| **Total** | **6/6** | **6/6** |

---

## Running Totals (B-01 to B-08)

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
| **Total** | | **47/48** | **42/48** | **+5** |
