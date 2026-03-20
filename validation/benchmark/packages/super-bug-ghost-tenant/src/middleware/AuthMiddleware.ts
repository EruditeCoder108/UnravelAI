import { TenantRequest } from './TenantMiddleware';

export interface JwtPayload {
  sub: string;
  tenantId: string;
  role: 'viewer' | 'editor' | 'admin';
  iat: number;
  exp: number;
}

export interface AuthResult {
  authenticated: boolean;
  payload?: JwtPayload;
  reason?: string;
}

const VALID_TOKENS: Record<string, JwtPayload> = {
  'acme-user-token': {
    sub: 'user-001',
    tenantId: 'acme',
    role: 'editor',
    iat: Math.floor(Date.now() / 1000) - 300,
    exp: Math.floor(Date.now() / 1000) + 3300,
  },
  'globex-user-token': {
    sub: 'user-002',
    tenantId: 'globex',
    role: 'viewer',
    iat: Math.floor(Date.now() / 1000) - 60,
    exp: Math.floor(Date.now() / 1000) + 3540,
  },
  'acme-admin-token': {
    sub: 'admin-001',
    tenantId: 'acme',
    role: 'admin',
    iat: Math.floor(Date.now() / 1000) - 120,
    exp: Math.floor(Date.now() / 1000) + 3480,
  },
  'initech-user-token': {
    sub: 'user-003',
    tenantId: 'initech',
    role: 'editor',
    iat: Math.floor(Date.now() / 1000) - 10,
    exp: Math.floor(Date.now() / 1000) + 3590,
  },
};

export class AuthMiddleware {
  verifyToken(authHeader: string | undefined): AuthResult {
    if (!authHeader?.startsWith('Bearer ')) {
      return { authenticated: false, reason: 'Missing or malformed Authorization header' };
    }

    const token = authHeader.slice(7).trim();
    const payload = VALID_TOKENS[token];

    if (!payload) {
      return { authenticated: false, reason: 'Token not recognized' };
    }

    const nowSeconds = Math.floor(Date.now() / 1000);
    if (payload.exp < nowSeconds) {
      return { authenticated: false, reason: 'Token expired' };
    }

    return { authenticated: true, payload };
  }

  enrichRequest(req: TenantRequest, authHeader: string | undefined): TenantRequest {
    const result = this.verifyToken(authHeader);
    if (!result.authenticated || !result.payload) {
      throw new Error(result.reason ?? 'Authentication failed');
    }

    return {
      ...req,
      tenantId: result.payload.tenantId,
      userId: result.payload.sub,
    };
  }
}
