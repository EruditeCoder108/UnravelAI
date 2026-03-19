import { EventBus } from '../core/EventBus';
import { ConfigLoader } from '../core/ConfigLoader';
import { PluginRegistry } from '../plugins/PluginRegistry';
import { DataEvent } from '../plugins/NotificationPlugin';

/**
 * Top-level application orchestrator.
 *
 * Initialisation order:
 *   1. ConfigLoader loads base config
 *   2. PluginRegistry initialises all plugins (they capture config here)
 *   3. Application receives a remote config update
 *   4. Events start flowing
 *
 * The config update in step 3 happens AFTER plugin init in step 2.
 * A developer sees this ordering and suspects the Application class
 * is applying the update incorrectly — or that the ConfigLoader isn't
 * propagating it. Both are wrong. The issue is in the plugin itself.
 */
export class Application {
  public bus: EventBus;
  public configLoader: ConfigLoader;
  public registry: PluginRegistry;

  constructor() {
    this.bus = new EventBus();
    this.configLoader = new ConfigLoader();
    this.registry = new PluginRegistry(this.bus, this.configLoader);
  }

  start(): void {
    // Step 2: plugins initialise and capture config snapshot
    this.registry.initAll();
  }

  applyRemoteConfig(partial: Parameters<ConfigLoader['updateConfig']>[0]): void {
    // Step 3: config update — ConfigLoader is correctly updated,
    // but plugins that already captured a snapshot won't see this.
    this.configLoader.updateConfig(partial);
  }

  emitDataEvent(source: string, payload: unknown): void {
    const event: DataEvent = { source, payload, timestamp: Date.now() };
    this.bus.emit<DataEvent>('data:received', event);
  }
}
