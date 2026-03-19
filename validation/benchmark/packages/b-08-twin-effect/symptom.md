## Environment
- Node 20.11, pnpm 8.15, macOS 14.5
- React 18.2, Vite 5.1
- Present since PR #388 ("fix subscription not re-activating after channel switch")

## Symptom
Every comment received via WebSocket appears 2–4 times in the feed,
depending on how many times the parent component has re-rendered.
A freshly mounted feed shows duplicates from the first message.
After navigating away and back (unmount/remount cycle) the duplication
count resets to 2, then climbs again.

The duplicate count is not consistent — it equals the number of renders
the parent has gone through, which makes this hard to reproduce in isolation.

I think the issue is in `CommentFeed.tsx`. The deduplication logic using
a `seen` Set filters by `comment.id` — but if the server is somehow sending
the same message twice (with the same ID), the dedup should catch it.
Removing the dedup makes 4 copies appear instead of the filtered output,
which confirms duplicates are actually arriving in the comments array.

## Stack trace
No crash. Duplicate entries visible in the rendered comment list.

## What I tried
- Added stronger deduplication in `CommentFeed.tsx` — reduces visible
  duplicates but doesn't fix the underlying issue
- Checked server-side broadcast logic — server sends exactly one message
  per comment, confirmed via network tab
- Added `console.log` on every `setComments` call — fires 2–4 times
  per received message
- Checked `useRealtimeComments` effect dependencies — they look correct

The bug must be in `CommentFeed.tsx` — it's receiving duplicates in the
`comments` array from the hook, so the deduplication there must be improved
or the comment objects need stable IDs that the current filter can match.
