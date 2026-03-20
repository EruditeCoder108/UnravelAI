## Environment
- Node 20.11, pnpm 8.15, Linux (Vercel serverless, production)
- TypeScript 5.4
- Works correctly during development, fails under sustained production traffic

## Symptom
After approximately 60 seconds of sustained traffic, the API starts returning
429 Too Many Requests for every single request — including requests from IPs
that have never hit the endpoint before. The rejection is total: once it
starts, no requests get through until the function is redeployed.

This does not happen in local development or in the test suite. It only
manifests in the serverless production environment after the function has
been warm for more than a minute.

We have confirmed the rate limiter is responsible by disabling it — without
the limiter, all requests succeed. With it enabled, the blanket rejection
begins ~60 seconds after the first request in each deployment.

The `maxRequests` threshold is currently set to 100 requests per 60 seconds.
We receive approximately 200 req/s in production, so the limit is being hit
legitimately. I believe the fix is to increase `maxRequests` to 1000 in
`RequestHandler.ts`. Alternatively we could increase `windowMs`.

## Stack trace
No crash. Every request returns HTTP 429 after the warm period:
`{ "error": "Too Many Requests", "retryAfter": 60 }`

## What I tried
- Increased `maxRequests` from 100 to 500 in `RequestHandler.ts` — delayed
  the onset of blanket rejection but did not fix it; starts at ~5 minutes instead of 1
- Decreased `windowMs` from 60000 to 10000 — made it worse, rejection starts sooner
- Checked `RateLimiter.check()` logic — the window reset logic looks correct
- Confirmed the bug only happens in serverless (Vercel), not in a long-running
  Express server on a VM

The bug must be in `RequestHandler.ts` — the `limiter` instance is configured
with values that are too restrictive for the actual traffic volume. We need
to tune the thresholds to match production load.
