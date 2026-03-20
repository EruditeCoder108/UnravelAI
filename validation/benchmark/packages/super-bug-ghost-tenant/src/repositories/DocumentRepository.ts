import { QueryBuilder } from '../db/QueryBuilder';
import { TenantCache } from '../cache/TenantCache';

export interface Document {
  id: string;
  tenant_id: string;
  title: string;
  content: string;
  author_id: string;
  status: 'draft' | 'published' | 'archived';
  tags: string[];
  created_at: number;
  updated_at: number;
  version: number;
}

export interface DocumentFilter {
  status?: 'draft' | 'published' | 'archived';
  authorId?: string;
  tag?: string;
}

const DOCUMENT_STORE: Document[] = [
  {
    id: 'doc-acme-001',
    tenant_id: 'acme',
    title: 'Acme Q4 Strategy',
    content: 'Confidential Acme strategic planning document...',
    author_id: 'user-001',
    status: 'published',
    tags: ['strategy', 'confidential'],
    created_at: 1700000100,
    updated_at: 1700000200,
    version: 3,
  },
  {
    id: 'doc-acme-002',
    tenant_id: 'acme',
    title: 'Acme Product Roadmap',
    content: 'Acme internal product roadmap for next fiscal year...',
    author_id: 'user-001',
    status: 'draft',
    tags: ['product', 'roadmap'],
    created_at: 1700001000,
    updated_at: 1700001500,
    version: 1,
  },
  {
    id: 'doc-globex-001',
    tenant_id: 'globex',
    title: 'Globex Operations Manual',
    content: 'Confidential Globex operational procedures...',
    author_id: 'user-002',
    status: 'published',
    tags: ['operations', 'manual'],
    created_at: 1700100100,
    updated_at: 1700100200,
    version: 5,
  },
  {
    id: 'doc-globex-002',
    tenant_id: 'globex',
    title: 'Globex Supplier Contracts',
    content: 'Confidential supplier agreement details...',
    author_id: 'user-002',
    status: 'published',
    tags: ['legal', 'contracts'],
    created_at: 1700101000,
    updated_at: 1700101200,
    version: 2,
  },
  {
    id: 'doc-initech-001',
    tenant_id: 'initech',
    title: 'Initech IT Policy',
    content: 'Initech internal IT security policies...',
    author_id: 'user-003',
    status: 'published',
    tags: ['it', 'policy'],
    created_at: 1700200100,
    updated_at: 1700200300,
    version: 4,
  },
];

export class DocumentRepository {
  private qb = new QueryBuilder('documents');
  private cache: TenantCache;

  constructor(cache: TenantCache) {
    this.cache = cache;
  }

  async findAll(filter?: DocumentFilter): Promise<Document[]> {
    const cacheKey = `documents:list:${JSON.stringify(filter ?? {})}`;
    const cached = this.cache.get<Document[]>(cacheKey);
    if (cached) return cached;

    const query = this.qb.buildSelect({
      filters: filter?.status ? { status: filter.status } : undefined,
    });

    await new Promise<void>((r) => setTimeout(r, 5));

    const results = DOCUMENT_STORE.filter((d) => {
      if (d.tenant_id !== query.tenantId) return false;
      if (filter?.status && d.status !== filter.status) return false;
      if (filter?.authorId && d.author_id !== filter.authorId) return false;
      if (filter?.tag && !d.tags.includes(filter.tag)) return false;
      return true;
    });

    this.cache.set(cacheKey, results, 60_000);
    return results;
  }

  async findById(id: string): Promise<Document | null> {
    const cacheKey = `documents:${id}`;
    const cached = this.cache.get<Document>(cacheKey);
    if (cached) return cached;

    const query = this.qb.buildSelect({ filters: { id } });

    await new Promise<void>((r) => setTimeout(r, 5));

    const doc = DOCUMENT_STORE.find(
      (d) => d.id === id && d.tenant_id === query.tenantId
    ) ?? null;

    if (doc) this.cache.set(cacheKey, doc, 60_000);
    return doc;
  }

  async create(
    data: Omit<Document, 'id' | 'tenant_id' | 'created_at' | 'updated_at' | 'version'>
  ): Promise<Document> {
    const query = this.qb.buildInsert(data as Record<string, unknown>);
    const now = Date.now();
    const doc: Document = {
      ...data,
      id: `doc-${query.tenantId}-${Date.now()}`,
      tenant_id: query.tenantId,
      created_at: now,
      updated_at: now,
      version: 1,
    };
    DOCUMENT_STORE.push(doc);
    this.cache.invalidate(`documents:list:${JSON.stringify({})}`);
    return doc;
  }
}
