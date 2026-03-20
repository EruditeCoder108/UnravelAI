import { RateLimiter } from '../middleware/RateLimiter';

export interface HandlerRequest {
  ip: string;
  path: string;
  method: string;
}

export interface HandlerResponse {
  status: number;
  body: unknown;
}

const limiter = new RateLimiter(100, 60_000);

export class RequestHandler {
  handle(req: HandlerRequest): HandlerResponse {
    if (!limiter.check(req.ip)) {
      return {
        status: 429,
        body: { error: 'Too Many Requests', retryAfter: 60 },
      };
    }

    return {
      status: 200,
      body: { path: req.path, method: req.method, timestamp: Date.now() },
    };
  }

  getLimiter(): RateLimiter {
    return limiter;
  }
}
