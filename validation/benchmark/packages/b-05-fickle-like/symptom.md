## Environment
- Node 20.11, pnpm 8.15, macOS 14.3
- Express 4.18, custom WebSocket layer
- Appeared after PR #318 ("add real-time like counts via WebSocket broadcast")

## Symptom
The like button shows the correct optimistic count for about 80–200ms,
then snaps back to the pre-click count. If you click quickly a second
time before the snap-back, both clicks are eventually confirmed by the
server — but the displayed count flickers down then back up. Slow clickers
(waiting >300ms between clicks) never see the issue.

The snap-back only happens on like, not unlike. The network tab shows
the HTTP POST completing successfully with the correct count in the response.

I traced the issue to `likesRouter.ts`. The router applies an optimistic
update, awaits the server response, then calls `reconcileFinalCount()`.
I think the `await` timing is wrong — the WebSocket broadcast from the
server arrives during the await window and fires before reconciliation,
then reconciliation overwrites it with wrong data. Moving the
`reconcileFinalCount()` call before the `await` might fix it.

## Stack trace
No crash. Visible as a count flicker in the UI.
wsHandler.ts receives the broadcast and dispatches it — timing confirmed
via console.log timestamps.

## What I tried
- Moved `reconcileFinalCount()` before the `await` in `likesRouter.ts` — no change
- Delayed the WebSocket broadcast handler with setTimeout(0) — flicker still occurs
- Added `console.log` timestamps in `likesRouter.ts` and `wsHandler.ts` — confirmed
  the WS broadcast fires at T+80ms, the HTTP reconciliation fires at T+100ms
  The WS fires first and then the HTTP reconciliation fires — so the HTTP should win.
  But it's the WS that's causing the rollback, not the HTTP.

The bug must be in `likesRouter.ts` — the await sequence is allowing the WebSocket
event to fire between the optimistic write and the final reconciliation, and something
in that window is corrupting the count.
