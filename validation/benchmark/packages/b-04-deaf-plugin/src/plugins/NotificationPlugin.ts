import { EventBus } from '../core/EventBus';
import { ConfigLoader, PluginConfig } from '../core/ConfigLoader';

export interface DataEvent {
  source: string;
  payload: unknown;
  timestamp: number;
}

export interface ProcessedResult {
  source: string;
  processed: boolean;
  retries: number;
  logLevel: string;
}

/**
 * Plugin that listens for data events and processes them according
 * to the current configuration — respecting logLevel, maxRetries,
 * and feature flags.
 *
 * Plugins are initialised once and remain subscribed for the lifetime
 * of the application. The event handler is registered in `init()`.
 */
export class NotificationPlugin {
  protected bus: EventBus;
  protected configLoader: ConfigLoader;
  public results: ProcessedResult[] = [];

  constructor(bus: EventBus, configLoader: ConfigLoader) {
    this.bus = bus;
    this.configLoader = configLoader;
  }

  init(): void {
    const config = this.configLoader.getConfig();
    const { logLevel, maxRetries } = config;

    const handler = (event: DataEvent) => {
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

  getResults(): ProcessedResult[] {
    return [...this.results];
  }

  clearResults(): void {
    this.results = [];
  }
}
