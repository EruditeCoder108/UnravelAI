## Environment
- Node 20.11, pnpm 8.15, macOS 14.3
- TypeScript 5.4, ESM modules
- Present since PR #178 ("add permission checks to user reads")

## Symptom
The application crashes on the first authenticated request with a
RangeError: Maximum call stack size exceeded. The crash happens inside
the Gateway error handler. Before the crash, a TypeError is logged:
`this.userService.getRoles is not a function`.

The stack trace shows `gateway.handle` calling an error logging function
which calls itself repeatedly until the stack overflows. The error handler
appears to be recursing infinitely.

Stack trace (truncated):
```
RangeError: Maximum call stack size exceeded
  at Gateway.handle (src/gateway/Gateway.ts:28)
  at Gateway.handle (src/gateway/Gateway.ts:28)
  at Gateway.handle (src/gateway/Gateway.ts:28)
  ... (repeated ~10,000 times)
```

The error is triggered by the first `validateToken` call. Before the
stack overflow there is one meaningful error:
`TypeError: this.userService.getRoles is not a function`

I believe the bug is in `Gateway.ts`. The error handler catches an
exception and calls `this.authService.logError()` — but if `logError`
itself throws, the catch block catches that and calls `logError` again,
creating infinite recursion. The fix should be to add a `try/catch`
around the `logError` call or to add a recursion depth guard.

## What I tried
- Wrapped `this.authService.logError()` in a nested try/catch — the inner
  catch logs to `console.error` instead, which stops the stack overflow
  but the original error (`getRoles is not a function`) still occurs
- Added `console.log(typeof this.authService.logError)` before the call —
  logs `undefined`, confirming the method doesn't exist at runtime
- Checked that `AuthService` is imported correctly in `Gateway.ts` — import
  looks syntactically correct

The bug must be in `Gateway.ts` — the error handler is recursing because
`logError` is undefined, and the solution is to guard the call with a
typeof check before invoking it.
