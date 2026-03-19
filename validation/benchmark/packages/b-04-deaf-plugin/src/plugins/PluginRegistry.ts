import { EventBus } from '../core/EventBus';
import { ConfigLoader } from '../core/ConfigLoader';
import { NotificationPlugin } from './NotificationPlugin';

/**
 * Manages plugin lifecycle: registration, initialisation, and teardown.
 *
 * The registry initialises each plugin exactly once on application startup.
 * Plugins remain active for the lifetime of the process.
 */
export class PluginRegistry {
  private bus: EventBus;
  private configLoader: ConfigLoader;
  private initialised: boolean = false;
  public notificationPlugin: NotificationPlugin;

  constructor(bus: EventBus, configLoader: ConfigLoader) {
    this.bus = bus;
    this.configLoader = configLoader;
    this.notificationPlugin = new NotificationPlugin(bus, configLoader);
  }

  initAll(): void {
    if (this.initialised) {
      console.warn('[PluginRegistry] Already initialised — ignoring duplicate call');
      return;
    }
    this.notificationPlugin.init();
    this.initialised = true;
    console.info('[PluginRegistry] All plugins initialised');
  }

  isInitialised(): boolean {
    return this.initialised;
  }

  reset(): void {
    this.initialised = false;
    this.notificationPlugin.clearResults();
    this.bus.clear();
  }
}
