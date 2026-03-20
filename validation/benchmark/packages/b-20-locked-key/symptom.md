## Environment
- macOS 14.3, Node 20.11, pnpm 8.15
- Electron 28, TypeScript 5.4
- German keyboard layout (QWERTZ), reproduced on Swiss layout as well
- Appeared after PR #203 ("add keyboard shortcut system")

## Symptom
The Cmd+Shift+] shortcut for switching to the next tab does not work on
German keyboards. The shortcut fires correctly on US keyboards. Other
shortcuts like Cmd+F and Cmd+S work fine on all layouts. Only the bracket
shortcuts (next tab and previous tab) are affected.

German keyboard users have reported this since launch. On a German keyboard,
the `]` character is not directly accessible — the key at that physical
position produces `+` when pressed with Shift.

I believe the issue is in `ShortcutHandler.ts`. The `dispatch()` method
compares `event.key` against the registered shortcut key string. When
`event.key` is `+` instead of `]`, the comparison fails. The fix should be
to add a key mapping table to `ShortcutHandler` that translates German layout
key values back to their US equivalents before the lookup. For example:
mapping `+` → `]` and similar substitutions for other affected keys.

## Stack trace
No crash. Shortcut silently fails to fire.
Console shows: `[ShortcutHandler] received key="+" code="BracketRight" — no match`

## What I tried
- Confirmed the shortcut is registered in `ShortcutRegistry` as key="]" — correct
- Added `console.log(event.key, event.code)` in `ShortcutHandler.dispatch()` —
  German layout produces `key="+"`, `code="BracketRight"` for the same physical key
- Added explicit check for `event.key === '+'` in `ShortcutHandler` — this fixed
  the German layout but broke the shortcut on other non-US layouts that produce
  different characters at that physical position
- Searched for keyboard layout normalization in the codebase — none exists

The bug must be in `ShortcutHandler.ts`. The comparison logic needs a
per-layout key translation layer that maps physical key positions to their
US-layout equivalents before the registry lookup runs.
