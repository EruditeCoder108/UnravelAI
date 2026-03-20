import { AuthMiddleware, AuthContext } from '../auth/AuthMiddleware';

export interface AdminRequest {
  path: string;
  headers: Record<string, string | undefined>;
  body?: unknown;
}

export interface AdminResponse {
  status: number;
  body: unknown;
}

export class AdminRouter {
  private auth: AuthMiddleware;

  constructor(auth: AuthMiddleware) {
    this.auth = auth;
  }

  handle(req: AdminRequest): AdminResponse {
    const authResult = this.auth.requireAdmin(req.headers['authorization']);
    if (!authResult.allowed) {
      return { status: 401, body: { error: authResult.reason } };
    }

    const ctx = authResult.context as AuthContext;

    if (req.path === '/api/admin/users') {
      return { status: 200, body: { users: [], requestedBy: ctx.userId } };
    }

    if (req.path === '/api/admin/settings') {
      return { status: 200, body: { settings: {}, requestedBy: ctx.userId } };
    }

    if (req.path === '/api/admin/stats') {
      return { status: 200, body: { stats: {}, requestedBy: ctx.userId } };
    }

    return { status: 404, body: { error: 'Route not found' } };
  }
}
