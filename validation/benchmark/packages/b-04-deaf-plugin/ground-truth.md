## Root Cause
**File:** `src/plugins/NotificationPlugin.ts` **Lines:** 57–58  
`const config = this.configLoader.getConfig()` followed by
`const { logLevel, maxRetries } = config` inside `init()`.
These two lines create a snapshot of the config at initialisation time.
The event handler's closure captures `logLevel` and `maxRetries` as
primitive values — not references — so no future call to
`configLoader.updateConfig()` can affect them.

## Causal Chain
1. `Application.start()` → `PluginRegistry.initAll()` → `NotificationPlugin.init()`
2. `init()` calls `this.configLoader.getConfig()` once — returns `{ logLevel: 'warn', maxRetries: 3, ... }`
3. Destructuring: `const { logLevel, maxRetries } = config` — primitives copied into local variables
4. Event handler `(event) => { ...uses logLevel, maxRetries... }` closes over these local variables
5. `Application.applyRemoteConfig({ maxRetries: 10 })` → `ConfigLoader.currentConfig` updated correctly
6. `bus.emit('data:received', event)` → handler fires
7. Handler reads `maxRetries` from its closure — value is `3`, not `10`
Hops: 4 files (Application → PluginRegistry → NotificationPlugin → EventBus callback)

## Key AST Signals
- Closure capture: `NotificationPlugin.ts` — `logLevel` and `maxRetries` captured inside
  arrow function `handler` at L62–L66, defined from destructuring at L57–L58 (parent scope of `init()`)
- `this.configLoader` IS in scope inside the handler (via outer `this`) — but it's
  never called inside the handler. AST shows: `configLoader` is read in `init()` but
  not in the handler function body
- `ConfigLoader.updateConfig()` writes to `this.currentConfig` — mutation chain
  is correct but has no path to the already-closed-over primitives
- Call graph: `Application.applyRemoteConfig` → `ConfigLoader.updateConfig` (correct),
  but no edge from config update to `NotificationPlugin` handler re-registration

## The Fix
```diff
  init(): void {
-   const config = this.configLoader.getConfig();
-   const { logLevel, maxRetries } = config;
-
    const handler = (event: DataEvent) => {
+     // Read fresh config on every event — never captures a stale snapshot
+     const { logLevel, maxRetries } = this.configLoader.getConfig();
      const result: ProcessedResult = {
        source: event.source,
        processed: true,
        retries: maxRetries,
        logLevel: logLevel,
      };
      if (logLevel !== 'silent') {
        console.log(`[NotificationPlugin] Processing event from ${event.source}`);
      }
      this.results.push(result);
    };
    this.bus.on<DataEvent>('data:received', handler);
  }
```

## Why the Fix Works
Moving `this.configLoader.getConfig()` inside the handler ensures it is
called on every event dispatch, not once at registration time. Because
`this.configLoader` is a reference to the live `ConfigLoader` instance,
every call to `getConfig()` returns the current values — including any
updates applied via `updateConfig()` between events.

## Proximate Fixation Trap
The reporter correctly identifies that `ConfigLoader.getConfig()` returns
updated values — and concludes that `ConfigLoader` must be sharing an
internal reference that the plugin captured. This logic is almost right:
the plugin DID capture a snapshot — but the snapshot is of primitive values
(`logLevel` and `maxRetries` strings/numbers), not of the ConfigLoader's
internal object. The reporter's proposed fix (re-initialise plugins after
config update) would work but is the wrong solution. The real fix is a
one-line move: call `getConfig()` inside the handler, not before it.

## Benchmark Metadata
- Category: `STALE_CLOSURE`
- Difficulty: Hard
- Files: 5
- File hops from symptom to root cause: 4 (Application → Registry → Plugin → handler closure)
- Tests: ① RCA Accuracy ② Proximate Fixation Resistance ③ Cross-file Reasoning
