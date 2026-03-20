
Root cause: PluginManager.ts line 17 — forEach with an async callback.

This is a classic ASYNC_ORDERING bug. Here's exactly what happened:
The mechanism. Array.prototype.forEach is synchronous. When you pass it an async callback, it calls each callback, receives a Promise back from each one, and silently discards that Promise. It does not await it. So buildRegistry() does this:

Calls plugins.forEach(async (plugin) => {...}) — launches one async callback per plugin, immediately returns the undefined that forEach always returns
buildRegistry() has no more synchronous work to do, so it resolves its own Promise<void> immediately
5ms later, AuditPlugin.getSupportedEvents() resolves (after its setTimeout), and the event names get written to the registry — but buildRegistry()'s caller has already moved on

By the time AppBootstrapper logs "Registry size after buildRegistry: 0" and the dispatcher starts routing events, the registry is still {}. The actual population happens 5ms later, in a floating Promise that nobody is waiting for.
Your debugging confirmed this precisely. You logged this.registry at the end of buildRegistry() and saw {}. That's the definitive evidence: if the registry were being populated before buildRegistry() returned, you'd see entries there. Empty registry inside the function that builds it means the population happens after the function has already resolved.
Why your hypothesis was wrong. EventDispatcher is entirely innocent. getHandler() is a simple synchronous object key lookup — there's nothing to be wrong there. The registry reference in the dispatcher is the same object instance as in the manager (not a copy, not a stale reference) — you can verify this: both this.manager.registry and the manager the dispatcher holds point to the same {}. The lookup fails because the map is empty, not because the lookup is broken.

The fix — PluginManager.ts line 17:
diff--- PluginManager.ts L16
-    plugins.forEach(async (plugin) => {
-      const events = await plugin.getSupportedEvents();
-      events.forEach((event) => {
-        this.registry[event] = plugin;
-        this.registrationLog.push(`${event} → ${plugin.name}`);
-      });
-    });
+    await Promise.all(
+      plugins.map(async (plugin) => {
+        const events = await plugin.getSupportedEvents();
+        events.forEach((event) => {
+          this.registry[event] = plugin;
+          this.registrationLog.push(`${event} → ${plugin.name}`);
+        });
+      })
+    );
Promise.all(plugins.map(async ...)) collects the Promise from every async callback into an array, then awaits all of them together. buildRegistry() now genuinely does not resolve until every plugin's getSupportedEvents() has completed and every event has been written to the registry. AppBootstrapper's await this.manager.buildRegistry(plugins) then works exactly as intended.

Why this fix is correct and complete. getRegistrySize() after the fix will return 3. The dispatcher will find handlers for user:login, user:logout, and user:permission_change. The AuditPlugin will actually run. No other file needs to change — AppBootstrapper already awaits correctly, EventDispatcher already lookups correctly, AuditPlugin already implements the interface correctly. The bug is entirely in those four lines of buildRegistry().
The broader pattern to avoid. forEach(async ...) is one of the most common async bugs in JavaScript. forEach predates Promises and has no mechanism to handle them. Any time you need to await async operations per-item in an array, the pattern is always await Promise.all(arr.map(async (item) => { ... })). The for...of loop with await inside is also correct if you need sequential execution rather than parallel. forEach with async looks right, compiles without error, and silently does the wrong thing every time.