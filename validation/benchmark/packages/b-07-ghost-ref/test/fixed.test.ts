/**
 * B-07: Ghost Ref — fixed.test.ts
 *
 * Fix applied to src/core/PluginManager.ts:
 *
 * BEFORE (buggy):
 *   plugins.forEach(async (plugin) => {
 *     const events = await plugin.getSupportedEvents();
 *     events.forEach((event) => { this.registry[event] = plugin; });
 *   });
 *
 * AFTER (fixed):
 *   for (const plugin of plugins) {
 *     const events = await plugin.getSupportedEvents();
 *     events.forEach((event) => { this.registry[event] = plugin; });
 *   }
 */

import { describe, it, expect, beforeEach } from 'vitest';
import { PluginManager, Plugin } from '../src/core/PluginManager';
import { EventDispatcher } from '../src/core/EventDispatcher';
import { AuditPlugin, auditLog } from '../src/plugins/AuditPlugin';

class FixedPluginManager extends PluginManager {
  override async buildRegistry(plugins: Plugin[]): Promise<void> {
    for (const plugin of plugins) {
      const events = await plugin.getSupportedEvents();
      events.forEach((event) => {
        (this as unknown as { registry: Record<string, Plugin> }).registry[event] = plugin;
        this.registrationLog.push(`${event} → ${plugin.name}`);
      });
    }
  }
}

beforeEach(() => { auditLog.length = 0; });

describe('B-07 PluginManager — for...of with await (fixed)', () => {
  it('registry is fully populated after buildRegistry resolves', async () => {
    const manager = new FixedPluginManager();
    await manager.buildRegistry([new AuditPlugin()]);

    expect(manager.getRegistrySize()).toBe(3);
    expect(manager.registrationLog).toHaveLength(3);
  });

  it('dispatched events are handled correctly', async () => {
    const manager = new FixedPluginManager();
    await manager.buildRegistry([new AuditPlugin()]);
    const dispatcher = new EventDispatcher(manager);

    const result = await dispatcher.dispatch('user:login', { userId: 'u1' });

    expect(result.handled).toBe(true);
    expect(result.handlerName).toBe('AuditPlugin');
    expect(auditLog).toHaveLength(1);
  });

  it('unregistered events still return handled: false', async () => {
    const manager = new FixedPluginManager();
    await manager.buildRegistry([new AuditPlugin()]);
    const dispatcher = new EventDispatcher(manager);

    const result = await dispatcher.dispatch('payment:processed', {});
    expect(result.handled).toBe(false);
  });
});
