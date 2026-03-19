/**
 * B-04: The Deaf Plugin — fixed.test.ts
 *
 * Fix applied to src/plugins/NotificationPlugin.ts:
 *
 * BEFORE (buggy — init() method):
 *   const config = this.configLoader.getConfig();
 *   const { logLevel, maxRetries } = config;  // snapshot at init time
 *   const handler = (event: DataEvent) => {
 *     ...uses stale logLevel, maxRetries...
 *   };
 *
 * AFTER (fixed):
 *   const handler = (event: DataEvent) => {
 *     // Read fresh config on every event — never stale
 *     const { logLevel, maxRetries } = this.configLoader.getConfig();
 *     ...uses current logLevel, maxRetries...
 *   };
 */

import { describe, it, expect, beforeEach } from 'vitest';
import { EventBus } from '../src/core/EventBus';
import { ConfigLoader } from '../src/core/ConfigLoader';
import { PluginRegistry } from '../src/plugins/PluginRegistry';
import { DataEvent } from '../src/plugins/NotificationPlugin';

// Fixed NotificationPlugin — reads config fresh on each event
import { NotificationPlugin as BuggyPlugin } from '../src/plugins/NotificationPlugin';

class FixedNotificationPlugin extends BuggyPlugin {
  override init(): void {
    // FIX: read config inside the handler, not in init()
    const handler = (event: DataEvent) => {
      const { logLevel, maxRetries } = this.configLoader.getConfig();
      this.results.push({
        source: event.source,
        processed: true,
        retries: maxRetries,
        logLevel: logLevel,
      });
    };
    this.bus.on<DataEvent>('data:received', handler);
  }
}

let bus: EventBus;
let configLoader: ConfigLoader;
let plugin: FixedNotificationPlugin;

beforeEach(() => {
  bus = new EventBus();
  configLoader = new ConfigLoader();
  plugin = new FixedNotificationPlugin(bus, configLoader);
  plugin.init();
});

describe('B-04 NotificationPlugin — fresh config read (fixed)', () => {
  it('reflects updated maxRetries in events after config change', () => {
    configLoader.updateConfig({ maxRetries: 10 });
    bus.emit<DataEvent>('data:received', { source: 'x', payload: {}, timestamp: 0 });

    const results = plugin.getResults();
    expect(results[0].retries).toBe(10);
  });

  it('reflects updated logLevel after config change', () => {
    configLoader.updateConfig({ logLevel: 'debug' });
    bus.emit<DataEvent>('data:received', { source: 'x', payload: {}, timestamp: 0 });

    expect(plugin.getResults()[0].logLevel).toBe('debug');
  });

  it('tracks sequential config changes correctly', () => {
    configLoader.updateConfig({ maxRetries: 5 });
    bus.emit<DataEvent>('data:received', { source: 'first', payload: {}, timestamp: 0 });

    configLoader.updateConfig({ maxRetries: 1 });
    bus.emit<DataEvent>('data:received', { source: 'second', payload: {}, timestamp: 0 });

    const results = plugin.getResults();
    expect(results[0].retries).toBe(5);
    expect(results[1].retries).toBe(1);
  });
});
