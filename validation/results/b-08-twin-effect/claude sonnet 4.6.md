
Root cause: useRealtimeComments.ts lines 27–34 — a duplicate useEffect that was added in PR #388 and never removed.

What's actually happening. Open useRealtimeComments.ts and count the useEffect calls. There are two. Both subscribe to the same channelId with the same handler logic. Both fire setComments((prev) => [...prev, msg.comment]) when a message arrives. So when a single message comes in, setComments fires twice — once from each listener — and the comment lands in state twice. That's your duplicate.
The variable listener count you're seeing (2–4 depending on renders) has a specific explanation. In React 18 development mode, StrictMode deliberately runs each effect twice — it mounts, runs the cleanup, then remounts — to help surface exactly this class of bug. With two effects and StrictMode double-invocation, you can end up with up to 4 active listeners before the first message arrives. After a full unmount/remount cycle (navigating away and back), both cleanups fire correctly, the count resets to 0, then both effects resubscribe, resetting to exactly 2. That matches "resets to 2 after navigating away and back, then climbs again."
The cleanup functions are fine — both correctly unsubscribe their own handleMessage reference via closure, so channel switching works correctly. The WebSocketClient handler array accumulation behavior is also correct — it's designed to support multiple consumers on the same channel. The problem isn't in any of those places.
Why your hypotheses were wrong. CommentFeed.tsx is innocent. The deduplication you added there reduces the visible count because it filters the comments array before rendering — but the underlying comments state still contains duplicates, setComments still fires twice per message, and removing the dedup restores the visible doubling. It's treating the symptom. The server is also innocent — your network tab confirmed one broadcast per comment, and that's consistent with everything else here.
When you checked "effect dependencies look correct," you were right. But you were checking the dep array [channelId], not whether there were two separate effects both running simultaneously.
Why PR #388 introduced this. The developer who wrote it noticed that after switching channels, the subscription sometimes didn't reactivate. Rather than diagnosing why, they added a second effect as a redundancy measure. The first effect's [channelId] dependency array already handles channel switching correctly: when channelId changes, the cleanup from the previous render unsubscribes the old channel, and the new run subscribes to the new one. The second effect was never necessary.

The fix — delete the second useEffect entirely from useRealtimeComments.ts:
diff--- useRealtimeComments.ts
-  // Ensures subscription stays active after re-renders
-  useEffect(() => {
-    const handleMessage = (msg: WsMessage) => {
-      if (msg.channelId !== channelId) return;
-      setComments((prev) => [...prev, msg.comment]);
-    };
-    wsClient.subscribe(channelId, handleMessage);
-    return () => wsClient.unsubscribe(channelId, handleMessage);
-  }, [channelId]);
That's the entire fix. The first useEffect (lines 19–25) is correct and sufficient for both the initial subscription and channel switching. Once this is removed, each message triggers exactly one setComments call, the listener count after mount is 1, and the duplicate count after navigating away and back is still 1.
You can also clean up CommentFeed.tsx, but it's optional — the seen Set dedup was never doing harm, just masking the root cause. With the hook fixed, the comments array will never contain duplicates, so the filter becomes a no-op. Whether you remove it is a code hygiene call.
The broader pattern. A useEffect with a [channelId] dep array already "stays active after re-renders" — that's precisely what the dep array is for. Re-renders don't re-run effects; only dep changes do. The comment in the second effect ("Ensures subscription stays active after re-renders") reflects a misunderstanding of how useEffect works. Effects don't get "deactivated" by re-renders. They run on mount and when deps change, and that's the only time they run.