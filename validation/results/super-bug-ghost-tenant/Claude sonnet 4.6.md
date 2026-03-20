\## 1. Hypothesis Tree



\*\*H1: `TenantCache.ts` — `buildKey()` calls `getTenant()` at the wrong time, returning a stale tenant ID\*\*

ELIMINATED as root cause (correctly observed symptom, wrong cause). The developer confirmed `getTenant()` returns the wrong value inside `buildKey()` — but this is a \*consequence\* of the context being wrong, not the source of why it's wrong. `TenantCache` reads context correctly; it's being called when the context holds the wrong value.



\*\*H2: `AuthMiddleware.ts` — JWT validation falls back to a previous request's tenant context\*\*

ELIMINATED. `AuthMiddleware.ts:63-71`: `enrichRequest()` reads `tenantId` directly from the JWT payload and attaches it to the request object. It never calls `getTenant()` — it only produces a `tenantId` value, it doesn't consume the context. The developer also confirmed `req.tenantId` is correct at the entry of each handler.



\*\*H3: `TenantContext.ts:1` — `\_activeTenant` is a module-level variable shared across all concurrent requests, and `TenantMiddleware` sets it before `verifyTenantExists` yields, allowing another concurrent request to overwrite it mid-flight\*\*

SURVIVED (root cause). `TenantContext.ts:1`: `let \_activeTenant: string | null = null` — a single mutable value for the entire Node.js process. `TenantMiddleware.ts:62`: `setTenant(req.tenantId)` sets this global, then `TenantMiddleware.ts:63`: `await verifyTenantExists(req.tenantId)` yields to the event loop for 20ms. During that 20ms window, any other concurrent request calling `setTenant()` overwrites `\_activeTenant` for the entire process.



\---



\## 2. Root Cause



\*\*File:\*\* `TenantContext.ts`, \*\*line 1\*\*, exploited at \*\*`TenantMiddleware.ts:62-63`\*\*



```ts

// TenantContext.ts:1

let \_activeTenant: string | null = null; // single global — shared by ALL concurrent requests



// TenantMiddleware.ts:62-63

setTenant(req.tenantId);                 // sets global to "acme"

await verifyTenantExists(req.tenantId);  // yields for 20ms — any other request can overwrite

```



Node.js is single-threaded but not single-concurrent. Every `await` is a yield point. Between `setTenant('acme')` and the resumption after `verifyTenantExists`, a concurrent request for `globex` calls `setTenant('globex')`, overwriting the global. When the acme request resumes, `getTenant()` returns `'globex'` — poisoning every downstream caller: `QueryBuilder`, `TenantCache`, and `AuditLogger`.



\---



\## 3. Causal Chain



```

\[TenantMiddleware.ts:62] req\_4821 (acme): setTenant('acme') → \_activeTenant = 'acme'

\[TenantMiddleware.ts:63] req\_4821 (acme): await verifyTenantExists('acme') → yields \~20ms

&#x20; → \[TenantMiddleware.ts:62] req\_4822 (globex): setTenant('globex') → \_activeTenant = 'globex'  ← OVERWRITES

\[TenantMiddleware.ts:63] req\_4821 (acme): verifyTenantExists resolves, resumes

&#x20; → \[TenantMiddleware.ts:65] next() called — but \_activeTenant is now 'globex'

&#x20; → \[DocumentRepository.ts:83] cache.get('documents:list:{}') → buildKey() → getTenant() = 'globex'

&#x20; → \[TenantCache.ts:30] key = 'globex:documents:list:{}'

&#x20; → \[DocumentRepository.ts:97] qb.buildSelect() → getTenant() = 'globex' → query.tenantId = 'globex'

&#x20; → \[DocumentRepository.ts:103] DOCUMENT\_STORE filtered by tenant\_id === 'globex' → Globex docs returned

&#x20; → \[AuditLogger.ts:36] getTenant() = 'globex' → audit entry stamped with wrong tenant

&#x20; → \[DocumentRouter.ts:58] result returned to acme user containing Globex documents

&#x20; → Symptom: cross-tenant data exposure, audit misattribution

```



\---



\## 4. Proximate Trap



The report blames \*\*`TenantCache.ts`'s `buildKey()`\*\* calling `getTenant()` at the wrong time. This is the right observation but the wrong file. The cache, query builder, and audit logger are all \*victims\* — they call `getTenant()` correctly within the tenant scope, but by the time they run, the global has already been corrupted by a concurrent request. Fixing `TenantCache` to store the tenant at construction time would only mask the symptom for cache operations; `QueryBuilder` and `AuditLogger` would still read the poisoned global.



\---



\## 5. Minimal Fix



Use Node.js `AsyncLocalStorage` to give each request its own isolated tenant context instead of a shared global:



```ts

// TenantContext.ts

import { AsyncLocalStorage } from 'async\_hooks';



const storage = new AsyncLocalStorage<string>();



export function setTenant(tenantId: string): void {

&#x20; // replaced by withTenant — direct set no longer exists

}



export function getTenant(): string {

&#x20; const tenantId = storage.getStore();

&#x20; if (tenantId === undefined) {

&#x20;   throw new Error('TenantContext accessed outside of a tenant-scoped request.');

&#x20; }

&#x20; return tenantId;

}



export function getTenantOrNull(): string | null {

&#x20; return storage.getStore() ?? null;

}



export function withTenant<T>(tenantId: string, fn: () => T): T {

&#x20; return storage.run(tenantId, fn);

}



export function clearTenant(): void { /\* no-op — scope ends with withTenant \*/ }

```



```ts

// TenantMiddleware.ts — replace setTenant/clearTenant pattern

import { withTenant } from '../context/TenantContext';



async handle(req: TenantRequest, next: () => Promise<void>): Promise<void> {

&#x20; await verifyTenantExists(req.tenantId); // verify BEFORE entering scope

&#x20; await withTenant(req.tenantId, () => next()); // scope is per-call-stack, not global

}

```



`AsyncLocalStorage.run()` binds the value to the async execution context of that specific call chain. Concurrent requests each get their own store — `getTenant()` in req\_4821's continuation always returns `'acme'` regardless of what req\_4822 does. No changes needed in `TenantCache`, `QueryBuilder`, `AuditLogger`, `DocumentRepository`, or anywhere else.

