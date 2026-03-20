export interface AuthContext {
  userId: string;
  role: 'user' | 'admin';
}

export interface CheckResult {
  allowed: boolean;
  context?: AuthContext;
  reason?: string;
}

const VALID_TOKENS: Record<string, AuthContext> = {
  'admin-token-abc123': { userId: 'admin-1', role: 'admin' },
  'user-token-xyz789': { userId: 'user-1', role: 'user' },
};

export class AuthMiddleware {
  verify(authHeader: string | undefined): CheckResult {
    if (!authHeader) {
      return { allowed: false, reason: 'Missing Authorization header' };
    }

    if (!authHeader.startsWith('Bearer ')) {
      return { allowed: false, reason: 'Invalid Authorization format' };
    }

    const token = authHeader.slice(7).trim();
    if (!token) {
      return { allowed: false, reason: 'Empty token' };
    }

    const context = VALID_TOKENS[token];
    if (!context) {
      return { allowed: false, reason: 'Invalid or expired token' };
    }

    return { allowed: true, context };
  }

  requireAdmin(authHeader: string | undefined): CheckResult {
    const result = this.verify(authHeader);
    if (!result.allowed) return result;
    if (result.context?.role !== 'admin') {
      return { allowed: false, reason: 'Admin role required' };
    }
    return result;
  }
}
