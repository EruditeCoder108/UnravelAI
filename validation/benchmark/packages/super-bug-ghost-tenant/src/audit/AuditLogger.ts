import { getTenant } from '../context/TenantContext';

export type AuditAction =
  | 'document.read'
  | 'document.create'
  | 'document.update'
  | 'document.delete'
  | 'document.list';

export interface AuditEntry {
  id: string;
  tenantId: string;
  userId: string;
  action: AuditAction;
  resourceId?: string;
  metadata?: Record<string, unknown>;
  timestamp: number;
  requestId: string;
}

let _entryCounter = 0;

export class AuditLogger {
  public log: AuditEntry[] = [];

  record(
    userId: string,
    action: AuditAction,
    requestId: string,
    resourceId?: string,
    metadata?: Record<string, unknown>
  ): AuditEntry {
    const tenantId = getTenant();
    const entry: AuditEntry = {
      id: `audit_${++_entryCounter}`,
      tenantId,
      userId,
      action,
      resourceId,
      metadata,
      timestamp: Date.now(),
      requestId,
    };
    this.log.push(entry);
    return entry;
  }

  getEntriesForTenant(tenantId: string): AuditEntry[] {
    return this.log.filter((e) => e.tenantId === tenantId);
  }

  getEntriesForUser(userId: string): AuditEntry[] {
    return this.log.filter((e) => e.userId === userId);
  }

  getRecentEntries(limit = 50): AuditEntry[] {
    return this.log.slice(-limit);
  }

  clear(): void {
    this.log = [];
    _entryCounter = 0;
  }
}
