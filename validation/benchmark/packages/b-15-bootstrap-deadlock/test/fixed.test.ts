/**
 * Fix: break the circular import by removing the top-level AuthService import
 * from UserService and injecting it via a setter after construction.
 *
 * BEFORE (UserService.ts):
 *   import { AuthService } from '../auth/AuthService';
 *   constructor(authService: AuthService) { this.authService = authService; }
 *
 * AFTER (UserService.ts):
 *   private authService: { hasPermission(c: string, p: string): boolean } | null = null;
 *   setAuthService(auth: { hasPermission(c: string, p: string): boolean }): void {
 *     this.authService = auth;
 *   }
 *
 * Wiring in bootstrap:
 *   const userService = new FixedUserService();
 *   const authService = new AuthService(userService as any);
 *   userService.setAuthService(authService);
 */

import { describe, it, expect } from 'vitest';
import { AuthService } from '../src/auth/AuthService';
import { UserRecord } from '../src/users/UserService';

interface AuthLike {
  hasPermission(caller: string, permission: string): boolean;
}

class FixedUserService {
  private authService: AuthLike | null = null;

  private store: Record<string, UserRecord> = {
    'user001': { id: 'user001', name: 'Alice', roles: ['viewer'] },
    'user002': { id: 'user002', name: 'Bob', roles: ['editor', 'viewer'] },
  };

  setAuthService(auth: AuthLike): void {
    this.authService = auth;
  }

  getRoles(userId: string): string[] {
    if (!this.authService) throw new Error('AuthService not set');
    if (!this.authService.hasPermission('gateway', 'read:users')) {
      throw new Error('Caller lacks read:users permission');
    }
    return this.store[userId]?.roles ?? [];
  }
}

function buildFixed() {
  const userService = new FixedUserService();
  const authService = new AuthService(userService as unknown as import('../src/users/UserService').UserService);
  userService.setAuthService(authService);
  return { userService, authService };
}

describe('B-15 Circular import — broken via setter (fixed)', () => {
  it('getRoles works without throwing', () => {
    const { userService } = buildFixed();
    expect(() => userService.getRoles('user001')).not.toThrow();
    expect(userService.getRoles('user001')).toEqual(['viewer']);
  });

  it('authService.hasPermission is callable from userService', () => {
    const { userService } = buildFixed();
    const roles = userService.getRoles('user002');
    expect(roles).toContain('editor');
  });

  it('authService.validateToken succeeds end-to-end', () => {
    const { authService } = buildFixed();
    const result = authService.validateToken('user001-token', 'gateway');
    expect(result.valid).toBe(true);
    expect(result.userId).toBe('user001');
  });

  it('no undefined method errors on first call', () => {
    const { authService } = buildFixed();
    expect(() =>
      authService.validateToken('user002-abcd', 'gateway')
    ).not.toThrow();
  });
});
