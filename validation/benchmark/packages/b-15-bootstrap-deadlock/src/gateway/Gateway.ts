import { AuthService } from '../auth/AuthService';
import { UserService } from '../users/UserService';

export interface GatewayRequest {
  token: string;
  path: string;
  caller: string;
}

export interface GatewayResponse {
  status: number;
  body: unknown;
}

export class Gateway {
  private authService: AuthService;

  constructor(authService: AuthService) {
    this.authService = authService;
  }

  handle(req: GatewayRequest): GatewayResponse {
    try {
      const result = this.authService.validateToken(req.token, req.caller);
      if (!result.valid) {
        return { status: 401, body: { error: result.reason } };
      }
      return { status: 200, body: { userId: result.userId, path: req.path } };
    } catch (err) {
      this.authService.logError('gateway.handle', err);
      return { status: 500, body: { error: 'Internal error' } };
    }
  }
}

export function buildGateway(): Gateway {
  const userService = new UserService(null as unknown as AuthService);
  const authService = new AuthService(userService);
  return new Gateway(authService);
}
