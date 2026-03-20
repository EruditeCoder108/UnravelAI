import { getTenant } from '../context/TenantContext';

export interface CacheStats {
  hits: number;
  misses: number;
  evictions: number;
}

export interface CacheEntry<T> {
  value: T;
  tenantId: string;
  storedAt: number;
  ttlMs: number;
}

export class TenantCache {
  private store = new Map<string, CacheEntry<unknown>>();
  private stats: CacheStats = { hits: 0, misses: 0, evictions: 0 };
  private defaultTtlMs: number;

  constructor(defaultTtlMs = 30_000) {
    this.defaultTtlMs = defaultTtlMs;
  }

  private buildKey(resource: string): string {
    const tenantId = getTenant();
    return `${tenantId}:${resource}`;
  }

  get<T>(resource: string): T | null {
    const key = this.buildKey(resource);
    const entry = this.store.get(key) as CacheEntry<T> | undefined;

    if (!entry) {
      this.stats.misses++;
      return null;
    }

    if (Date.now() - entry.storedAt > entry.ttlMs) {
      this.store.delete(key);
      this.stats.evictions++;
      this.stats.misses++;
      return null;
    }

    this.stats.hits++;
    return entry.value;
  }

  set<T>(resource: string, value: T, ttlMs?: number): void {
    const key = this.buildKey(resource);
    const tenantId = getTenant();
    this.store.set(key, {
      value,
      tenantId,
      storedAt: Date.now(),
      ttlMs: ttlMs ?? this.defaultTtlMs,
    });
  }

  invalidate(resource: string): void {
    const key = this.buildKey(resource);
    this.store.delete(key);
  }

  invalidateAll(): void {
    const tenantId = getTenant();
    for (const [key] of this.store.entries()) {
      if (key.startsWith(`${tenantId}:`)) {
        this.store.delete(key);
      }
    }
  }

  getStats(): CacheStats {
    return { ...this.stats };
  }

  resetStats(): void {
    this.stats = { hits: 0, misses: 0, evictions: 0 };
  }

  peek(resource: string): CacheEntry<unknown> | undefined {
    const key = this.buildKey(resource);
    return this.store.get(key);
  }

  getRawStore(): Map<string, CacheEntry<unknown>> {
    return this.store;
  }
}
