import { TokenValidator } from '../auth/TokenValidator';

export interface RequestContext {
  headers: Record<string, string | undefined>;
  path: string;
}

export interface MiddlewareResult {
  allowed: boolean;
  userId?: string;
  reason?: string;
}

export class AuthMiddleware {
  private validator: TokenValidator;

  constructor(validator: TokenValidator) {
    this.validator = validator;
  }

  check(ctx: RequestContext): MiddlewareResult {
    const authHeader = ctx.headers['authorization'] ?? '';
    if (!authHeader.startsWith('Bearer ')) {
      return { allowed: false, reason: 'Missing or malformed Authorization header' };
    }

    const token = authHeader.slice(7);
    if (!this.validator.isValid(token)) {
      return { allowed: false, reason: 'Token is invalid or expired' };
    }

    const payload = this.validator.decode(token);
    return { allowed: true, userId: payload!.sub };
  }
}
