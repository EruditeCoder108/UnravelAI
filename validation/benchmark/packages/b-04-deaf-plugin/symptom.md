## Environment
- Node 20.11, pnpm 8.15, Ubuntu 22.04
- TypeScript 5.4, custom plugin architecture
- Present since v1.4.0 ("add remote config refresh")

## Symptom
Runtime config updates from our remote config service are completely
ignored by the NotificationPlugin. After calling `applyRemoteConfig()`
with new `maxRetries` and `logLevel` values, events processed by the
plugin still reflect the original startup configuration.

We confirmed via logging that `ConfigLoader.updateConfig()` is receiving
the new values correctly — `getConfig()` called immediately after returns
the right values. The plugin is subscribed to the event bus and receiving
events (we can see event counts). The processed results just use the wrong
config values.

I think the issue is in `ConfigLoader.ts` — specifically the mutable
`currentConfig` field. It looks like the ConfigLoader might be handing
out a reference to its internal object, and the Application class might
be modifying that reference without going through `updateConfig()`.

Alternatively the `PluginRegistry.ts` might need to re-initialise plugins
after a config update — the `initAll()` guard that prevents duplicate
initialisation might be blocking the update from taking effect.

## Stack trace
No crash. Plugin processes events with stale config values silently.

## What I tried
- Added `console.log(this.configLoader.getConfig())` at the top of
  `ConfigLoader.updateConfig()` — logs show correct updated values
- Removed the duplicate-init guard from `PluginRegistry.initAll()` and
  called `initAll()` again after config update — this fixed the symptom,
  but re-initialising all plugins on every config update is not acceptable
- Checked `Application.applyRemoteConfig()` — it calls the right method

The bug must be in `ConfigLoader.ts` — it's returning a shared reference
that the plugin captured at startup, so mutations to `currentConfig` don't
reach the plugin's internal copy.
