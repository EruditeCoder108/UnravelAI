## Environment
- Node 20.11, pnpm 8.15, Linux (production)
- TypeScript 5.4, custom JWT implementation
- Present since v2.0.0 launch — never worked in production

## Symptom
Every authenticated request in production returns 401 Unauthorized with
`"Token is invalid or expired"`. The application is completely unusable for
all logged-in users. Tokens are being issued successfully — login works and
returns a token — but every subsequent request with that token is rejected.

This does not reproduce in the test suite. All auth tests pass. The tokens
issued in tests work correctly in tests.

I believe the issue is in `TokenIssuer.ts`. The token signing process must
be producing malformed tokens that the validator cannot parse. I have
confirmed that `TokenValidator.decode()` does return a payload (not null),
so parsing works — but `isValid()` still returns false. The `exp` field
in the decoded payload shows a value around 1,720,000,000, which looks
plausible for a Unix timestamp set one hour in the future.

## Stack trace
No crash. Every request returns:
`{ "error": "Token is invalid or expired" }`

## What I tried
- Confirmed `TokenIssuer.issue()` runs without error and returns a token
- Called `TokenValidator.decode()` on a freshly issued token — returns valid payload
- Checked `payload.exp` value — it is `now + 3600` as expected, roughly 1,720,003,600
- Checked `payload.iat` value — it is the correct current Unix second timestamp
- Searched for any token transformation between issue and validate — found none
- Compared dev tokens (work fine in tests) with prod tokens — the only difference
  is that test tokens are generated at test runtime with `Date.now()` as base

The bug must be in `TokenIssuer.ts` — the `exp` field calculation or the
token encoding is producing values that the validator rejects in production
even though they appear correct when logged. Possibly a timezone or locale
issue affecting `Date.now()` on the production host.
