## Root Cause
**File:** `src/hooks/useRealtimeComments.ts` **Lines:** 38–52  
A second `useEffect` re-subscribes to the same WebSocket channel using a
`handleMessage` callback created fresh every render. Because the second
effect does not include `handleMessage` in its dependency array, its
cleanup closes over the initial (stale) function reference and removes
the wrong listener — the first subscription is never cleaned up and
accumulates on every remount.

## Causal Chain
1. Component mounts → Effect 1 subscribes with `handleMessage_v1`
2. Re-render occurs (e.g. parent state change) → Effect 2 runs
3. Effect 2 creates `handleMessage_v2` (new function instance) and subscribes again
4. Effect 2's cleanup removes `handleMessage_v1` — the stale reference from
   the previous closure, not the currently registered `handleMessage_v2`
5. Net result: both subscriptions remain active; next render adds another
6. After N remounts: N active listeners all fire for every incoming message
7. Comment list receives N duplicate entries per WebSocket message
Hops: 3 files (CommentFeed → useRealtimeComments bug → WebSocketClient observes it)

## Key AST Signals
- `useRealtimeComments.ts`: two `useEffect` calls, both referencing `handleMessage`
- Second `useEffect` dependency array at L51: `[channelId]` — missing `handleMessage`
  which is redefined on every render (not wrapped in useCallback)
- Closure capture: cleanup function inside second effect closes over the
  `handleMessage` from the render in which the effect was set up —
  when cleanup runs on re-render, it unsubscribes the PREVIOUS render's handler
- `WebSocketClient.subscribe()` stores handlers in an array — call graph shows
  multiple subscribe calls with no corresponding unsubscribe for each

## The Fix
```diff
+ const handleMessage = useCallback((msg: WsMessage) => {
+   if (msg.channelId !== channelId) return;
+   setComments((prev) => [...prev, msg.comment]);
+ }, [channelId]);

  useEffect(() => {
    ws.subscribe(channelId, handleMessage);
    return () => ws.unsubscribe(channelId, handleMessage);
  }, [channelId, handleMessage]);
-
- // DELETE the second useEffect entirely
```

## Why the Fix Works
`useCallback` with `[channelId]` dependency ensures `handleMessage` is the
same function reference across renders unless `channelId` changes. The
single `useEffect` then correctly subscribes once and its cleanup removes
the exact same reference. No accumulation possible.

## Proximate Fixation Trap
The reporter blames the message parsing logic in `CommentFeed.tsx` because
duplicate comments appear in the list — and the deduplication logic there
looks insufficient. The actual bug is in `useRealtimeComments.ts`: duplicate
messages are real, arriving from multiple active listeners. The parsing is
correct; there are just too many listeners firing it.

## Benchmark Metadata
- Category: `EVENT_LIFECYCLE`
- Difficulty: Medium
- Files: 4
- File hops from symptom to root cause: 2 (CommentFeed → useRealtimeComments)
- Tests: ① RCA Accuracy ② Proximate Fixation Resistance ③ Cross-file Reasoning
