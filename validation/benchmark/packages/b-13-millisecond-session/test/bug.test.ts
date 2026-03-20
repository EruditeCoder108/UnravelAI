import { describe, it, expect } from 'vitest';
import { TokenIssuer } from '../src/auth/TokenIssuer';
import { TokenValidator } from '../src/auth/TokenValidator';
import { AuthMiddleware } from '../src/middleware/AuthMiddleware';
import { ProtectedRouter } from '../src/routes/ProtectedRouter';

const SECRET = 'test-secret-key';
const issuer = new TokenIssuer(SECRET);
const validator = new TokenValidator(SECRET);
const middleware = new AuthMiddleware(validator);
const router = new ProtectedRouter(middleware);

describe('B-13 TokenValidator — exp seconds vs Date.now() milliseconds', () => {
  it('a freshly issued token should be valid', () => {
    const { token } = issuer.issue('user-1', 'user', 3600);
    expect(validator.isValid(token)).toBe(true);
  });

  it('a request with a fresh token should receive 200', () => {
    const { token } = issuer.issue('user-42', 'user', 3600);
    const result = router.handle({
      headers: { authorization: `Bearer ${token}` },
      path: '/api/data',
    });
    expect(result.status).toBe(200);
  });

  it('isValid returns true for a token with 1 hour TTL', () => {
    const { token, payload } = issuer.issue('user-1', 'user', 3600);
    const nowSeconds = Math.floor(Date.now() / 1000);
    expect(payload.exp).toBeGreaterThan(nowSeconds);
    expect(validator.isValid(token)).toBe(true);
  });

  it('isValid returns false only for a genuinely expired token', () => {
    const payload = {
      sub: 'user-1',
      role: 'user' as const,
      iat: Math.floor(Date.now() / 1000) - 7200,
      exp: Math.floor(Date.now() / 1000) - 3600,
    };
    const header = btoa(JSON.stringify({ alg: 'HS256', typ: 'JWT' }));
    const body = btoa(JSON.stringify(payload));
    const sig = btoa(`${SECRET}:${header}.${body}`);
    const expiredToken = `${header}.${body}.${sig}`;

    expect(validator.isValid(expiredToken)).toBe(false);
    const freshToken = issuer.issue('user-1', 'user', 3600).token;
    expect(validator.isValid(freshToken)).toBe(true);
  });
});
