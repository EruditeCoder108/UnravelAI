## Environment
- Node 20.11, pnpm 8.15, macOS 14.5
- React 18.2, Zustand 4.5
- Appeared after PR #441 ("centralise preferences into Zustand")

## Symptom
When a user changes their notification settings in the modal,
the changes also appear in the embedded preferences panel on the
settings page — even though that panel was mounted before the modal
was opened and should be showing a completely independent view.

Worse: if we programmatically capture preferences state before a test
and then run an update, the snapshot we captured **before** the update
reflects the new values. It's as if Zustand is somehow updating past state.

I think the issue is in `usePreferences.ts`. The hook uses `JSON.stringify`
to compare preferences in its `useEffect`, and I suspect that comparison is
somehow linking the two component instances. Alternatively the `useCallback`
wrapping `updateNotifications` might be sharing a closure across renders.

## Stack trace
No crash — silent state contamination. Both panels show updated values when
only one was the source of the update.

## What I tried
- Checked that each `PreferencesPanel` receives a unique `userId` prop — confirmed
- Added `console.log(preferences)` inside both panels — both log the new value
  after only one panel fired the update
- Removed the `useEffect` inside `usePreferences.ts` that watches `preferences` —
  no change in behaviour, so it's not the JSON.stringify comparison causing it
- Wrapped the panel in `React.memo` — no change

The bug must be in `usePreferences.ts` — the hook seems to be returning the same
preference object identity to both component instances. Zustand must be giving
all subscribers the same reference.
