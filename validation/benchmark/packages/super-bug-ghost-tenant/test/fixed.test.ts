/**
 * Super Bug: The Ghost Tenant — fixed.test.ts
 *
 * Fix applied to src/middleware/TenantMiddleware.ts:
 *
 * BEFORE (buggy):
 *   setTenant(req.tenantId);                    // line 38 — write BEFORE await
 *   await verifyTenantExists(req.tenantId);     // line 39 — async gap AFTER write
 *
 * AFTER (fixed):
 *   await verifyTenantExists(req.tenantId);     // verify first
 *   setTenant(req.tenantId);                    // write AFTER await resolves
 */

import { describe, it, expect, beforeEach } from 'vitest';
import { setTenant, getTenant, clearTenant } from '../src/context/TenantContext';
import { verifyTenantExists, TenantRequest } from '../src/middleware/TenantMiddleware';
import { AuthMiddleware } from '../src/middleware/AuthMiddleware';
import { TenantCache } from '../src/cache/TenantCache';
import { AuditLogger } from '../src/audit/AuditLogger';
import { DocumentRepository } from '../src/repositories/DocumentRepository';
import { DocumentService } from '../src/services/DocumentService';
import { DocumentRouter } from '../src/routes/DocumentRouter';

class FixedTenantMiddleware {
  async handle(req: TenantRequest, next: () => Promise<void>): Promise<void> {
    if (!req.tenantId) throw new Error('Missing tenantId');
    await verifyTenantExists(req.tenantId);
    setTenant(req.tenantId);
    try {
      await next();
    } finally {
      clearTenant();
    }
  }
}

function buildFixedApp() {
  const cache = new TenantCache();
  const audit = new AuditLogger();
  const repo = new DocumentRepository(cache);
  const service = new DocumentService(repo, audit);
  const tenantMiddleware = new FixedTenantMiddleware() as unknown as import('../src/middleware/TenantMiddleware').TenantMiddleware;
  const authMiddleware = new AuthMiddleware();
  const router = new DocumentRouter(tenantMiddleware, authMiddleware, service);
  return { router, audit, cache };
}

beforeEach(() => { clearTenant(); });

describe('Ghost Tenant — fixed (await before setTenant)', () => {
  it('concurrent requests from different tenants return only their own documents', async () => {
    const { router } = buildFixedApp();

    const [acmeRes, globexRes] = await Promise.all([
      router.handleList({ authorization: 'Bearer acme-user-token' }, 'acme'),
      router.handleList({ authorization: 'Bearer globex-user-token' }, 'globex'),
    ]);

    const acmeDocs = (acmeRes.body as { documents: { tenant_id: string }[] }).documents;
    const globexDocs = (globexRes.body as { documents: { tenant_id: string }[] }).documents;

    expect(acmeDocs.every(d => d.tenant_id === 'acme')).toBe(true);
    expect(globexDocs.every(d => d.tenant_id === 'globex')).toBe(true);
  });

  it('requestTenant matches requesting tenant under concurrency', async () => {
    const { router } = buildFixedApp();

    const [a, b] = await Promise.all([
      router.handleList({ authorization: 'Bearer acme-user-token' }, 'acme'),
      router.handleList({ authorization: 'Bearer globex-user-token' }, 'globex'),
    ]);

    expect(a.requestTenant).toBe('acme');
    expect(b.requestTenant).toBe('globex');
  });

  it('50 concurrent mixed requests never leak documents', async () => {
    const { router } = buildFixedApp();

    const results = await Promise.all(
      Array.from({ length: 50 }, (_, i) => {
        const isAcme = i % 2 === 0;
        return router.handleList(
          { authorization: isAcme ? 'Bearer acme-user-token' : 'Bearer globex-user-token' },
          isAcme ? 'acme' : 'globex'
        );
      })
    );

    for (let i = 0; i < results.length; i++) {
      const expected = i % 2 === 0 ? 'acme' : 'globex';
      const docs = (results[i].body as { documents: { tenant_id: string }[] }).documents;
      expect(docs.every(d => d.tenant_id === expected)).toBe(true);
    }
  });

  it('audit entries are recorded under the correct tenant', async () => {
    const { router, audit } = buildFixedApp();

    await Promise.all([
      router.handleList({ authorization: 'Bearer acme-user-token' }, 'acme'),
      router.handleList({ authorization: 'Bearer globex-user-token' }, 'globex'),
    ]);

    const acmeAudit = audit.getEntriesForTenant('acme');
    const globexAudit = audit.getEntriesForTenant('globex');

    expect(acmeAudit.every(e => e.tenantId === 'acme')).toBe(true);
    expect(globexAudit.every(e => e.tenantId === 'globex')).toBe(true);
  });
});
