## Root Cause
**File:** `src/core/PluginManager.ts` **Lines:** 41–45  
`buildRegistry()` uses `plugins.forEach(async (p) => { ... })` to populate
`this.registry`. `forEach` does not await async callbacks — it fires each
one and discards the returned Promise. `buildRegistry()` returns while all
the async registrations are still in flight. Any caller that calls
`dispatch()` after `buildRegistry()` resolves receives an empty registry.

## Causal Chain
1. `AppBootstrapper.run()` calls `manager.buildRegistry(plugins)`
2. `buildRegistry()` calls `plugins.forEach(async (plugin) => { ... })`
3. `forEach` fires N Promises and returns immediately — does NOT await them
4. `buildRegistry()` resolves while `this.registry` is still empty `{}`
5. `AppBootstrapper.run()` calls `manager.dispatch('user:login', payload)`
6. `dispatch()` looks up `this.registry['user:login']` → `undefined`
7. Event is silently dropped — no handler runs, no error thrown
8. `AuditLogger.onEvent()` is never called — audit trail has gaps
Hops: 4 files (AppBootstrapper → PluginManager bug → EventDispatcher observes it → AuditLogger never called)

## Key AST Signals
- Async boundary: `forEach(async (plugin) => {...})` at L41 — `forEach`
  is not an async-aware iterator; the callback's returned Promise is discarded
- Floating promise: each `async` callback in `forEach` body is unawaited
- `this.registry` written inside the async callback at L44 — write is
  deferred to the microtask queue, not guaranteed before `buildRegistry` returns
- Contrast: if `for...of` with `await` were used, writes would complete
  before the next iteration and before the function returned

## The Fix
```diff
- async buildRegistry(plugins: Plugin[]): Promise<void> {
-   plugins.forEach(async (plugin) => {
-     const events = await plugin.getSupportedEvents();
-     events.forEach((event) => {
-       this.registry[event] = plugin;
-     });
-   });
- }
+ async buildRegistry(plugins: Plugin[]): Promise<void> {
+   for (const plugin of plugins) {
+     const events = await plugin.getSupportedEvents();
+     events.forEach((event) => {
+       this.registry[event] = plugin;
+     });
+   }
+ }
```

## Why the Fix Works
`for...of` with `await` processes each plugin sequentially, pausing at
each `getSupportedEvents()` call until it resolves. By the time the loop
exits, all registry entries have been written. Any caller that awaits
`buildRegistry()` is guaranteed a fully populated registry.

## Proximate Fixation Trap
The reporter blames `EventDispatcher.ts` because that is where events
are "lost" — the dispatch call returns without calling any handler.
`EventDispatcher` logs a warning when no handler is found, which is
the first visible signal of the problem. The actual bug is in
`PluginManager.buildRegistry()` — the `forEach(async)` anti-pattern
is subtle because `forEach` accepts a callback and looks correct.
The async keyword on the callback is silently ignored by `forEach`.

## Benchmark Metadata
- Category: `ASYNC_ORDERING`
- Difficulty: Medium
- Files: 4
- File hops from symptom to root cause: 3 (AppBootstrapper → PluginManager → EventDispatcher observes)
- Tests: ① RCA Accuracy ② Proximate Fixation Resistance ③ Cross-file Reasoning
