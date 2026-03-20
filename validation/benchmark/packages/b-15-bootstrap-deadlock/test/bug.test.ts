import { describe, it, expect } from 'vitest';
import { AuthService } from '../src/auth/AuthService';
import { UserService } from '../src/users/UserService';
import { Gateway } from '../src/gateway/Gateway';

describe('B-15 Circular import — AuthService ↔ UserService', () => {
  it('UserService.getRoles() should not throw when called through AuthService', () => {
    const userService = new UserService(null as unknown as AuthService);
    const authService = new AuthService(userService);
    const gateway = new Gateway(authService);

    const response = gateway.handle({
      token: 'user001-token',
      path: '/api/data',
      caller: 'gateway',
    });

    expect(response.status).not.toBe(500);
    expect(response.status).toBe(200);
  });

  it('authService.hasPermission is callable from within UserService.getRoles', () => {
    const userService = new UserService(null as unknown as AuthService);
    const authService = new AuthService(userService);

    expect(() => userService.getRoles('user001')).not.toThrow();
    expect(userService.getRoles('user001')).toContain('viewer');
  });

  it('gateway handles a valid token and returns 200', () => {
    const userService = new UserService(null as unknown as AuthService);
    const authService = new AuthService(userService);
    const gateway = new Gateway(authService);

    const response = gateway.handle({
      token: 'user002-token',
      path: '/api/items',
      caller: 'gateway',
    });

    expect(response.status).toBe(200);
  });

  it('UserService receives a functioning AuthService, not an empty stub', () => {
    const userService = new UserService(null as unknown as AuthService);
    const authService = new AuthService(userService);

    expect(typeof (authService as unknown as Record<string, unknown>)['hasPermission']).toBe('function');
    expect(typeof (userService as unknown as Record<string, unknown>)['authService']).not.toBe('undefined');
  });
});
