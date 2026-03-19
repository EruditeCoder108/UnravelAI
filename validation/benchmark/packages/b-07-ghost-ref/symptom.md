## Environment
- Node 20.11, pnpm 8.15, macOS 14.3
- TypeScript 5.4, custom plugin/event architecture
- Present since PR #201 ("make plugin event lists dynamic/async")

## Symptom
After migrating plugin event registration to async (plugins now fetch
their supported event list from a config service), no events are being
handled. The `EventDispatcher` logs `No handler registered for event: "user:login"`
for every single event — even events that worked perfectly before the migration.

We can see in the logs that `buildRegistry()` is called and returns without
error. We can see the plugins are instantiated. But the registry appears
empty to the dispatcher.

I believe the issue is in `EventDispatcher.ts` — specifically the
`getHandler()` lookup. After the async migration, the event names might
be formatted differently (with namespaces like `user:login` vs `userLogin`)
and the registry key comparison is failing. Alternatively the dispatcher
might be holding a stale reference to the manager from before the registry
was populated.

## Stack trace
No crash. Events are silently dropped with console warnings:
`[EventDispatcher] No handler registered for event: "user:login"`

## What I tried
- Added `console.log(this.registry)` at the end of `buildRegistry()` — logs `{}`
- Added `console.log(this.registry)` inside `getHandler()` — logs `{}`
- Verified the plugin names in `EventDispatcher` match what AuditPlugin returns — they do
- Checked that `AppBootstrapper` awaits `buildRegistry()` — it does

The bug must be in `EventDispatcher.ts` — it's receiving an empty registry
from PluginManager even though buildRegistry was called and awaited.
The dispatcher must be reading from a different object instance or the
manager reference is being replaced somewhere.
