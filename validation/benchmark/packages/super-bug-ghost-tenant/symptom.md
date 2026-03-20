## Environment
- Node 20.11, pnpm 8.15, Linux (production, 8-core server)
- Express 4.18, TypeScript 5.4
- Multi-tenant SaaS API, ~2,000 req/min peak load
- Appeared after PR #891 ("add tenant verification step to middleware pipeline")
- Severity: CRITICAL — confidential customer data exposure

## Symptom
Under production load, documents belonging to one tenant are appearing in
another tenant's API responses. A customer from Acme Corporation reported
seeing documents titled "Globex Operations Manual" and "Globex Supplier
Contracts" in their document listing. These documents are confidential to
Globex and should be completely invisible to Acme users.

The issue only manifests under concurrent load. In our staging environment
with single-threaded testing it has never reproduced. On the production
server processing ~2,000 requests per minute it occurs on approximately
1 in 300 requests.

The data leakage is consistent in its pattern: the documents returned belong
to a DIFFERENT tenant that was processing a request at approximately the same
time. The leaked documents are always real documents from a real tenant —
this is not garbage data.

Our audit logs are also showing tenant misattribution: access events are
being recorded under the wrong tenant ID, making it impossible to produce
accurate per-tenant audit trails.

We believe the issue is in `TenantCache.ts`. The cache uses `getTenant()`
to build cache keys — if cache keys are being constructed with the wrong
tenant ID, one tenant's cached results would be returned to another. We
have seen suspicious cache key patterns in our monitoring that show keys
like `acme:documents:list` being read during a request that should be
scoped to `globex`.

Alternatively the bug may be in `AuthMiddleware.ts`. If the JWT validation
is not correctly reading the `tenantId` claim and is falling back to a
previous request's tenant context, token validation could be serving the
wrong tenant's data.

## Stack trace
No crash. Silent data exposure.

Sequence observed in logs:
```
[req_4821] tenantId=acme  GET /documents → 200 (4 docs, all tenant_id=globex) ← WRONG
[req_4822] tenantId=globex GET /documents → 200 (2 docs, all tenant_id=globex) ← correct
```

## What I tried
- Added `console.log(getTenant())` at the top of `TenantCache.buildKey()` —
  confirmed it returns the wrong tenant ID during affected requests
- Added `console.log(req.tenantId)` at the entry of each request handler —
  confirmed the incoming `req.tenantId` is correct (acme for acme requests)
- Reviewed `AuthMiddleware.enrichRequest()` — correctly extracts tenantId
  from the JWT claim and attaches it to the request object
- Reviewed `TenantCache.get()` and `TenantCache.set()` — both look correct;
  they use `buildKey()` which uses `getTenant()`
- Checked `QueryBuilder.buildSelect()` — the WHERE clause uses `getTenant()`,
  and logging confirms it receives the wrong value

The bug must be in `TenantCache.ts`. The `buildKey()` method is calling
`getTenant()` which is returning a stale or wrong tenant ID. Either the
TenantContext module is not being reset between requests, or `TenantCache`
is somehow sharing state across requests. We should investigate whether
`TenantCache` should store the tenant ID at construction time rather than
reading it dynamically from TenantContext on every operation.
