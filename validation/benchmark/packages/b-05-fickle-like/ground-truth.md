## Root Cause
**File:** `src/services/likeService.ts` **Lines:** 67–71  
`handleWebSocketLikeEvent()` calls `optimisticStore.applyServerUpdate()`
unconditionally — no check whether `event.version <= current.version`.
When the server echo of the user's own click arrives (version=1) after
the user has already applied a second optimistic write (version=2), the
broadcast overwrites the newer local state and rolls back the second click.

## Causal Chain
1. T+0ms:  User clicks Like → `applyOptimisticLike()` → store: count=43, version=1
2. T+30ms: User clicks Like again → `applyOptimisticLike()` → store: count=44, version=2
3. T+80ms: Server broadcasts `like_update {count:43, version:1}` to all clients
4. T+80ms: `wsHandler.handleWsMessage()` receives broadcast → calls `handleWebSocketLikeEvent()`
5. T+80ms: `handleWebSocketLikeEvent()` calls `applyServerUpdate(postId, 43, 1)` — no version check
6. T+80ms: store: count=43, version=1 — second click is erased visually
7. T+100ms: HTTP confirms first click (count=43) → reconcileFinalCount → no visible change
8. T+110ms: HTTP confirms second click (count=44) → store: count=44 — flicker resolves
Hops: 4 files (wsHandler → likeService → optimisticStore, missing guard in likeService)

## Key AST Signals
- `optimisticStore.ts`: `applyServerUpdate()` has no version guard — documented comment
  says "should only overwrite if serverVersion > local version" but no code enforces this
- `likeService.ts L67`: `handleWebSocketLikeEvent` calls `applyServerUpdate` with no
  preceding read of `optimisticStore.get()` — mutation chain shows write with no prior read
- `optimisticStore.ts`: `applyOptimistic()` increments `version` on every call —
  AST confirms version is a monotonic counter intended for ordering writes
- Call graph: `wsHandler → handleWebSocketLikeEvent → applyServerUpdate` (no version check);
  `likesRouter → applyOptimisticLike → applyOptimistic` (increments version correctly)

## The Fix
```diff
  export function handleWebSocketLikeEvent(event: ServerLikeEvent): PostLikeState {
+   const current = optimisticStore.get(event.postId);
+   // Reject stale broadcasts — our local state is already newer
+   if (event.version <= current.version) {
+     return current;
+   }
    const next = optimisticStore.applyServerUpdate(event.postId, event.count, event.version);
    writeLog.push({ source: 'websocket', state: { ...next } });
    return next;
  }
```

## Why the Fix Works
Before writing, we read the current local version. If the incoming broadcast
carries a version number that is less than or equal to what we already hold,
we are seeing a stale echo of a write we have already superseded locally —
we discard it. Only genuinely newer server data (a like from another user,
or a server-side correction) passes the guard and updates the store.

## Proximate Fixation Trap
The reporter correctly identifies that the WebSocket broadcast fires during
the HTTP `await` window and that this causes the rollback. They conclude
the bug is in `likesRouter.ts` — in the ordering of the `await` and
`reconcileFinalCount()`. This is plausible: if reconciliation ran first,
it would overwrite the bad WS state. But that would only paper over the
real bug: `handleWebSocketLikeEvent()` in `likeService.ts` applying server
events without checking whether the local state is already newer.
The `optimisticStore.ts` version field exists precisely for this guard
but is never consulted in the WebSocket handler.

## Benchmark Metadata
- Category: `RACE_CONDITION`
- Difficulty: Medium
- Files: 4
- File hops from symptom to root cause: 3 (wsHandler → likeService → optimisticStore)
- Tests: ① RCA Accuracy ② Proximate Fixation Resistance ③ Cross-file Reasoning
