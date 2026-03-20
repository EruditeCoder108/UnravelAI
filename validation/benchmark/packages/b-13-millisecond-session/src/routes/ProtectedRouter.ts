import { AuthMiddleware, RequestContext } from '../middleware/AuthMiddleware';

export interface RouteResult {
  status: number;
  body: unknown;
}

export class ProtectedRouter {
  private auth: AuthMiddleware;

  constructor(auth: AuthMiddleware) {
    this.auth = auth;
  }

  handle(ctx: RequestContext): RouteResult {
    const result = this.auth.check(ctx);

    if (!result.allowed) {
      return { status: 401, body: { error: result.reason } };
    }

    return {
      status: 200,
      body: { message: `Hello, ${result.userId}`, data: { items: [] } },
    };
  }
}
