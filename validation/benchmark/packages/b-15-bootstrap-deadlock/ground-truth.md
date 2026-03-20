## Root Cause
**File:** `src/auth/AuthService.ts` **Line:** 3 and `src/users/UserService.ts` **Line:** 3
A circular import exists: `AuthService` imports `UserService` to resolve user
roles during token validation; `UserService` imports `AuthService` to verify
the caller has permission to read user records. Node.js resolves the cycle by
giving one module a partially-initialised empty object `{}` at the time the
other module loads. Whichever module loads second receives an empty stub for
the first. When `AuthService.validateToken()` calls `this.userService.getRoles()`,
`getRoles` is `undefined` — throwing `TypeError: this.userService.getRoles is not a function`.
The error handler in `Gateway` catches this and calls `AuthService.logError()` to
record it — but `AuthService` itself arrived as an empty stub in `Gateway`, so
`logError` is also `undefined`. The second throw is caught by the same handler,
which calls `AuthService.logError()` again — infinite recursion until stack overflow.

## Causal Chain
1. `Gateway` imports both `AuthService` and `UserService`
2. Node.js begins loading `AuthService` — encounters `import UserService`
3. Node.js begins loading `UserService` — encounters `import AuthService`
4. `AuthService` is not yet fully initialised — Node.js provides `{}` as its value
5. `UserService` finishes loading with a broken `authService = {}`
6. `AuthService` finishes loading with a valid `userService`
7. `Gateway.handleRequest()` calls `authService.validateToken()`
8. `validateToken` calls `this.userService.getRoles(userId)` — works
9. `getRoles` calls `this.authService.hasPermission(caller)` — `hasPermission` is undefined
10. `TypeError` thrown — Gateway error handler catches it
11. Error handler calls `authService.logError(err)` — `logError` is undefined on the stub
12. Second `TypeError` thrown — same handler catches it again — infinite loop → stack overflow
Hops: 4 files (Gateway → AuthService → UserService → AuthService cycle)

## Key AST Signals
- Circular import: call graph shows `AuthService → UserService → AuthService`
- `UserService.ts L3`: `import { AuthService } from '../auth/AuthService'`
- `AuthService.ts L3`: `import { UserService } from '../users/UserService'`
- Both imports are at module top level — not dynamic, not lazy
- `Gateway.ts` error handler calls `authService.logError()` — property accessed
  on a potentially-empty stub depending on import resolution order

## The Fix
Break the cycle by injecting `AuthService` into `UserService` at runtime
rather than at import time:

```diff
  // UserService.ts
- import { AuthService } from '../auth/AuthService';
  
  export class UserService {
-   private authService: AuthService;
-   constructor(authService: AuthService) {
-     this.authService = authService;
+   private authService: { hasPermission: (c: string, p: string) => boolean } | null = null;
+
+   setAuthService(auth: { hasPermission: (c: string, p: string) => boolean }): void {
+     this.authService = auth;
    }
```
Then in `Gateway`: construct both services first, then wire them:
```diff
+ const userService = new UserService();
+ const authService = new AuthService(userService);
+ userService.setAuthService(authService);
```

## Why the Fix Works
Removing the top-level import of `AuthService` from `UserService` breaks the
cycle. Node.js can now fully initialise `AuthService` before `UserService` ever
needs it. The `setAuthService` call at runtime passes the live instance after
both are constructed — no empty stubs, no undefined methods.

## Proximate Fixation Trap
The reporter blames the error handler in `Gateway.ts` because the stack trace
shows infinite recursion originating there. Adding a recursion depth counter
to the error handler would prevent the stack overflow but would not fix the
underlying circular import or the undefined method calls. The root cause is
the `import` statements in `AuthService.ts` and `UserService.ts`.

## Benchmark Metadata
- Category: `INFINITE_LOOP`
- Difficulty: Hard
- Files: 5
- File hops from symptom to root cause: 4 (Gateway → AuthService → UserService → AuthService)
- Tests: ① RCA Accuracy ② Proximate Fixation Resistance ③ Cross-file Reasoning
