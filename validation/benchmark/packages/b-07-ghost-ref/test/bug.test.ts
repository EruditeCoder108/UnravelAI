/**
 * B-07: Ghost Ref — bug.test.ts
 *
 * Proves that PluginManager.buildRegistry() returns before the
 * async forEach callbacks complete, leaving the registry empty.
 * Events dispatched after buildRegistry() resolves are silently dropped.
 *
 * These tests FAIL on the buggy code.
 */

import { describe, it, expect, beforeEach } from 'vitest';
import { AppBootstrapper } from '../src/app/AppBootstrapper';
import { auditLog } from '../src/plugins/AuditPlugin';

let app: AppBootstrapper;

beforeEach(() => {
  app = new AppBootstrapper();
  auditLog.length = 0;
});

describe('B-07 PluginManager.buildRegistry — forEach(async) race', () => {
  it('registry should be populated after buildRegistry resolves', async () => {
    await app.run();

    // BUG: registry size is 0 — forEach(async) didn't await registration
    expect(app.manager.getRegistrySize()).toBeGreaterThan(0);
  });

  it('user:login event should be handled after bootstrap', async () => {
    await app.run();

    const result = await app.emitEvent('user:login', { userId: 'u1' });

    // BUG: handled is false — no handler registered
    expect(result.handled).toBe(true);
    expect(result.handlerName).toBe('AuditPlugin');
  });

  it('audit log should contain the login event', async () => {
    await app.run();

    await app.emitEvent('user:login', { userId: 'u1' });

    // BUG: auditLog is empty — AuditPlugin.handle() was never called
    expect(auditLog).toHaveLength(1);
    expect(auditLog[0].event).toBe('user:login');
  });

  it('registrationLog should show all events registered synchronously', async () => {
    await app.run();

    // AuditPlugin supports 3 events — all should be in registrationLog
    // BUG: registrationLog is empty
    expect(app.manager.registrationLog).toHaveLength(3);
  });
});
