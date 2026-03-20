import { describe, it, expect, beforeEach } from 'vitest';
import { TenantMiddleware } from '../src/middleware/TenantMiddleware';
import { AuthMiddleware } from '../src/middleware/AuthMiddleware';
import { TenantCache } from '../src/cache/TenantCache';
import { AuditLogger } from '../src/audit/AuditLogger';
import { DocumentRepository } from '../src/repositories/DocumentRepository';
import { DocumentService } from '../src/services/DocumentService';
import { DocumentRouter } from '../src/routes/DocumentRouter';
import { clearTenant } from '../src/context/TenantContext';

function buildApp() {
  const cache = new TenantCache();
  const audit = new AuditLogger();
  const repo = new DocumentRepository(cache);
  const service = new DocumentService(repo, audit);
  const tenantMiddleware = new TenantMiddleware();
  const authMiddleware = new AuthMiddleware();
  const router = new DocumentRouter(tenantMiddleware, authMiddleware, service);
  return { router, audit, cache };
}

beforeEach(() => {
  clearTenant();
});

describe('Ghost Tenant — concurrent request tenant isolation', () => {
  it('sequential requests return documents belonging to the correct tenant', async () => {
    const { router } = buildApp();

    const acmeRes = await router.handleList(
      { authorization: 'Bearer acme-user-token' },
      'acme'
    );
    const globexRes = await router.handleList(
      { authorization: 'Bearer globex-user-token' },
      'globex'
    );

    expect(acmeRes.status).toBe(200);
    expect(globexRes.status).toBe(200);

    const acmeDocs = (acmeRes.body as { documents: { tenant_id: string }[] }).documents;
    const globexDocs = (globexRes.body as { documents: { tenant_id: string }[] }).documents;

    expect(acmeDocs.every(d => d.tenant_id === 'acme')).toBe(true);
    expect(globexDocs.every(d => d.tenant_id === 'globex')).toBe(true);
  });

  it('concurrent requests must not leak documents across tenant boundaries', async () => {
    const { router } = buildApp();

    const [acmeRes, globexRes] = await Promise.all([
      router.handleList({ authorization: 'Bearer acme-user-token' }, 'acme'),
      router.handleList({ authorization: 'Bearer globex-user-token' }, 'globex'),
    ]);

    expect(acmeRes.status).toBe(200);
    expect(globexRes.status).toBe(200);

    const acmeDocs = (acmeRes.body as { documents: { tenant_id: string }[] }).documents;
    const globexDocs = (globexRes.body as { documents: { tenant_id: string }[] }).documents;

    for (const doc of acmeDocs) {
      expect(doc.tenant_id).toBe('acme');
    }
    for (const doc of globexDocs) {
      expect(doc.tenant_id).toBe('globex');
    }
  });

  it('three concurrent requests from different tenants must each get only their own documents', async () => {
    const { router } = buildApp();

    const [acmeRes, globexRes, initechRes] = await Promise.all([
      router.handleList({ authorization: 'Bearer acme-user-token' }, 'acme'),
      router.handleList({ authorization: 'Bearer globex-user-token' }, 'globex'),
      router.handleList({ authorization: 'Bearer initech-user-token' }, 'initech'),
    ]);

    const acmeDocs = (acmeRes.body as { documents: { tenant_id: string }[] }).documents;
    const globexDocs = (globexRes.body as { documents: { tenant_id: string }[] }).documents;
    const initechDocs = (initechRes.body as { documents: { tenant_id: string }[] }).documents;

    expect(acmeDocs.length).toBeGreaterThan(0);
    expect(globexDocs.length).toBeGreaterThan(0);
    expect(initechDocs.length).toBeGreaterThan(0);

    expect(acmeDocs.every(d => d.tenant_id === 'acme')).toBe(true);
    expect(globexDocs.every(d => d.tenant_id === 'globex')).toBe(true);
    expect(initechDocs.every(d => d.tenant_id === 'initech')).toBe(true);
  });

  it('requestTenant on response must match the requesting tenant', async () => {
    const { router } = buildApp();

    const [acmeRes, globexRes] = await Promise.all([
      router.handleList({ authorization: 'Bearer acme-user-token' }, 'acme'),
      router.handleList({ authorization: 'Bearer globex-user-token' }, 'globex'),
    ]);

    expect(acmeRes.requestTenant).toBe('acme');
    expect(globexRes.requestTenant).toBe('globex');
  });

  it('audit log records each event under the correct tenant', async () => {
    const { router, audit } = buildApp();

    await Promise.all([
      router.handleList({ authorization: 'Bearer acme-user-token' }, 'acme'),
      router.handleList({ authorization: 'Bearer globex-user-token' }, 'globex'),
    ]);

    const acmeAudit = audit.getEntriesForTenant('acme');
    const globexAudit = audit.getEntriesForTenant('globex');

    expect(acmeAudit.length).toBeGreaterThan(0);
    expect(globexAudit.length).toBeGreaterThan(0);

    for (const entry of acmeAudit) {
      expect(entry.tenantId).toBe('acme');
    }
    for (const entry of globexAudit) {
      expect(entry.tenantId).toBe('globex');
    }
  });

  it('50 concurrent mixed-tenant requests never produce cross-tenant documents', async () => {
    const { router } = buildApp();

    const requests = Array.from({ length: 50 }, (_, i) => {
      const isAcme = i % 2 === 0;
      return router.handleList(
        { authorization: isAcme ? 'Bearer acme-user-token' : 'Bearer globex-user-token' },
        isAcme ? 'acme' : 'globex'
      );
    });

    const results = await Promise.all(requests);

    for (let i = 0; i < results.length; i++) {
      const expectedTenant = i % 2 === 0 ? 'acme' : 'globex';
      const docs = (results[i].body as { documents: { tenant_id: string }[] }).documents;
      for (const doc of docs) {
        expect(doc.tenant_id).toBe(expectedTenant);
      }
    }
  });
});
