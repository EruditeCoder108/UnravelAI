## Root Cause
**File:** `src/middleware/TenantMiddleware.ts` **Lines:** 38-39
`setTenant(req.tenantId)` is called BEFORE `await verifyTenantExists(req.tenantId)`.
`setTenant()` writes to `_activeTenant` — a module-level variable in
`TenantContext.ts`. The `await` on `verifyTenantExists()` creates an async
gap of ~20ms during which the Node.js event loop processes other requests.
Any concurrent request that arrives during this gap calls `setTenant()` with
its own tenant ID, overwriting `_activeTenant`. When the original request
resumes, `getTenant()` returns the wrong tenant. Every downstream operation
— cache lookups, WHERE clauses, audit entries — is contaminated.

## Causal Chain
1. Request A (tenant=acme): `setTenant('acme')` → `_activeTenant = 'acme'`
2. `await verifyTenantExists('acme')` — async gap opens, ~20ms
3. Request B (tenant=globex) arrives during the gap
4. Request B: `setTenant('globex')` → `_activeTenant = 'globex'` (overwrites)
5. Request A resumes: `getTenant()` → returns `'globex'`
6. `TenantCache.buildKey('documents:list')` → `'globex:documents:list'`
7. Cache hit: returns globex's documents to Request A (acme's user)
8. `QueryBuilder.buildSelect('documents')` → `WHERE tenant_id = 'globex'`
9. `DocumentRepository.findAll()` returns globex's documents to acme's session
10. `AuditLogger.record()` logs the access under tenant `'globex'`
Hops: 6 files (DocumentRouter → DocumentService → DocumentRepository →
               QueryBuilder ← TenantContext ← TenantMiddleware [BUG])

## The Three Hypotheses and Their Elimination

**H1 — TenantCache leaking data between tenants (ELIMINATED)**
`TenantCache.ts` has zero writes to `_activeTenant`. It reads `getTenant()`
to construct cache keys — it is a consumer of the corrupt value, not the
source. Eliminating this hypothesis: AST shows no imports of `setTenant`
anywhere in TenantCache.ts.

**H2 — JWT middleware not validating tenantId claim (ELIMINATED)**
`AuthMiddleware.ts` has zero imports of TenantContext. It decodes the JWT,
validates expiry and signature, and attaches `tenantId` to the request
object. It never touches `_activeTenant`. Call graph: AuthMiddleware →
req.tenantId (request property only). Eliminating: no path from
AuthMiddleware to TenantContext in the call graph.

**H3 — QueryBuilder WHERE clause using wrong field name (ELIMINATED)**
`QueryBuilder.buildSelect()` correctly parameterizes `WHERE tenant_id = ?`
with the value from `getTenant()`. The clause is correct. The parameter
is corrupt before arrival. Eliminating: QueryBuilder reads getTenant() as
a pure consumer — the corruption originates two files upstream.

## Key AST Signals
- Module-scope mutation: `_activeTenant` declared as `let` at module level
  in `TenantContext.ts L8` — zero writes inside any class or function body
  at declaration; written only via `setTenant()` and `clearTenant()`
- Async boundary: `TenantMiddleware.ts L39` — `await verifyTenantExists()`
  is a timing node; `setTenant()` at L38 precedes it with no await guard
- The write at L38 and the async boundary at L39 are adjacent lines —
  the race window is invisible without knowing `_activeTenant` is global
- Cross-file reads: `getTenant()` imported in QueryBuilder.ts L3,
  TenantCache.ts L3, AuditLogger.ts L3 — all read the same module-level
  variable; none can detect it was overwritten between their import and call

## The Fix
```diff
  async handle(req: TenantRequest, next: () => Promise<void>): Promise<void> {
-   setTenant(req.tenantId);
    await verifyTenantExists(req.tenantId);
+   setTenant(req.tenantId);
    await next();
    clearTenant();
  }
```

## Why the Fix Works
Moving `setTenant()` after `await verifyTenantExists()` eliminates the
async gap between the write and the downstream reads. After the await
resolves, execution is synchronous until `clearTenant()` — no concurrent
request can interleave between the write and next(). The architectural
fix (AsyncLocalStorage for per-request context) eliminates the root cause
entirely, but the one-line swap is the minimal correct fix.

## Why This Bug Defeats LLM-Only Analysis
1. Context dilution: 8 files, ~1,100 lines. The root cause is 2 adjacent
   lines in one middleware file. Without structural guidance, attention is
   distributed across the entire codebase.
2. Three independently plausible wrong hypotheses, each with supporting
   surface evidence. Single-pass hypothesis generation picks one and stops.
3. The async gap between two adjacent lines is invisible without knowing
   `_activeTenant` is module-scoped and shared across all concurrent requests.
4. The fix is swapping two lines. 1,100 lines of production code. One swap.

## Benchmark Metadata
- Category: RACE_CONDITION + STATE_MUTATION + ASYNC_ORDERING
- Difficulty: Extreme
- Files: 8
- Lines: ~1,100
- Hops: 6
- Hypotheses eliminated: 3
