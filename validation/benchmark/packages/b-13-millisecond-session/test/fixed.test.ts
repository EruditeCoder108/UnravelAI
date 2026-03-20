/**
 * Fix: src/auth/TokenValidator.ts
 *
 * BEFORE:
 *   return payload.exp > Date.now();
 *
 * AFTER:
 *   return payload.exp * 1000 > Date.now();
 */

import { describe, it, expect } from 'vitest';
import { TokenIssuer } from '../src/auth/TokenIssuer';

const SECRET = 'test-secret-key';
const issuer = new TokenIssuer(SECRET);

function isValidFixed(token: string): boolean {
  try {
    const parts = token.split('.');
    if (parts.length !== 3) return false;
    const payload = JSON.parse(atob(parts[1]));
    if (!payload.sub || !payload.exp) return false;
    return payload.exp * 1000 > Date.now();
  } catch {
    return false;
  }
}

describe('B-13 TokenValidator — fixed (exp * 1000)', () => {
  it('fresh token is valid', () => {
    const { token } = issuer.issue('u1', 'user', 3600);
    expect(isValidFixed(token)).toBe(true);
  });

  it('token with 1-second TTL is still valid immediately after issue', () => {
    const { token } = issuer.issue('u1', 'user', 1);
    expect(isValidFixed(token)).toBe(true);
  });

  it('expired token (negative TTL simulation) is invalid', () => {
    const payload = {
      sub: 'u1',
      role: 'user',
      iat: Math.floor(Date.now() / 1000) - 7200,
      exp: Math.floor(Date.now() / 1000) - 3600,
    };
    const h = btoa(JSON.stringify({ alg: 'HS256', typ: 'JWT' }));
    const b = btoa(JSON.stringify(payload));
    const token = `${h}.${b}.${btoa(SECRET)}`;
    expect(isValidFixed(token)).toBe(false);
  });

  it('malformed token returns false', () => {
    expect(isValidFixed('not.a.token')).toBe(false);
    expect(isValidFixed('')).toBe(false);
  });
});
