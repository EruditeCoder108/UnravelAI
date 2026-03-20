let _activeTenant: string | null = null;

export function setTenant(tenantId: string): void {
  _activeTenant = tenantId;
}

export function getTenant(): string {
  if (_activeTenant === null) {
    throw new Error(
      'TenantContext accessed outside of a tenant-scoped request. ' +
      'Ensure TenantMiddleware runs before any tenant-aware code.'
    );
  }
  return _activeTenant;
}

export function getTenantOrNull(): string | null {
  return _activeTenant;
}

export function clearTenant(): void {
  _activeTenant = null;
}

export function withTenant<T>(tenantId: string, fn: () => T): T {
  const previous = _activeTenant;
  _activeTenant = tenantId;
  try {
    return fn();
  } finally {
    _activeTenant = previous;
  }
}
