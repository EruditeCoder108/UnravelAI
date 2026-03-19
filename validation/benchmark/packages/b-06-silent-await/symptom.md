## Environment
- Node 20.11, pnpm 8.15, Ubuntu 22.04 (production), macOS 14.3 (dev)
- TypeScript 5.4, custom service architecture
- Works 100% of the time in local dev, fails ~60% of the time on cold production starts

## Symptom
On production cold starts, the first 1–3 requests to any user endpoint
fail with: `Database is not ready. Ensure init() has fully resolved before
issuing queries.`

After those first failures the service recovers and handles all subsequent
requests correctly for the rest of its uptime. Restarting the process
reproduces the failures on the first requests again.

This never happens in development. We have added extensive logging and
confirmed the error comes from `UserRepository.findById()` — specifically
the `db.query()` call inside it. The `DatabaseNotReadyError` is thrown
by the `isReady` guard inside `DatabaseService`.

I believe the issue is in `UserRepository.ts` — the `isReady` guard
inside `DatabaseService.query()` is too aggressive. We should either
remove it or add a retry loop so queries wait for the connection rather
than failing immediately. Our dev machines are fast enough that the DB
is always ready before the first request, but production hosts are slower.

## Stack trace
```
DatabaseNotReadyError: Database is not ready.
  at DatabaseService.query (src/services/DatabaseService.ts:58:13)
  at UserRepository.findById (src/repositories/UserRepository.ts:31:32)
  at Application.handleRequest (src/app/Application.ts:52:28)
```

## What I tried
- Added a 100ms `setTimeout` before the first `handleRequest()` call — fixed it
- Removed the `isReady` guard from `DatabaseService.query()` — queries then
  fail with a connection error from the underlying driver instead
- Added a retry loop inside `UserRepository.findById()` — works but feels wrong

The bug must be in `UserRepository.ts` — the repository should handle
the case where the database connection isn't ready yet rather than letting
the error propagate.
