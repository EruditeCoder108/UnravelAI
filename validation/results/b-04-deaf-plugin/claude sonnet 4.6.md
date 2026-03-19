
Root Cause
The bug is in NotificationPlugin.init(). It reads config once at init time and closes over the extracted values in the handler:
tsinit(): void {
  const config = this.configLoader.getConfig(); // snapshot taken once
  const { logLevel, maxRetries } = config;      // destructured out of config

  const handler = (event: DataEvent) => {
    // logLevel and maxRetries are frozen primitives from init time
    // — no connection to ConfigLoader at all
    retries: maxRetries,
    logLevel: logLevel,
  };
}
ConfigLoader is actually fine — it returns a fresh object on each getConfig() call and updateConfig() correctly replaces currentConfig. The problem is the plugin never calls getConfig() again. The fix is to call this.configLoader.getConfig() inside the handler, at event-processing time:
tsinit(): void {
  const handler = (event: DataEvent) => {
    const { logLevel, maxRetries } = this.configLoader.getConfig(); // always fresh

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
No changes needed anywhere else. ConfigLoader, PluginRegistry, Application, and EventBus are all correct. The comment in Application.ts even flagged exactly this: "plugins that already captured a snapshot won't see this" — it just pointed at the wrong file as the place to fix it.