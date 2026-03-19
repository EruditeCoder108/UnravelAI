/**
 * B-04: The Deaf Plugin — bug.test.ts
 *
 * Proves that NotificationPlugin captures config at init() time and
 * ignores all subsequent updates via ConfigLoader.updateConfig().
 *
 * These tests FAIL on the buggy code.
 */

import { describe, it, expect, beforeEach } from 'vitest';
import { Application } from '../src/app/Application';

let app: Application;

beforeEach(() => {
  app = new Application();
});

describe('B-04 NotificationPlugin — stale config closure', () => {
  it('should reflect updated maxRetries in processed events after config change', () => {
    // Start with default config (maxRetries = 3)
    app.start();

    // Update config to maxRetries = 10 AFTER plugin is initialised
    app.applyRemoteConfig({ maxRetries: 10 });

    // Emit an event — plugin should now use maxRetries = 10
    app.emitDataEvent('test-source', { value: 42 });

    const results = app.registry.notificationPlugin.getResults();
    expect(results).toHaveLength(1);

    // BUG: plugin still uses maxRetries = 3 (captured at init time)
    expect(results[0].retries).toBe(10);
  });

  it('should reflect updated logLevel after config change', () => {
    app.start();

    // Update logLevel from 'warn' to 'debug'
    app.applyRemoteConfig({ logLevel: 'debug' });

    app.emitDataEvent('service-a', {});

    const results = app.registry.notificationPlugin.getResults();
    expect(results).toHaveLength(1);

    // BUG: logLevel is still 'warn' from init-time snapshot
    expect(results[0].logLevel).toBe('debug');
  });

  it('should use the latest config across multiple sequential updates', () => {
    app.start();

    app.applyRemoteConfig({ maxRetries: 5 });
    app.emitDataEvent('first', {});

    app.applyRemoteConfig({ maxRetries: 1 });
    app.emitDataEvent('second', {});

    const results = app.registry.notificationPlugin.getResults();
    expect(results).toHaveLength(2);

    // BUG: both events show maxRetries = 3 (initial value)
    expect(results[0].retries).toBe(5);
    expect(results[1].retries).toBe(1);
  });
});
