# Bug Report — Duplicate Notifications from NotificationHub

## Environment
- Node 20.11, pnpm 8.15, macOS 14.3
- TypeScript 5.4, custom event/pub-sub layer

## Symptom

A notification hub is used to fan out events to all registered subscribers.
Subscribers can be marked as "priority" when they register.

**Bug:** Every time `broadcast(event)` is called, any subscriber registered
with `priority: true` has its callback fired **twice** in the same broadcast.
Non-priority subscribers fire exactly once — no known difference in how they
were registered.

```
// Minimal reproduction
const hub = new NotificationHub();
let count = 0;
hub.subscribe('normal', () => count++, false);
hub.subscribe('vip',    () => count++, true);   // priority

hub.broadcast({ type: 'tick' });
// Expected: count === 2  (one call per subscriber)
// Actual:   count === 3  (vip subscriber fired twice)
```

Added `getDiagnostics()` logging after every broadcast — no subscriber is
registered more than once. The `_subscribers` Set has exactly 2 entries.
No exceptions thrown. No extra `subscribe()` calls.

The doubling is consistent: always exactly once extra per priority subscriber
per broadcast call. With 2 priority subscribers, count increments by 4 instead
of 2.

Already ruled out:
- Multiple `subscribe()` calls — confirmed exactly one per subscriber
- Async re-entrancy — the hub is called synchronously in tests
- Event propagation / event re-emission — broadcast() does not recurse

## Files

- `src/notification-hub.js`

## What to fix

Why is a priority subscriber's callback fired twice in a single `broadcast()`
call? The Set has no duplicates and no extra registrations are happening.
