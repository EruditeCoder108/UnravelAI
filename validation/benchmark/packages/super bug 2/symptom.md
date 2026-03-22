# Bug Report — Rate Limiter Bypass After Window Rotation

## Symptom

After each 60-second window rotation, the rate limiter stops enforcing limits entirely. All requests pass regardless of volume. The bug does **not** occur during the first window (before the first rotation). It begins immediately after the first `rotateWindow()` call and persists for the remaining lifetime of the process.

## Observed behaviour

- `processRequest('free-client-001', {})` returns `{ allowed: true, count: 0, remaining: 100 }`
  even after the client has made 5,000 requests in the new window.
- The `count` field in all responses is `0` after rotation — as if the window just started.
- `getDiagnostics().cache.size` is always `0` after rotation.
- `getDiagnostics().store.entryCount` is non-zero and increasing correctly.
- Logs confirm the rotation sequence completed successfully:
  ```
  [WindowManager] Rotated: window 1 → 2 (34ms)
  ```

## What we checked

1. `window-manager.js::rotateWindow()` — logs confirm it runs and completes.
2. `counter-store.js::resetWindow()` — called correctly, `getStoreDiagnostics()` shows
   a new window ID and correct entry counts post-rotation.
3. `policy-engine.js` — tried setting `POLICY_TTL_MS = 0` to force fresh evaluations
   on every request. No change in behaviour.
4. `sync-coordinator.js` — tried disabling peer sync entirely (no peers configured).
   Bug still occurs in single-instance deployment.

## Suspicious observation

`getDiagnostics().cache.size` is 0 after rotation, but `getDiagnostics().store.entryCount`
is growing correctly. This suggests the cache and the store are out of sync in a way
that isn't just "cache warming" — they appear to be reading from different data sources.

## Hypothesis from team

Lead engineer suspects `sync-coordinator.js::fetchWindowSync()`'s 20–50 ms async gap
is allowing requests to slip through between `clearForRotation()` and `resetWindow()`.
This seems consistent with the burst of passes right after rotation — but doesn't
explain why the bypass is permanent, not just during the rotation window.

Junior dev suspects the `policy-engine.js` 30-second cache is returning stale
`effectiveLimit` values post-rotation, making the limit effectively infinite.

## Files provided

- `counter-store.js`
- `hot-path-cache.js`
- `rate-checker.js`
- `window-manager.js`
- `request-recorder.js`
- `policy-engine.js`
- `sync-coordinator.js`
- `limiter.js`
