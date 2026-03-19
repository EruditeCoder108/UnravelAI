import { Plugin } from '../core/PluginManager';

export const auditLog: Array<{ event: string; payload: unknown; ts: number }> = [];

/**
 * Handles security-relevant events and writes them to the audit log.
 * This plugin should handle: user:login, user:logout, user:permission_change.
 *
 * In practice it never handles anything because it was never registered —
 * PluginManager.buildRegistry() returned before getSupportedEvents() resolved.
 */
export class AuditPlugin implements Plugin {
  name = 'AuditPlugin';

  async getSupportedEvents(): Promise<string[]> {
    // Simulates async lookup of supported events (e.g. from config service)
    await new Promise<void>((resolve) => setTimeout(resolve, 5));
    return ['user:login', 'user:logout', 'user:permission_change'];
  }

  async handle(event: string, payload: unknown): Promise<void> {
    auditLog.push({ event, payload, ts: Date.now() });
    console.log(`[AuditPlugin] Logged event: ${event}`);
  }
}
