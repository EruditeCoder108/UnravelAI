import { UserService } from '../users/UserService';

export interface TokenClaims {
  userId: string;
  caller: string;
}

export interface ValidationResult {
  valid: boolean;
  userId?: string;
  reason?: string;
}

export class AuthService {
  private userService: UserService;
  public errorLog: string[] = [];

  constructor(userService: UserService) {
    this.userService = userService;
  }

  validateToken(token: string, caller: string): ValidationResult {
    if (!token || token.length < 8) {
      return { valid: false, reason: 'Token too short' };
    }

    const claims: TokenClaims = { userId: token.slice(0, 8), caller };
    const roles = this.userService.getRoles(claims.userId);

    if (!roles.length) {
      return { valid: false, reason: 'User has no roles' };
    }

    return { valid: true, userId: claims.userId };
  }

  hasPermission(caller: string, permission: string): boolean {
    const knownCallers: Record<string, string[]> = {
      gateway: ['read:users', 'validate:tokens'],
      admin: ['read:users', 'write:users', 'validate:tokens'],
    };
    return knownCallers[caller]?.includes(permission) ?? false;
  }

  logError(context: string, err: unknown): void {
    const message = err instanceof Error ? err.message : String(err);
    this.errorLog.push(`[${context}] ${message}`);
  }
}
