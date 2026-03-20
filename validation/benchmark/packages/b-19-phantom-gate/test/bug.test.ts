import { describe, it, expect } from 'vitest';
import { AuthMiddleware } from '../src/auth/AuthMiddleware';
import { AdminRouter } from '../src/routes/AdminRouter';

const auth = new AuthMiddleware();
const router = new AdminRouter(auth);

describe('B-19 AdminRouter — no authentication bypass (correct code)', () => {
  it('request without token returns 401', () => {
    const res = router.handle({ path: '/api/admin/users', headers: {} });
    expect(res.status).toBe(401);
  });

  it('request with user token (non-admin) returns 401', () => {
    const res = router.handle({
      path: '/api/admin/users',
      headers: { authorization: 'Bearer user-token-xyz789' },
    });
    expect(res.status).toBe(401);
    expect((res.body as { error: string }).error).toContain('Admin role required');
  });

  it('request with valid admin token returns 200', () => {
    const res = router.handle({
      path: '/api/admin/users',
      headers: { authorization: 'Bearer admin-token-abc123' },
    });
    expect(res.status).toBe(200);
  });

  it('all admin routes require authentication', () => {
    const routes = ['/api/admin/users', '/api/admin/settings', '/api/admin/stats'];
    for (const path of routes) {
      const res = router.handle({ path, headers: {} });
      expect(res.status).toBe(401);
    }
  });

  it('AuthMiddleware correctly rejects malformed headers', () => {
    expect(auth.verify('Token abc').allowed).toBe(false);
    expect(auth.verify('').allowed).toBe(false);
    expect(auth.verify('Bearer ').allowed).toBe(false);
    expect(auth.verify(undefined).allowed).toBe(false);
  });
});
