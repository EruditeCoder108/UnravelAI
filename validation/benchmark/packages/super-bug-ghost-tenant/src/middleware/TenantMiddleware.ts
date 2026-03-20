import { setTenant, clearTenant } from '../context/TenantContext';

export interface TenantRequest {
  tenantId: string;
  userId: string;
  path: string;
  method: string;
  headers: Record<string, string>;
  body?: unknown;
}

export interface TenantRecord {
  id: string;
  name: string;
  plan: 'starter' | 'professional' | 'enterprise';
  active: boolean;
  createdAt: number;
  allowedRegions: string[];
}

const TENANT_STORE: Record<string, TenantRecord> = {
  acme: {
    id: 'acme',
    name: 'Acme Corporation',
    plan: 'enterprise',
    active: true,
    createdAt: 1700000000,
    allowedRegions: ['us-east-1', 'eu-west-1'],
  },
  globex: {
    id: 'globex',
    name: 'Globex Industries',
    plan: 'professional',
    active: true,
    createdAt: 1700100000,
    allowedRegions: ['us-east-1'],
  },
  initech: {
    id: 'initech',
    name: 'Initech LLC',
    plan: 'starter',
    active: true,
    createdAt: 1700200000,
    allowedRegions: ['us-west-2'],
  },
  umbrella: {
    id: 'umbrella',
    name: 'Umbrella Corp',
    plan: 'enterprise',
    active: false,
    createdAt: 1699000000,
    allowedRegions: [],
  },
};

export async function verifyTenantExists(tenantId: string): Promise<TenantRecord> {
  await new Promise<void>((resolve) => setTimeout(resolve, 20));

  const tenant = TENANT_STORE[tenantId];
  if (!tenant) {
    throw new Error(`Tenant not found: ${tenantId}`);
  }
  if (!tenant.active) {
    throw new Error(`Tenant account is suspended: ${tenantId}`);
  }
  return tenant;
}

export class TenantMiddleware {
  async handle(req: TenantRequest, next: () => Promise<void>): Promise<void> {
    if (!req.tenantId) {
      throw new Error('Missing tenantId in request');
    }

    setTenant(req.tenantId);
    await verifyTenantExists(req.tenantId);

    try {
      await next();
    } finally {
      clearTenant();
    }
  }
}
